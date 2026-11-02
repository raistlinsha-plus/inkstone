import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Chunk } from "./types";

interface Node {
  type: string;
  depth?: number;
  value?: string;
  children?: Node[];
  position?: {
    start: { offset?: number; line: number };
    end: { offset?: number; line: number };
  };
}
const parser = unified().use(remarkParse).use(remarkGfm);
const chars = (s: string) => Array.from(s);
function nodeText(node: Node): string {
  return node.value ?? node.children?.map(nodeText).join("") ?? "";
}
function plainBlocks(content: string): Node[] {
  const blocks: Node[] = [];
  let offset = 0;
  let line = 1;
  for (const match of content.matchAll(/\r?\n[ \t]*\r?\n(?:[ \t]*\r?\n)*/g)) {
    const text = content.slice(offset, match.index);
    const end = line + (text.match(/\n/g)?.length ?? 0);
    blocks.push({
      type: "paragraph",
      value: text,
      position: {
        start: { offset, line },
        end: { offset: match.index, line: end },
      },
    });
    line = end + (match[0].match(/\n/g)?.length ?? 0);
    offset = match.index + match[0].length;
  }
  const text = content.slice(offset);
  blocks.push({
    type: "paragraph",
    value: text,
    position: {
      start: { offset, line },
      end: {
        offset: content.length,
        line: line + (text.match(/\n/g)?.length ?? 0),
      },
    },
  });
  return blocks;
}
export function visualUnsupported(markdown: string): boolean {
  const tree = parser.parse(markdown) as Node;
  const inspect = (node: Node): boolean =>
    [
      "html",
      "definition",
      "footnoteDefinition",
      "footnoteReference",
      "linkReference",
      "imageReference",
    ].includes(node.type) || !!node.children?.some(inspect);
  return inspect(tree);
}
export function chunkDocument(
  content: string,
  markdown = true,
  max = 1800,
): Chunk[] {
  const result: Chunk[] = [];
  const headings: string[] = [];
  const tree = markdown ? (parser.parse(content) as Node) : null;
  let pending = "";
  let first = 1;
  let last = 1;
  let currentHeading = "";
  const add = (
    text: string,
    heading: string,
    startLine: number,
    endLine: number,
  ) => {
    if (text.trim()) result.push({ text, heading, startLine, endLine });
  };
  const flush = () => {
    if (pending.trim()) add(pending, currentHeading, first, last);
    pending = "";
  };
  const blocks = tree?.children ?? plainBlocks(content);
  for (const node of blocks) {
    if (node.type === "heading") {
      flush();
      headings.length = Math.max(0, (node.depth ?? 1) - 1);
      headings[(node.depth ?? 1) - 1] = nodeText(node);
    }
    const heading = chars(headings.filter(Boolean).join(" / "))
      .slice(0, Math.min(180, Math.floor(max / 5)))
      .join("");
    const limit = Math.max(64, max - chars(heading).length - 2);
    const raw =
      node.position?.start.offset !== undefined &&
      node.position.end.offset !== undefined
        ? content.slice(node.position.start.offset, node.position.end.offset)
        : (node.value ?? "");
    if (!raw.trim()) continue;
    const start = node.position?.start.line ?? 1;
    const end = node.position?.end.line ?? start;
    if (chars(raw).length > limit) {
      flush();
      let piece = "";
      let pieceLength = 0;
      let line = start;
      let pieceStart = start;
      for (const character of chars(raw)) {
        if (pieceLength >= limit) {
          add(piece, heading, pieceStart, line);
          piece = "";
          pieceLength = 0;
          pieceStart = line;
        }
        piece += character;
        pieceLength++;
        if (character === "\n") line++;
      }
      add(piece, heading, pieceStart, end);
      continue;
    }
    if (
      pending &&
      (currentHeading !== heading ||
        chars(pending).length + chars(raw).length + 2 > limit)
    )
      flush();
    if (!pending) {
      first = start;
      currentHeading = heading;
    }
    pending += `${pending ? "\n\n" : ""}${raw}`;
    last = end;
  }
  flush();
  return result;
}
