import { msg } from "../i18n";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChartColumn, Code2, Pencil, Table2 } from "lucide-react";
import { chartText, parseChart, type ChartData } from "../content/chart";
import Graph from "./Graph";
import { loadBlockDraft, saveBlockDraft } from "./drafts";
import "./chart.css";

type Props = {
  source: string;
  toolbarHost?: HTMLElement | null;
  toolbarExtras?: ReactNode;
  onApply?: (base: string, next: string) => void;
  onError?: (message: string) => void;
  readOnly?: boolean;
  sourceRefs?: string[];
  viewKey?: string;
  onEditingChange?: (active: boolean) => void;
};
const chartViews = [
  ["chart", "图表", ChartColumn],
  ["data", "数据表", Table2],
  ["source", "源码", Code2],
] as const;

function inspect(source: string) {
  try {
    return { data: parseChart(source), error: "" };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e) };
  }
}
export default function Chart({
  source,
  onApply,
  onError,
  readOnly = false,
  sourceRefs,
  viewKey,
  onEditingChange,
  toolbarHost,
  toolbarExtras,
}: Props) {
  const id = useId();
  const [exportSlot, setExportSlot] = useState<HTMLDivElement | null>(null);
  const checked = useMemo(() => inspect(source), [source]);
  type Draft = {
    base: string;
    draft: string;
    fields: ChartData | null;
    cells: string[][];
    tab: "chart" | "data" | "source";
  };
  const draftKey = viewKey ? `${viewKey}:chart` : undefined;
  const [restored] = useState(() =>
    readOnly ? undefined : loadBlockDraft<Draft>(draftKey, source),
  );
  const [tab, setTab] = useState<"chart" | "data" | "source">(
    restored?.tab ?? "chart",
  );
  const [editingRequested, setEditing] = useState(!!restored);
  const editing = editingRequested && !readOnly && !!onApply;
  const [base, setBase] = useState(restored?.base ?? "");
  const [draft, setDraft] = useState(restored?.draft ?? source);
  const [fields, setFields] = useState<ChartData | null>(
    restored?.fields ?? null,
  );
  const [cells, setCells] = useState<string[][]>(restored?.cells ?? []);
  const [message, setMessage] = useState("");
  useEffect(() => {
    onEditingChange?.(editing);
    return () => onEditingChange?.(false);
  }, [editing, onEditingChange]);
  useEffect(() => {
    if (!readOnly)
      saveBlockDraft(
        draftKey,
        base || source,
        editingRequested ? { base, draft, fields, cells, tab } : null,
      );
  }, [
    draftKey,
    base,
    source,
    draft,
    fields,
    cells,
    tab,
    editingRequested,
    readOnly,
  ]);
  const begin = () => {
    if (readOnly || !onApply) return;
    setBase(source);
    setDraft(source);
    setFields(checked.data);
    setCells(
      checked.data?.series.map((s) =>
        s.values.map((v) => (v === null ? "" : String(v))),
      ) ?? [],
    );
    setTab(tab === "source" ? "source" : checked.data ? "data" : "source");
    setMessage("");
    setEditing(true);
  };
  const stale = editing && base !== source;
  const refs = checked.data?.sourceRefs ?? [];
  const unknownRefs = sourceRefs
    ? refs.filter((ref) => !sourceRefs.includes(ref))
    : [];
  const untrustedSources =
    sourceRefs !== undefined && (!refs.length || unknownRefs.length > 0);
  const apply = () => {
    if (readOnly || !onApply) return;
    try {
      if (stale)
        throw new Error("原文已变化，请取消后重新编辑；未写入过期修改。");
      let next = draft;
      if (tab === "data" && fields) {
        const series = fields.series
          .map((s, i) => {
            const values = cells[i].map((cell) => {
              const raw = cell.trim();
              if (!raw || raw === "null") return "null";
              if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(raw))
                throw new Error("数据值需要有效数值，留空表示缺失。");
              return raw;
            });
            return `{"name":${JSON.stringify(s.name)},"values":[${values.join(",")}]}`;
          })
          .join(",");
        // Keep numeric text intact until schema validation has checked precision.
        const common = JSON.stringify({ ...fields, series: undefined });
        next = common.slice(0, -1) + `,"series":[${series}]}`;
      }
      const value = parseChart(next);
      onApply?.(base, JSON.stringify(value, null, 2));
      setEditing(false);
      setMessage("已更新图表，可撤销。");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };
  const shown = editing && tab === "data" ? fields : checked.data;
  const tools = (
    <div className="graph-actions diagram-tools chart-tools">
      {toolbarExtras}
      <div className="chart-tabs" role="group" aria-label={msg("图表视图")}>
        {chartViews.map(([key, label, Icon]) => (
          <button
            key={key}
            title={msg(label)}
            aria-label={msg(label)}
            aria-pressed={tab === key}
            disabled={editing && key !== tab}
            onClick={() => setTab(key)}
          >
            <Icon size={16} aria-hidden="true" />
          </button>
        ))}
      </div>
      {!readOnly && onApply && !editing && (
        <button
          title={msg("编辑图表")}
          aria-label={msg("编辑图表")}
          onClick={begin}
        >
          <Pencil size={16} aria-hidden="true" />
        </button>
      )}
      <div className="chart-export-slot" ref={setExportSlot} />
    </div>
  );
  return (
    <section
      className="data-chart diagram-preview"
      aria-label={msg("数据图表")}
      data-editing={editing || undefined}
    >
      {toolbarHost === undefined
        ? tools
        : toolbarHost && createPortal(tools, toolbarHost)}
      {checked.error && !editing && (
        <div className="preview-error" role="status">
          {checked.error} <span>{msg("可以查看源码并修正。")}</span>
        </div>
      )}
      {stale && (
        <p className="preview-error" role="alert">
          {msg("原文已变化。草稿已保留，取消后可重新编辑。")}
        </p>
      )}
      {tab === "chart" && checked.data && !untrustedSources && (
        <Graph
          kind="chart"
          source={source}
          toolbarHost={exportSlot}
          onError={(error) => {
            setMessage(error);
            onError?.(error);
          }}
        />
      )}
      {tab === "data" && shown && (
        <>
          {editing && (
            <div className="chart-fields">
              <label>
                {msg("标题")}
                <input
                  aria-label={msg("图表标题")}
                  value={shown.title}
                  onChange={(e) =>
                    setFields({ ...shown, title: e.target.value })
                  }
                />
              </label>
              <label>
                {msg("类型")}
                <select
                  aria-label={msg("图表类型")}
                  value={shown.type}
                  onChange={(e) =>
                    setFields({
                      ...shown,
                      type: e.target.value as ChartData["type"],
                      donut: e.target.value === "pie" ? shown.donut : undefined,
                    })
                  }
                >
                  <option value="bar">{msg("柱状图")}</option>
                  <option value="line">{msg("折线图")}</option>
                  <option value="pie">{msg("饼图")}</option>
                </select>
              </label>
              <label>
                {msg("分类轴")}
                <input
                  aria-label={msg("分类轴名称")}
                  value={shown.x.label}
                  onChange={(e) =>
                    setFields({
                      ...shown,
                      x: { ...shown.x, label: e.target.value },
                    })
                  }
                />
              </label>
              <label>
                {msg("数值轴")}
                <input
                  aria-label={msg("数值轴名称")}
                  value={shown.y.label}
                  onChange={(e) =>
                    setFields({
                      ...shown,
                      y: { ...shown.y, label: e.target.value },
                    })
                  }
                />
              </label>
              <label>
                {msg("单位")}
                <input
                  aria-label={msg("图表单位")}
                  value={shown.y.unit}
                  onChange={(e) =>
                    setFields({
                      ...shown,
                      y: { ...shown.y, unit: e.target.value },
                    })
                  }
                />
              </label>
              {shown.type === "pie" ? (
                <label>
                  <input
                    type="checkbox"
                    checked={!!shown.donut}
                    onChange={(e) =>
                      setFields({ ...shown, donut: e.target.checked })
                    }
                  />
                  {msg("环形显示")}
                </label>
              ) : (
                <label>
                  {msg("方向")}
                  <select
                    aria-label={msg("图表方向")}
                    value={shown.orientation ?? "vertical"}
                    onChange={(e) =>
                      setFields({
                        ...shown,
                        orientation: e.target.value as
                          "vertical" | "horizontal",
                      })
                    }
                  >
                    <option value="vertical">{msg("纵向")}</option>
                    <option value="horizontal">{msg("横向")}</option>
                  </select>
                </label>
              )}
            </div>
          )}
          <div className="chart-table-wrap">
            <table className="chart-table" aria-label={`${shown.title}数据表`}>
              <thead>
                <tr>
                  <th scope="col">{shown.x.label || msg("分类")}</th>
                  {shown.series.map((s, i) => (
                    <th scope="col" key={i}>
                      {editing ? (
                        <input
                          aria-label={`系列 ${i + 1} 名称`}
                          value={s.name}
                          onChange={(e) =>
                            setFields({
                              ...shown,
                              series: shown.series.map((v, j) =>
                                j === i ? { ...v, name: e.target.value } : v,
                              ),
                            })
                          }
                        />
                      ) : (
                        s.name
                      )}
                      {shown.y.unit && <span>（{shown.y.unit}）</span>}
                      {editing && shown.series.length > 1 && (
                        <button
                          aria-label={`删除系列 ${i + 1}`}
                          onClick={() => {
                            setFields({
                              ...shown,
                              series: shown.series.filter((_, j) => j !== i),
                            });
                            setCells(cells.filter((_, j) => j !== i));
                          }}
                        >
                          −
                        </button>
                      )}
                    </th>
                  ))}
                  {editing && <th scope="col">{msg("操作")}</th>}
                </tr>
              </thead>
              <tbody>
                {shown.x.values.map((category, row) => (
                  <tr key={row}>
                    <th scope="row">
                      {editing ? (
                        <input
                          aria-label={`分类 ${row + 1}`}
                          value={category}
                          onChange={(e) =>
                            setFields({
                              ...shown,
                              x: {
                                ...shown.x,
                                values: shown.x.values.map((v, j) =>
                                  j === row ? e.target.value : v,
                                ),
                              },
                            })
                          }
                        />
                      ) : (
                        category
                      )}
                    </th>
                    {shown.series.map((s, column) => (
                      <td key={column}>
                        {editing ? (
                          <input
                            inputMode="decimal"
                            aria-label={`${s.name} 第 ${row + 1} 项数值`}
                            value={cells[column]?.[row] ?? ""}
                            placeholder={msg("缺失")}
                            onChange={(e) =>
                              setCells(
                                cells.map((col, i) =>
                                  i === column
                                    ? col.map((v, j) =>
                                        j === row ? e.target.value : v,
                                      )
                                    : col,
                                ),
                              )
                            }
                          />
                        ) : s.values[row] === null ? (
                          <span className="chart-missing">{msg("缺失")}</span>
                        ) : (
                          String(s.values[row])
                        )}
                      </td>
                    ))}
                    {editing && (
                      <td>
                        <button
                          aria-label={`删除分类 ${row + 1}`}
                          disabled={shown.x.values.length <= 1}
                          onClick={() => {
                            setFields({
                              ...shown,
                              x: {
                                ...shown.x,
                                values: shown.x.values.filter(
                                  (_, i) => i !== row,
                                ),
                              },
                              series: shown.series.map((s) => ({
                                ...s,
                                values: s.values.filter((_, i) => i !== row),
                              })),
                            });
                            setCells(
                              cells.map((col) =>
                                col.filter((_, i) => i !== row),
                              ),
                            );
                          }}
                        >
                          −
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {editing && (
            <div className="chart-data-actions">
              <button
                disabled={
                  (shown.x.values.length + 1) * shown.series.length > 1000
                }
                onClick={() => {
                  setFields({
                    ...shown,
                    x: {
                      ...shown.x,
                      values: [
                        ...shown.x.values,
                        `分类${shown.x.values.length + 1}`,
                      ],
                    },
                    series: shown.series.map((s) => ({
                      ...s,
                      values: [...s.values, null],
                    })),
                  });
                  setCells(cells.map((col) => [...col, ""]));
                }}
              >
                {msg("新增分类")}
              </button>
              <button
                disabled={
                  shown.series.length >= 8 ||
                  shown.type === "pie" ||
                  (shown.series.length + 1) * shown.x.values.length > 1000
                }
                onClick={() => {
                  setFields({
                    ...shown,
                    series: [
                      ...shown.series,
                      {
                        name: `系列${shown.series.length + 1}`,
                        values: shown.x.values.map(() => null),
                      },
                    ],
                  });
                  setCells([...cells, shown.x.values.map(() => "")]);
                }}
              >
                {msg("新增系列")}
              </button>
            </div>
          )}
          <p className="preview-help">
            {msg("空值表示缺失，不会自动补零。")}
            {!editing && msg("数据表与图形使用同一份数据。")}
          </p>
        </>
      )}
      {tab === "source" &&
        (editing ? (
          <label htmlFor={id}>
            {msg("图表 JSON")}
            <textarea
              id={id}
              aria-label={msg("图表 JSON 源码")}
              spellCheck={false}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </label>
        ) : (
          <pre tabIndex={0}>
            <code>{source}</code>
          </pre>
        ))}
      {!editing && tab !== "source" && !checked.data && (
        <pre>
          <code>{source}</code>
        </pre>
      )}
      {editing && (
        <div className="chart-save-actions">
          <button
            onClick={() => {
              setEditing(false);
              setMessage("");
            }}
          >
            {msg("取消编辑")}
          </button>
          <button disabled={stale} onClick={apply}>
            {msg("应用图表修改")}
          </button>
        </div>
      )}
      {message && (
        <p role="status" className={editing ? "preview-error" : "preview-help"}>
          {message}
        </p>
      )}
      {sourceRefs !== undefined && !refs.length && checked.data && (
        <p className="preview-error" role="status">
          {msg("图表没有声明本次资料来源，暂不绘图；可查看数据表与源码。")}
        </p>
      )}
      {unknownRefs.length > 0 && (
        <p className="preview-error" role="status">
          {msg("来源")} {unknownRefs.join("、")}{" "}
          {msg("不属于本次资料，暂不绘图；可查看数据表与源码。")}
        </p>
      )}
      {refs.length > 0 && (
        <p className="chart-source-note">
          {msg("声明来源：")}{refs.join("、")}{msg("。来源编号不代表每个数值已经核验。")}
        </p>
      )}
      {readOnly && (
        <p className="chart-source-note">
          {msg("AI 生成，请核对类别、数值与单位；保存为文档后可编辑。")}
        </p>
      )}
      {checked.data && (
        <details className="chart-description">
          <summary>{msg("图表文字说明")}</summary>
          <p className="chart-summary">
            {checked.data.series.length} {msg("个系列 ·")} {checked.data.x.values.length} {msg("个分类")}
          </p>
          <pre>{chartText(checked.data)}</pre>
        </details>
      )}
    </section>
  );
}
