import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";

/** Explicit navigation must own the DOM selection before PM tries to scroll it. */
export function revealTextPosition(view: EditorView, position: number) {
  view.focus();
  view.dispatch(
    view.state.tr
      .setSelection(TextSelection.near(view.state.doc.resolve(position)))
      .setMeta("addToHistory", false)
      .scrollIntoView(),
  );
}
