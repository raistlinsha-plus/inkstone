import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import ModalDialog from "../ModalDialog";
import { translate as t } from "../i18n";
import type { LibraryDocument } from "../library";

interface ImageImportResult {
  document: LibraryDocument;
  existing: boolean;
  actualFolder?: string | null;
  warning?: string | null;
}

export default function DirectImagePreview({
  files,
  projectId,
  projectTitle,
  onClose,
  onImport,
  folder,
  locations,
  onOpen,
}: {
  files: string[];
  projectId: string;
  projectTitle: string;
  onClose: () => void;
  folder: string;
  locations: Record<string, string>;
  onOpen: (doc: LibraryDocument) => void;
  onImport: () => Promise<void>;
}) {
  const [index, setIndex] = useState(0),
    [preview, setPreview] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [added, setAdded] = useState<Record<string, ImageImportResult>>({});
  const path = files[index],
    name = path.split("/").pop(),
    receipt = added[path];
  const location =
    receipt?.actualFolder ??
    (receipt?.existing ? locations[receipt.document.id] : folder);
  useEffect(() => {
    let current = true;
    setPreview("");
    setError("");
    invoke<string>("media_preview", { path })
      .then((src) => current && setPreview(src))
      .catch((e) => current && setError(String(e)));
    return () => {
      current = false;
    };
  }, [path]);
  async function add() {
    if (busy || !preview || added[path]) return;
    setBusy(true);
    setError("");
    try {
      const result = await invoke<ImageImportResult>("media_import", {
        projectId,
        folder,
        path,
      });
      setAdded((prev) => ({ ...prev, [path]: result }));
      await onImport();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <ModalDialog
      label={t("打开图片", "Open images")}
      busy={busy}
      onClose={onClose}
      className="direct-image"
    >
      <section
        onKeyDown={(e) => {
          if (busy) return;
          if (e.key === "ArrowLeft") setIndex(Math.max(0, index - 1));
          if (e.key === "ArrowRight")
            setIndex(Math.min(files.length - 1, index + 1));
        }}
      >
        <header>
          <strong>{name}</strong>
          <button disabled={busy} onClick={onClose}>
            {t("关闭", "Close")}
          </button>
        </header>
        <div className="media-stage">
          {preview ? (
            <img src={preview} alt={name} />
          ) : (
            !error && t("正在打开…", "Opening…")
          )}
        </div>
        <div className="media-tools">
          {files.length > 1 && (
            <>
              <button
                disabled={busy || index === 0}
                onClick={() => setIndex(index - 1)}
              >
                {t("上一张", "Previous")}
              </button>
              {index + 1} / {files.length}
              <button
                disabled={busy || index === files.length - 1}
                onClick={() => setIndex(index + 1)}
              >
                {t("下一张", "Next")}
              </button>
            </>
          )}
          <button
            disabled={!preview || busy || Boolean(receipt)}
            onClick={() => void add()}
          >
            {receipt?.existing
              ? t("已在空间中", "Already in space")
              : receipt
                ? t("已加入空间", "Added")
                : busy
                  ? t("正在导入…", "Importing…")
                  : t("加入当前空间", "Add to space")}
          </button>
        </div>
        <p role={receipt ? "status" : undefined}>
          {receipt?.existing
            ? t("图片已在", "Image already in")
            : t("本次位置", "Destination")}{" "}
          · {projectTitle} /{" "}
          {location === undefined && receipt?.actualFolder === null
            ? t("位置待刷新", "Location unavailable")
            : location || t("空间根目录", "Space root")}{" "}
          {receipt && (
            <button onClick={() => onOpen(receipt.document)}>
              {receipt.existing
                ? t("打开已有图片", "Open existing image")
                : t("打开图片", "Open image")}
            </button>
          )}
        </p>
        {receipt?.warning && <p role="status">{receipt.warning}</p>}
        {error && <p role="alert">{error}</p>}
      </section>
    </ModalDialog>
  );
}
