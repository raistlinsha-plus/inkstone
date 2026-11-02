// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import SourceReviewDialog, {
  type SourceUpdatePreview,
} from "./SourceReviewDialog";
const api = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: api.invoke }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const document = {
  id: "d1",
  projectId: "s1",
  path: "documents/d1/笔记.md",
  title: "笔记.md",
  source: "/source/笔记.md",
  updated: 0,
  opened: 0,
  status: "ready" as const,
};
const preview: SourceUpdatePreview = {
  documentId: "d1",
  title: "笔记.md",
  status: "source-changed",
  managedHash: "hash",
  managedFingerprint: "managed-v1",
  sourceFingerprint: "source-v2",
  canUpdate: true,
  canKeepBoth: true,
  message: "原件已更新，可比较后应用。",
  currentContent: "旧正文",
  sourceContent: "新正文",
  attachmentChanges: ["图像已更新"],
  warnings: [],
};
function setup(p = preview) {
  api.invoke.mockImplementation((cmd: string) =>
    Promise.resolve(
      cmd === "library_check_source_update"
        ? p
        : cmd === "library_history"
          ? [
              {
                id: "v1",
                created: 1720000000,
                reason: "来源更新前",
                contentHash: "old",
                attachmentCount: 1,
              },
            ]
          : { document, warning: null },
    ),
  );
}
test("a three-way conflict cannot overwrite, but explicitly preserving both remains available", async () => {
  setup({
    ...preview,
    status: "conflict",
    canUpdate: false,
    message: "副本与原件均已修改",
  });
  const changed = vi.fn().mockResolvedValue(undefined);
  render(
    <SourceReviewDialog
      document={document}
      onClose={() => {}}
      onChanged={changed}
      onBusy={() => {}}
    />,
  );
  await screen.findByText("副本与原件均已修改");
  expect(
    (screen.getByRole("button", { name: "更新已有文档" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "保留两份" }));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(api.invoke).toHaveBeenCalledWith("library_apply_source_update", {
    id: "d1",
    expectedManagedFingerprint: "managed-v1",
    expectedSourceFingerprint: "source-v2",
    keepBoth: true,
  });
});
test("source changes detected after preview leave the dialog open without reporting a commit", async () => {
  setup();
  api.invoke.mockImplementation((cmd: string) =>
    cmd === "library_apply_source_update"
      ? Promise.reject("原件已变化，请重新比较")
      : Promise.resolve(cmd === "library_check_source_update" ? preview : []),
  );
  const close = vi.fn(),
    changed = vi.fn();
  render(
    <SourceReviewDialog
      document={document}
      onClose={close}
      onChanged={changed}
      onBusy={() => {}}
    />,
  );
  await screen.findByText(preview.message);
  fireEvent.click(screen.getByRole("button", { name: "更新已有文档" }));
  await screen.findByRole("alert");
  expect(changed).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});
test("a committed copy remains locked while its list refresh is pending", async () => {
  setup();
  let complete!: () => void;
  const refresh = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const close = vi.fn(),
    changed = vi.fn(() => refresh),
    lock = vi.fn();
  render(
    <SourceReviewDialog
      document={document}
      onClose={close}
      onChanged={changed}
      onBusy={lock}
    />,
  );
  await screen.findByText(preview.message);
  fireEvent.click(screen.getByRole("button", { name: "保留两份" }));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(
    (screen.getByRole("button", { name: "保留两份" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "保留两份" }));
  fireEvent.keyDown(globalThis.document, { key: "Escape" });
  expect(
    api.invoke.mock.calls.filter(
      ([cmd]) => cmd === "library_apply_source_update",
    ),
  ).toHaveLength(1);
  expect(close).not.toHaveBeenCalled();
  expect(lock.mock.calls).toEqual([[true]]);
  await act(async () => complete());
  await waitFor(() => expect(lock.mock.calls).toEqual([[true], [false]]));
  expect(close).toHaveBeenCalledOnce();
});
test("restoring waits for confirmation and releases the app mutation guard only after backend commit", async () => {
  setup();
  let finish!: (value: unknown) => void;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const initial = api.invoke.getMockImplementation()!;
  api.invoke.mockImplementation((cmd: string, args: unknown) =>
    cmd === "library_restore_version" ? pending : initial(cmd, args),
  );
  const order: string[] = [],
    close = vi.fn();
  render(
    <SourceReviewDialog
      document={document}
      initialTab="history"
      onClose={close}
      onBusy={(b) => order.push(b ? "locked" : "released")}
      onChanged={async () => {
        order.push("refreshed");
      }}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "选择恢复" }));
  expect(
    api.invoke.mock.calls.some(([cmd]) => cmd === "library_restore_version"),
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "确认恢复此版本" }));
  expect(order).toEqual(["locked"]);
  fireEvent.keyDown(globalThis.document, { key: "Escape" });
  expect(close).not.toHaveBeenCalled();
  await act(async () => finish({ document, warning: null }));
  await waitFor(() =>
    expect(order).toEqual(["locked", "refreshed", "released"]),
  );
  expect(api.invoke).toHaveBeenCalledWith("library_restore_version", {
    id: "d1",
    versionId: "v1",
    expectedManagedFingerprint: "managed-v1",
  });
  expect(close).toHaveBeenCalledOnce();
});
