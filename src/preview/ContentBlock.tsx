import { lazy, Suspense } from "react";
import JsonTree from "./JsonTree";
import Mindmap from "./Mindmap";
import Graph from "./Graph";
import Chart from "./Chart";
import ContentBoundary from "./ContentBoundary";
const CalendarBlock = lazy(() => import("../calendar/CalendarBlock"));
export interface ContentBlockProps {
  kind: string;
  source: string;
  viewKey?: string;
  onApply?: (base: string, next: string) => void;
  onLocate?: (line: number) => void;
  onError?: (error: string) => void;
  readOnly?: boolean;
  onEditingChange?: (active: boolean) => void;
  startLine?: number;
  sourceRefs?: string[];
}
// Both the document NodeView and the Markdown reader use this dispatcher.
// Editing is an explicit capability; answers never receive it.
export default function ContentBlock(props: ContentBlockProps) {
  const {
    kind,
    source,
    viewKey,
    onApply,
    onLocate,
    onError,
    onEditingChange,
    startLine = 1,
    sourceRefs,
  } = props;
  const readOnly = props.readOnly === true || !onApply;
  let body;
  if (kind === "json")
    body = (
      <JsonTree
        embedded
        source={source}
        readOnly={readOnly}
        viewKey={viewKey}
        onApply={onApply}
        onLocate={onLocate}
        startLine={startLine}
        onEditingChange={onEditingChange}
      />
    );
  else if (kind === "mindmap")
    body = (
      <Mindmap
        embedded
        source={source}
        readOnly={readOnly}
        viewKey={viewKey}
        onApply={onApply}
        onLocate={onLocate}
        onError={onError}
        onEditingChange={onEditingChange}
      />
    );
  else if (kind === "calendar")
    body = (
      <Suspense
        fallback={<p className="block-placeholder">正在准备本地日历…</p>}
      >
        <CalendarBlock
          source={source}
          readOnly={readOnly}
          onApply={onApply}
          onError={onError}
          onEditingChange={onEditingChange}
        />
      </Suspense>
    );
  else if (kind === "chart")
    body = (
      <Chart
        source={source}
        viewKey={viewKey}
        readOnly={readOnly}
        onApply={onApply}
        onError={onError}
        sourceRefs={sourceRefs}
        onEditingChange={onEditingChange}
      />
    );
  else if (kind === "mermaid")
    body = (
      <Graph
        kind="mermaid"
        source={source}
        onError={onError}
        onLocate={onLocate}
        startLine={startLine}
      />
    );
  else
    body = (
      <pre>
        <code>{source}</code>
      </pre>
    );
  return (
    <ContentBoundary source={source} label={kind} onError={onError}>
      {body}
    </ContentBoundary>
  );
}
