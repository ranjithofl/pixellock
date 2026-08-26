import type { ProgressHTMLAttributes } from "react";
import { classNames } from "./classNames";

export function Progress({ className, ...props }: ProgressHTMLAttributes<HTMLProgressElement>) {
  return <progress className={classNames("ui-progress", className)} {...props} />;
}
