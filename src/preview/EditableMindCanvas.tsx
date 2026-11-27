import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import {
  Check,
  ChevronDown,
  CornerDownRight,
  Download,
  Expand,
  FileText,
  GitBranch,
  Minus,
  Palette,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import type {
  CanvasNode,
  MindChange,
  MindChangeResult,
  MindStyle,
} from "../content/editableMind";
import { translate as t } from "../i18n";
import { imeBoundary, isImeEvent } from "../platform/ime";
import { loadBlockDraft, saveBlockDraft } from "./drafts";
import { exportSvg } from "./Graph";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { mindBranches, visibleMind, type FoldKey } from "./mindFolds";
import MindFoldButton from "./MindFoldButton";
import {
  layOutMind,
  mindConnector,
  type PlacedNode,
} from "./editableMindLayout";
import { diagramFontFamily, mindBranchInk, mindTitleColors } from "./theme";
import { dismissOnOutside, focusMenuButton } from "../platform/menu";
import { loadViewport, saveViewport, type GraphViewport } from "./viewport";
import MindNodeMenu, { type NodeCommand, type NodeMenuAnchor } from "./MindNodeMenu";
import "./editable-mind.css";

interface Props {
  tree: CanvasNode;
  source: string;
  viewKey: string;
  style: MindStyle;
  onStyle: (style: MindStyle) => void;
  onChange: (change: MindChange) => MindChangeResult;
  onResetPositions?: () => void;
  onPosition?: (id: string, dx: number, dy: number) => void;
  onLocateNode?: (id: string) => void;
  onHistory: (back: boolean) => void;
  onError: (message: string) => void;
}
type Action = "rename" | "child" | "sibling" | "delete";
interface Draft {
  action: Action;
  id: string;
  value: string;
  base: string;
}
type BranchDrop = { target: string; placement: "before" | "after" | "child" };
type Drop = BranchDrop | "free" | undefined;
interface Gesture {
  id?: string;
  startX: number;
  startY: number;
  camera: GraphViewport;
  active: boolean;
  pointer: number;
  source: string;
}
const ghost = "__inkstone_draft__";
const styleNames = () => ({
  classic: t("青竹", "Jade"),
  color: t("彩色分支", "Color branches"),
  minimal: t("墨线", "Ink"),
});

function draftTree(root: CanvasNode, id?: string, action?: Action): CanvasNode {
  if (!id || (action !== "child" && action !== "sibling"))
    return root;
  const pending: CanvasNode = {
    id: ghost,
    label: t("新节点", "New node"),
    children: [],
  };
  function insert(node: CanvasNode): CanvasNode {
    const children = node.children.flatMap((child) => [
      insert(child),
      ...(id === child.id && action === "sibling"
        ? [pending]
        : []),
    ]);
    if (id === node.id && action === "child")
      children.push(pending);
    return { ...node, children };
  }
  return insert(root);
}
function canAct(box: PlacedNode, action: Action) {
  if (action === "child") return box.node.canAddChild !== false;
  if (action === "rename") return box.node.editable !== false;
  if (!box.parent) return false;
  return action === "delete"
    ? box.node.editable !== false
    : box.node.editable !== false && box.parent.node.canAddChild !== false;
}

function isCenterTitle(box: PlacedNode) {
  return box.depth === 0 && (!box.shape || box.shape === "plain" || box.shape === "rounded");
}

function NodeShape({
  box,
  style,
  ink,
  canvas,
  dark,
}: {
  box: PlacedNode;
  style: MindStyle;
  ink: string;
  canvas: string;
  dark: boolean;
}) {
  const { w, h, depth } = box;
  if (isCenterTitle(box)) {
    const { fill, stroke } = mindTitleColors(dark ? "dark" : "light", style);
    return <rect width={w} height={h} rx={8} fill={fill} stroke={stroke} />;
  }
  const authored = box.shape;
  const filled = !depth && style !== "minimal";
  const tint = style === "color" && depth === 1;
  const shape =
    authored && authored !== "plain"
      ? authored
      : !depth || tint
        ? "rounded"
        : "plain";
  if (shape === "plain") return null;
  const fill = filled ? ink : tint ? ink : canvas;
  const draw = {
    fill,
    fillOpacity: tint ? (dark ? 0.21 : 0.12) : 1,
    stroke: ink,
    strokeWidth: filled || tint ? 0 : 1.35,
  };
  if (shape === "circle")
    return <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} {...draw} />;
  if (shape === "hexagon")
    return (
      <polygon
        points={`10,0 ${w - 10},0 ${w},${h / 2} ${w - 10},${h} 10,${h} 0,${h / 2}`}
        {...draw}
      />
    );
  if (shape === "cloud")
    return (
      <path
        d={`M 10 ${h * 0.85} Q -6 ${h * 0.65} 5 ${h * 0.34} Q 0 ${h * 0.04} ${w * 0.26} 5 Q ${w * 0.48} -7 ${w * 0.63} 4 Q ${w * 0.94} -3 ${w - 6} ${h * 0.24} Q ${w + 8} ${h * 0.6} ${w - 6} ${h * 0.79} Q ${w * 0.87} ${h + 5} ${w * 0.66} ${h - 2} Q ${w * 0.43} ${h + 7} ${w * 0.3} ${h - 2} Q ${w * 0.1} ${h + 5} 10 ${h * 0.85} Z`}
        {...draw}
      />
    );
  if (shape === "bang")
    return (
      <polygon
        points={`0,5 ${w * 0.25},7 ${w * 0.36},0 ${w * 0.56},5 ${w * 0.8},0 ${w * 0.85},6 ${w},2 ${w - 3},${h * 0.55} ${w},${h} ${w * 0.7},${h - 4} ${w * 0.56},${h} ${w * 0.4},${h - 3} ${w * 0.16},${h} 0,${h - 4} 4,${h * 0.5}`}
        {...draw}
      />
    );
  return (
    <rect
      width={w}
      height={h}
      rx={shape === "rect" ? 0 : style === "minimal" ? 4 : 9}
      {...draw}
    />
  );
}

