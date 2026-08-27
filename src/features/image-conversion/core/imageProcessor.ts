import {
  assertSafeDecodedDimensions,
  assertSafeImageFile,
  sanitizeOutputStem,
} from "./inputValidation";

export type OutputFormat =
  | "WEBP"
  | "JPEG"
  | "PNG"
  | "AVIF"
  | "HEIC"
  | "BMP"
  | "PDF";

export type SearchUpdate = {
  parameter: number;
  sizeBytes: number;
  fits: boolean;
  attempt: number;
  totalAttempts: number;
  width: number;
  height: number;
  phase: "quality" | "scaling" | "target";
};

export type ProcessedResult = {
  blob: Blob;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  scaled: boolean;
  automaticParameter: boolean;
  qualityProtected: boolean;
  parameter: number;
  parameterLabel: "Quality" | "Colors" | "Lossless";
  strictTargetBytes: number;
  attempts: number;
};

export type ProcessOptions = {
  allowScaling?: boolean;
  preferredQuality?: number;
};

export type QualityPreview = {
  blob: Blob;
  estimatedBytes: number;
  height: number;
  parameter: number;
  parameterLabel: "Quality" | "Colors" | "Lossless";
  sizeIsEstimated: boolean;
  width: number;
};

type DecodeResult = {
  imageData: ImageData;
  width: number;
  height: number;
};

type ColorBin = {
  r: number;
  g: number;
  b: number;
  count: number;
};

type ColorBox = {
  bins: ColorBin[];
  count: number;
  rMin: number;
  rMax: number;
  gMin: number;
  gMax: number;
  bMin: number;
  bMax: number;
};

const MIME_BY_FORMAT: Record<OutputFormat, string> = {
  WEBP: "image/webp",
  JPEG: "image/jpeg",
  PNG: "image/png",
  AVIF: "image/avif",
  HEIC: "image/heic",
  BMP: "image/bmp",
  PDF: "application/pdf",
};

const EXTENSION_BY_FORMAT: Record<OutputFormat, string> = {
  WEBP: "webp",
  JPEG: "jpg",
  PNG: "png",
  AVIF: "avif",
  HEIC: "heic",
  BMP: "bmp",
  PDF: "pdf",
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const MINIMUM_PARAMETER: Record<OutputFormat, number> = {
  WEBP: 86,
  JPEG: 88,
  PNG: 192,
  AVIF: 72,
  HEIC: 76,
  BMP: 100,
  PDF: 88,
};

const ABSOLUTE_MINIMUM_PARAMETER: Record<OutputFormat, number> = {
  WEBP: 1,
  JPEG: 1,
  PNG: 2,
  AVIF: 1,
  HEIC: 1,
  BMP: 100,
  PDF: 1,
};

const MAXIMUM_PARAMETER: Record<OutputFormat, number> = {
  WEBP: 100,
  JPEG: 100,
  PNG: 256,
  AVIF: 100,
  HEIC: 100,
  BMP: 100,
  PDF: 100,
};

const normalizedQuality = (quality: number) =>
  clamp(Math.round(quality), 1, 100);

function qualityToParameter(format: OutputFormat, quality: number) {
  const normalized = normalizedQuality(quality);
  if (format === "PNG") return 2 + Math.round(((normalized - 1) / 99) * 254);
  if (format === "BMP") return 100;
  return normalized;
}

const decodeCache = new WeakMap<File, Promise<DecodeResult>>();
const encodeCache = new WeakMap<File, Map<string, Promise<Blob>>>();
const pngHistogramCache = new WeakMap<ImageData, Uint32Array>();
const encoderWarmups = new Map<OutputFormat, Promise<void>>();
const MAX_CACHED_ENCODINGS_PER_FILE = 12;

export function strictTargetBytes(maxSizeKb: number) {
  return Math.floor((maxSizeKb - 0.5) * 1000);
}

export function outputName(
  fileName: string,
  format: OutputFormat,
  scaled = false,
) {
  const base = sanitizeOutputStem(fileName);
  return `${base}${scaled ? "-scale" : ""}.${EXTENSION_BY_FORMAT[format]}`;
}

export function formatDecimalKb(bytes: number) {
  return `${(bytes / 1000).toFixed(bytes < 10_000 ? 2 : 1)} KB`;
}

function imageDataFromBitmap(bitmap: ImageBitmap): DecodeResult {
  assertSafeDecodedDimensions(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    bitmap.close();
    throw new Error("Your browser could not create an image workspace.");
  }

  context.drawImage(bitmap, 0, 0);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  bitmap.close();
  return { imageData, width: canvas.width, height: canvas.height };
}

async function decodeWithWasm(file: File): Promise<DecodeResult> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const buffer = await file.arrayBuffer();
  let decoded: ImageData;

  if (extension === "png" || file.type === "image/png") {
    const { decode } = await import("@jsquash/png");
    decoded = await decode(buffer);
  } else if (
    extension === "jpg" ||
    extension === "jpeg" ||
    file.type === "image/jpeg"
  ) {
    const { decode } = await import("@jsquash/jpeg");
    decoded = await decode(buffer, { preserveOrientation: true });
  } else if (extension === "webp" || file.type === "image/webp") {
    const { decode } = await import("@jsquash/webp");
    decoded = await decode(buffer);
  } else if (extension === "avif" || file.type === "image/avif") {
    const { decode } = await import("@jsquash/avif");
    decoded = (await decode(buffer)) as ImageData;
  } else {
    throw new Error(
      "This file could not be decoded. Use PNG, JPG, WebP, BMP, HEIC, or AVIF.",
    );
  }

  assertSafeDecodedDimensions(decoded.width, decoded.height);
  return { imageData: decoded, width: decoded.width, height: decoded.height };
}

