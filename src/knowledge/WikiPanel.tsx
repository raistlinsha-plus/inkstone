import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
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
}
interface WikiStatus {
  policy: WikiPolicy;
  pages: WikiSummary[];
  changes: WikiChange[];
  job: { status: string; message: string };
}
const jobLabels: Record<string, string> = {
  idle: "暂无任务",
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

export default function WikiPanel({
  projectId,
  workspaceRoot,
  view,
  onClose,
  onOpenSource,
}: {
  projectId: string;
  workspaceRoot: string;
  view: LibraryView;
  onClose: () => void;
  onOpenSource: (source: SearchResult) => void;
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
  const latestPage = useRef(0);
  const dirty = useRef(false);
  const docs = view.documents.filter(
    (doc) => doc.projectId === projectId && doc.status === "ready",
  );
  const active = useRef(true);
  const refresh = useCallback(async (resetPolicy = false) => {
    const next = await invoke<WikiStatus>("wiki_status");
    if (!active.current || !next) return;
    setStatus(next);
    if (!dirty.current || resetPolicy) {
      setPolicy(next.policy);
      dirty.current = false;
    }
  }, []);

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

  async function run(label: string, task: () => Promise<void>) {
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
      await invoke("wiki_set_policy", {
        input: { expectedRevision, ...settings },
      });
      await refresh(true);
      setTab("pages");
    });
  }

  async function inspect(pageId: string, proposal?: WikiChange) {
    const request = ++latestPage.current;
    setPage(undefined);
    setBaseline(undefined);
    setChange(proposal);
    setError("");
    try {
      const data = await invoke<WikiPage>("wiki_read", {
        pageId,
        changeId: proposal?.id ?? null,
      });
      if (active.current && request === latestPage.current) setPage(data);
      if (proposal?.status === "pending") {
        const previous = await invoke<WikiPage>("wiki_read", { pageId }).catch(
          () => undefined,
        );
        if (active.current && request === latestPage.current)
          setBaseline(previous);
      }
    } catch (reason) {
      if (active.current && request === latestPage.current)
        setError(String(reason));
    }
  }

  async function review(action: "publish" | "reject" | "restore") {
    if (!change) return;
    await run("正在处理改动", async () => {
      await invoke("wiki_review", { input: { id: change.id, action } });
      setChange(undefined);
      setPage(undefined);
      await refresh();
    });
  }

  async function organize(retryChangeId?: string) {
    await run("正在整理", async () => {
      const next = await invoke<WikiStatus>("wiki_compile", { retryChangeId });
      if (next && active.current) setStatus(next);
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
    if (!page || !reference) return;
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
      if (!source?.path) throw Error("原文不可用");
      onOpenSource({
        ...source,
        id: index,
        text: source.quote,
        heading: "",
        score: 0,
      });
    });
  }

  const isRunning = busy === "正在整理" || status?.job?.status === "running";
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
          <span className="eyebrow">SPACE WIKI</span>
          <h2>知识 Wiki</h2>
        </div>
        <button type="button" disabled={!!busy && !isRunning} onClick={onClose}>
          关闭
        </button>
      </div>
      <p className="muted">
        系统按授权范围整理主题、关系和原文位置。只有已生效且可核验的版本参与问答。
      </p>
      <div className="wiki-toolbar">
        <button
          type="button"
          aria-pressed={tab === "pages"}
          onClick={() => setTab("pages")}
        >
          页面
        </button>
        <button
          type="button"
          aria-pressed={tab === "changes"}
          onClick={() => setTab("changes")}
        >
          最近变更
        </button>
        <button
          type="button"
          aria-pressed={tab === "policy"}
          onClick={() => setTab("policy")}
        >
          范围与维护
        </button>
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
            className="primary"
            disabled={
              !!busy ||
              !status?.policy.enabled ||
              status.policy.paused ||
              !status.policy.documentIds.length
            }
            onClick={() => void organize()}
          >
            整理所选资料
          </button>
        )}
        <button
          type="button"
          disabled={!!busy}
          onClick={() => void run("刷新中", () => refresh())}
        >
          刷新
        </button>
      </div>
      {!status && !error && <p role="status">正在读取 Wiki…</p>}
      {(status || busy) && (
        <p role="status">
          {busy ||
            jobLabels[status?.job?.status ?? "idle"] ||
            status?.job?.status}
          {status?.job?.message && ` · ${status.job.message}`}
        </p>
      )}
      {error && (
        <p className="panel-warning" role="alert">
          {error}
        </p>
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
          </p>
          <div className="wiki-document-list">
            {docs.map((doc) => (
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
          </div>
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
              保存范围与维护
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
                {filter
                  ? "暂无匹配的主题。"
                  : "当前空间暂无已生效页面。请先选择资料范围并整理。"}
              </p>
            )}
            {pages.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={!change && page?.id === item.id}
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
          {!change && page && (
            <WikiPageView
              page={page}
              onOpen={(index) => void openSource(index)}
              onRelated={(id) => void inspect(id)}
              onError={setError}
            />
          )}
        </div>
      )}
      {tab === "changes" && status && (
        <div className="wiki-columns">
          <div className="wiki-list">
            {!status.changes.length && <p>暂无整理改动。</p>}
            {status.changes.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={change?.id === item.id}
                onClick={() => void inspect(item.pageId, item)}
              >
                <strong>{item.title}</strong>
                <small>
                  {changeLabels[item.status] ?? item.status} ·{" "}
                  {item.sourceCount} 处来源
                </small>
                <small>{item.reason}</small>
              </button>
            ))}
          </div>
          {change && page && (
            <div>
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
                onOpen={(index) => void openSource(index)}
                onError={setError}
              />
              <div className="modal-actions">
                {change.status === "rejected" && (
                  <button
                    type="button"
                    disabled={
                      !!busy || !status.policy.enabled || status.policy.paused
                    }
                    onClick={() => void organize(change.id)}
                  >
                    重新整理已拒绝改动
                  </button>
                )}
                {change.status === "pending" && (
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
                      disabled={!!busy}
                      onClick={() => void review("publish")}
                    >
                      发布改动
                    </button>
                  </>
                )}
                {change.canRestore && (
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => void review("restore")}
                  >
                    恢复此版本
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </ModalDialog>
  );
}
function WikiPageView({
  page,
  onOpen,
  onRelated,
  onError,
}: {
  page: WikiPage;
  onOpen?: (index: number) => void;
  onRelated?: (id: string) => void;
  onError: (message: string) => void;
}) {
  return (
    <article className="wiki-page">
      <h3>{page.title}</h3>
      {page.stale && (
        <p className="panel-warning">至少一处原文已变更，需重新整理。</p>
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
      <details className="assistant-evidence">
        <summary>原文位置 · {page.refs.length}</summary>
        {page.refs.map((source, index) => (
          <button
            type="button"
            key={`${source.documentId}-${index}`}
            disabled={!onOpen || page.stale}
            onClick={() => onOpen?.(index)}
          >
            {source.title} · 第 {source.startLine}–{source.endLine} 行
          </button>
        ))}
      </details>
    </article>
  );
}
