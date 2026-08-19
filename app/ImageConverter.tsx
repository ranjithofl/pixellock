"use client";

import {
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
  SearchUpdate,
} from "./lib/imageProcessor";

type QueueStatus = "ready" | "processing" | "done" | "failed" | "cancelled";

type QueueItem = {
  id: string;
  file: File;
  relativeDirectory: string;
  sourceUrl: string;
  status: QueueStatus;
  resultBlob?: Blob;
  resultName?: string;
  width?: number;
  height?: number;
  parameter?: number;
  parameterLabel?: "Quality" | "Colors";
  outputRelativePath?: string;
  update?: SearchUpdate;
  error?: string;
};

type LocalFileHandle = {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{
    write(data: Blob): Promise<void>;
    close(): Promise<void>;
  }>;
};

type LocalDirectoryHandle = {
  kind: "directory";
  name: string;
  values(): AsyncIterableIterator<LocalFileHandle | LocalDirectoryHandle>;
  getDirectoryHandle(
    name: string,
    options: { create: boolean },
  ): Promise<LocalDirectoryHandle>;
  getFileHandle(
    name: string,
    options: { create: boolean },
  ): Promise<LocalFileHandle>;
  isSameEntry(other: LocalDirectoryHandle): Promise<boolean>;
};

declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      id?: string;
      mode?: "read" | "readwrite";
    }) => Promise<LocalDirectoryHandle>;
    webkitAudioContext?: typeof AudioContext;
  }
}

const formats: Array<{
  value: OutputFormat;
  label: string;
  note: string;
}> = [
  { value: "WEBP", label: "WebP", note: "Balanced" },
  { value: "JPEG", label: "JPEG", note: "Universal" },
  { value: "PNG", label: "PNG", note: "Palette" },
  { value: "AVIF", label: "AVIF", note: "Smallest" },
];

const acceptedExtensions = ["png", "jpg", "jpeg", "webp", "bmp", "heic", "heif", "avif"];

