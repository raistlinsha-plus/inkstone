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
import { setLanguagePreference } from "../i18n";

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

function openPanel(
  onOpenSource = vi.fn(),
  catalog = view,
  onOpenCurrentDocument?: (doc: LibraryView["documents"][number]) => void,
) {
  render(
    <WikiPanel
      projectId="space"
      workspaceRoot={root}
      view={catalog}
      onClose={vi.fn()}
      onImport={vi.fn()}
      onOpenSource={onOpenSource}
      onOpenCurrentDocument={onOpenCurrentDocument}
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

test("shows generation-base deltas and continues to the next pending proposal only when requested", async () => {
  const secondPage = { ...page, id: "other", title: "另一主题" };
  const secondChange = {
    ...change,
    id: "next",
    pageId: secondPage.id,
    title: secondPage.title,
  };
  const candidate = {
    ...page,
    refs: [
      {
        ...page.refs[0],
        quote: "手册改为 96 小时。",
        startLine: 3,
        endLine: 3,
      },
    ],
    reviewComparison: {
      baseRevision: 1,
      currentRevision: 1,
      baseAvailable: true,
      summaryChanged: true,
      outlineChanged: false,
      sources: [
        { title: "手册.md", status: "updated" },
        { title: "旧指南.md", status: "removed" },
      ],
    },
  };
  const snapshot = {
    ...status,
    pages: [page],
    changes: [change, secondChange],
    currentPendingCount: 2,
  };
  api.listen.mockResolvedValue(vi.fn());
  api.invoke.mockImplementation(async (command, args) => {
    if (command === "wiki_status") return snapshot;
    if (command === "wiki_read")
      return args.changeId === secondChange.id
        ? secondPage
        : args.changeId
          ? candidate
          : page;
    if (command === "wiki_review")
      return { ...status, pages: [page], changes: [secondChange] };
    throw Error(command);
  });
  const panel = openPanel();
  fireEvent.click(await panel.findByRole("button", { name: "查看待审阅改动" }));
  const delta = within(await panel.findByRole("region", { name: "改动对照" }));
  expect(delta.getByText("生成基准 · 版本 1")).toBeTruthy();
  expect(delta.getByText("摘要有变化")).toBeTruthy();
  expect(delta.getByText("手册.md").closest("li")?.textContent).toContain(
    "更新引用",
  );
  expect(delta.getByText("旧指南.md").closest("li")?.textContent).toContain(
    "移除引用",
  );
  const quotes = within(
    await panel.findByRole("region", { name: "原文摘录变化" }),
  );
  expect(quotes.getByText("第 2 行 · 手册为 72 小时。")).toBeTruthy();
  expect(quotes.getByText("第 3 行 · 手册改为 96 小时。")).toBeTruthy();
  fireEvent.click(panel.getByRole("button", { name: "发布改动" }));
  const next = await panel.findByRole("button", { name: "审阅下一项" });
  expect(
    api.invoke.mock.calls.some(
      ([command, args]) => command === "wiki_read" && args.changeId === "next",
    ),
  ).toBe(false);
  fireEvent.click(next);
  const target = await panel.findByRole("group", { name: "正在审阅 另一主题" });
  expect(document.activeElement).toBe(target);
  expect(
    api.invoke.mock.calls.filter(([command]) => command === "wiki_review"),
  ).toHaveLength(1);
});

test("an obsolete generation base blocks publishing while the candidate can still be rejected", async () => {
  api.listen.mockResolvedValue(vi.fn());
  api.invoke.mockImplementation(async (command, args) => {
    if (command === "wiki_status") return { ...status, pages: [page] };
    if (command === "wiki_read" && args.changeId) {
      return {
        ...page,
        reviewComparison: {
          baseRevision: 1,
          currentRevision: 2,
          baseAvailable: true,
          summaryChanged: false,
          outlineChanged: false,
          sources: [],
        },
      };
    }
    if (command === "wiki_read") return { ...page, revision: 2 };
    throw Error(command);
  });
  const panel = openPanel();
  fireEvent.click(await panel.findByRole("button", { name: "查看待审阅改动" }));
  expect(await panel.findByText(/生效版本已变化/)).toBeTruthy();
  expect(
    panel.getByRole<HTMLButtonElement>("button", { name: "发布改动" }).disabled,
  ).toBe(true);
  expect(
    panel.getByRole<HTMLButtonElement>("button", { name: "拒绝改动" }).disabled,
  ).toBe(false);
});

test("opens recent changes from the topics home and keeps older excerpts out of source navigation", async () => {
  const published = {
    ...change,
    status: "published",
    stale: true,
    canRestore: true,
    restoreRevision: 1,
    restoreAvailability: "unavailable",
  };
  const snapshot = {
    ...status,
    pages: [page],
    currentPendingCount: 0,
    changes: [published],
  };
  const historical = {
    ...page,
    revision: 2,
    summary: "",
    body: "# 凭条",
    stale: true,
    refs: [],
    historicalSources: [
      {
        documentId: "manual",
        title: "手册.md",
        startLine: 2,
        endLine: 2,
        excerpt: "旧版手册为 72 小时。",
      },
      {
        documentId: "removed",
        title: "停用通知.md",
        startLine: 4,
        endLine: 4,
      },
    ],
  };
  api.listen.mockResolvedValue(vi.fn());
  api.invoke.mockImplementation(async (command) => {
    if (command === "wiki_status") return snapshot;
    if (command === "wiki_read") return historical;
    throw Error(command);
  });

  const jump = vi.fn();
  const panel = openPanel(jump);
  expect(
    await panel.findByRole("heading", { name: "已发布主题" }),
  ).toBeTruthy();
  const recent = within(panel.getByRole("region", { name: "最近变化" }));
  fireEvent.click(recent.getByRole("button", { name: /凭条.*已生效/ }));
  const details = (await panel.findByText(/已变化或不可用的出处/)).closest(
    "details",
  );
  expect(details).toBeTruthy();
  details!.open = true;
  expect(within(details!).getByText("旧版手册为 72 小时。")).toBeTruthy();
  expect(within(details!).getByText("原文当前不可用")).toBeTruthy();
  expect(within(details!).queryByRole("button")).toBeNull();
  expect(jump).not.toHaveBeenCalled();
  expect(
    panel.getByRole<HTMLButtonElement>("button", { name: "恢复改动前版本" })
      .disabled,
  ).toBe(true);
});

test("takes the reader to a source problem before routine pending changes", async () => {
  const damaged = {
    ...change,
    id: "stale",
    pageId: "other",
    title: "过时凭条",
    stale: true,
  };
  api.listen.mockResolvedValue(vi.fn());
  api.invoke.mockImplementation(async (command) => {
    if (command === "wiki_status")
      return {
        ...status,
        changes: [{ ...change, created: 2 }, damaged],
        currentPendingCount: 2,
      };
    if (command === "wiki_read")
      return {
        ...page,
        id: damaged.pageId,
        title: damaged.title,
        stale: true,
        refs: [],
      };
    throw Error(command);
  });
  const panel = openPanel();
  fireEvent.click(await panel.findByRole("button", { name: "查看待审阅改动" }));
  expect(
    await panel.findByRole("group", { name: "正在审阅 过时凭条" }),
  ).toBeTruthy();
  expect(
    panel.getByRole<HTMLButtonElement>("button", { name: "仅发布原文摘录" })
      .disabled,
  ).toBe(true);
});

test("review and publication keep a single-source fact separate from a two source accounts of duration", async () => {
  const handoff = {
    ...view.documents[0],
    id: "handoff",
    title: "交接记录.md",
    path: "交接记录.md",
  };
  const catalog = { ...view, documents: [...view.documents, handoff] };
  const refs = [
    { ...page.refs[0], quote: "每场 45 分钟。" },
    {
      ...page.refs[0],
      documentId: handoff.id,
      title: handoff.title,
      path: handoff.path,
      quote: "每场 60 分钟。",
      hash: "handoff-v2",
    },
    {
      ...page.refs[0],
      documentId: handoff.id,
      title: handoff.title,
      path: handoff.path,
      quote: "签到处在前台。",
      startLine: 5,
      endLine: 5,
      hash: "handoff-v2",
    },
  ];
  const claims = [
    {
      claim: "每场时长分别记录为 45、60 分钟。",
      status: "parallel",
      refIndices: [0, 1],
    },
    {
      claim: "仅交接记录提到签到处。",
      status: "singleSource",
      refIndices: [2],
    },
  ];
  const candidate = {
    ...page,
    refs,
    claimReviews: claims,
    reviewComparison: {
      baseRevision: 1,
      currentRevision: 1,
      baseAvailable: true,
      summaryChanged: true,
      outlineChanged: false,
      sources: [{ title: handoff.title, status: "updated" }],
    },
  };
  const baseline = { ...page, refs, claimReviews: [claims[1]] };
  let published = false;
  api.listen.mockResolvedValue(vi.fn());
  api.invoke.mockImplementation(async (command, args) => {
    if (command === "wiki_status") return { ...status, pages: [baseline] };
    if (command === "wiki_read")
      return published
        ? { ...candidate, revision: 2 }
        : args.changeId
          ? candidate
          : baseline;
    if (command === "wiki_source") return refs[2];
    if (command === "wiki_review") {
      published = true;
      return {
        ...status,
        currentPendingCount: 0,
        pages: [{ ...page, revision: 2 }],
        changes: [],
      };
    }
    throw Error(command);
  });
  const jump = vi.fn();
  const panel = openPanel(jump, catalog);
  fireEvent.click(await panel.findByRole("button", { name: "查看待审阅改动" }));
  const review = within(
    await panel.findByRole("region", { name: "结论与依据" }),
  );
  expect(
    within(review.getByText("来源并列").closest("li")!).getAllByRole("button"),
  ).toHaveLength(2);
  expect(review.queryByText("原文取值不同")).toBeNull();
  expect(review.queryByText("原文支持")).toBeNull();
  const signIn = within(review.getByText("单方记载").closest("li")!);
  expect(signIn.getByText("签到处在前台。")).toBeTruthy();
  expect(signIn.queryByText("手册.md")).toBeNull();
  expect(await signIn.findByText("沿用表述")).toBeTruthy();
  expect(review.getByText("本次新增表述")).toBeTruthy();
  fireEvent.click(signIn.getByRole("button", { name: /交接记录.md.*第 5 行/ }));
  await waitFor(() =>
    expect(jump).toHaveBeenCalledWith(
      expect.objectContaining({
        startLine: 5,
        documentId: "handoff",
        hash: "handoff-v2",
      }),
    ),
  );
  fireEvent.click(panel.getByRole("button", { name: "发布改动" }));
  expect(
    await panel.findByText("改动已发布，可在主题中查看生效版本。"),
  ).toBeTruthy();
  const formal = within(
    await panel.findByRole("region", { name: "结论与依据" }),
  );
  expect(formal.getByText("仅交接记录提到签到处。")).toBeTruthy();
  expect(formal.queryByText("沿用表述")).toBeNull();
});

test("opening a changed source rechecks permission and opens today's document without historical coordinates", async () => {
  const historical = {
    ...page,
    stale: true,
    refs: [],
    body: "# 历史",
    historicalSources: [
      {
        documentId: "manual",
        title: "手册.md",
        startLine: 23,
        endLine: 23,
        excerpt: "当时活动为 45 分钟。",
      },
    ],
    claimReviews: [
      { claim: "旧版资料已有变更。", status: "sourceChanged", refIndices: [] },
    ],
  };
  const snapshot = {
    ...status,
    pages: [historical],
    changes: [],
    currentPendingCount: 0,
  };
  const openCurrent = vi.fn(),
    jump = vi.fn();
  let permitted = true;
  api.listen.mockResolvedValue(vi.fn());
  api.invoke.mockImplementation(async (command) => {
    if (command === "wiki_status") return snapshot;
    if (command === "wiki_read")
      return permitted ? historical : { ...historical, historicalSources: [] };
    if (command === "library_answer_source")
      return { document: view.documents[0] };
    throw Error(command);
  });
  const panel = openPanel(jump, view, openCurrent);
  fireEvent.click(await panel.findByRole("button", { name: /凭条.*版本 1/ }));
  expect(await panel.findByText("来源已变")).toBeTruthy();
  const detail = panel.getByText(/已变化或不可用的出处/).closest("details")!;
  detail.open = true;
  const open = within(detail).getByRole("button", {
    name: "打开当前文档 手册.md",
  });
  fireEvent.click(open);
  await waitFor(() => expect(openCurrent).toHaveBeenCalledTimes(1));
  expect(openCurrent.mock.calls[0]).toEqual([view.documents[0]]);
  permitted = false;
  fireEvent.click(
    within(detail).getByRole("button", { name: "打开当前文档 手册.md" }),
  );
  expect((await panel.findByRole("alert")).textContent).toContain("已移出范围");
  expect(panel.queryByText("当时活动为 45 分钟。")).toBeNull();
  expect(openCurrent).toHaveBeenCalledTimes(1);
  expect(
    api.invoke.mock.calls.filter(
      ([command]) => command === "library_answer_source",
    ),
  ).toHaveLength(1);
  expect(jump).not.toHaveBeenCalled();
});

test("selects a whole space and clears only matching sources through the removal preview", async () => {
  const manual = view.documents[0];
  const docs = Array.from({ length: 268 }, (_, index) => ({
    ...manual,
    id: String(index),
    title: index < 2 ? `专题${index}.md` : `普通${index}.md`,
  }));
  const catalog = {
    ...view,
    documents: [
      manual,
      ...docs,
      { ...manual, id: "other", projectId: "elsewhere" },
      { ...manual, id: "trash", status: "trashed" as const },
    ],
  };
  let saved = status;
  api.listen.mockResolvedValue(vi.fn());
  api.invoke.mockImplementation(async (command, args) => {
    if (command === "wiki_status") return saved;
    if (command === "wiki_removal_impact")
      return { pages: 1, revisions: 2, pending: 0, token: "scope-preview" };
    if (command === "wiki_set_policy") {
      saved = {
        ...saved,
        policy: {
          ...saved.policy,
          documentIds: args.input.documentIds,
          revision: saved.policy.revision + 1,
        },
      };
      return saved;
    }
    throw Error(command);
  });

  const panel = openPanel(vi.fn(), catalog);
  fireEvent.click(await panel.findByRole("button", { name: "资料范围" }));
  const all = panel.getByRole("checkbox", {
    name: /全选 269/,
  }) as HTMLInputElement;
  expect(all.indeterminate).toBe(true);
  fireEvent.click(all);
  expect(all.checked).toBe(true);
  fireEvent.click(panel.getByRole("button", { name: "保存范围与维护" }));
  await waitFor(() =>
    expect(saved.policy.documentIds).toEqual([
      "manual",
      ...docs.map((doc) => doc.id),
    ]),
  );
  fireEvent.click(panel.getByRole("button", { name: "资料范围" }));
  const filter = panel.getByRole("searchbox", { name: "筛选资料" });
  fireEvent.change(filter, { target: { value: "缺失" } });
  expect(
    (panel.getByRole("checkbox", { name: /全选筛选结果/ }) as HTMLInputElement)
      .disabled,
  ).toBe(true);
  fireEvent.change(filter, { target: { value: "专题" } });
  const matches = panel.getByRole("checkbox", {
    name: /全选筛选结果/,
  }) as HTMLInputElement;
  expect(matches.checked).toBe(true);
  fireEvent.click(panel.getByRole("button", { name: "清除筛选内已选" }));
  expect(matches.checked).toBe(false);
  fireEvent.click(matches);
  fireEvent.click(panel.getByRole("checkbox", { name: "专题1.md" }));
  expect(matches.indeterminate).toBe(true);

  fireEvent.click(panel.getByRole("button", { name: "查看清除范围" }));
  const retained = [
    "manual",
    ...docs.filter((doc) => doc.id !== "1").map((doc) => doc.id),
  ];
  expect(api.invoke).toHaveBeenCalledWith("wiki_removal_impact", {
    projectId: "space",
    expectedRevision: 2,
    documentIds: expect.arrayContaining(retained),
  });
  fireEvent.click(await panel.findByRole("button", { name: "确认保存并清除" }));
  await waitFor(() =>
    expect(api.invoke).toHaveBeenCalledWith("wiki_set_policy", {
      input: expect.objectContaining({
        expectedRevision: 2,
        removalToken: "scope-preview",
      }),
    }),
  );
  expect([...saved.policy.documentIds].sort()).toEqual(retained.sort());
});

test("clear selection can revoke a previously selected document that is no longer listed", async () => {
  api.listen.mockResolvedValue(vi.fn());
  api.invoke.mockImplementation(async (command) => {
    if (command === "wiki_status") return status;
    if (command === "wiki_removal_impact")
      return { pages: 0, revisions: 0, pending: 0, token: "clear-all" };
    throw Error(command);
  });
  const panel = openPanel(vi.fn(), { ...view, documents: [] });
  fireEvent.click(await panel.findByRole("button", { name: "资料范围" }));
  fireEvent.click(panel.getByRole("button", { name: "清除已选" }));
  fireEvent.click(panel.getByRole("checkbox", { name: "启用当前空间的 Wiki" }));
  fireEvent.click(panel.getByRole("button", { name: "查看清除范围" }));
  expect(
    await panel.findByRole("button", { name: "确认保存并清除" }),
  ).toBeTruthy();
  expect(api.invoke).toHaveBeenCalledWith("wiki_removal_impact", {
    projectId: "space",
    expectedRevision: 1,
    documentIds: [],
  });
});

test("Wiki guards dirty close, backdrop and Escape; keep, discard and save have distinct effects", async () => {
  const onClose = vi.fn();
  api.listen.mockResolvedValue(vi.fn());
  api.invoke.mockImplementation(async (command, args) => {
    if (command === "wiki_status") return status;
    if (command === "wiki_set_policy") return {...status, policy: {...status.policy, topic: args.input.topic}};
    throw Error(command);
  });
  render(<WikiPanel projectId="space" workspaceRoot={root} view={view} onOpenSource={vi.fn()} onImport={vi.fn()} onClose={onClose}/>);
  fireEvent.click(await screen.findByRole("button", {name:"资料范围"}));
  const topic = await screen.findByRole("textbox", {name:"关注主题"});
  fireEvent.change(topic, {target:{value:"暂存主题"}});
  fireEvent.keyDown(document, {key:"Escape"});
  const dialog = () => within(screen.getByRole("dialog", {name:"保存 Wiki 更改？"}));
  expect(document.activeElement).toBe(dialog().getByRole("button", {name:"继续编辑"}));
  fireEvent.keyDown(document, {key:"Escape"});
  expect((topic as HTMLInputElement).value).toBe("暂存主题");
  fireEvent.mouseDown(screen.getByRole("dialog", {name:"知识 Wiki"}).closest(".modal-backdrop")!);
  fireEvent.click(dialog().getByRole("button", {name:"继续编辑"}));
  fireEvent.click(screen.getByRole("button", {name:"关闭知识 Wiki"}));
  fireEvent.click(dialog().getByRole("button", {name:"放弃更改"}));
  expect(onClose).toHaveBeenCalledOnce();
  expect(api.invoke.mock.calls.filter(([command]) => command === "wiki_set_policy")).toHaveLength(0);
  // The parent normally unmounts Wiki after accepting onClose.
  fireEvent.keyDown(document, {key:"Escape"});
  fireEvent.click(screen.getByRole("button", {name:"关闭知识 Wiki"}));
  fireEvent.click(dialog().getByRole("button", {name:"保存并关闭"}));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
  expect(api.invoke).toHaveBeenCalledWith("wiki_set_policy", {input:expect.objectContaining({topic:"暂存主题"})});
});

test("English source revocation shows affected counts and requires explicit confirmation even when closing", async () => {
  setLanguagePreference("en");
  try {
    api.listen.mockResolvedValue(vi.fn());
    api.invoke.mockImplementation(async command => {
      if (command === "wiki_status" || command === "wiki_set_policy") return status;
      if (command === "wiki_removal_impact") return {pages:1, revisions:3, pending:2, token:"checked"};
      throw Error(command);
    });
    render(<WikiPanel projectId="space" workspaceRoot={root} view={view} onOpenSource={vi.fn()} onImport={vi.fn()} onClose={vi.fn()}/>);
    expect(await screen.findByText("Authorized sources: 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", {name:"Sources"}));
    fireEvent.click(screen.getByRole("checkbox", {name:"Enable Wiki for this space"}));
    fireEvent.click(screen.getByRole("checkbox", {name:"手册.md"}));
    fireEvent.keyDown(document, {key:"Escape"});
    fireEvent.click(within(screen.getByRole("dialog", {name:"Save Wiki changes?"})).getByRole("button", {name:"Review items to clear"}));
    const warning = await screen.findByText(/Topics to clear: 1. Published revisions: 3. Pending changes: 2/);
    expect(warning.textContent).toContain("Original documents are kept.");
    expect(document.activeElement).toBe(warning);
    const confirm = document.querySelector<HTMLButtonElement>(".wiki-policy-footer .wiki-danger")!;
    expect(confirm.getAttribute("aria-describedby")).toBe(warning.id);
    expect(api.invoke.mock.calls.filter(([command]) => command === "wiki_set_policy")).toHaveLength(0);
    fireEvent.click(confirm);
    await waitFor(() => expect(api.invoke).toHaveBeenCalledWith("wiki_set_policy", {input:expect.objectContaining({removalToken:"checked"})}));
  } finally {
    setLanguagePreference("zh-CN");
  }
});
