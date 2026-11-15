export interface AnswerSourceLink {
  documentId: string;
  hash: string;
  startLine: number;
  endLine: number;
}

const prefix = "inkstone-source:v1/";
const documentIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const hashPattern = /^[0-9a-f]{64}$/;
const maxLine = 10_000_000;

export function answerSourceUrl(source: AnswerSourceLink): string | undefined {
  const { documentId, hash, startLine, endLine } = source;
  if (
    documentId.length !== 36 ||
    !documentIdPattern.test(documentId) ||
    hash.length !== 64 ||
    !hashPattern.test(hash) ||
    !Number.isInteger(startLine) ||
    !Number.isInteger(endLine) ||
    startLine < 1 ||
    endLine < startLine ||
    endLine > maxLine
  )
    return;
  return `${prefix}${documentId}/${hash}/${startLine}-${endLine}`;
}

export function usesAnswerSourceProtocol(url: string): boolean {
  return /^inkstone-source:/i.test(url);
}

export function parseAnswerSourceUrl(
  url: string,
): AnswerSourceLink | undefined {
  if (!url.startsWith(prefix)) return;
  const [documentId, hash, range] = url.slice(prefix.length).split("/");
  const lines = range?.match(/^(\d{1,8})-(\d{1,8})$/);
  if (!documentId || !hash || !lines) return;
  const source = {
    documentId,
    hash,
    startLine: Number(lines[1]),
    endLine: Number(lines[2]),
  };
  if (answerSourceUrl(source) === url) return source;
}
