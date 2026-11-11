export type Appearance = "system" | "light" | "dark";

const appearanceKey = "inkstone:appearance";
const systemQuery = "(prefers-color-scheme: dark)";

function validAppearance(value: unknown): value is Appearance {
  return value === "system" || value === "light" || value === "dark";
}

export function getAppearance(): Appearance {
  const applied = document.documentElement.dataset.appearance;
  if (validAppearance(applied)) return applied;
  try {
    const saved = localStorage.getItem(appearanceKey);
    if (validAppearance(saved)) return saved;
  } catch {
    // The system setting remains usable if local storage is unavailable.
  }
  return "system";
}

function applyAppearance(appearance: Appearance) {
  const root = document.documentElement;
  root.dataset.appearance = appearance;
  root.dataset.theme =
    appearance === "system"
      ? window.matchMedia?.(systemQuery).matches
        ? "dark"
        : "light"
      : appearance;
}

export function setAppearance(appearance: Appearance) {
  applyAppearance(appearance);
  try {
    localStorage.setItem(appearanceKey, appearance);
  } catch {
    // Keep the selection for the current window.
  }
}

export function initializeAppearance() {
  applyAppearance(getAppearance());
  window.matchMedia?.(systemQuery).addEventListener("change", () => {
    if (getAppearance() === "system") applyAppearance("system");
  });
}
