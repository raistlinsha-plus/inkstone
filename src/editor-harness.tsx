import { useRef, useState } from "react";
import Editor, { type EditorHandle, type EditorMode } from "./Editor";
import richSample from "../examples/v0.5/富内容与图表验收.md?raw";
import calendarSample from "../examples/v0.4/日程与周计划.md?raw";
import polishSample from "../examples/v0.6/排版与组件验收.md?raw";
import { codeBlocks } from "./content/blocks";
import experienceSample from "../examples/v0.6.4/编辑体验验收.md?raw";
const samples = {
  "v0.6.4编辑体验.md": experienceSample,
  "v0.6排版.md": polishSample,
  "v0.5富内容.md": richSample,
  "v0.4.1回归.md":
    '# 编辑器修复验收\n\n第一段普通文本\n\n<br />\n\n第二段普通文本\n\n- 第一项\n- 第一行<br />第二行\n- 第三项\n\n```python\nprint("Inkstone")\n```\n\n```json\n{"large":9007199254740993,"literal":"<br />"}\n```\n\n```mindmap\n- 写作\n  - 段落\n  - 日程\n```\n',
  ...Object.fromEntries(
    [3, 20, 100].map((count) => [
      `脑图-${count}节点.md`,
      "# 脑图阅读验收\n\n```mindmap\n- 主题\n" +
        Array.from(
          { length: count - 1 },
          (_, i) => `  - 中文节点 ${i + 1}\n`,
        ).join("") +
        "```\n",
    ]),
  ),
  "日程与周计划.md": calendarSample,
  "性能-100KB.md":
    "# 长文预览\n\n" +
    "这是一段用于检验长文编辑与本地预览性能的中文正文，包含 Markdown 和知识资料。\n\n".repeat(
      800,
    ),
  "性能-1000字段.json":
    "{\n" +
    Array.from({ length: 1000 }, (_, i) => `  "字段${i}": "内容${i}"`).join(
      ",\n",
    ) +
    "\n}",
  "性能-100节点.mmd":
    "flowchart TD\n" +
    Array.from(
      { length: 99 },
      (_, i) => `  N${i}[节点${i}] --> N${i + 1}[节点${i + 1}]`,
    ).join("\n"),
  "性能-300节点.md":
    "# 结构性能\n\n" +
    Array.from(
      { length: 20 },
      (_, i) =>
        `- 分组${i}\n` +
        Array.from({ length: 14 }, (_, j) => `  - 项目${i}-${j}\n`).join(""),
    ).join(""),
  "体验.md":
    "# 编辑体验\n\n在源码、可视化与分栏之间切换。\n\n## 计划\n\n- 可靠保存\n- 结构内容\n  - JSON\n  - Mermaid\n",
  "配置.json":
    '{"project":"Inkstone","large":9007199254740993,"a/b":{"x~y":true},"items":[1,2,3]}',
  "流程.mmd":
    "flowchart LR\n  A[编辑原文] --> B[本地保存]\n  B --> C[知识检索]\n",
  "结构内容.md":
    '# 结构内容\n\n```json\n{"title":"Inkstone","large":9007199254740993}\n```\n\n```mermaid\nsequenceDiagram\n  participant U as 用户\n  participant I as 砚台\n  U->>I: 保存\n  I-->>U: 完成\n```\n',
};
export default function Harness() {
  const editor = useRef<EditorHandle>(null);
  const [path, setPath] = useState<keyof typeof samples>("体验.md");
  const [content, setContent] = useState<string>(samples[path]);
  const [mode, setMode] = useState<EditorMode>("split");
  const [error, setError] = useState("");
  const [line, setLine] = useState<number>();
  const [reopen, setReopen] = useState(0);
  const [changes, setChanges] = useState(0);
  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#fffefa",
      }}
    >
      <header
        className="editor-harness-header"
        style={{
          padding: 12,
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 8,
          borderBottom: "1px solid #ddd",
        }}
      >
        <strong>Inkstone v0.6 编辑验收</strong>
        <select
          aria-label="验收文档"
          value={path}
          onChange={(e) => {
            const p = e.target.value as keyof typeof samples;
            setPath(p);
            setContent(samples[p]);
            setError("");
            setMode("split");
            setLine(undefined);
            setChanges(0);
          }}
        >
          {Object.keys(samples).map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        {(["source", "visual", "split", "mindmap"] as const).map((m) => (
          <button
            key={m}
            onClick={() => {
              const live = editor.current?.getContent();
              if (live !== undefined) setContent(live);
              setMode(m);
            }}
          >
            {
              {
                source: "源码",
                visual: "可视化",
                split: "分栏",
                mindmap: "脑图",
              }[m]
            }
          </button>
        ))}
        <button
          onClick={() => {
            const block = codeBlocks(content).find(
              (block) => block.lang === "json",
            );
            if (!block) return;
            setMode("visual");
            setLine(block.line - 1);
            setReopen((n) => n + 1);
          }}
        >
          引用 JSON 来源
        </button>
        <button
          onClick={() => {
            const block = codeBlocks(content).find(
              (block) => block.lang === "json",
            );
            if (!block) return;
            setMode("visual");
            const offset = block.text
              .split("\n")
              .findIndex((text) => text.includes("9007199254740993"));
            setLine(block.line + Math.max(0, offset));
            setReopen((n) => n + 1);
          }}
        >
          定位 JSON 数值行
        </button>
        <output aria-label="编辑发布次数">{changes}</output>
        <span role="status">{error || "仅用于开发验收，不写入用户文件"}</span>
      </header>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Editor
          handleRef={editor}
          key={path + ":" + reopen}
          content={content}
          mode={mode}
          path={path}
          line={line}
          onChange={(next) => {
            setContent(next);
            setChanges((n) => n + 1);
          }}
          onError={setError}
        />
      </div>
      <output
        aria-label="当前文档内容"
        style={{
          fontSize: 11,
          maxHeight: 100,
          overflow: "auto",
          whiteSpace: "pre-wrap",
          padding: 8,
          borderTop: "1px solid #ddd",
        }}
      >
        {content}
      </output>
    </div>
  );
}
