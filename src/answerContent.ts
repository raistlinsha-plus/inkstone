import type { SearchResult } from "./types";
import type { ExternalSource } from "./assistant/types";
import { publicCitationUrl, sourceKind } from "./assistant/sourceDisplay";
import { parseMarkdown, type MarkdownNode } from "./content/blocks";

export interface AnswerSnapshot {
  id: string;
  workspaceRoot: string;
  scopeLabel: string;
  scopePath: string | null;
  mode: "keyword" | "hybrid" | "rerank";
  model: string;
  createdAt: string;
  finishReason?: string;
  retrievalMode?: string;
  rerankStatus?: string;
}
const plain = (text: string) =>
  text.replace(/[\r\n]/g, " ").replace(/[\\`*_[\]<>]/g, "\\$&");
export interface AnswerTransferOptions {
  incomplete?: boolean;
  rejectedCharts?: number[];
  externalSources?: ExternalSource[];
}
function transferableBody(text: string, options: AnswerTransferOptions) {
  const edits: { from: number; to: number; value: string }[] = [];
  let chartIndex = 0,
    protectedContent = false;
  const visit = (node: MarkdownNode) => {
    if (node.type === "code") {
      const raw = text.slice(
        node.position.start.offset,
        node.position.end.offset,
      );
      const opening = raw.match(/^(`{3,}|~{3,})[ \t]*([^\s]*)/);
      const kind = node.lang?.toLowerCase() ?? "";
      const rejected =
        kind === "chart" && options.rejectedCharts?.includes(chartIndex);
      if (kind === "chart") chartIndex++;
      if (!opening) return;
      const marker = opening[1];
      const apparentClosing = new RegExp(
        "\\n[ \\t>]*" + marker[0] + "{" + marker.length + ",}[ \\t]*$",
      ).test(raw);
      // Quoted or deeply indented markers may be literal code. A real closing
      // fence is absent from the parsed value; a literal marker remains in it.
      const rawBreaks = (raw.replace(/\r?\n$/, "").match(/\n/g) ?? []).length;
      const valueBreaks = (node.value?.match(/\n/g) ?? []).length;
      const closed =
        apparentClosing && (!node.value || valueBreaks < rawBreaks - 1);
      let next = raw;
      if (
        ["chart", "json", "mermaid", "mindmap", "calendar"].includes(kind) &&
        (options.incomplete || rejected || !closed)
      ) {
        next = marker + kind + "-unverified" + raw.slice(opening[0].length);
        protectedContent = true;
      }
      if (!closed) {
        const lineStart =
          text.lastIndexOf("\n", node.position.start.offset - 1) + 1;
        const prefix = text
          .slice(lineStart, node.position.start.offset)
          .replace(/[^\s>]/g, " ");
        next += (next.endsWith("\n") ? "" : "\n") + prefix + marker + "\n";
        protectedContent = true;
      }
      if (next !== raw)
        edits.push({
          from: node.position.start.offset,
          to: node.position.end.offset,
          value: next,
        });
    } else node.children?.forEach(visit);
  };
  visit(parseMarkdown(text));
  for (const edit of edits.sort((a, b) => b.from - a.from))
    text = text.slice(0, edit.from) + edit.value + text.slice(edit.to);
  return { text, protectedContent };
}
export function answerFileName(question: string) {
  const label =
    Array.from(question.replace(/[\\/:*?"<>|\r\n]/g, " ").trim())
      .slice(0, 32)
      .join("") || "资料问答";
  return `回答-${label}.md`;
}
export function answerMarkdown(
  text: string,
  question: string,
  sources: SearchResult[],
  snapshot: AnswerSnapshot | null,
  targetPath = "",
  heading = false,
  options: AnswerTransferOptions = {},
) {
  const body = transferableBody(text, options);
  const depth = targetPath.split("/").length - 1;
  const prefix = "../".repeat(Math.max(0, depth));
  const sourceLines = sources.map((s, i) => {
    const href =
      prefix +
      s.path
        .split("/")
        .map((part) =>
          encodeURIComponent(part).replace(
            /[!'()*]/g,
            (char) => "%" + char.charCodeAt(0).toString(16).toUpperCase(),
          ),
        )
        .join("/");
    return `${i + 1}. [${plain(s.title || s.heading || s.path.split("/").at(-1) || "资料")}](${href}) · 第 ${s.startLine}–${s.endLine} 行 · 版本 \`${s.hash}\`${s.documentId ? ` · 文档 \`${s.documentId}\`` : ""}`;
  });
  for (const source of options.externalSources ?? []) {
    const label = plain(source.label);
    const url = publicCitationUrl(source.url);
    const title = url
      ? `[${label}](${url.replace(/[()]/g, (c) => (c === "(" ? "%28" : "%29"))})`
      : label;
    sourceLines.push(
      `${source.citation}. ${sourceKind(source)} · ${title}${source.capturedAt ? ` · ${plain(source.capturedAt)}` : ""}`,
    );
  }
  return [
    heading ? `# ${plain(question)}\n` : "",
    body.text,
    "\n---\n",
    "## 回答来源\n",
    body.protectedContent
      ? "> 未完成或来源不足的结构内容已保留为待核对代码。核对原文后，可手动恢复围栏类型；未自动绘制。\n"
      : "",
    `问题：${plain(question)}`,
    snapshot
      ? `\n范围：${plain(snapshot.scopeLabel)} · ${plain(snapshot.createdAt)}${snapshot.model ? ` · 模型：${plain(snapshot.model)}` : ""}`
      : "",
    snapshot?.finishReason &&
    !["stop", "no_evidence"].includes(snapshot.finishReason)
      ? "\n> 此回答可能未完整生成，结构内容请核对后使用。"
      : "",
    "\n引用编号对应生成时的资料版本；原文更新后请重新核对。",
    sourceLines.length ? "\n" + sourceLines.join("\n") : "\n本轮没有引用资料。",
    "",
  ]
    .filter(Boolean)
    .join("\n");
}
