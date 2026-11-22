import { msg, type Message } from "../i18n";

const labels = new Map<string, Message>([
  ["direct", "直接回答"],
  ["local", "本地资料"],
  ["web", "公开网页"],
  ["mixed", "本地资料和公开网页"],
  ["web-unavailable", "公开资料未核验"],
  ["no-evidence", "所选资料缺少足够证据"],
  ["bm25", "本地关键词（BM25）"],
  ["hybrid", "本地关键词和向量"],
  ["selected", "指定资料"],
]);

export const retrievalLabel = (code: string) => {
  const key = labels.get(code);
  return key ? msg(key) : code;
};

const rerankMessages: Record<string, Message> = {
  applied: "已重排",
  fallback: "重排未完成，使用初步排序",
  disabled: "未启用重排",
  "not-requested": "未请求重排",
  "no-candidates": "无候选，未调用重排",
  "strict-unavailable": "严格模式下重排不可用",
};
export const rerankLabel = (status: string) =>
  rerankMessages[status] ? msg(rerankMessages[status]) : status;
