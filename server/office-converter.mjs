import { constants } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, extname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import JSZip from "jszip";
import { securityHeaders } from "../config/security-headers.mjs";

const maximumInputBytes = 100 * 1_000_000;
const maximumOutputBytes = 200 * 1_000_000;
const maximumExpandedOfficeBytes = 500 * 1_000_000;
const maximumConcurrentConversions = 2;
let activeConversions = 0;

const conversionProfiles = {
  document: {
    inputs: new Set([".doc", ".docx", ".odt", ".rtf", ".txt"]),
    targets: new Map([
      ["pdf", "pdf:writer_pdf_Export"],
      ["docx", "docx:Office Open XML Text"],
      ["txt", "txt:Text"],
      ["rtf", "rtf:Rich Text Format"],
      ["odt", "odt:writer8"],
    ]),
  },
  excel: {
    inputs: new Set([".xls", ".xlsx", ".ods", ".csv"]),
    targets: new Map([
      ["pdf", "pdf:calc_pdf_Export"],
      ["xlsx", "xlsx:Calc MS Excel 2007 XML"],
      ["csv", "csv:Text - txt - csv (StarCalc)"],
      ["ods", "ods:calc8"],
    ]),
  },
  presentation: {
    inputs: new Set([".ppt", ".pptx", ".odp", ".fodp"]),
    targets: new Map([
      ["pdf", "pdf:impress_pdf_Export"],
      ["pptx", "pptx:Impress MS PowerPoint 2007 XML"],
      ["odp", "odp:impress8"],
    ]),
  },
};

const outputTypes = new Map([
  [".csv", "text/csv; charset=utf-8"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".odp", "application/vnd.oasis.opendocument.presentation"],
  [".ods", "application/vnd.oasis.opendocument.spreadsheet"],
  [".odt", "application/vnd.oasis.opendocument.text"],
  [".pdf", "application/pdf"],
  [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  [".rtf", "application/rtf"],
  [".txt", "text/plain; charset=utf-8"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
]);

function sendText(res, statusCode, message) {
  res.writeHead(statusCode, {
    ...securityHeaders(),
    "Content-Type": "text/plain; charset=utf-8",
  });
  res.end(message);
}

function safeDownloadName(sourceName, outputExtension) {
  const sourceExtension = extname(sourceName);
  const stem = basename(sourceName, sourceExtension)
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._ -]+/g, "-")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 120) || "converted";
  return `${stem}.${outputExtension}`;
}

async function executableCandidate(candidate) {
  if (!candidate || !isAbsolute(candidate)) return null;
  try {
    await access(candidate, constants.X_OK);
    return candidate;
  } catch {
    return null;
  }
}

async function findSoffice() {
  const candidates = [
    process.env.PIXELLOCK_SOFFICE,
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    "/usr/bin/libreoffice",
    "/usr/local/bin/libreoffice",
    "/opt/libreoffice/program/soffice",
    "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
  ];
  for (const candidate of candidates) {
    const executable = await executableCandidate(candidate);
    if (executable) return executable;
  }
  return "soffice";
}

async function validateOfficeInput(input, extension) {
  const zipExtensions = new Set([".docx", ".xlsx", ".pptx", ".odt", ".ods", ".odp"]);
  const legacyExtensions = new Set([".doc", ".xls", ".ppt"]);
  const legacyHeader = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

  if (legacyExtensions.has(extension)) {
    if (input.length < legacyHeader.length || !input.subarray(0, 8).equals(legacyHeader)) {
      throw new Error("INVALID_SOURCE_FILE");
    }
    return;
  }

  if (zipExtensions.has(extension)) {
    if (input.length < 4 || input[0] !== 0x50 || input[1] !== 0x4b) {
      throw new Error("INVALID_SOURCE_FILE");
    }
    let archive;
    try {
      archive = await JSZip.loadAsync(input, { checkCRC32: false });
    } catch {
      throw new Error("INVALID_SOURCE_FILE");
    }
    const entries = Object.values(archive.files);
    if (entries.length > 5_000) throw new Error("UNSAFE_ARCHIVE");
    let expandedBytes = 0;
    for (const entry of entries) {
      if (entry.dir) continue;
      const size = entry._data?.uncompressedSize;
      if (!Number.isSafeInteger(size) || size < 0) throw new Error("UNSAFE_ARCHIVE");
      expandedBytes += size;
      if (expandedBytes > maximumExpandedOfficeBytes) throw new Error("UNSAFE_ARCHIVE");
    }
    const hasExpectedStructure =
      extension.startsWith(".od")
        ? Boolean(archive.file("content.xml"))
        : Boolean(archive.file("[Content_Types].xml"));
    if (!hasExpectedStructure) throw new Error("INVALID_SOURCE_FILE");
    return;
  }

  const text = input.subarray(0, Math.min(input.length, 1_000_000)).toString("utf8");
  if (text.includes("\0")) throw new Error("INVALID_SOURCE_FILE");
  if (extension === ".rtf" && !text.trimStart().startsWith("{\\rtf")) {
    throw new Error("INVALID_SOURCE_FILE");
  }
  if (
    extension === ".fodp" &&
    (!text.includes("<office:document") ||
      text.includes("<!DOCTYPE") ||
      text.includes("<!ENTITY"))
  ) {
    throw new Error("INVALID_SOURCE_FILE");
  }
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

function runSoffice(executable, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, args, {
      env: {
        LANG: "C.UTF-8",
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
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
      rejectPromise(new Error("CONVERSION_TIMEOUT"));
    }, 90_000);

    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectPromise(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolvePromise(diagnostic);
      else rejectPromise(new Error(`CONVERSION_FAILED:${diagnostic.slice(0, 300)}`));
    });
  });
}

