export interface Provider {
  enabled: boolean;
  baseUrl: string;
  model: string;
  dimensions: number | null;
  maxInputChars: number;
  batchSize: number;
  contextChars: number;
}
export interface RerankProvider {
  enabled: boolean;
  endpoint: string;
  protocol: "cohere";
  model: string;
  candidateCount: number;
  timeoutMs: number;
  maxInputChars: number;
  minScore: number;
  strict: boolean;
}
export const defaultRerankProvider: RerankProvider = {
  enabled: false,
  endpoint: "",
  protocol: "cohere",
  model: "",
  candidateCount: 40,
  timeoutMs: 3000,
  maxInputChars: 2400,
  minScore: 0.5,
  strict: false,
};
export interface Settings {
  embedding: Provider;
  chat: Provider;
  rerank: RerankProvider;
  hasRerankKey: boolean;
  hasEmbeddingKey: boolean;
  hasChatKey: boolean;
  keyWarning?: string | null;
}
export interface FileEntry {
  path: string;
  name: string;
  directory: boolean;
  children: FileEntry[];
}
export interface Stats {
  documents: number;
  chunks: number;
  vectors: number;
  embeddingReady: boolean;
  vectorDocuments?: number;
}
export interface Workspace {
  root: string;
  name: string;
  managedProjectId?: string | null;
  files: FileEntry[];
  stats: Stats;
  warning?: string | null;
}
export interface FileData {
  path: string;
  content: string;
  hash: string;
  draft: { content: string; baseHash: string } | null;
  missing: boolean;
}
export interface Chunk {
  text: string;
  heading: string;
  startLine: number;
  endLine: number;
}
export interface IndexPlan {
  jobId: string;
  documents: { path: string; content: string; hash: string }[];
  skipped: number;
  warnings: string[];
  maxChunkChars: number;
  remote: boolean;
}
export interface SearchResult {
  id: number;
  path: string;
  text: string;
  heading: string;
  startLine: number;
  endLine: number;
  hash: string;
  score: number;
  bm25Score?: number | null;
  vectorDistance?: number | null;
  bm25Rank?: number | null;
  vectorRank?: number | null;
  rerankScore?: number | null;
  evidence?: boolean;
  matchKind?: string;
  title?: string | null;
  documentId?: string | null;
}
export interface SearchResponse {
  results: SearchResult[];
  warning: string | null;
  semantic: boolean;
  evidenceCount: number;
  candidateCount: number;
  retrievalMode: string;
  rerankStatus: string;
}
export interface ChatResponse {
  finishReason: string;
  text: string;
  sources: SearchResult[];
  warning: string | null;
  retrievalMode?: string;
  rerankStatus?: string;
  model?: string;
  scope?: string | null;
  chartWarnings?: string[];
  rejectedCharts?: number[];
}

export interface SaveResult {
  hash: string;
  indexStale: boolean;
  warning: string | null;
}

export interface DocumentIndexStatus {
  path: string;
  title: string;
  documentId?: string | null;
  included: boolean;
  reason?: string | null;
  sourceHash?: string | null;
  indexedHash?: string | null;
  keywordState:
    "ready" | "missing" | "stale" | "unknown" | "error" | "excluded";
  vectorState:
    | "ready"
    | "disabled"
    | "missing"
    | "stale"
    | "profile_changed"
    | "interrupted"
    | "unknown"
    | "error"
    | "excluded";
  strategy?: string | null;
  parserVersion?: number | null;
  indexedAt?: number | null;
  error?: string | null;
}
export interface IndexStatusSnapshot {
  checkedAt: number;
  embeddingProfile: string;
  documents: DocumentIndexStatus[];
}
