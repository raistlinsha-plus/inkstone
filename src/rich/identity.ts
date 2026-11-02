import { visibleCodeIndices } from "./markdown";
import type { Node } from "@milkdown/kit/prose/model";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import {
  Plugin,
  PluginKey,
  type EditorState,
  type Transaction,
} from "@milkdown/kit/prose/state";
import {
  contentBlockIdentities,
  rememberBlockIdentities,
} from "../preview/blockIdentity";
export interface BlockIdentity {
  pos: number;
  node: Node;
  id: string;
}
export const blockIdentityKey = new PluginKey<BlockIdentity[]>(
  "inkstone-block-identities",
);
export const restoreBlockIdentity = "inkstone-restore-identities";
const raw = (node: Node) =>
  String(node.attrs.language).startsWith("inkstone-raw-");
function codeNodes(doc: Node) {
  const entries: { pos: number; node: Node }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "code_block") entries.push({ pos, node });
  });
  return entries;
}
function initial(doc: Node, scope: string, source: string) {
  const allKeys = contentBlockIdentities(scope, source);
  const keys = visibleCodeIndices(source).map((index) => allKeys[index]);
  let at = 0;
  return codeNodes(doc).map((entry) => ({
    ...entry,
    id: raw(entry.node)
      ? crypto.randomUUID()
      : (keys[at++] ?? crypto.randomUUID()),
  }));
}
export function mapBlockIdentities(
  previous: BlockIdentity[],
  tr: Transaction,
): BlockIdentity[] {
  const nodes = codeNodes(tr.doc),
    result = new Map<number, BlockIdentity>(),
    used = new Set<string>();
  for (const old of previous) {
    const mapped = tr.mapping.mapResult(old.pos, 1),
      node = tr.doc.nodeAt(mapped.pos);
    if (!mapped.deleted && node?.type.name === "code_block") {
      result.set(mapped.pos, { pos: mapped.pos, node, id: old.id });
      used.add(old.id);
    }
  }
  // Native moves retain the immutable node. Mapped survivors consume their IDs
  // first, so even a duplicate sharing the same Node object gets a fresh ID.
  return nodes.map(
    (entry) =>
      result.get(entry.pos) ?? {
        ...entry,
        id: (() => {
          const moved = previous.find(
            (old) => !used.has(old.id) && old.node === entry.node,
          );
          const id = moved?.id ?? crypto.randomUUID();
          used.add(id);
          return id;
        })(),
      },
  );
}
export function identityPlugin(scope: string, source: string) {
  return new Plugin<BlockIdentity[]>({
    key: blockIdentityKey,
    props: {
      decorations(state) {
        return DecorationSet.create(
          state.doc,
          (blockIdentityKey.getState(state) ?? []).map((entry) =>
            Decoration.node(entry.pos, entry.pos + entry.node.nodeSize, {
              "data-block-identity": entry.id,
            }),
          ),
        );
      },
    },
    state: {
      init: (_, state) => initial(state.doc, scope, source),
      apply: (tr, old) => {
        const restored = tr.getMeta(restoreBlockIdentity) as string | undefined;
        return restored !== undefined
          ? initial(tr.doc, scope, restored)
          : tr.docChanged
            ? mapBlockIdentities(old, tr)
            : old;
      },
    },
  });
}
export function rememberVisualBlockIdentities(
  scope: string,
  source: string,
  state: EditorState,
) {
  const entries = blockIdentityKey.getState(state);
  if (entries)
    rememberBlockIdentities(
      scope,
      source,
      entries.filter((entry) => !raw(entry.node)).map((entry) => entry.id),
      visibleCodeIndices(source),
    );
}
