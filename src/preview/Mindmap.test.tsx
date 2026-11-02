// @vitest-environment jsdom
import { expect, test, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import Mindmap from "./Mindmap";
import { flattenMind, outlineTree } from "../content/mindmap";
vi.mock("./Graph", () => ({ default: () => null }));
afterEach(cleanup);
test("outline form cannot rename a different node at a reused offset after source changes", () => {
  const source = "# Root\n\n- Alpha\n";
  const onApply = vi.fn();
  const props = { onApply, onLocate: vi.fn(), onError: vi.fn() };
  const view = render(<Mindmap source={source} {...props} />);
  const id = flattenMind(outlineTree(source)).find(
    (n) => n.label === "Alpha",
  )!.id;
  fireEvent.change(screen.getByLabelText("脑图节点"), {
    target: { value: id },
  });
  view.rerender(
    <Mindmap source={source.replace("Alpha", "Bravo")} {...props} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "重命名" }));
  expect(onApply).not.toHaveBeenCalled();
  expect(screen.getAllByText(/原文已变化/).length).toBeGreaterThan(0);
});

test("read-only mindmaps have no mutation form even when an apply callback is supplied", () => {
  const apply = vi.fn();
  render(<Mindmap source={"# Root\n\n- Alpha\n"} readOnly onApply={apply} />);
  expect(screen.queryByLabelText("脑图节点")).toBeNull();
  expect(screen.queryByRole("button", { name: "重命名" })).toBeNull();
  expect(apply).not.toHaveBeenCalled();
});

test("mindmap node draft survives mode disposal without writing to Markdown", () => {
  const source = "# Root\n\n- Alpha\n",
    apply = vi.fn(),
    active = vi.fn();
  const props = {
    source,
    onApply: apply,
    viewKey: "mind-draft-test:block:0",
    onEditingChange: active,
  };
  const first = render(<Mindmap {...props} />);
  const id = flattenMind(outlineTree(source)).find(
    (n) => n.label === "Alpha",
  )!.id;
  fireEvent.change(screen.getByLabelText("脑图节点"), {
    target: { value: id },
  });
  fireEvent.change(screen.getByLabelText("脑图节点名称"), {
    target: { value: "未提交节点" },
  });
  expect(active).toHaveBeenLastCalledWith(true);
  first.unmount();
  render(<Mindmap {...props} />);
  expect(
    (screen.getByLabelText("脑图节点名称") as HTMLInputElement).value,
  ).toBe("未提交节点");
  expect(apply).not.toHaveBeenCalled();
});
