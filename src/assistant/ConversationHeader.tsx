import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Expand,
  Minimize2,
  MessageSquarePlus,
  History,
  MoreHorizontal,
  X,
} from "lucide-react";
import ModalDialog from "../ModalDialog";
import type { Conversation } from "./types";
import type { AssistantController } from "./useAssistant";
export function ConversationHeader({
  controller,
  disabled,
  expanded,
  onExpand,
  onNew,
  onActivate,
  onError,
}: {
  controller: AssistantController;
  disabled: boolean;
  expanded: boolean;
  onExpand: () => void;
  onNew: () => void;
  onActivate: (c: Conversation) => void;
  onError: (e: unknown) => void;
}) {
  const [dialog, setDialog] = useState<
      "history" | "rename" | "delete" | "export" | null
    >(null),
    [filter, setFilter] = useState(""),
    [archived, setArchived] = useState(false),
    [title, setTitle] = useState(""),
    [exportText, setExportText] = useState(""),
    [working, setWorking] = useState(false);
  const [exportJson, setExportJson] = useState("");
  const c = controller.conversation;
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
  return (
    <>
      <div className="assistant-toolbar">
        <div className="assistant-conversation-title">
          <strong>{c?.title || "新会话"}</strong>
          <small>
            {c
              ? `${c.scopeLabel}${c.archived ? " · 已归档" : ""}`
              : "发送问题后建立独立会话"}
          </small>
        </div>
        <div className="assistant-toolbar-actions">
          <button
            disabled={disabled}
            onClick={() => {
              setDialog("history");
              void controller.list().catch(onError);
            }}
            title="会话历史"
          >
            <History size={15} />
            会话
          </button>
          <button disabled={disabled} onClick={onNew}>
            <MessageSquarePlus size={15} />
            新建
          </button>
          <button onClick={onExpand} aria-pressed={expanded}>
            {expanded ? <Minimize2 size={15} /> : <Expand size={15} />}
            <span>{expanded ? "返回编辑" : "展开问答"}</span>
          </button>
          {c && (
            <details className="assistant-manage">
              <summary aria-label="管理当前会话">
                <MoreHorizontal size={16} />
              </summary>
              <div>
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
                        json: string;
                      }>("assistant_export", { conversationId: c.id });
                      setExportText(data.markdown);
                      setExportJson(data.json);
                      setDialog("export");
                    })
                  }
                >
                  导出会话
                </button>
                <button disabled={disabled} onClick={() => setDialog("delete")}>
                  删除会话…
                </button>
              </div>
            </details>
          )}
        </div>
      </div>
      {controller.error && (
        <div className="panel-warning" role="alert">
          {controller.error}
        </div>
      )}
      {dialog && (
        <ModalDialog
          label={
            dialog === "history"
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
              {dialog === "history"
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
                {controller.summaries
                  .filter(
                    (row) =>
                      (archived || !row.archived) &&
                      row.title.toLowerCase().includes(filter.toLowerCase()),
                  )
                  .map((row) => (
                    <button
                      key={row.id}
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
                  ))}
                {!controller.summaries.some(
                  (row) =>
                    (archived || !row.archived) &&
                    row.title.toLowerCase().includes(filter.toLowerCase()),
                ) && <p className="muted">本空间暂无匹配会话。</p>}
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
                  maxLength={100}
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
