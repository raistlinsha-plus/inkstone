import { calendarTemplate, cloneCalendarSource } from "../content/calendar";
import { chartTemplate } from "../content/chart";
import type { EditorView } from "@milkdown/kit/prose/view";
import { TextSelection, NodeSelection } from "@milkdown/kit/prose/state";
export type BlockKind = "json" | "mermaid" | "mindmap" | "calendar" | "chart";
export const blockTypes: Record<BlockKind, { label: string; source: string }> =
  {
    json: { label: "JSON 数据", source: '{\n  "名称": "新内容"\n}' },
    mermaid: {
      label: "Mermaid 图表",
      source: "flowchart LR\n  A[开始] --> B[完成]",
    },
    calendar: { label: "日程日历", source: "" },
    chart: { label: "数据图表", source: chartTemplate },
    mindmap: { label: "脑图", source: "# 中心主题\n\n- 分支一\n- 分支二" },
  };
export const blockSource = (
  kind: BlockKind,
  view: "agenda" | "month" = "agenda",
) => (kind === "calendar" ? calendarTemplate(view) : blockTypes[kind].source);
export function insertBlock(
  view: EditorView,
  kind: BlockKind,
  calendarView: "agenda" | "month" = "agenda",
) {
  if (view.composing) return false;
  const { schema } = view.state;
  const node = schema.nodes.code_block.create(
    { language: kind },
    schema.text(blockSource(kind, calendarView)),
  );
  const tr = view.state.tr
    .replaceSelectionWith(node)
    .setMeta("inkstone-structure", true);
  let found = -1;
  tr.doc.descendants((n, pos) => {
    if (n === node) found = pos;
  });
  if (found < 0) return false;
  const after = found + node.nodeSize;
  if (tr.doc.nodeAt(after)?.type !== schema.nodes.paragraph)
    tr.insert(after, schema.nodes.paragraph.create());
  tr.setSelection(
    TextSelection.near(
      tr.doc.resolve(Math.min(after + 1, tr.doc.content.size)),
    ),
  );
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}
export function blockAction(
  view: EditorView,
  getPos: () => number | undefined,
  action: "delete" | "duplicate" | "up" | "down" | "after" | "select",
) {
  const pos = getPos();
  if (pos === undefined) throw Error("内容块已移除");
  const node = view.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "code_block") throw Error("内容块已变化");
  let tr = view.state.tr;
  if (action === "select") tr.setSelection(NodeSelection.create(tr.doc, pos));
  else if (action === "delete") tr.delete(pos, pos + node.nodeSize);
  else if (action === "duplicate") {
    const copy =
      String(node.attrs.language).toLowerCase() === "calendar"
        ? node.type.create(
            node.attrs,
            view.state.schema.text(cloneCalendarSource(node.textContent)),
          )
        : node.copy(node.content);
    tr.insert(pos + node.nodeSize, copy);
  } else if (action === "after") {
    const end = pos + node.nodeSize;
    if (tr.doc.nodeAt(end)?.type.name !== "paragraph")
      tr.insert(end, view.state.schema.nodes.paragraph.create());
    tr.setSelection(TextSelection.near(tr.doc.resolve(end + 1)));
  } else {
    const resolved = tr.doc.resolve(pos);
    if (resolved.depth !== 0) throw Error("嵌套块请在源码中调整位置");
    const neighbor =
      action === "up"
        ? resolved.nodeBefore
        : tr.doc.resolve(pos + node.nodeSize).nodeAfter;
    if (!neighbor) return;
    tr.delete(pos, pos + node.nodeSize).insert(
      action === "up" ? pos - neighbor.nodeSize : pos + neighbor.nodeSize,
      node,
    );
  }
  view.dispatch(tr.setMeta("inkstone-structure", true).scrollIntoView());
  if (action === "after" || action === "delete") view.focus();
}
