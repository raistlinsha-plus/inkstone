import { msg, type Message } from "../i18n";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, ExternalLink, RefreshCw, X } from "lucide-react";
import type { LibraryDocument, LibraryView } from "../library";
import type { SearchResult } from "../types";
import ModalDialog from "../ModalDialog";
import Markdown from "../preview/Markdown";

import {
  WikiClaimEvidence,
  WikiSourceLink,
  sourceLines,
  type ClaimReview,
  type WikiRef,
} from "./WikiClaimEvidence";

interface WikiPolicy {
  revision: number;
  enabled: boolean;
  paused: boolean;
  automatic: boolean;
  topic: string;
  documentIds: string[];
}
interface RemovalImpact {
  pages: number;
  revisions: number;
  pending: number;
  token: string;
}
interface WikiSummary {
  id: string;
  title: string;
  summary: string;
  revision: number;
  sourceCount: number;
  stale: boolean;
}
interface WikiChange {
  id: string;
  pageId: string;
  title: string;
  status: string;
  reason: string;
  created: number;
  canRestore: boolean;
  stale?: boolean;
  restoreRevision?: number;
  restoreAvailability?: "full" | "excerpts" | "unavailable";
  sourceCount: number;
  summaryIssues?: SummaryIssue[];
  restoreSummaryIssues?: SummaryIssue[];
}
interface SummaryIssue {
  claim: string;
  reason: "missing" | "conflict";
}
interface WikiPage extends WikiSummary {
  body: string;
  refs: WikiRef[];
  historicalSources?: (Pick<
    WikiRef,
    "documentId" | "title" | "startLine" | "endLine"
  > & { excerpt?: string })[];
  related?: { id: string; title: string }[];
  summaryIssues?: SummaryIssue[];
  claimReviews?: ClaimReview[];
  reviewComparison?: WikiReviewComparison;
}
interface WikiReviewComparison {
  baseRevision: number;
  currentRevision: number;
  baseAvailable: boolean;
  summaryChanged: boolean;
  outlineChanged: boolean;
  sources: { title: string; status: "added" | "updated" | "removed" }[];
}
interface WikiStatus {
  policy: WikiPolicy;
  pages: WikiSummary[];
  changes: WikiChange[];
  job: { status: string; message: string };
  currentPendingCount?: number;
  coverage?: WikiCoverage[];
}
type ReviewAction =
  "publish" | "publish-excerpts" | "reject" | "restore" | "restore-excerpts";
interface WikiCoverage {
  documentId: string;
  title: string;
  status: keyof typeof coverageLabels;
}
const coverageLabels = {
  pending: "等待整理",
  included: "已找到原文引用",
  omitted: "本次未引用，可重试",
  partial: "超出本次处理限额，可重试",
  retry: "整理未完成，可重试",
  unavailable: "资料当前不可用",
  empty: "资料没有可整理的文本",
} as const;
const jobLabels: Record<string, Message> = {
  running: "整理中",
  ready: "整理完成",
  error: "整理失败",
  cancelled: "已取消",
} as const;
const changeLabels: Record<string, Message> = {
  pending: "待审阅",
  published: "已生效",
  rejected: "已拒绝",
  superseded: "已被替代",
} as const;
const reviewMessages: Record<ReviewAction, Message> = {
  publish: "改动已发布，可在主题中查看生效版本。",
  "publish-excerpts": "已发布核验过的原文摘录。",
  reject: "改动已拒绝，可重新整理。",
  restore: "历史版本已恢复，可在主题中查看。",
  "restore-excerpts": "已恢复核验过的原文摘录。",
} as const;
const sourceChangeLabels = {
  added: "新增引用",
  updated: "更新引用",
  removed: "移除引用",
} as const;

const changeDate = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

function reviewPriority(item: WikiChange) {
  if (item.stale) return 3;
  if (item.summaryIssues?.some(({ reason }) => reason === "conflict")) return 2;
  return item.summaryIssues?.length ? 1 : 0;
}

