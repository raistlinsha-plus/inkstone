use crate::{files, library};
use chrono::{DateTime, NaiveDate, Offset};
use chrono_tz::Tz;
use pulldown_cmark::{CodeBlockKind, Event, Parser, Tag, TagEnd};
use rusqlite::{params, Connection};
use serde::{
    de::{self, MapAccess, Visitor},
    Deserialize, Serialize,
};
use std::{collections::HashSet, path::Path};

fn error(e: impl std::fmt::Display) -> String {
    e.to_string()
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarDocument {
    pub document_id: String,
    pub title: String,
    pub path: String,
    pub content: String,
    pub hash: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarView {
    pub documents: Vec<CalendarDocument>,
    pub warnings: Vec<String>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EventData {
    id: String,
    title: String,
    start: String,
    end: String,
    time_zone: String,
    all_day: bool,
    status: String,
    notes: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CalendarData {
    schema: String,
    id: String,
    view: String,
    time_zone: String,
    events: Vec<EventData>,
}
struct Projected {
    block: String,
    event: EventData,
    start_line: usize,
    end_line: usize,
}
fn valid_id(id: &str) -> bool {
    id.len() == 36
        && id
            .as_bytes()
            .get(14)
            .is_some_and(|c| matches!(*c, b'1'..=b'8'))
        && id
            .as_bytes()
            .get(19)
            .is_some_and(|c| matches!(*c, b'8' | b'9' | b'a' | b'A' | b'b' | b'B'))
        && uuid::Uuid::parse_str(id).is_ok()
}
fn zone(value: &str) -> Result<Tz, String> {
    value
        .parse::<Tz>()
        .ok()
        .or_else(|| {
            chrono_tz::TZ_VARIANTS
                .iter()
                .find(|z| z.name().eq_ignore_ascii_case(value))
                .copied()
        })
        .ok_or("事项时区无效".into())
}
fn date(value: &str) -> Result<NaiveDate, String> {
    if value.len() != 10 || value.starts_with("0000") {
        return Err("全天事项请使用 YYYY-MM-DD".into());
    }
    let d = NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| "日期无效")?;
    if d.format("%Y-%m-%d").to_string() != value {
        return Err("日期无效".into());
    }
    Ok(d)
}
fn validate_event(e: &EventData) -> Result<(), String> {
    if !valid_id(&e.id)
        || e.title.trim().is_empty()
        || e.title.contains(['\n', '\r', '\0'])
        || e.title.chars().count() > 200
        || e.notes.chars().count() > 20000
        || e.notes.contains('\0')
    {
        return Err("事项标识、标题或备注无效".into());
    }
    if !["planned", "done", "cancelled"].contains(&e.status.as_str()) {
        return Err("事项状态无效".into());
    }
    let tz = zone(&e.time_zone)?;
    if e.all_day {
        if date(&e.end)? <= date(&e.start)? {
            return Err("全天结束日期必须晚于开始，且不包含结束日".into());
        }
    } else {
        for raw in [&e.start, &e.end] {
            if !raw.is_ascii()
                || raw.len() < 17
                || raw.len() > 35
                || raw.starts_with("0000")
                || raw.as_bytes().get(10) != Some(&b'T')
                || raw.as_bytes().get(13) != Some(&b':')
                || raw.get(16..19) == Some(":60")
            {
                return Err("请使用带明确偏移的 ISO 时间".into());
            }
            if let Some(dot) = raw.find('.') {
                let len = raw[dot + 1..]
                    .bytes()
                    .take_while(u8::is_ascii_digit)
                    .count();
                if len == 0 || len > 3 {
                    return Err("时间仅支持毫秒精度".into());
                }
            }
        }
        let normalize = |s: &str| {
            if s.as_bytes()
                .get(16)
                .is_some_and(|c| matches!(*c, b'Z' | b'+' | b'-'))
            {
                format!("{}:00{}", &s[..16], &s[16..])
            } else {
                s.to_string()
            }
        };
        let start = DateTime::parse_from_rfc3339(&normalize(&e.start))
            .map_err(|_| "开始时间需要明确时区偏移")?;
        let end = DateTime::parse_from_rfc3339(&normalize(&e.end))
            .map_err(|_| "结束时间需要明确时区偏移")?;
        if start >= end {
            return Err("结束时间必须晚于开始".into());
        }
        for (d, raw) in [(start, e.start.as_str()), (end, e.end.as_str())] {
            if !raw.ends_with('Z')
                && d.with_timezone(&tz).offset().fix().local_minus_utc()
                    != d.offset().local_minus_utc()
            {
                return Err("时间偏移与时区不符，请核对夏令时".into());
            }
        }
    }
    Ok(())
}
// Check unknown extension objects too, retaining their original number literals.
// RawValue avoids rounding large integers or rejecting an opaque extension number.
fn unique_json_keys(source: &str, depth: usize) -> Result<(), String> {
    let source = source.trim();
    if depth >= 128 && (source.starts_with('{') || source.starts_with('[')) {
        return Err("日历 JSON 嵌套超过 128 层".into());
    }
    if source.starts_with('{') {
        struct ObjectVisitor(usize);
        impl<'de> Visitor<'de> for ObjectVisitor {
            type Value = ();
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("没有重复字段的 JSON 对象")
            }
            fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
                let mut keys = HashSet::new();
                while let Some(key) = map.next_key::<String>()? {
                    if !keys.insert(key) {
                        return Err(de::Error::custom("日历 JSON 存在重复字段"));
                    }
                    let value = map.next_value::<&'de serde_json::value::RawValue>()?;
                    unique_json_keys(value.get(), self.0 + 1).map_err(de::Error::custom)?;
                }
                Ok(())
            }
        }
        let mut deserializer = serde_json::Deserializer::from_str(source);
        serde::de::Deserializer::deserialize_map(&mut deserializer, ObjectVisitor(depth))
            .map_err(|_| "日历 JSON 无效或存在重复字段")?;
    } else if source.starts_with('[') {
        let values: Vec<&serde_json::value::RawValue> =
            serde_json::from_str(source).map_err(|_| "日历 JSON 无效")?;
        for value in values {
            unique_json_keys(value.get(), depth + 1)?;
        }
    }
    Ok(())
}
fn parse_block(source: &str) -> Result<CalendarData, String> {
    if source.chars().count() > 300_000 {
        return Err("日历块超过 300,000 字符".into());
    }
    unique_json_keys(source, 0)?;
    let data: CalendarData =
        serde_json::from_str(source).map_err(|_| "日历 JSON 无效，保留原文，请在代码中修正")?;
    if data.schema != "inkstone.calendar/v1"
        || !valid_id(&data.id)
        || !["agenda", "month"].contains(&data.view.as_str())
        || zone(&data.time_zone).is_err()
        || data.events.len() > 500
    {
        return Err("日历版本、标识、视图、时区或事项数量无效".into());
    }
    let mut ids = HashSet::new();
    for event in &data.events {
        validate_event(event)?;
        if !ids.insert(event.id.to_lowercase()) {
            return Err("同一日历存在重复事项标识".into());
        }
    }
    Ok(data)
}
fn closed_fence(raw: &str) -> bool {
    let Some(first) = raw.lines().next() else {
        return false;
    };
    let Some(marker) = first.chars().find(|c| *c == '~' || *c == char::from(96)) else {
        return false;
    };
    let opening = first
        .chars()
        .skip_while(|c| *c != marker)
        .take_while(|c| *c == marker)
        .count();
    let Some(last) = raw.lines().rev().find(|s| !s.trim().is_empty()) else {
        return false;
    };
    let ending = last
        .trim()
        .trim_start_matches(|c: char| c == '>' || c.is_whitespace());
    opening >= 3 && ending.len() >= opening && ending.chars().all(|c| c == marker)
}

fn projection(content: &str) -> (Vec<Projected>, Vec<String>) {
    let mut result: Vec<Projected> = vec![];
    let mut warnings = vec![];
    let mut active: Option<(usize, String)> = None;
    let mut seen = HashSet::new();
    for (event, range) in Parser::new(content).into_offset_iter() {
        match event {
            Event::Start(Tag::CodeBlock(CodeBlockKind::Fenced(lang)))
                if lang
                    .split_whitespace()
                    .next()
                    .is_some_and(|s| s.eq_ignore_ascii_case("calendar")) =>
            {
                active = Some((range.start, String::new()))
            }
            Event::Text(text) if active.is_some() => active.as_mut().unwrap().1.push_str(&text),
            Event::End(TagEnd::CodeBlock) => {
                if let Some((start, source)) = active.take() {
                    if !closed_fence(&content[start..range.end.min(content.len())]) {
                        warnings.push("日历围栏未闭合，请在源码中修正".into());
                        continue;
                    }
                    match parse_block(&source) {
                        Ok(data) => {
                            if !seen.insert(data.id.to_lowercase()) {
                                result.retain(|p| !p.block.eq_ignore_ascii_case(&data.id));
                                warnings.push("同文档日历块标识重复，请复制为独立日历".into());
                                continue;
                            }
                            let start_line = content[..start].lines().count() + 1;
                            let end_line = content[..range.end.min(content.len())].lines().count();
                            for event in data.events {
                                result.push(Projected {
                                    block: data.id.clone(),
                                    event,
                                    start_line,
                                    end_line,
                                });
                            }
                        }
                        Err(e) => warnings.push(e),
                    }
                }
            }
            _ => (),
        }
    }
    (result, warnings)
}
fn connection(data: &Path) -> Result<Connection, String> {
    std::fs::create_dir_all(data).map_err(error)?;
    let c = Connection::open(data.join("calendar.sqlite3")).map_err(error)?;
    c.busy_timeout(std::time::Duration::from_secs(3))
        .map_err(error)?;
    let version: i64 = c
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(error)?;
    if version > 1 {
        return Err("日历索引来自更新版本，请使用新版应用".into());
    }
    c.execute_batch("PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS events(project TEXT NOT NULL,document TEXT NOT NULL,block TEXT NOT NULL,event TEXT NOT NULL,title TEXT NOT NULL,start TEXT NOT NULL,end TEXT NOT NULL,time_zone TEXT NOT NULL,all_day INTEGER NOT NULL,status TEXT NOT NULL,notes TEXT NOT NULL,path TEXT NOT NULL,source_hash TEXT NOT NULL,start_line INTEGER NOT NULL,end_line INTEGER NOT NULL,PRIMARY KEY(project,document,block,event));
      CREATE INDEX IF NOT EXISTS events_project_date ON events(project,start,end);
      PRAGMA user_version=1;").map_err(error)?;
    Ok(c)
}
fn projection_lock<T>(action: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = LOCK.lock().map_err(|_| "日历索引暂不可用")?;
    action()
}
pub fn refresh(data: &Path, project: &str) -> Result<CalendarView, String> {
    projection_lock(|| refresh_project(data, project))
}
fn refresh_project(data: &Path, project: &str) -> Result<CalendarView, String> {
    let root = library::project_root(data, project)?;
    let view = library::list(data)?;
    let mut documents = vec![];
    let mut warnings = vec![];
    let mut projected = vec![];
    let mut bytes = 0usize;
    for doc in view
        .documents
        .iter()
        .filter(|d| d.project_id == project && d.status == "ready")
    {
        if !doc.path.to_lowercase().ends_with(".md")
            && !doc.path.to_lowercase().ends_with(".markdown")
        {
            continue;
        }
        if documents.len() >= 2000 {
            warnings.push("日历最多扫描 2000 篇文档，请缩小项目".into());
            break;
        }
        let read = files::resolve(&root, &doc.path, false).and_then(|p| files::read_text(&p));
        match read {
            Ok(content) => {
                bytes += content.len();
                if bytes > 30 * 1024 * 1024 {
                    warnings.push("项目日历文本超过 30 MB，请拆分项目".into());
                    break;
                }
                let hash = files::hash(&content);
                let (events, errors) = projection(&content);
                warnings.extend(errors.into_iter().map(|e| format!("{}：{e}", doc.title)));
                projected.push((doc.clone(), hash.clone(), events));
                documents.push(CalendarDocument {
                    document_id: doc.id.clone(),
                    title: doc.title.clone(),
                    path: doc.path.clone(),
                    content,
                    hash,
                });
            }
            Err(e) => warnings.push(format!("{}：{e}", doc.title)),
        }
    }
    let stored = (|| -> Result<(), String> {
        let mut c = connection(data)?;
        let tx = c.transaction().map_err(error)?;
        tx.execute("DELETE FROM events WHERE project=?", [project])
            .map_err(error)?;
        for (doc, hash, events) in projected {
            write_events(&tx, project, &doc.id, &doc.path, &hash, events)?;
        }
        tx.commit().map_err(error)
    })();
    if stored.is_err() {
        warnings.push("日历索引暂不可用；当前列表仍根据原文显示，稍后刷新可重建。".into());
    }
    Ok(CalendarView {
        documents,
        warnings,
    })
}
fn write_events(
    tx: &rusqlite::Transaction,
    project: &str,
    document: &str,
    path: &str,
    hash: &str,
    events: Vec<Projected>,
) -> Result<(), String> {
    for p in events {
        tx.execute(
            "INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            params![
                project,
                document,
                p.block,
                p.event.id,
                p.event.title,
                p.event.start,
                p.event.end,
                p.event.time_zone,
                p.event.all_day,
                p.event.status,
                p.event.notes,
                path,
                hash,
                p.start_line,
                p.end_line
            ],
        )
        .map_err(error)?;
    }
    Ok(())
}
/// Call after source persistence while its file write lock is held.
/// Only this document is projected, avoiding a whole-project scan per keystroke save.
pub fn refresh_saved(data: &Path, root: &Path, path: &str, content: &str) -> Result<(), String> {
    let Some(project) = library::project_at_root(data, root) else {
        return Ok(());
    };
    let Some((document, _)) = library::title_for(data, root, path) else {
        return Ok(());
    };
    let doc = library::get(data, &document)?;
    if doc.status != "ready" {
        return Ok(());
    }
    projection_lock(|| {
        let mut c = connection(data)?;
        c.busy_timeout(std::time::Duration::from_millis(80))
            .map_err(error)?;
        let tx = c.transaction().map_err(error)?;
        tx.execute(
            "DELETE FROM events WHERE project=? AND document=?",
            params![project, document],
        )
        .map_err(error)?;
        let events =
            if path.to_lowercase().ends_with(".md") || path.to_lowercase().ends_with(".markdown") {
                projection(content).0
            } else {
                vec![]
            };
        write_events(
            &tx,
            &project,
            &document,
            path,
            &files::hash(content),
            events,
        )?;
        tx.commit().map_err(error)
    })
}
#[cfg(test)]
fn validate_document(content: &str) -> Result<(), String> {
    let (_, errors) = projection(content);
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("；"))
    }
}
fn sources(content: &str) -> Vec<String> {
    let mut values = vec![];
    let mut active: Option<(usize, String)> = None;
    for (event, range) in Parser::new(content).into_offset_iter() {
        match event {
            Event::Start(Tag::CodeBlock(CodeBlockKind::Fenced(lang)))
                if lang
                    .split_whitespace()
                    .next()
                    .is_some_and(|s| s.eq_ignore_ascii_case("calendar")) =>
            {
                active = Some((range.start, String::new()))
            }
            Event::Text(t) if active.is_some() => active.as_mut().unwrap().1.push_str(&t),
            Event::End(TagEnd::CodeBlock) => {
                if let Some((start, s)) = active.take() {
                    if closed_fence(&content[start..range.end.min(content.len())]) {
                        values.push(s)
                    } else {
                        values.push(String::from("UNTERMINATED:") + &s)
                    }
                }
            }
            _ => (),
        }
    }
    values
}
/// Existing malformed blocks stay literal; editing another valid block must remain possible.
pub fn validate_edit(before: &str, after: &str) -> Result<(), String> {
    fn checked(content: &str) -> Vec<(String, Result<(), String>)> {
        let parsed: Vec<_> = sources(content)
            .into_iter()
            .map(|s| {
                let parsed = parse_block(&s);
                (s, parsed)
            })
            .collect();
        let mut counts = std::collections::HashMap::<String, usize>::new();
        for (_, data) in &parsed {
            if let Ok(data) = data {
                *counts.entry(data.id.to_lowercase()).or_default() += 1;
            }
        }
        parsed
            .into_iter()
            .map(|(s, data)| {
                let result = data.and_then(|data| {
                    if counts.get(&data.id.to_lowercase()).copied().unwrap_or(0) > 1 {
                        Err("同文档日历块标识重复，请复制为独立日历".into())
                    } else {
                        Ok(())
                    }
                });
                (s, result)
            })
            .collect()
    }
    let mut invalid: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for (s, result) in checked(before) {
        if result.is_err() {
            *invalid.entry(s).or_default() += 1;
        }
    }
    for (s, result) in checked(after) {
        if let Err(e) = result {
            if let Some(n) = invalid.get_mut(&s).filter(|n| **n > 0) {
                *n -= 1;
            } else {
                return Err(e);
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn block(id: &str, event: &str) -> String {
        format!("前文\n\n~~~calendar\n{{\"schema\":\"inkstone.calendar/v1\",\"id\":\"{id}\",\"view\":\"month\",\"timeZone\":\"Asia/Shanghai\",\"events\":[{{\"id\":\"{event}\",\"title\":\"评审\",\"start\":\"2026-10-28T10:00:00+08:00\",\"end\":\"2026-10-28T11:00:00+08:00\",\"timeZone\":\"Asia/Shanghai\",\"allDay\":false,\"status\":\"planned\",\"notes\":\"\"}}]}}\n~~~\n\n后文")
    }
    #[test]
    fn projection_tracks_identity_versions_and_trash() {
        let data = tempfile::tempdir().unwrap();
        let source = block(
            "d85dab54-d06f-410f-b743-87282c9c3c2b",
            "11bec4c6-dfa0-4f80-a591-564e971f3305",
        );
        let d = library::create_document(data.path(), "inbox", "日程.md", &source).unwrap();
        let v = refresh(data.path(), "inbox").unwrap();
        assert_eq!(v.documents.len(), 1);
        assert!(v.warnings.is_empty());
        let c = connection(data.path()).unwrap();
        let n: i64 = c
            .query_row("SELECT count(*) FROM events", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
        let line: i64 = c
            .query_row("SELECT start_line FROM events", [], |r| r.get(0))
            .unwrap();
        assert_eq!(line, 3);
        library::rename(data.path(), &d.id, "新标题.md").unwrap();
        assert_eq!(
            refresh(data.path(), "inbox").unwrap().documents[0].document_id,
            d.id
        );
        library::trash(data.path(), &d.id, false).unwrap();
        assert!(refresh(data.path(), "inbox").unwrap().documents.is_empty());
        assert_eq!(
            c.query_row::<i64, _, _>("SELECT count(*) FROM events", [], |r| r.get(0))
                .unwrap(),
            0
        );
        library::trash(data.path(), &d.id, true).unwrap();
        assert_eq!(refresh(data.path(), "inbox").unwrap().documents.len(), 1);
    }
    #[test]
    fn rejects_wrong_offsets_duplicate_blocks_but_keeps_original() {
        let source = block(
            "d85dab54-d06f-410f-b743-87282c9c3c2b",
            "11bec4c6-dfa0-4f80-a591-564e971f3305",
        );
        assert!(validate_document(&source).is_ok());
        assert!(validate_document(&source.replace("+08:00", "+09:00")).is_err());
        assert!(validate_document(&(source.clone() + "\n" + &source)).is_err());
        let (events, errors) = projection(&(source + "\n~~~calendar\n{bad\n~~~"));
        assert_eq!(events.len(), 1);
        assert_eq!(errors.len(), 1);
    }
    #[test]
    fn source_save_refreshes_only_its_calendar_projection() {
        let data = tempfile::tempdir().unwrap();
        let source = block(
            "d85dab54-d06f-410f-b743-87282c9c3c2b",
            "11bec4c6-dfa0-4f80-a591-564e971f3305",
        );
        let a = library::create_document(data.path(), "inbox", "A.md", &source).unwrap();
        let b = library::create_document(data.path(), "inbox", "B.md", &source).unwrap();
        refresh(data.path(), "inbox").unwrap();
        let ws = crate::documents::library_workspace(data.path(), "inbox").unwrap();
        crate::documents::save(
            &ws,
            data.path(),
            &a.path,
            &source.replace("评审", "更新后的评审"),
            &files::hash(&source),
        )
        .unwrap();
        let c = connection(data.path()).unwrap();
        assert_eq!(
            c.query_row::<String, _, _>(
                "SELECT title FROM events WHERE document=?",
                [&a.id],
                |r| r.get(0)
            )
            .unwrap(),
            "更新后的评审"
        );
        assert_eq!(
            c.query_row::<String, _, _>(
                "SELECT title FROM events WHERE document=?",
                [&b.id],
                |r| r.get(0)
            )
            .unwrap(),
            "评审"
        );
        let updated = source.replace("评审", "更新后的评审");
        crate::documents::save(
            &ws,
            data.path(),
            &a.path,
            "# 日历已删除",
            &files::hash(&updated),
        )
        .unwrap();
        assert_eq!(
            c.query_row::<i64, _, _>("SELECT count(*) FROM events", [], |r| r.get(0))
                .unwrap(),
            1
        );
    }
    #[test]
    fn unavailable_projection_never_hides_source_or_fails_a_source_save() {
        let data = tempfile::tempdir().unwrap();
        let source = block(
            "d85dab54-d06f-410f-b743-87282c9c3c2b",
            "11bec4c6-dfa0-4f80-a591-564e971f3305",
        );
        let doc = library::create_document(data.path(), "inbox", "A.md", &source).unwrap();
        std::fs::write(data.path().join("calendar.sqlite3"), "invalid cache").unwrap();
        let ws = crate::documents::library_workspace(data.path(), "inbox").unwrap();
        let updated = source.replace("评审", "新事项");
        let saved =
            crate::documents::save(&ws, data.path(), &doc.path, &updated, &files::hash(&source))
                .unwrap();
        assert!(saved.warning.is_some());
        let view = refresh(data.path(), "inbox").unwrap();
        assert_eq!(view.documents[0].content, updated);
        assert!(!view.warnings.is_empty());
    }
    #[test]
    fn daylight_saving_and_all_day_boundaries() {
        let mut e:EventData=serde_json::from_value(serde_json::json!({"id":"11bec4c6-dfa0-4f80-a591-564e971f3305","title":"DST","start":"2026-03-08T01:30:00-05:00","end":"2026-03-08T03:30:00-04:00","timeZone":"America/New_York","allDay":false,"status":"planned","notes":""})).unwrap();
        assert!(validate_event(&e).is_ok());
        e.start = "2026-03-08T02:30:00-05:00".into();
        assert!(validate_event(&e).is_err());
        e.all_day = true;
        e.start = "2026-12-31".into();
        e.end = "2027-01-02".into();
        assert!(validate_event(&e).is_ok());
        e.end = e.start.clone();
        assert!(validate_event(&e).is_err());
    }
    #[test]
    fn edits_reject_new_duplicate_and_unclosed_blocks_but_preserve_existing_literals() {
        let source = block(
            "d85dab54-d06f-410f-b743-87282c9c3c2b",
            "11bec4c6-dfa0-4f80-a591-564e971f3305",
        );
        let duplicate = format!("{source}\n{source}");
        assert!(validate_edit(&source, &duplicate).is_err());
        assert!(validate_edit(&duplicate, &(duplicate.clone() + "\n新增正文")).is_ok());
        let malformed = format!("{source}\n~~~calendar\n{{bad\n~~~");
        assert!(validate_edit(&malformed, &(malformed.clone() + "\n新增正文")).is_ok());
        let unclosed = source.replacen("\n~~~\n\n后文", "\n", 1);
        assert!(validate_document(&unclosed).is_err());
        assert!(validate_edit(&source, &unclosed).is_err());
        let quote = source
            .lines()
            .map(|s| format!("> {s}"))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(validate_document(&quote).is_ok());
        assert!(validate_edit(&source, &source).is_ok());
        assert!(validate_document(&source.replace("Asia/Shanghai", "asia/shanghai")).is_ok());
        assert!(validate_document(&source.replace(
            "\"view\":\"month\"",
            "\"extension\":{\"a\":1,\"a\":2},\"view\":\"month\""
        ))
        .is_err());
        assert!(validate_document(&source.replace(
            "\"view\":\"month\"",
            "\"extension\":{\"large\":9007199254740993,\"huge\":1e500},\"view\":\"month\""
        ))
        .is_ok());
        assert!(validate_document(
            &source
                .replace("10:00:00+08:00", "02:00Z")
                .replace("11:00:00+08:00", "03:00Z")
        )
        .is_ok());
    }
}
