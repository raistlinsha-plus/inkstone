/** For the page-edge card, the writing surface stays mounted while its controls have focus. */
export function captureEditorReturn(origin: Element | null) {
  if (!(origin instanceof HTMLElement) || !origin.closest(".editor-container"))
    return null;
  const selection = document.getSelection();
  const range =
    selection?.rangeCount &&
    origin.contains(selection.anchorNode) &&
    origin.contains(selection.focusNode)
      ? selection.getRangeAt(0).cloneRange()
      : null;
  const backward =
    range &&
    selection?.anchorNode === range.endContainer &&
    selection.anchorOffset === range.endOffset;
  const input =
    origin instanceof HTMLTextAreaElement || origin instanceof HTMLInputElement
      ? origin
      : null;
  const start = input?.selectionStart;
  const end = input?.selectionEnd;
  const direction = input?.selectionDirection;
  const scroll: { element: HTMLElement; left: number; top: number }[] = [];
  for (
    let element: HTMLElement | null = origin;
    element;
    element = element.parentElement
  ) {
    scroll.push({ element, left: element.scrollLeft, top: element.scrollTop });
    if (element.classList.contains("main-content")) break;
  }
  return () => {
    if (!origin.isConnected || origin.closest("[hidden],[inert]")) return false;
    origin.focus({ preventScroll: true });
    if (input && start != null && end != null)
      input.setSelectionRange(start, end, direction ?? undefined);
    else if (range && origin.contains(range.commonAncestorContainer)) {
      selection?.setBaseAndExtent(
        backward ? range.endContainer : range.startContainer,
        backward ? range.endOffset : range.startOffset,
        backward ? range.startContainer : range.endContainer,
        backward ? range.startOffset : range.endOffset,
      );
    }
    for (const { element, left, top } of scroll) {
      element.scrollLeft = left;
      element.scrollTop = top;
    }
    return true;
  };
}
