import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export type MenuEntry<A> =
  | { kind: "separator" }
  | {
      kind: "item";
      label: string;
      /** A codicon name, without the `codicon-` prefix. */
      icon?: string;
      /** The keys that do the same without the menu, as text. */
      shortcut?: string;
      disabled?: boolean;
      action: A;
    };

interface MenuProps<A> {
  /** The accessible name. */
  label: string;
  entries: readonly MenuEntry<A>[];
  /** Where the menu opens, in the coordinates of the window. It is moved to stay inside the window. */
  at: { x: number; y: number };
  onAction(action: A): void;
  onClose(): void;
}

/** A context menu drawn by the view, with the look of the editor's own menus. */
export function Menu<A>({ label, entries, at, onAction, onClose }: MenuProps<A>): ReactNode {
  const root = useRef<HTMLUListElement>(null);
  const items = entries.flatMap((entry, index) => (entry.kind === "item" && entry.disabled !== true ? [index] : []));
  const [active, setActive] = useState(items[0] ?? -1);
  const [position, setPosition] = useState(at);

  // Keyboard input goes to the menu while it is open, and returns to where it was when it closes.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    root.current?.focus();
    return () => before?.focus?.();
  }, []);

  // Once it is laid out its size is known: it is pulled back inside the window when it would leave it.
  useLayoutEffect(() => {
    const box = root.current?.getBoundingClientRect();
    if (box === undefined) {
      return;
    }

    const x = Math.max(0, Math.min(at.x, window.innerWidth - box.width - 4));
    const y = Math.max(0, Math.min(at.y, window.innerHeight - box.height - 4));
    setPosition((current) => (current.x === x && current.y === y ? current : { x, y }));
  }, [at]);

  useEffect(() => {
    const outside = (event: Event): void => {
      if (root.current !== null && !root.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const choose = (index: number): void => {
    const entry = entries[index];
    if (entry?.kind === "item" && entry.disabled !== true) {
      onClose();
      onAction(entry.action);
    }
  };
  const move = (step: 1 | -1): void => {
    if (items.length > 0) {
      const next = (items.indexOf(active) + step + items.length) % items.length;
      setActive(items[next]!);
    }
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    const handled: Record<string, () => void> = {
      ArrowDown: () => move(1),
      ArrowUp: () => move(-1),
      Home: () => setActive(items[0] ?? -1),
      End: () => setActive(items.at(-1) ?? -1),
      Enter: () => choose(active),
      " ": () => choose(active),
      Escape: onClose,
      Tab: onClose
    };
    const handler = handled[event.key];
    if (handler !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      handler();
    }
  };

  return (
    <ul
      ref={root}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
      style={{ left: position.x, top: position.y }}
      className="border-menu-border bg-menu text-menu-fg fixed z-40 max-w-[90vw] min-w-48 rounded-md border py-1 shadow-lg outline-none"
    >
      {entries.map((entry, index) =>
        entry.kind === "separator" ? (
          // A separator has no content of its own; its place in the list is what identifies it.
          <li key={index} role="separator" className="bg-menu-separator mx-2 my-1 h-px" />
        ) : (
          <li
            key={entry.label}
            role="menuitem"
            aria-disabled={entry.disabled === true}
            aria-keyshortcuts={entry.shortcut?.replaceAll("Ctrl", "Control")}
            onPointerEnter={() => entry.disabled !== true && setActive(index)}
            onClick={() => choose(index)}
            className={`mx-1 flex items-center gap-2 rounded px-2 py-0.5 ${
              entry.disabled === true
                ? "opacity-50"
                : index === active
                  ? "bg-menu-selection text-menu-selection-fg cursor-pointer"
                  : "cursor-pointer"
            }`}
          >
            <i
              className={`w-4 shrink-0 ${entry.icon === undefined ? "" : `codicon codicon-${entry.icon}`}`}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate">{entry.label}</span>
            {entry.shortcut === undefined ? null : (
              // Announced through aria-keyshortcuts, so it is not read again as part of the name.
              <span aria-hidden="true" className="shrink-0 pl-6 opacity-70">
                {entry.shortcut}
              </span>
            )}
          </li>
        )
      )}
    </ul>
  );
}
