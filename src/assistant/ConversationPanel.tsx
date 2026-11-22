import ContextReceipt from "./ContextReceipt";
import { msg, systemMessage, type Message } from "../i18n";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  BookOpen,
  CircleAlert,
  Copy,
  FilePlus2,
  MoreHorizontal,
} from "lucide-react";
import Answer from "../Answer";
import { retrievalLabel, rerankLabel } from "../knowledge/retrievalLabels";
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

const preferenceLabels: Record<string, Message> = {
  structure: "回答结构",
  language: "回答语言",
  length: "回答篇幅",
  original_units: "资料单位",
};


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
        ? [msg("已停止，以下为未完成内容。"), candidate.error || r?.warning]
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

function answerBasis(record: AnswerRecord, choices: SearchResult[]) {
  if (!record.complete) return;
  if (record.snapshot?.finishReason === "no_evidence")
    return { label: msg("本轮未能核实"), missing: true };
  if (choices.length) {
    const web = choices.some((source) => source.external?.kind === "web");
    const local = choices.some((source) => source.external?.kind !== "web");
    return {
      label: local && web ? msg("本地资料与网页") : web ? msg("公开网页") : msg("所选资料"),
      missing: false,
    };
  }
  if (record.trace?.route === "direct")
    return { label: msg("直接回答 · 本轮未附来源"), missing: false };
}

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
  onCreateTasks,
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
  onCreateTasks?: (turn: Turn, candidate: Candidate | null, selection: string) => void;
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
  const renderAnswer = (
    record: AnswerRecord,
    key: string,
    active = false,
    retryTurn?: Turn,
  ) => {
    const citations = answerCitations(
      record.sources,
      record.externalSources ?? [],
    );
    const choices = citations.filter((source): source is SearchResult =>
      Boolean(source),
    );
    const first = choices[0];
    const basis = !active ? answerBasis(record, choices) : undefined;
    const technical = (record.snapshot || record.trace || record.memory) && (
      <details className="assistant-evidence assistant-technical">
        <summary>{msg("技术详情")}</summary>
        {record.snapshot && (
          <>
            <p>
              {record.snapshot.scopeLabel} ·{" "}
              {record.snapshot.model || msg("未调用问答模型")}
            </p>
            {record.snapshot.retrievalMode && (
              <p>
                {msg("实际检索 ·")}{" "}
                {retrievalLabel(record.snapshot.retrievalMode)}
                {record.snapshot.rerankStatus &&
                  ` · ${rerankLabel(record.snapshot.rerankStatus)}`}
              </p>
            )}
          </>
        )}
        {record.trace && (
          <section aria-label={msg("本轮查阅")}>
            <p>{msg("本轮查阅")}</p>
            <small>
              {retrievalLabel(record.trace.route)}
            </small>
            {record.trace.steps.map((step, index) => (
              <small key={index}>{step}</small>
            ))}
            {record.trace.unread.map((step, index) => (
              <small key={`unread-${index}`}>{msg("未核验 ·")} {step}</small>
            ))}
          </section>
        )}
        {record.memory && (
          <section aria-label={msg("本轮上下文")}>
            <p>
              {msg("本轮上下文 · 已应用")} {record.memory.preferences.length} {msg("项表达偏好")}
            </p>
            {record.memory.preferences.map((preference) => (
              <small key={preference.id}>
                {preferenceLabels[preference.key] ? msg(preferenceLabels[preference.key]) : preference.key} ·{" "}
                {preference.scope === "space" ? msg("当前空间") : msg("全部空间")}
              </small>
            ))}
            {record.memory.history && <small>{msg("已发送 1 条历史问题背景。")}</small>}
            {record.memory.notes.map((note) => (
              <small key={note}>{note}</small>
            ))}
          </section>
        )}
      </details>
    );
    return (
      <>
        {basis && (
          <div className="assistant-answer-basis">
            {basis.missing ? (
              <CircleAlert size={14} aria-hidden="true" />
            ) : (
              <BookOpen size={14} aria-hidden="true" />
            )}
            <span>{basis.label}</span>
            {first && (
              <button
                type="button"
                title={msg("查看本轮提供给模型的资料")}
                onClick={(event) => onOpen(first, choices, event.currentTarget)}
              >
                {msg("本轮依据 ·")} {choices.length}
              </button>
            )}
          </div>
        )}
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
          <div className="panel-warning">{systemMessage(record.warning)}</div>
        )}
        {record.chartWarnings.map((w, i) => (
          <div className="panel-warning" key={i}>
            {w}
          </div>
        ))}
        {!!record.citationChecks?.length && (
          <section
            className="assistant-citation-checks"
            aria-label={msg("引用核对结果")}
          >
            <h4>{msg("部分结论需要核对")}</h4>
            <ul>
              {record.citationChecks.map((check, index) => (
                <li key={index} data-review={check.status}>
                  <strong>
                    {check.status === "conflict" ? msg("与来源不一致") : msg("待核对")}
                  </strong>{" "}
                  {check.excerpt}
                  {check.citations.map((number) => {
                    const source = citations[number - 1];
                    return source ? (
                      <button
                        key={number}
                        type="button"
                        className="assistant-check-source"
                        title={source.title ?? undefined}
                        onClick={(event) =>
                          onOpen(source, choices, event.currentTarget)
                        }
                      >
                        {msg("查看引用")} {number}
                      </button>
                    ) : null;
                  })}
                </li>
              ))}
            </ul>
          </section>
        )}
        {!workbench && record.text && (
          <ContextualAnswerActions
            key={key}
            disabled={active}
            onCopy={() => onCopy(record)}
            onSave={() => onTransfer("save", record)}
          >
            {allowInsert && (
              <button
                disabled={active}
                onClick={() => onTransfer("insert", record)}
              >
                {msg("插入正文")}
              </button>
            )}
            {retryTurn && (
              <button
                disabled={busy || switching || conversation?.archived}
                onClick={() => onRetry(retryTurn)}
              >
                {msg("重新生成")}
              </button>
            )}
            {technical}
          </ContextualAnswerActions>
        )}
        {workbench && record.text && (
          <div className="assistant-turn-actions">
            <button disabled={active} onClick={() => onCopy(record)}>
              {msg("复制 Markdown")}
            </button>
            <button
              disabled={active}
              onClick={() => onTransfer("save", record)}
            >
              {msg("保存为文档")}
            </button>
            {first && !basis && (
              <button
                type="button"
                onClick={(event) => onOpen(first, choices, event.currentTarget)}
              >
                <BookOpen size={14} /> {msg("本轮依据 ·")} {choices.length}
              </button>
            )}
            {allowInsert && (
              <button
                disabled={active}
                onClick={() => onTransfer("insert", record)}
              >
                {msg("插入正文")}
              </button>
            )}
          </div>
        )}
        {(!record.text || !workbench) && first && !basis && (
          <button
            type="button"
            onClick={(event) => onOpen(first, choices, event.currentTarget)}
          >
            {msg("本轮依据 ·")} {choices.length}
          </button>
        )}
        {(workbench || !record.text) && technical}
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
        <p className="assistant-path" aria-label={msg("当前会话分支")}>
          {msg("当前分支 ·")} {path.length}{msg("轮 · 每轮展示选中的回答")}
        </p>
      )}
      {path.map((turn, index) => {
        const candidate = selectedCandidate(turn);
        return (
          <section className="assistant-turn" key={turn.id}>
            <div className="assistant-question">
              <div className="assistant-question-heading">
                <span>{msg("你 · 第")}{index + 1}{msg("轮")}</span>
                <button
                  disabled={busy || switching || conversation?.archived}
                  onClick={() => onEdit(turn)}
                >
                  {msg("修改问题并分支")}
                </button>
              </div>
              <p>{turn.question}</p>
              {onCreateTasks && <button disabled={busy || switching} onClick={()=>onCreateTasks(turn,null,window.getSelection()?.toString() ?? "")}>{msg("将原话转为任务")}</button>}
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
                false,
                candidate.status === "complete" ? turn : undefined,
              )}
            {candidate && <ContextReceipt candidate={candidate} turn={turn} parent={conversation?.turns.find(item=>item.id===turn.parentTurnId)}/>}
            {candidate?.status==="complete" && candidate.response?.text && onCreateTasks && <button className="assistant-task-action" disabled={busy || switching} onClick={()=>onCreateTasks(turn,candidate,window.getSelection()?.toString() ?? "")}>{msg("从回答创建任务")}</button>}
            {candidate &&
              (workbench ||
                candidate.status !== "complete" ||
                !candidate.response?.text ||
                turn.candidates.length > 1) && (
                <div className="assistant-branches">
                  <span>
                    {candidate.status === "stopped"
                      ? msg("已停止")
                      : candidate.status === "failed"
                        ? msg("生成失败")
                        : candidate.status === "source_changed"
                          ? msg("来源已变化")
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
                  {(workbench ||
                    !candidate.response?.text ||
                    candidate.status !== "complete") && (
                    <button
                      disabled={busy || switching || conversation?.archived}
                      onClick={() => onRetry(turn)}
                    >
                      {msg("重新生成")}
                    </button>
                  )}
                </div>
              )}
          </section>
        );
      })}
      {live && (
        <section className="assistant-turn assistant-live">
          <div className="assistant-question">
            <span>{msg("你")}</span>
            <p>{live.question}</p>
          </div>
          <p
            className="assistant-run-progress"
            role="status"
            aria-atomic="true"
          >
            {progress || msg("正在准备本轮资料…")}
          </p>
          {renderAnswer(live, live.snapshot?.id || "live", busy)}
        </section>
      )}
      {conversation &&
        conversation.turns.some((t) => !path.some((p) => p.id === t.id)) && (
          <details className="assistant-branch-list">
            <summary>{msg("其他问题分支")}</summary>
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
          {msg("回到最新回答")}
        </button>
      )}
    </div>
  );
}
function ContextualAnswerActions({
  disabled,
  onCopy,
  onSave,
  children,
}: {
  disabled: boolean;
  onCopy: () => void;
  onSave: () => void;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const area = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <div
      className="assistant-context-actions"
      onKeyDown={(event) => {
        if (expanded && event.key === "Escape") {
          event.stopPropagation();
          setExpanded(false);
          trigger.current?.focus();
        }
      }}
    >
      <div className="assistant-quick-actions">
        <button
          aria-label={msg("复制 Markdown")}
          title={msg("复制 Markdown")}
          disabled={disabled}
          onClick={onCopy}
        >
          <Copy size={14} aria-hidden="true" />
          {msg("复制")}
        </button>
        <button
          aria-label={msg("保存为文档")}
          title={msg("保存为文档")}
          disabled={disabled}
          onClick={onSave}
        >
          <FilePlus2 size={14} aria-hidden="true" />
          {msg("保存")}
        </button>
        <button
          ref={trigger}
          type="button"
          aria-label={msg("更多回答操作")}
          title={msg("更多回答操作")}
          aria-controls={area}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          <MoreHorizontal size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="assistant-extra-actions" id={area} hidden={!expanded}>
        {expanded && children}
      </div>
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
            : msg("指定空间")
          : "",
        attachments ? `${attachments} 份临时文件` : "",
      ]
        .filter(Boolean)
        .join("、") || msg("未指定本地资料")
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
    ? msg("使用公开网页")
    : turn.webAccess === "local-only"
      ? msg("本轮禁止搜索网页")
      : searched
        ? msg("已搜索，未使用网页证据")
        : response?.trace?.route === "web-unavailable"
          ? msg("公开网页未核验")
          : msg("未使用网页证据");
  return (
    <div className="assistant-turn-context" aria-label={msg("本轮资料与网页状态")}>
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
        {msg("第")}{source.startLine}–{source.endLine}{msg("行 · 本轮来源快照。打开原文时会核对当前版本。")}
      </p>
      {unavailable && (
        <p role="status" className="panel-warning">
          {msg("来源已删除、移入回收站或不在当前空间。此处保留历史快照，无法作为当前资料核对。")}
        </p>
      )}
      {source.heading && <h3>{source.heading}</h3>}
      <pre className="assistant-evidence-text">{source.text}</pre>
      <details>
        <summary>{msg("来源版本")}</summary>
        <code>{source.hash}</code>
      </details>
      <div className="modal-actions">
        <button disabled={busy} onClick={onClose}>
          {msg("回到会话")}
        </button>
        <button
          className="primary"
          disabled={busy || unavailable}
          onClick={onOpen}
        >
          {msg("打开原文并核对版本")}
        </button>
      </div>
    </>
  );
}
