import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import "./workspace-rail.css";

const HOVER_DELAY = 330;

function railButton(target: EventTarget | null) {
  return target instanceof Element
    ? target.closest<HTMLButtonElement>("button[aria-label]")
    : null;
}

function RailHint({ anchor }: { anchor: HTMLButtonElement }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const hint = ref.current;
    if (!hint) return;
    const box = anchor.getBoundingClientRect();
    const left = Math.max(
      6,
      Math.min(window.innerWidth - hint.offsetWidth - 6, box.right + 9),
    );
    const top = Math.max(
      6,
      Math.min(
        window.innerHeight - hint.offsetHeight - 6,
        box.top + (box.height - hint.offsetHeight) / 2,
      ),
    );
    hint.style.left = left + "px";
    hint.style.top = top + "px";
  });
  // aria-label already names the button. Repeating it via aria-describedby
  // would announce the identical name twice to a screen reader.
  return createPortal(
    <div className="workspace-rail-hint" role="tooltip" ref={ref}>
      {anchor.getAttribute("aria-label")}
    </div>,
    document.body,
  );
}

export default function WorkspaceRail({
  children,
  location,
}: {
  children: ReactNode;
  location: string;
}) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dismiss = useCallback(() => {
    clearTimeout(timer.current);
    setAnchor(null);
  }, []);
  useLayoutEffect(() => {
    dismiss();
    return () => clearTimeout(timer.current);
  }, [location, dismiss]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", escape, true);
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      document.removeEventListener("keydown", escape, true);
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  }, [dismiss]);
  return (
    <div
      className="workspace-rail"
      onPointerOver={(e) => {
        const button = railButton(e.target);
        if (
          !button ||
          button === railButton(e.relatedTarget) ||
          e.pointerType === "touch"
        )
          return;
        dismiss();
        timer.current = setTimeout(() => {
          if (button.isConnected) setAnchor(button);
        }, HOVER_DELAY);
      }}
      onPointerOut={(e) => {
        if (railButton(e.target) !== railButton(e.relatedTarget)) dismiss();
      }}
      onPointerLeave={dismiss}
      onFocus={(e) => {
        const button = railButton(e.target);
        if (button?.matches(":focus-visible")) {
          dismiss();
          setAnchor(button);
        }
      }}
      onBlur={dismiss}
      onClickCapture={dismiss}
    >
      {children}
      {anchor && <RailHint anchor={anchor} />}
    </div>
  );
}
