// @vitest-environment jsdom
import { useImperativeHandle } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { LibraryDocument, LibraryView } from "./library";
import type { CalendarDocument } from "./content/calendar";
import type { EditorHandle } from "./Editor";
import type { ComponentProps, Ref } from "react";
import type { FileData, Settings, Workspace } from "./types";
const api = vi.hoisted(() => ({
  invoke: vi.fn(),
  confirm: vi.fn(),
  realLibrary: false,
  events: new Map<string, (event: any) => void>(),
  close: undefined as
    undefined | ((event: { preventDefault: () => void }) => Promise<void>),
  drop: undefined as
    | undefined
    | ((event: { payload: { type: string; paths: string[] } }) => void),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: api.invoke,
  isTauri: () => true,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, callback: (event: any) => void) => {
    api.events.set(name, callback);
    return Promise.resolve(() => {
      if (api.events.get(name) === callback) api.events.delete(name);
    });
  },
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: (callback: typeof api.close) => {
      api.close = callback;
      return Promise.resolve(() => {});
    },
  }),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (callback: typeof api.drop) => {
      api.drop = callback;
      return Promise.resolve(() => {});
    },
  }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  confirm: api.confirm,
}));
vi.mock("./parser.worker?worker&inline", () => ({
  default: class {
    terminate() {}
  },
}));
vi.mock("./Editor", () => ({
  default: ({
    handleRef,
    content,
    onChange,
    path,
    line,
  }: {
    handleRef: Ref<EditorHandle>;
    content: string;
    onChange: (s: string) => void;
    path: string;
    line?: number;
  }) => {
    useImperativeHandle(handleRef, () => ({
      getContent: () => content,
      undo() {},
      redo() {},
      captureInsertion: () => ({
        revision: 0,
        selection: { mode: "source", head: content.length },
      }),
      insertMarkdown: (text, target) =>
        onChange(
          content.slice(0, target.selection.head) +
            "\n\n" +
            text +
            "\n\n" +
            content.slice(target.selection.head),
        ),
    }));
    return (
      <>
        <output data-testid="opened-path">
          {path}:{line ?? ""}
        </output>
        <textarea
          aria-label="测试正文"
          value={content}
          onChange={(e) => onChange(e.target.value)}
        />
      </>
    );
  },
}));
vi.mock("./LibraryBrowser", async () => {
  const { default: ActualLibraryBrowser } =
    await vi.importActual<typeof import("./LibraryBrowser")>(
      "./LibraryBrowser",
    );
  return {
    default: ({
      view,
      projectId,
      onOpen,
      onProject,
      onNew,
      compact,
      onBeforeAction,
      onMutationBusy,
      onDocumentChanged,
      ...rest
    }: ComponentProps<typeof ActualLibraryBrowser>) =>
      api.realLibrary ? (
        <ActualLibraryBrowser
          {...rest}
          view={view}
          projectId={projectId}
          onOpen={onOpen}
          onProject={onProject}
          onNew={onNew}
          compact={compact}
          onBeforeAction={onBeforeAction}
          onMutationBusy={onMutationBusy}
          onDocumentChanged={onDocumentChanged}
        />
      ) : !compact ? (
        <div>文档空间首页</div>
      ) : (
        <div aria-label="测试文档库">
          {view.projects.map((p) => (
            <button key={p.id} onClick={() => onProject(p.id)}>
              项目 {p.title}
            </button>
          ))}
          {view.documents
            .filter((d) => d.projectId === projectId)
            .map((d) => (
              <button key={d.id} onClick={() => onOpen(d)}>
                打开 {d.path}
              </button>
            ))}
          <button onClick={onNew}>测试新建文档</button>
          <button
            onClick={() =>
              void (async () => {
                if (!(await onBeforeAction())) return;
                onMutationBusy?.(true);
                try {
                  await api.invoke("test_source_apply");
                  await onDocumentChanged?.(view.documents[0]);
                } finally {
                  onMutationBusy?.(false);
                }
              })()
            }
          >
            测试来源更新
          </button>
        </div>
      ),
  };
});
vi.mock("./calendar/ProjectCalendar", () => ({
  default: ({
    documents,
    onPatch,
    onOpen,
    onUndo,
    canUndo,
    onNewDocument,
  }: {
    documents: CalendarDocument[];
    onPatch: (p: {
      documentId: string;
      expectedHash: string;
      content: string;
    }) => Promise<void>;
    onOpen: (p: { path: string; line: number }) => void;
    onUndo: () => void;
    canUndo: boolean;
    onNewDocument: () => void;
  }) => (
    <div aria-label="测试项目日历">
      <output data-testid="calendar-documents">
        {documents.map((d) => d.path).join(",")}
      </output>
      <button
        onClick={() => {
          const d = documents[0];
          if (d)
            void onPatch({
              documentId: d.documentId,
              expectedHash: d.hash,
              content: d.content + "\n日程已修改",
            }).catch(() => {});
        }}
      >
        测试修改事项
      </button>
      <button
        onClick={() => {
          if (documents[0]) onOpen({ path: documents[0].path, line: 7 });
        }}
      >
        测试打开原文
      </button>
      <button onClick={onUndo} disabled={!canUndo}>
        测试撤销事项
      </button>
      <button onClick={onNewDocument}>测试新建日程文档</button>
    </div>
  ),
}));
vi.mock("./companion/CompanionDock", () => ({ default: () => null }));
import App from "./App";
import { defaultRerankProvider } from "./types";

