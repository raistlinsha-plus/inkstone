import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { confirm } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import {
  Check,
  ChevronDown,
  ImagePlus,
  LoaderCircle,
  Settings2,
  X,
} from "lucide-react";
import { systemMessage, translate as t } from "../i18n";
import type { LibraryDocument, LibraryProject } from "../library";
import { layout } from "../library/Organization";
import ModalDialog from "../ModalDialog";
import "./image-generation.css";

type Config = { baseUrl: string; model: string; useChatKey: boolean };
type Settings = {
  config: Config;
  chatBaseUrl: string;
  chatEnabled: boolean;
  hasKey: boolean;
};
type Receipt = {
  document: LibraryDocument;
  existing: boolean;
  actualFolder: string | null;
  warning: string | null;
};
export interface ImageQuitGuard {
  confirmExit: () => Promise<boolean>;
  cancelGeneration: () => Promise<void>;
}
interface Props {
  quitGuard?: RefObject<ImageQuitGuard | null>;
  projects: LibraryProject[];
  projectId?: string;
  initialFolder?: string;
  initialPrompt?: string;
  onRefresh: () => Promise<unknown>;
  onOpen: (doc: LibraryDocument) => void;
}
export function ImageGenerationTool({
  disabled,
  ...props
}: Props & { disabled: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="image-gen-trigger"
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        title={t("生成图片", "Create image")}
        aria-label={t("生成图片", "Create image")}
      >
        <ImagePlus size={16} />
      </button>
      {open && <ImageGeneration {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

export default function ImageGeneration({
  projects,
  projectId,
  initialFolder = "",
  initialPrompt = "",
  onRefresh,
  onOpen,
  onClose,
  quitGuard,
}: Props & { onClose: () => void }) {
  const writable = projects.filter((p) => !p.archived);
  const [project, setProject] = useState(
    writable.find((p) => p.id === projectId)?.id ?? writable[0]?.id ?? "",
  );
  const [folder, setFolder] = useState(initialFolder);
  const [destinations, setDestinations] = useState<string[] | null>(null);
  const [folderError, setFolderError] = useState("");
  const [folderAttempt, setFolderAttempt] = useState(0);
  const [decision, setDecision] = useState<"close" | "replace" | null>(null);
  const [service, setService] = useState<Settings | null>(null);
  const [config, setConfig] = useState<Config>({
    baseUrl: "",
    model: "",
    useChatKey: false,
  });
  const [editConfig, setEditConfig] = useState(false);
  const [key, setKey] = useState("");
  const [prompt, setPrompt] = useState(initialPrompt);
  const [title, setTitle] = useState("");
  const [preview, setPreview] = useState("");
  const [previewPrompt, setPreviewPrompt] = useState("");
  const [revising, setRevising] = useState(false);
  const showingPreview = Boolean(preview) && !revising;
  const promptField = useRef<HTMLTextAreaElement>(null);
  const nameField = useRef<HTMLInputElement>(null);
  const openButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [working, setWorking] = useState<"generate" | "save" | "">("");
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const active = useRef("");
  const saving = useRef(false);
  const saveFinished = useRef<Promise<void> | null>(null);
  const unsavedPreview = useRef(false);
  useLayoutEffect(() => {
    if (!quitGuard) return;
    const guard: ImageQuitGuard = {
      async confirmExit() {
        await saveFinished.current;
        if (!active.current && !unsavedPreview.current) return true;
        const generating = !!active.current;
        return confirm(
          generating
            ? t(
                "退出后将无法保留本次生图结果。",
                "Quitting will discard the result of this generation.",
              )
            : t(
                "这张图片尚未保存到空间。退出后将丢失预览。",
                "This image has not been saved to a space. Quitting will discard the preview.",
              ),
          {
            title: t("退出 Inkstone？", "Quit Inkstone?"),
            kind: "warning",
            okLabel: t("放弃并退出", "Discard and quit"),
            cancelLabel: generating
              ? t("继续生成", "Keep generating")
              : t("返回预览", "Back to preview"),
          },
        );
      },
      async cancelGeneration() {
        const requestId = active.current;
        if (requestId)
          await invoke("image_generation_cancel", { requestId }).catch(
            () => {},
          );
      },
    };
    quitGuard.current = guard;
    return () => {
      if (quitGuard.current === guard) quitGuard.current = null;
    };
  }, [quitGuard]);
  const destinationName = projects.find((p) => p.id === project)?.title ?? "";
  const describeError = (err: unknown) =>
    systemMessage(String(err instanceof Error ? err.message : err));

  useEffect(() => {
    let current = true;
    invoke<Settings>("image_generation_settings")
      .then((value) => {
        if (!current) return;
        setService(value);
        setConfig(value.config);
        setEditConfig(!value.config.model);
      })
      .catch((err) => current && setError(describeError(err)));
    return () => {
      current = false;
    };
  }, [reload]);
  useEffect(
    () => () => {
      const requestId = active.current;
      active.current = "";
      if (requestId)
        void invoke("image_generation_cancel", { requestId }).catch(() => {});
    },
    [],
  );
  useEffect(() => {
    let current = true;
    setDestinations(null);
    setFolderError("");
    if (project)
      layout(project)
        .then((value) => {
          if (!current) return;
          setDestinations(value.folders);
          setFolder((existing) =>
            value.folders.includes(existing) ? existing : "",
          );
        })
        .catch((err) => current && setFolderError(describeError(err)));
    return () => {
      current = false;
    };
  }, [project, folderAttempt]);
  async function generate() {
    if (
      active.current ||
      saving.current ||
      !service ||
      !prompt.trim() ||
      !config.model.trim() ||
      !config.baseUrl.trim()
    )
      return;
    const requestId = crypto.randomUUID();
    active.current = requestId;
    setWorking("generate");
    setError("");
    try {
      const image = await invoke<string>("image_generation_preview", {
        requestId,
        config,
        apiKey: config.useChatKey ? null : key || null,
        prompt: prompt.trim(),
      });
      if (active.current !== requestId) return;
      unsavedPreview.current = true;
      setPreview(image);
      setPreviewPrompt(prompt.trim());
      setRevising(false);
      setKey("");
      setEditConfig(false);
      setTitle(
        Array.from(
          prompt
            .trim()
            .replace(/[\\/\n\r]/g, " ")
            .replace(/^\.+/, ""),
        )
          .slice(0, 24)
          .join("")
          .trim() || t("生成的图片", "Generated image"),
      );
    } catch (err) {
      if (active.current === requestId) setError(describeError(err));
    } finally {
      if (active.current === requestId) {
        active.current = "";
        setWorking("");
      }
    }
  }
  async function save() {
    if (
      saving.current ||
      !preview ||
      !project ||
      !title.trim() ||
      destinations === null
    )
      return;
    saving.current = true;
    let finishSave!: () => void;
    saveFinished.current = new Promise<void>((resolve) => {
      finishSave = resolve;
    });
    setWorking("save");
    setError("");
    try {
      const result = await invoke<Receipt>("image_generation_save", {
        projectId: project,
        folder,
        title: title.trim(),
        preview,
      });
      unsavedPreview.current = false;
      setReceipt(result);
      window.dispatchEvent(new Event("inkstone-folders"));
      await onRefresh();
    } catch (err) {
      setError(describeError(err));
    } finally {
      saving.current = false;
      saveFinished.current = null;
      finishSave();
      setWorking("");
    }
  }
  useEffect(() => {
    if (working === "generate") cancelButton.current?.focus();
    else if (receipt) openButton.current?.focus();
    else if (showingPreview) nameField.current?.focus();
    else promptField.current?.focus();
  }, [working, showingPreview, receipt]);

  const close = () => {
    if (saving.current) return;
    if (preview && !receipt) setDecision("close");
    else onClose();
  };
  const path = [destinationName, receipt ? receipt.actualFolder : folder]
    .filter(Boolean)
    .join(" / ");
  const decisionTitle =
    decision === "close"
      ? t("放弃未保存的预览？", "Discard unsaved preview?")
      : t("重新生成图片？", "Generate a replacement?");
  return createPortal(
    <ModalDialog
      label={t("生成图片", "Create image")}
      className="image-generation"
      onClose={close}
      busy={working === "save"}
    >
      <header className="image-gen-header">
        <h2>
          <ImagePlus size={21} />
          {t("生成图片", "Create image")}
        </h2>
        <button
          type="button"
          className="image-gen-close"
          aria-label={t("关闭", "Close")}
          onClick={close}
          disabled={working === "save"}
        >
          <X size={18} />
        </button>
      </header>
      {!showingPreview ? (
        <>
          <label>
            {t("图片描述", "Image prompt")}
            <textarea
              ref={promptField}
              data-autofocus
              rows={4}
              maxLength={12000}
              value={prompt}
              disabled={!!working}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t(
                "描述画面内容、风格和用途…",
                "Describe the subject, style and intended use…",
              )}
            />
          </label>
          {service && (
            <section className="image-gen-settings">
              <button
                type="button"
                className="image-gen-settings-toggle"
                aria-expanded={editConfig}
                disabled={!!working}
                onClick={() => setEditConfig(!editConfig)}
              >
                <Settings2 size={15} />
                <span>
                  {config.model || t("设置生图服务", "Set up image service")}
                </span>
                <ChevronDown size={14} />
              </button>
              {editConfig && (
                <div className="image-gen-fields">
                  <label>
                    {t("服务", "Service")}
                    <select
                      aria-label={t("服务", "Service")}
                      value={config.useChatKey ? "chat" : "custom"}
                      disabled={!!working}
                      onChange={(e) => {
                        const useChatKey = e.target.value === "chat";
                        setKey("");
                        setConfig({
                          ...config,
                          useChatKey,
                          baseUrl: useChatKey
                            ? service.chatBaseUrl
                            : config.baseUrl,
                        });
                      }}
                    >
                      {service.chatEnabled && (
                        <option value="chat">
                          {t(
                            "使用问答服务及其密钥",
                            "Use chat service and its key",
                          )}
                        </option>
                      )}
                      <option value="custom">
                        {t("独立生图服务", "Separate image service")}
                      </option>
                    </select>
                  </label>
                  <label>
                    API Base URL
                    <input
                      value={config.baseUrl}
                      placeholder="https://…/v1"
                      disabled={!!working || config.useChatKey}
                      onChange={(e) => {
                        setKey("");
                        setConfig({ ...config, baseUrl: e.target.value });
                      }}
                    />
                  </label>
                  <label>
                    {t("模型 ID", "Model ID")}
                    <input
                      value={config.model}
                      placeholder="gpt-image-1"
                      disabled={!!working}
                      onChange={(e) =>
                        setConfig({ ...config, model: e.target.value })
                      }
                    />
                  </label>
                  {!config.useChatKey && (
                    <label>
                      API Key
                      <input
                        type="password"
                        autoComplete="off"
                        value={key}
                        disabled={!!working}
                        onChange={(e) => setKey(e.target.value)}
                        placeholder={
                          service.config.baseUrl === config.baseUrl &&
                          service.hasKey
                            ? t(
                                "已保存，可输入新密钥替换",
                                "Saved · enter a new key to replace",
                              )
                            : t("本机服务可留空", "Optional for local services")
                        }
                      />
                    </label>
                  )}
                </div>
              )}
            </section>
          )}
          {service && (
            <small>
              {t("生成时将图片描述发送至", "Generating sends your prompt to")}{" "}
              {config.baseUrl || t("所选服务", "the selected service")}
            </small>
          )}
        </>
      ) : (
        <>
          <figure className="image-gen-preview">
            <img src={preview} alt={previewPrompt} />
          </figure>
          {receipt ? (
            <p role="status" className="image-gen-location">
              <Check size={15} />
              {receipt.existing
                ? t("已在", "Already in")
                : t("已保存到", "Saved to")}{" "}
              {path} · {receipt.document.title.replace(/\.md$/i, "")}
            </p>
          ) : (
            <div className="image-gen-fields destination">
              <label>
                {t("图片名称", "Image name")}
                <input
                  ref={nameField}
                  value={title}
                  maxLength={100}
                  disabled={!!working}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label>
                {t("空间", "Space")}
                <select
                  aria-label={t("空间", "Space")}
                  value={project}
                  disabled={!!working}
                  onChange={(e) => {
                    setFolder("");
                    setDestinations(null);
                    setError("");
                    setProject(e.target.value);
                  }}
                >
                  {writable.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("文件夹", "Folder")}
                <select
                  aria-label={t("文件夹", "Folder")}
                  value={folder}
                  disabled={!!working || destinations === null}
                  onChange={(e) => setFolder(e.target.value)}
                >
                  <option value="">
                    {destinations !== null
                      ? t("空间根目录", "Space root")
                      : folderError
                        ? t("目录不可用", "Folders unavailable")
                        : t("正在读取目录…", "Loading folders…")}
                  </option>
                  {destinations?.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </>
      )}
      {folderError && showingPreview && !receipt && (
        <p role="alert" className="image-gen-error">
          {t("无法读取保存目录", "Could not load destination folders")} ·{" "}
          {folderError}{" "}
          <button type="button" onClick={() => setFolderAttempt((n) => n + 1)}>
            {t("重试目录", "Retry folders")}
          </button>
        </p>
      )}
      {(error || receipt?.warning) && (
        <p role="alert" className="image-gen-error">
          {error || receipt?.warning}
        </p>
      )}
      <footer>
        {receipt ? (
          <>
            <button type="button" onClick={close}>
              {t("完成", "Done")}
            </button>
            <button
              type="button"
              className="primary"
              ref={openButton}
              onClick={() => {
                close();
                onOpen(receipt.document);
              }}
            >
              {t("打开图片", "Open image")}
            </button>
          </>
        ) : (
          <>
            <button
              ref={cancelButton}
              type="button"
              disabled={working === "save"}
              onClick={close}
            >
              {t("取消", "Cancel")}
            </button>
            {revising && !working && (
              <button
                type="button"
                onClick={() => {
                  setRevising(false);
                  setError("");
                }}
              >
                {t("返回预览", "Back to preview")}
              </button>
            )}
            {showingPreview ? (
              <>
                <button
                  type="button"
                  disabled={!!working}
                  onClick={() => {
                    setRevising(true);
                    setError("");
                  }}
                >
                  {t("修改描述", "Edit prompt")}
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={
                    !!working ||
                    !project ||
                    !title.trim() ||
                    destinations === null
                  }
                  onClick={() => void save()}
                >
                  {working === "save"
                    ? t("正在保存…", "Saving…")
                    : t("保存到空间", "Save to space")}
                </button>
              </>
            ) : !service && error ? (
              <button
                type="button"
                onClick={() => {
                  setError("");
                  setReload((n) => n + 1);
                }}
              >
                {t("重试", "Retry")}
              </button>
            ) : (
              <button
                type="button"
                className="primary"
                onClick={() =>
                  preview ? setDecision("replace") : void generate()
                }
                disabled={
                  !service ||
                  !!working ||
                  !config.baseUrl.trim() ||
                  !config.model.trim() ||
                  !prompt.trim() ||
                  !writable.length
                }
              >
                {working && <LoaderCircle size={15} />}{" "}
                {working
                  ? t("正在生成…", "Generating…")
                  : t("生成预览", "Generate preview")}
              </button>
            )}
          </>
        )}
      </footer>
      {decision &&
        createPortal(
          <ModalDialog
            label={decisionTitle}
            className="image-generation"
            onClose={() => setDecision(null)}
          >
            <header className="image-gen-header">
              <h2>{decisionTitle}</h2>
            </header>
            <p>
              {decision === "close"
                ? t(
                    "关闭后将丢失这张图片。你也可以返回预览并保存到空间。",
                    "Closing will discard this image. Return to the preview to save it to a space.",
                  )
                : t(
                    "将再次请求生图服务。新图片生成成功后会替换当前预览。",
                    "The image service will be called again. The new image will replace this preview when ready.",
                  )}
            </p>
            <footer>
              <button
                type="button"
                data-autofocus
                onClick={() => setDecision(null)}
              >
                {t("继续编辑", "Keep editing")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDecision(null);
                  if (decision === "close") onClose();
                  else void generate();
                }}
              >
                {decision === "close"
                  ? t("放弃预览", "Discard preview")
                  : t("重新生成", "Generate again")}
              </button>
            </footer>
          </ModalDialog>,
          document.body,
        )}
    </ModalDialog>,
    document.body,
  );
}
