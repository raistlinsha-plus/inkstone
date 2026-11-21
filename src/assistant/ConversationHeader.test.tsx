// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ConversationHeader } from "./ConversationHeader";
import type { AssistantController } from "./useAssistant";
const api = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => api);
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
test("history queries older titles on the backend, paginates and applies archive scope", async () => {
  vi.useFakeTimers();
  const advanceSearch = async (milliseconds = 200) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(milliseconds);
    });
  };
  const row = (id: string) => ({
    id,
    title: id,
    scopeLabel: "当前空间",
    turnCount: 1,
    archived: false,
  });
  const search = vi.fn(async (archive: boolean, q: string, offset: number) =>
    q
      ? [row("旧专题")]
      : offset === 0
        ? Array.from({ length: 200 }, (_, i) => row("recent-" + i))
        : [row("older-201")],
  );
  const controller = {
    conversation: null,
    error: "",
    workspaceKey: "space",
    search,
  } as unknown as AssistantController;
  render(
    <ConversationHeader
      controller={controller}
      disabled={false}
      expanded={false}
      onExpand={() => {}}
      onNew={() => {}}
      onActivate={() => {}}
      onError={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "会话" }));
  await advanceSearch(199);
  expect(search).not.toHaveBeenCalled();
  await advanceSearch(1);
  // Check the target row's button semantics without repeatedly walking the
  // accessibility tree of all 200 records while polling a real debounce.
  expect(screen.getByText("recent-199").closest("button")).not.toBeNull();
  await act(async () => {
    fireEvent.click(screen.getByText("加载更多会话"));
  });
  expect(screen.getByText("older-201").closest("button")).not.toBeNull();
  expect(search).toHaveBeenLastCalledWith(false, "", 200);
  fireEvent.change(screen.getByRole("textbox", { name: "查找会话" }), {
    target: { value: "旧专题" },
  });
  await advanceSearch();
  expect(screen.getByText("旧专题").closest("button")).not.toBeNull();
  expect(screen.queryByText("recent-199")).toBeNull();
  expect(search).toHaveBeenLastCalledWith(false, "旧专题", 0);
  fireEvent.click(screen.getByLabelText("显示已归档会话"));
  await advanceSearch();
  expect(search).toHaveBeenLastCalledWith(true, "旧专题", 0);
});

test("export defaults to the current branch and explicitly switches to all records", async () => {
  api.invoke.mockResolvedValue({
    markdown: "当前分支内容",
    allMarkdown: "全部分支与候选内容",
    json: "{}",
  });
  const controller = {
    conversation: { id: "c", title: "会话", scopeLabel: "当前空间" },
    error: "",
  } as unknown as AssistantController;
  render(
    <ConversationHeader
      controller={controller}
      disabled={false}
      expanded={false}
      onExpand={() => {}}
      onNew={() => {}}
      onActivate={() => {}}
      onError={() => {}}
    />,
  );
  fireEvent.click(screen.getByLabelText("管理当前会话"));
  fireEvent.click(screen.getByRole("button", { name: "导出会话" }));
  await screen.findByRole("dialog", { name: "导出问答会话" });
  expect(
    (screen.getByRole("textbox", { name: "Markdown" }) as HTMLTextAreaElement)
      .value,
  ).toBe("当前分支内容");
  fireEvent.change(screen.getByLabelText("会话导出范围"), {
    target: { value: "all" },
  });
  expect(
    (screen.getByRole("textbox", { name: "Markdown" }) as HTMLTextAreaElement)
      .value,
  ).toBe("全部分支与候选内容");
});

test("document questions share one header while named and archived threads keep their context", () => {
  const onExpand = vi.fn();
  const common = {
    dock: {
      modes: <button>问答</button>,
      onClose: vi.fn(),
      onGeneral: vi.fn(),
      canOpenGeneral: true,
    },
    disabled: false,
    expanded: false,
    onExpand,
    onNew: vi.fn(),
    onActivate: vi.fn(),
    onError: vi.fn(),
  };
  const controller = {
    general: false,
    conversation: null,
    workspaceKey: "space",
  } as unknown as AssistantController;
  const { rerender } = render(
    <ConversationHeader {...common} controller={controller} />,
  );
  expect(screen.queryByText("新会话")).toBeNull();
  expect(screen.getByRole("button", { name: "会话历史" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "新建会话" })).toBeTruthy();
  const more = screen.getByLabelText("更多会话操作");
  fireEvent.click(more);
  fireEvent.click(screen.getByRole("button", { name: "展开问答" }));
  expect(onExpand).toHaveBeenCalledOnce();
  expect(more.closest("details")?.open).toBe(false);
  expect(document.activeElement).toBe(more);
  rerender(
    <ConversationHeader
      {...common}
      controller={
        {
          ...controller,
          conversation: { title: "春季读书会", archived: true, turns: [] },
        } as unknown as AssistantController
      }
    />,
  );
  expect(screen.getByText("春季读书会")).toBeTruthy();
  expect(screen.getByText("已归档")).toBeTruthy();
});

test("conversation actions dismiss on non-focusable space and keep edited titles through backdrop clicks", () => {
  const controller = {
    conversation: { id: "c", title: "一次对话" },
    workspaceKey: "s",
  } as unknown as AssistantController;
  render(
    <>
      <div data-testid="outside">正文</div>
      <ConversationHeader
        controller={controller}
        disabled={false}
        expanded={false}
        onExpand={vi.fn()}
        onNew={vi.fn()}
        onActivate={vi.fn()}
        onError={vi.fn()}
      />
    </>,
  );
  const trigger = screen.getByLabelText("管理当前会话");
  const details = trigger.closest("details")!;
  fireEvent.click(trigger);
  fireEvent.pointerDown(screen.getByTestId("outside"));
  expect(details.open).toBe(false);
  fireEvent.keyDown(trigger, { key: "ArrowUp" });
  expect(document.activeElement?.textContent).toBe("删除会话…");
  fireEvent.keyDown(document.activeElement!, {
    key: "Escape",
    isComposing: true,
  });
  expect(details.open).toBe(true);
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(details.open).toBe(false);
  expect(document.activeElement).toBe(trigger);
  fireEvent.keyDown(trigger, { key: "Enter" });
  fireEvent.click(screen.getByRole("button", { name: "重命名会话" }));
  const title = screen.getByRole("textbox", { name: "会话标题" });
  fireEvent.change(title, { target: { value: "编辑中的标题" } });
  fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
  expect((title as HTMLInputElement).value).toBe("编辑中的标题");
  expect(screen.getByRole("dialog")).toBeTruthy();
});
