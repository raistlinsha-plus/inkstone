import type { CanvasNode, MindChange, MindChangeResult } from "./editableMind";
import { translate as t } from "../i18n";

interface SourceNode {
  view: CanvasNode;
  parent?: SourceNode;
  indent: string;
  line: number;
  firstLine: number; // Include a leading comment attached by indentation.
  lastLine: number; // Last node in this subtree, inclusive.
  labelStart: number;
  labelEnd: number;
}
const delimiters = [
  ["((", "))", "circle"],
  ["))", "((", "bang"],
  ["{{", "}}", "hexagon"],
  ["[", "]", "rect"],
  ["(", ")", "rounded"],
  [")", "(", "cloud"],
] as const;
const nodeId = (line: number) => "m" + line;
const unsupported = () =>
  new Error(
    t(
      "此脑图使用了复杂 Mermaid 语法，请在源码中编辑。",
      "Edit this diagram in source to preserve its Mermaid syntax.",
    ),
  );

function readLabel(text: string) {
  // Rich labels and styling directives belong to the full Mermaid renderer.
  if (/[<>`]|::icon\s*\(|:::|%%|&(?:#\w+|\w+);|#(?!\d+;)\w+;/i.test(text))
    return null;
  for (const match of text.matchAll(/#(\d+);/g)) {
    const code = Number(match[1]);
    if (code < 32 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
      return null;
  }
  return text.replace(/#(\d+);/g, (_, value: string) =>
    String.fromCodePoint(Number(value)),
  );
}

function writeLabel(input: string) {
  const label = input.trim();
  if (!label || /[\u0000-\u001f\u007f]/.test(input))
    throw new Error(
      t("请输入一行节点名称。", "Enter a single-line node label."),
    );
  // Mermaid numeric entities preserve punctuation as display text in every shape,
  // including a bare, unboxed node. They never introduce Mermaid syntax.
  return label.replace(
    /[()[\]{}"#%<>`&:]|^m(?=indmap\b)/gi,
    (ch) => "#" + ch.codePointAt(0) + ";",
  );
}

function readNode(line: string) {
  const indent = line.match(/^[ \t]*/)![0];
  const body = line.slice(indent.length).trimEnd();
  const shapeAt = body.search(/[()[\]{}]/);
  let shape: CanvasNode["shape"] = "plain";
  let from = 0;
  let to = body.length;
  if (shapeAt >= 0) {
    const suffix = body.slice(shapeAt);
    const form = delimiters.find(
      ([start, end]) => suffix.startsWith(start) && suffix.endsWith(end),
    );
    if (!form) return null;
    shape = form[2];
    from = shapeAt + form[0].length;
    to -= form[1].length;
    // Only an ordinary identifier is safe to round-trip. Leave special forms
    // (including abbreviated icon or class syntax) in Mermaid’s native view.
    if (shapeAt && !/^[\p{L}\p{N}_\-.]+$/u.test(body.slice(0, shapeAt)))
      return null;
  } else if (/^mindmap\b/i.test(body)) return null;
  if (shapeAt >= 0 && body[from] === '"' && body[to - 1] === '"') {
    from++;
    to--;
    if (body.slice(from, to).includes('"')) return null;
  } else if (/[()[\]{}]/.test(body.slice(from, to))) return null;
  while (from < to && /\s/.test(body[from])) from++;
  while (to > from && /\s/.test(body[to - 1])) to--;
  const label = readLabel(body.slice(from, to));
  if (!label) return null;
  return {
    label,
    shape,
    indent,
    labelStart: indent.length + from,
    labelEnd: indent.length + to,
  };
}

