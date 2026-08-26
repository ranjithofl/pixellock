import {
  type DragEvent,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
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
          { allowScaling },
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
                onChange={(event) => changeFormat(event.target.value as OutputFormat)}
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
