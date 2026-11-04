import { useState } from "react";
import {
  characters,
  type Snapshot,
  type ExperienceCard,
  type Pending,
} from "./types";
export default function ExperienceJournal({
  snapshot,
  spaceId,
  busy,
  onRetry,
  onCard,
}: {
  snapshot: Snapshot;
  spaceId: string | null | undefined;
  busy: boolean;
  onRetry: (pending: Pending) => void;
  onCard: (id: string, text: string | null) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState<ExperienceCard | null>(null);
  const cards = snapshot.cards.filter((c) => !spaceId || c.spaceId === spaceId);
  return (
    <>
      <h3>当前空间的经历卡</h3>
      <p>
        普通保存不计成长；确认后每日最多两条，同一文档同日只计一次。时区：
        {snapshot.timezone}
      </p>
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
          尚未记录经历。完成并保存一份文档后，可主动确认。
        </p>
      )}
      {cards.map((c) => (
        <article key={c.id} className="companion-experience">
          {editing?.id === c.id ? (
            <>
              <textarea
                aria-label="修改经历卡"
                maxLength={160}
                value={editing.text}
                onChange={(e) =>
                  setEditing({ ...editing, text: e.target.value })
                }
              />
              <button
                disabled={busy}
                onClick={() => {
                  onCard(c.id, editing.text);
                  setEditing(null);
                }}
              >
                保存修改
              </button>
              <button onClick={() => setEditing(null)}>取消</button>
            </>
          ) : (
            <>
              <small>
                {c.day} · {characters[c.characterId]?.name ?? "同伴"} ·{" "}
                {c.kind === "revision" ? "复盘" : "完成"}
              </small>
              <p>{c.text}</p>
              <button onClick={() => setEditing({ ...c })}>编辑</button>
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
