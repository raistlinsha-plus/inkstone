import type { Node } from "@milkdown/kit/prose/model";
import { parseMarkdown, type MarkdownNode } from "../content/blocks";

function inlineLeaves(block: MarkdownNode, node: Node, source: string) {
  if (
    !["paragraph", "heading"].includes(block.type) ||
    !["paragraph", "heading"].includes(node.type.name)
  )
    return null;
  const leaves: { value: string; from: number; to: number }[] = [];
  let valid = true;
  const visit = (part: MarkdownNode) => {
    if (part.type === "text" || part.type === "inlineCode") {
      const value = part.value ?? "",
        raw = source.slice(
          part.position.start.offset,
          part.position.end.offset,
        ),
        at = raw.indexOf(value);
      if (at < 0) {
        valid = false;
        return;
      }
      leaves.push({
        value,
        from: part.position.start.offset + at,
        to: part.position.start.offset + at + value.length,
      });
    } else part.children?.forEach(visit);
  };
  visit(block);
  return valid && leaves.map((leaf) => leaf.value).join("") === node.textContent
    ? leaves
    : null;
}
// Markdown offsets and ProseMirror positions have different units. Keep a
// top-level block anchor, then match nearby literal text within that block.
// Unknown/raw blocks still have a useful reading anchor at their beginning.
export function sourceFromVisual(
  doc: Node,
  position: number,
  source: string,
  affinity: "backward" | "forward" = "backward",
) {
  const resolved = doc.resolve(
    Math.max(0, Math.min(position, doc.content.size)),
  );
  const index = Math.min(resolved.index(0), doc.childCount - 1);
  const block = parseMarkdown(source).children?.filter(
    (node) => node.type !== "definition",
  )[index];
  if (!block || index < 0) return source.length;
  let start = 0;
  for (let i = 0; i < index; i++) start += doc.child(i).nodeSize;
  const node = doc.child(index);
  const local = Math.max(0, Math.min(node.content.size, position - start - 1));
  const leaves = inlineLeaves(block, node, source);
  if (leaves) {
    let length = 0;
    for (const leaf of leaves) {
      if (
        local < length + leaf.value.length ||
        (local === length + leaf.value.length && affinity === "backward")
      )
        return leaf.from + Math.max(0, local - length);
      length += leaf.value.length;
    }
    return leaves.at(-1)?.to ?? block.position.start.offset;
  }
  const context = node.textBetween(0, local, "\n", "").slice(-40);
  const raw = source.slice(
    block.position.start.offset,
    block.position.end.offset,
  );
  let match = context ? raw.indexOf(context) : -1;
  if (match >= 0) {
    for (
      let next = raw.indexOf(context, match + 1);
      next >= 0;
      next = raw.indexOf(context, next + 1)
    )
      if (
        Math.abs(next + context.length - local) <
        Math.abs(match + context.length - local)
      )
        match = next;
  }
  return block.position.start.offset + (match < 0 ? 0 : match + context.length);
}

export function visualFromSource(doc: Node, offset: number, source: string) {
  const blocks = (parseMarkdown(source).children ?? []).filter(
    (node) => node.type !== "definition",
  );
  if (
    offset >= source.length &&
    doc.childCount > blocks.length &&
    doc.lastChild?.type.name === "paragraph" &&
    !doc.lastChild.content.size
  )
    return Math.max(1, doc.content.size - 1);
  let index = blocks.findIndex((block) => block.position.end.offset >= offset);
  if (index < 0) index = blocks.length - 1;
  index = Math.max(0, Math.min(index, doc.childCount - 1));
  let start = 0;
  for (let i = 0; i < index; i++) start += doc.child(i).nodeSize;
  const block = blocks[index],
    node = doc.child(index);
  if (!block || !node) return Math.min(1, doc.content.size);
  const leaves = inlineLeaves(block, node, source);
  if (leaves) {
    let local = 0;
    for (const leaf of leaves) {
      if (offset <= leaf.to)
        return (
          start +
          1 +
          local +
          Math.max(0, Math.min(leaf.value.length, offset - leaf.from))
        );
      local += leaf.value.length;
    }
    return start + 1 + node.content.size;
  }
  const prefix = source.slice(
    block.position.start.offset,
    Math.max(block.position.start.offset, offset),
  );
  let local = 0;
  node.descendants((child, pos) => {
    if (!child.isText || !child.text) return;
    const at = prefix.lastIndexOf(child.text);
    if (at >= 0) local = pos + child.text.length;
    else {
      for (let length = Math.min(40, child.text.length); length > 0; length--) {
        const suffix = prefix.slice(-length);
        const match = child.text.indexOf(suffix);
        if (suffix && match >= 0) {
          local = pos + match + length;
          break;
        }
      }
    }
  });
  return Math.min(
    doc.content.size,
    start + 1 + Math.min(local, node.content.size),
  );
}
