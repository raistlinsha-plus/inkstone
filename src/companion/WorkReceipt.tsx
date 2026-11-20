import { useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Context, Pending, Preview, Snapshot } from "./types";
import "./work-receipt.css";

export type ReceiptResult = {
  status: "counted" | "duplicate" | "daily_limit";
  snapshot: Snapshot;
};

export function confirmReceipt(
  workspaceRoot: string,
  context: Context,
  receipt: Pick<Pending, "token" | "eventId" | "text" | "kind">,
) {
  return invoke<ReceiptResult>("companion_confirm", {
    workspaceRoot,
    input: { ...receipt, context, consent: true },
  });
}

type Request =
  | { phase: "loading" }
  | { phase: "preview" | "submitting"; preview: Preview }
  | { phase: "error"; message: string };

function receiptError(error: unknown) {
  return String(error).replace(/^(?:Error: )?(?:[A-Z_]+[：:]\s*)?/, "");
}

export function useWorkReceipt(scope: string) {
  const [request, setRequest] = useState<Request | null>(null);
  const operation = useRef(0);
  const previewToken = useRef<string | null>(null);

  function dismiss() {
    operation.current++;
    previewToken.current = null;
    setRequest(null);
  }
  useLayoutEffect(() => {
    dismiss();
    return () => {
      operation.current++;
    };
  }, [scope]);

  async function open(
    workspaceRoot: string,
    path: string | null,
    reason: string,
  ) {
    const id = ++operation.current;
    previewToken.current = null;
    if (!path || reason) {
      setRequest({ phase: "error", message: reason || "请先打开文档。" });
      return;
    }
    setRequest({ phase: "loading" });
    try {
      const preview = await invoke<Preview>("companion_preview", {
        workspaceRoot,
        path,
      });
      if (id !== operation.current) return;
      previewToken.current = preview.token;
      setRequest({ phase: "preview", preview });
    } catch (error) {
      if (id === operation.current)
        setRequest({ phase: "error", message: receiptError(error) });
    }
  }

  async function submit(
    workspaceRoot: string,
    preview: Preview,
    text: string,
    kind: string,
    onResult: (result: ReceiptResult) => void,
    refresh: () => void,
  ) {
    if (previewToken.current !== preview.token) return;
    previewToken.current = null;
    const id = ++operation.current;
    setRequest({ phase: "submitting", preview });
    try {
      const result = await confirmReceipt(workspaceRoot, preview.context, {
        token: preview.token,
        eventId: preview.eventId,
        text,
        kind,
      });
      if (id !== operation.current) {
        refresh();
        return;
      }
      setRequest(null);
      onResult(result);
    } catch (error) {
      refresh();
      if (id === operation.current)
        setRequest({ phase: "error", message: receiptError(error) });
    }
  }

  return { request, open, submit, dismiss };
}

export function WorkReceipt({
  request,
  onCancel,
  onSubmit,
  edge,
}: {
  request: Request;
  onCancel: () => void;
  onSubmit: (preview: Preview, text: string, kind: string) => void;
  edge: boolean;
}) {
  const preview = "preview" in request ? request.preview : undefined;
  const [text, setText] = useState(preview?.suggestedText ?? "");
  const [kind, setKind] = useState("complete");
  const [consent, setConsent] = useState(false);
  const section = useRef<HTMLElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const submitting = request.phase === "submitting";
  useLayoutEffect(() => {
    // The page-edge menu replaces its trigger. Keep keyboard navigation in the card.
    if (edge)
      (field.current ?? section.current)?.focus({ preventScroll: true });
  }, [edge, preview?.token]);

  return (
    <section
      className="companion-work-receipt"
      aria-label="本次完成经历卡"
      ref={section}
      tabIndex={-1}
    >
      {edge && <strong>记录本次完成</strong>}
      {request.phase === "loading" && <p role="status">正在核对本次保存…</p>}
      {request.phase === "error" && <p role="alert">{request.message}</p>}
      {preview && (
        <>
          <label>
            拟存经历
            <textarea
              ref={field}
              rows={2}
              maxLength={160}
              value={text}
              disabled={submitting}
              onChange={(event) => {
                setText(event.target.value);
                setConsent(false);
              }}
            />
          </label>
          <label>
            经历类型
            <select
              value={kind}
              disabled={submitting}
              onChange={(event) => {
                setKind(event.target.value);
                setConsent(false);
              }}
            >
              <option value="complete">完成一份笔记</option>
              <option value="milestone">确认项目里程碑</option>
              <option value="revision" disabled={!preview.canRevise}>
                复盘一次已有记录
              </option>
            </select>
          </label>
          <small>有效日 {preview.day} · 同一文档当日一次，每日最多两条。</small>
          <label className="companion-check">
            <input
              type="checkbox"
              checked={consent}
              disabled={submitting}
              onChange={(event) => setConsent(event.target.checked)}
            />
            我确认保存以上经历卡内容。
          </label>
        </>
      )}
      <div className="companion-receipt-actions">
        <button type="button" disabled={submitting} onClick={onCancel}>
          {request.phase === "error" ? "返回" : "暂不记录"}
        </button>
        {preview && (
          <button
            type="button"
            className="primary"
            disabled={submitting || !consent || !text.trim()}
            onClick={() => {
              if (consent && text.trim()) onSubmit(preview, text.trim(), kind);
            }}
          >
            {submitting ? "正在记录…" : "确认并记录"}
          </button>
        )}
      </div>
    </section>
  );
}
