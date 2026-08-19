export type OutputFormat = "WEBP" | "JPEG" | "PNG" | "AVIF";

export type SearchUpdate = {
  parameter: number;
  sizeBytes: number;
  fits: boolean;
  attempt: number;
  totalAttempts: number;
};

export type ProcessedResult = {
  blob: Blob;
  width: number;
  height: number;
  parameter: number;
  parameterLabel: "Quality" | "Colors";
  strictTargetBytes: number;
  attempts: number;
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
};

const EXTENSION_BY_FORMAT: Record<OutputFormat, string> = {
  WEBP: "webp",
  JPEG: "jpg",
  PNG: "png",
  AVIF: "avif",
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function strictTargetBytes(maxSizeKb: number) {
  return Math.floor((maxSizeKb - 0.5) * 1000);
}

export function outputName(fileName: string, format: OutputFormat) {
  const base = fileName.replace(/\.[^/.]+$/, "") || "image";
  return `${base}.${EXTENSION_BY_FORMAT[format]}`;
}

export function formatDecimalKb(bytes: number) {
  return `${(bytes / 1000).toFixed(bytes < 10_000 ? 2 : 1)} KB`;
}

function imageDataFromBitmap(bitmap: ImageBitmap): DecodeResult {
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

function flattenTransparencyOnWhite(source: ImageData) {
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
  const histogram = new Uint32Array(32 * 32 * 32);
  const data = source.data;

  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) continue;
    const r = data[index] >> 3;
    const g = data[index + 1] >> 3;
    const b = data[index + 2] >> 3;
    histogram[(r << 10) | (g << 5) | b] += 1;
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

      const errors = [r - nextR, g - nextG, b - nextB];
      for (let channel = 0; channel < 3; channel += 1) {
        const error = errors[channel];
        currentErrors[errorIndex + 3 + channel] += (error * 7) / 16;
        nextErrors[errorIndex - 3 + channel] += (error * 3) / 16;
        nextErrors[errorIndex + channel] += (error * 5) / 16;
        nextErrors[errorIndex + 3 + channel] += error / 16;
      }
    }

    currentErrors = nextErrors;
    nextErrors = new Float32Array((width + 2) * 3);
  }

  return new ImageData(output, source.width, source.height);
}

async function encodeImage(
  imageData: ImageData,
  format: OutputFormat,
  parameter: number,
) {
  let encoded: ArrayBuffer;

  if (format === "PNG") {
    const { encode } = await import("@jsquash/png");
    encoded = await encode(quantizeWithDithering(imageData, parameter));
  } else if (format === "WEBP") {
    const { encode } = await import("@jsquash/webp");
    encoded = await encode(imageData, {
      quality: parameter,
      method: 6,
      lossless: 0,
      alpha_quality: 100,
      exact: 1,
    });
  } else if (format === "JPEG") {
    const { encode } = await import("@jsquash/jpeg");
    encoded = await encode(imageData, {
      quality: parameter,
      progressive: false,
      optimize_coding: true,
      auto_subsample: false,
      chroma_subsample: 2,
    });
  } else {
    const { encode } = await import("@jsquash/avif");
    encoded = await encode(imageData, {
      quality: parameter,
      qualityAlpha: parameter,
      speed: 6,
      lossless: false,
    });
  }

  return new Blob([encoded], { type: MIME_BY_FORMAT[format] });
}

export async function processImage(
  file: File,
  format: OutputFormat,
  maxSizeKb: number,
  onUpdate?: (update: SearchUpdate) => void,
  signal?: AbortSignal,
): Promise<ProcessedResult> {
  const targetBytes = strictTargetBytes(maxSizeKb);
  if (!Number.isFinite(maxSizeKb) || targetBytes <= 0) {
    throw new Error("Choose a maximum size greater than 0.5 KB.");
  }

  const decoded = await decodeImage(file);
  const workingImage =
    format === "JPEG"
      ? flattenTransparencyOnWhite(decoded.imageData)
      : decoded.imageData;
  let low = format === "PNG" ? 2 : 1;
  let high = format === "PNG" ? 256 : 100;
  let bestParameter = -1;
  let bestBlob: Blob | null = null;
  let attempts = 0;
  const totalAttempts = Math.ceil(Math.log2(high - low + 1));

  while (low <= high) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const parameter = Math.floor((low + high) / 2);
    const blob = await encodeImage(workingImage, format, parameter);
    attempts += 1;
    const fits = blob.size <= targetBytes;
    onUpdate?.({
      parameter,
      sizeBytes: blob.size,
      fits,
      attempt: attempts,
      totalAttempts,
    });

    if (fits) {
      bestParameter = parameter;
      bestBlob = blob;
      low = parameter + 1;
    } else {
      high = parameter - 1;
    }
  }

  if (!bestBlob || bestParameter === -1) {
    throw new Error(
      `Cannot reach ${maxSizeKb} KB without changing the ${decoded.width} × ${decoded.height} dimensions.`,
    );
  }

  return {
    blob: bestBlob,
    width: decoded.width,
    height: decoded.height,
    parameter: bestParameter,
    parameterLabel: format === "PNG" ? "Colors" : "Quality",
    strictTargetBytes: targetBytes,
    attempts,
  };
}
