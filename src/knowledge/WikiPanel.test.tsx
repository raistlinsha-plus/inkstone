// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { LibraryView } from "../library";
import WikiPanel from "./WikiPanel";

const api = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: api.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: api.listen }));
vi.mock("../preview/Markdown", () => ({
  default: ({ source, label }: { source: string; label: string }) => (
    <article aria-label={label}>{source}</article>
  ),
}));

const root = "/wiki";
const view: LibraryView = {
  projects: [{ id: "space", title: "合成空间" }],
  documents: [
    {
      id: "manual",
      projectId: "space",
      path: "手册.md",
      title: "手册.md",
      source: "markdown",
      updated: 0,
      opened: 0,
      status: "ready",
    },
  ],
  pendingImports: [],
};
const page = {
  id: "pass",
  title: "凭条",
  revision: 1,
  summary: "手册为 72 小时，周末为 24 小时。",
  sourceCount: 1,
  stale: false,
  body: "手册为 72 小时，周末为 24 小时。",
  refs: [
    {
      documentId: "manual",
      title: "手册.md",
      path: "手册.md",
      startLine: 2,
      endLine: 2,
      quote: "手册为 72 小时。",
      hash: "fixture-hash",
    },
  ],
};
const change = {
  id: "change",
  pageId: page.id,
  title: page.title,
  status: "pending",
  reason: "首次整理",
  created: 1,
  canRestore: false,
  sourceCount: 1,
};
const status = {
  policy: {
    revision: 1,
    enabled: true,
    paused: false,
    automatic: false,
    topic: "凭条",
    documentIds: ["manual"],
  },
  pages: [] as (typeof page)[],
  changes: [change],
  currentPendingCount: 1,
  job: { status: "ready", message: "已生效 0 项，待审阅 1 项" },
};

afterEach(() => {
  cleanup();
  api.invoke.mockReset();
  api.listen.mockReset();
});

function openPanel(onOpenSource = vi.fn()) {
  render(
    <WikiPanel
      projectId="space"
      workspaceRoot={root}
      view={view}
      onClose={vi.fn()}
      onImport={vi.fn()}
      onOpenSource={onOpenSource}
    />,
  );
  return within(screen.getByRole("dialog", { name: "知识 Wiki" }));
}

test("a flagged summary can only publish excerpts and updates the pending count from the review result", async () => {
  const snapshot = {
    ...status,
    changes: [
      {
        ...change,
        summaryIssues: [{ claim: "周末为 24 小时。", reason: "missing" }],
      },
    ],
  };
  const published = { ...page, summary: "", body: "手册为 72 小时。" };
  let eventListener: ((event: { payload: string }) => void) | undefined;
  let staleResponse: ((value: typeof snapshot) => void) | undefined;
  api.listen.mockImplementation((_name, handler) => {
    eventListener = handler;
    return Promise.resolve(vi.fn());
  });
  api.invoke.mockImplementation(async (command, args) => {
    if (command === "wiki_status") {
      if (staleResponse === undefined && api.invoke.mock.calls.length > 1) {
        return new Promise<typeof snapshot>((resolve) => {
          staleResponse = resolve;
        });
      }
      return snapshot;
    }
    if (command === "wiki_read") return args.changeId ? page : published;
    if (command === "wiki_review") {
      return {
        ...snapshot,
        pages: [published],
        changes: [],
        currentPendingCount: 0,
      };
    }
    throw Error(command);
  });

  const panel = openPanel();
  fireEvent.click(await panel.findByRole("button", { name: "查看待审阅改动" }));
  const warning = within(
    await panel.findByRole("region", { name: "摘要需要核对" }),
  );
  expect(warning.getByText("缺少对应引文")).toBeTruthy();
  expect(warning.getByText(/周末为 24 小时/)).toBeTruthy();
  const actions = within(panel.getByRole("group", { name: "Wiki 审阅操作" }));
  expect(actions.queryByRole("button", { name: "发布改动" })).toBeNull();
  act(() => eventListener?.({ payload: root }));
  fireEvent.click(actions.getByRole("button", { name: "仅发布原文摘录" }));
  expect(await panel.findByText("当前待审阅 0 项")).toBeTruthy();
  expect(panel.getByText("已发布核验过的原文摘录。")).toBeTruthy();
  expect(api.invoke).toHaveBeenCalledWith("wiki_review", {
    input: { id: "change", action: "publish-excerpts" },
  });
  expect(panel.getByText("上次整理").parentElement?.textContent).toContain(
    "待审阅 1 项",
  );
  await act(async () => staleResponse?.(snapshot));
  expect(panel.getByText("当前待审阅 0 项")).toBeTruthy();
  expect(panel.getByRole("button", { name: "审阅与变更" })).toBeTruthy();
});

test("a historical restore with unsupported summary only offers restoring excerpts", async () => {
  api.listen.mockResolvedValue(vi.fn());
  const snapshot = {
    ...status,
    pages: [page],
    currentPendingCount: 0,
    changes: [
      {
        ...change,
        status: "published",
        canRestore: true,
        restoreSummaryIssues: [
          { claim: "旧版为 24 小时。", reason: "conflict" },
        ],
      },
    ],
  };
  api.invoke.mockImplementation(async (command) => {
    if (command === "wiki_status" || command === "wiki_review") return snapshot;
    if (command === "wiki_read") return page;
    throw Error(command);
  });
  const panel = openPanel();
  fireEvent.click(await panel.findByRole("button", { name: "审阅与变更" }));
  fireEvent.click(await panel.findByRole("button", { name: /凭条.*已生效/ }));
  const warning = within(
    await panel.findByRole("region", { name: "可恢复版本的摘要需要核对" }),
  );
  expect(warning.getByText("与已引用原文不一致")).toBeTruthy();
  expect(panel.queryByRole("button", { name: "恢复此版本" })).toBeNull();
  fireEvent.click(panel.getByRole("button", { name: "仅恢复原文摘录" }));
  await panel.findByRole("button", { name: /凭条.*版本 1/ });
  expect(api.invoke).toHaveBeenCalledWith("wiki_review", {
    input: { id: "change", action: "restore-excerpts" },
  });
});

test("opening a Wiki reference uses the selected candidate and only navigates after revalidation", async () => {
  api.listen.mockResolvedValue(vi.fn());
  const open = vi.fn();
  let valid = false;
  api.invoke.mockImplementation(async (command, args) => {
    if (command === "wiki_status") return status;
    if (command === "wiki_read" && args.changeId) return page;
    if (command === "wiki_source") {
      if (!valid) throw Error("原文已更新");
      return page.refs[0];
    }
    throw Error(command);
  });
  const panel = openPanel(open);
  fireEvent.click(await panel.findByRole("button", { name: "查看待审阅改动" }));
  const original = await panel.findByRole("button", {
    name: /手册.md.*第 2 行/,
  });
  fireEvent.click(original);
  expect((await panel.findByRole("alert")).textContent).toContain("原文已更新");
  expect(open).not.toHaveBeenCalled();
  valid = true;
  fireEvent.click(original);
  await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
  expect(api.invoke).toHaveBeenCalledWith("wiki_source", {
    input: {
      pageId: "pass",
      revision: 1,
      changeId: "change",
      documentId: "manual",
      startLine: 2,
      endLine: 2,
      hash: "fixture-hash",
    },
  });
  expect(open).toHaveBeenCalledWith(
    expect.objectContaining({ path: "手册.md", startLine: 2 }),
  );
});
