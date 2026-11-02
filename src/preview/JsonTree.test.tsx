// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import JsonTree from "./JsonTree";
afterEach(cleanup);
describe("JSON 结构编辑交互", () => {
  it("字段编辑按原文回写且保留大整数", () => {
    const onApply = vi.fn();
    render(
      <JsonTree
        source={'{"title":"旧值","big":9007199254740993}'}
        onApply={onApply}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "修改 title" }));
    fireEvent.change(screen.getByLabelText("JSON 字段值"), {
      target: { value: "新值" },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用修改" }));
    expect(onApply).toHaveBeenCalledWith(
      '{"title":"旧值","big":9007199254740993}',
      '{"title":"新值","big":9007199254740993}',
    );
  });
  it("原文变化后拒绝旧字段表单写入", () => {
    const onApply = vi.fn();
    const view = render(<JsonTree source={'{"a":1}'} onApply={onApply} />);
    fireEvent.click(screen.getByRole("button", { name: "修改 a" }));
    view.rerender(<JsonTree source={'{"b":2}'} onApply={onApply} />);
    fireEvent.click(screen.getByRole("button", { name: "应用修改" }));
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("原文已变化");
  });
  it("重复键关闭树写入，无效内容不会被覆盖", () => {
    const onApply = vi.fn();
    render(<JsonTree source={'{"a":1,"a":2}'} onApply={onApply} />);
    expect(screen.queryByRole("button", { name: "修改 a" })).toBeNull();
    expect(screen.getByText(/存在重复键/)).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
  });
  it("search finds the 1000th field without expanding pagination", () => {
    const source = JSON.stringify(
      Object.fromEntries(
        Array.from({ length: 1000 }, (_, i) => [`key${i}`, `value${i}`]),
      ),
    );
    render(<JsonTree source={source} onApply={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("搜索 JSON 键或值"), {
      target: { value: "key999" },
    });
    expect(screen.getByRole("button", { name: "修改 key999" })).toBeTruthy();
    expect(screen.queryByText("再显示 100 项")).toBeNull();
  });
});

it("reports activity and restores an unsaved field draft across view disposal", () => {
  const source = '{"title":"原值"}',
    active = vi.fn(),
    onApply = vi.fn();
  const props = {
    source,
    onApply,
    viewKey: "draft-test-document:block:0",
    onEditingChange: active,
  };
  const first = render(<JsonTree {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "修改 title" }));
  fireEvent.change(screen.getByLabelText("JSON 字段值"), {
    target: { value: "尚未提交" },
  });
  expect(active).toHaveBeenLastCalledWith(true);
  first.unmount();
  const second = render(<JsonTree {...props} />);
  expect(
    (screen.getByLabelText("JSON 字段值") as HTMLTextAreaElement).value,
  ).toBe("尚未提交");
  expect(onApply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(active).toHaveBeenLastCalledWith(false);
  second.unmount();
  render(<JsonTree {...props} />);
  expect(screen.queryByLabelText("JSON 字段值")).toBeNull();
});

it("read-only JSON keeps searchable exact values without exposing write controls", () => {
  const onApply = vi.fn();
  render(
    <JsonTree
      source={'{"value":9007199254740993}'}
      onApply={onApply}
      readOnly
    />,
  );
  expect(screen.getByText("9007199254740993")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "格式化" })).toBeNull();
  expect(screen.queryByRole("button", { name: "修改 value" })).toBeNull();
  expect(screen.queryByRole("button", { name: "删除 value" })).toBeNull();
  expect(onApply).not.toHaveBeenCalled();
});
