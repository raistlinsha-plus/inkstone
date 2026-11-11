import motuan from "../../prototypes/v0.7/assets/motuan-concept.png";
import yanzhou from "../../prototypes/v0.7/assets/yanzhou-concept.png";
import zhiwei from "../../prototypes/v0.7/assets/zhiwei-concept.png";
import study from "../../prototypes/v0.7/assets/motuan-study-concept.png";
import motuanBookmarkScene from "./assets/motuan.story.1.jpg";
import type { CharacterId } from "./types";
const artwork = import.meta.glob("./assets/*.png", {
  eager: true,
  import: "default",
}) as Record<string, string>;
const fallback = { motuan, yanzhou, zhiwei };
export function characterArt(id: CharacterId, stage: number) {
  return artwork[`./assets/${id}.${stage}.png`] ?? fallback[id];
}
export function cgArt(id: CharacterId, cg: number) {
  if (id === "motuan" && cg === 1) return motuanBookmarkScene;
  return (
    artwork[`./assets/${id}.cg.${cg}.png`] ??
    (id === "motuan" ? study : fallback[id])
  );
}