export default function EditableMindCanvas({
  tree,
  source,
  viewKey,
  style,
  onStyle,
  onChange,
  onPosition,
  onResetPositions,
  onHistory,
  onError,
  onLocateNode,
}: Props) {
  const draftKey = viewKey + ":canvas-name";
  const viewportKey = viewKey + ":editable-canvas";
  const [draft, setDraft] = useState<Draft | undefined>(() =>
    loadBlockDraft(draftKey, source),
  );
  const [selected, select] = useState(draft?.id || tree.id);
  const [nodeMenu, setNodeMenu] = useState<NodeMenuAnchor>();
  const closeNodeMenu = useCallback(() => setNodeMenu(undefined), []);
  useEffect(closeNodeMenu, [source, viewKey, closeNodeMenu]);
  const [themeMenu, setThemeMenu] = useState(false);
  const [camera, setCamera] = useState<GraphViewport | null>(() =>
    loadViewport(viewportKey),
  );
  const [size, setSize] = useState({ w: 840, h: 480 });
  const [dark, setDark] = useState(
    document.documentElement.dataset.theme === "dark",
  );
  const [drop, setDrop] = useState<Drop>();
  const [dragged, setDragged] = useState<string>();
  const [dragPoint, setDragPoint] = useState<{ x: number; y: number; dx: number; dy: number }>();
  const stale = draft && draft.base !== source;
  const pendingId = !stale ? draft?.id : undefined;
  const pendingAction = draft?.action;
  const branchInfo = useMemo(() => mindBranches(tree), [tree]);
  const [folds, setFolds] = useState<Set<FoldKey>>(() => new Set());
  const scene = useMemo(
    () => layOutMind(draftTree(visibleMind(tree, branchInfo, folds), pendingId, pendingAction)),
    [tree, branchInfo, folds, pendingId, pendingAction],
  );
  useEffect(() => {
    const live = new Set([...branchInfo.values()].map(branch => branch.key));
    setFolds(old => {
      const kept = [...old].filter(key => live.has(key));
      return kept.length === old.size ? old : new Set(kept);
    });
  }, [branchInfo]);
  const current = scene.byId.get(selected) || scene.byId.get(tree.id)!;
  const editBox =
    draft &&
    (scene.byId.get(
      draft.action === "child" || draft.action === "sibling" ? ghost : draft.id,
    ) ||
      current);
  const stage = useRef<HTMLDivElement>(null);
  const foldAnchor = useRef<{ id: string; x: number; y: number; scale: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const cancelEdit = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuToggle = useRef<HTMLButtonElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const fit = Math.max(
    0.005,
    Math.min(1.15, (size.w - 64) / scene.width, (size.h - 64) / scene.height),
  );
  const fittedCamera = {
    scale: fit,
    x: (size.w - scene.width * fit) / 2 - scene.minX * fit,
    y: (size.h - scene.height * fit) / 2 - scene.minY * fit,
  };
  const pose = camera ?? fittedCamera;
  const paper = dark ? "#1e2220" : "#fbfaf7";
  const text = dark ? "#eef1ee" : "#222724";
  const accent = dark ? "#a7cdba" : "#32634c";
  const ink = (branch: number, depth: number) => mindBranchInk(dark ? "dark" : "light", style, branch, depth);
  useLayoutEffect(() => {
    const el = stage.current!;
    const resize = () => {
      const b = el.getBoundingClientRect();
      if (b.width && b.height) setSize({ w: b.width, h: b.height });
    };
    resize();
    const obs =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(resize)
        : undefined;
    obs?.observe(el);
    const theme = new MutationObserver(() =>
      setDark(document.documentElement.dataset.theme === "dark"),
    );
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => {
      obs?.disconnect();
      theme.disconnect();
    };
  }, []);
  useEffect(() => {
    saveBlockDraft(draftKey, draft?.base ?? source, draft ?? null);
  }, [draftKey, draft, source]);
  useEffect(() => {
    if (camera) saveViewport(viewportKey, camera);
  }, [camera, viewportKey]);
  useLayoutEffect(() => {
    if (draft?.action === "delete") {
      cancelEdit.current?.focus({ preventScroll: true });
    } else if (draft) {
      input.current?.focus({ preventScroll: true });
      input.current?.select();
    }
  }, [draft?.action, draft?.id]);
  useEffect(() => {
    if (!themeMenu) return;
    const picker = menu.current!;
    picker.querySelector<HTMLElement>("[aria-checked=true]")?.focus({ preventScroll: true });
    const close = () => setThemeMenu(false);
    // WebKit blurs the checked item with a null relatedTarget on mouse-down.
    // Close on a real outside event so the next item's click can complete.
    const unwatch = dismissOnOutside(event => event.composedPath().includes(picker), close);
    window.addEventListener("blur", close);
    return () => {
      unwatch();
      window.removeEventListener("blur", close);
    };
  }, [themeMenu]);
  function focusNode(id: string) {
    select(id);
    requestAnimationFrame(() => {
      const nodes =
        stage.current?.querySelectorAll<SVGElement>("[data-map-node]");
      Array.from(nodes || [])
        .find((n) => n.dataset.mapNode === id)
        ?.focus({ preventScroll: true });
    });
  }
  useLayoutEffect(() => {
    const anchor = foldAnchor.current;
    if (!anchor) return;
    foldAnchor.current = null;
    const box = scene.byId.get(anchor.id);
    if (box) setCamera({
      scale: anchor.scale,
      x: anchor.x - (box.x + box.w) * anchor.scale,
      y: anchor.y - (box.y + box.h / 2) * anchor.scale,
    });
  }, [scene]);
  function openBranch(id: string) {
    const branch = branchInfo.get(id);
    if (branch && folds.has(branch.key)) setFolds(old => {
      const next = new Set(old);
      next.delete(branch.key);
      return next;
    });
  }
  function toggleFold(id: string) {
    const branch = branchInfo.get(id);
    const box = scene.byId.get(id);
    if (!branch || !box || draft) return;
    foldAnchor.current = { id, scale: pose.scale,
      x: pose.x + (box.x + box.w) * pose.scale,
      y: pose.y + (box.y + box.h / 2) * pose.scale };
    setFolds(old => {
      const next = new Set(old);
      if (next.has(branch.key)) next.delete(branch.key);
      else next.add(branch.key);
      return next;
    });
    focusNode(id);
  }
  function start(action: Action, box = current) {
    if (!canAct(box, action)) return;
    if (action === "child") openBranch(box.node.id);
    select(box.node.id);
    setDraft({
      id: box.node.id,
      action,
      base: source,
      value: action === "rename" ? box.node.label : "",
    });
  }
  function openNodeMenu(box: PlacedNode, trigger: SVGElement, x: number, y: number) {
    if (draft) return;
    select(box.node.id);
    setThemeMenu(false);
    setNodeMenu({ id: box.node.id, source, trigger, x, y });
  }
  function moveNeighbor(box: PlacedNode, direction: "up" | "down") {
    if (!box.parent || box.node.movable === false || box.parent.node.canAddChild === false)
      return;
    const peers = box.parent.node.children;
    const index = peers.findIndex(item => item.id === box.node.id);
    const neighbor = peers[index + (direction === "up" ? -1 : 1)];
    return neighbor?.editable === false ? undefined : neighbor;
  }
  function runNodeCommand(box: PlacedNode, command: NodeCommand) {
    closeNodeMenu();
    if (command === "fold") {
      toggleFold(box.node.id);
      return;
    }
    if (command !== "up" && command !== "down") {
      start(command, box);
      return;
    }
    const neighbor = moveNeighbor(box, command);
    if (!neighbor) return;
    try {
      const { selection } = onChange({ type: "move", id: box.node.id, target: neighbor.id,
        placement: command === "up" ? "before" : "after" });
      focusNode(selection || box.node.id);
    } catch (e) {
      onError(String(e));
      focusNode(box.node.id);
    }
  }
  function abandon() {
    const id = draft?.id || current.node.id;
    setDraft(undefined);
    focusNode(id);
  }
  function commit(continueWith?: "sibling" | "child") {
    if (!draft || stale || (draft.action !== "delete" && !draft.value.trim()))
      return;
    try {
      const updated =
        draft.action === "delete"
          ? onChange({ type: "delete", id: draft.id })
          : onChange({
              type: draft.action,
              id: draft.id,
              label: draft.value.trim(),
            });
      const id = updated.selection || (draft.action === "delete"
        ? current.parent?.node.id || tree.id
        : draft.id);
      if (continueWith && updated.selection && (draft.action !== "rename" || canAct(current, continueWith))) {
        if (continueWith === "child" && draft.action === "rename") openBranch(draft.id);
        select(id);
        setDraft({ id, action: continueWith, value: "", base: updated.source });
      } else {
        setDraft(undefined);
        focusNode(id);
      }
    } catch (e) {
      onError(String(e));
    }
  }
  function zoom(factor: number, x = size.w / 2, y = size.h / 2) {
    setCamera(previous => {
      const camera = previous ?? pose;
      const scale = Math.max(0.005, Math.min(4, camera.scale * factor));
      const ratio = scale / camera.scale;
      return { scale, x: x - (x - camera.x) * ratio, y: y - (y - camera.y) * ratio };
    });
  }
  useEffect(() => {
    const el = stage.current!;
    function wheel(e: WheelEvent) {
      if ((e.target as Element).closest("input,button")) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey)
        zoom(
          Math.exp(-e.deltaY * 0.012),
          e.clientX - rect.left,
          e.clientY - rect.top,
        );
      else {
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
        const dy = e.shiftKey ? 0 : e.deltaY;
        setCamera(previous => {
          const camera = previous ?? pose;
          return { ...camera, x: camera.x - dx, y: camera.y - dy };
        });
      }
    }
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [pose.x, pose.y, pose.scale, size.w, size.h]);
  function keydown(e: KeyboardEvent, box: PlacedNode) {
    if (isImeEvent(e.nativeEvent) || draft) return;
    if (e.altKey) {
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        e.stopPropagation();
        runNodeCommand(box, e.key === "ArrowUp" ? "up" : "down");
      }
      return;
    }
    if ((e.shiftKey && e.key === "F10") || e.key === "ContextMenu") {
      e.preventDefault();
      e.stopPropagation();
      const trigger = e.currentTarget as SVGElement;
      const rect = trigger.getBoundingClientRect();
      openNodeMenu(box, trigger, rect.left + rect.width / 2, rect.bottom);
      return;
    }
    const branch = branchInfo.get(box.node.id);
    if (branch && !e.shiftKey && (
      ((e.metaKey || e.ctrlKey) && e.key === "/") ||
      (!e.metaKey && !e.ctrlKey && e.key === "ArrowRight" && folds.has(branch.key))
    )) {
      e.preventDefault();
      e.stopPropagation();
      toggleFold(box.node.id);
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.stopPropagation();
      onHistory(!e.shiftKey);
      return;
    }
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    const peers = box.parent?.node.children ?? [tree];
    const i = peers.findIndex((c) => c.id === box.node.id);
    const next =
      e.key === "ArrowLeft"
        ? box.parent?.node
        : e.key === "ArrowRight"
          ? box.node.children[0]
          : e.key === "ArrowDown"
            ? peers[i + 1]
            : e.key === "ArrowUp"
              ? peers[i - 1]
              : undefined;
    const action = (
      {
        Tab: "child",
        Enter: "sibling",
        F2: "rename",
        Backspace: "delete",
        Delete: "delete",
      } as Record<string, Action>
    )[e.key];
    if (action && canAct(box, action)) {
      e.preventDefault();
      e.stopPropagation();
      start(action, box);
    } else if (next) {
      e.preventDefault();
      e.stopPropagation();
      const box = scene.byId.get(next.id);
      if (box) {
        // Keep the next topic visible when navigating a zoomed or panned map.
        const left = pose.x + box.x * pose.scale;
        const top = pose.y + box.y * pose.scale;
        const dx = Math.max(16 - left, 0) || Math.min(size.w - 16 - (left + box.w * pose.scale), 0);
        const dy = Math.max(16 - top, 0) || Math.min(size.h - 16 - (top + box.h * pose.scale), 0);
        if (dx || dy) setCamera({ ...pose, x: pose.x + dx, y: pose.y + dy });
      }
      focusNode(next.id);
    }
  }
  function pointerDown(e: PointerEvent<HTMLDivElement>) {
    if (
      e.button !== 0 ||
      !e.isPrimary ||
      (e.target as Element).closest("input,button,form")
    )
      return;
    if (draft) {
      if (draft.value.trim() && draft.action !== "delete") commit();
      return;
    }
    const node = (e.target as Element).closest<SVGElement>("[data-map-node]");
    const id = node?.dataset.mapNode;
    if (id) {
      select(id);
      node.focus({ preventScroll: true });
    }
    // Retain the down target for ordinary clicks and double-clicks, including
    // movements that cross an SVG child before reaching the drag threshold.
    (node ?? e.currentTarget).setPointerCapture(e.pointerId);
    gesture.current = {
      id,
      startX: e.clientX,
      startY: e.clientY,
      pointer: e.pointerId,
      camera: pose,
      active: false,
      source,
    };
  }
  function pointerMove(e: PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || g.pointer !== e.pointerId) return;
    const dx = e.clientX - g.startX,
      dy = e.clientY - g.startY;
    if (!g.active && Math.hypot(dx, dy) < 5) return;
    if (g.id && !onPosition && scene.byId.get(g.id)?.node.movable === false) return;
    if (!g.active) {
      g.active = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      if (g.id) setCamera(g.camera);
    }
    if (!g.id) {
      setCamera({ ...g.camera, x: g.camera.x + dx, y: g.camera.y + dy });
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setDragged(g.id);
    setDragPoint({ x: e.clientX - rect.left, y: e.clientY - rect.top, dx: dx / g.camera.scale, dy: dy / g.camera.scale });
    setDrop(dropAt(g.id, e.clientX, e.clientY));
  }

  function dropAt(id: string, x: number, y: number): Drop {
    const hit = document.elementFromPoint(x, y);
    const drawing = hit?.closest(".mind-drawing");
    if (!hit || !drawing || !stage.current?.contains(drawing)) return;
    const hitNode = hit.closest<SVGElement>("[data-map-node]");
    if (!hitNode) return onPosition ? "free" : undefined;
    const target = scene.byId.get(hitNode.dataset.mapNode!);
    const origin = scene.byId.get(id);
    if (target?.node.id === id) return onPosition ? "free" : undefined;
    if (!target || !origin?.parent || origin.node.movable === false) return;
    for (let ancestor: PlacedNode | undefined = target; ancestor; ancestor = ancestor.parent) {
      if (ancestor.node.id === id) return;
    }
    const rect = hitNode.getBoundingClientRect();
    const frac = (y - rect.top) / Math.max(1, rect.height);
    const placement = !target.parent ? "child" : frac < 0.27 ? "before" : frac > 0.73 ? "after" : "child";
    const parent = placement === "child" ? target : target.parent;
    if (parent?.node.canAddChild !== false) return { target: target.node.id, placement };
  }

  function finishDrag(pointerId: number, release?: { clientX: number; clientY: number }) {
    const g = gesture.current;
    if (!g || g.pointer !== pointerId) return;
    // Hit-test the actual release, even if the OS coalesced the final moves.
    const destination = release && g.active && g.id && dropAt(g.id, release.clientX, release.clientY);
    gesture.current = null;
    setDrop(undefined);
    setDragged(undefined);
    setDragPoint(undefined);
    if (stage.current?.hasPointerCapture(pointerId))
      stage.current.releasePointerCapture(pointerId);
    if (!release || !g.active || g.source !== source) return;
    if (!g.id) {
      setCamera({ ...g.camera, x: g.camera.x + release.clientX - g.startX, y: g.camera.y + release.clientY - g.startY });
      return;
    }
    try {
      if (destination === "free") {
        onPosition?.(g.id, (release.clientX - g.startX) / g.camera.scale, (release.clientY - g.startY) / g.camera.scale);
        focusNode(g.id);
      } else if (destination) {
        const moved = onChange({ type: "move", id: g.id, ...destination });
        if (destination.placement === "child") openBranch(destination.target);
        focusNode(moved.selection || tree.id);
      }
    } catch (error) {
      onError(String(error));
    }
  }
  function drawEdges(layout: ReturnType<typeof layOutMind>) {
    return layout.boxes
      .filter((b) => b.parent)
      .map((b) => (
        <path
          key={b.node.id}
          d={mindConnector(b)}
          fill="none"
          stroke={ink(b.branch, b.depth)}
          strokeOpacity={style === "minimal" ? 0.65 : 0.86}
          strokeWidth={style === "color" && b.depth === 1 ? 2.4 : 1.55}
        />
      ));
  }
  function drawTopic(b: PlacedNode, editing: boolean) {
    const stroke = ink(b.branch, b.depth);
    return <>
      <NodeShape
        box={b}
        style={style}
        ink={stroke}
        canvas={paper}
        dark={dark}
      />
      {!editing && (
        <text
          x={b.w / 2}
          textAnchor="middle"
          fill={isCenterTitle(b)
            ? mindTitleColors(dark ? "dark" : "light", style).text
            : !b.depth && style !== "minimal" ? (dark ? "#17241f" : "#fff") : text}
          fontFamily={diagramFontFamily}
          fontWeight={b.depth > 1 ? 400 : 600}
          fontSize={b.depth ? 15 : 18}
        >
          {b.lines.map((l, i) => (
            <tspan
              key={i}
              x={b.w / 2}
              y={
                b.h / 2 +
                (i - (b.lines.length - 1) / 2) * 22 +
                (b.depth ? 5 : 6)
              }
            >
              {l}
            </tspan>
          ))}
        </text>
      )}
    </>;
  }
  async function download() {
    // Render the complete layout offscreen so exported SVG contains even the
    // topics folded out of the current view, without disturbing its focus.
    const layout = folds.size ? layOutMind(tree) : scene;
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      flushSync(() => root.render(<svg
        viewBox={`${layout.minX - 24} ${layout.minY - 24} ${layout.width + 48} ${layout.height + 48}`}>
        <rect x={layout.minX - 24} y={layout.minY - 24} width={layout.width + 48} height={layout.height + 48} fill={paper} />
        {drawEdges(layout)}
        {layout.boxes.map(b => <g key={b.node.id} transform={`translate(${b.x} ${b.y})`}>
          {drawTopic(b, false)}
        </g>)}
      </svg>));
      const svg = new XMLSerializer().serializeToString(container.firstElementChild!);
      await exportSvg(svg);
    } catch (e) {
      onError(String(e));
    } finally {
      root.unmount();
    }
  }
  // Keep the editing field inside the reachable canvas, including at zoomed-out scales.
  const fieldWidth = Math.min(
    Math.max(168, (editBox?.w || 0) * pose.scale + 8),
    Math.max(135, size.w - 32),
    310,
  );
  const fieldStyle: CSSProperties | undefined = editBox && {
    width: fieldWidth,
    left: Math.max(
      8,
      Math.min(
        size.w - fieldWidth - 8,
        pose.x + (editBox.x + editBox.w / 2) * pose.scale - fieldWidth / 2,
      ),
    ),
    top: Math.max(
      8,
      Math.min(
        size.h - 68,
        pose.y + (editBox.y + editBox.h / 2) * pose.scale - 17,
      ),
    ),
  };
  const menuBox = nodeMenu?.source === source && nodeMenu ? scene.byId.get(nodeMenu.id) : undefined;
  const moving = dragged && scene.byId.get(dragged);
  const dragPreview = moving && dragPoint && {
    box: moving,
    x: moving.x + dragPoint.dx,
    y: moving.y + dragPoint.dy,
  };
  const names = styleNames();
  if (scene.boxes.length > 501)
    return (
      <p className="preview-error">
        {t(
          "脑图超过 500 个节点，请使用源码编辑。",
          "This map exceeds 500 nodes. Edit it in source view.",
        )}
      </p>
    );
  return (
    <section
      className="editable-mind"
      aria-label={t("脑图编辑器", "Mind map editor")}
    >
      <div
        className="mind-tools"
        role="group"
        aria-label={t("节点操作", "Node actions")}
      >
        <button
          disabled={!!draft || !canAct(current, "child")}
          title={t("新增子节点 · Tab", "Add child · Tab")}
          onClick={() => start("child")}
        >
          <CornerDownRight />
          {t("新增子节点", "Add child")}
        </button>
        <button
          disabled={!!draft || !canAct(current, "sibling")}
          title={t("新增同级 · Enter", "Add sibling · Enter")}
          onClick={() => start("sibling")}
        >
          <GitBranch />
          {t("新增同级", "Add sibling")}
        </button>
        <button
          disabled={!!draft || !canAct(current, "rename")}
          aria-label={t("重命名", "Rename")}
          title={t("重命名 · F2", "Rename · F2")}
          onClick={() => start("rename")}
        >
          <Pencil />
        </button>
        <button
          disabled={!!draft || !canAct(current, "delete")}
          aria-label={t("删除子树", "Delete branch")}
          title={t("删除子树", "Delete branch")}
          onClick={() => start("delete")}
        >
          <Trash2 />
        </button>
        {onLocateNode && (
          <button
            disabled={!!draft}
            title={t("回到原文", "Go to source")}
            aria-label={t("回到原文", "Go to source")}
            onClick={() => onLocateNode(current.node.id)}
          >
            <FileText />
          </button>
        )}
        <div
          className="mind-style-picker"
          ref={menu}
        >
          <button
            ref={menuToggle}
            disabled={!!draft}
            aria-haspopup="menu"
            aria-expanded={themeMenu}
            onClick={() => setThemeMenu(!themeMenu)}
          >
            <Palette />
            {t("样式", "Style")}
            <ChevronDown size={12} />
          </button>
          {themeMenu && (
            <div
              className="mind-style-menu"
              role="menu"
              aria-label={t("脑图样式", "Mind map style")}
              onKeyDown={(e) => {
                if (e.key === "Escape" || e.key === "Tab") {
                  if (e.key === "Escape") e.preventDefault();
                  e.stopPropagation();
                  setThemeMenu(false);
                  menuToggle.current?.focus({ preventScroll: true });
                } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
                  e.preventDefault();
                  e.stopPropagation();
                  focusMenuButton(e.currentTarget, e.key);
                }
              }}
            >
              {(Object.keys(names) as MindStyle[]).map((key) => (
                <button
                  type="button"
                  role="menuitemradio"
                  tabIndex={-1}
                  aria-checked={style === key}
                  key={key}
                  onClick={() => {
                    try {
                      onStyle(key);
                      setThemeMenu(false);
                      menuToggle.current?.focus();
                    } catch (e) {
                      onError(String(e));
                    }
                  }}
                >
                  <span
                    aria-hidden="true"
                    className={"mind-swatch swatch-" + key}
                  />
                  {names[key]}
                  {style === key && <Check />}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          disabled={!!draft}
          title={t("导出 SVG", "Export SVG")}
          aria-label={t("导出 SVG", "Export SVG")}
          onClick={() => void download()}
        >
          <Download />
        </button>
      </div>
      <div
        className="mind-stage"
        ref={stage}
        onKeyDownCapture={(e) => {
          if (e.key === "Escape" && gesture.current?.active) {
            e.preventDefault();
            e.stopPropagation();
            finishDrag(gesture.current.pointer);
          }
        }}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={(e) => finishDrag(e.pointerId, e)}
        onPointerCancel={(e) => finishDrag(e.pointerId)}
        onLostPointerCapture={(e) => {
          if (e.target === e.currentTarget) finishDrag(e.pointerId);
        }}
      >
        <svg
          className="mind-drawing"
          onDragStart={e => e.preventDefault()}
          role="tree"
          aria-label={t("脑图节点", "Mind map nodes")}
          width="100%"
          height="100%"
        >
          <g
            transform={`translate(${pose.x} ${pose.y}) scale(${pose.scale})`}
          >
            {drawEdges(scene)}
            {scene.boxes.map((b) => {
              const id = b.node.id,
                active = selected === id,
                dest = drop && drop !== "free" && drop.target === id ? drop.placement : undefined;
              const info = branchInfo.get(id);
              const stroke = ink(b.branch, b.depth);
              const title = isCenterTitle(b);
              const highlightPadding = title ? 0 : 3;
              const editing =
                (draft?.action === "rename" && draft.id === id) || id === ghost;
              return (
                <g
                  key={id}
                  data-map-node={id}
                  transform={`translate(${b.x} ${b.y})`}
                  className="mind-node"
                  role="treeitem"
                  aria-selected={active}
                  aria-expanded={info ? !!b.node.children.length : undefined}
                  aria-level={b.depth + 1}
                  aria-label={b.node.label}
                  tabIndex={current.node.id === id ? 0 : -1}
                  onFocus={() => {
                    if (!draft) select(id);
                  }}
                  aria-haspopup="menu"
                  onContextMenu={e => {
                    if (draft) return;
                    e.preventDefault();
                    e.stopPropagation();
                    openNodeMenu(b, e.currentTarget, e.clientX, e.clientY);
                  }}
                  onKeyDown={(e) => keydown(e, b)}
                  onDoubleClick={(e) => {
                    e.preventDefault();
                    if (!draft) start("rename", b);
                  }}
                  pointerEvents={id === dragged ? "none" : undefined}
                  opacity={id === dragged || editing ? 0.4 : 1}
                >
                  <rect
                    data-ui=""
                    x={-2}
                    y={-2}
                    width={b.w + 4}
                    height={b.h + 4}
                    rx={9}
                    fill="transparent"
                  />
                  {drawTopic(b, editing)}
                  {((active && !draft) || dest === "child") && (
                    <rect
                      data-ui=""
                      x={-highlightPadding}
                      y={-highlightPadding}
                      width={b.w + 2 * highlightPadding}
                      height={b.h + 2 * highlightPadding}
                      rx={title ? 8 : b.shape === "circle" ? "50%" : 9}
                      fill={dest === "child" ? accent : "none"}
                      fillOpacity={0.13}
                      stroke={accent}
                      strokeWidth={dest === "child" ? 2.5 : 1}
                      className="mind-node-highlight"
                      pointerEvents="none"
                    />
                  )}
                  {info && !draft && !dragged && (
                    <MindFoldButton box={b} count={info.count} ink={stroke} paper={paper} onToggle={toggleFold} />
                  )}
                  {(dest === "before" || dest === "after") && (
                    <path
                      data-ui=""
                      d={`M -4 ${dest === "before" ? -6 : b.h + 6} h ${b.w + 8}`}
                      stroke={accent}
                      strokeWidth={3}
                      strokeLinecap="round"
                    />
                  )}
                </g>
              );
            })}
            {dragPreview && (
              <g pointerEvents="none" aria-hidden="true" transform={`translate(${dragPreview.x} ${dragPreview.y})`}>
                <rect x={-2} y={-2} width={dragPreview.box.w + 4} height={dragPreview.box.h + 4} rx={8}
                  fill={paper} opacity={0.94} stroke={accent}/>
                {drawTopic(dragPreview.box, false)}
              </g>
            )}
          </g>
        </svg>
        {dragPoint && dragged && drop && drop !== "free" && (
          <span className="mind-drag-label" aria-hidden="true"
            style={{ left: dragPoint.x + 12, top: dragPoint.y + 12 }}>
            {drop.placement === "child"
              ? t("移为子节点", "Move under")
              : drop.placement === "before" ? t("插入上方", "Insert before") : t("插入下方", "Insert after")}
          </span>
        )}
        {draft && editBox && (
          <form
            {...imeBoundary}
            className="mind-inline-editor"
            style={fieldStyle}
            onSubmit={(e) => {
              e.preventDefault();
              if (!input.current?.dataset.imeComposing) commit();
            }}
            onKeyDown={(e) => {
              if (isImeEvent(e.nativeEvent)) {
                e.stopPropagation();
                return;
              }
              if (e.target === input.current && e.key === "Enter" && !e.altKey &&
                  (e.shiftKey || e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                e.stopPropagation();
                commit(e.metaKey || e.ctrlKey ? "child" : "sibling");
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                abandon();
              }
            }}
          >
            {draft.action === "delete" ? (
              <span>{t("删除此节点及子节点？", "Delete this branch?")}</span>
            ) : (
              <input
                ref={input}
                aria-label={t("脑图节点名称", "Node name")}
                title={t("Enter 保存，Shift+Enter 继续添加同级，⌘/Ctrl+Enter 继续添加子节点", "Enter to save, Shift+Enter for another sibling, Cmd/Ctrl+Enter for a child")}
                value={draft.value}
                onChange={(e) => setDraft({ ...draft, value: e.target.value })}
              />
            )}
            <div className="mind-edit-actions">
              {stale && (
                <span role="status">
                  {t(
                    "原文已变化，请重新选择节点。",
                    "Source changed. Select the node again.",
                  )}
                </span>
              )}
              <button
                type="submit"
                disabled={
                  !!stale || (draft.action !== "delete" && !draft.value.trim())
                }
                aria-label={
                  draft.action === "delete"
                    ? t("确认删除", "Confirm deletion")
                    : t("保存", "Save")
                }
                title={t("确认 · Enter", "Confirm · Enter")}
              >
                <Check />
              </button>
              {draft.action !== "delete" && <>
                <button type="button" disabled={!!stale || !draft.value.trim() || (draft.action === "rename" && !canAct(current, "sibling"))}
                  aria-label={t("保存并新增同级", "Save and add a sibling")}
                  title={t("保存并新增同级 · Shift+Enter", "Save and add a sibling · Shift+Enter")}
                  onClick={() => commit("sibling")}>
                  <GitBranch />
                </button>
                <button type="button" disabled={!!stale || !draft.value.trim() || (draft.action === "rename" && !canAct(current, "child"))}
                  aria-label={t("保存并新增子节点", "Save and add a child")}
                  title={t("保存并新增子节点 · ⌘/Ctrl+Enter", "Save and add a child · Cmd/Ctrl+Enter")}
                  onClick={() => commit("child")}>
                  <CornerDownRight />
                </button>
              </>}
              <button
                type="button"
                ref={cancelEdit}
                aria-label={t("取消", "Cancel")}
                title={t("取消 · Esc", "Cancel · Esc")}
                onClick={abandon}
              >
                <X />
              </button>
            </div>
          </form>
        )}
        <div
          className="mind-zoom"
          role="group"
          aria-label={t("画布缩放", "Canvas zoom")}
        >
          {onResetPositions && <button
            disabled={!!draft}
            onClick={() => { onResetPositions(); setCamera(null); saveViewport(viewportKey, null); }}
          >{t("自动布局", "Auto layout")}</button>}
          <button
            aria-label={t("缩小", "Zoom out")}
            title={t("缩小", "Zoom out")}
            onClick={() => zoom(1 / 1.25)}
          >
            <Minus />
          </button>
          <span>{Math.round(pose.scale * 100)}%</span>
          <button
            aria-label={t("放大", "Zoom in")}
            title={t("放大", "Zoom in")}
            onClick={() => zoom(1.25)}
          >
            <Plus />
          </button>
          <button
            aria-label={t("适应窗口", "Fit to window")}
            title={t("适应窗口", "Fit to window")}
            onClick={() => {
              setCamera(null);
              saveViewport(viewportKey, null);
            }}
          >
            <Expand />
          </button>
        </div>
      </div>
      {nodeMenu && menuBox && !draft && (
        <MindNodeMenu
          anchor={nodeMenu}
          label={menuBox.node.label}
          folded={branchInfo.has(menuBox.node.id) ? !menuBox.node.children.length : undefined}
          allowed={command => command === "fold" || ((command === "up" || command === "down")
            ? !!moveNeighbor(menuBox, command) : canAct(menuBox, command))}
          run={command => runNodeCommand(menuBox, command)}
          close={closeNodeMenu}
        />
      )}
    </section>
  );
}
