import { Slice, type Node } from "@milkdown/kit/prose/model";
import { TextSelection } from "@milkdown/kit/prose/state";
import { closeHistory } from "@milkdown/kit/prose/history";
import type { EditorView } from "@milkdown/kit/prose/view";

// One explicit insertion transaction. A caret within prose splits that prose;
// a boundary after a noneditable block inserts after it, never inside its code.
export function insertMarkdownDocument(
  view: EditorView,
  parsed: Node,
  position: number,
) {
  if (view.composing) throw Error("请先完成当前输入。");
  if (!Number.isInteger(position)) throw Error("插入位置无效，请重新选择。");
  const head = Math.max(0, Math.min(position, view.state.doc.content.size));
  const resolved = view.state.doc.resolve(head);
  let tr = view.state.tr;
  if (resolved.depth === 0) {
    tr.insert(head, parsed.content);
    const end = head + parsed.content.size;
    if (
      tr.doc.nodeAt(end)?.type.name !== "paragraph" &&
      parsed.lastChild?.type.name !== "paragraph"
    )
      tr.insert(end, view.state.schema.nodes.paragraph.create());
    tr.setSelection(
      TextSelection.near(
        tr.doc.resolve(Math.min(end + 1, tr.doc.content.size)),
      ),
    );
  } else
    tr.setSelection(TextSelection.near(resolved)).replaceSelection(
      new Slice(parsed.content, 0, 0),
    );
  view.dispatch(
    closeHistory(tr).setMeta("inkstone-structure", true).scrollIntoView(),
  );
  // Future typing must not join the answer in ProseMirror's own history either.
  view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
}