async function decodeImage(file: File): Promise<DecodeResult> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const mayBeHeic = extension === "heic" || extension === "heif";

  if (mayBeHeic) {
    const { heicTo } = await import("heic-to/csp");
    const bitmap = await heicTo({ blob: file, type: "bitmap" });
    return imageDataFromBitmap(bitmap);
  }

  try {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
      premultiplyAlpha: "none",
    });
    return imageDataFromBitmap(bitmap);
  } catch {
    return decodeWithWasm(file);
  }
}

function decodeImageCached(file: File) {
  const cached = decodeCache.get(file);
  if (cached) return cached;

  const pending = decodeImage(file).catch((error) => {
    decodeCache.delete(file);
    throw error;
  });
  decodeCache.set(file, pending);
  return pending;
}

function flattenTransparencyOnWhite(source: ImageData) {
  let hasTransparency = false;
  for (let index = 3; index < source.data.length; index += 4) {
    if (source.data[index] !== 255) {
      hasTransparency = true;
      break;
    }
  }
  if (!hasTransparency) return source;

  const output = new Uint8ClampedArray(source.data.length);

  for (let index = 0; index < source.data.length; index += 4) {
    const alpha = source.data[index + 3] / 255;
    output[index] = Math.round(source.data[index] * alpha + 255 * (1 - alpha));
    output[index + 1] = Math.round(
      source.data[index + 1] * alpha + 255 * (1 - alpha),
    );
    output[index + 2] = Math.round(
      source.data[index + 2] * alpha + 255 * (1 - alpha),
    );
    output[index + 3] = 255;
  }

  return new ImageData(output, source.width, source.height);
}

