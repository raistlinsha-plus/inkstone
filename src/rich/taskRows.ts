import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import type { Node } from "@milkdown/kit/prose/model";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { subscribeLocale } from "../i18n";
import { readTaskMarker } from "../content/tasks";
import { taskDetails, taskToggleLabel } from "../content/taskPresentation";
import "../preview/taskRows.css";

/** Keep the title as editable ProseMirror content. Status and planning controls
 * are decorations: clipboard, Markdown serialization and indexing see only the task. */
export function taskRowsPlugin(
  rememberToggle?: (doc: Node, taskId: string, checked: boolean) => void,
) {
  const parsed = new WeakMap<
    Node["attrs"],
    ReturnType<typeof readTaskMarker>
  >();
  const key = new PluginKey<DecorationSet>("inkstone-task-rows");
  function rows(doc: Node) {
    const language = document.documentElement.lang;
    const decorations: Decoration[] = [];
    doc.descendants((node, pos) => {
      if (node.type.name === "blockquote") return false;
      const marker = node.attrs.taskMarker;
      if (
        !marker ||
        typeof node.attrs.checked !== "boolean" ||
        !node.firstChild
      )
        return;
      if (!parsed.has(node.attrs))
        parsed.set(node.attrs, readTaskMarker(marker));
      const meta = parsed.get(node.attrs);
      if (!meta) return;
      const checked = node.attrs.checked;
      const title = node.firstChild.textContent;
      decorations.push(
        Decoration.node(pos, pos + node.nodeSize, {
          class: "document-task-row",
          "data-complete": String(checked),
        }),
        Decoration.widget(
          pos + 1,
          (view, getPos) => {
            const box = document.createElement("input");
            box.type = "checkbox";
            box.className = "document-task-check";
            box.checked = checked;
            box.setAttribute("aria-label", taskToggleLabel(title, checked));
            box.disabled = !view.editable;
            box.addEventListener("change", () => {
              const at = getPos();
              if (at === undefined || !view.editable) return;
              const current = view.state.doc.nodeAt(at - 1);
              if (!current || current.attrs.taskMarker !== marker) return;
              const focused = view.dom.ownerDocument.activeElement === box;
              const tr = view.state.tr.setNodeAttribute(at - 1, "checked", box.checked);
              rememberToggle?.(tr.doc, meta.id, box.checked);
              view.dispatch(tr);
              // Refreshing the decoration replaces the checkbox; retain keyboard focus.
              if (focused) {
                const row = view.nodeDOM(at - 1);
                if (row instanceof HTMLElement)
                  row
                    .querySelector<HTMLInputElement>(".document-task-check")
                    ?.focus({ preventScroll: true });
              }
            });
            return box;
          },
          {
            key: JSON.stringify([language, marker, checked, title]),
            side: -1,
            stopEvent: () => true,
            ignoreSelection: true,
          },
        ),
        Decoration.widget(
          pos + 1 + node.firstChild.nodeSize,
          () => {
            const line = document.createElement("span");
            line.className = "document-task-details";
            for (const detail of taskDetails(meta, checked)) {
              const chip = document.createElement("span");
              chip.textContent = detail;
              line.append(chip);
            }
            return line;
          },
          {
            key: "details:" + language + marker + checked,
            side: -1,
            ignoreSelection: true,
          },
        ),
      );
    });
    return DecorationSet.create(doc, decorations);
  }
  return new Plugin<DecorationSet>({
    key,
    view(editor) {
      const unsubscribe = subscribeLocale(() => {
        editor.dispatch(editor.state.tr.setMeta(key, true));
      });
      return { destroy: unsubscribe };
    },
    state: {
      init: (_, state) => rows(state.doc),
      apply: (tr, previous) =>
        tr.docChanged || tr.getMeta(key) ? rows(tr.doc) : previous,
    },
    props: {
      decorations(state) {
        return this.getState(state);
      },
    },
  });
}
