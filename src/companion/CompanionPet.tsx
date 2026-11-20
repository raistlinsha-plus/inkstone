import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { BookOpen, Feather, Heart, Moon, X } from "lucide-react";
import CharacterSprite from "./CharacterSprite";
import { characters, type CharacterId } from "./types";
import { isImeEvent } from "../platform/ime";
import {
  dragPet,
  petFrame,
  petPanelFrame,
  readPetPlacement,
  savePetPlacement,
  type PetArea,
  type PetPlacement,
} from "./petPlacement";
import "./petDock.css";

type Activity = "working" | "needs_input" | "ready" | "blocked" | "idle";
type PetProps = {
  role: CharacterId;
  outfit: number;
  moving: boolean;
  quiet: boolean;
  milestone: boolean;
  activity: Activity;
  activityText?: string;
  busy: boolean;
  onQuiet: () => void;
  onHide: () => void;
  onStories: () => void;
  onRecord: () => void;
  recordDisabled?: boolean;
  recordPanel?: ReactNode;
  receiptMessage?: string;
  onBeforeInteract?: (origin?: Element | null) => void;
  onDismissRecord?: (restore: boolean) => void;
};

function usePetArea(anchor: RefObject<HTMLDivElement | null>) {
  const [area, setArea] = useState<PetArea>({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    compact: true,
  });
  useLayoutEffect(() => {
    const parent = anchor.current?.parentElement;
    if (!parent) return;
    function measure() {
      if (!parent) return;
      const surface = parent.getBoundingClientRect();
      const panes = parent.querySelector(".editor-panes");
      const box = (panes ?? parent).getBoundingClientRect();
      const outlineWidth =
        panes?.querySelector(".document-outline")?.getBoundingClientRect()
          .width ?? 0;
      const source = panes?.querySelector<HTMLElement>(".editor-source-pane");
      const preview = panes?.querySelector<HTMLElement>(".editor-preview-pane");
      const sourceWidth = source?.getBoundingClientRect().width ?? box.width;
      const previewWidth = preview?.getBoundingClientRect().width ?? 0;
      // Ignore our own gutter when estimating pane widths, so changing the
      // bookmark size cannot feed back into the threshold.
      const available = Math.max(
        0,
        box.width - outlineWidth - (preview ? 8 : 0),
      );
      const fraction =
        preview && sourceWidth + previewWidth > 0
          ? Math.min(sourceWidth, previewWidth) / (sourceWidth + previewWidth)
          : 1;
      const next = {
        left: box.left - surface.left,
        top: box.top - surface.top,
        width: box.width,
        height: box.height,
        compact:
          box.height < 170 || available * fraction < (preview ? 480 : 640),
      };
      setArea((a) =>
        a.left === next.left &&
        a.top === next.top &&
        a.width === next.width &&
        a.height === next.height &&
        a.compact === next.compact
          ? a
          : next,
      );
    }
    const sizes =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    // Editor is keyed by document revision. Observe only structural child
    // lists so typing inside CodeMirror/Milkdown never rebinds our observers.
    const structure = new MutationObserver(bind);
    function bind() {
      if (!parent) return;
      structure.disconnect();
      sizes?.disconnect();
      const containers = [
        parent,
        ...parent.querySelectorAll(
          ".editor-container, .document-editor, .editor-panes",
        ),
      ];
      for (const node of containers) {
        structure.observe(node, { childList: true });
        sizes?.observe(node);
      }
      for (const pane of parent.querySelectorAll(
        ".editor-source-pane, .editor-preview-pane",
      ))
        sizes?.observe(pane);
      measure();
    }
    bind();
    window.addEventListener("resize", measure);
    return () => {
      sizes?.disconnect();
      structure.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [anchor]);
  return area;
}

export default function CompanionPet({
  role,
  outfit,
  moving,
  quiet,
  milestone,
  activity,
  activityText,
  busy,
  onQuiet,
  onHide,
  onStories,
  onRecord,
  recordDisabled,
  recordPanel,
  receiptMessage,
  onBeforeInteract,
  onDismissRecord,
}: PetProps) {
  const anchor = useRef<HTMLDivElement>(null);
  const avatar = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState(readPetPlacement);
  const latestPlacement = useRef(placement);
  const area = usePetArea(anchor);
  const pointer = useRef<{
    id: number;
    x: number;
    y: number;
    from: PetPlacement;
  } | null>(null);
  const suppressClick = useRef(false);
  const closing = useRef(false);
  const [dragging, setDragging] = useState<ReturnType<typeof dragPet> | null>(
    null,
  );
  const [reaction, setReaction] = useState<"happy" | "landing" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [readyPose, setReadyPose] = useState(false);
  const previousActivity = useRef(activity);
  const [resting, setResting] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(
    () =>
      globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ??
      false,
  );
  const animate = moving && !quiet && !reduceMotion;
  const name = characters[role].name;
  const frame = petFrame(area, dragging?.placement ?? placement);
  const panelStyle = petPanelFrame(area, placement);

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    const preference = globalThis.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    );
    const update = (event: MediaQueryListEvent) =>
      setReduceMotion(event.matches);
    preference?.addEventListener("change", update);
    return () => preference?.removeEventListener("change", update);
  }, []);
  useLayoutEffect(() => {
    const justFinished =
      previousActivity.current === "working" && activity === "ready";
    previousActivity.current = activity;
    // A new task or its answer supersedes an earlier greeting or landing.
    // A later deliberate click can still greet the companion during work.
    if (activity === "working" || justFinished) {
      clearTimeout(timer.current);
      setReaction(null);
    }
    setReadyPose(justFinished);
    if (!justFinished) return;
    const timeout = setTimeout(() => setReadyPose(false), 1100);
    return () => clearTimeout(timeout);
  }, [activity]);
  useEffect(() => {
    setResting(false);
    if (
      open ||
      dragging ||
      activity === "working" ||
      readyPose ||
      milestone ||
      reaction ||
      !animate
    )
      return;
    const timeout = setTimeout(() => setResting(true), 60000);
    return () => clearTimeout(timeout);
  }, [open, dragging, activity, readyPose, milestone, reaction, animate]);

  const recording = !!recordPanel;
  const wasRecording = useRef(recording);
  useLayoutEffect(() => {
    if (wasRecording.current && !recording) setOpen(false);
    wasRecording.current = recording;
  }, [recording]);
  const close = useCallback(
    (restore: boolean) => {
      if (closing.current) return;
      closing.current = true;
      setOpen(false);
      if (recording) onDismissRecord?.(restore);
      else if (restore && anchor.current?.contains(document.activeElement)) {
        const target = opener.current?.isConnected
          ? opener.current
          : avatar.current;
        target?.focus({ preventScroll: true });
      }
    },
    [recording, onDismissRecord],
  );
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (
        event.target instanceof Node &&
        !anchor.current?.contains(event.target)
      )
        close(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isImeEvent(event)) return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    document.addEventListener("beforeinput", outside);
    document.addEventListener("compositionstart", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("beforeinput", outside);
      document.removeEventListener("compositionstart", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open, close]);

  function react(next: "happy" | "landing", milliseconds: number) {
    setReaction(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setReaction(null), milliseconds);
  }
  function dock(next: PetPlacement) {
    latestPlacement.current = next;
    setPlacement(next);
    savePetPlacement(next);
  }
  function cancelDrag() {
    pointer.current = null;
    setDragging(null);
  }
  const mood = dragging
    ? "held"
    : (reaction ??
      (activity === "working"
        ? "reading"
        : activity === "ready" && readyPose
          ? "ready"
          : milestone
            ? "milestone"
            : resting
              ? "resting"
              : "idle"));

  return (
    <div
      ref={anchor}
      className="companion-pet-anchor"
      data-side={placement.side}
      data-form={area.compact ? "bookmark" : "sprite"}
      style={{
        left: dragging?.x ?? frame.x,
        top: frame.y,
        width: frame.width,
        height: frame.height,
      }}
    >
      <button
        ref={avatar}
        type="button"
        className="companion-pet-avatar"
        aria-label={`${name}桌宠`}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-describedby={`${menuId}-help`}
        title={`${name} · 点击互动，拖动或用方向键停靠`}
        onFocus={(event) =>
          onBeforeInteract?.(
            event.relatedTarget instanceof Element ? event.relatedTarget : null,
          )
        }
        onKeyDown={(event) => {
          if (
            isImeEvent(event.nativeEvent) ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey
          )
            return;
          const key = event.key;
          if (
            !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key)
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          const current = latestPlacement.current;
          if (key === "ArrowLeft" || key === "ArrowRight")
            dock({
              ...current,
              side: key === "ArrowLeft" ? "left" : "right",
            });
          else
            dock({
              ...current,
              heightRatio: Math.max(
                0,
                Math.min(
                  1,
                  current.heightRatio + (key === "ArrowUp" ? -0.1 : 0.1),
                ),
              ),
            });
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || pointer.current) return;
          onBeforeInteract?.();
          if (!open)
            opener.current =
              document.activeElement instanceof HTMLElement &&
              document.activeElement !== document.body
                ? document.activeElement
                : null;
          // A drag or peek at the menu keeps the current editor selection.
          event.preventDefault();
          suppressClick.current = false;
          pointer.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            from: placement,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const start = pointer.current;
          if (!start || start.id !== event.pointerId) return;
          const dx = event.clientX - start.x,
            dy = event.clientY - start.y;
          if (!suppressClick.current && Math.hypot(dx, dy) < 5) return;
          if (!suppressClick.current && open) close(false);
          suppressClick.current = true;
          setDragging(dragPet(area, start.from, dx, dy));
        }}
        onPointerUp={(event) => {
          const start = pointer.current;
          if (!start || start.id !== event.pointerId) return;
          if (suppressClick.current) {
            dock(
              dragPet(
                area,
                start.from,
                event.clientX - start.x,
                event.clientY - start.y,
              ).placement,
            );
            react("landing", 380);
          }
          cancelDrag();
        }}
        onPointerCancel={cancelDrag}
        onLostPointerCapture={cancelDrag}
        onClick={(event) => {
          if (!suppressClick.current || event.detail === 0) {
            if (open) close(true);
            else {
              if (event.detail === 0) opener.current = avatar.current;
              closing.current = false;
              setOpen(true);
            }
          }
          suppressClick.current = false;
        }}
      >
        <CharacterSprite
          role={role}
          outfit={outfit}
          mood={mood}
          animate={animate}
        />
      </button>
      <span hidden id={`${menuId}-help`}>
        左右方向键切换停靠边，上下方向键调整高度。
      </span>
      {open && (
        <section
          id={menuId}
          className="companion-pet-menu"
          style={panelStyle}
          aria-label={`${name}互动`}
        >
          {recordPanel || (
            <>
              <strong>{name}</strong>
              <p>
                {activity !== "idle" && activityText
                  ? activityText
                  : reaction === "happy"
                    ? role === "motuan"
                      ? "墨团眯了眯眼。"
                      : characters[role].quote
                    : quiet
                      ? "安静陪读"
                      : "一起读一会儿。"}
              </p>
              <div className="pet-actions">
                <button type="button" onClick={() => react("happy", 1800)}>
                  <Heart size={14} /> {role === "motuan" ? "摸摸" : "打招呼"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  aria-pressed={quiet}
                  onClick={onQuiet}
                >
                  <Moon size={14} /> {quiet ? "恢复陪伴" : "专注"}
                </button>
                <button type="button" onClick={onStories}>
                  <BookOpen size={14} /> 故事
                </button>
                <button
                  type="button"
                  disabled={busy || recordDisabled}
                  onClick={onRecord}
                >
                  <Feather size={14} /> 记录本次完成
                </button>
                <button
                  type="button"
                  onClick={() => {
                    close(true);
                    onHide();
                  }}
                >
                  <X size={14} /> 收起桌宠
                </button>
              </div>
            </>
          )}
        </section>
      )}
      {!open && receiptMessage && (
        <div
          className="companion-pet-feedback"
          style={{
            ...panelStyle,
            width: "max-content",
            maxWidth: panelStyle.width,
            ...(placement.side === "right" && {
              left: "auto",
              right: frame.width - panelStyle.left - panelStyle.width,
            }),
          }}
          role="status"
        >
          {receiptMessage}
        </div>
      )}
    </div>
  );
}
