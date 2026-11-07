import { expect, test, vi } from "vitest";
import { createStreamBuffer } from "./streamBuffer";
function setup() {
  let callback: () => void = () => {};
  const emit = vi.fn(),
    cancel = vi.fn();
  const buffer = createStreamBuffer(
    emit,
    (cb) => {
      callback = cb;
      return 1;
    },
    cancel,
  );
  return { buffer, emit, cancel, flush: () => callback() };
}
test("chunks in one animation frame update the view once in arrival order", () => {
  const h = setup();
  h.buffer.push("one", "甲");
  h.buffer.push("one", "乙");
  expect(h.emit).not.toHaveBeenCalled();
  h.flush();
  expect(h.emit).toHaveBeenCalledExactlyOnceWith("one", "甲乙");
});
test("clear before terminal response prevents a queued partial from duplicating final text", () => {
  const h = setup();
  h.buffer.push("one", "片段");
  h.buffer.clear();
  h.flush();
  expect(h.cancel).toHaveBeenCalled();
  expect(h.emit).not.toHaveBeenCalled();
});
test("changing request ownership drops the previous buffered content", () => {
  const h = setup();
  h.buffer.push("old", "旧");
  h.buffer.push("new", "新");
  h.flush();
  expect(h.emit).toHaveBeenCalledExactlyOnceWith("new", "新");
});
