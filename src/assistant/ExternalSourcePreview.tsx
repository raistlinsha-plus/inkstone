import { invoke, isTauri } from "@tauri-apps/api/core";
import { useState } from "react";
import { X } from "lucide-react";
import ModalDialog from "../ModalDialog";
import { publicCitationUrl, sourceKind } from "./sourceDisplay";
import type { ExternalSource } from "./types";

export default function ExternalSourcePreview({
  source,
  conversationId,
  onClose,
  onOpenDocument,
  onError,
}: {
  source: ExternalSource;
  conversationId?: string;
  onClose: () => void;
  onOpenDocument?: () => void;
  onError: (error: unknown) => void;
}) {
  const [attachmentText, setAttachmentText] = useState<string>();
  const [opening, setOpening] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const url = source.kind === "web" ? publicCitationUrl(source.url) : undefined;
  async function openAttachment() {
    if (!conversationId || !source.attachmentId) return;
    setOpening(true);
    try {
      const item = await invoke<{ text: string }>("assistant_attachment_read", {
        conversationId,
        attachmentId: source.attachmentId,
      });
      setAttachmentText(item.text);
    } catch {
      setUnavailable(true);
    } finally {
      setOpening(false);
    }
  }
  return (
    <ModalDialog
      label="查看来源"
      className="source-dialog"
      backdropClassName="assistant-source-backdrop"
      onClose={onClose}
    >
      <div className="modal-heading">
        <h2>{source.label}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="关闭来源预览"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <p>
        S{source.citation} · {sourceKind(source)}
        {source.capturedAt ? ` · ${source.capturedAt}` : ""}
      </p>
      {(attachmentText ?? source.excerpt) && (
        <blockquote className="assistant-source-excerpt">
          {attachmentText ?? source.excerpt}
        </blockquote>
      )}
      {unavailable && (
        <p role="status">此附件当前不可用。已保存的回答仍保留。</p>
      )}
      {source.kind === "web" && !source.excerpt && (
        <p>本轮只保存了出处，打开网页可核对当前版本。</p>
      )}
      {source.kind === "document" && !onOpenDocument && (
        <p role="status">
          当前无法定位到引用版本。以上摘录来自回答保存时的快照。
        </p>
      )}
      {url && <p className="assistant-source-url">{new URL(url).hostname}</p>}
      <div className="modal-actions">
        {url && (
          <button
            type="button"
            className="primary"
            onClick={() => {
              if (isTauri())
                void invoke("open_external", { url }).catch(onError);
              else window.open(url, "_blank", "noopener,noreferrer");
            }}
          >
            打开网页
          </button>
        )}
        {source.kind === "attachment" &&
          source.attachmentId &&
          conversationId &&
          !unavailable &&
          attachmentText === undefined && (
            <button
              type="button"
              className="primary"
              disabled={opening}
              onClick={() => void openAttachment()}
            >
              {opening ? "正在读取…" : "打开附件"}
            </button>
          )}
        {onOpenDocument && (
          <button type="button" className="primary" onClick={onOpenDocument}>
            打开文档
          </button>
        )}
        <button type="button" onClick={onClose}>
          关闭
        </button>
      </div>
    </ModalDialog>
  );
}
