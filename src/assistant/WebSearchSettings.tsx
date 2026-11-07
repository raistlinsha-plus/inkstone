import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import ModalDialog from "../ModalDialog";

interface WebSettings {
  enabled: boolean;
  hasKey: boolean;
  provider: "brave";
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

  return (
    <ModalDialog
      label="自动联网设置"
      className="settings-modal"
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
          <label>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              disabled={busy}
            />
            允许模型按需联网
          </label>
          <label>
            Brave Search API 密钥
            <input
              type="password"
              autoComplete="off"
              value={key}
              placeholder={settings.hasKey ? "已保存 · 留空保留" : "输入密钥"}
              disabled={busy || clear}
              onChange={(e) => setKey(e.target.value)}
            />
          </label>
          {settings.hasKey && (
            <label>
              <input
                type="checkbox"
                checked={clear}
                disabled={busy}
                onChange={(e) => {
                  setClear(e.target.checked);
                  if (e.target.checked) {
                    setKey("");
                    setEnabled(false);
                  }
                }}
              />
              删除已保存的搜索密钥
            </label>
          )}
          <div className="modal-actions">
            <button type="button" disabled={busy} onClick={onClose}>
              取消
            </button>
            <button
              type="submit"
              className="primary"
              disabled={
                busy ||
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
