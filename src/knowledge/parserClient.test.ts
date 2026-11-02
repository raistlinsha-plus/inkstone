import { test, expect, vi, afterEach } from "vitest";
import { requestChunks } from "./parserClient";
afterEach(() => vi.useRealTimers());
function worker() {
  const events = new EventTarget();
  return Object.assign(events, { postMessage: vi.fn() }) as unknown as Worker;
}
test("concurrent parser replies keep request identity and remove listeners", async () => {
  const w = worker();
  const a = requestChunks(w, 1, "a", "a.md", 128, null),
    b = requestChunks(w, 2, "b", "b.txt", 128, null);
  w.dispatchEvent(
    new MessageEvent("message", { data: { id: 2, chunks: [{ text: "b" }] } }),
  );
  expect(await b).toEqual([{ text: "b" }]);
  w.dispatchEvent(
    new MessageEvent("message", { data: { id: 1, chunks: [{ text: "a" }] } }),
  );
  expect(await a).toEqual([{ text: "a" }]);
  expect(w.postMessage).toHaveBeenNthCalledWith(2, {
    id: 2,
    content: "b",
    markdown: false,
    path: "b.txt",
    max: 128,
  });
});
test("timeout detaches handlers and late reply cannot resolve another request", async () => {
  vi.useFakeTimers();
  const w = worker(),
    remove = vi.spyOn(w, "removeEventListener");
  const rejected = expect(
    requestChunks(w, 9, "a", "a.md", 128, null),
  ).rejects.toThrow("文档解析超时");
  await vi.advanceTimersByTimeAsync(30000);
  await rejected;
  expect(remove).toHaveBeenCalledTimes(2);
  w.dispatchEvent(new MessageEvent("message", { data: { id: 9, chunks: [] } }));
});
test("unavailable and failed parser reject before posting", async () => {
  await expect(requestChunks(null, 1, "", "a.md", 128, null)).rejects.toThrow(
    "未就绪",
  );
  await expect(
    requestChunks(worker(), 1, "", "a.md", 128, "broken"),
  ).rejects.toThrow("broken");
});
