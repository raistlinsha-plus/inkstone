import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, ExternalLink, RefreshCw, X } from "lucide-react";
import type { LibraryView } from "../library";
import type { SearchResult } from "../types";
import ModalDialog from "../ModalDialog";
import Markdown from "../preview/Markdown";

interface WikiPolicy {
  revision: number;
  enabled: boolean;
  paused: boolean;
  automatic: boolean;
  topic: string;
  documentIds: string[];
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
  sourceCount: number;
  summaryIssues?: SummaryIssue[];
  restoreSummaryIssues?: SummaryIssue[];
}
interface SummaryIssue {
  claim: string;
  reason: "missing" | "conflict";
}
interface WikiRef {
  documentId: string;
  title: string;
  path: string;
  startLine: number;
  endLine: number;
  quote: string;
  hash: string;
}
interface WikiPage extends WikiSummary {
  body: string;
  refs: WikiRef[];
  related?: { id: string; title: string }[];
  summaryIssues?: SummaryIssue[];
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
};
const jobLabels: Record<string, string> = {
  running: "整理中",
  ready: "整理完成",
  error: "整理失败",
  cancelled: "已取消",
};
const changeLabels: Record<string, string> = {
  pending: "待审阅",
  published: "已生效",
  rejected: "已拒绝",
};
const reviewMessages: Record<ReviewAction, string> = {
  publish: "改动已发布，可在主题中查看生效版本。",
  "publish-excerpts": "已发布核验过的原文摘录。",
  reject: "改动已拒绝，可重新整理。",
  restore: "历史版本已恢复，可在主题中查看。",
  "restore-excerpts": "已恢复核验过的原文摘录。",
};

