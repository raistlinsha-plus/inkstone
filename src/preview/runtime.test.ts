// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
const pending = vi.hoisted(
  () =>
    [] as {
      resolve: (v: { svg: string }) => void;
      reject: (e: Error) => void;
    }[],
);
vi.mock("mermaid", () => ({
  default: {
    initialize() {},
    render: vi.fn(
      () =>
        new Promise((resolve, reject) =>
          pending.push({ resolve: resolve as any, reject }),
        ),
    ),
  },
}));
vi.mock("markmap-view", () => ({ Markmap: {} }));
test("outdated render completion and errors cannot replace the latest SVG or ready version", async () => {
  document.body.innerHTML = '<div id="graph"></div>';
  const messages = vi
    .spyOn(window.parent, "postMessage")
    .mockImplementation(() => {});
  await import("./runtime");
  const send = (id: string, n: number) =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window.parent,
        data: {
          type: "render",
          kind: "mermaid",
          channel: "test",
          requestId: id,
          revision: n,
          source: "flowchart LR",
        },
      }),
    );
  send("old", 1);
  send("new", 2);
  pending[1].resolve({ svg: "<svg><text>NEW</text></svg>" });
  await new Promise((r) => setTimeout(r, 0));
  pending[0].resolve({ svg: "<svg><text>OLD</text></svg>" });
  await new Promise((r) => setTimeout(r, 0));
  expect(document.querySelector("#graph")?.textContent).toBe("NEW");
  const ready = messages.mock.calls.filter(
    (c) => (c[0] as any).type === "ready",
  );
  expect(ready).toHaveLength(1);
  expect(ready[0][0]).toMatchObject({ requestId: "new", revision: 2 });
  send("failure-old", 3);
  send("latest", 4);
  pending[3].resolve({ svg: "<svg><text>LATEST</text></svg>" });
  await new Promise((r) => setTimeout(r, 0));
  pending[2].reject(new Error("stale"));
  await new Promise((r) => setTimeout(r, 0));
  expect(document.querySelector("#graph")?.textContent).toBe("LATEST");
  expect(messages.mock.calls.some((c) => (c[0] as any).type === "error")).toBe(
    false,
  );
});
