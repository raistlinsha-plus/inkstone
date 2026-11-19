import { useLayoutEffect, useRef, useState } from "react";

const minWidth = 300;
const maxWidth = 640;

export default function KnowledgePanelResizer({
  preferredWidth,
  onResize,
}: {
  preferredWidth: number;
  onResize: (width: number) => void;
}) {
  const handle = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [bounds, setBounds] = useState({ width: preferredWidth, max: maxWidth });

  useLayoutEffect(() => {
    const pane = handle.current?.parentElement;
    const documentArea = pane?.previousElementSibling;
    if (!pane || !documentArea) return;
    const measure = () => {
      const width = Math.round(pane.getBoundingClientRect().width);
      const documentWidth = documentArea.getBoundingClientRect().width;
      if (!width || !documentWidth) return;
      const reserved = parseFloat(getComputedStyle(documentArea).minWidth) || 0;
      const max = Math.min(maxWidth, Math.round(width + documentWidth - reserved));
      setBounds((old) =>
        old.width === width && old.max === max ? old : { width, max },
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(pane);
    observer.observe(documentArea);
    return () => observer.disconnect();
  }, []);

  const resize = (width: number) =>
    onResize(Math.min(bounds.max, Math.max(minWidth, width)));
  return (
    <div
      ref={handle}
      className="panel-resize"
      role="separator"
      aria-label="知识侧栏宽度"
      aria-orientation="vertical"
      aria-valuemin={minWidth}
      aria-valuemax={bounds.max}
      aria-valuenow={bounds.width}
      tabIndex={0}
      onKeyDown={(event) => {
        const widths: Record<string, number> = {
          Home: minWidth,
          End: bounds.max,
          ArrowLeft: bounds.width + 20,
          ArrowRight: bounds.width - 20,
        };
        if (!Object.hasOwn(widths, event.key)) return;
        event.preventDefault();
        resize(widths[event.key]);
      }}
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        drag.current = { x: event.clientX, width: bounds.width };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (drag.current && event.currentTarget.hasPointerCapture(event.pointerId))
          resize(drag.current.width + drag.current.x - event.clientX);
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
    />
  );
}
