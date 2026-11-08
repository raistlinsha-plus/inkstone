import type { SearchResult } from "../types";
import type { ExternalSource } from "./types";

export function sourceKind(source: ExternalSource) {
  return source.kind === "web"
    ? "网页"
    : source.kind === "attachment"
      ? "临时文件"
      : "文档";
}

export function publicCitationUrl(value?: string | null) {
  if (!value) return;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password)
      return url.href;
  } catch {
    // A malformed URL can still be displayed as a source label.
  }
}

export function documentCitation(
  source: ExternalSource,
  path: string,
): SearchResult | undefined {
  if (
    source.kind !== "document" ||
    !source.documentId ||
    !source.id.startsWith(source.documentId + ":") ||
    !source.contentHash ||
    !/^[a-f\d]{64}$/.test(source.contentHash)
  )
    return;
  const range = /^(\d+)-(\d+)$/.exec(
    source.id.slice(source.documentId.length + 1),
  );
  if (!range) return;
  const startLine = Number(range[1]);
  const endLine = Number(range[2]);
  if (
    !Number.isSafeInteger(startLine) ||
    !Number.isSafeInteger(endLine) ||
    startLine < 1 ||
    endLine < startLine
  )
    return;
  return {
    external: source,
    id: source.citation,
    documentId: source.documentId,
    path,
    title: source.label,
    text: source.excerpt ?? "",
    heading: "",
    startLine,
    endLine,
    hash: source.contentHash,
    score: 0,
  };
}

export function answerCitations(
  local: SearchResult[],
  external: ExternalSource[],
) {
  const citations: (SearchResult | undefined)[] = [...local];
  for (const source of external) {
    const index = source.citation - 1;
    if (
      !Number.isInteger(index) ||
      index < local.length ||
      index >= 128 ||
      citations[index]
    )
      continue;
    citations[index] = {
      id: -(index + 1),
      title: source.label,
      path: "",
      heading: sourceKind(source),
      hash: "",
      text: source.excerpt ?? "",
      startLine: 0,
      endLine: 0,
      score: 0,
      external: source,
    };
  }
  return citations;
}
