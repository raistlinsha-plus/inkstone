import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import Answer from "../Answer";
import ModalDialog from "../ModalDialog";
import type { AnswerSnapshot } from "../answerContent";
import type { SearchResult } from "../types";
import {
  branchTurns,
  selectedCandidate,
  type Candidate,
  type Conversation,
  type Turn,
} from "./types";

export interface AnswerRecord {
  question: string;
  text: string;
  sources: SearchResult[];
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
  live,
  onOpen,
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
  live: AnswerRecord | null;
  onOpen: (source: SearchResult) => void;
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
    if (atBottom.current) {
      scroll.current?.scrollTo?.({ top: scroll.current.scrollHeight });
      setUnread(false);
    } else setUnread(true);
  }, [conversation?.activeLeafId, live?.text, conversation?.revision]);
  const renderAnswer = (record: AnswerRecord, key: string, active = false) => (
    <>
      <div className="assistant-turn-context">
        {record.snapshot?.scopeLabel}
        <span>
          {record.snapshot?.model || "未调用问答模型"}
          {record.snapshot?.rerankStatus
            ? ` · ${record.snapshot.rerankStatus}`
            : ""}
        </span>
      </div>
      {record.text && (
        <Answer
          text={record.text}
          sources={record.sources}
          onOpen={onOpen}
          pending={active || !record.complete}
          rejectedCharts={record.rejectedCharts}
          viewKey={key}
          onError={(message) => onError(message)}
        />
      )}{" "}
      {!record.text && active && (
        <div className="thinking">正在准备资料并组织回答…</div>
      )}{" "}
      {record.warning && (
        <div className="panel-warning" role={active ? "status" : "alert"}>
          {record.warning}
        </div>
      )}
      {record.chartWarnings.map((w, i) => (
        <div className="panel-warning" key={i}>
          {w}
        </div>
      ))}
      {record.text && (
        <div className="assistant-turn-actions">
          <button disabled={active} onClick={() => onCopy(record)}>
            复制 Markdown
          </button>
          <button disabled={active} onClick={() => onTransfer("save", record)}>
            保存为文档
          </button>
          <button
            disabled={active}
            onClick={() => onTransfer("insert", record)}
          >
            插入正文
          </button>
        </div>
      )}
      {record.sources.length > 0 && (
        <details className="assistant-evidence">
          <summary>本轮资料依据 · {record.sources.length}</summary>
          {record.sources.map((source, i) => (
            <button key={`${source.id}-${i}`} onClick={() => onOpen(source)}>
              <strong>
                S{i + 1} · {source.title || source.path.split("/").at(-1)}
              </strong>
              <small>
                第{source.startLine}–{source.endLine}行 · 本轮版本快照
              </small>
            </button>
          ))}
        </details>
      )}
    </>
  );
  return (
    <div
      className="assistant-timeline"
      ref={scroll}
      onScroll={() => {
        const el = scroll.current;
        if (el)
          atBottom.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 64;
      }}
    >
      {path.length > 0 && (
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
                <button disabled={busy} onClick={() => onEdit(turn)}>
                  修改问题并分支
                </button>
              </div>
              <p>{turn.question}</p>
            </div>
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
                        : "回答候选"}
                  {` · 当前选择 ${turn.candidates.indexOf(candidate) + 1}/${turn.candidates.length}`}
                </span>
                {turn.candidates.length > 1 && (
                  <select
                    aria-label={`回答候选 ${turn.question}`}
                    disabled={busy}
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
                  disabled={busy || conversation?.archived}
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
                <button key={t.id} disabled={busy} onClick={() => onBranch(t)}>
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
export function EvidencePreview({
  source,
  busy,
  onClose,
  onOpen,
}: {
  source: SearchResult;
  busy: boolean;
  onClose: () => void;
  onOpen: () => void;
}) {
  return (
    <ModalDialog
      label="本轮来源预览"
      className="assistant-evidence-dialog"
      onClose={onClose}
    >
      <div className="modal-heading">
        <h2>{source.title || source.path.split("/").at(-1)}</h2>
        <button onClick={onClose} aria-label="关闭来源预览">
          <X size={18} />
        </button>
      </div>
      <p className="muted">
        第{source.startLine}–{source.endLine}行 ·
        本轮来源快照。打开原文时会核对当前版本。
      </p>
      {source.heading && <h3>{source.heading}</h3>}
      <pre className="assistant-evidence-text">{source.text}</pre>
      <details>
        <summary>来源版本</summary>
        <code>{source.hash}</code>
      </details>
      <div className="modal-actions">
        <button onClick={onClose}>回到会话</button>
        <button className="primary" disabled={busy} onClick={onOpen}>
          打开原文并核对版本
        </button>
      </div>
    </ModalDialog>
  );
}
