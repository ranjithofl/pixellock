import {
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createQualityPreview,
  formatDecimalKb,
  outputName,
  OutputFormat,
  processImage,
  releaseImageProcessingCache,
  SearchUpdate,
  warmImageEncoder,
} from "../core/imageProcessor";
import { assertSafeImageFile } from "../core/inputValidation";
import {
  collectFolderImages,
  type LocalDirectoryHandle,
  writeToOutputFolder,
} from "../platform/fileSystem";
import { Badge, Button, Progress, Select, Switch } from "../../../components/ui";
import { UploadIcon } from "../../../components/ui/Icons";
import { SiteHeader } from "../../../components/layout/SiteHeader";

type QueueStatus = "ready" | "processing" | "done" | "failed" | "cancelled";

type QueueItem = {
  id: string;
  file: File;
  relativeDirectory: string;
  sourceUrl: string;
  status: QueueStatus;
  resultBlob?: Blob;
  resultUrl?: string;
  resultName?: string;
  width?: number;
  height?: number;
  originalWidth?: number;
  originalHeight?: number;
  scaled?: boolean;
  automaticParameter?: boolean;
  qualityProtected?: boolean;
  parameter?: number;
  parameterLabel?: "Quality" | "Colors" | "Lossless";
  outputRelativePath?: string;
  update?: SearchUpdate;
  error?: string;
  manualQuality?: number;
};

const formats: Array<{
  value: OutputFormat;
  label: string;
  note: string;
}> = [
  { value: "WEBP", label: "WebP", note: "Balanced" },
  { value: "JPEG", label: "JPEG (.jpg)", note: "Universal" },
  { value: "PNG", label: "PNG", note: "Lossless or palette" },
  { value: "AVIF", label: "AVIF", note: "Smallest" },
  { value: "HEIC", label: "HEIC", note: "Native macOS" },
  { value: "BMP", label: "BMP", note: "Lossless bitmap" },
  { value: "PDF", label: "PDF", note: "One image page" },
];

type ImageConverterProps = {
  title?: string;
  initialFormat?: OutputFormat;
  initialWorkflowMode?: "folder" | "instant";
  fixedFormat?: boolean;
  showBackLink?: boolean;
};

