import type { CanvasNode } from "../content/editableMind";

export type FoldKey = string | CanvasNode;

export function mindBranches(root: CanvasNode) {
  const branches = new Map<string, { key: FoldKey; count: number }>();
  function index(node: CanvasNode, path: string[] | undefined): number {
    const names = new Set<string>();
    const duplicates = new Set<string>();
    for (const child of node.children) {
      if (names.has(child.label)) duplicates.add(child.label);
      names.add(child.label);
    }
    let count = 0;
    for (const child of node.children) {
      const childPath =
        path && !duplicates.has(child.label)
          ? [...path, child.label]
          : undefined;
      count += 1 + index(child, childPath);
    }
    // An ambiguous branch is valid only for this parse. Never carry a fold to
    // a different topic when duplicate captions or source line numbers shift.
    if (count)
      branches.set(node.id, { key: path ? JSON.stringify(path) : node, count });
    return count;
  }
  index(root, []);
  return branches;
}

export function visibleMind(
  root: CanvasNode,
  branches: ReturnType<typeof mindBranches>,
  folded: Set<FoldKey>,
): CanvasNode {
  if (!folded.size) return root;
  function visit(node: CanvasNode): CanvasNode {
    const info = branches.get(node.id);
    if (!info) return node;
    return {
      ...node,
      children: folded.has(info.key) ? [] : node.children.map(visit),
    };
  }
  return visit(root);
}
