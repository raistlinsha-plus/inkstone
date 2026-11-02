import type {
  CompositionEvent,
  KeyboardEvent as ReactKeyEvent,
  FormEvent,
} from "react";
/** WebKit's final candidate-confirmation key can have isComposing=false and keyCode=229. */
export function isImeEvent(event: {
  isComposing?: boolean;
  keyCode?: number;
  target?: EventTarget | null;
}) {
  return (
    !!event.isComposing ||
    event.keyCode === 229 ||
    (typeof Element !== "undefined" &&
      event.target instanceof Element &&
      !!event.target.closest("[data-ime-composing]"))
  );
}
function release(target: HTMLElement) {
  requestAnimationFrame(() => {
    if (target.dataset.imeComposing === "ending")
      delete target.dataset.imeComposing;
  });
}
export const imeBoundary = {
  onCompositionStartCapture(event: CompositionEvent<HTMLElement>) {
    if (event.target instanceof HTMLElement)
      event.target.dataset.imeComposing = "true";
  },
  onCompositionEndCapture(event: CompositionEvent<HTMLElement>) {
    if (event.target instanceof HTMLElement) {
      const target = event.target;
      target.dataset.imeComposing = "ending";
      release(target);
    }
  },
  onKeyDownCapture(event: ReactKeyEvent<HTMLElement>) {
    const target = event.target;
    if (
      !(target instanceof HTMLElement) ||
      target.dataset.imeComposing === "true"
    )
      return;
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
      target.dataset.imeComposing = "ending";
      release(target);
    }
  },
  onSubmitCapture(event: FormEvent<HTMLElement>) {
    // Let the OS commit its candidate; suppress only the resulting implicit form submission.
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.dataset.imeComposing) {
      event.preventDefault();
      event.stopPropagation();
    }
  },
};
