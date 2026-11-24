// @vitest-environment jsdom
import { expect, it } from "vitest";
import {
  Editor,
  defaultValueCtx,
  editorViewCtx,
  rootCtx,
  serializerCtx,
} from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { $prose } from "@milkdown/kit/utils";
import { listItemBlockComponent } from "@milkdown/kit/component/list-item-block";
import { configureTrackedTasks } from "./trackedTasks";
import { RichMarkdownAdapter } from "./markdown";
import { taskRowsPlugin } from "./taskRows";
import { scanTrackedTasks, taskLine } from "../content/tasks";

it("shows dates inside editable Markdown and writes completion back to the same task across reopen", async () => {
  const task = {
    id: crypto.randomUUID(),
    title: "**整理**访谈要点",
    waiting: true,
    due: "2026-11-23",
    followOn: "2026-11-25",
    slot: {
      start: "2026-11-23T23:00:00+08:00",
      end: "2026-11-24T01:00:00+08:00",
      zone: "Asia/Shanghai",
    },
  };
  const source = [
    "# 访谈",
    "",
    "- [ ] 普通复选项",
    "  " + taskLine(task),
    "",
    "后记",
  ].join("\n");
  const root = document.createElement("div");
  document.body.append(root);
  async function open(source: string) {
    const adapter = new RichMarkdownAdapter(source);
    const editor = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, adapter.prepare(source));
      })
      .use(commonmark)
      .use(gfm)
      .config(configureTrackedTasks)
      .use(listItemBlockComponent)
      .use($prose(() => taskRowsPlugin()));
    await editor.create();
    return {
      editor,
      markdown: () =>
        editor.action((ctx) =>
          adapter.serialize(
            ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc),
          ),
        ),
    };
  }
  let active = await open(source);
  try {
    expect(root.querySelectorAll(".document-task-row")).toHaveLength(1);
    const row = root.querySelector<HTMLElement>(".document-task-row")!;
    expect(row.querySelector("strong")?.textContent).toBe("整理");
    expect(row.textContent).toContain(
      "2026-11-23 23:00 – 2026-11-24 01:00 · Asia/Shanghai",
    );
    expect(row.textContent).toContain("跟进 2026-11-25");
    expect(row.textContent).not.toContain(task.id);
    const check = row.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    )!;
    check.focus();
    check.click();
    expect(
      root.querySelector(".document-task-row")?.getAttribute("data-complete"),
    ).toBe("true");
    expect(document.activeElement).toBe(
      root.querySelector(".document-task-check"),
    );
    const saved = active.markdown();
    expect(scanTrackedTasks(saved)).toMatchObject([{ ...task, done: true }]);
    expect(saved).toContain("后记");
    expect(saved).toContain("[ ] 普通复选项");
    expect(saved).not.toContain("排期");
    await active.editor.destroy();
    active = await open(saved);
    const reopened = root.querySelector<HTMLInputElement>(
      ".document-task-check",
    )!;
    expect(reopened.checked).toBe(true);
    reopened.click();
    expect(scanTrackedTasks(active.markdown())).toMatchObject([
      { ...task, done: false },
    ]);
  } finally {
    await active.editor.destroy();
    root.remove();
  }
});
