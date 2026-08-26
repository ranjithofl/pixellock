# PixelLock

PixelLock is a standalone, local image converter. Files are decoded, optimized,
and written entirely on the current computer. The application has no accounts,
analytics, database, remote API, upload service, or external runtime.

The home page is the complete Image Converter workspace, with JPEG, PNG, WebP,
AVIF, HEIC, BMP, and PDF outputs selected from one settings dropdown. Image,
PDF, Document, Excel, Presentation, and GIF tools are available from the
**All converters** header menu. The same menu includes Compress PDF, Organize
PDF, and Split PDF.

PDF rendering and text extraction run locally through PDF.js. PDF page exports
produce valid PPTX, DOCX, XLSX, and XPS packages with a high-resolution visual
page in each destination page, slide, or sheet. These visual exports preserve
appearance rather than editable document semantics. Document, spreadsheet, and
presentation conversions run through a locally installed LibreOffice engine
using isolated temporary profiles.

## Requirements

- Node.js 22.13 or newer
- Chrome or Edge for direct Input/Output folder access
- LibreOffice for Document, Excel, and Presentation conversions
- macOS for HEIC output; HEIC input decoding works in supported browsers on all
  operating systems

## Run the application

```bash
npm ci --ignore-scripts
npm run app
```

Then open `http://localhost:3000`. The server binds only to `127.0.0.1`, so it
is not exposed to other devices on the network.

On macOS, `Start PixelLock.command` performs the same setup and starts the app.

## Project structure

- `src/app/` — application composition
- `src/app/converterCatalog.ts` — category hierarchy and availability
- `src/app/toolCatalog.ts` — operational image-tool definitions and routes
- `src/components/layout/` — shared application shell and header
- `src/components/ui/` — dependency-free shadcn-style UI primitives
- `src/features/image-conversion/core/` — validation and codec pipeline
- `src/features/image-conversion/platform/` — local file-system integration
- `src/features/image-conversion/ui/` — conversion interface and state
- `src/features/file-conversion/` — PDF and Office converter interfaces
- `src/features/gif-compression/` — bounded animated-GIF decoder and encoder
- `src/features/pdf-tools/` — PDF compression, page organization, and splitting
- `src/features/tool-directory/` — not-found page
- `src/styles/` — application styles
- `src/styles/theme.css` — validated light/dark semantic color tokens
- `config/` — shared security-header policy
- `scripts/` — staged production build and safe bundle rotation
- `server/` — minimal local static server
- `tests/` — architecture and security regression checks

## Security model

- Localhost-only network binding and strict host validation
- Content Security Policy, cross-origin isolation, anti-framing, MIME-sniffing
  protection, no-referrer policy, and restricted browser permissions
- Exact extension and magic-byte validation before image decoding
- 200 MB compressed-file limit, 40 megapixel decoded-image limit, 32-level
  directory-depth limit, and 2,000-file batch limit
- Safe output-name normalization and path-segment checks
- Re-encoding of every successful output to strip source metadata and embedded
  ancillary payloads
- Bounded codec caches that are released after every file
- Office conversion subprocesses run without a shell, with strict format
  allowlists, 100 MB inputs, two-job concurrency, 90-second timeouts, isolated
  profiles, and automatic temporary-file cleanup
- Native HEIC conversion uses the fixed macOS encoder path, no shell, strict
  origin/header checks, signature validation, concurrency and time limits, and
  isolated temporary files
- PDF and GIF tools enforce file, page, frame, dimension, and total-pixel limits
- Staged builds with one prior codec bundle retained for interruption-free updates
- No telemetry, cookies, browser storage, user identity, or network upload code

## Commands

- `npm run dev` — local development server
- `npm run build` — type-check and create the production bundle
- `npm run start` — serve an existing production bundle on localhost
- `npm run app` — build and start the standalone application
- `npm run lint` — static quality and unsafe-pattern checks
- `npm test` — production build plus security regression tests
- `npm run audit:security` — production dependency vulnerability audit