function encodeBmp(source: ImageData) {
  const dibHeaderBytes = 108;
  const pixelOffset = 14 + dibHeaderBytes;
  const pixelBytes = source.width * source.height * 4;
  const buffer = new ArrayBuffer(pixelOffset + pixelBytes);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  bytes[0] = 0x42;
  bytes[1] = 0x4d;
  view.setUint32(2, buffer.byteLength, true);
  view.setUint32(10, pixelOffset, true);
  view.setUint32(14, dibHeaderBytes, true);
  view.setInt32(18, source.width, true);
  // A negative height stores scanlines top-to-bottom and avoids a costly flip.
  view.setInt32(22, -source.height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 32, true);
  view.setUint32(30, 3, true);
  view.setUint32(34, pixelBytes, true);
  view.setInt32(38, 3_780, true);
  view.setInt32(42, 3_780, true);
  view.setUint32(54, 0x00ff0000, true);
  view.setUint32(58, 0x0000ff00, true);
  view.setUint32(62, 0x000000ff, true);
  view.setUint32(66, 0xff000000, true);
  view.setUint32(70, 0x73524742, true);

  for (let sourceIndex = 0, targetIndex = pixelOffset;
    sourceIndex < source.data.length;
    sourceIndex += 4, targetIndex += 4) {
    bytes[targetIndex] = source.data[sourceIndex + 2];
    bytes[targetIndex + 1] = source.data[sourceIndex + 1];
    bytes[targetIndex + 2] = source.data[sourceIndex];
    bytes[targetIndex + 3] = source.data[sourceIndex + 3];
  }

  return buffer;
}

async function encodePdfPage(imageData: ImageData, quality: number) {
  const { encode } = await import("@jsquash/jpeg");
  const jpeg = await encode(flattenTransparencyOnWhite(imageData), {
    quality,
    progressive: true,
    optimize_coding: true,
    trellis_multipass: true,
    trellis_opt_zero: true,
    trellis_opt_table: true,
    trellis_loops: 3,
    auto_subsample: true,
    separate_chroma_quality: true,
    chroma_quality: Math.min(100, quality + 6),
  });
  const { PDFDocument } = await import("pdf-lib");
  const document = await PDFDocument.create();
  const embedded = await document.embedJpg(jpeg);
  const page = document.addPage([imageData.width, imageData.height]);
  page.drawImage(embedded, {
    x: 0,
    y: 0,
    width: imageData.width,
    height: imageData.height,
  });
  return (await document.save({
    addDefaultPage: false,
    objectsPerTick: 50,
    useObjectStreams: true,
  })).buffer as ArrayBuffer;
}

function createImageScaler(source: ImageData) {
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = source.width;
  sourceCanvas.height = source.height;
  const sourceContext = sourceCanvas.getContext("2d");
  if (!sourceContext) {
    throw new Error("Your browser could not create a scaling workspace.");
  }
  sourceContext.putImageData(source, 0, 0);

  return (width: number, height: number) => {
    if (width === source.width && height === source.height) return source;

    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = width;
    outputCanvas.height = height;
    const outputContext = outputCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    if (!outputContext) {
      throw new Error("Your browser could not create a scaling workspace.");
    }

    outputContext.imageSmoothingEnabled = true;
    outputContext.imageSmoothingQuality = "high";
    outputContext.drawImage(sourceCanvas, 0, 0, width, height);
    return outputContext.getImageData(0, 0, width, height);
  };
}

function describeBox(bins: ColorBin[]): ColorBox {
  let count = 0;
  let rMin = 255;
  let rMax = 0;
  let gMin = 255;
  let gMax = 0;
  let bMin = 255;
  let bMax = 0;

  for (const bin of bins) {
    count += bin.count;
    rMin = Math.min(rMin, bin.r);
    rMax = Math.max(rMax, bin.r);
    gMin = Math.min(gMin, bin.g);
    gMax = Math.max(gMax, bin.g);
    bMin = Math.min(bMin, bin.b);
    bMax = Math.max(bMax, bin.b);
  }

  return { bins, count, rMin, rMax, gMin, gMax, bMin, bMax };
}

function splitBox(box: ColorBox): [ColorBox, ColorBox] | null {
  if (box.bins.length < 2) return null;

  const ranges = [
    box.rMax - box.rMin,
    box.gMax - box.gMin,
    box.bMax - box.bMin,
  ];
  const channel = ranges.indexOf(Math.max(...ranges));
  const key = channel === 0 ? "r" : channel === 1 ? "g" : "b";
  const sorted = [...box.bins].sort((a, b) => a[key] - b[key]);
  const midpoint = box.count / 2;
  let running = 0;
  let splitIndex = 1;

  for (let index = 0; index < sorted.length - 1; index += 1) {
    running += sorted[index].count;
    if (running >= midpoint) {
      splitIndex = index + 1;
      break;
    }
  }

  return [
    describeBox(sorted.slice(0, splitIndex)),
    describeBox(sorted.slice(splitIndex)),
  ];
}

