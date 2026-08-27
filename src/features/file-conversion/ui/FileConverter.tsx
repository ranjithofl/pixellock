import {
  type DragEvent,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ConverterCategory } from "../../../app/converterCatalog";
import { SiteHeader } from "../../../components/layout/SiteHeader";
import { Button, Progress, Select } from "../../../components/ui";
import { UploadIcon } from "../../../components/ui/Icons";

const maximumFileBytes = 100 * 1_000_000;

function fileExtension(fileName: string) {
  const index = fileName.lastIndexOf(".");
  return index >= 0 ? fileName.slice(index + 1).toLowerCase() : "";
}

function outputName(fileName: string, extension: string) {
  const index = fileName.lastIndexOf(".");
  const stem = (index > 0 ? fileName.slice(0, index) : fileName)
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._ -]+/g, "-")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 120) || "converted";
  return `${stem}.${extension}`;
}

function formatSize(bytes: number) {
  return `${(bytes / 1_000_000).toFixed(bytes >= 10_000_000 ? 1 : 2)} MB`;
}

export function FileConverter({ category }: { category: ConverterCategory }) {
  const [file, setFile] = useState<File | null>(null);
  const [output, setOutput] = useState(category.outputs[0]?.value ?? "");
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState("");
  const [progressMessage, setProgressMessage] = useState("");
  const [progress, setProgress] = useState({ value: 0, max: 1 });
  const [result, setResult] = useState<{ url: string; name: string } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(
    () => () => {
      if (result) URL.revokeObjectURL(result.url);
    },
    [result],
  );

  const sourceMatchesOutput = useMemo(
    () => Boolean(file && fileExtension(file.name) === output),
    [file, output],
  );

  const clearResult = () => {
    setResult((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
  };

  const chooseFile = (nextFile: File | undefined) => {
    setError("");
    clearResult();
    if (!nextFile) return;
    const extension = fileExtension(nextFile.name);
    if (!category.inputExtensions.includes(extension)) {
      setFile(null);
      setError(`Choose one of these source formats: ${category.acceptLabel}.`);
      return;
    }
    if (nextFile.size < 1 || nextFile.size > maximumFileBytes) {
      setFile(null);
      setError("Files must be between 1 byte and 100 MB.");
      return;
    }
    setFile(nextFile);
    if (extension === output) {
      const differentOutput = category.outputs.find((option) => option.value !== extension);
      if (differentOutput) setOutput(differentOutput.value);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (!isProcessing) chooseFile(event.dataTransfer.files[0]);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!isProcessing) inputRef.current?.click();
    }
  };

  const convert = async () => {
    if (!file || !output || isProcessing) return;
    if (sourceMatchesOutput) {
      setError("Choose an output format different from the source file.");
      return;
    }
    setIsProcessing(true);
    setError("");
    clearResult();
    setProgressMessage("Preparing local conversion");
    setProgress({ value: 0, max: 1 });

    try {
      let blob: Blob;
      let extension = output;
      if (category.engine === "pdf") {
        const { convertPdf } = await import("../core/pdfProcessor");
        const converted = await convertPdf(
          file,
          output as "text" | "images" | "pptx" | "docx" | "xlsx" | "xps",
          (message, value, max) => {
            setProgressMessage(message);
            setProgress({ value, max });
          },
        );
        blob = converted.blob;
        extension = converted.extension;
      } else {
        setProgressMessage("Converting with the local document engine");
        const response = await fetch(
          `/api/office-convert?category=${encodeURIComponent(category.id)}&target=${encodeURIComponent(output)}`,
          {
            body: file,
            headers: {
              "Content-Type": "application/octet-stream",
              "X-PixelLock-Filename": encodeURIComponent(file.name),
              "X-PixelLock-Request": "local-conversion",
            },
            method: "POST",
          },
        );
        if (!response.ok) {
          throw new Error((await response.text()) || "The document could not be converted.");
        }
        blob = await response.blob();
      }

      const name = outputName(file.name, extension);
      setResult({ name, url: URL.createObjectURL(blob) });
      setProgressMessage("Conversion complete");
      setProgress({ value: 1, max: 1 });
    } catch (conversionError) {
      setProgressMessage("");
      setError(
        conversionError instanceof Error
          ? conversionError.message
          : "The file could not be converted.",
      );
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <main className="app-shell">
      <SiteHeader />
      <section className="hero" id="top">
        <h1>{category.title}.</h1>
      </section>

      <section className="workspace file-converter-workspace" aria-label={`${category.title} workspace`}>
        <div className="workspace-main">
          <div className="section-heading">
            <div><span className="step-number">01</span><h2>Choose a source file</h2></div>
          </div>

          <div
            className={`drop-zone file-drop-zone${isDragging ? " is-dragging" : ""}`}
            role="button"
            tabIndex={0}
            aria-label={`Choose a file for ${category.title}`}
            onClick={() => !isProcessing && inputRef.current?.click()}
            onKeyDown={handleKeyDown}
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
              ref={inputRef}
              type="file"
              accept={category.accept}
              onChange={(event) => {
                chooseFile(event.target.files?.[0]);
                event.target.value = "";
              }}
              disabled={isProcessing}
            />
            <div className="drop-icon" aria-hidden="true">
              <UploadIcon />
            </div>
            <div>
              <strong>{isDragging ? "Release to add file" : "Drop a file here"}</strong>
              <span>or click to choose from this computer</span>
            </div>
            <p>{category.acceptLabel}</p>
          </div>

          {file && (
            <div className="selected-source-file">
              <span aria-hidden="true">01</span>
              <div>
                <strong>{file.name}</strong>
                <small>{formatSize(file.size)} · Local file</small>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${file.name}`}
                onClick={() => {
                  setFile(null);
                  setError("");
                  clearResult();
                }}
                disabled={isProcessing}
              >
                ×
              </Button>
            </div>
          )}
        </div>

        <aside className="settings-panel" aria-label="Conversion settings">
          <div className="settings-heading">
            <span className="step-number">02</span>
            <h2>Choose output</h2>
          </div>
          <label className="output-format-control" htmlFor={`${category.id}-output-format`}>
            <span>Output format</span>
            <Select
              id={`${category.id}-output-format`}
              aria-label="Output format"
              value={output}
              onValueChange={(nextOutput) => {
                setOutput(nextOutput);
                setError("");
                clearResult();
              }}
              disabled={isProcessing}
            >
              {category.outputs.map((option) => (
                <option
                  value={option.value}
                  disabled={Boolean(file && fileExtension(file.name) === option.value)}
                  key={option.value}
                >
                  {option.label}
                </option>
              ))}
            </Select>
          </label>

          {progressMessage && (
            <div className="file-conversion-progress" aria-live="polite">
              <Progress value={progress.value} max={progress.max} />
              <span>{progressMessage}</span>
            </div>
          )}
          {error && <p className="converter-error" role="alert">{error}</p>}

          {result ? (
            <a
              className="ui-button ui-button-default ui-button-lg converter-download"
              href={result.url}
              download={result.name}
            >
              Download {result.name}
              <span aria-hidden="true">↓</span>
            </a>
          ) : (
            <Button
              size="lg"
              className="convert-button"
              onClick={convert}
              disabled={!file || isProcessing || sourceMatchesOutput}
            >
              {isProcessing ? (
                <>
                  <span className="button-spinner" aria-hidden="true" />
                  Converting…
                </>
              ) : (
                <>
                  Convert file
                  <span aria-hidden="true">→</span>
                </>
              )}
            </Button>
          )}
        </aside>
      </section>
    </main>
  );
}
