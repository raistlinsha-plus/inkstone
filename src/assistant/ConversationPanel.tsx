import { useEffect, useRef, useState } from "react";
import { BookOpen } from "lucide-react";
import Answer from "../Answer";
import type { AnswerSnapshot } from "../answerContent";
import type { SearchResult } from "../types";
import { answerCitations } from "./sourceDisplay";
import {
  branchTurns,
  selectedCandidate,
  type Candidate,
  type CitationCheck,
  type Conversation,
  type ExternalSource,
  type MemoryUsage,
  type RetrievalTrace,
  type Turn,
} from "./types";

const preferenceLabels: Record<string, string> = {
  structure: "回答结构",
  length: "回答篇幅",
  original_units: "资料单位",
};
const retrievalLabels = new Map([
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

export interface AnswerRecord {
  question: string;
  text: string;
  sources: SearchResult[];
  externalSources?: ExternalSource[];
  trace?: RetrievalTrace;
  memory?: MemoryUsage;
  citationChecks?: CitationCheck[];
  snapshot: AnswerSnapshot | null;
  complete: boolean;
  rejectedCharts: number[];
  chartWarnings: string[];
  warning: string;
}
export function answerRecord(
  conversation: Conversation,
  turn: Turn,
  candidate: Candidate,
  root: string,
  mode: "keyword" | "hybrid" | "rerank",
): AnswerRecord {
  const r = candidate.response;
  return {
    question: turn.question,
    text: r?.text ?? "",
    sources: r?.sources ?? [],
    externalSources: r?.externalSources,
    trace: r?.trace,
    memory: r?.memory,
    citationChecks: r?.citationChecks,
    complete:
      candidate.status === "complete" &&
      ["stop", "no_evidence"].includes(r?.finishReason ?? ""),
    rejectedCharts: r?.rejectedCharts ?? [],
    chartWarnings: r?.chartWarnings ?? [],
    warning:
      candidate.status === "stopped"
        ? ["已停止，以下为未完成内容。", candidate.error || r?.warning]
            .filter(Boolean)
            .join("\n")
        : candidate.error || r?.warning || "",
    snapshot: {
      id: candidate.id,
      workspaceRoot: root,
      scopeLabel: conversation.scopeLabel,
      scopePath: conversation.scope,
      mode:
        candidate.requestedMode ??
        (r?.retrievalMode === "bm25"
          ? "keyword"
          : r?.rerankStatus === "applied"
            ? "rerank"
            : r?.retrievalMode === "hybrid"
              ? "hybrid"
              : mode),
      model: r?.model ?? "",
      createdAt: candidate.createdAt,
      finishReason: r?.finishReason,
      retrievalMode: r?.retrievalMode,
      rerankStatus: r?.rerankStatus,
    },
  };
}
export { ConversationHeader } from "./ConversationHeader";

export function ConversationTimeline({
  conversation,
  root,
  mode,
  busy,
  switching = false,
  progress,
  live,
  onOpen,
  allowInsert = true,
  workbench = false,
  onCopy,
  onTransfer,
  onRetry,
  onEdit,
  onSelect,
  onBranch,
  onError,
}: {
  conversation: Conversation | null;
  root: string;
  mode: "keyword" | "hybrid" | "rerank";
  busy: boolean;
  switching?: boolean;
  progress?: string;
  live: AnswerRecord | null;
  onOpen: (
    source: SearchResult,
    choices: SearchResult[],
    trigger?: HTMLButtonElement,
  ) => void;
  workbench?: boolean;
  allowInsert?: boolean;
  onCopy: (answer: AnswerRecord) => void;
  onTransfer: (kind: "save" | "insert", answer: AnswerRecord) => void;
  onRetry: (turn: Turn) => void;
  onEdit: (turn: Turn) => void;
  onSelect: (turn: Turn, c: Candidate) => void;
  onBranch: (turn: Turn) => void;
  onError: (e: unknown) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null),
    atBottom = useRef(true),
    [unread, setUnread] = useState(false);
  const path = conversation ? branchTurns(conversation) : [];
  useEffect(() => {
    atBottom.current = true;
  }, [conversation?.id]);
  useEffect(() => {
    if (atBottom.current) {
      scroll.current?.scrollTo?.({ top: scroll.current.scrollHeight });
      setUnread(false);
    } else setUnread(true);
  }, [
    conversation?.id,
    conversation?.activeLeafId,
    live?.text,
    conversation?.revision,
  ]);
  const renderAnswer = (record: AnswerRecord, key: string, active = false) => {
    const choices = answerCitations(
      record.sources,
      record.externalSources ?? [],
    ).filter((source): source is SearchResult => Boolean(source));
    const first = choices[0];
    return (
      <>
        {record.text && (
          <Answer
            text={record.text}
            sources={record.sources}
            externalSources={record.externalSources}
            citationChecks={record.citationChecks}
            onOpen={(source, trigger) => onOpen(source, choices, trigger)}
            pending={active || !record.complete}
            rejectedCharts={record.rejectedCharts}
            viewKey={key}
            onError={(message) => onError(message)}
          />
        )}{" "}
        {record.warning && (
          <div className="panel-warning">{record.warning}</div>
        )}
        {record.chartWarnings.map((w, i) => (
          <div className="panel-warning" key={i}>
            {w}
          </div>
        ))}
        {!!record.citationChecks?.length && (
          <section
            className="assistant-citation-checks"
            aria-label="引用核对结果"
          >
            <h4>部分结论需要核对</h4>
            <ul>
              {record.citationChecks.map((check, index) => (
                <li key={index} data-review={check.status}>
                  <strong>
                    {check.status === "conflict" ? "与来源不一致" : "待核对"}
                  </strong>{" "}
                  {check.excerpt}
                  {!!check.citations.length && (
                    <small> · 引用 {check.citations.join("、")}</small>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        {record.text && (
          <div className="assistant-turn-actions">
            <button disabled={active} onClick={() => onCopy(record)}>
              复制 Markdown
            </button>
            <button
              disabled={active}
              onClick={() => onTransfer("save", record)}
            >
              保存为文档
            </button>
            {first && (
              <button
                type="button"
                onClick={(event) => onOpen(first, choices, event.currentTarget)}
              >
                <BookOpen size={14} /> 本轮依据 · {choices.length}
              </button>
            )}
            {allowInsert && (
              <button
                disabled={active}
                onClick={() => onTransfer("insert", record)}
              >
                插入正文
              </button>
            )}
          </div>
        )}
        {!record.text && first && (
          <button
            type="button"
            onClick={(event) => onOpen(first, choices, event.currentTarget)}
          >
            本轮依据 · {choices.length}
          </button>
        )}
        {(record.snapshot || record.trace || record.memory) && (
          <details className="assistant-evidence assistant-technical">
            <summary>技术详情</summary>
            {record.snapshot && (
              <>
                <p>
                  {record.snapshot.scopeLabel} ·{" "}
                  {record.snapshot.model || "未调用问答模型"}
                </p>
                {record.snapshot.retrievalMode && (
                  <p>
                    实际检索 ·{" "}
                    {retrievalLabels.get(record.snapshot.retrievalMode) ??
                      record.snapshot.retrievalMode}
                    {record.snapshot.rerankStatus &&
                      ` · 重排 ${record.snapshot.rerankStatus}`}
                  </p>
                )}
              </>
            )}
            {record.trace && (
              <section aria-label="本轮查阅">
                <p>本轮查阅</p>
                <small>
                  {retrievalLabels.get(record.trace.route) ??
                    record.trace.route}
                </small>
                {record.trace.steps.map((step, index) => (
                  <small key={index}>{step}</small>
                ))}
                {record.trace.unread.map((step, index) => (
                  <small key={`unread-${index}`}>未核验 · {step}</small>
                ))}
              </section>
            )}
            {record.memory && (
              <section aria-label="本轮上下文">
                <p>
                  本轮上下文 · 已应用 {record.memory.preferences.length}{" "}
                  项表达偏好
                </p>
                {record.memory.preferences.map((preference) => (
                  <small key={preference.id}>
                    {preferenceLabels[preference.key] ?? preference.key} ·{" "}
                    {preference.scope === "space" ? "当前空间" : "全部空间"}
                  </small>
                ))}
                {record.memory.history && (
                  <small>已发送 1 条历史问题背景。</small>
                )}
                {record.memory.notes.map((note) => (
                  <small key={note}>{note}</small>
                ))}
              </section>
            )}
          </details>
        )}
      </>
    );
  };
  return (
    <div
      className={`assistant-timeline ${workbench ? "workbench-timeline" : ""}`}
      ref={scroll}
      onScroll={() => {
        const el = scroll.current;
        if (el)
          atBottom.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 64;
      }}
    >
      {path.length > 1 && (
        <p className="assistant-path" aria-label="当前会话分支">
          当前分支 · {path.length}轮 · 每轮展示选中的回答
        </p>
      )}
      {path.map((turn, index) => {
        const candidate = selectedCandidate(turn);
        return (
          <section className="assistant-turn" key={turn.id}>
            <div className="assistant-question">
              <div className="assistant-question-heading">
                <span>你 · 第{index + 1}轮</span>
                <button
                  disabled={busy || switching || conversation?.archived}
                  onClick={() => onEdit(turn)}
                >
                  修改问题并分支
                </button>
              </div>
              <p>{turn.question}</p>
            </div>
            <TurnSources
              turn={turn}
              candidate={candidate}
              conversation={conversation!}
            />
            {candidate &&
              renderAnswer(
                answerRecord(conversation!, turn, candidate, root, mode),
                candidate.id,
              )}
            {candidate && (
              <div className="assistant-branches">
                <span>
                  {candidate.status === "stopped"
                    ? "已停止"
                    : candidate.status === "failed"
                      ? "生成失败"
                      : candidate.status === "source_changed"
                        ? "来源已变化"
                        : null}
                  {turn.candidates.length > 1 &&
                    ` · 当前选择 ${turn.candidates.indexOf(candidate) + 1}/${turn.candidates.length}`}
                </span>
                {turn.candidates.length > 1 && (
                  <select
                    aria-label={`回答候选 ${turn.question}`}
                    disabled={busy || switching}
                    value={candidate.id}
                    onChange={(e) => {
                      const c = turn.candidates.find(
                        (c) => c.id === e.target.value,
                      );
                      if (c) onSelect(turn, c);
                    }}
                  >
                    {turn.candidates.map((c, i) => (
                      <option value={c.id} key={c.id}>
                        {i + 1}/{turn.candidates.length} ·{" "}
                        {
                          {
                            complete: "已完成",
                            stopped: "已停止",
                            failed: "生成失败",
                            generating: "生成中",
                            source_changed: "来源变化",
                          }[c.status]
                        }
                      </option>
                    ))}
                  </select>
                )}
                <button
                  disabled={busy || switching || conversation?.archived}
                  onClick={() => onRetry(turn)}
                >
                  重新生成
                </button>
              </div>
            )}
          </section>
        );
      })}
      {live && (
        <section className="assistant-turn assistant-live">
          <div className="assistant-question">
            <span>你</span>
            <p>{live.question}</p>
          </div>
          <p
            className="assistant-run-progress"
            role="status"
            aria-atomic="true"
          >
            {progress || "正在准备本轮资料…"}
          </p>
          {renderAnswer(live, live.snapshot?.id || "live", busy)}
        </section>
      )}
      {conversation &&
        conversation.turns.some((t) => !path.some((p) => p.id === t.id)) && (
          <details className="assistant-branch-list">
            <summary>其他问题分支</summary>
            {conversation.turns
              .filter((t) => !path.some((p) => p.id === t.id))
              .map((t) => (
                <button
                  key={t.id}
                  disabled={busy || switching}
                  onClick={() => onBranch(t)}
                >
                  {t.question}
                </button>
              ))}
          </details>
        )}
      {unread && (
        <button
          className="assistant-latest"
          onClick={() => {
            atBottom.current = true;
            setUnread(false);
            scroll.current?.scrollTo?.({
              top: scroll.current.scrollHeight,
              behavior: "smooth",
            });
          }}
        >
          回到最新回答
        </button>
      )}
    </div>
  );
}
function TurnSources({
  turn,
  candidate,
  conversation,
}: {
  turn: Turn;
  candidate?: Candidate;
  conversation: Conversation;
}) {
  const response = candidate?.response;
  const picked = turn.sources;
  const documents = picked?.documentIds?.length ?? 0;
  const attachments = picked?.attachments?.length ?? 0;
  const selected = picked
    ? [
        picked.projectId
          ? documents
            ? `指定 ${documents} 篇文档`
            : "指定空间"
          : "",
        attachments ? `${attachments} 份临时文件` : "",
      ]
        .filter(Boolean)
        .join("、") || "未指定本地资料"
    : conversation.scopeLabel;
  const local =
    (response?.sources.length ?? 0) +
    (response?.externalSources?.filter((source) => source.kind !== "web")
      .length ?? 0);
  const publicEvidence = response?.externalSources?.some(
    (source) => source.kind === "web",
  );
  const searched = response?.trace?.steps?.some((step) =>
    step.startsWith("公开网页 · 检查 "),
  );
  const web = publicEvidence
    ? "使用公开网页"
    : turn.webAccess === "local-only"
      ? "本轮禁止搜索网页"
      : searched
        ? "已搜索，未使用网页证据"
        : response?.trace?.route === "web-unavailable"
          ? "公开网页未核验"
          : "未使用网页证据";
  return (
    <div className="assistant-turn-context" aria-label="本轮资料与网页状态">
      <span>
        {selected}
        {response ? ` · ${local} 段本地证据` : ""}
      </span>
      {(response || turn.webAccess === "local-only") && <span>{web}</span>}
    </div>
  );
}

export function EvidencePreview({
  source,
  busy,
  unavailable = false,
  onClose,
  onOpen,
}: {
  source: SearchResult;
  busy: boolean;
  unavailable?: boolean;

  onClose: () => void;
  onOpen: () => void;
}) {
  return (
    <>
      <p className="muted">
        第{source.startLine}–{source.endLine}行 ·
        本轮来源快照。打开原文时会核对当前版本。
      </p>
      {unavailable && (
        <p role="status" className="panel-warning">
          来源已删除、移入回收站或不在当前空间。此处保留历史快照，无法作为当前资料核对。
        </p>
      )}
      {source.heading && <h3>{source.heading}</h3>}
      <pre className="assistant-evidence-text">{source.text}</pre>
      <details>
        <summary>来源版本</summary>
        <code>{source.hash}</code>
      </details>
      <div className="modal-actions">
        <button disabled={busy} onClick={onClose}>
          回到会话
        </button>
        <button
          className="primary"
          disabled={busy || unavailable}
          onClick={onOpen}
        >
          打开原文并核对版本
        </button>
      </div>
    </>
  );
}
