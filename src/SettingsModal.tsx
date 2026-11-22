import { msg, systemMessage } from "./i18n";
import { useLocale } from "./i18n";
import { isImeEvent } from "./platform/ime";
import { getAppearance, setAppearance } from "./platform/appearance";
import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, KeyRound, LoaderCircle, Server, X } from "lucide-react";
import {
  defaultRerankProvider,
  type Provider,
  type RerankProvider,
  type Settings,
} from "./types";
import ModalDialog from "./ModalDialog";
import type { LibraryProject } from "./library";
import ExternalToolsDialog from "./ExternalToolsDialog";
type Tab = "embedding" | "chat" | "rerank";
type SavedKeySource = "embedding" | "chat";
const keyFlags = { embedding: "hasEmbeddingKey", chat: "hasChatKey", rerank: "hasRerankKey" } as const;
function serviceOrigin(address: string): string | null {
  try {
    const url = new URL(address);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

export default function SettingsModal({
  value,
  initialTab = "embedding",
  chatSetupOnly = false,
  onClose,
  onSave,
  onWebSearch,
  onKeyImported,
  projects,
}: {
  value: Settings;
  initialTab?: Tab;
  chatSetupOnly?: boolean;
  onClose: () => void;
  onSave: (settings: Settings) => void;
  onWebSearch?: () => void;
  onKeyImported?: (value: Settings) => void;
  projects?: LibraryProject[];
}) {
  const { preference, setPreference, t } = useLocale();
  const [form, setForm] = useState<Settings>(() => ({
    ...structuredClone(value),
    chat: { ...value.chat, enabled: chatSetupOnly || value.chat.enabled },
    rerank: { ...defaultRerankProvider, ...value.rerank },
  }));
  const [keys, setKeys] = useState({ embedding: "", chat: "", rerank: "" });
  const [reuseKeySource, setReuseKeySource] = useState<SavedKeySource | null>(
    null,
  );
  const [clear, setClear] = useState({
    embedding: false,
    chat: false,
    rerank: false,
  });
  const [tab, setTab] = useState<Tab>(chatSetupOnly ? "chat" : initialTab);
  const [busy, setBusy] = useState("");
  const [externalOpen, setExternalOpen] = useState(false);
  const [appearance, setAppearanceChoice] = useState(getAppearance);
  const testGeneration = useRef(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    setMessage("");
    setError("");
  }, [form.embedding, form.chat, form.rerank, form.candidateReading, keys, clear, reuseKeySource]);
  const targetOrigin = serviceOrigin(form.rerank.endpoint);
  const reusableSources = (["embedding", "chat"] as const).filter((source) => {
    const savedOrigin = serviceOrigin(value[source].baseUrl);
    return (
      !!targetOrigin &&
      savedOrigin === targetOrigin &&
      serviceOrigin(form[source].baseUrl) === savedOrigin &&
      form[keyFlags[source]] &&
      !clear[source] &&
      !keys[source].trim()
    );
  });
  const selectedReuse =
    reuseKeySource &&
    reusableSources.includes(reuseKeySource) &&
    !keys.rerank.trim() &&
    !clear.rerank
      ? reuseKeySource
      : null;
  useEffect(() => {
    if (reuseKeySource && !selectedReuse) setReuseKeySource(null);
  }, [reuseKeySource, selectedReuse]);
  const provider = form[tab === "rerank" ? "embedding" : tab];
  const update = (patch: Partial<Provider>) => {
    if (tab === "rerank") return;
    if (patch.baseUrl !== undefined && patch.baseUrl !== provider.baseUrl) {
      setClear((old) => ({ ...old, [tab]: false }));
    }
    setForm((old) => ({
      ...old,
      ...(tab === "chat" && patch.baseUrl !== undefined && patch.baseUrl !== old.chat.baseUrl
        ? { candidateReading: false }
        : {}),
      [tab]: { ...old[tab], ...patch },
    }));
  };
  const updateRerank = (patch: Partial<RerankProvider>) => {
    if (patch.endpoint !== undefined && patch.endpoint !== form.rerank.endpoint) {
      setClear((old) => ({ ...old, rerank: false }));
    }
    setForm((old) => ({ ...old, rerank: { ...old.rerank, ...patch } }));
  };
  const changeKey = (kind: Tab, next: string) => {
    setKeys((old) => ({ ...old, [kind]: next }));
    if (next.trim()) {
      setClear((old) => ({ ...old, [kind]: false }));
      if (kind === "rerank") setReuseKeySource(null);
    }
  };
  const changeClearKey = (kind: Tab, checked: boolean) => {
    setClear((old) => ({ ...old, [kind]: checked }));
    if (checked) {
      setKeys((old) => ({ ...old, [kind]: "" }));
      setReuseKeySource(null);
    }
  };
  const address = tab === "rerank" ? form.rerank.endpoint : form[tab].baseUrl;
  const savedAddress = tab === "rerank" ? value.rerank?.endpoint : value[tab].baseUrl;
  const sameAddress = !!address && address === savedAddress;
  const hasKey = sameAddress && form[keyFlags[tab]];
  const canImport = sameAddress && !hasKey && !keys[tab].trim() && !clear[tab]
    && !(tab === "rerank" && selectedReuse);
  async function importLegacyKey() {
    if (busy || !canImport) return;
    setBusy("import");
    setMessage("");
    setError("");
    try {
      if (await invoke<boolean>("import_legacy_model_key", { kind: tab })) {
        const flag = keyFlags[tab];
        setForm((current) => ({ ...current, [flag]: true }));
        onKeyImported?.({ ...value, [flag]: true });
        setMessage(msg("密钥已导入本机，可直接使用。"));
      } else {
        setError(msg("未找到可导入的旧密钥。请填写 API 密钥后保存。"));
      }
    } catch {
      setError(msg("未能导入旧密钥。可重试并允许这次钥匙串读取，或填写 API 密钥后保存。"));
    } finally {
      setBusy("");
    }
  }
  async function test() {
    const generation = ++testGeneration.current;
    setBusy("test");
    setError("");
    setMessage("");
    try {
      const result =
        tab === "rerank"
          ? await invoke<string>("test_reranker", {
              provider: { ...form.rerank, enabled: true },
              key: keys.rerank || null,
              reuseKeyFrom: selectedReuse,
              skipStoredKey: clear.rerank,
            })
          : await invoke<string>("test_provider", {
              kind: tab,
              provider: { ...provider, enabled: true },
              key: keys[tab] || null,
              skipStoredKey: clear[tab],
            });
      if (generation === testGeneration.current) setMessage(result);
    } catch (e) {
      if (generation === testGeneration.current) setError(String(e));
    } finally {
      if (generation === testGeneration.current) setBusy("");
    }
  }
  async function stopTest() {
    ++testGeneration.current;
    await invoke("cancel_provider_test");
    setBusy("");
    setMessage(msg("连接测试已取消"));
  }
  async function save() {
    setBusy("save");
    setError("");
    try {
      const result = await invoke<Settings>("save_settings", {
        value: {
          candidateReading: form.candidateReading ?? false,
          embedding: form.embedding,
          chat: form.chat,
          rerank: form.rerank,
        },
        embeddingKey: keys.embedding || null,
        chatKey: keys.chat || null,
        rerankKey: keys.rerank || null,
        clearEmbeddingKey: clear.embedding,
        clearChatKey: clear.chat,
        clearRerankKey: clear.rerank,
        reuseRerankKeyFrom: selectedReuse,
      });
      onSave(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  }
  return (
    <>
    <ModalDialog
      label={msg("模型设置")}
      className="settings-modal"
      onClose={onClose}
      busy={!!busy}
    >
      <div className="modal-heading">
        <div>
          <h2>{chatSetupOnly ? msg("连接问答模型") : msg("连接你的模型")}</h2>
        </div>
        <button
          className="icon-button"
          aria-label={msg("关闭设置")}
          disabled={!!busy}
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      <p className="muted">
        {chatSetupOnly
          ? msg("配置自己的问答接口。保存后返回当前问题，准备好后再发送。")
          : msg("文件与索引保存在本机。按需要连接自己的 API，也可以使用本地服务。")}
      </p>
      {!chatSetupOnly && <div className="settings-utilities">
        {projects && (
          <button type="button" className="button small" disabled={!!busy} onClick={() => setExternalOpen(true)}>
            {msg("外部工具")}
          </button>
        )}
        {onWebSearch && (
          <button
            type="button"
            className="button small"
            disabled={!!busy}
            onClick={onWebSearch}
          >
            {msg("自动联网设置")}
          </button>
        )}
        <label>
          {msg("工作台外观")}
          <select
            value={appearance}
            onChange={(event) => {
              const next = event.target.value;
              if (next !== "system" && next !== "light" && next !== "dark")
                return;
              setAppearanceChoice(next);
              setAppearance(next);
            }}
          >
            <option value="system">{msg("跟随系统")}</option>
            <option value="light">{msg("浅色")}</option>
            <option value="dark">{msg("深色")}</option>
          </select>
        </label>
        <label>
          {t("语言 / Language", "Language / 语言")}
          <select value={preference} onChange={(event) => {
            const next = event.target.value;
            if (next === "system" || next === "zh-CN" || next === "en") setPreference(next);
          }}>
            <option value="system">{t("跟随系统", "Use system language")}</option>
            <option value="zh-CN">{"简体中文"}</option>
            <option value="en">English</option>
          </select>
        </label>
        <small>{msg("即时生效")}</small>
      </div>}
      {!chatSetupOnly && <div
        className="settings-tabs"
        role="tablist"
        aria-label={msg("模型用途")}
        onKeyDown={(event) => {
          if (isImeEvent(event.nativeEvent)) return;
          if (
            busy ||
            !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
          )
            return;
          event.preventDefault();
          const tabs: Tab[] = ["embedding", "chat", "rerank"];
          const index =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? 2
                : (tabs.indexOf(tab) + (event.key === "ArrowRight" ? 1 : 2)) %
                  3;
          setTab(tabs[index]);
          setMessage("");
          setError("");
          event.currentTarget
            .querySelector<HTMLButtonElement>(`[data-tab="${tabs[index]}"]`)
            ?.focus();
        }}
      >
        {(
          [
            ["embedding", msg("向量化模型"), msg("理解与检索资料")],
            ["chat", msg("问答模型"), msg("根据资料生成回答")],
            ["rerank", msg("重排模型"), msg("筛选更相关的证据")],
          ] as const
        ).map(([id, title, subtitle]) => (
          <button
            key={id}
            role="tab"
            data-tab={id}
            id={"settings-tab-" + id}
            tabIndex={tab === id ? 0 : -1}
            aria-controls="settings-provider-panel"
            aria-selected={tab === id}
            className={tab === id ? "active" : ""}
            disabled={!!busy}
            onClick={() => {
              setTab(id);
              setMessage("");
              setError("");
            }}
          >
            {title}
            <span>{subtitle}</span>
          </button>
        ))}
      </div>}
      <fieldset
        className="provider-fields"
        disabled={!!busy}
        role={chatSetupOnly ? undefined : "tabpanel"}
        id="settings-provider-panel"
        aria-label={chatSetupOnly ? msg("问答模型") : undefined}
        aria-labelledby={chatSetupOnly ? undefined : "settings-tab-" + tab}
      >
        <label className="enable-row">
          <span>
            <Server size={17} />
            {msg("启用")}
            {tab === "embedding"
              ? msg("语义检索")
              : tab === "chat"
                ? msg("资料问答")
                : msg("相关性重排")}
          </span>
          <input
            type="checkbox"
            checked={tab === "rerank" ? form.rerank.enabled : provider.enabled}
            onChange={(e) =>
              tab === "rerank"
                ? updateRerank({ enabled: e.target.checked })
                : update({ enabled: e.target.checked })
            }
          />
        </label>
        {tab === "rerank" ? (
          <div className="form-grid">
            <label className="wide">
              {msg("重排接口地址")}
              <input
                value={form.rerank.endpoint}
                onChange={(e) =>
                  updateRerank({ endpoint: e.target.value.trim() })
                }
                placeholder="https://your-provider.example/v2/rerank"
                spellCheck={false}
              />
              <small>
                {msg("填写服务文档中的完整接口地址。支持向量化或问答的地址不一定支持重排；请先测试连接。")}
              </small>
            </label>
            <label>
              {msg("接口协议")}
              <select value={form.rerank.protocol} onChange={() => {}}>
                <option value="cohere">{msg("Cohere 兼容重排接口")}</option>
              </select>
            </label>
            <label>
              {msg("重排模型名称")}
              <input
                value={form.rerank.model}
                onChange={(e) => updateRerank({ model: e.target.value })}
                placeholder={msg("服务支持的 rerank 模型")}
                spellCheck={false}
              />
            </label>
            <label className="wide">
              API Key{" "}
              {hasKey && (
                <span className="key-saved">
                  <KeyRound size={11} />
                  {msg("已保存")}
                </span>
              )}
              <input
                type="password"
                autoComplete="off"
                value={keys.rerank}
                onChange={(e) => changeKey("rerank", e.target.value)}
                placeholder={hasKey ? msg("留空保留现有密钥") : msg("本地服务可留空")}
              />
            </label>
            {reusableSources.length > 0 && (
              <div className="wide reuse-saved-key">
                <label className="reuse-key-option">
                  <input
                    type="checkbox"
                    checked={!!selectedReuse}
                    disabled={!!keys.rerank.trim() || clear.rerank}
                    onChange={(e) =>
                      setReuseKeySource(
                        e.target.checked ? reusableSources[0] : null,
                      )
                    }
                  />
                  <span>
                    {reusableSources.length === 1
                      ? reusableSources[0] === "embedding"
                        ? msg("沿用同服务已保存的向量密钥")
                        : msg("沿用同服务已保存的问答密钥")
                      : msg("沿用同服务已保存的密钥")}
                  </span>
                </label>
                {selectedReuse && reusableSources.length > 1 && (
                  <label>
                    {msg("已保存的密钥来源")}
                    <select
                      value={selectedReuse}
                      onChange={(e) =>
                        setReuseKeySource(e.target.value as SavedKeySource)
                      }
                    >
                      {reusableSources.map((source) => (
                        <option key={source} value={source}>
                          {source === "embedding" ? msg("向量化服务") : msg("问答服务")}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <small>
                  {msg("测试使用同服务已保存的密钥。保存设置时会为重排单独保留一份。填写独立密钥时优先使用填写值。")}
                </small>
              </div>
            )}
            <details>
              <summary>{msg("重排与证据参数")}</summary>
              <div className="advanced-fields">
                <label>
                  {msg("最多重排候选数")}
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={form.rerank.candidateCount}
                    onChange={(e) =>
                      updateRerank({ candidateCount: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  {msg("超时（秒）")}
                  <input
                    type="number"
                    min={0.5}
                    max={30}
                    step={0.5}
                    value={form.rerank.timeoutMs / 1000}
                    onChange={(e) =>
                      updateRerank({ timeoutMs: Number(e.target.value) * 1000 })
                    }
                  />
                </label>
                <label>
                  {msg("每条候选字符上限")}
                  <input
                    type="number"
                    min={128}
                    max={12000}
                    value={form.rerank.maxInputChars}
                    onChange={(e) =>
                      updateRerank({ maxInputChars: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  {msg("最低证据分")}
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={form.rerank.minScore}
                    onChange={(e) =>
                      updateRerank({ minScore: Number(e.target.value) })
                    }
                  />
                  <small>
                    {msg("阈值需按所选模型与资料评测，不能视为回答正确率。")}
                  </small>
                </label>
                <label className="wide clear-key">
                  <input
                    type="checkbox"
                    checked={form.rerank.strict}
                    onChange={(e) => updateRerank({ strict: e.target.checked })}
                  />
                  {msg("严格证据模式")}
                </label>
                <small className="wide">
                  {msg("重排只排序和筛选已有证据，不能仅凭高分新增证据。严格模式在重排失败时不使用资料生成答案。")}
                </small>
              </div>
            </details>
          </div>
        ) : (
          <div className="form-grid">
            <label className="wide">
              {msg("服务地址 · Base URL")}
              <input
                value={provider.baseUrl}
                onChange={(e) => update({ baseUrl: e.target.value.trim() })}
                placeholder="https://your-provider.com/v1"
                spellCheck={false}
              />
              <small>
                {msg("包含接口前缀，例如 /v1；本机 Ollama 可填 http://localhost:11434/v1")}
              </small>
            </label>
            <label>
              {msg("模型名称")}
              <input
                value={provider.model}
                onChange={(e) => update({ model: e.target.value })}
                placeholder={
                  tab === "embedding" ? msg("你的 embedding 模型") : msg("你的对话模型")
                }
                spellCheck={false}
              />
            </label>
            <label>
              API Key{" "}
              {hasKey && (
                <span className="key-saved">
                  <KeyRound size={11} />
                  {msg("已保存")}
                </span>
              )}
              <input
                type="password"
                autoComplete="off"
                value={keys[tab]}
                onChange={(e) => changeKey(tab, e.target.value)}
                placeholder={hasKey ? msg("留空保留现有密钥") : msg("本机服务可留空")}
              />
            </label>
            {tab === "chat" && (
              <div className="wide">
                <label className="clear-key">
                  <input
                    type="checkbox"
                    checked={form.candidateReading ?? false}
                    aria-describedby="candidate-reading-help"
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setForm((old) => ({ ...old, candidateReading: checked }));
                    }}
                  />
                  {msg("用问答模型核对候选原文")}
                </label>
                <small id="candidate-reading-help">
                  {msg("本机取证不足时，可把小问与所选资料的标题、原句发给上方问答服务核对。每题最多增加一次请求，最多 8 段、合计 4,000 个原文字符。")}
                </small>
              </div>
            )}
            <details>
              <summary>{msg("高级参数")}</summary>
              <div className="advanced-fields">
                {tab === "embedding" ? (
                  <>
                    <label>
                      {msg("向量维度（可选）")}
                      <input
                        type="number"
                        min={1}
                        max={16384}
                        value={provider.dimensions ?? ""}
                        onChange={(e) =>
                          update({
                            dimensions: e.target.value
                              ? Number(e.target.value)
                              : null,
                          })
                        }
                        placeholder={msg("自动检测")}
                      />
                    </label>
                    <label>
                      {msg("每批切片数")}
                      <input
                        type="number"
                        min={1}
                        max={32}
                        value={provider.batchSize}
                        onChange={(e) =>
                          update({ batchSize: Number(e.target.value) })
                        }
                      />
                    </label>
                    <label className="wide">
                      {msg("单个输入字符上限")}
                      <input
                        type="number"
                        min={128}
                        max={12000}
                        value={provider.maxInputChars}
                        onChange={(e) =>
                          update({ maxInputChars: Number(e.target.value) })
                        }
                      />
                      <small>
                        {msg("包含标题上下文；设定应保守低于模型的 token 上限。更改模型、维度或切片长度后需更新索引。")}
                      </small>
                    </label>
                  </>
                ) : (
                  <label className="wide">
                    {msg("问答上下文字符预算")}
                    <input
                      type="number"
                      min={2000}
                      max={100000}
                      value={provider.contextChars}
                      onChange={(e) =>
                        update({ contextChars: Number(e.target.value) })
                      }
                    />
                    <small>{msg("更换问答模型不会重建索引。")}</small>
                  </label>
                )}
              </div>
            </details>
          </div>
        )}
        {hasKey && (
          <label className="clear-key">
            <input
              type="checkbox"
              checked={clear[tab]}
              onChange={(e) => changeClearKey(tab, e.target.checked)}
            />
            {msg("删除已保存的此服务密钥")}
          </label>
        )}
        <div className="privacy-note">
          <KeyRound size={15} />
          <div>
            {tab === "rerank"
              ? msg("远程重排会把问题和候选片段发送到你配置的服务；默认关闭。")
              : msg("远程向量化发送所选文本，问答发送问题与命中的片段。")}{" "}
            {msg("API 密钥保存在当前 Mac 用户的本地配置中。更换服务地址后需重新填写。")}
            {canImport && (
              <div>
                <button type="button" className="button small" onClick={importLegacyKey}>
                  {msg("从旧钥匙串导入")}
                </button>{" "}
                {msg("仅导入时可能弹出 macOS 授权提示。")}
              </div>
            )}
          </div>
        </div>
      </fieldset>
      {(error || message) && (
        <div
          role="status"
          className={error ? "inline-message error" : "inline-message success"}
        >
          {(error && systemMessage(error)) || (
            <>
              <Check size={15} />
              {message}
            </>
          )}
        </div>
      )}
      <div className="modal-actions">
        <button className="button" disabled={!!busy} onClick={test}>
          {busy === "test" && <LoaderCircle size={15} className="spin" />}
          {msg("测试连接")}
        </button>
        {busy === "test" && (
          <button className="button" onClick={() => void stopTest()}>
            {msg("停止测试")}
          </button>
        )}
        <div />
        <button className="button ghost" disabled={!!busy} onClick={onClose}>
          {msg("取消")}
        </button>
        <button className="button primary" disabled={!!busy} onClick={save}>
          {busy === "save" && <LoaderCircle size={15} className="spin" />}
          {msg("保存设置")}
        </button>
      </div>
    </ModalDialog>
    {externalOpen && projects && (
      <ExternalToolsDialog projects={projects} onClose={() => setExternalOpen(false)} />
    )}
    </>
  );
}
