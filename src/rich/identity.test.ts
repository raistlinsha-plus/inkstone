import { expect, test, vi } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { blockAction } from "./blocks";
import {
  blockIdentityKey,
  identityPlugin,
  rememberVisualBlockIdentities,
  restoreBlockIdentity,
} from "./identity";
import { contentBlockIdentities } from "../preview/blockIdentity";
import { loadBlockDraft, saveBlockDraft } from "../preview/drafts";
import { visibleCodeIndices } from "./markdown";
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
const code = (text = '{"same":1}', language = "json") =>
  schema.nodes.code_block.create({ language }, schema.text(text));
const serialize = (state: EditorState) =>
  state.doc.content.content
    .map((n) => "```" + n.attrs.language + "\n" + n.textContent + "\n```")
    .join("\n\n");
function setup() {
  const scope = "identity-test:" + crypto.randomUUID(),
    doc = schema.nodes.doc.create(null, [code(), code()]);
  const source = doc.content.content
    .map((n) => "```json\n" + n.textContent + "\n```")
    .join("\n\n");
  const state = EditorState.create({
    schema,
    doc,
    plugins: [identityPlugin(scope, source)],
  });
  const view = {
    state,
    composing: false,
    focus: vi.fn(),
    dispatch(tr: any) {
      view.state = view.state.apply(tr);
    },
  } as unknown as EditorView;
  return { scope, source, view };
}
const entries = (view: EditorView) => blockIdentityKey.getState(view.state)!;
test("moving one of two identical JSON blocks preserves both identities and the other block draft", () => {
  const { scope, view } = setup();
  const [a, b] = entries(view);
  saveBlockDraft(`${scope}:block:${b.id}:json`, b.node.textContent, {
    value: "尚未提交的B",
  });
  blockAction(view, () => a.pos, "down");
  expect(entries(view).map((e) => e.id)).toEqual([b.id, a.id]);
  expect(
    loadBlockDraft(`${scope}:block:${b.id}:json`, b.node.textContent),
  ).toEqual({ value: "尚未提交的B" });
  rememberVisualBlockIdentities(scope, serialize(view.state), view.state);
  expect(contentBlockIdentities(scope, serialize(view.state))).toEqual([
    b.id,
    a.id,
  ]);
});
test("duplicating an identical node receives a new key and deleting its neighbor never transfers the old key", () => {
  const { view } = setup();
  const [a, b] = entries(view);
  blockAction(view, () => a.pos, "duplicate");
  const current = entries(view);
  expect(current.map((e) => e.id)).toEqual([a.id, expect.any(String), b.id]);
  expect(current[1].id).not.toBe(a.id);
  expect(current[1].id).not.toBe(b.id);
  const duplicate = current[1].id;
  blockAction(view, () => entries(view)[0].pos, "delete");
  expect(entries(view).map((e) => e.id)).toEqual([duplicate, b.id]);
});
test("whole-document undo restores prior block identities, including indistinguishable duplicate sources", () => {
  const { view, scope, source } = setup();
  const oldDoc = view.state.doc,
    [a, b] = entries(view);
  rememberVisualBlockIdentities(scope, source, view.state);
  blockAction(view, () => a.pos, "delete");
  rememberVisualBlockIdentities(scope, serialize(view.state), view.state);
  view.dispatch(
    view.state.tr
      .replaceWith(0, view.state.doc.content.size, oldDoc.content)
      .setMeta(restoreBlockIdentity, source),
  );
  expect(entries(view).map((e) => e.id)).toEqual([a.id, b.id]);
});
test("editing content preserves its key while the untouched neighboring block retains its draft owner", () => {
  const { view } = setup();
  const [a, b] = entries(view);
  view.dispatch(view.state.tr.insertText("2", a.pos + 9, a.pos + 10));
  expect(entries(view).map((e) => e.id)).toEqual([a.id, b.id]);
});
test("fences hidden inside a protected reference list do not consume the visible block identity", () => {
  const scope = "identity-hidden:" + crypto.randomUUID();
  const source =
    '- <span>[链接][ref]</span>\n\n  ```json\n  {"same":1}\n  ```\n\n[ref]: target.md\n\n```json\n{"same":1}\n```';
  expect(visibleCodeIndices(source)).toEqual([1]);
  const keys = contentBlockIdentities(scope, source);
  const doc = schema.nodes.doc.create(null, [
    code("list source", "inkstone-raw-x"),
    code("[ref]: target.md", "inkstone-raw-x"),
    code(),
  ]);
  const state = EditorState.create({
    schema,
    doc,
    plugins: [identityPlugin(scope, source)],
  });
  expect(blockIdentityKey.getState(state)!.at(-1)!.id).toBe(keys[1]);
});
