import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, X } from "lucide-react";
import ModalDialog from "./ModalDialog";
interface BackupReport {
  path: string;
  files: number;
  totalBytes: number;
  createdAt: number;
  manifestHash: string;
  mode: "backup" | "restore-preview";
  warnings: string[];
}
interface BackupValidation {
  valid: boolean;
  path: string;
  files: number;
  totalBytes: number;
  createdAt: number;
  schemaVersion: number;
  manifestHash: string;
  issues: string[];
  warnings: string[];
}
export default function BackupDialog({
  onClose,
  onPrepare,
  onBusy,
}: {
  onClose: () => void;
  onPrepare: () => Promise<boolean>;
  onBusy: (busy: boolean) => void;
}) {
  const [path, setPath] = useState(""),
    [parent, setParent] = useState(""),
    [name, setName] = useState(
      () =>
        `Inkstone备份-${new Date().toISOString().slice(0, 10)}.inkstone.zip`,
    ),
    [restoreName, setRestoreName] = useState("Inkstone恢复预演"),
    [validation, setValidation] = useState<BackupValidation | null>(null),
    [report, setReport] = useState<BackupReport | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const flight = useRef(false),
    active = useRef(true);
  useEffect(
    () => () => {
      active.current = false;
    },
    [],
  );
  const select = async (which: "parent" | "path") => {
    try {
      const result = await open({
        directory: which === "parent",
        multiple: false,
        ...(which === "path"
          ? { filters: [{ name: "Inkstone 备份", extensions: ["zip"] }] }
          : {}),
        title: which === "parent" ? "选择新建备份的父目录" : "选择已有备份包",
      });
      if (typeof result === "string" && active.current) {
        if (which === "parent") setParent(result);
        else {
          setPath(result);
          setValidation(null);
          setReport(null);
        }
      }
    } catch (e) {
      if (active.current) setError(String(e));
    }
  };
  const validName = (value: string) =>
    !!value.trim() && !/[\\/]/.test(value) && !/^\.{1,2}$/.test(value.trim());
  const run = async (kind: "create" | "validate" | "restore") => {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    setReport(null);
    try {
      if (kind === "create") {
        if (!parent || !validName(name) || !/\.zip$/i.test(name.trim()))
          throw Error("请选择父目录并填写新的 ZIP 备份文件名");
        if (!(await onPrepare())) return;
        const result = await invoke<BackupReport>("library_create_backup", {
          target: parent.replace(/\/$/, "") + "/" + name.trim(),
        });
        if (active.current) {
          setReport(result);
          setPath(result.path);
          setValidation(null);
        }
      } else if (kind === "validate") {
        setValidation(null);
        const result = await invoke<BackupValidation>(
          "library_validate_backup",
          { path },
        );
        if (active.current) setValidation(result);
      } else {
        if (!validation?.valid || validation.path !== path)
          throw Error("请先校验所选备份");
        if (!parent || !validName(restoreName))
          throw Error("请选择父目录并填写全新的预演文件夹名称");
        if (!(await onPrepare())) return;
        const result = await invoke<BackupReport>("library_restore_backup", {
          path,
          target: parent.replace(/\/$/, "") + "/" + restoreName.trim(),
        });
        if (active.current) setReport(result);
      }
    } catch (e) {
      if (active.current) setError(String(e));
    } finally {
      flight.current = false;
      onBusy(false);
      if (active.current) setBusy(false);
    }
  };
  return (
    <ModalDialog
      label="备份与恢复预演"
      className="backup-modal"
      onClose={onClose}
      busy={busy}
    >
      <div className="modal-heading">
        <div>
          <span className="eyebrow">LOCAL BACKUP</span>
          <h2>备份与恢复预演</h2>
        </div>
        <button
          className="icon-button"
          disabled={busy}
          aria-label="关闭备份与恢复预演"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <p className="muted">
        备份全部文档空间的正文、附件、目录、历史和恢复草稿。外部原件、系统设置、API密钥与系统口令不打包；索引可重新建立。未应用的内容块表单请先应用或取消。
      </p>
      <section className="backup-section">
        <h3>1. 生成完整备份</h3>
        <label>
          保存位置
          <div className="path-picker">
            <input readOnly value={parent} placeholder="选择一个父目录" />
            <button
              className="button"
              disabled={busy}
              onClick={() => void select("parent")}
            >
              <FolderOpen size={14} />
              选择父目录
            </button>
          </div>
        </label>
        <label>
          新备份文件名
          <input
            aria-label="备份文件名"
            disabled={busy}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button
          className="button primary"
          disabled={
            busy || !parent || !validName(name) || !/\.zip$/i.test(name.trim())
          }
          onClick={() => void run("create")}
        >
          生成并校验备份
        </button>
      </section>
      <section className="backup-section">
        <h3>2. 校验已有备份</h3>
        <div className="path-picker">
          <input
            aria-label="所选备份路径"
            readOnly
            value={path}
            placeholder="选择备份 ZIP 包"
          />
          <button
            className="button"
            disabled={busy}
            onClick={() => void select("path")}
          >
            选择备份包
          </button>
        </div>
        <button
          className="button"
          disabled={busy || !path}
          onClick={() => void run("validate")}
        >
          校验清单与文件
        </button>
        {validation && (
          <div
            role="status"
            className={validation.valid ? "backup-result" : "panel-warning"}
          >
            <strong>
              {validation.valid ? "备份校验通过" : "备份校验失败"}
            </strong>
            <p>
              {validation.files} 个文件 ·{" "}
              {(validation.totalBytes / 1024 / 1024).toFixed(2)} MB · schema{" "}
              {validation.schemaVersion}
            </p>
            {[...validation.issues, ...validation.warnings].map((i, n) => (
              <p key={n}>{i}</p>
            ))}
          </div>
        )}
      </section>
      <section className="backup-section">
        <h3>3. 恢复到全新目录预演</h3>
        <p className="muted">
          校验备份后，使用上方父目录创建隔离的恢复副本。当前工作库不被覆盖，也不会自动切换。
        </p>
        <div className="path-picker">
          <input
            aria-label="恢复预演父目录"
            readOnly
            value={parent}
            placeholder="选择恢复预演的父目录"
          />
          <button
            className="button"
            disabled={busy}
            onClick={() => void select("parent")}
          >
            选择恢复父目录
          </button>
        </div>
        <label>
          新预演文件夹
          <input
            aria-label="恢复预演文件夹名称"
            disabled={busy}
            value={restoreName}
            onChange={(e) => setRestoreName(e.target.value)}
          />
        </label>
        <button
          className="button"
          disabled={
            busy || !validation?.valid || !parent || !validName(restoreName)
          }
          onClick={() => void run("restore")}
        >
          生成恢复预演副本
        </button>
      </section>
      {busy && <p role="status">正在处理，请保持当前窗口打开…</p>}
      {error && (
        <p className="panel-warning" role="alert">
          {error}
        </p>
      )}
      {report && (
        <div className="backup-result" role="status">
          <strong>
            {report.mode === "backup"
              ? "备份已生成并校验"
              : "恢复预演已完成，当前库保持原样"}
          </strong>
          <p>{report.path}</p>
          <p>
            {report.files} 个文件 ·{" "}
            {(report.totalBytes / 1024 / 1024).toFixed(2)} MB
          </p>
          {report.warnings.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
        </div>
      )}
    </ModalDialog>
  );
}
