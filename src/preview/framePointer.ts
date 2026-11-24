// Pointer events inside a sandboxed preview do not reliably update :hover on
// its parent. Report transitions only, even when the renderer redraws under the mouse.
export function trackFramePointer(onChange: (inside: boolean) => void) {
  let inside = false;
  const update = (value: boolean) => {
    if (inside === value) return;
    inside = value;
    onChange(value);
  };
  const enter = (event: PointerEvent) => {
    if (event.pointerType !== "touch") update(true);
  };
  const root = document.documentElement;
  root.addEventListener("pointerover", enter);
  root.addEventListener("pointermove", enter, { passive: true });
  root.addEventListener("pointerleave", () => update(false));
  return {
    get inside() {
      return inside;
    },
    reset() {
      inside = false;
    },
  };
}
