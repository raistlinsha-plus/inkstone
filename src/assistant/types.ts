import type { ChatResponse } from "../types";
export interface Candidate {
  id: string;
  requestId: string;
  requestedMode?: "keyword" | "hybrid" | "rerank";
  status: "generating" | "complete" | "stopped" | "failed" | "source_changed";
  createdAt: string;
  error: string | null;
  response: ChatResponse | null;
}
export interface Turn {
  id: string;
  parentTurnId: string | null;
  question: string;
  createdAt: string;
  selectedCandidateId: string | null;
  candidates: Candidate[];
}
export interface Conversation {
  id: string;
  title: string;
  scope: string | null;
  scopeLabel: string;
  archived: boolean;
  draft: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  activeLeafId: string | null;
  turns: Turn[];
}
export interface ConversationSummary {
  id: string;
  title: string;
  scope: string | null;
  scopeLabel: string;
  archived: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
  activeLeafId: string | null;
  turnCount: number;
}
export interface HistoryRef {
  conversationId: string;
  turnId: string;
  digest: string;
}
export interface HistoryPreview {
  reference: HistoryRef;
  title: string;
  excerpt: string;
  createdAt: string;
}
export interface MemoryUsage {
  preferences: {
    id: string;
    revision: number;
    key: string;
    scope: "global" | "space";
  }[];
  history: { conversationId: string; turnId: string } | null;
  notes: string[];
}
export interface StartQuestion {
  memoryOptions?: { skipPreferences: boolean; history: HistoryRef | null };
  question: string;
  parentTurnId?: string | null;
  regenerateTurnId?: string | null;
  requestId: string;
  semantic: boolean;
  retrievalMode: string;
}
export function selectedCandidate(turn: Turn) {
  return (
    turn.candidates.find((c) => c.id === turn.selectedCandidateId) ??
    turn.candidates.at(-1)
  );
}
export function branchTurns(conversation: Conversation): Turn[] {
  const result: Turn[] = [],
    seen = new Set<string>();
  let id = conversation.activeLeafId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const t = conversation.turns.find((t) => t.id === id);
    if (!t) break;
    result.unshift(t);
    id = t.parentTurnId;
  }
  return result;
}
