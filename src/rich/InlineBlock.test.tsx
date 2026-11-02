// @vitest-environment jsdom
import { useEffect, useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
vi.mock("../preview/JsonTree", () => ({ default: () => null }));
vi.mock("../preview/Graph", () => ({ default: () => null }));
vi.mock("../preview/Mindmap", () => ({ default: () => null }));
vi.mock("../calendar/CalendarBlock", () => ({
  default: ({
    onEditingChange,
  }: {
    onEditingChange: (active: boolean) => void;
  }) => {
    const [editing, setEditing] = useState(false),
      [draft, setDraft] = useState("");
    useEffect(() => {
      onEditingChange(editing);
    }, [editing, onEditingChange]);
    return (
      <div>
        <button onClick={() => setEditing(!editing)}>
          {editing ? "关闭测试事项" : "打开测试事项"}
        </button>
        {editing && (
          <input
            aria-label="未保存的事项"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        )}
      </div>
    );
  },
}));
import InlineBlock from "./InlineBlock";
test("ordinary code remains readable after editing and never renders source HTML", () => {
  const source = 'print("Inkstone")\n<script>untrusted()</script>';
  render(
    <InlineBlock
      language="python"
      source={source}
      apply={vi.fn()}
      action={vi.fn()}
    />,
  );
  expect(screen.getByLabelText("python内容").textContent).toBe(source);
  expect(document.querySelector("script")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "编辑代码" }));
  expect(
    (screen.getByLabelText("python块源码") as HTMLTextAreaElement).value,
  ).toBe(source);
  fireEvent.click(screen.getByRole("button", { name: "完成编辑" }));
  expect(screen.getByLabelText("python内容").textContent).toBe(source);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
test("scrolling an event form offscreen preserves its draft until it is closed", async () => {
  let report!: (entries: { isIntersecting: boolean }[]) => void;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: typeof report) {
        report = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  render(
    <InlineBlock
      language="calendar"
      source="{}"
      apply={vi.fn()}
      action={vi.fn()}
    />,
  );
  act(() => {
    report([{ isIntersecting: true }]);
  });
  fireEvent.click(await screen.findByRole("button", { name: "打开测试事项" }));
  fireEvent.change(screen.getByLabelText("未保存的事项"), {
    target: { value: "尚未保存的中文标题" },
  });
  act(() => {
    report([{ isIntersecting: false }]);
  });
  expect(
    (screen.getByLabelText("未保存的事项") as HTMLInputElement).value,
  ).toBe("尚未保存的中文标题");
  act(() => {
    report([{ isIntersecting: true }]);
  });
  expect(
    (screen.getByLabelText("未保存的事项") as HTMLInputElement).value,
  ).toBe("尚未保存的中文标题");
  act(() => {
    report([{ isIntersecting: false }]);
  });
  fireEvent.click(screen.getByRole("button", { name: "关闭测试事项" }));
  expect(screen.queryByLabelText("未保存的事项")).toBeNull();
  expect(screen.getByText("滚动到此处后本地呈现")).toBeTruthy();
});
