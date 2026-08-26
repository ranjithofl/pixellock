import { decompressFrames, parseGIF } from "gifuct-js";
import { GIFEncoder, applyPalette, quantize } from "gifenc";

export type GifQuality = "maximum" | "balanced" | "compact";

const maximumGifBytes = 100 * 1_000_000;
const maximumDimension = 4_096;
const maximumFrames = 1_000;
const maximumAnimationPixels = 120_000_000;

function validateGif(file: File, bytes: Uint8Array) {
  if (file.size < 14 || file.size > maximumGifBytes) {
    throw new Error("GIF files must be between 14 bytes and 100 MB.");
  }
  const signature = new TextDecoder("ascii").decode(bytes.subarray(0, 6));
  if (signature !== "GIF87a" && signature !== "GIF89a") {
    throw new Error("This file does not contain a valid GIF signature.");
  }
}

function ownedBuffer(bytes: Uint8Array | Uint8ClampedArray) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function compositeFrames(fileBytes: Uint8Array) {
  const parsed = parseGIF(ownedBuffer(fileBytes));
  const width = parsed.lsd.width;
  const height = parsed.lsd.height;
  const imageFrameCount = parsed.frames.filter((frame) => "image" in frame).length;
  if (
    width < 1 ||
    height < 1 ||
    width > maximumDimension ||
    height > maximumDimension ||
    imageFrameCount < 1 ||
    imageFrameCount > maximumFrames ||
    width * height * imageFrameCount > maximumAnimationPixels
  ) {
    throw new Error("The GIF dimensions or frame count exceed the safe animation limit.");
  }
  const decoded = decompressFrames(parsed, true);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas rendering is unavailable in this browser.");
  const patchCanvas = document.createElement("canvas");
  const patchContext = patchCanvas.getContext("2d");
  if (!patchContext) throw new Error("Canvas rendering is unavailable in this browser.");

  const frames: Array<{ delay: number; pixels: Uint8ClampedArray }> = [];
  let previousDisposal = 0;
  let previousDimensions = { left: 0, top: 0, width, height };
  let restoreImage: ImageData | null = null;
  for (const frame of decoded) {
    if (previousDisposal === 2) {
      context.clearRect(
        previousDimensions.left,
        previousDimensions.top,
        previousDimensions.width,
        previousDimensions.height,
      );
    } else if (previousDisposal === 3 && restoreImage) {
      context.putImageData(restoreImage, 0, 0);
    }
    const nextRestore = frame.disposalType === 3
      ? context.getImageData(0, 0, width, height)
      : null;
    patchCanvas.width = frame.dims.width;
    patchCanvas.height = frame.dims.height;
    patchContext.clearRect(0, 0, patchCanvas.width, patchCanvas.height);
    const patch = new Uint8ClampedArray(frame.patch.length);
    patch.set(frame.patch);
    patchContext.putImageData(
      new ImageData(patch, frame.dims.width, frame.dims.height),
      0,
      0,
    );
    context.drawImage(patchCanvas, frame.dims.left, frame.dims.top);
    frames.push({
      delay: Math.max(20, frame.delay || 100),
      pixels: new Uint8ClampedArray(context.getImageData(0, 0, width, height).data),
    });
    previousDisposal = frame.disposalType;
    previousDimensions = frame.dims;
    restoreImage = nextRestore;
  }
  canvas.width = 1;
  canvas.height = 1;
  patchCanvas.width = 1;
  patchCanvas.height = 1;
  return { frames, height, width };
}

function encodeFrames(
  frames: Array<{ delay: number; pixels: Uint8ClampedArray }>,
  width: number,
  height: number,
  colorCount: number,
) {
  const encoder = GIFEncoder({ initialCapacity: Math.max(4_096, width * height) });
  frames.forEach((frame, index) => {
    const palette = quantize(frame.pixels, colorCount, {
      clearAlpha: true,
      clearAlphaColor: 0,
      clearAlphaThreshold: 127,
      format: "rgba4444",
      oneBitAlpha: true,
      useSqrt: true,
    });
    const transparentIndex = palette.findIndex((color) => (color[3] ?? 255) === 0);
    const indexed = applyPalette(frame.pixels, palette, "rgba4444");
    encoder.writeFrame(indexed, width, height, {
      colorDepth: 8,
      delay: frame.delay,
      dispose: 2,
      palette,
      repeat: index === 0 ? 0 : undefined,
      transparent: transparentIndex >= 0,
      transparentIndex: Math.max(0, transparentIndex),
    });
  });
  encoder.finish();
  return encoder.bytes();
}

export async function compressGif(
  file: File,
  quality: GifQuality,
  onProgress: (message: string, completed: number, total: number) => void,
) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  validateGif(file, bytes);
  onProgress("Decoding animation frames", 0, 2);
  const { frames, height, width } = compositeFrames(bytes);
  const startingColors = { maximum: 256, balanced: 128, compact: 64 }[quality];
  const colorAttempts = [startingColors, 96, 64, 48, 32]
    .filter((value, index, values) => value <= startingColors && values.indexOf(value) === index)
    .sort((a, b) => b - a);
  let best: Uint8Array | null = null;
  let usedColors = startingColors;
  for (let index = 0; index < colorAttempts.length; index += 1) {
    const colors = colorAttempts[index];
    onProgress(`Encoding ${frames.length} frames with up to ${colors} colors`, index + 1, colorAttempts.length + 1);
    const candidate = encodeFrames(frames, width, height, colors);
    if (!best || candidate.byteLength < best.byteLength) {
      best = candidate;
      usedColors = colors;
    }
    if (candidate.byteLength < file.size) break;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }
  if (!best) throw new Error("The GIF encoder did not create an output file.");
  if (best.byteLength >= file.size) {
    throw new Error("This GIF is already smaller than a high-quality rebuilt copy. No larger replacement was created.");
  }
  onProgress("GIF compression complete", colorAttempts.length + 1, colorAttempts.length + 1);
  return {
    blob: new Blob([ownedBuffer(best)], { type: "image/gif" }),
    colors: usedColors,
    frameCount: frames.length,
    height,
    width,
  };
}