function createMedianCutPalette(source: ImageData, colorCount: number) {
  // Five-bit channel bins keep the histogram bounded while retaining the
  // median-cut behavior of the Pillow workflow.
  let histogram = pngHistogramCache.get(source);
  if (!histogram) {
    histogram = new Uint32Array(32 * 32 * 32);
    const data = source.data;

    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] === 0) continue;
      const r = data[index] >> 3;
      const g = data[index + 1] >> 3;
      const b = data[index + 2] >> 3;
      histogram[(r << 10) | (g << 5) | b] += 1;
    }
    pngHistogramCache.set(source, histogram);
  }

  const bins: ColorBin[] = [];
  histogram.forEach((count, packed) => {
    if (!count) return;
    bins.push({
      r: ((packed >> 10) & 31) * 8 + 4,
      g: ((packed >> 5) & 31) * 8 + 4,
      b: (packed & 31) * 8 + 4,
      count,
    });
  });

  if (bins.length === 0) return [[0, 0, 0] as const];

  const boxes = [describeBox(bins)];
  while (boxes.length < colorCount) {
    let candidateIndex = -1;
    let candidateScore = -1;

    boxes.forEach((box, index) => {
      if (box.bins.length < 2) return;
      const range = Math.max(
        box.rMax - box.rMin,
        box.gMax - box.gMin,
        box.bMax - box.bMin,
      );
      const score = (range + 1) * box.count;
      if (score > candidateScore) {
        candidateScore = score;
        candidateIndex = index;
      }
    });

    if (candidateIndex === -1) break;
    const split = splitBox(boxes[candidateIndex]);
    if (!split) break;
    boxes.splice(candidateIndex, 1, ...split);
  }

  return boxes.map((box) => {
    let r = 0;
    let g = 0;
    let b = 0;
    for (const bin of box.bins) {
      r += bin.r * bin.count;
      g += bin.g * bin.count;
      b += bin.b * bin.count;
    }
    return [
      Math.round(r / box.count),
      Math.round(g / box.count),
      Math.round(b / box.count),
    ] as const;
  });
}

function quantizeWithDithering(source: ImageData, colorCount: number) {
  const palette = createMedianCutPalette(source, colorCount);
  const output = new Uint8ClampedArray(source.data.length);
  const width = source.width;
  let currentErrors = new Float32Array((width + 2) * 3);
  let nextErrors = new Float32Array((width + 2) * 3);
  const nearestCache = new Int16Array(32 * 32 * 32);
  nearestCache.fill(-1);

  const nearestPaletteIndex = (r: number, g: number, b: number) => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const cached = nearestCache[key];
    if (cached >= 0) return cached;

    let nearest = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < palette.length; index += 1) {
      const candidate = palette[index];
      const rDelta = r - candidate[0];
      const gDelta = g - candidate[1];
      const bDelta = b - candidate[2];
      const distance =
        rDelta * rDelta * 0.299 +
        gDelta * gDelta * 0.587 +
        bDelta * bDelta * 0.114;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = index;
      }
    }
    nearestCache[key] = nearest;
    return nearest;
  };

  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = (y * width + x) * 4;
      const errorIndex = (x + 1) * 3;
      const alpha = source.data[pixelIndex + 3];

      if (alpha === 0) {
        output[pixelIndex] = 0;
        output[pixelIndex + 1] = 0;
        output[pixelIndex + 2] = 0;
        output[pixelIndex + 3] = 0;
        continue;
      }

      const r = Math.round(
        clamp(source.data[pixelIndex] + currentErrors[errorIndex], 0, 255),
      );
      const g = Math.round(
        clamp(
          source.data[pixelIndex + 1] + currentErrors[errorIndex + 1],
          0,
          255,
        ),
      );
      const b = Math.round(
        clamp(
          source.data[pixelIndex + 2] + currentErrors[errorIndex + 2],
          0,
          255,
        ),
      );
      const paletteIndex = nearestPaletteIndex(r, g, b);
      const [nextR, nextG, nextB] = palette[paletteIndex];
      output[pixelIndex] = nextR;
      output[pixelIndex + 1] = nextG;
      output[pixelIndex + 2] = nextB;
      output[pixelIndex + 3] = alpha;

      const rError = r - nextR;
      const gError = g - nextG;
      const bError = b - nextB;

      currentErrors[errorIndex + 3] += (rError * 7) / 16;
      currentErrors[errorIndex + 4] += (gError * 7) / 16;
      currentErrors[errorIndex + 5] += (bError * 7) / 16;
      nextErrors[errorIndex - 3] += (rError * 3) / 16;
      nextErrors[errorIndex - 2] += (gError * 3) / 16;
      nextErrors[errorIndex - 1] += (bError * 3) / 16;
      nextErrors[errorIndex] += (rError * 5) / 16;
      nextErrors[errorIndex + 1] += (gError * 5) / 16;
      nextErrors[errorIndex + 2] += (bError * 5) / 16;
      nextErrors[errorIndex + 3] += rError / 16;
      nextErrors[errorIndex + 4] += gError / 16;
      nextErrors[errorIndex + 5] += bError / 16;
    }

    const completedRowErrors = currentErrors;
    currentErrors = nextErrors;
    nextErrors = completedRowErrors;
    nextErrors.fill(0);
  }

  return new ImageData(output, source.width, source.height);
}

