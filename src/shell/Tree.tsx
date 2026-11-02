import { ChevronDown, ChevronRight, FileText, Folder } from "lucide-react";
import { useState } from "react";
import type { FileEntry } from "../types";
const basename = (path: string) => path.split("/").at(-1) ?? path;
export default function Tree({
  files,
  selected,
  onOpen,
  depth = 0,
}: {
  files: FileEntry[];
  selected?: string;
  onOpen: (path: string) => void;
  depth?: number;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  return (
    <>
      {files.map((file) => (
        <div key={file.path}>
          {file.directory ? (
            <>
              <button
                className="tree-row directory"
                style={{ paddingLeft: 14 + depth * 14 }}
                onClick={() =>
                  setCollapsed((old) => {
                    const next = new Set(old);
                    next.has(file.path)
                      ? next.delete(file.path)
                      : next.add(file.path);
                    return next;
                  })
                }
              >
                {collapsed.has(file.path) ? (
                  <ChevronRight size={12} />
                ) : (
                  <ChevronDown size={12} />
                )}
                <Folder size={14} />
                <span>{file.name}</span>
              </button>
              {!collapsed.has(file.path) && (
                <Tree
                  files={file.children}
                  selected={selected}
                  onOpen={onOpen}
                  depth={depth + 1}
                />
              )}
            </>
          ) : (
            <button
              className={`tree-row ${selected === file.path ? "selected" : ""}`}
              style={{ paddingLeft: 28 + depth * 14 }}
              onClick={() => onOpen(file.path)}
              title={file.path}
            >
              <FileText size={14} />
              <span>{file.name}</span>
              {selected === file.path && <span className="active-dot" />}
            </button>
          )}
        </div>
      ))}
    </>
  );
}
