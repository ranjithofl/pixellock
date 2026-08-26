import type { OutputFormat } from "../features/image-conversion/core/imageProcessor";

export type WorkflowMode = "folder" | "instant";

export type ConverterTool = {
  path: string;
  title: string;
  description: string;
  formatLabel: string;
  initialFormat: OutputFormat;
  initialWorkflow: WorkflowMode;
  fixedFormat: boolean;
};

export const converterTools: ConverterTool[] = [
  {
    path: "/tools/image-compressor",
    title: "Image compressor.",
    description: "Meet a strict file-size target while protecting image quality.",
    formatLabel: "SIZE",
    initialFormat: "WEBP",
    initialWorkflow: "instant",
    fixedFormat: false,
  },
  {
    path: "/tools/image-to-webp",
    title: "Image to WebP.",
    description: "Convert PNG, JPEG, BMP, HEIC, or AVIF images into efficient WebP files.",
    formatLabel: "WEBP",
    initialFormat: "WEBP",
    initialWorkflow: "instant",
    fixedFormat: true,
  },
  {
    path: "/tools/image-to-jpeg",
    title: "Image to JPEG.",
    description: "Create broadly compatible JPEG images with an optimized size ceiling.",
    formatLabel: "JPEG",
    initialFormat: "JPEG",
    initialWorkflow: "instant",
    fixedFormat: true,
  },
  {
    path: "/tools/image-to-png",
    title: "Image to PNG.",
    description: "Create optimized PNG images with automatic palette selection.",
    formatLabel: "PNG",
    initialFormat: "PNG",
    initialWorkflow: "instant",
    fixedFormat: true,
  },
  {
    path: "/tools/image-to-avif",
    title: "Image to AVIF.",
    description: "Convert supported images into compact, high-quality AVIF files.",
    formatLabel: "AVIF",
    initialFormat: "AVIF",
    initialWorkflow: "instant",
    fixedFormat: true,
  },
  {
    path: "/tools/batch-image-converter",
    title: "Batch image converter.",
    description: "Convert complete folder trees while preserving every nested directory.",
    formatLabel: "BATCH",
    initialFormat: "WEBP",
    initialWorkflow: "folder",
    fixedFormat: false,
  },
  {
    path: "/tools/instant-image-converter",
    title: "Instant image converter.",
    description: "Drop multiple images, convert them locally, and download individually or as ZIP.",
    formatLabel: "QUICK",
    initialFormat: "WEBP",
    initialWorkflow: "instant",
    fixedFormat: false,
  },
];

export function findConverterTool(pathname: string) {
  const normalizedPath = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  return converterTools.find((tool) => tool.path === normalizedPath);
}
