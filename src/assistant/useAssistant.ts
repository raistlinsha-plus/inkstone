import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Conversation, ConversationSummary, StartQuestion } from "./types";

/** Persistent assistant data; request ownership is scoped to the current workspace. */
export function useAssistant(root: string | undefined) {
  const [conversation, setConversation] = useState<Conversation | null>(null),
    [summaries, setSummaries] = useState<ConversationSummary[]>([]),
    [error, setError] = useState(""),
    [draftError, setDraftError] = useState(""),
    [loading, setLoading] = useState(false);
  const current = useRef<Conversation | null>(null),
    generation = useRef(0),
    rootRef = useRef(root),
    queue = useRef<Promise<unknown>>(Promise.resolve());
  rootRef.current = root;
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    pendingDraft = useRef<{ scope: string | null; text: string } | null>(null);
  const install = useCallback((next: Conversation | null) => {
    current.current = next;
    setConversation(next);
  }, []);
  const list = useCallback(async (includeArchived = true, query = "") => {
    const epoch = generation.current;
    if (!rootRef.current) return;
    const rows = await invoke<ConversationSummary[]>("assistant_list", {
      includeArchived,
      query,
    });
    if (epoch === generation.current)
      setSummaries(Array.isArray(rows) ? rows : []);
  }, []);
  const search = useCallback(
    async (includeArchived: boolean, query: string, offset = 0) => {
      const epoch = generation.current;
      const rows = await invoke<ConversationSummary[]>("assistant_list", {
        includeArchived,
        query,
        offset,
      });
      if (epoch !== generation.current) throw Error("空间已变化");
      return Array.isArray(rows) ? rows : [];
    },
    [],
  );
  useEffect(() => {
    ++generation.current;
    install(null);
    setSummaries([]);
    setError("");
    setDraftError("");
    pendingDraft.current = null;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    let active = true;
    if (root) {
      setLoading(true);
      void (async () => {
        const rows = await invoke<ConversationSummary[]>("assistant_list", {
          includeArchived: true,
          query: "",
        });
        if (!active) return;
        setSummaries(Array.isArray(rows) ? rows : []);
        const first = Array.isArray(rows)
          ? rows.find((x) => !x.archived)
          : undefined;
        if (first && !current.current) {
          const next = await invoke<Conversation>("assistant_get", {
            conversationId: first.id,
          });
          if (active && !current.current) install(next);
        }
      })()
        .catch((e) => {
          if (active) setError(String(e));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    } else setLoading(false);
    return () => {
      active = false;
      ++generation.current;
      if (draftTimer.current) clearTimeout(draftTimer.current);
    };
  }, [root, install, list]);
  const serial = useCallback(<T>(fn: () => Promise<T>) => {
    const epoch = generation.current;
    const job = queue.current
      .catch(() => {})
      .then(async () => {
        if (epoch !== generation.current) throw Error("空间已变化");
        return fn();
      });
    queue.current = job;
    return job;
  }, []);
  const create = useCallback(
    (scope: string | null, title?: string) =>
      serial(async () => {
        const epoch = generation.current;
        const next = await invoke<Conversation>("assistant_create", {
          scope,
          title,
        });
        if (epoch !== generation.current) throw Error("空间已变化");
        if (!next?.id) throw Error("会话服务暂不可用");
        install(next);
        await list();
        return next;
      }),
    [serial, install, list],
  );
  const load = useCallback(
    async (id: string) => {
      const epoch = generation.current;
      setLoading(true);
      setError("");
      try {
        const next = await invoke<Conversation>("assistant_get", {
          conversationId: id,
        });
        if (epoch !== generation.current) return null;
        install(next);
        return next;
      } catch (e) {
        if (epoch === generation.current) setError(String(e));
        throw e;
      } finally {
        if (epoch === generation.current) setLoading(false);
      }
    },
    [install],
  );
  const update = useCallback(
    (patch: {
      title?: string;
      archived?: boolean;
      draft?: string;
      activeLeafId?: string;
    }) =>
      serial(async () => {
        const c = current.current;
        if (!c) throw Error("请先建立会话");
        const epoch = generation.current;
        const next = await invoke<Conversation>("assistant_update", {
          conversationId: c.id,
          expectedRevision: c.revision,
          ...patch,
        });
        if (epoch !== generation.current) throw Error("空间已变化");
        install(next);
        await list();
        return next;
      }),
    [serial, install, list],
  );
  const flushDraft = useCallback(async () => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = null;
    const draft = pendingDraft.current;
    if (!draft || !rootRef.current) return;
    const epoch = generation.current;
    try {
      // One queue owns begin/finish and draft revisions. Read the revision only
      // when this job runs, after any generating candidate has been installed.
      await serial(async () => {
        if (
          !current.current ||
          current.current.archived ||
          current.current.scope !== draft.scope
        ) {
          const next = await invoke<Conversation>("assistant_create", {
            scope: draft.scope,
          });
          if (epoch !== generation.current) throw Error("空间已变化");
          if (!next?.id) throw Error("会话服务暂不可用");
          install(next);
        }
        const c = current.current!;
        if (c.draft !== draft.text) {
          const next = await invoke<Conversation>("assistant_update", {
            conversationId: c.id,
            expectedRevision: c.revision,
            draft: draft.text,
          });
          if (epoch !== generation.current) throw Error("空间已变化");
          install(next);
        }
      });
      if (epoch === generation.current) {
        if (pendingDraft.current === draft) pendingDraft.current = null;
        setDraftError("");
        await list().catch((e) => setError(String(e)));
      }
    } catch (e) {
      if (epoch === generation.current)
        setDraftError("问答草稿未保存：" + String(e));
      throw e;
    }
  }, [serial, install, list]);
  const saveDraft = useCallback(
    (scope: string | null, text: string) => {
      pendingDraft.current = { scope, text };
      if (draftTimer.current) clearTimeout(draftTimer.current);
      draftTimer.current = setTimeout(() => {
        void flushDraft().catch(() => {
          /* retained for explicit retry */
        });
      }, 600);
    },
    [flushDraft],
  );
  const start = useCallback(
    async (scope: string | null, input: StartQuestion) => {
      await flushDraft();
      if (
        !current.current ||
        current.current.archived ||
        current.current.scope !== scope
      )
        await create(scope);
      return serial(async () => {
        const c = current.current!;
        const epoch = generation.current;
        setError("");
        const next = await invoke<Conversation>("assistant_ask", {
          ...input,
          conversationId: c.id,
          expectedRevision: c.revision,
          parentTurnId:
            input.parentTurnId === undefined
              ? c.activeLeafId
              : input.parentTurnId,
          regenerateTurnId: input.regenerateTurnId ?? null,
        });
        if (epoch !== generation.current) throw Error("空间已变化");
        install(next);
        await list().catch((e) => setError(String(e)));
        return next;
      });
    },
    [create, install, list, serial, flushDraft],
  );
  const select = useCallback(
    (turnId: string, candidateId: string) =>
      serial(async () => {
        const c = current.current;
        if (!c) throw Error("会话已关闭");
        const epoch = generation.current;
        const next = await invoke<Conversation>("assistant_select_candidate", {
          conversationId: c.id,
          turnId,
          candidateId,
          expectedRevision: c.revision,
        });
        if (epoch === generation.current) install(next);
      }),
    [serial, install],
  );
  const remove = useCallback(
    () =>
      serial(async () => {
        if (draftTimer.current) clearTimeout(draftTimer.current);
        pendingDraft.current = null;
        const c = current.current;
        if (!c) return;
        const epoch = generation.current;
        await invoke("assistant_delete", {
          conversationId: c.id,
          expectedRevision: c.revision,
        });
        if (epoch === generation.current) install(null);
        await list();
      }),
    [serial, install, list],
  );
  const clear = useCallback(() => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    pendingDraft.current = null;
    install(null);
    setError("");
    setDraftError("");
  }, [install]);
  return {
    workspaceKey: root,
    conversation,
    summaries,
    error: draftError || error,
    loading,
    list,
    search,
    create,
    load,
    update,
    start,
    select,
    remove,
    clear,
    saveDraft,
    flushDraft,
  };
}
export type AssistantController = ReturnType<typeof useAssistant>;
