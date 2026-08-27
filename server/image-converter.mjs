import { access, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { securityHeaders } from "../config/security-headers.mjs";

const maximumInputBytes = 200 * 1_000_000;
const maximumOutputBytes = 200 * 1_000_000;
const maximumConcurrentConversions = 2;
const protectedQuality = 76;
const supportedExtensions = new Set([
  ".avif",
  ".bmp",
  ".heic",
  ".heif",
  ".jpeg",
  ".jpg",
  ".png",
  ".webp",
]);
const bmffBrands = new Set(["avif", "avis", "heic", "heix", "hevc", "hevx", "mif1", "msf1"]);
let activeConversions = 0;

function sendText(res, statusCode, message) {
  res.writeHead(statusCode, {
    ...securityHeaders(),
    "Content-Type": "text/plain; charset=utf-8",
  });
  res.end(message);
}

function asciiAt(bytes, offset) {
  return bytes.subarray(offset, offset + 4).toString("ascii");
}

function validSignature(extension, input) {
  const header = input.subarray(0, 96);
  if (extension === ".png") {
    return header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (extension === ".jpg" || extension === ".jpeg") {
    return header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  }
  if (extension === ".webp") {
    return asciiAt(header, 0) === "RIFF" && asciiAt(header, 8) === "WEBP";
  }
  if (extension === ".bmp") return asciiAt(header, 0).startsWith("BM");
  if (asciiAt(header, 4) !== "ftyp") return false;
  for (let offset = 8; offset + 3 < header.length; offset += 4) {
    if (bmffBrands.has(asciiAt(header, offset))) return true;
  }
  return false;
}

async function receiveBody(req, expectedLength) {
  const chunks = [];
  let received = 0;
  for await (const chunk of req) {
    received += chunk.length;
    if (received > maximumInputBytes || received > expectedLength) {
      throw new Error("INPUT_TOO_LARGE");
    }
    chunks.push(chunk);
  }
  if (received !== expectedLength) throw new Error("INCOMPLETE_INPUT");
  return Buffer.concat(chunks, received);
}

function runSips(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/sips", args, {
      env: {
        LANG: "C.UTF-8",
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        TMPDIR: process.env.TMPDIR,
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let diagnostic = "";
    const capture = (chunk) => {
      if (diagnostic.length < 8_000) diagnostic += chunk.toString("utf8");
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("CONVERSION_TIMEOUT"));
    }, 45_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(diagnostic);
      else reject(new Error(`CONVERSION_FAILED:${diagnostic.slice(0, 400)}`));
    });
  });
}

function dimensionsFromDiagnostic(diagnostic) {
  const width = Number.parseInt(/pixelWidth:\s*(\d+)/.exec(diagnostic)?.[1] ?? "", 10);
  const height = Number.parseInt(/pixelHeight:\s*(\d+)/.exec(diagnostic)?.[1] ?? "", 10);
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 32_768 ||
    height > 32_768 ||
    width * height > 40_000_000
  ) {
    throw new Error("UNSAFE_DIMENSIONS");
  }
  return { width, height };
}

function safeDownloadName(sourceName) {
  const stem = basename(sourceName, extname(sourceName))
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._ -]+/g, "-")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 120) || "converted";
  return `${stem}.heic`;
}