async function encodeImage(
  imageData: ImageData,
  format: OutputFormat,
  parameter: number,
  targetBytes = 0,
) {
  let encoded: ArrayBuffer;

  if (format === "PNG") {
    const { encode } = await import("@jsquash/png");
    encoded = await encode(
      parameter >= MAXIMUM_PARAMETER.PNG
        ? imageData
        : quantizeWithDithering(imageData, parameter),
    );
  } else if (format === "WEBP") {
    const { encode } = await import("@jsquash/webp");
    encoded = await encode(imageData, {
      quality: parameter,
      target_size: targetBytes,
      method: 6,
      pass: 10,
      autofilter: 1,
      filter_sharpness: 4,
      use_sharp_yuv: 1,
      lossless: 0,
      alpha_quality: 100,
      exact: 1,
    });
  } else if (format === "JPEG") {
    const { encode } = await import("@jsquash/jpeg");
    encoded = await encode(imageData, {
      quality: parameter,
      progressive: true,
      optimize_coding: true,
      trellis_multipass: true,
      trellis_opt_zero: true,
      trellis_opt_table: true,
      trellis_loops: 3,
      auto_subsample: true,
      separate_chroma_quality: true,
      chroma_quality: Math.min(100, parameter + 6),
    });
  } else if (format === "AVIF") {
    const { encode } = await import("@jsquash/avif");
    encoded = await encode(imageData, {
      quality: parameter,
      qualityAlpha: parameter,
      speed: 4,
      enableSharpYUV: true,
      sharpness: 2,
      tune: 2,
      lossless: false,
    });
  } else if (format === "BMP") {
    encoded = encodeBmp(imageData);
  } else if (format === "PDF") {
    encoded = await encodePdfPage(imageData, parameter);
  } else {
    throw new Error("HEIC uses the isolated native encoder.");
  }

  return new Blob([encoded], { type: MIME_BY_FORMAT[format] });
}

export function warmImageEncoder(format: OutputFormat) {
  if (format === "HEIC") return Promise.resolve();
  const cached = encoderWarmups.get(format);
  if (cached) return cached;

  const pending = (async () => {
    const pixel = new ImageData(
      new Uint8ClampedArray([
        128, 128, 128, 255,
        128, 128, 128, 255,
        128, 128, 128, 255,
        128, 128, 128, 255,
      ]),
      2,
      2,
    );
    await encodeImage(pixel, format, MINIMUM_PARAMETER[format]);
  })().catch((error) => {
    encoderWarmups.delete(format);
    throw error;
  });
  encoderWarmups.set(format, pending);
  return pending;
}

