import { useEffect, useState } from "react";
/** A task layout follows the window without overwriting the user's pane preferences. */
export function useCompactWindow() {
  const [compact, setCompact] = useState(
    () =>
      typeof window.matchMedia === "function" &&
      window.matchMedia("(max-width: 1100px)").matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(max-width: 1100px)");
    const change = () => setCompact(media.matches);
    change();
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  return compact;
}
