import type { SelectHTMLAttributes } from "react";
import { ChevronDownIcon } from "./Icons";
import { classNames } from "./classNames";

type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export function Select({ className, children, ...props }: SelectProps) {
  return (
    <span className="ui-select">
      <select className={classNames("ui-select-input", className)} {...props}>
        {children}
      </select>
      <ChevronDownIcon className="ui-select-icon" />
    </span>
  );
}
