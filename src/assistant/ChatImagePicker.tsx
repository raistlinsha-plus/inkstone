import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, Image, Search, X } from "lucide-react";
import ModalDialog from "../ModalDialog";
import { translate as t } from "../i18n";
import type { LibraryDocument } from "../library";
import { imageName, label } from "../library/mediaTypes";
import type { ChatImage } from "./types";
import "./chat-image.css";

type Preview = {
  hash: string;
  url: string;
  previewError?: string | null;
  hasOcr: boolean;
  hasDescription: boolean;
};
function usePreview(photo?: LibraryDocument) {
  const id = photo?.id,
    project = photo?.projectId;
  const [state, setState] = useState<{
    id: string;
    project: string;
    preview?: Preview;
    error?: string;
  }>();
  useEffect(() => {
    if (!id || !project) return;
    let current = true;
    void invoke<Preview>("assistant_image_preview", {
      projectId: project,
      documentId: id,
    }).then(
      (preview) => current && setState({ id, project, preview }),
      (error) => current && setState({ id, project, error: String(error) }),
    );
    return () => {
      current = false;
    };
  }, [id, project]);
  return id && state?.id === id && state.project === project
    ? state
    : undefined;
}

function ImageContent({
  state,
  title,
}: {
  state: ReturnType<typeof usePreview>;
  title: string;
}) {
  if (state?.error) return <span role="alert">{state.error}</span>;
  if (state?.preview && !state.preview.url) {
    return (
      <span role="status">
        {t("JPEG 预览不可用", "JPEG preview unavailable")}
      </span>
    );
  }
  return state?.preview ? (
    <img src={state.preview.url} alt={label(title)} />
  ) : (
    <span role="status">{t("正在读取预览…", "Loading preview…")}</span>
  );
}

