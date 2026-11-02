import { imeBoundary, isImeEvent } from "./platform/ime";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import {
  ArrowDownToLine,
  ArrowUp,
  Check,
  ChevronRight,
  Circle,
  Code2,
  Database,
  FileText,
  LoaderCircle,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PenLine,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import Answer from "./Answer";
import {
  answerFileName,
  answerMarkdown,
  type AnswerSnapshot,
} from "./answerContent";
import BackupDialog from "./BackupDialog";
import ProjectCalendar from "./calendar/ProjectCalendar";
import { codeBlocks } from "./content/blocks";
import {
  calendarTemplate,
  currentTimeZone,
  dateQuery,
  type CalendarDocument,
  type DateRange,
} from "./content/calendar";
import Editor, {
  type EditorHandle,
  type EditorMode,
  type InsertionTarget,
} from "./Editor";
import ImportDialog from "./ImportDialog";
import IndexStatusPanel from "./IndexStatusPanel";
import { requestChunks } from "./knowledge/parserClient";
import type { ImportTask, LibraryDocument, LibraryView } from "./library";
import LibraryBrowser from "./LibraryBrowser";
import ModalDialog from "./ModalDialog";
import ParserWorker from "./parser.worker?worker&inline";
import { invoke } from "./platform/ipc";
import { readPanePreference, savePanePreference } from "./platform/layout";
import Markdown from "./preview/Markdown";
import { isCalendarIntent } from "./queryIntent";
import RecoveryDialog, { type RecoveryReport } from "./RecoveryDialog";
import { documentKind } from "./session";
import SettingsModal from "./SettingsModal";
import Sources from "./shell/Sources";
import SpaceNavigation from "./shell/SpaceNavigation";
import Titlebar from "./shell/Titlebar";
import Tree from "./shell/Tree";
import WelcomePage from "./shell/WelcomePage";
import StartupState from "./shell/StartupState";
import type {
  IndexStatusSnapshot,
  SearchResult,
  Settings,
  Stats,
  Workspace,
} from "./types";

interface DocumentState {
  path: string;
  content: string;
  saved: string;
  hash: string;
  revision: number;
  conflict: boolean;
  recovered: boolean;
  missing?: boolean;
  draftSaved?: string;
}
interface PendingMutation {
  epoch: number;
  projectId?: string;
  done: Promise<void>;
  finish: () => void;
}
const emptyStats: Stats = {
  documents: 0,
  chunks: 0,
  vectors: 0,
  embeddingReady: false,
};
const demoContent =
  "# 欢迎来到砚台\n\n给想法一个安静的地方。\n\n砚台把本地写作和知识检索放在一起。文档依然是你熟悉的 Markdown，随时可以用其他编辑器打开。\n\n## 先从一个目录开始\n\n- 打开你的笔记文件夹\n- 选择一篇 Markdown 开始写作\n- 将资料加入资料索引，让它们彼此连接\n\n> 文件留在本机，模型由你选择。\n\n## 你的知识，随手可及\n\n关键词搜索无需模型；连接你自己的 API 后，可以使用语义检索和带引用的资料问答。\n";
const displayError = (e: unknown) =>
  String(e)
    .replace(/^Error: /, "")
    .replace(/^CONFLICT:/, "");
const basename = (path: string) => path.split("/").at(-1) ?? path;
const modeLabel = (mode: string) =>
  ({ keyword: "本地关键词", hybrid: "BM25 + 向量", rerank: "混合检索 + 重排" })[
    mode
  ] ?? mode;
const rerankLabel = (status: string) =>
  ({
    applied: "已重排",
    fallback: "重排降级",
    disabled: "未启用重排",
    "not-requested": "未请求重排",
    "no-candidates": "无候选",
    "strict-unavailable": "重排不可用",
  })[status] ?? status;

const answerExecution = (snapshot: AnswerSnapshot) => {
  const actual =
    snapshot.retrievalMode === "hybrid"
      ? "BM25 + 向量"
      : snapshot.retrievalMode === "bm25"
        ? "BM25"
        : "等待检索";
  return `请求：${modeLabel(snapshot.mode)} · 实际：${actual}${snapshot.rerankStatus ? ` · ${rerankLabel(snapshot.rerankStatus)}` : ""}${snapshot.model ? ` · ${snapshot.model}` : " · 未调用问答模型"}`;
};

export default function App() {
  const [libraryView, setLibraryView] = useState<LibraryView>({
    projects: [],
    documents: [],
    pendingImports: [],
  });
  const [importOpen, setImportOpen] = useState(false),
    [importPaths, setImportPaths] = useState<string[]>([]),
    [importTask, setImportTask] = useState<ImportTask | undefined>(),
    [importBusy, setImportBusy] = useState(false);
  const editorHandle = useRef<EditorHandle>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [document, setDocument] = useState<DocumentState | null>(null);
  const docRef = useRef(document);
  docRef.current = document;
  const [mode, setMode] = useState<EditorMode>("visual");
  const [line, setLine] = useState<number>();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(() =>
    readPanePreference("panel-open"),
  );
  const [panel, setPanel] = useState<"search" | "ask">("search");
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"workspace" | "current">("workspace");
  const [retrievalMode, setRetrievalMode] = useState<
    "keyword" | "hybrid" | "rerank"
  >("hybrid");
  const semantic = retrievalMode !== "keyword";
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      return Math.max(
        240,
        Math.min(
          420,
          Number(localStorage.getItem("inkstone:sidebar-width")) || 272,
        ),
      );
    } catch {
      return 272;
    }
  });
  const [sidebarClosed, setSidebarClosed] = useState(() =>
    readPanePreference("sidebar-closed"),
  );
  useEffect(() => {
    savePanePreference("panel-open", panelOpen);
    savePanePreference("sidebar-closed", sidebarClosed);
  }, [panelOpen, sidebarClosed]);
  const sidebarDrag = useRef<{ x: number; width: number } | null>(null);
  const [libraryMutationBusy, setLibraryMutationBusy] = useState(false);
  const libraryMutation = useRef<PendingMutation | null>(null);
  const libraryGeneration = useRef(0);
  useEffect(() => {
    try {
      localStorage.setItem("inkstone:sidebar-width", String(sidebarWidth));
    } catch {
      /* Optional layout setting */
    }
  }, [sidebarWidth]);
  const [panelWidth, setPanelWidth] = useState(() => {
    try {
      return Math.min(
        640,
        Math.max(
          300,
          Number(localStorage.getItem("inkstone:panel-width")) || 380,
        ),
      );
    } catch {
      return 380;
    }
  });
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [queryBusy, setQueryBusy] = useState(false);
  const [queryWarning, setQueryWarning] = useState("");
  const [answerWarning, setAnswerWarning] = useState("");
  const [retrievalStatus, setRetrievalStatus] = useState("");
  const searchRequest = useRef("");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarDocuments, setCalendarDocuments] = useState<
    CalendarDocument[]
  >([]);
  const [calendarWarnings, setCalendarWarnings] = useState<string[]>([]);
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [calendarWriting, setCalendarWriting] = useState(false);
  const calendarLoadSequence = useRef(0);
  const calendarWrite = useRef<PendingMutation | null>(null);
  const [calendarRange, setCalendarRange] = useState<DateRange>();
  const [calendarScopePath, setCalendarScopePath] = useState<string>();
  const calendarHistory = useRef<
    { documentId: string; before: string; afterHash: string }[]
  >([]);
  const [, redrawCalendar] = useState(0);
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState("");
  const [answer, setAnswer] = useState("");
  const [answerSources, setAnswerSources] = useState<SearchResult[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [answerSnapshot, setAnswerSnapshot] = useState<AnswerSnapshot | null>(
    null,
  );
  const [answerComplete, setAnswerComplete] = useState(false);
  const [answerChartWarnings, setAnswerChartWarnings] = useState<string[]>([]);
  const [rejectedCharts, setRejectedCharts] = useState<number[]>([]);
  const [chatStage, setChatStage] = useState("");
  const [answerExpanded, setAnswerExpanded] = useState(false);
  const [answerTransfer, setAnswerTransfer] = useState<null | {
    kind: "save" | "insert";
    content: string;
    root: string;
    path?: string;
    target?: InsertionTarget;
  }>(null);
  const [answerTitle, setAnswerTitle] = useState("");
  const [answerTransferError, setAnswerTransferError] = useState("");
  const [answerSavedPath, setAnswerSavedPath] = useState("");
  const answerTransferRef = useRef(answerTransfer);
  answerTransferRef.current = answerTransfer;
  const requestRef = useRef("");
  const chatInFlight = useRef(false);
  const [indexOpen, setIndexOpen] = useState(false);
  const [pins, setPins] = useState<string[]>([]);
  const [indexSnapshot, setIndexSnapshot] =
    useState<IndexStatusSnapshot | null>(null);
  const [indexSnapshotLoading, setIndexSnapshotLoading] = useState(false);
  const [indexSnapshotError, setIndexSnapshotError] = useState("");
  const indexSnapshotSequence = useRef(0);
  const [backupOpen, setBackupOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryReport, setRecoveryReport] = useState<RecoveryReport | null>(
    null,
  );
  const [recoveryHidden, setRecoveryHidden] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");
  const [indexBusy, setIndexBusy] = useState(false);
  const indexCancelled = useRef(false);
  const indexFlight = useRef(false);
  const [indexScope, setIndexScope] = useState("");
  const [indexProgress, setIndexProgress] = useState({
    done: 0,
    total: 0,
    path: "",
  });
  const [indexMessages, setIndexMessages] = useState<string[]>([]);
  const [stats, setStats] = useState<Stats>(emptyStats);
  const statsRefreshSequence = useRef(0);
  const [indexDirty, setIndexDirty] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [saveWarning, setSaveWarning] = useState("");
  const [position, setPosition] = useState<{
    selection: number;
    scroll: number;
  }>();
  const workspaceEpoch = useRef(0);
  const openSequence = useRef(0);
  const libraryRefreshSequence = useRef(0);
  const workspaceTransition = useRef(false);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const closingRef = useRef(false);
  const importBusyRef = useRef(false);
  const workspaceRef = useRef<Workspace | null>(null);
  workspaceRef.current = workspace;
  function rememberPosition(selection?: number, scroll?: number) {
    const ws = workspaceRef.current,
      current = docRef.current;
    if (!ws || !current) return;
    const key = `inkstone:session:${ws.root}`;
    try {
      const old = JSON.parse(localStorage.getItem(key) || "{}");
      localStorage.setItem(
        key,
        JSON.stringify({
          path: current.path,
          mode,
          selection: selection ?? old.selection ?? 0,
          scroll: scroll ?? old.scroll ?? 0,
        }),
      );
    } catch {
      /* Session metadata is optional. */
    }
  }
  const saveInFlight = useRef<Promise<void> | null>(null);
  const draftInFlight = useRef<Promise<void>>(Promise.resolve());
  const [nameDialog, setNameDialog] = useState<
    "new" | "rename" | "copy" | null
  >(null);
  const [fileName, setFileName] = useState("");
  const [nameError, setNameError] = useState("");
  const [nameBusy, setNameBusy] = useState(false);
  const nameMutation = useRef<PendingMutation | null>(null);
  const [fileMenu, setFileMenu] = useState(false);
  const [welcome, setWelcome] = useState(true);
  const [booting, setBooting] = useState(true);
  const [startupError, setStartupError] = useState("");
  const [startupAttempt, setStartupAttempt] = useState(0);
  const parser = useRef<Worker | null>(null);
  const parserError = useRef("");
  const parseSeq = useRef(0);
  const dirty = document !== null && document.content !== document.saved;
  const busy =
    booting ||
    !!startupError ||
    libraryMutationBusy ||
    indexBusy ||
    chatBusy ||
    importBusy ||
    calendarWriting ||
    workspaceBusy ||
    nameBusy;
  const taskBusy = indexBusy || chatBusy || importBusy || libraryMutationBusy;
  const interaction = useRef({
    busy: taskBusy,
    booting,
    settingsOpen,
    indexOpen: indexOpen || backupOpen || recoveryOpen,
    importOpen,
    nameDialog,
  });
  interaction.current = {
    busy: taskBusy,
    booting,
    settingsOpen,
    indexOpen: indexOpen || backupOpen || recoveryOpen,
    importOpen,
    nameDialog,
  };
  const native = isTauri();
  function notify(message: string) {
    setToast(message);
  }
  function fail(e: unknown) {
    setError(displayError(e));
  }
  function navigationBlocked() {
    return (
      interaction.current.busy ||
      interaction.current.booting ||
      !!libraryMutation.current ||
      !!calendarWrite.current ||
      !!nameMutation.current ||
      !!answerTransferRef.current ||
      workspaceTransition.current ||
      importBusyRef.current ||
      chatInFlight.current ||
      closingRef.current
    );
  }
  function resetCalendar() {
    ++calendarLoadSequence.current;
    setCalendarBusy(false);
    setCalendarWriting(false);
    setCalendarOpen(false);
    setCalendarDocuments([]);
    setCalendarWarnings([]);
    setCalendarRange(undefined);
    setCalendarScopePath(undefined);
    calendarHistory.current = [];
  }
  function beginCalendarWrite(projectId: string): PendingMutation {
    if (navigationBlocked()) throw Error("请等待当前操作完成后再修改日程");
    let finish!: () => void;
    const operation: PendingMutation = {
      epoch: workspaceEpoch.current,
      projectId,
      done: new Promise<void>((resolve) => {
        finish = resolve;
      }),
      finish: () => finish(),
    };
    calendarWrite.current = operation;
    ++openSequence.current;
    ++calendarLoadSequence.current;
    setCalendarBusy(true);
    setCalendarWriting(true);
    return operation;
  }
  function currentCalendarWrite(operation: PendingMutation) {
    return (
      calendarWrite.current === operation &&
      operation.epoch === workspaceEpoch.current &&
      operation.projectId === workspaceRef.current?.managedProjectId
    );
  }
  function endCalendarWrite(operation: PendingMutation) {
    if (calendarWrite.current === operation) {
      calendarWrite.current = null;
      setCalendarWriting(false);
      setCalendarBusy(false);
    }
    operation.finish();
  }
  function syncCalendarSave(
    before: CalendarDocument,
    content: string,
    hash: string,
  ) {
    const live = syncEditor();
    if (!live || live.path !== before.path) return true;
    // Disk commits must never replace text that was edited after the calendar was opened.
    if (
      live.conflict ||
      live.hash !== before.hash ||
      live.content !== before.content ||
      live.content !== live.saved
    ) {
      const next = { ...live, conflict: true };
      docRef.current = next;
      setDocument(next);
      void persistDraft().catch(fail);
      return false;
    }
    const next = {
      ...live,
      content,
      saved: content,
      hash,
      revision: Date.now(),
    };
    docRef.current = next;
    setDocument(next);
    return true;
  }
  async function refreshStats() {
    const epoch = workspaceEpoch.current,
      root = workspaceRef.current?.root,
      sequence = ++statsRefreshSequence.current;
    if (!root) return;
    const current = () =>
      epoch === workspaceEpoch.current &&
      root === workspaceRef.current?.root &&
      sequence === statsRefreshSequence.current;
    try {
      const next = await invoke("index_stats");
      if (current()) {
        setStats(next);
        setWorkspace((old) =>
          old?.root === root ? { ...old, stats: next } : old,
        );
      }
    } catch (e) {
      if (current()) fail(e);
    }
  }
  async function refreshIndexSnapshot() {
    const epoch = workspaceEpoch.current,
      root = workspaceRef.current?.root,
      sequence = ++indexSnapshotSequence.current;
    if (!root) return;
    setIndexSnapshotLoading(true);
    setIndexSnapshotError("");
    try {
      const [next] = await Promise.all([
        invoke("workspace_index_status"),
        refreshStats(),
      ]);
      if (
        epoch === workspaceEpoch.current &&
        root === workspaceRef.current?.root &&
        sequence === indexSnapshotSequence.current
      )
        setIndexSnapshot(next);
    } catch (e) {
      if (
        epoch === workspaceEpoch.current &&
        sequence === indexSnapshotSequence.current
      )
        setIndexSnapshotError(displayError(e));
    } finally {
      if (sequence === indexSnapshotSequence.current)
        setIndexSnapshotLoading(false);
    }
  }
  useEffect(() => {
    setIndexScope("");
    setIndexMessages([]);
    setPins([]);
    setIndexSnapshot(null);
    setIndexSnapshotError("");
    ++indexSnapshotSequence.current;
    if (!native || !workspace?.root) return;
    let active = true;
    const epoch = workspaceEpoch.current;
    void invoke("workspace_pins")
      .then((next) => {
        if (active && epoch === workspaceEpoch.current) setPins(next ?? []);
      })
      .catch(() => {});
    void refreshIndexSnapshot();
    void invoke("library_recovery_report")
      .then((next) => {
        if (active) {
          setRecoveryReport(next);
          setRecoveryError("");
          setRecoveryHidden(false);
        }
      })
      .catch((e) => {
        if (active) {
          setRecoveryError(displayError(e));
          setRecoveryHidden(false);
        }
      });
    return () => {
      active = false;
    };
  }, [workspace?.root]);
  useEffect(() => {
    if (native && workspace?.root) void refreshIndexSnapshot();
  }, [
    indexOpen,
    stats.documents,
    stats.vectors,
    document?.hash,
    settings?.embedding.enabled,
    settings?.embedding.model,
    settings?.embedding.baseUrl,
    settings?.embedding.dimensions,
  ]);
  async function setDocumentPin(id: string, pinned: boolean) {
    const epoch = workspaceEpoch.current,
      root = workspaceRef.current?.root;
    await invoke("workspace_set_pin", { id, pinned });
    if (epoch === workspaceEpoch.current && root === workspaceRef.current?.root)
      setPins((old) =>
        pinned
          ? [...new Set([...old, id])]
          : old.filter((value) => value !== id),
      );
  }
  async function refreshLibrary() {
    const request = ++libraryRefreshSequence.current;
    const next = await invoke("library_list");
    if (request === libraryRefreshSequence.current) setLibraryView(next);
  }
  async function refreshFiles() {
    const epoch = workspaceEpoch.current;
    const files = await invoke("list_files");
    if (epoch !== workspaceEpoch.current) return;
    setWorkspace((old) => (old ? { ...old, files } : old));
    if (workspaceRef.current?.managedProjectId) await refreshLibrary();
  }

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3600);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    setBooting(true);
    setStartupError("");
    parser.current = new ParserWorker();
    parser.current.onerror = (event) => {
      parserError.current = event.message || "后台解析器启动失败";
    };
    if (!native) {
      setBooting(false);
      return () => parser.current?.terminate();
    }
    let disposed = false;
    const sourceListener = listen<{
      requestId: string;
      sources: SearchResult[];
    }>("chat-sources", (event) => {
      if (event.payload.requestId === requestRef.current)
        setAnswerSources(event.payload.sources);
    });
    const statusListener = listen<{
      requestId: string;
      stage: string;
      detail: string;
    }>("chat-status", (event) => {
      if (event.payload.requestId === requestRef.current)
        setChatStage(event.payload.detail);
    });
    const unlisten = listen<{ requestId: string; delta: string }>(
      "chat-delta",
      (event) => {
        if (event.payload.requestId === requestRef.current)
          setAnswer((old) => old + event.payload.delta);
      },
    );
    void invoke("bootstrap")
      .then(async (boot) => {
        if (disposed) return;
        setSettings(boot.settings);
        const epoch = workspaceEpoch.current;
        if (boot.settings.keyWarning) notify(boot.settings.keyWarning);
        const ws =
          localStorage.getItem("inkstone:workspaceMode") === "external" &&
          boot.lastWorkspace
            ? await invoke("open_workspace", { root: boot.lastWorkspace })
            : await invoke("open_library", { projectId: null });
        if (disposed) return;
        await refreshLibrary();
        if (!disposed && epoch === workspaceEpoch.current) {
          setWorkspace(ws);
          workspaceRef.current = ws;
          setStats(ws.stats);
          if (ws.warning) notify(ws.warning);
          try {
            const saved = JSON.parse(
              localStorage.getItem(`inkstone:session:${ws.root}`) || "null",
            );
            if (saved?.path) await openPath(saved.path, undefined, true, saved);
          } catch {
            /* Optional session metadata must not prevent opening the library. */
          }
        }
      })
      .catch((e) => {
        if (!disposed) setStartupError(displayError(e));
      })
      .finally(() => {
        if (!disposed) setBooting(false);
      });
    return () => {
      disposed = true;
      void unlisten.then((fn) => fn());
      void statusListener.then((stop) => stop());
      void sourceListener.then((fn) => fn());
      parser.current?.terminate();
    };
  }, [startupAttempt]);

  function syncEditor() {
    const doc = docRef.current;
    const live = editorHandle.current?.getContent();
    if (doc && live !== undefined && live !== doc.content) {
      const next = { ...doc, content: live };
      setSaveWarning("");
      docRef.current = next;
      setDocument(next);
      return next;
    }
    return doc;
  }
  useEffect(() => {
    rememberPosition();
  }, [mode]);
  async function persistDraft() {
    const doc = syncEditor(),
      root = workspaceRef.current?.root;
    if (!doc || (doc.content === doc.saved && !doc.conflict)) {
      await draftInFlight.current.catch(() => {});
      return;
    }
    const previous = draftInFlight.current.catch(() => {});
    const pending = (async () => {
      await previous;
      try {
        await invoke("save_draft", {
          path: doc.path,
          content: doc.content,
          baseHash: doc.hash,
          workspaceRoot: root,
        });
        if (workspaceRef.current?.root === root) {
          setDocument((old) =>
            old?.path === doc.path ? { ...old, draftSaved: doc.content } : old,
          );
          setDraftError("");
        }
      } catch (e) {
        if (workspaceRef.current?.root === root) setDraftError(displayError(e));
        throw e;
      }
    })();
    draftInFlight.current = pending;
    return pending;
  }
  async function saveCurrent(): Promise<void> {
    if (saveInFlight.current) {
      await saveInFlight.current;
      return saveCurrent();
    }
    const doc = syncEditor();
    if (!doc) return;
    if (doc.conflict) {
      await persistDraft();
      throw new Error(
        doc.missing
          ? "原文件不可访问，可恢复原位置或另存为。"
          : "文件有外部修改，请载入磁盘版本或另存为",
      );
    }
    if (doc.content === doc.saved) return;
    setSaving(true);
    const promise = (async () => {
      try {
        try {
          await persistDraft();
        } catch {
          /* A successful file save remains sufficient. */
        }
        const result = await invoke("save_file", {
          path: doc.path,
          content: doc.content,
          expectedHash: doc.hash,
          workspaceRoot: workspaceRef.current?.root,
        });
        const hash = result.hash;
        setSaveWarning(result.warning ?? "");
        setError("");
        setDraftError("");
        setDocument((old) =>
          old?.path === doc.path
            ? {
                ...old,
                saved: doc.content,
                hash,
                recovered: false,
                conflict: false,
                missing: false,
                draftSaved: undefined,
              }
            : old,
        );
        if (docRef.current?.path === doc.path)
          docRef.current = {
            ...docRef.current,
            saved: doc.content,
            hash,
            recovered: false,
          };
        setIndexDirty(true);
        if (!result.warning) void refreshStats();
      } catch (e) {
        if (String(e).includes("CONFLICT:"))
          setDocument((old) =>
            old?.path === doc.path ? { ...old, conflict: true } : old,
          );
        throw e;
      } finally {
        setSaving(false);
        saveInFlight.current = null;
      }
    })();
    saveInFlight.current = promise;
    return promise;
  }
  useEffect(() => {
    if (libraryMutationBusy || !document || (!dirty && !document.conflict))
      return;
    const draft = setTimeout(() => void persistDraft().catch(fail), 400);
    const auto = document.conflict
      ? null
      : setTimeout(() => void saveCurrent().catch(fail), 1400);
    return () => {
      clearTimeout(draft);
      if (auto) clearTimeout(auto);
    };
  }, [
    document?.content,
    document?.path,
    document?.conflict,
    document?.saved,
    libraryMutationBusy,
  ]);
  useEffect(() => {
    if (!document || !native) return;
    const timer = setInterval(() => {
      const current = docRef.current;
      if (
        !current ||
        saveInFlight.current ||
        calendarWrite.current ||
        libraryMutation.current
      )
        return;
      const generation = libraryGeneration.current,
        epoch = workspaceEpoch.current;
      void invoke("file_hash", { path: current.path })
        .then((hash) => {
          if (
            !libraryMutation.current &&
            libraryGeneration.current === generation &&
            workspaceEpoch.current === epoch &&
            docRef.current?.path === current.path &&
            docRef.current.hash === current.hash &&
            hash !== docRef.current.hash
          )
            setDocument((old) =>
              !libraryMutation.current &&
              libraryGeneration.current === generation &&
              workspaceEpoch.current === epoch &&
              old?.path === current.path &&
              old.hash === current.hash
                ? { ...old, conflict: true }
                : old,
            );
        })
        .catch(() =>
          setDocument((old) =>
            !libraryMutation.current &&
            libraryGeneration.current === generation &&
            workspaceEpoch.current === epoch &&
            old?.path === current.path &&
            old.hash === current.hash
              ? { ...old, conflict: true, missing: true }
              : old,
          ),
        );
    }, 3500);
    return () => clearInterval(timer);
  }, [document?.path]);
  useEffect(() => {
    if (!native) return;
    const quit = async () => {
      if (closingRef.current) return;
      closingRef.current = true;
      try {
        const pendingCalendar = calendarWrite.current,
          pendingName = nameMutation.current;
        if (pendingCalendar || pendingName)
          notify("正在完成文档保存，随后退出…");
        await libraryMutation.current?.done;
        await pendingCalendar?.done;
        await pendingName?.done;
        try {
          await persistDraft();
        } catch (e) {
          fail(`无法保存恢复草稿，已取消退出：${displayError(e)}`);
          closingRef.current = false;
          return;
        }
        try {
          await saveCurrent();
        } catch {
          /* Conflict drafts are retained. */
        }
        if (indexBusy || chatBusy || importBusyRef.current) {
          const leave = await confirm(
            "正在进行的导入、建库或问答将停止，已完成内容会保留。确定退出？",
            { title: "退出砚台", kind: "warning" },
          );
          if (!leave) {
            closingRef.current = false;
            return;
          }
        }
        if (importBusyRef.current)
          await invoke("cancel_import").catch(() => {});
        cancelSearch();
        await invoke("quit_app");
      } catch (e) {
        closingRef.current = false;
        fail(e);
      }
    };
    const listener = getCurrentWindow().onCloseRequested(async (event) => {
      event.preventDefault();
      await quit();
    });
    const exitListener = listen("request-close", () => void quit());
    return () => {
      void listener.then((fn) => fn());
      void exitListener.then((fn) => fn());
    };
  }, [indexBusy, chatBusy, importBusy]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isImeEvent(e)) return;
      if (booting || startupError) return;
      if ((e.target as Element)?.closest?.('[role="dialog"]')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveCurrent()
          .then(() => notify("已保存"))
          .catch(fail);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void chooseWorkspace();
      }
      if (e.key === "Escape") {
        setFileMenu(false);
        if (!busy) {
          setSettingsOpen(false);
          setIndexOpen(false);
          setNameDialog(null);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  async function mayLeave() {
    try {
      await saveCurrent();
      return true;
    } catch (e) {
      try {
        await persistDraft();
      } catch (draftError) {
        fail(draftError);
        return false;
      }
      return confirm(`${displayError(e)}。继续切换会保留恢复草稿。`, {
        title: "保留草稿并继续？",
        kind: "warning",
      });
    }
  }
  async function chooseWorkspace() {
    if (!native) {
      notify("请使用桌面应用打开本地目录");
      return;
    }
    if (navigationBlocked()) return;
    const request = ++openSequence.current,
      previousEpoch = workspaceEpoch.current;
    if (
      !(await mayLeave()) ||
      request !== openSequence.current ||
      previousEpoch !== workspaceEpoch.current ||
      navigationBlocked()
    )
      return;
    rememberPosition();
    workspaceTransition.current = true;
    setWorkspaceBusy(true);
    let epoch = previousEpoch;
    try {
      const root = await open({
        directory: true,
        multiple: false,
        title: "选择你的笔记文件夹",
      });
      if (!root || typeof root !== "string") return;
      epoch = ++workspaceEpoch.current;
      cancelSearch();
      ++calendarLoadSequence.current;
      const ws = await invoke("open_workspace", { root });
      if (epoch !== workspaceEpoch.current || request !== openSequence.current)
        return;
      localStorage.setItem("inkstone:workspaceMode", "external");
      workspaceRef.current = ws;
      setWorkspace(ws);
      resetCalendar();
      setStats(ws.stats);
      if (ws.warning) notify(ws.warning);
      setDocument(null);
      docRef.current = null;
      setResults([]);
      setAnswer("");
      setAnswerSources([]);
      setAsked("");
      requestRef.current = "";
      setIndexDirty(false);
      setWelcome(true);
      setError("");
    } catch (e) {
      if (epoch === workspaceEpoch.current) fail(e);
    } finally {
      workspaceTransition.current = false;
      setWorkspaceBusy(false);
      if (epoch === workspaceEpoch.current) setCalendarBusy(false);
    }
  }
  async function useLibrary(
    projectId?: string,
    path?: string,
    committedReopen = false,
  ): Promise<boolean> {
    if (!committedReopen && navigationBlocked()) return false;
    const request = ++openSequence.current,
      previousEpoch = workspaceEpoch.current;
    if (
      (!committedReopen && !(await mayLeave())) ||
      request !== openSequence.current ||
      previousEpoch !== workspaceEpoch.current ||
      (!committedReopen && navigationBlocked())
    )
      return false;
    const epoch = ++workspaceEpoch.current;
    rememberPosition();
    workspaceTransition.current = true;
    setWorkspaceBusy(true);
    cancelSearch();
    ++calendarLoadSequence.current;
    let entered = false;
    try {
      const ws = await invoke("open_library", {
        projectId: projectId ?? null,
      });
      if (epoch !== workspaceEpoch.current || request !== openSequence.current)
        return false;
      workspaceRef.current = ws;
      setWorkspace(ws);
      resetCalendar();
      setStats(ws.stats);
      setDocument(null);
      docRef.current = null;
      localStorage.setItem("inkstone:workspaceMode", "library");
      setWelcome(!path);
      setError("");
      setResults([]);
      setAnswer("");
      setAnswerSources([]);
      setAsked("");
      requestRef.current = "";
      setIndexDirty(false);
      await refreshLibrary();
      entered =
        epoch === workspaceEpoch.current && request === openSequence.current;
    } catch (e) {
      if (epoch === workspaceEpoch.current) fail(e);
    } finally {
      workspaceTransition.current = false;
      setWorkspaceBusy(false);
      if (epoch === workspaceEpoch.current) setCalendarBusy(false);
    }
    if (
      !entered ||
      epoch !== workspaceEpoch.current ||
      request !== openSequence.current
    )
      return false;
    if (path) return openPath(path, undefined, true);
    return true;
  }
  async function showLibraryHome() {
    if (navigationBlocked()) return;
    if (!workspaceRef.current?.managedProjectId) {
      await useLibrary();
      return;
    }
    const request = ++openSequence.current,
      epoch = workspaceEpoch.current;
    if (
      !(await mayLeave()) ||
      request !== openSequence.current ||
      epoch !== workspaceEpoch.current ||
      navigationBlocked()
    )
      return;
    rememberPosition();
    ++calendarLoadSequence.current;
    setCalendarBusy(false);
    setCalendarOpen(false);
    setWelcome(true);
  }
  async function openLibraryDocument(doc: LibraryDocument) {
    if (doc.projectId === workspaceRef.current?.managedProjectId) {
      if (await openPath(doc.path)) await refreshLibrary();
    } else await useLibrary(doc.projectId, doc.path);
  }
  function showImport(task?: ImportTask) {
    const state = interaction.current;
    if (
      navigationBlocked() ||
      state.settingsOpen ||
      state.indexOpen ||
      state.importOpen ||
      state.nameDialog
    ) {
      notify("请先完成或关闭当前窗口，再导入文档");
      return;
    }
    setImportTask(task);
    setImportPaths([]);
    setImportOpen(true);
  }
  async function trashLibraryDocument(doc: LibraryDocument, restore: boolean) {
    if (navigationBlocked()) return;
    const epoch = workspaceEpoch.current;
    if (!(await mayLeave())) return;
    if (epoch !== workspaceEpoch.current || navigationBlocked()) return;
    await invoke("library_trash", { id: doc.id, restore });
    if (doc.path === docRef.current?.path && !restore) {
      setDocument(null);
      docRef.current = null;
      setWelcome(true);
    }
    await refreshLibrary();
    await refreshFiles();
    setIndexDirty(true);
  }
  useEffect(() => {
    if (!native) return;
    const unlisten = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === "drop") {
        const state = interaction.current;
        if (
          navigationBlocked() ||
          state.settingsOpen ||
          state.indexOpen ||
          state.importOpen ||
          state.nameDialog
        ) {
          notify("请先完成或关闭当前窗口，再拖入文档");
          return;
        }
        setImportPaths(e.payload.paths);
        setImportTask(undefined);
        setImportOpen(true);
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);
  const libraryProps = {
    view: libraryView,
    projectId: workspace?.managedProjectId ?? "inbox",
    busy,
    selected: document?.path,
    onProject: (id: string, committed = false) =>
      void useLibrary(id, undefined, committed),
    onOpen: (d: LibraryDocument) => void openLibraryDocument(d),
    onNew: () => nameAction("new"),
    onImport: showImport,
    onRefresh: refreshLibrary,
    onTrash: trashLibraryDocument,
    onBeforeAction: mayLeave,
    onMutationBusy: (active: boolean) => {
      ++libraryGeneration.current;
      if (active && !libraryMutation.current) {
        let finish!: () => void;
        libraryMutation.current = {
          epoch: workspaceEpoch.current,
          done: new Promise<void>((resolve) => {
            finish = resolve;
          }),
          finish: () => finish(),
        };
      } else if (!active) {
        libraryMutation.current?.finish();
        libraryMutation.current = null;
      }
      setLibraryMutationBusy(active);
    },
    onDocumentChanged: async (d: LibraryDocument) => {
      if (closingRef.current) return;
      const entered =
        d.projectId === workspaceRef.current?.managedProjectId
          ? (await refreshFiles(), await openPath(d.path, undefined, true))
          : await useLibrary(d.projectId, d.path, true);
      if (!entered) throw Error("已保存，但目标文档未能重新打开");
      setIndexDirty(true);
    },
    onSpaceRename: (id: string, title: string) => {
      setWorkspace((old) =>
        old?.managedProjectId === id ? { ...old, name: title } : old,
      );
    },
    onError: fail,
    pins,
    onPin: setDocumentPin,
    onIndex: () => setIndexOpen(true),
    onBackup: () => setBackupOpen(true),
  };
  function titleOf(path: string) {
    return (
      libraryView.documents.find(
        (d) => d.projectId === workspace?.managedProjectId && d.path === path,
      )?.title ?? basename(path)
    );
  }
  async function openPath(
    path: string,
    target?: SearchResult,
    skipLeave = false,
    restore?: { selection: number; scroll: number; mode: EditorMode },
  ): Promise<boolean> {
    if (
      calendarWrite.current ||
      workspaceTransition.current ||
      (!skipLeave && navigationBlocked())
    )
      return false;
    const request = ++openSequence.current,
      epoch = workspaceEpoch.current;
    const current = () =>
      request === openSequence.current && epoch === workspaceEpoch.current;
    if (!skipLeave && !(await mayLeave())) return false;
    if (!current() || calendarWrite.current || workspaceTransition.current)
      return false;
    if (!skipLeave) rememberPosition();
    ++calendarLoadSequence.current;
    setCalendarBusy(false);
    try {
      const readSourceHash =
        docRef.current?.path === path ? docRef.current.hash : null;
      let file = await invoke("read_file", { path });
      if (!current()) return false;
      let content = file.content;
      let recovered = false;
      if (
        file.draft &&
        (file.missing ||
          (await confirm(
            "发现此文件的未保存草稿，是否恢复？原文件不会被立即覆盖。",
            { title: "恢复草稿" },
          )))
      ) {
        content = file.draft.content;
        recovered = true;
      }
      if (!skipLeave && !(await mayLeave())) return false;
      if (!current()) return false;
      const live = docRef.current;
      if (
        !skipLeave &&
        live?.path === path &&
        !live.conflict &&
        live.content === live.saved &&
        live.hash !== readSourceHash &&
        live.hash !== file.hash
      ) {
        // Reopening the same file must keep text saved while the read was pending.
        file = {
          ...file,
          content: live.saved,
          hash: live.hash,
          draft: null,
          missing: false,
        };
        content = file.content;
        recovered = false;
      }
      const conflict =
        file.missing ||
        (!!file.draft && recovered && file.draft.baseHash !== file.hash);
      const next = {
        path,
        content,
        saved: file.content,
        hash: file.hash,
        revision: Date.now(),
        conflict,
        recovered,
        missing: file.missing,
        draftSaved: recovered ? content : undefined,
      };
      setDraftError("");
      setSaveWarning("");
      setPosition(
        restore
          ? { selection: restore.selection ?? 0, scroll: restore.scroll ?? 0 }
          : undefined,
      );
      setDocument(next);
      docRef.current = next;
      const ws = workspaceRef.current;
      if (ws)
        try {
          localStorage.setItem(
            `inkstone:session:${ws.root}`,
            JSON.stringify({
              path,
              mode:
                restore?.mode ??
                (documentKind(path) === "markdown" ? "visual" : "split"),
              selection: restore?.selection ?? 0,
              scroll: restore?.scroll ?? 0,
            }),
          );
        } catch {}
      setWelcome(false);
      setCalendarOpen(false);
      if (
        ["json", "mermaid"].includes(documentKind(path)) ||
        restore?.mode === "split" ||
        restore?.mode === "mindmap"
      )
        setPanelOpen(false);
      setLine(target?.startLine);
      if (target) {
        setMode(
          documentKind(path) === "markdown" &&
            target.hash === file.hash &&
            codeBlocks(content).some(
              (b) =>
                b.line - 1 <= target.startLine &&
                b.endLine + 1 >= target.startLine,
            )
            ? "visual"
            : "source",
        );
        if (target.hash !== file.hash)
          notify("来源已更新，行号仅供参考，请核对当前原文");
      } else
        setMode(
          restore?.mode ??
            (documentKind(path) === "json" || documentKind(path) === "mermaid"
              ? "split"
              : documentKind(path) === "text" || content.length > 300000
                ? "source"
                : "visual"),
        );
    } catch (e) {
      if (current()) fail(e);
      return false;
    }
    return true;
  }
  async function restoreOriginal() {
    const doc = syncEditor();
    if (!doc) return;
    try {
      await invoke("create_file", { path: doc.path, content: doc.content });
      await invoke("discard_draft", { path: doc.path });
      await refreshFiles();
      await openPath(doc.path, undefined, true);
      notify("已恢复原位置");
    } catch (e) {
      fail(e);
    }
  }
  async function reloadDisk() {
    if (
      !document ||
      !(await confirm("放弃当前编辑并载入磁盘版本？", {
        title: "载入磁盘版本",
        kind: "warning",
      }))
    )
      return;
    try {
      const file = await invoke("read_file", { path: document.path });
      if (file.missing)
        throw new Error("原文件仍不存在，请恢复原位置或另存为。");
      await invoke("discard_draft", { path: document.path });
      const next = {
        path: file.path,
        content: file.content,
        saved: file.content,
        hash: file.hash,
        revision: Date.now(),
        conflict: false,
        recovered: false,
      };
      setDocument(next);
      docRef.current = next;
      setError("");
    } catch (e) {
      fail(e);
    }
  }
  function nameAction(action: "new" | "rename" | "copy") {
    if (navigationBlocked()) return;
    ++openSequence.current;
    setFileMenu(false);
    setNameError("");
    setFileName(
      action === "new"
        ? "未命名.md"
        : action === "copy"
          ? ((document
              ? titleOf(document.path).replace(/(\.[^.]+)$/, " 副本$1")
              : undefined) ?? "未命名.md")
          : document
            ? titleOf(document.path)
            : "",
    );
    setNameDialog(action);
  }
  function closeNameDialog() {
    if (!nameMutation.current) setNameDialog(null);
  }
  async function submitName() {
    if (
      nameMutation.current ||
      calendarWrite.current ||
      workspaceTransition.current
    )
      return;
    const path = fileName.trim(),
      action = nameDialog,
      ws = workspaceRef.current;
    if (!action || !ws) return;
    if (!path) {
      setNameError("请输入文件名");
      return;
    }
    let finish!: () => void;
    const operation: PendingMutation = {
      epoch: workspaceEpoch.current,
      done: new Promise<void>((resolve) => {
        finish = resolve;
      }),
      finish: () => finish(),
    };
    nameMutation.current = operation;
    setNameBusy(true);
    const current = () =>
      nameMutation.current === operation &&
      operation.epoch === workspaceEpoch.current &&
      workspaceRef.current?.root === ws.root;
    try {
      if (action !== "copy" && !(await mayLeave())) return;
      if (!current()) return;
      if (ws.managedProjectId) {
        const selected = libraryView.documents.find(
          (d) =>
            d.projectId === ws.managedProjectId &&
            d.path === docRef.current?.path,
        );
        if (action === "rename" && selected) {
          await invoke("library_rename", { id: selected.id, title: path });
          if (!current()) return;
          await refreshLibrary();
        } else {
          const created = await invoke("library_create_document", {
            projectId: ws.managedProjectId,
            title: path,
            content: action === "copy" ? (syncEditor()?.content ?? "") : "",
          });
          if (!current()) return;
          await refreshLibrary();
          await refreshFiles();
          if (!current()) return;
          await openPath(created.path, undefined, true);
          if (current()) setIndexDirty(true);
        }
      } else {
        const live = syncEditor();
        if (action === "rename" && live) {
          await saveCurrent();
          if (!current()) return;
          await invoke("rename_file", { oldPath: live.path, newPath: path });
          if (!current()) return;
          setDocument(null);
          docRef.current = null;
        } else {
          await invoke("create_file", {
            path,
            content: action === "copy" ? (live?.content ?? "") : "",
          });
          if (action === "copy" && live)
            await invoke("discard_draft", { path: live.path }).catch(() => {});
        }
        if (!current()) return;
        await refreshFiles();
        if (!current()) return;
        await openPath(path, undefined, true);
        if (current()) setIndexDirty(true);
      }
      if (current()) setNameDialog(null);
    } catch (e) {
      if (current()) setNameError(displayError(e));
    } finally {
      if (nameMutation.current === operation) {
        nameMutation.current = null;
        setNameBusy(false);
      }
      operation.finish();
    }
  }
  function changeMode(next: EditorMode) {
    const current = syncEditor();
    if (!document || next === mode) return;
    if (next === "visual" && document.content.length > 300000) {
      notify("大文档请使用源码模式，以保持编辑流畅");
      return;
    }
    setMode(next);
    if (next === "split" || next === "mindmap") setPanelOpen(false);
    setLine(undefined);
    rememberPosition();
  }
  function parse(content: string, path: string, max: number) {
    return requestChunks(
      parser.current,
      ++parseSeq.current,
      content,
      path,
      max,
      parserError.current,
    );
  }
  async function runIndex(scopeOverride?: string) {
    if (!workspaceRef.current || busy || indexFlight.current) return;
    indexFlight.current = true;
    const epoch = workspaceEpoch.current,
      root = workspaceRef.current.root;
    const current = () =>
      epoch === workspaceEpoch.current &&
      root === workspaceRef.current?.root &&
      !closingRef.current;
    let jobId = "",
      failed = 0;
    try {
      if (!(await mayLeave()) || !current()) return;
      if (settings?.embedding.enabled) {
        const local = /^http:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(
          settings.embedding.baseUrl,
        );
        if (
          !local &&
          !(await confirm(
            `所选范围的文本切片将发送到 ${settings.embedding.baseUrl} 进行向量化，可能产生 API 费用。是否开始？`,
            { title: "建立语义索引" },
          ))
        )
          return;
      }
      if (!current()) return;
      setIndexBusy(true);
      indexCancelled.current = false;
      setIndexMessages([]);
      const plan = await invoke("begin_index", {
        scope: scopeOverride ?? (indexScope || null),
      });
      jobId = plan.jobId;
      setIndexMessages([...plan.warnings, `跳过 ${plan.skipped} 个未变化文件`]);
      setIndexProgress({ done: 0, total: plan.documents.length, path: "" });
      for (let i = 0; i < plan.documents.length; i++) {
        if (indexCancelled.current || !current()) break;
        const file = plan.documents[i];
        setIndexProgress({
          done: i,
          total: plan.documents.length,
          path: file.path,
        });
        try {
          const chunks = await parse(
            file.content,
            file.path,
            plan.maxChunkChars,
          );
          if (indexCancelled.current || !current()) break;
          await invoke("index_document", {
            jobId,
            path: file.path,
            hash: file.hash,
            chunks,
            manifest: {
              strategy: "structured",
              version: 1,
              sourceHash: file.hash,
            },
          });
        } catch (e) {
          if (indexCancelled.current || !current()) break;
          failed++;
          setIndexMessages((old) => [
            ...old,
            `${file.path}：${displayError(e)}`,
          ]);
        }
        setIndexProgress({
          done: i + 1,
          total: plan.documents.length,
          path: file.path,
        });
      }
      if (indexCancelled.current)
        setIndexMessages((old) => [
          ...old,
          "已取消。已完成文件的索引已保留，稍后可继续。",
        ]);
      else {
        setIndexDirty(failed > 0);
        notify(
          failed ? `建库结束，${failed} 个文件需要重试` : "资料索引已更新",
        );
      }
    } catch (e) {
      if (current()) setIndexMessages((old) => [...old, displayError(e)]);
    } finally {
      if (jobId)
        await invoke("end_index", { jobId }).catch((e) => {
          if (current()) fail(e);
        });
      indexFlight.current = false;
      setIndexBusy(false);
      if (current()) {
        await refreshStats();
        await refreshIndexSnapshot();
      }
    }
  }

  function cancelSearch() {
    const id = searchRequest.current;
    searchRequest.current = "";
    setQueryBusy(false);
    if (id) void invoke("cancel_search", { requestId: id }).catch(() => {});
  }
  useEffect(() => {
    cancelSearch();
    setResults([]);
    setSearched(false);
    setRetrievalStatus("");
  }, [
    workspace?.root,
    scope,
    scope === "current" ? document?.path : undefined,
  ]);
  async function loadCalendar(
    range?: DateRange,
    path?: string,
  ): Promise<boolean> {
    if (navigationBlocked()) return false;
    const projectId = workspaceRef.current?.managedProjectId;
    if (!projectId) {
      notify("请先进入我的文档中的项目，再查看项目日历");
      return false;
    }
    const epoch = workspaceEpoch.current,
      request = ++calendarLoadSequence.current;
    const navigation = ++openSequence.current;
    const current = () =>
      epoch === workspaceEpoch.current &&
      request === calendarLoadSequence.current &&
      navigation === openSequence.current &&
      projectId === workspaceRef.current?.managedProjectId;
    setCalendarBusy(true);
    try {
      if (!(await mayLeave()) || !current() || navigationBlocked())
        return false;
      rememberPosition();
      setCalendarRange(range);
      setCalendarScopePath(path);
      setCalendarOpen(true);
      setWelcome(false);
      setPanelOpen(false);
      const data = await invoke("calendar_list", { projectId });
      if (!current()) return false;
      setCalendarDocuments(data.documents);
      setCalendarWarnings(data.warnings);
      return true;
    } catch (e) {
      if (current()) fail(e);
      return false;
    } finally {
      if (request === calendarLoadSequence.current && !calendarWrite.current)
        setCalendarBusy(false);
    }
  }
  function calendarQueryRange(text: string) {
    if (scope === "current" && !docRef.current) return null;
    const range = dateQuery(text, new Date(), currentTimeZone());
    return range &&
      isCalendarIntent(text, range.terms) &&
      workspaceRef.current?.managedProjectId
      ? range
      : null;
  }
  async function routeDateQuery(range: DateRange): Promise<boolean> {
    cancelSearch();
    const loaded = await loadCalendar(
      range,
      scope === "current" ? docRef.current?.path : undefined,
    );
    if (loaded)
      notify(
        "已按 " + range.label + " 显示完整事项列表 · " + currentTimeZone(),
      );
    return loaded;
  }
  async function patchCalendar(patch: {
    documentId: string;
    expectedHash: string;
    content: string;
  }) {
    const projectId = workspaceRef.current?.managedProjectId;
    if (!projectId) throw Error("请先打开本地项目");
    const before = calendarDocuments.find(
      (d) => d.documentId === patch.documentId,
    );
    if (!before || before.hash !== patch.expectedHash)
      throw Error("原文已更新，请刷新日历后重试");
    const operation = beginCalendarWrite(projectId);
    try {
      const result = await invoke("calendar_save", {
        projectId,
        ...patch,
      });
      if (!currentCalendarWrite(operation)) return;
      calendarHistory.current.push({
        documentId: patch.documentId,
        before: before.content,
        afterHash: result.hash,
      });
      while (
        calendarHistory.current.length > 30 ||
        calendarHistory.current.reduce((n, h) => n + h.before.length, 0) >
          8_000_000
      )
        calendarHistory.current.shift();
      setCalendarDocuments((old) =>
        old.map((d) =>
          d.documentId === patch.documentId
            ? { ...d, content: patch.content, hash: result.hash }
            : d,
        ),
      );
      const synced = syncCalendarSave(before, patch.content, result.hash);
      notify(
        !synced
          ? "日程已保存；正文有较新的编辑，已保留草稿，请核对磁盘版本"
          : result.warning || "日程已保存到原文",
      );
      setIndexDirty(result.indexStale);
      void refreshStats();
      redrawCalendar((n) => n + 1);
    } finally {
      endCalendarWrite(operation);
    }
  }
  async function undoCalendar() {
    const last = calendarHistory.current.at(-1),
      projectId = workspaceRef.current?.managedProjectId;
    if (!last || !projectId || navigationBlocked()) return;
    const before = calendarDocuments.find(
      (d) => d.documentId === last.documentId,
    );
    if (!before) return;
    const operation = beginCalendarWrite(projectId);
    try {
      const result = await invoke("calendar_save", {
        projectId,
        documentId: last.documentId,
        expectedHash: last.afterHash,
        content: last.before,
      });
      if (!currentCalendarWrite(operation)) return;
      if (calendarHistory.current.at(-1) === last)
        calendarHistory.current.pop();
      setCalendarDocuments((old) =>
        old.map((d) =>
          d.documentId === last.documentId
            ? { ...d, content: last.before, hash: result.hash }
            : d,
        ),
      );
      const previous = calendarHistory.current.at(-1);
      if (previous?.documentId === last.documentId)
        previous.afterHash = result.hash;
      const synced = syncCalendarSave(before, last.before, result.hash);
      redrawCalendar((n) => n + 1);
      notify(
        synced
          ? "已撤销日历修改"
          : "已撤销日历修改；正文的新编辑已保留，请核对磁盘版本",
      );
      setIndexDirty(result.indexStale);
      void refreshStats();
    } catch (e) {
      if (currentCalendarWrite(operation)) fail(e);
    } finally {
      endCalendarWrite(operation);
    }
  }
  async function newCalendarDocument() {
    const projectId = workspaceRef.current?.managedProjectId;
    if (!projectId || navigationBlocked()) return;
    const operation = beginCalendarWrite(projectId),
      range = calendarRange;
    let created = false;
    try {
      if (!(await mayLeave()) || !currentCalendarWrite(operation)) return;
      await invoke("library_create_document", {
        projectId,
        title: "日程安排.md",
        content:
          "# 日程安排\n\n~~~calendar\n" + calendarTemplate("month") + "\n~~~\n",
      });
      if (!currentCalendarWrite(operation)) return;
      await refreshLibrary();
      await refreshFiles();
      created = currentCalendarWrite(operation);
    } catch (e) {
      if (currentCalendarWrite(operation)) fail(e);
    } finally {
      endCalendarWrite(operation);
    }
    if (
      created &&
      operation.epoch === workspaceEpoch.current &&
      projectId === workspaceRef.current?.managedProjectId
    )
      await loadCalendar(range);
  }
  async function runSearch() {
    if (
      !workspace ||
      !query.trim() ||
      workspaceTransition.current ||
      closingRef.current
    )
      return;
    const previousEpoch = workspaceEpoch.current,
      navigation = openSequence.current;
    const range = calendarQueryRange(query);
    if (range) {
      await routeDateQuery(range);
      return;
    }
    if (
      previousEpoch !== workspaceEpoch.current ||
      navigation !== openSequence.current
    )
      return;
    if (scope === "current" && !document) {
      notify("请先打开一篇文档");
      return;
    }
    cancelSearch();
    const id = crypto.randomUUID(),
      epoch = workspaceEpoch.current;
    searchRequest.current = id;
    setQueryBusy(true);
    setQueryWarning("");
    setResults([]);
    setSearched(false);
    setError("");
    try {
      const response = await invoke("search", {
        query,
        scope: scope === "current" ? document?.path : null,
        semantic,
        retrievalMode,
        requestId: id,
      });
      if (searchRequest.current !== id || workspaceEpoch.current !== epoch)
        return;
      setResults(response.results);
      setSearched(true);
      setQueryWarning(response.warning ?? "");
      setRetrievalStatus(
        (response.retrievalMode === "hybrid" ? "BM25 + 向量" : "BM25") +
          " · " +
          ({
            disabled: "未启用重排",
            "no-candidates": "无候选，未调用重排",
            applied: "已重排",
            fallback: "重排降级",
            "strict-unavailable": "严格模式：重排不可用",
          }[response.rerankStatus] ?? response.rerankStatus),
      );
    } catch (e) {
      if (searchRequest.current === id && workspaceEpoch.current === epoch)
        setQueryWarning(displayError(e));
    } finally {
      if (searchRequest.current === id) {
        searchRequest.current = "";
        setQueryBusy(false);
      }
    }
  }
  async function ask() {
    if (!workspace || navigationBlocked() || !question.trim()) return;
    const epoch = workspaceEpoch.current,
      navigation = openSequence.current;
    const range = calendarQueryRange(question);
    if (range) {
      await routeDateQuery(range);
      return;
    }
    if (
      epoch !== workspaceEpoch.current ||
      navigation !== openSequence.current ||
      navigationBlocked()
    )
      return;
    if (!settings?.chat.enabled) {
      setSettingsOpen(true);
      return;
    }
    if (scope === "current" && !document) {
      notify("请先打开一篇文档");
      return;
    }
    const id = crypto.randomUUID();
    requestRef.current = id;
    chatInFlight.current = true;
    setAsked(question);
    const snapshot: AnswerSnapshot = {
      id,
      workspaceRoot: workspace.root,
      scopeLabel:
        scope === "current"
          ? `当前文档 · ${basename(document!.path)}`
          : `当前空间 · ${workspace.name}`,
      scopePath: scope === "current" ? document!.path : null,
      mode: retrievalMode,
      model: settings.chat.model,
      createdAt: new Date().toISOString(),
    };
    setAnswerSnapshot(snapshot);
    setAnswerComplete(false);
    setAnswerChartWarnings([]);
    setRejectedCharts([]);
    setChatStage("正在准备本轮资料…");
    setAnswer("");
    setAnswerSources([]);
    setAnswerWarning("");
    setChatBusy(true);
    try {
      const response = await invoke("ask_question", {
        question,
        scope: scope === "current" ? document?.path : null,
        requestId: id,
        semantic,
        retrievalMode,
      });
      if (requestRef.current !== id || epoch !== workspaceEpoch.current) return;
      setAnswer(response.text);
      setAnswerSources(response.sources);
      setAnswerSnapshot({
        ...snapshot,
        model: response.model ?? snapshot.model,
        finishReason: response.finishReason,
        retrievalMode: response.retrievalMode,
        rerankStatus: response.rerankStatus,
      });
      setAnswerComplete(
        ["stop", "no_evidence"].includes(response.finishReason),
      );
      setAnswerChartWarnings(response.chartWarnings ?? []);
      setRejectedCharts(response.rejectedCharts ?? []);
      setChatStage("");
      setAnswerWarning(response.warning ?? "");
      setQuestion("");
    } catch (e) {
      if (requestRef.current === id && epoch === workspaceEpoch.current) {
        setAnswerWarning(displayError(e));
        setAnswerSnapshot({ ...snapshot, finishReason: "error" });
        setChatStage("");
      }
    } finally {
      if (requestRef.current === id) {
        requestRef.current = "";
        chatInFlight.current = false;
        setChatBusy(false);
      }
    }
  }

  function updatePanelWidth(width: number) {
    const next = Math.max(300, Math.min(640, width));
    setPanelWidth(next);
    try {
      localStorage.setItem("inkstone:panel-width", String(next));
    } catch {
      /* optional preference */
    }
  }
  async function copyAnswer() {
    try {
      await navigator.clipboard.writeText(
        answerMarkdown(
          answer,
          asked,
          answerSources,
          answerSnapshot,
          "",
          false,
          { incomplete: !answerComplete, rejectedCharts },
        ),
      );
      notify("已复制 Markdown 与来源记录");
    } catch (e) {
      fail(e);
    }
  }
  function closeAnswerTransfer() {
    if (nameMutation.current) return;
    answerTransferRef.current = null;
    setAnswerTransfer(null);
  }
  function prepareAnswerTransfer(kind: "save" | "insert") {
    if (navigationBlocked() || !workspace || !answer.trim()) return;
    try {
      const live = syncEditor();
      const target =
        kind === "insert"
          ? editorHandle.current?.captureInsertion()
          : undefined;
      if (kind === "insert" && (!live || !target))
        throw Error("请先选择正文中的插入位置。");
      const transfer = {
        kind,
        root: workspace.root,
        path: live?.path,
        target,
        content: answerMarkdown(
          answer,
          asked,
          answerSources,
          answerSnapshot,
          kind === "insert"
            ? live!.path
            : workspace.managedProjectId
              ? "documents/new/回答.md"
              : "回答.md",
          kind === "save",
          { incomplete: !answerComplete, rejectedCharts },
        ),
      };
      setAnswerTitle(answerFileName(asked));
      setAnswerTransferError("");
      setAnswerSavedPath("");
      answerTransferRef.current = transfer;
      setAnswerTransfer(transfer);
    } catch (e) {
      fail(e);
    }
  }
  async function commitAnswerTransfer() {
    const transfer = answerTransferRef.current,
      ws = workspaceRef.current;
    if (!transfer || !ws || nameMutation.current) return;
    if (transfer.root !== ws.root) {
      setAnswerTransferError("空间已变化，请重新选择保存目标。");
      return;
    }
    setAnswerTransferError("");
    if (transfer.kind === "insert") {
      try {
        if (
          docRef.current?.path !== transfer.path ||
          !transfer.target ||
          !editorHandle.current
        )
          throw Error("目标文档已变化，请重新选择插入位置。");
        editorHandle.current.insertMarkdown(transfer.content, transfer.target);
        syncEditor();
        closeAnswerTransfer();
        notify("已插入正文，可一次撤销");
      } catch (e) {
        setAnswerTransferError(displayError(e));
      }
      return;
    }
    const title = answerTitle.trim();
    if (!title || !/\.md$/i.test(title) || /[\\/\r\n]/.test(title)) {
      setAnswerTransferError("请输入以 .md 结尾的文件名，文件名不包含目录。");
      return;
    }
    let finish!: () => void;
    const operation: PendingMutation = {
      epoch: workspaceEpoch.current,
      done: new Promise<void>((resolve) => {
        finish = resolve;
      }),
      finish: () => finish(),
    };
    nameMutation.current = operation;
    setNameBusy(true);
    const current = () =>
      nameMutation.current === operation &&
      workspaceRef.current?.root === ws.root &&
      operation.epoch === workspaceEpoch.current;
    try {
      let path = title;
      if (ws.managedProjectId) {
        const created = await invoke("library_create_document", {
          projectId: ws.managedProjectId,
          title,
          content: transfer.content,
        });
        path = created.path;
      } else await invoke("create_file", { path, content: transfer.content });
      if (current()) {
        setAnswerSavedPath(path);
        setIndexDirty(true);
        notify("回答已保存为本地文档");
        try {
          if (ws.managedProjectId) await refreshLibrary();
          await refreshFiles();
        } catch (e) {
          if (current())
            setAnswerTransferError(
              "文档已保存，列表刷新失败。可直接打开新文档。" + displayError(e),
            );
        }
      }
    } catch (e) {
      if (current()) setAnswerTransferError(displayError(e));
    } finally {
      if (nameMutation.current === operation) {
        nameMutation.current = null;
        setNameBusy(false);
      }
      operation.finish();
    }
  }

  return (
    <div
      {...imeBoundary}
      className={`app-shell v06-shell ${sidebarClosed ? "sidebar-closed" : ""}`}
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
      <Titlebar
        workspaceName={workspace?.name}
        panelOpen={panelOpen}
        onToggle={() => setPanelOpen(!panelOpen)}
      />
      {!recoveryHidden &&
        (recoveryError ||
          recoveryReport?.items.some(
            (item) => item.status !== "recovered",
          )) && (
          <div className="recovery-summary" role="status">
            <span>
              {recoveryError
                ? "恢复诊断暂不可读取，请查看并重试。"
                : `有 ${recoveryReport?.items.filter((item) => item.status !== "recovered").length ?? 0} 项恢复记录需要核对，当前内容已保留。`}
            </span>
            <button onClick={() => setRecoveryOpen(true)}>查看诊断</button>
            <button
              aria-label="收起恢复提示"
              onClick={() => setRecoveryHidden(true)}
            >
              <X size={14} />
            </button>
          </div>
        )}
      <div className="main-layout">
        <aside className="sidebar sidebar-compact" aria-label="文档空间导航">
          <div className="space-sidebar-heading">
            <strong>Inkstone</strong>
            <button
              className="icon-button"
              aria-label={sidebarClosed ? "展开文档列表" : "收起文档列表"}
              title={sidebarClosed ? "展开文档列表" : "收起文档列表"}
              onClick={() => setSidebarClosed(!sidebarClosed)}
            >
              {sidebarClosed ? (
                <PanelLeftOpen size={17} />
              ) : (
                <PanelLeftClose size={17} />
              )}
            </button>
          </div>
          <SpaceNavigation
            disabled={busy || booting}
            calendarOpen={calendarOpen}
            canIndex={!!workspace && !busy}
            indexDirty={indexDirty}
            onHome={() => void showLibraryHome()}
            onCalendar={() => void loadCalendar()}
            onSearch={() => {
              setPanelOpen(true);
              setPanel("search");
            }}
            onIndex={() => setIndexOpen(true)}
          />
          <div className="file-tree">
            {booting || startupError ? (
              <div className="tree-empty">
                <p>{booting ? "正在读取文档列表…" : "资料暂不可读取"}</p>
              </div>
            ) : workspace?.managedProjectId ? (
              <LibraryBrowser {...libraryProps} compact />
            ) : workspace ? (
              <>
                <div className="external-mode-note">
                  外部目录 · 直接编辑原件
                </div>
                <Tree
                  files={workspace.files}
                  selected={document?.path}
                  onOpen={(path) => void openPath(path)}
                />
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => nameAction("new")}
                >
                  新建文件
                </button>
              </>
            ) : (
              <div className="tree-empty">
                <p>创建空间，汇集不同位置的文档。</p>
                <button
                  disabled={busy || booting}
                  onClick={() => void useLibrary()}
                >
                  进入我的文档
                </button>
              </div>
            )}
          </div>
          <div className="sidebar-bottom space-footer">
            <details className="space-advanced">
              <summary>空间与文件</summary>
              <div>
                <button
                  disabled={busy || booting}
                  onClick={() => void showLibraryHome()}
                >
                  文档空间首页
                </button>
                <button disabled={busy || booting} onClick={() => showImport()}>
                  导入本地资料
                </button>
                <button
                  disabled={busy || booting}
                  onClick={() => setBackupOpen(true)}
                >
                  备份与恢复预演
                </button>
                <button
                  disabled={busy || booting}
                  onClick={() => setRecoveryOpen(true)}
                >
                  恢复与诊断
                </button>
                <button
                  disabled={busy || booting}
                  onClick={() => void chooseWorkspace()}
                >
                  打开本地目录（编辑原件）
                </button>
                {workspace?.managedProjectId && (
                  <>
                    <button
                      onClick={() =>
                        void invoke("library_reveal", {
                          projectId: workspace.managedProjectId!,
                        }).catch(fail)
                      }
                    >
                      在访达中显示空间
                    </button>
                    <button
                      onClick={() => {
                        setPanelOpen(true);
                        setPanel("search");
                      }}
                    >
                      搜索空间资料
                    </button>
                  </>
                )}
              </div>
            </details>
            <button
              className="settings-button"
              title="模型与设置"
              aria-label="模型与设置"
              disabled={!settings || busy}
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 size={17} />
              <span>模型与设置</span>
              <span
                className={`status-dot ${settings?.embedding.enabled || settings?.chat.enabled ? "online" : ""}`}
              />
            </button>
            <span className="local-note">
              <ShieldCheck size={12} />
              文档保存在本机
            </span>
          </div>
        </aside>
        {!sidebarClosed && (
          <div
            className="sidebar-resizer"
            role="separator"
            aria-label="调整文档列表宽度"
            aria-orientation="vertical"
            aria-valuemin={240}
            aria-valuemax={420}
            aria-valuenow={sidebarWidth}
            tabIndex={0}
            onPointerDown={(e) => {
              sidebarDrag.current = { x: e.clientX, width: sidebarWidth };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const start = sidebarDrag.current;
              if (start)
                setSidebarWidth(
                  Math.max(
                    240,
                    Math.min(420, start.width + e.clientX - start.x),
                  ),
                );
            }}
            onPointerUp={(e) => {
              sidebarDrag.current = null;
              if (e.currentTarget.hasPointerCapture(e.pointerId))
                e.currentTarget.releasePointerCapture(e.pointerId);
            }}
            onPointerCancel={() => {
              sidebarDrag.current = null;
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                e.preventDefault();
                setSidebarWidth((w) =>
                  Math.max(
                    240,
                    Math.min(420, w + (e.key === "ArrowRight" ? 16 : -16)),
                  ),
                );
              }
            }}
          />
        )}
        <main className="main-content" aria-busy={booting}>
          {error && (
            <div className="error-banner">
              <span>{error}</span>
              <button aria-label="关闭错误提示" onClick={() => setError("")}>
                <X size={14} />
              </button>
            </div>
          )}
          {!native && (
            <div className="browser-banner">
              界面预览模式 · 本地文件和资料索引功能请使用桌面应用。
            </div>
          )}
          {booting || startupError ? (
            <StartupState
              error={startupError}
              onRetry={() => setStartupAttempt((n) => n + 1)}
            />
          ) : calendarOpen ? (
            <div className="project-calendar-container">
              <div className="calendar-project-picker">
                <label>
                  空间{" "}
                  <select
                    aria-label="日历空间"
                    value={workspace?.managedProjectId ?? ""}
                    disabled={busy || calendarBusy}
                    onChange={(e) => {
                      const id = e.target.value;
                      void useLibrary(id).then((entered) => {
                        if (
                          entered &&
                          workspaceRef.current?.managedProjectId === id
                        )
                          void loadCalendar();
                      });
                    }}
                  >
                    {libraryView.projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                </label>
                <span>日程保存在所属文档，可点击返回原文</span>
              </div>
              {calendarWarnings.length > 0 && (
                <details className="calendar-warnings">
                  <summary>有 {calendarWarnings.length} 条日历提示</summary>
                  {calendarWarnings.map((w, i) => (
                    <p key={i}>{w}</p>
                  ))}
                </details>
              )}
              {calendarScopePath && (
                <div className="panel-warning">
                  日期查询范围：当前文档 · {titleOf(calendarScopePath)}{" "}
                  <button onClick={() => setCalendarScopePath(undefined)}>
                    查看整个空间
                  </button>
                </div>
              )}
              <ProjectCalendar
                key={workspace?.managedProjectId}
                documents={
                  calendarScopePath
                    ? calendarDocuments.filter(
                        (d) => d.path === calendarScopePath,
                      )
                    : calendarDocuments
                }
                onPatch={patchCalendar}
                onOpen={({ path, line }) =>
                  void openPath(path).then((opened) => {
                    if (opened && docRef.current?.path === path) {
                      setLine(line);
                      setMode("visual");
                    }
                  })
                }
                onError={fail}
                initialRange={calendarRange}
                initialQuery={calendarRange?.terms}
                onUndo={() => void undoCalendar()}
                canUndo={calendarHistory.current.length > 0}
                busy={calendarBusy}
                onRefresh={() =>
                  void loadCalendar(calendarRange, calendarScopePath)
                }
                onNewDocument={() => void newCalendarDocument()}
              />
            </div>
          ) : welcome || !document ? (
            workspace?.managedProjectId ? (
              <LibraryBrowser {...libraryProps} />
            ) : (
              <WelcomePage
                workspace={workspace}
                stats={stats}
                disabled={busy || booting}
                onOpen={() => void chooseWorkspace()}
                onNew={() => nameAction("new")}
                onIndex={() => setIndexOpen(true)}
              />
            )
          ) : (
            <>
              <div className="editor-toolbar">
                <div className="document-title">
                  <FileText size={16} />
                  <span className="document-project" title={workspace?.name}>
                    {workspace?.name}
                  </span>
                  <ChevronRight size={11} />
                  <span title={document.path}>{titleOf(document.path)}</span>
                  {dirty && <span className="unsaved-dot" />}
                </div>
                <div className="mode-switch">
                  <button
                    className={mode === "source" ? "active" : ""}
                    onClick={() => changeMode("source")}
                  >
                    <Code2 size={13} />
                    源码
                  </button>
                  <button
                    disabled={documentKind(document.path) !== "markdown"}
                    className={mode === "visual" ? "active" : ""}
                    onClick={() => changeMode("visual")}
                  >
                    <PenLine size={13} />
                    正文
                  </button>
                  <button
                    className={mode === "split" ? "active" : ""}
                    onClick={() => changeMode("split")}
                  >
                    分栏
                  </button>
                  <button
                    disabled={documentKind(document.path) !== "markdown"}
                    className={mode === "mindmap" ? "active" : ""}
                    onClick={() => changeMode("mindmap")}
                  >
                    大纲脑图
                  </button>
                </div>
                <div className="file-actions">
                  <button
                    className="icon-button"
                    title="保存 ⌘S"
                    aria-label="保存文件"
                    onClick={() =>
                      void saveCurrent()
                        .then(() => notify("已保存"))
                        .catch(fail)
                    }
                  >
                    {saving ? (
                      <LoaderCircle size={16} className="spin" />
                    ) : (
                      <ArrowDownToLine size={16} />
                    )}
                  </button>
                  <button
                    className="icon-button"
                    aria-label="文件操作"
                    onClick={() => setFileMenu(!fileMenu)}
                  >
                    <MoreHorizontal size={18} />
                  </button>
                  {fileMenu && (
                    <div className="dropdown">
                      <button
                        disabled={busy}
                        onClick={() => nameAction("rename")}
                      >
                        重命名文件
                      </button>
                      <button onClick={() => nameAction("copy")}>
                        另存为新文件
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {document.conflict && (
                <div className="conflict-banner">
                  <span>
                    {document.missing ? "原文件已移走。" : "磁盘文件已变化。"}
                    {document.draftSaved === document.content
                      ? "当前编辑已保留为草稿。"
                      : "当前编辑尚未保存草稿，请保留窗口并重试或另存。"}
                  </span>
                  {document.missing ? (
                    <button onClick={() => void restoreOriginal()}>
                      恢复原位置
                    </button>
                  ) : (
                    <button onClick={() => void reloadDisk()}>
                      载入磁盘版本
                    </button>
                  )}
                  <button onClick={() => nameAction("copy")}>另存为</button>
                </div>
              )}
              {saveWarning && (
                <div className="recovery-banner">{saveWarning}</div>
              )}
              {draftError && (
                <div className="conflict-banner">
                  草稿保存失败：{draftError}
                  <button onClick={() => void persistDraft().catch(fail)}>
                    重试草稿
                  </button>
                  <button onClick={() => nameAction("copy")}>另存为</button>
                  <button
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(syncEditor()?.content ?? "")
                        .then(() => notify("已复制当前编辑"))
                        .catch(fail)
                    }
                  >
                    复制内容
                  </button>
                </div>
              )}
              {document.recovered && !document.conflict && (
                <div className="recovery-banner">
                  已恢复未保存草稿，保存后写入原文件。
                </div>
              )}
              <div className="editor-container">
                <Editor
                  handleRef={editorHandle}
                  key={`${document.path}:${document.revision}`}
                  content={document.content}
                  path={document.path}
                  viewKey={`${workspace?.root ?? ""}/${document.path}`}
                  mode={mode}
                  line={line}
                  onChange={(content) => {
                    setSaveWarning("");
                    setDocument((old) => (old ? { ...old, content } : old));
                  }}
                  onError={fail}
                  position={position}
                  onPosition={(selection, scroll) =>
                    rememberPosition(selection, scroll)
                  }
                  onOpenDoc={(path) => void openPath(path)}
                />
              </div>
              <footer className="editor-status">
                <span>
                  {saving ? (
                    "正在保存…"
                  ) : dirty ? (
                    document.conflict ? (
                      document.draftSaved === document.content ? (
                        "草稿已保留"
                      ) : (
                        "草稿未保存"
                      )
                    ) : (
                      "等待自动保存"
                    )
                  ) : (
                    <>
                      <Check size={12} />
                      已保存
                    </>
                  )}
                </span>
                <span>
                  {Array.from(document.content).length.toLocaleString()} 字符
                </span>
                <span>{document.content.split("\n").length} 行</span>
                <div />
                <span>UTF-8</span>
                <span>
                  {document.path.toLowerCase().endsWith(".txt")
                    ? "纯文本"
                    : documentKind(document.path) === "json"
                      ? "JSON"
                      : documentKind(document.path) === "mermaid"
                        ? "Mermaid"
                        : "Markdown"}
                </span>
                {indexDirty && (
                  <button onClick={() => setIndexOpen(true)}>
                    索引待更新 <Circle size={7} fill="currentColor" />
                  </button>
                )}
              </footer>
            </>
          )}
        </main>
        {panelOpen && (
          <aside
            className="knowledge-panel"
            style={{ "--knowledge-width": `${panelWidth}px` } as CSSProperties}
          >
            <div
              className="panel-resize"
              role="separator"
              aria-label="知识侧栏宽度"
              aria-orientation="vertical"
              tabIndex={0}
              aria-valuemin={300}
              aria-valuemax={640}
              aria-valuenow={panelWidth}
              onKeyDown={(e) => {
                if (
                  ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
                ) {
                  e.preventDefault();
                  updatePanelWidth(
                    e.key === "Home"
                      ? 300
                      : e.key === "End"
                        ? 640
                        : panelWidth + (e.key === "ArrowLeft" ? 20 : -20),
                  );
                }
              }}
              onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                const start = e.clientX,
                  initial = panelWidth;
                const move = (event: PointerEvent) =>
                  updatePanelWidth(initial + start - event.clientX);
                const end = () => {
                  window.removeEventListener("pointermove", move);
                  window.removeEventListener("pointerup", end);
                  window.removeEventListener("pointercancel", end);
                };
                window.addEventListener("pointermove", move);
                window.addEventListener("pointerup", end);
                window.addEventListener("pointercancel", end);
              }}
            />
            <div className="panel-tabs">
              <button
                className={panel === "search" ? "active" : ""}
                onClick={() => setPanel("search")}
              >
                <Search size={15} />
                检索
              </button>
              <button
                className={panel === "ask" ? "active" : ""}
                onClick={() => setPanel("ask")}
              >
                <Sparkles size={15} />
                问答
              </button>
              <button
                className="icon-button"
                aria-label="收起知识侧栏"
                onClick={() => setPanelOpen(false)}
              >
                <PanelRightClose size={15} />
              </button>
            </div>
            <div className="scope-row">
              <span>资料范围</span>
              <select
                aria-label="资料范围"
                value={scope}
                disabled={chatBusy}
                onChange={(e) =>
                  setScope(e.target.value as "workspace" | "current")
                }
              >
                <option value="workspace">当前空间</option>
                <option value="current" disabled={!document}>
                  当前文档
                </option>
              </select>
            </div>
            <div className="retrieval-choice">
              <label>
                检索方式
                <select
                  aria-label="检索方式"
                  value={retrievalMode}
                  disabled={chatBusy || queryBusy}
                  onChange={(e) => {
                    cancelSearch();
                    setResults([]);
                    setSearched(false);
                    setRetrievalMode(e.target.value as typeof retrievalMode);
                  }}
                >
                  <option value="keyword">本地关键词</option>
                  <option value="hybrid">BM25 + 向量</option>
                  <option value="rerank" disabled={!settings?.rerank.enabled}>
                    混合检索 + 重排
                  </option>
                </select>
              </label>
              <p>
                {retrievalMode === "keyword"
                  ? "检索在本机进行；问答仍会将证据发送给问答模型。"
                  : retrievalMode === "hybrid"
                    ? "问题会发送给向量模型；问答另发送选定证据。"
                    : "问题与候选资料会发送给重排模型。"}
              </p>
              {retrievalMode !== "keyword" && (
                <div className="retrieval-readiness" role="status">
                  {!settings?.embedding.enabled
                    ? "向量未启用：本次可使用本地关键词检索。"
                    : !indexSnapshot ||
                        indexSnapshotError ||
                        indexSnapshotLoading
                      ? "向量准备情况尚未核对或正在重新核对。"
                      : !indexSnapshot.documents.some(
                            (d) =>
                              d.included &&
                              (scope !== "current" ||
                                d.path === document?.path),
                          )
                        ? "当前范围尚未建立可用向量；可先使用本地关键词或显式建库。"
                        : indexSnapshot.documents
                              .filter(
                                (d) =>
                                  scope !== "current" ||
                                  d.path === document?.path,
                              )
                              .some(
                                (d) => d.included && d.vectorState !== "ready",
                              )
                          ? "部分文档缺少当前向量或需要更新；实际检索方式以结果说明为准。"
                          : "已核对的纳入文档具有当前模型向量。"}
                  <button
                    disabled={chatBusy || queryBusy}
                    onClick={() => setIndexOpen(true)}
                  >
                    查看准备情况
                  </button>
                </div>
              )}
              {panel === "ask" && (dirty || indexDirty) && (
                <p className="index-note" role="status">
                  回答依据已保存并入库的版本。
                  {dirty ? "当前编辑尚未保存。" : "索引待更新。"}
                  <button
                    onClick={() => setIndexOpen(true)}
                    disabled={chatBusy}
                  >
                    查看索引
                  </button>
                </p>
              )}
            </div>
            {panel === "search" ? (
              <>
                <form
                  className="search-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void runSearch();
                  }}
                >
                  <div>
                    <Search size={16} />
                    <input
                      aria-label="搜索资料"
                      placeholder="在你的资料里寻找…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      maxLength={1500}
                    />
                    <button
                      className="icon-button"
                      disabled={!workspace || !query.trim()}
                      aria-label="执行搜索"
                    >
                      {queryBusy ? (
                        <LoaderCircle size={15} className="spin" />
                      ) : (
                        <ArrowUp size={16} className="diagonal" />
                      )}
                    </button>
                  </div>
                  {queryBusy && (
                    <button
                      type="button"
                      className="stop-search"
                      onClick={cancelSearch}
                    >
                      <Square size={12} />
                      停止检索
                    </button>
                  )}
                </form>
                <div className="panel-scroll">
                  {queryWarning && (
                    <div className="panel-warning">{queryWarning}</div>
                  )}
                  {searched ? (
                    <>
                      <div className="results-label">
                        {results.filter((r) => r.evidence).length} 条可用证据 ·{" "}
                        {results.filter((r) => !r.evidence).length} 条待核实候选
                      </div>
                      {retrievalStatus && (
                        <div className="retrieval-status">
                          {retrievalStatus}
                        </div>
                      )}
                      {!results.some((r) => r.evidence) &&
                        results.length > 0 && (
                          <div className="panel-warning">
                            仅找到可能相关的候选，资料不足以支持回答。
                          </div>
                        )}
                      <Sources
                        items={results}
                        onOpen={(source) => void openPath(source.path, source)}
                      />
                      {!results.length && (
                        <div className="empty-results">
                          暂无匹配资料。试试更具体的关键词，或更新资料索引。
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="panel-empty">
                      <div className="orbit-icon">
                        <Search size={25} strokeWidth={1.4} />
                        <span />
                        <i />
                      </div>
                      <h3>想找的，或许就在笔记里</h3>
                      <p>
                        从一个关键词开始，
                        <br />
                        重新发现你积累的知识。
                      </p>
                      <div className="example-searches">
                        {["项目计划", "灵感记录", "技术方案"].map((text) => (
                          <button key={text} onClick={() => setQuery(text)}>
                            {text}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="panel-scroll ask-scroll">
                  {asked ? (
                    <>
                      <div className="question-bubble">{asked}</div>
                      {answerSnapshot && (
                        <div className="answer-context">
                          {answerSnapshot.scopeLabel}
                          <br />
                          {answerExecution(answerSnapshot)}
                        </div>
                      )}
                      {chatBusy && (
                        <div className="retrieval-status" role="status">
                          {chatStage || "正在组织回答…"}
                        </div>
                      )}
                      <div className="assistant-label">
                        <span className="mini-mark">
                          <Sparkles size={13} />
                        </span>
                        砚台
                        {chatBusy && (
                          <LoaderCircle size={12} className="spin" />
                        )}
                      </div>
                      {answer ? (
                        <Answer
                          text={answer}
                          sources={answerSources}
                          onOpen={(s) => void openPath(s.path, s)}
                          pending={chatBusy || !answerComplete}
                          rejectedCharts={rejectedCharts}
                          viewKey={`answer:${answerSnapshot?.id ?? ""}`}
                          onError={notify}
                        />
                      ) : (
                        chatBusy && (
                          <div className="thinking">
                            正在查找资料并组织回答…
                          </div>
                        )
                      )}
                      {answer && (
                        <div className="answer-actions">
                          <button onClick={() => setAnswerExpanded(true)}>
                            展开阅读
                          </button>
                          <button
                            disabled={chatBusy}
                            onClick={() => void copyAnswer()}
                          >
                            复制 Markdown
                          </button>
                          <button
                            disabled={chatBusy || !workspace}
                            onClick={() => prepareAnswerTransfer("save")}
                          >
                            保存为文档
                          </button>
                          <button
                            disabled={
                              chatBusy ||
                              !document ||
                              documentKind(document.path) !== "markdown"
                            }
                            onClick={() => prepareAnswerTransfer("insert")}
                          >
                            插入正文
                          </button>
                        </div>
                      )}
                      {answerChartWarnings.map((warning, i) => (
                        <div className="panel-warning" key={i}>
                          {warning}
                        </div>
                      ))}
                      {answerWarning && (
                        <div className="panel-warning">{answerWarning}</div>
                      )}
                      {answerSources.length > 0 && (
                        <>
                          <div className="results-label">
                            参考资料 · {answerSources.length}
                          </div>
                          <Sources
                            items={answerSources}
                            onOpen={(s) => void openPath(s.path, s)}
                          />
                        </>
                      )}
                    </>
                  ) : (
                    <div className="panel-empty">
                      <div className="orbit-icon">
                        <Sparkles size={26} strokeWidth={1.4} />
                        <span />
                        <i />
                      </div>
                      <h3>向自己的知识提问</h3>
                      <p>
                        让散落的片段形成回答，
                        <br />
                        每一处引用，都能回到原文。
                      </p>
                      {!settings?.chat.enabled && (
                        <button
                          className="button small"
                          disabled={!settings}
                          onClick={() => setSettingsOpen(true)}
                        >
                          连接问答模型
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <form
                  className="ask-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void ask();
                  }}
                >
                  <textarea
                    aria-label="向当前空间提问"
                    value={question}
                    maxLength={1500}
                    placeholder="向你的资料提问…"
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => {
                      if (
                        !isImeEvent(e.nativeEvent) &&
                        (e.metaKey || e.ctrlKey) &&
                        e.key === "Enter"
                      ) {
                        e.preventDefault();
                        void ask();
                      }
                    }}
                  />
                  <div>
                    <span>基于当前资料索引 · ⌘↵</span>
                    {chatBusy ? (
                      <button
                        type="button"
                        className="send-button"
                        title="停止生成"
                        aria-label="停止生成"
                        onClick={() => {
                          setChatStage("正在停止生成…");
                          void invoke("cancel_chat", {
                            requestId: requestRef.current,
                          }).catch(fail);
                        }}
                      >
                        <Square size={13} fill="currentColor" />
                      </button>
                    ) : (
                      <button
                        className="send-button"
                        title="发送问题"
                        aria-label="发送问题"
                        disabled={!workspace || !question.trim()}
                      >
                        <ArrowUp size={17} />
                      </button>
                    )}
                  </div>
                </form>
              </>
            )}
            <div className="panel-bottom">
              <span
                className={`status-dot ${stats.documents ? "online" : ""}`}
              />
              <span>
                {stats.documents
                  ? `${stats.documents} 篇文档 · ${stats.chunks} 个片段`
                  : "还没有加入资料索引的资料"}
              </span>
              <button
                title="管理资料索引"
                disabled={!workspace}
                aria-label="管理资料索引"
                onClick={() => setIndexOpen(true)}
              >
                <Database size={13} />
              </button>
            </div>
          </aside>
        )}
      </div>
      {toast && (
        <div className="toast">
          <Check size={15} />
          {toast}
        </div>
      )}
      {settingsOpen && settings && (
        <SettingsModal
          value={settings}
          onClose={() => setSettingsOpen(false)}
          onSave={(next) => {
            const indexSettingsChanged =
              JSON.stringify(settings.embedding) !==
              JSON.stringify(next.embedding);
            setSettings(next);
            setSettingsOpen(false);
            if (indexSettingsChanged) setIndexDirty(true);
            notify("模型设置已保存");
            if (workspace) void refreshStats();
          }}
        />
      )}
      {backupOpen && (
        <BackupDialog
          onClose={() => setBackupOpen(false)}
          onBusy={libraryProps.onMutationBusy}
          onPrepare={async () => {
            await saveInFlight.current;
            await persistDraft();
            return mayLeave();
          }}
        />
      )}
      {recoveryOpen && (
        <RecoveryDialog
          initial={recoveryReport}
          onClose={() => setRecoveryOpen(false)}
          onBusy={libraryProps.onMutationBusy}
          onReport={(report) => {
            setRecoveryReport(report);
            void refreshLibrary();
          }}
        />
      )}
      {indexOpen && (
        <ModalDialog
          label="资料索引管理"
          className="index-modal"
          busy={indexBusy}
          onClose={() => setIndexOpen(false)}
        >
          <div className="modal-heading">
            <div>
              <span className="eyebrow">YOUR LOCAL KNOWLEDGE</span>
              <h2>当前空间的资料索引</h2>
            </div>
            <button
              className="icon-button"
              aria-label="关闭资料索引管理"
              disabled={indexBusy}
              onClick={() => setIndexOpen(false)}
            >
              <X size={19} />
            </button>
          </div>
          <p className="muted">
            为本地文本与图表源码建立索引。当前空间默认跳过独立 JSON；仅选择当前
            JSON 文档时纳入，Markdown 内的代码块随文档处理。
          </p>
          <div className="stat-grid">
            <div>
              <strong>{stats.documents}</strong>
              <span>关键词已入库文档</span>
            </div>
            <div>
              <strong>{stats.chunks}</strong>
              <span>文本片段</span>
            </div>
            <div>
              <strong>{stats.vectors}</strong>
              <span>有效向量</span>
            </div>
          </div>
          <div className="index-state-detail">
            <p>
              <strong>关键词：</strong>
              {stats.documents ? `${stats.documents} 篇文档已入库` : "尚未建立"}
            </p>
            <p>
              <strong>向量：</strong>
              {!settings?.embedding.enabled
                ? "未启用"
                : `${stats.vectorDocuments ?? "—"} 篇文档具有当前模型向量 · ${stats.vectors} 个有效向量`}
            </p>
            <p>
              {indexDirty
                ? "本次会话有保存或来源更新，请更新索引。"
                : "统计来自索引；保存后的来源仍会进行版本校验。"}
            </p>
          </div>
          <IndexStatusPanel
            snapshot={indexSnapshot}
            loading={indexSnapshotLoading}
            error={indexSnapshotError}
            busy={indexBusy || busy}
            onRefresh={() => void refreshIndexSnapshot()}
            onUpdate={(path) => void runIndex(path)}
          />
          <label className="index-scope">
            建库范围
            <select
              disabled={indexBusy}
              value={indexScope}
              onChange={(e) => setIndexScope(e.target.value)}
            >
              <option value="">当前空间</option>
              {document && (
                <option value={document.path}>
                  当前文档 · {titleOf(document.path)}
                </option>
              )}
              {workspace?.files
                .filter((f) => f.directory)
                .map((f) => (
                  <option value={f.path} key={f.path}>
                    目录 · {f.name}
                  </option>
                ))}
            </select>
          </label>
          <div className="privacy-note">
            <ShieldCheck size={16} />
            <span>
              {settings?.embedding.enabled
                ? `文本切片将发送至 ${settings.embedding.baseUrl}。索引保存在本机；未变化文件自动跳过。`
                : "当前建立关键词索引，无需调用模型。配置向量化服务后，再更新即可加入语义检索。"}
            </span>
          </div>
          {indexBusy && (
            <div className="index-progress">
              <div>
                <LoaderCircle className="spin" size={15} />
                <span>
                  {indexProgress.path
                    ? titleOf(indexProgress.path)
                    : "扫描资料…"}
                </span>
                <strong>
                  {indexProgress.done}/{indexProgress.total}
                </strong>
              </div>
              <progress
                value={indexProgress.done}
                max={indexProgress.total || 1}
              />
            </div>
          )}
          {indexMessages.length > 0 && (
            <div className="index-log">
              {indexMessages.map((message, i) => (
                <p key={i}>{message}</p>
              ))}
            </div>
          )}
          <div className="modal-actions">
            <button
              className="button danger-ghost"
              disabled={busy || !stats.documents}
              onClick={async () => {
                if (
                  await confirm("清空当前空间的索引？原始文件会保留。", {
                    title: "清空索引",
                    kind: "warning",
                  })
                ) {
                  try {
                    await invoke("clear_index");
                    await refreshStats();
                    setIndexDirty(false);
                    setResults([]);
                    setSearched(false);
                    notify("索引已清空，原文件保留");
                  } catch (e) {
                    fail(e);
                  }
                }
              }}
            >
              <Trash2 size={14} />
              清空索引
            </button>
            <div />
            {indexBusy ? (
              <button
                className="button"
                onClick={() => {
                  indexCancelled.current = true;
                  void invoke("cancel_index");
                }}
              >
                <Square size={13} />
                停止建库
              </button>
            ) : (
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void runIndex()}
              >
                <RefreshCw size={15} />
                {stats.documents ? "更新索引" : "开始建库"}
              </button>
            )}
          </div>
        </ModalDialog>
      )}
      {answerExpanded && (
        <ModalDialog
          label="展开阅读回答"
          className="answer-reading-modal"
          onClose={() => setAnswerExpanded(false)}
        >
          <div className="modal-heading">
            <h2>{asked || "资料问答"}</h2>
            <button
              className="icon-button"
              aria-label="关闭展开阅读"
              onClick={() => setAnswerExpanded(false)}
            >
              <X size={19} />
            </button>
          </div>
          {answerSnapshot && (
            <p className="answer-context">
              {answerSnapshot.scopeLabel} · {answerExecution(answerSnapshot)}
            </p>
          )}
          <div className="answer-actions">
            <button disabled={chatBusy} onClick={() => void copyAnswer()}>
              复制 Markdown
            </button>
            <button
              disabled={chatBusy}
              onClick={() => prepareAnswerTransfer("save")}
            >
              保存为文档
            </button>
            <button
              disabled={
                chatBusy ||
                !document ||
                documentKind(document.path) !== "markdown"
              }
              onClick={() => prepareAnswerTransfer("insert")}
            >
              插入正文
            </button>
          </div>
          <Answer
            text={answer}
            sources={answerSources}
            pending={chatBusy || !answerComplete}
            rejectedCharts={rejectedCharts}
            viewKey={`answer:${answerSnapshot?.id}:expanded`}
            onError={notify}
            onOpen={(source) => {
              setAnswerExpanded(false);
              void openPath(source.path, source);
            }}
          />
          {answerWarning && <p className="panel-warning">{answerWarning}</p>}
          {answerChartWarnings.map((warning, i) => (
            <p className="panel-warning" key={i}>
              {warning}
            </p>
          ))}
        </ModalDialog>
      )}
      {answerTransfer && (
        <ModalDialog
          label={
            answerTransfer.kind === "save" ? "保存回答为文档" : "预览插入回答"
          }
          className="answer-reading-modal"
          busy={nameBusy}
          onClose={closeAnswerTransfer}
        >
          <div className="modal-heading">
            <h2>
              {answerTransfer.kind === "save" ? "保存回答为文档" : "插入正文"}
            </h2>
            <button
              className="icon-button"
              aria-label="关闭回答预览"
              disabled={nameBusy}
              onClick={closeAnswerTransfer}
            >
              <X size={19} />
            </button>
          </div>
          <p className="muted">
            {answerTransfer.kind === "save"
              ? `保存到 ${workspace?.name ?? "当前空间"}，包含原始 Markdown、结构数据与来源版本。`
              : `插入到 ${basename(answerTransfer.path ?? "")} 的原光标位置，可一次撤销。`}
          </p>
          {answerTransfer.kind === "save" && (
            <label className="answer-file-label">
              文件名
              <input
                aria-label="回答文档文件名"
                value={answerTitle}
                disabled={nameBusy || !!answerSavedPath}
                onChange={(event) => setAnswerTitle(event.target.value)}
              />
            </label>
          )}
          <details className="answer-source-preview">
            <summary>预览 Markdown 内容</summary>
            <pre>{answerTransfer.content}</pre>
          </details>
          <div className="answer-transfer-preview">
            <Markdown
              source={answerTransfer.content}
              path=""
              readOnly
              citations={answerSources}
              onCitation={() => {}}
              onError={setAnswerTransferError}
              label="回答转存预览"
            />
          </div>
          {answerTransferError && (
            <p className="preview-error" role="alert">
              {answerTransferError}
            </p>
          )}
          {answerSavedPath && (
            <p role="status">已保存：{basename(answerSavedPath)}</p>
          )}
          <div className="modal-actions">
            <button
              className="button"
              disabled={nameBusy}
              onClick={closeAnswerTransfer}
            >
              {answerSavedPath ? "完成" : "取消"}
            </button>
            {answerSavedPath ? (
              <button
                className="button primary"
                disabled={nameBusy}
                onClick={() => {
                  const path = answerSavedPath;
                  closeAnswerTransfer();
                  setAnswerExpanded(false);
                  void openPath(path);
                }}
              >
                打开新文档
              </button>
            ) : (
              <button
                className="button primary"
                disabled={nameBusy}
                onClick={() => void commitAnswerTransfer()}
              >
                {nameBusy
                  ? "正在保存…"
                  : answerTransfer.kind === "save"
                    ? "保存新文档"
                    : "确认插入"}
              </button>
            )}
          </div>
        </ModalDialog>
      )}
      {importOpen && (
        <ImportDialog
          view={libraryView}
          projectId={workspace?.managedProjectId ?? "inbox"}
          initialPaths={importPaths}
          task={importTask}
          onClose={() => setImportOpen(false)}
          onBusy={(next) => {
            importBusyRef.current = next;
            setImportBusy(next);
          }}
          onFinished={async () => {
            await refreshLibrary();
            await refreshFiles();
            await refreshIndexSnapshot();
          }}
          onOpen={(id) => {
            setImportOpen(false);
            void refreshLibrary().then(async () => {
              const v = await invoke("library_list");
              const d = v.documents.find((d) => d.id === id);
              if (d) await openLibraryDocument(d);
            });
          }}
        />
      )}
      {nameDialog && (
        <ModalDialog
          label="文件名称"
          className="name-modal"
          busy={nameBusy}
          onClose={closeNameDialog}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitName();
            }}
          >
            <div className="modal-heading">
              <h2>
                {nameDialog === "new"
                  ? "新建笔记"
                  : nameDialog === "copy"
                    ? "另存为新文件"
                    : "重命名文件"}
              </h2>
              <button
                type="button"
                className="icon-button"
                aria-label="取消文件操作"
                disabled={nameBusy}
                onClick={closeNameDialog}
              >
                <X size={18} />
              </button>
            </div>
            <label>
              文件名
              <input
                autoFocus
                disabled={nameBusy}
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                onFocus={(e) => e.target.select()}
                placeholder="我的笔记.md"
              />
            </label>
            <p className="muted">
              支持 .md、.markdown、.txt、.json 和
              .mmd；可填写已有子目录中的相对路径。
            </p>
            {nameError && (
              <div className="inline-message error">{nameError}</div>
            )}
            <div className="modal-actions">
              <div />
              <button
                type="button"
                className="button"
                disabled={nameBusy}
                onClick={closeNameDialog}
              >
                取消
              </button>
              <button className="button primary" disabled={nameBusy}>
                {nameBusy ? "正在保存…" : "确定"}
              </button>
            </div>
          </form>
        </ModalDialog>
      )}
    </div>
  );
}