const stats = { documents: 0, chunks: 0, vectors: 0, embeddingReady: false };
const provider = {
  enabled: false,
  baseUrl: "",
  model: "",
  dimensions: null,
  maxInputChars: 1800,
  batchSize: 8,
  contextChars: 16000,
};
const settings: Settings = {
  embedding: { ...provider },
  chat: { ...provider },
  rerank: { ...defaultRerankProvider },
  hasEmbeddingKey: false,
  hasChatKey: false,
  hasRerankKey: false,
};
const workspace = (id: string): Workspace => ({
  root: "/library/" + id,
  name: id,
  managedProjectId: id,
  files: [],
  stats,
});
const libraryDoc = (path: string, projectId = "p1"): LibraryDocument => ({
  id: path,
  projectId,
  path,
  title: path,
  source: "",
  updated: 0,
  opened: 0,
  status: "ready",
});
const view: LibraryView = {
  projects: [
    { id: "p1", title: "p1" },
    { id: "p2", title: "p2" },
  ],
  documents: [libraryDoc("a.md"), libraryDoc("b.md"), libraryDoc("c.md", "p2")],
  pendingImports: [],
};
const disk = new Map<string, FileData>();
const overrides = new Map<string, (args: Record<string, any>) => unknown>();
let mockConversation: any = null;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
const file = (path: string, content = "正文 " + path): FileData => ({
  path,
  content,
  hash: "hash-" + path,
  draft: null,
  missing: false,
});
function calls(command: string) {
  return api.invoke.mock.calls.filter(([name]) => name === command);
}
async function boot() {
  render(<App />);
  await screen.findByRole("button", { name: "打开 a.md" });
}
async function openDocument(path: string) {
  fireEvent.click(screen.getByRole("button", { name: "打开 " + path }));
  await waitFor(() =>
    expect(
      (screen.getByLabelText("测试正文") as HTMLTextAreaElement).value,
    ).toBe(disk.get(path)?.content),
  );
}

test("the managed workbench offers the first-question guide on startup", async () => {
  api.realLibrary = true;
  render(<App />);
  const guide = await screen.findByRole("region", { name: "开始使用" });
  expect(within(guide).getByText("从资料到第一条回答")).toBeTruthy();
  expect(
    within(guide).getByRole("button", { name: "复制导入文档" }),
  ).toBeTruthy();
  fireEvent.click(within(guide).getByRole("button", { name: "打开问答" }));
  expect(await screen.findByLabelText("向当前空间提问")).toBeTruthy();
});

test("startup remains loading until the space and its document list have both loaded", async () => {
  const opening = deferred<Workspace>();
  const listing = deferred<LibraryView>();
  overrides.set("open_library", () => opening.promise);
  overrides.set("library_list", () => listing.promise);
  render(<App />);
  await screen.findByText("正在打开文档空间…");
  expect(screen.queryByText("让想法落笔，")).toBeNull();
  expect(screen.queryByText("创建空间，汇集不同位置的文档。")).toBeNull();
  await act(async () => opening.resolve(workspace("p1")));
  expect(screen.getByText("正在打开文档空间…")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "打开 a.md" })).toBeNull();
  await act(async () => listing.resolve(view));
  await screen.findByRole("button", { name: "打开 a.md" });
  expect(screen.queryByText("正在打开文档空间…")).toBeNull();
});

test("startup failure is not an empty library and retry can recover without creating documents", async () => {
  overrides.set("open_library", () => Promise.reject("目录暂时不可读取"));
  render(<App />);
  await screen.findByRole("button", { name: "重新打开资料" });
  expect(screen.getByText("资料暂时无法打开")).toBeTruthy();
  expect(screen.queryByText("创建空间，汇集不同位置的文档。")).toBeNull();
  overrides.delete("open_library");
  fireEvent.click(screen.getByRole("button", { name: "重新打开资料" }));
  await screen.findByRole("button", { name: "打开 a.md" });
  expect(screen.queryByText("资料暂时无法打开")).toBeNull();
  expect(calls("library_create_document")).toHaveLength(0);
});

test("pane visibility is restored and deliberate toggles persist for the next launch", async () => {
  localStorage.setItem("inkstone:sidebar-closed", "true");
  localStorage.setItem("inkstone:panel-open", "true");
  await boot();
  fireEvent.click(screen.getByRole("button", { name: "展开文档列表" }));
  fireEvent.click(screen.getByRole("button", { name: "切换知识侧栏" }));
  expect(localStorage.getItem("inkstone:sidebar-closed")).toBe("false");
  expect(localStorage.getItem("inkstone:panel-open")).toBe("false");
});

test("restoring the previous document finishes before exposing the workspace", async () => {
  localStorage.setItem(
    "inkstone:session:/library/p1",
    JSON.stringify({ path: "a.md", mode: "source" }),
  );
  const reading = deferred<FileData>();
  overrides.set("read_file", () => reading.promise);
  render(<App />);
  await waitFor(() => expect(calls("read_file")).toHaveLength(1));
  expect(screen.getByText("正在打开文档空间…")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "打开 a.md" })).toBeNull();
  await act(async () => reading.resolve(file("a.md")));
  await screen.findByLabelText("测试正文");
  expect(screen.queryByText("正在打开文档空间…")).toBeNull();
});

