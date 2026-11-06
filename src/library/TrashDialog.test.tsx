// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
const api = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: api.invoke }));
import TrashDialog from "./TrashDialog";
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const document = {
  id: "d",
  projectId: "s",
  path: "documents/d/a.md",
  title: "计划.md",
  source: "",
  updated: 1,
  opened: 0,
  status: "trashed" as const,
};
const detail = {
  documentId: "d",
  projectId: "s",
  title: "计划.md",
  status: "trashed",
  trashedAt: null,
  attachments: 1,
  history: 2,
  bytes: 123,
};
function setup() {
  api.invoke.mockImplementation(async (cmd: string) => {
    if (cmd === "library_trash_detail") return detail;
    if (cmd === "library_purge_preview")
      return { detail, token: "token", expiresAt: 999 };
    if (cmd === "library_purge_execute")
      return { operationId: "op", status: "completed", message: "done" };
  });
  const close = vi.fn(),
    restore = vi.fn().mockResolvedValue(undefined),
    refresh = vi.fn().mockResolvedValue(undefined),
    busy = vi.fn();
  render(
    <TrashDialog
      document={document}
      onClose={close}
      onRestore={restore}
      onRefresh={refresh}
      onBeforeAction={async () => true}
      onBusy={busy}
    />,
  );
  return { close, restore, refresh, busy };
}
test("details never restore automatically and irreversible deletion requires exact confirmation", async () => {
  const p = setup();
  await screen.findByText(/1 个附件/);
  expect(p.restore).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "彻底删除…" }));
  const field = await screen.findByLabelText("输入删除以确认");
  const button = screen.getByRole("button", { name: "彻底删除" });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(field, { target: { value: "删" } });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(field, { target: { value: "删除" } });
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(p.close).toHaveBeenCalledTimes(1));
  expect(
    api.invoke.mock.calls.filter(([name]) => name === "library_purge_execute"),
  ).toHaveLength(1);
  expect(p.refresh).toHaveBeenCalled();
});
test("explicit restore leaves parent navigation guard available", async () => {
  const p = setup();
  await screen.findByText(/1 个附件/);
  fireEvent.click(screen.getByRole("button", { name: "恢复文档" }));
  await waitFor(() => expect(p.restore).toHaveBeenCalledTimes(1));
  expect(p.busy).not.toHaveBeenCalledWith(true);
});
test("lost completion response is reconciled by operation status", async () => {
  const p = setup();
  await screen.findByText(/1 个附件/);
  fireEvent.click(screen.getByRole("button", { name: "彻底删除…" }));
  const field = await screen.findByLabelText("输入删除以确认");
  const normal = api.invoke.getMockImplementation()!;
  api.invoke.mockImplementation(async (cmd: string, ...args: unknown[]) => {
    if (cmd === "library_purge_execute") throw Error("lost response");
    if (cmd === "library_purge_status")
      return { operationId: "op", status: "completed", message: "done" };
    return normal(cmd, ...args);
  });
  fireEvent.change(field, { target: { value: "删除" } });
  fireEvent.click(screen.getByRole("button", { name: "彻底删除" }));
  await waitFor(() => expect(p.close).toHaveBeenCalled());
  expect(p.refresh).toHaveBeenCalled();
});
test("a refresh failure after committed deletion does not offer another deletion", async () => {
  const p = setup();
  p.refresh.mockRejectedValueOnce(Error("refresh unavailable"));
  await screen.findByText(/1 个附件/);
  fireEvent.click(screen.getByRole("button", { name: "彻底删除…" }));
  const field = await screen.findByLabelText("输入删除以确认");
  fireEvent.change(field, { target: { value: "删除" } });
  fireEvent.click(screen.getByRole("button", { name: "彻底删除" }));
  await screen.findByRole("dialog", { name: "已彻底删除" });
  expect(screen.queryByLabelText("输入删除以确认")).toBeNull();
  expect(screen.queryByRole("button", { name: "彻底删除" })).toBeNull();
  expect(p.close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "刷新列表" }));
  await waitFor(() => expect(p.close).toHaveBeenCalled());
});
