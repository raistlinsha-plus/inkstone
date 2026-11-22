import { useLocale } from "../i18n";
import type { Candidate, Turn } from "./types";

export default function ContextReceipt({
  candidate,
  turn,
  parent,
}: {
  candidate: Candidate;
  turn: Turn;
  parent?: Turn;
}) {
  const { t } = useLocale();
  const receipt = candidate.contextReceipt;
  const response = candidate.response;
  const labels = {
    answer: t("生成回答", "Generate answer"),
    webPlan: t("判断是否搜索网页", "Plan web lookup"),
    reviewPassages: t("核对候选原文", "Review candidate passages"),
    structured: t("结构化模型请求", "Structured model call"),
    embedding: t("向量检索", "Embed query"),
    rerank: t("重排候选", "Rerank passages"),
    webSearch: t("搜索网页", "Search the web"),
    webPage: t("读取网页", "Read web page"),
  };
  const previousAttachments = new Set(parent?.sources?.attachments ?? []);
  const currentAttachments = new Set(turn.sources?.attachments ?? []);
  const added = [...currentAttachments].filter(
    (id) => !previousAttachments.has(id),
  ).length;
  const removed = [...previousAttachments].filter(
    (id) => !currentAttachments.has(id),
  ).length;
  return (
    <details className="assistant-evidence context-receipt">
      <summary>
        {t("本轮上下文", "Context used")}
        {receipt && (
          <>
            {" "}
            · {receipt.attempts.length + receipt.overflow}{" "}
            {t(
              "次请求",
              receipt.attempts.length + receipt.overflow === 1
                ? "request"
                : "requests",
            )}
          </>
        )}
      </summary>
      {!receipt ? (
        <p>
          {t(
            "这条回答没有逐请求记录。",
            "Per-request details are unavailable for this answer.",
          )}
        </p>
      ) : (
        <>
          {receipt.attempts.length === 0 && (
            <p>
              {t(
                "本轮未发出模型或网页请求。",
                "No model or web request was attempted for this turn.",
              )}
            </p>
          )}
          {receipt.attempts.map((row, i) => (
            <p key={i}>
              <strong>
                {i + 1}. {labels[row.service]}
              </strong>{" "}
              ·{" "}
              {row.httpStatus == null
                ? t("已尝试，未收到响应头", "Attempted · no response headers")
                : `HTTP ${row.httpStatus}`}
              {row.service !== "webPage" && (
                <>
                  {" "}
                  · {row.inputChars} {t("个输入字符", "input characters")}
                </>
              )}
              {row.sources && (
                <small>
                  {t(
                    "最终请求包含的摘录",
                    "Passages included in the final request",
                  )}{" "}
                  · {t("文档", "Documents")} {row.sources.documents} · Wiki{" "}
                  {row.sources.wiki} · {t("附件", "Attachments")}{" "}
                  {row.sources.attachments} · {t("网页", "Web pages")}{" "}
                  {row.sources.web}
                </small>
              )}
              {row.inputTokens != null && (
                <>
                  {" "}
                  · {row.inputTokens} {t("个输入 token", "input tokens")}
                </>
              )}
              {row.outputTokens != null && (
                <>
                  {" "}
                  · {row.outputTokens} {t("个输出 token", "output tokens")}
                </>
              )}
            </p>
          ))}
          {receipt.overflow > 0 && (
            <p>
              {t("其他请求", "Additional requests")} · {receipt.overflow}
            </p>
          )}
          {receipt.attempts.some(
            (a) =>
              [
                "answer",
                "structured",
                "embedding",
                "rerank",
                "webPlan",
                "reviewPassages",
              ].includes(a.service) && a.inputTokens == null,
          ) && (
            <small>
              {t(
                "字符数按提交的文字统计。只有服务返回的 token 用量才会列出。",
                "Characters count submitted text. Token counts appear when reported by the provider.",
              )}
            </small>
          )}
        </>
      )}
      {response && (
        <p>
          {t("随回答保留的来源", "Sources retained with the answer")} ·{" "}
          {response.sources.length + (response.externalSources?.length ?? 0)}
        </p>
      )}
      {receipt?.citedSources != null && (
        <p>
          {t("回答正文标注的不同来源", "Distinct sources cited in answer text")}{" "}
          · {receipt.citedSources}
        </p>
      )}
      {response?.memory && (
        <p>
          {t("采用的表达偏好", "Applied preferences")} ·{" "}
          {response.memory.preferences.length}　
          {t("显式历史背景", "Explicit history")} ·{" "}
          {response.memory.history ? 1 : 0}
        </p>
      )}
      {parent && (added > 0 || removed > 0) && (
        <p>
          {t(
            "与上轮相比，本轮所选附件",
            "Selected attachments since the preceding turn",
          )}{" "}
          · +{added} / −{removed}
        </p>
      )}
    </details>
  );
}
