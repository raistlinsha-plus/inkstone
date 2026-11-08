// @vitest-environment jsdom
import { act, renderHook, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useAssistant } from "./useAssistant";
import { branchTurns, type Conversation } from "./types";
const api = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: api.invoke }));
const make = (id = "c1", scope: string | null = null): Conversation => ({
  id,
  title: id,
  scope,
  scopeLabel: scope ? `当前文档 · ${scope}` : "当前空间",
  archived: false,
  draft: "",
  revision: 0,
  createdAt: "2026-11-05T00:00:00Z",
  updatedAt: "2026-11-05T00:00:00Z",
  activeLeafId: null,
  turns: [],
});
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
beforeEach(() => {
  api.invoke.mockReset();
  api.invoke.mockImplementation((name: string, args: any) => {
    if (name === "assistant_list") return Promise.resolve([]);
    if (name === "assistant_create")
      return Promise.resolve(make("created", args.scope));
    if (name === "assistant_update")
      return Promise.resolve({
        ...make(),
        ...args,
        revision: args.expectedRevision + 1,
      });
    if (name === "assistant_ask")
      return Promise.resolve({ ...make(args.conversationId), revision: 2 });
    return Promise.resolve(make());
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

test("saves changed source choices even when draft text has not changed", async () => {
  let stored = { ...make(), draft: "只使用所选资料" };
  api.invoke.mockImplementation(async (name: string, args: any) => {
    if (name === "assistant_list") return [{ ...stored, turnCount: 0 }];
    if (name === "assistant_get") return stored;
    if (name === "assistant_update") {
      stored = { ...stored, ...args, revision: stored.revision + 1 };
      return stored;
    }
    throw Error(name);
  });
  const h = renderHook(() => useAssistant(undefined, true));
  await waitFor(() => expect(h.result.current.conversation?.id).toBe("c1"));
  const context = {
    sources: { projectId: "inbox", documentIds: ["doc-a"], attachments: [] },
    webAccess: "local-only" as const,
  };
  await act(async () => {
    h.result.current.saveDraft(null, stored.draft, context);
    await h.result.current.flushDraft();
    await h.result.current.load("c1");
  });
  expect(h.result.current.conversation?.draftContext).toEqual(context);
  await act(async () => {
    h.result.current.saveDraft(null, stored.draft, {});
    await h.result.current.flushDraft();
  });
  expect(h.result.current.conversation?.draftContext).toEqual({});
});

async function ready() {
  const h = renderHook(({ root }) => useAssistant(root), {
    initialProps: { root: "/space/a" },
  });
  await waitFor(() => expect(h.result.current.loading).toBe(false));
  return h;
}
test("restores the latest unarchived conversation and its backend draft", async () => {
  api.invoke.mockImplementation((name: string) =>
    Promise.resolve(
      name === "assistant_list"
        ? [{ ...make(), turnCount: 1 }]
        : { ...make(), draft: "留下的问题" },
    ),
  );
  const h = await ready();
  expect(h.result.current.conversation?.draft).toBe("留下的问题");
});
test("late history from a previous workspace cannot replace the current space", async () => {
  const old = deferred<Conversation>();
  api.invoke.mockImplementation((name: string) =>
    name === "assistant_list"
      ? Promise.resolve([{ ...make(), turnCount: 1 }])
      : old.promise,
  );
  const h = renderHook(({ root }) => useAssistant(root), {
    initialProps: { root: "/space/a" },
  });
  await waitFor(() =>
    expect(
      api.invoke.mock.calls.some(([name]) => name === "assistant_get"),
    ).toBe(true),
  );
  api.invoke.mockImplementation((name: string) =>
    Promise.resolve(name === "assistant_list" ? [] : make("b")),
  );
  h.rerender({ root: "/space/b" });
  await act(async () => old.resolve(make("old")));
  expect(h.result.current.conversation).toBeNull();
});
test("new questions default to the durable active branch and send frozen scope", async () => {
  const h = await ready();
  await act(async () => {
    await h.result.current.create("notes/a.md");
  });
  const c = { ...make("created", "notes/a.md"), activeLeafId: "parent-1" };
  api.invoke.mockImplementation((name: string, args: any) =>
    Promise.resolve(
      name === "assistant_list"
        ? []
        : name === "assistant_get"
          ? c
          : name === "assistant_ask"
            ? { ...c, revision: 2 }
            : c,
    ),
  );
  await act(async () => {
    await h.result.current.load(c.id);
    await h.result.current.start(c.scope, {
      question: "它们有什么差异？",
      requestId: "r1",
      semantic: true,
      retrievalMode: "hybrid",
    });
  });
  const args = api.invoke.mock.calls.find(
    ([name]) => name === "assistant_ask",
  )?.[1];
  expect(args).toMatchObject({
    conversationId: "created",
    parentTurnId: "parent-1",
    question: "它们有什么差异？",
    expectedRevision: 0,
  });
});
test("a late answer cannot populate another workspace", async () => {
  const h = await ready();
  await act(async () => {
    await h.result.current.create(null);
  });
  const pending = deferred<Conversation>();
  api.invoke.mockImplementation((name: string) =>
    name === "assistant_ask" ? pending.promise : Promise.resolve([]),
  );
  let request!: Promise<Conversation>;
  act(() => {
    request = h.result.current.start(null, {
      question: "问题",
      requestId: "r1",
      semantic: false,
      retrievalMode: "keyword",
    });
  });
  await waitFor(() =>
    expect(
      api.invoke.mock.calls.some(([name]) => name === "assistant_ask"),
    ).toBe(true),
  );
  h.rerender({ root: "/space/b" });
  await act(async () => {
    pending.resolve(make("old"));
    await expect(request).rejects.toThrow("空间已变化");
  });
  expect(h.result.current.conversation).toBeNull();
});
test("explicit edit uses the previous parent while regeneration keeps the turn identity", async () => {
  const h = await ready();
  await act(async () => {
    await h.result.current.start(null, {
      question: "修改后",
      parentTurnId: null,
      regenerateTurnId: "turn-one",
      requestId: "edit",
      semantic: false,
      retrievalMode: "keyword",
    });
  });
  expect(
    api.invoke.mock.calls.find(([name]) => name === "assistant_ask")?.[1],
  ).toMatchObject({ parentTurnId: null, regenerateTurnId: "turn-one" });
});
test("a scope change creates a separate conversation instead of mutating the old range", async () => {
  const h = await ready();
  await act(async () => {
    await h.result.current.create("one.md");
    await h.result.current.start("two.md", {
      question: "比较",
      requestId: "r1",
      semantic: false,
      retrievalMode: "keyword",
    });
  });
  expect(
    api.invoke.mock.calls
      .filter(([name]) => name === "assistant_create")
      .map(([, args]) => args.scope),
  ).toEqual(["one.md", "two.md"]);
});
test("draft flush persists typed input in the database rather than localStorage", async () => {
  const h = await ready();
  await act(async () => {
    h.result.current.saveDraft("one.md", "未发送的问题");
    await h.result.current.flushDraft();
  });
  expect(
    api.invoke.mock.calls.find(
      ([name, args]) => name === "assistant_update" && args.draft,
    )?.[1],
  ).toMatchObject({ draft: "未发送的问题", expectedRevision: 0 });
  expect(localStorage.length).toBe(0);
});
test("branch traversal keeps ancestors, omits another branch and terminates malformed cycles", () => {
  const turn = (id: string, parentTurnId: string | null) => ({
    id,
    parentTurnId,
    question: id,
    createdAt: "",
    selectedCandidateId: null,
    candidates: [],
  });
  const c = {
    ...make(),
    activeLeafId: "b",
    turns: [turn("a", null), turn("b", "a"), turn("other", "a")],
  };
  expect(branchTurns(c).map((t) => t.id)).toEqual(["a", "b"]);
  c.turns[0].parentTurnId = "b";
  expect(branchTurns(c)).toHaveLength(2);
});

test("deleting a conversation cancels its pending draft so it cannot resurrect on flush", async () => {
  const h = await ready();
  await act(async () => {
    await h.result.current.create(null);
  });
  act(() => h.result.current.saveDraft(null, "即将删除的草稿"));
  await act(async () => {
    await h.result.current.remove();
    await h.result.current.flushDraft();
  });
  expect(h.result.current.conversation).toBeNull();
  expect(
    api.invoke.mock.calls.filter(([name]) => name === "assistant_create"),
  ).toHaveLength(1);
  expect(
    api.invoke.mock.calls.some(
      ([name, args]) => name === "assistant_update" && args.draft,
    ),
  ).toBe(false);
});

test("stop during the initial draft save prevents a later model request", async () => {
  const write = deferred<Conversation>();
  let stopped = false;
  api.invoke.mockImplementation(async (name: string) => {
    if (name === "assistant_list") return [];
    if (name === "assistant_create") return make();
    if (name === "assistant_update") return write.promise;
    throw Error(`unexpected ${name}`);
  });
  const h = await ready();
  let run!: Promise<Conversation>;
  act(() => {
    h.result.current.saveDraft(null, "尚未发送");
    run = h.result.current.start(
      null,
      {
        question: "尚未发送",
        requestId: "stop-before-send",
        semantic: false,
        retrievalMode: "keyword",
      },
      () => stopped,
    );
    void run.catch(() => {});
  });
  await waitFor(() =>
    expect(api.invoke).toHaveBeenCalledWith("assistant_update", {
      conversationId: "c1",
      expectedRevision: 0,
      draft: "尚未发送",
    }),
  );
  stopped = true;
  await act(async () => {
    write.resolve({ ...make(), draft: "尚未发送", revision: 1 });
    await expect(run).rejects.toThrow("问题未发送");
  });
  expect(h.result.current.conversation?.draft).toBe("尚未发送");
  expect(api.invoke.mock.calls.some(([name]) => name === "assistant_ask")).toBe(
    false,
  );
});

test("the newest draft reaches storage before a held answer finishes", async () => {
  const answer = deferred<Conversation>(),
    firstWrite = deferred<boolean>();
  let db = make();
  api.invoke.mockImplementation(async (name: string, args: any) => {
    if (name === "assistant_list") return [];
    if (name === "assistant_create") return db;
    if (name === "assistant_ask") {
      db = { ...db, revision: db.revision + 1 };
      return answer.promise;
    }
    if (name === "assistant_save_running_draft") {
      expect(args.conversationId).toBe(db.id);
      expect(args.requestId).toBe("held-answer");
      if (args.draft === "初稿") await firstWrite.promise;
      db = { ...db, draft: args.draft, revision: db.revision + 1 };
      return true;
    }
    throw Error(`unexpected ${name}`);
  });
  const h = await ready();
  await act(async () => {
    await h.result.current.create(null);
  });
  let generation!: Promise<Conversation>;
  act(() => {
    generation = h.result.current.start(null, {
      question: "首问",
      requestId: "held-answer",
      semantic: false,
      retrievalMode: "keyword",
    });
  });
  await waitFor(() => expect(db.revision).toBe(1));
  vi.useFakeTimers();
  act(() => h.result.current.saveDraft(null, "初稿"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
  act(() => h.result.current.saveDraft(null, "改好的下一问"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
  expect(
    api.invoke.mock.calls.filter(
      ([name]) => name === "assistant_save_running_draft",
    ),
  ).toHaveLength(1);
  await act(async () => {
    firstWrite.resolve(true);
  });
  expect(db.draft).toBe("改好的下一问");
  expect(db.revision).toBe(3);
  expect(h.result.current.conversation?.revision).toBe(0);

  await act(async () => {
    answer.resolve({ ...db, revision: 4 });
    await generation;
    await h.result.current.flushDraft();
  });
  expect(h.result.current.conversation?.draft).toBe("改好的下一问");
  expect(
    api.invoke.mock.calls.some(([name]) => name === "assistant_update"),
  ).toBe(false);
});

test("draft flush waits for the finished revision and survives retryable write failure", async () => {
  let db = make(),
    finish!: (c: Conversation) => void,
    failOnce = true;
  let generating = new Promise<Conversation>((resolve) => {
    finish = resolve;
  });
  api.invoke.mockImplementation(async (name: string, args: any) => {
    if (name === "assistant_list") return [];
    if (name === "assistant_create") return db;
    if (name === "assistant_ask") {
      db = { ...db, revision: db.revision + 1 };
      return generating;
    }
    if (name === "assistant_update") {
      expect(args.expectedRevision).toBe(db.revision);
      if (failOnce) {
        failOnce = false;
        throw Error("磁盘暂不可写");
      }
      db = { ...db, draft: args.draft, revision: db.revision + 1 };
      return db;
    }
  });
  const h = await ready();
  await act(async () => {
    await h.result.current.create(null);
  });
  let request!: Promise<Conversation>;
  act(() => {
    request = h.result.current.start(null, {
      question: "首问",
      requestId: "r",
      semantic: false,
      retrievalMode: "keyword",
    });
  });
  await waitFor(() =>
    expect(api.invoke.mock.calls.some(([n]) => n === "assistant_ask")).toBe(
      true,
    ),
  );
  act(() => h.result.current.saveDraft(null, "生成中写下的下一问"));
  let draft!: Promise<void>;
  act(() => {
    draft = h.result.current.flushDraft();
    draft.catch(() => {});
  });
  expect(api.invoke.mock.calls.some(([n]) => n === "assistant_update")).toBe(
    false,
  );
  await act(async () => {
    db = { ...db, revision: db.revision + 1 };
    finish(db);
    await request;
    await expect(draft).rejects.toThrow("磁盘暂不可写");
  });
  expect(h.result.current.error).toContain("草稿未保存");
  await act(async () => {
    await h.result.current.flushDraft();
  });
  expect(db.draft).toBe("生成中写下的下一问");
  expect(h.result.current.error).toBe("");
  const second = deferred<Conversation>();
  generating = second.promise;
  let next!: Promise<Conversation>;
  act(() => {
    next = h.result.current.start(null, {
      question: "第二问",
      requestId: "r2",
      semantic: false,
      retrievalMode: "keyword",
    });
  });
  await waitFor(() =>
    expect(
      api.invoke.mock.calls.filter(([n]) => n === "assistant_ask"),
    ).toHaveLength(2),
  );
  let drained = false;
  const emptyFlush = h.result.current.flushDraft().then(() => {
    drained = true;
  });
  await Promise.resolve();
  expect(drained).toBe(false);
  await act(async () => {
    db = { ...db, revision: db.revision + 1 };
    second.resolve(db);
    await next;
    await emptyFlush;
  });
  expect(drained).toBe(true);
});

test("a newer draft remains pending when an older save completes", async () => {
  const h = await ready();
  await act(async () => {
    await h.result.current.create(null);
  });
  const saving = deferred<Conversation>();
  api.invoke.mockImplementation((name: string, args: any) =>
    name === "assistant_update" && args.draft === "旧草稿"
      ? saving.promise
      : Promise.resolve(
          name === "assistant_list"
            ? []
            : { ...make(), draft: args.draft, revision: 2 },
        ),
  );
  act(() => h.result.current.saveDraft(null, "旧草稿"));
  let old!: Promise<void>;
  act(() => {
    old = h.result.current.flushDraft();
  });
  await waitFor(() =>
    expect(api.invoke.mock.calls.some(([n]) => n === "assistant_update")).toBe(
      true,
    ),
  );
  act(() => h.result.current.saveDraft(null, "最新草稿"));
  await act(async () => {
    saving.resolve({ ...make(), draft: "旧草稿", revision: 1 });
    await old;
    await h.result.current.flushDraft();
  });
  expect(h.result.current.conversation?.draft).toBe("最新草稿");
});

test("a lost finish reply reconciles the accepted revision before saving the next draft", async () => {
  const h = await ready();
  await act(async () => {
    await h.result.current.create(null);
  });
  const accepted = { ...make("created"), revision: 1 };
  api.invoke.mockImplementation(async (name: string, args: any) => {
    if (name === "assistant_list") return [];
    if (name === "assistant_ask") throw Error("完成回执中断");
    if (name === "assistant_get") return accepted;
    if (name === "assistant_update") {
      expect(args.expectedRevision).toBe(1);
      return { ...accepted, revision: 2, draft: args.draft };
    }
  });
  await act(async () => {
    await expect(
      h.result.current.start(null, {
        question: "已接收的问题",
        requestId: "r",
        semantic: false,
        retrievalMode: "keyword",
      }),
    ).rejects.toThrow("完成回执中断");
  });
  await act(async () => {
    h.result.current.saveDraft(null, "下一问仍可保存");
    await h.result.current.flushDraft();
  });
  expect(h.result.current.conversation?.draft).toBe("下一问仍可保存");
});
