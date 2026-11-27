import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, ArchiveRestore, Folder, FileText } from "lucide-react";
import { translate as t } from "../i18n";
import type { LibraryDocument, LibraryProject } from "../library";
import { empty, layout } from "./Organization";
import { FolderPath, childFolders, folderName } from "./FolderPath";
import { label } from "./mediaTypes";

export function ArchivedDocument({
  projectId,
  document,
  citation,
}: {
  projectId: string;
  document: LibraryDocument;
  citation?: { hash: string; startLine: number; endLine: number };
}) {
  const [preview, setPreview] = useState<{
    hash: string;
    content: string;
    image?: string;
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setPreview(null);
    setError("");
    invoke<{ hash: string; content: string; image?: string }>(
      "library_archived_preview",
      {
        projectId,
        documentId: document.id,
      },
    )
      .then((v) => {
        if (live) setPreview(v);
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [document.id, projectId]);
  const mark = useRef<HTMLElement>(null);
  const lines = citation && preview ? preview.content.split("\n") : [];
  const located =
    citation &&
    preview?.hash === citation.hash &&
    citation.startLine >= 1 &&
    citation.endLine >= citation.startLine &&
    citation.endLine <= lines.length;
  useEffect(() => {
    if (located) mark.current?.scrollIntoView?.({ block: "nearest" });
  }, [preview, citation, located]);
  return (
    <div className="archive-preview" aria-busy={!preview && !error}>
      {error ? (
        <p role="alert">{error}</p>
      ) : preview ? (
        <>
          {preview.image && (
            <img alt={label(document.title)} src={preview.image} />
          )}
          {citation && !located && (
            <p role="status">
              {t(
                "当前版本与引用不符，显示现有正文。",
                "The source version has changed. Showing the current text.",
              )}
            </p>
          )}
          {located ? (
            <pre>
              {lines
                .slice(0, citation.startLine - 1)
                .map((line) => line + "\n")
                .join("")}
              <mark ref={mark}>
                {lines
                  .slice(citation.startLine - 1, citation.endLine)
                  .join("\n")}
              </mark>
              {lines
                .slice(citation.endLine)
                .map((line) => "\n" + line)
                .join("")}
            </pre>
          ) : (
            <pre>{preview.content}</pre>
          )}
        </>
      ) : (
        t("正在读取…", "Loading…")
      )}
    </div>
  );
}

export function ArchivedSpace({
  project,
  documents,
  onBack,
  onRestore,
}: {
  project: LibraryProject;
  documents: LibraryDocument[];
  onBack: () => void;
  onRestore: () => Promise<void>;
}) {
  const [tree, setTree] = useState<typeof empty | null>(null);
  const [path, setPath] = useState("");
  const [document, setDocument] = useState<LibraryDocument | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    layout(project.id)
      .then((v) => {
        if (live) setTree(v);
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [project.id]);
  const folderList = tree ? childFolders(tree.folders, path) : [];
  const files = tree
    ? documents.filter(
        (d) =>
          d.projectId === project.id &&
          d.status === "ready" &&
          (tree.locations[d.id] ?? "") === path,
      )
    : [];
  return (
    <section
      className="workspace-manager space-page"
      aria-label={t("归档空间", "Archived space")}
    >
      <FolderPath
        space={project.title}
        path={path}
        onSpaces={onBack}
        onFolder={(p) => {
          setDocument(null);
          setPath(p);
        }}
      />
      <header>
        <h2>
          {document ? label(document.title) : folderName(path) || project.title}
        </h2>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onRestore();
            } catch (e) {
              setError(String(e));
              setBusy(false);
            }
          }}
        >
          <ArchiveRestore />
          {t("恢复空间", "Restore space")}
        </button>
      </header>
      <small>{t("已归档 · 只读", "Archived · read only")}</small>
      {error && <p role="alert">{error}</p>}
      {document ? (
        <>
          <button
            className="archive-back"
            onClick={() => {
              setDocument(null);
              setError("");
            }}
          >
            <ArrowLeft />
            {t("返回目录", "Back to folder")}
          </button>
          <ArchivedDocument projectId={project.id} document={document} />
        </>
      ) : (
        <div className="space-rows">
          {folderList.map((f) => (
            <button className="archive-file" key={f} onClick={() => setPath(f)}>
              <Folder />
              {folderName(f)}
            </button>
          ))}
          {files.map((d) => (
            <button
              className="archive-file"
              key={d.id}
              onClick={() => setDocument(d)}
            >
              <FileText />
              {label(d.title)}
            </button>
          ))}
          {tree && !folderList.length && !files.length && (
            <p>{t("此目录为空", "This folder is empty")}</p>
          )}
        </div>
      )}
    </section>
  );
}
