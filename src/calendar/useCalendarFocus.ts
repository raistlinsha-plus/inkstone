import { useEffect, useRef } from "react";

export function useCalendarFocus() {
  const scope = useRef<HTMLElement>(null);
  const origin = useRef<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancel, []);
  const remember = () => {
    cancel();
    const active = document.activeElement;
    origin.current =
      active instanceof HTMLElement && scope.current?.contains(active)
        ? active
        : null;
  };
  const restore = () => {
    cancel();
    const target = origin.current;
    timer.current = setTimeout(() => {
      timer.current = null;
      if (target?.isConnected && !target.hasAttribute("disabled"))
        target.focus();
      else
        scope.current
          ?.querySelector<HTMLButtonElement>(
            ".calendar-main-actions .calendar-primary:not(:disabled)",
          )
          ?.focus();
    }, 0);
  };
  return { scope, remember, restore };
}
