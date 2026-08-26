import JSZip from "jszip";
import { PDFDocument, degrees } from "pdf-lib";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const maximumPdfBytes = 100 * 1_000_000;
const maximumPages = 500;
const maximumPixelsPerPage = 25_000_000;
const maximumTotalPixels = 250_000_000;

export type PdfPagePlan = {
  sourceIndex: number;
  rotation: 0 | 90 | 180 | 270;
};

export type CompressionPreset = "quality" | "balanced" | "compact";

export type PdfInspection = {
  pages: Array<{ height: number; preview: Blob; width: number }>;
};

function validatePdf(file: File, bytes: Uint8Array) {
  if (file.size < 5 || file.size > maximumPdfBytes) {
    throw new Error("PDF files must be between 5 bytes and 100 MB.");
  }
  const header = new TextDecoder("latin1").decode(bytes.subarray(0, 1_024));
  if (!header.includes("%PDF-")) {
    throw new Error("This file does not contain a valid PDF header.");
  }
}

function ownedBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("A PDF page could not be encoded."));
    }, type, quality);
  });
}

function safeStem(fileName: string) {
  const index = fileName.lastIndexOf(".");
  return (index > 0 ? fileName.slice(0, index) : fileName)
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._ -]+/g, "-")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 120) || "document";
}

export async function inspectPdf(
  file: File,
  onProgress: (message: string, completed: number, total: number) => void,
): Promise<PdfInspection> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  validatePdf(file, bytes);
  const loadingTask = getDocument({
    data: bytes,
    enableXfa: false,
    maxImageSize: maximumPixelsPerPage,
    stopAtErrors: true,
    useSystemFonts: true,
  });
  try {
    const pdf = await loadingTask.promise;
    if (pdf.numPages < 1 || pdf.numPages > maximumPages) {
      throw new Error(`PDF files must contain between 1 and ${maximumPages} pages.`);
    }
    const pages: PdfInspection["pages"] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      onProgress(`Preparing page ${pageNumber}`, pageNumber - 1, pdf.numPages);
      const page = await pdf.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(0.45, 180 / base.width);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Canvas rendering is unavailable in this browser.");
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      pages.push({
        height: base.height,
        preview: await canvasBlob(canvas, "image/jpeg", 0.82),
        width: base.width,
      });
      canvas.width = 1;
      canvas.height = 1;
      page.cleanup();
    }
    onProgress("Pages ready", pdf.numPages, pdf.numPages);
    return { pages };
  } finally {
    await loadingTask.destroy();
  }
}

export async function organizePdf(file: File, plan: PdfPagePlan[]) {
  if (!plan.length) throw new Error("Keep at least one page in the organized PDF.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  validatePdf(file, bytes);
  const source = await PDFDocument.load(bytes, { updateMetadata: false });
  const count = source.getPageCount();
  if (count < 1 || count > maximumPages) throw new Error("The PDF page count is outside the safe limit.");
  if (plan.some(({ sourceIndex }) => sourceIndex < 0 || sourceIndex >= count)) {
    throw new Error("The page arrangement contains an invalid page.");
  }
  const output = await PDFDocument.create();
  for (const item of plan) {
    const [page] = await output.copyPages(source, [item.sourceIndex]);
    const currentRotation = page.getRotation().angle;
    page.setRotation(degrees((currentRotation + item.rotation) % 360));
    output.addPage(page);
  }
  return new Blob([
    ownedBuffer(await output.save({ addDefaultPage: false, objectsPerTick: 50, useObjectStreams: true })),
  ], { type: "application/pdf" });
}

export function parsePageGroups(value: string, pageCount: number) {
  const groups = value
    .split(",")
    .map((group) => group.trim())
    .filter(Boolean)
    .map((group) => {
      const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(group);
      if (!match) throw new Error(`Invalid page group: “${group}”. Use 1-3, 4, 5-7.`);
      const start = Number(match[1]);
      const end = Number(match[2] ?? match[1]);
      if (start < 1 || end < start || end > pageCount) {
        throw new Error(`Page group “${group}” is outside this ${pageCount}-page PDF.`);
      }
      return Array.from({ length: end - start + 1 }, (_, index) => start - 1 + index);
    });
  if (!groups.length) throw new Error("Enter at least one page or page range.");
  return groups;
}

export async function splitPdf(file: File, groups: number[][]) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  validatePdf(file, bytes);
  const source = await PDFDocument.load(bytes, { updateMetadata: false });
  const pageCount = source.getPageCount();
  if (pageCount < 1 || pageCount > maximumPages) throw new Error("The PDF page count is outside the safe limit.");
  const archive = new JSZip();
  const stem = safeStem(file.name);
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex];
    if (!group.length || group.some((index) => index < 0 || index >= pageCount)) {
      throw new Error("A split range contains an invalid page.");
    }
    const output = await PDFDocument.create();
    const copied = await output.copyPages(source, group);
    copied.forEach((page) => output.addPage(page));
    const label = group.length === 1
      ? `page-${group[0] + 1}`
      : `pages-${group[0] + 1}-${group[group.length - 1] + 1}`;
    archive.file(
      `${stem}-${label}.pdf`,
      await output.save({ addDefaultPage: false, objectsPerTick: 50, useObjectStreams: true }),
    );
  }
  return archive.generateAsync({
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    type: "blob",
  });
}

