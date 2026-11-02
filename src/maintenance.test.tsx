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
import type { LibraryDocument } from "./library";
const api = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: api.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: api.open }));
import RelinkDialog from "./RelinkDialog";
import BackupDialog from "./BackupDialog";
import RecoveryDialog from "./RecoveryDialog";
import IndexStatusPanel from "./IndexStatusPanel";
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const doc: LibraryDocument = {
  id: "d1",
  projectId: "p1",
  path: "one/a.md",
  title: "资料",
  source: "/src/a.md",
  updated: 0,
  opened: 0,
  status: "ready",
};
const preview = {
  documentId: "d1",
  managedFingerprint: "body-v1",
  catalogFingerprint: "targets-v1",
  currentContent: "[目标](b.md)",
  projectedContent: "[目标](../d2/b.md)",
  links: [],
  warnings: [],
};
test("relink freezes the preview fingerprints and cannot repeat a committed mutation during refresh", async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => (finish = resolve)),
    close = vi.fn(),
    lock = vi.fn();
  api.invoke.mockImplementation((cmd) =>
    Promise.resolve(
      cmd === "library_relink_preview" ? preview : { document: doc },
    ),
  );
  const changed = vi.fn(() => pending);
  render(
    <RelinkDialog
      document={doc}
      onClose={close}
      onChanged={changed}
      onBusy={lock}
    />,
  );
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "保存链接关联",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "保存链接关联" }));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "保存链接关联" }));
  fireEvent.keyDown(document, { key: "Escape" });
  expect(close).not.toHaveBeenCalled();
  expect(lock.mock.calls).toEqual([[true]]);
  expect(api.invoke).toHaveBeenCalledWith("library_relink_apply", {
    id: "d1",
    expectedManagedFingerprint: "body-v1",
    expectedCatalogFingerprint: "targets-v1",
    choices: [],
  });
  expect(
    api.invoke.mock.calls.filter(([cmd]) => cmd === "library_relink_apply"),
  ).toHaveLength(1);
  await act(async () => finish());
  await waitFor(() => expect(lock.mock.calls).toEqual([[true], [false]]));
});
test("ambiguous targets require an explicit choice and a fresh preview before saving", async () => {
  api.invoke.mockResolvedValue({
    ...preview,
    projectedContent: preview.currentContent,
    links: [
      {
        url: "b.md",
        status: "ambiguous",
        targetDocumentId: null,
        replacement: null,
        candidates: [
          { id: "d2", title: "B一", path: "d2/b.md" },
          { id: "d3", title: "B二", path: "d3/b.md" },
        ],
      },
    ],
  });
  render(
    <RelinkDialog
      document={doc}
      onClose={() => {}}
      onChanged={async () => {}}
      onBusy={() => {}}
    />,
  );
  await screen.findByLabelText("关联目标 b.md");
  fireEvent.change(screen.getByLabelText("关联目标 b.md"), {
    target: { value: "d2" },
  });
  expect(
    (screen.getByRole("button", { name: "保存链接关联" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "重新预览" }));
  await waitFor(() =>
    expect(api.invoke).toHaveBeenLastCalledWith("library_relink_preview", {
      id: "d1",
      choices: [{ url: "b.md", documentId: "d2" }],
    }),
  );
});
test("resolved links show a friendly target name while retaining the exact encoded path for review", async () => {
  const replacement =
    "%2E%2E/974eff5d%2Df4fa%2D41eb%2D9df6%2D391fbc4a3e5d/%E7%9B%AE%E6%A0%87%2Emd";
  api.invoke.mockResolvedValue({
    ...preview,
    links: [
      {
        url: "b.md",
        status: "resolved",
        targetDocumentId: "d2",
        replacement,
        candidates: [{ id: "d2", title: "目标说明", path: "d2/目标.md" }],
      },
    ],
  });
  render(
    <RelinkDialog
      document={doc}
      onClose={() => {}}
      onChanged={async () => {}}
      onBusy={() => {}}
    />,
  );
  await screen.findByText("→ 目标说明");
  expect(screen.getByText("→ 目标说明").getAttribute("title")).toBe(
    replacement,
  );
  const full = screen.getByText(replacement);
  expect(full.closest("details")?.hasAttribute("open")).toBe(false);
  fireEvent.click(screen.getByText("核对完整链接"));
  expect(full.closest("details")).toBeTruthy();
});
test("a failed backup validation never enables restoration", async () => {
  api.open.mockResolvedValue("/backup/bad");
  api.invoke.mockResolvedValue({
    valid: false,
    path: "/backup/bad",
    files: 2,
    totalBytes: 2,
    createdAt: 0,
    schemaVersion: 3,
    manifestHash: "bad",
    issues: ["文件指纹不匹配"],
    warnings: [],
  });
  render(
    <BackupDialog
      onClose={() => {}}
      onPrepare={async () => true}
      onBusy={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "选择备份包" }));
  await waitFor(() =>
    expect(
      (screen.getByLabelText("所选备份路径") as HTMLInputElement).value,
    ).toBe("/backup/bad"),
  );
  fireEvent.click(screen.getByRole("button", { name: "校验清单与文件" }));
  await screen.findByText("备份校验失败");
  expect(
    (
      screen.getByRole("button", {
        name: "生成恢复预演副本",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(api.invoke).not.toHaveBeenCalledWith(
    "library_restore_backup",
    expect.anything(),
  );
});
test("backup waits for accepted editor work and holds the mutation lock until completion", async () => {
  let finish!: () => void;
  const prepare = new Promise<boolean>(
      (resolve) => (finish = () => resolve(true)),
    ),
    lock = vi.fn();
  api.open.mockResolvedValue("/safe");
  api.invoke.mockResolvedValue({
    path: "/safe/backup.zip",
    files: 3,
    totalBytes: 20,
    createdAt: 0,
    manifestHash: "hash",
    mode: "backup",
    warnings: [],
  });
  render(
    <BackupDialog onClose={() => {}} onPrepare={() => prepare} onBusy={lock} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "选择父目录" }));
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "生成并校验备份",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.change(screen.getByLabelText("备份文件名"), {
    target: { value: "backup.zip" },
  });
  fireEvent.click(screen.getByRole("button", { name: "生成并校验备份" }));
  expect(api.invoke).not.toHaveBeenCalled();
  expect(lock.mock.calls).toEqual([[true]]);
  await act(async () => finish());
  await screen.findByText("备份已生成并校验");
  expect(api.invoke).toHaveBeenCalledWith("library_create_backup", {
    target: "/safe/backup.zip",
  });
  expect(lock.mock.calls).toEqual([[true], [false]]);
});
test("recovery diagnostics retain mixed results and retry only through the recovery command", async () => {
  const report = {
    checkedAt: 0,
    items: [
      {
        operationId: "op1",
        documentId: "d1",
        projectId: "p1",
        kind: "save",
        status: "metadata-pending" as const,
        retryable: true,
        message: "内容已落盘",
      },
    ],
  };
  api.invoke.mockResolvedValue({
    ...report,
    items: [
      {
        ...report.items[0],
        status: "recovered",
        retryable: false,
        message: "核对完成",
      },
    ],
  });
  render(
    <RecoveryDialog
      initial={report}
      onClose={() => {}}
      onReport={() => {}}
      onBusy={() => {}}
    />,
  );
  expect(screen.getByText("正文已保存，元数据待恢复")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "重试可恢复项" }));
  await screen.findByText("已恢复");
  expect(api.invoke).toHaveBeenCalledWith("library_retry_recovery");
});
test("index status counts excluded documents separately and binds updates to an exact path", () => {
  const update = vi.fn();
  render(
    <IndexStatusPanel
      snapshot={{
        checkedAt: 1,
        embeddingProfile: "model-v2",
        documents: [
          {
            path: "a.md",
            title: "旧正文",
            included: true,
            keywordState: "ready",
            vectorState: "profile_changed",
          },
          {
            path: "data.json",
            title: "独立JSON",
            included: false,
            reason: "默认排除",
            keywordState: "excluded",
            vectorState: "excluded",
          },
        ],
      }}
      loading={false}
      busy={false}
      error=""
      onRefresh={() => {}}
      onUpdate={update}
    />,
  );
  expect(
    screen.getByText("空间 2 篇 · 已纳入 1 篇 · 待处理 1 篇"),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "显式纳入并更新" }));
  expect(update).toHaveBeenCalledWith("data.json");
  fireEvent.click(screen.getByRole("button", { name: "待处理" }));
  expect(screen.queryByText("独立JSON")).toBeNull();
  expect(screen.getByText("向量 · 模型已变")).toBeTruthy();
});