export async function createQualityPreview(
  file: File,
  format: OutputFormat,
  quality: number,
): Promise<QualityPreview> {
  await assertSafeImageFile(file);
  const decoded = await decodeImageCached(file);
  const previewFormat: OutputFormat =
    format === "HEIC" || format === "PDF" ? "JPEG" : format;
  const source =
    previewFormat === "JPEG"
      ? flattenTransparencyOnWhite(decoded.imageData)
      : decoded.imageData;
  const maximumDimension = 1_200;
  const scale = Math.min(1, maximumDimension / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const previewImage =
    width === source.width && height === source.height
      ? source
      : createImageScaler(source)(width, height);
  const parameter = qualityToParameter(format, quality);
  const previewParameter = qualityToParameter(previewFormat, quality);
  const blob = await encodeImage(previewImage, previewFormat, previewParameter);
  const sourcePixelCount = source.width * source.height;
  const previewPixelCount = width * height;
  const pixelRatio = sourcePixelCount / previewPixelCount;
  const sizeIsEstimated = pixelRatio > 1.01 || previewFormat !== format;
  const estimatedBytes = sizeIsEstimated
    ? Math.max(blob.size, Math.round(blob.size * Math.pow(pixelRatio, 0.94)))
    : blob.size;

  return {
    blob,
    estimatedBytes,
    width,
    height,
    parameter,
    parameterLabel:
      format === "PNG" ? "Colors" : format === "BMP" ? "Lossless" : "Quality",
    sizeIsEstimated,
  };
}

function encodeImageCached(
  file: File,
  imageData: ImageData,
  format: OutputFormat,
  parameter: number,
  targetBytes = 0,
) {
  let fileCache = encodeCache.get(file);
  if (!fileCache) {
    fileCache = new Map();
    encodeCache.set(file, fileCache);
  }

  const cacheKey = `${format}:${imageData.width}x${imageData.height}:${parameter}:${targetBytes}`;
  const cached = fileCache.get(cacheKey);
  if (cached) {
    fileCache.delete(cacheKey);
    fileCache.set(cacheKey, cached);
    return cached;
  }

  while (fileCache.size >= MAX_CACHED_ENCODINGS_PER_FILE) {
    const oldestKey = fileCache.keys().next().value;
    if (oldestKey === undefined) break;
    fileCache.delete(oldestKey);
  }

  const pending = encodeImage(
    imageData,
    format,
    parameter,
    targetBytes,
  ).catch((error) => {
    fileCache?.delete(cacheKey);
    throw error;
  });
  fileCache.set(cacheKey, pending);
  return pending;
}

export function releaseImageProcessingCache(file: File) {
  decodeCache.delete(file);
  encodeCache.delete(file);
}

function responseInteger(response: Response, name: string) {
  const value = Number.parseInt(response.headers.get(name) ?? "", 10);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("The native HEIC encoder returned incomplete metadata.");
  }
  return value;
}

async function processHeic(
  file: File,
  maxSizeKb: number,
  onUpdate?: (update: SearchUpdate) => void,
  signal?: AbortSignal,
  options: ProcessOptions = {},
): Promise<ProcessedResult> {
  const response = await fetch(
    `/api/image-convert?target=heic&maxKb=${encodeURIComponent(maxSizeKb)}&allowScaling=${options.allowScaling ? "1" : "0"}&preferredQuality=${encodeURIComponent(normalizedQuality(options.preferredQuality ?? 100))}`,
    {
      body: file,
      headers: {
        "Content-Type": "application/octet-stream",
        "X-PixelLock-Filename": encodeURIComponent(file.name),
        "X-PixelLock-Request": "local-conversion",
      },
      method: "POST",
      signal,
    },
  );
  if (!response.ok) {
    throw new Error((await response.text()) || "The image could not be encoded as HEIC.");
  }

  const blob = await response.blob();
  const width = responseInteger(response, "X-PixelLock-Width");
  const height = responseInteger(response, "X-PixelLock-Height");
  const originalWidth = responseInteger(response, "X-PixelLock-Original-Width");
  const originalHeight = responseInteger(response, "X-PixelLock-Original-Height");
  const parameter = responseInteger(response, "X-PixelLock-Quality");
  const attempts = responseInteger(response, "X-PixelLock-Attempts");
  const scaled = response.headers.get("X-PixelLock-Scaled") === "1";
  const qualityProtected = response.headers.get("X-PixelLock-Quality-Protected") === "1";

  onUpdate?.({
    parameter,
    sizeBytes: blob.size,
    fits: true,
    attempt: attempts,
    totalAttempts: attempts,
    width,
    height,
    phase: scaled ? "scaling" : "quality",
  });

  return {
    blob,
    width,
    height,
    originalWidth,
    originalHeight,
    scaled,
    automaticParameter: false,
    qualityProtected,
    parameter,
    parameterLabel: "Quality",
    strictTargetBytes: strictTargetBytes(maxSizeKb),
    attempts,
  };
}

