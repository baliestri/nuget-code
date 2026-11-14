import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface DropdownOption {
  value: string;
  /** What the list shows. */
  label: string;
  /** What the closed control shows when this is the choice; the label when absent. */
  short?: string;
  icon?: ReactNode;
  disabled?: boolean;
  /** Shown as the option's tooltip. */
  title?: string;
}

interface DropdownProps {
  /** The accessible name. */
  label: string;
  value: string;
  options: readonly DropdownOption[];
  onChange(value: string): void;
  className?: string;
}

/** A list of choices that opens under its control, drawn by the view so that each choice can carry an icon. */
export function Dropdown({ label, value, options, onChange, className = "" }: DropdownProps): ReactNode {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const current = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const close = (event: PointerEvent): void => {
      if (root.current !== null && !root.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const show = (): void => {
    setActive(options.findIndex((option) => option.value === value));
    setOpen(true);
  };
  const choose = (option: DropdownOption | undefined): void => {
    if (option !== undefined && option.disabled !== true) {
      setOpen(false);
      onChange(option.value);
    }
  };
  // The next choice that can be taken, in the direction given; the same one when there is no other.
  const step = (direction: 1 | -1): void => {
    for (let offset = 1; offset <= options.length; offset++) {
      const index = (active + direction * offset + options.length * offset) % options.length;
      if (options[index]?.disabled !== true) {
        setActive(index);
        return;
      }
    }
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (open) {
        step(event.key === "ArrowDown" ? 1 : -1);
      } else {
        show();
      }
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    } else if ((event.key === "Enter" || event.key === " ") && open) {
      event.preventDefault();
      choose(options[active]);
    }
  };

  return (
    <div ref={root} className={`relative min-w-0 ${className}`}>
      <button
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
        title={label}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
        className="hover:bg-toolbar-hover flex w-full min-w-0 items-center gap-1 rounded px-1 py-0.5"
      >
        {current?.icon}
        <span className="min-w-0 truncate">{current?.short ?? current?.label}</span>
        <i className="codicon codicon-chevron-down shrink-0" aria-hidden="true" />
      </button>
      <ul
        id={id}
        role="listbox"
        aria-label={label}
        hidden={!open}
        className="border-input-border bg-input text-input-fg absolute top-full right-0 z-20 mt-1 max-h-64 min-w-full overflow-y-auto rounded border py-1 whitespace-nowrap shadow-lg"
      >
        {options.map((option, index) => (
          <li
            key={option.value}
            id={`${id}-${index}`}
            role="option"
            aria-selected={option.value === value}
            aria-disabled={option.disabled === true}
            title={option.title}
            onPointerEnter={() => setActive(index)}
            onClick={() => choose(option)}
            className={`flex items-center gap-1.5 px-2 py-0.5 ${option.disabled === true ? "opacity-50" : "cursor-pointer"} ${index === active ? "bg-selection text-selection-fg" : ""}`}
          >
            {option.icon}
            {option.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
