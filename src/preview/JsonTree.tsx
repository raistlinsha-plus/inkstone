import { useEffect, useMemo, useState } from "react";
import { loadBlockDraft, saveBlockDraft } from "./drafts";
import {
  ChevronDown,
  ChevronRight,
  Dot,
  Plus,
  Trash2,
  ArrowUpRight,
} from "lucide-react";
import {
  addJsonChild,
  deleteJsonNode,
  formatJson,
  inspectJson,
  pointer,
  replaceJsonValue,
  type JsonNode,
} from "../content/json";
interface Props {
  source: string;
  embedded?: boolean;
  onApply?: (base: string, next: string) => void;
  readOnly?: boolean;
  viewKey?: string;
  onEditingChange?: (active: boolean) => void;
  onLocate?: (line: number) => void;
  startLine?: number;
}
export default function JsonTree({
  source,
  embedded = false,
  onApply,
  onLocate,
  startLine = 1,
  readOnly = false,
  viewKey,
  onEditingChange,
}: Props) {
  const state = useMemo(() => inspectJson(source), [source]);
  type Selection = {
    node: JsonNode;
    path: (string | number)[];
    base: string;
    action: "edit" | "add" | "delete";
  };
  type Draft = {
    selected: Selection;
    value: string;
    valueType: string;
    key: string;
  };
  const draftKey = viewKey ? `${viewKey}:json` : undefined;
  const [restored] = useState(() =>
    readOnly ? undefined : loadBlockDraft<Draft>(draftKey, source),
  );
  const [selected, setSelected] = useState<Selection | null>(
    restored?.selected ?? null,
  );
  const [value, setValue] = useState(restored?.value ?? "新内容");
  const [valueType, setValueType] = useState(restored?.valueType ?? "string");
  const [key, setKey] = useState(restored?.key ?? "");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const writable =
    !readOnly && !!onApply && !state.errors.length && !state.duplicate;
  const editingActive = selected !== null && !readOnly;
  useEffect(() => {
    onEditingChange?.(editingActive);
    return () => onEditingChange?.(false);
  }, [editingActive, onEditingChange]);
  useEffect(() => {
    if (!readOnly)
      saveBlockDraft(
        draftKey,
        selected?.base ?? source,
        selected ? { selected, value, valueType, key } : null,
      );
  }, [draftKey, selected, source, value, valueType, key, readOnly]);
  const apply = (next: string) => {
    try {
      if (!writable) return;
      onApply?.(source, next);
      setError("");
      setSelected(null);
    } catch (e) {
      setError(String(e));
    }
  };
  function choose(
    node: JsonNode,
    path: (string | number)[],
    action: "edit" | "add" | "delete",
  ) {
    setSelected({ node, path, base: source, action });
    const type =
      action === "edit" &&
      ["string", "number", "boolean", "null"].includes(node.type)
        ? node.type
        : action === "add"
          ? "string"
          : "json";
    setValueType(type);
    setValue(
      action === "edit"
        ? type === "string"
          ? String(node.value)
          : source.slice(node.offset, node.offset + node.length)
        : "新值",
    );
    setKey("");
    setError("");
  }
  function submit() {
    if (!selected || !writable) return;
    try {
      if (selected.base !== source)
        throw new Error("原文已变化，请重新选择字段。");
      const { node, action } = selected;
      const raw =
        valueType === "string"
          ? JSON.stringify(value)
          : valueType === "null"
            ? "null"
            : value;
      if (
        valueType === "number" &&
        !/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw.trim())
      )
        throw Error("请输入有效数值，保持原始数字字面量。");
      if (valueType === "boolean" && !["true", "false"].includes(raw.trim()))
        throw Error("布尔值请输入 true 或 false。");
      const next =
        action === "edit"
          ? replaceJsonValue(source, node, raw)
          : action === "delete"
            ? deleteJsonNode(source, node)
            : addJsonChild(
                source,
                node,
                raw,
                node.type === "object" ? key : undefined,
              );
      apply(next);
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <section className="json-preview" aria-label="JSON 结构编辑器">
      <div className="graph-actions">
        {!embedded && <strong>JSON 结构</strong>}
        <input
          aria-label="搜索 JSON 键或值"
          placeholder="搜索键或值…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {!readOnly && (
          <button
            disabled={!writable}
            onClick={() => {
              try {
                apply(formatJson(source));
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            格式化
          </button>
        )}
      </div>
      {search && (
        <p className="preview-help" role="status">
          在完整 JSON 中搜索，展示匹配项及其祖先路径。
        </p>
      )}
      {state.errors.map((e, i) => (
        <div className="preview-error" key={i}>
          {onLocate ? (
            <button
              onClick={() =>
                onLocate(
                  startLine + source.slice(0, e.offset).split("\n").length - 1,
                )
              }
            >
              {e.message} · 定位
            </button>
          ) : (
            <span>{e.message}</span>
          )}
        </div>
      ))}
      {state.duplicate && (
        <div className="preview-error">
          存在重复键。请先在源码中处理；树编辑已关闭。
        </div>
      )}
      {error && (
        <div className="preview-error" role="alert">
          {error}
        </div>
      )}
      {!readOnly && selected && (
        <form
          className="structure-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <strong>
            {selected.action === "delete"
              ? "删除字段及其子项"
              : selected.action === "add"
                ? "新增字段"
                : "修改 JSON 值"}{" "}
            {pointer(selected.path) || "根节点"}
          </strong>
          {selected.action === "add" && selected.node.type === "object" && (
            <label>
              字段名
              <input
                autoFocus
                aria-label="新增 JSON 字段名"
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
            </label>
          )}
          {selected.action !== "delete" && (
            <label>
              值
              <select
                aria-label="JSON 值类型"
                value={valueType}
                onChange={(e) => {
                  setValueType(e.target.value);
                  setValue(
                    e.target.value === "boolean"
                      ? "true"
                      : e.target.value === "null"
                        ? "null"
                        : e.target.value === "number"
                          ? "0"
                          : e.target.value === "json"
                            ? "{}"
                            : "",
                  );
                }}
              >
                <option value="string">文本（直接输入）</option>
                <option value="number">数值</option>
                <option value="boolean">布尔</option>
                <option value="null">空值 null</option>
                <option value="json">对象 / 数组 / 原始 JSON</option>
              </select>
              <textarea
                autoFocus
                aria-label="JSON 字段值"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                rows={3}
              />
            </label>
          )}
          {selected.action === "delete" && (
            <p>这会删除整个字段及其子项，完成后可以撤销。</p>
          )}
          <div>
            <button type="button" onClick={() => setSelected(null)}>
              取消
            </button>
            <button className="primary" type="submit">
              {selected.action === "delete" ? "确认删除" : "应用修改"}
            </button>
          </div>
        </form>
      )}
      {state.root && !state.errors.length && (
        <JsonBranch
          key={source}
          node={state.root}
          label="根节点"
          path={[]}
          source={source}
          depth={0}
          search={search}
          writable={writable}
          choose={choose}
          canLocate={!!onLocate}
          locate={(node) =>
            onLocate?.(
              startLine + source.slice(0, node.offset).split("\n").length - 1,
            )
          }
        />
      )}
      <p className="preview-help">
        {readOnly
          ? "JSON 只读查看，展开节点可阅读完整结构。"
          : "树操作会回写原文，可撤销。无效 JSON 仍可保存为文本。"}
      </p>
    </section>
  );
}
function JsonBranch({
  node,
  label,
  path,
  source,
  depth,
  search,
  writable,
  choose,
  locate,
  canLocate,
}: {
  node: JsonNode;
  label: string;
  path: (string | number)[];
  source: string;
  depth: number;
  search: string;
  writable: boolean;
  choose: (
    n: JsonNode,
    p: (string | number)[],
    a: "edit" | "add" | "delete",
  ) => void;
  locate: (n: JsonNode) => void;
  canLocate: boolean;
}) {
  const [expanded, setExpanded] = useState(depth === 0);
  const [limit, setLimit] = useState(50);
  const [copied, setCopied] = useState(false);
  const container = node.type === "object" || node.type === "array";
  const raw = source.slice(
    node.offset,
    node.offset + Math.min(node.length, 180),
  );
  const match =
    !search ||
    label.toLowerCase().includes(search.toLowerCase()) ||
    raw.toLowerCase().includes(search.toLowerCase());
  if (!container && !match) return null;
  if (depth > 40)
    return <div className="preview-help">嵌套超过 40 层，请使用源码编辑。</div>;
  return (
    <div className="json-branch" style={{ paddingLeft: depth ? 14 : 0 }}>
      <div className="json-row">
        <button
          className="json-label"
          onClick={() => (container ? setExpanded(!expanded) : locate(node))}
          title={pointer(path)}
          aria-expanded={container ? expanded || !!search : undefined}
        >
          {container ? (
            expanded ? (
              <ChevronDown size={14} aria-hidden="true" />
            ) : (
              <ChevronRight size={14} aria-hidden="true" />
            )
          ) : (
            <Dot size={14} aria-hidden="true" />
          )}
          <strong>{label}</strong>
          <span>
            {container
              ? `${node.type === "object" ? "对象" : "数组"} · ${node.children?.length ?? 0}`
              : raw}
          </span>
        </button>
        {canLocate && (
          <button
            title="定位源码"
            aria-label={`定位 ${label}`}
            onClick={() => locate(node)}
          >
            <ArrowUpRight size={15} aria-hidden="true" />
          </button>
        )}
        <button
          title={pointer(path) || "根节点"}
          aria-label={`复制 ${label} 路径`}
          onClick={() =>
            void navigator.clipboard.writeText(pointer(path)).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1000);
            })
          }
        >
          {copied ? "已复制" : "路径"}
        </button>
        {writable && (
          <>
            <button
              aria-label={`修改 ${label}`}
              onClick={() => choose(node, path, "edit")}
            >
              编辑
            </button>
            {container && (
              <button
                aria-label={`向 ${label} 新增字段`}
                onClick={() => choose(node, path, "add")}
              >
                <Plus size={15} aria-hidden="true" />
              </button>
            )}
            {path.length > 0 && (
              <button
                aria-label={`删除 ${label}`}
                onClick={() => choose(node, path, "delete")}
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            )}
          </>
        )}
      </div>
      {container && (expanded || search) && (
        <div>
          {node.children
            ?.slice(0, search ? undefined : limit)
            .map((child, i) => {
              const key =
                node.type === "object" ? String(child.children?.[0]?.value) : i;
              const value =
                node.type === "object" ? child.children?.[1] : child;
              return (
                value && (
                  <JsonBranch
                    key={`${key}-${i}`}
                    node={value}
                    label={String(key)}
                    path={[...path, key]}
                    source={source}
                    depth={depth + 1}
                    search={search}
                    writable={writable}
                    choose={choose}
                    locate={locate}
                    canLocate={canLocate}
                  />
                )
              );
            })}
          {!search && (node.children?.length ?? 0) > limit && (
            <button onClick={() => setLimit((n) => n + 100)}>
              再显示 100 项
            </button>
          )}
        </div>
      )}
    </div>
  );
}