export async function processImage(
  file: File,
  format: OutputFormat,
  maxSizeKb: number,
  onUpdate?: (update: SearchUpdate) => void,
  signal?: AbortSignal,
  options: ProcessOptions = {},
): Promise<ProcessedResult> {
  await assertSafeImageFile(file);
  const targetBytes = strictTargetBytes(maxSizeKb);
  if (!Number.isFinite(maxSizeKb) || targetBytes <= 0) {
    throw new Error("Choose a maximum size greater than 0.5 KB.");
  }
  if (format === "HEIC") {
    return processHeic(file, maxSizeKb, onUpdate, signal, options);
  }

  const decoded = await decodeImageCached(file);
  const originalImage =
    format === "JPEG" || format === "PDF"
      ? flattenTransparencyOnWhite(decoded.imageData)
      : decoded.imageData;
  let attempts = 0;
  const totalAttempts = options.allowScaling ? 40 : 14;
  const preferredMaximumParameter = qualityToParameter(
    format,
    options.preferredQuality ?? 100,
  );
  const protectedMinimumParameter = Math.min(
    MINIMUM_PARAMETER[format],
    preferredMaximumParameter,
  );

  const encodeAndReport = async (
    imageData: ImageData,
    parameter: number,
    phase: SearchUpdate["phase"],
    requestedTargetBytes = 0,
  ) => {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const blob = await encodeImageCached(
      file,
      imageData,
      format,
      parameter,
      requestedTargetBytes,
    );
    attempts += 1;
    onUpdate?.({
      parameter,
      sizeBytes: blob.size,
      fits: blob.size <= targetBytes,
      attempt: attempts,
      totalAttempts,
      width: imageData.width,
      height: imageData.height,
      phase,
    });
    return blob;
  };

  const searchBestParameter = async (
    imageData: ImageData,
    minimumParameter = protectedMinimumParameter,
    maximumParameter = preferredMaximumParameter,
  ) => {
    let low = minimumParameter;
    let high = maximumParameter;
    let bestParameter = -1;
    let bestBlob: Blob | null = null;
    let smallestBlobSize = Number.POSITIVE_INFINITY;
    const automaticParameter = false;

    const minimumBlob = await encodeAndReport(imageData, low, "quality");
    smallestBlobSize = minimumBlob.size;
    if (minimumBlob.size > targetBytes) {
      return {
        bestBlob,
        bestParameter,
        smallestBlobSize,
        automaticParameter,
      };
    }

    bestBlob = minimumBlob;
    bestParameter = low;

    if (format === "WEBP" && options.preferredQuality === undefined) {
      const targetBlob = await encodeAndReport(
        imageData,
        high,
        "target",
        targetBytes,
      );
      if (targetBlob.size <= targetBytes) {
        return {
          bestBlob: targetBlob,
          bestParameter: high,
          smallestBlobSize,
          automaticParameter: true,
        };
      }

    }

    low += 1;

    while (low <= high) {
      const parameter = Math.floor((low + high) / 2);
      const blob = await encodeAndReport(imageData, parameter, "quality");
      if (blob.size < smallestBlobSize) {
        smallestBlobSize = blob.size;
      }
      if (blob.size <= targetBytes) {
        bestParameter = parameter;
        bestBlob = blob;
        low = parameter + 1;
      } else {
        high = parameter - 1;
      }
    }

    return {
      bestBlob,
      bestParameter,
      smallestBlobSize,
      automaticParameter,
    };
  };

  let workingImage = originalImage;
  let {
    bestBlob,
    bestParameter,
    smallestBlobSize,
    automaticParameter,
  } = await searchBestParameter(workingImage);
  let qualityProtected =
    preferredMaximumParameter >= MINIMUM_PARAMETER[format];

  if (!bestBlob && !options.allowScaling && format !== "BMP") {
    qualityProtected = false;
    ({
      bestBlob,
      bestParameter,
      smallestBlobSize,
      automaticParameter,
    } = await searchBestParameter(
      workingImage,
      ABSOLUTE_MINIMUM_PARAMETER[format],
      protectedMinimumParameter - 1,
    ));
  }

  if (!bestBlob && options.allowScaling) {
    const minimumScale = Math.max(1 / decoded.width, 1 / decoded.height);
    const scaleImage = createImageScaler(originalImage);
    let nonFittingScale = 1;
    let fittingScale = -1;
    let probeScale = clamp(
      Math.sqrt(targetBytes / smallestBlobSize) * 0.97,
      minimumScale,
      0.98,
    );

    // First establish a guaranteed fitting lower bound. The size estimate is
    // usually close, while the reduction loop handles hard-to-compress images.
    while (fittingScale < 0) {
      const width = Math.max(1, Math.round(decoded.width * probeScale));
      const height = Math.max(1, Math.round(decoded.height * probeScale));
      const candidate = scaleImage(width, height);
      const blob = await encodeAndReport(
        candidate,
        protectedMinimumParameter,
        "scaling",
      );

      if (blob.size <= targetBytes) {
        fittingScale = probeScale;
        break;
      }

      nonFittingScale = probeScale;
      if (probeScale <= minimumScale) break;
      probeScale = Math.max(minimumScale, probeScale * 0.65);
    }

    if (fittingScale > 0) {
      // Refine upward to keep the largest dimensions that satisfy the hard
      // byte ceiling at the protected minimum quality.
      let lowScale = fittingScale;
      let highScale = nonFittingScale;
      for (let index = 0; index < 8; index += 1) {
        const scale = (lowScale + highScale) / 2;
        const width = Math.max(1, Math.round(decoded.width * scale));
        const height = Math.max(1, Math.round(decoded.height * scale));
        const candidate = scaleImage(width, height);
        const blob = await encodeAndReport(
          candidate,
          protectedMinimumParameter,
          "scaling",
        );

        if (blob.size <= targetBytes) {
          fittingScale = scale;
          lowScale = scale;
        } else {
          highScale = scale;
        }
      }

      const width = Math.max(1, Math.round(decoded.width * fittingScale));
      const height = Math.max(1, Math.round(decoded.height * fittingScale));
      workingImage = scaleImage(width, height);
      ({
        bestBlob,
        bestParameter,
        smallestBlobSize,
        automaticParameter,
      } = await searchBestParameter(workingImage));
    }
  }

  if (!bestBlob || bestParameter === -1) {
    throw new Error(
      options.allowScaling
        ? `The ${maxSizeKb} KB target is too small for a sharp ${format} file. Choose a larger maximum size.`
        : `Strict ${maxSizeKb} KB limit cannot be represented in ${format} at the original dimensions. Turn on Allow scaling or choose a larger maximum size.`,
    );
  }

  if (bestBlob.size > targetBytes) {
    throw new Error("Strict size verification failed. No oversized file was written.");
  }

  return {
    blob: bestBlob,
    width: workingImage.width,
    height: workingImage.height,
    originalWidth: decoded.width,
    originalHeight: decoded.height,
    scaled:
      workingImage.width !== decoded.width ||
      workingImage.height !== decoded.height,
    automaticParameter,
    qualityProtected,
    parameter: bestParameter,
    parameterLabel:
      format === "PNG" ? "Colors" : format === "BMP" ? "Lossless" : "Quality",
    strictTargetBytes: targetBytes,
    attempts,
  };
}
