import { msg } from "../i18n";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Expand,
  Minimize2,
  MessageSquarePlus,
  History,
  MoreHorizontal,
  PanelRightClose,
  ArrowUpRight,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { isImeEvent } from "../platform/ime";
import { dismissDetailsOnOutside, focusMenuButton } from "../platform/menu";
import ModalDialog from "../ModalDialog";
import {
  branchTurns,
  type Conversation,
  type ConversationSummary,
  type HistoryPreview,
} from "./types";
import type { AssistantController } from "./useAssistant";
export function ConversationHeader({
  controller,
  disabled,
  expanded,
  onExpand,
  onNew,
  onActivate,
  onError,
  onUseHistory,
  onPreferences,
  showNew = true,
  scope = null,
  dock,
}: {
  dock?: {
    modes: ReactNode;
    onClose: () => void;
    onGeneral?: () => void;
    canOpenGeneral: boolean;
  };
  controller: AssistantController;
  disabled: boolean;
  expanded: boolean;
  onExpand: () => void;
  onNew: () => void;
  onActivate: (c: Conversation) => void;
  onError: (e: unknown) => void;
  onPreferences?: () => void;
  showNew?: boolean;
  onUseHistory?: (preview: HistoryPreview) => void;
  scope?: string | null;
}) {
  const [dialog, setDialog] = useState<
      "history" | "background" | "rename" | "delete" | "export" | null
    >(null),
    [filter, setFilter] = useState(""),
    [archived, setArchived] = useState(false),
    [title, setTitle] = useState(""),
    [exportText, setExportText] = useState(""),
    [working, setWorking] = useState(false);
  const [background, setBackground] = useState<Conversation>();
  const [preview, setPreview] = useState<HistoryPreview>();
  const [previewError, setPreviewError] = useState("");
  const [exportJson, setExportJson] = useState("");
  const [exportData, setExportData] = useState({ current: "", all: "" });
  const [exportScope, setExportScope] = useState("current");
  const [rows, setRows] = useState<ConversationSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [searchError, setSearchError] = useState("");
  const searchSequence = useRef(0);
  useEffect(() => {
    const sequence = ++searchSequence.current;
    if (dialog !== "history") return;
    setSearching(true);
    setRows([]);
    setSearchError("");
    const timer = setTimeout(() => {
      void controller
        .search(archived, filter, 0)
        .then((next) => {
          if (sequence !== searchSequence.current) return;
          setRows(next);
          setHasMore(next.length === 200);
        })
        .catch((e) => {
          if (sequence === searchSequence.current) setSearchError(String(e));
        })
        .finally(() => {
          if (sequence === searchSequence.current) setSearching(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      ++searchSequence.current;
    };
  }, [dialog, filter, archived, controller.search, controller.workspaceKey]);
  async function loadMore() {
    const sequence = searchSequence.current;
    setSearching(true);
    setSearchError("");
    try {
      const next = await controller.search(archived, filter, rows.length);
      if (sequence !== searchSequence.current) return;
      setRows((old) => [
        ...old,
        ...next.filter((r) => !old.some((x) => x.id === r.id)),
      ]);
      setHasMore(next.length === 200);
    } catch (e) {
      if (sequence === searchSequence.current) setSearchError(String(e));
    } finally {
      if (sequence === searchSequence.current) setSearching(false);
    }
  }
  const c = controller.conversation;
  const firstQuestion = c?.turns?.[0]?.question ?? "";
  const autoTitle = Array.from(firstQuestion).slice(0, 32).join("");
  const namedTitle =
    c?.title && c.title !== autoTitle && c.title !== "新会话" ? c.title : "";
  const conversationTitle = c?.title === "新会话" && !c.turns?.length ? msg("新会话") : c?.title;
  let headerTitle = conversationTitle || msg("新会话");
  if (firstQuestion && c?.title === autoTitle) {
    headerTitle = controller.general ? firstQuestion : msg("当前会话");
  }
  useEffect(() => {
    setBackground(undefined);
    setPreview(undefined);
    setDialog(null);
  }, [controller.workspaceKey]);
  async function previewQuestion(turnId: string) {
    if (!background) return;
    setPreview(undefined);
    setPreviewError("");
    setWorking(true);
    try {
      setPreview(
        await invoke<HistoryPreview>("assistant_history_preview", {
          workspaceRoot: controller.workspaceKey,
          scope,
          reference: { conversationId: background.id, turnId, digest: "" },
        }),
      );
    } catch (error) {
      setPreviewError(String(error));
    } finally {
      setWorking(false);
    }
  }
  async function run(fn: () => Promise<void>) {
    setWorking(true);
    try {
      await fn();
    } catch (e) {
      onError(e);
    } finally {
      setWorking(false);
    }
  }
  const expandAction = (
    <button
      onClick={onExpand}
      aria-pressed={expanded}
      aria-label={expanded ? msg("返回编辑") : msg("展开问答")}
      title={expanded ? msg("返回编辑") : msg("展开问答")}
    >
      {expanded ? <Minimize2 size={15} /> : <Expand size={15} />}
      <span>{expanded ? msg("返回编辑") : msg("展开问答")}</span>
    </button>
  );
  return (
    <>
      <div
        className={
          dock ? "panel-tabs contextual-ask-header" : "assistant-toolbar"
        }
      >
        {dock ? (
          dock.modes
        ) : (
          <div className="assistant-conversation-title">
            <strong title={headerTitle}>{headerTitle}</strong>
            {c?.archived && <small>{msg("已归档")}</small>}
          </div>
        )}
        <div className="assistant-toolbar-actions">
          <button
            disabled={disabled}
            onClick={() => {
              setDialog("history");
            }}
            title={msg("会话历史")}
            aria-label={dock ? msg("会话历史") : msg("会话")}
          >
            <History size={15} />
            <span>{msg("会话")}</span>
          </button>
          {showNew && (
            <button
              disabled={disabled}
              onClick={onNew}
              aria-label={dock ? msg("新建会话") : msg("新建")}
              title={msg("新建会话")}
            >
              <MessageSquarePlus size={15} />
              <span>{msg("新建")}</span>
            </button>
          )}
          {(!dock || expanded) && expandAction}
          {!dock && onPreferences && (
            <button
              disabled={disabled}
              onClick={onPreferences}
              title={msg("回答偏好")}
              aria-label={msg("回答偏好")}
            >
              <SlidersHorizontal size={15} />
              <span>{msg("回答偏好")}</span>
            </button>
          )}
          {(c || dock) && (
            <details
              ref={dismissDetailsOnOutside}
              className="assistant-manage"
              onKeyDown={(event) => {
                if (isImeEvent(event.nativeEvent)) return;
                const details = event.currentTarget;
                const summary = details.querySelector("summary");
                const fromTrigger = event.target === summary;
                const openWithKeyboard = fromTrigger && !details.open &&
                  ["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key);
                if (openWithKeyboard || (details.open && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))) {
                  event.preventDefault();
                  event.stopPropagation();
                  details.open = true;
                  focusMenuButton(details, event.key);
                } else if (details.open && ["Escape", "Tab"].includes(event.key)) {
                  if (event.key === "Escape") event.preventDefault();
                  event.stopPropagation();
                  details.open = false;
                  summary?.focus({ preventScroll: true });
                }
              }}
            >
              <summary
                aria-label={dock ? msg("更多会话操作") : msg("管理当前会话")}
                title={dock ? msg("更多会话操作") : msg("管理当前会话")}
                onClick={(e) => e.currentTarget.focus({ preventScroll: true })}
              >
                <MoreHorizontal size={16} />
              </summary>
              <div
                onClick={(event) => {
                  const details = event.currentTarget.closest("details");
                  if (!details || !(event.target as Element).closest("button")) return;
                  details.open = false;
                  details.querySelector("summary")?.focus();
                }}
              >
                {dock && !expanded && expandAction}
                {dock?.onGeneral && (
                  <button
                    disabled={!dock.canOpenGeneral}
                    onClick={dock.onGeneral}
                  >
                    <ArrowUpRight size={15} /> {msg("通用问答")}
                  </button>
                )}
                {dock && onPreferences && (
                  <button disabled={disabled} onClick={onPreferences}>
                    <SlidersHorizontal size={15} /> {msg("回答偏好")}
                  </button>
                )}
                {c && (
                  <>
                    <button
                      disabled={disabled}
                      onClick={() => {
                        setTitle(c.title);
                        setDialog("rename");
                      }}
                    >
                      {msg("重命名会话")}
                    </button>
                    <button
                      disabled={disabled}
                      onClick={() =>
                        void run(async () => {
                          await controller.update({ archived: !c.archived });
                        })
                      }
                    >
                      {c.archived ? msg("取消归档") : msg("归档会话")}
                    </button>
                    <button
                      disabled={disabled}
                      onClick={() =>
                        void run(async () => {
                          const data = await invoke<{
                            markdown: string;
                            allMarkdown: string;
                            json: string;
                          }>("assistant_export", {
                            conversationId: c.id,
                            ...(controller.general ? { general: true } : {}),
                          });
                          setExportText(data.markdown);
                          setExportData({
                            current: data.markdown,
                            all: data.allMarkdown,
                          });
                          setExportScope("current");
                          setExportJson(data.json);
                          setDialog("export");
                        })
                      }
                    >
                      {msg("导出会话")}
                    </button>
                    <button
                      disabled={disabled}
                      onClick={() => setDialog("delete")}
                    >
                      {msg("删除会话…")}
                    </button>
                  </>
                )}
              </div>
            </details>
          )}
          {dock && (
            <button
              type="button"
              aria-label={msg("收起知识侧栏")}
              title={msg("收起知识侧栏")}
              onClick={dock.onClose}
            >
              <PanelRightClose size={15} />
            </button>
          )}
        </div>
      </div>
      {dock && (namedTitle || c?.archived) && (
        <div className="contextual-thread-title">
          {namedTitle && <strong title={namedTitle}>{namedTitle}</strong>}
          {c?.archived && <span>{msg("已归档")}</span>}
        </div>
      )}
      {controller.error && (
        <div className="panel-warning" role="alert">
          {controller.error}
          {controller.draftFailed && (
            <button
              disabled={disabled || working}
              onClick={() => void run(() => controller.flushDraft())}
            >
              {msg("重试保存草稿")}
            </button>
          )}
        </div>
      )}
      {dialog && (
        <ModalDialog
          label={
            dialog === "background"
              ? msg("选择历史背景")
              : dialog === "history"
                ? msg("问答会话")
                : dialog === "rename"
                  ? msg("重命名会话")
                  : dialog === "delete"
                    ? msg("删除问答会话")
                    : msg("导出问答会话")
          }
          className="assistant-history-dialog"
          busy={working}
          dismissOnBackdrop={dialog !== "rename" || title === c?.title}
          onClose={() => setDialog(null)}
        >
          <div className="modal-heading">
            <h2>
              {dialog === "background"
                ? msg("选择历史背景")
                : dialog === "history"
                  ? msg("问答会话")
                  : dialog === "rename"
                    ? msg("重命名会话")
                    : dialog === "delete"
                      ? msg("删除这段会话？")
                      : msg("导出会话 Markdown")}
            </h2>
            <button
              aria-label={msg("关闭会话管理")}
              onClick={() => setDialog(null)}
              disabled={working}
            >
              <X size={18} />
            </button>
          </div>
          {dialog === "history" && (
            <>
              <label>
                {msg("查找会话")}
                <input
                  autoFocus
                  maxLength={200}
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder={msg("搜索本空间会话标题…")}
                />
              </label>
              <label className="assistant-archive-toggle">
                <input
                  type="checkbox"
                  checked={archived}
                  onChange={(e) => setArchived(e.target.checked)}
                />
                {msg("显示已归档会话")}
              </label>
              <div className="assistant-history-list">
                {rows.map((row) => (
                  <div className="assistant-history-row" key={row.id}>
                    <button
                      disabled={working}
                      aria-current={c?.id === row.id ? "true" : undefined}
                      onClick={() =>
                        void run(async () => {
                          await controller.flushDraft();
                          const next = await controller.load(row.id);
                          if (next) {
                            onActivate(next);
                            setDialog(null);
                          }
                        })
                      }
                    >
                      <strong>{row.title}</strong>
                      <small>
                        {row.scopeLabel} · {row.turnCount}{msg("轮")}
                        {row.archived ? msg(" · 已归档") : ""}
                      </small>
                    </button>
                    {onUseHistory &&
                      !row.archived &&
                      row.turnCount > 0 &&
                      (!scope || row.scope === scope) && (
                        <button
                          className="text-button"
                          disabled={working}
                          onClick={() =>
                            void run(async () => {
                              setBackground(
                                await invoke<Conversation>("assistant_get", {
                                  conversationId: row.id,
                                }),
                              );
                              setPreview(undefined);
                              setPreviewError("");
                              setDialog("background");
                            })
                          }
                        >
                          {msg("选作背景")}
                        </button>
                      )}
                  </div>
                ))}
                {!searching && !searchError && !rows.length && (
                  <p className="muted">
                    {controller.general
                      ? msg("暂无匹配的通用会话。")
                      : msg("本空间暂无匹配会话。")}
                  </p>
                )}
              </div>
              {searchError && <p role="alert">{searchError}</p>}
              <p className="muted" role="status">
                {searching
                  ? msg("正在查找…")
                  : `已显示${rows.length}条${hasMore ? "，还有更多会话" : "，已显示全部匹配会话"}`}
              </p>
              {(hasMore || searchError) && (
                <button disabled={searching} onClick={() => void loadMore()}>
                  {searchError ? msg("重试查找") : msg("加载更多会话")}
                </button>
              )}
            </>
          )}
          {dialog === "background" && background && (
            <>
              <p>{background.title} {msg("· 当前分支")}</p>
              <label>
                {msg("选择一个历史问题")}
                <select
                  disabled={working}
                  value={preview?.reference.turnId ?? ""}
                  onChange={(event) => void previewQuestion(event.target.value)}
                >
                  <option value="" disabled>
                    {msg("请选择")}
                  </option>
                  {branchTurns(background)
                    .slice(-200)
                    .map((turn) => (
                      <option key={turn.id} value={turn.id}>
                        {turn.question.slice(0, 100)}
                      </option>
                    ))}
                </select>
              </label>
              {previewError && <p role="alert">{previewError}</p>}
              {preview && (
                <>
                  <p className="muted">
                    {new Date(preview.createdAt).toLocaleString()} {msg("· 最多 400 字")}
                  </p>
                  <blockquote>{preview.excerpt}</blockquote>
                </>
              )}
              <p className="muted">
                {msg("确认后，预览片段会随下一次问答发给聊天模型，作为理解问题的背景。检索仍使用你当前输入的问题。")}
              </p>
              <div className="modal-actions">
                <button disabled={working} onClick={() => setDialog("history")}>
                  {msg("返回会话")}
                </button>
                <button
                  className="primary"
                  disabled={working || !preview}
                  onClick={() => {
                    if (!preview) return;
                    onUseHistory?.(preview);
                    setDialog(null);
                  }}
                >
                  {msg("加入本轮")}
                </button>
              </div>
            </>
          )}
          {dialog === "rename" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await controller.update({ title: title.trim() });
                  setDialog(null);
                });
              }}
            >
              <label>
                {msg("会话标题")}
                <input
                  autoFocus
                  maxLength={80}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <div className="modal-actions">
                <button className="primary" disabled={working || !title.trim()}>
                  {msg("保存标题")}
                </button>
              </div>
            </form>
          )}
          {dialog === "delete" && (
            <>
              <p>
                {msg("将删除此会话、问题、回答候选、来源快照和草稿。工作文档与角色进度保留。你自行保存的导出文件或旧备份仍可能含有历史内容。")}
              </p>
              <div className="modal-actions">
                <button disabled={working} onClick={() => setDialog(null)}>
                  {msg("保留会话")}
                </button>
                <button
                  className="danger"
                  disabled={working}
                  onClick={() =>
                    void run(async () => {
                      await controller.remove();
                      onNew();
                      setDialog(null);
                    })
                  }
                >
                  {msg("删除此会话")}
                </button>
              </div>
            </>
          )}
          {dialog === "export" && (
            <>
              <label>
                {msg("导出范围")}
                <select
                  aria-label={msg("会话导出范围")}
                  value={exportScope}
                  onChange={(e) => {
                    setExportScope(e.target.value);
                    setExportText(
                      e.target.value === "all"
                        ? exportData.all
                        : exportData.current,
                    );
                  }}
                >
                  <option value="current">{msg("当前分支与选中回答")}</option>
                  <option value="all">{msg("全部分支与全部候选")}</option>
                </select>
              </label>
              <p className="muted">
                {msg("Markdown按所选范围导出；JSON包含完整会话、全部分支与来源快照。")}
              </p>
              <label>
                Markdown
                <textarea
                  className="assistant-export"
                  readOnly
                  value={exportText}
                  rows={12}
                />
              </label>
              <div className="modal-actions">
                <button
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(exportText)
                      .catch(onError)
                  }
                >
                  {msg("复制 Markdown")}
                </button>
                <button
                  onClick={() => {
                    const blob = new Blob([exportText], {
                        type: "text/markdown;charset=utf-8",
                      }),
                      url = URL.createObjectURL(blob),
                      a = document.createElement("a");
                    a.href = url;
                    a.download = `${c?.title || "问答会话"}.md`;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  }}
                >
                  {msg("下载 Markdown")}
                </button>
                <button
                  onClick={() => {
                    const blob = new Blob([exportJson], {
                        type: "application/json;charset=utf-8",
                      }),
                      url = URL.createObjectURL(blob),
                      a = document.createElement("a");
                    a.href = url;
                    a.download = "Inkstone-问答会话.json";
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  }}
                >
                  {msg("下载 JSON")}
                </button>
              </div>
            </>
          )}
        </ModalDialog>
      )}
    </>
  );
}
