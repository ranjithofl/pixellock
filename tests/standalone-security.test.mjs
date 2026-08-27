import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("builds the standalone PixelLock application", async () => {
  const html = await readFile(new URL("dist/index.html", root), "utf8");
  assert.match(html, /<title>PixelLock — Private Local Image Converter<\/title>/);
  assert.match(html, /src="\/assets\/[^"]+\.js"/);
  assert.match(html, /href="\/assets\/[^"]+\.css"/);
  assert.doesNotMatch(html, /https?:\/\//i);
});

test("keeps the architecture small and separated", async () => {
  const required = [
    "src/app/App.tsx",
    "src/app/converterCatalog.ts",
    "src/app/routing.ts",
    "src/app/toolCatalog.ts",
    "src/main.tsx",
    "src/components/layout/SiteHeader.tsx",
    "src/components/ui/Button.tsx",
    "src/components/ui/Badge.tsx",
    "src/components/ui/Progress.tsx",
    "src/components/ui/Select.tsx",
    "src/components/ui/Switch.tsx",
    "src/components/ui/ThemeToggle.tsx",
    "src/features/image-conversion/core/imageProcessor.ts",
    "src/features/image-conversion/core/inputValidation.ts",
    "src/features/image-conversion/platform/fileSystem.ts",
    "src/features/image-conversion/ui/ImageConverter.tsx",
    "src/features/file-conversion/core/pdfProcessor.ts",
    "src/features/file-conversion/core/fixedDocumentWriters.ts",
    "src/features/file-conversion/ui/FileConverter.tsx",
    "src/features/gif-compression/core/gifCompressor.ts",
    "src/features/gif-compression/ui/GifCompressor.tsx",
    "src/features/pdf-tools/core/pdfTools.ts",
    "src/features/pdf-tools/ui/PdfTool.tsx",
    "src/features/tool-directory/NotFoundPage.tsx",
    "src/styles/theme.css",
    "config/security-headers.mjs",
    "scripts/build.mjs",
    "server/local-server.mjs",
    "server/office-converter.mjs",
    "server/image-converter.mjs",
  ];
  await Promise.all(required.map((path) => access(new URL(path, root))));

  const removed = ["app", "db", "worker", "examples", "github-pages"];
  await Promise.all(
    removed.map((path) => assert.rejects(access(new URL(path, root)))),
  );
});

test("provides a catalog with dedicated converter routes", async () => {
  const catalog = await readFile(new URL("src/app/toolCatalog.ts", root), "utf8");
  const categoryCatalog = await readFile(
    new URL("src/app/converterCatalog.ts", root),
    "utf8",
  );
  const app = await readFile(new URL("src/app/App.tsx", root), "utf8");
  const header = await readFile(
    new URL("src/components/layout/SiteHeader.tsx", root),
    "utf8",
  );
  const converter = await readFile(
    new URL("src/features/image-conversion/ui/ImageConverter.tsx", root),
    "utf8",
  );
  const fileConverter = await readFile(
    new URL("src/features/file-conversion/ui/FileConverter.tsx", root),
    "utf8",
  );
  const localServer = await readFile(
    new URL("server/local-server.mjs", root),
    "utf8",
  );

  const paths = [...catalog.matchAll(/path:\s*"(\/tools\/[^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.equal(paths.length, 7);
  assert.equal(new Set(paths).size, paths.length);
  const categoryPaths = [
    ...categoryCatalog.matchAll(/path:\s*"(\/converters\/[^"]+)"/g),
  ].map((match) => match[1]);
  assert.equal(categoryPaths.length, 5);
  assert.equal(new Set(categoryPaths).size, categoryPaths.length);
  assert.match(app, /const pathname = getAppPath\(\)/);
  assert.match(app, /pathname === "\/"/);
  assert.match(app, /findConverterCategory\(pathname\)/);
  assert.match(app, /category\?\.id === "image"/);
  assert.match(app, /<FileConverter category=\{category\}/);
  assert.match(app, /findConverterTool\(pathname\)/);
  assert.match(header, /<summary>/);
  assert.match(header, /All converters/);
  assert.match(header, /converterCategories\.map/);
  assert.match(header, /appHref\("\/"\)/);
  assert.match(header, /\/tools\/gif-compressor/);
  assert.match(header, /\/pdf-tools\/compress/);
  assert.match(header, /\/pdf-tools\/organize/);
  assert.match(header, /\/pdf-tools\/split/);
  assert.match(converter, /fixedFormat \?/);
  assert.match(converter, /<Select/);
  assert.match(converter, /onValueChange/);
  assert.doesNotMatch(converter, /className="format-grid"/);
  assert.match(fileConverter, /category\.engine === "pdf"/);
  assert.match(fileConverter, /\/api\/office-convert/);
  assert.match(localServer, /extname\(requestedPath\) === ""/);
  assert.match(localServer, /findAsset\("\/index\.html"\)/);
  await assert.rejects(
    access(new URL("src/features/tool-directory/ToolDirectory.tsx", root)),
  );
});

test("exposes only implemented image and PDF targets", async () => {
  const imageProcessor = await readFile(
    new URL("src/features/image-conversion/core/imageProcessor.ts", root),
    "utf8",
  );
  const imageConverter = await readFile(
    new URL("src/features/image-conversion/ui/ImageConverter.tsx", root),
    "utf8",
  );
  const categoryCatalog = await readFile(
    new URL("src/app/converterCatalog.ts", root),
    "utf8",
  );
  const pdfProcessor = await readFile(
    new URL("src/features/file-conversion/core/pdfProcessor.ts", root),
    "utf8",
  );

  for (const output of ["WEBP", "JPEG", "PNG", "AVIF", "HEIC", "BMP", "PDF"]) {
    assert.match(imageProcessor, new RegExp(`\\| "${output}"|= "${output}"`));
    assert.match(imageConverter, new RegExp(`value: "${output}"`));
  }
  for (const output of ["images", "pptx", "xlsx", "docx", "xps", "text"]) {
    assert.match(categoryCatalog, new RegExp(`value: "${output}"`));
    assert.match(pdfProcessor, new RegExp(`"${output}"`));
  }
  assert.match(imageProcessor, /encodeBmp/);
  assert.match(imageProcessor, /encodePdfPage/);
  assert.match(imageProcessor, /createQualityPreview/);
  assert.match(imageProcessor, /preferredQuality\?: number/);
  assert.match(imageConverter, /Adjust quality/);
  assert.match(imageConverter, /manualQuality/);
  assert.match(imageConverter, /Linked comparison view/);
  assert.match(imageConverter, /previewPan/);
  assert.match(imageConverter, /quality-comparison-zoom/);
  assert.match(pdfProcessor, /pagesToPptx/);
  assert.match(pdfProcessor, /pagesToDocx/);
  assert.match(pdfProcessor, /pagesToXlsx/);
  assert.match(pdfProcessor, /pagesToXps/);
});

test("isolates and bounds local document conversions", async () => {
  const officeConverter = await readFile(
    new URL("server/office-converter.mjs", root),
    "utf8",
  );
  assert.match(officeConverter, /maximumInputBytes = 100 \* 1_000_000/);
  assert.match(officeConverter, /maximumConcurrentConversions = 2/);
  assert.match(officeConverter, /mkdtemp\(join\(tmpdir\(\), "pixellock-office-"\)\)/);
  assert.match(officeConverter, /shell: false/);
  assert.match(officeConverter, /basename\(originalName\) !== originalName/);
  assert.match(officeConverter, /allowedOrigins/);
  assert.match(officeConverter, /"x-pixellock-request"/);
  assert.match(officeConverter, /child\.kill\("SIGKILL"\)/);
  assert.match(officeConverter, /await rm\(temporaryRoot/);
  assert.doesNotMatch(officeConverter, /exec\(|execFile\(|shell: true/);
});

test("isolates and bounds native HEIC conversions", async () => {
  const imageConverter = await readFile(
    new URL("server/image-converter.mjs", root),
    "utf8",
  );
  const localServer = await readFile(
    new URL("server/local-server.mjs", root),
    "utf8",
  );
  assert.match(imageConverter, /maximumInputBytes = 200 \* 1_000_000/);
  assert.match(imageConverter, /maximumConcurrentConversions = 2/);
  assert.match(imageConverter, /spawn\("\/usr\/bin\/sips"/);
  assert.match(imageConverter, /shell: false/);
  assert.match(imageConverter, /validSignature/);
  assert.match(imageConverter, /allowedOrigins/);
  assert.match(imageConverter, /preferredQuality/);
  assert.match(imageConverter, /Invalid preferred quality/);
  assert.match(imageConverter, /child\.kill\("SIGKILL"\)/);
  assert.match(imageConverter, /await rm\(temporaryRoot/);
  assert.doesNotMatch(
    imageConverter,
    /import[^\n]+\bexec(?:File)?\b|shell: true/,
  );
  assert.match(localServer, /\/api\/image-convert/);
});

test("keeps all application colors in complete light and dark themes", async () => {
  const theme = await readFile(new URL("src/styles/theme.css", root), "utf8");
  const globalStyles = await readFile(
    new URL("src/styles/global.css", root),
    "utf8",
  );
  const themeToggle = await readFile(
    new URL("src/components/ui/ThemeToggle.tsx", root),
    "utf8",
  );

  assert.match(theme, /:root\s*\{/);
  assert.match(theme, /:root\.dark\s*\{/);
  for (const token of [
    "background",
    "foreground",
    "card",
    "primary",
    "secondary",
    "muted",
    "accent",
    "destructive",
    "destructive-strong",
    "success",
    "border",
    "input",
    "ring",
  ]) {
    assert.equal(
      theme.match(new RegExp(`--${token}:`, "g"))?.length,
      2,
      `${token} must exist in both themes`,
    );
  }
  assert.doesNotMatch(globalStyles, /#[\da-f]{3,8}|rgba?\(|oklch\(/i);
  assert.match(themeToggle, /aria-label=\{isDark/);
  assert.match(themeToggle, /document\.documentElement\.classList\.toggle/);

  const contrastPairs = [
    ["foreground", "background"],
    ["card-foreground", "card"],
    ["muted-foreground", "background"],
    ["muted-foreground", "card"],
    ["primary-foreground", "primary"],
    ["secondary-foreground", "secondary"],
    ["destructive-foreground", "destructive-strong"],
    ["success-muted-foreground", "success-muted"],
  ];
  const themeBlocks = [
    ...theme.matchAll(/:root(\.dark)?\s*\{([^}]+)\}/g),
  ];
  assert.equal(themeBlocks.length, 2);

  const relativeLuminance = (color) => {
    const match = color.match(
      /oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)/,
    );
    assert.ok(match, `Expected an OKLCH color, received ${color}`);
    const lightness = Number(match[1]);
    const chroma = Number(match[2]);
    const hue = (Number(match[3]) * Math.PI) / 180;
    const a = chroma * Math.cos(hue);
    const b = chroma * Math.sin(hue);
    const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const clamp = (value) => Math.max(0, Math.min(1, value));
    const red = clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
    const green = clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
    const blue = clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };

  for (const block of themeBlocks) {
    const tokens = new Map(
      [...block[2].matchAll(/--([\w-]+):\s*(oklch\([^;]+\));/g)].map(
        (match) => [match[1], match[2]],
      ),
    );
    const themeName = block[1] ? "dark" : "light";
    for (const [foreground, background] of contrastPairs) {
      const foregroundValue = tokens.get(foreground);
      const backgroundValue = tokens.get(background);
      assert.ok(foregroundValue, `${themeName} ${foreground} is missing`);
      assert.ok(backgroundValue, `${themeName} ${background} is missing`);
      const foregroundLuminance = relativeLuminance(foregroundValue);
      const backgroundLuminance = relativeLuminance(backgroundValue);
      const ratio =
        (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
        (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
      assert.ok(
        ratio >= 4.5,
        `${themeName} ${foreground}/${background} contrast is ${ratio.toFixed(2)}:1`,
      );
    }
  }
});

test("enforces the local security policy", async () => {
  const { securityHeaders } = await import(
    new URL("config/security-headers.mjs", root)
  );
  const headers = securityHeaders();
  assert.match(headers["Content-Security-Policy"], /default-src 'self'/);
  assert.match(headers["Content-Security-Policy"], /object-src 'none'/);
  assert.match(headers["Content-Security-Policy"], /frame-ancestors 'none'/);
  assert.equal(headers["Cross-Origin-Opener-Policy"], "same-origin");
  assert.equal(headers["Cross-Origin-Embedder-Policy"], "require-corp");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["X-Frame-Options"], "DENY");
});

test("contains no legacy platform integration", async () => {
  const rootsToScan = [
    "src",
    "config",
    "server",
    "scripts",
    "tests",
  ];
  const files = ["package.json", "vite.config.ts", "README.md", "index.html"];

  const walk = async (directory) => {
    const entries = await readdir(new URL(`${directory}/`, root), {
      withFileTypes: true,
    });
    for (const entry of entries) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await walk(path);
      else files.push(path);
    }
  };
  await Promise.all(rootsToScan.map(walk));

  const blockedTerms = [
    [99, 104, 97, 116, 103, 112, 116],
    [111, 112, 101, 110, 97, 105],
    [99, 108, 111, 117, 100, 102, 108, 97, 114, 101],
    [119, 114, 97, 110, 103, 108, 101, 114],
    [118, 105, 110, 101, 120, 116],
    [99, 111, 100, 101, 120],
  ].map((points) => String.fromCodePoint(...points));
  const forbidden = new RegExp(blockedTerms.join("|"), "i");
  for (const path of files) {
    const contents = await readFile(new URL(path, root), "utf8");
    assert.doesNotMatch(contents, forbidden, path);
  }
});

test("keeps codec modules available across local rebuilds", async () => {
  const buildConfig = await readFile(new URL("vite.config.ts", root), "utf8");
  const buildScript = await readFile(new URL("scripts/build.mjs", root), "utf8");
  const localServer = await readFile(new URL("server/local-server.mjs", root), "utf8");
  const applicationEntry = await readFile(new URL("src/main.tsx", root), "utf8");

  assert.match(buildConfig, /chunkFileNames:\s*"assets\/\[name\]\.js"/);
  assert.match(buildScript, /dist\.staging/);
  assert.match(buildScript, /dist\.previous/);
  assert.match(localServer, /previousRoot/);
  assert.match(localServer, /stableModules/);
  assert.match(applicationEntry, /vite:preloadError/);
});

test("extracts text with the pinned local PDF engine", async () => {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = "BT /F1 18 Tf 72 720 Td (PixelLock PDF engine) Tj ET";
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);

  let source = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(source));
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(source);
  source += `xref\n0 ${objects.length + 1}\n`;
  source += "0000000000 65535 f \n";
  source += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  source += `startxref\n${xrefOffset}\n%%EOF\n`;

  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({
    data: new Uint8Array(Buffer.from(source, "ascii")),
    stopAtErrors: true,
    useSystemFonts: true,
  });
  try {
    const pdf = await task.promise;
    assert.equal(pdf.numPages, 1);
    const page = await pdf.getPage(1);
    const content = await page.getTextContent();
    const text = content.items
      .filter((item) => "str" in item)
      .map((item) => item.str)
      .join(" ");
    assert.match(text, /PixelLock PDF engine/);
  } finally {
    await task.destroy();
  }
});
