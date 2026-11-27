import { translate as t } from "../i18n";
import { checkMindCapacity, type CanvasNode, type MindChange, type MindChangeResult } from "./editableMind";
import { parseMarkdown } from "./blocks";
import { flattenMind, outlineTree, type MindNode } from "./mindmap";

function visibleRoot(root: MindNode) {
  const first = root.children[0];
  return root.children.length === 1 &&
    first.kind === "heading" &&
    first.depth === 1
    ? first
    : root;
}

// Keep line endings with their original lines, including mixed LF/CRLF files.
function linesOf(source: string) {
  return source.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) ?? [];
}
function syntax(lines: string[], node: MindNode) {
  if (node.kind === "root") return undefined;
  const line = lines[node.line - 1].replace(/(?:\r\n|[\r\n])$/, "");
  const match = /^( *)(#{1,6}|[-+*])( +)(.*)$/.exec(line);
  if (!match || (node.kind === "heading") !== match[2].startsWith("#"))
    return undefined;
  return { indent: match[1], marker: match[2], gap: match[3], body: match[4] };
}

// A plain H1 can still be renamed when one of its children contains prose.
function plainRootTitle(node: MindNode, root: MindNode, lines: string[]) {
  if (node !== root || node.kind !== "heading" || !syntax(lines, node))
    return false;
  const heading = parseMarkdown(lines[node.line - 1]).children?.[0];
  return (
    heading?.type === "heading" &&
    !!heading.children?.every((child) => child.type === "text")
  );
}

export function readMarkdownMind(source: string, title: string): CanvasNode {
  const root = visibleRoot(outlineTree(source));
  const lines = linesOf(source);
  function visit(node: MindNode): CanvasNode {
    const simple = node.editable && !!syntax(lines, node);
    return {
      id: node.id,
      label: node.kind === "root" ? title : node.label,
      editable: simple || plainRootTitle(node, root, lines),
      canAddChild: node.kind === "root" || simple,
      movable: node !== root && simple,
      children: node.children.map(visit),
    };
  }
  return visit(root);
}

const unsafeEdit = () =>
  new Error(
    t(
      "此操作会改变其他 Markdown 内容，请在源码中编辑。",
      "This change would affect other Markdown content. Edit it in source view.",
    ),
  );
const invalidDrop = () =>
  new Error(
    t(
      "请选择其他分支中的目标节点。",
      "Choose a destination outside this branch.",
    ),
  );
function labelText(value: string) {
  if (!value.trim() || /[\r\n]/.test(value))
    throw new Error(
      t(
        "请输入一行非空的节点名称。",
        "Enter a nonempty, single-line node name.",
      ),
    );
  // Escape Markdown syntax, including GFM checkboxes, autolinks and strikethrough.
  return value.trim().replace(/[\\`*_\[\]<>#|&~.:@!=+\-]/g, "\\$&");
}

interface Prefix {
  indent: string;
  marker: string;
  gap: string;
}
const bullet = (): Prefix => ({ indent: "", marker: "-", gap: " " });
function below(parent: Prefix, original?: Prefix): Prefix {
  if (parent.marker.startsWith("#")) {
    if (original?.marker.startsWith("#") && parent.marker.length < 6)
      return { ...original, marker: parent.marker + "#" };
    return original && !original.marker.startsWith("#")
      ? { ...original, indent: "" }
      : bullet();
  }
  return {
    indent:
      parent.indent + " ".repeat(parent.marker.length + parent.gap.length),
    marker:
      original && !original.marker.startsWith("#")
        ? original.marker
        : parent.marker,
    gap: original?.gap ?? " ",
  };
}
function prefixText(p: Prefix) {
  return p.indent + p.marker + p.gap;
}

// Reparse after each patch. Besides guarding CommonMark edge cases, using the
// new tree gives back the correct selected node even when captions repeat.
function selectionAfter(
  expected: MindNode,
  actual: MindNode,
  selected: MindNode,
): string | undefined {
  if (
    actual.label !== expected.label ||
    actual.children.length !== expected.children.length
  )
    throw unsafeEdit();
  let id = expected === selected ? actual.id : undefined;
  expected.children.forEach((child, i) => {
    const match = selectionAfter(child, actual.children[i], selected);
    if (match) id = match;
  });
  return id;
}

export function changeMarkdownMind(
  source: string,
  _title: string,
  change: MindChange,
): MindChangeResult {
  const root = outlineTree(source);
  const visible = visibleRoot(root);
  const nodes = flattenMind(root);
  checkMindCapacity(nodes.length - (visible === root ? 0 : 1), change);
  const parents = new Map(
    nodes.flatMap((n) => n.children.map((child) => [child, n] as const)),
  );
  const node = nodes.find((n) => n.id === change.id);
  if (!node || (node === root && visible !== root)) throw unsafeEdit();
  const lines = linesOf(source);
  const newline = source.match(/\r\n|[\r\n]/)?.[0] ?? "\n";
  const prefix = syntax(lines, node);
  const simple = !!prefix && node.editable;
  if (
    !simple &&
    !(node === root && change.type === "child") &&
    !(change.type === "rename" && plainRootTitle(node, visible, lines))
  )
    throw unsafeEdit();
  let selected = node;

  const endOf = (n: MindNode) => {
    if (n.kind === "root") return lines.length;
    if (n.kind === "heading")
      return (
        (nodes.find(
          (next) =>
            next.line > n.line &&
            next.kind === "heading" &&
            next.depth <= n.depth,
        )?.line ?? lines.length + 1) - 1
      );
    return source.slice(0, n.to).split(/\r\n|[\r\n]/).length;
  };
  const lastLine = (n: MindNode) =>
    Math.max(...flattenMind(n).map((d) => d.line));
  function branchRows(n: MindNode) {
    const positions = new Set(flattenMind(n).map((d) => d.line - 1));
    const start = n.line - 1,
      end = lastLine(n);
    for (let i = start; i < end; i++)
      if (!positions.has(i) && lines[i].trim()) throw unsafeEdit();
    return { start, end };
  }

  if (change.type === "rename") {
    const label = labelText(change.label);
    const suffix =
      prefix!.body.match(
        node.kind === "heading" ? /( +#+ *)$|( *)$/ : / *$/,
      )?.[0] ?? "";
    lines[node.line - 1] =
      prefixText(prefix!) +
      label +
      suffix +
      (lines[node.line - 1].match(/\r\n$|[\r\n]$/)?.[0] ?? "");
    node.label = change.label.trim();
  } else if (change.type === "delete") {
    if (node === visible) throw unsafeEdit();
    selected = parents.get(node)!;
    if (flattenMind(node).some((n) => !syntax(lines, n))) throw unsafeEdit();
    const span = branchRows(node);
    lines.splice(span.start, span.end - span.start);
    selected.children.splice(selected.children.indexOf(node), 1);
  } else {
    const move = change.type === "move";
    const target = move ? nodes.find((n) => n.id === change.target) : node;
    if (
      !target ||
      (move && (node === visible || flattenMind(node).includes(target)))
    )
      throw invalidDrop();
    const placement = move
      ? change.placement
      : change.type === "child"
        ? "child"
        : "after";
    if (target === visible && placement !== "child") throw unsafeEdit();
    if (target !== root && (!target.editable || !syntax(lines, target)))
      throw unsafeEdit();
    const parent = placement === "child" ? target : parents.get(target)!;
    const anchor = placement === "child" ? target.children.at(-1) : target;
    let at = placement === "before" ? target.line - 1 : endOf(target);
    const dest = anchor && syntax(lines, anchor);
    let layout: Prefix;
    if (dest) layout = dest;
    else if (parent.kind === "root") layout = bullet();
    else {
      const parentStyle = syntax(lines, parent);
      if (!parentStyle) throw unsafeEdit();
      layout = below(parentStyle, move ? prefix : undefined);
    }

    if (move) {
      const span = branchRows(node);
      const moved = lines.slice(span.start, span.end);
      function reindent(n: MindNode, style: Prefix) {
        const original = syntax(lines, n);
        if (!original) throw unsafeEdit();
        const index = n.line - 1 - span.start;
        const body =
          n.kind === "heading" && !style.marker.startsWith("#")
            ? original.body.replace(/ +#+ *$/, "")
            : original.body;
        moved[index] =
          prefixText(style) +
          body +
          (moved[index].match(/\r\n$|[\r\n]$/)?.[0] ?? "");
        for (const child of n.children)
          reindent(child, below(style, syntax(lines, child)));
      }
      reindent(node, layout);
      lines.splice(span.start, span.end - span.start);
      if (at >= span.end) at -= span.end - span.start;
      lines.splice(at, 0, ...moved);
      const oldParent = parents.get(node)!;
      oldParent.children.splice(oldParent.children.indexOf(node), 1);
    } else {
      const caption = change.label.trim();
      lines.splice(
        at,
        0,
        prefixText(layout) + labelText(change.label) + newline,
      );
      selected = { ...node, label: caption, children: [] };
    }
    const slot =
      placement === "child"
        ? parent.children.length
        : parent.children.indexOf(target) + (placement === "after" ? 1 : 0);
    parent.children.splice(slot, 0, selected);
  }

  const output = lines
    .map((line, i) => {
      if (i === lines.length - 1 && source && !/[\r\n]$/.test(source))
        return line.replace(/(?:\r\n|[\r\n])$/, "");
      return /[\r\n]$/.test(line) ? line : line + newline;
    })
    .join("");
  const parsed = outlineTree(output);
  const selection = selectionAfter(root, parsed, selected);
  return {
    source: output,
    selection: selected.kind === "root" ? visibleRoot(parsed).id : selection,
  };
}
