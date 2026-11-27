import { maxMindOffset, type MindOffset, type MindPositions } from "./mindPositions";

export interface CanvasNode {
  id: string;
  label: string;
  children: CanvasNode[];
  positionKey?: string;
  offset?: MindOffset;
  shape?: "plain" | "rounded" | "rect" | "circle" | "hexagon" | "cloud" | "bang";
  editable?: boolean;
  canAddChild?: boolean;
  movable?: boolean;
}

export type MindChange =
  | { type: "rename" | "child" | "sibling"; id: string; label: string }
  | { type: "delete"; id: string }
  | { type: "move"; id: string; target: string; placement: "before" | "after" | "child" };

export interface MindChangeResult {
  source: string;
  selection?: string;
}
export type MindStyle = "classic" | "color" | "minimal";
export type MindFormat = "markdown" | "mermaid";

// Keep metadata in a native comment. Mermaid keeps its declaration first;
// Markdown keeps any YAML front matter in the leading position.
function styleOffset(source: string, format: MindFormat) {
  if (format === "mermaid") {
    const header = /^[\uFEFF \t]*mindmap[ \t]*\r?\n/im.exec(source);
    if (header) return header.index + header[0].length;
  }
  const bom = source.startsWith("\uFEFF") ? 1 : 0;
  const yaml = /^---[ \t]*\r?\n[\s\S]*?^(?:---|\.\.\.)[ \t]*\r?\n/m.exec(source.slice(bom));
  return bom + (yaml?.index === 0 ? yaml[0].length : 0);
}

export function mindPresentation(source: string, format: MindFormat) {
  const offset = styleOffset(source, format);
  const marker = format === "mermaid"
    ? /^%% inkstone-mind-style: (color|minimal)\r?\n/
    : /^<!-- inkstone-mind-style: (color|minimal) -->\r?\n/;
  const match = marker.exec(source.slice(offset));
  const afterStyle = offset + (match?.[0].length ?? 0);
  const layoutMarker = format === "mermaid"
    ? /^%% inkstone-mind-layout: (.+)\r?\n/
    : /^<!-- inkstone-mind-layout: (.+) -->\r?\n/;
  const layout = layoutMarker.exec(source.slice(afterStyle));
  const positions: MindPositions = new Map();
  let end = afterStyle;
  if (layout) {
    try {
      const rows: unknown = JSON.parse(layout[1]);
      if (Array.isArray(rows) && rows.length <= 500 && rows.every(row =>
        Array.isArray(row) && row.length === 3 && typeof row[0] === "string" &&
        Number.isFinite(row[1]) && Math.abs(row[1]) <= maxMindOffset &&
        Number.isFinite(row[2]) && Math.abs(row[2]) <= maxMindOffset)) {
        for (const [key, x, y] of rows) positions.set(key, { x, y });
        end += layout[0].length;
      }
    } catch { /* Leave unrecognized metadata intact in the source. */ }
  }
  return {
    body: source.slice(0, offset) + source.slice(end),
    style: (match?.[1] ?? "classic") as MindStyle, positions, offset,
    lineCount: Number(!!match) + Number(end !== afterStyle),
  };
}

export function withMindStyle(body: string, format: MindFormat, style: MindStyle, positions?: MindPositions): string {
  const metadata: string[] = [];
  if (style !== "classic") metadata.push("inkstone-mind-style: " + style);
  if (positions?.size) {
    const rows = Array.from(positions, ([key, { x, y }]) => [key, x, y]);
    metadata.push("inkstone-mind-layout: " + JSON.stringify(rows));
  }
  if (!metadata.length) return body;
  const pos = styleOffset(body, format);
  const eol = body.includes("\r\n") ? "\r\n" : "\n";
  const markers = metadata.map(line => (format === "mermaid" ? "%% " + line : "<!-- " + line + " -->") + eol);
  return body.slice(0, pos) + markers.join("") + body.slice(pos);
}
