type PanePreference = "sidebar-closed" | "panel-open";
export function readPanePreference(name: PanePreference): boolean {
  try {
    return localStorage.getItem(`inkstone:${name}`) === "true";
  } catch {
    return false;
  }
}
export function savePanePreference(name: PanePreference, value: boolean) {
  try {
    localStorage.setItem(`inkstone:${name}`, String(value));
  } catch {
    /* Layout preferences are optional; document persistence is independent. */
  }
}