test("a late index snapshot from the previous space cannot populate the current index panel", async () => {
  const old = deferred<unknown>();
  let current = "p1";
  overrides.set("workspace_index_status", () =>
    current === "p1"
      ? old.promise
      : {
          checkedAt: 1,
          embeddingProfile: "",
          documents: [
            {
              path: "c.md",
              title: "当前空间索引",
              included: true,
              keywordState: "ready",
              vectorState: "disabled",
            },
          ],
        },
  );
  overrides.set("open_library", (args) => {
    current = args.projectId ?? "p1";
    return workspace(current);
  });
  await boot();
  fireEvent.click(screen.getByRole("button", { name: "项目 p2" }));
  await screen.findByRole("button", { name: "打开 c.md" });
  fireEvent.click(screen.getByRole("button", { name: "资料索引" }));
  await screen.findByText("当前空间索引");
  await act(async () =>
    old.resolve({
      checkedAt: 1,
      embeddingProfile: "old",
      documents: [
        {
          path: "a.md",
          title: "旧空间索引",
          included: true,
          keywordState: "ready",
          vectorState: "ready",
        },
      ],
    }),
  );
  expect(screen.queryByText("旧空间索引")).toBeNull();
  expect(screen.getByText("当前空间索引")).toBeTruthy();
});
test("import completion and opening the index manager refresh persisted summary counts", async () => {
  let imported = false;
  overrides.set("index_stats", () =>
    imported ? { ...stats, documents: 2, chunks: 5 } : stats,
  );
  overrides.set("workspace_index_status", () => ({
    checkedAt: 1,
    embeddingProfile: "",
    documents: [],
  }));
  overrides.set("library_import", () => {
    imported = true;
    return {
      jobId: "import-summary",
      projectId: "p1",
      cancelled: false,
      warnings: [],
      items: [
        {
          source: "/source/imported.md",
          status: "success",
          documentId: "a.md",
          message: "已复制",
        },
      ],
    };
  });
  await boot();
  await act(async () =>
    api.drop?.({ payload: { type: "drop", paths: ["/source/imported.md"] } }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "复制导入" }));
  const done = await screen.findByRole("button", { name: "完成" });
  await waitFor(() => expect((done as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(done);
  const beforeOpen = calls("index_stats").length;
  fireEvent.click(screen.getByRole("button", { name: "资料索引" }));
  const modal = await screen.findByRole("dialog", { name: "资料索引管理" });
  await waitFor(() =>
    expect(
      within(modal)
        .getByText("关键词已入库文档")
        .parentElement?.querySelector("strong")?.textContent,
    ).toBe("2"),
  );
  await waitFor(() =>
    expect(calls("index_stats").length).toBeGreaterThan(beforeOpen),
  );
  imported = false;
  fireEvent.click(within(modal).getByRole("button", { name: "重新核对" }));
  await waitFor(() =>
    expect(
      within(modal)
        .getByText("关键词已入库文档")
        .parentElement?.querySelector("strong")?.textContent,
    ).toBe("0"),
  );
});
test("a late summary response cannot replace stats from the newly selected space", async () => {
  let current = "p1";
  const old = deferred<unknown>();
  overrides.set("open_library", (args) => {
    current = args.projectId ?? "p1";
    return workspace(current);
  });
  overrides.set("index_stats", () =>
    current === "p1" ? old.promise : { ...stats, documents: 3, chunks: 9 },
  );
  overrides.set("workspace_index_status", () => ({
    checkedAt: 1,
    embeddingProfile: "",
    documents: [],
  }));
  await boot();
  await waitFor(() => expect(calls("index_stats").length).toBeGreaterThan(0));
  fireEvent.click(screen.getByRole("button", { name: "项目 p2" }));
  await screen.findByRole("button", { name: "打开 c.md" });
  fireEvent.click(screen.getByRole("button", { name: "资料索引" }));
  const modal = await screen.findByRole("dialog", { name: "资料索引管理" });
  const count = () =>
    within(modal)
      .getByText("关键词已入库文档")
      .parentElement?.querySelector("strong")?.textContent;
  await waitFor(() => expect(count()).toBe("3"));
  await act(async () => old.resolve({ ...stats, documents: 99, chunks: 999 }));
  expect(count()).toBe("3");
});
beforeEach(() => {
  api.events.clear();
  api.close = undefined;
  api.realLibrary = false;
  localStorage.clear();
  disk.clear();
  overrides.clear();
  mockConversation = null;
  api.confirm.mockResolvedValue(true);
  for (const d of view.documents) disk.set(d.path, file(d.path));
  api.invoke.mockImplementation(
    (command: string, args: Record<string, any> = {}) => {
      if (overrides.has(command))
        return Promise.resolve(overrides.get(command)!(args));
      switch (command) {
        case "assistant_list":
          return Promise.resolve(
            mockConversation
              ? [
                  {
                    ...mockConversation,
                    turnCount: mockConversation.turns.length,
                  },
                ]
              : [],
          );
        case "assistant_create":
          mockConversation = {
            id: "conversation-test",
            title: "新会话",
            scope: args.scope,
            scopeLabel: args.scope
              ? `当前文档 · ${args.scope}`
              : "当前空间 · p1",
            archived: false,
            draft: "",
            revision: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            activeLeafId: null,
            turns: [],
          };
          return Promise.resolve({ ...mockConversation });
        case "assistant_get":
          return Promise.resolve(mockConversation);
        case "assistant_update":
          mockConversation = {
            ...mockConversation,
            ...args,
            revision: mockConversation.revision + 1,
          };
          return Promise.resolve(mockConversation);
        case "assistant_ask": {
          const c = mockConversation;
          // Reuse the original provider fixture while asserting the new durable command boundary.
          return api
            .invoke("ask_question", {
              question: args.question,
              scope: c.scope,
              requestId: args.requestId,
              semantic: args.semantic,
              retrievalMode: args.retrievalMode,
            })
            .then((response: any) => {
              const candidate = {
                id: "candidate-" + args.requestId,
                requestId: args.requestId,
                status: "complete",
                createdAt: new Date().toISOString(),
                error: null,
                response,
              };
              const turn = {
                id: "turn-" + args.requestId,
                parentTurnId: args.parentTurnId,
                question: args.question,
                createdAt: new Date().toISOString(),
                selectedCandidateId: candidate.id,
                candidates: [candidate],
              };
              mockConversation = {
                ...c,
                title: args.question,
                draft: "",
                revision: c.revision + 2,
                activeLeafId: turn.id,
                turns: [...c.turns, turn],
              };
              return mockConversation;
            });
        }
        case "bootstrap":
          return Promise.resolve({ settings, lastWorkspace: null });
        case "open_library":
          return Promise.resolve(workspace(args.projectId ?? "p1"));
        case "library_list":
          return Promise.resolve(view);
        case "list_files":
          return Promise.resolve([]);
        case "index_stats":
          return Promise.resolve(stats);
        case "read_file":
          return Promise.resolve(disk.get(args.path) ?? file(args.path));
        case "save_file":
          disk.set(args.path, {
            ...file(args.path, args.content),
            hash: "saved-" + args.path,
          });
          return Promise.resolve({
            hash: "saved-" + args.path,
            indexStale: true,
            warning: null,
          });
        case "calendar_list":
          return Promise.resolve({
            documents: view.documents
              .filter(
                (d) => d.projectId === args.projectId && d.path !== "b.md",
              )
              .map((d) => ({
                documentId: d.id,
                title: d.title,
                ...disk.get(d.path)!,
              })),
            warnings: [],
          });
        case "file_hash":
          return Promise.resolve(disk.get(args.path)?.hash);
        case "search":
          return Promise.resolve({
            results: [],
            evidenceCount: 0,
            candidateCount: 0,
            warning: null,
            semantic: false,
            retrievalMode: "bm25",
            rerankStatus: "disabled",
          });
        default:
          return Promise.resolve();
      }
    },
  );
});
afterEach(() => {
  cleanup();
  api.realLibrary = false;
  api.invoke.mockReset();
  api.confirm.mockReset();
  api.drop = undefined;
});

test("a committed space creation switches the real App while the LibraryBrowser mutation guard is still active", async () => {
  api.realLibrary = true;
  const creation = deferred<{ id: string; title: string }>();
  const newDocument = libraryDoc("新空间笔记.md", "p3");
  const createdView: LibraryView = {
    ...view,
    projects: [...view.projects, { id: "p3", title: "新空间" }],
    documents: [...view.documents, newDocument],
  };
  let created = false;
  disk.set(newDocument.path, file(newDocument.path, "新空间里的正文"));
  overrides.set("library_create_project", () => creation.promise);
  overrides.set("library_list", () => (created ? createdView : view));
  render(<App />);

  const sidebar = await screen.findByLabelText("文档库侧栏");
  await waitFor(() =>
    expect(
      (
        within(sidebar).getByRole("combobox", {
          name: "当前空间",
        }) as HTMLSelectElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(within(sidebar).getByRole("button", { name: "新建空间" }));
  fireEvent.change(within(sidebar).getByLabelText("空间名称"), {
    target: { value: "新空间" },
  });
  fireEvent.click(within(sidebar).getByRole("button", { name: /^创建$/ }));
  await waitFor(() => expect(calls("library_create_project")).toHaveLength(1));
  expect(
    (
      within(sidebar).getByRole("combobox", {
        name: "当前空间",
      }) as HTMLSelectElement
    ).disabled,
  ).toBe(true);
  expect(
    calls("open_library").some(([, args]) => args.projectId === "p3"),
  ).toBe(false);

  await act(async () => {
    created = true;
    creation.resolve({ id: "p3", title: "新空间" });
  });
  await waitFor(() =>
    expect(
      calls("open_library").some(([, args]) => args.projectId === "p3"),
    ).toBe(true),
  );
  await waitFor(() =>
    expect(
      (
        within(sidebar).getByRole("combobox", {
          name: "当前空间",
        }) as HTMLSelectElement
      ).value,
    ).toBe("p3"),
  );
  const openNew = await within(sidebar).findByRole("button", {
    name: /^新空间笔记\.md$/,
  });
  await waitFor(() =>
    expect((openNew as HTMLButtonElement).disabled).toBe(false),
  );
  fireEvent.click(openNew);
  await waitFor(() =>
    expect(
      (screen.getByLabelText("测试正文") as HTMLTextAreaElement).value,
    ).toBe("新空间里的正文"),
  );
  expect(calls("library_create_project")).toHaveLength(1);
  expect(calls("read_file").at(-1)?.[1]).toEqual({ path: "新空间笔记.md" });
});

test("a slow document open cannot replace the document selected more recently", async () => {
  const a = deferred<FileData>(),
    b = deferred<FileData>();
  overrides.set("read_file", ({ path }) =>
    path === "a.md" ? a.promise : b.promise,
  );
  await boot();
  fireEvent.click(screen.getByRole("button", { name: "打开 a.md" }));
  await waitFor(() => expect(calls("read_file")).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "打开 b.md" }));
  await waitFor(() => expect(calls("read_file")).toHaveLength(2));
  await act(async () => {
    b.resolve(disk.get("b.md")!);
  });
  await act(async () => {
    a.resolve(disk.get("a.md")!);
  });
  expect((screen.getByLabelText("测试正文") as HTMLTextAreaElement).value).toBe(
    "正文 b.md",
  );
});

test("edits made while the next document is loading are saved before leaving", async () => {
  await boot();
  await openDocument("a.md");
  const b = deferred<FileData>();
  overrides.set("read_file", () => b.promise);
  fireEvent.click(screen.getByRole("button", { name: "打开 b.md" }));
  await waitFor(() => expect(calls("read_file")).toHaveLength(2));
  fireEvent.change(screen.getByLabelText("测试正文"), {
    target: { value: "加载期间的新内容" },
  });
  await act(async () => {
    b.resolve(disk.get("b.md")!);
  });
  expect(calls("save_file").at(-1)?.[1]).toEqual(
    expect.objectContaining({ path: "a.md", content: "加载期间的新内容" }),
  );
  expect((screen.getByLabelText("测试正文") as HTMLTextAreaElement).value).toBe(
    "正文 b.md",
  );
});
test("reopening the current document retains edits saved during a slow read", async () => {
  await boot();
  await openDocument("a.md");
  const stale = { ...disk.get("a.md")! },
    read = deferred<FileData>();
  overrides.set("read_file", () => read.promise);
  fireEvent.click(screen.getByRole("button", { name: "打开 a.md" }));
  await waitFor(() => expect(calls("read_file")).toHaveLength(2));
  fireEvent.change(screen.getByLabelText("测试正文"), {
    target: { value: "读取期间写入的新段落" },
  });
  await act(async () => {
    read.resolve(stale);
  });
  expect((screen.getByLabelText("测试正文") as HTMLTextAreaElement).value).toBe(
    "读取期间写入的新段落",
  );
  expect(disk.get("a.md")?.content).toBe("读取期间写入的新段落");
});

test("a calendar response from a previous project does not reopen its calendar", async () => {
  const old = deferred<{ documents: CalendarDocument[]; warnings: string[] }>();
  overrides.set("calendar_list", ({ projectId }) =>
    projectId === "p1"
      ? old.promise
      : {
          documents: [
            {
              documentId: "c",
              path: "c.md",
              title: "c",
              content: "C",
              hash: "c",
            },
          ],
          warnings: [],
        },
  );
  await boot();
  fireEvent.click(screen.getByRole("button", { name: "日历" }));
  await waitFor(() => expect(calls("calendar_list")).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "我的文档" }));
  await screen.findByRole("button", { name: "项目 p2" });
  fireEvent.click(screen.getByRole("button", { name: "项目 p2" }));
  await screen.findByRole("button", { name: "打开 c.md" });
  await act(async () => {
    old.resolve({
      documents: [
        {
          documentId: "old",
          path: "old.md",
          title: "old",
          content: "old",
          hash: "old",
        },
      ],
      warnings: ["旧提示"],
    });
  });
  expect(screen.queryByTestId("calendar-documents")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "日历" }));
  await waitFor(() =>
    expect(screen.getByTestId("calendar-documents").textContent).toBe("c.md"),
  );
  expect(screen.queryByText("旧提示")).toBeNull();
  expect(
    screen.getByRole("button", { name: "测试撤销事项" }).matches(":disabled"),
  ).toBe(true);
});

