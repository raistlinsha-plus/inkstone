import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import ModalDialog from "../ModalDialog";

const fields = {
  structure: {
    label: "回答结构",
    choices: {
      default: "默认",
      conclusion_first: "结论先行",
      compare: "适合时逐项对照",
    },
  },
  length: {
    label: "回答篇幅",
    choices: { standard: "标准", short: "精简", detailed: "详细" },
  },
  original_units: {
    label: "资料单位",
    choices: { default: "默认", explicit: "显式标注原单位" },
  },
} as const;
type Key = keyof typeof fields;
type Scope = "space" | "global";
interface Preference {
  key: Key;
  value: string;
  scope: Scope;
  enabled: boolean;
  revision: number;
}
interface Legacy {
  id: string;
  key: keyof typeof legacyKeys;
  value: string;
  scope: Scope;
}
interface Change {
  scope: Scope;
  key: Key;
  expectedRevision: number | null;
  value: string | null;
  enabled: boolean;
  legacyId?: string;
  ignoreLegacy?: boolean;
}
interface Settings {
  preferences: Preference[];
  legacy: Legacy[];
}
const legacyKeys = {
  answerStyle: "structure",
  answerLength: "length",
  displayUnit: "original_units",
} as const;

function PreferenceRow({
  scope,
  field,
  preference,
  legacy,
  busy,
  onSave,
}: {
  scope: Scope;
  field: Key;
  preference?: Preference;
  legacy?: Legacy;
  busy: boolean;
  onSave: (change: Change) => void;
}) {
  const definition = fields[field];
  const [value, setValue] = useState(legacy ? "" : (preference?.value ?? ""));
  const [enabled, setEnabled] = useState(
    !!legacy || preference?.enabled !== false,
  );
  const change = {
    scope,
    key: field,
    expectedRevision: preference?.revision ?? null,
    value,
    enabled,
    legacyId: legacy?.id,
  };
  return (
    <form
      className="answer-preference-row"
      onSubmit={(event) => {
        event.preventDefault();
        if (value) onSave(change);
      }}
    >
      {legacy && (
        <p>
          旧偏好 · {scope === "space" ? "当前空间" : "全部空间"} ·{" "}
          {legacy.value}
        </p>
      )}
      <label>
        {definition.label}
        <select
          value={value}
          disabled={busy}
          onChange={(event) => setValue(event.target.value)}
        >
          <option value="" disabled>
            请选择
          </option>
          {Object.entries(definition.choices).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="answer-preference-enabled">
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        启用
      </label>
      <div className="answer-preference-actions">
        <button
          className="button small"
          disabled={
            busy ||
            !value ||
            (!legacy &&
              value === preference?.value &&
              enabled === preference.enabled)
          }
        >
          {legacy ? "确认采用" : "保存"}
        </button>
        {legacy ? (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              onSave({ ...change, value: null, ignoreLegacy: true })
            }
          >
            忽略旧偏好
          </button>
        ) : (
          preference && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onSave({ ...change, value: null })}
            >
              删除
            </button>
          )
        )}
      </div>
    </form>
  );
}

export default function AnswerPreferences({
  workspaceRoot,
  general = false,
  onClose,
}: {
  workspaceRoot?: string;
  general?: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<Settings>();
  const [scope, setScope] = useState<Scope>(general ? "global" : "space");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    void invoke<Settings>("assistant_memory_settings", {
      workspaceRoot,
      ...(general ? { general: true } : {}),
    }).then(
      (result) => {
        if (active) {
          setData(result);
          setError("");
        }
      },
      (reason) => {
        if (active) setError(String(reason));
      },
    );
    return () => {
      active = false;
    };
  }, [workspaceRoot, general, refresh]);
  function save(change: Change) {
    setBusy(true);
    setError("");
    void invoke<Settings>("assistant_memory_update", {
      workspaceRoot,
      change,
      ...(general ? { general: true } : {}),
    })
      .then(setData, (reason) => setError(String(reason)))
      .finally(() => setBusy(false));
  }
  return (
    <ModalDialog
      label="回答偏好"
      className="assistant-history-dialog"
      busy={busy}
      onClose={onClose}
    >
      <div className="modal-heading">
        <h2>回答偏好</h2>
        <button disabled={busy} onClick={onClose}>
          关闭
        </button>
      </div>
      <p>
        偏好只影响表达方式。发送问答时，启用的选项会随请求发送给聊天模型。
        {general ? "通用问答" : "当前空间"}的启用项优先。
      </p>
      <label>
        编辑范围
        <select
          value={scope}
          disabled={busy}
          onChange={(event) =>
            setScope(event.target.value === "global" ? "global" : "space")
          }
        >
          <option value="space">{general ? "通用问答" : "当前空间"}</option>
          <option value="global">全部空间</option>
        </select>
      </label>
      {error && (
        <p role="alert">
          {error} <button onClick={() => setRefresh(refresh + 1)}>刷新</button>
        </p>
      )}
      {!data && !error && <p role="status">正在读取偏好…</p>}
      {data &&
        (Object.keys(fields) as Key[]).map((field) => {
          const preference = data.preferences.find(
            (row) => row.scope === scope && row.key === field,
          );
          return (
            <PreferenceRow
              key={scope + field + (preference?.revision ?? "")}
              scope={scope}
              field={field}
              preference={preference}
              busy={busy}
              onSave={save}
            />
          );
        })}
      {!!data?.legacy.length && (
        <section>
          <h3>旧偏好待确认</h3>
          <p>
            可以重新选择受支持的表达选项，或忽略这条记录。旧文字仅在本机展示。
          </p>
          {data.legacy.map((legacy) => {
            const field = legacyKeys[legacy.key];
            const preference = data.preferences.find(
              (row) => row.scope === legacy.scope && row.key === field,
            );
            return (
              <PreferenceRow
                key={legacy.id + (preference?.revision ?? "")}
                scope={legacy.scope}
                field={field}
                preference={preference}
                legacy={legacy}
                busy={busy}
                onSave={save}
              />
            );
          })}
        </section>
      )}
    </ModalDialog>
  );
}
