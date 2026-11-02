// @vitest-environment jsdom
import { useImperativeHandle, type Ref } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { EditorHandle } from "../TextEditor";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState, TextSelection } from "@milkdown/kit/prose/state";
import { history, undo } from "@milkdown/kit/prose/history";
import type { EditorView } from "@milkdown/kit/prose/view";
import { insertBlock } from "../rich/blocks";
import { chartTemplate, parseChart } from "../content/chart";
import { codeBlocks } from "../content/blocks";
vi.mock("../TextEditor", () => ({
  default: ({
    content,
    handleRef,
  }: {
    content: string;
    handleRef: Ref<EditorHandle>;
  }) => {
    useImperativeHandle(handleRef, () => ({
      getContent: () => content,
      insertBlock() {},
      runInsertCommand() {},
      closeMenus() {},
      captureSelection: () => ({ mode: "source", head: 0 }),
      insertMarkdown() {},
    }));
    return <textarea aria-label="隔离源码适配" value={content} readOnly />;
  },
}));
vi.mock("./Graph", () => ({ default: () => <div>本地安全图形</div> }));
import Editor from "../Editor";
afterEach(cleanup);
test("actual chart insertion uses one transaction, keeps caret neighbors and can be undone", () => {
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
  const before = schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null, schema.text("前半后半")),
    schema.nodes.paragraph.create(null, schema.text("相邻正文")),
  ]);
  let state = EditorState.create({ schema, doc: before, plugins: [history()] });
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, 3)),
  );
  const transactions: any[] = [];
  const view = {
    state,
    composing: false,
    focus() {},
    dispatch(tr: any) {
      transactions.push(tr);
      view.state = view.state.apply(tr);
    },
  } as unknown as EditorView;
  expect(insertBlock(view, "chart")).toBe(true);
  expect(transactions).toHaveLength(1);
  expect(view.state.doc.child(0).textContent).toBe("前半");
  expect(view.state.doc.child(1).attrs.language).toBe("chart");
  expect(parseChart(view.state.doc.child(1).textContent).type).toBe("bar");
  expect(view.state.doc.child(2).textContent).toBe("后半");
  expect(view.state.doc.child(3).textContent).toBe("相邻正文");
  expect(undo(view.state, view.dispatch)).toBe(true);
  expect(view.state.doc.eq(before)).toBe(true);
});
test("the real split reader applies one chart edit and one Editor undo restores the entire Markdown", () => {
  const second = chartTemplate
    .replace('"type": "bar"', '"type": "line"')
    .replace('"季度收入"', '"另一张图"');
  const original =
    "# 混排\n\n前文保持。\n\n```chart\n" +
    chartTemplate +
    '\n```\n\n```json\n{"id":9007199254740993,"values":[1]}\n```\n\n```chart\n' +
    second +
    "\n```\n\n后文保持。\n";
  const changes = vi.fn();
  render(
    <Editor
      content={original}
      mode="split"
      path="chart-review.md"
      onChange={changes}
      onError={vi.fn()}
    />,
  );
  const first = screen.getAllByRole("region", { name: "数据图表" })[0];
  fireEvent.click(within(first).getByRole("button", { name: "编辑图表" }));
  fireEvent.change(
    within(first).getByRole("textbox", { name: "收入 第 2 项数值" }),
    { target: { value: "155" } },
  );
  fireEvent.click(within(first).getByRole("button", { name: "应用图表修改" }));
  expect(changes).toHaveBeenCalledTimes(1);
  const updated = changes.mock.calls[0][0];
  const blocks = codeBlocks(updated);
  expect(parseChart(blocks[0].text).series[0].values[1]).toBe(155);
  expect(blocks[1].text).toBe('{"id":9007199254740993,"values":[1]}');
  expect(blocks[2].text).toBe(second);
  fireEvent.click(screen.getByRole("button", { name: /^撤销$/ }));
  expect(changes.mock.calls.at(-1)?.[0]).toBe(original);
});
