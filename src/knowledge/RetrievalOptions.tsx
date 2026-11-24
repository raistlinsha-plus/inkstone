import { msg } from "../i18n";
import { SlidersHorizontal } from "lucide-react";
import type { IndexStatusSnapshot } from "../types";

export const retrievalDisclosure = {
  keyword: {
    search: "关键词仅在本机检索。",
    ask: "本地检索，问题与证据将发送给问答模型。",
  },
  hybrid: {
    search: "向量检索会将检索词发送给向量模型。",
    ask: "向量模型接收问题，问答模型接收问题与相关原文。",
  },
  rerank: {
    search: "检索词发给向量模型，检索词与候选片段发给重排模型。",
    ask: "问题发给向量模型，重排模型接收问题与候选片段，问答模型接收问题与证据。",
  },
} as const;
type Mode = keyof typeof retrievalDisclosure;

export default function RetrievalOptions({
  mode, onChange, locked, example, rerankEnabled, embeddingEnabled, snapshot,
  scopePath, onInspect,
}: {
  mode: Mode;
  onChange: (mode: Mode) => void;
  locked: boolean;
  example: boolean;
  rerankEnabled: boolean;
  embeddingEnabled: boolean;
  snapshot: IndexStatusSnapshot | null;
  scopePath: string | null | undefined;
  onInspect: () => void;
}) {
  const included = snapshot?.documents.filter(
    (doc) => doc.included && (!scopePath || doc.path === scopePath),
  );
  return (
    <details className="knowledge-options">
      <summary><SlidersHorizontal size={14} />{msg("检索设置")}</summary>
      <div className="knowledge-options-body">
        <label>
          {msg("检索方式")}
          <select
            aria-label={msg("检索方式")}
            value={mode}
            disabled={locked || example}
            onChange={(event) => onChange(event.target.value as Mode)}
          >
            <option value="keyword">{msg("本地关键词")}</option>
            <option value="hybrid">{msg("BM25 + 向量")}</option>
            <option value="rerank" disabled={!rerankEnabled}>{msg("混合检索 + 重排")}</option>
          </select>
        </label>
        {example && <p>{msg("样例仅使用本地关键词检索。")}</p>}
        {mode !== "keyword" && (
          <div role="status">
            <p>{!embeddingEnabled
              ? msg("向量未启用，可使用本地关键词检索。")
              : !included
                ? msg("尚未取得范围内的向量状态。")
                : !included.length
                  ? msg("当前范围没有已纳入的文档。")
                  : included.some((doc) => doc.vectorState !== "ready")
                    ? msg("部分向量尚未就绪，结果将标明实际检索方式。")
                    : msg("范围内已纳入的文档已准备好向量。")}
            </p>
            <button type="button" disabled={locked} onClick={onInspect}>{msg("查看准备情况")}</button>
          </div>
        )}
      </div>
    </details>
  );
}
