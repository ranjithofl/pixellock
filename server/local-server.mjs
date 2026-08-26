import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { securityHeaders } from "../config/security-headers.mjs";
import { handleOfficeConversion } from "./office-converter.mjs";
import { handleImageConversion } from "./image-converter.mjs";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const publicRoot = resolve(projectRoot, "dist");
const previousRoot = resolve(projectRoot, "dist.previous");
const requestedPort = Number.parseInt(process.env.PIXELLOCK_PORT ?? "3000", 10);
const port =
  Number.isSafeInteger(requestedPort) &&
  requestedPort >= 1024 &&
  requestedPort <= 65_535
    ? requestedPort
    : 3000;

const mimeTypes = new Map([
  [".avif", "image/avif"],
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".wasm", "application/wasm"],
  [".webp", "image/webp"],
]);
const stableModules = new Set([
  "avif",
  "avif_enc",
  "avif_enc_mt",
  "esm",
  "heic-to",
  "index",
  "jpeg",
  "jszip.min",
  "png",
  "pdfProcessor",
  "webp",
  "webp_enc",
  "webp_enc_simd",
]);

function send(res, statusCode, body) {
  res.writeHead(statusCode, {
    ...securityHeaders(),
    "Content-Type": "text/plain; charset=utf-8",
  });
  res.end(body);
}

function safeAssetPath(root, requestedPath) {
  const filePath = resolve(root, `.${requestedPath}`);
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    return null;
  }
  return filePath;
}

async function findAsset(requestedPath) {
  for (const root of [publicRoot, previousRoot]) {
    const filePath = safeAssetPath(root, requestedPath);
    if (!filePath) return null;

    try {
      const fileStat = await stat(filePath);
      if (fileStat.isFile()) return { filePath, fileStat };
    } catch {
      // A staged build may have moved the active bundle; try the prior bundle.
    }
  }

  const legacyModule = /^\/assets\/(.+)-[a-zA-Z0-9_-]{6,}\.js$/.exec(
    requestedPath,
  );
  if (legacyModule && stableModules.has(legacyModule[1])) {
    const filePath = safeAssetPath(
      publicRoot,
      `/assets/${legacyModule[1]}.js`,
    );
    if (filePath) {
      try {
        const fileStat = await stat(filePath);
        if (fileStat.isFile()) return { filePath, fileStat };
      } catch {
        // The current build is temporarily unavailable; return a normal miss.
      }
    }
  }

  return null;
}

const server = createServer(async (req, res) => {
  const host = req.headers.host ?? "";
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
    send(res, 421, "Invalid host");
    return;
  }

  let requestUrl;
  try {
    requestUrl = new URL(req.url ?? "/", "http://localhost");
    requestUrl.pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    send(res, 400, "Invalid request path");
    return;
  }

  const pathname = requestUrl.pathname;
  if (pathname === "/api/office-convert") {
    await handleOfficeConversion(req, res, requestUrl, port);
    return;
  }
  if (pathname === "/api/image-convert") {
    await handleImageConversion(req, res, requestUrl, port);
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    send(res, 405, "Method not allowed");
    return;
  }

  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  if (!safeAssetPath(publicRoot, requestedPath)) {
    send(res, 403, "Forbidden");
    return;
  }

  try {
    let asset = await findAsset(requestedPath);
    if (!asset && extname(requestedPath) === "") {
      asset = await findAsset("/index.html");
    }
    if (!asset) {
      send(res, 404, "Not found");
      return;
    }
    const { filePath, fileStat } = asset;

    const extension = extname(filePath).toLowerCase();
    const contentType = mimeTypes.get(extension);
    if (!contentType) {
      send(res, 415, "Unsupported asset type");
      return;
    }

    const immutableAsset =
      requestedPath.startsWith("/assets/") &&
      extension !== ".js" &&
      extension !== ".css";
    res.writeHead(200, {
      ...securityHeaders(),
      "Cache-Control": immutableAsset
        ? "public, max-age=31536000, immutable"
        : "no-cache",
      "Content-Length": fileStat.size,
      "Content-Type": contentType,
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(filePath).on("error", () => res.destroy()).pipe(res);
  } catch {
    send(res, 500, "Unable to read asset");
  }
});

server.requestTimeout = 10_000;
server.headersTimeout = 5_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 50;
server.maxRequestsPerSocket = 100;

server.on("clientError", (_error, socket) => {
  if (socket.writable) {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  }
});

server.on("error", (error) => {
  process.stderr.write(`PixelLock server error: ${error.message}\n`);
  process.exitCode = 1;
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`PixelLock is available at http://localhost:${port}\n`);
});
