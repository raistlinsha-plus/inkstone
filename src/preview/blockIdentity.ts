import { parseMarkdown, type MarkdownNode } from "../content/blocks";

interface Block {
  key: string;
  kind: string;
  hash: string;
  from: number;
  to: number;
}
interface Snapshot {
  hash: string;
  blocks: Block[];
  source?: string;
}
const scopes = new Map<string, Snapshot[]>();
const storageKey = "inkstone-content-identities-v1";
function hash(value: string) {
  let a = 2166136261;
  for (let i = 0; i < value.length; i++)
    a = Math.imul(a ^ value.charCodeAt(i), 16777619);
  return `${value.length}:${a >>> 0}`;
}
function blocksOf(source: string, tree?: MarkdownNode) {
  const result: Omit<Block, "key">[] = [];
  function visit(node: MarkdownNode) {
    if (node.type === "code")
      result.push({
        kind: (node.lang ?? "").toLowerCase(),
        hash: hash(node.value ?? ""),
        from: node.position.start.offset,
        to: node.position.end.offset,
      });
    node.children?.forEach(visit);
  }
  visit(tree ?? parseMarkdown(source));
  return result;
}
function load(scope: string): Snapshot[] {
  const existing = scopes.get(scope);
  if (existing) return existing;
  let loaded: Snapshot[] = [];
  try {
    const item = JSON.parse(localStorage.getItem(storageKey) ?? "{}")[scope];
    if (
      item &&
      typeof item.hash === "string" &&
      Array.isArray(item.blocks) &&
      item.blocks.length <= 2000 &&
      item.blocks.every(
        (b: Block) =>
          typeof b.key === "string" &&
          typeof b.hash === "string" &&
          typeof b.kind === "string" &&
          Number.isInteger(b.from) &&
          Number.isInteger(b.to),
      )
    )
      loaded = [item];
  } catch {}
  scopes.set(scope, loaded);
  while (scopes.size > 20) scopes.delete(scopes.keys().next().value!);
  return loaded;
}
function store(scope: string, snapshot: Snapshot) {
  const history = load(scope),
    at = history.findIndex((s) => s.hash === snapshot.hash);
  if (at >= 0) history.splice(at, 1);
  // Only the latest snapshot holds source for text-range reconciliation. History
  // and disk contain keys/fingerprints, not copies of document content.
  for (const previous of history) delete previous.source;
  history.push(snapshot);
  if (history.length > 30) history.shift();
  try {
    const disk = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    delete disk[scope];
    disk[scope] = { hash: snapshot.hash, blocks: snapshot.blocks };
    for (const key of Object.keys(disk).slice(0, -20)) delete disk[key];
    localStorage.setItem(storageKey, JSON.stringify(disk));
  } catch {}
}
export function contentBlockIdentities(
  scope: string,
  source: string,
  tree?: MarkdownNode,
): string[] {
  const history = load(scope),
    fingerprint = hash(source),
    blocks = blocksOf(source, tree);
  const exact = history.find((s) => s.hash === fingerprint);
  if (
    exact &&
    exact.blocks.length === blocks.length &&
    blocks.every(
      (b, i) =>
        b.kind === exact.blocks[i].kind && b.hash === exact.blocks[i].hash,
    )
  ) {
    store(scope, {
      hash: fingerprint,
      blocks: blocks.map((b, i) => ({ ...b, key: exact.blocks[i].key })),
      source,
    });
    return exact.blocks.map((b) => b.key);
  }
  const previous = history.at(-1),
    used = new Set<string>();
  let prefix = 0,
    oldEnd = 0,
    newEnd = source.length;
  if (previous?.source !== undefined) {
    const old = previous.source;
    oldEnd = old.length;
    while (
      prefix < old.length &&
      prefix < source.length &&
      old[prefix] === source[prefix]
    )
      prefix++;
    while (
      oldEnd > prefix &&
      newEnd > prefix &&
      old[oldEnd - 1] === source[newEnd - 1]
    ) {
      oldEnd--;
      newEnd--;
    }
  }
  const next = blocks.map((block) => {
    let match: Block | undefined;
    if (previous?.source !== undefined)
      match = previous.blocks.find((old) => {
        if (used.has(old.key) || old.kind !== block.kind) return false;
        if (old.to <= prefix)
          return old.from === block.from && old.to === block.to;
        if (old.from >= oldEnd)
          return (
            old.from + newEnd - oldEnd === block.from &&
            old.to + newEnd - oldEnd === block.to
          );
        return (
          old.from <= prefix &&
          old.to >= oldEnd &&
          old.from === block.from &&
          old.to + newEnd - oldEnd === block.to
        );
      });
    if (!match) {
      const candidates =
        previous?.blocks.filter(
          (old) =>
            !used.has(old.key) &&
            old.kind === block.kind &&
            old.hash === block.hash,
        ) ?? [];
      const duplicates = blocks.filter(
        (next) => next.kind === block.kind && next.hash === block.hash,
      ).length;
      if (candidates.length === 1 && duplicates === 1) match = candidates[0];
    }
    const key = match?.key ?? crypto.randomUUID();
    used.add(key);
    return { ...block, key };
  });
  store(scope, { hash: fingerprint, blocks: next, source });
  return next.map((b) => b.key);
}
export function rememberBlockIdentities(
  scope: string,
  source: string,
  keys: string[],
  visibleIndices?: number[],
) {
  const blocks = blocksOf(source);
  if (visibleIndices) {
    if (visibleIndices.length !== keys.length) return;
    const merged = contentBlockIdentities(scope, source);
    visibleIndices.forEach((index, i) => {
      merged[index] = keys[i];
    });
    keys = merged;
  }
  if (blocks.length !== keys.length) return;
  store(scope, {
    hash: hash(source),
    blocks: blocks.map((b, i) => ({ ...b, key: keys[i] })),
    source,
  });
}
