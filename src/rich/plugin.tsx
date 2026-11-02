import { createRoot, type Root } from "react-dom/client";
import type { Node } from "@milkdown/kit/prose/model";
import type { EditorView, NodeView } from "@milkdown/kit/prose/view";
import { codeBlockSchema } from "@milkdown/kit/preset/commonmark";
import { $view } from "@milkdown/kit/utils";
import InlineBlock from "./InlineBlock";
import { blockAction } from "./blocks";
import { blockIdentityKey } from "./identity";
export const revealSourceEvent = "inkstone-reveal-source";
export class ContentBlockView implements NodeView {
  dom: HTMLElement;
  root: Root;
  node: Node;
  destroyed = false;
  readonly identity: string;
  sourceReveal?: { request: number; line: number; showCode: boolean };
  constructor(
    node: Node,
    readonly view: EditorView,
    readonly getPos: () => number | undefined,
    readonly changed: (structure: boolean) => void,
    readonly scope: string,
  ) {
    this.node = node;
    this.identity =
      blockIdentityKey
        .getState(view.state)
        ?.find((entry) => entry.pos === getPos())?.id ?? crypto.randomUUID();
    this.dom = document.createElement("div");
    this.dom.contentEditable = "false";
    this.dom.className = "inkstone-node-view";
    this.dom.addEventListener(revealSourceEvent, (event) => {
      const { line, showCode } = (
        event as CustomEvent<{ line: number; showCode: boolean }>
      ).detail;
      this.sourceReveal = {
        request: (this.sourceReveal?.request ?? 0) + 1,
        line,
        showCode,
      };
      this.render();
    });
    this.root = createRoot(this.dom);
    this.render();
  }
  render() {
    this.root.render(
      <InlineBlock
        viewKey={`${this.scope}:block:${this.identity}`}
        key={String(this.node.attrs.language)}
        language={String(this.node.attrs.language ?? "")}
        source={this.node.textContent}
        sourceReveal={this.sourceReveal}
        apply={(base, next, structure = true) => {
          const pos = this.getPos();
          const current =
            pos === undefined ? null : this.view.state.doc.nodeAt(pos);
          if (
            this.destroyed ||
            pos === undefined ||
            !current ||
            current.type.name !== "code_block" ||
            current.textContent !== base ||
            current.attrs.language !== this.node.attrs.language
          )
            throw Error("内容块已变化，请重新编辑，未写入旧修改。");
          if (base === next) return;
          if (structure) this.changed(false);
          this.view.dispatch(
            this.view.state.tr
              .insertText(next, pos + 1, pos + current.nodeSize - 1)
              .setMeta("inkstone-structure", structure),
          );
          this.changed(structure);
        }}
        action={(name) => {
          if (name !== "select" && name !== "after") this.changed(false);
          blockAction(this.view, this.getPos, name);
          if (name !== "select" && name !== "after") this.changed(true);
        }}
      />,
    );
  }
  update(node: Node) {
    if (node.type !== this.node.type) return false;
    const identity = blockIdentityKey
      .getState(this.view.state)
      ?.find((entry) => entry.pos === this.getPos())?.id;
    if (identity && identity !== this.identity) return false;
    if (node !== this.node) {
      this.node = node;
      this.render();
    }
    return true;
  }
  selectNode() {
    this.dom.classList.add("selected");
  }
  deselectNode() {
    this.dom.classList.remove("selected");
  }
  stopEvent(event: Event) {
    return event.target !== this.dom;
  }
  ignoreMutation() {
    return true;
  }
  destroy() {
    this.destroyed = true;
    queueMicrotask(() => this.root.unmount());
  }
}
export const contentBlockPlugin = (
  changed: (structure: boolean) => void,
  scope = "",
) =>
  $view(
    codeBlockSchema.node,
    () => (node, view, getPos) =>
      new ContentBlockView(node, view, getPos, changed, scope),
  );
