import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { characterArt, cgArt } from "./art";
import { type CharacterId, type StoryEpisode } from "./types";

export function storyBookmark(generation: string, episode: string) {
  const storageKey = "inkstone:companion:reader";
  const get = (): {
    generation: string;
    chapters: Partial<Record<string, number>>;
  } => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      if (
        saved?.generation === generation &&
        saved.chapters &&
        typeof saved.chapters === "object"
      )
        return saved;
    } catch {
      /* Reading continues when local browser storage is unavailable. */
    }
    return { generation, chapters: {} };
  };
  return {
    read: () => get().chapters[episode],
    write: (page: number) => {
      try {
        const saved = get();
        saved.chapters[episode] = page;
        localStorage.setItem(storageKey, JSON.stringify(saved));
      } catch {
        /* Bookmarks are optional. */
      }
    },
  };
}

export default function StoryReader({
  generation,
  role,
  episode,
  read,
  choice,
  lockedChoice,
  busy,
  canFinish,
  onChoice,
  onFinish,
  onSkip,
}: {
  generation: string;
  role: CharacterId;
  episode: StoryEpisode;
  read: boolean;
  choice: string | null;
  lockedChoice: boolean;
  busy: boolean;
  canFinish: boolean;
  onChoice: (value: string) => void;
  onFinish: () => void;
  onSkip: () => void;
}) {
  const bookmark = storyBookmark(generation, episode.id);
  const [page, setPage] = useState(() => {
    const saved = bookmark.read();
    return !read &&
      typeof saved === "number" &&
      Number.isInteger(saved) &&
      saved >= 0 &&
      saved < episode.paragraphs.length
      ? saved
      : 0;
  });
  const last = page === episode.paragraphs.length - 1;
  const option = episode.choices.find(({ id }) => id === choice);

  function move(next: number) {
    setPage(next);
    if (!read) bookmark.write(next);
  }

  return (
    <div className="companion-reader">
      <figure className="companion-reader-scene">
        <img
          src={
            episode.stage === 0
              ? characterArt(role, 0)
              : cgArt(role, episode.stage)
          }
          alt={episode.title}
        />
        <figcaption aria-live="polite">
          <span className="companion-reader-count">
            旁白 · {page + 1} / {episode.paragraphs.length}
          </span>
          <p>{episode.paragraphs[page]}</p>
        </figcaption>
      </figure>
      {last && episode.choices.length > 0 && (
        <div className="companion-story-choices" aria-label="剧情选择">
          {episode.choices.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={choice === entry.id}
              disabled={busy || lockedChoice || !canFinish}
              onClick={() => onChoice(entry.id)}
            >
              {entry.label}
            </button>
          ))}
          {option && <p role="status">{option.result}</p>}
        </div>
      )}
      <div className="companion-reader-controls">
        <button
          type="button"
          disabled={busy || page === 0}
          onClick={() => move(page - 1)}
        >
          <ChevronLeft size={15} /> 上一段
        </button>
        {!read && canFinish && (
          <button type="button" disabled={busy} onClick={onSkip}>
            明确跳过本章
          </button>
        )}
        {last ? (
          <button
            className="primary"
            type="button"
            disabled={busy || (!read && episode.choices.length > 0 && !choice)}
            onClick={onFinish}
          >
            {read ? "返回章节" : "完成本章"}
          </button>
        ) : (
          <button
            className="primary"
            type="button"
            disabled={busy}
            onClick={() => move(page + 1)}
          >
            继续 <ChevronRight size={15} />
          </button>
        )}
      </div>
    </div>
  );
}
