// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ConversationHeader } from "./ConversationHeader";
import type { AssistantController } from "./useAssistant";
const api = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => api);
afterEach(cleanup);
test("history queries older titles on the backend, paginates and applies archive scope", async () => {
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
  await screen.findByRole("button", { name: /recent-199/ });
  fireEvent.click(screen.getByRole("button", { name: "加载更多会话" }));
  await screen.findByRole("button", { name: /older-201/ });
  expect(search).toHaveBeenCalledWith(false, "", 200);
  fireEvent.change(screen.getByRole("textbox", { name: "查找会话" }), {
    target: { value: "旧专题" },
  });
  await screen.findByRole("button", { name: /旧专题/ });
  expect(search).toHaveBeenCalledWith(false, "旧专题", 0);
  fireEvent.click(screen.getByRole("checkbox", { name: "显示已归档会话" }));
  await waitFor(() => expect(search).toHaveBeenCalledWith(true, "旧专题", 0));
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
  fireEvent.click(
    screen.getByRole("button", { name: "导出会话" }),
  );
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
