export type TaskSource = {
  conversationId: string;
  turnId: string;
  candidateId: string | null;
  general: boolean;
};
export type ActionChoice = {
  fromQuestion?: boolean;
  quote: string;
  startChar: number;
  title: string;
  due: string;
  selected: boolean;
};

export function choice(
  text: string,
  from: number,
  to: number,
  title?: string,
): ActionChoice | undefined {
  const raw = text.slice(from, to);
  const quote = raw.trim();
  if (!quote || Array.from(quote).length > 8000) return;
  const offset = from + raw.indexOf(quote);
  return {
    quote,
    startChar: Array.from(text.slice(0, offset)).length,
    title:
      title ?? Array.from(quote.replace(/\s+/gu, " ")).slice(0, 160).join(""),
    due: "",
    selected: false,
  };
}

// Persistent wire identity shared with assistant_tasks.rs. Hash the UTF-8 JSON tuple exactly
// as serialized here; startChar counts Unicode scalar values, and the title is editable.
export async function actionId(
  source: TaskSource,
  documentId: string,
  row: ActionChoice,
) {
  const key = JSON.stringify([
    source.conversationId,
    source.turnId,
    row.fromQuestion ? null : source.candidateId,
    documentId,
    row.startChar,
    row.quote,
  ]);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(key),
  );
  const bytes = new Uint8Array(digest, 0, 16);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}
