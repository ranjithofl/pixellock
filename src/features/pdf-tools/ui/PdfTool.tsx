import {
  type DragEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { SiteHeader } from "../../../components/layout/SiteHeader";
import { Button, Progress, Select } from "../../../components/ui";
import { UploadIcon } from "../../../components/ui/Icons";
import {
  type CompressionPreset,
  type PdfPagePlan,
  compressPdf,
  inspectPdf,
  organizePdf,
  parsePageGroups,
  splitPdf,
} from "../core/pdfTools";

export type PdfToolKind = "compress" | "organize" | "split";

const toolCopy = {
  compress: { title: "Compress PDF", action: "Compress PDF" },
  organize: { title: "Organize PDF", action: "Create organized PDF" },
  split: { title: "Split PDF", action: "Split into ZIP" },
} satisfies Record<PdfToolKind, { title: string; action: string }>;

function formatSize(bytes: number) {
  return `${(bytes / 1_000_000).toFixed(bytes >= 10_000_000 ? 1 : 2)} MB`;
}

function outputName(fileName: string, suffix: string, extension: string) {
  const index = fileName.lastIndexOf(".");
  const stem = (index > 0 ? fileName.slice(0, index) : fileName)
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._ -]+/g, "-")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 120) || "document";
  return `${stem}-${suffix}.${extension}`;
}

