import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { createPortal } from "react-dom";
import {
  BookOpen,
  Leaf,
  Settings2,
  ChevronDown,
  X,
  Heart,
  Image as ImageIcon,
} from "lucide-react";
import ModalDialog from "../ModalDialog";
import { isImeEvent } from "../platform/ime";
import type { LibraryView } from "../library";
import type { Workspace } from "../types";
import stories from "./stories.json";
import { characterArt, cgArt } from "./art";
import {
  characters,
  contextOf,
  roleLevel,
  stages,
  type CharacterId,
  type Snapshot,
  type Preview,
  type StoryCharacter,
  type Pending,
  type CompanionRecall,
} from "./types";
import "./companion.css";

import ExperienceJournal from "./ExperienceJournal";
import MotuanSprite from "./MotuanSprite";
import CompanionPet from "./CompanionPet";
import StoryReader, { storyBookmark } from "./StoryReader";
import {
  CharacterPicker,
  GrowthOverview,
  AlbumCards,
  MotuanBonusScene,
  motuanBonusTitle,
  StoryContent,
} from "./CompanionViews";

type View =
  | "pet"
  | "choose"
  | "growth"
  | "journal"
  | "stories"
  | "album"
  | "settings"
  | "preview"
  | "story"
  | "cg"
  | "motuan-bonus"
  | "reset";
const storyData = stories.characters as StoryCharacter[];
const petStorageKey = "inkstone:companion:pet-generation";
const viewTitles: Partial<Record<View, string>> = {
  pet: "桌宠",
  choose: "选择书房同伴",
  growth: "成长",
  journal: "经历",
  stories: "故事",
  album: "相册",
  settings: "偏好与数据",
  preview: "记录本次完成",
  reset: "清空同伴数据？",
  "motuan-bonus": motuanBonusTitle,
};

function CompanionPage({
  label,
  onClose,
  busy,
  className,
  children,
}: {
  label: string;
  onClose: () => void;
  busy: boolean;
  className: string;
  children: ReactNode;
}) {
  const page = useRef<HTMLElement>(null);
  useEffect(() => {
    const container = page.current;
    container?.focus();
    const content = container?.querySelector(".companion-dialog-content");
    if (content) content.scrollTop = 0;
  }, [label]);
  return (
    <section
      ref={page}
      className={`companion-workspace-page ${className}`}
      aria-label={label}
      aria-busy={busy || undefined}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || busy || isImeEvent(event.nativeEvent))
          return;
        event.stopPropagation();
        onClose();
      }}
    >
      {children}
    </section>
  );
}

