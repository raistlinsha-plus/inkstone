import { useLayoutEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import ModalDialog from "../ModalDialog";
import { isImeEvent } from "../platform/ime";

export default function SourcePreviewFrame({
  children,
  label,
  title,
  className,
  inline,
  busy,
  controls,
  onClose,
}: {
  children: ReactNode;
  label: string;
  title: string;
  className: string;
  inline: boolean;
  busy: boolean;
  controls: ReactNode;
  onClose: () => void;
}) {
  const close = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (inline) close.current?.focus({ preventScroll: true });
  }, [inline]);

  const content = (
    <>
      {controls}
      <div className="modal-heading">
        <h2>{title}</h2>
        {!inline && (
          <button
            type="button"
            className="icon-button"
            aria-label="关闭来源预览"
            disabled={busy}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        )}
      </div>
      {children}
    </>
  );
  if (!inline)
    return (
      <ModalDialog
        label={label}
        className={className}
        backdropClassName="assistant-source-backdrop"
        busy={busy}
        onClose={onClose}
      >
        {content}
      </ModalDialog>
    );
  return (
    <aside
      aria-label={label}
      aria-busy={busy || undefined}
      className="workbench-citation-pane"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !isImeEvent(event.nativeEvent)) {
          event.preventDefault();
          event.stopPropagation();
          if (!busy) onClose();
        }
      }}
    >
      <header>
        <strong>回答引用</strong>
        <button
          ref={close}
          type="button"
          className="icon-button"
          aria-label="收起引用侧栏"
          aria-disabled={busy}
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </header>
      <div className="workbench-citation-content">{content}</div>
    </aside>
  );
}