export function ChatImagePicker({
  docs,
  space,
  selected,
  returnFocus,
  onPick,
  onClose,
}: {
  docs: LibraryDocument[];
  space: string;
  selected?: ChatImage;
  returnFocus?: HTMLElement;
  onPick: (image: ChatImage) => void;
  onClose: () => void;
}) {
  const photos = docs.filter((d) => d.status === "ready" && imageName(d.path));
  const [query, setQuery] = useState("");
  const [id, setId] = useState(selected?.documentId ?? photos[0]?.id);
  const [mode, setMode] = useState<ChatImage["mode"]>(selected?.mode ?? "ocr");
  const visible = photos.filter((d) =>
    d.title.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const photo = visible.find((d) => d.id === id) ?? visible[0];
  const state = usePreview(photo);
  const available = (value: ChatImage["mode"]) =>
    !!state?.preview &&
    (value === "vision"
      ? !!state.preview.url && !!state.preview.hash
      : value === "ocr"
        ? state.preview.hasOcr
        : state.preview.hasDescription);
  return (
    <ModalDialog
      label={t("从空间选图", "Choose an image")}
      returnFocus={returnFocus}
      onClose={onClose}
      className="chat-image-dialog"
    >
      <header>
        <div>
          <h2>{t("从空间选图", "Choose an image")}</h2>
          <small>{space}</small>
        </div>
        <button type="button" aria-label={t("关闭", "Close")} onClick={onClose}>
          <X size={17} />
        </button>
      </header>
      <div className="chat-image-picker">
        <div className="chat-image-list">
          <label>
            <Search size={15} />
            <input
              type="search"
              data-autofocus
              placeholder={t("查找图片", "Find an image")}
              aria-label={t("查找图片", "Find an image")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div>
            {visible.map((d) => (
              <button
                type="button"
                key={d.id}
                aria-pressed={d.id === photo?.id}
                onClick={() => setId(d.id)}
              >
                <Image size={15} />
                <span>{label(d.title)}</span>
                {d.id === photo?.id && <Check size={14} />}
              </button>
            ))}
            {!visible.length && (
              <p>
                {query
                  ? t("没有匹配的图片", "No matching images")
                  : t(
                      "这个空间还没有图片。可先在文档中导入。",
                      "Import an image into this space first.",
                    )}
              </p>
            )}
          </div>
        </div>
        <div className="chat-image-preview">
          {photo && <ImageContent state={state} title={photo.title} />}
        </div>
      </div>
      <fieldset className="chat-image-modes">
        <legend>{t("本轮使用", "Use for this turn")}</legend>
        {(
          [
            ["ocr", t("图中文字（OCR）", "Recognized text (OCR)")],
            ["description", t("已保存的描述", "Saved description")],
            ["vision", t("图片预览", "Image preview")],
          ] as const
        ).map(([value, name]) => (
          <label key={value}>
            <input
              type="radio"
              disabled={!available(value)}
              checked={mode === value}
              onChange={() => setMode(value)}
            />
            {name}
          </label>
        ))}
      </fieldset>
      {photo && state?.preview && mode !== "vision" && !available(mode) && (
        <small role="status">
          {mode === "description"
            ? t(
                "这张图还没有已保存的描述。",
                "This image has no saved description yet.",
              )
            : t(
                "这张图没有识别到文字。",
                "No text was recognized in this image.",
              )}
        </small>
      )}
      <p>
        {mode === "vision"
          ? t(
              "发送时可核对图片、模型和服务地址。",
              "Review the image, model and endpoint before sending.",
            )
          : t(
              "本轮仅使用所选文字，原图保存在本机。",
              "Only the selected text is used. The image stays on this Mac.",
            )}
      </p>
      <footer>
        <button type="button" onClick={onClose}>
          {t("取消", "Cancel")}
        </button>
        <button
          type="button"
          className="primary"
          disabled={!photo || !available(mode)}
          onClick={() => photo && onPick({ documentId: photo.id, mode })}
        >
          {t("加入本轮", "Add to turn")}
        </button>
      </footer>
    </ModalDialog>
  );
}

export function ConfirmChatImage({
  photo,
  endpoint,
  defaultModel,
  imageQuestion,
  onClose,
  onConfirm,
}: {
  photo: LibraryDocument;
  endpoint: string;
  defaultModel: string;
  imageQuestion?: string;
  onClose: () => void;
  onConfirm: (model: string, previewHash: string) => void;
}) {
  const [model, setModel] = useState(defaultModel);
  const state = usePreview(photo);
  return (
    <ModalDialog
      label={t("发送图片给模型", "Send image to model")}
      onClose={onClose}
      className="chat-image-dialog"
    >
      <header>
        <h2>{t("发送图片给模型", "Send image to model")}</h2>
        <button type="button" aria-label={t("关闭", "Close")} onClick={onClose}>
          <X size={17} />
        </button>
      </header>
      <div className="chat-image-preview confirm">
        <ImageContent state={state} title={photo.title} />
      </div>
      <strong>{label(photo.title)}</strong>
      <p>
        {imageQuestion
          ? t(
              "将把这张 JPEG 预览和以下问题发送给所选服务。",
              "This JPEG preview and the question below will be sent to the selected service.",
            )
          : t(
              "本轮将把这张 JPEG 预览和所选资料一起发送给以下服务。",
              "This JPEG preview and the selected material will be sent to this service for this turn.",
            )}
      </p>
      {imageQuestion && <p>{imageQuestion}</p>}
      <small className="chat-image-endpoint">{endpoint}</small>
      <label className="chat-image-model">
        {t("视觉模型", "Vision model")}
        <input
          value={model}
          maxLength={256}
          onChange={(e) => setModel(e.target.value)}
        />
      </label>
      <footer>
        <button type="button" data-autofocus onClick={onClose}>
          {t("取消", "Cancel")}
        </button>
        <button
          type="button"
          className="primary"
          disabled={
            !endpoint ||
            !model.trim() ||
            !state?.preview?.hash ||
            !state.preview.url
          }
          onClick={() =>
            state?.preview && onConfirm(model.trim(), state.preview.hash)
          }
        >
          {t("发送图片", "Send image")}
        </button>
      </footer>
    </ModalDialog>
  );
}
