import { isImeEvent } from "../platform/ime";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Link,
  List,
  ListOrdered,
  ListTodo,
  ChevronDown,
  MoreHorizontal,
} from "lucide-react";

const svg = (Icon: typeof Bold) =>
  renderToStaticMarkup(<Icon size={18} strokeWidth={1.8} aria-hidden="true" />);
// Crepe's supported icon configuration keeps the editor's own commands and state.
export const formattingIcons = {
  boldIcon: svg(Bold),
  italicIcon: svg(Italic),
  strikethroughIcon: svg(Strikethrough),
  codeIcon: svg(Code),
  linkIcon: svg(Link),
  bulletListIcon: svg(List),
  orderedListIcon: svg(ListOrdered),
  taskListIcon: svg(ListTodo),
  chevronDownIcon: svg(ChevronDown),
};
const labels = [
  "粗体",
  "斜体",
  "删除线",
  "行内代码",
  "无序列表",
  "有序列表",
  "任务列表",
  "链接",
];
const shortcuts = ["⌘B", "⌘I", "", "⌘E", "", "", "", "⌘K"];

/** Overflow forwards to Crepe's original controls; it never edits the document itself. */
export function enhanceFormattingToolbar(
  bar: HTMLElement,
  onCommand: (button: HTMLButtonElement) => void,
) {
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "format-overflow-button";
  trigger.setAttribute("aria-label", "更多文字格式");
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");
  trigger.title = "更多文字格式";
  trigger.innerHTML = svg(MoreHorizontal);
  const menu = document.createElement("div");
  menu.className = "format-overflow-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "更多文字格式");
  menu.hidden = true;
  bar.append(trigger, menu);
  let hiddenItems: HTMLButtonElement[] = [];
  let signature = "";
  let open = false;
  const position = () => {
    const box = trigger.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(box.right - 200, window.innerWidth - 208))}px`;
    menu.style.top = `${box.bottom + 6}px`;
    menu.style.maxHeight = `${Math.max(120, window.innerHeight - box.bottom - 20)}px`;
  };
  const setOpen = (next: boolean, focus = false) => {
    open = next && hiddenItems.length > 0;
    menu.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
    if (open) {
      position();
      if (focus)
        menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    }
  };
  const makeMenu = () => {
    const next = JSON.stringify(
      hiddenItems.map((b) => [
        b.getAttribute("aria-label"),
        b.getAttribute("aria-pressed"),
        b.disabled,
      ]),
    );
    if (next === signature) return;
    signature = next;
    const focusedLabel = menu.contains(document.activeElement)
      ? document.activeElement?.getAttribute("aria-label") ||
        document.activeElement?.textContent
      : null;
    menu.replaceChildren(
      ...hiddenItems.map((original) => {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "format-overflow-option";
        option.setAttribute("role", "menuitemcheckbox");
        option.setAttribute(
          "aria-checked",
          original.getAttribute("aria-pressed") ?? "false",
        );
        option.disabled = original.disabled;
        const icon = original.querySelector("svg");
        if (icon) option.append(icon.cloneNode(true));
        const label = document.createElement("span");
        label.textContent = original.getAttribute("aria-label");
        option.append(label);
        option.addEventListener("mousedown", (event) => event.preventDefault());
        option.addEventListener("click", (event) => {
          event.stopPropagation();
          setOpen(false);
          original.dispatchEvent(
            new PointerEvent("pointerdown", {
              bubbles: true,
              cancelable: true,
            }),
          );
          onCommand(original);
        });
        return option;
      }),
    );
    if (open && focusedLabel) {
      const options = Array.from(
        menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
      );
      (
        options.find((b) => b.textContent === focusedLabel) ||
        options[0] ||
        trigger
      ).focus();
    }
  };
  const refresh = () => {
    const wasMenuFocused =
      menu.contains(document.activeElement) ||
      document.activeElement === trigger;
    const heading = bar.querySelector<HTMLButtonElement>(
      ".top-bar-heading-button",
    );
    heading?.setAttribute("aria-label", "标题样式");
    if (heading) heading.title = "正文与标题样式";
    const buttons = Array.from(
      bar.querySelectorAll<HTMLButtonElement>(".top-bar-item"),
    );
    buttons.forEach((button, i) => {
      button.setAttribute("aria-label", labels[i] ?? "排版操作");
      button.title = `${labels[i] ?? "排版操作"}${shortcuts[i] ? ` · ${shortcuts[i]}` : ""}`;
      button.setAttribute(
        "aria-pressed",
        String(button.classList.contains("active")),
      );
      button.dataset.formatGroup = i < 4 ? "文字格式" : i < 7 ? "列表" : "链接";
      button.dataset.groupStart = String(i === 4 || i === 7);
    });
    const width = bar.getBoundingClientRect().width;
    // Detached/hidden bars have no layout yet. Do not discard commands before mounting.
    const headingWidth =
      bar
        .querySelector<HTMLElement>(".top-bar-heading-selector")
        ?.getBoundingClientRect().width || 116;
    const cost = (i: number) => 36 + (i === 4 || i === 7 ? 8 : 0);
    const total = buttons.reduce((n, _, i) => n + cost(i), headingWidth);
    const overflow = width > 0 && total > width;
    let remaining = width - headingWidth - 36;
    let fits = true;
    hiddenItems = [];
    buttons.forEach((button, i) => {
      if (overflow) {
        fits = fits && remaining >= cost(i);
        if (fits) remaining -= cost(i);
      }
      const hide = overflow && !fits;
      button.hidden = hide;
      if (hide) hiddenItems.push(button);
    });
    trigger.hidden = hiddenItems.length === 0;
    makeMenu();
    if (!hiddenItems.length) {
      const hadFocus = wasMenuFocused;
      setOpen(false);
      if (hadFocus)
        (buttons.find((b) => !b.hidden && !b.disabled) || heading)?.focus();
    }
    if (open) position();
  };
  const toggle = (event: MouseEvent) => {
    event.stopPropagation();
    setOpen(!open, true);
  };
  const triggerKeys = (event: KeyboardEvent) => {
    if (isImeEvent(event)) return;
    if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(true, true);
      if (event.key === "ArrowUp")
        menu.querySelector<HTMLButtonElement>("button:last-child")?.focus();
    }
  };
  const menuKeys = (event: KeyboardEvent) => {
    if (isImeEvent(event)) return;
    if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      if (event.key === "Escape") trigger.focus();
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      const options = Array.from(
        menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
      );
      const index = options.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? options.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : options.length - 1)) %
              options.length;
      options[next]?.focus();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      (event.target as HTMLElement)
        .closest<HTMLButtonElement>("button")
        ?.click();
    }
  };
  const outside = (event: PointerEvent) => {
    if (
      !menu.contains(event.target as Node) &&
      !trigger.contains(event.target as Node)
    )
      setOpen(false);
  };
  trigger.addEventListener("click", toggle);
  trigger.addEventListener("keydown", triggerKeys);
  menu.addEventListener("keydown", menuKeys);
  document.addEventListener("pointerdown", outside, true);
  window.addEventListener("resize", refresh);
  const resize =
    typeof ResizeObserver !== "undefined" ? new ResizeObserver(refresh) : null;
  resize?.observe(bar);
  refresh();
  return {
    refresh,
    destroy: () => {
      resize?.disconnect();
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", refresh);
      trigger.remove();
      menu.remove();
    },
  };
}
