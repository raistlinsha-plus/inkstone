import { msg, type Message } from "../i18n";
export type CharacterId = "motuan" | "yanzhou" | "zhiwei";
export interface Context {
  generation: string;
  revision: number;
}
export interface CompanionSettings {
  enabled: boolean;
  characterId: CharacterId;
  mode: "focus" | "gentle";
  reducedMotion: boolean;
  compact: boolean;
}
export interface RoleProgress {
  read: number[];
  outcomes?: Partial<Record<number, "read" | "skipped">>;
  choices: Record<string, string>;
  outfit: number;
}
export interface ExperienceCard {
  id: string;
  text: string;
  spaceId: string;
  day: string;
  characterId: CharacterId;
  kind: string;
}
export interface Preference {
  id: string;
  key: string;
  value: string;
  scope: string;
  scopeId: string;
  enabled: boolean;
  updated: number;
}
export interface Pending {
  token: string;
  eventId: string;
  text: string;
  kind: string;
  receipt: { spaceId: string; docId: string };
  characterId: CharacterId;
}
export type SourceStatus = "current" | "changed" | "unavailable";
export interface CompanionRecall {
  recent: ExperienceCard | null;
  statuses: Record<string, SourceStatus>;
}
export interface Snapshot extends Context {
  recallEnabled?: boolean;
  timezone: string;
  settings: CompanionSettings;
  events: number;
  days: number;
  hasRevision?: boolean;
  roles: Partial<Record<CharacterId, RoleProgress>>;
  cards: ExperienceCard[];
  preferences: Preference[];
  pending: Pending[];
  eligible: number | null;
}
export interface Preview {
  token: string;
  eventId: string;
  suggestedText: string;
  day: string;
  canRevise: boolean;
  expiresAt: number;
  context: Context;
}
export interface StoryEpisode {
  id: string;
  stage: number;
  title: string;
  paragraphs: string[];
  choices: { id: string; label: string; result: string; next: string }[];
  cgId: string | null;
}
export interface StoryCharacter {
  id: CharacterId;
  name: string;
  theme: string;
  episodes: StoryEpisode[];
}
export function characterProfiles(): Record<
  CharacterId,
  { name: string; description: string; quote: string }
> {
  return {
    motuan: {
      name: msg("墨团"),
      description: msg("墨色书猫 · 叶纹纸签"),
      quote: msg("这枚纸签……刚好留给你。"),
    },
    yanzhou: {
      name: msg("砚舟"),
      description: msg("成年男性 · 27岁 · 铜书签"),
      quote: msg("还没想清楚的部分，也可以先留在这里。"),
    },
    zhiwei: {
      name: msg("知微"),
      description: msg("成年女性 · 25岁 · 叶形纸夹"),
      quote: msg("不一样的想法，也值得有自己的位置。"),
    },
  };
}
export const stageNames = () => [msg("初遇"), msg("相识"), msg("同行")];
export const preferenceLabels: Record<string, Message> = {
  answerStyle: "回答组织",
  answerLength: "回答长度",
  displayUnit: "展示单位",
  nickname: "称呼",
};
export const contextOf = (s: Snapshot): Context => ({
  generation: s.generation,
  revision: s.revision,
});
export const roleLevel = (p?: RoleProgress) =>
  p?.read.includes(2) ? 2 : p?.read.includes(1) ? 1 : 0;

/** Old snapshots only tracked which chapters advanced growth. */
export function chapterLabel(
  progress: RoleProgress | undefined,
  stage: number,
) {
  if (!progress?.read.includes(stage)) return "";
  const outcome = progress.outcomes?.[stage];
  return outcome === "read"
    ? msg("已读完")
    : outcome === "skipped"
      ? msg("已跳过")
      : msg("已解锁");
}
