export type EditOrigin = "source" | "visual" | "structure";
interface Step {
  before: string;
  after: string;
  origin: EditOrigin;
  time: number;
}
/** One text history across source, visual, JSON and outline views. */
export class DocumentSession {
  content: string;
  revision = 0;
  selection = 0;
  selectionAnchor?: number;
  scrollTop = 0;
  positionMode: "source" | "visual" = "source";
  visualSelection = 1;
  visualAnchor?: number;
  visualScrollTop = 0;
  private steps: Step[] = [];
  private cursor = 0;
  constructor(content: string) {
    this.content = content;
  }
  commit(
    next: string,
    origin: EditOrigin = "structure",
    now = Date.now(),
  ): boolean {
    if (next === this.content) return false;
    const before = this.content;
    this.steps.splice(this.cursor);
    const last = this.steps.at(-1);
    if (
      origin !== "structure" &&
      last?.origin === origin &&
      now - last.time < 650
    ) {
      last.after = next;
      last.time = now;
    } else {
      this.steps.push({ before, after: next, origin, time: now });
    }
    while (
      this.steps.length > 80 ||
      (this.steps.length > 1 &&
        this.steps.reduce((n, s) => n + s.before.length + s.after.length, 0) >
          16_000_000)
    )
      this.steps.shift();
    this.cursor = this.steps.length;
    this.content = next;
    this.revision++;
    return true;
  }
  apply(base: string, next: string) {
    if (base !== this.content)
      throw new Error("文档已变化，请刷新预览后重试，未写入过期修改。");
    return this.commit(next, "structure");
  }
  get canUndo() {
    return this.cursor > 0;
  }
  get canRedo() {
    return this.cursor < this.steps.length;
  }
  undo() {
    if (this.cursor === 0) return false;
    this.content = this.steps[--this.cursor].before;
    this.revision++;
    return true;
  }
  redo() {
    if (this.cursor >= this.steps.length) return false;
    this.content = this.steps[this.cursor++].after;
    this.revision++;
    return true;
  }
}
export function replaceRange(
  source: string,
  base: string,
  from: number,
  to: number,
  value: string,
) {
  if (source.slice(from, to) !== base)
    throw new Error("源码区间已变化，请重新打开该块。");
  return source.slice(0, from) + value + source.slice(to);
}
export type DocumentKind = "markdown" | "json" | "mermaid" | "text";
export function documentKind(path: string): DocumentKind {
  if (/\.json$/i.test(path)) return "json";
  if (/\.mmd$/i.test(path)) return "mermaid";
  if (/\.txt$/i.test(path)) return "text";
  return "markdown";
}
