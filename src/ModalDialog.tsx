import { isImeEvent } from "./platform/ime";
import { useLayoutEffect, useRef, type ReactNode } from "react";

interface ModalBoundary {
  dialog: HTMLElement;
  previous: HTMLElement | null;
}
const stack: ModalBoundary[] = [];
const hidden = new Map<HTMLElement, { inert: boolean; aria: string | null }>();
const updateBackground = () => {
  for (const [el, { inert, aria }] of hidden) {
    if (!inert) el.removeAttribute("inert");
    if (aria === null) el.removeAttribute("aria-hidden");
    else el.setAttribute("aria-hidden", aria);
  }
  hidden.clear();
  const dialog = stack.at(-1)?.dialog;
  if (!dialog) return;
  let node: HTMLElement | null = dialog.closest(".modal-backdrop") ?? dialog;
  while (node?.parentElement) {
    for (const sibling of Array.from(node.parentElement.children)) {
      if (
        sibling === node ||
        !(sibling instanceof HTMLElement) ||
        /^(SCRIPT|STYLE)$/.test(sibling.tagName)
      )
        continue;
      hidden.set(sibling, {
        inert: sibling.hasAttribute("inert"),
        aria: sibling.getAttribute("aria-hidden"),
      });
      sibling.setAttribute("inert", "");
      sibling.setAttribute("aria-hidden", "true");
    }
    if (node.parentElement === document.body) break;
    node = node.parentElement;
  }
};
const focusable = (root: HTMLElement) =>
  Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]),input:not([disabled]):not([type="hidden"]),textarea:not([disabled]),select:not([disabled]),a[href],[tabindex]:not([tabindex="-1"]),summary',
    ),
  ).filter((el) => {
    if (el.matches(":disabled") || el.closest("[hidden],[inert]")) return false;
    const collapsed = el.closest("details:not([open])");
    if (collapsed && !el.matches("summary") && !el.closest("summary"))
      return false;
    return (
      getComputedStyle(el).display !== "none" &&
      getComputedStyle(el).visibility !== "hidden"
    );
  });

/** A shared modal boundary: keyboard stays inside, and closing restores its trigger. */
export default function ModalDialog({
  label,
  onClose,
  busy = false,
  className = "",
  backdropClassName = "",
  children,
}: {
  label: string;
  onClose: () => void;
  busy?: boolean;
  className?: string;
  backdropClassName?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const entryFocus = useRef<HTMLElement | null>(null);
  const current = useRef({ onClose, busy });
  current.current = { onClose, busy };
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const boundary = {
      dialog,
      previous:
        entryFocus.current ??
        (document.activeElement instanceof HTMLElement &&
        !dialog.contains(document.activeElement)
          ? document.activeElement
          : null),
    };
    stack.push(boundary);
    updateBackground();
    if (!dialog.contains(document.activeElement)) {
      const items = focusable(dialog);
      (
        items.find((item) => item.hasAttribute("data-autofocus")) ??
        items[0] ??
        dialog
      ).focus();
    }
    const handle = (event: KeyboardEvent) => {
      if (stack.at(-1) !== boundary || isImeEvent(event)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!current.current.busy) current.current.onClose();
      } else if (event.key === "Tab") {
        const items = focusable(dialog);
        const first = items[0] ?? dialog,
          last = items.at(-1) ?? dialog;
        if (
          !dialog.contains(document.activeElement) ||
          !items.includes(document.activeElement as HTMLElement) ||
          (event.shiftKey
            ? document.activeElement === first
            : document.activeElement === last)
        ) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }
    };
    document.addEventListener("keydown", handle, true);
    return () => {
      document.removeEventListener("keydown", handle, true);
      const wasTop = stack.at(-1) === boundary;
      const index = stack.indexOf(boundary);
      if (index >= 0) stack.splice(index, 1);
      // A lower dialog may finish while a newer one is still open.
      for (const other of stack)
        if (other.previous && dialog.contains(other.previous))
          other.previous = boundary.previous;
      updateBackground();
      if (!wasTop) return;
      const previous = boundary.previous;
      const remaining = stack.at(-1)?.dialog;
      if (
        previous?.isConnected &&
        !previous.closest("[inert]") &&
        (!remaining || remaining.contains(previous))
      )
        previous.focus();
      else if (remaining) (focusable(remaining)[0] ?? remaining).focus();
    };
  }, []);
  return (
    <div
      className={`modal-backdrop ${backdropClassName}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        ref={ref}
        className={`modal ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-busy={busy || undefined}
        tabIndex={-1}
        onFocusCapture={(event) => {
          // Child autoFocus commits before this parent's layout effect. Capture
          // the outside trigger as focus enters, instead of remembering the input.
          if (
            !entryFocus.current &&
            event.relatedTarget instanceof HTMLElement &&
            !event.currentTarget.contains(event.relatedTarget)
          )
            entryFocus.current = event.relatedTarget;
        }}
      >
        {children}
      </section>
    </div>
  );
}