test("a calendar write blocks source navigation and a second write until it completes", async () => {
  const save = deferred<{ hash: string; indexStale: boolean; warning: null }>();
  overrides.set("calendar_save", () => save.promise);
  await boot();
  await openDocument("a.md");
  fireEvent.click(screen.getByRole("button", { name: "日历" }));
  await waitFor(() =>
    expect(screen.getByTestId("calendar-documents").textContent).toBe("a.md"),
  );
  const edit = screen.getByRole("button", { name: "测试修改事项" });
  act(() => {
    fireEvent.click(edit);
    fireEvent.click(edit);
  });
  expect(calls("calendar_save")).toHaveLength(1);
  expect(
    screen.getByRole("button", { name: "我的文档" }).matches(":disabled"),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "测试打开原文" }));
  expect(calls("read_file")).toHaveLength(1);
  const patch = calls("calendar_save")[0][1];
  disk.set("a.md", {
    ...disk.get("a.md")!,
    content: patch.content,
    hash: "calendar-saved",
  });
  await act(async () => {
    save.resolve({ hash: "calendar-saved", indexStale: true, warning: null });
  });
  fireEvent.click(screen.getByRole("button", { name: "测试打开原文" }));
  await waitFor(() =>
    expect(
      (screen.getByLabelText("测试正文") as HTMLTextAreaElement).value,
    ).toContain("日程已修改"),
  );
  expect(screen.getByTestId("opened-path").textContent).toBe("a.md:7");
  fireEvent.click(screen.getByRole("button", { name: "日历" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "测试撤销事项" }).matches(":disabled"),
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "我的文档" }));
  await screen.findByRole("button", { name: "项目 p2" });
  fireEvent.click(screen.getByRole("button", { name: "项目 p2" }));
  await screen.findByRole("button", { name: "打开 c.md" });
  fireEvent.click(screen.getByRole("button", { name: "日历" }));
  await waitFor(() =>
    expect(screen.getByTestId("calendar-documents").textContent).toBe("c.md"),
  );
  expect(
    screen.getByRole("button", { name: "测试撤销事项" }).matches(":disabled"),
  ).toBe(true);
});