function createId(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`;
}

function FolderIcon({ direction }: { direction: "input" | "output" }) {
  return (
    <div className={`folder-symbol ${direction}`} aria-hidden="true">
      <svg viewBox="0 0 68 54">
        <path d="M7 8h18l6 7h29a5 5 0 0 1 5 5v26H3V13a5 5 0 0 1 4-5Z" />
        <path d="M3 22h62v24a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V22Z" />
      </svg>
      <span>{direction === "input" ? "IN" : "OUT"}</span>
    </div>
  );
}

function processingErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return "This image could not be processed.";

  if (
    error.message.includes("Failed to fetch dynamically imported module") ||
    error.message.includes("Importing a module script failed")
  ) {
    return "The local image codec was refreshed. Reload PixelLock once, then retry this file.";
  }

  return error.message;
}

function qualityDescription(quality: number) {
  if (quality >= 95) return "Maximum detail";
  if (quality >= 85) return "High quality";
  if (quality >= 70) return "Balanced";
  if (quality >= 50) return "Compact";
  return "Strong compression";
}

function clampValue(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function QualityEditor({
  format,
  item,
  maxSizeKb,
  onApply,
  onClose,
}: {
  format: OutputFormat;
  item: QueueItem;
  maxSizeKb: number;
  onApply: (quality?: number) => void;
  onClose: () => void;
}) {
  const [quality, setQuality] = useState(item.manualQuality ?? 100);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewDetail, setPreviewDetail] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [isPreviewing, setIsPreviewing] = useState(true);
  const [sizeForecast, setSizeForecast] = useState<{
    bytes: number;
    estimated: boolean;
  } | null>(null);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [previewPan, setPreviewPan] = useState({ x: 0, y: 0 });
  const [isPreviewPanning, setIsPreviewPanning] = useState(false);
  const editorRef = useRef<HTMLElement | null>(null);
  const originalViewportRef = useRef<HTMLButtonElement | null>(null);
  const panStartRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const previewUrlRef = useRef("");
  const strictLimitBytes = Math.max(0, Math.floor(maxSizeKb * 1_000));
  const forecastFits = Boolean(
    sizeForecast && sizeForecast.bytes <= strictLimitBytes,
  );

  useEffect(() => {
    editorRef.current?.scrollTo({ top: 0 });
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setIsPreviewing(true);
      setPreviewError("");
      setSizeForecast(null);
      void createQualityPreview(item.file, format, quality)
        .then((preview) => {
          if (cancelled) return;
          const nextUrl = URL.createObjectURL(preview.blob);
          if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
          previewUrlRef.current = nextUrl;
          setPreviewUrl(nextUrl);
          setPreviewDetail(
            `${preview.parameterLabel} ${preview.parameter} · ${preview.width} × ${preview.height} preview`,
          );
          setSizeForecast({
            bytes: preview.estimatedBytes,
            estimated: preview.sizeIsEstimated,
          });
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setPreviewError(
              error instanceof Error ? error.message : "The quality preview could not be created.",
            );
          }
        })
        .finally(() => {
          if (!cancelled) setIsPreviewing(false);
        });
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [format, item.file, quality]);

  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  const panLimits = (
    viewport: HTMLButtonElement | null,
    nextZoomPercent = zoomPercent,
  ) => {
    if (!viewport || nextZoomPercent <= 100) return { x: 0, y: 0 };
    const image = viewport.querySelector("img");
    if (!image) return { x: 0, y: 0 };

    const currentScale = Math.max(1, zoomPercent / 100);
    const nextScale = nextZoomPercent / 100;
    const imageRect = image.getBoundingClientRect();
    const baseWidth = imageRect.width / currentScale;
    const baseHeight = imageRect.height / currentScale;

    return {
      x: Math.max(0, (baseWidth * nextScale - viewport.clientWidth) / 2),
      y: Math.max(0, (baseHeight * nextScale - viewport.clientHeight) / 2),
    };
  };

  const updateZoom = (nextValue: number) => {
    const nextZoom = clampValue(Math.round(nextValue), 100, 400);
    const limits = panLimits(originalViewportRef.current, nextZoom);
    setZoomPercent(nextZoom);
    setPreviewPan((current) => ({
      x: clampValue(current.x, -limits.x, limits.x),
      y: clampValue(current.y, -limits.y, limits.y),
    }));
  };

  const resetComparisonView = () => {
    setZoomPercent(100);
    setPreviewPan({ x: 0, y: 0 });
  };

  const startPreviewPan = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (zoomPercent <= 100 || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    panStartRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: previewPan.x,
      originY: previewPan.y,
    };
    setIsPreviewPanning(true);
  };

  const movePreviewPan = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = panStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    event.preventDefault();
    const limits = panLimits(event.currentTarget);
    setPreviewPan({
      x: clampValue(start.originX + event.clientX - start.startX, -limits.x, limits.x),
      y: clampValue(start.originY + event.clientY - start.startY, -limits.y, limits.y),
    });
  };

  const stopPreviewPan = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (panStartRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    panStartRef.current = null;
    setIsPreviewPanning(false);
  };

  const handlePreviewKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (zoomPercent <= 100) return;
    const movement = event.shiftKey ? 64 : 24;
    const directions: Record<string, { x: number; y: number }> = {
      ArrowLeft: { x: -movement, y: 0 },
      ArrowRight: { x: movement, y: 0 },
      ArrowUp: { x: 0, y: -movement },
      ArrowDown: { x: 0, y: movement },
    };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    const limits = panLimits(event.currentTarget);
    setPreviewPan((current) => ({
      x: clampValue(current.x + direction.x, -limits.x, limits.x),
      y: clampValue(current.y + direction.y, -limits.y, limits.y),
    }));
  };

  const sharedPreviewStyle = {
    transform: `translate3d(${previewPan.x}px, ${previewPan.y}px, 0) scale(${zoomPercent / 100})`,
  };
  const previewViewportClass = `quality-preview-image${zoomPercent > 100 ? " is-pannable" : ""}${isPreviewPanning ? " is-panning" : ""}`;

  return (
    <div className="quality-editor-backdrop">
      <section
        ref={editorRef}
        className="quality-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quality-editor-title"
      >
        <header className="quality-editor-header">
          <div>
            <span className="quality-editor-kicker">Instant Drop · {format}</span>
            <h2 id="quality-editor-title">Adjust image quality</h2>
            <p title={item.file.name}>{item.file.name}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close quality editor">×</Button>
        </header>

        <div className="quality-preview-grid">
          <article className="quality-preview-card">
            <div className="quality-preview-label"><strong>Original</strong><span>{formatDecimalKb(item.file.size)}</span></div>
            <button
              type="button"
              ref={originalViewportRef}
              className={previewViewportClass}
              aria-label={`Original synchronized preview at ${zoomPercent}% zoom`}
              aria-describedby="quality-pan-instructions"
              onPointerDown={startPreviewPan}
              onPointerMove={movePreviewPan}
              onPointerUp={stopPreviewPan}
              onPointerCancel={stopPreviewPan}
              onKeyDown={handlePreviewKeyDown}
            >
              <img src={item.sourceUrl} alt="Original preview" style={sharedPreviewStyle} draggable={false} />
            </button>
          </article>
          <article className="quality-preview-card">
            <div className="quality-preview-label"><strong>Quality preview</strong><span>{sizeForecast ? `${sizeForecast.estimated ? "≈ " : ""}${formatDecimalKb(sizeForecast.bytes)}` : `${quality}%`}</span></div>
            <button
              type="button"
              className={previewViewportClass}
              aria-label={`Quality synchronized preview at ${zoomPercent}% zoom`}
              aria-describedby="quality-pan-instructions"
              onPointerDown={startPreviewPan}
              onPointerMove={movePreviewPan}
              onPointerUp={stopPreviewPan}
              onPointerCancel={stopPreviewPan}
              onKeyDown={handlePreviewKeyDown}
            >
              {previewUrl && <img src={previewUrl} alt={`Preview at ${quality}% quality`} style={sharedPreviewStyle} draggable={false} />}
              {isPreviewing && <span className="quality-preview-loading"><span className="button-spinner" aria-hidden="true" />Rendering preview…</span>}
              {previewError && <span className="quality-preview-error">{previewError}</span>}
            </button>
          </article>
        </div>

        <div className="quality-view-controls">
          <div className="quality-view-copy">
            <strong>Linked comparison view</strong>
            <span id="quality-pan-instructions">Zoom in, then drag either image. Both previews stay at the same position.</span>
          </div>
          <div className="quality-zoom-controls" aria-label="Comparison zoom controls">
            <Button variant="outline" size="icon" onClick={() => updateZoom(zoomPercent - 25)} disabled={zoomPercent <= 100} aria-label="Zoom out">−</Button>
            <input
              id="quality-comparison-zoom"
              className="quality-zoom-range"
              type="range"
              min="100"
              max="400"
              step="25"
              value={zoomPercent}
              onChange={(event) => updateZoom(Number(event.target.value))}
              aria-label="Comparison zoom"
              aria-valuetext={`${zoomPercent}% zoom`}
            />
            <output htmlFor="quality-comparison-zoom" aria-live="polite">{zoomPercent}%</output>
            <Button variant="outline" size="icon" onClick={() => updateZoom(zoomPercent + 25)} disabled={zoomPercent >= 400} aria-label="Zoom in">+</Button>
            <Button variant="ghost" size="sm" onClick={resetComparisonView} disabled={zoomPercent === 100 && previewPan.x === 0 && previewPan.y === 0}>Reset view</Button>
          </div>
        </div>

        <div className="quality-control-panel">
          <div className="quality-control-heading">
            <div><strong>{qualityDescription(quality)}</strong><span>{previewDetail || "Preparing visual preview"}</span></div>
            <output htmlFor="manual-image-quality">{quality}%</output>
          </div>
          <div className="quality-slider-shell">
            <span className="quality-slider-track" aria-hidden="true"><span style={{ width: `${quality}%` }} /></span>
            <input
              id="manual-image-quality"
              className="quality-range"
              type="range"
              min="1"
              max="100"
              step="1"
              value={quality}
              onChange={(event) => {
                setIsPreviewing(true);
                setPreviewError("");
                setSizeForecast(null);
                setQuality(Number(event.target.value));
              }}
              aria-label="Manual image quality"
              aria-valuetext={`${quality}% · ${qualityDescription(quality)}`}
            />
          </div>
          <div className="quality-range-labels" aria-hidden="true"><span>Smaller file</span><span>Maximum detail</span></div>
          <div className="quality-presets" aria-label="Quality presets">
            {[
              { label: "Maximum", value: 100 },
              { label: "High", value: 90 },
              { label: "Balanced", value: 75 },
              { label: "Compact", value: 60 },
            ].map((preset) => (
              <button
                type="button"
                className={quality === preset.value ? "selected" : ""}
                onClick={() => {
                  setIsPreviewing(true);
                  setPreviewError("");
                  setSizeForecast(null);
                  setQuality(preset.value);
                }}
                aria-pressed={quality === preset.value}
                key={preset.value}
              >
                <strong>{preset.label}</strong><span>{preset.value}%</span>
              </button>
            ))}
          </div>
          {sizeForecast && (
            <p className={`quality-fit-message ${forecastFits ? "fits" : "over"}`}>
              {forecastFits
                ? `${sizeForecast.estimated ? "Estimated to fit" : "Fits"} under the ${maxSizeKb} KB maximum at ${quality}% quality.`
                : `${sizeForecast.estimated ? "Estimated size is" : "Output is"} above ${maxSizeKb} KB. Final conversion will lower quality until the strict maximum is passed.`}
            </p>
          )}
          {!sizeForecast && <p className="quality-fit-message pending">Calculating the expected output size for this quality…</p>}
        </div>

        <footer className="quality-editor-actions">
          <Button variant="ghost" onClick={() => onApply(undefined)}>Use automatic quality</Button>
          <div><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={() => onApply(quality)}>Apply {quality}% quality</Button></div>
        </footer>
      </section>
    </div>
  );
}

export default function ImageConverter({
  title = "Image conversion.",
  initialFormat = "WEBP",
  initialWorkflowMode = "folder",
  fixedFormat = false,
  showBackLink = false,
}: ImageConverterProps) {
  const [workflowMode, setWorkflowMode] = useState<"folder" | "instant">(
    initialWorkflowMode,
  );
  const [format, setFormat] = useState<OutputFormat>(initialFormat);
  const [sizeMode, setSizeMode] = useState<"100" | "150" | "200" | "custom">("100");
  const [customSize, setCustomSize] = useState("120");
  const [items, setItems] = useState<QueueItem[]>([]);
  const [inputDirectory, setInputDirectory] = useState<LocalDirectoryHandle | null>(null);
  const [outputDirectory, setOutputDirectory] = useState<LocalDirectoryHandle | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isCreatingZip, setIsCreatingZip] = useState(false);
  const [allowScaling, setAllowScaling] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [batchMessage, setBatchMessage] = useState("");
  const [showLongRunningMessage, setShowLongRunningMessage] = useState(false);
  const [qualityEditorId, setQualityEditorId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const completionAudioRef = useRef<AudioContext | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const itemsRef = useRef(items);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(
    () => () => {
      itemsRef.current.forEach((item) => {
        URL.revokeObjectURL(item.sourceUrl);
        if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
      });
      abortRef.current?.abort();
      if (completionAudioRef.current?.state !== "closed") {
        void completionAudioRef.current?.close();
      }
    },
    [],
  );

  useEffect(() => {
    if (!isProcessing) return;
    const timer = window.setTimeout(() => setShowLongRunningMessage(true), 5000);
    return () => window.clearTimeout(timer);
  }, [isProcessing]);

  const maxSizeKb = useMemo(() => {
    if (sizeMode === "custom") return Number(customSize);
    return Number(sizeMode);
  }, [customSize, sizeMode]);

  const completeItems = items.filter((item) => item.status === "done");
  const qualityEditorItem = items.find((item) => item.id === qualityEditorId);
  const pendingCount = items.filter(
    (item) => item.status === "ready" || item.status === "failed" || item.status === "cancelled",
  ).length;

  const clearItemUrls = (entries: QueueItem[]) => {
    entries.forEach((item) => {
      URL.revokeObjectURL(item.sourceUrl);
      if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
    });
  };

  const addInstantFiles = async (files: File[]) => {
    const validatedFiles = await Promise.all(
      files.slice(0, 2_000).map(async (file) => {
        try {
          await assertSafeImageFile(file);
          return file;
        } catch {
          return null;
        }
      }),
    );
    const supportedFiles = validatedFiles.filter(
      (file): file is File => file !== null,
    );
    if (!supportedFiles.length) {
      setBatchMessage(
        "No validated PNG, JPG, WebP, BMP, HEIC, HEIF, or AVIF images were found.",
      );
      return;
    }

    const nextItems = supportedFiles.map<QueueItem>((file) => ({
      id: createId(file),
      file,
      relativeDirectory: "",
      sourceUrl: URL.createObjectURL(file),
      status: "ready",
    }));
    void warmImageEncoder(format).catch(() => undefined);
    setItems((current) => [...current, ...nextItems]);
    const rejectedCount = files.length - supportedFiles.length;
    setBatchMessage(`${supportedFiles.length} ${
      supportedFiles.length === 1 ? "validated image is" : "validated images are"
    } ready for instant conversion.${
      rejectedCount ? ` ${rejectedCount} unsafe or unsupported file${rejectedCount === 1 ? " was" : "s were"} skipped.` : ""
    }`);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (isProcessing) return;
    void addInstantFiles(Array.from(event.dataTransfer.files));
  };

  const openInstantPicker = () => {
    if (!isProcessing) fileInputRef.current?.click();
  };

  const handleDropZoneKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openInstantPicker();
  };

  const chooseInputFolder = async () => {
    if (!window.showDirectoryPicker) {
      setBatchMessage(
        "Folder access needs Chrome or Edge. Open this local app in one of those browsers.",
      );
      return;
    }

    try {
      const directory = await window.showDirectoryPicker({ id: "pixellock-input", mode: "read" });
      if (outputDirectory && (await directory.isSameEntry(outputDirectory))) {
        setBatchMessage("Input and Output must be different folders.");
        return;
      }

      setBatchMessage("Scanning the Input folder and its subfolders…");
      void warmImageEncoder(format).catch(() => undefined);
      const folderImages = await collectFolderImages(directory);
      const nextItems = folderImages.map<QueueItem>(({ file, relativeDirectory }) => ({
        id: createId(file),
        file,
        relativeDirectory,
        sourceUrl: URL.createObjectURL(file),
        status: "ready",
      }));
      setItems((current) => {
        clearItemUrls(current);
        return nextItems;
      });
      setInputDirectory(directory);
      setBatchMessage(
        nextItems.length
          ? `Found ${nextItems.length} supported ${nextItems.length === 1 ? "image" : "images"} in ${directory.name}.`
          : `No supported images were found in ${directory.name}.`,
      );
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setBatchMessage(
          error instanceof Error
            ? error.message
            : "The Input folder could not be opened.",
        );
      }
    }
  };

  const chooseOutputFolder = async () => {
    if (!window.showDirectoryPicker) {
      setBatchMessage(
        "Folder access needs Chrome or Edge. Open this local app in one of those browsers.",
      );
      return;
    }

    try {
      const directory = await window.showDirectoryPicker({
        id: "pixellock-output",
        mode: "readwrite",
      });
      if (inputDirectory && (await directory.isSameEntry(inputDirectory))) {
        setBatchMessage("Input and Output must be different folders.");
        return;
      }
      setOutputDirectory(directory);
      setBatchMessage(`Converted files will be written directly into ${directory.name}.`);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setBatchMessage("The Output folder could not be opened for writing.");
      }
    }
  };

  const resetCompletedResults = () => {
    setItems((current) =>
      current.map((item) => {
        if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
        return {
          ...item,
          status: "ready",
          resultBlob: undefined,
          resultUrl: undefined,
          resultName: undefined,
          outputRelativePath: undefined,
          width: undefined,
          height: undefined,
          originalWidth: undefined,
          originalHeight: undefined,
          scaled: undefined,
          automaticParameter: undefined,
          qualityProtected: undefined,
          parameter: undefined,
          parameterLabel: undefined,
          update: undefined,
          error: undefined,
        };
      }),
    );
  };

  const changeFormat = (nextFormat: OutputFormat) => {
    if (nextFormat === format) return;
    setFormat(nextFormat);
    if (items.length) void warmImageEncoder(nextFormat).catch(() => undefined);
    resetCompletedResults();
  };

  const changeSizeMode = (nextMode: "100" | "150" | "200" | "custom") => {
    if (nextMode === sizeMode) return;
    setSizeMode(nextMode);
    resetCompletedResults();
  };

  const updateItem = (id: string, patch: Partial<QueueItem>) => {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  };

  const applyManualQuality = (id: string, quality?: number) => {
    const itemName = items.find((item) => item.id === id)?.file.name ?? "Image";
    const manualQuality = quality === undefined
      ? undefined
      : Math.max(1, Math.min(100, Math.round(quality)));
    setItems((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
        return {
          ...item,
          status: "ready",
          manualQuality,
          resultBlob: undefined,
          resultUrl: undefined,
          resultName: undefined,
          outputRelativePath: undefined,
          width: undefined,
          height: undefined,
          originalWidth: undefined,
          originalHeight: undefined,
          scaled: undefined,
          automaticParameter: undefined,
          qualityProtected: undefined,
          parameter: undefined,
          parameterLabel: undefined,
          update: undefined,
          error: undefined,
        };
      }),
    );
    setQualityEditorId(null);
    setBatchMessage(
      manualQuality === undefined
        ? `${itemName} returned to automatic best-fit quality.`
        : `${itemName} will start at ${manualQuality}% quality and still respect the strict size target.`,
    );
  };

  const prepareCompletionAudio = () => {
    const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContextClass) return;

    try {
      if (!completionAudioRef.current || completionAudioRef.current.state === "closed") {
        completionAudioRef.current = new AudioContextClass();
      }
      void completionAudioRef.current.resume();
    } catch {
      // Audio is a small enhancement; conversion should continue if it is unavailable.
    }
  };

  const playCompletionChime = () => {
    const context = completionAudioRef.current;
    if (!context || context.state === "closed") return;

    void context.resume().then(() => {
      const now = context.currentTime;
      [523.25, 659.25, 783.99].forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = now + index * 0.18;

        oscillator.type = "triangle";
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.24, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.52);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.54);
      });
    }).catch(() => {
      // Some browser audio policies can still block playback; the completion text remains.
    });
  };

  const processBatch = async () => {
    if (
      !items.length ||
      (workflowMode === "folder" && !outputDirectory) ||
      isProcessing
    ) return;
    if (!Number.isFinite(maxSizeKb) || maxSizeKb <= 0.5) {
      setBatchMessage("Enter a maximum size greater than 0.5 KB.");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setIsProcessing(true);
    setShowLongRunningMessage(false);
    const queue = items.filter((item) => item.status !== "done");
    const outputKeys = queue.map(
      (item) => `${item.relativeDirectory}/${outputName(item.file.name, format)}`,
    );
    const hasOutputNameCollision =
      workflowMode === "folder" && new Set(outputKeys).size !== outputKeys.length;
    const deviceMemory =
      (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
    const benefitsFromParallelBatch =
      format === "WEBP" || format === "JPEG" || format === "HEIC";
    const processorCount =
      queue.length > 1 &&
      !hasOutputNameCollision &&
      benefitsFromParallelBatch &&
      (navigator.hardwareConcurrency || 4) >= 4 &&
      deviceMemory >= 4
        ? 2
        : 1;
    setBatchMessage(
      processorCount > 1
        ? "Accelerated batch active — processing two images at a time."
        : "",
    );
    let succeeded = 0;
    let nextItemIndex = 0;
    prepareCompletionAudio();
    await warmImageEncoder(format).catch(() => undefined);

    const processItem = async (item: QueueItem) => {
      updateItem(item.id, { status: "processing", error: undefined, update: undefined });

      try {
        const result = await processImage(
          item.file,
          format,
          maxSizeKb,
          (update) => updateItem(item.id, { update }),
          controller.signal,
          { allowScaling, preferredQuality: item.manualQuality },
        );
        const resultName = outputName(item.file.name, format, result.scaled);
        if (workflowMode === "folder" && outputDirectory) {
          await writeToOutputFolder(
            outputDirectory,
            item.relativeDirectory,
            resultName,
            result.blob,
          );
        }
        const outputRelativePath =
          workflowMode === "folder" && outputDirectory
            ? item.relativeDirectory
              ? `${outputDirectory.name}/${item.relativeDirectory}/${resultName}`
              : `${outputDirectory.name}/${resultName}`
            : resultName;
        updateItem(item.id, {
          status: "done",
          resultBlob: result.blob,
          resultUrl: URL.createObjectURL(result.blob),
          resultName,
          outputRelativePath,
          width: result.width,
          height: result.height,
          originalWidth: result.originalWidth,
          originalHeight: result.originalHeight,
          scaled: result.scaled,
          automaticParameter: result.automaticParameter,
          qualityProtected: result.qualityProtected,
          parameter: result.parameter,
          parameterLabel: result.parameterLabel,
        });
        succeeded += 1;
      } catch (error) {
        const cancelled = error instanceof DOMException && error.name === "AbortError";
        updateItem(item.id, {
          status: cancelled ? "cancelled" : "failed",
          error: cancelled
            ? "Processing cancelled."
            : processingErrorMessage(error),
        });
      } finally {
        releaseImageProcessingCache(item.file);
      }
    };

    const runProcessor = async () => {
      while (!controller.signal.aborted) {
        const itemIndex = nextItemIndex;
        nextItemIndex += 1;
        const item = queue[itemIndex];
        if (!item) return;
        await processItem(item);
      }
    };

    await Promise.all(
      Array.from({ length: processorCount }, () => runProcessor()),
    );

    setIsProcessing(false);
    setShowLongRunningMessage(false);
    abortRef.current = null;
    if (controller.signal.aborted) {
      setBatchMessage("Processing stopped. Finished files are still available.");
    } else {
      setBatchMessage(
        succeeded === queue.length
          ? workflowMode === "folder" && outputDirectory
            ? `${succeeded} ${succeeded === 1 ? "image was" : "images were"} written to ${outputDirectory.name}.`
            : `${succeeded} ${succeeded === 1 ? "image is" : "images are"} ready to download.`
          : `${succeeded} of ${queue.length} images completed. Review the file notes below.`,
      );
      playCompletionChime();
    }
  };

  const cancelBatch = () => abortRef.current?.abort();

  const downloadCompletedAsZip = async () => {
    const downloadableItems = items.filter(
      (item) =>
        item.status === "done" &&
        item.resultBlob &&
        item.resultName,
    );
    if (!downloadableItems.length || isCreatingZip) return;

    setIsCreatingZip(true);
    setBatchMessage("Packing completed images into one ZIP…");

    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      const outputFolder = zip.folder("PixelLock-Converted");
      const usedNames = new Map<string, number>();

      downloadableItems.forEach((item) => {
        if (!item.resultBlob || !item.resultName || !outputFolder) return;

        const extensionIndex = item.resultName.lastIndexOf(".");
        const baseName =
          extensionIndex > 0
            ? item.resultName.slice(0, extensionIndex)
            : item.resultName;
        const extension =
          extensionIndex > 0 ? item.resultName.slice(extensionIndex) : "";
        const duplicateCount = usedNames.get(item.resultName) ?? 0;
        usedNames.set(item.resultName, duplicateCount + 1);
        const archiveName = duplicateCount
          ? `${baseName}-${duplicateCount + 1}${extension}`
          : item.resultName;

        outputFolder.file(archiveName, item.resultBlob);
      });

      const zipBlob = await zip.generateAsync({
        type: "blob",
        compression: "STORE",
      });
      const zipUrl = URL.createObjectURL(zipBlob);
      const link = document.createElement("a");
      const dateStamp = new Date().toISOString().slice(0, 10);
      link.href = zipUrl;
      link.download = `pixellock-converted-${dateStamp}.zip`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(zipUrl), 1000);
      setBatchMessage(
        `${downloadableItems.length} ${downloadableItems.length === 1 ? "image was" : "images were"} packed into one ZIP.`,
      );
    } catch {
      setBatchMessage("The ZIP could not be created. Individual downloads are still available.");
    } finally {
      setIsCreatingZip(false);
    }
  };

  const removeItem = (id: string) => {
    if (qualityEditorId === id) setQualityEditorId(null);
    setItems((current) => {
      const item = current.find((entry) => entry.id === id);
      if (item) {
        URL.revokeObjectURL(item.sourceUrl);
        if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
      }
      return current.filter((entry) => entry.id !== id);
    });
  };

  const reset = () => {
    abortRef.current?.abort();
    items.forEach((item) => {
      URL.revokeObjectURL(item.sourceUrl);
      if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
    });
    setItems([]);
    setInputDirectory(null);
    setBatchMessage("");
    setShowLongRunningMessage(false);
    setQualityEditorId(null);
  };

  const changeWorkflowMode = (nextMode: "folder" | "instant") => {
    if (nextMode === workflowMode || isProcessing) return;
    reset();
    setWorkflowMode(nextMode);
    setBatchMessage(
      nextMode === "folder"
        ? "Folder Batch keeps the complete Input and Output structure."
        : "Instant Drop converts selected images and prepares direct downloads.",
    );
  };

  return (
    <main className="app-shell">
      <SiteHeader />

      <section className={`hero${showBackLink ? " has-eyebrow" : ""}`} id="top">
        {showBackLink && (
          <div className="eyebrow">
            <a href="/">← Image Converter</a>
          </div>
        )}
        <h1>{title}</h1>
      </section>

      <section className="workspace" aria-label="Image conversion workspace">
        <div className="workspace-main">
          <div className="workflow-tabs" role="tablist" aria-label="Conversion method">
            <button
              type="button"
              role="tab"
              aria-selected={workflowMode === "folder"}
              className={workflowMode === "folder" ? "selected" : ""}
              onClick={() => changeWorkflowMode("folder")}
              disabled={isProcessing}
            >
              <strong>Folder Batch</strong>
              <span>Keep nested folders</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={workflowMode === "instant"}
              className={workflowMode === "instant" ? "selected" : ""}
              onClick={() => changeWorkflowMode("instant")}
              disabled={isProcessing}
            >
              <strong>Instant Drop</strong>
              <span>Drag, convert, download</span>
            </button>
          </div>

          <div className="section-heading">
            <div>
              <span className="step-number">01</span>
              <h2>
                {workflowMode === "folder"
                  ? "Choose Input and Output"
                  : "Drop images to convert"}
              </h2>
            </div>
            <Badge variant="secondary" className="file-count">
              {items.length} {items.length === 1 ? "file" : "files"}
            </Badge>
          </div>

          {workflowMode === "folder" ? (
            <>
          <div className="folder-workflow">
            <section className={`folder-card${inputDirectory ? " selected" : ""}`}>
              <div className="folder-card-top">
                <span className="folder-label">Input</span>
                <span className="folder-state">{inputDirectory ? "Connected" : "Required"}</span>
              </div>
              <FolderIcon direction="input" />
              <div className="folder-copy">
                <strong>{inputDirectory?.name ?? "Input folder"}</strong>
                <p>
                  {inputDirectory
                    ? `${items.length} supported ${items.length === 1 ? "image" : "images"} found`
                    : "PixelLock scans every nested folder for supported images."}
                </p>
              </div>
              <Button
                variant="outline"
                className="folder-button"
                onClick={chooseInputFolder}
                disabled={isProcessing}
              >
                {inputDirectory ? "Change Input" : "Choose Input folder"}
                <span>→</span>
              </Button>
            </section>

            <div className="flow-arrow" aria-hidden="true">
              <span>→</span>
              <small>convert</small>
            </div>

            <section className={`folder-card${outputDirectory ? " selected" : ""}`}>
              <div className="folder-card-top">
                <span className="folder-label">Output</span>
                <span className="folder-state">{outputDirectory ? "Writable" : "Required"}</span>
              </div>
              <FolderIcon direction="output" />
              <div className="folder-copy">
                <strong>{outputDirectory?.name ?? "Output folder"}</strong>
                <p>
                  {outputDirectory
                    ? "Ready to receive converted files and matching subfolders."
                    : "Finished files are written here—not downloaded one by one."}
                </p>
              </div>
              <Button
                variant="outline"
                className="folder-button"
                onClick={chooseOutputFolder}
                disabled={isProcessing}
              >
                {outputDirectory ? "Change Output" : "Choose Output folder"}
                <span>→</span>
              </Button>
            </section>
          </div>

          <p className="folder-note">
            Example: <strong>Input/products/shoe.png</strong> becomes{" "}
            <strong>Output/products/shoe.{format.toLowerCase() === "jpeg" ? "jpg" : format.toLowerCase()}</strong>.
          </p>
            </>
          ) : (
            <div
              className={`drop-zone${isDragging ? " is-dragging" : ""}`}
              role="button"
              tabIndex={0}
              aria-label="Choose images or drag and drop images here"
              onClick={openInstantPicker}
              onKeyDown={handleDropZoneKeyDown}
              onDragEnter={(event) => {
                event.preventDefault();
                if (!isProcessing) setIsDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setIsDragging(false);
                }
              }}
              onDrop={handleDrop}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp,image/bmp,image/avif,.heic,.heif"
                onChange={(event) => {
                  void addInstantFiles(Array.from(event.target.files ?? []));
                  event.target.value = "";
                }}
                disabled={isProcessing}
              />
              <div className="drop-icon" aria-hidden="true">
                <UploadIcon />
              </div>
              <div>
                <strong>{isDragging ? "Release to add images" : "Drop images here"}</strong>
                <span>or click to choose multiple files</span>
              </div>
              <p>PNG · JPG · WEBP · BMP · HEIC · AVIF</p>
            </div>
          )}

          {items.length > 0 && (
            <div className="queue" aria-live="polite">
              <div className="queue-header">
                <h3>{workflowMode === "folder" ? "Input folder queue" : "Instant queue"}</h3>
                <div className="queue-header-actions">
                  {workflowMode === "instant" && completeItems.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="zip-download-button"
                      onClick={downloadCompletedAsZip}
                      disabled={isProcessing || isCreatingZip}
                    >
                      {isCreatingZip ? (
                        <>
                          <span className="zip-spinner" aria-hidden="true" />
                          Packing ZIP…
                        </>
                      ) : (
                        <>
                          Download all ZIP
                          <span aria-hidden="true">↓</span>
                        </>
                      )}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-button"
                    onClick={reset}
                    disabled={isProcessing || isCreatingZip}
                  >
                    Clear all
                  </Button>
                </div>
              </div>
              <div className="queue-list">
                {items.map((item, index) => (
                  <article className={`queue-item status-${item.status}`} key={item.id}>
                    <div className="thumbnail-wrap">
                      {/* Browser-created local URL; the file is never uploaded. */}
                      <img src={item.sourceUrl} alt="" className="thumbnail" />
                      <span>{String(index + 1).padStart(2, "0")}</span>
                    </div>
                    <div className="file-details">
                      <strong title={item.file.name}>{item.file.name}</strong>
                      <span>
                        {workflowMode === "folder"
                          ? item.relativeDirectory
                            ? `${item.relativeDirectory}/`
                            : "Input root · "
                          : "Local file · "}
                        {formatDecimalKb(item.file.size)}
                        {item.width && item.height ? ` · ${item.width} × ${item.height} px` : ""}
                      </span>
                      {item.status === "processing" && item.update && (
                        <div className="search-progress">
                          <Progress
                            className="progress-track"
                            value={item.update.attempt}
                            max={item.update.totalAttempts}
                            aria-label="Conversion search progress"
                          />
                          <span>
                            {item.update.phase === "scaling"
                              ? `Finding the best scale · ${item.update.width} × ${item.update.height} px`
                              : item.update.phase === "target"
                                ? "Optimizing WebP directly to the size target"
                              : `Testing ${format === "PNG" ? "colors" : "quality"} ${item.update.parameter}`}
                            {" · "}
                            {formatDecimalKb(item.update.sizeBytes)}
                          </span>
                        </div>
                      )}
                      {item.error && <p className="file-error">{item.error}</p>}
                      {item.status === "done" && item.resultBlob && (
                        <p className="file-success">
                          {formatDecimalKb(item.resultBlob.size)} · {item.automaticParameter
                            ? "Best-fit quality"
                            : `${item.parameterLabel} ${item.parameter}`}
                          {` · Strict ${maxSizeKb} KB maximum passed`}
                          {item.manualQuality
                            ? ` · Manual ${item.manualQuality}% ceiling`
                            : " · Automatic quality"}
                          {item.qualityProtected
                            ? " · High-quality floor protected"
                            : " · Best achievable quality at original dimensions"}
                          {item.scaled && item.originalWidth && item.originalHeight
                            ? ` · Scaled ${item.originalWidth} × ${item.originalHeight} → ${item.width} × ${item.height} px`
                            : " · Original dimensions"}
                          {workflowMode === "folder"
                            ? ` · Written to ${item.outputRelativePath}`
                            : " · Ready to download"}
                        </p>
                      )}
                    </div>
                    <div className="item-actions">
                      {workflowMode === "instant" && format !== "BMP" && item.status !== "processing" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="quality-adjust-button"
                          onClick={() => setQualityEditorId(item.id)}
                          aria-label={`Adjust quality for ${item.file.name}`}
                        >
                          {item.manualQuality ? `Quality ${item.manualQuality}%` : "Adjust quality"}
                        </Button>
                      )}
                      <Badge
                        variant={
                          item.status === "done"
                            ? "success"
                            : item.status === "failed"
                              ? "destructive"
                              : item.status === "ready"
                                ? "outline"
                                : "secondary"
                        }
                        className={`status-chip ${item.status}`}
                      >
                        {item.status === "ready" && "Ready"}
                        {item.status === "processing" && "Searching"}
                        {item.status === "done" && "Complete"}
                        {item.status === "failed" && "Failed"}
                        {item.status === "cancelled" && "Stopped"}
                      </Badge>
                      {item.status === "done" && workflowMode === "instant" && item.resultUrl ? (
                        <a
                          className="icon-button download-button"
                          href={item.resultUrl}
                          download={item.resultName}
                          aria-label={`Download ${item.resultName}`}
                          title={`Download ${item.resultName}`}
                        >
                          ↓
                        </a>
                      ) : item.status === "done" ? (
                        <span className="output-check" aria-label="Written to Output" title="Written to Output">
                          ✓
                        </span>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="icon-button"
                          onClick={() => removeItem(item.id)}
                          disabled={item.status === "processing"}
                          aria-label={`Remove ${item.file.name}`}
                          title="Remove file"
                        >
                          ×
                        </Button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
        </div>

        <aside className="settings-panel" aria-label="Conversion settings">
          <div className="settings-heading">
            <span className="step-number">02</span>
            <h2>Set the target</h2>
          </div>

          {fixedFormat ? (
            <div className="fixed-format-summary">
              <span>Output format</span>
              <strong>{formats.find((option) => option.value === format)?.label}</strong>
              <small>Fixed for this conversion tool</small>
            </div>
          ) : (
            <label className="output-format-control" htmlFor="image-output-format">
              <span>Output format</span>
              <Select
                id="image-output-format"
                aria-label="Output format"
                value={format}
                onValueChange={(nextFormat) => changeFormat(nextFormat as OutputFormat)}
                disabled={isProcessing}
              >
                {formats.map((option) => (
                  <option value={option.value} key={option.value}>
                    {option.label} — {option.note}
                  </option>
                ))}
              </Select>
            </label>
          )}

          <fieldset>
            <legend>Maximum file size</legend>
            <div className="size-options">
              {(["100", "150", "200"] as const).map((size) => (
                <label key={size} className={sizeMode === size ? "selected" : ""}>
                  <input
                    type="radio"
                    name="size"
                    checked={sizeMode === size}
                    onChange={() => changeSizeMode(size)}
                    disabled={isProcessing}
                  />
                  <strong>{size}</strong>
                  <span>KB</span>
                </label>
              ))}
              <label className={sizeMode === "custom" ? "selected custom-size" : "custom-size"}>
                <input
                  type="radio"
                  name="size"
                  checked={sizeMode === "custom"}
                  onChange={() => changeSizeMode("custom")}
                  disabled={isProcessing}
                />
                <span>Custom</span>
              </label>
            </div>
            {sizeMode === "custom" && (
              <label className="custom-input">
                <span>Target size</span>
                <div>
                  <input
                    type="number"
                    min="1"
                    step="0.5"
                    value={customSize}
                    onChange={(event) => {
                      setCustomSize(event.target.value);
                      resetCompletedResults();
                    }}
                    disabled={isProcessing}
                    aria-label="Custom maximum size in kilobytes"
                  />
                  <span>KB</span>
                </div>
              </label>
            )}
            <p className="safety-note">
              <span aria-hidden="true">✓</span>
              Strict ceiling — output never exceeds the selected maximum. A 0.5 KB safety margin is reserved.
            </p>
          </fieldset>

          <div className={`scaling-rule${allowScaling ? " enabled" : ""}`}>
            <Switch
              checked={allowScaling}
              onCheckedChange={(checked) => {
                setAllowScaling(checked);
                resetCompletedResults();
              }}
              disabled={isProcessing}
              aria-label="Allow image scaling when original dimensions cannot meet the size target at good quality"
            />
            <span className="scaling-copy">
              <strong>Allow scaling fallback</strong>
              <small>
                {allowScaling
                  ? "On — PixelLock finds the largest dimensions that still pass the strict sharpness threshold."
                  : "Off — dimensions stay locked. PixelLock finds the highest codec quality that fits the strict maximum."}
              </small>
            </span>
          </div>

          {isProcessing ? (
            <Button
              variant="destructive"
              size="lg"
              className="primary-button processing"
              onClick={cancelBatch}
              aria-label="Stop processing"
            >
              <span className="processing-label">
                <span className="button-spinner" aria-hidden="true" />
                Converting images…
              </span>
              <span className="button-stop">Stop</span>
            </Button>
          ) : (
            <Button
              size="lg"
              className="primary-button"
              onClick={processBatch}
              disabled={
                !items.length ||
                (workflowMode === "folder" && !outputDirectory) ||
                pendingCount === 0
              }
            >
              {completeItems.length
                ? "Process remaining"
                : workflowMode === "folder"
                  ? "Convert Input to Output"
                  : "Convert instant queue"}
              <span>→</span>
            </Button>
          )}
          {batchMessage && <p className="batch-message" role="status">{batchMessage}</p>}
        </aside>
      </section>

      {qualityEditorItem && workflowMode === "instant" && format !== "BMP" && (
        <QualityEditor
          key={`${qualityEditorItem.id}-${format}`}
          format={format}
          item={qualityEditorItem}
          maxSizeKb={maxSizeKb}
          onApply={(quality) => applyManualQuality(qualityEditorItem.id, quality)}
          onClose={() => setQualityEditorId(null)}
        />
      )}

      {showLongRunningMessage && (
        <div className="long-running-message" role="status" aria-live="polite">
          <div className="reassurance-icon" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="reassurance-copy">
            <strong>Still working its magic</strong>
            <p>No need to wait here—I’ll chime when your files are ready.</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="reassurance-close"
            onClick={() => setShowLongRunningMessage(false)}
            aria-label="Close progress message"
            title="Close"
          >
            ×
          </Button>
        </div>
      )}
    </main>
  );
}