export async function handleImageConversion(req, res, requestUrl, port) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendText(res, 405, "Method not allowed");
    return;
  }
  if (process.platform !== "darwin") {
    sendText(res, 501, "HEIC output currently requires the native macOS image encoder.");
    return;
  }
  const allowedOrigins = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`]);
  if (!req.headers.origin || !allowedOrigins.has(req.headers.origin)) {
    sendText(res, 403, "Invalid request origin");
    return;
  }
  if (req.headers["x-pixellock-request"] !== "local-conversion") {
    sendText(res, 403, "Invalid conversion request");
    return;
  }
  if (req.headers["content-type"] !== "application/octet-stream") {
    sendText(res, 415, "Unsupported upload type");
    return;
  }
  if (requestUrl.searchParams.get("target") !== "heic") {
    sendText(res, 400, "Unsupported image target");
    return;
  }

  const contentLength = Number.parseInt(req.headers["content-length"] ?? "", 10);
  if (!Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > maximumInputBytes) {
    sendText(res, 413, "Image must be between 1 byte and 200 MB");
    return;
  }
  const maximumKb = Number(requestUrl.searchParams.get("maxKb"));
  const targetBytes = Math.floor((maximumKb - 0.5) * 1_000);
  if (!Number.isFinite(maximumKb) || targetBytes < 1 || targetBytes > maximumOutputBytes) {
    sendText(res, 400, "Invalid maximum output size");
    return;
  }
  const allowScaling = requestUrl.searchParams.get("allowScaling") === "1";
  const preferredQuality = Number.parseInt(
    requestUrl.searchParams.get("preferredQuality") ?? "100",
    10,
  );
  if (!Number.isSafeInteger(preferredQuality) || preferredQuality < 1 || preferredQuality > 100) {
    sendText(res, 400, "Invalid preferred quality");
    return;
  }

  let originalName;
  try {
    originalName = decodeURIComponent(req.headers["x-pixellock-filename"] ?? "");
  } catch {
    sendText(res, 400, "Invalid file name");
    return;
  }
  if (!originalName || originalName.length > 200 || originalName.includes("\0") || basename(originalName) !== originalName) {
    sendText(res, 400, "Invalid file name");
    return;
  }
  const extension = extname(originalName).toLowerCase();
  if (!supportedExtensions.has(extension)) {
    sendText(res, 415, "Unsupported image source format");
    return;
  }
  if (activeConversions >= maximumConcurrentConversions) {
    sendText(res, 429, "Two native image conversions are already running. Please retry shortly.");
    return;
  }

  activeConversions += 1;
  req.setTimeout(180_000);
  let temporaryRoot;
  try {
    await access("/usr/bin/sips");
    const input = await receiveBody(req, contentLength);
    if (!validSignature(extension, input)) throw new Error("INVALID_SOURCE_FILE");
    temporaryRoot = await mkdtemp(join(tmpdir(), "pixellock-image-"));
    const inputPath = join(temporaryRoot, `source${extension}`);
    await writeFile(inputPath, input, { flag: "wx", mode: 0o600 });
    const dimensions = dimensionsFromDiagnostic(
      await runSips(["-g", "pixelWidth", "-g", "pixelHeight", inputPath]),
    );
    let attempts = 0;

    const encode = async (quality, width = dimensions.width, height = dimensions.height) => {
      attempts += 1;
      if (attempts > 40) throw new Error("TOO_MANY_ATTEMPTS");
      const outputPath = join(temporaryRoot, `candidate-${attempts}.heic`);
      const resizeArgs =
        width === dimensions.width && height === dimensions.height
          ? []
          : ["-z", String(height), String(width)];
      await runSips([
        "-s", "format", "heic",
        "-s", "formatOptions", String(quality),
        ...resizeArgs,
        inputPath,
        "-o", outputPath,
      ]);
      const outputStat = await stat(outputPath);
      if (!outputStat.isFile() || outputStat.size < 1 || outputStat.size > maximumOutputBytes) {
        throw new Error("OUTPUT_SIZE_INVALID");
      }
      return { height, outputPath, quality, size: outputStat.size, width };
    };

    const searchQuality = async (width, height, minimumQuality) => {
      let low = minimumQuality;
      let high = preferredQuality;
      let best = null;
      while (low <= high) {
        const quality = Math.floor((low + high) / 2);
        const candidate = await encode(quality, width, height);
        if (candidate.size <= targetBytes) {
          best = candidate;
          low = quality + 1;
        } else {
          high = quality - 1;
        }
      }
      return best;
    };

    const preferredMinimumQuality = Math.min(protectedQuality, preferredQuality);
    let best = await searchQuality(dimensions.width, dimensions.height, preferredMinimumQuality);
    let qualityProtected = preferredQuality >= protectedQuality;
    let scaled = false;

    if (!best && !allowScaling) {
      best = await searchQuality(dimensions.width, dimensions.height, 1);
      qualityProtected = Boolean(best && best.quality >= protectedQuality);
    }

    if (!best && allowScaling) {
      const baseline = await encode(preferredMinimumQuality);
      const minimumScale = Math.max(1 / dimensions.width, 1 / dimensions.height);
      let probeScale = Math.max(
        minimumScale,
        Math.min(0.98, Math.sqrt(targetBytes / baseline.size) * 0.97),
      );
      let fittingScale = -1;
      let nonFittingScale = 1;
      while (fittingScale < 0) {
        const width = Math.max(1, Math.round(dimensions.width * probeScale));
        const height = Math.max(1, Math.round(dimensions.height * probeScale));
        const candidate = await encode(preferredMinimumQuality, width, height);
        if (candidate.size <= targetBytes) {
          fittingScale = probeScale;
          best = candidate;
          break;
        }
        nonFittingScale = probeScale;
        if (probeScale <= minimumScale) break;
        probeScale = Math.max(minimumScale, probeScale * 0.65);
      }
      if (fittingScale > 0) {
        let lowScale = fittingScale;
        let highScale = nonFittingScale;
        for (let index = 0; index < 7; index += 1) {
          const scale = (lowScale + highScale) / 2;
          const width = Math.max(1, Math.round(dimensions.width * scale));
          const height = Math.max(1, Math.round(dimensions.height * scale));
          const candidate = await encode(preferredMinimumQuality, width, height);
          if (candidate.size <= targetBytes) {
            fittingScale = scale;
            best = candidate;
            lowScale = scale;
          } else {
            highScale = scale;
          }
        }
        const width = Math.max(1, Math.round(dimensions.width * fittingScale));
        const height = Math.max(1, Math.round(dimensions.height * fittingScale));
        best = await searchQuality(width, height, preferredMinimumQuality) ?? best;
        scaled = width !== dimensions.width || height !== dimensions.height;
      }
    }

    if (!best || best.size > targetBytes) {
      throw new Error(allowScaling ? "TARGET_TOO_SMALL" : "TARGET_REQUIRES_SCALING");
    }
    const output = await readFile(best.outputPath);
    const downloadName = safeDownloadName(originalName);
    res.writeHead(200, {
      ...securityHeaders(),
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
      "Content-Length": output.length,
      "Content-Type": "image/heic",
      "X-PixelLock-Attempts": String(attempts),
      "X-PixelLock-Height": String(best.height),
      "X-PixelLock-Original-Height": String(dimensions.height),
      "X-PixelLock-Original-Width": String(dimensions.width),
      "X-PixelLock-Quality": String(best.quality),
      "X-PixelLock-Quality-Protected": qualityProtected ? "1" : "0",
      "X-PixelLock-Scaled": scaled ? "1" : "0",
      "X-PixelLock-Width": String(best.width),
    });
    res.end(output);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "INPUT_TOO_LARGE") sendText(res, 413, "Image exceeds the 200 MB limit");
    else if (message === "INCOMPLETE_INPUT") sendText(res, 400, "Upload ended before the complete image was received");
    else if (message === "INVALID_SOURCE_FILE") sendText(res, 415, "The file contents do not match the image extension");
    else if (message === "UNSAFE_DIMENSIONS") sendText(res, 413, "The image exceeds the 40 megapixel processing limit");
    else if (message === "CONVERSION_TIMEOUT") sendText(res, 504, "The native image encoder exceeded the time limit");
    else if (message === "TARGET_REQUIRES_SCALING") sendText(res, 422, `Strict ${maximumKb} KB limit requires scaling for HEIC. Turn on Allow scaling or choose a larger maximum size.`);
    else if (message === "TARGET_TOO_SMALL") sendText(res, 422, `The ${maximumKb} KB target is too small for a sharp HEIC file. Choose a larger maximum size.`);
    else sendText(res, 422, "The native HEIC encoder could not convert this image");
  } finally {
    activeConversions -= 1;
    if (temporaryRoot) await rm(temporaryRoot, { force: true, recursive: true }).catch(() => undefined);
  }
}