test("double clicking a new calendar document creates one copy", async () => {
  const created = deferred<LibraryDocument>();
  overrides.set("library_create_document", () => created.promise);
  await boot();
  fireEvent.click(screen.getByRole("button", { name: "日历" }));
  await waitFor(() =>
    expect(screen.getByTestId("calendar-documents").textContent).toBe("a.md"),
  );
  const button = screen.getByRole("button", { name: "测试新建日程文档" });
  act(() => {
    fireEvent.click(button);
    fireEvent.click(button);
  });
  await waitFor(() => expect(calls("library_create_document")).toHaveLength(1));
  expect(
    screen.getByRole("button", { name: "我的文档" }).matches(":disabled"),
  ).toBe(true);
  await act(async () => {
    created.resolve(libraryDoc("日程安排.md"));
  });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "我的文档" }).matches(":disabled"),
    ).toBe(false),
  );
});

test("cancelled date navigation neither reports success nor starts a fallback RAG request", async () => {
  await boot();
  await openDocument("a.md");
  overrides.set("save_file", () =>
    Promise.reject(Error("CONFLICT:原文已变化")),
  );
  api.confirm.mockResolvedValue(false);
  fireEvent.change(screen.getByLabelText("测试正文"), {
    target: { value: "需保留的正文" },
  });
  fireEvent.click(screen.getByRole("button", { name: /搜索资料/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "搜索资料" }), {
    target: { value: "今天有哪些事项" },
  });
  fireEvent.submit(
    screen.getByRole("textbox", { name: "搜索资料" }).closest("form")!,
  );
  await waitFor(() => expect(api.confirm).toHaveBeenCalled());
  expect(calls("calendar_list")).toHaveLength(0);
  expect(calls("search")).toHaveLength(0);
  expect(screen.queryByText(/已按/)).toBeNull();
  expect((screen.getByLabelText("测试正文") as HTMLTextAreaElement).value).toBe(
    "需保留的正文",
  );
});

