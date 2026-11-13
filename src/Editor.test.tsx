// @vitest-environment jsdom
import { useImperativeHandle, type Ref } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { EditorHandle } from "./TextEditor";

vi.mock("./TextEditor", () => ({
  default: ({
    handleRef,
    content,
  }: {
    handleRef: Ref<EditorHandle>;
    content: string;
  }) => {
    useImperativeHandle(handleRef, () => ({
      getContent: () => content,
      focus: vi.fn(),
      insertBlock: vi.fn(),
      runInsertCommand: vi.fn(),
      closeMenus: vi.fn(),
      captureSelection: () => ({ mode: "source", head: content.length }),
      insertMarkdown: vi.fn(),
    }));
    return <textarea aria-label="正文测试输入" defaultValue={content} />;
  },
}));
import Editor from "./Editor";

afterEach(cleanup);
test("pointer-opened insert menu accepts keyboard navigation while the document retains focus", () => {
  const onChange = vi.fn();
  render(
    <Editor
      content="原文保持"
      mode="visual"
      path="test.md"
      onChange={onChange}
      onError={vi.fn()}
    />,
  );
  const input = screen.getByLabelText("正文测试输入");
  const trigger = screen.getByRole("button", { name: /^插入$/ });
  input.focus();
  fireEvent.mouseDown(trigger);
  fireEvent.click(trigger);
  expect(document.activeElement).toBe(input);
  fireEvent.keyDown(input, { key: "ArrowUp" });
  expect(document.activeElement).toBe(
    screen.getByRole("menuitem", { name: /^日历$/ }),
  );
  fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
  expect(document.activeElement).toBe(
    screen.getByRole("menuitem", { name: /^正文$/ }),
  );
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(onChange).not.toHaveBeenCalled();
});

test("toolbar follows actual document pane width, independently of window width", () => {
  let width = 400;
  const box = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(() => ({
      width,
      height: 600,
      top: 0,
      left: 0,
      right: width,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON() {},
    }));
  const { container, unmount } = render(
    <Editor
      content="正文"
      mode="visual"
      path="test.md"
      onChange={vi.fn()}
      onError={vi.fn()}
    />,
  );
  expect(
    container
      .querySelector(".document-editor")
      ?.getAttribute("data-compact-tools"),
  ).toBe("true");
  width = 800;
  fireEvent(window, new Event("resize"));
  expect(
    container
      .querySelector(".document-editor")
      ?.getAttribute("data-compact-tools"),
  ).toBe("false");
  unmount();
  box.mockRestore();
});
test("undo and redo expose real history availability", () => {
  const changed = vi.fn();
  const props = {
    mode: "visual" as const,
    path: "test.md",
    onChange: changed,
    onError: vi.fn(),
  };
  const { rerender } = render(<Editor {...props} content="原文" />);
  expect(
    (screen.getByRole("button", { name: "撤销" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  rerender(<Editor {...props} content="修改稿" />);
  expect(
    (screen.getByRole("button", { name: "撤销" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "撤销" }));
  expect(changed).toHaveBeenCalledWith("原文");
  expect(
    (screen.getByRole("button", { name: "重做" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
});

test("keyboard opens the insert menu and Escape returns to the toolbar", () => {
  render(
    <Editor
      content="正文"
      mode="source"
      path="test.md"
      onChange={vi.fn()}
      onError={vi.fn()}
    />,
  );
  const trigger = screen.getByRole("button", { name: "插入" });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
  const menu = screen.getByRole("menu", { name: "插入内容" });
  expect(trigger.getAttribute("aria-controls")).toBe(menu.id);
  expect(document.activeElement).toBe(
    screen.getByRole("menuitem", { name: "正文" }),
  );
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(document.activeElement).toBe(trigger);
  expect(screen.queryByRole("menu")).toBeNull();
});
