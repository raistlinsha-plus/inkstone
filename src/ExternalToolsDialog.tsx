import { msg } from "./i18n";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import ModalDialog from "./ModalDialog";
import type { LibraryProject } from "./library";

type Grant = { id: string; name: string; space: string };

export default function ExternalToolsDialog({
  projects,
  onClose,
}: {
  projects: LibraryProject[];
  onClose: () => void;
}) {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [space, setSpace] = useState("");
  const [name, setName] = useState("");
  const [issued, setIssued] = useState<{ token: string; space: string }>();
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let mounted = true;
    invoke<Grant[]>("external_grants")
      .then(
        (value) => {
          if (mounted) setGrants(value);
        },
        (reason) => {
          if (mounted) setError(String(reason));
        },
      )
      .finally(() => {
        if (mounted) setBusy(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  async function create() {
    setBusy(true);
    setError("");
    try {
      const token = await invoke<string>("external_grant_create", {
        space,
        name: name.trim(),
      });
      setReveal(false);
      setIssued({ token, space });
      setName("");
      setGrants(await invoke<Grant[]>("external_grants"));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    setError("");
    try {
      await invoke("external_grant_revoke", { id });
      setGrants((old) => old.filter((g) => g.id !== id));
      setIssued(undefined);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalDialog
      label={msg("外部工具")}
      className="settings-modal web-search-settings"
      busy={busy}
      onClose={onClose}
    >
      <h2>{msg("外部工具")}</h2>
      <p>
        {msg("允许一个本机工具搜索所选空间、读取原文片段。检索在本机完成，工具取得的内容可能会发送给它自己的模型。")}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && name.trim() && space) void create();
        }}
      >
        <label className="web-search-key">
          {msg("工具名称")}
          <input
            required
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            placeholder={msg("例如：周报助手")}
          />
        </label>
        <label className="web-search-key">
          {msg("允许读取的空间")}
          <select
            required
            value={space}
            onChange={(e) => setSpace(e.target.value)}
          >
            <option value="">{msg("选择空间…")}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="button"
          disabled={busy || !space || !name.trim()}
        >
          {msg("创建只读连接")}
        </button>
      </form>
      {issued && (
        <section className="web-search-diagnostic" aria-label={msg("新连接")}>
          <p>
            {msg("在工具的环境变量中设置")} <code>INKSTONE_CLI_TOKEN</code>
            {msg("。凭据只显示这一次。")}
          </p>
          <label className="web-search-key">
            {msg("连接凭据")}
            <input
              readOnly
              type={reveal ? "text" : "password"}
              autoComplete="off"
              value={issued.token}
              onFocus={(e) => e.target.select()}
            />
          </label>
          <button
            type="button"
            className="button small"
            onClick={() => setReveal(!reveal)}
          >
            {reveal ? msg("隐藏凭据") : msg("显示凭据以复制")}
          </button>
          <label className="web-search-key">
            {msg("空间 ID")}
            <input
              readOnly
              value={issued.space}
              onFocus={(e) => e.target.select()}
            />
          </label>
        </section>
      )}
      <section className="web-search-diagnostic" aria-label={msg("已授权连接")}>
        <h3>{msg("已授权连接")}</h3>
        {!busy && !error && !grants.length && <p>{msg("尚无连接。")}</p>}
        {grants.map((g) => (
          <div key={g.id} className="settings-utilities">
            <span>
              {g.name} ·{" "}
              {projects.find((p) => p.id === g.space)?.title ?? msg("空间不可用")}
            </span>
            <button
              className="button small"
              disabled={busy}
              onClick={() => void revoke(g.id)}
              aria-label={`撤销 ${g.name}`}
            >
              {msg("撤销")}
            </button>
          </div>
        ))}
      </section>
      {error && (
        <p className="inline-message error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button className="button" disabled={busy} onClick={onClose}>
          {msg("完成")}
        </button>
      </div>
    </ModalDialog>
  );
}
