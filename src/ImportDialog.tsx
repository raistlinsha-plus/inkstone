import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { Upload, X } from "lucide-react";
import ModalDialog from "./ModalDialog";
import type {
  LibraryView,
  ImportTask,
  ImportResult,
  ImportItem,
} from "./library";
interface Props {
  view: LibraryView;
  projectId: string;
  initialPaths: string[];
  task?: ImportTask;
  onClose: () => void;
  onFinished: (r: ImportResult) => Promise<void>;
  onBusy: (busy: boolean) => void;
  onOpen: (id: string) => void;
}
export default function ImportDialog({
  view,
  projectId,
  initialPaths,
  task,
  onClose,
  onFinished,
  onBusy,
  onOpen,
}: Props) {
  const [project, setProject] = useState(task?.projectId ?? projectId),
    [paths, setPaths] = useState(task?.paths ?? initialPaths),
    [skip, setSkip] = useState(true),
    [attachments, setAttachments] = useState(true),
    [busy, setBusy] = useState(false),
    [picking, setPicking] = useState(false),
    [stopping, setStopping] = useState(false),
    [error, setError] = useState(""),
    [items, setItems] = useState<ImportItem[]>([]),
    [progress, setProgress] = useState({ done: 0, total: 0 }),
    [result, setResult] = useState<ImportResult | null>(null);
  const inFlight = useRef(false);
  const choosing = useRef(false);
  const mounted = useRef(true);
  const activeJob = useRef("");
  const retiredJobs = useRef(new Set<string>());
  const locked = busy || picking;
  const close = () => {
    if (!inFlight.current && !choosing.current) onClose();
  };
  useEffect(() => {
    mounted.current = true;
    const unlisten = listen<{
      jobId: string;
      done: number;
      total: number;
      item: ImportItem;
    }>("import-progress", (e) => {
      if (
        !mounted.current ||
        !inFlight.current ||
        retiredJobs.current.has(e.payload.jobId)
      )
        return;
      if (!activeJob.current) activeJob.current = e.payload.jobId;
      if (activeJob.current !== e.payload.jobId) return;
      setProgress({ done: e.payload.done, total: e.payload.total });
      setItems((old) => [...old, e.payload.item]);
    });
    return () => {
      mounted.current = false;
      void unlisten.then((fn) => fn());
    };
  }, []);
  const choose = async (folder: boolean) => {
    if (inFlight.current || choosing.current) return;
    choosing.current = true;
    setPicking(true);
    try {
      const selected = await open({
        directory: folder,
        multiple: !folder,
        title: folder ? "选择要复制导入的文件夹" : "选择要复制导入的文档",
        filters: folder
          ? undefined
          : [
              {
                name: "文本与结构文档",
                extensions: ["md", "markdown", "txt", "json", "mmd"],
              },
            ],
      });
      if (!mounted.current) return;
      if (selected) setPaths(Array.isArray(selected) ? selected : [selected]);
      setResult(null);
      setError("");
    } catch (e) {
      if (mounted.current) setError(String(e));
    } finally {
      choosing.current = false;
      if (mounted.current) setPicking(false);
    }
  };
  const run = async () => {
    if (inFlight.current || choosing.current || !paths.length || !project)
      return;
    inFlight.current = true;
    activeJob.current = "";
    setBusy(true);
    setStopping(false);
    onBusy(true);
    setError("");
    setItems([]);
    setResult(null);
    setProgress({ done: 0, total: 0 });
    try {
      const response = await invoke<ImportResult>("library_import", {
        projectId: project,
        paths,
        skipDuplicates: skip,
        attachments,
        resumeJobId: task?.id ?? null,
      });
      retiredJobs.current.add(response.jobId);
      if (mounted.current) {
        setResult(response);
        setItems(response.items);
      }
      await onFinished(response);
    } catch (e) {
      if (mounted.current) setError(String(e));
    } finally {
      if (activeJob.current) retiredJobs.current.add(activeJob.current);
      inFlight.current = false;
      if (mounted.current) {
        setBusy(false);
        setStopping(false);
      }
      onBusy(false);
    }
  };
  const stop = async () => {
    if (!inFlight.current || stopping) return;
    setStopping(true);
    try {
      await invoke("cancel_import");
    } catch (e) {
      if (mounted.current) {
        setError(String(e));
        setStopping(false);
      }
    }
  };
  const imported = items.filter((i) => i.status === "imported"),
    skipped = items.filter((i) => i.status === "skipped"),
    failed = items.filter((i) => i.status === "failed");
  return (
    <ModalDialog
      label="导入本地文档"
      className="import-modal"
      busy={locked}
      onClose={close}
    >
      <div className="modal-heading">
        <div>
          <h2>导入本地文档</h2>
          <p>复制到当前文档空间，保留外部原件。</p>
        </div>
        <button disabled={locked} aria-label="关闭导入" onClick={close}>
          <X size={18} />
        </button>
      </div>
      <label>
        导入到空间
        <select
          aria-label="导入目标空间"
          value={project}
          disabled={locked}
          onChange={(e) => setProject(e.target.value)}
        >
          {view.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </label>
      <div className="import-pick">
        <Upload size={26} />
        <p>选择文件或文件夹，也可以直接拖入应用</p>
        <button
          className="button"
          disabled={locked}
          onClick={() => void choose(false)}
        >
          选择文件（可多选）
        </button>
        <button
          className="button"
          disabled={locked}
          onClick={() => void choose(true)}
        >
          选择文件夹
        </button>
      </div>
      {paths.length > 0 && (
        <ul className="import-paths">
          {paths.map((p) => (
            <li key={p}>{p.split("/").at(-1)}</li>
          ))}
        </ul>
      )}
      <div className="import-options">
        <label>
          <input
            type="checkbox"
            checked={skip}
            disabled={locked}
            onChange={(e) => setSkip(e.target.checked)}
          />
          跳过相同内容；同名不同内容自动保存副本
        </label>
        <label>
          <input
            type="checkbox"
            checked={attachments}
            disabled={locked}
            onChange={(e) => setAttachments(e.target.checked)}
          />
          一并复制源目录范围内的相对图片
        </label>
      </div>
      <p className="preview-help">
        支持 MD、TXT、JSON、MMD；文本每篇最多 2 MB，图片最多 8
        MB。导入不会自动发送到远程模型。
      </p>
      {busy && (
        <div role="status">
          正在复制 {progress.done} / {progress.total || "准备中"}
          <progress value={progress.done} max={progress.total || 1} />
        </div>
      )}
      {(result || items.length > 0) && (
        <div className="import-results">
          <strong>
            {result?.cancelled ? "已停止，可重试 · " : ""}成功 {imported.length}{" "}
            · 跳过 {skipped.length} · 失败 {failed.length}
          </strong>
          {items.map((i, n) => (
            <div className={"import-item " + i.status} key={i.source + n}>
              <span>{i.source.split("/").at(-1)}</span>
              <small>{i.message}</small>
              {i.documentId && i.status === "imported" && !busy && (
                <button onClick={() => onOpen(i.documentId!)}>打开副本</button>
              )}
            </div>
          ))}
          {result?.warnings.map((w, i) => (
            <p className="panel-warning" key={i}>
              {w}
            </p>
          ))}
        </div>
      )}
      {error && (
        <div role="alert" className="preview-error">
          {error}
        </div>
      )}
      <div className="modal-actions">
        <button className="button" disabled={locked} onClick={close}>
          {result ? "完成" : "取消"}
        </button>
        {busy ? (
          <button
            className="button"
            disabled={stopping}
            onClick={() => void stop()}
          >
            {stopping ? "正在停止…" : "停止导入"}
          </button>
        ) : (
          <button
            className="button primary"
            disabled={picking || !paths.length || !project}
            onClick={() => void run()}
          >
            {result ? "重新检查并导入" : "复制导入"}
          </button>
        )}
      </div>
    </ModalDialog>
  );
}
