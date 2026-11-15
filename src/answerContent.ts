import type { SearchResult } from "./types";
import type { CitationCheck, ExternalSource } from "./assistant/types";
import {
  documentCitation,
  publicCitationUrl,
  sourceKind,
} from "./assistant/sourceDisplay";
import { answerSourceUrl } from "./content/answerSourceLink";
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
  citationChecks?: CitationCheck[];
}
function evidenceExcerpt(citation: number, text?: string | null) {
  const characters = Array.from((text ?? "").replace(/\s+/gu, " ").trim());
  if (!characters.length) return "";
  const excerpt =
    characters.slice(0, 420).join("") + (characters.length > 420 ? "…" : "");
  const fence = "`".repeat(
    Math.max(0, ...(excerpt.match(/`+/g) ?? []).map((run) => run.length)) + 1,
  );
  const indent = " ".repeat(String(citation).length + 2);
  return `\n\n${indent}> 生成时摘录 ${fence} ${excerpt} ${fence}`;
}

function managedSourceLink(source: SearchResult) {
  if (!source.documentId) return;
  return answerSourceUrl({
    documentId: source.documentId,
    hash: source.hash,
    startLine: source.startLine,
    endLine: source.endLine,
  });
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
  const sourceLines = sources.map((source, i) => {
    const href =
      managedSourceLink(source) ??
      prefix +
        source.path
          .split("/")
          .map((part) =>
            encodeURIComponent(part).replace(
              /[!'()*]/g,
              (char) => "%" + char.charCodeAt(0).toString(16).toUpperCase(),
            ),
          )
          .join("/");
    const label = plain(
      source.title || source.heading || source.path.split("/").at(-1) || "资料",
    );
    return `${i + 1}. [${label}](${href}) · 第 ${source.startLine}–${source.endLine} 行 · 版本 \`${source.hash}\`${source.documentId ? ` · 文档 \`${source.documentId}\`` : ""}${evidenceExcerpt(i + 1, source.text)}`;
  });
  for (const source of options.externalSources ?? []) {
    const label = plain(source.label);
    const document = documentCitation(source, "");
    const url = document
      ? managedSourceLink(document)
      : source.kind === "web"
        ? publicCitationUrl(source.url)
        : undefined;
    const title = url
      ? `[${label}](${url.replace(/[()]/g, (c) => (c === "(" ? "%28" : "%29"))})`
      : label;
    const position = document
      ? ` · 第 ${document.startLine}–${document.endLine} 行 · 版本 \`${document.hash}\``
      : "";
    sourceLines.push(
      `${source.citation}. ${sourceKind(source)} · ${title}${position}${source.capturedAt ? ` · ${plain(source.capturedAt)}` : ""}${evidenceExcerpt(source.citation, source.excerpt)}`,
    );
  }
  return [
    heading ? `# ${plain(question)}\n` : "",
    options.citationChecks?.length
      ? `> 部分结论需要核对。${options.citationChecks.some((check) => check.status === "conflict") ? "有结论与来源不一致。" : ""}\n`
      : "",
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
    "\n引用编号对应生成时的资料版本。链接可在砚台打开原文，摘录供核对。正文模式下按住 ⌘ 点击打开链接。",
    sourceLines.length
      ? "\n" + sourceLines.join("\n\n")
      : "\n本轮没有引用资料。",
    options.citationChecks?.length
      ? "\n### 待核对结论\n\n" +
        options.citationChecks
          .map(
            (check) =>
              `- ${check.status === "conflict" ? "与来源不一致" : "待核对"} · ${plain(check.excerpt)}${check.citations.length ? ` · 引用 ${check.citations.join("、")}` : ""}`,
          )
          .join("\n")
      : "",
    "",
  ]
    .filter(Boolean)
    .join("\n");
}
