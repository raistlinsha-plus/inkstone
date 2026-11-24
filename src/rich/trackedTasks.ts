import type { Ctx } from "@milkdown/kit/ctx";
import { extendListItemSchemaForTask } from "@milkdown/kit/preset/gfm";
import { Fragment, Slice, type Node } from "@milkdown/kit/prose/model";
import { ReplaceStep } from "@milkdown/kit/prose/transform";
import { Plugin, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { MarkdownNode } from "../content/blocks";
import { readTaskMarker, taskAnnotation, taskMarker } from "../content/tasks";

/** The checkbox is GFM's own boolean. Only the hidden planning annotation is extra. */
export function configureTrackedTasks(ctx: Ctx) {
  ctx.update(extendListItemSchemaForTask.key, (previous) => (context) => {
    const base = previous(context);
    return {
      ...base,
      attrs: { ...base.attrs, taskMarker: { default: null } },
      toDOM(node) {
        const dom = base.toDOM!(node);
        if (!node.attrs.taskMarker || !Array.isArray(dom)) return dom;
        return [
          "li",
          {
            ...(dom[1] as object),
            "data-inkstone-task": node.attrs.taskMarker,
          },
          0,
        ];
      },
      parseDOM: [
        {
          tag: "li[data-inkstone-task]",
          getAttrs(element) {
            const marker = element.dataset.inkstoneTask;
            if (!readTaskMarker(marker)) return false;
            return {
              taskMarker: marker,
              checked: element.dataset.checked === "true",
              label: element.dataset.label,
              listType: element.dataset.listType,
              spread: element.dataset.spread === "true",
            };
          },
        },
        ...(base.parseDOM ?? []),
      ],
      parseMarkdown: {
        ...base.parseMarkdown,
        runner(state, node, type) {
          const annotation =
            node.position && taskAnnotation(node as unknown as MarkdownNode);
          if (!annotation) {
            base.parseMarkdown.runner(state, node, type);
            return;
          }
          const [first, ...rest] = node.children!;
          const children = [...first.children!];
          children.splice(annotation.index, 1);
          const before = children[annotation.index - 1];
          if (before?.type === "text" && typeof before.value === "string")
            children[annotation.index - 1] = {
              ...before,
              value: before.value.trimEnd(),
            };
          state.openNode(type, {
            label: node.label != null ? String(node.label) + "." : "•",
            listType: node.label != null ? "ordered" : "bullet",
            spread: node.spread ?? true,
            checked: node.checked,
            taskMarker: annotation.node.value,
          });
          state.next([
            {
              ...first,
              children: children.filter(
                (c) => c.type !== "text" || c.value !== "",
              ),
            },
            ...rest,
          ]);
          state.closeNode();
        },
      },
      toMarkdown: {
        ...base.toMarkdown,
        runner(state, node) {
          base.toMarkdown.runner(state, node);
          const marker = node.attrs.taskMarker;
          if (!marker || typeof node.attrs.checked !== "boolean") return;
          const inline = state.top()?.children?.at(-1)?.children?.[0]?.children;
          if (!inline) return;
          const annotation = { type: "html", value: " " + marker };
          const lineBreak = inline.findIndex(
            (n) =>
              n.type === "break" ||
              (n.type === "text" && /\r?\n/.test(String(n.value))),
          );
          if (lineBreak < 0) inline.push(annotation);
          else {
            const first = inline[lineBreak];
            if (first.type === "break") inline.splice(lineBreak, 0, annotation);
            else {
              const text = String(first.value),
                split = text.search(/\r?\n/);
              inline.splice(
                lineBreak,
                1,
                { type: "text", value: text.slice(0, split) },
                annotation,
                { type: "text", value: text.slice(split) },
              );
            }
          }
        },
      },
    };
  });
}
export function taskClipboardPlugin() {
  return new Plugin({
    // ProseMirror splits a list item by copying its attributes into both halves.
    // A structural split should keep the one original identity with its text.
    appendTransaction(transactions, _before, state) {
      const splitItem = transactions.some((tr) =>
        tr.steps.some(
          (step) =>
            step instanceof ReplaceStep &&
            step.from === step.to &&
            step.slice.openStart === 2 &&
            step.slice.openEnd === 2,
        ),
      );
      if (!splitItem) return null;
      const point = state.selection.$from;
      for (let depth = point.depth; depth > 0; depth--) {
        const item = point.node(depth),
          parent = point.node(depth - 1);
        const idx = point.index(depth - 1);
        if (
          item.type.name !== "list_item" ||
          !item.attrs.taskMarker ||
          idx === 0
        )
          continue;
        const previous = parent.child(idx - 1);
        if (previous.attrs.taskMarker !== item.attrs.taskMarker) continue;
        const at = point.before(depth);
        const removeFrom = previous.textContent.trim() ? item : previous;
        return state.tr.setNodeMarkup(
          removeFrom === item ? at : at - previous.nodeSize,
          undefined,
          { ...removeFrom.attrs, checked: false, taskMarker: null },
        );
      }
      return null;
    },
    props: {
      transformPasted(slice, view) {
        if (view.dragging?.move) return slice;
        function clone(node: Node): Node {
          if (node.isLeaf) return node;
          const children: Node[] = [];
          node.forEach((n) => children.push(clone(n)));
          const meta = readTaskMarker(node.attrs.taskMarker);
          const attrs = meta
            ? {
                ...node.attrs,
                taskMarker: taskMarker({ ...meta, id: crypto.randomUUID() }),
              }
            : node.attrs;
          return node.type.create(attrs, children, node.marks);
        }
        const nodes: Node[] = [];
        slice.content.forEach((n) => nodes.push(clone(n)));
        return new Slice(
          Fragment.fromArray(nodes),
          slice.openStart,
          slice.openEnd,
        );
      },
    },
  });
}
/** Promote the active list item in place; otherwise turn the active paragraph into a tracked checkbox. */
export function insertTrackedTask(view: EditorView, fallback: string) {
  const { $from } = view.state.selection;
  const marker = taskMarker({ id: crypto.randomUUID() });
  for (let depth = $from.depth; depth > 0; depth--) {
    const item = $from.node(depth);
    if (item.type.name !== "list_item") continue;
    if (item.attrs.taskMarker) return;
    view.dispatch(
      view.state.tr
        .setNodeMarkup($from.before(depth), undefined, {
          ...item.attrs,
          checked: item.attrs.checked ?? false,
          taskMarker: marker,
        })
        .scrollIntoView(),
    );
    return;
  }
  const { schema } = view.state;
  const textBlock = $from.parent,
    paragraph = schema.nodes.paragraph;
  const useParagraph = textBlock.type === paragraph;
  const content =
    useParagraph && textBlock.content.size
      ? textBlock.content
      : schema.text(fallback);
  const item = schema.nodes.list_item.create(
    { checked: false, taskMarker: marker },
    paragraph.create(null, content),
  );
  const list = schema.nodes.bullet_list.create(null, item);
  const from = $from.depth && useParagraph ? $from.before() : $from.pos;
  const to = $from.depth && useParagraph ? $from.after() : $from.pos;
  const tr = view.state.tr.replaceRangeWith(from, to, list);
  tr.setSelection(
    TextSelection.near(tr.doc.resolve(Math.min(tr.doc.content.size, from + 3))),
  );
  view.dispatch(tr.scrollIntoView());
}