test("file naming stays open while saving, ignores duplicate submits and ignores dropped files", async () => {
  const created = deferred<LibraryDocument>();
  overrides.set("library_create_document", () => created.promise);
  await boot();
  fireEvent.click(screen.getByRole("button", { name: "测试新建文档" }));
  const dialog = screen.getByRole("dialog", { name: "文件名称" });
  const form = screen.getByRole("textbox", { name: "文件名" }).closest("form")!;
  act(() => {
    fireEvent.submit(form);
    fireEvent.submit(form);
  });
  await waitFor(() => expect(calls("library_create_document")).toHaveLength(1));
  fireEvent.keyDown(dialog, { key: "Escape" });
  act(() => {
    api.drop?.({ payload: { type: "drop", paths: ["/source/late.md"] } });
  });
  expect(screen.getByRole("dialog", { name: "文件名称" })).toBeTruthy();
  expect(screen.queryByRole("dialog", { name: "导入本地文档" })).toBeNull();
  await act(async () => {
    created.resolve(libraryDoc("new.md"));
  });
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "文件名称" })).toBeNull(),
  );
  expect(screen.getByTestId("opened-path").textContent).toBe("new.md:");
});

test("dated technical searches stay in RAG and remain cancellable without disabling navigation", async () => {
  const response = deferred<unknown>();
  overrides.set("search", () => response.promise);
  await boot();
  fireEvent.click(screen.getByRole("button", { name: /搜索资料/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "搜索资料" }), {
    target: { value: "今天向量检索" },
  });
  fireEvent.submit(
    screen.getByRole("textbox", { name: "搜索资料" }).closest("form")!,
  );
  await screen.findByRole("button", { name: "停止检索" });
  expect(calls("calendar_list")).toHaveLength(0);
  expect(
    screen.getByRole("button", { name: "我的文档" }).matches(":disabled"),
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "停止检索" }));
  await act(async () => {
    response.resolve({
      results: [
        {
          id: "stale",
          path: "old.md",
          title: "已取消结果",
          text: "旧内容",
          evidence: true,
          startLine: 1,
          endLine: 1,
        },
      ],
      retrievalMode: "bm25",
      rerankStatus: "disabled",
    });
  });
  expect(screen.queryByText("已取消结果")).toBeNull();
  expect(calls("cancel_search")).toHaveLength(1);
});

async function askSynthetic(response?: unknown) {
  overrides.set("bootstrap", () => ({
    settings: {
      ...settings,
      chat: { ...settings.chat, enabled: true, model: "test-model" },
    },
    lastWorkspace: null,
  }));
  if (response) overrides.set("ask_question", () => response);
  await boot();
  await openDocument("a.md");
  fireEvent.click(screen.getByRole("button", { name: "切换知识侧栏" }));
  fireEvent.click(screen.getByRole("button", { name: "问答" }));
  fireEvent.change(screen.getByLabelText("资料范围"), {
    target: { value: "current" },
  });
  fireEvent.change(screen.getByLabelText("检索方式"), {
    target: { value: "keyword" },
  });
  fireEvent.change(screen.getByLabelText("向当前空间提问"), {
    target: { value: "请分析季度资料" },
  });
  fireEvent.click(screen.getByRole("button", { name: "发送问题" }));
  await waitFor(() => expect(calls("ask_question")).toHaveLength(1));
}
const syntheticAnswer = {
  text: "## 季度分析\n\n**收入**增长。\n\n| 季度 | 收入 |\n| --- | --- |\n| Q1 | 120 |\n",
  sources: [],
  warning: null,
  finishReason: "stop",
  retrievalMode: "bm25",
  rerankStatus: "not-requested",
  model: "test-model",
  scope: "a.md",
  chartWarnings: [],
  rejectedCharts: [],
};

test("an answer keeps its request scope and explicit retrieval mode when controls change after completion", async () => {
  const pending = deferred<typeof syntheticAnswer>();
  await askSynthetic(pending.promise);
  expect(
    (screen.getByLabelText("资料范围") as HTMLSelectElement).disabled,
  ).toBe(true);
  expect(
    (screen.getByLabelText("检索方式") as HTMLSelectElement).disabled,
  ).toBe(true);
  expect(calls("ask_question")[0][1]).toEqual(
    expect.objectContaining({
      scope: "a.md",
      retrievalMode: "keyword",
      semantic: false,
    }),
  );
  await act(async () => {
    pending.resolve(syntheticAnswer);
  });
  await screen.findByRole("heading", { name: "季度分析" });
  expect(screen.getByRole("table")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("资料范围"), {
    target: { value: "workspace" },
  });
  expect(
    within(document.querySelector(".assistant-turn")!).getByText(
      /当前文档 · a.md/,
    ),
  ).toBeTruthy();
});

