import { ChevronRight } from "lucide-react";
import { Fragment } from "react";
import { translate as t } from "../i18n";

export const folderParent = (path: string) =>
  path.split("/").slice(0, -1).join("/");
export const folderName = (path: string) => path.split("/").at(-1) ?? "";
export const childFolders = (folders: string[], path: string) =>
  folders
    .filter((f) => folderParent(f) === path)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

export function FolderPath({
  space,
  path,
  onSpaces,
  onFolder,
}: {
  space: string;
  path: string;
  onSpaces: () => void;
  onFolder: (path: string) => void;
}) {
  const parts = path ? path.split("/") : [];
  return (
    <nav
      className="folder-crumbs"
      aria-label={t("目录位置", "Folder location")}
    >
      <button onClick={onSpaces}>{t("我的空间", "My spaces")}</button>
      {[space, ...parts].map((name, index) => (
        <Fragment key={index}>
          <ChevronRight aria-hidden="true" size={13} />
          {index === parts.length ? (
            <span aria-current="page">{name}</span>
          ) : (
            <button onClick={() => onFolder(parts.slice(0, index).join("/"))}>
              {name}
            </button>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
