const SUPPORTED_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "bmp",
  "heic",
  "heif",
  "avif",
]);

const BMFF_BRANDS = new Set([
  "avif",
  "avis",
  "heic",
  "heix",
  "hevc",
  "hevx",
  "mif1",
  "msf1",
]);

export const MAX_INPUT_FILE_BYTES = 200_000_000;
export const MAX_DECODED_PIXELS = 40_000_000;
export const MAX_IMAGE_DIMENSION = 32_768;

export function hasUnsafePathCharacters(value: string) {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (
      codePoint < 32 ||
      codePoint === 127 ||
      character === "/" ||
      character === "\\"
    );
  });
}

export function sanitizeOutputStem(fileName: string) {
  const rawBase = fileName
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.[^/.]+$/, "")
    .normalize("NFC");
  const invalidFileCharacters = new Set(["<", ">", ":", '"', "|", "?", "*"]);
  let base = Array.from(rawBase ?? "image")
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127 || invalidFileCharacters.has(character)
        ? "-"
        : character;
    })
    .join("")
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "")
    .trim()
    .slice(0, 120);
  if (!base) base = "image";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)) {
    base = `image-${base}`;
  }
  return base;
}

function extensionOf(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function bytesMatch(
  bytes: Uint8Array,
  offset: number,
  expected: readonly number[],
) {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function asciiAt(bytes: Uint8Array, offset: number) {
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  );
}

function hasSupportedBmffBrand(bytes: Uint8Array) {
  if (asciiAt(bytes, 4) !== "ftyp") return false;
  for (let offset = 8; offset + 3 < bytes.length; offset += 4) {
    if (BMFF_BRANDS.has(asciiAt(bytes, offset))) return true;
  }
  return false;
}

function hasExpectedSignature(extension: string, bytes: Uint8Array) {
  if (extension === "png") {
    return bytesMatch(bytes, 0, [137, 80, 78, 71, 13, 10, 26, 10]);
  }
  if (extension === "jpg" || extension === "jpeg") {
    return bytesMatch(bytes, 0, [255, 216, 255]);
  }
  if (extension === "webp") {
    return asciiAt(bytes, 0) === "RIFF" && asciiAt(bytes, 8) === "WEBP";
  }
  if (extension === "bmp") {
    return bytesMatch(bytes, 0, [66, 77]);
  }
  return hasSupportedBmffBrand(bytes);
}

export function isSupportedImageName(name: string) {
  return SUPPORTED_EXTENSIONS.has(extensionOf(name));
}

export async function assertSafeImageFile(file: File) {
  if (!file.name || hasUnsafePathCharacters(file.name)) {
    throw new Error("The image has an unsafe file name.");
  }
  if (!isSupportedImageName(file.name)) {
    throw new Error("Unsupported image format.");
  }
  if (file.size <= 0) {
    throw new Error("The image file is empty.");
  }
  if (file.size > MAX_INPUT_FILE_BYTES) {
    throw new Error("The image exceeds the 200 MB input safety limit.");
  }

  const header = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  if (!hasExpectedSignature(extensionOf(file.name), header)) {
    throw new Error("The file contents do not match its image extension.");
  }
}

export function assertSafeDecodedDimensions(width: number, height: number) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION ||
    width * height > MAX_DECODED_PIXELS
  ) {
    throw new Error(
      "The image dimensions exceed the 40 megapixel processing safety limit.",
    );
  }
}
