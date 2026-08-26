import { converterCategories } from "../../app/converterCatalog";
import { ChevronDownIcon, ToolIcon, type ToolIconKind } from "../ui/Icons";
import { ThemeToggle } from "../ui";

const converterDetails = {
  image: { icon: "image", note: "Photos and graphics" },
  pdf: { icon: "pdf", note: "PDF to editable formats" },
  document: { icon: "document", note: "Word and text files" },
  excel: { icon: "excel", note: "Sheets and CSV files" },
  presentation: { icon: "presentation", note: "Slides and decks" },
} satisfies Record<string, { icon: ToolIconKind; note: string }>;

function MenuLinkContent({ icon, label, note }: { icon: ToolIconKind; label: string; note: string }) {
  return (
    <>
      <span className="menu-item-main">
        <span className="menu-item-icon"><ToolIcon kind={icon} /></span>
        <span className="menu-item-copy"><strong>{label}</strong><small>{note}</small></span>
      </span>
      <span className="menu-arrow" aria-hidden="true">→</span>
    </>
  );
}

export function SiteHeader() {
  const pathname = window.location.pathname;

  return (
    <header className="site-header">
      <a className="brand" href="/" aria-label="PixelLock Image Converter home">
        <span className="brand-mark" aria-hidden="true">
          PL
        </span>
        <span>PixelLock</span>
      </a>
      <div className="header-actions">
        <details className="converter-menu">
          <summary>
            All converters
            <span className="menu-chevron"><ChevronDownIcon /></span>
          </summary>
          <nav aria-label="All converters">
            <span className="menu-label">Converters</span>
            {converterCategories.map((category) => {
              const href = category.id === "image" ? "/" : category.path;
              const detail = converterDetails[category.id];
              const isCurrent = category.id === "image"
                ? pathname === "/" || pathname === category.path
                : pathname === category.path;
              return <a href={href} aria-current={isCurrent ? "page" : undefined} key={category.id}><MenuLinkContent icon={detail.icon} label={category.title} note={detail.note} /></a>;
            })}
            <a href="/tools/gif-compressor" aria-current={pathname === "/tools/gif-compressor" ? "page" : undefined}><MenuLinkContent icon="gif" label="GIF Compressor" note="Reduce animated GIF size" /></a>
            <span className="menu-label">PDF tools</span>
            <a href="/pdf-tools/compress" aria-current={pathname === "/pdf-tools/compress" ? "page" : undefined}><MenuLinkContent icon="compress" label="Compress PDF" note="Reduce PDF file size" /></a>
            <a href="/pdf-tools/organize" aria-current={pathname === "/pdf-tools/organize" ? "page" : undefined}><MenuLinkContent icon="organize" label="Organize PDF" note="Reorder and rotate pages" /></a>
            <a href="/pdf-tools/split" aria-current={pathname === "/pdf-tools/split" ? "page" : undefined}><MenuLinkContent icon="split" label="Split PDF" note="Separate pages into files" /></a>
          </nav>
        </details>
        <ThemeToggle />
      </div>
    </header>
  );
}
