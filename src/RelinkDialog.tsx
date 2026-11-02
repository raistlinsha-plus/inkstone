import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import ModalDialog from "./ModalDialog";
import type { LibraryDocument } from "./library";
interface LinkPreview {
  documentId: string;
  managedFingerprint: string;
  catalogFingerprint: string;
  currentContent: string;
  projectedContent: string;
  links: {
    url: string;
    status: "kept" | "resolved" | "ambiguous" | "unresolved" | "image";
    targetDocumentId: string | null;
    replacement: string | null;
    candidates: { id: string; title: string; path: string }[];
  }[];
  warnings: string[];
}
function readableLinkName(url: string) {
  const path = url.split(/[?#]/, 1)[0];
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    /* Keep malformed input visible for review. */
  }
  return decoded.split(/[\\/]/).filter(Boolean).at(-1) || decoded || url;
}
export default function RelinkDialog({
  document,
  onClose,
  onChanged,
  onBusy,
}: {
  document: LibraryDocument;
  onClose: () => void;
  onChanged: (d: LibraryDocument) => Promise<void>;
  onBusy: (busy: boolean) => void;
}) {
  const [preview, setPreview] = useState<LinkPreview | null>(null),
    [choices, setChoices] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  const active = useRef(true),
    sequence = useRef(0),
    flight = useRef(false);
  useEffect(
    () => () => {
      active.current = false;
      ++sequence.current;
    },
    [],
  );
  const selections = () =>
    Object.entries(choices)
      .filter(([, id]) => id)
      .map(([url, documentId]) => ({ url, documentId }));
  const load = async () => {
    const seq = ++sequence.current;
    setBusy(true);
    setError("");
    try {
      const next = await invoke<LinkPreview>("library_relink_preview", {
        id: document.id,
        choices: selections(),
      });
      if (active.current && seq === sequence.current) {
        setPreview(next);
        setSaved(false);
      }
    } catch (e) {
      if (active.current && seq === sequence.current) {
        setPreview(null);
        setError(String(e));
      }
    } finally {
      if (active.current && seq === sequence.current) setBusy(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const apply = async () => {
    if (!preview || flight.current) return;
    flight.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    let committed = false;
    try {
      const result = await invoke<{
        document: LibraryDocument;
        warning?: string;
      }>("library_relink_apply", {
        id: document.id,
        expectedManagedFingerprint: preview.managedFingerprint,
        expectedCatalogFingerprint: preview.catalogFingerprint,
        choices: selections(),
      });
      committed = true;
      if (active.current) {
        setPreview(null);
        setSaved(true);
        if (result.warning) setError(result.warning);
      }
      await onChanged(result.document);
    } catch (e) {
      if (active.current) {
        setError(committed ? `链接已保存，刷新失败：${String(e)}` : String(e));
        if (!committed) setPreview(null);
      }
    } finally {
      flight.current = false;
      onBusy(false);
      if (active.current) setBusy(false);
    }
  };
  const changed =
    preview && preview.currentContent !== preview.projectedContent;
  const labels = {
    kept: "保持原关联",
    resolved: "将关联",
    ambiguous: "有多个目标，请选择",
    unresolved: "尚未找到目标",
    image: "图片：保持现有规则",
  };
  return (
    <ModalDialog
      label="重新关联链接"
      onClose={onClose}
      busy={busy}
      className="source-review-modal"
    >
      <div className="modal-heading">
        <div>
          <span className="eyebrow">LINK REVIEW</span>
          <h2>重新关联链接</h2>
          <p>{document.title}</p>
        </div>
        <button
          className="icon-button"
          disabled={busy}
          aria-label="关闭重新关联链接"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <p className="muted">
        只在当前空间查找已登记的文档，不要求外部原件在线。保存前保留历史；不改代码中的链接字面量。
      </p>
      {!preview && !busy && !saved && Object.keys(choices).length > 0 && (
        <p role="status">目标选择已更改，请重新预览后保存。</p>
      )}
      {error && (
        <p className="panel-warning" role="alert">
          {error}
        </p>
      )}
      {saved && <p role="status">链接已保存，旧版本可从历史恢复。</p>}
      {busy && <p role="status">正在核对链接与文档身份…</p>}
      <div className="relink-list">
        {preview?.links.map((link, i) => (
          <article key={link.url + ":" + i}>
            <strong>{labels[link.status]}</strong>
            <code title={link.url}>{readableLinkName(link.url)}</code>
            {link.status === "ambiguous" && (
              <label>
                关联目标
                <select
                  aria-label={`关联目标 ${link.url}`}
                  value={choices[link.url] ?? ""}
                  disabled={busy}
                  onChange={(e) => {
                    setChoices((old) => ({
                      ...old,
                      [link.url]: e.target.value,
                    }));
                    setPreview(null);
                  }}
                >
                  <option value="">保持不变，稍后处理</option>
                  {link.candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title} · {c.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {link.replacement && (
              <small title={link.replacement}>
                →{" "}
                {link.candidates.find((c) => c.id === link.targetDocumentId)
                  ?.title || readableLinkName(link.replacement)}
              </small>
            )}
            <details>
              <summary>核对完整链接</summary>
              <p>原链接</p>
              <code>{link.url}</code>
              {link.replacement && (
                <>
                  <p>目标路径</p>
                  <code>{link.replacement}</code>
                </>
              )}
            </details>
          </article>
        ))}
      </div>
      {!busy && preview?.links.length === 0 && (
        <p>这篇文档没有需要重新关联的本地链接。</p>
      )}
      {preview?.warnings.map((w, i) => (
        <p className="panel-warning" key={i}>
          {w}
        </p>
      ))}
      {preview && (
        <div className="source-comparison">
          <label>
            当前内容
            <textarea readOnly value={preview.currentContent} />
          </label>
          <label>
            重新关联后的内容
            <textarea readOnly value={preview.projectedContent} />
          </label>
        </div>
      )}
      <div className="modal-actions">
        <button className="button" disabled={busy} onClick={() => void load()}>
          重新预览
        </button>
        <div />
        <button
          className="button primary"
          disabled={busy || !changed}
          onClick={() => void apply()}
        >
          保存链接关联
        </button>
      </div>
    </ModalDialog>
  );
}
