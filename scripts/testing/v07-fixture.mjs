/** DEV/QA ONLY. Injected into an isolated browser context by qa-v07-browser.mjs.
 * This emulates IPC for presentation checks. It is never imported by the app. */
export function installV07Fixture({
  clean = false,
  companionPilot = false,
} = {}) {
  const key = `inkstone-v07-ui-qa-store-${clean ? "clean" : companionPilot ? "pilot" : "base"}`,
    clone = (x) => JSON.parse(JSON.stringify(x));
  const root = "/qa/inkstone-v07",
    now = () => new Date().toISOString(),
    stats = {
      documents: 2,
      chunks: 2,
      vectors: 2,
      vectorDocuments: 2,
      embeddingReady: true,
    };
  const base = {
    spaces: [{ id: "qa-space", title: "北岸阅读计划（合成）" }],
    documents: [
      {
        id: "doc-1",
        projectId: "qa-space",
        path: "documents/doc-1/阅读活动方案.md",
        title: "阅读活动方案.md",
        source: "",
        updated: 1,
        opened: 1,
        status: "ready",
      },
      {
        id: "doc-2",
        projectId: "qa-space",
        path: "documents/doc-2/复盘.md",
        title: "复盘.md",
        source: "",
        updated: 1,
        opened: 0,
        status: "ready",
      },
    ],
    conversations: [],
    files: {
      "documents/doc-1/阅读活动方案.md": {
        content:
          "# 北岸阅读活动\n\n本页所有资料均为虚构，供UI验收使用。\n\n## 两种活动\n\n| 方案 | 时间 | 人数 |\n| --- | --- | --- |\n| 甲 | 周二 | 120 |\n| 乙 | 周四 | 80 |\n\n资料未提供满意度、费用或长期效果。",
        hash: "1".repeat(64),
      },
      "documents/doc-2/复盘.md": {
        content: "# 复盘\n\n下一步补充满意度和成本指标。",
        hash: "qa-hash-review",
      },
    },
    companion: {
      generation: "qa-generation",
      revision: 0,
      timezone: "Asia/Shanghai",
      settings: {
        enabled: true,
        characterId: "motuan",
        mode: "focus",
        reducedMotion: true,
        compact: true,
      },
      events: 0,
      days: 0,
      roles: { motuan: { read: [0], choices: {}, outfit: 0 } },
      cards: [],
      preferences: [],
      pending: [],
      eligible: null,
    },
  };
  const templates = clone({ documents: base.documents, files: base.files });
  if (clean) {
    base.documents = [];
    base.files = {};
    base.companion.settings.enabled = false;
  }
  if (companionPilot) {
    Object.assign(base.companion.settings, {
      mode: "gentle",
      reducedMotion: false,
    });
    base.companion.roles.motuan = { read: [0, 1], choices: {}, outfit: 1 };
  }
  let store;
  try {
    store = JSON.parse(localStorage.getItem(key) || "null") || base;
  } catch {
    store = base;
  }
  const persist = () => localStorage.setItem(key, JSON.stringify(store)),
    callbacks = new Map(),
    listeners = new Map(),
    cancelled = new Set();
  let nextCallback = 1,
    nextListener = 1;
  const send = (event, payload) => {
    for (const v of listeners.values())
      if (v.event === event)
        callbacks.get(v.handler)?.({ event, id: v.id, payload });
  };
  const provider = {
    enabled: true,
    baseUrl: "https://example.invalid/v1",
    model: "QA fixture (no network model)",
    dimensions: 4,
    maxInputChars: 1800,
    batchSize: 8,
    contextChars: 16000,
  };
  const settings = {
    embedding: provider,
    chat: provider,
    rerank: {
      enabled: false,
      endpoint: "",
      protocol: "cohere",
      model: "",
      candidateCount: 40,
      timeoutMs: 3000,
      maxInputChars: 2400,
      minScore: 0.5,
      strict: false,
    },
    hasEmbeddingKey: false,
    hasChatKey: false,
    hasRerankKey: false,
  };
  const ws = () => ({
    root,
    name: "北岸阅读计划（合成）",
    managedProjectId: "qa-space",
    files: [],
    stats: currentStats(),
  });
  const currentStats = () =>
    clean && !store.documents.length
      ? {
          documents: 0,
          chunks: 0,
          vectors: 0,
          vectorDocuments: 0,
          embeddingReady: false,
        }
      : stats;
  const source = () => ({
    id: 1,
    path: store.documents[0].path,
    text: "甲方案：周二，120人。乙方案：周四，80人。资料未提供满意度、费用或长期效果。",
    heading: "两种活动",
    startLine: 7,
    endLine: 11,
    hash: store.files[store.documents[0].path].hash,
    score: 1,
    evidence: true,
    title: "阅读活动方案.md",
    documentId: "doc-1",
  });
  const wiki = {
    policy: {
      revision: 0,
      enabled: false,
      paused: false,
      automatic: false,
      topic: "",
      documentIds: [],
    },
    pages: [],
    changes: [],
    job: { status: "idle", message: "" },
  };
  const wikiSummary = {
    id: "qa-wiki",
    title: "北岸阅读活动",
    summary: "两种活动的对照。",
    revision: 1,
    sourceCount: 1,
    stale: false,
  };
  const wikiRef = () => ({ ...source(), quote: source().text });
  async function invoke(command, args = {}) {
    window.__INKSTONE_QA_CALLS__.push({ command, args: clone(args) });
    if (command === "plugin:event|listen") {
      const id = nextListener++;
      listeners.set(id, { id, event: args.event, handler: args.handler });
      return id;
    }
    if (command === "plugin:event|unlisten") {
      listeners.delete(args.eventId);
      return;
    }
    if (command === "plugin:dialog|open" && clean)
      return ["/qa/fixtures/阅读活动方案.md"];
    if (command.startsWith("plugin:")) return null;
    if (command === "bootstrap") return { settings, lastWorkspace: null };
    if (command === "web_search_settings")
      return { provider: "brave", enabled: false, hasKey: false };
    if (command === "test_web_search_connection")
      return {
        status: "page_unreadable",
        searchElapsedMs: 115,
        pageElapsedMs: 325,
        candidateCount: 3,
        httpStatus: 200,
      };
    if (command === "open_library") return ws();
    if (command === "library_import" && clean) {
      const original = templates.documents[0];
      const doc = {
        ...original,
        source: args.paths[0],
        projectId: args.projectId,
      };
      store.documents.push(doc);
      store.files[doc.path] = templates.files[doc.path];
      persist();
      return {
        jobId: "qa-first-import",
        projectId: args.projectId,
        cancelled: false,
        warnings: [],
        items: [
          {
            source: doc.source,
            status: "imported",
            message: "已复制",
            documentId: doc.id,
          },
        ],
      };
    }
    if (command === "library_list")
      return {
        projects: store.spaces,
        documents: [...store.documents].sort((a, b) => b.opened - a.opened),
        pendingImports: [],
      };
    if (command === "library_get_view")
      return (
        store.views?.[args.projectId] ?? {
          version: 1,
          sort: "nameAsc",
          pinnedCollapsed: false,
        }
      );
    if (command === "library_set_view") {
      store.views ??= {};
      store.views[args.projectId] = args.preferences;
      persist();
      return;
    }
    if (command === "library_trash") {
      const doc = store.documents.find((d) => d.id === args.id);
      doc.status = args.restore ? "ready" : "trashed";
      persist();
      return;
    }
    if (command === "library_trash_detail") {
      const doc = store.documents.find((d) => d.id === args.documentId);
      return {
        documentId: doc.id,
        projectId: doc.projectId,
        title: doc.title,
        status: doc.status,
        trashedAt: Date.now() / 1000,
        attachments: 1,
        history: 2,
        bytes: 2048,
        operationId: null,
      };
    }
    if (command === "library_purge_preview")
      return {
        detail: await invoke("library_trash_detail", args),
        token: "synthetic-preview",
        expiresAt: Date.now() / 1000 + 300,
      };
    if (command === "library_purge_execute") {
      if (args.confirmation !== "删除") throw Error("确认缺失");
      const doc = store.documents.find((d) => d.id === args.documentId);
      store.documents = store.documents.filter((d) => d.id !== args.documentId);
      if (doc) delete store.files[doc.path];
      persist();
      return {
        operationId: args.operationId,
        status: "completed",
        message: "已删除合成资料",
      };
    }
    if (command === "library_recovery_report")
      return { checkedAt: Date.now(), items: [] };
    if (command === "workspace_index_status")
      return {
        checkedAt: Date.now(),
        embeddingProfile: "qa",
        documents: store.documents.map((d) => ({
          path: d.path,
          title: d.title,
          documentId: d.id,
          included: true,
          sourceHash: store.files[d.path].hash,
          indexedHash: store.files[d.path].hash,
          keywordState: "ready",
          vectorState: "ready",
        })),
      };
    if (command === "workspace_pins") return [];
    if (command === "index_stats") return currentStats();
    if (command === "list_files") return [];
    if (command === "read_file") {
      const f = store.files[args.path];
      if (!f) throw Error("QA fixture source unavailable");
      const doc = store.documents.find((d) => d.path === args.path);
      if (doc) {
        doc.opened = Date.now() / 1000;
        persist();
      }
      return {
        path: args.path,
        content: f.content,
        hash: f.hash,
        draft: null,
        missing: false,
      };
    }
    if (command === "file_hash") return store.files[args.path]?.hash;
    if (
      command === "save_draft" ||
      command === "discard_draft" ||
      command === "library_mark_open"
    )
      return;
    if (command === "save_file") {
      store.files[args.path] = {
        content: args.content,
        hash: "qa-save-" + Date.now(),
      };
      persist();
      return {
        hash: store.files[args.path].hash,
        indexStale: true,
        warning: null,
      };
    }
    if (command === "library_create_document") {
      const id = "qa-answer-" + Date.now(),
        path = `documents/${id}/${args.title}`;
      const d = {
        id,
        projectId: "qa-space",
        path,
        title: args.title,
        source: "",
        updated: Date.now() / 1000,
        opened: 0,
        status: "ready",
      };
      store.documents.push(d);
      store.files[path] = { content: args.content, hash: "qa-answer-hash" };
      persist();
      return clone(d);
    }
    if (command === "wiki_status") return clone(wiki);
    if (command === "wiki_set_policy") {
      if (args.input.expectedRevision !== wiki.policy.revision)
        throw Error("旧的 Wiki 范围");
      const { expectedRevision, ...policy } = args.input;
      wiki.policy = { ...policy, revision: expectedRevision + 1 };
      return clone(wiki);
    }
    if (command === "wiki_compile") {
      if (!wiki.policy.enabled || !wiki.policy.documentIds.includes("doc-1"))
        throw Error("缺少 Wiki 授权资料");
      wiki.changes = [
        {
          id: "qa-wiki-change",
          pageId: wikiSummary.id,
          title: wikiSummary.title,
          status: "pending",
          reason: "首次整理",
          created: Date.now() / 1000,
          canRestore: false,
          sourceCount: 1,
        },
      ];
      wiki.job = { status: "ready", message: "已整理" };
      return clone(wiki);
    }
    if (command === "wiki_read") {
      if (!args.changeId && !wiki.pages.length) throw Error("暂无生效版本");
      return {
        ...wikiSummary,
        body: "### 阅读计划\n\n两种活动参加人数。",
        refs: [wikiRef()],
      };
    }
    if (command === "wiki_review") {
      if (args.input.id !== "qa-wiki-change" || args.input.action !== "publish")
        throw Error("非发布请求");
      wiki.changes[0].status = "published";
      wiki.pages = [wikiSummary];
      return clone(wiki);
    }
    if (command === "wiki_source") return wikiRef();
    if (command === "assistant_attachment_list") return [];
    if (command === "assistant_list")
      return clone(
        store.conversations
          .filter(
            (c) =>
              (args.includeArchived || !c.archived) &&
              c.title.toLowerCase().includes((args.query || "").toLowerCase()),
          )
          .map((c) => ({ ...c, turnCount: c.turns.length }))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(args.offset || 0, (args.offset || 0) + 200),
      );
    if (command === "assistant_create") {
      const c = {
        id: crypto.randomUUID(),
        title: args.title || "新会话",
        scope: args.scope ?? null,
        scopeLabel: args.general
          ? "通用问答"
          : args.scope
            ? "当前文档 · " + args.scope.split("/").at(-1)
            : "当前空间 · 北岸阅读计划（合成）",
        archived: false,
        draft: "",
        revision: 0,
        createdAt: now(),
        updatedAt: now(),
        activeLeafId: null,
        turns: [],
      };
      store.conversations.push(c);
      persist();
      return clone(c);
    }
    if (command.startsWith("assistant_")) {
      const c = store.conversations.find((c) => c.id === args.conversationId);
      if (!c) throw Error("会话已删除或不属于本空间");
      if (command === "assistant_get") return clone(c);
      if (command === "assistant_update") {
        for (const k of ["title", "archived", "draft", "activeLeafId"])
          if (args[k] !== undefined) c[k] = args[k];
        c.revision++;
        c.updatedAt = now();
        persist();
        return clone(c);
      }
      if (command === "assistant_delete") {
        store.conversations = store.conversations.filter((x) => x.id !== c.id);
        persist();
        return;
      }
      if (command === "assistant_export")
        return {
          json: JSON.stringify(c, null, 2),
          allMarkdown: c.turns
            .map(
              (t) =>
                "## 全部分支：" +
                t.question +
                "\n" +
                t.candidates.map((a) => a.response?.text || "").join("\n"),
            )
            .join("\n\n"),
          markdown: c.turns
            .map(
              (t) =>
                "## " +
                t.question +
                "\n\n" +
                (t.candidates.at(-1)?.response?.text || ""),
            )
            .join("\n\n"),
        };
      if (command === "assistant_select_candidate") {
        c.turns.find((t) => t.id === args.turnId).selectedCandidateId =
          args.candidateId;
        c.revision++;
        persist();
        return clone(c);
      }
      if (command === "assistant_save_running_draft") {
        const active = c.turns.find((t) => t.id === c.activeLeafId);
        const candidate = active?.candidates.find(
          (a) => a.id === active.selectedCandidateId,
        );
        if (
          c.archived ||
          candidate?.requestId !== args.requestId ||
          candidate.status !== "generating"
        )
          return false;
        c.draft = args.draft;
        c.revision++;
        c.updatedAt = now();
        persist();
        return true;
      }
      if (command === "assistant_ask") {
        if (!args.regenerateTurnId) c.draft = "";
        const t = args.regenerateTurnId
          ? c.turns.find((t) => t.id === args.regenerateTurnId)
          : {
              id: crypto.randomUUID(),
              parentTurnId: args.parentTurnId ?? null,
              question: args.question,
              createdAt: now(),
              selectedCandidateId: null,
              candidates: [],
            };
        if (!args.regenerateTurnId) c.turns.push(t);
        const candidate = {
          id: crypto.randomUUID(),
          requestId: args.requestId,
          requestedMode: args.retrievalMode,
          status: "generating",
          createdAt: now(),
          error: null,
          response: null,
        };
        t.candidates.push(candidate);
        t.selectedCandidateId = candidate.id;
        c.activeLeafId = t.id;
        if (c.title === "新会话") c.title = c.turns[0].question.slice(0, 30);
        c.revision++;
        persist();
        send("assistant-accepted", { requestId: args.requestId });
        const selectedSource = store.documents.length ? source() : null;
        const insufficient = /满意|更好/.test(t.question),
          text = insufficient
            ? "## 资料不足以判断满意度\n\n当前资料只记录时间和人数，没有满意度指标。人数较多不等于更受欢迎。\n\n建议补充问卷样本与调查口径。"
            : "## 甲方案参与人数较多\n\n甲方案为 **120人**，乙方案为 **80人**，相差 **40人**。[1]\n\n| 方案 | 时间 | 人数 |\n| --- | --- | --- |\n| 甲 | 周二 | 120 |\n| 乙 | 周四 | 80 |\n\n资料不足以判断满意度或方案优劣。";
        send("chat-status", {
          requestId: args.requestId,
          stage: "retrieving",
          detail: "QA合成协议桩：正在检索",
        });
        send("chat-sources", {
          requestId: args.requestId,
          sources: selectedSource ? [selectedSource] : [],
        });
        let partial = "";
        for (let i = 0; i < text.length; i += 12) {
          await new Promise((r) => setTimeout(r, 30));
          if (cancelled.has(args.requestId)) break;
          const delta = text.slice(i, i + 12);
          partial += delta;
          send("chat-delta", { requestId: args.requestId, delta });
        }
        candidate.status = cancelled.has(args.requestId)
          ? "stopped"
          : "complete";
        candidate.response = {
          text: partial,
          finishReason:
            candidate.status === "stopped"
              ? "cancelled"
              : insufficient
                ? "no_evidence"
                : "stop",
          sources: !args.general && selectedSource ? [selectedSource] : [],
          externalSources:
            args.general && selectedSource && args.sources?.projectId
              ? [
                  {
                    id: `doc-1:${selectedSource.startLine}-${selectedSource.endLine}`,
                    kind: "document",
                    label: selectedSource.title,
                    citation: 1,
                    excerpt: selectedSource.text,
                    contentHash: selectedSource.hash,
                    projectId: "qa-space",
                    documentId: "doc-1",
                  },
                ]
              : [],
          trace: args.general
            ? {
                route: args.sources?.projectId ? "local" : "direct",
                steps: [],
                unread: [],
              }
            : undefined,
          warning: null,
          retrievalMode: "bm25",
          rerankStatus: "not-requested",
          model: "QA fixture · no provider request",
          chartWarnings: [],
          rejectedCharts: [],
        };
        c.revision++;
        c.updatedAt = now();
        persist();
        return clone(c);
      }
    }
    if (command === "cancel_chat") {
      cancelled.add(args.requestId);
      return;
    }
    if (command === "companion_state") return clone(store.companion);
    if (command === "companion_settings") {
      Object.assign(store.companion.settings, args.input);
      store.companion.revision++;
      persist();
      return clone(store.companion);
    }
    if (command === "companion_preview")
      return {
        token: "qa-preview",
        eventId: "qa-event",
        suggestedText: "完成一份资料整理（合成UI验收）",
        day: "2026-11-05",
        canRevise: false,
        expiresAt: Date.now() / 1000 + 900,
        context: {
          generation: store.companion.generation,
          revision: store.companion.revision,
        },
      };
    if (command === "companion_confirm") {
      const s = store.companion;
      if (!s.cards.some((c) => c.id === args.input.eventId)) {
        s.events++;
        s.days = 1;
        s.cards.push({
          id: args.input.eventId,
          text: args.input.text,
          spaceId: "qa-space",
          day: "2026-11-05",
          characterId: s.settings.characterId,
          kind: args.input.kind,
        });
      }
      s.revision++;
      persist();
      return { status: "counted", snapshot: clone(s) };
    }
    if (command === "companion_story") {
      const s = store.companion,
        id = args.input.characterId;
      s.roles[id] ||= { read: [], choices: {}, outfit: 0 };
      if (!s.roles[id].read.includes(args.input.stage))
        s.roles[id].read.push(args.input.stage);
      s.roles[id].outfit = args.input.stage;
      s.revision++;
      persist();
      return clone(s);
    }
    if (command === "companion_export")
      return JSON.stringify(store.companion, null, 2);
    window.__INKSTONE_QA_UNKNOWN__.push(command);
    return null;
  }
  window.__INKSTONE_QA_CALLS__ = [];
  window.__INKSTONE_QA_UNKNOWN__ = [];
  window.__TAURI_INTERNALS__ = {
    invoke,
    transformCallback(fn) {
      const id = nextCallback++;
      callbacks.set(id, fn);
      return id;
    },
    unregisterCallback(id) {
      callbacks.delete(id);
    },
    convertFileSrc(path) {
      return path;
    },
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main", windowLabel: "main" },
    },
  };
  localStorage.setItem("inkstone:workspaceMode", "library");
  localStorage.setItem("inkstone:panel-open", clean ? "false" : "true");
  if (store.documents[0] && !clean)
    localStorage.setItem(
      "inkstone:session:" + root,
      JSON.stringify({ path: store.documents[0].path, mode: "visual" }),
    );
  persist();
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener(_event, id) {
      listeners.delete(id);
    },
  };
  window.isTauri = true;
  window.__INKSTONE_QA_FIXTURE__ = true;
}
