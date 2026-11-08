import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AssistantDraftContext,
  Conversation,
  ConversationSummary,
  StartQuestion,
} from "./types";

type Draft = {
  scope: string | null;
  text: string;
  context?: AssistantDraftContext;
};

function compactDraftContext(
  context: AssistantDraftContext | undefined,
): AssistantDraftContext {
  const result: AssistantDraftContext = {};
  const {
    projectId,
    documentIds = [],
    attachments = [],
  } = context?.sources ?? {};
  if (projectId || documentIds.length || attachments.length)
    result.sources = { projectId: projectId ?? null, documentIds, attachments };
  if (context?.webAccess === "local-only") result.webAccess = "local-only";
  if (context?.branch)
    result.branch = { parentTurnId: context.branch.parentTurnId };
  return result;
}
type RunningQuestion = {
  id: string;
  conversationId: string;
  scope: string | null;
  epoch: number;
  writes: Promise<boolean>;
};

/** Persistent assistant data; request ownership is scoped to the current workspace. */
export function useAssistant(
  workspaceRoot: string | undefined,
  general = false,
) {
  const root = general ? "general:" : workspaceRoot;
  const request = useCallback(
    <T>(command: string, args: Record<string, unknown>) =>
      invoke<T>(command, general ? { ...args, general: true } : args),
    [general],
  );
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
    pendingDraft = useRef<Draft | null>(null);
  const runningQuestion = useRef<RunningQuestion | null>(null);
  const install = useCallback((next: Conversation | null) => {
    current.current = next;
    setConversation(next);
  }, []);
  const list = useCallback(
    async (includeArchived = true, query = "") => {
      const epoch = generation.current;
      if (!rootRef.current) return;
      const rows = await request<ConversationSummary[]>("assistant_list", {
        includeArchived,
        query,
      });
      if (epoch === generation.current)
        setSummaries(Array.isArray(rows) ? rows : []);
    },
    [request],
  );
  const search = useCallback(
    async (includeArchived: boolean, query: string, offset = 0) => {
      const epoch = generation.current;
      const rows = await request<ConversationSummary[]>("assistant_list", {
        includeArchived,
        query,
        offset,
      });
      if (epoch !== generation.current) throw Error("空间已变化");
      return Array.isArray(rows) ? rows : [];
    },
    [request],
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
        const rows = await request<ConversationSummary[]>("assistant_list", {
          includeArchived: true,
          query: "",
        });
        if (!active) return;
        setSummaries(Array.isArray(rows) ? rows : []);
        const first = Array.isArray(rows)
          ? rows.find((x) => !x.archived)
          : undefined;
        if (first && !current.current) {
          const next = await request<Conversation>("assistant_get", {
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
  }, [root, install, list, request]);
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
        const next = await request<Conversation>("assistant_create", {
          scope,
          title,
        });
        if (epoch !== generation.current) throw Error("空间已变化");
        if (!next?.id) throw Error("会话服务暂不可用");
        install(next);
        await list();
        return next;
      }),
    [serial, install, list, request],
  );
  const load = useCallback(
    async (id: string) => {
      const epoch = generation.current;
      setLoading(true);
      setError("");
      try {
        const next = await request<Conversation>("assistant_get", {
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
    [install, request],
  );
  const update = useCallback(
    (patch: {
      title?: string;
      archived?: boolean;
      draft?: string;
      draftContext?: AssistantDraftContext;
      activeLeafId?: string;
    }) =>
      serial(async () => {
        const c = current.current;
        if (!c) throw Error("请先建立会话");
        const epoch = generation.current;
        const next = await request<Conversation>("assistant_update", {
          conversationId: c.id,
          expectedRevision: c.revision,
          ...patch,
        });
        if (epoch !== generation.current) throw Error("空间已变化");
        install(next);
        await list();
        return next;
      }),
    [serial, install, list, request],
  );
  const flushDraft = useCallback(async () => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = null;
    if (!rootRef.current) return;
    const epoch = generation.current;
    if (!pendingDraft.current) {
      // Closing after stop must also wait for a candidate's durable finish,
      // even when the composer is empty.
      await queue.current.catch(() => {});
      if (epoch !== generation.current || !pendingDraft.current) return;
    }
    try {
      // Read the latest pending value when this job runs. A draft may already
      // have been written during generation while this job waited in the queue.
      await serial(async () => {
        const draft = pendingDraft.current;
        if (!draft) return;
        if (
          !current.current ||
          current.current.archived ||
          current.current.scope !== draft.scope
        ) {
          const next = await request<Conversation>("assistant_create", {
            scope: draft.scope,
          });
          if (epoch !== generation.current) throw Error("空间已变化");
          if (!next?.id) throw Error("会话服务暂不可用");
          install(next);
        }
        const c = current.current!;
        const contextChanged =
          draft.context !== undefined &&
          JSON.stringify(draft.context) !==
            JSON.stringify(compactDraftContext(c.draftContext));
        if (c.draft !== draft.text || contextChanged) {
          const next = await request<Conversation>("assistant_update", {
            conversationId: c.id,
            expectedRevision: c.revision,
            draft: draft.text,
            ...(contextChanged ? { draftContext: draft.context } : {}),
          });
          if (epoch !== generation.current) throw Error("空间已变化");
          install(next);
        }
        if (pendingDraft.current === draft) pendingDraft.current = null;
      });
      if (epoch === generation.current) {
        setDraftError("");
        await list().catch((e) => setError(String(e)));
      }
    } catch (e) {
      if (epoch === generation.current)
        setDraftError("问答草稿未保存：" + String(e));
      throw e;
    }
  }, [serial, install, list, request]);
  const ensureGeneral = useCallback(async () => {
    await flushDraft();
    return serial(async () => {
      if (current.current && !current.current.archived) return current.current;
      const epoch = generation.current;
      const next = await request<Conversation>("assistant_create", {
        scope: null,
      });
      if (epoch !== generation.current) throw Error("会话已切换");
      if (!next?.id) throw Error("会话服务暂不可用");
      install(next);
      await list();
      return next;
    });
  }, [flushDraft, serial, request, install, list]);
  const persistDebouncedDraft = useCallback(async () => {
    const draft = pendingDraft.current;
    const run = runningQuestion.current;
    if (
      !draft ||
      !run ||
      run.scope !== draft.scope ||
      run.epoch !== generation.current
    ) {
      await flushDraft();
      return;
    }

    const write = run.writes
      .catch(() => {})
      .then(async () => {
        if (pendingDraft.current !== draft || run.epoch !== generation.current)
          return false;
        return request<boolean>("assistant_save_running_draft", {
          conversationId: run.conversationId,
          requestId: run.id,
          draft: draft.text,
          ...(draft.context === undefined
            ? {}
            : { draftContext: draft.context }),
        });
      });
    run.writes = write;
    let saved: boolean;
    try {
      saved = await write;
    } catch (e) {
      if (run.epoch === generation.current && pendingDraft.current === draft)
        setDraftError("问答草稿未保存：" + String(e));
      return;
    }
    if (run.epoch !== generation.current || pendingDraft.current !== draft)
      return;
    if (saved) {
      pendingDraft.current = null;
      setDraftError("");
    } else {
      // Begin may not have accepted the request yet, or finish may have won
      // the race. The normal queue will use the conversation's final revision.
      await flushDraft();
    }
  }, [flushDraft, request]);
  const saveDraft = useCallback(
    (scope: string | null, text: string, context?: AssistantDraftContext) => {
      pendingDraft.current = {
        scope,
        text,
        context:
          context === undefined ? undefined : compactDraftContext(context),
      };
      if (draftTimer.current) clearTimeout(draftTimer.current);
      draftTimer.current = setTimeout(() => {
        draftTimer.current = null;
        void persistDebouncedDraft().catch(() => {
          /* retained for explicit retry */
        });
      }, 600);
    },
    [persistDebouncedDraft],
  );
  const start = useCallback(
    async (
      scope: string | null,
      input: StartQuestion,
      isStopped?: () => boolean,
    ) => {
      await flushDraft();
      if (
        !current.current ||
        current.current.archived ||
        current.current.scope !== scope
      )
        await create(scope);
      return serial(async () => {
        if (isStopped?.()) throw Error("已停止生成，问题未发送。");
        const c = current.current!;
        const epoch = generation.current;
        const run: RunningQuestion = {
          id: input.requestId,
          conversationId: c.id,
          scope,
          epoch,
          writes: Promise.resolve(false),
        };
        runningQuestion.current = run;
        setError("");
        let next: Conversation;
        try {
          next = await request<Conversation>("assistant_ask", {
            ...input,
            conversationId: c.id,
            expectedRevision: c.revision,
            parentTurnId:
              input.parentTurnId === undefined
                ? c.activeLeafId
                : input.parentTurnId,
            regenerateTurnId: input.regenerateTurnId ?? null,
          });
        } catch (e) {
          // A transport/finish failure may follow durable begin. Reconcile the
          // accepted revision before a queued draft retries; never invent one.
          if (epoch === generation.current) {
            try {
              const latest = await request<Conversation>("assistant_get", {
                conversationId: c.id,
              });
              if (epoch === generation.current && latest?.id === c.id)
                install(latest);
            } catch {
              /* Keep the input/pending draft and the original error. */
            }
          }
          throw e;
        } finally {
          if (runningQuestion.current === run) runningQuestion.current = null;
        }
        if (epoch !== generation.current) throw Error("空间已变化");
        install(next);
        await list().catch((e) => setError(String(e)));
        return next;
      });
    },
    [create, install, list, serial, flushDraft, request],
  );
  const select = useCallback(
    (turnId: string, candidateId: string) =>
      serial(async () => {
        const c = current.current;
        if (!c) throw Error("会话已关闭");
        const epoch = generation.current;
        const next = await request<Conversation>("assistant_select_candidate", {
          conversationId: c.id,
          turnId,
          candidateId,
          expectedRevision: c.revision,
        });
        if (epoch === generation.current) install(next);
      }),
    [serial, install, request],
  );
  const remove = useCallback(
    () =>
      serial(async () => {
        if (draftTimer.current) clearTimeout(draftTimer.current);
        pendingDraft.current = null;
        const c = current.current;
        if (!c) return;
        const epoch = generation.current;
        await request("assistant_delete", {
          conversationId: c.id,
          expectedRevision: c.revision,
        });
        if (epoch === generation.current) install(null);
        await list();
      }),
    [serial, install, list, request],
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
    general,
    conversation,
    summaries,
    error: draftError || error,
    draftFailed: !!draftError,
    loading,
    list,
    search,
    create,
    ensureGeneral,
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
