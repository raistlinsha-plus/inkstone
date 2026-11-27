import type { MindStyle } from "../content/editableMind";

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

const branchColors = {
  light: ["#4269a7", "#985b37", "#7b5595", "#397a72", "#956052", "#69773b"],
  dark: ["#99b7ed", "#e1a575", "#c5a0e4", "#87c3b3", "#eaa69b", "#bed18b"],
};
export function mindBranchInk(theme: PreviewTheme, style: MindStyle, branch: number, depth: number) {
  const dark = theme === "dark";
  if (style === "color") {
    const colors = branchColors[theme];
    return depth ? colors[branch % colors.length] : dark ? "#b5c6ef" : "#374c77";
  }
  if (style === "minimal") return dark ? "#bac1bd" : "#4d5651";
  return dark ? "#a7cdba" : "#32634c";
}

// Concrete SVG colors also travel with exported and embedded maps.
export function mindTitleColors(theme: PreviewTheme, style: MindStyle = "classic") {
  const dark = theme === "dark";
  const palette = previewColors[theme];
  if (style === "minimal")
    return { fill: palette.canvas, stroke: palette.axis, text: palette.text };
  if (style === "color")
    return dark
      ? { fill: "#323c51", stroke: "#65748f", text: "#e2e9fb" }
      : { fill: "#e9edf7", stroke: "#a4b2cc", text: "#324565" };
  return {
    fill: palette.node,
    stroke: dark ? "#657d6e" : "#a1b5a7",
    text: dark ? "#e2eee5" : "#294c39",
  };
}

// SVG files and sandboxed diagram frames need a concrete, portable system font.
export const diagramFontFamily = "system-ui, sans-serif";
export const mindmapFontSize = 14;
export const lightGraphExport = "#fffefa";

export function applyPreviewTheme(theme: PreviewTheme) {
  const root = document.documentElement;
  const colors = previewColors[theme];
  root.style.colorScheme = theme;
  root.style.setProperty("--preview-background", colors.canvas);
  root.style.setProperty("--preview-text", colors.text);
}
