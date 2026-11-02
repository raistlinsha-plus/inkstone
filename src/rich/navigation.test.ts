// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState } from "@milkdown/kit/prose/state";
import { EditorView } from "@milkdown/kit/prose/view";
import { revealTextPosition } from "./navigation";

test("an external outline-button selection reaches PM's actual scroll handler, including repeated navigation to the same heading", () => {
  const schema = new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { content: "text*", group: "block", toDOM: () => ["p", 0] },
      heading: { content: "text*", group: "block", toDOM: () => ["h3", 0] },
      text: { group: "inline" },
    },
  });
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null, schema.text("文章开头")),
    schema.nodes.heading.create(null, schema.text("柱状图与多系列")),
  ]);
  const button = document.createElement("button"),
    mount = document.createElement("div");
  button.textContent = "柱状图与多系列";
  document.body.append(button, mount);
  const scrolled = vi.fn(() => true);
  const view = new EditorView(mount, {
    state: EditorState.create({ schema, doc }),
    handleScrollToSelection: scrolled,
  });
  const outside = () => {
    button.focus();
    const range = document.createRange();
    range.selectNodeContents(button);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(view.dom.contains(selection.focusNode)).toBe(false);
  };
  const target = doc.child(0).nodeSize + 1;
  try {
    outside();
    revealTextPosition(view, target);
    expect(view.state.selection.head).toBe(target);
    expect(scrolled).toHaveBeenCalledTimes(1);
    expect(view.dom.contains(window.getSelection()!.focusNode)).toBe(true);
    outside();
    revealTextPosition(view, target);
    expect(scrolled).toHaveBeenCalledTimes(2);
    expect(view.state.doc).toBe(doc);
  } finally {
    view.destroy();
    mount.remove();
    button.remove();
  }
});
