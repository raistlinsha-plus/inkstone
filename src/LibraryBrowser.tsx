import DirectImagePreview from "./library/DirectImagePreview";
import { open as chooseFile } from "@tauri-apps/plugin-dialog";
import {
  FolderPath,
  childFolders,
  folderParent,
  folderName,
} from "./library/FolderPath";
import { imageName, mindName, label } from "./library/mediaTypes";
import { layout, empty, FolderTree } from "./library/Organization";

import { Image as Photo, Network, Layers, Folder } from "lucide-react";
import ModalDialog from "./ModalDialog";
import { translate as t, msg, documentCount } from "./i18n";
import {
  dismissDetailsOnOutside,
  dismissOnOutside,
  focusMenuButton,
} from "./platform/menu";
import { imeBoundary, isImeEvent } from "./platform/ime";
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  selectDocuments,
  type LibraryTab,
  type DocumentSort,
} from "./library/selectors";
import { useViewPreferences } from "./library/useViewPreferences";
import TrashDialog from "./library/TrashDialog";
import { invoke } from "@tauri-apps/api/core";
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
  Database,
  Archive,
  Link2,
  Search,
} from "lucide-react";
import SourceReviewDialog from "./SourceReviewDialog";
import RelinkDialog from "./RelinkDialog";
import type { LibraryView, LibraryDocument, ImportTask } from "./library";
interface Props {
  view: LibraryView;
  projectId: string;
  compact?: boolean;
  browseFolder?: string;
  onBrowseFolder?: (path: string) => void;
  onSpaces?: () => void;
  folderNavigation?: Map<string, { top: number; focus: string }>;
  busy: boolean;
  selected?: string;
  onProject: (id: string, committed?: boolean) => void;
  onOpen: (doc: LibraryDocument) => void;
  onNew: (folder?: string) => void;
  onImport: (task?: ImportTask, folder?: string) => void;
  onSearch?: () => void;
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
  firstUseGuide?: ReactNode;
}
export default function LibraryBrowser({
  view,
  projectId,
  compact,
  browseFolder,
  onBrowseFolder,
  onSpaces,
  folderNavigation,
  busy,
  selected,
  onProject,
  onOpen,
  onNew,
  onImport,
  onSearch,
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
  firstUseGuide,
}: Props) {
  const [query, setQuery] = useState(""),
    [tab, setTab] = useState<LibraryTab>("all"),
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
  const {
    preferences,
    update: updateView,
    warning: viewWarning,
  } = useViewPreferences(projectId);
  const sortBy = preferences.sort;
  const listRef = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ id: string; offset: number } | null>(null);
  function rememberAnchor() {
    const list = listRef.current;
    if (!list) return;
    const top = list.getBoundingClientRect().top;
    const row = Array.from(
      list.querySelectorAll<HTMLElement>("[data-document-id]"),
    ).find((el) => el.getBoundingClientRect().bottom > top);
    anchor.current = row
      ? {
          id: row.dataset.documentId!,
          offset: row.getBoundingClientRect().top - top,
        }
      : null;
  }
  useEffect(() => {
    setTab("all");
    setMenu("");
    setQuery("");
    anchor.current = null;
  }, [projectId]);
  const [typeFilter, setTypeFilter] = useState("all");
  const [relink, setRelink] = useState<LibraryDocument | null>(null);
  const [trashDetail, setTrashDetail] = useState<LibraryDocument | null>(null);
  const [pinSaving, setPinSaving] = useState("");
  const menuTrigger = useRef<HTMLButtonElement | null>(null);
  const popup = useRef<HTMLDivElement>(null);
  const entryKey = useRef("Home");
  useLayoutEffect(() => {
    if (!menu || !popup.current || !menuTrigger.current) return;
    const panel = popup.current;
    const trigger = menuTrigger.current;
    const anchor = trigger.getBoundingClientRect();
    const gap = 4;
    const margin = 8;
    const above = anchor.top - gap - margin;
    const below = window.innerHeight - anchor.bottom - gap - margin;
    const placeAbove = below < panel.offsetHeight && above > below;
    panel.style.left =
      Math.max(
        margin,
        Math.min(
          window.innerWidth - panel.offsetWidth - margin,
          anchor.right - panel.offsetWidth,
        ),
      ) + "px";
    if (placeAbove)
      panel.style.bottom = window.innerHeight - anchor.top + gap + "px";
    else panel.style.top = anchor.bottom + gap + "px";
    panel.style.maxHeight = Math.max(0, placeAbove ? above : below) + "px";
    focusMenuButton(panel, entryKey.current);
    const close = () => setMenu("");
    const unwatch = dismissOnOutside(
      (event) =>
        event.composedPath().includes(panel) ||
        event.composedPath().includes(trigger),
      close,
    );
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && event.target.contains(trigger))
        close();
    };
    window.addEventListener("resize", close);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      unwatch();
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [menu]);
  const pendingImports = view.pendingImports.filter(
    (t) => t.projectId === projectId,
  );
  const project = view.projects.find((p) => p.id === projectId);
  const [organ, setOrgan] = useState(empty),
    [localFolder, setLocalFolder] = useState("");
  const folder = browseFolder ?? localFolder;
  const destination = folder;
  const navigate = (path: string) => {
    setTab("all");
    setQuery("");
    setTypeFilter("all");
    if (onBrowseFolder) onBrowseFolder(path);
    else setLocalFolder(path);
  };
  const pageRef = useRef<HTMLElement>(null);
  const [loadedProject, setLoadedProject] = useState("");
  const navigationKey = projectId + "/" + folder;
  function rememberEntry(key: string) {
    if (!compact && pageRef.current)
      folderNavigation?.set(navigationKey, {
        top: pageRef.current.scrollTop,
        focus: key,
      });
  }
  useLayoutEffect(() => {
    if (
      compact ||
      !folderNavigation ||
      !pageRef.current ||
      loadedProject !== projectId
    )
      return;
    const page = pageRef.current;
    const saved = folderNavigation.get(navigationKey);
    page.scrollTop = saved?.top ?? 0;
    const frame = requestAnimationFrame(() => {
      const target = [
        ...page.querySelectorAll<HTMLButtonElement>("[data-nav-key]"),
      ].find((b) => b.dataset.navKey === saved?.focus);
      if (
        target &&
        (!window.document.activeElement ||
          window.document.activeElement === window.document.body ||
          page.contains(window.document.activeElement))
      )
        target.focus({ preventScroll: true });
      page.scrollTop = saved?.top ?? 0;
    });
    const capture = (e: FocusEvent) => {
      const key = (e.target as HTMLElement).closest<HTMLElement>(
        "[data-nav-key]",
      )?.dataset.navKey;
      if (key) rememberEntry(key);
    };
    const scroll = () =>
      folderNavigation.set(navigationKey, {
        top: page.scrollTop,
        focus: folderNavigation.get(navigationKey)?.focus ?? "",
      });
    page.addEventListener("focusin", capture);
    page.addEventListener("scroll", scroll);
    return () => {
      cancelAnimationFrame(frame);
      page.removeEventListener("focusin", capture);
      page.removeEventListener("scroll", scroll);
    };
  }, [compact, loadedProject, navigationKey, projectId, folderNavigation]);
  useEffect(() => {
    if (!compact) {
      setTab("all");
      setQuery("");
      setTypeFilter("all");
    }
  }, [folder, compact]);
  const treeVisible =
    compact && tab === "all" && !query && organ.folders.length > 0;

  const [action, setAction] = useState(""),
    [value, setValue] = useState(""),
    [prompt, setPrompt] = useState(""),
    [model, setModel] = useState(""),
    [working, setWorking] = useState(false);
  const [moveDoc, setMoveDoc] = useState("");
  useEffect(() => {
    setLocalFolder("");
    setOrgan(empty);
    let live = true;
    function reload() {
      if ("__TAURI_INTERNALS__" in window)
        void layout(projectId)
          .then((v) => {
            if (live) {
              setOrgan(v);
              setLoadedProject(projectId);
            }
          })
          .catch(onError);
    }
    reload();
    window.addEventListener("inkstone-folders", reload);
    return () => {
      live = false;
      window.removeEventListener("inkstone-folders", reload);
    };
  }, [projectId]);
  const [previewFiles, setPreviewFiles] = useState<string[]>([]);
  async function pickImages() {
    try {
      const files = await chooseFile({
        multiple: true,
        filters: [
          {
            name: t("图片", "Images"),
            extensions: ["heic", "heif", "jpg", "jpeg", "png", "webp", "gif"],
          },
        ],
      });
      if (files) setPreviewFiles(Array.isArray(files) ? files : [files]);
    } catch (e) {
      onError(e);
    }
  }
  function startAction(kind: string) {
    setValue(
      kind === "renameFolder"
        ? folderName(folder)
        : kind === "moveFolder"
          ? folderParent(folder)
          : "",
    );
    setPrompt("");
    setMenu("");
    setAction(kind);
  }
  async function applyAction() {
    if (working || busy) return;
    setWorking(true);
    let doc: LibraryDocument | undefined;
    try {
      if (action === "folder") {
        const leaf = value.trim();
        if (!leaf || leaf.includes("/"))
          throw Error(t("请输入单个文件夹名称", "Enter a single folder name"));
        const path = destination ? destination + "/" + leaf : leaf;
        await layout(projectId, "folder", path);
        navigate(path);
        setTab("all");
      } else if (action === "renameFolder" || action === "moveFolder") {
        const name =
          action === "renameFolder" ? value.trim() : folderName(folder);
        if (!name || name.includes("/"))
          throw Error(t("请输入单个文件夹名称", "Enter a single folder name"));
        const parent = action === "renameFolder" ? folderParent(folder) : value;
        const target = parent ? parent + "/" + name : name;
        if (target !== folder) {
          setOrgan(await layout(projectId, "relocateFolder", target, folder));
          navigate(target);
        }
      } else if (action === "deleteFolder") {
        setOrgan(await layout(projectId, "deleteFolder", "", folder));
        navigate(folderParent(folder));
      } else if (action === "move") {
        await layout(projectId, "move", value, moveDoc);
      } else {
        if (!(await onBeforeAction())) return;
        if (action === "paste") {
          doc = await invoke<LibraryDocument>("library_create_document", {
            projectId,
            folder: destination,
            title: /\.md$/i.test(value.trim())
              ? value.trim()
              : value.trim() + ".md",
            content: prompt,
          });
        } else if (action === "map") {
          const title = value.trim() || t("思维脑图", "Mind map");
          doc = await invoke<LibraryDocument>("library_create_document", {
            projectId,
            title: title + ".mindmap.md",
            folder: destination,
            content:
              "# " + title + "\n\n- " + t("第一个想法", "First idea") + "\n",
          });
        } else {
          doc = await invoke<LibraryDocument>("media_generate", {
            projectId,
            title: value.trim(),
            prompt,
            model,
            folder: destination,
          });
        }
      }
      window.dispatchEvent(new Event("inkstone-folders"));
      await onRefresh();
      setAction("");
      if (doc) onOpen(doc);
    } catch (e) {
      onError(e);
    } finally {
      setWorking(false);
    }
  }
  const allDocs = selectDocuments(
    view.documents,
    projectId,
    tab,
    sortBy,
    query,
    pins,
    compact ? "all" : typeFilter,
  );
  const inDirectory = !compact && tab === "all";
  const docs = inDirectory
    ? allDocs.filter((doc) => (organ.locations[doc.id] ?? "") === folder)
    : allDocs;
  const directories =
    inDirectory && typeFilter === "all"
      ? childFolders(organ.folders, folder).filter((f) =>
          folderName(f)
            .toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase()),
        )
      : [];
  const readyDocuments = compact
    ? []
    : view.documents.filter(
        (doc) => doc.projectId === projectId && doc.status === "ready",
      );
  const showingFirstUse =
    !compact && !folder && !!firstUseGuide && readyDocuments.length === 0;
  const filtered = Boolean(query || (!compact && typeFilter !== "all"));
  const order = docs.map((d) => d.id).join("|") + preferences.pinnedCollapsed;
  useLayoutEffect(() => {
    const list = listRef.current,
      old = anchor.current;
    if (list && old) {
      const row = Array.from(
        list.querySelectorAll<HTMLElement>("[data-document-id]"),
      ).find((el) => el.dataset.documentId === old.id);
      if (row)
        list.scrollTop +=
          row.getBoundingClientRect().top -
          list.getBoundingClientRect().top -
          old.offset;
    }
    rememberAnchor();
  }, [order]);
  const exportDoc = async (
    d?: LibraryDocument,
    format: "bundle" | "document" | "original" = "bundle",
  ) => {
    try {
      if (!(await onBeforeAction())) return;
      if (d && format === "original") {
        await invoke("media_export_original", { documentId: d.id });
        return;
      }
      await invoke("library_export", {
        projectId: d?.projectId ?? projectId,
        documentId: d?.id ?? null,
        bundle: format === "bundle",
      });
    } catch (e) {
      onError(e);
    }
  };
  const renderRows = (scopedDocs: LibraryDocument[]) =>
    scopedDocs.slice(0, tab === "recent" ? 50 : 2000).map((d, i) => (
      <Fragment key={d.id}>
        {tab === "all" && pins.includes(d.id) && i === 0 && (
          <button
            className="library-pin-heading"
            aria-expanded={!preferences.pinnedCollapsed}
            onClick={() =>
              updateView({
                ...preferences,
                pinnedCollapsed: !preferences.pinnedCollapsed,
              })
            }
          >
            {msg("置顶 ·")}{" "}
            {preferences.pinnedCollapsed ? msg("展开") : msg("收起")}
          </button>
        )}
        {tab === "all" &&
          !pins.includes(d.id) &&
          i > 0 &&
          pins.includes(scopedDocs[i - 1].id) && (
            <div className="library-pin-heading">{msg("空间文档")}</div>
          )}
        {!(
          tab === "all" &&
          pins.includes(d.id) &&
          preferences.pinnedCollapsed
        ) && (
          <div
            key={d.id}
            data-document-id={d.id}
            className={`library-document ${selected === d.path && d.projectId === projectId ? "selected" : ""}`}
          >
            <button
              className="library-open"
              data-nav-key={d.id}
              title={d.title}
              aria-current={
                selected === d.path && d.projectId === projectId
                  ? "page"
                  : undefined
              }
              disabled={busy}
              onClick={() => {
                setMenu("");
                rememberEntry(d.id);
                if (d.status !== "ready") setTrashDetail(d);
                else onOpen(d);
              }}
            >
              {pins.includes(d.id) ? (
                <Pin size={compact ? 14 : 20} aria-label={msg("已置顶")} />
              ) : imageName(d.path) ? (
                <Photo size={compact ? 14 : 20} />
              ) : mindName(d.path) ? (
                <Network size={compact ? 14 : 20} />
              ) : (
                <FileText size={compact ? 14 : 20} />
              )}
              <span>
                <strong>{label(d.title)}</strong>
                {(!compact || tab === "recent") && (
                  <small>
                    {view.projects.find((p) => p.id === d.projectId)?.title} ·{" "}
                    {d.opened
                      ? "最近打开 " +
                        new Date(d.opened * 1000).toLocaleDateString(undefined)
                      : msg("本地文档")}
                    {d.source ? msg(" · 已导入副本") : ""}
                  </small>
                )}
              </span>
            </button>
            {d.status !== "ready" ? (
              <>
                <button
                  disabled={busy || d.status === "purging"}
                  aria-label={"恢复 " + d.title}
                  onClick={() => void onTrash(d, true).catch(onError)}
                >
                  {msg("恢复")}
                </button>
                <button
                  aria-label={"回收站操作 " + d.title}
                  disabled={busy}
                  onClick={() => setTrashDetail(d)}
                >
                  {d.status === "purging" ? (
                    msg("删除未完成")
                  ) : (
                    <MoreHorizontal size={15} />
                  )}
                </button>
              </>
            ) : (
              <button
                aria-label={"文档操作 " + d.title}
                aria-expanded={menu === d.id}
                aria-haspopup="menu"
                onKeyDown={(e) => {
                  if (
                    isImeEvent(e.nativeEvent) ||
                    !["ArrowDown", "ArrowUp"].includes(e.key)
                  )
                    return;
                  e.preventDefault();
                  entryKey.current = e.key;
                  menuTrigger.current = e.currentTarget;
                  setMenu(d.id);
                }}
                onClick={(e) => {
                  entryKey.current = "Home";
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
                ref={popup}
                role="menu"
                onKeyDown={(e) => {
                  if (
                    isImeEvent(e.nativeEvent) ||
                    !["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)
                  )
                    return;
                  e.preventDefault();
                  e.stopPropagation();
                  focusMenuButton(e.currentTarget, e.key);
                }}
                onClick={(e) => {
                  if (!(e.target as HTMLElement).closest("button")) return;
                  menuTrigger.current?.focus({ preventScroll: true });
                  setMenu("");
                }}
                aria-label={d.title + "的操作"}
              >
                {onPin && (
                  <button
                    role="menuitem"
                    tabIndex={-1}
                    disabled={busy || !!pinSaving}
                    onClick={() =>
                      void (async () => {
                        setPinSaving(d.id);
                        try {
                          await onPin(d.id, !pins.includes(d.id));
                        } catch (e) {
                          onError(e);
                        } finally {
                          setPinSaving("");
                        }
                      })()
                    }
                  >
                    <Pin size={14} />
                    {pins.includes(d.id) ? msg("取消置顶") : msg("置顶文档")}
                  </button>
                )}
                {d.source && (
                  <button
                    role="menuitem"
                    tabIndex={-1}
                    disabled={busy}
                    onClick={() =>
                      void (async () => {
                        if (!(await onBeforeAction())) return;
                        setRelink(d);
                      })().catch(onError)
                    }
                  >
                    <Link2 size={14} />
                    {msg("重新关联链接")}
                  </button>
                )}
                <button
                  role="menuitem"
                  tabIndex={-1}
                  onClick={() => {
                    setRename(d);
                    setTitle(d.title);
                  }}
                >
                  {msg("重命名标题")}
                </button>
                <button
                  role="menuitem"
                  tabIndex={-1}
                  onClick={() => {
                    setMoveDoc(d.id);
                    startAction("move");
                    setValue(organ.locations[d.id] || "");
                  }}
                >
                  <Folder size={14} />
                  {t("移动到文件夹", "Move to folder")}
                </button>
                {d.source && (
                  <button
                    role="menuitem"
                    tabIndex={-1}
                    disabled={busy}
                    onClick={() =>
                      void (async () => {
                        if (!(await onBeforeAction())) return;
                        setReview({ document: d, tab: "source" });
                      })().catch(onError)
                    }
                  >
                    <RefreshCw size={14} />
                    {msg("检查来源更新")}
                  </button>
                )}
                <button
                  role="menuitem"
                  tabIndex={-1}
                  disabled={busy}
                  onClick={() =>
                    void (async () => {
                      if (!(await onBeforeAction())) return;
                      setReview({ document: d, tab: "history" });
                    })().catch(onError)
                  }
                >
                  <History size={14} />
                  {msg("历史版本")}
                </button>
                {imageName(d.path) && (
                  <button
                    role="menuitem"
                    tabIndex={-1}
                    onClick={() => void exportDoc(d, "original")}
                  >
                    {t("导出原图", "Export original")}
                  </button>
                )}
                <button
                  role="menuitem"
                  tabIndex={-1}
                  onClick={() => void exportDoc(d, "document")}
                >
                  {imageName(d.path)
                    ? t("导出 Markdown 说明", "Export Markdown description")
                    : msg("导出文件")}
                </button>
                <button
                  role="menuitem"
                  tabIndex={-1}
                  onClick={() => void exportDoc(d)}
                >
                  {msg("导出含附件包")}
                </button>
                <button
                  role="menuitem"
                  tabIndex={-1}
                  onClick={() => void onTrash(d, false).catch(onError)}
                >
                  <Trash2 size={12} />
                  {msg("移到回收站")}
                </button>
              </div>
            )}
          </div>
        )}
      </Fragment>
    ));
  return (
    <section
      ref={pageRef}
      data-library-drop-folder={compact ? undefined : folder}
      onPaste={(e) => {
        if (
          compact ||
          busy ||
          action ||
          (e.target as HTMLElement).closest(
            "input, textarea, [contenteditable=true]",
          )
        )
          return;
        const text = e.clipboardData.getData("text/plain");
        if (!text.trim()) return;
        e.preventDefault();
        startAction("paste");
        setValue(t("剪贴笔记", "Clipboard note"));
        setPrompt(text);
      }}
      className={`library-browser ${compact ? "compact" : ""}`}
      aria-label={compact ? msg("文档库侧栏") : msg("我的文档")}
      onKeyDown={(e) => {
        if (isImeEvent(e.nativeEvent)) return;
        if (menu && (e.key === "Escape" || e.key === "Tab")) {
          if (e.key === "Escape") e.preventDefault();
          e.stopPropagation();
          menuTrigger.current?.focus({ preventScroll: true });
          setMenu("");
        } else if (e.key === "Escape" && (rename || adding)) {
          e.stopPropagation();
          setRename(null);
          setAdding(false);
          menuTrigger.current?.focus();
        }
      }}
    >
      {compact && (
        <div className="space-entry">
          <button disabled={busy} onClick={onSpaces}>
            <Layers size={15} />
            {t("我的空间", "My spaces")}
          </button>
          <details
            ref={dismissDetailsOnOutside}
            onClick={(e) => {
              if ((e.target as Element).closest("button"))
                e.currentTarget.open = false;
            }}
          >
            <summary>{t("创建与整理", "Create and organize")}</summary>
            <div>
              <button onClick={() => void pickImages()}>
                {t("打开图片…", "Open images…")}
              </button>
              <button onClick={() => startAction("folder")}>
                {t("新建文件夹", "New folder")}
              </button>
              <button onClick={() => startAction("map")}>
                {t("新建独立脑图", "New mind map")}
              </button>
              <button onClick={() => startAction("generate")}>
                {t("生成图片", "Generate image")}
              </button>
            </div>
          </details>
        </div>
      )}
      {previewFiles.length > 0 && (
        <DirectImagePreview
          files={previewFiles}
          projectId={projectId}
          projectTitle={project?.title ?? projectId}
          onClose={() => setPreviewFiles([])}
          folder={destination}
          locations={organ.locations}
          onOpen={(doc) => {
            setPreviewFiles([]);
            onOpen(doc);
          }}
          onImport={async () => {
            window.dispatchEvent(new Event("inkstone-folders"));
            await onRefresh();
          }}
        />
      )}
      {action && (
        <ModalDialog
          label={t("空间操作", "Space action")}
          busy={working}
          onClose={() => setAction("")}
        >
          <form
            className="space-form"
            {...imeBoundary}
            onSubmit={(e) => {
              e.preventDefault();
              void applyAction();
            }}
          >
            <h2>
              {action === "renameFolder"
                ? t("重命名文件夹", "Rename folder")
                : action === "moveFolder"
                  ? t("移动文件夹", "Move folder")
                  : action === "deleteFolder"
                    ? t("删除空文件夹", "Delete empty folder")
                    : action === "paste"
                      ? t("将文本粘贴为文档", "Paste text as a document")
                      : action === "folder"
                        ? t("新建文件夹", "New folder")
                        : action === "move"
                          ? t("移动到文件夹", "Move to folder")
                          : action === "map"
                            ? t("新建脑图", "New mind map")
                            : t("生成图片", "Generate image")}
            </h2>
            {action === "deleteFolder" ? (
              <p>
                {t("删除文件夹", "Delete folder")}「{folder}」？
              </p>
            ) : action === "move" || action === "moveFolder" ? (
              <select
                aria-label="Destination"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              >
                <option value="">{t("空间根目录", "Space root")}</option>
                {organ.folders
                  .filter(
                    (f) =>
                      action !== "moveFolder" ||
                      (f !== folder && !f.startsWith(folder + "/")),
                  )
                  .map((f) => (
                    <option key={f}>{f}</option>
                  ))}
              </select>
            ) : (
              <input
                aria-label="Name"
                autoFocus
                placeholder={t("名称", "Name")}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            )}
            {action === "paste" && (
              <textarea
                autoFocus
                required
                aria-label={t("粘贴的文本", "Pasted text")}
                placeholder={t("在这里粘贴文本…", "Paste your text here…")}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            )}
            {action === "generate" && (
              <>
                <p>
                  {t(
                    "使用问答服务地址和凭据，调用图像生成接口。",
                    "Uses the chat service endpoint and credentials for image generation.",
                  )}
                </p>
                <input
                  required
                  placeholder={t("生图模型 ID", "Image model ID")}
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                />
                <textarea
                  required
                  placeholder={t("描述要生成的图片", "Describe the image")}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </>
            )}
            <div>
              <button
                type="button"
                disabled={working}
                onClick={() => setAction("")}
              >
                {msg("取消")}
              </button>
              <button
                disabled={
                  working ||
                  busy ||
                  (!["move", "moveFolder", "deleteFolder"].includes(action) &&
                    !value.trim()) ||
                  (action === "paste" && !prompt.trim())
                }
              >
                {working ? t("处理中…", "Working…") : msg("确定")}
              </button>
            </div>
          </form>
        </ModalDialog>
      )}
      {!compact && (
        <FolderPath
          space={project?.title ?? msg("我的文档")}
          path={folder}
          onFolder={navigate}
          onSpaces={() => onSpaces?.()}
        />
      )}
      {!compact && (
        <header className="library-heading">
          <div>
            <h1>{folderName(folder) || project?.title || msg("我的文档")}</h1>
            <p>
              {folder
                ? documentCount(
                    view.documents.filter(
                      (d) =>
                        d.projectId === projectId &&
                        d.status === "ready" &&
                        organ.locations[d.id] === folder,
                    ).length,
                  )
                : documentCount(readyDocuments.length)}
              {" · "}
              {
                readyDocuments.filter(
                  (doc) =>
                    pins.includes(doc.id) &&
                    (!folder || organ.locations[doc.id] === folder),
                ).length
              }{" "}
              {msg("篇置顶")}
            </p>
          </div>
          <div className="library-heading-actions">
            <button
              className="button primary"
              disabled={busy}
              onClick={() => onNew(destination)}
            >
              <Plus size={15} /> {msg("新建文档")}
            </button>
            {!showingFirstUse && (
              <button
                className="button"
                disabled={busy}
                onClick={() => onImport(undefined, destination)}
              >
                <Upload size={15} /> {msg("导入文档")}
              </button>
            )}
          </div>
        </header>
      )}
      {!compact && (
        <div
          className="library-space-tools"
          role="group"
          aria-label={msg("空间工具")}
        >
          <button disabled={busy} onClick={() => startAction("folder")}>
            <FolderPlus size={15} />
            {t("新建文件夹", "New folder")}
          </button>
          <button
            disabled={busy}
            onClick={() => {
              startAction("paste");
              setValue(t("剪贴笔记", "Clipboard note"));
            }}
          >
            <FileText size={15} />
            {t("粘贴文本", "Paste text")}
          </button>
          {folder && (
            <>
              <button
                disabled={busy}
                onClick={() => startAction("renameFolder")}
              >
                <Pencil size={15} />
                {t("重命名文件夹", "Rename folder")}
              </button>
              <button disabled={busy} onClick={() => startAction("moveFolder")}>
                <Folder size={15} />
                {t("移动文件夹", "Move folder")}
              </button>
              <button
                disabled={
                  busy ||
                  childFolders(organ.folders, folder).length > 0 ||
                  Object.values(organ.locations).includes(folder)
                }
                onClick={() => startAction("deleteFolder")}
              >
                <Trash2 size={15} />
                {t("删除空文件夹", "Delete empty folder")}
              </button>
            </>
          )}
          {!folder && (
            <>
              {onSearch && readyDocuments.length > 0 && (
                <button disabled={busy} onClick={onSearch}>
                  <Search size={15} /> {msg("搜索这些资料")}
                </button>
              )}
              <button disabled={busy || !onIndex} onClick={onIndex}>
                <Database size={15} /> {msg("查看逐文档索引")}
              </button>
              <button disabled={busy} onClick={() => void exportDoc()}>
                <Download size={15} /> {msg("导出空间")}
              </button>
              <button disabled={busy || !onBackup} onClick={onBackup}>
                <Archive size={15} /> {msg("备份与恢复预演")}
              </button>
            </>
          )}
        </div>
      )}
      {!compact && !folder && firstUseGuide}
      <div className="library-controls">
        {compact && (
          <div className="library-project">
            <select
              aria-label={compact ? msg("当前空间") : msg("文档空间")}
              disabled={busy}
              value={projectId}
              onChange={(e) => {
                setTab("all");
                onProject(e.target.value);
              }}
            >
              {view.projects
                .filter((p) => !p.archived || p.id === projectId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
            </select>
            <button
              title={msg("新建空间")}
              aria-label={msg("新建空间")}
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
              title={msg("重命名空间")}
              aria-label={msg("重命名空间")}
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
                  {msg("导出空间")}
                </button>
                <button
                  className="text-button"
                  onClick={() =>
                    void invoke("library_reveal", { projectId }).catch(onError)
                  }
                >
                  <FolderOpen size={14} />
                  {msg("在访达中显示")}
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
              aria-label={msg("空间名称")}
              placeholder={msg("空间名称")}
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
            />
            <button
              type="button"
              disabled={spaceSaving}
              onClick={() => setAdding(false)}
            >
              {msg("取消")}
            </button>
            <button type="submit" disabled={spaceSaving || busy}>
              {renamingSpace ? msg("保存名称") : msg("创建")}
            </button>
          </form>
        )}
        {compact && (
          <div className="library-shortcuts">
            <button disabled={busy} onClick={() => onNew(destination)}>
              <Plus size={13} strokeWidth={2} aria-hidden="true" />
              <span>{msg("新建")}</span>
            </button>
            <button
              disabled={busy}
              onClick={() => onImport(undefined, destination)}
            >
              <Upload size={13} strokeWidth={2} aria-hidden="true" />
              <span>{msg("导入文档")}</span>
            </button>
          </div>
        )}
        {compact && (
          <input
            className="library-search"
            aria-label={compact ? msg("查找文档") : msg("搜索我的文档")}
            placeholder={msg("查找文档标题…")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
        <div className="library-tabs">
          {(compact
            ? [
                ["all", msg("空间文档")],
                ["recent", msg("最近")],
                ["trash", msg("回收站")],
              ]
            : [
                ["recent", msg("最近")],
                ["pinned", msg("置顶")],
                ["all", msg("全部资料")],
                ["trash", msg("回收站")],
              ]
          ).map(([id, label]) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              aria-pressed={tab === id}
              onClick={() => {
                anchor.current = null;
                setTab(id as LibraryTab);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {!compact && (
          <div
            className="workbench-type-filter"
            role="group"
            aria-label={msg("文档类型筛选")}
          >
            {[
              ["all", msg("全部类型")],
              ["md", "Markdown"],
              ["image", t("图片", "Images")],
              ["mindmap", t("脑图", "Mind maps")],
              ["txt", msg("纯文本")],
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
            {documentCount(docs.length, tab === "trash")}
            {query && <> · {msg("匹配")}</>}
          </span>
          {tab !== "recent" && tab !== "trash" && (
            <label>
              {msg("排序")}
              <select
                aria-label={msg("文档排序")}
                value={sortBy}
                onChange={(e) =>
                  updateView({
                    ...preferences,
                    sort: e.target.value as DocumentSort,
                  })
                }
              >
                <option value="nameAsc">{msg("名称 A–Z")}</option>
                <option value="nameDesc">{msg("名称 Z–A")}</option>
                <option value="updatedDesc">{msg("修改时间")}</option>
              </select>
            </label>
          )}
        </div>
      </div>
      {viewWarning && (
        <p role="status" className="library-view-warning">
          {viewWarning}
        </p>
      )}
      {!compact && pendingImports.length > 0 && (
        <div className="import-recovery">
          <strong>{msg("有可重试的导入记录")}</strong>
          {pendingImports.slice(0, 3).map((t) => (
            <div key={t.id}>
              <span>
                {view.projects.find((p) => p.id === t.projectId)?.title} ·{" "}
                {t.status === "cancelled"
                  ? msg("已停止")
                  : t.status === "partial"
                    ? msg("有失败项")
                    : msg("上次中断")}
              </span>
              <button disabled={busy} onClick={() => onImport(t)}>
                {msg("重试未完成项")}
              </button>
              <button
                disabled={busy}
                aria-label={msg("归档导入记录")}
                onClick={() =>
                  void (async () => {
                    if (onArchiveImport) await onArchiveImport(t);
                    else await invoke("library_archive_import", { id: t.id });
                    await onRefresh();
                  })().catch(onError)
                }
              >
                {msg("归档")}
              </button>
            </div>
          ))}
        </div>
      )}

      <div
        className="library-documents"
        ref={listRef}
        onScroll={rememberAnchor}
      >
        {directories.map((path) => (
          <div className="library-document directory-row" key={path}>
            <button
              className="library-open"
              data-library-drop-folder={path}
              data-nav-key={"folder:" + path}
              onClick={() => {
                rememberEntry("folder:" + path);
                navigate(path);
              }}
            >
              <Folder size={20} />
              <strong>{folderName(path)}</strong>
            </button>
          </div>
        ))}
        {treeVisible ? (
          <FolderTree
            folders={organ.folders}
            selected={folder}
            onSelect={navigate}
            renderFiles={(path) =>
              renderRows(
                docs.filter((d) => (organ.locations[d.id] ?? "") === path),
              )
            }
          />
        ) : docs.length ? (
          renderRows(docs)
        ) : directories.length ? null : (
          <div className="library-empty">
            <FileText size={25} />
            <p>
              {filtered
                ? msg("没有匹配的文档")
                : tab === "trash"
                  ? msg("回收站为空")
                  : tab === "recent"
                    ? msg("还没有最近打开的文档")
                    : tab === "pinned"
                      ? msg("还没有置顶文档")
                      : folder
                        ? t("此目录为空", "This folder is empty")
                        : msg("空间里还没有文档")}
            </p>
            {filtered ? (
              <button
                onClick={() => {
                  setQuery("");
                  setTypeFilter("all");
                }}
              >
                {msg("清除筛选")}
              </button>
            ) : (
              tab === "all" &&
              !showingFirstUse && (
                <button
                  disabled={busy}
                  onClick={() => onImport(undefined, destination)}
                >
                  {msg("导入本地文件")}
                </button>
              )
            )}
          </div>
        )}
      </div>
      {trashDetail && (
        <TrashDialog
          key={trashDetail.id}
          document={trashDetail}
          onClose={() => setTrashDetail(null)}
          onRestore={() => onTrash(trashDetail, true)}
          onRefresh={onRefresh}
          onBeforeAction={onBeforeAction}
          onBusy={onMutationBusy ?? (() => {})}
        />
      )}
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
            {msg("文档标题")}
            <input
              autoFocus
              aria-label={msg("新文档标题")}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <button type="button" onClick={() => setRename(null)}>
            {msg("取消")}
          </button>
          <button type="submit">{msg("保存标题")}</button>
        </form>
      )}
    </section>
  );
}
