import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  codeBlocks,
  parseMarkdown,
  textOf,
  type MarkdownNode,
} from "../content/blocks";
import { replaceRange } from "../session";
import { isSafeBreak } from "../rich/markdown";
import { blockTypes } from "../rich/blocks";
import type { SearchResult } from "../types";
import ContentBlock from "./ContentBlock";
import "./content.css";
import { decodeLocalImageUrl } from "../content/urls";
import { contentBlockIdentities } from "./blockIdentity";

type ReadNode = MarkdownNode & {
  start?: number | null;
  align?: ("left" | "right" | "center" | null)[];
  identifier?: string;
  label?: string;
  title?: string;
  checked?: boolean;
};
export { decodeLocalImageUrl as safeImageUrl } from "../content/urls";
function LocalImage({
  url,
  alt,
  path,
  readOnly,
}: {
  url: string;
  alt: string;
  path: string;
  readOnly: boolean;
}) {
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let disposed = false;
    setSrc("");
    setFailed(false);
    // Model answers cannot request arbitrary files or remote resources.
    if (!readOnly && path && isTauri()) {
      void Promise.resolve()
        .then(() =>
          invoke<string>("resolve_image", {
            documentPath: path,
            url: decodeLocalImageUrl(url),
          }),
        )
        .then((value) => {
          if (!disposed) {
            setSrc(value);
            setFailed(!value);
          }
        })
        .catch(() => {
          if (!disposed) setFailed(true);
        });
    }
    return () => {
      disposed = true;
    };
  }, [url, path, readOnly]);
  return src && !failed ? (
    <img src={src} alt={alt} onError={() => setFailed(true)} />
  ) : (
    <span className="preview-help">
      [{failed ? "图片不可读取" : readOnly ? "图片未自动加载" : "本地图片"}：
      {alt || url}]
    </span>
  );
}
function slug(text: string) {
  return (
    text
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .replace(/\s/g, "-") || "section"
  );
}
export default function Markdown({
  source,
  path,
  onApply,
  onLocate,
  onError,
  onOpenDoc,
  viewKey = path,
  readOnly = false,
  citations,
  citationChecks,
  onCitation,
  label = "Markdown 实时预览",
  pending = false,
  rejectedCharts,
}: {
  source: string;
  path: string;
  onApply?: (base: string, next: string) => void;
  onLocate?: (line: number) => void;
  onError?: (error: string) => void;
  onOpenDoc?: (path: string) => void;
  viewKey?: string;
  readOnly?: boolean;
  citations?: (SearchResult | undefined)[];
  citationChecks?: import("../assistant/types").CitationCheck[];
  onCitation?: (source: SearchResult, trigger?: HTMLButtonElement) => void;
  label?: string;
  pending?: boolean;
  rejectedCharts?: number[];
}) {
  const ast = useMemo(() => parseMarkdown(source), [source]);
  const blocks = useMemo(() => codeBlocks(source, ast), [source, ast]);
  const identities = useMemo(
    () => (readOnly ? [] : contentBlockIdentities(viewKey, source, ast)),
    [viewKey, source, ast, readOnly],
  );
  const article = useRef<HTMLElement>(null);
  const prefix = useId();
  const derived = useMemo(() => {
    const definitions = new Map<string, ReadNode>();
    const headings = new Map<number, string>();
    const duplicates = new Map<string, number>();
    const visit = (raw: MarkdownNode) => {
      const node = raw as ReadNode;
      if (node.type === "definition" && node.identifier)
        definitions.set(node.identifier.toLowerCase(), node);
      if (node.type === "heading") {
        const base = slug(textOf(node)),
          n = duplicates.get(base) ?? 0;
        duplicates.set(base, n + 1);
        headings.set(node.position.start.line, n ? `${base}-${n}` : base);
      }
      node.children?.forEach(visit);
    };
    visit(ast);
    return { definitions, headings };
  }, [ast]);
  function text(
    value: string,
    key: string | number,
    allowCitations: boolean,
  ): ReactNode {
    if (!allowCitations || !citations || !onCitation) return value;
    return value.split(/(\[\d+\])/g).map((part, i) => {
      const m = part.match(/^\[([1-9]\d*)\]$/),
        index = m ? Number(m[1]) - 1 : -1;
      const citation = citations[index];
      const matching = citationChecks?.filter((check) =>
        check.citations.includes(index + 1),
      );
      const hasConflict = matching?.some(
        (check) => check.status === "conflict",
      );
      const note = hasConflict
        ? "有结论与来源不一致"
        : matching?.length
          ? "有结论待核对"
          : undefined;
      return citation ? (
        <button
          key={`${key}:${i}`}
          type="button"
          className="citation"
          aria-description={note}
          data-review={
            hasConflict ? "conflict" : note ? "unverified" : undefined
          }
          title={`查看来源 ${index + 1}：${citation.title || citation.path}${note ? ` · ${note}` : ""}`}
          onClick={(event) => onCitation(citation, event.currentTarget)}
        >
          {index + 1}
          {note && <span aria-hidden="true">!</span>}
        </button>
      ) : (
        part
      );
    });
  }
  function openLink(url: string) {
    if (url.startsWith("#")) {
      let target = url.slice(1);
      try {
        target = decodeURIComponent(target);
      } catch {}
      const heading = Array.from(
        article.current?.querySelectorAll<HTMLElement>("[data-heading]") ?? [],
      ).find(
        (el) =>
          el.dataset.heading === target ||
          el.dataset.sourceLine === target.replace(/^line-/, ""),
      );
      if (heading) {
        heading.scrollIntoView({ block: "start" });
        heading.focus({ preventScroll: true });
      }
      return;
    }
    if (/^https?:\/\//i.test(url)) {
      if (isTauri())
        void invoke("open_external", { url }).catch((e) =>
          onError?.(String(e)),
        );
      else window.open(url, "_blank", "noopener,noreferrer");
    } else if (!url.includes(":")) {
      if (!path || !onOpenDoc) {
        onError?.("请先将回答保存为文档，再打开相对文档链接。");
        return;
      }
      try {
        const base = new URL(path, "https://workspace.invalid/"),
          dest = new URL(url, base);
        if (dest.origin !== base.origin) throw Error("不支持的链接");
        onOpenDoc(decodeURIComponent(dest.pathname.slice(1)));
      } catch (e) {
        onError?.(String(e));
      }
    } else onError?.("此链接协议不受支持。");
  }
  function render(
    raw: MarkdownNode,
    key: number | string,
    allowCitations = true,
  ): ReactNode {
    const node = raw as ReadNode;
    const children = (allow = allowCitations) =>
      node.children?.map((n, i) => render(n, `${key}:${i}`, allow));
    switch (node.type) {
      case "root":
        return <div key={key}>{children()}</div>;
      case "text":
        return text(node.value ?? "", key, allowCitations);
      case "heading": {
        const Tag = `h${node.depth ?? 1}` as "h1";
        return (
          <Tag
            key={key}
            id={`${prefix}-${derived.headings.get(node.position.start.line)}`}
            data-heading={derived.headings.get(node.position.start.line)}
            data-source-line={node.position.start.line}
            tabIndex={-1}
            onDoubleClick={() =>
              !readOnly && onLocate?.(node.position.start.line)
            }
          >
            {children()}
          </Tag>
        );
      }
      case "paragraph":
        return <p key={key}>{children()}</p>;
      case "strong":
        return <strong key={key}>{children()}</strong>;
      case "emphasis":
        return <em key={key}>{children()}</em>;
      case "delete":
        return <del key={key}>{children()}</del>;
      case "inlineCode":
        return <code key={key}>{node.value}</code>;
      case "break":
        return <br key={key} />;
      case "thematicBreak":
        return <hr key={key} />;
      case "blockquote":
        return <blockquote key={key}>{children()}</blockquote>;
      case "list":
        return node.ordered ? (
          <ol key={key} start={node.start ?? 1}>
            {children()}
          </ol>
        ) : (
          <ul key={key}>{children()}</ul>
        );
      case "listItem":
        return (
          <li key={key}>
            {typeof node.checked === "boolean" && (
              <input
                type="checkbox"
                checked={node.checked}
                readOnly
                disabled
                aria-label={node.checked ? "已完成任务" : "未完成任务"}
              />
            )}{" "}
            {children()}
          </li>
        );
      case "table": {
        const rows = node.children ?? [];
        return (
          <div className="preview-table" key={key}>
            <table>
              <thead>
                {rows.slice(0, 1).map((row, i) => (
                  <tr key={i}>
                    {row.children?.map((cell, j) => (
                      <th
                        key={j}
                        scope="col"
                        style={{ textAlign: node.align?.[j] ?? undefined }}
                      >
                        {cell.children?.map((child, k) =>
                          render(child, `${key}:${i}:${j}:${k}`),
                        )}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {rows.slice(1).map((row, i) => (
                  <tr key={i}>
                    {row.children?.map((cell, j) => (
                      <td
                        key={j}
                        style={{ textAlign: node.align?.[j] ?? undefined }}
                      >
                        {cell.children?.map((child, k) =>
                          render(child, `${key}:${i + 1}:${j}:${k}`),
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      case "image":
        return (
          <LocalImage
            key={key}
            path={path}
            url={node.url ?? ""}
            alt={node.alt ?? ""}
            readOnly={readOnly}
          />
        );
      case "imageReference": {
        const def = derived.definitions.get(
          node.identifier?.toLowerCase() ?? "",
        );
        return def ? (
          <LocalImage
            key={key}
            path={path}
            url={def.url ?? ""}
            alt={node.alt ?? ""}
            readOnly={readOnly}
          />
        ) : (
          <span key={key}>{node.alt}</span>
        );
      }
      case "link":
        return (
          <a
            key={key}
            href={
              /^(https?:\/\/|#)/i.test(node.url ?? "") ||
              !/[:]/.test(node.url ?? "")
                ? node.url || "#"
                : "#"
            }
            onClick={(e) => {
              e.preventDefault();
              openLink(node.url ?? "");
            }}
          >
            {children(false)}
          </a>
        );
      case "linkReference": {
        const def = derived.definitions.get(
          node.identifier?.toLowerCase() ?? "",
        );
        return def ? (
          <a
            key={key}
            href={
              /^(https?:\/\/|#)/i.test(def.url ?? "") ||
              !/[:]/.test(def.url ?? "")
                ? def.url || "#"
                : "#"
            }
            onClick={(e) => {
              e.preventDefault();
              openLink(def.url ?? "");
            }}
          >
            {children(false)}
          </a>
        ) : (
          <span key={key}>{children(false)}</span>
        );
      }
      case "definition":
        return null;
      case "html":
        return isSafeBreak(node.value) ? (
          <br key={key} />
        ) : (
          <pre className="raw-html" key={key}>
            {node.value}
          </pre>
        );
      case "code": {
        const language = node.lang?.toLowerCase() ?? "text";
        const block = blocks.find(
          (b) => b.line === node.position.start.line + 1,
        );
        const known = Object.hasOwn(blockTypes, language);
        const chartIndex =
          language === "chart"
            ? blocks
                .filter((b) => b.lang === "chart")
                .findIndex((b) => b.from === block?.from)
            : -1;
        const rejected =
          language === "chart" && rejectedCharts?.includes(chartIndex);
        return (
          <section key={key} className="code-preview-block">
            <div className="block-label">
              <span>
                {known
                  ? blockTypes[language as keyof typeof blockTypes].label
                  : language}{" "}
                · 第 {node.position.start.line} 行
              </span>
              {!readOnly && onLocate && (
                <button onClick={() => onLocate(node.position.start.line)}>
                  编辑源码
                </button>
              )}
              <button
                onClick={() =>
                  void navigator.clipboard
                    .writeText(node.value ?? "")
                    .catch((e) => onError?.(String(e)))
                }
              >
                复制
              </button>
            </div>
            {known && block && !pending && !rejected ? (
              <ContentBlock
                kind={language}
                source={block.text}
                viewKey={`${viewKey}:block:${identities[blocks.indexOf(block)] ?? block.id}`}
                readOnly={readOnly}
                startLine={block.line}
                onLocate={readOnly ? undefined : onLocate}
                onError={onError}
                sourceRefs={citations?.flatMap((source, i) =>
                  source ? [`S${i + 1}`] : [],
                )}
                onApply={
                  !readOnly && onApply
                    ? (base, next) =>
                        onApply(
                          source,
                          replaceRange(
                            source,
                            base,
                            block.from,
                            block.to,
                            next,
                          ),
                        )
                    : undefined
                }
              />
            ) : (
              <>
                {known && (
                  <p className="preview-help">
                    {rejected
                      ? "图表数值或来源待核实，暂以原文显示。"
                      : pending
                        ? "内容尚未完成，暂以原文显示。"
                        : "代码围栏尚未闭合，原文已保留。"}
                  </p>
                )}
                <pre>
                  <code>{node.value}</code>
                </pre>
              </>
            )}
          </section>
        );
      }
      default:
        return <span key={key}>{node.value ?? children()}</span>;
    }
  }
  return (
    <article
      ref={article}
      className={`markdown-preview${readOnly ? " markdown-reading" : ""}`}
      aria-label={label}
    >
      {render(ast, "root")}
    </article>
  );
}
