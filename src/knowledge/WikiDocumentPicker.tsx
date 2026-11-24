import { msg, translate } from "../i18n";
import type { LibraryDocument } from "../library";

// Keep the selection limit in sync with the Wiki policy and backup validator.
const maxDocuments = 1_000;

export default function WikiDocumentPicker({
  documents,
  selectedIds,
  filter,
  onFilter,
  onChange,
  busy,
}: {
  documents: LibraryDocument[];
  selectedIds: string[];
  filter: string;
  onFilter: (filter: string) => void;
  onChange: (ids: string[]) => void;
  busy: boolean;
}) {
  if (!documents.length && !selectedIds.length)
    return <small>{msg("请先在当前空间导入或新建文档。")}</small>;

  const query = documents.length ? filter.trim().toLocaleLowerCase() : "";
  const matches = documents.filter((doc) =>
    doc.title.toLocaleLowerCase().includes(query),
  );
  const visible = new Set(matches.map((doc) => doc.id));
  const selected = new Set(selectedIds);
  const unselected = [...visible].filter((id) => !selected.has(id));
  const selectedHere = visible.size - unselected.length;
  const allChecked = visible.size > 0 && !unselected.length;
  const exceedsLimit = selected.size + unselected.length > maxDocuments;

  function clearVisible() {
    onChange(selectedIds.filter((id) => !visible.has(id)));
  }

  return (
    <>
      {documents.length > 0 && (
        <label>
          {msg("筛选资料")}
          <input
            type="search"
            value={filter}
            onChange={(event) => onFilter(event.target.value)}
          />
        </label>
      )}
      <div className="wiki-picker">
        <div className="wiki-picker-actions">
          <label>
            <input
              type="checkbox"
              aria-label={
                query
                  ? translate(
                      `全选筛选结果，共 ${visible.size} 篇`,
                      `Select all ${visible.size} matching documents`,
                    )
                  : translate(
                      `全选 ${visible.size} 篇资料`,
                      `Select all ${visible.size} documents`,
                    )
              }
              checked={allChecked}
              ref={(input) => {
                if (input)
                  input.indeterminate = selectedHere > 0 && !allChecked;
              }}
              disabled={busy || !visible.size || exceedsLimit}
              onChange={(event) => {
                if (event.target.checked)
                  onChange([...selectedIds, ...unselected]);
                else clearVisible();
              }}
            />
            {query
              ? translate("全选筛选结果", "Select all matches")
              : translate("全选", "Select all")}
            <span className="wiki-picker-count">{visible.size}</span>
          </label>
          <button
            type="button"
            disabled={busy || !(query ? selectedHere : selected.size)}
            onClick={() => {
              if (query) clearVisible();
              else onChange([]);
            }}
          >
            {query
              ? translate("清除筛选内已选", "Clear selected matches")
              : translate("清除已选", "Clear selection")}
          </button>
        </div>
        {exceedsLimit && (
          <p className="muted wiki-picker-limit">
            {translate(
              `最多可选择 ${maxDocuments} 篇资料，请缩小筛选范围或取消部分选择。`,
              `Select up to ${maxDocuments} documents. Narrow the filter or remove some selections.`,
            )}
          </p>
        )}
        <div className="wiki-document-list">
          {matches.map((doc) => (
            <label key={doc.id}>
              <input
                type="checkbox"
                checked={selected.has(doc.id)}
                disabled={
                  busy ||
                  (selected.size >= maxDocuments && !selected.has(doc.id))
                }
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...selectedIds, doc.id]
                      : selectedIds.filter((id) => id !== doc.id),
                  )
                }
              />
              {doc.title}
            </label>
          ))}
          {!visible.size && (
            <small>
              {documents.length
                ? msg("没有匹配的资料。")
                : msg("请先在当前空间导入或新建文档。")}
            </small>
          )}
        </div>
      </div>
    </>
  );
}
