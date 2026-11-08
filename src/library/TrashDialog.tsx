import { useEffect, useRef, useState } from "react";
import { FileText, X } from "lucide-react";
import ModalDialog from "../ModalDialog";
import { invoke } from "../platform/ipc";
import type { LibraryDocument } from "../library";
export interface TrashDetail {
  documentId: string;
  projectId: string;
  title: string;
  status: string;
  trashedAt: number | null;
  attachments: number;
  history: number;
  bytes: number;
  operationId?: string | null;
}
export interface PurgePreview {
  detail: TrashDetail;
  token: string;
  expiresAt: number;
}
export interface PurgeResult {
  operationId: string;
  status: "completed" | "notStarted" | "pendingCleanup";
  message: string;
}
export default function TrashDialog({
  document,
  onClose,
  onRestore,
  onRefresh,
  onBeforeAction,
  onBusy,
}: {
  document: LibraryDocument;
  onClose: () => void;
  onRestore: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onBeforeAction: () => Promise<boolean>;
  onBusy: (busy: boolean) => void;
}) {
  const [detail, setDetail] = useState<TrashDetail | null>(null),
    [preview, setPreview] = useState<PurgePreview | null>(null),
    [confirm, setConfirm] = useState(""),
    [working, setWorking] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<PurgeResult | null>(null);
  const operation = useRef<string | null>(null),
    flight = useRef(false),
    ownsBusy = useRef(false),
    alive = useRef(true);
  function beginBusy() {
    ownsBusy.current = true;
    onBusy(true);
  }
  useEffect(() => {
    alive.current = true;
    void invoke("library_trash_detail", {
      projectId: document.projectId,
      documentId: document.id,
    })
      .then((d) => {
        if (alive.current) {
          setDetail(d);
          if (d.operationId) {
            operation.current = d.operationId;
            setResult({
              operationId: d.operationId,
              status: "pendingCleanup",
              message: "删除未完成，请重试清理。",
            });
          }
        }
      })
      .catch((e) => {
        if (alive.current) setError(String(e));
      });
    return () => {
      alive.current = false;
    };
  }, [document.id]);
  async function run(action: () => Promise<void>) {
    if (flight.current) return;
    flight.current = true;
    setWorking(true);
    setError("");
    try {
      await action();
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      flight.current = false;
      if (alive.current) setWorking(false);
      if (ownsBusy.current) {
        ownsBusy.current = false;
        onBusy(false);
      }
    }
  }
  async function prepare() {
    await run(async () => {
      if (!(await onBeforeAction())) return;
      beginBusy();
      const p = await invoke("library_purge_preview", {
        projectId: document.projectId,
        documentId: document.id,
      });
      if (alive.current) {
        setPreview(p);
        setConfirm("");
        operation.current = crypto.randomUUID();
        setResult(null);
      }
    });
  }
  async function execute() {
    await run(async () => {
      if (!(await onBeforeAction())) return;
      beginBusy();
      const op = operation.current;
      if (!op) throw Error("请重新预览删除范围");
      let r: PurgeResult;
      try {
        r = await invoke("library_purge_execute", {
          projectId: document.projectId,
          documentId: document.id,
          token: preview?.token ?? "",
          operationId: op,
          confirmation: result?.status === "pendingCleanup" ? "删除" : confirm,
        });
      } catch (e) {
        try {
          r = await invoke("library_purge_status", {
            projectId: document.projectId,
            operationId: op,
          });
        } catch {
          throw e;
        }
      }
      if (!alive.current) return;
      setResult(r);
      if (r.status === "completed") {
        try {
          await onRefresh();
        } catch {
          setError("已彻底删除；列表暂未刷新。可重试刷新，文档不会再次删除。");
          return;
        }
        onClose();
      } else if (r.status === "notStarted") {
        await onRefresh();
        setPreview(null);
        operation.current = null;
        setError(r.message);
      } else {
        setError(r.message);
        await onRefresh();
      }
    });
  }
  const purging =
    detail?.status === "purging" || result?.status === "pendingCleanup";
  const completed = result?.status === "completed";
  const title = completed
    ? "已彻底删除"
    : purging
      ? "删除未完成"
      : preview
        ? "彻底删除这篇文档？"
        : "回收站文档";
  return (
    <ModalDialog
      label={title}
      className="trash-dialog"
      onClose={onClose}
      busy={working}
    >
      <header className="modal-heading">
        <h2>{title}</h2>
        <button
          aria-label="关闭回收站详情"
          disabled={working}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <div className="trash-dialog-body">
        <div className="trash-target">
          <FileText size={18} />
          <div>
            <strong>{document.title}</strong>
            <small>
              {detail?.trashedAt
                ? new Date(detail.trashedAt * 1000).toLocaleDateString(
                    "zh-CN",
                  ) + " 移入"
                : detail
                  ? "升级前已移入"
                  : "正在读取…"}
            </small>
          </div>
        </div>
        {detail && !purging && (
          <p className="trash-facts">
            {detail.attachments} 个附件 · {detail.history} 个历史版本 ·{" "}
            {(detail.bytes / 1024).toFixed(1)} KB
          </p>
        )}
        {!completed && (preview || purging) && (
          <>
            <h3>将从 Inkstone 删除</h3>
            <p>
              文档副本、专属附件、历史版本、恢复草稿，以及检索和日历派生数据。引用这篇文档的
              Wiki
              已发布主题及其版本历史、相关待审阅改动和摘录也会删除，可从剩余资料重新整理。
            </p>
            <h3>不会删除</h3>
            <p>
              导入原件、已有问答和手札中的文本、已导出的文件与备份。已有来源引用会标为不可用。
            </p>
            <p className="trash-danger-note">此操作无法在 Inkstone 中恢复。</p>
          </>
        )}
        {preview && !purging && !completed && (
          <label className="trash-confirm">
            输入“删除”以确认
            <input
              aria-label="输入删除以确认"
              autoComplete="off"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={working}
            />
          </label>
        )}
        {purging && !completed && (
          <p>
            删除操作尚未完成，请重试同一次清理；若提示需要修复，可先运行资料恢复检查。完成前该文档暂不可编辑。
          </p>
        )}
        {error && (
          <p role="alert" className="trash-error">
            {error}
          </p>
        )}
        {!preview && !purging && (
          <p className="muted">标题点击只查看详情；恢复后文档回到原空间。</p>
        )}
      </div>
      <footer className="modal-actions">
        <button data-autofocus disabled={working} onClick={onClose}>
          {preview && !completed ? "取消" : "关闭"}
        </button>
        {completed ? (
          <button
            disabled={working}
            onClick={() =>
              void run(async () => {
                await onRefresh();
                onClose();
              })
            }
          >
            刷新列表
          </button>
        ) : purging ? (
          <button
            className="danger"
            disabled={working || !operation.current}
            onClick={() => void execute()}
          >
            {working ? "正在清理…" : "重试清理"}
          </button>
        ) : preview ? (
          <button
            className="danger"
            disabled={working || confirm !== "删除"}
            onClick={() => void execute()}
          >
            {working ? "正在删除…" : "彻底删除"}
          </button>
        ) : (
          <>
            <button
              disabled={working || !detail}
              onClick={() =>
                void run(async () => {
                  if (!(await onBeforeAction())) return;
                  await onRestore();
                  onClose();
                })
              }
            >
              恢复文档
            </button>
            <button
              className="danger-text"
              disabled={working || !detail}
              onClick={() => void prepare()}
            >
              彻底删除…
            </button>
          </>
        )}
        {error && preview && !purging && !completed && (
          <button disabled={working} onClick={() => void prepare()}>
            重新核对删除范围
          </button>
        )}
      </footer>
    </ModalDialog>
  );
}
