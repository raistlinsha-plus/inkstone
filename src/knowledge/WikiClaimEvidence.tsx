import { ExternalLink } from "lucide-react";

export interface WikiRef {
  documentId: string;
  title: string;
  path: string;
  startLine: number;
  endLine: number;
  quote: string;
  hash: string;
}

export interface ClaimReview {
  claim: string;
  status:
    | "supported"
    | "parallel"
    | "singleSource"
    | "conflict"
    | "missing"
    | "sourceChanged";
  refIndices: number[];
}

const labels = {
  supported: "原文支持",
  parallel: "来源并列",
  singleSource: "单方记载",
  conflict: "原文取值不同",
  missing: "依据不足",
  sourceChanged: "来源已变",
};

export function sourceLines({
  startLine,
  endLine,
}: Pick<WikiRef, "startLine" | "endLine">) {
  return startLine === endLine
    ? `第 ${startLine} 行`
    : `第 ${startLine}–${endLine} 行`;
}

export function WikiSourceLink({
  source,
  onOpen,
}: {
  source: WikiRef;
  onOpen?: () => void;
}) {
  return (
    <button type="button" disabled={!onOpen} onClick={onOpen}>
      <span>
        <strong>{source.title}</strong>
        <small>{sourceLines(source)}</small>
      </span>
      <ExternalLink size={14} aria-hidden="true" />
    </button>
  );
}

export function WikiClaimEvidence({
  claims,
  sources,
  previousClaims,
  onOpen,
}: {
  claims: ClaimReview[];
  sources: WikiRef[];
  previousClaims?: ClaimReview[];
  onOpen?: (index: number) => void;
}) {
  const previousText = new Set(previousClaims?.map((row) => row.claim));
  return (
    <section className="wiki-claim-evidence" aria-label="结论与依据">
      <h3>结论与依据</h3>
      <ol className="wiki-claims">
        {claims.map((row, position) => (
          <li key={position} data-status={row.status}>
            <div className="wiki-claim-label">
              <strong>{labels[row.status]}</strong>
              {previousClaims && (
                <span>
                  {previousText.has(row.claim) ? "沿用表述" : "本次新增表述"}
                </span>
              )}
            </div>
            <p>{row.claim}</p>
            {row.status !== "sourceChanged" &&
              row.refIndices.some((index) => sources[index]) && (
                <ul className="wiki-citation-list">
                  {row.refIndices
                    .filter((index) => sources[index])
                    .map((index) => (
                      <li key={index}>
                        <WikiSourceLink
                          source={sources[index]}
                          onOpen={onOpen && (() => onOpen(index))}
                        />
                        <blockquote>{sources[index].quote}</blockquote>
                      </li>
                    ))}
                </ul>
              )}
          </li>
        ))}
      </ol>
    </section>
  );
}
