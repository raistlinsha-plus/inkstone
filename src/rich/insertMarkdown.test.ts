import { expect, test, vi } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState, TextSelection } from "@milkdown/kit/prose/state";
import { history, undo } from "@milkdown/kit/prose/history";
import type { EditorView } from "@milkdown/kit/prose/view";
import { DocumentSession } from "../session";
import { insertMarkdownDocument } from "./insertMarkdown";
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
const p = (text: string) =>
  schema.nodes.paragraph.create(null, schema.text(text));
const text = (state: EditorState) =>
  state.doc.content.content
    .map((node) =>
      node.type.name === "code_block"
        ? "```" + node.attrs.language + "\n" + node.textContent + "\n```"
        : node.textContent,
    )
    .join("\n\n");
function setup() {
  const state = EditorState.create({
    schema,
    doc: schema.nodes.doc.create(null, [p("前段后段"), p("末段")]),
    plugins: [history()],
  });
  const view = {
    state,
    composing: false,
    focus: vi.fn(),
    dispatch(tr: any) {
      view.state = view.state.apply(tr);
    },
  };
  return view as unknown as EditorView;
}
test("real PM insertion splits prose and one undo removes only the answer, retaining immediately preceding typing", () => {
  const view = setup();
  view.dispatch(view.state.tr.insertText("新输入", 3));
  const before = text(view.state),
    session = new DocumentSession("原文");
  session.commit(before, "visual", 100);
  const parsed = schema.nodes.doc.create(null, [p("回答标题"), p("回答内容")]);
  insertMarkdownDocument(view, parsed, 6);
  const after = text(view.state);
  session.commit(after, "structure", 101);
  expect(after).toContain("回答标题\n\n回答内容");
  expect(after).toContain("新输入");
  expect(after).toContain("末段");
  expect(session.undo()).toBe(true);
  expect(session.content).toBe(before);
  expect(undo(view.state, (tr) => view.dispatch(tr))).toBe(true);
  expect(text(view.state)).toBe(before);
});
test("an answer captured at a selected final iframe/code block inserts after it and never edits its source", () => {
  const view = setup();
  const code = schema.nodes.code_block.create(
    { language: "json" },
    schema.text('{"exact":9007199254740993}'),
  );
  view.dispatch(
    view.state.tr.replaceWith(0, view.state.doc.content.size, code),
  );
  insertMarkdownDocument(
    view,
    schema.nodes.doc.create(null, [p("后续回答")]),
    code.nodeSize,
  );
  expect(view.state.doc.child(0).textContent).toBe(
    '{"exact":9007199254740993}',
  );
  expect(view.state.doc.child(0).type.name).toBe("code_block");
  expect(view.state.doc.child(1).textContent).toBe("后续回答");
});
test("IME composition rejects insertion before dispatching any changes", () => {
  const view = setup(),
    before = view.state.doc;
  Object.defineProperty(view, "composing", { value: true });
  expect(() =>
    insertMarkdownDocument(view, schema.nodes.doc.create(null, [p("回答")]), 3),
  ).toThrow("完成当前输入");
  expect(view.state.doc).toBe(before);
});
