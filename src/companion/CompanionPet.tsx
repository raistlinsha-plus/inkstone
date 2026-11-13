import { useEffect, useRef, useState } from "react";
import { BookOpen, Heart, Moon, X } from "lucide-react";
import MotuanSprite from "./MotuanSprite";
import { characterArt } from "./art";
import { characters, type CharacterId } from "./types";

type Point = { right: number; bottom: number };
type PetBounds = { width: number; height: number; top: number; bottom: number };

function constrain(point: Point, bounds: PetBounds): Point {
  return {
    right: Math.max(8, Math.min(point.right, bounds.width - 76)),
    bottom: Math.max(
      bounds.bottom + 8,
      Math.min(point.bottom, bounds.height - bounds.top - 76),
    ),
  };
}

export default function CompanionPet({
  role,
  outfit,
  moving,
  quiet,
  milestone,
  working,
  busy,
  onQuiet,
  onHide,
  onStories,
}: {
  role: CharacterId;
  outfit: number;
  moving: boolean;
  quiet: boolean;
  milestone: boolean;
  working: boolean;
  busy: boolean;
  onQuiet: () => void;
  onHide: () => void;
  onStories: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reaction, setReaction] = useState<"happy" | "landing" | null>(null);
  const [held, setHeld] = useState(false);
  const [resting, setResting] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(
    () =>
      globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ??
      false,
  );
  const animate = moving && !reduceMotion;
  const [bounds, setBounds] = useState<PetBounds>({
    width: Infinity,
    height: Infinity,
    top: 0,
    bottom: 0,
  });
  const avatar = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<Point>({ right: 14, bottom: 42 });
  const anchor = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const drag = useRef<{ x: number; y: number; from: Point } | null>(null);
  const wasDragged = useRef(false);
  const name = characters[role].name;

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
  useEffect(() => {
    const parent = anchor.current?.parentElement;
    if (!parent || typeof ResizeObserver === "undefined") return;
    const editor =
      parent.querySelector(".editor-panes") ??
      parent.querySelector(".editor-container") ??
      parent;
    const updateBounds = () => {
      const surface = parent.getBoundingClientRect();
      const content = editor.getBoundingClientRect();
      const next = {
        width: parent.clientWidth,
        height: parent.clientHeight,
        top: Math.max(0, content.top - surface.top),
        bottom: Math.max(0, surface.bottom - content.bottom),
      };
      setBounds(next);
      setPosition((point) => constrain(point, next));
    };
    updateBounds();
    const observer = new ResizeObserver(updateBounds);
    observer.observe(parent);
    if (editor !== parent) observer.observe(editor);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (open || held || working || milestone || reaction || !animate) {
      setResting(false);
      return;
    }
    const timeout = setTimeout(() => setResting(true), 60000);
    return () => clearTimeout(timeout);
  }, [open, held, working, milestone, reaction, animate]);

  function react(next: "happy" | "landing", milliseconds: number) {
    setReaction(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setReaction(null), milliseconds);
  }

  function finishDrag() {
    if (wasDragged.current && drag.current) react("landing", 380);
    drag.current = null;
    setHeld(false);
  }

  const placement = [
    position.bottom + 68 + 142 > bounds.height - bounds.top ? "below" : "",
    position.right + 222 > bounds.width ? "align-left" : "",
  ].join(" ");

  return (
    <div
      ref={anchor}
      className="companion-pet-anchor"
      style={position}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        avatar.current?.focus();
      }}
    >
      <button
        ref={avatar}
        type="button"
        className="companion-pet-avatar"
        aria-label={`${name}桌宠`}
        aria-expanded={open}
        title={`${name} · 点击互动或拖动`}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          wasDragged.current = false;
          drag.current = { x: event.clientX, y: event.clientY, from: position };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          const parent = anchor.current?.parentElement;
          if (!start || !parent) return;
          const dx = event.clientX - start.x;
          const dy = event.clientY - start.y;
          if (!wasDragged.current && Math.hypot(dx, dy) < 5) return;
          wasDragged.current = true;
          setHeld(true);
          setOpen(false);
          setPosition(
            constrain(
              { right: start.from.right - dx, bottom: start.from.bottom - dy },
              bounds,
            ),
          );
        }}
        onPointerUp={finishDrag}
        onPointerCancel={() => {
          finishDrag();
          wasDragged.current = false;
        }}
        onLostPointerCapture={finishDrag}
        onClick={(event) => {
          if (!wasDragged.current || event.detail === 0) setOpen(!open);
          wasDragged.current = false;
        }}
      >
        {role === "motuan" ? (
          <MotuanSprite
            mood={
              held
                ? "held"
                : reaction
                  ? reaction
                  : milestone
                    ? "milestone"
                    : working
                      ? "reading"
                      : resting
                        ? "resting"
                        : "idle"
            }
            outfit={outfit}
            animate={animate}
          />
        ) : (
          <img alt="" src={characterArt(role, outfit)} />
        )}
      </button>
      {open && (
        <section
          className={`companion-pet-menu ${placement}`}
          aria-label={`${name}互动`}
        >
          <strong>{name}</strong>
          <p role="status">
            {reaction === "happy"
              ? role === "motuan"
                ? "墨团眯了眯眼。"
                : characters[role].quote
              : quiet
                ? "安静陪读"
                : "一起读一会儿。"}
          </p>
          <div>
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
            <button type="button" onClick={onHide}>
              <X size={14} /> 收起桌宠
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