export default function WikiPanel({
  projectId,
  workspaceRoot,
  view,
  onClose,
  onImport,
  onOpenSource,
}: {
  projectId: string;
  workspaceRoot: string;
  view: LibraryView;
  onClose: () => void;
  onImport: () => void;
  onOpenSource: (source: SearchResult) => void | Promise<void>;
}) {
  const [status, setStatus] = useState<WikiStatus>();
  const [policy, setPolicy] = useState<WikiPolicy>();
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
          (item) => item.id === change.id && item.status === change.status,
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
        item?.refs.some(
          (source) =>
            !view.documents.some(
              (doc) => doc.id === source.documentId && doc.status !== "purging",
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
    setPolicy((old) => old && { ...old, ...value });
  }

  async function save() {
    if (!policy) return;
    const { revision: expectedRevision, ...settings } = policy;
    await run("保存中", async () => {
      const next = await invoke<WikiStatus>("wiki_set_policy", {
        input: { expectedRevision, ...settings },
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
      if (proposal?.status === "pending") {
        const previous = await invoke<WikiPage>("wiki_read", { pageId }).catch(
          () => undefined,
        );
        if (active.current && request === latestPage.current)
          setBaseline(previous);
      }
    } catch (reason) {
      if (active.current && request === latestPage.current) {
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
      setReviewNotice(reviewMessages[action]);
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

  const job = status?.job;
  const isRunning = busy === "正在整理" || job?.status === "running";
  const pending =
    status?.changes.filter((item) => item.status === "pending") ?? [];
  const pendingCount = status?.currentPendingCount ?? pending.length;
  const history =
    status?.changes.filter((item) => item.status !== "pending") ?? [];
  const selectedChange =
    change &&
    status?.changes.find(
      (item) => item.id === change.id && item.status === change.status,
    );
  const summaryIssues = selectedChange?.summaryIssues ?? [];
  const restoreIssues = selectedChange?.restoreSummaryIssues ?? [];
  const firstWiki = status && !status.pages.length;
  const scopeReady =
    status?.policy.enabled && !!status.policy.documentIds.length;
  const filter = search.trim().toLocaleLowerCase();
  const pages = (status?.pages ?? []).filter(
    (item) =>
      !filter ||
      `${item.title} ${item.summary}`.toLocaleLowerCase().includes(filter),
  );
  return (
    <ModalDialog
      label="知识 Wiki"
      className="wiki-dialog"
      busy={!!busy && !isRunning}
      onClose={onClose}
    >
      <div className="modal-heading">
        <div>
          <h2>知识 Wiki</h2>
          {spaceTitle && <p className="wiki-space-name">{spaceTitle}</p>}
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="关闭知识 Wiki"
          disabled={!!busy && !isRunning}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <nav className="wiki-toolbar wiki-nav" aria-label="Wiki 页面导航">
        <button
          type="button"
          aria-pressed={tab === "pages"}
          disabled={!!busy && !isRunning}
          onClick={() => setTab("pages")}
        >
          主题
        </button>
        <button
          type="button"
          aria-pressed={tab === "changes"}
          disabled={!!busy && !isRunning}
          onClick={() => setTab("changes")}
        >
          审阅与变更{pendingCount ? ` · ${pendingCount}` : ""}
        </button>
        <button
          type="button"
          aria-pressed={tab === "policy"}
          disabled={!!busy && !isRunning}
          onClick={() => setTab("policy")}
        >
          资料范围
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
            取消整理
          </button>
        ) : (
          <button
            type="button"
            className={tab === "changes" ? "wiki-organize" : "primary"}
            disabled={
              !!busy || dirty.current || !scopeReady || status?.policy.paused
            }
            onClick={() => void organize()}
          >
            整理所选资料
          </button>
        )}
        <button
          type="button"
          className="icon-button"
          aria-label="刷新 Wiki"
          title="刷新 Wiki"
          disabled={!!busy}
          onClick={() => void run("刷新中", () => refresh())}
        >
          <RefreshCw size={16} />
        </button>
      </nav>
      {!status && !error && <p role="status">正在读取 Wiki…</p>}
      {status && (
        <div className="wiki-overview">
          <span>
            {status.policy.enabled
              ? `已授权 ${status.policy.documentIds.length} 篇资料`
              : "尚未启用整理"}
          </span>
          {status.policy.enabled && status.policy.paused && (
            <span>整理已暂停</span>
          )}
          <span>{status.pages.length} 个已生效主题</span>
          <strong className="wiki-pending-count" role="status">
            当前待审阅 {pendingCount} 项
          </strong>
        </div>
      )}
      {(busy || job?.status === "running") && (
        <p role="status">
          {busy || jobLabels.running}
          {job?.status === "running" && job.message && ` · ${job.message}`}
        </p>
      )}
      {!isRunning && job && job.status !== "idle" && (
        <details
          className="wiki-job-details"
          open={job.status === "error" || undefined}
        >
          <summary>
            上次整理<span>{jobLabels[job.status] ?? job.status}</span>
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
        <p className="wiki-review-notice" role="status">
          {reviewNotice}
        </p>
      )}
      {error && (
        <p className="panel-warning" role="alert">
          {error}
        </p>
      )}
      {tab === "pages" && (firstWiki || !!pending.length) && (
        <section className="wiki-next-step" aria-label="整理与审阅进度">
          {pending.length ? (
            <>
              <p>待审阅的改动需要发布后，才能参与问答。</p>
              <button
                className="button small"
                type="button"
                disabled={!!busy}
                onClick={() => {
                  setTab("changes");
                  void inspect(pending[0].pageId, pending[0]);
                }}
              >
                查看待审阅改动
              </button>
            </>
          ) : docs.length === 0 ? (
            <>
              <p>先复制导入一份资料，再选择可整理的文档。</p>
              <button
                className="button small"
                type="button"
                disabled={!!busy}
                onClick={onImport}
              >
                复制导入资料
              </button>
            </>
          ) : !scopeReady ? (
            <>
              <p>选择当前空间中允许整理的文档。</p>
              <button
                className="button small"
                type="button"
                disabled={!!busy}
                onClick={() => setTab("policy")}
              >
                选择整理范围
              </button>
            </>
          ) : (
            <p>
              {status?.policy.paused
                ? "可在「资料范围」中继续整理。"
                : "资料范围已保存。整理完成后，可核对候选正文和原文。"}
            </p>
          )}
        </section>
      )}
      {!!status?.coverage?.length && (
        <details className="wiki-coverage">
          <summary>
            资料覆盖 ·{" "}
            {
              status.coverage.filter((item) => item.status === "included")
                .length
            }
            /{status.coverage.length} 份已引用
          </summary>
          <p>
            这里显示授权范围内各份资料的整理状态。请在候选正文中核对关键结论及其出处。
          </p>
          <ul>
            {status.coverage.map((item) => (
              <li key={item.documentId} data-status={item.status}>
                <strong>{item.title || "不可用资料"}</strong>
                <span>{coverageLabels[item.status]}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {tab === "policy" && policy && (
        <div className="wiki-policy">
          <label>
            <input
              type="checkbox"
              checked={policy.enabled}
              disabled={!!busy}
              onChange={(e) => patch({ enabled: e.target.checked })}
            />
            启用当前空间的 Wiki
          </label>
          <label>
            关注主题
            <input
              maxLength={120}
              value={policy.topic}
              onChange={(e) => patch({ topic: e.target.value })}
              disabled={!!busy}
            />
          </label>
          <label>
            维护方式
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
              <option value="review">发布前全部审阅</option>
              <option value="auto">自动发布符合规则的常规变更</option>
              <option value="paused">暂停整理</option>
            </select>
          </label>
          <p className="muted">
            整理时会把所选资料提交给配置的聊天模型。已选{" "}
            {policy.documentIds.length} 篇。
            {dirty.current && " 请先保存更改再整理。"}
          </p>
          {!!docs.length && (
            <label>
              筛选资料
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
            {!docs.length && <small>请先在当前空间导入或新建文档。</small>}
            {!!docs.length && !visibleDocuments.length && (
              <small>没有匹配的资料。</small>
            )}
          </div>
          {removingDocuments && (
            <p className="panel-warning" role="status">
              保存后，依赖已移除资料的 Wiki
              页面、历史和待审阅改动将被永久清除。原始文档会保留，可用剩余资料重新整理。
            </p>
          )}
          <div className="modal-actions">
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void run("刷新中", () => refresh(true))}
            >
              重新载入配置
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
              {removingDocuments ? "保存并清除受影响的 Wiki" : "保存范围与维护"}
            </button>
          </div>
        </div>
      )}
      {tab === "pages" && status && (
        <div className="wiki-columns">
          <div className="wiki-list">
            <label>
              查找主题
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            {!pages.length && (
              <p>
                {filter ? "暂无匹配的主题。" : "当前空间还没有已生效主题。"}
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
                  版本 {item.revision} · {item.sourceCount} 处来源
                  {item.stale && " · 来源已更新"}
                </small>
                {item.summary && <small>{item.summary}</small>}
              </button>
            ))}
          </div>
          {!change && page ? (
            <WikiPageView
              page={page}
              onOpen={busy ? undefined : (index) => void openSource(index)}
              onRelated={busy ? undefined : (id) => void inspect(id)}
              onError={setError}
            />
          ) : (
            <WikiReaderPlaceholder
              loading={!!readingId}
              text="从左侧选择一个主题"
            />
          )}
        </div>
      )}
      {tab === "changes" && status && (
        <div className="wiki-columns">
          <div className="wiki-list">
            <WikiChangeList
              label="待审阅"
              items={pending}
              activeId={change?.id}
              busy={!!busy && !isRunning}
              onSelect={(item) => void inspect(item.pageId, item)}
            />
            {!!history.length && (
              <WikiChangeList
                label="变更历史"
                items={history}
                activeId={change?.id}
                busy={!!busy && !isRunning}
                onSelect={(item) => void inspect(item.pageId, item)}
              />
            )}
          </div>
          {selectedChange && page ? (
            <div className="wiki-review-detail">
              <div className="wiki-review-context">
                <strong>
                  {changeLabels[selectedChange.status] ?? selectedChange.status}
                </strong>
                <span>
                  {selectedChange.status === "pending"
                    ? "候选版本 · 发布后生效"
                    : selectedChange.reason}
                </span>
              </div>
              {selectedChange.status === "pending" &&
                !!summaryIssues.length && (
                  <WikiSummaryWarning
                    title="摘要需要核对"
                    issues={summaryIssues}
                    guidance="可仅发布已核验的原文摘录。如需重新生成摘要，拒绝此改动后选择「重新整理已拒绝改动」。"
                  />
                )}
              {selectedChange.canRestore && !!restoreIssues.length && (
                <WikiSummaryWarning
                  title="可恢复版本的摘要需要核对"
                  issues={restoreIssues}
                  guidance="该版本只能恢复已核验的原文摘录。"
                />
              )}
              {baseline && baseline.body !== page.body && (
                <details className="wiki-baseline">
                  <summary>对照当前生效版 · 版本 {baseline.revision}</summary>
                  <Markdown
                    source={baseline.body}
                    path=""
                    readOnly
                    onError={setError}
                    label="当前生效版正文"
                  />
                </details>
              )}
              <WikiPageView
                page={page}
                showQuotes={selectedChange.status === "pending"}
                onOpen={busy ? undefined : (index) => void openSource(index)}
                onError={setError}
              />
            </div>
          ) : (
            <WikiReaderPlaceholder
              loading={!!readingId}
              text="选择一项改动以核对正文和原文"
            />
          )}
        </div>
      )}
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
            aria-label="Wiki 审阅操作"
          >
            {selectedChange.status === "rejected" && (
              <button
                type="button"
                disabled={
                  !!busy || !status.policy.enabled || status.policy.paused
                }
                onClick={() => void organize(selectedChange.id)}
              >
                重新整理已拒绝改动
              </button>
            )}
            {selectedChange.status === "pending" && (
              <>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => void review("reject")}
                >
                  拒绝改动
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={
                    !!busy || !status.policy.enabled || status.policy.paused
                  }
                  onClick={() =>
                    void review(
                      summaryIssues.length ? "publish-excerpts" : "publish",
                    )
                  }
                >
                  {summaryIssues.length ? "仅发布原文摘录" : "发布改动"}
                </button>
              </>
            )}
            {selectedChange.canRestore && (
              <button
                type="button"
                disabled={
                  !!busy || !status.policy.enabled || status.policy.paused
                }
                onClick={() =>
                  void review(
                    restoreIssues.length ? "restore-excerpts" : "restore",
                  )
                }
              >
                {restoreIssues.length ? "仅恢复原文摘录" : "恢复此版本"}
              </button>
            )}
          </div>
        )}
    </ModalDialog>
  );
}

function WikiChangeList({
  label,
  items,
  activeId,
  busy,
  onSelect,
}: {
  label: string;
  items: WikiChange[];
  activeId?: string;
  busy: boolean;
  onSelect: (item: WikiChange) => void;
}) {
  return (
    <section className="wiki-change-list" aria-label={label}>
      <h3>{label}</h3>
      {!items.length && <p>当前没有待审阅的改动。</p>}
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
            {changeLabels[item.status] ?? item.status} · {item.sourceCount}{" "}
            处来源
          </small>
          <small>{item.reason}</small>
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
      {loading ? <p role="status">正在读取正文…</p> : <p>{text}</p>}
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
              {reason === "conflict" ? "与已引用原文不一致" : "缺少对应引文"}
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
  onError,
  showQuotes = false,
}: {
  page: WikiPage;
  onOpen?: (index: number) => void;
  onRelated?: (id: string) => void;
  onError: (message: string) => void;
  showQuotes?: boolean;
}) {
  return (
    <article className={`wiki-page ${showQuotes ? "wiki-page-review" : ""}`}>
      <div className="wiki-page-body">
        <h3>{page.title}</h3>
        {page.stale && (
          <p className="panel-warning">
            部分原文或主题信息已过时，请重新整理。
          </p>
        )}
        {!showQuotes && !!page.summaryIssues?.length && (
          <p className="panel-warning">
            此版本的摘要缺少可核验的原文，暂只显示已核验的摘录。
          </p>
        )}
        <Markdown
          source={page.body}
          path=""
          readOnly
          onError={onError}
          label="Wiki 正文"
        />
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
      <details className="wiki-evidence" open={showQuotes || undefined}>
        <summary>原文位置 · {page.refs.length}</summary>
        {!page.refs.length && <p>此版本暂无可打开的原文。</p>}
        <ul className="wiki-citation-list">
          {page.refs.map((source, index) => (
            <li key={`${source.documentId}-${index}`}>
              <button
                type="button"
                disabled={!onOpen}
                onClick={() => onOpen?.(index)}
              >
                <span>
                  <strong>{source.title}</strong>
                  <small>
                    {source.startLine === source.endLine
                      ? `第 ${source.startLine} 行`
                      : `第 ${source.startLine}–${source.endLine} 行`}
                  </small>
                </span>
                <ExternalLink size={14} aria-hidden="true" />
              </button>
              {showQuotes && <blockquote>{source.quote}</blockquote>}
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}
