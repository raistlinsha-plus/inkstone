import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Paperclip, Plus, X } from "lucide-react";
import type { LibraryDocument, LibraryView } from "../library";
import type { AssistantAttachment, AssistantSourcePlan } from "./types";

export default function QuestionSources({
  view,
  currentDocument,
  conversationId,
  disabled,
  selected,
  onChange,
  ensureConversation,
  onBusy,
}: {
  view: LibraryView;
  currentDocument?: LibraryDocument;
  conversationId?: string;
  disabled: boolean;
  selected: AssistantSourcePlan;
  onChange: (value: AssistantSourcePlan) => void;
  ensureConversation: () => Promise<string>;
  onBusy: (busy: boolean) => void;
}) {
  const [files, setFiles] = useState<AssistantAttachment[]>([]);
  const [revision, refresh] = useState(0);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const project = view.projects.find((item) => item.id === selected.projectId);
  const documentIds = selected.documentIds ?? [];
  const attachedIds = selected.attachments ?? [];
  const docs = view.documents.filter(
    (doc) => doc.projectId === project?.id && doc.status === "ready",
  );

  useEffect(() => {
    let active = true;
    if (!conversationId) {
      setFiles([]);
      return;
    }
    void invoke<AssistantAttachment[]>("assistant_attachment_list", {
      conversationId,
    }).then(
      (next) => {
        if (active) setFiles(Array.isArray(next) ? next : []);
      },
      (reason) => {
        if (active) setError(String(reason));
      },
    );
    return () => {
      active = false;
    };
  }, [conversationId, revision]);

  async function attach() {
    setWorking(true);
    onBusy(true);
    setError("");
    try {
      if (files.length >= 12 || attachedIds.length >= 5)
        throw Error("本轮最多 5 个附件，会话最多保留 12 个。");
      const path = await open({
        multiple: false,
        directory: false,
        filters: [
          {
            name: "文本文件",
            extensions: ["md", "markdown", "txt", "json", "mmd"],
          },
        ],
      });
      if (typeof path !== "string") return;
      const id = conversationId ?? (await ensureConversation());
      const file = await invoke<AssistantAttachment>(
        "assistant_attachment_add",
        { conversationId: id, path },
      );
      if (!file?.id) throw Error("附件未保存");
      setFiles((old) => [...old.filter((item) => item.id !== file.id), file]);
      onChange({
        ...selected,
        attachments: [...new Set([...attachedIds, file.id])],
      });
      refresh((n) => n + 1);
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking(false);
      onBusy(false);
    }
  }

  async function remove(file: AssistantAttachment) {
    if (!conversationId) return;
    setWorking(true);
    onBusy(true);
    setError("");
    try {
      await invoke("assistant_attachment_delete", {
        conversationId,
        attachmentId: file.id,
      });
      setFiles((old) => old.filter((item) => item.id !== file.id));
      onChange({
        ...selected,
        attachments: attachedIds.filter((id) => id !== file.id),
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking(false);
      onBusy(false);
    }
  }

  const changeAttachments = (id: string) =>
    onChange({
      ...selected,
      attachments: attachedIds.includes(id)
        ? attachedIds.filter((item) => item !== id)
        : [...attachedIds, id],
    });

  return (
    <section className="question-sources" aria-label="本轮资料">
      <div className="question-source-chips">
        <button
          type="button"
          aria-expanded={adding}
          onClick={() => setAdding(!adding)}
          disabled={disabled || working}
        >
          <Plus size={14} />
          添加资料
        </button>
        {project && (
          <button
            type="button"
            className="question-source-chip"
            disabled={disabled || working}
            onClick={() =>
              onChange({ ...selected, projectId: null, documentIds: [] })
            }
          >
            {project.title}
            {documentIds.length ? ` · ${documentIds.length} 篇` : " · 整个空间"}
            <X size={12} />
          </button>
        )}
        {files
          .filter((file) => attachedIds.includes(file.id))
          .map((file) => (
            <button
              key={file.id}
              type="button"
              className="question-source-chip"
              disabled={disabled || working}
              onClick={() => changeAttachments(file.id)}
              aria-label={`移除本轮附件 ${file.title}`}
            >
              <Paperclip size={13} />
              {file.title}
              <X size={12} />
            </button>
          ))}
      </div>
      {adding && (
        <div className="question-source-picker">
          <button
            type="button"
            disabled={disabled || working}
            onClick={() => void attach()}
          >
            附加临时文件
          </button>
          {currentDocument && (
            <button
              type="button"
              disabled={disabled || working}
              onClick={() =>
                onChange({
                  ...selected,
                  projectId: currentDocument.projectId,
                  documentIds: [currentDocument.id],
                })
              }
            >
              添加当前文档
            </button>
          )}
          {!!view.projects.length && (
            <label>
              知识空间
              <select
                value={selected.projectId ?? ""}
                disabled={disabled || working}
                onChange={(e) => {
                  onChange({
                    ...selected,
                    projectId: e.target.value || null,
                    documentIds: [],
                  });
                }}
              >
                <option value="">不选择知识空间</option>
                {view.projects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          {project && !!docs.length && (
            <div className="question-source-documents">
              <small>
                可使用整个已选空间，或指定最多 5
                篇文档。取消最后一篇会移除该空间。
              </small>
              {docs.map((doc) => (
                <label key={doc.id}>
                  <input
                    type="checkbox"
                    checked={documentIds.includes(doc.id)}
                    disabled={
                      disabled ||
                      working ||
                      (documentIds.length >= 5 && !documentIds.includes(doc.id))
                    }
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...documentIds, doc.id]
                        : documentIds.filter((id) => id !== doc.id);
                      onChange({
                        ...selected,
                        projectId: next.length ? project.id : null,
                        documentIds: next,
                      });
                    }}
                  />
                  {doc.title}
                </label>
              ))}
            </div>
          )}
          {!!files.length && (
            <div className="question-source-documents">
              {files.map((file) => (
                <div className="question-source-attachment" key={file.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={attachedIds.includes(file.id)}
                      disabled={
                        disabled ||
                        working ||
                        (attachedIds.length >= 5 &&
                          !attachedIds.includes(file.id))
                      }
                      onChange={() => changeAttachments(file.id)}
                    />
                    {file.title}
                  </label>
                  <button
                    type="button"
                    disabled={disabled || working}
                    onClick={() => void remove(file)}
                  >
                    删除附件
                  </button>
                </div>
              ))}
            </div>
          )}
          <small>
            所选本地资料可能发送给配置的聊天模型。联网搜索只发送通过校验的公开查询。
          </small>
        </div>
      )}
      {working && <p role="status">正在处理附件…</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
