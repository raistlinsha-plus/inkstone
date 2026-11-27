import { msg, translate } from "../i18n";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { createPortal } from "react-dom";
import { ChatImagePicker } from "./ChatImagePicker";
import { imageName, label as mediaLabel } from "../library/mediaTypes";
import { ImagePlus, Paperclip, Plus, X } from "lucide-react";
import type { LibraryDocument, LibraryView } from "../library";
import { isImeEvent } from "../platform/ime";
import { dismissOnOutside } from "../platform/menu";
import type { AssistantAttachment, AssistantSourcePlan } from "./types";

export default function QuestionSources({
  view,
  currentDocument,
  currentProjectId,
  conversationId,
  disabled,
  selected,
  onChange,
  ensureConversation,
  onBusy,
  controls,
}: {
  view: LibraryView;
  currentDocument?: LibraryDocument;
  currentProjectId?: string;
  conversationId?: string;
  disabled: boolean;
  selected: AssistantSourcePlan;
  onChange: (value: AssistantSourcePlan) => void;
  ensureConversation: () => Promise<string>;
  onBusy: (busy: boolean) => void;
  controls?: ReactNode;
}) {
  const [files, setFiles] = useState<AssistantAttachment[]>([]);
  const [inventoryOwner, setInventoryOwner] = useState<string>();
  const [revision, refresh] = useState(0);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [browsingId, setBrowsingId] = useState("");
  const [documentQuery, setDocumentQuery] = useState("");
  const [imageProjectId, setImageProjectId] = useState("");
  const imageButton = useRef<HTMLButtonElement>(null);
  const imageReturnFocus = useRef<HTMLElement | null>(null);
  const imageProject = view.projects.find((p) => p.id === imageProjectId);
  const pickerId = useId();
  const pickerButton = useRef<HTMLButtonElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!adding) return;
    return dismissOnOutside(
      (event) =>
        event
          .composedPath()
          .some(
            (node) => node === pickerButton.current || node === picker.current,
          ),
      () => setAdding(false),
    );
  }, [adding]);
  useEffect(() => {
    if (disabled) setAdding(false);
  }, [disabled]);
  const project = view.projects.find((item) => item.id === selected.projectId);
  const browsing = view.projects.find((item) => item.id === browsingId);
  const documentIds = selected.documentIds ?? [];
  const attachedIds = selected.attachments ?? [];
  const docs = view.documents.filter(
    (doc) => doc.projectId === project?.id && doc.status === "ready",
  );
  const availableDocuments = documentIds.filter((id) =>
    docs.some((doc) => doc.id === id),
  );
  const availableAttachments =
    inventoryOwner === conversationId && conversationId
      ? attachedIds.filter((id) => files.some((file) => file.id === id))
      : attachedIds;
  const photo = docs.find((doc) => doc.id === selected.image?.documentId);
  const remainingDocumentIds = documentIds.filter((id) => id !== photo?.id);
  const selectedFiles = files.filter((file) => attachedIds.includes(file.id));
  const staleDocumentScope =
    (!!selected.projectId && !project) ||
    availableDocuments.length < documentIds.length;
  const staleAttachments = availableAttachments.length < attachedIds.length;
  const browsingDocs = view.documents.filter(
    (doc) =>
      doc.projectId === browsing?.id && doc.status === "ready",
  );
  const browsingSelection = browsingId === project?.id ? documentIds : [];
  const filter = documentQuery.trim().toLocaleLowerCase();
  const visibleDocs = browsingDocs.filter((doc) =>
    !imageName(doc.path) && doc.title.toLocaleLowerCase().includes(filter),
  );

  useEffect(() => {
    let active = true;
    if (!conversationId) {
      setFiles([]);
      setInventoryOwner(undefined);
      return;
    }
    void invoke<AssistantAttachment[]>("assistant_attachment_list", {
      conversationId,
    }).then(
      (next) => {
        if (active && Array.isArray(next)) {
          setFiles(next);
          setInventoryOwner(conversationId);
        }
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
    <section
      className="question-sources question-source-chips"
      aria-label={msg("本轮资料与选项")}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || isImeEvent(event.nativeEvent) || !adding)
          return;
        event.stopPropagation();
        setAdding(false);
        pickerButton.current?.focus();
      }}
    >
      {(project || selectedFiles.length > 0) && (
        <div className="composer-selected-sources">
          {project && (!photo || remainingDocumentIds.length > 0) && (
            <button
              type="button"
              className="question-source-chip"
              aria-description={msg("移除当前知识空间范围")}
              title={
                docs
                  .filter((doc) => remainingDocumentIds.includes(doc.id))
                  .map((doc) => doc.title)
                  .join("、") || msg("移除整个空间")
              }
              disabled={disabled || working}
              onClick={() =>
                onChange({
                  ...selected,
                  projectId: photo ? project.id : null,
                  documentIds: photo ? [photo.id] : [],
                })
              }
            >
              <span>
                {project.title}
                {remainingDocumentIds.length
                  ? translate(
                      ` · ${remainingDocumentIds.length} 篇`,
                      ` · ${remainingDocumentIds.length} ${remainingDocumentIds.length === 1 ? "file" : "files"}`,
                    )
                  : msg(" · 整个空间")}
              </span>
              <X size={12} />
            </button>
          )}
          {photo && (
            <span className="composer-image-chip">
              <button
                type="button"
                disabled={disabled || working}
                title={translate(
                  "更改图片或读取方式",
                  "Change image or reading mode",
                )}
                onClick={(e) => {
                  imageReturnFocus.current = e.currentTarget;
                  setImageProjectId(photo.projectId);
                }}
              >
                <ImagePlus size={14} />
                <span>
                  {mediaLabel(photo.title)} ·{" "}
                  {selected.image?.mode === "vision"
                    ? translate("图片", "Image")
                    : selected.image?.mode === "description"
                      ? translate("描述", "Description")
                      : "OCR"}
                </span>
              </button>
              <button
                type="button"
                disabled={disabled || working}
                aria-label={translate("移除本轮图片", "Remove image from turn")}
                onClick={() =>
                  onChange({
                    ...selected,
                    projectId: remainingDocumentIds.length
                      ? selected.projectId
                      : null,
                    documentIds: remainingDocumentIds,
                    image: undefined,
                  })
                }
              >
                <X size={12} />
              </button>
            </span>
          )}
          {selectedFiles.map((file) => (
            <button
              key={file.id}
              type="button"
              className="question-source-chip"
              disabled={disabled || working}
              onClick={() => changeAttachments(file.id)}
              aria-label={translate(
                `移除本轮附件 ${file.title}`,
                `Remove attachment ${file.title}`,
              )}
              title={file.title}
            >
              <Paperclip size={13} />
              <span>{file.title}</span>
              <X size={12} />
            </button>
          ))}
        </div>
      )}
      {(staleDocumentScope || staleAttachments) && (
        <div role="alert">
          {msg("草稿选定的部分资料已不可用。请重新确认本轮资料。")}
          <button
            type="button"
            disabled={disabled || working}
            onClick={() =>
              onChange({
                projectId:
                  project && (!documentIds.length || availableDocuments.length)
                    ? project.id
                    : null,
                documentIds: availableDocuments,
                image: photo ? selected.image : undefined,
                attachments: availableAttachments,
              })
            }
          >
            {msg("移除失效选择")}
          </button>
        </div>
      )}
      {working && <p role="status">{msg("正在处理附件…")}</p>}
      {error && <p role="alert">{error}</p>}
      <button
        ref={pickerButton}
        className="composer-add-source"
        type="button"
        aria-expanded={adding}
        aria-controls={adding ? pickerId : undefined}
        onClick={() => {
          if (!adding) {
            setBrowsingId(project?.id ?? "");
            setDocumentQuery("");
          }
          setAdding(!adding);
        }}
        disabled={disabled || working}
      >
        <Plus size={16} />
        {adding ? msg("完成选择") : msg("添加资料")}
      </button>
      {!!view.projects.length && (
        <button
          ref={imageButton}
          className="composer-add-source composer-add-image"
          type="button"
          aria-haspopup="dialog"
          aria-label={translate("添加图片", "Add image")}
          title={translate("添加图片", "Add image")}
          disabled={disabled || working}
          onClick={(e) => {
            setAdding(false);
            imageReturnFocus.current = e.currentTarget;
            setImageProjectId(
              project?.id ?? currentProjectId ?? view.projects[0].id,
            );
          }}
        >
          <ImagePlus size={16} />
        </button>
      )}
      {adding && (
        <div
          id={pickerId}
          ref={picker}
          className="question-source-picker"
          role="group"
          aria-label={msg("选择本轮资料")}
        >
          <div className="question-source-picker-actions">
            <button
              type="button"
              disabled={disabled || working}
              onClick={() => void attach()}
            >
              <Paperclip size={15} />
              {msg("附加临时文件")}
            </button>
            {view.projects.length > 0 && (
              <button
                type="button"
                disabled={disabled || working}
                onClick={() => {
                  imageReturnFocus.current = pickerButton.current;
                  setAdding(false);
                  setImageProjectId(
                    browsing?.id ??
                      project?.id ??
                      currentProjectId ??
                      view.projects[0].id,
                  );
                }}
              >
                <ImagePlus size={15} />
                {translate("从空间选图", "Choose an image")}
              </button>
            )}
            {currentDocument && (
              <button
                type="button"
                disabled={disabled || working}
                onClick={() => {
                  setBrowsingId(currentDocument.projectId);
                  setDocumentQuery("");
                  onChange({
                    ...selected,
                    projectId: currentDocument.projectId,
                    documentIds: [currentDocument.id],
                    image: imageName(currentDocument.path)
                      ? { documentId: currentDocument.id, mode: "ocr" }
                      : undefined,
                  });
                }}
              >
                {msg("添加当前文档")}
              </button>
            )}
          </div>
          {!!view.projects.length && (
            <label>
              {msg("知识空间")}
              <select
                value={browsing ? browsingId : ""}
                disabled={disabled || working}
                onChange={(e) => {
                  setBrowsingId(e.target.value);
                  setDocumentQuery("");
                }}
              >
                <option value="">{msg("选择要浏览的空间")}</option>
                {view.projects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          {browsing && (
            <div className="question-source-documents">
              <small>
                {browsingId === project?.id
                  ? browsingSelection.length
                    ? translate(
                        `本轮已选 ${browsingSelection.length} 篇，最多 5 篇。`,
                        `${browsingSelection.length} selected for this turn (up to 5).`,
                      )
                    : msg("本轮使用整个空间。勾选文档可缩小范围。")
                  : msg("选择文档或整个空间后才会加入本轮。")}
              </small>
              <button
                type="button"
                className="button small"
                disabled={
                  disabled ||
                  working ||
                  !browsingDocs.length ||
                  (browsingId === project?.id && !documentIds.length)
                }
                onClick={() =>
                  onChange({
                    ...selected,
                    projectId: browsing.id,
                    documentIds: [],
                    image: undefined,
                  })
                }
              >
                {msg("使用整个空间")}
              </button>
              {browsingDocs.length > 5 && (
                <input
                  type="search"
                  aria-label={msg("筛选空间文档")}
                  placeholder={msg("筛选文档标题…")}
                  value={documentQuery}
                  onChange={(e) => setDocumentQuery(e.target.value)}
                />
              )}
              {!visibleDocs.length && (
                <small>
                  {filter
                    ? msg("没有匹配的文档。")
                    : browsingDocs.length ? translate("通过「从空间选图」添加图片。","Choose an image to add a picture.") : msg("空间中还没有可用文档。")}
                </small>
              )}
              {visibleDocs.map((doc) => (
                <label key={doc.id}>
                  <input
                    type="checkbox"
                    checked={browsingSelection.includes(doc.id)}
                    disabled={
                      disabled ||
                      working ||
                      (browsingSelection.length >= 5 &&
                        !browsingSelection.includes(doc.id))
                    }
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...browsingSelection, doc.id]
                        : browsingSelection.filter((id) => id !== doc.id);
                      onChange({
                        ...selected,
                        projectId: next.length ? browsing.id : null,
                        documentIds: next,
                        image:
                          selected.image &&
                          next.includes(selected.image.documentId)
                            ? selected.image
                            : undefined,
                      });
                    }}
                  />
                  {mediaLabel(doc.title)}
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
                    {msg("删除附件")}
                  </button>
                </div>
              ))}
            </div>
          )}
          {!project && !attachedIds.length && (
            <small>{msg("未添加资料")}</small>
          )}
          <small>
            {msg(
              "所选资料可发送给已配置的聊天模型。本轮发送后将清除资料选择。",
            )}
          </small>
        </div>
      )}
      {imageProject &&
        createPortal(
          <ChatImagePicker
            docs={view.documents.filter((d) => d.projectId === imageProject.id)}
            space={imageProject.title}
            selected={
              selected.projectId === imageProject.id
                ? selected.image
                : undefined
            }
            returnFocus={
              imageReturnFocus.current ?? imageButton.current ?? undefined
            }
            onClose={() => setImageProjectId("")}
            onPick={(image) => {
              const keep =
                selected.projectId === imageProject.id
                  ? documentIds.filter(
                      (id) =>
                        id !== selected.image?.documentId &&
                        id !== image.documentId,
                    )
                  : [];
              if (keep.length >= 5) {
                setError(
                  translate(
                    "本轮最多选择五份空间资料，请先移除一份。",
                    "Remove a source first. A turn can include up to five space items.",
                  ),
                );
                setImageProjectId("");
                return;
              }
              onChange({
                ...selected,
                projectId: imageProject.id,
                documentIds: [...keep, image.documentId],
                image,
              });
              setError("");
              setImageProjectId("");
            }}
          />,
          document.body,
        )}
      {controls}
    </section>
  );
}
