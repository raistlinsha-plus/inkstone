/** Coalesce transport chunks without letting a completed/stopped request append stale text. */
export function createStreamBuffer(
  emit: (requestId: string, text: string) => void,
  schedule: (callback: () => void) => number = (callback) =>
    requestAnimationFrame(callback),
  cancel: (handle: number) => void = (handle) => cancelAnimationFrame(handle),
) {
  let id = "",
    pending = "",
    frame: number | null = null;
  function clear() {
    if (frame !== null) cancel(frame);
    frame = null;
    pending = "";
    id = "";
  }
  return {
    clear,
    push(requestId: string, delta: string) {
      if (id && id !== requestId) clear();
      id = requestId;
      pending += delta;
      if (frame === null)
        frame = schedule(() => {
          const text = pending,
            request = id;
          pending = "";
          frame = null;
          if (text) emit(request, text);
        });
    },
  };
}
