import { $remark } from "@milkdown/kit/utils";
import { isSafeBreak } from "./markdown";

interface BreakNode {
  type: string;
  value?: unknown;
  children?: BreakNode[];
}

/** Convert inline BR only. Standalone placeholders belong to Crepe's empty-line
 * plugin; fenced code and JSON values are leaves and are never rewritten. */
export function normalizeInlineBreaks(node: BreakNode, parent?: BreakNode) {
  if (node.type === "html" && isSafeBreak(node.value) && parent) {
    const placeholder =
      (parent.type === "paragraph" || parent.type === "tableCell") &&
      parent.children?.length === 1;
    if (
      !placeholder &&
      [
        "paragraph",
        "heading",
        "tableCell",
        "link",
        "emphasis",
        "strong",
        "delete",
      ].includes(parent.type)
    ) {
      node.type = "break";
      delete node.value;
    }
  }
  node.children?.forEach((child) => normalizeInlineBreaks(child, node));
}

export const safeInlineBreaks = $remark(
  "inkstone-safe-inline-breaks",
  () => () => (tree) => normalizeInlineBreaks(tree),
);
