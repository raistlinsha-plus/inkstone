import { useEffect, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ScanText,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { translate as t } from "../i18n";
import type { LibraryDocument } from "../library";
import { imageName, label } from "./mediaTypes";
import "./image-reader.css";

interface Analysis {
  model: string;
  question: string;
  result: string;
  error: string;
  pending: boolean;
  saving: boolean;
}
const empty: Analysis = {
  model: "",
  question: "",
  result: "",
  error: "",
  pending: false,
  saving: false,
};
// Requests can finish while another image or workspace is on screen.
const analyses = new Map<string, Analysis>();
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function update(id: string, patch: Partial<Analysis>) {
  const next = { ...(analyses.get(id) ?? empty), ...patch };
  if (Object.values(next).some(Boolean)) analyses.set(id, next);
  else analyses.delete(id);
  listeners.forEach((listener) => listener());
}

interface ViewerProps {
  path: string;
  content: string;
  documents: LibraryDocument[];
  defaultModel?: string;
  citationLine?: number;
  onReady?: (element: HTMLElement) => void;
  open: (doc: LibraryDocument) => void;
  append: (text: string) => Promise<void> | void;
}
export default function MediaViewer({
  path,
  content,
  documents,
  defaultModel,
  citationLine,
  onReady,
  open,
  append,
}: ViewerProps) {
  const images = documents
    .filter((d) => d.status === "ready" && imageName(d.path))
    .sort((a, b) =>
      a.title.localeCompare(b.title, undefined, { numeric: true }),
    );
  const pos = images.findIndex((d) => d.path === path);
  const photo = images[pos];
  const id = JSON.stringify([photo?.projectId, photo?.id ?? path]);
  const draft = useSyncExternalStore(
    subscribe,
    () => analyses.get(id) ?? empty,
  );
  const [panel, setPanel] = useState<"text" | "analysis" | null>(() =>
    citationLine ? "text" : analyses.has(id) ? "analysis" : null,
  );
  const [src, setSource] = useState("");
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(false);
  const name = label(photo?.title ?? path.split("/").pop() ?? path);
  const body = content.split(/^## 图中文字\s*$/m)[1] ?? "";
  const [ocr, ...saved] = body.split(/^## (?:模型描述|Model description)\s*$/m);
  useEffect(() => {
    let active = true;
    setError("");
    setSource("");
    invoke<string>("resolve_image", {
      documentPath: path,
      url: "assets/preview.jpg",
    })
      .then((value) => {
        if (active) setSource(value);
      })
      .catch((reason) => {
        if (active) setError(String(reason));
      });
    return () => {
      active = false;
    };
  }, [path]);
  useEffect(() => {
    if (citationLine) setPanel("text");
  }, [citationLine]);
  function move(delta: number) {
    if (pos >= 0 && images[pos + delta]) open(images[pos + delta]);
  }
  async function analyze() {
    if (!photo || !src || analyses.get(id)?.pending) return;
    update(id, { pending: true, error: "" });
    try {
      const result = await invoke<string>("media_describe", {
        documentId: photo.id,
        model: draft.model.trim(),
        question:
          draft.question.trim() ||
          t("描述图片中可见的内容。", "Describe what is visible in the image."),
      });
      update(id, { result });
    } catch (reason) {
      update(id, { error: String(reason) });
    } finally {
      update(id, { pending: false });
    }
  }
  async function save() {
    if (draft.saving || !draft.result) return;
    update(id, { saving: true, error: "" });
    try {
      await append(
        "\n\n## " +
          t("模型描述", "Model description") +
          "\n\n" +
          draft.result +
          "\n",
      );
      update(id, { result: "", question: "" });
      setPanel("text");
    } catch (reason) {
      update(id, { error: String(reason) });
    } finally {
      update(id, { saving: false });
    }
  }
  return (
    <section
      ref={element => { if (element) onReady?.(element); }}
      className="picture-reader"
      tabIndex={0}
      aria-label={t("图片查看器", "Image viewer")}
      onKeyDown={(e) => {
        if (
          e.altKey ||
          e.metaKey ||
          e.ctrlKey ||
          (e.target as Element).closest(
            "input, textarea, select, [contenteditable=true]",
          )
        )
          return;
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          move(e.key === "ArrowLeft" ? -1 : 1);
        }
      }}
    >
      <div className={"picture-stage" + (zoom ? " is-zoomed" : "")}>
        {src ? (
          <img src={src} alt={name} onDoubleClick={() => setZoom(!zoom)} />
        ) : (
          !error && (
            <span role="status">{t("正在打开图片…", "Opening image…")}</span>
          )
        )}
      </div>
      <div
        className="picture-controls"
        role="group"
        aria-label={t("图片操作", "Image actions")}
      >
        {images.length > 1 && pos >= 0 && (
          <div
            className="picture-pages"
            aria-label={t("当前空间的图片", "Images in this space")}
          >
            <button
              disabled={pos === 0}
              onClick={() => move(-1)}
              aria-label={t("上一张", "Previous image")}
            >
              <ChevronLeft />
            </button>
            <span title={t("当前空间的图片", "Images in this space")}>
              {pos + 1} / {images.length}
            </span>
            <button
              disabled={pos === images.length - 1}
              onClick={() => move(1)}
              aria-label={t("下一张", "Next image")}
            >
              <ChevronRight />
            </button>
          </div>
        )}
        <button disabled={!src} onClick={() => setZoom(!zoom)}>
          {zoom ? <ZoomOut /> : <ZoomIn />}
          {zoom ? t("适应窗口", "Fit") : t("放大", "Zoom")}
        </button>
        <button
          disabled={!photo}
          onClick={() =>
            void invoke("media_export_original", {
              documentId: photo.id,
            }).catch((e) => setError(String(e)))
          }
        >
          <Download />
          {t("导出原图", "Export original")}
        </button>
        <button
          aria-expanded={panel === "text"}
          onClick={() => setPanel(panel === "text" ? null : "text")}
        >
          <ScanText />
          {t("查看文字", "View text")}
        </button>
        <button
          aria-expanded={panel === "analysis"}
          onClick={() => setPanel(panel === "analysis" ? null : "analysis")}
        >
          <Sparkles />
          {t("分析图片", "Analyze image")}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {panel && (
        <section
          className="picture-panel"
          aria-label={
            panel === "text"
              ? t("图片文字", "Image text")
              : t("图片分析", "Image analysis")
          }
        >
          <header>
            <strong>
              {panel === "text"
                ? t("图中文字", "Recognized text")
                : t("分析图片", "Analyze image")}
            </strong>
            <button
              aria-label={t("收起", "Collapse")}
              onClick={() => setPanel(null)}
            >
              <X size={16} />
            </button>
          </header>
          {panel === "text" ? (
            <>
              <p className="picture-copy">
                {ocr.trim() || t("未识别到文字", "No text detected")}
              </p>
              {saved.length > 0 && (
                <>
                  <strong>{t("已保存的描述", "Saved descriptions")}</strong>
                  {saved.map((s, i) => (
                    <p className="picture-copy" key={i}>
                      {s.trim()}
                    </p>
                  ))}
                </>
              )}
            </>
          ) : (
            <>
              <div className="picture-model">
                {src && (
                  <img src={src} alt={t("将发送的预览", "Preview to send")} />
                )}
                <label>
                  {t("视觉模型", "Vision model")}
                  <input
                    placeholder={
                      defaultModel ||
                      t("使用已配置的问答模型", "Use configured chat model")
                    }
                    value={draft.model}
                    disabled={draft.pending || draft.saving}
                    onChange={(e) => update(id, { model: e.target.value })}
                  />
                </label>
              </div>
              <label>
                {t("问题", "Question")}
                <textarea
                  rows={2}
                  placeholder={t(
                    "想了解图中的什么？",
                    "What would you like to know about this image?",
                  )}
                  value={draft.question}
                  disabled={draft.pending || draft.saving}
                  onChange={(e) => update(id, { question: e.target.value })}
                />
              </label>
              <div className="picture-send">
                <small>
                  {t(
                    "发送时，问答服务会收到上方预览和问题。",
                    "Sending shares the preview and question with your chat service.",
                  )}
                </small>
                <button
                  className="picture-primary"
                  disabled={!src || !photo || draft.pending || draft.saving}
                  onClick={() => void analyze()}
                >
                  {draft.pending
                    ? t("分析中…", "Analyzing…")
                    : t("发送图片", "Send image")}
                </button>
              </div>
              {draft.error && <p role="alert">{draft.error}</p>}
              {draft.result && (
                <div className="picture-result">
                  <p className="picture-copy">{draft.result}</p>
                  <button
                    disabled={draft.saving || draft.pending}
                    onClick={() => void save()}
                  >
                    {t("保存描述并用于检索", "Save description for search")}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </section>
  );
}
