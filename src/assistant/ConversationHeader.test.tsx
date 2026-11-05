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
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
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
