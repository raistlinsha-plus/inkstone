import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { History, RefreshCw, X } from "lucide-react";
import ModalDialog from "./ModalDialog";
import type { LibraryDocument } from "./library";

export interface SourceUpdatePreview {
  documentId: string;
  title: string;
  status:
    | "unchanged"
    | "source-changed"
    | "local-changed"
    | "conflict"
    | "unavailable"
    | "baseline-unavailable";
  managedHash: string;
  managedFingerprint: string;
  sourceFingerprint: string | null;
  canUpdate: boolean;
  canKeepBoth?: boolean;
  message: string;
  currentContent: string;
  sourceContent: string | null;
  attachmentChanges: string[];
  warnings: string[];
}
interface Version {
  id: string;
  created: number;
  reason: string;
  contentHash: string;
  attachmentCount: number;
}
interface MutationResult {
  document: LibraryDocument;
  warning: string | null;
}

export default function SourceReviewDialog({
  document,
  initialTab = "source",
  spaceName,
  onClose,
  onChanged,
  onBusy,
}: {
  document: LibraryDocument;
  initialTab?: "source" | "history";
  spaceName?: string;
  onClose: () => void;
  onChanged: (doc: LibraryDocument) => Promise<void>;
  onBusy: (busy: boolean) => void;
}) {
  const [preview, setPreview] = useState<SourceUpdatePreview | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [tab, setTab] = useState(initialTab);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [committed, setCommitted] = useState(false);
  const [restore, setRestore] = useState<string | null>(null);
  const mounted = useRef(true),
    inFlight = useRef(false),
    sequence = useRef(0);
  const load = async () => {
    const id = ++sequence.current;
    setError("");
    setBusy(true);
    try {
      const [p, h] = await Promise.all([
        invoke<SourceUpdatePreview>("library_check_source_update", {
          id: document.id,
        }),
        invoke<Version[]>("library_history", { id: document.id }),
      ]);
      if (mounted.current && sequence.current === id) {
        setPreview(p);
        setVersions(h);
      }
    } catch (e) {
      if (mounted.current && sequence.current === id) setError(String(e));
    } finally {
      if (mounted.current && sequence.current === id) setBusy(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      ++sequence.current;
    };
  }, [document.id]);
  const mutate = async (kind: "update" | "copy" | "restore") => {
    if (!preview || inFlight.current || busy || committed) return;
    inFlight.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    let result: MutationResult | undefined;
    try {
      result =
        kind === "restore"
          ? await invoke<MutationResult>("library_restore_version", {
              id: document.id,
              versionId: restore,
              expectedManagedFingerprint: preview.managedFingerprint,
            })
          : await invoke<MutationResult>("library_apply_source_update", {
              id: document.id,
              expectedManagedFingerprint: preview.managedFingerprint,
              expectedSourceFingerprint: preview.sourceFingerprint,
              keepBoth: kind === "copy",
            });
      setCommitted(true);
      if (mounted.current) {
        try {
          await onChanged(result.document);
          if (result.warning)
            setError(`文件已保存：${result.warning}。请关闭后重新检查。`);
          else onClose();
        } catch (e) {
          setError(`文件已保存，刷新失败，请关闭后重新打开：${String(e)}`);
        }
      }
    } catch (e) {
      if (mounted.current) setError(String(e));
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
      onBusy(false);
    }
  };
  return (
    <ModalDialog
      label="来源更新与历史版本"
      className="source-review-modal"
      busy={busy}
      onClose={onClose}
    >
      <div className="modal-heading">
        <div>
          <h2>{document.title}</h2>
          {spaceName && <p>所属空间：{spaceName}</p>}
          <p>比较外部原件与当前副本；更新前保留可恢复版本。</p>
        </div>
        <button
          className="icon-button"
          aria-label="关闭来源比较"
          disabled={busy}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <div className="source-review-tabs">
        <button
          aria-pressed={tab === "source"}
          onClick={() => setTab("source")}
        >
          <RefreshCw size={16} />
          来源更新
        </button>
        <button
          aria-pressed={tab === "history"}
          onClick={() => setTab("history")}
        >
          <History size={16} />
          历史版本
        </button>
        <button disabled={busy} onClick={() => void load()}>
          重新检查
        </button>
      </div>
      {error && (
        <p role="alert" className="panel-warning">
          {error}
        </p>
      )}
      {busy && <p role="status">正在检查或保存，请稍候…</p>}
      {tab === "source" && preview && (
        <>
          <p role="status" className="source-update-status">
            {preview.message}
          </p>
          {preview.warnings.map((w, i) => (
            <p className="panel-warning" key={i}>
              {w}
            </p>
          ))}
          {!!preview.attachmentChanges.length && (
            <details open>
              <summary>附件变化（{preview.attachmentChanges.length}）</summary>
              <ul>
                {preview.attachmentChanges.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </details>
          )}
          <div className="source-comparison">
            <label>
              当前副本
              <textarea
                readOnly
                aria-label="当前副本内容"
                value={preview.currentContent}
              />
            </label>
            <label>
              原件更新后的内容
              <textarea
                readOnly
                aria-label="原件更新后的内容"
                value={preview.sourceContent ?? "原件当前不可读取"}
              />
            </label>
          </div>
          <div className="modal-actions">
            <button className="button" onClick={onClose} disabled={busy}>
              取消
            </button>
            <div />
            <button
              className="button"
              disabled={
                busy ||
                !preview.sourceFingerprint ||
                preview.sourceContent === null ||
                preview.canKeepBoth === false ||
                preview.status === "unchanged"
              }
              onClick={() => void mutate("copy")}
            >
              保留两份
            </button>
            <button
              className="button primary"
              disabled={busy || committed || !preview.canUpdate}
              onClick={() => void mutate("update")}
            >
              更新已有文档
            </button>
          </div>
        </>
      )}
      {tab === "history" && (
        <div className="source-history">
          <p>更新或恢复前的正文与附件一并保留；恢复不会修改外部原件。</p>
          {!busy && !versions.length && (
            <p>尚无历史版本。首次更新后会在这里保留旧版本。</p>
          )}
          {versions.map((v) => (
            <div className="source-version" key={v.id}>
              <span>
                <strong>
                  {new Date(
                    v.created * (v.created < 1e12 ? 1000 : 1),
                  ).toLocaleString("zh-CN")}
                </strong>
                <small>
                  {v.reason} · {v.attachmentCount} 个附件
                </small>
              </span>
              <button
                className="button"
                disabled={busy || committed || !preview}
                onClick={() => setRestore(v.id)}
              >
                选择恢复
              </button>
            </div>
          ))}
          {restore && (
            <div className="panel-warning">
              <p>将恢复所选版本，当前副本先保留为另一历史版本。</p>
              <button
                className="button"
                disabled={busy}
                onClick={() => setRestore(null)}
              >
                取消恢复
              </button>
              <button
                className="button primary"
                disabled={busy || committed || !preview}
                onClick={() => void mutate("restore")}
              >
                确认恢复此版本
              </button>
            </div>
          )}
        </div>
      )}
    </ModalDialog>
  );
}
