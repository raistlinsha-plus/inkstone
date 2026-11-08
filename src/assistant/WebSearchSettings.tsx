import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import ModalDialog from "../ModalDialog";

interface WebSettings {
  enabled: boolean;
  hasKey: boolean;
  provider: "brave";
}

const diagnosticMessages = {
  ok: "Brave 搜索接口可用，已读取一条公开网页的正文。",
  missing_key: "未找到可用密钥，请输入 Brave Search API 密钥后重试。",
  invalid_key: "密钥格式不正确，请检查复制的内容后重试。",
  keychain:
    "暂时无法读取已保存的密钥。请检查 macOS 钥匙串授权，或用新输入的密钥测试。",
  timeout: "连接 Brave Search 超时。请检查当前网络是否能直连 Brave Search。",
  connection: "未能与 Brave Search 建立连接。请检查当前网络的 DNS 和直连情况。",
  unauthorized: "Brave Search 未接受该密钥。请检查密钥是否有效。",
  forbidden: "Brave Search 拒绝了访问。请检查密钥权限和搜索订阅。",
  rate_limited:
    "Brave Search 触发限流或额度限制。请稍后重试，或在 Brave 控制台检查额度。",
  provider_error: "Brave Search 服务暂时异常。请稍后重试。",
  unexpected_status: "Brave Search 返回了非预期的 HTTP 状态。请稍后重试。",
  invalid_response: "Brave Search 已响应，但返回的数据无法读取。",
  no_candidates: "Brave 搜索接口已响应，本次未返回符合安全规则的公开网页。",
  page_unreadable: "Brave 搜索接口可用，但本次抽查的公开网页无法读取正文。",
  unavailable: "暂时无法运行连接测试。请稍后重试。",
} as const;

interface BraveDiagnostic {
  status: keyof typeof diagnosticMessages;
  searchElapsedMs: number | null;
  pageElapsedMs: number | null;
  candidateCount: number | null;
  httpStatus: number | null;
}

export default function WebSearchSettings({
  onClose,
}: {
  onClose: () => void;
}) {
  const [settings, setSettings] = useState<WebSettings>();
  const [enabled, setEnabled] = useState(false);
  const [key, setKey] = useState("");
  const [clear, setClear] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [testing, setTesting] = useState(false);
  const [diagnostic, setDiagnostic] = useState<BraveDiagnostic>();
  useEffect(() => {
    let active = true;
    void invoke<WebSettings>("web_search_settings")
      .then((next) => {
        if (!active) return;
        setSettings(next);
        setEnabled(next.enabled);
      })
      .catch((reason) => {
        if (active) setError(String(reason));
      });
    return () => {
      active = false;
    };
  }, []);

  async function save() {
    if (busy || testing) return;
    setBusy(true);
    setError("");
    try {
      await invoke<WebSettings>("save_web_search_settings", {
        enabled,
        apiKey: key.trim() || null,
        clearKey: clear,
      });
      onClose();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    if (busy || testing || clear) return;
    setTesting(true);
    setDiagnostic(undefined);
    try {
      setDiagnostic(
        await invoke<BraveDiagnostic>("test_web_search_connection", {
          apiKey: key.trim() || null,
        }),
      );
    } catch {
      setDiagnostic({
        status: "unavailable",
        searchElapsedMs: null,
        pageElapsedMs: null,
        candidateCount: null,
        httpStatus: null,
      });
    } finally {
      setTesting(false);
    }
  }

  return (
    <ModalDialog
      label="自动联网设置"
      className="settings-modal web-search-settings"
      busy={busy}
      onClose={onClose}
    >
      <h2>自动联网</h2>
      <p>
        配置 Brave Search
        后，模型按问题判断是否查公开资料。应用校验可发送的公开查询，网页访问使用独立的请求。
      </p>
      {!settings && !error && <p role="status">正在读取搜索设置…</p>}
      {settings && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="web-search-toggle">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              disabled={busy || testing}
            />
            允许模型按需联网
          </label>
          <label className="web-search-key">
            Brave Search API 密钥
            <input
              type="password"
              autoComplete="off"
              value={key}
              placeholder={settings.hasKey ? "已保存 · 留空保留" : "输入密钥"}
              disabled={busy || testing || clear}
              onChange={(e) => {
                setKey(e.target.value);
                setDiagnostic(undefined);
              }}
            />
          </label>
          {settings.hasKey && (
            <label className="web-search-toggle">
              <input
                type="checkbox"
                checked={clear}
                disabled={busy || testing}
                onChange={(e) => {
                  setClear(e.target.checked);
                  setDiagnostic(undefined);
                  if (e.target.checked) {
                    setKey("");
                    setEnabled(false);
                  }
                }}
              />
              删除已保存的搜索密钥
            </label>
          )}
          <section className="web-search-diagnostic" aria-label="连接诊断">
            <button
              type="button"
              className="button"
              aria-disabled={busy || testing || clear}
              aria-describedby="web-search-test-description"
              onClick={() => void testConnection()}
            >
              测试连接
            </button>
            <p id="web-search-test-description">
              发送一条固定的公开查询，并尝试读取一条公开网页。测试可能计入 Brave
              用量，可在自动联网关闭时运行，且不会保存密钥或设置。
            </p>
            <div role="status" aria-atomic="true">
              {testing && <p>正在测试 Brave Search…</p>}
              {diagnostic && (
                <>
                  <p>{diagnosticMessages[diagnostic.status]}</p>
                  {(diagnostic.httpStatus != null ||
                    diagnostic.searchElapsedMs != null ||
                    diagnostic.candidateCount != null ||
                    diagnostic.pageElapsedMs != null) && (
                    <ul className="web-search-diagnostic-details">
                      {diagnostic.httpStatus != null && (
                        <li>HTTP {diagnostic.httpStatus}</li>
                      )}
                      {diagnostic.searchElapsedMs != null && (
                        <li>搜索耗时 {diagnostic.searchElapsedMs} ms</li>
                      )}
                      {diagnostic.candidateCount != null && (
                        <li>{diagnostic.candidateCount} 条可尝试的候选</li>
                      )}
                      {diagnostic.pageElapsedMs != null && (
                        <li>网页读取 {diagnostic.pageElapsedMs} ms</li>
                      )}
                    </ul>
                  )}
                </>
              )}
            </div>
          </section>
          <div className="modal-actions">
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={onClose}
            >
              取消
            </button>
            <button
              type="submit"
              className="button primary"
              disabled={
                busy ||
                testing ||
                (enabled && (clear || (!settings.hasKey && !key.trim())))
              }
            >
              保存
            </button>
          </div>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </ModalDialog>
  );
}
