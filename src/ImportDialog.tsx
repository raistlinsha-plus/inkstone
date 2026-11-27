import { translate as t, msg } from "./i18n";
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
  folderPath?: string;
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
  folderPath = "",
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
  const target = view.projects.find((p) => p.id === project && !p.archived);
  const folder = project === projectId ? folderPath : "";
  const [preview, setPreview] = useState<{
    documents: number;
    images: number;
    attachments: number;
    skipped: number;
    existing: number;
    warnings: string[];
  } | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [previewAttempt, retryPreview] = useState(0);
  const targetId = target?.id;
  useEffect(() => {
    let current = true;
    setPreview(null);
    setPreviewError("");
    if (paths.length && targetId) {
      invoke<NonNullable<typeof preview>>("library_preview_import", {
        projectId: targetId,
        skipDuplicates: skip,
        paths,
        attachments,
      })
        .then((v) => {
          if (current) setPreview(v);
        })
        .catch((e) => {
          if (current) setPreviewError(String(e));
        });
    }
    return () => {
      current = false;
    };
  }, [paths, targetId, skip, attachments, previewAttempt]);
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
                name: t("文档与图片", "Documents and images"),
                extensions: [
                  "md",
                  "markdown",
                  "txt",
                  "json",
                  "mmd",
                  "png",
                  "jpg",
                  "jpeg",
                  "heic",
                  "heif",
                  "gif",
                  "webp",
                ],
              },
            ],
      });
      if (!mounted.current) return;
      if (selected) {
        setPaths(Array.isArray(selected) ? selected : [selected]);
        setResult(null);
        setItems([]);
      }
      setError("");
    } catch (e) {
      if (mounted.current) setError(String(e));
    } finally {
      choosing.current = false;
      if (mounted.current) setPicking(false);
    }
  };
  const run = async (retry: ImportItem[] = []) => {
    if (
      inFlight.current ||
      choosing.current ||
      !paths.length ||
      !target ||
      !preview ||
      !(preview.documents + preview.images)
    )
      return;
    inFlight.current = true;
    activeJob.current = "";
    setBusy(true);
    setStopping(false);
    onBusy(true);
    setError("");
    const retained = retry.length
      ? items.filter((item) => item.status !== "failed")
      : [];
    setItems(retained);
    setResult(null);
    setProgress({ done: 0, total: 0 });
    let copied = false;
    try {
      const response = await invoke<ImportResult>("library_import", {
        projectId: project,
        folder,
        paths: retry.length ? retry.map((item) => item.source) : paths,
        skipDuplicates: skip,
        attachments,
        resumeJobId:
          result?.jobId ??
          (task?.projectId === project &&
          task.paths.length === paths.length &&
          task.paths.every((path, index) => paths[index] === path)
            ? task.id
            : null),
      });
      copied = true;
      retiredJobs.current.add(response.jobId);
      if (mounted.current) {
        setResult(response);
        setItems([...retained, ...response.items]);
      }
      await onFinished(response);
    } catch (e) {
      if (mounted.current) {
        if (!copied && retry.length) {
          setResult(result);
          setItems(items);
        }
        setError(String(e));
      }
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
  // Retrying individually selected files preserves their original attachment roots.
  const retryFailed =
    !!result &&
    !result.cancelled &&
    !result.warnings.length &&
    failed.length > 0 &&
    failed.every((item) => paths.includes(item.source));
  const complete =
    !!result &&
    !result.cancelled &&
    !failed.length &&
    !result.warnings.length &&
    items.length > 0;
  return (
    <ModalDialog
      label={msg("导入本地文档")}
      className="import-modal"
      busy={locked}
      onClose={close}
    >
      <div className="modal-heading">
        <div>
          <h2>{msg("导入本地文档")}</h2>
          <p>{msg("复制到当前文档空间，保留外部原件。")}</p>
        </div>
        <button disabled={locked} aria-label={msg("关闭导入")} onClick={close}>
          <X size={18} />
        </button>
      </div>
      <label>
        {msg("导入到空间")}
        <select
          aria-label={msg("导入目标空间")}
          value={project}
          disabled={locked}
          onChange={(e) => {
            setProject(e.target.value);
            setItems([]);
            setResult(null);
          }}
        >
          {!target && (
            <option value={project} disabled>
              {t("目标空间不可用", "Destination unavailable")}
            </option>
          )}
          {view.projects
            .filter((p) => !p.archived)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
        </select>
      </label>
      {target ? (
        <p>
          {t("本次位置", "Destination")} · {target.title} /{" "}
          {folder || t("根目录", "Root")}
        </p>
      ) : (
        <p role="alert">
          {t(
            "目标空间已归档或已移除，请选择其他空间。",
            "The destination is archived or unavailable. Choose another space.",
          )}
        </p>
      )}
      <div className="import-pick">
        <Upload size={26} />
        <p>{msg("选择文件或文件夹，也可以直接拖入应用")}</p>
        <button
          className="button"
          disabled={locked}
          onClick={() => void choose(false)}
        >
          {msg("选择文件（可多选）")}
        </button>
        <button
          className="button"
          disabled={locked}
          onClick={() => void choose(true)}
        >
          {msg("选择文件夹")}
        </button>
      </div>
      {paths.length > 0 && (
        <ul className="import-paths">
          {paths.map((p) => (
            <li key={p}>{p.split("/").at(-1)}</li>
          ))}
        </ul>
      )}
      {paths.length > 0 && target && !preview && !previewError && (
        <p role="status">{t("正在检查导入内容…", "Checking files…")}</p>
      )}
      {preview && (
        <div className="import-preview" role="status">
          <p>
            {t("导入预检", "Import preview")} · {preview.documents}{" "}
            {t("份文档", "documents")} · {preview.images}{" "}
            {t("张独立图片", "standalone images")} · {preview.attachments}{" "}
            {t("项附件", "assets")} · {preview.skipped} {t("项跳过", "skipped")}
          </p>
          {skip && (
            <p>
              {t(
                `其中 ${preview.existing ?? 0} 项已存在于目标空间，将跳过。`,
                `${preview.existing ?? 0} already in the destination space and will be skipped.`,
              )}
            </p>
          )}
          {!!preview.warnings.length && (
            <details>
              <summary>{t("查看预检说明", "Preview details")}</summary>
              {preview.warnings.map((w, i) => (
                <p key={i}>{w}</p>
              ))}
            </details>
          )}
        </div>
      )}
      {previewError && (
        <div role="alert">
          {previewError}{" "}
          <button disabled={locked} onClick={() => retryPreview((n) => n + 1)}>
            {t("重新检查", "Check again")}
          </button>
        </div>
      )}
      <div className="import-options">
        <label>
          <input
            type="checkbox"
            checked={skip}
            disabled={locked}
            onChange={(e) => {
              setSkip(e.target.checked);
              setItems([]);
              setResult(null);
            }}
          />
          {msg("跳过相同内容；同名不同内容自动保存副本")}
        </label>
        <label>
          <input
            type="checkbox"
            checked={attachments}
            disabled={locked}
            onChange={(e) => {
              setAttachments(e.target.checked);
              setItems([]);
              setResult(null);
            }}
          />
          {msg("一并复制源目录范围内的相对图片")}
        </label>
      </div>
      <p className="preview-help">
        {t(
          "文本每篇最多 2 MB，内嵌图片最多 8 MB。独立图片支持最多 64 MB 的 HEIC、HEIF、JPEG、PNG、WebP 或 GIF。文字识别在本机完成。",
          "Text files up to 2 MB, embedded images up to 8 MB. Import standalone HEIC, HEIF, JPEG, PNG, WebP or GIF files up to 64 MB. Text recognition runs on this Mac.",
        )}
      </p>
      {busy && (
        <div role="status">
          {msg("正在复制")} {progress.done} / {progress.total || msg("准备中")}
          <progress value={progress.done} max={progress.total || 1} />
        </div>
      )}
      {(result || items.length > 0) && (
        <div className="import-results">
          <strong>
            {result?.cancelled ? msg("已停止，可重试 · ") : ""}
            {msg("成功")} {imported.length} {msg("· 跳过")} {skipped.length}{" "}
            {msg("· 失败")} {failed.length}
          </strong>
          {items.map((i, n) => (
            <div className={"import-item " + i.status} key={i.source + n}>
              <span>{i.source.split("/").at(-1)}</span>
              <small>{i.message}</small>
              {i.documentId &&
                (i.status === "imported" || i.status === "skipped") &&
                !busy && (
                  <button onClick={() => onOpen(i.documentId!)}>
                    {i.status === "skipped"
                      ? msg("打开已有副本")
                      : msg("打开副本")}
                  </button>
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
        <button
          className={complete ? "button primary" : "button"}
          disabled={locked}
          onClick={close}
        >
          {result ? msg("完成") : msg("取消")}
        </button>
        {busy ? (
          <button
            className="button"
            disabled={stopping}
            onClick={() => void stop()}
          >
            {stopping ? msg("正在停止…") : msg("停止导入")}
          </button>
        ) : (
          !complete && (
            <button
              className="button primary"
              disabled={
                picking ||
                !paths.length ||
                !target ||
                !preview ||
                !(preview.documents + preview.images)
              }
              onClick={() => void run(retryFailed ? failed : [])}
            >
              {retryFailed
                ? msg("重试失败文件")
                : result
                  ? msg("重新检查并导入")
                  : msg("复制导入")}
            </button>
          )
        )}
      </div>
    </ModalDialog>
  );
}
