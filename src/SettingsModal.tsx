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
type Tab = "embedding" | "chat" | "rerank";
type SavedKeySource = "embedding" | "chat";
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
  onClose,
  onSave,
  onWebSearch,
}: {
  value: Settings;
  onClose: () => void;
  onSave: (settings: Settings) => void;
  onWebSearch?: () => void;
}) {
  const [form, setForm] = useState<Settings>(() => ({
    ...structuredClone(value),
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
  const [tab, setTab] = useState<Tab>("embedding");
  const [busy, setBusy] = useState("");
  const [appearance, setAppearanceChoice] = useState(getAppearance);
  const testGeneration = useRef(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const targetOrigin = serviceOrigin(form.rerank.endpoint);
  const reusableSources = (["embedding", "chat"] as const).filter((source) => {
    const savedOrigin = serviceOrigin(value[source].baseUrl);
    return (
      !!targetOrigin &&
      savedOrigin === targetOrigin &&
      serviceOrigin(form[source].baseUrl) === savedOrigin &&
      (source === "embedding" ? value.hasEmbeddingKey : value.hasChatKey) &&
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
    setForm((old) => ({ ...old, [tab]: { ...old[tab], ...patch } }));
  };
  const updateRerank = (patch: Partial<RerankProvider>) =>
    setForm((old) => ({ ...old, rerank: { ...old.rerank, ...patch } }));
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
  const hasKey =
    tab === "embedding"
      ? value.hasEmbeddingKey
      : tab === "chat"
        ? value.hasChatKey
        : value.hasRerankKey;
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
    setMessage("连接测试已取消");
  }
  async function save() {
    setBusy("save");
    setError("");
    try {
      const result = await invoke<Settings>("save_settings", {
        value: {
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
    <ModalDialog
      label="模型设置"
      className="settings-modal"
      onClose={onClose}
      busy={!!busy}
    >
      <div className="modal-heading">
        <div>
          <span className="eyebrow">YOUR MODELS, YOUR CHOICE</span>
          <h2>连接你的模型</h2>
        </div>
        <button
          className="icon-button"
          aria-label="关闭设置"
          disabled={!!busy}
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      <p className="muted">
        文件与索引保存在本机。按需要连接自己的 API，也可以使用本地服务。
      </p>
      <div className="settings-utilities">
        {onWebSearch && (
          <button
            type="button"
            className="button small"
            disabled={!!busy}
            onClick={onWebSearch}
          >
            自动联网设置
          </button>
        )}
        <label>
          工作台外观
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
            <option value="system">跟随系统</option>
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </select>
        </label>
        <small>即时生效</small>
      </div>
      <div
        className="settings-tabs"
        role="tablist"
        aria-label="模型用途"
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
            ["embedding", "向量化模型", "理解与检索资料"],
            ["chat", "问答模型", "根据资料生成回答"],
            ["rerank", "重排模型", "筛选更相关的证据"],
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
      </div>
      <fieldset
        className="provider-fields"
        disabled={!!busy}
        role="tabpanel"
        id="settings-provider-panel"
        aria-labelledby={"settings-tab-" + tab}
      >
        <label className="enable-row">
          <span>
            <Server size={17} />
            启用
            {tab === "embedding"
              ? "语义检索"
              : tab === "chat"
                ? "资料问答"
                : "相关性重排"}
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
              重排接口地址
              <input
                value={form.rerank.endpoint}
                onChange={(e) =>
                  updateRerank({ endpoint: e.target.value.trim() })
                }
                placeholder="https://your-provider.example/v2/rerank"
                spellCheck={false}
              />
              <small>
                填写服务文档中的完整接口地址。支持向量化或问答的地址不一定支持重排；请先测试连接。
              </small>
            </label>
            <label>
              接口协议
              <select value={form.rerank.protocol} onChange={() => {}}>
                <option value="cohere">Cohere 兼容重排接口</option>
              </select>
            </label>
            <label>
              重排模型名称
              <input
                value={form.rerank.model}
                onChange={(e) => updateRerank({ model: e.target.value })}
                placeholder="服务支持的 rerank 模型"
                spellCheck={false}
              />
            </label>
            <label className="wide">
              API Key{" "}
              {hasKey && (
                <span className="key-saved">
                  <KeyRound size={11} />
                  已保存
                </span>
              )}
              <input
                type="password"
                autoComplete="off"
                value={keys.rerank}
                onChange={(e) => changeKey("rerank", e.target.value)}
                placeholder={hasKey ? "留空保留现有密钥" : "本地服务可留空"}
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
                        ? "沿用同服务已保存的向量密钥"
                        : "沿用同服务已保存的问答密钥"
                      : "沿用同服务已保存的密钥"}
                  </span>
                </label>
                {selectedReuse && reusableSources.length > 1 && (
                  <label>
                    已保存的密钥来源
                    <select
                      value={selectedReuse}
                      onChange={(e) =>
                        setReuseKeySource(e.target.value as SavedKeySource)
                      }
                    >
                      {reusableSources.map((source) => (
                        <option key={source} value={source}>
                          {source === "embedding" ? "向量化服务" : "问答服务"}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <small>
                  测试时读取同一服务已保存的密钥；保存时复制为独立重排密钥，重排开关仍由上方控制。密钥由钥匙串读取，不显示到界面；填写独立密钥时优先使用填写值。
                </small>
              </div>
            )}
            <details>
              <summary>重排与证据参数</summary>
              <div className="advanced-fields">
                <label>
                  最多重排候选数
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
                  超时（秒）
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
                  每条候选字符上限
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
                  最低证据分
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
                    阈值需按所选模型与资料评测，不能视为回答正确率。
                  </small>
                </label>
                <label className="wide clear-key">
                  <input
                    type="checkbox"
                    checked={form.rerank.strict}
                    onChange={(e) => updateRerank({ strict: e.target.checked })}
                  />
                  严格证据模式
                </label>
                <small className="wide">
                  重排只排序和筛选已有证据，不能仅凭高分新增证据。严格模式在重排失败时不使用资料生成答案。
                </small>
              </div>
            </details>
          </div>
        ) : (
          <div className="form-grid">
            <label className="wide">
              服务地址 · Base URL
              <input
                value={provider.baseUrl}
                onChange={(e) => update({ baseUrl: e.target.value.trim() })}
                placeholder="https://your-provider.com/v1"
                spellCheck={false}
              />
              <small>
                包含接口前缀，例如 /v1；本机 Ollama 可填
                http://localhost:11434/v1
              </small>
            </label>
            <label>
              模型名称
              <input
                value={provider.model}
                onChange={(e) => update({ model: e.target.value })}
                placeholder={
                  tab === "embedding" ? "你的 embedding 模型" : "你的对话模型"
                }
                spellCheck={false}
              />
            </label>
            <label>
              API Key{" "}
              {hasKey && (
                <span className="key-saved">
                  <KeyRound size={11} />
                  已保存
                </span>
              )}
              <input
                type="password"
                autoComplete="off"
                value={keys[tab]}
                onChange={(e) => changeKey(tab, e.target.value)}
                placeholder={hasKey ? "留空保留现有密钥" : "本机服务可留空"}
              />
            </label>
            <details>
              <summary>高级参数</summary>
              <div className="advanced-fields">
                {tab === "embedding" ? (
                  <>
                    <label>
                      向量维度（可选）
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
                        placeholder="自动检测"
                      />
                    </label>
                    <label>
                      每批切片数
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
                      单个输入字符上限
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
                        包含标题上下文；设定应保守低于模型的 token
                        上限。更改模型、维度或切片长度后需更新索引。
                      </small>
                    </label>
                  </>
                ) : (
                  <label className="wide">
                    问答上下文字符预算
                    <input
                      type="number"
                      min={2000}
                      max={100000}
                      value={provider.contextChars}
                      onChange={(e) =>
                        update({ contextChars: Number(e.target.value) })
                      }
                    />
                    <small>更换问答模型不会重建索引。</small>
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
            删除已保存的此服务密钥
          </label>
        )}
        <div className="privacy-note">
          <KeyRound size={15} />
          <span>
            {tab === "rerank"
              ? "远程重排会把问题和候选片段发送到你配置的服务；默认关闭。"
              : "远程向量化发送所选文本，问答发送问题与命中的片段。"}
            密钥存入 macOS 钥匙串，服务地址变化后需重新填写。
          </span>
        </div>
      </fieldset>
      {(error || message) && (
        <div
          role="status"
          className={error ? "inline-message error" : "inline-message success"}
        >
          {error || (
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
          测试连接
        </button>
        {busy === "test" && (
          <button className="button" onClick={() => void stopTest()}>
            停止测试
          </button>
        )}
        <div />
        <button className="button ghost" disabled={!!busy} onClick={onClose}>
          取消
        </button>
        <button className="button primary" disabled={!!busy} onClick={save}>
          {busy === "save" && <LoaderCircle size={15} className="spin" />}
          保存设置
        </button>
      </div>
    </ModalDialog>
  );
}
