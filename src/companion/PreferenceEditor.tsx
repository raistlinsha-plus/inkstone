import { useState } from "react";
import type { Workspace } from "../types";
import {
  characters,
  contextOf,
  preferenceLabels,
  type Snapshot,
  type Preference,
  type Context,
  type CharacterId,
} from "./types";
export interface PreferenceMutation {
  context: Context;
  id: string | null;
  key: string;
  value: string;
  scope: string;
  scopeId: string;
  enabled: boolean;
  delete: boolean;
}
export default function PreferenceEditor({
  snapshot,
  workspace,
  busy,
  onWrite,
}: {
  snapshot: Snapshot;
  workspace: Workspace | null;
  busy: boolean;
  onWrite: (input: PreferenceMutation) => Promise<boolean>;
}) {
  const [key, setKey] = useState("answerStyle"),
    [value, setValue] = useState(""),
    [scope, setScope] = useState("global"),
    [editing, setEditing] = useState<Preference | null>(null);
  const reset = () => {
    setEditing(null);
    setValue("");
    setScope("global");
  };
  const save = async (pref?: Preference, remove = false) => {
    const range = pref?.scope ?? scope;
    const scopeId =
      pref?.scopeId ??
      (editing?.scope === range ? editing.scopeId : null) ??
      (range === "global"
        ? "global"
        : range === "character"
          ? snapshot.settings.characterId
          : (workspace?.managedProjectId ?? ""));
    const ok = await onWrite({
      context: contextOf(snapshot),
      id: pref?.id ?? editing?.id ?? null,
      key: pref?.key ?? key,
      value: pref?.value ?? value,
      scope: range,
      scopeId,
      enabled: pref ? !pref.enabled : (editing?.enabled ?? true),
      delete: remove,
    });
    if (ok) reset();
  };
  return (
    <>
      <h3>你确认的偏好</h3>
      {snapshot.preferences.map((p) => (
        <article className="companion-preference" key={p.id}>
          <p>
            {preferenceLabels[p.key] ?? p.key}：{p.value}
          </p>
          <small>
            {p.scope === "global"
              ? "全局"
              : p.scope === "character"
                ? characters[p.scopeId as CharacterId]?.name
                : "指定空间"}{" "}
            · {p.enabled ? "启用" : "停用"}
          </small>
          <button
            disabled={busy || p.key === "nickname"}
            onClick={() => {
              setEditing(p);
              setKey(p.key);
              setValue(p.value);
              setScope(p.scope);
            }}
          >
            编辑
          </button>
          <button
            disabled={busy || p.key === "nickname"}
            onClick={() => void save(p)}
          >
            {p.enabled ? "停用" : "启用"}
          </button>
          <button disabled={busy} onClick={() => void save(p, true)}>
            删除
          </button>
        </article>
      ))}
      <div className="companion-preference-form">
        <label>
          偏好类别
          <select
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setScope("global");
            }}
          >
            {Object.entries(preferenceLabels)
              .filter(([k]) => k !== "nickname")
              .map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
          </select>
        </label>
        <label>
          内容
          <input
            value={value}
            maxLength={100}
            placeholder="例如：先给结论，再列依据"
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <label>
          范围
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="global">全局</option>
            {key === "nickname" ? (
              <option value="character">当前角色</option>
            ) : (
              workspace?.managedProjectId && (
                <option value="space">当前空间</option>
              )
            )}
          </select>
        </label>
        <button disabled={busy || !value.trim()} onClick={() => void save()}>
          {editing ? "保存偏好修改" : "确认保存偏好"}
        </button>
        {editing && <button onClick={reset}>取消修改</button>}
      </div>
      <p className="companion-note">
        偏好限于回答表达，不改变资料、权限和证据充分性。旧称呼值保留并可删除；本版暂不应用称呼。故事与经历不会成为检索资料。
      </p>
    </>
  );
}