export default function WikiPanel({
  projectId,
  workspaceRoot,
  view,
  onClose,
  onImport,
  onOpenSource,
  onOpenCurrentDocument,
}: {
  projectId: string;
  workspaceRoot: string;
  view: LibraryView;
  onClose: () => void;
  onImport: () => void;
  onOpenCurrentDocument?: (doc: LibraryDocument) => void | Promise<void>;
  onOpenSource: (source: SearchResult) => void | Promise<void>;
}) {
  const [status, setStatus] = useState<WikiStatus>();
  const [policy, setPolicy] = useState<WikiPolicy>();
  const [removalImpact, setRemovalImpact] = useState<RemovalImpact>();
  const [page, setPage] = useState<WikiPage>();
  const [change, setChange] = useState<WikiChange>();
  const [baseline, setBaseline] = useState<WikiPage>();
  const [tab, setTab] = useState<"pages" | "changes" | "policy">("pages");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [reviewNotice, setReviewNotice] = useState("");
  const [readingId, setReadingId] = useState<string>();
  const [documentFilter, setDocumentFilter] = useState("");
  const latestPage = useRef(0);
  const latestStatus = useRef(0);
  const requestedReviewFocus = useRef<string>(undefined);
  const reviewContext = useRef<HTMLDivElement>(null);
  const dirty = useRef(false);
  const removingDocuments =
    !!policy &&
    status?.policy.documentIds.some((id) => !policy.documentIds.includes(id));
  const docs = view.documents.filter(
    (doc) => doc.projectId === projectId && doc.status === "ready",
  );
  const spaceTitle = view.projects.find((item) => item.id === projectId)?.title;
  const visibleDocuments = docs.filter((doc) =>
    doc.title
      .toLocaleLowerCase()
      .includes(documentFilter.trim().toLocaleLowerCase()),
  );
  const active = useRef(true);
  const applyStatus = useCallback((next: WikiStatus, resetPolicy = false) => {
    ++latestStatus.current;
    setStatus(next);
    if (!dirty.current || resetPolicy) {
      setPolicy(next.policy);
      setRemovalImpact(undefined);
      dirty.current = false;
    }
  }, []);
  const refresh = useCallback(
    async (resetPolicy = false) => {
      const request = ++latestStatus.current;
      const next = await invoke<WikiStatus>("wiki_status");
      if (!active.current || request !== latestStatus.current || !next) return;
      applyStatus(next, resetPolicy);
      return next;
    },
    [applyStatus],
  );

  useEffect(() => {
    if (!status || !page) return;
    const stillAvailable = change
      ? status.changes.some(
          (item) =>
            item.id === change.id &&
            item.status === change.status &&
            (item.stale === undefined || item.stale === page.stale),
        )
      : status.pages.some(
          (item) =>
            item.id === page.id &&
            item.revision === page.revision &&
            item.stale === page.stale,
        );
    if (!stillAvailable) {
      ++latestPage.current;
      setPage(undefined);
      setChange(undefined);
      setBaseline(undefined);
    }
  }, [change, page, status]);

  useEffect(() => {
    if (page && change && change.id === requestedReviewFocus.current) {
      requestedReviewFocus.current = undefined;
      reviewContext.current?.focus();
    }
  }, [change, page]);

  useEffect(() => {
    active.current = true;
    void refresh(true).catch((reason) => {
      if (active.current) setError(String(reason));
    });
    const off = listen<string | { workspaceRoot?: string; root?: string }>(
      "wiki-change",
      ({ payload }) => {
        const root =
          typeof payload === "string"
            ? payload
            : (payload?.workspaceRoot ?? payload?.root);
        if (!root || root === workspaceRoot)
          void refresh().catch((reason) => {
            if (active.current) setError(String(reason));
          });
      },
    );
    void off.catch(() => {});
    return () => {
      active.current = false;
      ++latestPage.current;
      ++latestStatus.current;
      void off.then(
        (unlisten) => unlisten(),
        () => {},
      );
    };
  }, [refresh, workspaceRoot]);

  useEffect(() => {
    if (
      [page, baseline].some((item) =>
        [
          ...(item?.refs ?? []),
          ...(item?.historicalSources ?? []).filter((source) => source.excerpt),
        ].some(
          (source) =>
            !view.documents.some(
              (doc) => doc.id === source.documentId && doc.status === "ready",
            ),
        ),
      )
    ) {
      ++latestPage.current;
      setPage(undefined);
      setChange(undefined);
      setBaseline(undefined);
      void refresh().catch((reason) => {
        if (active.current) setError(String(reason));
      });
    }
  }, [page, baseline, view.documents, refresh]);

  async function run(label: string, task: () => Promise<unknown>) {
    setBusy(label);
    setError("");
    try {
      await task();
    } catch (reason) {
      if (active.current) setError(String(reason));
    } finally {
      if (active.current) setBusy("");
    }
  }

  function patch(value: Partial<WikiPolicy>) {
    dirty.current = true;
    setRemovalImpact(undefined);
    setPolicy((old) => old && { ...old, ...value });
  }

  async function save() {
    if (!policy) return;
    const { revision: expectedRevision, ...settings } = policy;
    if (removingDocuments && !removalImpact) {
      await run("正在查看影响", async () => {
        const impact = await invoke<RemovalImpact>("wiki_removal_impact", {
          projectId,
          expectedRevision,
          documentIds: policy.documentIds,
        });
        if (active.current) setRemovalImpact(impact);
      });
      return;
    }
    await run("保存中", async () => {
      setRemovalImpact(undefined);
      const next = await invoke<WikiStatus>("wiki_set_policy", {
        input: {
          expectedRevision,
          ...settings,
          removalToken: removalImpact?.token,
        },
      });
      if (!active.current) return;
      if (removingDocuments) {
        ++latestPage.current;
        setPage(undefined);
        setChange(undefined);
        setBaseline(undefined);
      }
      if (next) applyStatus(next, true);
      else await refresh(true);
      setTab("pages");
    });
  }

  async function inspect(pageId: string, proposal?: WikiChange) {
    const request = ++latestPage.current;
    setPage(undefined);
    setBaseline(undefined);
    setChange(proposal);
    setReadingId(proposal?.id ?? pageId);
    setError("");
    try {
      const data = await invoke<WikiPage>("wiki_read", {
        pageId,
        changeId: proposal?.id ?? null,
      });
      if (!active.current || request !== latestPage.current) return;
      setPage(data);
      setReadingId(undefined);
      const comparison = data.reviewComparison;
      if (
        proposal?.status === "pending" &&
        (!comparison ||
          (comparison.baseRevision > 0 &&
            comparison.baseAvailable &&
            comparison.baseRevision === comparison.currentRevision))
      ) {
        const previous = await invoke<WikiPage>("wiki_read", { pageId }).catch(
          () => undefined,
        );
        if (active.current && request === latestPage.current)
          setBaseline(previous);
      }
    } catch (reason) {
      if (active.current && request === latestPage.current) {
        requestedReviewFocus.current = undefined;
        setReadingId(undefined);
        setError(String(reason));
      }
    }
  }

  async function review(action: ReviewAction) {
    if (!selectedChange || busy) return;
    const { id, pageId } = selectedChange;
    setReviewNotice("");
    await run("正在处理改动", async () => {
      const result = await invoke<WikiStatus>("wiki_review", {
        input: { id, action },
      });
      if (!active.current) return;
      ++latestPage.current;
      setChange(undefined);
      setPage(undefined);
      setBaseline(undefined);
      if (result) applyStatus(result);
      const next = result ?? (await refresh());
      if (!active.current) return;
      setReviewNotice(msg(reviewMessages[action]));
      if (action === "reject") {
        const rejected = next?.changes.find(
          (item) => item.id === id && item.status === "rejected",
        );
        if (rejected) await inspect(pageId, rejected);
        return;
      }
      setTab("pages");
      await inspect(pageId);
    });
  }

  async function organize(retryChangeId?: string) {
    await run("正在整理", async () => {
      const next = await invoke<WikiStatus>("wiki_compile", { retryChangeId });
      if (!active.current) return;
      if (next) applyStatus(next);
      else await refresh();
      if (retryChangeId && active.current) {
        setPage(undefined);
        setChange(undefined);
        setBaseline(undefined);
      }
    });
  }

  async function openSource(index: number) {
    const reference = page?.refs[index];
    if (!page || !reference || busy) return;
    const request = latestPage.current;
    await run("正在核对来源", async () => {
      const source = await invoke<WikiRef>("wiki_source", {
        input: {
          pageId: page.id,
          revision: page.revision,
          changeId: change?.id ?? null,
          documentId: reference.documentId,
          startLine: reference.startLine,
          endLine: reference.endLine,
          hash: reference.hash,
        },
      });
      if (!active.current || request !== latestPage.current) return;
      if (!source?.path) throw Error("原文不可用");
      await onOpenSource({
        ...source,
        id: index,
        text: source.quote,
        heading: "",
        score: 0,
      });
    });
  }

  async function openCurrentDocument(id: string) {
    if (!page || !onOpenCurrentDocument || busy) return;
    const request = latestPage.current;
    await run("正在核对来源", async () => {
      const current = await invoke<WikiPage>("wiki_read", {
        pageId: page.id,
        changeId: change?.id ?? null,
      }).catch((reason) => {
        if (active.current && request === latestPage.current) {
          setPage(undefined);
          setBaseline(undefined);
        }
        throw reason;
      });
      if (!active.current || request !== latestPage.current) return;
      setPage(current);
      if (
        !current.historicalSources?.some(
          (source) => source.documentId === id && source.excerpt,
        )
      ) {
        throw Error("历史来源已更新或已移出范围，请刷新 Wiki。");
      }
      const result = await invoke<{ document: LibraryDocument } | null>(
        "library_answer_source",
        { documentId: id },
      );
      if (!active.current || request !== latestPage.current) return;
      if (
        !result ||
        result.document.projectId !== projectId ||
        result.document.id !== id ||
        result.document.status !== "ready"
      ) {
        throw Error("当前文档不可用。");
      }
      await onOpenCurrentDocument(result.document);
    });
  }
  const openHistoricalDocument = onOpenCurrentDocument
    ? openCurrentDocument
    : undefined;

  const job = status?.job;
  const isRunning = busy === "正在整理" || job?.status === "running";
  const pending =
    status?.changes
      .filter((item) => item.status === "pending")
      .sort(
        (a, b) =>
          reviewPriority(b) - reviewPriority(a) || b.created - a.created,
      ) ?? [];
  const pendingCount = status?.currentPendingCount ?? pending.length;
  const nextReview = pending.find((item) => item.id !== change?.id);
  const history =
    status?.changes.filter((item) => item.status !== "pending") ?? [];
  const selectedChange =
    change &&
    status?.changes.find(
      (item) => item.id === change.id && item.status === change.status,
    );
  const reviewing = tab === "changes" && !!selectedChange && !!page;
  const summaryIssues = page?.summaryIssues?.length
    ? page.summaryIssues
    : (selectedChange?.summaryIssues ?? []);
  const restoreIssues = selectedChange?.restoreSummaryIssues ?? [];
  const publishExcerpts = !!page?.stale || !!summaryIssues.length;
  const restoreExcerpts =
    selectedChange?.restoreAvailability === "excerpts" ||
    !!restoreIssues.length;
  const comparison = page?.reviewComparison;
  const currentRevision = Math.max(
    status?.pages.find((item) => item.id === page?.id)?.revision ?? 0,
    comparison?.currentRevision ?? 0,
    baseline?.revision ?? 0,
  );
  const baseOutdated =
    !!comparison && comparison.baseRevision !== currentRevision;
  const firstWiki = status && !status.pages.length;
  const scopeReady =
    status?.policy.enabled && !!status.policy.documentIds.length;
  const filter = search.trim().toLocaleLowerCase();
  const pages = (status?.pages ?? []).filter(
    (item) =>
      !filter ||
      `${item.title} ${item.summary}`.toLocaleLowerCase().includes(filter),
  );

  const coverageDetails = tab !== "pages" && !!status?.coverage?.length && (
    <details className="wiki-coverage">
      <summary>
        {msg("资料覆盖 ·")}{" "}
        {status.coverage.filter((item) => item.status === "included").length}/
        {status.coverage.length} {msg("份已引用")}
      </summary>
      <p>
        {msg("这里显示授权范围内各份资料的整理状态。请在候选正文中核对关键结论及其出处。")}
      </p>
      <ul>
        {status.coverage.map((item) => (
          <li key={item.documentId} data-status={item.status}>
            <strong>{item.title || msg("不可用资料")}</strong>
            <span>{msg(coverageLabels[item.status])}</span>
          </li>
        ))}
      </ul>
    </details>
  );

  function selectChange(item: WikiChange) {
    requestedReviewFocus.current = item.id;
    setTab("changes");
    void inspect(item.pageId, item);
  }
  return (
    <ModalDialog
      label={msg("知识 Wiki")}
      className="wiki-dialog"
      busy={!!busy && !isRunning}
      onClose={onClose}
    >
      <div className="modal-heading">
        <div>
          <h2>{msg("知识 Wiki")}</h2>
          {spaceTitle && <p className="wiki-space-name">{spaceTitle}</p>}
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label={msg("关闭知识 Wiki")}
          disabled={!!busy && !isRunning}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <nav className="wiki-toolbar wiki-nav" aria-label={msg("Wiki 页面导航")}>
        <button
          type="button"
          aria-pressed={tab === "pages"}
          disabled={!!busy && !isRunning}
          onClick={() => setTab("pages")}
        >
          {msg("主题")}
        </button>
        <button
          type="button"
          aria-pressed={tab === "changes"}
          disabled={!!busy && !isRunning}
          onClick={() => setTab("changes")}
        >
          {msg("审阅与变更")}{pendingCount ? ` · ${pendingCount}` : ""}
        </button>
        <button
          type="button"
          aria-pressed={tab === "policy"}
          disabled={!!busy && !isRunning}
          onClick={() => setTab("policy")}
        >
          {msg("资料范围")}
        </button>
        <span className="wiki-toolbar-divider" />
        {isRunning ? (
          <button
            type="button"
            onClick={() =>
              void invoke("wiki_cancel").catch((reason) =>
                setError(String(reason)),
              )
            }
          >
            {msg("取消整理")}
          </button>
        ) : (
          <button
            type="button"
            className={
              firstWiki && scopeReady && !pendingCount
                ? "primary"
                : "wiki-organize"
            }
            disabled={
              !!busy || dirty.current || !scopeReady || status?.policy.paused
            }
            onClick={() => void organize()}
          >
            {msg("整理所选资料")}
          </button>
        )}
        <button
          type="button"
          className="icon-button"
          aria-label={msg("刷新 Wiki")}
          title={msg("刷新 Wiki")}
          disabled={!!busy}
          onClick={() => void run("刷新中", () => refresh())}
        >
          <RefreshCw size={16} />
        </button>
      </nav>
      {!status && !error && <p role="status">{msg("正在读取 Wiki…")}</p>}
      {status && !reviewing && (
        <div className="wiki-overview">
          <span>
            {status.policy.enabled
              ? `已授权 ${status.policy.documentIds.length} 篇资料`
              : msg("尚未启用整理")}
          </span>
          {status.policy.enabled && status.policy.paused && (
            <span>{msg("整理已暂停")}</span>
          )}
          <span>{status.pages.length} {msg("个已发布主题")}</span>
          <strong className="wiki-pending-count" role="status">
            {msg("当前待审阅")} {pendingCount} {msg("项")}
          </strong>
        </div>
      )}
      {(busy || job?.status === "running") && (
        <p role="status">
          {busy || jobLabels.running}
          {job?.status === "running" && job.message && ` · ${job.message}`}
        </p>
      )}
      {!isRunning &&
        job &&
        job.status !== "idle" &&
        (!reviewing || job.status === "error") && (
          <details
            className="wiki-job-details"
            open={job.status === "error" || undefined}
          >
            <summary>
              {msg("上次整理")}<span>{(jobLabels[job.status] ? msg(jobLabels[job.status]) : job.status)}</span>
            </summary>
            {job.message && <p>{job.message}</p>}
          </details>
        )}
      {!isRunning && job?.status === "idle" && job.message && (
        <p className="muted" role="status">
          {job.message}
        </p>
      )}
      {reviewNotice && (
        <div className="wiki-review-notice">
          <p role="status">{reviewNotice}</p>
          {nextReview && (
            <button
              type="button"
              disabled={!!busy}
              onClick={() => {
                setReviewNotice("");
                selectChange(nextReview);
              }}
            >
              {msg("审阅下一项")}
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="panel-warning" role="alert">
          {error}
        </p>
      )}
      {tab === "pages" && (firstWiki || !!pending.length) && (
        <section className="wiki-next-step" aria-label={msg("整理与审阅进度")}>
          {pending.length ? (
            <>
              <p>
                {msg("有")} {pendingCount} {msg("项改动等待审阅，发布后可参与问答。")}
                {pending[0].stale && msg(" 部分原文已变化，请优先核对。")}
              </p>
              <button
                className="button small"
                type="button"
                disabled={!!busy}
                onClick={() => selectChange(pending[0])}
              >
                {msg("查看待审阅改动")}
              </button>
            </>
          ) : docs.length === 0 ? (
            <>
              <p>{msg("先复制导入一份资料，再选择可整理的文档。")}</p>
              <button
                className="button small"
                type="button"
                disabled={!!busy}
                onClick={onImport}
              >
                {msg("复制导入资料")}
              </button>
            </>
          ) : !scopeReady ? (
            <>
              <p>{msg("选择当前空间中允许整理的文档。")}</p>
              <button
                className="button small"
                type="button"
                disabled={!!busy}
                onClick={() => setTab("policy")}
              >
                {msg("选择整理范围")}
              </button>
            </>
          ) : (
            <p>
              {status?.policy.paused
                ? msg("可在「资料范围」中继续整理。")
                : msg("资料范围已保存。整理完成后，可核对候选正文和原文。")}
            </p>
          )}
        </section>
      )}
      {!reviewing && coverageDetails}
      {tab === "policy" && policy && (
        <div className="wiki-policy">
          <label>
            <input
              type="checkbox"
              checked={policy.enabled}
              disabled={!!busy}
              onChange={(e) => patch({ enabled: e.target.checked })}
            />
            {msg("启用当前空间的 Wiki")}
          </label>
          <label>
            {msg("关注主题")}
            <input
              maxLength={120}
              value={policy.topic}
              onChange={(e) => patch({ topic: e.target.value })}
              disabled={!!busy}
            />
          </label>
          <label>
            {msg("维护方式")}
            <select
              value={
                policy.paused ? "paused" : policy.automatic ? "auto" : "review"
              }
              disabled={!!busy}
              onChange={(e) =>
                patch({
                  paused: e.target.value === "paused",
                  ...(e.target.value !== "paused"
                    ? { automatic: e.target.value === "auto" }
                    : {}),
                })
              }
            >
              <option value="review">{msg("发布前全部审阅")}</option>
              <option value="auto">{msg("自动发布符合规则的常规变更")}</option>
              <option value="paused">{msg("暂停整理")}</option>
            </select>
          </label>
          <p className="muted">
            {msg("整理时会把所选资料提交给配置的聊天模型。已选")}{" "}
            {policy.documentIds.length} {msg("篇。")}
            {dirty.current && msg(" 请先保存更改再整理。")}
          </p>
          {!!docs.length && (
            <label>
              {msg("筛选资料")}
              <input
                type="search"
                value={documentFilter}
                onChange={(event) => setDocumentFilter(event.target.value)}
              />
            </label>
          )}
          <div className="wiki-document-list">
            {visibleDocuments.map((doc) => (
              <label key={doc.id}>
                <input
                  type="checkbox"
                  checked={policy.documentIds.includes(doc.id)}
                  disabled={
                    !!busy ||
                    (policy.documentIds.length >= 100 &&
                      !policy.documentIds.includes(doc.id))
                  }
                  onChange={(e) =>
                    patch({
                      documentIds: e.target.checked
                        ? [...policy.documentIds, doc.id]
                        : policy.documentIds.filter((id) => id !== doc.id),
                    })
                  }
                />
                {doc.title}
              </label>
            ))}
            {!docs.length && <small>{msg("请先在当前空间导入或新建文档。")}</small>}
            {!!docs.length && !visibleDocuments.length && (
              <small>{msg("没有匹配的资料。")}</small>
            )}
          </div>
          {removingDocuments && (
            <p className="panel-warning" role="status">
              {removalImpact
                ? `确认后将清除 ${removalImpact.pages} 个主题、${removalImpact.revisions} 个已发布版本及 ${removalImpact.pending} 个待审改动。相关变更历史也将清除。`
                : msg("移出资料会清除依赖它的 Wiki 内容。保存前可查看影响范围。")}
              {msg("原始文档会保留，可用剩余资料重新整理。")}
            </p>
          )}
          <div className="modal-actions">
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void run("刷新中", () => refresh(true))}
            >
              {msg("重新载入配置")}
            </button>
            <button
              type="button"
              className="primary"
              disabled={
                !!busy ||
                (policy.enabled &&
                  (!policy.topic.trim() || !policy.documentIds.length))
              }
              onClick={() => void save()}
            >
              {removingDocuments
                ? removalImpact
                  ? msg("确认保存并清除")
                  : msg("查看清除范围")
                : msg("保存范围与维护")}
            </button>
          </div>
        </div>
      )}
      {tab === "pages" && status && (
        <div className="wiki-columns">
          <div className="wiki-list">
            <h3 className="wiki-section-title">{msg("已发布主题")}</h3>
            <label>
              {msg("查找主题")}
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            {!pages.length && (
              <p>
                {filter ? msg("暂无匹配的主题。") : msg("当前空间还没有已发布主题。")}
              </p>
            )}
            {pages.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={
                  !change && (page?.id === item.id || readingId === item.id)
                }
                disabled={!!busy && !isRunning}
                onClick={() => void inspect(item.id)}
              >
                <strong>{item.title}</strong>
                <small>
                  {msg("版本")} {item.revision} · {item.sourceCount} {msg("处来源")}
                  {item.stale && msg(" · 出处待更新")}
                </small>
                {item.summary && <small>{item.summary}</small>}
              </button>
            ))}
          </div>
          {!change && page ? (
            <WikiPageView
              page={page}
              onOpenCurrent={openHistoricalDocument}
              onOpen={busy ? undefined : (index) => void openSource(index)}
              onRelated={busy ? undefined : (id) => void inspect(id)}
              onError={setError}
            />
          ) : readingId ? (
            <WikiReaderPlaceholder loading text={msg("从左侧选择一个主题")} />
          ) : (
            <div className="wiki-recent">
              <WikiChangeList
                label={msg("最近变化")}
                items={history
                  .filter((item) => item.status !== "superseded")
                  .slice(0, 5)}
                busy={!!busy && !isRunning}
                emptyText={msg("还没有整理记录。发布或拒绝改动后，可在这里查看。")}
                onSelect={selectChange}
              />
              {!!history.length && (
                <button
                  type="button"
                  className="wiki-all-changes"
                  disabled={!!busy && !isRunning}
                  onClick={() => setTab("changes")}
                >
                  {msg("查看全部变化")}
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {tab === "changes" && status && (
        <div className="wiki-columns">
          <div className="wiki-list">
            <WikiChangeList
              label={msg("待审阅")}
              items={pending}
              activeId={change?.id}
              busy={!!busy && !isRunning}
              onSelect={selectChange}
            />
            {!!history.length && (
              <WikiChangeList
                label={msg("变更历史")}
                items={history}
                activeId={change?.id}
                busy={!!busy && !isRunning}
                onSelect={selectChange}
              />
            )}
          </div>
          {selectedChange && page ? (
            <div className="wiki-review-detail">
              <div
                className="wiki-review-context"
                ref={reviewContext}
                tabIndex={-1}
                role="group"
                aria-label={`正在审阅 ${page.title}`}
              >
                <strong>{page.title}</strong>
                <span>
                  {selectedChange.status === "pending"
                    ? msg("待发布的候选版本")
                    : `${(changeLabels[selectedChange.status] ? msg(changeLabels[selectedChange.status]) : selectedChange.status)} · 版本 ${page.revision}`}
                </span>
                <p>{selectedChange.reason}</p>
              </div>
              {selectedChange.status === "pending" && comparison && (
                <WikiReviewChanges
                  comparison={comparison}
                  outdated={baseOutdated}
                  previousSummary={baseline?.summary}
                  nextSummary={page.summary}
                  compact={!!page.claimReviews?.length}
                />
              )}
              {selectedChange.status === "pending" &&
                comparison?.baseAvailable &&
                !baseOutdated &&
                baseline?.revision === comparison.baseRevision &&
                baseline &&
                !page.stale && (
                  <WikiChangedQuotes previous={baseline} current={page} />
                )}
              {selectedChange.status === "pending" &&
                !!summaryIssues.length && (
                  <WikiSummaryWarning
                    title={msg("摘要需要核对")}
                    issues={summaryIssues}
                    guidance={msg("可仅发布已核验的原文摘录。如需重新生成摘要，拒绝此改动后选择「重新整理已拒绝改动」。")}
                  />
                )}
              {selectedChange.canRestore && !!restoreIssues.length && (
                <WikiSummaryWarning
                  title={msg("可恢复版本的摘要需要核对")}
                  issues={restoreIssues}
                  guidance={msg("该版本只能恢复已核验的原文摘录。")}
                />
              )}
              {selectedChange.canRestore &&
                selectedChange.restoreRevision !== undefined && (
                  <p className="wiki-restore-note">
                    {msg("恢复会使用此次改动前的版本")} {selectedChange.restoreRevision}
                    。
                    {selectedChange.restoreAvailability === "excerpts" &&
                      msg(" 该版本只可恢复仍能核验的原文摘录。")}
                    {selectedChange.restoreAvailability === "unavailable" &&
                      msg(" 该版本已没有可核验的原文，无法恢复。")}
                  </p>
                )}
              {!baseOutdated && baseline && baseline.body !== page.body && (
                <details className="wiki-baseline">
                  <summary>{msg("对照当前生效版 · 版本")} {baseline.revision}</summary>
                  <Markdown
                    source={baseline.body}
                    path=""
                    readOnly
                    onError={setError}
                    label={msg("当前生效版正文")}
                  />
                  <WikiHistoricalSources sources={baseline.historicalSources} />
                </details>
              )}
              <WikiPageView
                page={page}
                onOpenCurrent={openHistoricalDocument}
                showQuotes={selectedChange.status === "pending"}
                previousClaims={
                  comparison?.baseAvailable && !baseOutdated && !baseline?.stale
                    ? baseline?.claimReviews
                    : undefined
                }
                history={selectedChange.status !== "pending"}
                onOpen={busy ? undefined : (index) => void openSource(index)}
                onError={setError}
              />
            </div>
          ) : (
            <WikiReaderPlaceholder
              loading={!!readingId}
              text={msg("选择一项改动以核对正文和原文")}
            />
          )}
        </div>
      )}
      {reviewing && coverageDetails}
      {tab === "changes" &&
        status &&
        selectedChange &&
        page &&
        (selectedChange.status === "rejected" ||
          selectedChange.status === "pending" ||
          selectedChange.canRestore) && (
          <div
            className="modal-actions wiki-review-actions"
            role="group"
            aria-label={msg("Wiki 审阅操作")}
          >
            {selectedChange.status === "rejected" && (
              <button
                type="button"
                disabled={
                  !!busy || !status.policy.enabled || status.policy.paused
                }
                onClick={() => void organize(selectedChange.id)}
              >
                {msg("重新整理已拒绝改动")}
              </button>
            )}
            {selectedChange.status === "pending" && (
              <>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => void review("reject")}
                >
                  {msg("拒绝改动")}
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={
                    !!busy ||
                    !status.policy.enabled ||
                    status.policy.paused ||
                    baseOutdated ||
                    (publishExcerpts && !page.refs.length) ||
                    comparison?.baseAvailable === false
                  }
                  onClick={() =>
                    void review(
                      publishExcerpts ? "publish-excerpts" : "publish",
                    )
                  }
                >
                  {publishExcerpts ? msg("仅发布原文摘录") : msg("发布改动")}
                </button>
              </>
            )}
            {selectedChange.canRestore && (
              <button
                type="button"
                disabled={
                  !!busy ||
                  !status.policy.enabled ||
                  status.policy.paused ||
                  selectedChange.restoreAvailability === "unavailable"
                }
                onClick={() =>
                  void review(restoreExcerpts ? "restore-excerpts" : "restore")
                }
              >
                {restoreExcerpts ? msg("仅恢复原文摘录") : msg("恢复改动前版本")}
              </button>
            )}
          </div>
        )}
    </ModalDialog>
  );
}

function WikiReviewChanges({
  comparison,
  outdated,
  previousSummary,
  nextSummary,
  compact,
}: {
  comparison: WikiReviewComparison;
  outdated: boolean;
  previousSummary?: string;
  nextSummary: string;
  compact: boolean;
}) {
  const {
    baseRevision,
    baseAvailable,
    summaryChanged,
    outlineChanged,
    sources,
  } = comparison;
  return (
    <section className="wiki-review-changes" aria-label={msg("改动对照")}>
      <header>
        <h3>{msg("改动对照")}</h3>
        <span>
          {baseRevision ? `生成基准 · 版本 ${baseRevision}` : msg("新建主题")}
        </span>
      </header>
      {outdated && (
        <p className="panel-warning">
          {msg("生效版本已变化。可拒绝此项，再重新整理。")}
        </p>
      )}
      {!baseAvailable ? (
        <p className="panel-warning">
          {msg("无法读取生成基准。可拒绝此项，再重新整理。")}
        </p>
      ) : (
        <>
          {(summaryChanged || outlineChanged) && (
            <p>
              {[
                summaryChanged && "摘要有变化",
                outlineChanged && "主题结构有变化",
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
          {summaryChanged && !outdated && !compact && (
            <dl className="wiki-conclusion-diff">
              {!!baseRevision && (
                <div>
                  <dt>{msg("生效版摘要")}</dt>
                  <dd>{previousSummary || msg("当前没有可展示的生效摘要。")}</dd>
                </div>
              )}
              <div>
                <dt>{msg("候选摘要")}</dt>
                <dd>{nextSummary || msg("当前没有可展示的候选摘要。")}</dd>
              </div>
            </dl>
          )}
          {!!sources.length && (
            <ul aria-label={msg("引用资料变化")}>
              {sources.map((source, index) => (
                <li key={index}>
                  <span>{msg(sourceChangeLabels[source.status])}</span>
                  <strong>{source.title}</strong>
                </li>
              ))}
            </ul>
          )}
          {!sources.length && <p>{msg("引用资料无变化")}</p>}
        </>
      )}
    </section>
  );
}

function WikiChangedQuotes({
  previous,
  current,
}: {
  previous: WikiPage;
  current: WikiPage;
}) {
  // Historical line numbers belong to the old revision. The backend only includes
  // historical excerpts when the document is still authorized and readable.
  const before = [
    ...previous.refs,
    ...(previous.historicalSources ?? []).flatMap((ref) =>
      ref.excerpt ? [{ ...ref, quote: ref.excerpt }] : [],
    ),
  ];
  const ids = [...new Set(current.refs.map((ref) => ref.documentId))];
  const groups = ids.flatMap((id) => {
    const old = before.filter((ref) => ref.documentId === id);
    const next = current.refs.filter((ref) => ref.documentId === id);
    const removed = old.filter(
      (ref) => !next.some((row) => row.quote === ref.quote),
    );
    const added = next.filter(
      (ref) => !old.some((row) => row.quote === ref.quote),
    );
    return removed.length && added.length
      ? [{ id, title: next[0].title, removed, added }]
      : [];
  });
  if (!groups.length) return null;
  return (
    <section aria-label={msg("原文摘录变化")} className="wiki-review-changes">
      <h3>{msg("原文摘录变化")}</h3>
      {groups.map(({ id, title, removed, added }) => (
        <div key={id}>
          <strong>{title}</strong>
          <dl className="wiki-conclusion-diff">
            {[
              { label: "上版引用", refs: removed },
              { label: "本次引用", refs: added },
            ].map(({ label, refs }) => (
              <div key={label}>
                <dt>{label}</dt>
                {refs.map((ref, i) => (
                  <dd key={i}>
                    {sourceLines(ref)} · {ref.quote}
                  </dd>
                ))}
              </div>
            ))}
          </dl>
        </div>
      ))}
    </section>
  );
}

function WikiChangeList({
  label,
  items,
  activeId,
  busy,
  onSelect,
  emptyText = msg("当前没有待审阅的改动。"),
}: {
  label: string;
  items: WikiChange[];
  activeId?: string;
  busy: boolean;
  onSelect: (item: WikiChange) => void;
  emptyText?: string;
}) {
  return (
    <section className="wiki-change-list" aria-label={label}>
      <h3>{label}</h3>
      {!items.length && <p>{emptyText}</p>}
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-pressed={activeId === item.id}
          disabled={busy}
          onClick={() => onSelect(item)}
        >
          <strong>{item.title}</strong>
          <small>
            {(changeLabels[item.status] ? msg(changeLabels[item.status]) : item.status)} · {item.sourceCount}{" "}
            {msg("处来源")}
            {item.created > 0 &&
              ` · ${changeDate.format(item.created * 1_000)}`}
          </small>
          <small>
            {item.stale && item.status === "pending" && (
              <span className="wiki-attention">{msg("出处已变 ·")} </span>
            )}
            {!!item.summaryIssues?.length && item.status === "pending" && (
              <span className="wiki-attention">
                {item.summaryIssues.some(({ reason }) => reason === "conflict")
                  ? msg("结论与引用不一致 · ")
                  : msg("部分结论缺少出处 · ")}
              </span>
            )}
            {item.reason}
          </small>
        </button>
      ))}
    </section>
  );
}

function WikiReaderPlaceholder({
  loading,
  text,
}: {
  loading: boolean;
  text: string;
}) {
  return (
    <div className="wiki-reader-placeholder">
      <BookOpen size={24} aria-hidden="true" />
      {loading ? <p role="status">{msg("正在读取正文…")}</p> : <p>{text}</p>}
    </div>
  );
}

function WikiSummaryWarning({
  title,
  issues,
  guidance,
}: {
  title: string;
  issues: SummaryIssue[];
  guidance: string;
}) {
  return (
    <section className="wiki-summary-warning" aria-label={title}>
      <h3>{title}</h3>
      <ul>
        {issues.map(({ claim, reason }, index) => (
          <li key={index}>
            <strong>
              {reason === "conflict" ? msg("与已引用原文不一致") : msg("缺少对应引文")}
            </strong>{" "}
            {claim}
          </li>
        ))}
      </ul>
      <p>{guidance}</p>
    </section>
  );
}

function WikiPageView({
  page,
  onOpen,
  onRelated,
  onOpenCurrent,
  onError,
  previousClaims,
  showQuotes = false,
  history = false,
}: {
  page: WikiPage;
  onOpen?: (index: number) => void;
  onOpenCurrent?: (id: string) => void;
  onRelated?: (id: string) => void;
  onError: (message: string) => void;
  previousClaims?: ClaimReview[];
  showQuotes?: boolean;
  history?: boolean;
}) {
  const hasClaims = !!page.claimReviews?.length;
  const body = (
    <Markdown
      source={page.body}
      path=""
      readOnly
      onError={onError}
      label={msg("Wiki 正文")}
    />
  );
  return (
    <article
      className={`wiki-page ${showQuotes && !hasClaims ? "wiki-page-review" : ""}`}
    >
      <div className="wiki-page-body">
        {!showQuotes && <h3>{page.title}</h3>}
        {page.stale && (
          <p className="panel-warning">
            {history
              ? msg("此版的部分资料已经变化，下方仅展示仍可核验的原文。")
              : msg("部分所用资料已经变化，当前版本暂停参与问答。重新整理后可更新结论。")}
          </p>
        )}
        {!showQuotes && !!page.summaryIssues?.length && (
          <p className="panel-warning">
            {msg("此版本的摘要缺少可核验的原文，暂只显示已核验的摘录。")}
          </p>
        )}
        {hasClaims ? (
          <>
            <WikiClaimEvidence
              claims={page.claimReviews!}
              sources={page.refs}
              previousClaims={previousClaims}
              onOpen={onOpen}
            />
            <details className="wiki-full-page">
              <summary>{msg("完整主题正文")}</summary>
              {body}
            </details>
          </>
        ) : (
          body
        )}
        {onRelated && !!page.related?.length && (
          <div className="wiki-toolbar">
            {page.related.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => onRelated(item.id)}
              >
                {item.title}
              </button>
            ))}
          </div>
        )}
      </div>
      <details
        className="wiki-evidence"
        open={(showQuotes && !hasClaims) || undefined}
      >
        <summary>{msg("原文位置 ·")} {page.refs.length}</summary>
        {!page.refs.length && <p>{msg("此版本暂无可打开的原文。")}</p>}
        <ul className="wiki-citation-list">
          {page.refs.map((source, index) => (
            <li key={`${source.documentId}-${index}`}>
              <WikiSourceLink
                source={source}
                onOpen={onOpen && (() => onOpen(index))}
              />
              {showQuotes && <blockquote>{source.quote}</blockquote>}
            </li>
          ))}
        </ul>
      </details>
      <WikiHistoricalSources
        sources={page.historicalSources}
        disabled={!onOpen}
        onOpenCurrent={onOpenCurrent}
      />
    </article>
  );
}

function WikiHistoricalSources({
  sources,
  onOpenCurrent,
  disabled,
}: {
  sources: WikiPage["historicalSources"];
  disabled?: boolean;
  onOpenCurrent?: (id: string) => void;
}) {
  if (!sources?.length) return null;
  return (
    <details className="wiki-historical-sources">
      <summary>{msg("已变化或不可用的出处 ·")} {sources.length}</summary>
      <p>{msg("下列位置记录于整理当时，仅供追溯。")}</p>
      <ul className="wiki-citation-list">
        {sources.map((source, index) => (
          <li key={`${source.documentId}-${index}`}>
            <div className="wiki-historical-label">
              <strong>{source.title}</strong>
              <small>
                {source.excerpt
                  ? `历史摘录 · ${sourceLines(source)}`
                  : msg("原文当前不可用")}
              </small>
            </div>
            {source.excerpt && (
              <>
                <blockquote>{source.excerpt}</blockquote>
                {onOpenCurrent && (
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label={`打开当前文档 ${source.title}`}
                    onClick={() => onOpenCurrent(source.documentId)}
                  >
                    {msg("打开当前文档")} <ExternalLink size={14} aria-hidden="true" />
                  </button>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
