import { useState, useEffect, useRef } from "react";
import {
  Leaf,
  FileText,
  CalendarDays,
  Search,
  Database,
  Plus,
  Upload,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Pin,
  Settings2,
  ArrowUpDown,
  Check,
  Trash2,
  X,
  RotateCcw,
  Sparkles,
  BookOpen,
  ArrowUp,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  Bold,
  Italic,
  Code,
  List,
  ListOrdered,
  Link,
  Undo2,
  Redo2,
} from "lucide-react";
const initial = [
  { id: "a", title: "01-书房计划.md", updated: 10, opened: 2, pinned: true },
  { id: "b", title: "02-阅读活动.md", updated: 10, opened: 4 },
  { id: "c", title: "03-资料整理.md", updated: 10, opened: 1 },
  { id: "d", title: "10-阶段复盘.md", updated: 10, opened: 3 },
  { id: "e", title: "100-灵感手记.md", updated: 9, opened: 0 },
  {
    id: "t",
    title: "旧版活动草案.md",
    trashed: true,
    attachments: 1,
    history: 2,
  },
  {
    id: "u",
    title: "待整理摘录.md",
    trashed: true,
    attachments: 0,
    history: 0,
  },
];
const orders = {
  nameAsc: "名称 A–Z",
  nameDesc: "名称 Z–A",
  updatedDesc: "修改时间",
};
function Icon({ label, children, ...props }) {
  return (
    <button className="icon" aria-label={label} title={label} {...props}>
      {children}
    </button>
  );
}
function Dialog({ title, close, children, footer }) {
  const box = useRef(),
    prior = useRef(document.activeElement);
  useEffect(() => {
    box.current.querySelector("[data-initial]")?.focus();
    let before = prior.current;
    return () => before?.isConnected && before.focus();
  }, []);
  return (
    <div className="scrim">
      <section
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="modal"
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
          if (e.key === "Tab") {
            const f = [
                ...box.current.querySelectorAll(
                  "button:not(:disabled),input,textarea",
                ),
              ],
              first = f[0],
              last = f.at(-1);
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <header>
          <h2>{title}</h2>
          <Icon label="关闭弹窗" onClick={close}>
            <X />
          </Icon>
        </header>
        <div className="modal-body">{children}</div>
        <footer>{footer}</footer>
      </section>
    </div>
  );
}
export function App() {
  const [docs, setDocs] = useState(() => structuredClone(initial)),
    [tab, setTab] = useState("docs"),
    [sort, setSort] = useState("nameAsc"),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState("a"),
    [clock, setClock] = useState(20),
    [menu, setMenu] = useState(false),
    [mode, setMode] = useState("正文"),
    [task, setTask] = useState("editor"),
    [side, setSide] = useState(true),
    [modal, setModal] = useState(null),
    [confirm, setConfirm] = useState(""),
    [fail, setFail] = useState(false),
    [error, setError] = useState(false),
    [pending, setPending] = useState(false),
    [toast, setToast] = useState(""),
    [question, setQuestion] = useState(""),
    [followup, setFollowup] = useState(false),
    [petTab, setPetTab] = useState("经历"),
    [pinOpen, setPinOpen] = useState(true),
    [insert, setInsert] = useState(false),
    [extra, setExtra] = useState("");
  const current = docs.find((d) => d.id === selected),
    target = docs.find((d) => d.id === modal?.id),
    collator = new Intl.Collator("zh-CN", {
      numeric: true,
      sensitivity: "base",
    });
  const compare = (a, b) =>
    sort === "updatedDesc"
      ? b.updated - a.updated ||
        collator.compare(a.title, b.title) ||
        a.id.localeCompare(b.id)
      : (sort === "nameDesc" ? -1 : 1) * collator.compare(a.title, b.title) ||
        a.id.localeCompare(b.id);
  const visible = docs
    .filter(
      (d) =>
        (tab === "trash" ? d.trashed : !d.trashed) &&
        d.title.toLowerCase().includes(query.toLowerCase()) &&
        (tab !== "recent" || d.opened > 0),
    )
    .sort(
      tab === "recent"
        ? (a, b) => b.opened - a.opened || a.id.localeCompare(b.id)
        : compare,
    );
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!menu && !insert) return;
    function handleKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        setMenu(false);
        setInsert(false);
        document.querySelector('[aria-label="文档排序"]')?.focus();
      }
      if (menu && ["ArrowDown", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        const items = [...document.querySelectorAll('[role="menuitemradio"]')];
        const i = items.indexOf(document.activeElement);
        items[
          (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length
        ]?.focus();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [menu, insert]);
  function close() {
    if (!pending) setModal(null);
  }
  function open(d) {
    if (d.trashed) {
      setModal({ type: "detail", id: d.id });
      return;
    }
    setSelected(d.id);
    setDocs((old) =>
      old.map((v) => (v.id === d.id ? { ...v, opened: clock } : v)),
    );
    setClock(clock + 1);
    setTask("editor");
  }
  function restore(d) {
    setDocs((old) =>
      old.map((v) =>
        v.id === d.id ? { ...v, trashed: false, updated: clock } : v,
      ),
    );
    setModal(null);
    setToast("已恢复到书房计划");
  }
  function startDelete(d) {
    setConfirm("");
    setError(false);
    setModal({ type: "purge", id: d.id });
  }
  function purge() {
    if (confirm !== "删除" || pending) return;
    setPending(true);
    setTimeout(() => {
      setPending(false);
      if (fail) {
        setFail(false);
        setError(true);
        return;
      }
      setDocs((old) => old.filter((d) => d.id !== modal.id));
      setModal(null);
      setToast("已彻底删除合成副本");
    }, 350);
  }
  function send() {
    if (!question.trim()) return;
    if (!/满意|评价|调查/.test(question)) {
      setToast("本原型只演示“哪个方案满意度更高”的追问，请试试这个问题。");
      return;
    }
    setFollowup(true);
    setQuestion("");
  }
  function reset() {
    setDocs(structuredClone(initial));
    setTab("docs");
    setSort("nameAsc");
    setQuery("");
    setSelected("a");
    setMode("正文");
    setQuestion("");
    setConfirm("");
    setFail(false);
    setError(false);
    setMenu(false);
    setInsert(false);
    setFollowup(false);
    setExtra("");
    setModal(null);
    setTask("editor");
    setSide(true);
  }
  function row(d) {
    return (
      <div
        className={
          "doc-row " + (selected === d.id && !d.trashed ? "selected" : "")
        }
        data-doc-id={d.id}
        key={d.id}
      >
        <button
          className="doc-open"
          title={d.title}
          aria-current={selected === d.id && !d.trashed ? "page" : undefined}
          onClick={() => open(d)}
        >
          {d.pinned && !d.trashed ? <Pin /> : <FileText />}
          <span>
            {d.title}
            {tab === "trash" && <small>11 月 4 日移入</small>}
            {tab === "recent" && <small>最近打开</small>}
          </span>
        </button>
        {d.trashed ? (
          <button className="text-button" onClick={() => restore(d)}>
            恢复
          </button>
        ) : (
          <Icon
            label={"操作 " + d.title}
            onClick={() => setModal({ type: "doc", id: d.id })}
          >
            <MoreHorizontal />
          </Icon>
        )}
      </div>
    );
  }
  return (
    <div className="design-root">
      <div className="review-bar">
        <strong>v0.7.0 正式版设计</strong>
        <span>合成资料 · 不连接真实文档或 API</span>
        <nav>
          <button
            onClick={() => {
              setTab("docs");
              setTask("editor");
            }}
          >
            工作台
          </button>
          <button
            onClick={() => {
              setTab("trash");
              setTask("editor");
            }}
          >
            回收站
          </button>
          <button onClick={() => setTask("chat")}>问答</button>
          <button
            onClick={() => {
              setPetTab("经历");
              setModal({ type: "pet" });
            }}
          >
            同伴
          </button>
          <button onClick={reset}>
            <RotateCcw />
            重置
          </button>
        </nav>
      </div>
      <div className="titlebar">
        <span>
          <Leaf />
          砚台 <b>/ Inkstone</b>
          <small>v0.7.0 设计预览</small>
        </span>
        <span className="title-center">书房计划</span>
        <Icon label="切换文档列表" onClick={() => setSide(!side)}>
          {side ? <PanelLeftClose /> : <PanelLeftOpen />}
        </Icon>
      </div>
      <div className={"workbench task-" + task + (!side ? " no-sidebar" : "")}>
        {side && (
          <aside className="sidebar">
            <div className="brand">
              <strong>Inkstone</strong>
              <small>本地文档空间</small>
            </div>
            <nav className="main-nav">
              <button
                className="active"
                onClick={() => {
                  setTab("docs");
                  setTask("editor");
                }}
              >
                <FileText />
                文档
              </button>
              <button
                onClick={() =>
                  setToast("日历沿用现有实现，本原型不新增编辑流程")
                }
              >
                <CalendarDays />
                日历
              </button>
              <button onClick={() => document.querySelector("#search").focus()}>
                <Search />
                搜索
              </button>
              <button onClick={() => setModal({ type: "index" })}>
                <Database />
                索引
              </button>
            </nav>
            <button
              className="space"
              onClick={() => setToast("本原型仅含一个合成空间")}
            >
              书房计划
              <ChevronDown />
            </button>
            <div className="quick">
              <button
                onClick={() => {
                  let id = "new" + clock;
                  setDocs((old) => [
                    ...old,
                    {
                      id,
                      title: "未命名文档.md",
                      opened: clock,
                      updated: clock,
                    },
                  ]);
                  setClock(clock + 1);
                  setSelected(id);
                  setTab("docs");
                }}
              >
                <Plus />
                新建
              </button>
              <button
                onClick={() =>
                  setToast("导入沿用本地副本流程，原型不读取本机文件")
                }
              >
                <Upload />
                导入文档
              </button>
            </div>
            <label className="search">
              <Search />
              <input
                id="search"
                aria-label="查找文档"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="查找文档标题…"
              />
              {query && (
                <Icon label="清除搜索" onClick={() => setQuery("")}>
                  <X />
                </Icon>
              )}
            </label>
            <div className="tabs">
              {[
                ["docs", "文档"],
                ["recent", "最近"],
                ["trash", "回收站"],
              ].map(([id, t]) => (
                <button
                  key={id}
                  aria-pressed={tab === id}
                  onClick={() => {
                    setTab(id);
                    setMenu(false);
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="list-meta">
              <span>
                {visible.length} 篇{tab === "trash" ? "已移除文档" : "文档"}
              </span>
              {tab === "docs" && (
                <div className="sort-wrap">
                  <button
                    aria-label="文档排序"
                    aria-expanded={menu}
                    onClick={() => setMenu(!menu)}
                  >
                    <ArrowUpDown />
                    {orders[sort]}
                  </button>
                  {menu && (
                    <div
                      role="menu"
                      className="sort-menu"
                      onKeyDown={(e) => e.key === "Escape" && setMenu(false)}
                    >
                      {Object.entries(orders).map(([value, label]) => (
                        <button
                          role="menuitemradio"
                          key={value}
                          aria-checked={sort === value}
                          onClick={() => {
                            setSort(value);
                            setMenu(false);
                          }}
                        >
                          {label}
                          {sort === value && <Check />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="doc-scroll">
              {tab === "docs" && visible.some((d) => d.pinned) && (
                <>
                  <button
                    className="group"
                    aria-expanded={pinOpen}
                    onClick={() => setPinOpen(!pinOpen)}
                  >
                    <ChevronDown />
                    置顶
                  </button>
                  {pinOpen && visible.filter((d) => d.pinned).map(row)}
                  <div className="group all">空间文档</div>
                </>
              )}
              {visible.filter((d) => tab !== "docs" || !d.pinned).map(row)}
              {!visible.length && (
                <div className="empty">
                  <Trash2 />
                  <p>{tab === "trash" ? "回收站为空" : "没有匹配的文档"}</p>
                  <small>
                    {tab === "trash"
                      ? "只有主动彻底删除才不可恢复。"
                      : "清除搜索后查看全部资料。"}
                  </small>
                </div>
              )}
            </div>
            <div className="side-bottom">
              <button onClick={() => setModal({ type: "settings" })}>
                <Settings2 />
                模型与设置
              </button>
              <small>
                <Check />
                文档副本保存在本机
              </small>
            </div>
          </aside>
        )}
        <main className="editor">
          <header className="doc-header">
            <span>
              <FileText />
              书房计划
              <ChevronRight />
              <b>{current?.title || "选择文档"}</b>
            </span>
            <div className="modes">
              {["源码", "正文"].map((m) => (
                <button
                  key={m}
                  aria-pressed={mode === m}
                  onClick={() => setMode(m)}
                >
                  {m}
                </button>
              ))}
            </div>
            <Icon label="进入问答" onClick={() => setTask("chat")}>
              <Sparkles />
            </Icon>
          </header>
          <div className="toolbar">
            <div className="tool-group">
              <Icon label="撤销（沿用生产编辑器）" disabled>
                <Undo2 />
              </Icon>
              <Icon label="重做（沿用生产编辑器）" disabled>
                <Redo2 />
              </Icon>
            </div>
            <button
              className="heading"
              onClick={() => setToast("标题样式沿用生产编辑器")}
            >
              正文
              <ChevronDown />
            </button>
            <div className="tool-group format">
              {[
                [Bold, "粗体"],
                [Italic, "斜体"],
                [Code, "行内代码"],
                [List, "无序列表"],
                [ListOrdered, "有序列表"],
                [Link, "链接"],
              ].map(([C, label]) => (
                <Icon
                  label={label}
                  key={label}
                  onClick={() =>
                    setToast("格式编辑沿用 rc.3，本原型用于评审导航")
                  }
                >
                  <C />
                </Icon>
              ))}
            </div>
            <Icon label="更多格式" onClick={() => setModal({ type: "format" })}>
              <MoreHorizontal />
            </Icon>
            <div className="insert-wrap">
              <button onClick={() => setInsert(!insert)} aria-expanded={insert}>
                <Plus />
                插入
                <ChevronDown />
              </button>
              {insert && (
                <div className="insert-menu">
                  {["JSON", "脑图", "Mermaid", "图表", "日程", "表格"].map(
                    (t) => (
                      <button
                        key={t}
                        onClick={() => {
                          setExtra(t);
                          setInsert(false);
                        }}
                      >
                        {t}
                      </button>
                    ),
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="doc-body">
            {mode === "源码" ? (
              <pre>
                {"# " +
                  current?.title.replace(".md", "") +
                  "\n\n把资料整理成能继续工作的线索。\n\n## 本周安排\n\n1. 核对阅读活动中的两种方案。\n2. 将有依据的结论保存为文档。\n3. 把尚未确定的部分留待补充。\n\n> 留白，也是思考的一部分。"}
              </pre>
            ) : (
              <article>
                <div className="eyebrow">书房计划 / 工作笔记</div>
                <h1>{current?.title.replace(".md", "") || "选择一篇文档"}</h1>
                <p className="lead">把资料整理成能继续工作的线索。</p>
                <h2>本周安排</h2>
                <ol>
                  <li>
                    核对阅读活动中的两种方案。打开文档后，左侧位置保持不变。
                  </li>
                  <li>将有依据的结论保存为文档，保留可核对的来源。</li>
                  <li>把尚未确定的部分留待补充，不急着填满每一处空白。</li>
                </ol>
                <blockquote>留白，也是思考的一部分。</blockquote>
                <h2>资料与判断</h2>
                <p>
                  本次活动包含两种阅读方案。人数可以比较，满意度还需要新的调查资料。
                </p>
                <div className="data-card">
                  <header>
                    <Database />
                    资料核对
                  </header>
                  <div>
                    <span>甲方案</span>
                    <strong>120 人</strong>
                  </div>
                  <div>
                    <span>乙方案</span>
                    <strong>80 人</strong>
                  </div>
                  <footer>合成示例 · 数值仅用于交互设计</footer>
                </div>
                {extra && (
                  <div className="inserted">
                    <Code />
                    <b>{extra} 内容块</b>
                    <p>此处为插入位置演示，正式编辑使用现有结构块。</p>
                  </div>
                )}
                <small className="doc-note">
                  <Check />
                  本页为合成设计样例
                </small>
              </article>
            )}
          </div>
          <footer className="doc-status">
            <span>
              <Check />
              已保存
            </span>
            <span>UTF-8 · Markdown</span>
            <button onClick={() => setTask("chat")}>
              进入问答
              <ChevronRight />
            </button>
          </footer>
        </main>
        <aside className="assistant">
          <header className="assistant-header">
            <span>
              <Sparkles />
              <b>知识问答</b>
            </span>
            <Icon label="回到编辑" onClick={() => setTask("editor")}>
              <PanelRightClose />
            </Icon>
          </header>
          <div className="chat-head">
            <div>
              <strong>阅读活动比较</strong>
              <button onClick={() => setModal({ type: "history" })}>
                会话
                <ChevronDown />
              </button>
            </div>
            <button
              className="scope"
              onClick={() => setModal({ type: "scope" })}
            >
              <Database />
              固定范围 · 2 篇资料
              <ChevronRight />
            </button>
          </div>
          <button
            className="pet-strip"
            onClick={() => {
              setPetTab("经历");
              setModal({ type: "pet" });
            }}
          >
            <img src="assets/motuan-concept.png" alt="墨团预览插画" />
            <span>
              <b>墨团</b>
              <small>安静陪读</small>
            </span>
            <BookOpen />
            手札
          </button>
          <div className="timeline">
            <div className="question">比较两种阅读方案的参与人数。</div>
            <section className="answer">
              <div className="answer-label">
                <Sparkles />
                基于本轮资料
              </div>
              <h2>甲方案参与人数较多</h2>
              <p>
                甲方案有 <strong>120 人</strong>，乙方案有{" "}
                <strong>80 人</strong>，相差 40 人。
                <button
                  className="citation"
                  onClick={() => setModal({ type: "source" })}
                >
                  1
                </button>
              </p>
              <p>参与人数反映覆盖规模，不能据此判断满意度。</p>
              <button
                className="source-chip"
                onClick={() => setModal({ type: "source" })}
              >
                <FileText />
                来源 2<ChevronRight />
              </button>
              <div className="answer-actions">
                <span>候选 1/1</span>
                <button
                  onClick={() => {
                    let id = "answer" + clock;
                    setDocs((old) => [
                      ...old,
                      {
                        id,
                        title: "阅读活动比较.md",
                        updated: clock,
                        opened: 0,
                      },
                    ]);
                    setClock(clock + 1);
                    setToast("已保存合成答案副本");
                  }}
                >
                  保存为文档
                </button>
                <button onClick={() => setModal({ type: "insertAnswer" })}>
                  插入正文
                </button>
              </div>
            </section>
            {followup && (
              <>
                <div className="question">那哪个方案满意度更高？</div>
                <section className="answer insufficient">
                  <small>资料不足</small>
                  <h3>目前还不能比较满意度</h3>
                  <p>
                    两份资料只有人数，缺少评价或调查结果。补充调查数据后可继续核对。
                  </p>
                </section>
              </>
            )}
          </div>
          <div className="composer-area">
            <div className="composer">
              <textarea
                aria-label="追问资料"
                placeholder="继续向资料提问…"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              <footer>
                <span>固定范围 · 2 篇资料</span>
                <Icon
                  label="发送追问"
                  onClick={send}
                  disabled={!question.trim()}
                >
                  <ArrowUp />
                </Icon>
              </footer>
            </div>
            <div className="composer-note">
              <span>Enter 发送 · Shift+Enter 换行</span>
              <span>合成问答</span>
            </div>
          </div>
        </aside>
      </div>
      {toast && (
        <div role="status" className="toast">
          <Check />
          {toast}
        </div>
      )}
      {modal?.type === "detail" && target && (
        <Dialog
          title="回收站文档"
          close={close}
          footer={
            <>
              <button data-initial onClick={close}>
                关闭
              </button>
              <button onClick={() => restore(target)}>恢复文档</button>
              <button
                className="danger-text"
                onClick={() => startDelete(target)}
              >
                彻底删除…
              </button>
            </>
          }
        >
          <h3>{target.title}</h3>
          <p>书房计划 · 11 月 4 日移入</p>
          <div className="facts">
            <span>{target.attachments} 个附件</span>
            <span>{target.history} 个历史版本</span>
          </div>
          <p className="muted">点击标题仅查看详情。恢复后文档回到原空间。</p>
        </Dialog>
      )}
      {modal?.type === "purge" && target && (
        <Dialog
          title="彻底删除这篇文档？"
          close={close}
          footer={
            <>
              <button data-initial disabled={pending} onClick={close}>
                取消
              </button>
              <button
                className="danger"
                onClick={purge}
                disabled={confirm !== "删除" || pending}
              >
                {pending ? "正在删除…" : "彻底删除"}
              </button>
            </>
          }
        >
          <div className="delete-target">
            <FileText />
            <div>
              <strong>{target.title}</strong>
              <small>
                书房计划 · {target.attachments} 个附件 · {target.history}{" "}
                个历史版本
              </small>
            </div>
          </div>
          <h4>将从 Inkstone 删除</h4>
          <p>
            文档副本、专属附件、历史版本、恢复草稿，以及检索和日历派生数据。
          </p>
          <h4>不会删除</h4>
          <p>
            导入原件、已有问答和手札中的文本、已导出的文件与备份。已有来源引用会标为不可用。
          </p>
          <div className="danger-note">此操作无法在 Inkstone 中恢复。</div>
          <label className="confirm-field">
            输入“删除”以确认
            <input
              aria-label="输入删除以确认"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="off"
            />
          </label>
          {error && (
            <p role="alert" className="error">
              尚未删除：合成存储错误。文档仍可恢复，请重试。
            </p>
          )}
          <label className="fixture">
            <input
              type="checkbox"
              checked={fail}
              onChange={(e) => setFail(e.target.checked)}
            />
            评审工具：模拟一次准备失败
          </label>
        </Dialog>
      )}
      {modal?.type === "doc" && target && (
        <Dialog
          title="文档操作"
          close={close}
          footer={
            <button data-initial onClick={close}>
              关闭
            </button>
          }
        >
          <h3>{target.title}</h3>
          <div className="actions">
            <button
              onClick={() => {
                setDocs((old) =>
                  old.map((d) =>
                    d.id === target.id ? { ...d, pinned: !d.pinned } : d,
                  ),
                );
                close();
              }}
            >
              <Pin />
              置顶 / 取消置顶
            </button>
            <button
              onClick={() => {
                setDocs((old) =>
                  old.map((d) =>
                    d.id === target.id
                      ? { ...d, trashed: true, attachments: 0, history: 0 }
                      : d,
                  ),
                );
                if (selected === target.id)
                  setSelected(
                    docs.find((d) => !d.trashed && d.id !== target.id)?.id,
                  );
                close();
                setToast("已移入合成回收站，可恢复");
              }}
            >
              <Trash2 />
              移入回收站
            </button>
          </div>
        </Dialog>
      )}
      {modal?.type === "pet" && (
        <Dialog
          title="墨团的手札"
          close={close}
          footer={
            <>
              <small>预览插画 · 像素终稿待签收</small>
              <button data-initial onClick={close}>
                回到工作
              </button>
            </>
          }
        >
          <div className="pet-profile">
            <img src="assets/motuan-concept.png" alt="墨团概念插画" />
            <div>
              <span className="badge">相识 · 演示阶段</span>
              <h3>这一页，也留给你。</h3>
              <p>叶纹纸签上，又多了一点墨色。</p>
            </div>
          </div>
          <div className="pet-tabs">
            {["经历", "新章", "相册", "设置"].map((t) => (
              <button
                aria-pressed={petTab === t}
                key={t}
                onClick={() => setPetTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          {petTab === "经历" && (
            <div className="journal">
              <small>11 月 6 日 · 合成记录</small>
              <h3>把问题留在纸上</h3>
              <p>你整理了一份活动比较，也记下了还缺少的满意度资料。</p>
              <p className="muted">真实成长仅由已保存工作与主动确认触发。</p>
            </div>
          )}
          {petTab === "新章" && (
            <div className="journal">
              <span className="badge">可主动阅读</span>
              <h3>纸签上的叶纹</h3>
              <p>墨团把纸签推近了一点。原本空白的角落，藏着一枚浅浅的叶纹。</p>
              <button onClick={() => setToast("已读合成章节，不改变真实成长")}>
                读完这一页
              </button>
            </div>
          )}
          {petTab === "相册" && (
            <figure className="cg">
              <img
                src="assets/motuan-study-concept.png"
                alt="墨团灯下共读 CG 概念"
              />
              <figcaption>灯下共读 · CG 概念，非最终解锁资源</figcaption>
            </figure>
          )}
          {petTab === "设置" && (
            <div className="journal">
              <p>默认专注、减少动态，工作与成长状态分别显示。</p>
              <p className="muted">称呼设置本版暂不开放，已有值保留。</p>
              <button onClick={close}>收起面板</button>
            </div>
          )}
        </Dialog>
      )}
      {modal &&
        [
          "scope",
          "index",
          "settings",
          "history",
          "insertAnswer",
          "source",
          "format",
        ].includes(modal.type) && (
          <Dialog
            title={
              {
                scope: "会话资料范围",
                index: "资料索引",
                settings: "模型与设置",
                history: "会话历史",
                insertAnswer: "插入正文预览",
                source: "本轮来源",
                format: "更多格式",
              }[modal.type]
            }
            close={close}
            footer={
              <button
                data-initial
                onClick={() => {
                  if (modal.type === "insertAnswer") setExtra("问答结论");
                  close();
                }}
              >
                {modal.type === "insertAnswer"
                  ? "确认插入合成正文"
                  : "回到工作"}
              </button>
            }
          >
            {modal.type === "format" && (
              <>
                <p>格式命令沿用现有编辑器，缩窄窗口后在这里保持可达。</p>
                <div className="actions">
                  <button onClick={() => setToast("列表命令沿用生产编辑器")}>
                    <ListOrdered />
                    有序列表
                  </button>
                  <button onClick={() => setToast("链接命令沿用生产编辑器")}>
                    <Link />
                    链接
                  </button>
                </div>
              </>
            )}
            {modal.type === "source" && (
              <>
                <span className="badge">候选 1/1 · 固定快照</span>
                <h3>02-阅读活动.md</h3>
                <p>甲方案参与人数为 120 人，乙方案为 80 人。</p>
                <div className="excerpt">
                  来源 1 · 人数记录
                  <br />
                  来源 2 · 活动安排
                  <br />
                  <small>没有满意度调查，不能推断满意度。</small>
                </div>
                <p className="muted">
                  正式应用继续回答或落文前核对来源可用性。
                </p>
              </>
            )}
            {modal.type === "scope" && (
              <>
                <span className="badge">首次发送时固定</span>
                <h3>书房计划 · 2 篇资料</h3>
                <p>
                  02-阅读活动.md
                  <br />
                  10-阶段复盘.md
                </p>
                <p>BM25 + 向量 · 重排按配置启用</p>
                <p className="muted">
                  修改范围会新建会话，已有问题与回答保留。
                </p>
              </>
            )}
            {modal.type === "index" && (
              <>
                <h3>关键词已就绪 · 向量已就绪</h3>
                <p>2 篇合成资料用于当前问答。</p>
                <p className="muted">
                  实际状态需核对模型配置、范围与正文版本。
                </p>
              </>
            )}
            {modal.type === "settings" && (
              <>
                <h3>用户自己的 API</h3>
                <p>聊天、向量与可选重排分别配置、分别测试。</p>
                <p className="muted">
                  本原型不接收或保存真实密钥。生产凭据沿用钥匙串。
                </p>
              </>
            )}
            {modal.type === "history" && (
              <>
                <h3>阅读活动比较</h3>
                <p>固定范围 · 2 篇资料 · 当前会话</p>
              </>
            )}
            {modal.type === "insertAnswer" && (
              <>
                <h3>甲方案参与人数较多</h3>
                <p>甲方案 120 人，乙方案 80 人，相差 40 人。</p>
                <p>来源：02-阅读活动.md（合成）</p>
                <p className="muted">将插入合成文档末尾，保留已有正文。</p>
              </>
            )}
          </Dialog>
        )}
    </div>
  );
}
