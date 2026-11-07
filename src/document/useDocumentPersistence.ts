import { useEffect, useRef, useState, type RefObject } from "react";
import type { EditorHandle } from "../Editor";
import { invoke } from "../platform/ipc";
import type { Workspace } from "../types";

interface DocumentState {
  path: string;
  content: string;
  saved: string;
  hash: string;
  revision: number;
  conflict: boolean;
  recovered: boolean;
  missing?: boolean;
  draftSaved?: string;
}
interface Options {
  workspaceRef: RefObject<Workspace | null>;
  libraryMutationBusy: boolean;
  formatError(error: unknown): string;
  onError(error: unknown): void;
  onSaved(warning?: string | null): void;
}

export function useDocumentPersistence({
  workspaceRef,
  libraryMutationBusy,
  formatError,
  onError,
  onSaved,
}: Options) {
  const editorHandle = useRef<EditorHandle>(null);
  const [document, setDocument] = useState<DocumentState | null>(null);
  const docRef = useRef(document);
  docRef.current = document;
  const [saving, setSaving] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [saveWarning, setSaveWarning] = useState("");
  const saveInFlight = useRef<Promise<void> | null>(null);
  const draftInFlight = useRef<Promise<void>>(Promise.resolve());
  const dirty = document !== null && document.content !== document.saved;

  function syncEditor() {
    const doc = docRef.current;
    const live = editorHandle.current?.getContent();
    if (doc && live !== undefined && live !== doc.content) {
      const next = { ...doc, content: live };
      setSaveWarning("");
      docRef.current = next;
      setDocument(next);
      return next;
    }
    return doc;
  }
  async function persistDraft() {
    const doc = syncEditor(),
      root = workspaceRef.current?.root;
    if (!doc || (doc.content === doc.saved && !doc.conflict)) {
      await draftInFlight.current.catch(() => {});
      return;
    }
    const previous = draftInFlight.current.catch(() => {});
    const pending = (async () => {
      await previous;
      try {
        await invoke("save_draft", {
          path: doc.path,
          content: doc.content,
          baseHash: doc.hash,
          workspaceRoot: root,
        });
        if (workspaceRef.current?.root === root) {
          setDocument((old) =>
            old?.path === doc.path ? { ...old, draftSaved: doc.content } : old,
          );
          setDraftError("");
        }
      } catch (e) {
        if (workspaceRef.current?.root === root) setDraftError(formatError(e));
        throw e;
      }
    })();
    draftInFlight.current = pending;
    return pending;
  }
  async function saveCurrent(): Promise<void> {
    if (saveInFlight.current) {
      await saveInFlight.current;
      return saveCurrent();
    }
    const doc = syncEditor();
    if (!doc) return;
    if (doc.conflict) {
      await persistDraft();
      throw new Error(
        doc.missing
          ? "原文件不可访问，可恢复原位置或另存为。"
          : "文件有外部修改，请载入磁盘版本或另存为",
      );
    }
    if (doc.content === doc.saved) return;
    setSaving(true);
    const promise = (async () => {
      try {
        try {
          await persistDraft();
        } catch {
          /* A successful file save remains sufficient. */
        }
        const result = await invoke("save_file", {
          path: doc.path,
          content: doc.content,
          expectedHash: doc.hash,
          workspaceRoot: workspaceRef.current?.root,
        });
        const hash = result.hash;
        setSaveWarning(result.warning ?? "");

        setDraftError("");
        setDocument((old) =>
          old?.path === doc.path
            ? {
                ...old,
                saved: doc.content,
                hash,
                recovered: false,
                conflict: false,
                missing: false,
                draftSaved: undefined,
              }
            : old,
        );
        if (docRef.current?.path === doc.path)
          docRef.current = {
            ...docRef.current,
            saved: doc.content,
            hash,
            recovered: false,
          };
        onSaved(result.warning);
      } catch (e) {
        if (String(e).includes("CONFLICT:"))
          setDocument((old) =>
            old?.path === doc.path ? { ...old, conflict: true } : old,
          );
        throw e;
      } finally {
        setSaving(false);
        saveInFlight.current = null;
      }
    })();
    saveInFlight.current = promise;
    return promise;
  }
  useEffect(() => {
    if (libraryMutationBusy || !document || (!dirty && !document.conflict))
      return;
    const draft = setTimeout(() => void persistDraft().catch(onError), 400);
    const auto = document.conflict
      ? null
      : setTimeout(() => void saveCurrent().catch(onError), 1400);
    return () => {
      clearTimeout(draft);
      if (auto) clearTimeout(auto);
    };
  }, [
    document?.content,
    document?.path,
    document?.conflict,
    document?.saved,
    libraryMutationBusy,
  ]);

  return {
    document,
    setDocument,
    docRef,
    editorHandle,
    dirty,
    saving,
    draftError,
    setDraftError,
    saveWarning,
    setSaveWarning,
    saveInFlight,
    syncEditor,
    persistDraft,
    saveCurrent,
  };
}
