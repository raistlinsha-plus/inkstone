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
import type { ImportResult } from "./library";
const api = vi.hoisted(() => ({
  invoke: vi.fn(),
  preflight: vi.fn(),
  progress: undefined as
    | undefined
    | ((event: {
        payload: {
          jobId: string;
          done: number;
          total: number;
          item: {
            source: string;
            status: string;
            documentId: null;
            message: string;
          };
        };
      }) => void),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args: unknown) =>
    command === "library_preview_import"
      ? (api.preflight(command, args) ??
        Promise.resolve({
          documents: 1,
          images: 1,
          attachments: 0,
          skipped: 0,
          existing: 0,
          warnings: [],
        }))
      : api.invoke(command, args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (_name: string, callback: typeof api.progress) => {
    api.progress = callback;
    return Promise.resolve(() => {});
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
import ImportDialog from "./ImportDialog";
afterEach(() => {
  cleanup();
  api.invoke.mockReset();
  api.preflight.mockReset();
  api.progress = undefined;
});

test("one import owns the busy state through file copy and library refresh", async () => {
  let finishImport!: (result: ImportResult) => void, finishRefresh!: () => void;
  api.invoke.mockImplementation((command: string) =>
    command === "library_import"
      ? new Promise((resolve) => {
          finishImport = resolve;
        })
      : Promise.resolve(),
  );
  const onBusy = vi.fn(),
    onClose = vi.fn(),
    onFinished = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = resolve;
        }),
    );
  render(
    <ImportDialog
      view={{
        projects: [{ id: "p", title: "项目" }],
        documents: [],
        pendingImports: [],
      }}
      projectId="p"
      initialPaths={["/source/a.md"]}
      onBusy={onBusy}
      onClose={onClose}
      onFinished={onFinished}
      onOpen={vi.fn()}
    />,
  );
  const start = screen.getByRole("button", { name: "复制导入" });
  await waitFor(() => expect(start.matches(":disabled")).toBe(false));
  act(() => {
    fireEvent.click(start);
    fireEvent.click(start);
  });
  expect(
    api.invoke.mock.calls.filter(([command]) => command === "library_import"),
  ).toHaveLength(1);
  expect(onBusy.mock.calls).toEqual([[true]]);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => {
    finishImport({
      jobId: "one",
      projectId: "p",
      cancelled: false,
      items: [],
      warnings: [],
    });
  });
  expect(onFinished).toHaveBeenCalledOnce();
  expect(onBusy.mock.calls).toEqual([[true]]);
  expect(
    screen.getByRole("button", { name: "关闭导入" }).matches(":disabled"),
  ).toBe(true);
  await act(async () => {
    finishRefresh();
  });
  expect(onBusy.mock.calls).toEqual([[true], [false]]);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(onClose).toHaveBeenCalledOnce();
});

test("retry does not display progress from a finished import", async () => {
  let finishImport!: (result: ImportResult) => void;
  api.invoke.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishImport = resolve;
      }),
  );
  render(
    <ImportDialog
      view={{
        projects: [{ id: "p", title: "项目" }],
        documents: [],
        pendingImports: [],
      }}
      projectId="p"
      initialPaths={["/source/a.md"]}
      onBusy={vi.fn()}
      onClose={vi.fn()}
      onFinished={async () => {}}
      onOpen={vi.fn()}
    />,
  );
  const start = screen.getByRole("button", { name: "复制导入" });
  await waitFor(() => expect(start.matches(":disabled")).toBe(false));
  fireEvent.click(start);
  await act(async () => {
    finishImport({
      jobId: "old",
      projectId: "p",
      cancelled: true,
      items: [],
      warnings: [],
    });
  });
  fireEvent.click(screen.getByRole("button", { name: "重新检查并导入" }));
  act(() => {
    api.progress?.({
      payload: {
        jobId: "old",
        done: 1,
        total: 1,
        item: {
          source: "旧进度.md",
          status: "failed",
          documentId: null,
          message: "旧任务",
        },
      },
    });
  });
  expect(screen.queryByText("旧进度.md")).toBeNull();
  act(() => {
    api.progress?.({
      payload: {
        jobId: "new",
        done: 1,
        total: 2,
        item: {
          source: "新进度.md",
          status: "imported",
          documentId: null,
          message: "已复制",
        },
      },
    });
  });
  expect(screen.getByText("新进度.md")).toBeTruthy();
  await act(async () => {
    finishImport({
      jobId: "new",
      projectId: "p",
      cancelled: false,
      items: [],
      warnings: [],
    });
  });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "完成" }).matches(":disabled"),
    ).toBe(false),
  );
});

