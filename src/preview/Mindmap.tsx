import { msg } from "../i18n";
import { useEffect, useMemo, useState } from "react";
import { loadBlockDraft, saveBlockDraft } from "./drafts";
import { editMind, flattenMind, outlineTree } from "../content/mindmap";
import Graph from "./Graph";
export default function Mindmap({
  source,
  onApply,
  onLocate,
  onError,
  embedded = false,
  toolbarHost,
  toolbarExtras,
  viewKey,
  readOnly = false,
  onEditingChange,
}: {
  source: string;
  onApply?: (base: string, next: string) => void;
  onLocate?: (line: number) => void;
  onError?: (e: string) => void;
  readOnly?: boolean;
  onEditingChange?: (active: boolean) => void;
  embedded?: boolean;
  toolbarHost?: HTMLElement | null;
  toolbarExtras?: React.ReactNode;
  viewKey?: string;
}) {
  const tree = useMemo(() => outlineTree(source), [source]);
  const nodes = useMemo(() => flattenMind(tree), [tree]);
  type Draft = {
    id: string;
    selectedBase: string;
    value: string;
    deleting: boolean;
  };
  const draftKey = viewKey ? `${viewKey}:mindmap` : undefined;
  const [restored] = useState(() =>
    readOnly ? undefined : loadBlockDraft<Draft>(draftKey, source),
  );
  const [id, setId] = useState(restored?.id ?? "");
  const [selectedBase, setSelectedBase] = useState(
    restored?.selectedBase ?? "",
  );
  const [value, setValue] = useState(restored?.value ?? "");
  const [showNodeTools, setShowNodeTools] = useState(!!restored);
  const [message, setMessage] = useState("");
  const [deleting, setDeleting] = useState(restored?.deleting ?? false);
  const editingActive = !!id && !readOnly;
  useEffect(() => {
    onEditingChange?.(editingActive);
    return () => onEditingChange?.(false);
  }, [editingActive, onEditingChange]);
  useEffect(() => {
    if (!readOnly)
      saveBlockDraft(
        draftKey,
        selectedBase || source,
        id ? { id, selectedBase, value, deleting } : null,
      );
  }, [draftKey, selectedBase, source, id, value, deleting, readOnly]);
  const selected = nodes.find((n) => n.id === id);
  const choose = (next: string) => {
    setShowNodeTools(true);
    setId(next);
    setSelectedBase(source);
    setValue(nodes.find((n) => n.id === next)?.label ?? "");
    setDeleting(false);
    setMessage("");
  };
  const apply = (action: "rename" | "child" | "sibling" | "delete") => {
    if (!selected || readOnly || !onApply) return;
    try {
      if (selectedBase !== source)
        throw Error("原文已变化，请重新选择节点，未写入过期修改。");
      onApply(source, editMind(source, selected, action, value));
      setMessage("已回写 Markdown，可撤销。");
      setDeleting(false);
      setId("");
    } catch (e) {
      setMessage(String(e));
    }
  };
  return (
    <section className="mindmap-preview">
      {nodes.length > 500 ? (
        <div className="preview-error">
          {msg("脑图超过 500 个节点，请精简或使用文档大纲。")}
        </div>
      ) : (
        <Graph
          toolbarHost={toolbarHost}
          toolbarExtras={toolbarExtras}
          viewKey={viewKey}
          kind="mindmap"
          source={source}
          tree={
            embedded &&
            tree.children.length === 1 &&
            tree.children[0].kind === "heading"
              ? tree.children[0]
              : tree
          }
          onNode={readOnly ? undefined : choose}
          onError={onError}
        />
      )}
      {!readOnly && (
        <details
          className="mind-node-tools"
          open={showNodeTools}
          onToggle={(event) => setShowNodeTools(event.currentTarget.open)}
        >
          <summary>{msg("选择节点")}</summary>
          <div className="mind-editor">
            <label>
              {msg("选择节点")}
              <select
                aria-label={msg("脑图节点")}
                value={id}
                onChange={(e) => choose(e.target.value)}
              >
                <option value="">{msg("点击图中节点，或在这里选择")}</option>
                {nodes
                  .filter((n) => n.kind !== "root")
                  .map((n) => (
                    <option key={n.id} value={n.id}>
                      {"　".repeat(Math.min(8, n.depth - 1))}
                      {n.label}
                    </option>
                  ))}
              </select>
            </label>
            {selected && selectedBase !== source && (
              <p className="preview-error">
                {msg("原文已变化，请重新选择节点。")}
              </p>
            )}
            {selected && (
              <>
                <button
                  onClick={() => {
                    setId("");
                    setDeleting(false);
                    setMessage("");
                  }}
                >
                  {msg("取消节点编辑")}
                </button>
                {onLocate && (
                  <button onClick={() => onLocate(selected.line)}>
                    {msg("回到原文第")} {selected.line} {msg("行")}
                  </button>
                )}
                {selected.editable ? (
                  <>
                    <label>
                      {msg("节点名称")}
                      <input
                        aria-label={msg("脑图节点名称")}
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                      />
                    </label>
                    <div className="node-actions">
                      <button onClick={() => apply("rename")}>
                        {msg("重命名")}
                      </button>
                      <button onClick={() => apply("child")}>
                        {msg("新增子节点")}
                      </button>
                      <button onClick={() => apply("sibling")}>
                        {msg("新增同级")}
                      </button>
                      <button onClick={() => setDeleting(true)}>
                        {msg("删除子树")}
                      </button>
                    </div>
                    {deleting && (
                      <div className="preview-error">
                        {msg("将删除此节点及全部子节点，可撤销。")}
                        <button onClick={() => apply("delete")}>
                          {msg("确认删除")}
                        </button>
                        <button onClick={() => setDeleting(false)}>
                          {msg("取消")}
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="preview-help">
                    {msg(
                      "该分支包含复杂正文，仅提供呈现和原文定位，避免结构操作丢弃内容。",
                    )}
                  </p>
                )}
              </>
            )}
            {message && <p role="status">{message}</p>}
            <p className="preview-help">
              {msg(
                "标题与简单无序列表可编辑；正文、表格、代码等混合分支回到原文编辑。",
              )}
            </p>
          </div>
        </details>
      )}
    </section>
  );
}
