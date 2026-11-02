// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import Chart from "./Chart";
import { chartTemplate, parseChart } from "../content/chart";
vi.mock("./Graph", () => ({ default: () => <div>本地安全图形</div> }));
afterEach(cleanup);
test("read only answers expose original data and source without editing controls", () => {
  render(<Chart source={chartTemplate} readOnly onApply={vi.fn()} />);
  expect(screen.queryByRole("button", { name: "编辑图表" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^数据表$/ }));
  expect(screen.getByRole("table").textContent).toContain("150");
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^源码$/ }));
  expect(document.querySelector("code")?.textContent).toBe(chartTemplate);
});
test("a table edit applies exactly once with the original base and matching chart data", () => {
  const apply = vi.fn();
  const editing = vi.fn();
  render(
    <Chart source={chartTemplate} onApply={apply} onEditingChange={editing} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "编辑图表" }));
  fireEvent.change(screen.getByRole("textbox", { name: "图表标题" }), {
    target: { value: "修改后的季度收入" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "收入 第 2 项数值" }), {
    target: { value: "188.5" },
  });
  fireEvent.click(screen.getByRole("button", { name: "应用图表修改" }));
  expect(apply).toHaveBeenCalledTimes(1);
  expect(apply.mock.calls[0][0]).toBe(chartTemplate);
  expect(parseChart(apply.mock.calls[0][1])).toMatchObject({
    title: "修改后的季度收入",
    series: [{ values: [120, 188.5, 138, 180] }],
  });
  expect(editing.mock.calls.map((x) => x[0])).toContain(true);
  expect(editing.mock.calls.at(-1)?.[0]).toBe(false);
});
test("unsafe numeric input stays as a draft and cannot round into a saved value", () => {
  const apply = vi.fn();
  render(<Chart source={chartTemplate} onApply={apply} />);
  fireEvent.click(screen.getByRole("button", { name: "编辑图表" }));
  fireEvent.change(screen.getByRole("textbox", { name: "收入 第 1 项数值" }), {
    target: { value: "9007199254740993" },
  });
  fireEvent.click(screen.getByRole("button", { name: "应用图表修改" }));
  expect(apply).not.toHaveBeenCalled();
  expect(screen.getByRole("status").textContent).toContain("精度");
  expect(
    (
      screen.getByRole("textbox", {
        name: "收入 第 1 项数值",
      }) as HTMLInputElement
    ).value,
  ).toBe("9007199254740993");
});
test("stale base cannot replace a more recent source, and cancel does not mutate content", () => {
  const apply = vi.fn();
  const view = render(<Chart source={chartTemplate} onApply={apply} />);
  fireEvent.click(screen.getByRole("button", { name: "编辑图表" }));
  view.rerender(
    <Chart
      source={chartTemplate.replace('"季度收入"', '"新版本"')}
      onApply={apply}
    />,
  );
  expect(
    screen
      .getByRole("button", { name: "应用图表修改" })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(screen.getByRole("alert").textContent).toContain("草稿已保留");
  fireEvent.click(screen.getByRole("button", { name: "取消编辑" }));
  expect(apply).not.toHaveBeenCalled();
});
test("invalid source can be repaired locally, while citations cannot claim an unrelated source", () => {
  const apply = vi.fn();
  const value = JSON.parse(chartTemplate);
  value.sourceRefs = ["S2"];
  const view = render(
    <Chart source={JSON.stringify(value)} sourceRefs={["S1"]} readOnly />,
  );
  expect(screen.getByRole("status").textContent).toContain("不属于本次资料");
  expect(screen.queryByText("本地安全图形")).toBeNull();
  view.rerender(<Chart source="{" onApply={apply} />);
  fireEvent.click(screen.getByRole("button", { name: "编辑图表" }));
  fireEvent.change(screen.getByRole("textbox", { name: "图表 JSON 源码" }), {
    target: { value: chartTemplate },
  });
  fireEvent.click(screen.getByRole("button", { name: "应用图表修改" }));
  expect(apply).toHaveBeenCalledTimes(1);
});
test("switching an editable component to read only removes all pending mutation controls", () => {
  const apply = vi.fn();
  const view = render(<Chart source={chartTemplate} onApply={apply} />);
  fireEvent.click(screen.getByRole("button", { name: "编辑图表" }));
  fireEvent.change(screen.getByRole("textbox", { name: "图表标题" }), {
    target: { value: "尚未提交" },
  });
  view.rerender(<Chart source={chartTemplate} onApply={apply} readOnly />);
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("button", { name: "应用图表修改" })).toBeNull();
  expect(apply).not.toHaveBeenCalled();
});
test("table and source drafts survive mode unmounts by stable block identity but not a changed base", () => {
  const apply = vi.fn();
  let view = render(
    <Chart
      source={chartTemplate}
      viewKey="test:chart-draft:data"
      onApply={apply}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "编辑图表" }));
  fireEvent.change(screen.getByRole("textbox", { name: "图表标题" }), {
    target: { value: "未提交标题" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "收入 第 2 项数值" }), {
    target: { value: "155." },
  });
  view.unmount();
  view = render(
    <Chart
      source={chartTemplate}
      viewKey="test:chart-draft:data"
      onApply={apply}
    />,
  );
  expect(
    (screen.getByRole("textbox", { name: "图表标题" }) as HTMLInputElement)
      .value,
  ).toBe("未提交标题");
  expect(
    (
      screen.getByRole("textbox", {
        name: "收入 第 2 项数值",
      }) as HTMLInputElement
    ).value,
  ).toBe("155.");
  expect(apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "取消编辑" }));
  view.unmount();
  view = render(
    <Chart
      source={chartTemplate}
      viewKey="test:chart-draft:data"
      onApply={apply}
    />,
  );
  expect(screen.queryByRole("textbox", { name: "图表标题" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^源码$/ }));
  fireEvent.click(screen.getByRole("button", { name: "编辑图表" }));
  fireEvent.change(screen.getByRole("textbox", { name: "图表 JSON 源码" }), {
    target: { value: '{"schemaVersion":1' },
  });
  view.unmount();
  view = render(
    <Chart
      source={chartTemplate}
      viewKey="test:chart-draft:data"
      onApply={apply}
    />,
  );
  expect(
    (
      screen.getByRole("textbox", {
        name: "图表 JSON 源码",
      }) as HTMLTextAreaElement
    ).value,
  ).toBe('{"schemaVersion":1');
  view.unmount();
  view = render(
    <Chart
      source={chartTemplate.replace('"季度收入"', '"新的原文"')}
      viewKey="test:chart-draft:data"
      onApply={apply}
    />,
  );
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(apply).not.toHaveBeenCalled();
});
