export type ConverterCategoryId =
  | "image"
  | "pdf"
  | "document"
  | "excel"
  | "presentation";

export type ConverterCategory = {
  id: ConverterCategoryId;
  path: string;
  title: string;
  engine: "image" | "pdf" | "office";
  accept: string;
  acceptLabel: string;
  inputExtensions: string[];
  outputs: Array<{ value: string; label: string }>;
};

export const converterCategories: ConverterCategory[] = [
  {
    id: "image",
    path: "/converters/image",
    title: "Image Converter",
    engine: "image",
    accept: "image/png,image/jpeg,image/webp,image/bmp,image/avif,.heic,.heif",
    acceptLabel: "PNG · JPG · WEBP · BMP · HEIC · AVIF",
    inputExtensions: ["png", "jpg", "jpeg", "webp", "bmp", "heic", "heif", "avif"],
    outputs: [],
  },
  {
    id: "pdf",
    path: "/converters/pdf",
    title: "PDF Converter",
    engine: "pdf",
    accept: "application/pdf,.pdf",
    acceptLabel: "PDF up to 100 MB",
    inputExtensions: ["pdf"],
    outputs: [
      { value: "images", label: "Images — PNG pages (.zip)" },
      { value: "pptx", label: "PowerPoint — visual pages (.pptx)" },
      { value: "xlsx", label: "Excel — one visual sheet per page (.xlsx)" },
      { value: "docx", label: "Word — visual pages (.docx)" },
      { value: "xps", label: "XPS — fixed-layout pages (.xps)" },
      { value: "text", label: "Plain text — extracted text (.txt)" },
    ],
  },
  {
    id: "document",
    path: "/converters/document",
    title: "Document Converter",
    engine: "office",
    accept: ".doc,.docx,.odt,.rtf,.txt",
    acceptLabel: "DOC · DOCX · ODT · RTF · TXT",
    inputExtensions: ["doc", "docx", "odt", "rtf", "txt"],
    outputs: [
      { value: "pdf", label: "PDF (.pdf)" },
      { value: "docx", label: "Word (.docx)" },
      { value: "txt", label: "Text (.txt)" },
      { value: "rtf", label: "Rich Text (.rtf)" },
      { value: "odt", label: "OpenDocument (.odt)" },
    ],
  },
  {
    id: "excel",
    path: "/converters/excel",
    title: "Excel Converter",
    engine: "office",
    accept: ".xls,.xlsx,.ods,.csv",
    acceptLabel: "XLS · XLSX · ODS · CSV",
    inputExtensions: ["xls", "xlsx", "ods", "csv"],
    outputs: [
      { value: "pdf", label: "PDF (.pdf)" },
      { value: "xlsx", label: "Excel (.xlsx)" },
      { value: "csv", label: "CSV (.csv)" },
      { value: "ods", label: "OpenDocument (.ods)" },
    ],
  },
  {
    id: "presentation",
    path: "/converters/presentation",
    title: "Presentation Converter",
    engine: "office",
    accept: ".ppt,.pptx,.odp,.fodp",
    acceptLabel: "PPT · PPTX · ODP · FODP",
    inputExtensions: ["ppt", "pptx", "odp", "fodp"],
    outputs: [
      { value: "pdf", label: "PDF (.pdf)" },
      { value: "pptx", label: "PowerPoint (.pptx)" },
      { value: "odp", label: "OpenDocument (.odp)" },
    ],
  },
];

export function findConverterCategory(pathname: string) {
  const normalizedPath = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  return converterCategories.find((category) => category.path === normalizedPath);
}
