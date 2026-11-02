// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import Markdown from "./Markdown";
afterEach(cleanup);
test("split preview renders safe line breaks without executing other HTML or changing code literals", () => {
  const source =
    "前<br />后\n\n<BR>\n\n<script>unsafe()</script>\n\n```text\n<br />\n```";
  const { container } = render(
    <Markdown
      source={source}
      path="test.md"
      onApply={vi.fn()}
      onLocate={vi.fn()}
      onError={vi.fn()}
    />,
  );
  expect(container.querySelectorAll("br")).toHaveLength(2);
  expect(container.querySelector("script")).toBeNull();
  expect(container.querySelector("pre.raw-html")?.textContent).toBe(
    "<script>unsafe()</script>",
  );
  expect(container.querySelector("pre code")?.textContent).toBe("<br />");
  expect(screen.getByLabelText("Markdown 实时预览")).toBeTruthy();
});

const native = vi.hoisted(() => ({ enabled: false, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => native.enabled,
  invoke: (...args: unknown[]) => native.invoke(...args),
}));
vi.mock("./Graph", () => ({
  default: ({ kind, source }: { kind: string; source: string }) => (
    <div data-testid="graph" data-kind={kind}>
      {source}
    </div>
  ),
}));
vi.mock("./Chart", () => ({
  default: ({ sourceRefs }: { sourceRefs?: string[] }) => (
    <div aria-label="测试图表">{sourceRefs?.join(",")}</div>
  ),
}));

import { fireEvent, waitFor } from "@testing-library/react";
import type { SearchResult } from "../types";
import { calendarTemplate } from "../content/calendar";
import { safeImageUrl } from "./Markdown";
const citation = {
  id: 1,
  path: "资料.md",
  text: "季度收入120",
  title: "季度资料",
  hash: "v1",
  heading: "",
  startLine: 1,
  endLine: 3,
  score: 1,
} satisfies SearchResult;

test("GFM reading preserves numbered starts, table header alignment and reference links", () => {
  const { container } = render(
    <Markdown
      source={
        "3. 第三项\n4. 第四项\n\n| 左 | 右 |\n| :--- | ---: |\n| A | 12 |\n\n[参考][manual]\n\n[manual]: https://example.com/help"
      }
      path="test.md"
      readOnly
    />,
  );
  expect(container.querySelector("ol")?.getAttribute("start")).toBe("3");
  expect(container.querySelectorAll("thead th")).toHaveLength(2);
  expect(
    (container.querySelectorAll("thead th")[1] as HTMLElement).style.textAlign,
  ).toBe("right");
  expect(screen.getByRole("link", { name: "参考" }).getAttribute("href")).toBe(
    "https://example.com/help",
  );
  expect(container.textContent).not.toContain("[manual]:");
});

test("citation buttons are limited to prose and do not replace JSON or inline-code literals", () => {
  const open = vi.fn();
  const { container } = render(
    <Markdown
      path=""
      readOnly
      citations={[citation]}
      onCitation={open}
      source={
        '## 回答\n\n有来源的结论。[1] 未知编号[2026]\n\n`arr[1]`\n\n```json\n{"values":[1],"years":[2026]}\n```\n\n[链接 [1]](https://example.com)'
      }
    />,
  );
  const buttons = container.querySelectorAll("button.citation");
  expect(buttons).toHaveLength(1);
  fireEvent.click(buttons[0]);
  expect(open).toHaveBeenCalledWith(citation);
  expect(container.querySelector("p code")?.textContent).toBe("arr[1]");
  expect(container.textContent).toContain("[2026]");
  expect(container.textContent).toContain("[1]");
  expect(container.textContent).not.toContain("引用待核实");
  expect(screen.queryByRole("button", { name: "修改 values" })).toBeNull();
  expect(screen.queryByRole("button", { name: "格式化" })).toBeNull();
});

test("local image percent filenames cannot throw outside the error boundary", async () => {
  native.enabled = true;
  native.invoke.mockResolvedValue("data:image/png;base64,AA==");
  const { container } = render(
    <Markdown
      source={"![比例][img]\n\n[img]: image%.png\n\n其余正文"}
      path="test.md"
    />,
  );
  await waitFor(() =>
    expect(native.invoke).toHaveBeenCalledWith("resolve_image", {
      documentPath: "test.md",
      url: "image%.png",
    }),
  );
  expect(container.textContent).toContain("其余正文");
  expect(container.querySelector("img")?.getAttribute("alt")).toBe("比例");
  native.enabled = false;
  native.invoke.mockClear();
  expect(safeImageUrl("image%25.png")).toBe("image%.png");
  expect(safeImageUrl("image%E4.png")).toBe("image%E4.png");
});

test("answer images never resolve local or remote resources", async () => {
  native.enabled = true;
  native.invoke.mockClear();
  render(
    <Markdown
      readOnly
      source={"![本地](private.png)\n\n![远程](https://example.com/pixel.png)"}
      path="private.md"
    />,
  );
  expect(screen.queryByRole("img")).toBeNull();
  expect(screen.getAllByText(/图片未自动加载/)).toHaveLength(2);
  expect(native.invoke).not.toHaveBeenCalled();
  native.enabled = false;
});

test("pending and unclosed special fences remain literal instead of rendering previews", () => {
  const { rerender } = render(
    <Markdown
      readOnly
      pending
      path=""
      source={"```mermaid\nflowchart LR\nA-->B\n```"}
    />,
  );
  expect(screen.queryByTestId("graph")).toBeNull();
  expect(screen.getByText(/内容尚未完成/)).toBeTruthy();
  rerender(
    <Markdown readOnly path="" source={"```mermaid\nflowchart LR\nA-->B"} />,
  );
  expect(screen.queryByTestId("graph")).toBeNull();
  expect(screen.getByText(/代码围栏尚未闭合/)).toBeTruthy();
});

test("rejected chart indexes refer to chart fences rather than all code blocks", () => {
  const source =
    '```text\nplain\n```\n\n```chart\n{"first":1}\n```\n\n```chart\n{"second":2}\n```';
  const { container } = render(
    <Markdown
      readOnly
      path=""
      citations={[citation]}
      rejectedCharts={[0]}
      source={source}
    />,
  );
  expect(screen.getAllByLabelText("测试图表")).toHaveLength(1);
  expect(screen.getByLabelText("测试图表").textContent).toBe("S1");
  expect(container.querySelectorAll("pre code")[1]?.textContent).toBe(
    '{"first":1}',
  );
  expect(screen.getByText(/图表数值或来源待核实/)).toBeTruthy();
});

test("calendar fences use the shared read-only calendar instead of raw JSON", async () => {
  render(
    <Markdown
      readOnly
      path=""
      source={"```calendar\n" + calendarTemplate() + "\n```"}
    />,
  );
  await waitFor(() =>
    expect(screen.getByLabelText("正文日程日历")).toBeTruthy(),
  );
  expect(screen.queryByRole("button", { name: "＋ 新增事项" })).toBeNull();
  expect(screen.queryByRole("button", { name: "导出 ICS" })).toBeNull();
});

test("anchors scroll and focus only the matching heading in this reading surface", () => {
  const { container } = render(
    <Markdown
      readOnly
      path=""
      source={"[跳转](#第二节)\n\n## 第二节\n\n正文"}
    />,
  );
  const heading = container.querySelector("h2")!;
  const scroll = vi.fn();
  heading.scrollIntoView = scroll;
  fireEvent.click(screen.getByRole("link", { name: "跳转" }));
  expect(scroll).toHaveBeenCalledWith({ block: "start" });
  expect(document.activeElement).toBe(heading);
});
