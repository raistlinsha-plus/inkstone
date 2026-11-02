import { useEffect, useId, useMemo, useState } from "react";
import { chartText, parseChart, type ChartData } from "../content/chart";
import Graph from "./Graph";
import { loadBlockDraft, saveBlockDraft } from "./drafts";
import "./chart.css";

type Props = {
  source: string;
  onApply?: (base: string, next: string) => void;
  onError?: (message: string) => void;
  readOnly?: boolean;
  sourceRefs?: string[];
  viewKey?: string;
  onEditingChange?: (active: boolean) => void;
};
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
}: Props) {
  const id = useId();
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
  return (
    <section className="data-chart" aria-label="数据图表">
      <div className="chart-tabs" role="group" aria-label="图表视图">
        {(
          [
            ["chart", "图表"],
            ["data", "数据表"],
            ["source", "源码"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            aria-pressed={tab === key}
            disabled={editing && key !== tab}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
        {!readOnly && onApply && !editing && (
          <button className="chart-edit-button" onClick={begin}>
            编辑图表
          </button>
        )}
      </div>
      {checked.error && !editing && (
        <div className="preview-error" role="status">
          {checked.error} <span>可以查看源码并修正。</span>
        </div>
      )}
      {stale && (
        <p className="preview-error" role="alert">
          原文已变化。草稿已保留，取消后可重新编辑。
        </p>
      )}
      {tab === "chart" && checked.data && !untrustedSources && (
        <>
          <Graph
            kind="chart"
            source={source}
            onError={(error) => {
              setMessage(error);
              onError?.(error);
            }}
          />
          <p className="chart-summary">
            {checked.data.title} · {checked.data.series.length} 个系列 ·{" "}
            {checked.data.x.values.length} 个分类
            {checked.data.y.unit ? ` · 单位：${checked.data.y.unit}` : ""}
          </p>
        </>
      )}
      {tab === "data" && shown && (
        <>
          {editing && (
            <div className="chart-fields">
              <label>
                标题
                <input
                  aria-label="图表标题"
                  value={shown.title}
                  onChange={(e) =>
                    setFields({ ...shown, title: e.target.value })
                  }
                />
              </label>
              <label>
                类型
                <select
                  aria-label="图表类型"
                  value={shown.type}
                  onChange={(e) =>
                    setFields({
                      ...shown,
                      type: e.target.value as ChartData["type"],
                      donut: e.target.value === "pie" ? shown.donut : undefined,
                    })
                  }
                >
                  <option value="bar">柱状图</option>
                  <option value="line">折线图</option>
                  <option value="pie">饼图</option>
                </select>
              </label>
              <label>
                分类轴
                <input
                  aria-label="分类轴名称"
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
                数值轴
                <input
                  aria-label="数值轴名称"
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
                单位
                <input
                  aria-label="图表单位"
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
                  环形显示
                </label>
              ) : (
                <label>
                  方向
                  <select
                    aria-label="图表方向"
                    value={shown.orientation ?? "vertical"}
                    onChange={(e) =>
                      setFields({
                        ...shown,
                        orientation: e.target.value as
                          "vertical" | "horizontal",
                      })
                    }
                  >
                    <option value="vertical">纵向</option>
                    <option value="horizontal">横向</option>
                  </select>
                </label>
              )}
            </div>
          )}
          <div className="chart-table-wrap">
            <table className="chart-table" aria-label={`${shown.title}数据表`}>
              <thead>
                <tr>
                  <th scope="col">{shown.x.label || "分类"}</th>
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
                  {editing && <th scope="col">操作</th>}
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
                            placeholder="缺失"
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
                          <span className="chart-missing">缺失</span>
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
                新增分类
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
                新增系列
              </button>
            </div>
          )}
          <p className="preview-help">
            空值表示缺失，不会自动补零。
            {!editing && "数据表与图形使用同一份数据。"}
          </p>
        </>
      )}
      {tab === "source" &&
        (editing ? (
          <label htmlFor={id}>
            图表 JSON
            <textarea
              id={id}
              aria-label="图表 JSON 源码"
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
            取消编辑
          </button>
          <button disabled={stale} onClick={apply}>
            应用图表修改
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
          图表没有声明本次资料来源，暂不绘图；可查看数据表与源码。
        </p>
      )}
      {unknownRefs.length > 0 && (
        <p className="preview-error" role="status">
          来源 {unknownRefs.join("、")}{" "}
          不属于本次资料，暂不绘图；可查看数据表与源码。
        </p>
      )}
      {refs.length > 0 && (
        <p className="chart-source-note">
          声明来源：{refs.join("、")}。来源编号不代表每个数值已经核验。
        </p>
      )}
      {readOnly && (
        <p className="chart-source-note">
          AI 生成，请核对类别、数值与单位；保存为文档后可编辑。
        </p>
      )}
      {checked.data && (
        <details className="chart-description">
          <summary>图表文字说明</summary>
          <pre>{chartText(checked.data)}</pre>
        </details>
      )}
    </section>
  );
}
