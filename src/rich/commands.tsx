import type { Ctx } from "@milkdown/kit/ctx";
import { commandsCtx, editorViewCtx } from "@milkdown/kit/core";
import {
  addBlockTypeCommand,
  blockquoteSchema,
  bulletListSchema,
  codeBlockSchema,
  headingSchema,
  hrSchema,
  listItemSchema,
  orderedListSchema,
  paragraphSchema,
  setBlockTypeCommand,
  wrapInBlockTypeCommand,
  selectTextNearPosCommand,
} from "@milkdown/kit/preset/commonmark";
import { createTable } from "@milkdown/kit/preset/gfm";
import { imageBlockSchema } from "@milkdown/kit/component/image-block";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Type,
  Heading,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Code,
  Table,
  Image,
  Minus,
  Braces,
  GitBranch,
  Workflow,
  CalendarDays,
  ChartColumn,
} from "lucide-react";
import { blockSource, insertBlock, type BlockKind } from "./blocks";

// One command catalog for toolbar, slash and block-handle insertion.
export const insertCommands = [
  { id: "text", label: "正文", group: "文本", Icon: Type },
  ...[1, 2, 3, 4, 5, 6].map((level) => ({
    id: `h${level}`,
    label: `标题 ${level}`,
    group: "文本",
    Icon: Heading,
  })),
  { id: "bullet", label: "无序列表", group: "列表", Icon: List },
  { id: "ordered", label: "有序列表", group: "列表", Icon: ListOrdered },
  { id: "task", label: "任务列表", group: "列表", Icon: ListTodo },
  { id: "quote", label: "引用", group: "文本", Icon: Quote },
  { id: "clear", label: "清除文字格式", group: "文本", Icon: Type },
  { id: "divider", label: "分隔线", group: "文本", Icon: Minus },
  { id: "code", label: "代码块", group: "内容块", Icon: Code },
  { id: "table", label: "表格", group: "内容块", Icon: Table },
  { id: "image", label: "本地图片", group: "内容块", Icon: Image },
  { id: "json", label: "JSON 数据", group: "插入内容", Icon: Braces },
  { id: "mindmap", label: "脑图", group: "插入内容", Icon: GitBranch },
  { id: "mermaid", label: "Mermaid 图表", group: "插入内容", Icon: Workflow },
  { id: "chart", label: "数据图表", group: "插入内容", Icon: ChartColumn },
  { id: "agenda", label: "日程", group: "插入内容", Icon: ListTodo },
  { id: "calendar", label: "日历", group: "插入内容", Icon: CalendarDays },
] as const;
export function commandIcon(command: (typeof insertCommands)[number]) {
  return renderToStaticMarkup(<command.Icon size={18} />);
}
export function runInsertCommand(ctx: Ctx, id: string, fromSlash = false) {
  const view = ctx.get(editorViewCtx),
    commands = ctx.get(commandsCtx);
  const parent = view.state.selection.$from.parent;
  // Never erase an ordinary paragraph when using the toolbar menu.
  if (
    fromSlash &&
    /^\//.test(parent.textContent) &&
    ["paragraph", "heading"].includes(parent.type.name)
  ) {
    const start = view.state.selection.$from.start();
    view.dispatch(view.state.tr.delete(start, start + parent.content.size));
  }
  if (
    ["json", "mindmap", "mermaid", "chart", "agenda", "calendar"].includes(id)
  ) {
    insertBlock(
      view,
      id === "agenda" ? "calendar" : (id as BlockKind),
      id === "agenda" ? "agenda" : "month",
    );
  } else if (id === "clear") {
    const { from, to } = view.state.selection;
    view.dispatch(view.state.tr.removeMark(from, to).setStoredMarks([]));
  } else if (id === "text" || /^h[1-6]$/.test(id)) {
    commands.call(setBlockTypeCommand.key, {
      nodeType:
        id === "text" ? paragraphSchema.type(ctx) : headingSchema.type(ctx),
      attrs: id === "text" ? undefined : { level: Number(id.slice(1)) },
    });
  } else if (["bullet", "ordered", "quote", "task"].includes(id)) {
    const nodeType =
      id === "bullet"
        ? bulletListSchema.type(ctx)
        : id === "ordered"
          ? orderedListSchema.type(ctx)
          : id === "quote"
            ? blockquoteSchema.type(ctx)
            : listItemSchema.type(ctx);
    commands.call(wrapInBlockTypeCommand.key, {
      nodeType,
      attrs: id === "task" ? { checked: false } : undefined,
    });
  } else if (id === "code") {
    commands.call(setBlockTypeCommand.key, {
      nodeType: codeBlockSchema.type(ctx),
    });
  } else if (id === "table") {
    const pos = view.state.selection.from;
    commands.call(addBlockTypeCommand.key, {
      nodeType: createTable(ctx, 3, 3),
    });
    commands.call(selectTextNearPosCommand.key, { pos });
  } else if (id === "divider" || id === "image") {
    commands.call(addBlockTypeCommand.key, {
      nodeType:
        id === "divider" ? hrSchema.type(ctx) : imageBlockSchema.type(ctx),
    });
  }
  view.focus();
}
export function insertSource(id: string, selection = "") {
  if (
    ["json", "mindmap", "mermaid", "chart", "agenda", "calendar"].includes(id)
  ) {
    const kind = (id === "agenda" ? "calendar" : id) as BlockKind;
    return (
      "```" +
      kind +
      "\n" +
      blockSource(kind, id === "agenda" ? "agenda" : "month") +
      "\n```"
    );
  }
  if (/^h[1-6]$/.test(id))
    return "#".repeat(Number(id.slice(1))) + " " + (selection || "标题");
  if (id === "bullet" || id === "ordered" || id === "task" || id === "quote") {
    const prefix = {
      bullet: "- ",
      ordered: "1. ",
      task: "- [ ] ",
      quote: "> ",
    }[id]!;
    return (selection || "内容")
      .split("\n")
      .map((line) => prefix + line)
      .join("\n");
  }
  if (id === "code") return "```text\n" + selection + "\n```";
  if (id === "table") return "| 列一 | 列二 |\n| --- | --- |\n| 内容 | 内容 |";
  if (id === "image") return "![图片说明](相对路径.png)";
  if (id === "divider") return "---";
  return selection || "正文";
}

/** Public Ctx string lookup isolates the version-pinned Crepe menu integration. */
export function hideCrepeMenu(ctx: Ctx) {
  ctx
    .get<{ show: (pos: number) => void; hide: () => void }, "menuAPICtx">(
      "menuAPICtx",
    )
    .hide();
}
