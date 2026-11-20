import { Check, LockKeyhole } from "lucide-react";
import { characterArt, cgArt } from "./art";
import motuanBonusArt from "./assets/motuan-pilot-cg.svg";
import {
  chapterLabel,
  characters,
  roleLevel,
  stages,
  type CharacterId,
  type Snapshot,
  type StoryEpisode,
} from "./types";
export function CharacterPicker({
  selected,
  onSelect,
}: {
  selected: CharacterId;
  onSelect: (id: CharacterId) => void;
}) {
  return (
    <>
      <div className="companion-character-grid">
        {(Object.keys(characters) as CharacterId[]).map((id) => (
          <button
            type="button"
            key={id}
            aria-pressed={selected === id}
            className={selected === id ? "selected" : ""}
            onClick={() => onSelect(id)}
          >
            <img
              src={characterArt(id, 0)}
              alt={`${characters[id].name}初遇预览插画`}
            />
            <h3>{characters[id].name}</h3>
            <small>{characters[id].description}</small>
            <p>{characters[id].quote}</p>
          </button>
        ))}
      </div>
      <p>同伴默认安静陪读，动作可在设置中开启。你可以随时更换同伴。</p>
    </>
  );
}
function chapterAvailability(snapshot: Snapshot, stage: number) {
  const progress = snapshot.roles[snapshot.settings.characterId];
  const label = chapterLabel(progress, stage);
  if (label) return label;
  if (stage === snapshot.eligible || stage === 0)
    return snapshot.settings.enabled ? "可以开始阅读" : "开启陪伴后可读";

  const missing: string[] = [];
  const previous = stage - 1;
  if (!progress?.read.includes(previous))
    missing.push(`读完或跳过「${stages[previous]}」`);
  const events = (stage === 1 ? 3 : 8) - snapshot.events;
  const days = (stage === 1 ? 2 : 5) - snapshot.days;
  if (events > 0) missing.push(`${events} 条经历`);
  if (days > 0) missing.push(`${days} 个不同记录日`);
  if (stage === 2 && snapshot.hasRevision === false) missing.push("一次复盘");
  return missing.length ? `还需${missing.join("、")}` : "等待解锁";
}

export function GrowthOverview({
  snapshot,
  busy,
  onStory,
}: {
  snapshot: Snapshot;
  busy: boolean;
  onStory: (stage: number) => void;
}) {
  const role = snapshot.settings.characterId,
    r = characters[role],
    progress = snapshot.roles[role],
    level = roleLevel(progress);
  const next = stages.findIndex((_, i) => !progress?.read.includes(i));
  return (
    <>
      <div className="companion-profile">
        <img src={characterArt(role, progress?.outfit ?? level)} alt={r.name} />
        <div>
          <h3>
            {r.name} · {stages[level]}
          </h3>
          <p>{r.description}</p>
          <p>
            {snapshot.events}条有效经历 · {snapshot.days}个不同有效日
          </p>
          <small>各空间的经历一起计入成长，记录日可以不连续。</small>
        </div>
      </div>
      <ol className="companion-stage-list">
        {stages.map((n, i) => (
          <li key={n}>
            <strong>{n}</strong>
            <span>
              {i === next && "下一章 · "}
              {chapterAvailability(snapshot, i)}
            </span>
            <button
              disabled={
                busy ||
                (!progress?.read.includes(i) &&
                  (!snapshot.settings.enabled || snapshot.eligible !== i))
              }
              onClick={() => onStory(i)}
            >
              {progress?.outcomes?.[i] === "read" ? "重读" : "阅读"}
            </button>
          </li>
        ))}
      </ol>
      {next === 2 && snapshot.hasRevision === false && (
        <p>
          复盘时，选一篇已有经历的文档，修改并保存，再将这次经历记为「复盘」。
        </p>
      )}
    </>
  );
}
export function AlbumCards({
  role,
  read,
  episodes,
  onOpen,
  onOpenMotuanBonus,
}: {
  role: CharacterId;
  read: number[];
  episodes: StoryEpisode[];
  onOpen: (stage: number) => void;
  onOpenMotuanBonus: () => void;
}) {
  const motuanBonusUnlocked = read.includes(1);
  return (
    <>
      <p>读完或跳过「相识」「同行」后，对应的故事插画会收进相册。</p>
      <div className="companion-album">
        {[1, 2].map((n) => (
          <button
            type="button"
            key={n}
            disabled={!read.includes(n)}
            onClick={() => onOpen(n)}
          >
            {read.includes(n) ? (
              <img
                src={cgArt(role, n)}
                alt={`${characters[role].name} ${stages[n]}CG`}
                loading="lazy"
              />
            ) : (
              <span className="motuan-bonus-placeholder" aria-hidden="true">
                <LockKeyhole size={24} />
              </span>
            )}
            <strong>{episodes[n].title}</strong>
            <small>
              {read.includes(n)
                ? "已解锁 · 点击查看"
                : `读完或跳过「${stages[n]}」后解锁`}
            </small>
          </button>
        ))}
        {role === "motuan" && (
          <button
            type="button"
            disabled={!motuanBonusUnlocked}
            onClick={onOpenMotuanBonus}
          >
            {motuanBonusUnlocked ? (
              <img src={motuanBonusArt} alt="" loading="lazy" />
            ) : (
              <span className="motuan-bonus-placeholder" aria-hidden="true">
                <LockKeyhole size={24} />
              </span>
            )}
            <strong>{motuanBonusTitle}</strong>
            <small>
              {motuanBonusUnlocked
                ? "相识纪念 · 已解锁"
                : "相识纪念 · 读完或跳过「相识」后解锁"}
            </small>
          </button>
        )}
      </div>
    </>
  );
}

export const motuanBonusTitle = "墨团 · 纸签下的午后";

export function MotuanBonusScene() {
  return (
    <figure className="companion-full-cg motuan-bonus-scene">
      <img
        src={motuanBonusArt}
        alt="墨团在圆窗旁打盹，摊开的书页里夹着一枚叶纹纸签"
      />
      <figcaption>
        相识纪念 · 午后的光落在书脊上，墨团替你守着翻到的这一页。
      </figcaption>
    </figure>
  );
}

export function StoryContent({
  role,
  episode,
  stage,
  busy,
  choice,
  lockedChoice,
  onChoice,
}: {
  role: CharacterId;
  episode: StoryEpisode;
  stage: number;
  busy: boolean;
  choice: string | null;
  lockedChoice: boolean;
  onChoice: (id: string) => void;
}) {
  const r = characters[role];
  return (
    <>
      <figure className="companion-scene">
        <img
          src={stage === 0 ? characterArt(role, 0) : cgArt(role, stage)}
          alt={`${r.name} ${episode.title}预览插画`}
        />
        <figcaption>
          {r.name} · {stages[stage]} · 固定剧情，离线可读
        </figcaption>
      </figure>
      <div className="companion-prose">
        {episode.paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      {stage === 2 && (
        <div className="companion-story-choices">
          {episode.choices.map((c) => (
            <button
              key={c.id}
              aria-pressed={choice === c.id}
              disabled={busy || lockedChoice}
              onClick={() => onChoice(c.id)}
            >
              {choice === c.id && <Check size={14} />} {c.label}
            </button>
          ))}
        </div>
      )}
      {stage === 2 && choice && (
        <p className="companion-choice-result">
          {episode.choices.find((c) => c.id === choice)?.result}
          <br />
          两种方式同等推进，故事将回到共同主线。
        </p>
      )}
    </>
  );
}
