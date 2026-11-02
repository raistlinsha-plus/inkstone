import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
export interface Position {
  start: { offset: number; line: number };
  end: { offset: number; line: number };
}
export interface MarkdownNode {
  type: string;
  value?: string;
  lang?: string;
  depth?: number;
  ordered?: boolean;
  children?: MarkdownNode[];
  position: Position;
  url?: string;
  alt?: string;
}
const parser = unified().use(remarkParse).use(remarkGfm);
export const parseMarkdown = (source: string) =>
  parser.parse(source) as unknown as MarkdownNode;
export const textOf = (node: MarkdownNode): string =>
  node.value ?? node.children?.map(textOf).join("") ?? "";
export interface ContentBlock {
  id: string;
  lang: string;
  text: string;
  from: number;
  to: number;
  line: number;
  endLine: number;
}
export function codeBlocks(
  source: string,
  tree?: MarkdownNode,
): ContentBlock[] {
  const result: ContentBlock[] = [];
  function visit(node: MarkdownNode) {
    if (node.type === "code" && node.position) {
      const raw = source.slice(
        node.position.start.offset,
        node.position.end.offset,
      );
      const firstEnd = raw.indexOf("\n");
      const closing = raw.match(/\n[ \t]*(`{3,}|~{3,})[ \t]*$/);
      // Unterminated fences are previewable, never structurally writable.
      if (firstEnd >= 0 && closing) {
        const from = node.position.start.offset + firstEnd + 1;
        const to = node.position.start.offset + closing.index!;
        result.push({
          id: `${node.position.start.offset}:${node.lang}`,
          lang: (node.lang ?? "text").toLowerCase(),
          text: source.slice(from, to),
          from,
          to,
          line: node.position.start.line + 1,
          endLine: node.position.end.line - 1,
        });
      }
    }
    node.children?.forEach(visit);
  }
  visit(tree ?? parseMarkdown(source));
  return result;
}
export function headingOutline(source: string) {
  return (parseMarkdown(source).children ?? [])
    .filter((n) => n.type === "heading")
    .map((n) => ({
      label: textOf(n),
      depth: n.depth ?? 1,
      line: n.position.start.line,
    }));
}
