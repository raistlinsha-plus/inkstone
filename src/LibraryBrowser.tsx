import { isImeEvent } from "./platform/ime";
import { useRef, useState } from "react";
import { appVersion } from "./version";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import {
  FileText,
  FolderPlus,
  Upload,
  Plus,
  Trash2,
  FolderOpen,
  Download,
  MoreHorizontal,
  Pencil,
  History,
  RefreshCw,
  Pin,
  Link2,
} from "lucide-react";
import SourceReviewDialog from "./SourceReviewDialog";
import RelinkDialog from "./RelinkDialog";
import type { LibraryView, LibraryDocument, ImportTask } from "./library";
interface Props {
  view: LibraryView;
  projectId: string;
  compact?: boolean;
  busy: boolean;
  selected?: string;
  onProject: (id: string, committed?: boolean) => void;
  onOpen: (doc: LibraryDocument) => void;
  onNew: () => void;
  onImport: (task?: ImportTask) => void;
  onRefresh: () => Promise<void>;
  onTrash: (doc: LibraryDocument, restore: boolean) => Promise<void>;
  onBeforeAction: () => Promise<boolean>;
  onArchiveImport?: (task: ImportTask) => Promise<void>;
  onError: (e: unknown) => void;
  onDocumentChanged?: (doc: LibraryDocument) => Promise<void>;
  onMutationBusy?: (busy: boolean) => void;
  onSpaceRename?: (id: string, title: string) => void;
  pins?: string[];
  onPin?: (id: string, pinned: boolean) => Promise<void>;
  onIndex?: () => void;
  onBackup?: () => void;
}
export default function LibraryBrowser({
  view,
  projectId,
  compact,
  busy,
  selected,
  onProject,
  onOpen,
  onNew,
  onImport,
  onRefresh,
  onTrash,
  onBeforeAction,
  onArchiveImport,
  onError,
  onDocumentChanged,
  onMutationBusy,
  onSpaceRename,
  pins = [],
  onPin,
  onIndex,
  onBackup,
}: Props) {
  const [query, setQuery] = useState(""),
    [tab, setTab] = useState(compact ? "all" : "recent"),
    [projectName, setProjectName] = useState(""),
    [adding, setAdding] = useState(false),
    [menu, setMenu] = useState(""),
    [rename, setRename] = useState<LibraryDocument | null>(null),
    [title, setTitle] = useState("");
  const [review, setReview] = useState<{
    document: LibraryDocument;
    tab: "source" | "history";
  } | null>(null);
  const [renamingSpace, setRenamingSpace] = useState(false);
  const [spaceSaving, setSpaceSaving] = useState(false);
  const spaceFlight = useRef(false);
  const [sortBy, setSortBy] = useState("updated");
  const [typeFilter, setTypeFilter] = useState("all");
  const [relink, setRelink] = useState<LibraryDocument | null>(null);
  const [pinSaving, setPinSaving] = useState("");
  const menuTrigger = useRef<HTMLButtonElement | null>(null);
  const pendingImports = view.pendingImports.filter(
    (t) => t.projectId === projectId,
  );
  const project = view.projects.find((p) => p.id === projectId);
  const docs = view.documents
    .filter((d) =>
      tab === "trash" ? d.status === "trashed" : d.status === "ready",
    )
    .filter((d) => d.projectId === projectId)
    .filter((d) => tab !== "pinned" || pins.includes(d.id))
    .filter(
      (d) =>
        compact ||
        typeFilter === "all" ||
        (typeFilter === "md"
          ? /\.(md|markdown)$/i.test(d.path)
          : (d.path.split(".").at(-1)?.toLowerCase() ?? "") === typeFilter),
    )
    .filter((d) => d.title.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) =>
      tab === "recent" || sortBy === "opened"
        ? b.opened - a.opened || b.updated - a.updated
        : sortBy === "title"
          ? a.title.localeCompare(b.title, "zh-CN")
          : b.updated - a.updated,
    );
  const exportDoc = async (d?: LibraryDocument, bundle = true) => {
    try {
      if (!(await onBeforeAction())) return;
      const target = await save({
        defaultPath: bundle
          ? d
            ? d.title + " 附件包.zip"
            : (project?.title ?? "文档") + ".zip"
          : d?.title,
        filters: bundle
          ? [{ name: "含附件的文档包", extensions: ["zip"] }]
          : [{ name: "文档", extensions: [d?.path.split(".").at(-1) ?? "md"] }],
      });
      if (target)
        await invoke("library_export", {
          projectId: d?.projectId ?? projectId,
          documentId: d?.id ?? null,
          path: target,
          bundle,
        });
      setMenu("");
    } catch (e) {
      onError(e);
    }
  };
  return (
    <section
      className={`library-browser ${compact ? "compact" : ""}`}
      aria-label={compact ? "文档库侧栏" : "我的文档"}
      onKeyDown={(e) => {
        if (isImeEvent(e.nativeEvent)) return;
        if (e.key === "Escape" && (menu || rename || adding)) {
          e.stopPropagation();
          setMenu("");
          setRename(null);
          setAdding(false);
          menuTrigger.current?.focus();
        }
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setMenu("");
      }}
    >
      {!compact && (
        <header className="library-heading">
          <div>
            <span>LOCAL LIBRARY · v{appVersion}</span>
            <h1>{project?.title ?? "我的文档"}</h1>
            <p>接续最近的工作，或从置顶资料开始。文档副本保存在本机。</p>
          </div>
          <div>
            <button
              className="button"
              disabled={busy}
              onClick={() => void exportDoc()}
            >
              <Download size={15} />
              导出空间
            </button>
            <button className="button primary" disabled={busy} onClick={onNew}>
              <Plus size={15} />
              新建文档
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() => onImport()}
            >
              <Upload size={15} />
              导入文档
            </button>
          </div>
        </header>
      )}
      {!compact && (
        <div className="workbench-overview">
          <div>
            <strong>
              {
                view.documents.filter(
                  (d) => d.projectId === projectId && d.status === "ready",
                ).length
              }
            </strong>
            <span>空间文档</span>
          </div>
          <div>
            <strong>
              {
                view.documents.filter(
                  (d) =>
                    d.projectId === projectId &&
                    d.status === "ready" &&
                    pins.includes(d.id),
                ).length
              }
            </strong>
            <span>置顶资料</span>
          </div>
          <button onClick={onIndex} disabled={busy || !onIndex}>
            查看逐文档索引<span>核对关键词、向量与正文版本</span>
          </button>
          <button onClick={onBackup} disabled={busy || !onBackup}>
            备份与恢复预演<span>正文、附件、历史与恢复草稿</span>
          </button>
        </div>
      )}
      <div className="library-controls">
        {compact && (
          <div className="library-project">
            <select
              aria-label={compact ? "当前空间" : "文档空间"}
              disabled={busy}
              value={projectId}
              onChange={(e) => {
                setTab("all");
                onProject(e.target.value);
              }}
            >
              {view.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
            <button
              title="新建空间"
              aria-label="新建空间"
              disabled={busy}
              onClick={() => {
                setRenamingSpace(false);
                setProjectName("");
                setAdding(!adding);
              }}
            >
              <FolderPlus size={16} />
            </button>
            <button
              className="icon-button"
              title="重命名空间"
              aria-label="重命名空间"
              disabled={busy}
              onClick={() => {
                setRenamingSpace(true);
                setProjectName(project?.title ?? "");
                setAdding(true);
              }}
            >
              <Pencil size={16} />
            </button>
            {!compact && (
              <>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => void exportDoc()}
                >
                  <Download size={14} />
                  导出空间
                </button>
                <button
                  className="text-button"
                  onClick={() =>
                    void invoke("library_reveal", { projectId }).catch(onError)
                  }
                >
                  <FolderOpen size={14} />
                  在访达中显示
                </button>
              </>
            )}
          </div>
        )}
        {adding && (
          <form
            className="library-inline-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (spaceFlight.current) return;
              spaceFlight.current = true;
              setSpaceSaving(true);
              let committed = false;
              try {
                if (!(await onBeforeAction())) return;
                onMutationBusy?.(true);
                const p = await invoke<{ id: string }>(
                  renamingSpace
                    ? "library_rename_project"
                    : "library_create_project",
                  {
                    ...(renamingSpace ? { id: projectId } : {}),
                    title: projectName,
                  },
                );
                committed = true;
                setAdding(false);
                setProjectName("");
                await onRefresh();
                onMutationBusy?.(false);
                if (renamingSpace) onSpaceRename?.(p.id, projectName.trim());
                else onProject(p.id, true);
              } catch (e) {
                onError(
                  committed
                    ? `空间已保存，列表刷新失败，请刷新后查看：${String(e)}`
                    : e,
                );
              } finally {
                spaceFlight.current = false;
                setSpaceSaving(false);
                onMutationBusy?.(false);
              }
            }}
          >
            <input
              autoFocus
              aria-label="空间名称"
              placeholder="空间名称"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
            />
            <button
              type="button"
              disabled={spaceSaving}
              onClick={() => setAdding(false)}
            >
              取消
            </button>
            <button type="submit" disabled={spaceSaving || busy}>
              {renamingSpace ? "保存名称" : "创建"}
            </button>
          </form>
        )}
        {compact && (
          <div className="library-shortcuts">
            <button disabled={busy} onClick={onNew}>
              <Plus size={15} />
              新建
            </button>
            <button disabled={busy} onClick={() => onImport()}>
              导入文档
            </button>
          </div>
        )}
        {compact && (
          <input
            className="library-search"
            aria-label={compact ? "查找文档" : "搜索我的文档"}
            placeholder="查找文档标题…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
        <div className="library-tabs">
          {(compact
            ? [
                ["all", "空间文档"],
                ["trash", "回收站"],
              ]
            : [
                ["recent", "最近"],
                ["pinned", "置顶"],
                ["all", "全部资料"],
              ]
          ).map(([id, label]) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {!compact && (
          <div
            className="workbench-type-filter"
            role="group"
            aria-label="文档类型筛选"
          >
            {[
              ["all", "全部类型"],
              ["md", "Markdown"],
              ["txt", "纯文本"],
              ["json", "JSON"],
              ["mmd", "Mermaid"],
            ].map(([id, label]) => (
              <button
                key={id}
                aria-pressed={typeFilter === id}
                onClick={() => setTypeFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="library-list-meta">
          <span>
            {docs.length} 篇{tab === "trash" ? "已移除文档" : "文档"}
            {query ? "匹配" : ""}
          </span>
          {!compact && tab !== "recent" && (
            <label>
              排序
              <select
                aria-label="文档排序"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
              >
                <option value="updated">最近修改</option>
                <option value="opened">最近打开</option>
                <option value="title">标题</option>
              </select>
            </label>
          )}
        </div>
      </div>
      {!compact && pendingImports.length > 0 && (
        <div className="import-recovery">
          <strong>有可重试的导入记录</strong>
          {pendingImports.slice(0, 3).map((t) => (
            <div key={t.id}>
              <span>
                {view.projects.find((p) => p.id === t.projectId)?.title} ·{" "}
                {t.status === "cancelled"
                  ? "已停止"
                  : t.status === "partial"
                    ? "有失败项"
                    : "上次中断"}
              </span>
              <button disabled={busy} onClick={() => onImport(t)}>
                重试未完成项
              </button>
              <button
                disabled={busy}
                aria-label="归档导入记录"
                onClick={() =>
                  void (async () => {
                    if (onArchiveImport) await onArchiveImport(t);
                    else await invoke("library_archive_import", { id: t.id });
                    await onRefresh();
                  })().catch(onError)
                }
              >
                归档
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="library-documents">
        {docs.length ? (
          docs.slice(0, tab === "recent" ? 50 : 2000).map((d) => (
            <div
              key={d.id}
              className={`library-document ${selected === d.path && d.projectId === projectId ? "selected" : ""}`}
            >
              <button
                className="library-open"
                title={d.title}
                disabled={busy}
                onClick={() => {
                  setMenu("");
                  if (d.status === "trashed")
                    void onTrash(d, true).catch(onError);
                  else onOpen(d);
                }}
              >
                {pins.includes(d.id) ? (
                  <Pin size={compact ? 14 : 20} aria-label="已置顶" />
                ) : (
                  <FileText size={compact ? 14 : 20} />
                )}
                <span>
                  <strong>{d.title}</strong>
                  {(!compact || tab === "recent") && (
                    <small>
                      {view.projects.find((p) => p.id === d.projectId)?.title} ·{" "}
                      {d.opened
                        ? "最近打开 " +
                          new Date(d.opened * 1000).toLocaleDateString("zh-CN")
                        : "本地文档"}
                      {d.source ? " · 已导入副本" : ""}
                    </small>
                  )}
                </span>
              </button>
              {d.status === "trashed" ? (
                <button
                  aria-label={"恢复 " + d.title}
                  onClick={() => void onTrash(d, true).catch(onError)}
                >
                  恢复
                </button>
              ) : (
                <button
                  aria-label={"文档操作 " + d.title}
                  aria-expanded={menu === d.id}
                  aria-haspopup="true"
                  onClick={(e) => {
                    menuTrigger.current = e.currentTarget;
                    setMenu(menu === d.id ? "" : d.id);
                  }}
                >
                  <MoreHorizontal size={15} />
                </button>
              )}
              {menu === d.id && (
                <div
                  className="library-doc-menu"
                  role="group"
                  aria-label={d.title + "的操作"}
                >
                  {onPin && (
                    <button
                      disabled={busy || !!pinSaving}
                      onClick={() =>
                        void (async () => {
                          setPinSaving(d.id);
                          try {
                            await onPin(d.id, !pins.includes(d.id));
                            setMenu("");
                          } catch (e) {
                            onError(e);
                          } finally {
                            setPinSaving("");
                          }
                        })()
                      }
                    >
                      <Pin size={14} />
                      {pins.includes(d.id) ? "取消置顶" : "置顶文档"}
                    </button>
                  )}
                  {d.source && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void (async () => {
                          if (!(await onBeforeAction())) return;
                          setMenu("");
                          setRelink(d);
                        })().catch(onError)
                      }
                    >
                      <Link2 size={14} />
                      重新关联链接
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setRename(d);
                      setTitle(d.title);
                      setMenu("");
                    }}
                  >
                    重命名标题
                  </button>
                  {d.source && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void (async () => {
                          if (!(await onBeforeAction())) return;
                          setMenu("");
                          setReview({ document: d, tab: "source" });
                        })().catch(onError)
                      }
                    >
                      <RefreshCw size={14} />
                      检查来源更新
                    </button>
                  )}
                  <button
                    disabled={busy}
                    onClick={() =>
                      void (async () => {
                        if (!(await onBeforeAction())) return;
                        setMenu("");
                        setReview({ document: d, tab: "history" });
                      })().catch(onError)
                    }
                  >
                    <History size={14} />
                    历史版本
                  </button>
                  <button onClick={() => void exportDoc(d, false)}>
                    导出文件
                  </button>
                  <button onClick={() => void exportDoc(d, true)}>
                    导出含附件包
                  </button>
                  <button
                    onClick={() =>
                      void onTrash(d, false)
                        .then(() => setMenu(""))
                        .catch(onError)
                    }
                  >
                    <Trash2 size={12} />
                    移到回收站
                  </button>
                </div>
              )}
            </div>
          ))
        ) : (
          <div className="library-empty">
            <FileText size={25} />
            <p>{tab === "trash" ? "回收站为空" : "还没有匹配的文档"}</p>
            {tab !== "trash" && (
              <button disabled={busy} onClick={() => onImport()}>
                导入本地文件，或新建一篇文档
              </button>
            )}
          </div>
        )}
      </div>
      {relink && (
        <RelinkDialog
          key={relink.id}
          document={relink}
          onClose={() => setRelink(null)}
          onBusy={onMutationBusy ?? (() => {})}
          onChanged={async (d) => {
            await onRefresh();
            await onDocumentChanged?.(d);
          }}
        />
      )}
      {review && (
        <SourceReviewDialog
          document={review.document}
          spaceName={
            view.projects.find((p) => p.id === review.document.projectId)?.title
          }
          initialTab={review.tab}
          onClose={() => setReview(null)}
          onBusy={onMutationBusy ?? (() => {})}
          onChanged={async (doc) => {
            await onRefresh();
            await onDocumentChanged?.(doc);
          }}
        />
      )}
      {rename && (
        <form
          className="library-rename"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              if (!(await onBeforeAction())) return;
              await invoke("library_rename", { id: rename.id, title });
              await onRefresh();
              setRename(null);
            } catch (e) {
              onError(e);
            }
          }}
        >
          <label>
            文档标题
            <input
              autoFocus
              aria-label="新文档标题"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <button type="button" onClick={() => setRename(null)}>
            取消
          </button>
          <button type="submit">保存标题</button>
        </form>
      )}
    </section>
  );
}
