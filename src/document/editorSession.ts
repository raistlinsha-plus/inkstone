import type { EditorMode } from "../Editor";

export interface EditorPosition {
  selection: number;
  scroll: number;
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
  try {
    localStorage.setItem(
      key(root),
      JSON.stringify({
        path,
        mode,
        selection: position?.selection ?? (same ? previous.selection : 0),
        scroll: position?.scroll ?? (same ? previous.scroll : 0),
      }),
    );
  } catch {
    // Document persistence does not depend on view preferences.
  }
}
