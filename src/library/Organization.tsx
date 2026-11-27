import { dismissOnOutside, focusMenuButton } from "../platform/menu";
import { useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Archive,
  Folder,
  FolderOpen,
  Layers,
  Pin,
  Plus,
  ChevronRight,
  ChevronDown,
  Search,
  X,
  MoreHorizontal,
  Pencil,
  ArchiveRestore,
  ArrowLeft,
} from "lucide-react";
import { translate as t } from "../i18n";
import { ArchivedSpace } from "./ArchivedSpace";
import { imeBoundary, isImeEvent } from "../platform/ime";
import type { LibraryProject, LibraryView } from "../library";
export interface Layout {
  folders: string[];
  locations: Record<string, string>;
  pinned: boolean;
  archived: boolean;
}
export const empty: Layout = {
  folders: [],
  locations: {},
  pinned: false,
  archived: false,
};
export const layout = (
  projectId: string,
  action?: string,
  value?: string,
  documentId?: string,
) => invoke<Layout>("library_layout", { projectId, action, value, documentId });
export function FolderTree({
  folders,
  selected,
  renderFiles,
  onSelect,
}: {
  renderFiles: (path: string) => React.ReactNode;
  folders: string[];
  selected: string;
  onSelect: (s: string) => void;
}) {
  const [closed, set] = useState<string[]>([]);
  function nodes(parent: string): React.ReactNode {
    return folders
      .filter((f) => f.split("/").slice(0, -1).join("/") === parent)
      .map((f) => {
        const expanded = !closed.includes(f);
        return (
          <div key={f}>
            <div className="folder-row">
              <button
                aria-label={f}
                aria-expanded={expanded}
                onClick={() =>
                  set(expanded ? [...closed, f] : closed.filter((n) => n !== f))
                }
              >
                {expanded ? <ChevronDown /> : <ChevronRight />}
              </button>
              <button
                data-library-drop-folder={f}
                className={selected === f ? "selected" : ""}
                onClick={() => {
                  onSelect(f);
                  set(closed.filter((n) => n !== f));
                }}
              >
                <Folder />
                {f.split("/").pop()}
              </button>
            </div>
            {expanded && (
              <div className="folder-children">
                {nodes(f)}
                {renderFiles(f)}
              </div>
            )}
          </div>
        );
      });
  }
  return (
    <div className="library-folders">
      <button
        data-library-drop-folder=""
        className={!selected ? "selected" : ""}
        onClick={() => onSelect("")}
      >
        <FolderOpen />
        {t("空间根目录", "Space root")}
      </button>
      {nodes("")}
      {renderFiles("")}
    </div>
  );
}
export function SpaceManager({
  view,
  onClose,
  onEnter,
  onRefresh,
  onRename,
  onArchived,
}: {
  view: LibraryView;
  onClose: () => void;
  onEnter: (id: string) => void;
  onRefresh: () => Promise<void>;
  onRename?: (id: string, name: string) => void;
  onArchived?: (id: string) => Promise<void>;
}) {
  const [archived, setArchived] = useState(false);
  const [browsing, setBrowsing] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("updated");
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<LibraryProject | null>(null);
  const popup = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const newSpace = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const firstKey = useRef("Home");
  const returnTo = useRef<string | null>(null);
  const pending = useRef(false);
  const stats = new Map<string, { count: number; updated: number }>();
  for (const doc of view.documents) {
    const stat = stats.get(doc.projectId) ?? { count: 0, updated: 0 };
    stat.updated = Math.max(stat.updated, doc.updated);
    if (doc.status === "ready") stat.count++;
    stats.set(doc.projectId, stat);
  }
  const rows = view.projects
    .filter(
      (p) =>
        !!p.archived === archived &&
        p.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(!!b.pinned) - Number(!!a.pinned) ||
        (sort === "name"
          ? a.title.localeCompare(b.title)
          : (stats.get(b.id)?.updated ?? 0) - (stats.get(a.id)?.updated ?? 0)),
    );

  useLayoutEffect(() => {
    if (!browsing) search.current?.focus();
  }, [browsing]);
  useLayoutEffect(() => {
    if (editing) {
      nameInput.current?.focus();
      nameInput.current?.select();
    }
  }, [editing]);

  useLayoutEffect(() => {
    if (busy || editing || !returnTo.current) return;
    const target = returnTo.current;
    returnTo.current = null;
    const item = Array.from(
      list.current?.querySelectorAll<HTMLButtonElement>(
        "[data-space-actions]",
      ) ?? [],
    ).find((el) => el.dataset.spaceActions === target);
    (target === "new" ? newSpace.current : (item ?? search.current))?.focus();
  }, [editing, busy, menu]);

  useLayoutEffect(() => {
    const button = trigger.current,
      panel = popup.current;
    const dialog = panel?.closest<HTMLElement>(".workspace-manager");
    if (!menu || !button || !panel || !dialog) return;
    const place = () => {
      const row = button.getBoundingClientRect(),
        bounds = dialog.getBoundingClientRect();
      const above = row.bottom + 4 + panel.offsetHeight > bounds.bottom - 8;
      const top = above ? row.top - panel.offsetHeight - 4 : row.bottom + 4;
      panel.style.top = Math.max(4, top - bounds.top) + "px";
      panel.style.right = Math.max(6, bounds.right - row.right) + "px";
    };
    place();
    focusMenuButton(panel, firstKey.current);
    const outside = dismissOnOutside(
      (e) => e.composedPath().some((el) => el === button || el === panel),
      () => setMenu(null),
    );
    const scroller = list.current;
    const onScroll = () => {
      const limit = scroller?.getBoundingClientRect(),
        anchor = button.getBoundingClientRect();
      if (limit && (anchor.bottom <= limit.top || anchor.top >= limit.bottom)) {
        setMenu(null);
        scroller?.focus({ preventScroll: true });
      } else place();
    };
    scroller?.addEventListener("scroll", onScroll);
    window.addEventListener("resize", place);
    return () => {
      outside();
      scroller?.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", place);
    };
  }, [menu]);

  function begin(id: string, title: string) {
    setMenu(null);
    setError("");
    setName(title);
    setEditing(id);
  }
  function escape() {
    if (menu) {
      returnTo.current = menu.id;
      setMenu(null);
    } else if (editing) {
      returnTo.current = editing;
      setEditing(null);
      setError("");
    } else onClose();
  }
  async function mutate(fn: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
      await onRefresh();
    } catch (e) {
      setError(String(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function saveName() {
    const title = name.trim();
    if (!editing || !title || pending.current) return;
    if (view.projects.some((p) => p.id !== editing && p.title === title)) {
      setError(t("空间名称重复", "A space with this name already exists"));
      nameInput.current?.focus();
      return;
    }
    await mutate(async () => {
      if (editing === "new") {
        const created = await invoke<LibraryProject>("library_create_project", {
          title,
        });
        returnTo.current = created.id;
        setArchived(false);
      } else {
        await invoke("library_rename_project", { id: editing, title });
        returnTo.current = editing;
        onRename?.(editing, title);
      }
      if (!title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
        setQuery("");
      setEditing(null);
    });
  }
  function nameForm() {
    return (
      <form
        className="space-name-form"
        {...imeBoundary}
        onSubmit={(e) => {
          e.preventDefault();
          void saveName();
        }}
      >
        <label htmlFor="space-manager-name">
          {t("空间名称", "Space name")}
        </label>
        <div className="space-name-controls">
          <input
            id="space-manager-name"
            ref={nameInput}
            disabled={busy}
            value={name}
            aria-invalid={!!error}
            aria-describedby={error ? "space-name-error" : undefined}
            onChange={(e) => {
              setName(e.target.value);
              setError("");
            }}
          />
          <button
            type="submit"
            className="space-primary"
            disabled={!name.trim() || busy}
          >
            {editing === "new" ? t("创建", "Create") : t("保存", "Save")}
          </button>
          <button type="button" disabled={busy} onClick={escape}>
            {t("取消", "Cancel")}
          </button>
        </div>
        {error && (
          <p role="alert" id="space-name-error">
            {error}
          </p>
        )}
      </form>
    );
  }
  function change(
    p: LibraryProject,
    action: "pin" | "archive",
    value: boolean,
  ) {
    returnTo.current = p.id;
    setMenu(null);
    void mutate(async () => {
      await layout(p.id, action, String(value));
      if (action === "archive" && value) await onArchived?.(p.id);
    });
  }
  const unavailable = busy || !!editing;
  const archivedProject = view.projects.find(
    (p) => p.id === browsing && p.archived,
  );
  if (archivedProject)
    return (
      <ArchivedSpace
        project={archivedProject}
        documents={view.documents}
        onBack={() => setBrowsing(null)}
        onRestore={async () => {
          await layout(archivedProject.id, "archive", "false");
          await onRefresh();
          setArchived(false);
          setBrowsing(null);
        }}
      />
    );
  return (
    <section
      className="workspace-manager space-page"
      aria-label={t("我的空间", "My spaces")}
      onKeyDown={(e) => {
        if (isImeEvent(e.nativeEvent)) return;
        if (e.key === "Escape" && !busy) {
          e.preventDefault();
          e.stopPropagation();
          escape();
        }
        if (e.key === "Tab" && menu) {
          trigger.current?.focus();
          setMenu(null);
        }
      }}
    >
      <header>
        <h2>
          <Layers aria-hidden="true" />
          {t("我的空间", "My spaces")}
        </h2>
        <button
          className="space-back"
          disabled={busy}
          aria-label={t("返回当前目录", "Back to current folder")}
          onClick={onClose}
        >
          <ArrowLeft />
          {t("返回当前目录", "Back to current folder")}
        </button>
      </header>
      <div className="space-tools">
        <div
          className="space-search"
          onClick={(event) => {
            if (event.target === event.currentTarget) search.current?.focus();
          }}
        >
          <label htmlFor="space-manager-search">
            <Search aria-hidden="true" />
          </label>
          <input
            id="space-manager-search"
            ref={search}
            data-autofocus
            type="search"
            aria-label={t("搜索空间名称", "Find a space")}
            disabled={unavailable}
            placeholder={t("搜索空间名称", "Find a space")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            {...imeBoundary}
          />
          {query && (
            <button
              className="space-icon"
              disabled={unavailable}
              aria-label={t("清除搜索", "Clear search")}
              onClick={() => {
                setQuery("");
                search.current?.focus();
              }}
            >
              <X />
            </button>
          )}
        </div>
        <button
          ref={newSpace}
          className="space-primary"
          disabled={unavailable}
          onClick={() => begin("new", "")}
        >
          <Plus />
          {t("新建空间", "New space")}
        </button>
      </div>
      {editing === "new" && nameForm()}
      <div className="space-list-tools">
        <div role="group" aria-label={t("空间范围", "Space scope")}>
          <button
            disabled={unavailable}
            aria-pressed={!archived}
            onClick={() => setArchived(false)}
          >
            {t("使用中", "Active")}
          </button>
          <button
            disabled={unavailable}
            aria-pressed={archived}
            onClick={() => setArchived(true)}
          >
            {t("已归档", "Archived")}
          </button>
        </div>
        <select
          aria-label={t("空间排序", "Sort spaces")}
          disabled={unavailable}
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="updated">{t("最近更新", "Recently updated")}</option>
          <option value="name">{t("按名称", "By name")}</option>
        </select>
      </div>
      <div className="space-rows" ref={list} tabIndex={-1}>
        <div className="space-columns" aria-hidden="true">
          <span>{t("名称", "Name")}</span>
          <span>{t("资料数", "Items")}</span>
          <span>{t("最近更新", "Updated")}</span>
        </div>
        {rows.map((p) => {
          const updated = stats.get(p.id)?.updated;
          return (
            <div key={p.id} className="space-record">
              {editing === p.id ? (
                nameForm()
              ) : (
                <>
                  <button
                    className="space-name"
                    disabled={unavailable}
                    onClick={() =>
                      archived ? setBrowsing(p.id) : onEnter(p.id)
                    }
                  >
                    <FolderOpen />
                    <span>{p.title}</span>
                    {p.pinned && <Pin aria-label={t("已置顶", "Pinned")} />}
                  </button>
                  <small>{stats.get(p.id)?.count ?? 0}</small>
                  <small>
                    {updated
                      ? new Date(updated * 1000).toLocaleDateString()
                      : "—"}
                  </small>
                  <button
                    className="space-icon"
                    data-space-actions={p.id}
                    disabled={unavailable}
                    aria-label={p.title + t("的更多操作", " actions")}
                    aria-haspopup="menu"
                    aria-expanded={menu?.id === p.id}
                    onClick={(e) => {
                      trigger.current = e.currentTarget;
                      firstKey.current = "Home";
                      setMenu(menu?.id === p.id ? null : p);
                    }}
                    onKeyDown={(e) => {
                      if (!["ArrowDown", "ArrowUp"].includes(e.key)) return;
                      e.preventDefault();
                      firstKey.current = e.key === "ArrowUp" ? "End" : "Home";
                      trigger.current = e.currentTarget;
                      setMenu(p);
                    }}
                  >
                    <MoreHorizontal />
                  </button>
                </>
              )}
            </div>
          );
        })}
        {!rows.length && (
          <p role="status">
            {query
              ? t("没有匹配的空间", "No matching spaces")
              : archived
                ? t("没有已归档的空间", "No archived spaces")
                : t("暂无空间", "No spaces yet")}
          </p>
        )}
      </div>
      {menu && (
        <div
          className="space-action-menu"
          ref={popup}
          role="menu"
          aria-label={menu.title}
          onKeyDown={(e) => {
            if (isImeEvent(e.nativeEvent)) return;
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
              e.preventDefault();
              focusMenuButton(e.currentTarget, e.key);
            }
          }}
        >
          <button
            role="menuitem"
            onClick={() => change(menu, "pin", !menu.pinned)}
          >
            <Pin />
            {menu.pinned ? t("取消置顶", "Unpin") : t("置顶", "Pin")}
          </button>
          <button role="menuitem" onClick={() => begin(menu.id, menu.title)}>
            <Pencil />
            {t("重命名", "Rename")}
          </button>
          {menu.id !== "inbox" && (
            <button
              role="menuitem"
              onClick={() => change(menu, "archive", !archived)}
            >
              {archived ? <ArchiveRestore /> : <Archive />}
              {archived ? t("恢复", "Restore") : t("归档", "Archive")}
            </button>
          )}
        </div>
      )}
      {error && !editing && <p role="alert">{error}</p>}
    </section>
  );
}
