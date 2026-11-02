import {
  parseTree,
  printParseErrorCode,
  format,
  applyEdits,
  type Node,
  type ParseError,
} from "jsonc-parser";
export type JsonNode = Node;
export function inspectJson(source: string) {
  let depth = 0,
    quoted = false,
    escaped = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "{" || c === "[") {
      if (++depth > 128)
        return {
          root: undefined,
          errors: [
            { offset: i, message: "JSON 嵌套超过 128 层，请使用源码精简。" },
          ],
          duplicate: false,
        };
    } else if (c === "}" || c === "]") depth--;
  }
  const errors: ParseError[] = [];
  const root = parseTree(source, errors, {
    disallowComments: true,
    allowTrailingComma: false,
    allowEmptyContent: false,
  });
  let duplicate = false;
  function visit(node: Node) {
    if (node.type === "object") {
      const keys = new Set<string>();
      for (const p of node.children ?? []) {
        const key = p.children?.[0]?.value;
        if (keys.has(key)) duplicate = true;
        keys.add(key);
      }
    }
    node.children?.forEach(visit);
  }
  if (root) visit(root);
  return {
    root,
    errors: errors.map((e) => ({
      offset: e.offset,
      message: `${printParseErrorCode(e.error)}（第 ${source.slice(0, e.offset).split("\n").length} 行）`,
    })),
    duplicate,
  };
}
export function formatJson(source: string) {
  const state = inspectJson(source);
  if (state.errors.length || !state.root)
    throw new Error("JSON 有语法错误，请先修正再格式化。");
  // The formatter edits whitespace only; it does not parse numbers into IEEE-754 values.
  return applyEdits(
    source,
    format(source, undefined, {
      insertSpaces: true,
      tabSize: 2,
      eol: source.includes("\r\n") ? "\r\n" : "\n",
    }),
  );
}
export const pointer = (path: (string | number)[]) =>
  path.length
    ? "/" +
      path
        .map((x) => String(x).replaceAll("~", "~0").replaceAll("/", "~1"))
        .join("/")
    : "";
export function replaceJsonValue(source: string, node: Node, raw: string) {
  const check = inspectJson(raw);
  if (check.errors.length || !check.root || check.duplicate)
    throw new Error("请输入有效且没有重复键的 JSON 值。");
  return (
    source.slice(0, node.offset) +
    raw.trim() +
    source.slice(node.offset + node.length)
  );
}
export function addJsonChild(
  source: string,
  node: Node,
  raw: string,
  key?: string,
) {
  if (!["object", "array"].includes(node.type))
    throw new Error("仅对象和数组可新增字段。");
  const check = inspectJson(raw);
  if (check.errors.length || !check.root || check.duplicate)
    throw new Error("新增值不是有效 JSON。");
  if (
    node.type === "object" &&
    (key === undefined ||
      node.children?.some((p) => p.children?.[0]?.value === key))
  )
    throw new Error("字段名不能为空或重复。");
  const insertion = node.offset + node.length - 1;
  const entry =
    node.type === "object"
      ? `${JSON.stringify(key)}: ${raw.trim()}`
      : raw.trim();
  return (
    source.slice(0, insertion) +
    `${node.children?.length ? "," : ""}\n${entry}\n` +
    source.slice(insertion)
  );
}
export function deleteJsonNode(source: string, node: Node) {
  const entry = node.parent?.type === "property" ? node.parent : node;
  const parent = entry.parent;
  if (!parent || !["object", "array"].includes(parent.type))
    throw new Error("根节点不能删除。");
  const siblings = parent.children ?? [];
  const index = siblings.indexOf(entry);
  let from = entry.offset,
    to = entry.offset + entry.length;
  if (index < siblings.length - 1) to = siblings[index + 1].offset;
  else if (index > 0)
    from = siblings[index - 1].offset + siblings[index - 1].length;
  return source.slice(0, from) + source.slice(to);
}
