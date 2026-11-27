import type { CanvasNode, MindStyle } from "../content/editableMind";
import { positionedMind, type MindPositions } from "../content/mindPositions";
import { layOutMind, mindConnector } from "./editableMindLayout";
import { diagramFontFamily, mindBranchInk, mindTitleColors, previewColors, type PreviewTheme } from "./theme";

export function isMermaidMindmap(source: string) {
  const text = source.trimStart().replace(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, "");
  const first = text.split(/\r?\n/).find(line => line.trim() && !line.trimStart().startsWith("%%"));
  return /^mindmap(?:\s|$)/i.test(first?.trimStart() ?? "");
}

interface MermaidNode {
  descr: string;
  type: number;
  icon?: string;
  class?: string;
  children: MermaidNode[];
}
type ShapeTypes = Record<
  "DEFAULT" | "CIRCLE" | "RECT" | "ROUNDED_RECT" | "HEXAGON",
  number
>;
export interface MermaidMindDB {
  nodeType: ShapeTypes;
  getMindmap(): MermaidNode | null;
}

const ns = "http://www.w3.org/2000/svg";
function svgEl(name: string, attrs: Record<string, string | number>) {
  const el = document.createElementNS(ns, name);
  for (const [key, value] of Object.entries(attrs))
    el.setAttribute(key, String(value));
  return el;
}

// Mermaid parses and validates the hierarchy, IDs, and shape syntax. Leave
// decorated nodes, Markdown labels and uncommon shapes to its native renderer.
export function orderedMindmap(
  db: MermaidMindDB,
  theme: PreviewTheme,
  style: MindStyle,
  positions: MindPositions,
): DocumentFragment | undefined {
  const root = db.getMindmap();
  const shapes = db.nodeType;
  function supported(node: MermaidNode): boolean {
    return (
      !node.icon &&
      !node.class &&
      !/[<>`]|&[#\w]+;/.test(node.descr) &&
      [
        shapes.DEFAULT,
        shapes.CIRCLE,
        shapes.RECT,
        shapes.ROUNDED_RECT,
        shapes.HEXAGON,
      ].includes(node.type) &&
      node.children.every(supported)
    );
  }
  if (!root || !supported(root)) return;
  const colors = previewColors[theme];
  const shapeNames = new Map<number, CanvasNode["shape"]>([
    [shapes.DEFAULT, "plain"], [shapes.CIRCLE, "circle"], [shapes.RECT, "rect"],
    [shapes.ROUNDED_RECT, "rounded"], [shapes.HEXAGON, "hexagon"],
  ]);
  let sequence = 0;
  function toCanvasNode(node: MermaidNode): CanvasNode {
    return { id: String(sequence++), label: node.descr, shape: shapeNames.get(node.type),
      children: node.children.map(toCanvasNode) };
  }
  const layout = layOutMind(positionedMind(toCanvasNode(root), positions));
  const padding = 22;
  const svg = svgEl("svg", {
    viewBox: [layout.minX - padding, layout.minY - padding, layout.width + 2 * padding,
      layout.height + 2 * padding].join(" "),
    role: "img", "aria-label": root.descr,
  });
  const edges = svgEl("g", { fill: "none", "stroke-linecap": "round" });
  svg.append(edges);
  for (const box of layout.boxes) {
    const { x, y, w, h, depth, shape } = box;
    const ink = mindBranchInk(theme, style, box.branch, depth);
    if (box.parent) {
      edges.append(svgEl("path", { d: mindConnector(box), stroke: ink,
        "stroke-opacity": style === "minimal" ? 0.65 : 0.86,
        "stroke-width": style === "color" && depth === 1 ? 2.4 : 1.55 }));
    }
    const group = svgEl("g", { transform: `translate(${x},${y})` });
    const title = !depth && (shape === "plain" || shape === "rounded")
      ? mindTitleColors(theme, style) : undefined;
    const tinted = style === "color" && depth === 1;
    const filled = !depth && style !== "minimal";
    const paint = {
      fill: title?.fill ?? (filled || tinted ? ink : colors.canvas),
      "fill-opacity": tinted ? (theme === "dark" ? 0.21 : 0.12) : 1,
      stroke: title?.stroke ?? ink,
      "stroke-width": title ? 1 : filled || tinted ? 0 : 1.35,
    };
    if (shape === "circle") {
      group.append(svgEl("circle", { cx: w / 2, cy: h / 2, r: h / 2, ...paint }));
    } else if (shape === "hexagon") {
      group.append(svgEl("polygon", {
        points: `10,0 ${w - 10},0 ${w},${h / 2} ${w - 10},${h} 10,${h} 0,${h / 2}`,
        ...paint,
      }));
    } else if (shape !== "plain" || !depth || tinted) {
      group.append(svgEl("rect", { width: w, height: h, rx: shape === "rect" ? 0 : 8, ...paint }));
    }
    box.lines.forEach((line, index) => {
      const label = svgEl("text", {
        x: w / 2, y: h / 2 + (index - (box.lines.length - 1) / 2) * 22 + (depth ? 5 : 6),
        "text-anchor": "middle", "font-family": diagramFontFamily,
        "font-size": depth ? 15 : 18, "font-weight": depth > 1 ? 400 : 600,
        fill: title?.text ?? (filled ? (theme === "dark" ? "#17241f" : "#fff") : colors.text),
      });
      label.textContent = line;
      group.append(label);
    });
    svg.append(group);
  }
  const fragment = document.createDocumentFragment();
  fragment.append(svg);
  return fragment;
}
