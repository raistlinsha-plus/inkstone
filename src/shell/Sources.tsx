import type { SearchResult } from "../types";
const basename = (path: string) => path.split("/").at(-1) ?? path;
export default function Sources({
  items,
  onOpen,
}: {
  items: SearchResult[];
  onOpen: (source: SearchResult) => void;
}) {
  return (
    <div className="sources">
      {items.map((s, i) => (
        <button
          className="source-card"
          key={`${s.path}-${s.id}`}
          onClick={() => onOpen(s)}
        >
          <div>
            <span className="source-number">{i + 1}</span>
            <strong>{s.title ?? basename(s.path)}</strong>
            <span className="source-line">
              L{s.startLine}–{s.endLine}
            </span>
          </div>
          <small
            className={
              s.evidence === false ? "candidate-label" : "evidence-label"
            }
          >
            {s.evidence === false
              ? "待核实候选"
              : s.matchKind === "reranked"
                ? "关键词 + 重排"
                : "关键词命中"}
          </small>
          <p>{s.heading || "正文"}</p>
          <span className="source-excerpt">
            {s.text.slice(0, 135)}
            {s.text.length > 135 ? "…" : ""}
          </span>
        </button>
      ))}
    </div>
  );
}
