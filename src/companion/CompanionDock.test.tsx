// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import CompanionDock from "./CompanionDock";
import type { Snapshot } from "./types";
const mocked = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocked.invoke }));
const workspace = {
  root: "/synthetic/space",
  name: "合成空间",
  managedProjectId: "space-1",
  files: [],
  stats: { documents: 1, chunks: 1, vectors: 0, embeddingReady: false },
};
const base = (): Snapshot => ({
  generation: "generation-1",
  revision: 1,
  timezone: "Asia/Shanghai",
  settings: {
    enabled: true,
    characterId: "motuan",
    mode: "focus",
    compact: false,
    reducedMotion: true,
  },
  events: 0,
  days: 0,
  roles: { motuan: { read: [0], choices: {}, outfit: 0 } },
  cards: [],
  preferences: [],
  pending: [],
  eligible: null,
});
let current: Snapshot;
beforeEach(() => {
  current = base();
  mocked.invoke.mockReset();
  mocked.invoke.mockImplementation(
    async (cmd: string, args?: { input?: Record<string, unknown> }) => {
      if (cmd === "companion_state") return structuredClone(current);
      if (cmd === "companion_settings") {
        current = {
          ...current,
          revision: current.revision + 1,
          settings: {
            ...current.settings,
            ...args?.input,
          } as Snapshot["settings"],
        };
        return structuredClone(current);
      }
      if (cmd === "companion_preview")
        return {
          token: "server-token",
          eventId: "server-event",
          suggestedText: "完成一份资料整理",
          day: "2026-11-05",
          canRevise: false,
          expiresAt: 9999999999,
          context: {
            generation: current.generation,
            revision: current.revision,
          },
        };
      throw Error("Unexpected command: " + cmd);
    },
  );
});
afterEach(cleanup);
const mount = (saved = true) =>
  render(
    <CompanionDock
      workspace={workspace}
      documentPath="note.md"
      documentHash="hash"
      saved={saved}
    />,
  );
test("opt-in is explicit and selecting a role does not record work or call a model", async () => {
  current.settings.enabled = false;
  current.roles = {};
  mount();
  fireEvent.click(screen.getByRole("button", { name: "认识同伴" }));
  await screen.findByRole("button", { name: "与墨团相遇" });
  fireEvent.click(screen.getByRole("button", { name: "与墨团相遇" }));
  await screen.findByRole("dialog", { name: "纸页旁的小影子" });
  expect(
    mocked.invoke.mock.calls.every(([name]) =>
      String(name).startsWith("companion_"),
    ),
  ).toBe(true);
  expect(
    mocked.invoke.mock.calls.some(([name]) => name === "companion_confirm"),
  ).toBe(false);
});
test("unsaved work cannot preview a completion", async () => {
  mount(false);
  const button = await screen.findByRole("button", { name: "本次完成" });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(button);
  expect(
    mocked.invoke.mock.calls.some(([name]) => name === "companion_preview"),
  ).toBe(false);
});
test("preview requires consent and sends server token; a failed write never claims success", async () => {
  mocked.invoke.mockImplementation(async (cmd: string) => {
    if (cmd === "companion_state") return structuredClone(current);
    if (cmd === "companion_preview")
      return {
        token: "server-token",
        eventId: "server-event",
        suggestedText: "完成一份资料整理",
        day: "2026-11-05",
        canRevise: false,
        context: { generation: current.generation, revision: current.revision },
      };
    if (cmd === "companion_confirm")
      throw Error("STORAGE_ERROR：工作已保存，经历待保存");
    throw Error(cmd);
  });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "本次完成" }));
  const confirm = await screen.findByRole("button", { name: "确认并记录" });
  expect((confirm as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(confirm);
  await screen.findByRole("alert");
  expect(screen.queryByText("经历已记录。新章节会安静留在同伴入口。")).toBe(
    null,
  );
  const call = mocked.invoke.mock.calls.find(
    ([name]) => name === "companion_confirm",
  );
  expect(call?.[1]).toMatchObject({
    workspaceRoot: workspace.root,
    input: { token: "server-token", eventId: "server-event", consent: true },
  });
});
test("a late preview cannot open in a new workspace", async () => {
  let resolve: ((v: unknown) => void) | undefined;
  mocked.invoke.mockImplementation(async (cmd: string) =>
    cmd === "companion_state"
      ? structuredClone(current)
      : new Promise((r) => {
          resolve = r;
        }),
  );
  const ui = mount();
  fireEvent.click(await screen.findByRole("button", { name: "本次完成" }));
  await waitFor(() => expect(resolve).toBeTypeOf("function"));
  ui.rerender(
    <CompanionDock
      workspace={{
        ...workspace,
        root: "/synthetic/other",
        managedProjectId: "space-2",
      }}
      documentPath="other.md"
      documentHash="other"
      saved
    />,
  );
  resolve?.({
    token: "old",
    eventId: "old",
    suggestedText: "旧空间工作",
    context: { generation: "generation-1", revision: 1 },
  });
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "记录本次完成" })).toBe(null),
  );
});
test("closing a chapter does not mark it read", async () => {
  current.eligible = 1;
  current.events = 3;
  current.days = 2;
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "打开新章" }));
  await screen.findByRole("dialog", { name: "捡到一枚书签" });
  fireEvent.click(screen.getByRole("button", { name: "关闭同伴面板" }));
  expect(
    mocked.invoke.mock.calls.some(([name]) => name === "companion_story"),
  ).toBe(false);
});

test("pet status reflects actual work failure without a celebratory line", async () => {
  render(
    <CompanionDock
      workspace={workspace}
      documentPath="note.md"
      documentHash="hash"
      saved
      activity="blocked"
      activityText="模型连接失败，请重试"
    />,
  );
  await screen.findByText("模型连接失败，请重试");
  expect(screen.queryByText("回答已完成，可核对依据")).toBe(null);
});
