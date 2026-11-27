import { label } from "./library/mediaTypes";
import { msg } from "./i18n";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import type { IndexStatusSnapshot } from "./types";

const labels: Record<string, string> = {
  ready: "已就绪",
  missing: "未建立",
  stale: "正文已变",
  unknown: "尚未核对",
  error: "失败",
  excluded: "默认排除",
  disabled: "未启用",
  profile_changed: "模型已变",
  interrupted: "上次未完成",
};
export default function IndexStatusPanel({
  snapshot,
  loading,
  error,
  busy,
  onRefresh,
  onUpdate,
}: {
  snapshot: IndexStatusSnapshot | null;
  loading: boolean;
  error: string;
  busy: boolean;
  onRefresh: () => void;
  onUpdate: (path: string) => void;
}) {
  const [filter, setFilter] = useState("all");
  const documents = snapshot?.documents ?? [];
  const pending = documents.filter(
    (d) =>
      d.included &&
      (d.keywordState !== "ready" ||
        !["ready", "disabled"].includes(d.vectorState)),
  );
  const shown = filter === "pending" ? pending : documents;
  return (
    <section
      className="document-index-status"
      aria-label={msg("逐文档索引状态")}
      aria-busy={loading}
    >
      <div className="section-heading">
        <div>
          <h3>{msg("文档与索引版本")}</h3>
          <p>
            {snapshot
              ? `空间 ${documents.length} 篇 · 已纳入 ${documents.filter((d) => d.included).length} 篇 · 待处理 ${pending.length} 篇`
              : msg("尚未核对当前空间的文件")}
          </p>
        </div>
        <button
          className="button"
          disabled={loading || busy}
          onClick={onRefresh}
        >
          <RefreshCw size={14} />
          {msg("重新核对")}
        </button>
      </div>
      {snapshot && (
        <p className="muted index-check-time">
          {msg("最近核对：")}
          {new Date(snapshot.checkedAt * 1000).toLocaleString()}
          {msg("。外部原件变化不等于当前副本索引过期。")}
        </p>
      )}
      <div className="index-filter" role="group" aria-label={msg("索引状态筛选")}>
        {[
          ["all", "全部文档"],
          ["pending", "待处理"],
        ].map(([id, label]) => (
          <button
            key={id}
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <p className="panel-warning" role="alert">
          {msg("核对失败：")}{error}{msg("。上次快照仅供参考，请重试。")}
        </p>
      )}
      {loading && <p role="status">{msg("正在核对文件内容与索引版本…")}</p>}
      {!loading && snapshot && shown.length === 0 && (
        <p className="muted">
          {filter === "pending"
            ? msg("当前已核对的纳入文档没有待处理项。")
            : msg("当前空间没有可显示的文档。")}
        </p>
      )}
      <div className="document-index-list">
        {shown.map((d) => (
          <article key={d.path} className="document-index-row">
            <div>
              <strong title={d.path}>{label(d.title)}</strong>
              <div className="index-badges">
                <span>{msg("关键词 ·")} {labels[d.keywordState]}</span>
                <span>{msg("向量 ·")} {labels[d.vectorState]}</span>
              </div>
              {(d.reason || d.error) && (
                <p className={d.error ? "panel-warning" : "muted"}>
                  {d.error || d.reason}
                </p>
              )}
              <details>
                <summary>{msg("版本依据")}</summary>
                <dl>
                  <dt>{msg("当前正文")}</dt>
                  <dd>{d.sourceHash || msg("尚未核对")}</dd>
                  <dt>{msg("索引正文")}</dt>
                  <dd>{d.indexedHash || msg("未建立")}</dd>
                  <dt>{msg("切片策略")}</dt>
                  <dd>
                    {d.strategy || msg("未记录")} / {d.parserVersion ?? "—"}
                  </dd>
                  <dt>{msg("向量模型")}</dt>
                  <dd>{snapshot?.embeddingProfile || msg("未启用")}</dd>
                </dl>
              </details>
            </div>
            <button
              className="button"
              disabled={busy || loading || d.keywordState === "error"}
              onClick={() => onUpdate(d.path)}
            >
              {d.included ? msg("更新此文档") : msg("显式纳入并更新")}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
