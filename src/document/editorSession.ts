import type { EditorMode } from "../Editor";

export interface EditorPosition {
  selection: number;
  scroll: number;
  /** Native editor coordinates preserve a range when resuming the same mode. */
  anchor?: number;
  visual?: { head: number; anchor: number };
}

export interface SavedEditorSession extends EditorPosition {
  path: string;
  mode?: EditorMode;
}

const key = (root: string) => `inkstone:session:${root}`;
const isMode = (value: unknown): value is EditorMode =>
  value === "source" ||
  value === "visual" ||
  value === "split" ||
  value === "mindmap";

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

export function readEditorSession(root: string): SavedEditorSession | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(key(root)) ?? "null");
    if (typeof value?.path !== "string" || !value.path) return;
    return {
      path: value.path,
      mode: isMode(value.mode) ? value.mode : undefined,
      selection: Math.floor(numberOrZero(value.selection)),
      scroll: numberOrZero(value.scroll),
      anchor: Number.isSafeInteger(value.anchor) && value.anchor >= 0 ? value.anchor : undefined,
      visual:
        value.mode === "visual" &&
        Number.isSafeInteger(value.visual?.head) && value.visual.head >= 0 &&
        Number.isSafeInteger(value.visual?.anchor) && value.visual.anchor >= 0
          ? { head: value.visual.head, anchor: value.visual.anchor }
          : undefined,
    };
  } catch {
    // A missing or damaged local preference does not block the editor.
  }
}

export function saveEditorSession(
  root: string,
  path: string,
  mode: EditorMode,
  position?: Partial<EditorPosition>,
) {
  const previous = readEditorSession(root);
  const same = previous?.path === path;
  const unchanged = same && previous.mode === mode && position?.selection === undefined;
  try {
    localStorage.setItem(
      key(root),
      JSON.stringify({
        path,
        mode,
        selection: position?.selection ?? (same ? previous.selection : 0),
        scroll: position?.scroll ?? (same ? previous.scroll : 0),
        anchor: position?.anchor ?? (unchanged ? previous.anchor : undefined),
        visual: position?.visual ?? (unchanged ? previous.visual : undefined),
      }),
    );
  } catch {
    // Document persistence does not depend on view preferences.
  }
}
