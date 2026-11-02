import { parseMarkdown, textOf, type MarkdownNode } from "./blocks";
export interface MindNode {
  id: string;
  label: string;
  line: number;
  from: number;
  to: number;
  kind: "heading" | "list" | "root";
  depth: number;
  children: MindNode[];
  editable: boolean;
}
export function outlineTree(source: string): MindNode {
  const ast = parseMarkdown(source);
  const root: MindNode = {
    id: "root",
    label: "文档",
    line: 1,
    from: 0,
    to: source.length,
    kind: "root",
    depth: 0,
    children: [],
    editable: false,
  };
  const stack = [root];
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  function lists(node: MarkdownNode, parent: MindNode) {
    for (const item of node.children ?? []) {
      const para = item.children?.[0];
      const textOnly =
        !!para &&
        para.type === "paragraph" &&
        para.position.start.line === para.position.end.line &&
        para.children?.every((n) => n.type === "text");
      const simple =
        textOnly &&
        item.children?.every(
          (n, i) => i === 0 || (n.type === "list" && !n.ordered),
        );
      const firstLine = source.slice(item.position.start.offset).split(eol)[0];
      const m: MindNode = {
        id: `l${item.position.start.offset}`,
        label: para ? textOf(para) : "空节点",
        line: item.position.start.line,
        from: item.position.start.offset,
        to: item.position.end.offset,
        kind: "list",
        depth: parent.depth + 1,
        children: [],
        editable: !!simple && !node.ordered && /^[-+*] /.test(firstLine),
      };
      parent.children.push(m);
      for (const child of item.children ?? [])
        if (child.type === "list") lists(child, m);
    }
  }
  for (const block of ast.children ?? []) {
    if (block.type === "heading") {
      while (stack.length > 1 && stack.at(-1)!.depth >= (block.depth ?? 1))
        stack.pop();
      const m: MindNode = {
        id: `h${block.position.start.offset}`,
        label: textOf(block),
        line: block.position.start.line,
        from: block.position.start.offset,
        to: block.position.end.offset,
        kind: "heading",
        depth: block.depth ?? 1,
        children: [],
        editable: !!block.children?.every((n) => n.type === "text"),
      };
      stack.at(-1)!.children.push(m);
      stack.push(m);
    } else if (block.type === "list") lists(block, stack.at(-1)!);
    else stack.at(-1)!.editable = false;
  }
  // Include an entire subtree for safe deletion. Ancestor readonly protects attached prose.
  function finalize(node: MindNode, end: number) {
    if (node.kind === "heading") node.to = end;
    for (let i = 0; i < node.children.length; i++)
      finalize(node.children[i], node.children[i + 1]?.from ?? node.to);
    if (node.children.some((n) => !n.editable)) node.editable = false;
  }
  finalize(root, source.length);
  return root;
}
export function flattenMind(root: MindNode): MindNode[] {
  return [root, ...root.children.flatMap(flattenMind)];
}
export function editMind(
  source: string,
  node: MindNode,
  action: "rename" | "child" | "sibling" | "delete",
  value = "",
) {
  if (!node.editable) throw new Error("该分支包含复杂正文，请回到原文编辑。");
  if (action !== "delete" && (!value.trim() || /[\r\n]/.test(value)))
    throw new Error("节点名称应为一行非空文字。");
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const lineStart = source.lastIndexOf("\n", node.from - 1) + 1;
  const lineEnd = source.indexOf("\n", node.from);
  const first = source
    .slice(lineStart, lineEnd < 0 ? source.length : lineEnd)
    .replace(/\r$/, "");
  const prefix = first.match(/^(\s*(?:#{1,6}|[-+*])\s+)/)?.[1];
  if (!prefix) throw new Error("节点位置已经变化，请刷新脑图。");
  if (action === "rename") {
    // Plain-text labels only; escape Markdown punctuation instead of introducing structure.
    const label = value.trim().replace(/[\\`*_[\]<>#!]/g, "\\$&");
    return (
      source.slice(0, lineStart) +
      prefix +
      label +
      source.slice(
        lineEnd < 0
          ? source.length
          : lineEnd - (source[lineEnd - 1] === "\r" ? 1 : 0),
      )
    );
  }
  if (action === "delete")
    return (
      source.slice(0, lineStart) + source.slice(node.to).replace(/^\r?\n/, "")
    );
  const label = value.trim().replace(/[\\`*_[\]<>#!]/g, "\\$&");
  const indent = first.match(/^\s*/)?.[0] ?? "";
  const marker =
    node.kind === "heading"
      ? action === "child"
        ? node.depth < 6
          ? "#".repeat(node.depth + 1) + " "
          : "- "
        : "#".repeat(node.depth) + " "
      : indent + (action === "child" ? "  " : "") + "- ";
  const at = node.to;
  return (
    source.slice(0, at) + newline + marker + label + newline + source.slice(at)
  );
}
