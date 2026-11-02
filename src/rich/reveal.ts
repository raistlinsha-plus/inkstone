/** Follow the actual block while lazy previews above it finish laying out. */
export function revealAfterLayout(editor: HTMLElement, block: HTMLElement) {
  let stopped = false,
    frame = 0,
    quietTimer = 0;
  const target = () =>
    block.querySelector<HTMLElement>(".inline-code-editor textarea") ??
    block.querySelector<HTMLElement>(".inline-block-bar") ??
    block;
  const align = () => {
    if (!stopped && block.isConnected)
      target().scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: "instant",
      });
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    clearTimeout(quietTimer);
    clearTimeout(deadline);
    resize?.disconnect();
    mutations.disconnect();
    for (const type of ["wheel", "touchstart", "pointerdown", "keydown"])
      document.removeEventListener(type, stop, true);
  };
  const schedule = () => {
    if (stopped) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      align();
      clearTimeout(quietTimer);
      quietTimer = window.setTimeout(align, 120);
    });
  };
  const resize =
    typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
  resize?.observe(editor);
  resize?.observe(block);
  const mutations = new MutationObserver(schedule);
  mutations.observe(editor, { childList: true, subtree: true });
  const deadline = window.setTimeout(() => {
    align();
    stop();
  }, 5000);
  for (const type of ["wheel", "touchstart", "pointerdown", "keydown"])
    document.addEventListener(type, stop, { capture: true, passive: true });
  schedule();
  return stop;
}
