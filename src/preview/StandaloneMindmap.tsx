import { useMemo } from "react";
import { msg, translate as t } from "../i18n";
import { mindPresentation, withMindStyle, type MindFormat, type MindChange } from "../content/editableMind";
import { findTopic, maxMindOffset, positionedMind, transferPositions } from "../content/mindPositions";
import { readMarkdownMind, changeMarkdownMind } from "../content/markdownMind";
import { readMermaidMind, changeMermaidMind } from "../content/mermaidMindDocument";
import { flattenMind, outlineTree } from "../content/mindmap";
import EditableMindCanvas from "./EditableMindCanvas";
import Graph from "./Graph";

interface Props {
  title: string;
  source: string;
  viewKey: string;
  format?: MindFormat;
  onApply: (base: string, next: string) => void;
  onError: (message: string) => void;
  onHistory: (back: boolean) => void;
  onLocate?: (line: number) => void;
}

export default function StandaloneMindmap({ title, source, viewKey, format = "markdown", onApply, onError, onHistory, onLocate }: Props) {
  const { body, style, offset, positions, lineCount } = useMemo(() => mindPresentation(source, format), [source, format]);
  const rawTree = useMemo(() => format === "mermaid" ? readMermaidMind(body) : readMarkdownMind(body, title), [body, title, format]);
  const tree = useMemo(() => rawTree && positionedMind(rawTree, positions), [rawTree, positions]);
  if (!tree) return <>
    <p className="preview-help">{t("此图含有扩展 Mermaid 语法。可在「源码」或「分栏」中编辑。", "This map uses extended Mermaid syntax. Edit it in Source or Split view.")}</p>
    <Graph canvas kind="mermaid" source={source} onError={onError} onLocate={onLocate}/>
  </>;
  const pending = [tree];
  let count = 0;
  while (pending.length) {
    if (++count > 500) return <p className="preview-error">{msg("脑图超过 500 个节点，请精简或使用文档大纲。")}</p>;
    pending.push(...pending.pop()!.children);
  }
  function change(edit: MindChange) {
    const next = format === "mermaid" ? changeMermaidMind(body, edit) : changeMarkdownMind(body, title, edit);
    let remapped = positions;
    if (positions.size && next.source !== body) {
      const parsed = format === "mermaid" ? readMermaidMind(next.source) : readMarkdownMind(next.source, title);
      if (parsed) remapped = transferPositions(tree!, positionedMind(parsed, new Map()), edit, next.selection);
    }
    const result = { ...next, source: withMindStyle(next.source, format, style, remapped) };
    onApply(source, result.source);
    return result;
  }
  function position(id: string, dx: number, dy: number) {
    const node = findTopic(tree!, id);
    if (!node?.positionKey || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const next = new Map<string, { x: number; y: number }>();
    const nodes = [tree!];
    while (nodes.length) {
      const topic = nodes.pop()!;
      if (topic.offset && topic.positionKey) next.set(topic.positionKey, topic.offset);
      nodes.push(...topic.children);
    }
    const rounded = (value: number) => Math.max(-maxMindOffset, Math.min(maxMindOffset, Math.round(value * 100) / 100));
    const x = rounded((node.offset?.x ?? 0) + dx);
    const y = rounded((node.offset?.y ?? 0) + dy);
    if (x || y) next.set(node.positionKey, { x, y });
    else next.delete(node.positionKey);
    onApply(source, withMindStyle(body, format, style, next));
  }
  function locate(id: string) {
    const node = flattenMind(outlineTree(body)).find(n => n.id === id);
    if (node && onLocate) onLocate(node.line + (node.from >= offset ? lineCount : 0));
  }
  return <EditableMindCanvas
    tree={tree} source={source} viewKey={viewKey} style={style}
    onStyle={next => onApply(source, withMindStyle(body, format, next, positions))}
    onPosition={position} onResetPositions={positions.size ? () => onApply(source, withMindStyle(body, format, style)) : undefined}
    onChange={change} onHistory={onHistory} onError={onError}
    onLocateNode={onLocate && format === "markdown" ? locate : undefined}
  />;
}
