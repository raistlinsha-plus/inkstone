import type { Language } from "../i18n";
import original from "./stories.json";
import english from "./stories.en.json";
import type { CharacterId, StoryEpisode } from "./types";

const translations: Record<
  string,
  { title: string; paragraphs: string[]; choices?: Record<string, string[]> }
> = english;
export function seasonEpisodes(
  character: CharacterId,
  language: Language,
): StoryEpisode[] {
  const episodes =
    original.characters.find((entry) => entry.id === character)?.episodes ?? [];
  if (language === "zh-CN") return episodes;
  return episodes.map((episode) => {
    const copy = translations[episode.id];
    return {
      ...episode,
      title: copy.title,
      paragraphs: copy.paragraphs,
      choices: episode.choices.map((choice) => {
        const [label, result] = copy.choices![choice.id];
        return { ...choice, label, result };
      }),
    };
  });
}
