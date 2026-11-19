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
  const moreActions = useRef<HTMLDetailsElement>(null);
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
  const headerTitle =
    !controller.general && c?.title === autoTitle
      ? "当前会话"
      : c?.title || "新会话";
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
      aria-label={expanded ? "返回编辑" : "展开问答"}
      title={expanded ? "返回编辑" : "展开问答"}
    >
      {expanded ? <Minimize2 size={15} /> : <Expand size={15} />}
      <span>{expanded ? "返回编辑" : "展开问答"}</span>
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
            <strong title={c?.title}>{headerTitle}</strong>
            {(controller.general || c?.archived) && (
              <small>
                {controller.general
                  ? c?.archived
                    ? "通用问答 · 已归档"
                    : "通用问答 · 每轮可添加资料"
                  : "已归档"}
              </small>
            )}
          </div>
        )}
        <div className="assistant-toolbar-actions">
          <button
            disabled={disabled}
            onClick={() => {
              setDialog("history");
            }}
            title="会话历史"
            aria-label={dock ? "会话历史" : "会话"}
          >
            <History size={15} />
            <span>会话</span>
          </button>
          {showNew && (
            <button
              disabled={disabled}
              onClick={onNew}
              aria-label={dock ? "新建会话" : "新建"}
              title="新建会话"
            >
              <MessageSquarePlus size={15} />
              <span>新建</span>
            </button>
          )}
          {(!dock || expanded) && expandAction}
          {!dock && onPreferences && (
            <button
              disabled={disabled}
              onClick={onPreferences}
              title="回答偏好"
              aria-label="回答偏好"
            >
              <SlidersHorizontal size={15} />
              <span>回答偏好</span>
            </button>
          )}
          {(c || dock) && (
            <details
              ref={moreActions}
              className="assistant-manage"
              onKeyDown={(event) => {
                if (event.key !== "Escape" || !event.currentTarget.open) return;
                event.stopPropagation();
                event.currentTarget.open = false;
                event.currentTarget.querySelector("summary")?.focus();
              }}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget))
                  event.currentTarget.open = false;
              }}
            >
              <summary
                aria-label={dock ? "更多会话操作" : "管理当前会话"}
                title={dock ? "更多会话操作" : "管理当前会话"}
              >
                <MoreHorizontal size={16} />
              </summary>
              <div
                onClick={(event) => {
                  if (
                    !(event.target as Element).closest("button") ||
                    !moreActions.current
                  )
                    return;
                  moreActions.current.open = false;
                  moreActions.current.querySelector("summary")?.focus();
                }}
              >
                {dock && !expanded && expandAction}
                {dock?.onGeneral && (
                  <button
                    disabled={!dock.canOpenGeneral}
                    onClick={dock.onGeneral}
                  >
                    <ArrowUpRight size={15} /> 通用问答
                  </button>
                )}
                {dock && onPreferences && (
                  <button disabled={disabled} onClick={onPreferences}>
                    <SlidersHorizontal size={15} /> 回答偏好
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
                      重命名会话
                    </button>
                    <button
                      disabled={disabled}
                      onClick={() =>
                        void run(async () => {
                          await controller.update({ archived: !c.archived });
                        })
                      }
                    >
                      {c.archived ? "取消归档" : "归档会话"}
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
                      导出会话
                    </button>
                    <button
                      disabled={disabled}
                      onClick={() => setDialog("delete")}
                    >
                      删除会话…
                    </button>
                  </>
                )}
              </div>
            </details>
          )}
          {dock && (
            <button
              type="button"
              aria-label="收起知识侧栏"
              title="收起知识侧栏"
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
          {c?.archived && <span>已归档</span>}
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
              重试保存草稿
            </button>
          )}
        </div>
      )}
      {dialog && (
        <ModalDialog
          label={
            dialog === "background"
              ? "选择历史背景"
              : dialog === "history"
                ? "问答会话"
                : dialog === "rename"
                  ? "重命名会话"
                  : dialog === "delete"
                    ? "删除问答会话"
                    : "导出问答会话"
          }
          className="assistant-history-dialog"
          busy={working}
          onClose={() => setDialog(null)}
        >
          <div className="modal-heading">
            <h2>
              {dialog === "background"
                ? "选择历史背景"
                : dialog === "history"
                  ? "问答会话"
                  : dialog === "rename"
                    ? "重命名会话"
                    : dialog === "delete"
                      ? "删除这段会话？"
                      : "导出会话 Markdown"}
            </h2>
            <button
              aria-label="关闭会话管理"
              onClick={() => setDialog(null)}
              disabled={working}
            >
              <X size={18} />
            </button>
          </div>
          {dialog === "history" && (
            <>
              <label>
                查找会话
                <input
                  autoFocus
                  maxLength={200}
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="搜索本空间会话标题…"
                />
              </label>
              <label className="assistant-archive-toggle">
                <input
                  type="checkbox"
                  checked={archived}
                  onChange={(e) => setArchived(e.target.checked)}
                />
                显示已归档会话
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
                        {row.scopeLabel} · {row.turnCount}轮
                        {row.archived ? " · 已归档" : ""}
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
                          选作背景
                        </button>
                      )}
                  </div>
                ))}
                {!searching && !searchError && !rows.length && (
                  <p className="muted">
                    {controller.general
                      ? "暂无匹配的通用会话。"
                      : "本空间暂无匹配会话。"}
                  </p>
                )}
              </div>
              {searchError && <p role="alert">{searchError}</p>}
              <p className="muted" role="status">
                {searching
                  ? "正在查找…"
                  : `已显示${rows.length}条${hasMore ? "，还有更多会话" : "，已显示全部匹配会话"}`}
              </p>
              {(hasMore || searchError) && (
                <button disabled={searching} onClick={() => void loadMore()}>
                  {searchError ? "重试查找" : "加载更多会话"}
                </button>
              )}
            </>
          )}
          {dialog === "background" && background && (
            <>
              <p>{background.title} · 当前分支</p>
              <label>
                选择一个历史问题
                <select
                  disabled={working}
                  value={preview?.reference.turnId ?? ""}
                  onChange={(event) => void previewQuestion(event.target.value)}
                >
                  <option value="" disabled>
                    请选择
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
                    {new Date(preview.createdAt).toLocaleString()} · 最多 400 字
                  </p>
                  <blockquote>{preview.excerpt}</blockquote>
                </>
              )}
              <p className="muted">
                确认后，预览片段会随下一次问答发给聊天模型，作为理解问题的背景。检索仍使用你当前输入的问题。
              </p>
              <div className="modal-actions">
                <button disabled={working} onClick={() => setDialog("history")}>
                  返回会话
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
                  加入本轮
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
                会话标题
                <input
                  autoFocus
                  maxLength={80}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <div className="modal-actions">
                <button className="primary" disabled={working || !title.trim()}>
                  保存标题
                </button>
              </div>
            </form>
          )}
          {dialog === "delete" && (
            <>
              <p>
                将删除此会话、问题、回答候选、来源快照和草稿。工作文档与角色进度保留。你自行保存的导出文件或旧备份仍可能含有历史内容。
              </p>
              <div className="modal-actions">
                <button disabled={working} onClick={() => setDialog(null)}>
                  保留会话
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
                  删除此会话
                </button>
              </div>
            </>
          )}
          {dialog === "export" && (
            <>
              <label>
                导出范围
                <select
                  aria-label="会话导出范围"
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
                  <option value="current">当前分支与选中回答</option>
                  <option value="all">全部分支与全部候选</option>
                </select>
              </label>
              <p className="muted">
                Markdown按所选范围导出；JSON包含完整会话、全部分支与来源快照。
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
                  复制 Markdown
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
                  下载 Markdown
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
                  下载 JSON
                </button>
              </div>
            </>
          )}
        </ModalDialog>
      )}
    </>
  );
}