function createId(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`;
}

function isAccepted(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return file.type.startsWith("image/") || acceptedExtensions.includes(extension);
}

async function collectFolderImages(
  directory: LocalDirectoryHandle,
  relativeDirectory = "",
): Promise<Array<{ file: File; relativeDirectory: string }>> {
  const images: Array<{ file: File; relativeDirectory: string }> = [];

  for await (const entry of directory.values()) {
    if (entry.kind === "directory") {
      const nestedPath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      images.push(...(await collectFolderImages(entry, nestedPath)));
      continue;
    }

    const file = await entry.getFile();
    if (isAccepted(file)) images.push({ file, relativeDirectory });
  }

  return images.sort((a, b) => {
    const pathA = `${a.relativeDirectory}/${a.file.name}`;
    const pathB = `${b.relativeDirectory}/${b.file.name}`;
    return pathA.localeCompare(pathB, undefined, { numeric: true });
  });
}

async function writeToOutputFolder(
  outputRoot: LocalDirectoryHandle,
  relativeDirectory: string,
  fileName: string,
  blob: Blob,
) {
  let destination = outputRoot;
  for (const segment of relativeDirectory.split("/").filter(Boolean)) {
    destination = await destination.getDirectoryHandle(segment, { create: true });
  }

  const fileHandle = await destination.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

export default function ImageConverter() {
  const [format, setFormat] = useState<OutputFormat>("WEBP");
  const [sizeMode, setSizeMode] = useState<"100" | "150" | "200" | "custom">("100");
  const [customSize, setCustomSize] = useState("120");
  const [items, setItems] = useState<QueueItem[]>([]);
  const [inputDirectory, setInputDirectory] = useState<LocalDirectoryHandle | null>(null);
  const [outputDirectory, setOutputDirectory] = useState<LocalDirectoryHandle | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [batchMessage, setBatchMessage] = useState("");
  const [showLongRunningMessage, setShowLongRunningMessage] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const completionAudioRef = useRef<AudioContext | null>(null);
  const itemsRef = useRef(items);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(
    () => () => {
      itemsRef.current.forEach((item) => {
        URL.revokeObjectURL(item.sourceUrl);
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
    });
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
        setBatchMessage("The Input folder could not be opened.");
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
        return {
          ...item,
          status: "ready",
          resultBlob: undefined,
          resultName: undefined,
          outputRelativePath: undefined,
          width: undefined,
          height: undefined,
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
    if (!items.length || !outputDirectory || isProcessing) return;
    if (!Number.isFinite(maxSizeKb) || maxSizeKb <= 0.5) {
      setBatchMessage("Enter a maximum size greater than 0.5 KB.");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setIsProcessing(true);
    setBatchMessage("");
    setShowLongRunningMessage(false);
    const queue = items.filter((item) => item.status !== "done");
    let succeeded = 0;
    prepareCompletionAudio();

    for (const item of queue) {
      if (controller.signal.aborted) break;
      updateItem(item.id, { status: "processing", error: undefined, update: undefined });

      try {
        const result = await processImage(
          item.file,
          format,
          maxSizeKb,
          (update) => updateItem(item.id, { update }),
          controller.signal,
        );
        const resultName = outputName(item.file.name, format);
        await writeToOutputFolder(
          outputDirectory,
          item.relativeDirectory,
          resultName,
          result.blob,
        );
        const outputRelativePath = item.relativeDirectory
          ? `${outputDirectory.name}/${item.relativeDirectory}/${resultName}`
          : `${outputDirectory.name}/${resultName}`;
        updateItem(item.id, {
          status: "done",
          resultBlob: result.blob,
          resultName,
          outputRelativePath,
          width: result.width,
          height: result.height,
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
            : error instanceof Error
              ? error.message
              : "This image could not be processed.",
        });
      }
    }

    setIsProcessing(false);
    setShowLongRunningMessage(false);
    abortRef.current = null;
    if (controller.signal.aborted) {
      setBatchMessage("Processing stopped. Finished files are still available.");
    } else {
      setBatchMessage(
        succeeded === queue.length
          ? `${succeeded} ${succeeded === 1 ? "image was" : "images were"} written to ${outputDirectory.name}.`
          : `${succeeded} of ${queue.length} images completed. Review the file notes below.`,
      );
      playCompletionChime();
    }
  };

  const cancelBatch = () => abortRef.current?.abort();

  const removeItem = (id: string) => {
    setItems((current) => {
      const item = current.find((entry) => entry.id === id);
      if (item) {
        URL.revokeObjectURL(item.sourceUrl);
      }
      return current.filter((entry) => entry.id !== id);
    });
  };

  const reset = () => {
    abortRef.current?.abort();
    items.forEach((item) => {
      URL.revokeObjectURL(item.sourceUrl);
    });
    setItems([]);
    setInputDirectory(null);
    setBatchMessage("");
    setShowLongRunningMessage(false);
  };

  return (
    <main className="app-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="PixelLock home">
          <span className="brand-mark" aria-hidden="true">
            PL
          </span>
          <span>PixelLock</span>
        </a>
        <div className="header-status">
          <span className="status-dot" aria-hidden="true" />
          Local folder processing
        </div>
      </header>

      <section className="hero" id="top">
        <div className="eyebrow">
          Deisgned By Ranjith (With AI)
        </div>
        <div className="hero-grid">
          <h1>
            Smaller files.
            <br />
            <em>Every pixel stays.</em>
          </h1>
          <div className="hero-copy">
            <p>
              Put images in an Input folder and write finished files to an Output
              folder. Every nested folder is recreated automatically.
            </p>
            <div className="rule-strip" aria-label="Core rules">
              <span>0 px resized</span>
              <span>Folders preserved</span>
              <span>Localhost only</span>
            </div>
          </div>
        </div>
      </section>

      <section className="workspace" aria-label="Image conversion workspace">
        <div className="workspace-main">
          <div className="section-heading">
            <div>
              <span className="step-number">01</span>
              <h2>Choose Input and Output</h2>
            </div>
            <span className="file-count">
              {items.length} {items.length === 1 ? "file" : "files"}
            </span>
          </div>

          <div className="folder-workflow">
            <section className={`folder-card${inputDirectory ? " selected" : ""}`}>
              <div className="folder-card-top">
                <span className="folder-label">Input</span>
                <span className="folder-state">{inputDirectory ? "Connected" : "Required"}</span>
              </div>
              <div className="folder-symbol" aria-hidden="true">
                <span>IN</span>
              </div>
              <div className="folder-copy">
                <strong>{inputDirectory?.name ?? "Input folder"}</strong>
                <p>
                  {inputDirectory
                    ? `${items.length} supported ${items.length === 1 ? "image" : "images"} found`
                    : "PixelLock scans every nested folder for supported images."}
                </p>
              </div>
              <button
                type="button"
                className="folder-button"
                onClick={chooseInputFolder}
                disabled={isProcessing}
              >
                {inputDirectory ? "Change Input" : "Choose Input folder"}
                <span>→</span>
              </button>
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
              <div className="folder-symbol output" aria-hidden="true">
                <span>OUT</span>
              </div>
              <div className="folder-copy">
                <strong>{outputDirectory?.name ?? "Output folder"}</strong>
                <p>
                  {outputDirectory
                    ? "Ready to receive converted files and matching subfolders."
                    : "Finished files are written here—not downloaded one by one."}
                </p>
              </div>
              <button
                type="button"
                className="folder-button"
                onClick={chooseOutputFolder}
                disabled={isProcessing}
              >
                {outputDirectory ? "Change Output" : "Choose Output folder"}
                <span>→</span>
              </button>
            </section>
          </div>

          <p className="folder-note">
            Example: <strong>Input/products/shoe.png</strong> becomes{" "}
            <strong>Output/products/shoe.{format.toLowerCase() === "jpeg" ? "jpg" : format.toLowerCase()}</strong>.
          </p>

          {items.length > 0 && (
            <div className="queue" aria-live="polite">
              <div className="queue-header">
                <h3>Input folder queue</h3>
                <button type="button" className="text-button" onClick={reset} disabled={isProcessing}>
                  Clear all
                </button>
              </div>
              <div className="queue-list">
                {items.map((item, index) => (
                  <article className={`queue-item status-${item.status}`} key={item.id}>
                    <div className="thumbnail-wrap">
                      {/* Browser-created local URL; the file is never uploaded. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={item.sourceUrl} alt="" className="thumbnail" />
                      <span>{String(index + 1).padStart(2, "0")}</span>
                    </div>
                    <div className="file-details">
                      <strong title={item.file.name}>{item.file.name}</strong>
                      <span>
                        {item.relativeDirectory ? `${item.relativeDirectory}/` : "Input root · "}
                        {formatDecimalKb(item.file.size)}
                        {item.width && item.height ? ` · ${item.width} × ${item.height} px` : ""}
                      </span>
                      {item.status === "processing" && item.update && (
                        <div className="search-progress">
                          <div className="progress-track">
                            <span
                              style={{
                                width: `${Math.min(100, (item.update.attempt / item.update.totalAttempts) * 100)}%`,
                              }}
                            />
                          </div>
                          <span>
                            Testing {format === "PNG" ? "colors" : "quality"} {item.update.parameter}
                            {" · "}
                            {formatDecimalKb(item.update.sizeBytes)}
                          </span>
                        </div>
                      )}
                      {item.error && <p className="file-error">{item.error}</p>}
                      {item.status === "done" && item.resultBlob && (
                        <p className="file-success">
                          {formatDecimalKb(item.resultBlob.size)} · {item.parameterLabel} {item.parameter} · Written to {item.outputRelativePath}
                        </p>
                      )}
                    </div>
                    <div className="item-actions">
                      <span className={`status-chip ${item.status}`}>
                        {item.status === "ready" && "Ready"}
                        {item.status === "processing" && "Searching"}
                        {item.status === "done" && "Complete"}
                        {item.status === "failed" && "Failed"}
                        {item.status === "cancelled" && "Stopped"}
                      </span>
                      {item.status === "done" ? (
                        <span className="output-check" aria-label="Written to Output" title="Written to Output">
                          ✓
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="icon-button"
                          onClick={() => removeItem(item.id)}
                          disabled={item.status === "processing"}
                          aria-label={`Remove ${item.file.name}`}
                          title="Remove file"
                        >
                          ×
                        </button>
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

          <fieldset>
            <legend>Output format</legend>
            <div className="format-grid">
              {formats.map((option) => (
                <label
                  key={option.value}
                  className={`format-option${format === option.value ? " selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="format"
                    value={option.value}
                    checked={format === option.value}
                    onChange={() => changeFormat(option.value)}
                    disabled={isProcessing}
                  />
                  <strong>{option.label}</strong>
                  <span>{option.note}</span>
                </label>
              ))}
            </div>
          </fieldset>

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
              A 0.5 KB safety margin is reserved automatically.
            </p>
          </fieldset>

          <div className="locked-rule">
            <div className="lock-glyph" aria-hidden="true">□</div>
            <div>
              <strong>Dimensions are locked</strong>
              <p>If a file cannot fit at its original size, PixelLock reports it instead of resizing.</p>
            </div>
          </div>

          {isProcessing ? (
            <button
              type="button"
              className="primary-button processing"
              onClick={cancelBatch}
              aria-label="Stop processing"
            >
              <span className="processing-label">
                <span className="button-spinner" aria-hidden="true" />
                Converting images…
              </span>
              <span className="button-stop">Stop</span>
            </button>
          ) : (
            <button
              type="button"
              className="primary-button"
              onClick={processBatch}
              disabled={!items.length || !outputDirectory || pendingCount === 0}
            >
              {completeItems.length ? "Process remaining" : "Convert Input to Output"}
              <span>→</span>
            </button>
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
          <button
            type="button"
            className="reassurance-close"
            onClick={() => setShowLongRunningMessage(false)}
            aria-label="Close progress message"
            title="Close"
          >
            ×
          </button>
        </div>
      )}
    </main>
  );
}
