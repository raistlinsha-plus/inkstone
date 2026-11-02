import { expect, test, vi } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { insertBlock, blockAction } from "./blocks";
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "text*", group: "block" },
    text: { group: "inline" },
    code_block: {
      content: "text*",
      group: "block",
      code: true,
      attrs: { language: { default: "" } },
    },
  },
});
function setup(offset: number) {
  const p = (s: string) => schema.nodes.paragraph.create(null, schema.text(s));
  let state = EditorState.create({
    schema,
    doc: schema.nodes.doc.create(null, [p("第一段正文"), p("第二段正文")]),
  });
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, offset)),
  );
  const view = {
    state,
    composing: false,
    dispatch(tr: any) {
      view.state = view.state.apply(tr);
    },
    focus: vi.fn(),
  } as unknown as EditorView;
  return view;
}
test("insertion splits at the caret and retains both surrounding paragraphs", () => {
  const view = setup(3);
  expect(insertBlock(view, "json")).toBe(true);
  const children: any[] = [];
  view.state.doc.forEach((n) => children.push(n));
  expect(children.map((n) => n.type.name)).toEqual([
    "paragraph",
    "code_block",
    "paragraph",
    "paragraph",
  ]);
  expect(children[0].textContent).toBe("第一");
  expect(children[2].textContent).toBe("段正文");
  expect(children[3].textContent).toBe("第二段正文");
});
test("duplicating moving and removing one block preserves its neighbors", () => {
  const view = setup(6);
  insertBlock(view, "mindmap");
  let pos = -1;
  view.state.doc.descendants((n, p) => {
    if (n.type.name === "code_block") pos = p;
  });
  const source = view.state.doc.textContent;
  blockAction(view, () => pos, "duplicate");
  expect(view.state.doc.textContent).toBe(
    source.replace(
      "# 中心主题\n\n- 分支一\n- 分支二",
      "# 中心主题\n\n- 分支一\n- 分支二".repeat(2),
    ),
  );
  blockAction(view, () => pos, "delete");
  expect(view.state.doc.textContent).toBe(source);
});
test("insertion waits for IME composition to finish", () => {
  const view = setup(3);
  Object.defineProperty(view, "composing", { value: true });
  expect(insertBlock(view, "json")).toBe(false);
  expect(view.state.doc.childCount).toBe(2);
});

test("duplicated calendars get independent block and event identities", () => {
  const view = setup(3);
  insertBlock(view, "calendar", "month");
  let pos = -1;
  view.state.doc.descendants((node, p) => {
    if (node.type.name === "code_block") pos = p;
  });
  const original = JSON.parse(view.state.doc.nodeAt(pos)!.textContent);
  expect(original.view).toBe("month");
  original.events.push({
    id: crypto.randomUUID(),
    title: "评审",
    start: "2026-10-28T10:00:00Z",
    end: "2026-10-28T11:00:00Z",
    timeZone: "UTC",
    allDay: false,
    status: "planned",
    notes: "",
  });
  const calendarNode = view.state.doc.nodeAt(pos)!;
  view.dispatch(
    view.state.tr.insertText(
      JSON.stringify(original),
      pos + 1,
      pos + calendarNode.nodeSize - 1,
    ),
  );
  blockAction(view, () => pos, "duplicate");
  const calendars: any[] = [];
  view.state.doc.descendants((node) => {
    if (node.type.name === "code_block")
      calendars.push(JSON.parse(node.textContent));
  });
  expect(calendars).toHaveLength(2);
  expect(calendars[0].id).not.toBe(calendars[1].id);
  expect(calendars[0].events.map((e: any) => e.id)).not.toEqual(
    calendars[1].events.map((e: any) => e.id),
  );
  expect(calendars[0].view).toBe(calendars[1].view);
});
