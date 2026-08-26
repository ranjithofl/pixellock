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
import { compressGif, type GifQuality } from "../core/gifCompressor";

function formatSize(bytes: number) {
  return `${(bytes / 1_000_000).toFixed(bytes >= 10_000_000 ? 1 : 2)} MB`;
}

function outputName(fileName: string) {
  const stem = fileName.replace(/\.gif$/i, "")
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._ -]+/g, "-")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 120) || "animation";
  return `${stem}-compressed.gif`;
}

export function GifCompressor() {
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [quality, setQuality] = useState<GifQuality>("maximum");
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState("");
  const [progressMessage, setProgressMessage] = useState("");
  const [progress, setProgress] = useState({ value: 0, max: 1 });
  const [result, setResult] = useState<{
    colors: number;
    frames: number;
    name: string;
    size: number;
    url: string;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => () => {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  }, [sourceUrl]);
  useEffect(() => () => {
    if (result) URL.revokeObjectURL(result.url);
  }, [result]);

  const clearResult = () => {
    setResult((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
  };

  const chooseFile = async (nextFile: File | undefined) => {
    setError("");
    clearResult();
    if (!nextFile) return;
    if (!nextFile.name.toLowerCase().endsWith(".gif")) {
      setError("Choose a GIF file.");
      return;
    }
    if (nextFile.size < 14 || nextFile.size > 100_000_000) {
      setError("GIF files must be between 14 bytes and 100 MB.");
      return;
    }
    const signature = new TextDecoder("ascii").decode(
      new Uint8Array(await nextFile.slice(0, 6).arrayBuffer()),
    );
    if (signature !== "GIF87a" && signature !== "GIF89a") {
      setError("The file contents do not match the GIF extension.");
      return;
    }
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    setSourceUrl(URL.createObjectURL(nextFile));
    setFile(nextFile);
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

  const runCompression = async () => {
    if (!file || isProcessing) return;
    setIsProcessing(true);
    setError("");
    clearResult();
    try {
      const compressed = await compressGif(file, quality, (message, value, max) => {
        setProgressMessage(message);
        setProgress({ value, max });
      });
      setResult({
        colors: compressed.colors,
        frames: compressed.frameCount,
        name: outputName(file.name),
        size: compressed.blob.size,
        url: URL.createObjectURL(compressed.blob),
      });
      setProgressMessage("Animation ready to download");
    } catch (compressionError) {
      setProgressMessage("");
      setError(compressionError instanceof Error ? compressionError.message : "The GIF could not be compressed.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <main className="app-shell">
      <SiteHeader />
      <section className="hero" id="top"><h1>GIF Compressor.</h1></section>
      <section className="workspace file-converter-workspace" aria-label="GIF compression workspace">
        <div className="workspace-main">
          <div className="section-heading"><div><span className="step-number">01</span><h2>Choose an animated GIF</h2></div></div>
          <div
            className={`drop-zone file-drop-zone${isDragging ? " is-dragging" : ""}`}
            role="button"
            tabIndex={0}
            aria-label="Choose a GIF to compress"
            onClick={() => !isProcessing && inputRef.current?.click()}
            onKeyDown={handleKeyDown}
            onDragEnter={(event) => { event.preventDefault(); if (!isProcessing) setIsDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragging(false);
            }}
            onDrop={handleDrop}
          >
            <input ref={inputRef} type="file" accept="image/gif,.gif" disabled={isProcessing} onChange={(event) => {
              void chooseFile(event.target.files?.[0]);
              event.target.value = "";
            }} />
            <div className="drop-icon" aria-hidden="true"><UploadIcon /></div>
            <div><strong>{isDragging ? "Release to add GIF" : "Drop a GIF here"}</strong><span>or click to choose from this computer</span></div>
            <p>Animated and static GIF · up to 100 MB</p>
          </div>
          {file && (
            <div className="gif-source-card">
              <img src={sourceUrl} alt="Selected GIF preview" />
              <div><strong>{file.name}</strong><small>{formatSize(file.size)} · animation preserved</small></div>
              <Button variant="ghost" size="icon" aria-label={`Remove ${file.name}`} disabled={isProcessing} onClick={() => {
                setFile(null);
                if (sourceUrl) URL.revokeObjectURL(sourceUrl);
                setSourceUrl("");
                setError("");
                clearResult();
              }}>×</Button>
            </div>
          )}
        </div>
        <aside className="settings-panel" aria-label="GIF compression settings">
          <div className="settings-heading"><span className="step-number">02</span><h2>Protect the animation</h2></div>
          <label className="output-format-control" htmlFor="gif-color-profile"><span>Color profile</span><Select id="gif-color-profile" value={quality} disabled={isProcessing} onChange={(event) => { setQuality(event.target.value as GifQuality); clearResult(); }}><option value="maximum">Maximum quality — up to 256 colors</option><option value="balanced">Balanced — up to 128 colors</option><option value="compact">Compact — up to 64 colors</option></Select><small className="setting-help">Frame timing, looping, transparency, and animation are preserved.</small></label>
          {progressMessage && <div className="file-conversion-progress" aria-live="polite"><Progress value={progress.value} max={progress.max} /><span>{progressMessage}</span></div>}
          {error && <p className="converter-error" role="alert">{error}</p>}
          {result ? (
            <><a className="ui-button ui-button-default ui-button-lg converter-download" href={result.url} download={result.name}>Download {result.name}<span aria-hidden="true">↓</span></a>{file && <p className="result-detail">{formatSize(file.size)} → {formatSize(result.size)} · {Math.round((1 - result.size / file.size) * 100)}% smaller · {result.frames} {result.frames === 1 ? "frame" : "frames"} · {result.colors} colors</p>}</>
          ) : (
            <Button size="lg" className="convert-button" disabled={!file || isProcessing} onClick={runCompression}>{isProcessing ? <><span className="button-spinner" aria-hidden="true" />Compressing…</> : <>Compress GIF<span aria-hidden="true">→</span></>}</Button>
          )}
        </aside>
      </section>
    </main>
  );
}
