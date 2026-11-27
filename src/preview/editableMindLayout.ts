import type { CanvasNode } from "../content/editableMind";
import { diagramFontFamily } from "./theme";

export interface PlacedNode {
  node: CanvasNode;
  shape: CanvasNode["shape"];
  x: number;
  y: number;
  w: number;
  h: number;
  parent?: PlacedNode;
  branch: number;
  depth: number;
  lines: string[];
}
export function layOutMind(root: CanvasNode) {
  const ctx =
    typeof CanvasRenderingContext2D === "undefined"
      ? null
      : document.createElement("canvas").getContext("2d");
  const widths: number[] = [];
  const spans = new Map<string, number>();
  const byId = new Map<string, PlacedNode>();
  function visit(
    node: CanvasNode,
    depth: number,
    parent?: PlacedNode,
    branch = 0,
  ): number {
    const size = depth ? 15 : 18;
    if (ctx)
      ctx.font =
        (depth > 1 ? "400 " : "600 ") + size + "px " + diagramFontFamily;
    const measure = (str: string) =>
      ctx?.measureText(str).width ?? [...str].length * size;
    const lines: string[] = [];
    let line = "";
    for (const ch of node.label) {
      if (line && measure(line + ch) > 208) {
        lines.push(line);
        line = "";
      }
      line += ch;
    }
    lines.push(line);
    let w = Math.max(
      48,
      ...lines.map((l) => Math.ceil(measure(l)) + (depth ? 24 : 32)),
    );
    let h = lines.length * 22 + (depth ? 12 : 20);
    // Legacy templates encode the center title as root((label)).
    const shape = !depth && node.shape === "circle" ? "rounded" : node.shape;
    if (shape === "circle") w = h = Math.ceil(Math.hypot(w, h));
    if (shape === "hexagon") w += 18;
    widths[depth] = Math.max(widths[depth] || 0, w);
    const box: PlacedNode = {
      node,
      shape,
      x: 0,
      y: 0,
      w,
      h,
      parent,
      branch,
      depth,
      lines,
    };
    byId.set(node.id, box);
    const children = node.children.map((c, i) =>
      visit(c, depth + 1, box, depth ? branch : i),
    );
    const span = Math.max(
      h,
      children.reduce((n, v) => n + v, 0) +
        14 * Math.max(0, children.length - 1),
    );
    spans.set(node.id, span);
    return span;
  }
  visit(root, 0);
  const columns = [0];
  widths.forEach((w, i) => columns.push(columns[i] + w + 48));
  function place(node: CanvasNode, top: number, depth: number, parentX = 0, parentY = 0) {
    const dx = parentX + (node.offset?.x ?? 0), dy = parentY + (node.offset?.y ?? 0);
    const box = byId.get(node.id)!;
    box.x = columns[depth] + dx;
    const middle = top + spans.get(node.id)! / 2;
    box.y = middle - box.h / 2 + dy;
    const childSpan =
      node.children.reduce((sum, child) => sum + spans.get(child.id)!, 0) +
      Math.max(0, node.children.length - 1) * 14;
    let nextTop = middle - childSpan / 2;
    for (const child of node.children) {
      place(child, nextTop, depth + 1, dx, dy);
      nextTop += spans.get(child.id)! + 14;
    }
  }
  place(root, 0, 0);
  const boxes = Array.from(byId.values());
  const minX = Math.min(...boxes.map(b => b.x)), minY = Math.min(...boxes.map(b => b.y));
  return {
    byId, boxes, minX, minY,
    width: Math.max(...boxes.map(b => b.x + b.w)) - minX,
    height: Math.max(...boxes.map(b => b.y + b.h)) - minY,
  };
}

export function mindConnector(box: PlacedNode) {
  const p = box.parent!;
  const overlapX = box.x < p.x + p.w && box.x + box.w > p.x;
  if (overlapX && (box.y >= p.y + p.h || box.y + box.h <= p.y)) {
    const down = box.y >= p.y + p.h;
    const start = down ? p.y + p.h : p.y, end = down ? box.y : box.y + box.h;
    const mid = (start + end) / 2;
    const x1 = p.x + p.w / 2, x2 = box.x + box.w / 2;
    return `M ${x1} ${start} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${end}`;
  }
  const right = box.x + box.w / 2 >= p.x + p.w / 2;
  const start = right ? p.x + p.w : p.x,
    end = right ? box.x : box.x + box.w,
    mid = (start + end) / 2;
  const y1 = p.y + p.h / 2,
    y2 = box.y + box.h / 2;
  return `M ${start} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${end} ${y2}`;
}
