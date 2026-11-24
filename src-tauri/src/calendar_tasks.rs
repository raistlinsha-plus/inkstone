//! Hash-keyed, disposable task projection. Original Markdown owns checkbox state and metadata.
use super::{date, valid_id, validate_event, EventData};
use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
const PREFIX: &str = "<!--inkstone-task:v1 ";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Slot {
    start: String,
    end: String,
    zone: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Meta {
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    due: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    waiting: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    follow_on: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    slot: Option<Slot>,
}
fn meta(raw: &str) -> Option<Meta> {
    if raw.len() > 2048 {
        return None;
    }
    let json = raw.strip_prefix(PREFIX)?.strip_suffix("-->")?;
    let value: Meta = serde_json::from_str(json).ok()?;
    let object: serde_json::Value = serde_json::from_str(json).ok()?;
    if object.as_object()?.values().any(|v| v.is_null())
        || !valid_id(&value.id)
        || value
            .due
            .iter()
            .chain(value.follow_on.iter())
            .any(|s| date(s).is_err())
        || value.follow_on.is_some() && value.waiting != Some(true)
    {
        return None;
    }
    if let Some(slot) = &value.slot {
        validate_event(&EventData {
            id: value.id.clone(),
            title: "Task".into(),
            start: slot.start.clone(),
            end: slot.end.clone(),
            time_zone: slot.zone.clone(),
            all_day: false,
            status: "planned".into(),
            notes: String::new(),
        })
        .ok()?;
    }
    Some(value)
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskRow {
    #[serde(flatten)]
    meta: Meta,
    title: String,
    done: bool,
    line: usize,
    marker_from: usize,
    marker_to: usize,
    title_from: usize,
    check_from: usize,
    duplicate: bool,
}
impl TaskRow {
    pub(crate) fn id(&self) -> &str {
        &self.meta.id
    }
    pub(crate) fn duplicate(&self) -> bool {
        self.duplicate
    }
}
pub(crate) fn rows(source: &str) -> Vec<TaskRow> {
    if !source.contains(PREFIX) {
        return vec![];
    }
    // Rust parser offsets are UTF-8. The text editor and DOM use UTF-16 offsets.
    let mut lines = vec![(0, 0)];
    let mut units = 0;
    for (byte, c) in source.char_indices() {
        units += c.len_utf16();
        if c == '\n' {
            lines.push((byte + 1, units));
        }
    }
    let mut result = vec![];
    let mut quote = 0;
    let mut check = None;
    let mut counts = HashMap::new();
    for (event, range) in Parser::new_ext(source, Options::ENABLE_TASKLISTS).into_offset_iter() {
        match event {
            Event::Start(Tag::BlockQuote(_)) => {
                quote += 1;
                check = None;
            }
            Event::End(TagEnd::BlockQuote(_)) => quote -= 1,
            Event::TaskListMarker(done) if quote == 0 => check = Some((range.start, done)),
            Event::InlineHtml(raw) if check.is_some() && quote == 0 => {
                let (checkbox, done) = check.unwrap();
                let Some(meta) = meta(&raw) else { continue };
                if checkbox > range.start {
                    continue;
                }
                let title_prefix = &source[checkbox..range.start];
                if title_prefix.contains(['\r', '\n']) {
                    continue;
                }
                let Some(bracket) = title_prefix.find('[') else {
                    continue;
                };
                let after = checkbox + bracket + 3;
                let Some(title) = source.get(after..range.start) else {
                    continue;
                };
                if !title.starts_with([' ', '\t'])
                    || source[range.end..]
                        .split('\n')
                        .next()
                        .is_some_and(|s| !s.trim().is_empty())
                {
                    continue;
                }
                let line = lines.partition_point(|(byte, _)| *byte <= range.start);
                let (byte, units) = lines[line - 1];
                let offset = |pos: usize| units + source[byte..pos].encode_utf16().count();
                let start = range.start - title.trim_start_matches([' ', '\t']).len();
                *counts.entry(meta.id.to_ascii_lowercase()).or_insert(0) += 1;
                result.push(TaskRow {
                    meta,
                    title: title.trim().into(),
                    done,
                    line,
                    marker_from: offset(range.start),
                    marker_to: offset(range.end),
                    check_from: offset(checkbox + bracket + 1),
                    title_from: offset(start),
                    duplicate: false,
                });
                check = None;
            }
            Event::Start(Tag::Item)
            | Event::End(TagEnd::Item)
            | Event::HardBreak
            | Event::SoftBreak => check = None,
            _ => {}
        }
    }
    for row in &mut result {
        row.duplicate = counts[&row.meta.id.to_ascii_lowercase()] > 1;
    }
    result
}
pub(super) fn read(
    c: &Connection,
    project: &str,
    document: &str,
    hash: &str,
) -> Option<Vec<TaskRow>> {
    let mut statement = c.prepare_cached(
        "SELECT rows_json FROM task_documents_v1 WHERE project=? AND document=? AND source_hash=?"
    ).ok()?;
    let data: Option<String> = statement
        .query_row(params![project, document, hash], |row| row.get(0))
        .optional()
        .ok()?;
    serde_json::from_str(&data?).ok()
}
pub(super) fn remove_missing(
    c: &Connection,
    project: &str,
    present: &std::collections::HashSet<&str>,
) -> Result<(), String> {
    let mut statement = c
        .prepare("SELECT document FROM task_documents_v1 WHERE project=?")
        .map_err(super::error)?;
    let mut removed = vec![];
    for id in statement
        .query_map([project], |row| row.get::<_, String>(0))
        .map_err(super::error)?
    {
        let id = id.map_err(super::error)?;
        if !present.contains(id.as_str()) {
            removed.push(id);
        }
    }
    for id in removed {
        c.execute(
            "DELETE FROM task_documents_v1 WHERE project=? AND document=?",
            params![project, id],
        )
        .map_err(super::error)?;
    }
    Ok(())
}
pub(super) fn write(
    c: &Connection,
    project: &str,
    document: &str,
    hash: &str,
    rows: &[TaskRow],
) -> Result<(), String> {
    c.execute("INSERT OR REPLACE INTO task_documents_v1(project,document,source_hash,rows_json) VALUES (?,?,?,?)",
        params![project,document,hash,serde_json::to_string(rows).map_err(super::error)?]).map_err(super::error)?;
    Ok(())
}

/// A text view for retrieval strips identifiers from tracked lines, retaining planned dates.
pub(crate) fn retrieval_text(source: &str) -> std::borrow::Cow<'_, str> {
    let entries = rows(source);
    if entries.is_empty() {
        return std::borrow::Cow::Borrowed(source);
    }
    let mut text = String::with_capacity(source.len());
    let mut tasks = entries.iter().peekable();
    for (idx, line) in source.split_inclusive('\n').enumerate() {
        if let Some(task) = tasks.next_if(|task| task.line == idx + 1) {
            if let Some(at) = line.rfind(PREFIX) {
                text.push_str(line[..at].trim_end());
                if let Some(date) = &task.meta.due {
                    text.push_str(" · due ");
                    text.push_str(date);
                }
                if let Some(date) = &task.meta.follow_on {
                    text.push_str(" · follow-up ");
                    text.push_str(date);
                }
                if let Some(slot) = &task.meta.slot {
                    text.push_str(" · scheduled ");
                    text.push_str(&slot.start);
                    text.push('–');
                    text.push_str(&slot.end);
                }
                if line.ends_with("\r\n") {
                    text.push_str("\r\n");
                } else if line.ends_with('\n') {
                    text.push('\n');
                }
                continue;
            }
        }
        text.push_str(line);
    }
    std::borrow::Cow::Owned(text)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn actual_checkboxes_only_with_utf16_offsets_and_independent_dates() {
        let id = "7741085c-8702-4250-a63a-c9a95f9af36a";
        let item=format!("  - [X] 🖋 中文 **title** <!--inkstone-task:v1 {{\"id\":\"{id}\",\"due\":\"2026-11-30\"}}-->");
        let doc=format!("Intro 🐈\r\n\r\n> {item}\r\n\r\n~~~md\r\n{item}\r\n~~~\r\n\r\n- [ ] ordinary\r\n{item}\r\n");
        let tasks = rows(&doc);
        assert_eq!(tasks.len(), 1);
        let task = &tasks[0];
        assert!(task.done);
        assert_eq!(task.line, 10);
        assert_eq!(task.title, "🖋 中文 **title**");
        let units = doc.encode_utf16().collect::<Vec<_>>();
        assert_eq!(
            String::from_utf16(&units[task.title_from..task.marker_from])
                .unwrap()
                .trim(),
            task.title
        );
        assert_eq!(units[task.check_from], 'X' as u16);
        let search = retrieval_text(&doc);
        assert!(search.ends_with("**title** · due 2026-11-30\r\n"));
        assert!(search.contains(&format!("~~~md\r\n{item}")));
        assert_eq!(
            rows(&format!("{item}\n{item}"))
                .iter()
                .filter(|r| r.duplicate)
                .count(),
            2
        );
    }
}
