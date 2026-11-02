export interface GraphViewport {
  x: number;
  y: number;
  scale: number;
}
export function graphViewport(value: unknown): GraphViewport | null {
  const v = value as Partial<GraphViewport> | null;
  return v &&
    typeof v.x === "number" &&
    typeof v.y === "number" &&
    typeof v.scale === "number" &&
    Number.isFinite(v.x) &&
    Number.isFinite(v.y) &&
    Number.isFinite(v.scale) &&
    Math.abs(v.x) < 1_000_000 &&
    Math.abs(v.y) < 1_000_000 &&
    v.scale >= 0.005 &&
    v.scale <= 16
    ? { x: v.x, y: v.y, scale: v.scale }
    : null;
}
const prefix = "inkstone.graph-view.v1:";
export function loadViewport(key?: string): GraphViewport | null {
  try {
    return key
      ? graphViewport(JSON.parse(localStorage.getItem(prefix + key) || "null"))
      : null;
  } catch {
    return null;
  }
}
export function saveViewport(key: string | undefined, value: GraphViewport) {
  if (!key) return;
  try {
    // View preferences contain no document content. Bound their storage growth.
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(prefix));
    if (keys.length >= 200 && !keys.includes(prefix + key))
      localStorage.removeItem(keys[0]);
    localStorage.setItem(prefix + key, JSON.stringify(value));
  } catch {
    /* Private browsing/storage limits do not affect editing. */
  }
}
