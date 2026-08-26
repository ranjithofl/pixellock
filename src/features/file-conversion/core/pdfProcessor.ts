import JSZip from "jszip";
import {
  GlobalWorkerOptions,
  getDocument,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const maximumPdfBytes = 100 * 1_000_000;
const maximumPages = 500;
const maximumPixelsPerPage = 25_000_000;
const maximumTotalPixels = 250_000_000;

export type PdfOutput = "text" | "images" | "pptx" | "docx" | "xlsx" | "xps";

export type PdfConversionResult = {
  blob: Blob;
  extension: "txt" | "zip" | "pptx" | "docx" | "xlsx" | "xps";
};

function validatePdf(file: File, data: Uint8Array) {
  if (file.size < 5 || file.size > maximumPdfBytes) {
    throw new Error("PDF files must be between 5 bytes and 100 MB.");
  }
  const header = new TextDecoder("latin1").decode(data.subarray(0, 1_024));
  if (!header.includes("%PDF-")) {
    throw new Error("This file does not contain a valid PDF header.");
  }
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("A PDF page could not be encoded as PNG."));
    }, "image/png");
  });
}

export async function convertPdf(
  file: File,
  output: PdfOutput,
  onProgress: (message: string, completed: number, total: number) => void,
): Promise<PdfConversionResult> {
  const data = new Uint8Array(await file.arrayBuffer());
  validatePdf(file, data);

  const loadingTask = getDocument({
    data,
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

    if (output === "text") {
      const pages: string[] = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        onProgress(`Extracting text from page ${pageNumber}`, pageNumber - 1, pdf.numPages);
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent({ disableNormalization: false });
        let pageText = "";
        for (const item of content.items) {
          if (!("str" in item)) continue;
          const textItem = item as { str: string; hasEOL: boolean };
          pageText += textItem.str;
          pageText += textItem.hasEOL ? "\n" : " ";
        }
        pages.push(pageText.trim());
        page.cleanup();
      }
      onProgress("Text extraction complete", pdf.numPages, pdf.numPages);
      return {
        blob: new Blob([pages.join("\n\n--- Page break ---\n\n")], {
          type: "text/plain;charset=utf-8",
        }),
        extension: "txt",
      };
    }

    const renderedPages: Array<{ blob: Blob; width: number; height: number }> = [];
    let totalPixels = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      onProgress(`Rendering page ${pageNumber}`, pageNumber - 1, pdf.numPages);
      const page = await pdf.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const safeScale = Math.min(
        2,
        Math.sqrt(maximumPixelsPerPage / (baseViewport.width * baseViewport.height)),
      );
      const viewport = page.getViewport({ scale: safeScale });
      const width = Math.max(1, Math.floor(viewport.width));
      const height = Math.max(1, Math.floor(viewport.height));
      totalPixels += width * height;
      if (totalPixels > maximumTotalPixels) {
        throw new Error("The PDF is too large to render safely in one conversion.");
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Canvas rendering is unavailable in this browser.");
      context.fillStyle = "white";
      context.fillRect(0, 0, width, height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const pageBlob = await canvasBlob(canvas);
      renderedPages.push({ blob: pageBlob, width, height });
      canvas.width = 1;
      canvas.height = 1;
      page.cleanup();
    }
    if (output === "images") {
      onProgress("Packing rendered pages", pdf.numPages, pdf.numPages);
      const archive = new JSZip();
      const digits = String(pdf.numPages).length;
      renderedPages.forEach((page, index) => {
        archive.file(`page-${String(index + 1).padStart(digits, "0")}.png`, page.blob);
      });
      return {
        blob: await archive.generateAsync({
          compression: "DEFLATE",
          compressionOptions: { level: 6 },
          type: "blob",
        }),
        extension: "zip",
      };
    }

    onProgress(`Building ${output.toUpperCase()} package`, pdf.numPages, pdf.numPages);
    const writers = await import("./fixedDocumentWriters");
    if (output === "pptx") {
      return { blob: await writers.pagesToPptx(renderedPages), extension: "pptx" };
    }
    if (output === "docx") {
      return { blob: await writers.pagesToDocx(renderedPages), extension: "docx" };
    }
    if (output === "xlsx") {
      return { blob: await writers.pagesToXlsx(renderedPages), extension: "xlsx" };
    }
    return { blob: await writers.pagesToXps(renderedPages), extension: "xps" };
  } finally {
    await loadingTask.destroy();
  }
}
