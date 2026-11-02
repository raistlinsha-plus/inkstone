// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { act } from "react";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState } from "@milkdown/kit/prose/state";
import { EditorView } from "@milkdown/kit/prose/view";
import { ContentBlockView } from "./plugin";
import { identityPlugin, blockIdentityKey } from "./identity";
import { blockAction } from "./blocks";
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "text*", group: "block", toDOM: () => ["p", 0] },
    text: { group: "inline" },
    code_block: {
      content: "text*",
      group: "block",
      code: true,
      attrs: { language: { default: "" } },
      toDOM: () => ["pre", ["code", 0]],
    },
  },
});
test("real PM NodeViews keep a pending draft attached to its block when another identical block moves and duplicates", async () => {
  (
    globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const scope = "nodeview-test:" + crypto.randomUUID();
  const source =
    '```json\n{"title":"相同"}\n```\n\n```json\n{"title":"相同"}\n```';
  const code = () =>
    schema.nodes.code_block.create(
      { language: "json" },
      schema.text('{"title":"相同"}'),
    );
  const mount = document.createElement("div");
  document.body.append(mount);
  const rect = {
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  };
  const rectsDescriptor = Object.getOwnPropertyDescriptor(
    Range.prototype,
    "getClientRects",
  );
  const boundsDescriptor = Object.getOwnPropertyDescriptor(
    Range.prototype,
    "getBoundingClientRect",
  );
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  // jsdom does not lay out Range rectangles, but all document/state updates and
  // React NodeViews below are the production implementations.
  Range.prototype.getBoundingClientRect = () => rect;
  let view!: EditorView;
  await act(async () => {
    view = new EditorView(mount, {
      state: EditorState.create({
        schema,
        doc: schema.nodes.doc.create(null, [code(), code()]),
        plugins: [identityPlugin(scope, source)],
      }),
      nodeViews: {
        code_block: (node, editor, getPos) =>
          new ContentBlockView(node, editor, getPos, () => {}, scope),
      },
    });
  });
  try {
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: "修改 title" }),
      ).toHaveLength(2),
    );
    const second = screen.getAllByRole("region", {
      name: "JSON 数据内容块",
    })[1];
    fireEvent.click(within(second).getByRole("button", { name: "修改 title" }));
    fireEvent.change(within(second).getByLabelText("JSON 字段值"), {
      target: { value: "B未提交草稿" },
    });
    const [a, b] = blockIdentityKey.getState(view.state)!;
    await act(async () => blockAction(view, () => a.pos, "down"));
    await waitFor(() =>
      expect(
        (screen.getByLabelText("JSON 字段值") as HTMLTextAreaElement).value,
      ).toBe("B未提交草稿"),
    );
    expect(
      blockIdentityKey.getState(view.state)!.map((entry) => entry.id),
    ).toEqual([b.id, a.id]);
    expect(
      within(
        screen.getAllByRole("region", { name: "JSON 数据内容块" })[0],
      ).getByLabelText("JSON 字段值"),
    ).toBeTruthy();
    await act(async () =>
      blockAction(
        view,
        () => blockIdentityKey.getState(view.state)![1].pos,
        "duplicate",
      ),
    );
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: "修改 title" }),
      ).toHaveLength(3),
    );
    expect(screen.getAllByLabelText("JSON 字段值")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "应用修改" }));
    expect(view.state.doc.child(0).textContent).toContain("B未提交草稿");
    expect(view.state.doc.child(1).textContent).toBe('{"title":"相同"}');
    expect(view.state.doc.child(2).textContent).toBe('{"title":"相同"}');
  } finally {
    await act(async () => {
      view.destroy();
      await Promise.resolve();
    });
    mount.remove();
    if (rectsDescriptor)
      Object.defineProperty(Range.prototype, "getClientRects", rectsDescriptor);
    else
      delete (Range.prototype as unknown as Record<string, unknown>)
        .getClientRects;
    if (boundsDescriptor)
      Object.defineProperty(
        Range.prototype,
        "getBoundingClientRect",
        boundsDescriptor,
      );
    else
      delete (Range.prototype as unknown as Record<string, unknown>)
        .getBoundingClientRect;
    vi.restoreAllMocks();
  }
});