export async function compressPdf(
  file: File,
  preset: CompressionPreset,
  onProgress: (message: string, completed: number, total: number) => void,
) {
  const settings = {
    quality: { jpegQuality: 0.9, renderScale: 1.8 },
    balanced: { jpegQuality: 0.82, renderScale: 1.4 },
    compact: { jpegQuality: 0.72, renderScale: 1.05 },
  }[preset];
  const bytes = new Uint8Array(await file.arrayBuffer());
  validatePdf(file, bytes);
  const loadingTask = getDocument({
    data: bytes.slice(),
    enableXfa: false,
    maxImageSize: maximumPixelsPerPage,
    stopAtErrors: true,
    useSystemFonts: true,
  });
  try {
    const pdf = await loadingTask.promise;
    if (pdf.numPages < 1 || pdf.numPages > maximumPages) {
      throw new Error(`PDF files must contain between 1 and ${maximumPages} pages.`);
    }
    const output = await PDFDocument.create();
    let totalPixels = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      onProgress(`Compressing page ${pageNumber}`, pageNumber - 1, pdf.numPages);
      const page = await pdf.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(
        settings.renderScale,
        Math.sqrt(maximumPixelsPerPage / (base.width * base.height)),
      );
      const viewport = page.getViewport({ scale });
      const width = Math.max(1, Math.floor(viewport.width));
      const height = Math.max(1, Math.floor(viewport.height));
      totalPixels += width * height;
      if (totalPixels > maximumTotalPixels) {
        throw new Error("The PDF is too large to compress safely in one conversion.");
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Canvas rendering is unavailable in this browser.");
      context.fillStyle = "white";
      context.fillRect(0, 0, width, height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const jpeg = await canvasBlob(canvas, "image/jpeg", settings.jpegQuality);
      const embedded = await output.embedJpg(await jpeg.arrayBuffer());
      const outputPage = output.addPage([base.width, base.height]);
      outputPage.drawImage(embedded, { x: 0, y: 0, width: base.width, height: base.height });
      canvas.width = 1;
      canvas.height = 1;
      page.cleanup();
    }
    onProgress("Finalizing compressed PDF", pdf.numPages, pdf.numPages);
    const compressed = await output.save({ addDefaultPage: false, objectsPerTick: 50, useObjectStreams: true });
    if (compressed.byteLength >= file.size) {
      const preserved = await PDFDocument.load(bytes, { updateMetadata: false });
      const optimized = await preserved.save({ addDefaultPage: false, objectsPerTick: 50, useObjectStreams: true });
      if (optimized.byteLength >= file.size) {
        throw new Error("This PDF is already smaller than a high-quality rebuilt copy. No larger replacement was created.");
      }
      return new Blob([ownedBuffer(optimized)], { type: "application/pdf" });
    }
    return new Blob([ownedBuffer(compressed)], { type: "application/pdf" });
  } finally {
    await loadingTask.destroy();
  }
}
