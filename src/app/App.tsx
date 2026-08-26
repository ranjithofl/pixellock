import { lazy, Suspense, type ReactNode } from "react";
import ImageConverter from "../features/image-conversion/ui/ImageConverter";
import { FileConverter } from "../features/file-conversion/ui/FileConverter";
import { NotFoundPage } from "../features/tool-directory/NotFoundPage";
import type { PdfToolKind } from "../features/pdf-tools/ui/PdfTool";
import { findConverterCategory } from "./converterCatalog";
import { findConverterTool } from "./toolCatalog";
import { getAppPath } from "./routing";

const GifCompressor = lazy(async () => {
  const module = await import("../features/gif-compression/ui/GifCompressor");
  return { default: module.GifCompressor };
});
const PdfTool = lazy(async () => {
  const module = await import("../features/pdf-tools/ui/PdfTool");
  return { default: module.PdfTool };
});

function lazyPage(page: ReactNode) {
  return <Suspense fallback={<main className="app-shell page-loader" aria-label="Loading tool" />}>{page}</Suspense>;
}

export default function App() {
  const pathname = getAppPath();
  if (pathname === "/") {
    return (
      <ImageConverter
        title="Image Converter."
        initialFormat="WEBP"
        initialWorkflowMode="instant"
      />
    );
  }

  if (pathname === "/tools/gif-compressor") return lazyPage(<GifCompressor />);
  const pdfToolRoutes: Record<string, PdfToolKind> = {
    "/pdf-tools/compress": "compress",
    "/pdf-tools/organize": "organize",
    "/pdf-tools/split": "split",
  };
  const pdfTool = pdfToolRoutes[pathname.replace(/\/$/, "")];
  if (pdfTool) return lazyPage(<PdfTool kind={pdfTool} />);

  const category = findConverterCategory(pathname);
  if (category?.id === "image") {
    return (
      <ImageConverter
        title="Image Converter."
        initialFormat="WEBP"
        initialWorkflowMode="instant"
      />
    );
  }
  if (category) return <FileConverter category={category} />;

  const tool = findConverterTool(pathname);
  if (!tool) return <NotFoundPage />;

  return (
    <ImageConverter
      title={tool.title}
      initialFormat={tool.initialFormat}
      initialWorkflowMode={tool.initialWorkflow}
      fixedFormat={tool.fixedFormat}
      showBackLink
    />
  );
}
