// @vitest-environment jsdom
import { expect, it } from "vitest";
import {
  Editor,
  rootCtx,
  defaultValueCtx,
  editorViewCtx,
  serializerCtx,
} from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { $prose } from "@milkdown/kit/utils";
import { splitListItem } from "@milkdown/kit/prose/schema-list";
import { TextSelection } from "@milkdown/kit/prose/state";
import {
  configureTrackedTasks,
  insertTrackedTask,
  taskClipboardPlugin,
} from "./trackedTasks";
import { RichMarkdownAdapter } from "./markdown";
import { scanTrackedTasks, taskLine } from "../content/tasks";
it("reopens nested tracked checkboxes as editable GFM and persists one updated check without turning HTML into live DOM", async () => {
  const id = crypto.randomUUID(),
    original = [
      "- [ ] untracked",
      "  " + taskLine({ id, title: "**write** plan", due: "2026-11-30" }),
      "  more",
      "",
      "<script>stay protected</script>",
    ].join("\n");
  const adapter = new RichMarkdownAdapter(original),
    root = document.createElement("div");
  const editor = Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, adapter.prepare(original));
    })
    .use(commonmark)
    .use(gfm)
    .config(configureTrackedTasks);
  await editor.create();
  try {
    expect(root.querySelector("strong")?.textContent).toBe("write");
    expect(root.querySelector("script")).toBeNull();
    const saved = editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      let target = -1;
      view.state.doc.descendants((node, pos) => {
        if (node.attrs.taskMarker) target = pos;
      });
      expect(target).toBeGreaterThanOrEqual(0);
      const task = view.state.doc.nodeAt(target)!;
      view.dispatch(
        view.state.tr.setNodeMarkup(target, undefined, {
          ...task.attrs,
          checked: true,
        }),
      );
      return adapter.serialize(ctx.get(serializerCtx)(view.state.doc));
    });
    expect(scanTrackedTasks(saved)).toMatchObject([
      { id, done: true, due: "2026-11-30", title: "**write** plan" },
    ]);
    expect(saved).toContain("more");
  } finally {
    await editor.destroy();
  }
});
it("promotes a paragraph into a tracked checklist through the insert command", async () => {
  const editor = Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, document.createElement("div"));
      ctx.set(defaultValueCtx, "Draft title");
    })
    .use(commonmark)
    .use(gfm)
    .config(configureTrackedTasks);
  await editor.create();
  try {
    const saved = editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      insertTrackedTask(view, "New task");
      return ctx.get(serializerCtx)(view.state.doc);
    });
    expect(scanTrackedTasks(saved)).toMatchObject([
      { title: "Draft title", done: false },
    ]);
  } finally {
    await editor.destroy();
  }
});

it("splits a tracked list item without duplicating its ID and clones with a new identity on copy", async () => {
  const id = crypto.randomUUID(),
    original = taskLine({
      id,
      title: "First second",
      waiting: true,
      followOn: "2026-11-29",
    });
  const editor = Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, document.createElement("div"));
      ctx.set(defaultValueCtx, original);
    })
    .use(commonmark)
    .use(gfm)
    .config(configureTrackedTasks)
    .use($prose(taskClipboardPlugin));
  await editor.create();
  try {
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const copied = view.state.doc.slice(0, view.state.doc.content.size);
      const plugin = taskClipboardPlugin();
      const cloned = plugin.props.transformPasted!.call(
        plugin,
        copied,
        view,
        false,
      );
      expect(
        cloned.content.firstChild!.firstChild!.attrs.taskMarker,
      ).not.toEqual(copied.content.firstChild!.firstChild!.attrs.taskMarker);
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, 8)),
      );
      expect(
        splitListItem(view.state.schema.nodes.list_item)(
          view.state,
          view.dispatch,
        ),
      ).toBe(true);
      const tasks = scanTrackedTasks(ctx.get(serializerCtx)(view.state.doc));
      expect(tasks).toMatchObject([
        { id, title: "First", waiting: true, duplicate: false },
      ]);
    });
  } finally {
    await editor.destroy();
  }
});
