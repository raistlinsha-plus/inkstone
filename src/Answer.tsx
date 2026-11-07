import Markdown from "./preview/Markdown";
import type { SearchResult } from "./types";
import type { ExternalSource } from "./assistant/types";
import { answerCitations } from "./assistant/sourceDisplay";

export default function Answer({
  text,
  sources,
  onOpen,
  externalSources = [],
  pending = false,
  rejectedCharts = [],
  viewKey,
  onError,
}: {
  text: string;
  sources: SearchResult[];
  externalSources?: ExternalSource[];
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
        citations={answerCitations(sources, externalSources)}
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