test("save answer creates a separate managed Markdown document without replacing current edits", async () => {
  overrides.set("library_create_document", ({ title, content }) => {
    disk.set(
      "documents/answer/回答.md",
      file("documents/answer/回答.md", content),
    );
    return { ...libraryDoc("documents/answer/回答.md"), title };
  });
  // askSynthetic boot clears no overrides; the new document is intentionally not opened automatically.
  await askSynthetic(syntheticAnswer);
  await screen.findByRole("heading", { name: "季度分析" });
  const before = (screen.getByLabelText("测试正文") as HTMLTextAreaElement)
    .value;
  fireEvent.click(screen.getByRole("button", { name: "保存为文档" }));
  fireEvent.change(screen.getByLabelText("回答文档文件名"), {
    target: { value: "季度回答.md" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存新文档" }));
  await screen.findByText("已保存：回答.md");
  expect(calls("library_create_document")[0][1]).toEqual(
    expect.objectContaining({
      projectId: "p1",
      title: "季度回答.md",
      content: expect.stringContaining("## 季度分析"),
    }),
  );
  expect((screen.getByLabelText("测试正文") as HTMLTextAreaElement).value).toBe(
    before,
  );
});

test("answer insertion previews content before one explicit editor insertion", async () => {
  await askSynthetic(syntheticAnswer);
  await screen.findByRole("heading", { name: "季度分析" });
  const before = (screen.getByLabelText("测试正文") as HTMLTextAreaElement)
    .value;
  fireEvent.click(screen.getByRole("button", { name: "插入正文" }));
  expect(screen.getByRole("dialog", { name: "预览插入回答" })).toBeTruthy();
  expect((screen.getByLabelText("测试正文") as HTMLTextAreaElement).value).toBe(
    before,
  );
  fireEvent.click(screen.getByRole("button", { name: "确认插入" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "预览插入回答" })).toBeNull(),
  );
  expect(
    (screen.getByLabelText("测试正文") as HTMLTextAreaElement).value,
  ).toContain(before + "\n\n## 季度分析");
});

test("a committed answer save is not repeated when refreshing the library fails", async () => {
  await askSynthetic(syntheticAnswer);
  await screen.findByRole("heading", { name: "季度分析" });
  overrides.set("library_create_document", ({ content }) => {
    disk.set(
      "documents/saved/回答.md",
      file("documents/saved/回答.md", content),
    );
    return libraryDoc("documents/saved/回答.md");
  });
  overrides.set("library_list", () =>
    Promise.reject(Error("temporary list failure")),
  );
  fireEvent.click(screen.getByRole("button", { name: "保存为文档" }));
  fireEvent.click(screen.getByRole("button", { name: "保存新文档" }));
  await screen.findByText(/文档已保存，列表刷新失败/);
  expect(screen.getByText("已保存：回答.md")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "保存新文档" })).toBeNull();
  expect(calls("library_create_document")).toHaveLength(1);
});

test("no evidence reports no model call and unknown completion keeps structured content as source", async () => {
  await askSynthetic({
    ...syntheticAnswer,
    text: "资料不足，无法回答。",
    model: "",
    finishReason: "no_evidence",
  });
  await screen.findByText(/未调用问答模型/);
  expect(screen.queryByText(/test-model/)).toBeNull();
});

test("unknown provider completion does not activate structure blocks or reactivate them when saved", async () => {
  const content = '```json\n{"items":[1],"years":[2026]}\n```';
  await askSynthetic({
    ...syntheticAnswer,
    text: content,
    finishReason: "unknown",
  });
  await screen.findByText("内容尚未完成，暂以原文显示。");
  expect(screen.queryByLabelText("JSON 结构编辑器")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "保存为文档" }));
  const preview = screen.getByRole("dialog", { name: "保存回答为文档" });
  expect(preview.textContent).toContain("json-unverified");
});

test("source replacement and an in-flight file hash never save the old document as a conflict draft", async () => {
  await boot();
  await openDocument("a.md");
  const hash = deferred<string>(),
    apply = deferred<void>();
  overrides.set("file_hash", () => hash.promise);
  overrides.set("test_source_apply", () => apply.promise);
  await waitFor(() => expect(calls("file_hash").length).toBeGreaterThan(0), {
    timeout: 5000,
  });
  fireEvent.click(screen.getByRole("button", { name: "测试来源更新" }));
  await waitFor(() => expect(calls("test_source_apply")).toHaveLength(1));
  await act(async () => hash.resolve("externally-updated-hash"));
  const updated = {
    ...file("a.md", "来源更新后的正文"),
    hash: "externally-updated-hash",
  };
  disk.set("a.md", updated);
  await act(async () => apply.resolve());
  await waitFor(() =>
    expect(
      (screen.getByLabelText("测试正文") as HTMLTextAreaElement).value,
    ).toBe(updated.content),
  );
  expect(api.confirm).not.toHaveBeenCalled();
  expect(calls("save_file")).toHaveLength(0);
  expect(screen.queryByText("磁盘文件已变化。")).toBeNull();
}, 10000);

test("assistant keeps multiple turns and transfers the explicitly selected older answer", async () => {
  await askSynthetic(syntheticAnswer);
  await screen.findByRole("heading", { name: "季度分析" });
  overrides.set("ask_question", () => ({
    ...syntheticAnswer,
    text: "## 后续结论\n\n另一轮的回答。",
  }));
  fireEvent.change(screen.getByLabelText("向当前空间提问"), {
    target: { value: "请继续分析第二季度" },
  });
  fireEvent.click(screen.getByRole("button", { name: "发送问题" }));
  await screen.findByRole("heading", { name: "后续结论" });
  const turns = document.querySelectorAll(".assistant-turn");
  expect(turns).toHaveLength(2);
  expect(calls("assistant_ask")[1][1]).toMatchObject({
    parentTurnId: mockConversation.turns[0].id,
  });
  fireEvent.click(
    within(turns[0] as HTMLElement).getByRole("button", { name: "保存为文档" }),
  );
  const preview = screen.getByRole("dialog", { name: "保存回答为文档" });
  expect(preview.textContent).toContain("季度分析");
  expect(preview.textContent).not.toContain("后续结论");
});

test("question composer protects IME Enter and Shift+Enter while Enter sends", async () => {
  await askSynthetic(syntheticAnswer);
  await screen.findByRole("heading", { name: "季度分析" });
  const input = screen.getByLabelText("向当前空间提问");
  fireEvent.change(input, { target: { value: "追问资料" } });
  fireEvent.keyDown(input, { key: "Enter", isComposing: true, keyCode: 229 });
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  expect(calls("assistant_ask")).toHaveLength(1);
  await waitFor(() =>
    expect(input.hasAttribute("data-ime-composing")).toBe(false),
  );
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(calls("assistant_ask")).toHaveLength(2));
});

