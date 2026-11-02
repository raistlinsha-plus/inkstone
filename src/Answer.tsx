import Markdown from "./preview/Markdown";
import type { SearchResult } from "./types";

export default function Answer({
  text,
  sources,
  onOpen,
  pending = false,
  rejectedCharts = [],
  viewKey,
  onError,
}: {
  text: string;
  sources: SearchResult[];
  onOpen: (source: SearchResult) => void;
  pending?: boolean;
  rejectedCharts?: number[];
  viewKey?: string;
  onError?: (message: string) => void;
}) {
  return (
    <div className="answer-text">
      <Markdown
        source={text}
        path=""
        readOnly
        citations={sources}
        onCitation={onOpen}
        pending={pending}
        rejectedCharts={rejectedCharts}
        viewKey={viewKey ?? "answer"}
        label="AI 回答"
        onError={onError ?? (() => {})}
      />
    </div>
  );
}
