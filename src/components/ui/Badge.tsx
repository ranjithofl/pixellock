import type { HTMLAttributes } from "react";
import { classNames } from "./classNames";

type BadgeVariant = "default" | "secondary" | "outline" | "success" | "destructive";

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
};

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={classNames("ui-badge", `ui-badge-${variant}`, className)}
      {...props}
    />
  );
}
