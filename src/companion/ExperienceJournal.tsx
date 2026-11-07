import { useState } from "react";
import {
  characters,
  type Snapshot,
  type ExperienceCard,
  type Pending,
  type SourceStatus,
  type CharacterId,
} from "./types";
export default function ExperienceJournal({
  snapshot,
  spaceId,
  busy,
  onRetry,
  onCard,
  sourceStatuses,
  onOpenSource,
}: {
  snapshot: Snapshot;
  spaceId: string | null | undefined;
  busy: boolean;
  onRetry: (pending: Pending) => void;
  onOpenSource?: (id: string) => void;
  sourceStatuses?: Record<string, SourceStatus>;
  onCard: (id: string, text: string | null) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState<ExperienceCard | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [role, setRole] = useState<CharacterId | "">("");
  const [since, setSince] = useState("");
  const cards = snapshot.cards.filter(
    (c) =>
      (!spaceId || c.spaceId === spaceId) &&
      (!role || c.characterId === role) &&
      (!since || c.day >= since),
  );
  const statuses = {
    current: "来源可用",
    changed: "来源已更新",
    unavailable: "来源不可用",
  } as const;
  return (
    <>
      <h3>{spaceId ? "当前空间的经历卡" : "所有空间的经历卡"}</h3>
      <p>
        普通保存不计成长；确认后每日最多两条，同一文档同日只计一次。时区：
        {snapshot.timezone}
      </p>
      <div className="companion-journal-filters">
        <label>
          角色
          <select
            value={role}
            onChange={(event) =>
              setRole(event.target.value as CharacterId | "")
            }
          >
            <option value="">全部角色</option>
            {Object.entries(characters).map(([id, character]) => (
              <option key={id} value={id}>
                {character.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          起始日期
          <input
            type="date"
            value={since}
            onChange={(event) => setSince(event.target.value)}
          />
        </label>
      </div>
      {snapshot.pending.map((p) => (
        <div key={p.token} className="companion-pending-card">
          <p>经历待保存：{p.text}</p>
          <div>
            <button
              disabled={busy || spaceId !== p.receipt.spaceId}
              onClick={() => onRetry(p)}
            >
              重试保存
            </button>
            <button disabled={busy} onClick={() => onCard(p.eventId, null)}>
              删除待存内容
            </button>
          </div>
          {spaceId !== p.receipt.spaceId && (
            <small>请切回该经历所属空间重试。</small>
          )}
        </div>
      ))}
      {!cards.length && (
        <p className="companion-empty">
          {role || since
            ? "没有符合筛选条件的经历。"
            : "尚未记录经历。完成并保存一份文档后，可主动确认。"}
        </p>
      )}
      {cards.map((c) => (
        <article key={c.id} className="companion-experience">
          {editing?.id === c.id ? (
            <>
              <textarea
                aria-label="修改经历卡"
                disabled={busy || saving}
                maxLength={160}
                value={editing.text}
                onChange={(e) =>
                  setEditing({ ...editing, text: e.target.value })
                }
              />
              <button
                disabled={busy || saving || !editing.text.trim()}
                onClick={async () => {
                  if (saving) return;
                  setSaving(true);
                  setSaveError("");
                  try {
                    if (await onCard(c.id, editing.text)) setEditing(null);
                    else setSaveError("修改尚未保存，文字已保留，请重试。");
                  } catch {
                    setSaveError("修改尚未保存，文字已保留，请重试。");
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {saving ? "正在保存…" : "保存修改"}
              </button>
              <button disabled={saving} onClick={() => setEditing(null)}>
                取消
              </button>
              {saveError && <p role="alert">{saveError}</p>}
            </>
          ) : (
            <>
              <small>
                {c.day} · {characters[c.characterId]?.name ?? "同伴"} ·{" "}
                {c.kind === "revision" ? "复盘" : "完成"}
                {spaceId && (
                  <>
                    {" "}
                    ·{" "}
                    {sourceStatuses?.[c.id]
                      ? statuses[sourceStatuses[c.id]]
                      : "来源待核验"}
                  </>
                )}
              </small>
              <p>{c.text}</p>
              {onOpenSource && sourceStatuses?.[c.id] === "current" && (
                <button
                  disabled={busy || saving}
                  onClick={() => onOpenSource(c.id)}
                >
                  打开来源
                </button>
              )}
              <button
                disabled={saving}
                onClick={() => {
                  setSaveError("");
                  setEditing({ ...c });
                }}
              >
                编辑
              </button>
              <button disabled={busy} onClick={() => onCard(c.id, null)}>
                删除卡片文字
              </button>
            </>
          )}
        </article>
      ))}
    </>
  );
}