export async function handleOfficeConversion(req, res, requestUrl, port) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendText(res, 405, "Method not allowed");
    return;
  }

  const allowedOrigins = new Set([
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
  ]);
  const origin = req.headers.origin;
  if (!origin || !allowedOrigins.has(origin)) {
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

  const contentLength = Number.parseInt(req.headers["content-length"] ?? "", 10);
  if (!Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > maximumInputBytes) {
    sendText(res, 413, "File must be between 1 byte and 100 MB");
    return;
  }

  const category = requestUrl.searchParams.get("category") ?? "";
  const target = requestUrl.searchParams.get("target") ?? "";
  const profile = conversionProfiles[category];
  const targetFilter = profile?.targets.get(target);
  if (!profile || !targetFilter) {
    sendText(res, 400, "Unsupported conversion target");
    return;
  }

  let originalName;
  try {
    originalName = decodeURIComponent(req.headers["x-pixellock-filename"] ?? "");
  } catch {
    sendText(res, 400, "Invalid file name");
    return;
  }
  if (
    !originalName ||
    originalName.length > 200 ||
    originalName.includes("\0") ||
    basename(originalName) !== originalName
  ) {
    sendText(res, 400, "Invalid file name");
    return;
  }
  const inputExtension = extname(originalName).toLowerCase();
  if (!profile.inputs.has(inputExtension)) {
    sendText(res, 415, `Unsupported ${category} source format`);
    return;
  }
  if (inputExtension === `.${target}`) {
    sendText(res, 400, "Source and output formats must be different");
    return;
  }
  if (activeConversions >= maximumConcurrentConversions) {
    sendText(res, 429, "Two conversions are already running. Please retry shortly.");
    return;
  }

  activeConversions += 1;
  req.setTimeout(100_000);
  let temporaryRoot;
  try {
    const input = await receiveBody(req, contentLength);
    await validateOfficeInput(input, inputExtension);
    temporaryRoot = await mkdtemp(join(tmpdir(), "pixellock-office-"));
    const inputDirectory = join(temporaryRoot, "input");
    const outputDirectory = join(temporaryRoot, "output");
    const profileDirectory = join(temporaryRoot, "profile");
    await Promise.all([
      mkdir(inputDirectory, { mode: 0o700 }),
      mkdir(outputDirectory, { mode: 0o700 }),
      mkdir(profileDirectory, { mode: 0o700 }),
    ]);
    const inputPath = join(inputDirectory, `source${inputExtension}`);
    await writeFile(inputPath, input, { mode: 0o600, flag: "wx" });

    const executable = await findSoffice();
    await runSoffice(executable, [
      "--headless",
      "--nologo",
      "--nodefault",
      "--norestore",
      "--safe-mode",
      `-env:UserInstallation=${pathToFileURL(profileDirectory).href}`,
      "--convert-to",
      targetFilter,
      "--outdir",
      outputDirectory,
      inputPath,
    ]);

    const outputFiles = await readdir(outputDirectory);
    const expectedExtension = `.${target}`;
    const outputFileName = outputFiles.find(
      (name) => extname(name).toLowerCase() === expectedExtension,
    );
    if (!outputFileName) throw new Error("OUTPUT_NOT_CREATED");
    const outputPath = join(outputDirectory, outputFileName);
    const outputStat = await stat(outputPath);
    if (!outputStat.isFile() || outputStat.size < 1 || outputStat.size > maximumOutputBytes) {
      throw new Error("OUTPUT_SIZE_INVALID");
    }
    const output = await readFile(outputPath);
    const downloadName = safeDownloadName(originalName, target);
    res.writeHead(200, {
      ...securityHeaders(),
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
      "Content-Length": output.length,
      "Content-Type": outputTypes.get(expectedExtension) ?? "application/octet-stream",
    });
    res.end(output);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("ENOENT")) {
      sendText(res, 503, "LibreOffice is required for this local converter.");
    } else if (message === "INPUT_TOO_LARGE") {
      sendText(res, 413, "File exceeds the 100 MB limit");
    } else if (message === "INCOMPLETE_INPUT") {
      sendText(res, 400, "Upload ended before the complete file was received");
    } else if (message === "INVALID_SOURCE_FILE") {
      sendText(res, 415, "The file contents do not match the selected source format");
    } else if (message === "UNSAFE_ARCHIVE") {
      sendText(res, 413, "The compressed office document expands beyond safe limits");
    } else if (message === "CONVERSION_TIMEOUT") {
      sendText(res, 504, "The document engine exceeded the 90 second limit");
    } else {
      sendText(res, 422, "The document engine could not convert this file");
    }
  } finally {
    activeConversions -= 1;
    if (temporaryRoot?.startsWith(join(tmpdir(), "pixellock-office-"))) {
      await rm(temporaryRoot, { force: true, recursive: true }).catch(() => undefined);
    }
  }
}
