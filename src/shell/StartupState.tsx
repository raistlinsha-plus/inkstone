import { LoaderCircle, RefreshCw } from "lucide-react";

/** Loading and failure are distinct from a successfully opened, empty library. */
export default function StartupState({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => void;
}) {
  return (
    <section className="startup-state" aria-label="打开资料">
      {error ? (
        <>
          <h1>资料暂时无法打开</h1>
          <p role="alert">请重试；需要时可展开错误详情。</p>
          <button className="button primary" onClick={onRetry}>
            <RefreshCw size={16} aria-hidden="true" />
            重新打开资料
          </button>
          <details>
            <summary>错误详情</summary>
            <pre>{error}</pre>
          </details>
        </>
      ) : (
        <>
          <LoaderCircle size={24} className="spin" aria-hidden="true" />
          <h1 role="status">正在打开文档空间…</h1>
          <p>正在恢复空间、文档和编辑位置。</p>
        </>
      )}
    </section>
  );
}
