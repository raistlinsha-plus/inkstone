import { parseMarkdown, type MarkdownNode } from "../content/blocks";
const rawTypes = new Set([
  "html",
  "definition",
  "footnoteDefinition",
  "footnoteReference",
  "linkReference",
  "imageReference",
]);
// Crepe serializes an empty paragraph as a lone <br />. Let its empty-line
// plugin read that placeholder, while all other HTML remains literal.
export const isSafeBreak = (value: unknown): value is string =>
  typeof value === "string" && /^<br\s*\/?\s*>$/i.test(value.trim());
type ReferenceNode = MarkdownNode & {
  identifier?: string;
  title?: string | null;
  label?: string;
  alt?: string;
};
function definitionsOf(tree: MarkdownNode) {
  const definitions = new Map<string, ReferenceNode>();
  for (const raw of tree.children ?? []) {
    const node = raw as ReferenceNode;
    if (
      node.type === "definition" &&
      node.identifier &&
      node.url !== undefined &&
      !definitions.has(node.identifier.toLowerCase())
    )
      definitions.set(node.identifier.toLowerCase(), node);
  }
  return definitions;
}
const unsupported = (
  n: MarkdownNode,
  definitions?: Map<string, ReferenceNode>,
): boolean => {
  const reference = n as ReferenceNode;
  const resolved =
    (n.type === "linkReference" || n.type === "imageReference") &&
    definitions?.has(reference.identifier?.toLowerCase() ?? "");
  return (
    (rawTypes.has(n.type) &&
      !resolved &&
      !(n.type === "html" && isSafeBreak(n.value))) ||
    !!n.children?.some((child) => unsupported(child, definitions))
  );
};
function inlineReference(
  node: ReferenceNode,
  definition: ReferenceNode,
  source: string,
) {
  const destination =
    "<" +
    (definition.url ?? "").replace(/[<>\\\s]/g, (character) =>
      encodeURIComponent(character),
    ) +
    ">";
  const title =
    definition.title === null || definition.title === undefined
      ? ""
      : ' "' +
        definition.title.replace(/\\/g, "\\\\").replace(/"/g, '\\"') +
        '"';
  if (node.type === "imageReference")
    return (
      "![" +
      (node.alt ?? "").replace(/[\\[\]]/g, "\\$&") +
      "](" +
      destination +
      title +
      ")"
    );
  const first = node.children?.[0],
    last = node.children?.at(-1);
  const label =
    first && last
      ? source.slice(first.position.start.offset, last.position.end.offset)
      : "";
  return "[" + label + "](" + destination + title + ")";
}
function codes(source: string) {
  const result: MarkdownNode[] = [];
  const visit = (n: MarkdownNode) => {
    if (n.type === "code") result.push(n);
    n.children?.forEach(visit);
  };
  visit(parseMarkdown(source));
  return result;
}
// References/HTML protected as one raw block may contain nested fences. Their
// identities must not be reassigned to the next visible JSON or diagram block.
export function visibleCodeIndices(source: string) {
  const indices: number[] = [];
  let ordinal = 0;
  function visit(node: MarkdownNode, visible: boolean) {
    if (node.type === "code") {
      if (visible) indices.push(ordinal);
      ordinal++;
    }
    node.children?.forEach((child) => visit(child, visible));
  }
  const tree = parseMarkdown(source),
    definitions = definitionsOf(tree);
  for (const node of tree.children ?? [])
    if (node.type !== "definition")
      visit(node, !unsupported(node, definitions));
  return indices;
}
/** Keep unsupported Markdown local and literal; it never becomes executable DOM. */
export class RichMarkdownAdapter {
  readonly rawLanguage = "inkstone-raw-" + crypto.randomUUID();
  private originalCodes: MarkdownNode[];
  private definitions: string[] = [];
  private prepared = new Map<string, string>();
  constructor(readonly original: string) {
    this.originalCodes = codes(original);
  }
  sourceLocation(source: string, line: number) {
    const blocks: { node: MarkdownNode; raw: boolean }[] = [];
    const visit = (node: MarkdownNode) => {
      if (node.type === "code") blocks.push({ node, raw: false });
      else node.children?.forEach(visit);
    };
    const tree = parseMarkdown(source),
      definitions = definitionsOf(tree);
    for (const node of tree.children ?? []) {
      if (node.type === "definition") continue;
      if (unsupported(node, definitions)) blocks.push({ node, raw: true });
      else visit(node);
    }
    const index = blocks.findIndex(
      ({ node }) =>
        node.position.start.line <= line && node.position.end.line >= line,
    );
    if (index < 0) return null;
    const { node, raw } = blocks[index];
    return {
      index,
      line: Math.max(1, line - node.position.start.line + (raw ? 1 : 0)),
    };
  }
  prepare(source: string, mode: "document" | "fragment" = "document") {
    const tree = parseMarkdown(source),
      definitions = definitionsOf(tree);
    const raws = (tree.children ?? [])
      .filter((node) => node.type === "definition")
      .map((node) =>
        source.slice(node.position.start.offset, node.position.end.offset),
      );
    if (mode === "document") {
      this.definitions = raws;
      this.prepared.clear();
    } else
      for (const raw of raws)
        if (!this.definitions.includes(raw)) this.definitions.push(raw);
    const changes: { from: number; to: number; value: string }[] = [];
    function visit(raw: MarkdownNode) {
      const node = raw as ReferenceNode;
      if (node.type === "linkReference" || node.type === "imageReference") {
        const definition = definitions.get(
          node.identifier?.toLowerCase() ?? "",
        );
        if (definition) {
          changes.push({
            from: node.position.start.offset,
            to: node.position.end.offset,
            value: inlineReference(node, definition, source),
          });
          return;
        }
      }
      node.children?.forEach(visit);
    }
    for (const node of tree.children ?? []) {
      if (node.type === "definition")
        changes.push({
          from: node.position.start.offset,
          to: node.position.end.offset,
          value: "",
        });
      else visit(node);
    }
    let next = source;
    for (const change of changes.sort((a, b) => b.from - a.from))
      next = next.slice(0, change.from) + change.value + next.slice(change.to);
    // Unsupported HTML/footnotes still receive the existing literal protection,
    // after only AST-confirmed references have become equivalent inline syntax.
    const nodes = (parseMarkdown(next).children ?? []).filter((node) =>
      unsupported(node),
    );
    for (const node of nodes.reverse()) {
      const raw = next.slice(
        node.position.start.offset,
        node.position.end.offset,
      );
      const fence = "`".repeat(
        Math.max(
          3,
          ...Array.from(raw.matchAll(/`+/g), (match) => match[0].length + 1),
        ),
      );
      next =
        next.slice(0, node.position.start.offset) +
        fence +
        this.rawLanguage +
        "\n" +
        raw +
        "\n" +
        fence +
        next.slice(node.position.end.offset);
    }
    if (mode === "document") this.prepared.set(next, source);
    return next;
  }
  serialize(markdown: string) {
    const original = this.prepared.get(markdown);
    if (original !== undefined) return original;
    const originals = this.originalCodes;
    if (
      !originals.length &&
      !markdown.includes(this.rawLanguage) &&
      !this.definitions.length
    )
      return markdown;
    const used = new Set<MarkdownNode>();
    let result = markdown;
    for (const node of codes(markdown).reverse()) {
      if (node.lang === this.rawLanguage) {
        result =
          result.slice(0, node.position.start.offset) +
          (node.value ?? "") +
          result.slice(node.position.end.offset);
        continue;
      }
      const old = [...originals]
        .reverse()
        .find(
          (n) => !used.has(n) && n.lang === node.lang && n.value === node.value,
        );
      if (old) {
        used.add(old);
        result =
          result.slice(0, node.position.start.offset) +
          this.original.slice(
            old.position.start.offset,
            old.position.end.offset,
          ) +
          result.slice(node.position.end.offset);
      }
    }
    const existingDefinitions = new Set(
      (parseMarkdown(result).children ?? [])
        .filter((node) => node.type === "definition")
        .map((node) =>
          result.slice(node.position.start.offset, node.position.end.offset),
        ),
    );
    const missing = this.definitions.filter(
      (raw) => !existingDefinitions.has(raw),
    );
    if (missing.length)
      result =
        result.replace(/\n*$/, "") + "\n\n" + missing.join("\n\n") + "\n";
    return result;
  }
}
