import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RefreshCw, X } from "lucide-react";
import ModalDialog from "./ModalDialog";
export interface RecoveryReport {
  checkedAt: number;
  items: {
    operationId: string;
    documentId: string | null;
    projectId: string | null;
    kind: string;
    status: "recovered" | "interrupted" | "needs-review" | "metadata-pending";
    retryable: boolean;
    message: string;
  }[];
}
export default function RecoveryDialog({
  initial,
  onClose,
  onReport,
  onBusy,
}: {
  initial: RecoveryReport | null;
  onClose: () => void;
  onReport: (report: RecoveryReport) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [report, setReport] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const active = useRef(true),
    flight = useRef(false);
  useEffect(
    () => () => {
      active.current = false;
    },
    [],
  );
  const load = async (retry = false) => {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError("");
    onBusy(true);
    try {
      const next = await invoke<RecoveryReport>(
        retry ? "library_retry_recovery" : "library_recovery_report",
      );
      if (active.current) {
        setReport(next);
        onReport(next);
      }
    } catch (e) {
      if (active.current) setError(String(e));
    } finally {
      flight.current = false;
      if (active.current) setBusy(false);
      onBusy(false);
    }
  };
  useEffect(() => {
    if (!initial) void load();
  }, []);
  const labels = {
    recovered: "已恢复",
    interrupted: "操作中断，当前内容保留",
    "needs-review": "需要核对",
    "metadata-pending": "正文已保存，元数据待恢复",
  };
  return (
    <ModalDialog
      label="恢复与诊断"
      onClose={onClose}
      busy={busy}
      className="recovery-modal"
    >
      <div className="modal-heading">
        <div>
          <span className="eyebrow">LOCAL RECOVERY</span>
          <h2>恢复与诊断</h2>
        </div>
        <button
          className="icon-button"
          disabled={busy}
          aria-label="关闭恢复与诊断"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <p className="muted">
        每项独立核对。重试只补齐可以确认的操作，不会用旧正文覆盖当前内容。
      </p>
      {error && (
        <p className="panel-warning" role="alert">
          {error}
        </p>
      )}
      {busy && <p role="status">正在核对恢复记录…</p>}
      {report?.items.length === 0 && (
        <p className="empty-state">没有待处理的恢复记录。</p>
      )}
      <div className="recovery-items">
        {report?.items.map((item) => (
          <article key={item.operationId}>
            <div className="section-heading">
              <strong>{labels[item.status]}</strong>
              <small>{item.retryable ? "可安全重试" : "核对结果"}</small>
            </div>
            <p>{item.message}</p>
            <details>
              <summary>诊断身份</summary>
              <p>
                操作：{item.operationId}
                <br />
                类型：{item.kind}
                <br />
                文档：{item.documentId ?? "未关联"}
              </p>
            </details>
          </article>
        ))}
      </div>
      <div className="modal-actions">
        <button className="button" disabled={busy} onClick={() => void load()}>
          <RefreshCw size={14} />
          重新核对
        </button>
        <div />
        <button
          className="button primary"
          disabled={busy || !report?.items.some((i) => i.retryable)}
          onClick={() => void load(true)}
        >
          重试可恢复项
        </button>
      </div>
    </ModalDialog>
  );
}
