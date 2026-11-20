import type {
  CompositionEvent,
  KeyboardEvent as ReactKeyEvent,
  FormEvent,
  FocusEvent,
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
// A final WebKit keydown can arrive after compositionend and a paint with
// neither the composing flag nor 229. Keyup marks the next physical press.
const endingTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();
function clearComposition(target: HTMLElement) {
  clearTimeout(endingTimers.get(target));
  endingTimers.delete(target);
  delete target.dataset.imeComposing;
}
function markEnding(target: HTMLElement) {
  clearComposition(target);
  target.dataset.imeComposing = "ending";
  // Pointer-selected candidates and some IMEs deliver no final keyup.
  endingTimers.set(target, setTimeout(() => clearComposition(target), 80));
}
export const imeBoundary = {
  onCompositionStartCapture(event: CompositionEvent<HTMLElement>) {
    if (event.target instanceof HTMLElement) {
      clearComposition(event.target);
      event.target.dataset.imeComposing = "true";
    }
  },
  onCompositionEndCapture(event: CompositionEvent<HTMLElement>) {
    if (event.target instanceof HTMLElement) markEnding(event.target);
  },
  onKeyDownCapture(event: ReactKeyEvent<HTMLElement>) {
    const target = event.target;
    if (
      !(target instanceof HTMLElement) ||
      target.dataset.imeComposing === "true"
    )
      return;
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
      markEnding(target);
    }
  },
  onKeyUpCapture(event: ReactKeyEvent<HTMLElement>) {
    const target = event.target;
    if (target instanceof HTMLElement && target.dataset.imeComposing === "ending")
      clearComposition(target);
  },
  onBlurCapture(event: FocusEvent<HTMLElement>) {
    if (event.target instanceof HTMLElement) clearComposition(event.target);
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
