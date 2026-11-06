import type { LibraryDocument } from "../library";
export type DocumentSort = "nameAsc" | "nameDesc" | "updatedDesc";
export type LibraryTab = "all" | "recent" | "pinned" | "trash";
export interface ViewPreferences {
  version: 1;
  sort: DocumentSort;
  pinnedCollapsed: boolean;
}
export const defaultView: ViewPreferences = {
  version: 1,
  sort: "nameAsc",
  pinnedCollapsed: false,
};
const names = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base",
});
export function selectDocuments(
  documents: LibraryDocument[],
  project: string,
  tab: LibraryTab,
  sort: DocumentSort,
  query: string,
  pins: string[],
  type = "all",
) {
  const pinned = new Set(pins);
  return documents
    .filter(
      (d) =>
        d.projectId === project &&
        (tab === "trash" ? d.status !== "ready" : d.status === "ready") &&
        (tab !== "recent" || d.opened > 0) &&
        (tab !== "pinned" || pinned.has(d.id)) &&
        d.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()) &&
        (type === "all" ||
          (type === "md"
            ? /\.(md|markdown)$/i.test(d.path)
            : d.path.split(".").at(-1)?.toLowerCase() === type)),
    )
    .sort((a, b) => {
      if (tab === "recent")
        return b.opened - a.opened || a.id.localeCompare(b.id);
      if (tab === "all" && pinned.has(a.id) !== pinned.has(b.id))
        return pinned.has(a.id) ? -1 : 1;
      if (sort === "updatedDesc")
        return (
          b.updated - a.updated ||
          names.compare(a.title, b.title) ||
          a.id.localeCompare(b.id)
        );
      return (
        (sort === "nameDesc" ? -1 : 1) * names.compare(a.title, b.title) ||
        a.id.localeCompare(b.id)
      );
    });
}