export default function CompanionDock({
  workspace,
  documentPath,
  documentHash,
  saved = true,
  saveSerial,
  activity = "idle",
  activityText,
  libraryRevision,
  onOpenSource,
  surface,
}: {
  workspace: Workspace | null;
  documentPath: string | null;
  documentHash: string | null;
  saved?: boolean;
  saveSerial?: number;
  activity?: "working" | "needs_input" | "ready" | "blocked" | "idle";
  activityText?: string;
  libraryRevision?: LibraryView;
  onOpenSource?: (path: string) => Promise<boolean>;
  surface?: {
    open: boolean;
    showPet: boolean;
    navigationHost?: HTMLElement | null;
    onOpen: () => void;
    onClose: () => void;
  };
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [view, setView] = useState<View | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [milestone, setMilestone] = useState(false);
  const [petGeneration, setPetGeneration] = useState(() => {
    try {
      return localStorage.getItem(petStorageKey);
    } catch {
      return null;
    }
  });
  const inWorkspace = surface?.open === true;
  const managed = surface !== undefined;
  const requestedPage = useRef<View>("pet");
  const setPet = (visible: boolean) => {
    const generation = visible ? (snapshot?.generation ?? null) : null;
    setPetGeneration(generation);
    try {
      if (generation) localStorage.setItem(petStorageKey, generation);
      else localStorage.removeItem(petStorageKey);
    } catch {
      /* Visibility can still change for this session. */
    }
  };
  const [selected, setSelected] = useState<CharacterId>("motuan"),
    [stage, setStage] = useState(0),
    [choice, setChoice] = useState<string | null>(null),
    [preview, setPreview] = useState<Preview | null>(null),
    [text, setText] = useState(""),
    [kind, setKind] = useState("complete"),
    [consent, setConsent] = useState(false);
  const epoch = useRef(0),
    live = useRef(true);
  const root = workspace?.root ?? "";
  const refresh = useCallback(async (clearError = true) => {
    const requestEpoch = epoch.current;
    try {
      const s = await invoke<Snapshot>("companion_state");
      if (live.current && requestEpoch === epoch.current && s?.settings) {
        setSnapshot(s);
        if (clearError) setError("");
      }
    } catch (e) {
      if (live.current && requestEpoch === epoch.current) setError(String(e));
    }
  }, []);
  useEffect(() => {
    live.current = true;
    void refresh();
    return () => {
      live.current = false;
    };
  }, [refresh]);
  useEffect(() => {
    epoch.current++;
    setView(null);
    setPreview(null);
    setBusy(false);
    setMilestone(false);
    void refresh();
  }, [root, refresh]);
  useEffect(() => {
    if (!managed) return;
    setView(inWorkspace ? requestedPage.current : null);
    requestedPage.current = "pet";
  }, [inWorkspace, managed, root]);
  useEffect(() => {
    void refresh();
  }, [documentHash, saveSerial, refresh]);
  const run = async <T,>(
    task: () => Promise<T>,
    after?: (value: T) => void,
  ) => {
    if (busy) return;
    const requestEpoch = epoch.current;
    setBusy(true);
    setError("");
    try {
      const r = await task();
      if (live.current && requestEpoch === epoch.current) after?.(r);
    } catch (e) {
      if (live.current && requestEpoch === epoch.current) {
        setError(String(e));
        void refresh(false);
      }
    } finally {
      if (live.current && requestEpoch === epoch.current) setBusy(false);
    }
  };
  const settings = snapshot?.settings;
  const [recallResult, setRecallResult] = useState<{
    key: string;
    data: CompanionRecall;
    library?: LibraryView;
  }>();
  const recallKey = JSON.stringify([
    root,
    snapshot?.generation,
    snapshot?.revision,
    documentHash,
    saveSerial,
    view === "journal",
  ]);
  const readRecall =
    !!workspace?.managedProjectId &&
    ((view === "journal" && (!managed || inWorkspace)) ||
      ((!managed || (inWorkspace && view === "pet")) &&
        settings?.enabled &&
        snapshot?.recallEnabled));
  const recall =
    readRecall &&
    recallResult?.key === recallKey &&
    recallResult.library === libraryRevision
      ? recallResult.data
      : undefined;
  useEffect(() => {
    if (!readRecall) return;
    let alive = true;
    let pending = false;
    function read() {
      if (pending || document.hidden) return;
      pending = true;
      void invoke<CompanionRecall>("companion_recall", {
        workspaceRoot: root,
        journal: view === "journal",
      })
        .then(
          (data) => {
            if (alive)
              setRecallResult({
                key: recallKey,
                data,
                library: libraryRevision,
              });
          },
          () => {
            if (alive) setRecallResult(undefined);
          },
        )
        .finally(() => {
          pending = false;
        });
    }
    read();
    const interval = setInterval(read, 10000);
    document.addEventListener("visibilitychange", read);
    return () => {
      alive = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", read);
    };
  }, [readRecall, recallKey, root, view, libraryRevision]);
  const role = settings?.characterId ?? "motuan",
    r = characters[role],
    progress = snapshot?.roles[role],
    level = roleLevel(progress),
    outfit = progress?.outfit ?? level;
  useEffect(() => {
    if (!milestone) return;
    const timeout = setTimeout(() => setMilestone(false), 2600);
    return () => clearTimeout(timeout);
  }, [milestone]);
  const updateSettings = (
    patch: Partial<NonNullable<typeof settings>> & { outfit?: number },
  ) => {
    if (!snapshot) return;
    void run(
      () =>
        invoke<Snapshot>("companion_settings", {
          input: {
            context: contextOf(snapshot),
            ...snapshot.settings,
            ...patch,
            timezone:
              snapshot.events === 0
                ? Intl.DateTimeFormat().resolvedOptions().timeZone
                : null,
          },
        }),
      (next) => {
        setSnapshot(next);
        if (!next.settings.enabled || next.settings.characterId !== "motuan") {
          setMilestone(false);
        }
      },
    );
  };
  const openStory = (n: number) => {
    setStage(n);
    setChoice(progress?.choices.c1 ?? null);
    setView("story");
  };
  const startPreview = () => {
    if (!workspace || !documentPath || !saved) return;
    setConsent(false);
    setKind("complete");
    void run(
      () =>
        invoke<Preview>("companion_preview", {
          path: documentPath,
          workspaceRoot: workspace.root,
        }),
      (p) => {
        setPreview(p);
        setText(p.suggestedText);
        setView("preview");
      },
    );
  };
  const confirm = (
    p: Pick<Preview, "token" | "eventId">,
    cardText: string,
    cardKind: string,
  ) => {
    if (!snapshot || !workspace) return;
    void run(
      () =>
        invoke<{ status: string; snapshot: Snapshot }>("companion_confirm", {
          workspaceRoot: workspace.root,
          input: {
            context: contextOf(snapshot),
            token: p.token,
            eventId: p.eventId,
            text: cardText,
            kind: cardKind,
            consent: true,
          },
        }),
      (result) => {
        setSnapshot(result.snapshot);
        setView(inWorkspace ? "pet" : null);
        setPreview(null);
        if (
          role === "motuan" &&
          result.status === "counted" &&
          cardKind === "milestone"
        ) {
          setMilestone(true);
        }
        setNotice(
          result.status === "counted"
            ? "经历已记录。新章节会安静留在同伴入口。"
            : result.status === "daily_limit"
              ? "今天的有效经历已达上限，工作仍可继续。"
              : "该经历已经记录，没有重复计入。",
        );
      },
    );
  };
  const retry = (p: Pending) => confirm(p, p.text, p.kind);
  const finishStory = (skipped: boolean) => {
    if (!snapshot) return;
    void run(
      () =>
        invoke<Snapshot>("companion_story", {
          input: {
            context: contextOf(snapshot),
            characterId: role,
            stage,
            skipped,
            choiceId: choice,
          },
        }),
      (s) => {
        setSnapshot(s);
        setView("stories");
        setNotice("章节已处理，形象与相册已更新。");
        if (
          role === "motuan" &&
          stage > 0 &&
          !progress?.read.includes(stage) &&
          s.roles.motuan?.read.includes(stage)
        ) {
          setMilestone(true);
        }
      },
    );
  };
  const cardMutation = async (id: string, value: string | null) => {
    if (!snapshot) return false;
    let ok = false;
    await run(
      () =>
        invoke<Snapshot>("companion_card", {
          input: { context: contextOf(snapshot), id, text: value },
        }),
      (s) => {
        setSnapshot(s);
        ok = true;
      },
    );
    return ok;
  };
  const exportData = () =>
    void run(
      () => invoke<string>("companion_export"),
      (raw) => {
        const a = document.createElement("a"),
          url = URL.createObjectURL(
            new Blob([raw], { type: "application/json" }),
          );
        a.href = url;
        a.download = "Inkstone-同伴数据.json";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setNotice("同伴数据已导出；不包含API密钥或工作正文。");
      },
    );
  const episodes = storyData.find((s) => s.id === role)?.episodes ?? [];
  const episode = episodes[stage];
  const canRead = (stageNumber: number) =>
    progress?.read.includes(stageNumber) === true ||
    (!!settings?.enabled && snapshot?.eligible === stageNumber);
  const petEnabled =
    !!snapshot && !!settings?.enabled && petGeneration === snapshot.generation;
  const closeView = () => {
    setNotice("");
    setView(null);
    surface?.onClose();
  };
  const ViewContainer = inWorkspace ? CompanionPage : ModalDialog;
  const title =
    view === "story" || view === "cg"
      ? (episode?.title ?? "角色故事")
      : (view && viewTitles[view]) || "书房手札";
  const pending = snapshot?.pending ?? [];
  const activityLabel = pending.length
    ? "工作已保存，经历待保存"
    : activity === "blocked"
      ? activityText || "本次问答未完成，请查看错误与重试"
      : activity === "working"
        ? activityText || "正在处理本次问答…"
        : activity === "needs_input"
          ? activityText || "等待你的确认"
          : activity === "ready"
            ? activityText || "回答已完成，可核对依据"
            : "";
  const navigation = (
    <nav aria-label={inWorkspace ? "同伴功能" : "同伴手札"}>
      {inWorkspace && surface?.navigationHost && <h2>书房同伴</h2>}
      {inWorkspace && (
        <button
          type="button"
          disabled={busy}
          aria-current={view === "pet" ? "page" : undefined}
          onClick={() => setView("pet")}
        >
          桌宠
        </button>
      )}
      <button
        disabled={busy}
        aria-current={view === "growth" ? "page" : undefined}
        onClick={() => setView("growth")}
      >
        成长
      </button>
      <button
        disabled={busy}
        aria-current={view === "journal" ? "page" : undefined}
        onClick={() => setView("journal")}
      >
        经历
      </button>
      <button
        disabled={busy}
        aria-current={
          view === "stories" || (inWorkspace && view === "story")
            ? "page"
            : undefined
        }
        onClick={() => setView("stories")}
      >
        故事
      </button>
      <button
        disabled={busy}
        aria-current={
          view === "album" ||
          (inWorkspace && (view === "cg" || view === "motuan-bonus"))
            ? "page"
            : undefined
        }
        onClick={() => setView("album")}
      >
        相册
      </button>
      <button
        disabled={busy}
        aria-current={view === "settings" ? "page" : undefined}
        onClick={() => setView("settings")}
      >
        偏好与数据
      </button>
      {inWorkspace &&
        surface?.navigationHost &&
        (view === "stories" || view === "story") && (
          <section className="companion-season-nav" aria-label="第一季">
            <p>{r.name} · 第一季</p>
            {episodes.map((ep) => (
              <button
                key={ep.id}
                type="button"
                disabled={busy || !canRead(ep.stage)}
                aria-current={
                  view === "story" && stage === ep.stage ? "page" : undefined
                }
                onClick={() => openStory(ep.stage)}
              >
                {ep.stage + 1}. {ep.title}
              </button>
            ))}
          </section>
        )}
    </nav>
  );
  if (surface && !inWorkspace) {
    if (!surface.showPet || !petEnabled || !settings) return null;
    return (
      <CompanionPet
        role={role}
        outfit={outfit}
        moving={settings.mode === "gentle" && !settings.reducedMotion}
        quiet={settings.mode === "focus"}
        milestone={milestone}
        working={activity === "working"}
        busy={busy}
        onQuiet={() =>
          updateSettings({
            mode: settings.mode === "focus" ? "gentle" : "focus",
          })
        }
        onHide={() => setPet(false)}
        onStories={() => {
          requestedPage.current = "stories";
          surface.onOpen();
        }}
      />
    );
  }
  return (
    <section
      className={inWorkspace ? "companion-workspace" : "companion-dock"}
      aria-label={inWorkspace ? "书房同伴工作区" : "书房同伴"}
      data-activity={pending.length ? "needs_input" : activity}
    >
      {!inWorkspace &&
        (!settings?.enabled ? (
          <div className="companion-invitation">
            <Leaf size={16} />
            <span>书房同伴</span>
            <button
              type="button"
              onClick={() => {
                setSelected(role);
                setView("choose");
              }}
            >
              认识同伴
            </button>
            {snapshot && (
              <button
                type="button"
                aria-label="同伴数据设置"
                onClick={() => setView("settings")}
              >
                <Settings2 size={15} />
              </button>
            )}
          </div>
        ) : (
          <>
            <div
              className={
                settings.compact ? "companion-mini" : "companion-summary"
              }
            >
              {role === "motuan" ? (
                <MotuanSprite
                  mood={
                    milestone
                      ? "milestone"
                      : activity === "working"
                        ? "reading"
                        : "idle"
                  }
                  outfit={outfit}
                  animate={
                    settings.mode === "gentle" && !settings.reducedMotion
                  }
                />
              ) : (
                <img
                  src={characterArt(role, outfit)}
                  alt={`${r.name} ${stages[outfit]}阶段预览插画`}
                />
              )}
              <div>
                <strong>
                  {r.name}
                  <span className="companion-stage">{stages[level]}</span>
                </strong>
                <p>
                  {activityLabel ||
                    (settings.mode === "gentle"
                      ? r.quote
                      : "专注陪读 · 固定故事离线可用")}
                </p>
              </div>
              <button
                type="button"
                aria-label={settings.compact ? "展开同伴" : "收起同伴"}
                title={settings.compact ? "展开同伴" : "收起同伴"}
                onClick={() => updateSettings({ compact: !settings.compact })}
              >
                <ChevronDown size={16} />
              </button>
              <button
                type="button"
                aria-label="同伴设置"
                onClick={() => setView("settings")}
              >
                <Settings2 size={16} />
              </button>
            </div>
            {recall?.recent && settings.enabled && snapshot?.recallEnabled && (
              <button
                type="button"
                className="companion-recent"
                title="在手札中查看"
                onClick={() => setView("journal")}
              >
                <BookOpen size={14} />
                <span>
                  <small>最近一起完成 · {recall.recent.day}</small>
                  <strong>{recall.recent.text}</strong>
                </span>
              </button>
            )}
            {settings.compact && (
              <div className="companion-compact-actions">
                <button type="button" onClick={() => setView("journal")}>
                  <BookOpen size={13} />
                  手札
                </button>
                <button
                  type="button"
                  disabled={
                    busy ||
                    !saved ||
                    !documentPath ||
                    !workspace?.managedProjectId
                  }
                  onClick={startPreview}
                >
                  本次完成
                </button>
              </div>
            )}
            {!settings.compact && (
              <div className="companion-links">
                <button type="button" onClick={() => setView("growth")}>
                  <BookOpen size={13} />
                  手札
                </button>
                <button type="button" onClick={() => setView("stories")}>
                  故事
                </button>
                <button type="button" onClick={() => setView("album")}>
                  <ImageIcon size={13} />
                  相册
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setNotice(
                      settings.mode === "gentle"
                        ? r.quote
                        : "同伴安静陪读。轻互动不会计入成长。",
                    )
                  }
                >
                  <Heart size={13} />
                  纸签
                </button>
                <button
                  type="button"
                  disabled={
                    busy ||
                    !saved ||
                    !documentPath ||
                    !workspace?.managedProjectId
                  }
                  onClick={startPreview}
                >
                  本次完成
                </button>
              </div>
            )}
            {snapshot?.eligible != null && (
              <div className="companion-ready">
                <span>{stages[snapshot.eligible]}章节可阅读</span>
                <button
                  type="button"
                  onClick={() => openStory(snapshot.eligible!)}
                >
                  打开新章
                </button>
              </div>
            )}
            {pending.length > 0 && (
              <div className="companion-pending">
                {pending.length}条经历待保存
                <button type="button" onClick={() => setView("journal")}>
                  查看与重试
                </button>
              </div>
            )}
          </>
        ))}
      {!inWorkspace && notice && (
        <div className="companion-notice" role="status">
          {notice}
          <button
            type="button"
            aria-label="关闭同伴提示"
            onClick={() => setNotice("")}
          >
            <X size={12} />
          </button>
        </div>
      )}
      {!inWorkspace && error && !view && (
        <p className="companion-error" role="status">
          {error}
          <button type="button" onClick={() => void refresh()}>
            重试
          </button>
        </p>
      )}
      {view && (
        <ViewContainer
          label={title}
          onClose={closeView}
          busy={busy}
          className="companion-dialog"
        >
          <header>
            <div>
              <h2>{title}</h2>
              <p>
                {view === "choose"
                  ? "所有用户自由选择，知识与工具能力相同。"
                  : inWorkspace
                    ? "书房同伴 · 本机进度"
                    : "经历、剧情和偏好保存在本机，不作为文档问答证据。"}
              </p>
            </div>
            <button
              type="button"
              aria-label={inWorkspace ? "返回工作区" : "关闭同伴面板"}
              disabled={busy}
              onClick={closeView}
            >
              <X size={18} />
            </button>
          </header>
          {(inWorkspace ||
            ![
              "choose",
              "preview",
              "story",
              "cg",
              "motuan-bonus",
              "reset",
            ].includes(view)) &&
            (inWorkspace && surface?.navigationHost
              ? createPortal(navigation, surface.navigationHost)
              : navigation)}
          <div className="companion-dialog-content">
            {inWorkspace && notice && (
              <div className="companion-notice" role="status">
                {notice}
                <button
                  type="button"
                  aria-label="关闭同伴提示"
                  onClick={() => setNotice("")}
                >
                  <X size={12} />
                </button>
              </div>
            )}
            {error && (
              <p role="alert" className="companion-error">
                {error}
              </p>
            )}
            {!snapshot && (
              <p>
                正在读取同伴资料…
                <button onClick={() => void refresh()}>重试</button>
              </p>
            )}
            {view === "choose" && snapshot && (
              <CharacterPicker selected={selected} onSelect={setSelected} />
            )}
            {view === "pet" && snapshot && (
              <div className="companion-pet-overview">
                <div className="companion-profile">
                  {role === "motuan" ? (
                    <MotuanSprite
                      mood={milestone ? "milestone" : "idle"}
                      outfit={outfit}
                      animate={
                        milestone &&
                        settings?.mode === "gentle" &&
                        !settings.reducedMotion
                      }
                    />
                  ) : (
                    <img src={characterArt(role, outfit)} alt={r.name} />
                  )}
                  <div>
                    <h3>
                      {r.name} · {stages[level]}
                    </h3>
                    <p>{r.description}</p>
                    {settings?.enabled && (
                      <p>
                        {petEnabled ? "桌宠在文档工作区可见" : "桌宠已收起"}
                      </p>
                    )}
                  </div>
                </div>
                <div className="companion-workspace-actions">
                  {!settings?.enabled ? (
                    <button
                      type="button"
                      className="primary"
                      onClick={() => {
                        setSelected(role);
                        setView("choose");
                      }}
                    >
                      认识同伴
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="primary"
                        onClick={() => setPet(!petEnabled)}
                      >
                        {petEnabled ? "收起桌宠" : "显示桌宠"}
                      </button>
                      <button type="button" onClick={() => setView("stories")}>
                        阅读故事
                      </button>
                      <button
                        type="button"
                        disabled={
                          busy ||
                          !saved ||
                          !documentPath ||
                          !workspace?.managedProjectId
                        }
                        onClick={startPreview}
                      >
                        本次完成
                      </button>
                    </>
                  )}
                </div>
                {recall?.recent && (
                  <button
                    className="companion-recent"
                    type="button"
                    onClick={() => setView("journal")}
                  >
                    <BookOpen size={15} />
                    <span>
                      <small>最近一起完成 · {recall.recent.day}</small>
                      <strong>{recall.recent.text}</strong>
                    </span>
                  </button>
                )}
                {pending.length > 0 && (
                  <button
                    className="companion-pending"
                    type="button"
                    onClick={() => setView("journal")}
                  >
                    {pending.length} 条经历待保存 · 查看与重试
                  </button>
                )}
              </div>
            )}
            {view === "growth" && snapshot && (
              <GrowthOverview
                snapshot={snapshot}
                busy={busy}
                onStory={openStory}
              />
            )}
            {view === "journal" && snapshot && (
              <ExperienceJournal
                snapshot={snapshot}
                spaceId={workspace?.managedProjectId}
                busy={busy}
                onRetry={retry}
                onCard={cardMutation}
                sourceStatuses={recall?.statuses}
                onOpenSource={
                  onOpenSource &&
                  ((cardId) =>
                    void run(
                      () =>
                        invoke<string>("companion_recall_source", {
                          workspaceRoot: root,
                          cardId,
                        }),
                      (path) => {
                        void onOpenSource(path)
                          .then((opened) => {
                            if (opened) setView(null);
                          })
                          .catch((error) => setError(String(error)));
                      },
                    ))
                }
              />
            )}
            {view === "stories" && (
              <div className="companion-story-list">
                {inWorkspace && (
                  <p className="companion-season">
                    {r.name} · 第一季 · 书房来客
                  </p>
                )}
                {episodes.map((ep) => (
                  <article key={ep.id}>
                    <span>{stages[ep.stage]}</span>
                    <h3>{ep.title}</h3>
                    <p>{ep.paragraphs[0].slice(0, 54)}…</p>
                    <button
                      disabled={
                        busy ||
                        (!progress?.read.includes(ep.stage) &&
                          (!settings?.enabled ||
                            snapshot?.eligible !== ep.stage))
                      }
                      onClick={() => openStory(ep.stage)}
                    >
                      {progress?.read.includes(ep.stage)
                        ? "重看故事"
                        : !settings?.enabled || snapshot?.eligible !== ep.stage
                          ? "尚未解锁"
                          : inWorkspace &&
                              snapshot &&
                              (storyBookmark(
                                snapshot.generation,
                                ep.id,
                              ).read() ?? 0) > 0
                            ? "继续阅读"
                            : "阅读章节"}
                    </button>
                  </article>
                ))}
              </div>
            )}
            {view === "album" && (
              <AlbumCards
                role={role}
                read={progress?.read ?? []}
                episodes={episodes}
                onOpen={(n) => {
                  setStage(n);
                  setView("cg");
                }}
                onOpenMotuanBonus={() => setView("motuan-bonus")}
              />
            )}
            {view === "story" &&
              episode &&
              snapshot &&
              (inWorkspace ? (
                <StoryReader
                  key={episode.id}
                  generation={snapshot.generation}
                  role={role}
                  episode={episode}
                  read={progress?.read.includes(stage) === true}
                  choice={choice}
                  lockedChoice={!!progress?.choices.c1}
                  busy={busy}
                  canFinish={!!settings?.enabled}
                  onChoice={setChoice}
                  onFinish={() =>
                    progress?.read.includes(stage) &&
                    (!choice || !!progress.choices.c1)
                      ? setView("stories")
                      : finishStory(false)
                  }
                  onSkip={() => finishStory(true)}
                />
              ) : (
                <StoryContent
                  role={role}
                  episode={episode}
                  stage={stage}
                  busy={busy}
                  choice={choice}
                  lockedChoice={!!progress?.choices.c1}
                  onChoice={setChoice}
                />
              ))}
            {view === "cg" && (
              <figure className="companion-full-cg">
                <img
                  src={cgArt(role, stage)}
                  alt={`${r.name} ${episode?.title}CG预览`}
                />
                <figcaption>书房故事预览插画 · 虚构文字与场景</figcaption>
              </figure>
            )}
            {view === "motuan-bonus" && <MotuanBonusScene />}
            {view === "preview" && preview && (
              <>
                <p>工作已成功保存。确认后保存这张经历卡；取消不会增加成长。</p>
                <label>
                  拟存经历
                  <textarea
                    maxLength={160}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                  />
                </label>
                <label>
                  经历类型
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value)}
                  >
                    <option value="complete">完成一份笔记</option>
                    <option value="milestone">确认项目里程碑</option>
                    <option value="revision" disabled={!preview.canRevise}>
                      复盘一次已有记录
                    </option>
                  </select>
                </label>
                <p>有效日：{preview.day}。同一文档同日不重复，每日最多两条。</p>
                <label className="companion-check">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  我确认保存以上经历卡内容，不包含未同意保留的私人信息。
                </label>
              </>
            )}
            {view === "settings" && snapshot && (
              <>
                <div className="companion-settings-grid">
                  <label>
                    陪伴模式
                    <select
                      value={settings?.mode}
                      disabled={busy}
                      onChange={(e) =>
                        updateSettings({
                          mode: e.target.value as "focus" | "gentle",
                        })
                      }
                    >
                      <option value="focus">专注</option>
                      <option value="gentle">温和陪伴</option>
                    </select>
                  </label>
                  <label>
                    当前形象
                    <select
                      value={outfit}
                      disabled={busy}
                      onChange={(e) =>
                        updateSettings({ outfit: Number(e.target.value) })
                      }
                    >
                      {stages.slice(0, level + 1).map((n, i) => (
                        <option key={n} value={i}>
                          {n} · 已解锁
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="companion-check">
                  <input
                    type="checkbox"
                    checked={settings?.enabled ?? false}
                    disabled={busy}
                    onChange={(e) =>
                      updateSettings({ enabled: e.target.checked })
                    }
                  />
                  开启角色陪伴；关闭后不新增经历、不补记历史
                </label>
                <label className="companion-check">
                  <input
                    type="checkbox"
                    checked={settings?.reducedMotion ?? true}
                    disabled={busy}
                    onChange={(e) =>
                      updateSettings({ reducedMotion: e.target.checked })
                    }
                  />
                  减少动态效果
                </label>
                {role === "motuan" && (
                  <p className="companion-note">
                    墨团动效在温和陪伴中播放。专注模式、减少动态或 macOS
                    的减少动态设置会让形象保持静止。
                  </p>
                )}
                <button
                  onClick={() => {
                    setSelected(role);
                    setView("choose");
                  }}
                >
                  更换角色
                </button>
                <label>
                  <input
                    type="checkbox"
                    checked={!!snapshot.recallEnabled}
                    disabled={busy}
                    onChange={(event) => {
                      const enabled = event.target.checked;
                      void run(
                        () =>
                          invoke<Snapshot>("companion_recall_setting", {
                            context: contextOf(snapshot),
                            enabled,
                          }),
                        setSnapshot,
                      );
                    }}
                  />
                  回顾最近一起完成的事
                </label>
                <p className="companion-note">
                  开启后，在当前空间显示这个角色近 30
                  天的一条已确认经历。来源版本校验通过才展示，经历保存在本机。
                </p>
                <p className="companion-note">回答偏好可在问答工具栏中管理。</p>
                {snapshot.preferences
                  .filter((preference) => preference.key === "nickname")
                  .map((preference) => (
                    <div className="companion-preference" key={preference.id}>
                      <span>保留的旧称呼 · {preference.value}</span>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () =>
                              invoke<Snapshot>("companion_preference", {
                                input: {
                                  ...preference,
                                  context: contextOf(snapshot),
                                  delete: true,
                                },
                              }),
                            setSnapshot,
                          )
                        }
                      >
                        删除旧称呼
                      </button>
                    </div>
                  ))}
                <div className="companion-data-actions">
                  <button disabled={busy} onClick={exportData}>
                    导出同伴数据
                  </button>
                  <button disabled={busy} onClick={() => setView("reset")}>
                    清空同伴数据…
                  </button>
                </div>
              </>
            )}
            {view === "reset" && (
              <>
                <p>
                  将清除同伴设置、经历卡、去重账本、故事进度、形象/CG解锁、偏好与待存内容。
                </p>
                <p>
                  工作文档、知识会话、索引和API密钥保留。你已有的历史备份仍可能含删除前的数据，恢复时请核对范围。
                </p>
              </>
            )}
          </div>
          <footer>
            <span>
              {busy
                ? "正在保存…"
                : view === "story"
                  ? "关闭不等于读完；可以稍后重看。"
                  : "像素水墨预览资源 · 所有资料保存在本机"}
            </span>
            {view === "choose" ? (
              <>
                <button
                  disabled={busy}
                  onClick={() => setView(inWorkspace ? "pet" : null)}
                >
                  稍后
                </button>
                <button
                  className="primary"
                  disabled={busy || !snapshot}
                  onClick={() => {
                    if (!snapshot) return;
                    void run(
                      () =>
                        invoke<Snapshot>("companion_settings", {
                          input: {
                            context: contextOf(snapshot),
                            ...snapshot.settings,
                            enabled: true,
                            characterId: selected,
                            timezone:
                              snapshot.events === 0
                                ? Intl.DateTimeFormat().resolvedOptions()
                                    .timeZone
                                : null,
                          },
                        }),
                      (s) => {
                        setSnapshot(s);
                        if (selected !== role) setMilestone(false);
                        setStage(0);
                        setChoice(null);
                        setView(
                          s.roles[selected]?.read.includes(0)
                            ? "growth"
                            : "story",
                        );
                      },
                    );
                  }}
                >
                  与{characters[selected].name}相遇
                </button>
              </>
            ) : view === "preview" && preview ? (
              <>
                <button
                  disabled={busy}
                  onClick={() => setView(inWorkspace ? "pet" : null)}
                >
                  暂不记录
                </button>
                <button
                  className="primary"
                  disabled={busy || !consent || !text.trim()}
                  onClick={() => confirm(preview, text, kind)}
                >
                  确认并记录
                </button>
              </>
            ) : view === "story" && !inWorkspace ? (
              <>
                <button disabled={busy} onClick={() => finishStory(true)}>
                  明确跳过本章
                </button>
                <button
                  className="primary"
                  disabled={busy || (stage === 2 && !choice)}
                  onClick={() => finishStory(false)}
                >
                  读完这一章
                </button>
              </>
            ) : view === "reset" ? (
              <>
                <button disabled={busy} onClick={() => setView("settings")}>
                  保留数据
                </button>
                <button
                  className="danger"
                  disabled={busy || !snapshot}
                  onClick={() => {
                    if (snapshot)
                      void run(
                        () =>
                          invoke<Snapshot>("companion_reset", {
                            context: contextOf(snapshot),
                          }),
                        (s) => {
                          setSnapshot(s);
                          setMilestone(false);
                          setPet(false);
                          setView(inWorkspace ? "pet" : null);
                          setNotice("同伴资料已清空，工作文档和知识会话保留。");
                        },
                      );
                  }}
                >
                  确认清空同伴数据
                </button>
              </>
            ) : view === "motuan-bonus" || (view === "cg" && inWorkspace) ? (
              <button onClick={() => setView("album")}>返回相册</button>
            ) : view === "story" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => setView("stories")}
              >
                返回章节
              </button>
            ) : inWorkspace ? null : (
              <button disabled={busy} onClick={() => setView(null)}>
                回到工作
              </button>
            )}
          </footer>
        </ViewContainer>
      )}
    </section>
  );
}
