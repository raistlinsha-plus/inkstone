import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown, ArrowUp, CornerDownRight, FoldHorizontal, GitBranch, Pencil, Trash2, UnfoldHorizontal,
} from "lucide-react";
import { translate as t } from "../i18n";
import { dismissOnOutside, focusMenuButton } from "../platform/menu";
import { isImeEvent } from "../platform/ime";
import "./mind-node-menu.css";

export type NodeCommand = "child" | "sibling" | "rename" | "up" | "down" | "fold" | "delete";
export interface NodeMenuAnchor {
  id: string;
  source: string;
  trigger: SVGElement;
  x: number;
  y: number;
}

interface Props {
  anchor: NodeMenuAnchor;
  label: string;
  folded?: boolean;
  allowed: (command: NodeCommand) => boolean;
  run: (command: NodeCommand) => void;
  close: () => void;
}

export default function MindNodeMenu({ anchor, label, folded, allowed, run, close }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = panel.current!;
    const margin = 6;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const left = anchor.x + width > window.innerWidth - margin ? anchor.x - width : anchor.x;
    const top = anchor.y + height > window.innerHeight - margin ? anchor.y - height : anchor.y;
    el.style.left = Math.max(margin, Math.min(window.innerWidth - width - margin, left)) + "px";
    el.style.top = Math.max(margin, Math.min(window.innerHeight - height - margin, top)) + "px";
    el.focus({ preventScroll: true });
    focusMenuButton(el, "Home");
    const unwatch = dismissOnOutside(e => e.composedPath().includes(el), close);
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && event.target.contains(anchor.trigger)) close();
    };
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      unwatch();
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [anchor, close]);

  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const moveKey = mac ? "⌥" : "Alt+";
  const entries = [
    ["child", CornerDownRight, t("新增子节点", "Add child"), "Tab"],
    ["sibling", GitBranch, t("新增同级", "Add sibling"), "Enter"],
    ["rename", Pencil, t("重命名", "Rename"), "F2"],
    ["up", ArrowUp, t("上移", "Move up"), moveKey + "↑"],
    ["down", ArrowDown, t("下移", "Move down"), moveKey + "↓"],
    ["fold", folded ? UnfoldHorizontal : FoldHorizontal,
      folded ? t("展开分支", "Expand branch") : t("收起分支", "Collapse branch"),
      mac ? "⌘/" : "Ctrl+/"],
    ["delete", Trash2, t("删除分支", "Delete branch"), ""],
  ] as const;
  return createPortal(
    <div
      ref={panel} className="mind-node-menu" role="menu" tabIndex={-1}
      aria-label={label + t("的节点操作", " node actions")}
      onContextMenu={e => e.preventDefault()}
      onKeyDown={e => {
        if (isImeEvent(e.nativeEvent)) return;
        if (e.key === "Escape" || e.key === "Tab") {
          if (e.key === "Escape") e.preventDefault();
          e.stopPropagation();
          close();
          anchor.trigger.focus({ preventScroll: true });
        } else if (["Home", "End", "ArrowUp", "ArrowDown"].includes(e.key)) {
          e.preventDefault();
          e.stopPropagation();
          focusMenuButton(e.currentTarget, e.key);
        }
      }}
    >
      {entries.filter(([command]) => command !== "fold" || folded !== undefined).map(([command, Icon, caption, shortcut]) => (
        <button
          key={command} type="button" role="menuitem" tabIndex={-1}
          data-command={command} disabled={!allowed(command)}
          onClick={() => run(command)}
        >
          <Icon size={15} aria-hidden="true"/><span>{caption}</span>
          {shortcut && <kbd aria-hidden="true">{shortcut}</kbd>}
        </button>
      ))}
    </div>, document.body,
  );
}
