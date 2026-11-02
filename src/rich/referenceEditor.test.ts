// @vitest-environment jsdom
import { expect, test } from "vitest";
import {
  Editor,
  rootCtx,
  defaultValueCtx,
  editorViewCtx,
  serializerCtx,
} from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { RichMarkdownAdapter } from "./markdown";

test("actual Milkdown parser displays reference links inline and serialization after a prose edit keeps their destinations and definitions", async () => {
  const original =
    '第一段 [参考][help] 与 [锚点](#后文)。\n\n[help]: https://example.com/help "帮助"\n\n## 后文\n\n最后正文。';
  const adapter = new RichMarkdownAdapter(original),
    mount = document.createElement("div");
  document.body.append(mount);
  const editor = Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, mount);
      ctx.set(defaultValueCtx, adapter.prepare(original));
    })
    .use(commonmark);
  await editor.create();
  try {
    expect(mount.querySelectorAll("a")).toHaveLength(2);
    expect(mount.querySelector("a")?.getAttribute("href")).toBe(
      "https://example.com/help",
    );
    expect(mount.querySelector("pre")).toBeNull();
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.insertText("编辑后", 2));
    });
    const saved = adapter.serialize(
      editor.action((ctx) =>
        ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc),
      ),
    );
    expect(saved).toContain("编辑后");
    expect(saved).toContain('[help]: https://example.com/help "帮助"');
    expect(saved).toContain("https://example.com/help");
    const reopened = new RichMarkdownAdapter(saved);
    const parsed = editor.action((ctx) =>
      ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc),
    );
    expect(parsed).toContain("https://example.com/help");
    expect(reopened.prepare(saved)).not.toContain(reopened.rawLanguage);
  } finally {
    await editor.destroy();
    mount.remove();
  }
});
