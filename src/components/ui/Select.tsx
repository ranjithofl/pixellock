import {
  Children,
  isValidElement,
  type KeyboardEvent,
  type OptionHTMLAttributes,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { CheckIcon, ChevronDownIcon } from "./Icons";
import { classNames } from "./classNames";

type SelectProps = {
  "aria-label"?: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  id?: string;
  onValueChange: (value: string) => void;
  value: string;
};

type SelectOption = {
  disabled: boolean;
  label: ReactNode;
  searchLabel: string;
  value: string;
};

export function Select({
  "aria-label": ariaLabel,
  children,
  className,
  disabled = false,
  id,
  onValueChange,
  value,
}: SelectProps) {
  const generatedId = useId();
  const listboxId = `${id || generatedId}-listbox`;
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const typeaheadRef = useRef({ text: "", timer: 0 });

  const options = useMemo<SelectOption[]>(
    () =>
      Children.toArray(children).flatMap((child) => {
        if (!isValidElement<OptionHTMLAttributes<HTMLOptionElement>>(child)) {
          return [];
        }
        return [{
          disabled: Boolean(child.props.disabled),
          label: child.props.children,
          searchLabel: String(child.props.children ?? "").toLocaleLowerCase(),
          value: String(child.props.value ?? ""),
        }];
      }),
    [children],
  );

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selectedOption = options[selectedIndex];

  const enabledIndex = (start: number, direction: 1 | -1) => {
    if (!options.length) return -1;
    for (let offset = 0; offset < options.length; offset += 1) {
      const index = (start + direction * offset + options.length) % options.length;
      if (!options[index].disabled) return index;
    }
    return -1;
  };

  const openMenu = (preferredIndex = selectedIndex) => {
    if (disabled) return;
    const nextIndex = preferredIndex >= 0 && !options[preferredIndex]?.disabled
      ? preferredIndex
      : enabledIndex(0, 1);
    setActiveIndex(nextIndex);
    setIsOpen(true);
  };

  const closeMenu = (restoreFocus = false) => {
    setIsOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  const chooseOption = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onValueChange(option.value);
    closeMenu(true);
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleOutsidePointer = (event: globalThis.PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closeMenu();
    };
    document.addEventListener("pointerdown", handleOutsidePointer);
    return () => document.removeEventListener("pointerdown", handleOutsidePointer);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || activeIndex < 0) return;
    document.getElementById(`${listboxId}-option-${activeIndex}`)?.scrollIntoView({
      block: "nearest",
    });
  }, [activeIndex, isOpen, listboxId]);

  useEffect(
    () => () => window.clearTimeout(typeaheadRef.current.timer),
    [],
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;

    if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      closeMenu();
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (isOpen && activeIndex >= 0) chooseOption(activeIndex);
      else openMenu();
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      if (!isOpen) {
        const start = selectedIndex >= 0 ? selectedIndex + direction : direction > 0 ? 0 : options.length - 1;
        openMenu(enabledIndex(start, direction));
      } else {
        setActiveIndex((current) => enabledIndex(current + direction, direction));
      }
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const direction = event.key === "Home" ? 1 : -1;
      const index = enabledIndex(event.key === "Home" ? 0 : options.length - 1, direction);
      if (!isOpen) openMenu(index);
      else setActiveIndex(index);
      return;
    }

    if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      window.clearTimeout(typeaheadRef.current.timer);
      typeaheadRef.current.text += event.key.toLocaleLowerCase();
      typeaheadRef.current.timer = window.setTimeout(() => {
        typeaheadRef.current.text = "";
      }, 600);
      const matchIndex = options.findIndex(
        (option) => !option.disabled && option.searchLabel.startsWith(typeaheadRef.current.text),
      );
      if (matchIndex >= 0) {
        event.preventDefault();
        if (!isOpen) openMenu(matchIndex);
        else setActiveIndex(matchIndex);
      }
    }
  };

  return (
    <span ref={rootRef} className="ui-select">
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={classNames("ui-select-trigger", className)}
        role="combobox"
        aria-label={ariaLabel}
        aria-controls={listboxId}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-activedescendant={isOpen && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
        disabled={disabled}
        onClick={() => (isOpen ? closeMenu() : openMenu())}
        onKeyDown={handleKeyDown}
      >
        <span className={selectedOption ? "" : "ui-select-placeholder"}>
          {selectedOption?.label ?? "Select an option"}
        </span>
        <ChevronDownIcon className="ui-select-icon" />
      </button>

      {isOpen && (
        <div id={listboxId} className="ui-select-content" role="listbox" aria-label={ariaLabel}>
          <div className="ui-select-viewport">
            {options.map((option, index) => (
              <button
                id={`${listboxId}-option-${index}`}
                type="button"
                className={classNames(
                  "ui-select-item",
                  index === activeIndex && "active",
                  option.value === value && "selected",
                )}
                role="option"
                aria-selected={option.value === value}
                disabled={option.disabled}
                onClick={() => chooseOption(index)}
                onPointerMove={() => {
                  if (!option.disabled) setActiveIndex(index);
                }}
                key={option.value}
              >
                <span>{option.label}</span>
                {option.value === value && <CheckIcon className="ui-select-check" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </span>
  );
}
