import type { ReactNode } from "react";

type IconProps = {
  className?: string;
};

export type ToolIconKind =
  | "image"
  | "pdf"
  | "document"
  | "excel"
  | "presentation"
  | "gif"
  | "compress"
  | "organize"
  | "split";

export function UploadIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
    </svg>
  );
}

export function ChevronDownIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m7 9.5 5 5 5-5" />
    </svg>
  );
}

export function ToolIcon({ className, kind }: IconProps & { kind: ToolIconKind }) {
  const paths: Record<ToolIconKind, ReactNode> = {
    image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9" r="1.5" /><path d="m5 17 4.5-4.5 3.5 3 2.5-2.5 3.5 4" /></>,
    pdf: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>,
    document: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 12h6M9 16h6" /></>,
    excel: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 4v16M15 10v10M9 15h12" /></>,
    presentation: <><rect x="4" y="4" width="16" height="12" rx="2" /><path d="M12 16v5M8 21h8M8 12l3-3 2 2 3-3" /></>,
    gif: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M8 5v14M16 5v14M3 10h5M16 14h5" /></>,
    compress: <><path d="M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5" /><path d="m3 8 5-5m13 5-5-5M3 16l5 5m13-5-5 5" /></>,
    organize: <><path d="M4 7h8M16 7h4M4 12h3M11 12h9M4 17h10M18 17h2" /><circle cx="14" cy="7" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="16" cy="17" r="2" /></>,
    split: <><path d="M5 4h6v6H5zM13 14h6v6h-6zM15 4h4v4M5 16v4h4" /><path d="m11 7 4 5M9 17l4-5" /></>,
  };

  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {paths[kind]}
    </svg>
  );
}
