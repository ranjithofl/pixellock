"use client";

import {
  ChangeEvent,
  DragEvent,
  KeyboardEvent,
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
  sourceUrl: string;
  status: QueueStatus;
  resultUrl?: string;
  resultBlob?: Blob;
  resultName?: string;
  width?: number;
  height?: number;
  parameter?: number;
  parameterLabel?: "Quality" | "Colors";
  update?: SearchUpdate;
  error?: string;
};

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

function download(url: string, name: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export default function ImageConverter() {
  const [format, setFormat] = useState<OutputFormat>("WEBP");
  const [sizeMode, setSizeMode] = useState<"100" | "150" | "200" | "custom">("100");
  const [customSize, setCustomSize] = useState("120");
  const [items, setItems] = useState<QueueItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [batchMessage, setBatchMessage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
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
    },
    [],
  );

  const maxSizeKb = useMemo(() => {
    if (sizeMode === "custom") return Number(customSize);
    return Number(sizeMode);
  }, [customSize, sizeMode]);

  const completeItems = items.filter((item) => item.status === "done");
  const pendingCount = items.filter(
    (item) => item.status === "ready" || item.status === "failed" || item.status === "cancelled",
  ).length;

  const addFiles = (files: File[]) => {
    const accepted = files.filter(isAccepted);
    const rejectedCount = files.length - accepted.length;
    const nextItems = accepted.map<QueueItem>((file) => ({
      id: createId(file),
      file,
      sourceUrl: URL.createObjectURL(file),
      status: "ready",
    }));
    setItems((current) => [...current, ...nextItems]);
    setBatchMessage(
      rejectedCount
        ? `${rejectedCount} unsupported ${rejectedCount === 1 ? "file was" : "files were"} skipped.`
        : "",
    );
  };

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
  };

  const handleDropKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      inputRef.current?.click();
    }
  };

  const updateItem = (id: string, patch: Partial<QueueItem>) => {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  };

  const processBatch = async () => {
    if (!items.length || isProcessing) return;
    if (!Number.isFinite(maxSizeKb) || maxSizeKb <= 0.5) {
      setBatchMessage("Enter a maximum size greater than 0.5 KB.");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setIsProcessing(true);
    setBatchMessage("");
    const queue = items.filter((item) => item.status !== "done");
    let succeeded = 0;

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
        const resultUrl = URL.createObjectURL(result.blob);
        updateItem(item.id, {
          status: "done",
          resultBlob: result.blob,
          resultUrl,
          resultName: outputName(item.file.name, format),
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
    abortRef.current = null;
    if (controller.signal.aborted) {
      setBatchMessage("Processing stopped. Finished files are still available.");
    } else {
      setBatchMessage(
        succeeded === queue.length
          ? `${succeeded} ${succeeded === 1 ? "image" : "images"} ready to download.`
          : `${succeeded} of ${queue.length} images completed. Review the file notes below.`,
      );
    }
  };

  const cancelBatch = () => abortRef.current?.abort();

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
    setBatchMessage("");
  };

  const downloadAll = async () => {
    if (!completeItems.length) return;
    if (completeItems.length === 1) {
      const item = completeItems[0];
      if (item.resultUrl && item.resultName) download(item.resultUrl, item.resultName);
      return;
    }

    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    completeItems.forEach((item) => {
      if (item.resultBlob && item.resultName) zip.file(item.resultName, item.resultBlob);
    });
    const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
    const url = URL.createObjectURL(blob);
    download(url, `pixellock-${format.toLowerCase()}-images.zip`);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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
          Private browser processing
        </div>
      </header>

      <section className="hero" id="top">
        <div className="eyebrow">
          <span>01</span>
          Strict dimension compressor
        </div>
        <div className="hero-grid">
          <h1>
            Smaller files.
            <br />
            <em>Every pixel stays.</em>
          </h1>
          <div className="hero-copy">
            <p>
              Hit an exact file-size ceiling without resizing. PixelLock searches
              for the highest usable quality at your image’s original dimensions.
            </p>
            <div className="rule-strip" aria-label="Core rules">
              <span>0 px resized</span>
              <span>0.5 KB safety</span>
              <span>100% local</span>
            </div>
          </div>
        </div>
      </section>

      <section className="workspace" aria-label="Image conversion workspace">
        <div className="workspace-main">
          <div className="section-heading">
            <div>
              <span className="step-number">01</span>
              <h2>Add your images</h2>
            </div>
            <span className="file-count">
              {items.length} {items.length === 1 ? "file" : "files"}
            </span>
          </div>

          <div
            className={`drop-zone${isDragging ? " is-dragging" : ""}`}
            onClick={() => inputRef.current?.click()}
            onKeyDown={handleDropKey}
            onDragEnter={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                setIsDragging(false);
              }
            }}
            onDrop={handleDrop}
            role="button"
            tabIndex={0}
            aria-label="Choose images or drop them here"
          >
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/bmp,image/heic,image/heif,image/avif,.heic,.heif"
              multiple
              onChange={handleInput}
            />
            <div className="drop-icon" aria-hidden="true">
              <span>+</span>
            </div>
            <div>
              <strong>Drop files here</strong>
              <span>or click to browse</span>
            </div>
            <p>PNG, JPG, WebP, BMP, HEIC, AVIF · Batch supported</p>
          </div>

          {items.length > 0 && (
            <div className="queue" aria-live="polite">
              <div className="queue-header">
                <h3>Batch queue</h3>
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
                          {formatDecimalKb(item.resultBlob.size)} · {item.parameterLabel} {item.parameter} · Dimensions locked
                        </p>
                      )}
                    </div>
                    <div className="item-actions">
                      <span className={`status-chip ${item.status}`}>
                        {item.status === "ready" && "Ready"}
                        {item.status === "processing" && "Searching"}
                        {item.status === "done" && "Complete"}
                        {item.status === "failed" && "Couldn’t fit"}
                        {item.status === "cancelled" && "Stopped"}
                      </span>
                      {item.status === "done" && item.resultUrl && item.resultName ? (
                        <a
                          className="icon-button download-button"
                          href={item.resultUrl}
                          download={item.resultName}
                          aria-label={`Download ${item.resultName}`}
                          title="Download file"
                        >
                          ↓
                        </a>
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
                    onChange={() => setFormat(option.value)}
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
                    onChange={() => setSizeMode(size)}
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
                  onChange={() => setSizeMode("custom")}
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
                    onChange={(event) => setCustomSize(event.target.value)}
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
            <button type="button" className="primary-button cancel" onClick={cancelBatch}>
              Stop processing
              <span>×</span>
            </button>
          ) : (
            <button
              type="button"
              className="primary-button"
              onClick={processBatch}
              disabled={!items.length || pendingCount === 0}
            >
              {completeItems.length ? "Process remaining" : "Compress images"}
              <span>→</span>
            </button>
          )}

          {completeItems.length > 0 && !isProcessing && (
            <button type="button" className="secondary-button" onClick={downloadAll}>
              {completeItems.length === 1 ? "Download result" : `Download ${completeItems.length} as ZIP`}
              <span>↓</span>
            </button>
          )}
          {batchMessage && <p className="batch-message" role="status">{batchMessage}</p>}
        </aside>
      </section>

      <section className="method-section" aria-labelledby="method-title">
        <div className="method-intro">
          <div className="eyebrow"><span>03</span> The method</div>
          <h2 id="method-title">The script’s rules,<br />made visible.</h2>
        </div>
        <div className="method-list">
          <article>
            <span>01</span>
            <h3>Read every pixel</h3>
            <p>PNG, JPG, WebP, BMP, HEIC, and AVIF are decoded locally at their original width and height.</p>
          </article>
          <article>
            <span>02</span>
            <h3>Search, don’t guess</h3>
            <p>A binary search tests quality 1–100, or 2–256 colors for PNG, to find the best fit.</p>
          </article>
          <article>
            <span>03</span>
            <h3>Honor the ceiling</h3>
            <p>Sizes use decimal KB. Files are accepted only beneath the target minus the safety margin.</p>
          </article>
          <article>
            <span>04</span>
            <h3>Never resize</h3>
            <p>When minimum quality still cannot fit, the file fails gracefully and its dimensions remain untouched.</p>
          </article>
        </div>
      </section>

      <footer>
        <a className="brand footer-brand" href="#top"><span className="brand-mark">PL</span><span>PixelLock</span></a>
        <p>Your files never leave this device.</p>
        <span>Strict Pixel Dimension Compressor</span>
      </footer>
    </main>
  );
}