test("opens existing copies and retries only failed selected files, including after a retry error", async () => {
  const existing = {
    source: "/source/a.md",
    documentId: "old",
    status: "skipped",
    message: "已有副本",
  };
  const failed = {
    source: "/source/b.md",
    documentId: null,
    status: "failed",
    message: "无法读取",
  };
  const first = {
    jobId: "one",
    projectId: "p",
    cancelled: false,
    warnings: [],
    items: [existing, failed],
  };
  api.invoke
    .mockResolvedValueOnce(first)
    .mockRejectedValueOnce("请重试")
    .mockResolvedValueOnce({
      ...first,
      jobId: "two",
      items: [{ ...failed, status: "imported", documentId: "new" }],
    });
  const onOpen = vi.fn();
  render(
    <ImportDialog
      view={{
        projects: [{ id: "p", title: "空间" }],
        documents: [],
        pendingImports: [],
      }}
      projectId="p"
      initialPaths={[existing.source, failed.source]}
      onBusy={vi.fn()}
      onFinished={async () => {}}
      onOpen={onOpen}
      onClose={vi.fn()}
    />,
  );
  const start = screen.getByRole("button", { name: "复制导入" });
  await waitFor(() => expect(start.matches(":disabled")).toBe(false));
  fireEvent.click(start);
  fireEvent.click(await screen.findByRole("button", { name: "打开已有副本" }));
  expect(onOpen).toHaveBeenCalledWith("old");
  fireEvent.click(screen.getByRole("button", { name: "重试失败文件" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "重试失败文件" }));
  await screen.findByRole("button", { name: "打开副本" });
  expect(api.invoke.mock.calls.slice(1).map(([, args]) => args.paths)).toEqual([
    [failed.source],
    [failed.source],
  ]);
  expect(screen.getByRole("button", { name: "打开已有副本" })).toBeTruthy();
  expect(
    api.invoke.mock.calls
      .slice(1)
      .every(([, args]) => args.resumeJobId === "one"),
  ).toBe(true);
  expect(screen.queryByRole("button", { name: "重新检查并导入" })).toBeNull();
});

test("shows the selected folder, waits for preflight and excludes archived destinations", async () => {
  let finish!: (r: unknown) => void;
  api.preflight.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  api.invoke.mockResolvedValue({
    jobId: "fixture",
    cancelled: false,
    items: [],
    warnings: [],
  });
  render(
    <ImportDialog
      projectId="p"
      folderPath="项目/照片"
      initialPaths={["/selected"]}
      view={{
        projects: [
          { id: "p", title: "我的文档" },
          { id: "old", title: "已封存", archived: true },
        ],
        documents: [],
        pendingImports: [],
      }}
      onBusy={vi.fn()}
      onClose={vi.fn()}
      onOpen={vi.fn()}
      onFinished={async () => {}}
    />,
  );
  expect(screen.queryByRole("option", { name: "已封存" })).toBeNull();
  expect(screen.getByText(/我的文档 \/ 项目\/照片/)).toBeTruthy();
  const start = screen.getByRole("button", { name: "复制导入" });
  expect(start.matches(":disabled")).toBe(true);
  await act(async () =>
    finish({
      documents: 1,
      images: 2,
      attachments: 3,
      skipped: 4,
      existing: 2,
      warnings: [],
    }),
  );
  expect(
    screen.getByText(/1 份文档 · 2 张独立图片 · 3 项附件 · 4 项跳过/),
  ).toBeTruthy();
  expect(screen.getByText(/其中 2 项已存在于目标空间/)).toBeTruthy();
  await act(async () => fireEvent.click(start));
  expect(api.invoke).toHaveBeenCalledWith(
    "library_import",
    expect.objectContaining({ projectId: "p", folder: "项目/照片" }),
  );
});

test("rechecks duplicate counts for the selected space and options, ignores stale results and retries preflight errors", async () => {
  type Report = {
    documents: number;
    images: number;
    attachments: number;
    existing: number;
    skipped: number;
    warnings: string[];
  };
  const report = (existing: number): Report => ({
    documents: 1,
    images: 1,
    attachments: 2,
    existing,
    skipped: 0,
    warnings: [],
  });
  let finishFirst!: (v: Report) => void;
  api.preflight
    .mockImplementationOnce(
      () =>
        new Promise<Report>((r) => {
          finishFirst = r;
        }),
    )
    .mockResolvedValueOnce(report(1))
    .mockResolvedValueOnce(report(0))
    .mockRejectedValueOnce(new Error("catalog busy"))
    .mockResolvedValueOnce(report(2));
  render(
    <ImportDialog
      projectId="a"
      initialPaths={["/pictures"]}
      view={{
        projects: [
          { id: "a", title: "One" },
          { id: "b", title: "Two" },
        ],
        documents: [],
        pendingImports: [],
      }}
      onClose={vi.fn()}
      onOpen={vi.fn()}
      onBusy={vi.fn()}
      onFinished={async () => {}}
    />,
  );
  fireEvent.change(screen.getByLabelText("导入目标空间"), {
    target: { value: "b" },
  });
  expect(await screen.findByText(/其中 1 项已存在于目标空间/)).toBeTruthy();
  expect(api.preflight).toHaveBeenLastCalledWith(
    "library_preview_import",
    expect.objectContaining({
      projectId: "b",
      skipDuplicates: true,
      attachments: true,
    }),
  );
  await act(async () => finishFirst(report(9)));
  expect(screen.queryByText(/其中 9 项/)).toBeNull();
  fireEvent.click(screen.getByLabelText(/跳过相同内容/));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "复制导入" }).matches(":disabled"),
    ).toBe(false),
  );
  expect(screen.queryByText(/项已存在于目标空间/)).toBeNull();
  expect(api.preflight).toHaveBeenLastCalledWith(
    "library_preview_import",
    expect.objectContaining({ projectId: "b", skipDuplicates: false }),
  );
  fireEvent.click(screen.getByLabelText(/跳过相同内容/));
  expect(
    await screen.findByText("catalog busy", { exact: false }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "重新检查" }));
  expect(await screen.findByText(/其中 2 项已存在于目标空间/)).toBeTruthy();
  expect(api.invoke).not.toHaveBeenCalled();
});
