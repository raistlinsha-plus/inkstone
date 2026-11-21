// Observe the original event without cancelling it or taking focus from its target.
export function dismissOnOutside(
  inside: (event: Event) => boolean,
  dismiss: () => void,
) {
  const check = (event: Event) => {
    if (!inside(event)) dismiss();
  };
  // Assistive technology may emit a click without a preceding pointer event.
  const events = ["pointerdown", "focusin", "click"] as const;
  for (const type of events) document.addEventListener(type, check, true);
  return () => {
    for (const type of events) document.removeEventListener(type, check, true);
  };
}

// React ref callback shared by disclosure-style command panels.
export function dismissDetailsOnOutside(details: HTMLDetailsElement | null) {
  if (!details) return;
  return dismissOnOutside(
    (event) => event.composedPath().includes(details),
    () => {
      if (details.open) details.open = false;
    },
  );
}

export function focusMenuButton(container: HTMLElement, key: string) {
  const buttons = Array.from(
    container.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
  );
  if (!buttons.length) return;
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const last = buttons.length - 1;
  let next: number;
  switch (key) {
    case "ArrowUp":
      next = index <= 0 ? last : index - 1;
      break;
    case "ArrowDown":
      next = (index + 1) % buttons.length;
      break;
    case "End":
      next = last;
      break;
    default:
      next = 0;
  }
  buttons[next].focus({ preventScroll: true });
}