function parse(source: string) {
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(eol);
  if (lines.some((line) => /[\r\n]/.test(line))) return null;
  const terminated = source.endsWith(eol);
  if (terminated) lines.pop();
  const rows = new Map<string, SourceNode>();
  const stack: SourceNode[] = [];
  let root: SourceNode | undefined;
  let header = false;
  let trivia = 0;
  for (const [lineNo, line] of lines.entries()) {
    const body = line.trim();
    if (!body || body.startsWith("%%")) {
      if (body.startsWith("%%{")) return null;
      continue;
    }
    if (!header) {
      if (!/^mindmap$/i.test(body)) return null;
      header = true;
      trivia = lineNo + 1;
      continue;
    }
    const parsed = readNode(line);
    if (!parsed || rows.size >= 500) return null;
    while (
      stack.length &&
      stack[stack.length - 1].indent.length >= parsed.indent.length
    )
      stack.pop();
    const parent = stack.at(-1);
    if (
      (!parent && root) ||
      (parent && !parsed.indent.startsWith(parent.indent))
    )
      return null;
    // In irregular indentation Mermaid may infer siblings from decreasing
    // columns. A source move could then change an unrelated node’s parent.
    const previous = parent?.view.children[0];
    if (previous && rows.get(previous.id)!.indent !== parsed.indent)
      return null;
    const view: CanvasNode = {
      id: nodeId(lineNo),
      label: parsed.label,
      shape: parsed.shape,
      children: [],
      editable: true,
      canAddChild: true,
      movable: !!parent,
    };
    let firstLine = lineNo;
    for (let i = lineNo - 1; i >= trivia; i--) {
      if (
        lines[i].trimStart().startsWith("%%") &&
        lines[i].startsWith(parsed.indent)
      )
        firstLine = i;
      else if (lines[i].trim()) break;
    }
    const node: SourceNode = {
      ...parsed,
      view,
      parent,
      line: lineNo,
      firstLine,
      lastLine: lineNo,
    };
    rows.set(view.id, node);
    if (parent) parent.view.children.push(view);
    else root = node;
    for (const ancestor of stack) ancestor.lastLine = lineNo;
    stack.push(node);
    trivia = lineNo + 1;
  }
  return root && { root, rows, lines, eol, terminated };
}

export function readMermaidMind(source: string): CanvasNode | null {
  return parse(source)?.root.view ?? null;
}

export function changeMermaidMind(
  source: string,
  change: MindChange,
): MindChangeResult {
  const doc = parse(source);
  if (!doc) throw unsupported();
  const node = doc.rows.get(change.id);
  if (!node)
    throw new Error(
      t(
        "节点已变化，请重新选择。",
        "Select the node again after the source change.",
      ),
    );
  const { lines, rows, root } = doc;
  function childIndent(parent: SourceNode) {
    const child = parent.view.children[0];
    if (child) return rows.get(child.id)!.indent;
    const rootChild = root.view.children[0];
    const step = parent.parent
      ? parent.indent.slice(parent.parent.indent.length)
      : rootChild
        ? rows.get(rootChild.id)!.indent.slice(root.indent.length)
        : parent.indent || "  ";
    return parent.indent + step;
  }
  let selectLine = node.line;
  if (change.type === "rename") {
    if (node.view.label === change.label.trim())
      return { source, selection: change.id };
    const line = lines[node.line];
    lines[node.line] =
      line.slice(0, node.labelStart) +
      writeLabel(change.label) +
      line.slice(node.labelEnd);
  } else if (change.type === "delete") {
    if (!node.parent)
      throw new Error(t("根节点必须保留。", "Keep the root node."));
    // Comments may document choices unrelated to the branch. Deleting nodes
    // keeps such notes and blank lines verbatim.
    const keep = lines
      .slice(node.line, node.lastLine + 1)
      .filter((line) => !line.trim() || line.trimStart().startsWith("%%"));
    lines.splice(node.line, node.lastLine - node.line + 1, ...keep);
    selectLine = node.parent.line;
  } else if (change.type === "move") {
    const target = rows.get(change.target);
    if (
      !target ||
      !node.parent ||
      (target.line >= node.line && target.line <= node.lastLine)
    )
      throw new Error(
        t("不能把节点移入自身分支。", "Choose a target outside this branch."),
      );
    if (!target.parent && change.placement !== "child")
      throw new Error(
        t("根节点只接受子节点。", "The root can only receive children."),
      );
    const indent =
      change.placement === "child" ? childIndent(target) : target.indent;
    let at =
      change.placement === "before" ? target.firstLine : target.lastLine + 1;
    const count = node.lastLine - node.firstLine + 1;
    const segment = lines.splice(node.firstLine, count);
    if (at > node.lastLine) at -= count;
    const shifted = segment.map((line) =>
      line.trim() && line.startsWith(node.indent)
        ? indent + line.slice(node.indent.length)
        : line,
    );
    lines.splice(at, 0, ...shifted);
    selectLine = at + node.line - node.firstLine;
  } else {
    if (change.type === "sibling" && !node.parent)
      throw new Error(
        t("根节点没有同级节点。", "The root cannot have siblings."),
      );
    selectLine = node.lastLine + 1;
    const indent = change.type === "child" ? childIndent(node) : node.indent;
    lines.splice(selectLine, 0, indent + writeLabel(change.label));
  }
  return {
    source: lines.join(doc.eol) + (doc.terminated ? doc.eol : ""),
    selection: nodeId(selectLine),
  };
}