export function PdfTool({ kind }: { kind: PdfToolKind }) {
  const copy = toolCopy[kind];
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState("");
  const [progressMessage, setProgressMessage] = useState("");
  const [progress, setProgress] = useState({ value: 0, max: 1 });
  const [pagePreviews, setPagePreviews] = useState<string[]>([]);
  const [plan, setPlan] = useState<PdfPagePlan[]>([]);
  const [preset, setPreset] = useState<CompressionPreset>("quality");
  const [splitMode, setSplitMode] = useState<"pages" | "ranges">("pages");
  const [ranges, setRanges] = useState("1");
  const [result, setResult] = useState<{
    name: string;
    size: number;
    url: string;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const releasePreviews = (urls: string[]) => urls.forEach((url) => URL.revokeObjectURL(url));
  const clearResult = () => {
    setResult((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
  };

  useEffect(() => () => releasePreviews(pagePreviews), [pagePreviews]);
  useEffect(
    () => () => {
      if (result) URL.revokeObjectURL(result.url);
    },
    [result],
  );

  const chooseFile = async (nextFile: File | undefined) => {
    setError("");
    clearResult();
    if (!nextFile) return;
    if (!nextFile.name.toLowerCase().endsWith(".pdf")) {
      setError("Choose a PDF file.");
      return;
    }
    if (nextFile.size < 5 || nextFile.size > 100_000_000) {
      setError("PDF files must be between 5 bytes and 100 MB.");
      return;
    }
    setIsProcessing(true);
    setProgressMessage("Reading PDF pages");
    try {
      const inspection = await inspectPdf(nextFile, (message, value, max) => {
        setProgressMessage(message);
        setProgress({ value, max });
      });
      releasePreviews(pagePreviews);
      setPagePreviews(inspection.pages.map((page) => URL.createObjectURL(page.preview)));
      setPlan(inspection.pages.map((_, sourceIndex) => ({ sourceIndex, rotation: 0 })));
      setRanges(inspection.pages.length > 1 ? `1-${inspection.pages.length}` : "1");
      setFile(nextFile);
      setProgressMessage("");
    } catch (inspectionError) {
      setFile(null);
      setError(inspectionError instanceof Error ? inspectionError.message : "The PDF could not be opened.");
      setProgressMessage("");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (!isProcessing) void chooseFile(event.dataTransfer.files[0]);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!isProcessing) inputRef.current?.click();
    }
  };

  const movePage = (index: number, direction: -1 | 1) => {
    setPlan((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    clearResult();
  };

  const runTool = async () => {
    if (!file || isProcessing) return;
    setIsProcessing(true);
    setError("");
    clearResult();
    setProgress({ value: 0, max: 1 });
    try {
      let blob: Blob;
      let name: string;
      if (kind === "compress") {
        setProgressMessage("Preparing high-quality compression");
        blob = await compressPdf(file, preset, (message, value, max) => {
          setProgressMessage(message);
          setProgress({ value, max });
        });
        name = outputName(file.name, "compressed", "pdf");
      } else if (kind === "organize") {
        setProgressMessage("Writing organized pages");
        blob = await organizePdf(file, plan);
        name = outputName(file.name, "organized", "pdf");
      } else {
        setProgressMessage("Splitting pages into validated PDFs");
        const groups = splitMode === "pages"
          ? plan.map((page) => [page.sourceIndex])
          : parsePageGroups(ranges, pagePreviews.length);
        blob = await splitPdf(file, groups);
        name = outputName(file.name, "split", "zip");
      }
      setResult({ name, size: blob.size, url: URL.createObjectURL(blob) });
      setProgress({ value: 1, max: 1 });
      setProgressMessage("Ready to download");
    } catch (toolError) {
      setProgressMessage("");
      setError(toolError instanceof Error ? toolError.message : "The PDF operation could not be completed.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <main className="app-shell">
      <SiteHeader />
      <section className="hero" id="top"><h1>{copy.title}.</h1></section>
      <section className="workspace file-converter-workspace" aria-label={`${copy.title} workspace`}>
        <div className="workspace-main">
          <div className="section-heading"><div><span className="step-number">01</span><h2>Choose a PDF</h2></div></div>
          <div
            className={`drop-zone file-drop-zone${isDragging ? " is-dragging" : ""}`}
            role="button"
            tabIndex={0}
            aria-label={`Choose a PDF for ${copy.title}`}
            onClick={() => !isProcessing && inputRef.current?.click()}
            onKeyDown={handleKeyDown}
            onDragEnter={(event) => { event.preventDefault(); if (!isProcessing) setIsDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragging(false);
            }}
            onDrop={handleDrop}
          >
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              disabled={isProcessing}
              onChange={(event) => {
                void chooseFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <div className="drop-icon" aria-hidden="true"><UploadIcon /></div>
            <div><strong>{isDragging ? "Release to add PDF" : "Drop a PDF here"}</strong><span>or click to choose from this computer</span></div>
            <p>PDF up to 100 MB · processed only on this device</p>
          </div>

          {file && (
            <div className="selected-source-file">
              <span aria-hidden="true">01</span>
              <div><strong>{file.name}</strong><small>{formatSize(file.size)} · {pagePreviews.length} {pagePreviews.length === 1 ? "page" : "pages"}</small></div>
              <Button variant="ghost" size="icon" aria-label={`Remove ${file.name}`} disabled={isProcessing} onClick={() => {
                setFile(null);
                setPlan([]);
                releasePreviews(pagePreviews);
                setPagePreviews([]);
                setError("");
                clearResult();
              }}>×</Button>
            </div>
          )}

          {kind === "organize" && plan.length > 0 && (
            <div className="pdf-page-grid" aria-label="PDF page arrangement">
              {plan.map((item, index) => (
                <article className="pdf-page-card" key={`${item.sourceIndex}-${index}`}>
                  <div className="pdf-page-preview"><img src={pagePreviews[item.sourceIndex]} alt={`Original page ${item.sourceIndex + 1}`} style={{ transform: `rotate(${item.rotation}deg)` }} /></div>
                  <strong>Page {item.sourceIndex + 1}</strong>
                  <div className="pdf-page-actions">
                    <Button variant="outline" size="icon" aria-label={`Move page ${item.sourceIndex + 1} left`} disabled={index === 0 || isProcessing} onClick={() => movePage(index, -1)}>←</Button>
                    <Button variant="outline" size="icon" aria-label={`Move page ${item.sourceIndex + 1} right`} disabled={index === plan.length - 1 || isProcessing} onClick={() => movePage(index, 1)}>→</Button>
                    <Button variant="outline" size="icon" aria-label={`Rotate page ${item.sourceIndex + 1}`} disabled={isProcessing} onClick={() => {
                      setPlan((current) => current.map((page, pageIndex) => pageIndex === index ? { ...page, rotation: ((page.rotation + 90) % 360) as PdfPagePlan["rotation"] } : page));
                      clearResult();
                    }}>↻</Button>
                    <Button variant="ghost" size="icon" aria-label={`Remove page ${item.sourceIndex + 1}`} disabled={isProcessing || plan.length === 1} onClick={() => {
                      setPlan((current) => current.filter((_, pageIndex) => pageIndex !== index));
                      clearResult();
                    }}>×</Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <aside className="settings-panel" aria-label={`${copy.title} settings`}>
          <div className="settings-heading"><span className="step-number">02</span><h2>Set the result</h2></div>
          {kind === "compress" && (
            <label className="output-format-control" htmlFor="pdf-compression-profile"><span>Compression profile</span><Select id="pdf-compression-profile" value={preset} disabled={isProcessing} onValueChange={(nextPreset) => { setPreset(nextPreset as CompressionPreset); clearResult(); }}><option value="quality">Quality — sharpest rebuild</option><option value="balanced">Balanced — smaller, clear pages</option><option value="compact">Compact — strongest reduction</option></Select><small className="setting-help">Compression rebuilds each page visually. Selectable text and links are not retained.</small></label>
          )}
          {kind === "organize" && <p className="tool-guidance">Reorder, rotate, or remove pages. Page content is copied without rasterizing it.</p>}
          {kind === "split" && (
            <fieldset className="pdf-split-settings">
              <legend>Split method</legend>
              <label htmlFor="split-every-page">
                <input id="split-every-page" type="radio" name="split-mode" checked={splitMode === "pages"} onChange={() => setSplitMode("pages")} disabled={isProcessing} />
                <span>Every page<small>One PDF per original page</small></span>
              </label>
              <label htmlFor="split-custom-ranges">
                <input id="split-custom-ranges" type="radio" name="split-mode" checked={splitMode === "ranges"} onChange={() => setSplitMode("ranges")} disabled={isProcessing} />
                <span>Custom groups<small>Example: 1-3, 4, 5-7</small></span>
              </label>
              {splitMode === "ranges" && <input className="page-range-input" value={ranges} onChange={(event) => { setRanges(event.target.value); clearResult(); }} aria-label="PDF page groups" disabled={isProcessing} />}
            </fieldset>
          )}
          {progressMessage && <div className="file-conversion-progress" aria-live="polite"><Progress value={progress.value} max={progress.max} /><span>{progressMessage}</span></div>}
          {error && <p className="converter-error" role="alert">{error}</p>}
          {result ? (
            <><a className="ui-button ui-button-default ui-button-lg converter-download" href={result.url} download={result.name}>Download {result.name}<span aria-hidden="true">↓</span></a>{kind === "compress" && file && <p className="result-detail">{formatSize(file.size)} → {formatSize(result.size)} · {Math.max(0, Math.round((1 - result.size / file.size) * 100))}% smaller</p>}</>
          ) : (
            <Button size="lg" className="convert-button" disabled={!file || isProcessing || (kind === "organize" && !plan.length)} onClick={runTool}>{isProcessing ? <><span className="button-spinner" aria-hidden="true" />Working…</> : <>{copy.action}<span aria-hidden="true">→</span></>}</Button>
          )}
        </aside>
      </section>
    </main>
  );
}
