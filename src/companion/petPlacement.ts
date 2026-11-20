export type PetPlacement = { side: "left" | "right"; heightRatio: number };
export type PetArea = {
  left: number;
  top: number;
  width: number;
  height: number;
  compact: boolean;
};

const storageKey = "inkstone:companion:pet-placement";
const defaultPlacement: PetPlacement = { side: "right", heightRatio: 0.93 };

export function readPetPlacement(): PetPlacement {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    if (
      (value?.side === "left" || value?.side === "right") &&
      Number.isFinite(value.heightRatio) &&
      value.heightRatio >= 0 &&
      value.heightRatio <= 1
    )
      return { side: value.side, heightRatio: value.heightRatio };
  } catch {
    // Storage may be unavailable, or contain an older invalid value.
  }
  return defaultPlacement;
}

export function savePetPlacement(placement: PetPlacement) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(placement));
  } catch {
    // The placement remains available for this session.
  }
}

const clamp = (n: number, max: number) => Math.max(0, Math.min(n, max));

export function petFrame(area: PetArea, placement: PetPlacement) {
  const width = Math.min(area.width, area.compact ? 32 : 64);
  const height = Math.min(area.height, area.compact ? 44 : 64);
  const inset = Math.min(4, (area.height - height) / 2);
  const travel = area.height - height - 2 * inset;
  return {
    width,
    height,
    travel,
    x: area.left + (placement.side === "left" ? 0 : area.width - width),
    y: area.top + inset + travel * placement.heightRatio,
  };
}

export function dragPet(
  area: PetArea,
  from: PetPlacement,
  dx: number,
  dy: number,
) {
  const frame = petFrame(area, from);
  const x =
    area.left + clamp(frame.x - area.left + dx, area.width - frame.width);
  const ratio =
    frame.travel > 0
      ? clamp(from.heightRatio + dy / frame.travel, 1)
      : from.heightRatio;
  const side =
    x + frame.width / 2 < area.left + area.width / 2 ? "left" : "right";
  const placement: PetPlacement = { side, heightRatio: ratio };
  return { x, placement };
}

// Align beside the pet, opening toward the larger vertical space. A short
// window scrolls the panel within the editor, including its recording form.
export function petPanelFrame(area: PetArea, placement: PetPlacement) {
  const pet = petFrame(area, placement);
  const width = Math.min(280, Math.max(0, area.width - 8));
  const preferRight = placement.side === "left";
  const desiredX =
    pet.x - area.left + (preferRight ? pet.width + 4 : -width - 4);
  const left = area.left + clamp(desiredX, area.width - width) - pet.x;
  const above = pet.y - area.top + pet.height;
  const below = area.top + area.height - pet.y;
  return above > below
    ? { left, width, bottom: 0, maxHeight: above }
    : { left, width, top: 0, maxHeight: below };
}
