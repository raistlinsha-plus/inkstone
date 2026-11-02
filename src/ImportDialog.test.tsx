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
vi.mock("@tauri-apps/api/core", () => ({ invoke: api.invoke }));
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
  fireEvent.click(screen.getByRole("button", { name: "复制导入" }));
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
