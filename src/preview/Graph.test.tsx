// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import Graph from "./Graph";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
test("load and ready handshakes send one render and ignore stale revisions", async () => {
  vi.useFakeTimers();
  const rendered = render(<Graph kind="mindmap" source="- 原始" />);
  const iframe = screen.getByTitle("Markdown 脑图") as HTMLIFrameElement;
  const posted = vi.spyOn(iframe.contentWindow!, "postMessage");
  fireEvent.load(iframe);
  window.dispatchEvent(
    new MessageEvent("message", {
      source: iframe.contentWindow!,
      data: { type: "frame-loaded" },
    }),
  );
  expect(
    posted.mock.calls.filter(([data]) => data.type === "render"),
  ).toHaveLength(1);
  const first = posted.mock.calls[0][0];
  rendered.rerender(<Graph kind="mindmap" source="- 修改" />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
  const jobs = posted.mock.calls.filter(([data]) => data.type === "render");
  expect(jobs).toHaveLength(2);
  const latest = jobs[1][0];
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        source: iframe.contentWindow!,
        data: { ...first, type: "ready" },
      }),
    );
  });
  expect(
    screen.getByRole("button", { name: "导出 SVG" }).hasAttribute("disabled"),
  ).toBe(true);
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        source: iframe.contentWindow!,
        data: { ...latest, type: "ready" },
      }),
    );
  });
  expect(
    screen.getByRole("button", { name: "导出 SVG" }).hasAttribute("disabled"),
  ).toBe(false);
});
test("chart validation fails closed and its own frame enables SVG and PNG only for the latest ready source", () => {
  const invalid = render(<Graph kind="chart" source='{"type":"custom"}' />);
  expect(screen.queryByTitle("数据图表本地预览")).toBeNull();
  invalid.unmount();
  const source = JSON.stringify({
    schemaVersion: 1,
    type: "bar",
    title: "数字",
    x: { label: "季度", values: ["Q1"] },
    y: { label: "数量", unit: "项" },
    series: [{ name: "数量", values: [2] }],
  });
  render(<Graph kind="chart" source={source} />);
  const iframe = screen.getByTitle("数据图表本地预览") as HTMLIFrameElement;
  expect(iframe.getAttribute("src")).toBe("./inkstone-chart.html");
  expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
  const posted = vi.spyOn(iframe.contentWindow!, "postMessage");
  fireEvent.load(iframe);
  const job = posted.mock.calls.find(([data]) => data.type === "render")![0];
  expect(
    screen.getByRole("button", { name: "导出 PNG" }).hasAttribute("disabled"),
  ).toBe(true);
  act(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: iframe.contentWindow!,
        data: { ...job, type: "ready" },
      }),
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "导出 PNG" }));
  expect(posted.mock.calls.at(-1)?.[0]).toMatchObject({
    type: "command",
    action: "export",
    format: "png",
    requestId: job.requestId,
  });
});

test("graph sizes are bounded, revision-owned and expandable without changing source", () => {
  render(<Graph kind="mermaid" source="flowchart LR\n A-->B" />);
  const iframe = screen.getByTitle("Mermaid 本地预览") as HTMLIFrameElement;
  const posted = vi.spyOn(iframe.contentWindow!, "postMessage");
  fireEvent.load(iframe);
  const job = posted.mock.calls.find(([data]) => data.type === "render")![0];
  const container = iframe.closest(".graph-preview") as HTMLElement;
  const size = (height: number, revision = job.revision) =>
    act(() =>
      window.dispatchEvent(
        new MessageEvent("message", {
          source: iframe.contentWindow!,
          data: { ...job, type: "size", height, revision },
        }),
      ),
    );
  size(180);
  expect(container.style.getPropertyValue("--graph-height")).toBe("180px");
  size(999999);
  expect(container.style.getPropertyValue("--graph-height")).toBe("440px");
  size(200, job.revision - 1);
  size(NaN);
  expect(container.style.getPropertyValue("--graph-height")).toBe("440px");
  fireEvent.click(screen.getByRole("button", { name: "展开画布" }));
  expect(container.style.getPropertyValue("--graph-height")).toBe("560px");
  fireEvent.click(screen.getByRole("button", { name: "收起画布" }));
  expect(container.style.getPropertyValue("--graph-height")).toBe("440px");
});
