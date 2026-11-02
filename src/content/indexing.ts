import { chunkDocument } from "../document";
import { chartIndexChunks } from "./chartIndex";
import { inspectJson, pointer, type JsonNode } from "./json";
import type { Chunk } from "../types";
import { parseMarkdown, type MarkdownNode } from "./blocks";
export function chunkStructured(
  content: string,
  path: string,
  max: number,
): Chunk[] {
  if (!/\.json$/i.test(path)) {
    if (/\.(txt|mmd)$/i.test(path)) return chunkDocument(content, false, max);
    const tree = parseMarkdown(content);
    const special = (n: MarkdownNode) =>
      n.type === "code" &&
      ["json", "mindmap", "mermaid", "chart"].includes(
        n.lang?.toLowerCase() ?? "",
      );
    if (!(tree.children ?? []).some(special))
      return chunkDocument(content, true, max);
    const chunks: Chunk[] = [],
      headings: string[] = [];
    let from = 0,
      startLine = 1;
    const heading = () => headings.filter(Boolean).join(" / ");
    const flush = (to: number) => {
      const part = content.slice(from, to);
      for (const c of chunkDocument(part, true, max))
        chunks.push({
          ...c,
          heading: (c.heading || heading()).slice(0, 180),
          startLine: c.startLine + startLine - 1,
          endLine: c.endLine + startLine - 1,
        });
    };
    for (const node of tree.children ?? []) {
      if (node.type === "heading") {
        headings.length = (node.depth ?? 1) - 1;
        headings[(node.depth ?? 1) - 1] = (node.children ?? [])
          .map((n) => n.value ?? "")
          .join("");
      }
      if (!special(node)) continue;
      flush(node.position.start.offset);
      const body = node.value ?? "",
        line = node.position.start.line + 1,
        kind = node.lang?.toLowerCase();
      // Invalid JSON is still indexable as literal source; editing and recovery do not depend on parsing it.
      let parts: Chunk[];
      const available = Math.max(
        64,
        max - Math.min(180, Array.from(heading()).length) - 16,
      );
      try {
        parts =
          kind === "chart"
            ? chartIndexChunks(
                body,
                max - Math.min(180, Math.floor(max / 5)) - 2,
              )
            : kind === "json"
              ? chunkStructured(body, "inline.json", available)
              : chunkDocument(body, kind === "mindmap", available);
      } catch {
        parts = chunkDocument(body, false, available);
      }
      for (const c of parts)
        chunks.push({
          ...c,
          heading: [
            heading(),
            kind === "mindmap"
              ? "脑图"
              : kind === "mermaid"
                ? "Mermaid 图表"
                : kind === "chart"
                  ? "数据图表"
                  : "JSON",
            c.heading,
          ]
            .filter(Boolean)
            .join(" / ")
            .slice(0, Math.min(180, Math.floor(max / 5))),
          startLine: line + c.startLine - 1,
          endLine: line + c.endLine - 1,
        });
      from = node.position.end.offset;
      startLine = node.position.end.line;
    }
    flush(content.length);
    return chunks;
  }
  const state = inspectJson(content);
  if (state.errors.length || !state.root)
    throw new Error("JSON 有语法错误，请修正后再加入知识库。");
  const chunks: Chunk[] = [];
  const add = (node: JsonNode, keys: (string | number)[]) => {
    const text = content.slice(node.offset, node.offset + node.length);
    const line = content.slice(0, node.offset).split("\n").length;
    const heading = Array.from(pointer(keys) || "/")
      .slice(0, Math.min(180, Math.floor(max / 5)))
      .join("");
    if (
      text.length > max &&
      node.children?.length &&
      (node.type === "object" || node.type === "array")
    ) {
      node.children.forEach((entry, i) => {
        const value = node.type === "object" ? entry.children?.[1] : entry;
        if (value)
          add(value, [
            ...keys,
            node.type === "object" ? String(entry.children?.[0]?.value) : i,
          ]);
      });
    } else {
      for (const chunk of chunkDocument(
        text,
        false,
        Math.max(64, max - Array.from(heading).length - 2),
      ))
        chunks.push({
          ...chunk,
          heading: heading.slice(0, 180),
          startLine: line + chunk.startLine - 1,
          endLine: line + chunk.endLine - 1,
        });
    }
  };
  if (state.root.type === "object" || state.root.type === "array")
    state.root.children?.forEach((entry, i) => {
      const value = state.root!.type === "object" ? entry.children?.[1] : entry;
      if (value)
        add(value, [
          state.root!.type === "object"
            ? String(entry.children?.[0]?.value)
            : i,
        ]);
    });
  else add(state.root, []);
  return chunks;
}
