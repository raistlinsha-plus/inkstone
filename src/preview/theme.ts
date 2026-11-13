export type PreviewTheme = "light" | "dark";

export function previewTheme(value: unknown): PreviewTheme {
  return value === "dark" ? "dark" : "light";
}

// Keep the opaque frame palettes in step with the application's workbench tokens.
export const previewColors = {
  light: {
    canvas: "#fbfaf7",
    surface: "#f3f2ef",
    text: "#222724",
    muted: "#57605b",
    axis: "#748079",
    grid: "#dedfda",
    node: "#e7eee8",
    branch: "#4f7a65",
  },
  dark: {
    canvas: "#1e2220",
    surface: "#272d29",
    text: "#eef1ee",
    muted: "#b9c3bc",
    axis: "#86978c",
    grid: "#3b443e",
    node: "#354a3e",
    branch: "#a0c5af",
  },
} satisfies Record<PreviewTheme, Record<string, string>>;

export const lightGraphExport = "#fffefa";

export function applyPreviewTheme(theme: PreviewTheme) {
  const root = document.documentElement;
  const colors = previewColors[theme];
  root.style.colorScheme = theme;
  root.style.setProperty("--preview-background", colors.canvas);
  root.style.setProperty("--preview-text", colors.text);
}
