import type { CanvasNode, MindChange } from "./editableMind";

export interface MindOffset { x: number; y: number }
export type MindPositions = Map<string, MindOffset>;
export const maxMindOffset = 1_000_000;


export function childPositionKey(parent: string, label: string, occurrence: number) {
  // Escape path separators and characters that terminate a host-format comment.
  const escaped = label.replace(/[%/:<>\-\r\n]/g, char => "%" + char.charCodeAt(0).toString(16).padStart(2, "0"));
  return parent + "/" + escaped + ":" + occurrence;
}

export function positionedMind(node: CanvasNode, positions: MindPositions, key = "$"): CanvasNode {
  const counts = new Map<string, number>();
  return {
    ...node, positionKey: key, offset: positions.get(key),
    children: node.children.map(child => {
      const occurrence = counts.get(child.label) ?? 0;
      counts.set(child.label, occurrence + 1);
      return positionedMind(child, positions, childPositionKey(key, child.label, occurrence));
    }),
  };
}

export function findTopic(node: CanvasNode, id: string): CanvasNode | undefined {
  if (node.id === id) return node;
  for (const child of node.children) {
    const match = findTopic(child, id);
    if (match) return match;
  }
}

// Re-parsing a text edit changes source line IDs. Pair the unaffected children
// in document order, including repeated captions. A reparented topic snaps to
// its new branch but carries its descendants' local adjustments with it.
export function transferPositions(before: CanvasNode, after: CanvasNode, edit: MindChange, selection?: string): MindPositions {
  const positions: MindPositions = new Map();
  const removed = edit.type === "delete" || edit.type === "move" ? edit.id : undefined;
  const inserted = ["move", "child", "sibling"].includes(edit.type) ? selection : undefined;
  function pair(a: CanvasNode, b: CanvasNode, keep = true) {
    if (a.label !== b.label && !(edit.type === "rename" && a.id === edit.id)) return;
    if (keep && a.offset && b.positionKey) positions.set(b.positionKey, a.offset);
    const oldChildren = a.children.filter(n => n.id !== removed);
    const newChildren = b.children.filter(n => n.id !== inserted);
    if (oldChildren.length === newChildren.length)
      oldChildren.forEach((child, i) => pair(child, newChildren[i]));
  }
  pair(before, after);
  if (edit.type === "move" && selection) {
    const a = findTopic(before, edit.id), b = findTopic(after, selection);
    if (a && b) pair(a, b, false);
  }
  return positions;
}
