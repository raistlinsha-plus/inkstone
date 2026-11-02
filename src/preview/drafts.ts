// Unsaved structure forms live only in this app session. Rendering offscreen or
// switching editor modes must not be interpreted as cancelling the form.
const drafts = new Map<string, { source: string; value: unknown }>();
const limit = 100;
export function loadBlockDraft<T>(
  key: string | undefined,
  source: string,
): T | undefined {
  if (!key) return undefined;
  const cached = drafts.get(key);
  return cached?.source === source ? (cached.value as T) : undefined;
}
export function saveBlockDraft<T>(
  key: string | undefined,
  source: string,
  value: T | null,
) {
  if (!key) return;
  drafts.delete(key);
  if (value === null) return;
  drafts.set(key, { source, value });
  if (drafts.size > limit) drafts.delete(drafts.keys().next().value!);
}
export function clearBlockDrafts(scope?: string) {
  for (const key of drafts.keys())
    if (!scope || key.startsWith(scope)) drafts.delete(key);
}

export const clearContentDrafts = (prefix: string) => clearBlockDrafts(prefix);