test("pre-begin send failure preserves the question and its durable draft for retry", async () => {
  overrides.set("assistant_ask", () => Promise.reject(Error("发送前存储失败")));
  overrides.set("bootstrap", () => ({
    settings: {
      ...settings,
      chat: { ...settings.chat, enabled: true, model: "fixture" },
    },
    lastWorkspace: null,
  }));
  await boot();
  await openDocument("a.md");
  fireEvent.click(screen.getByRole("button", { name: "切换知识侧栏" }));
  fireEvent.click(screen.getByRole("button", { name: "问答" }));
  const input = screen.getByLabelText("向当前空间提问") as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: "还未发送的重要问题" } });
  fireEvent.click(screen.getByRole("button", { name: "发送问题" }));
  await screen.findAllByText("发送前存储失败");
  expect(input.value).toBe("还未发送的重要问题");
  expect(mockConversation.draft).toBe("还未发送的重要问题");
  expect(mockConversation.turns).toHaveLength(0);
  expect(
    (screen.getByRole("button", { name: "发送问题" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
});

test("rapid space navigation flushes question drafts even when the document is clean", async () => {
  let project = "p1";
  overrides.set("open_library", (args) => {
    project = args.projectId ?? "p1";
    return workspace(project);
  });
  overrides.set("assistant_list", () =>
    project === "p1" && mockConversation
      ? [{ ...mockConversation, turnCount: 0 }]
      : [],
  );

  await boot();
  await openDocument("a.md");
  fireEvent.click(screen.getByRole("button", { name: "切换知识侧栏" }));
  fireEvent.click(screen.getByRole("button", { name: "问答" }));
  fireEvent.change(screen.getByLabelText("向当前空间提问"), {
    target: { value: "切换前的问题" },
  });
  fireEvent.click(screen.getByRole("button", { name: "项目 p2" }));
  await screen.findByRole("button", { name: "打开 c.md" });
  expect(mockConversation.draft).toBe("切换前的问题");
  const save = api.invoke.mock.calls.findIndex(
    ([n, a]) => n === "assistant_update" && a.draft === "切换前的问题",
  );
  const open = api.invoke.mock.calls.findIndex(
    ([n, a]) => n === "open_library" && a.projectId === "p2",
  );
  expect(save).toBeGreaterThan(-1);
  expect(save).toBeLessThan(open);
  fireEvent.click(screen.getByRole("button", { name: "项目 p1" }));
  await screen.findByRole("button", { name: "打开 a.md" });
  await waitFor(() =>
    expect(
      (screen.getByLabelText("向当前空间提问") as HTMLTextAreaElement).value,
    ).toBe("切换前的问题"),
  );
});

test("failed question draft persistence blocks space navigation and retains the input", async () => {
  await boot();
  await openDocument("a.md");
  fireEvent.click(screen.getByRole("button", { name: "切换知识侧栏" }));
  fireEvent.click(screen.getByRole("button", { name: "问答" }));
  overrides.set("assistant_update", () =>
    Promise.reject(Error("磁盘暂不可写")),
  );
  fireEvent.change(screen.getByLabelText("向当前空间提问"), {
    target: { value: "不能丢的问题" },
  });
  fireEvent.click(screen.getByRole("button", { name: "项目 p2" }));
  await screen.findByText(/已保留当前空间/);
  expect(calls("open_library").some(([, a]) => a.projectId === "p2")).toBe(
    false,
  );
  expect(
    (screen.getByLabelText("向当前空间提问") as HTMLTextAreaElement).value,
  ).toBe("不能丢的问题");
});

test("durable acceptance clears only the submitted input, preserving later typing", async () => {
  const answer = deferred<any>();
  await askSynthetic(answer.promise);
  const sent = calls("assistant_ask")[0][1];
  const input = screen.getByLabelText("向当前空间提问") as HTMLTextAreaElement;
  expect(input.value).toBe("请分析季度资料");
  fireEvent.change(input, { target: { value: "后来输入的新问题" } });
  act(() =>
    api.events.get("assistant-accepted")?.({
      payload: { requestId: sent.requestId },
    }),
  );
  expect(input.value).toBe("后来输入的新问题");
  await act(async () => {
    answer.resolve(syntheticAnswer);
  });
  await screen.findByRole("heading", { name: "季度分析" });
  expect(input.value).toBe("后来输入的新问题");
});

test("exit stops generation then durably flushes the next question before quitting", async () => {
  const answer = deferred<any>();
  await askSynthetic(answer.promise);
  const sent = calls("assistant_ask")[0][1];
  act(() =>
    api.events.get("assistant-accepted")?.({
      payload: { requestId: sent.requestId },
    }),
  );
  fireEvent.change(screen.getByLabelText("向当前空间提问"), {
    target: { value: "退出前必须保留的下一问" },
  });
  overrides.set("cancel_chat", () => {
    answer.resolve(syntheticAnswer);
  });
  await act(async () => {
    await api.close?.({ preventDefault() {} });
  });
  expect(calls("cancel_chat")).toHaveLength(1);
  expect(calls("quit_app")).toHaveLength(1);
  expect(mockConversation.draft).toBe("退出前必须保留的下一问");
});

test("exit preserves the latest single-document draft scope without starting generation", async () => {
  await boot();
  await openDocument("a.md");
  fireEvent.click(screen.getByRole("button", { name: "切换知识侧栏" }));
  fireEvent.click(screen.getByRole("button", { name: "问答" }));
  fireEvent.change(screen.getByLabelText("资料范围"), {
    target: { value: "current" },
  });
  fireEvent.change(screen.getByLabelText("向当前空间提问"), {
    target: { value: "单文档的未发送问题" },
  });
  await act(async () => {
    await api.close?.({ preventDefault() {} });
  });
  expect(calls("quit_app")).toHaveLength(1);
  expect(mockConversation.draft).toBe("单文档的未发送问题");
  expect(mockConversation.scope).toBe("a.md");
});
