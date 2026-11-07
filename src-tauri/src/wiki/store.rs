use super::{error, Content, Policy, MAX_REFS, MAX_SECTIONS, MAX_SOURCES};
use crate::db;
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde::{de::DeserializeOwned, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const SCHEMA: i64 = 1;
const MAX_PAYLOAD: usize = 300_000;
const MAX_PAGES: i64 = 200;

pub(super) fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn path(data: &Path) -> PathBuf {
    data.join("wiki.sqlite3")
}

pub(super) fn exists(data: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path(data)) {
        Ok(meta) if meta.is_file() && !meta.file_type().is_symlink() => Ok(true),
        Ok(_) => Err("Wiki 存储必须是本机普通文件".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(error(e)),
    }
}

fn version(c: &Connection) -> Result<i64, String> {
    c.pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(error)
}

fn read_at(file: &Path) -> Result<Connection, String> {
    let c = Connection::open_with_flags(file, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(error)?;
    c.busy_timeout(std::time::Duration::from_secs(2))
        .map_err(error)?;
    if version(&c)? != SCHEMA {
        return Err("Wiki 存储版本不受支持".into());
    }
    Ok(c)
}

pub(super) fn read(data: &Path) -> Result<Connection, String> {
    if !exists(data)? {
        return Err("尚未建立 Wiki".into());
    }
    read_at(&path(data))
}

pub(super) fn write(data: &Path) -> Result<Connection, String> {
    exists(data)?;
    let c = Connection::open(path(data)).map_err(error)?;
    c.busy_timeout(std::time::Duration::from_secs(2))
        .map_err(error)?;
    match version(&c)? {
        SCHEMA => Ok(c),
        0 => {
            c.execute_batch("
                BEGIN IMMEDIATE;
                CREATE TABLE IF NOT EXISTS policies(space TEXT PRIMARY KEY,payload TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS pages(space TEXT NOT NULL,id TEXT NOT NULL,title_key TEXT NOT NULL,current INTEGER NOT NULL,PRIMARY KEY(space,id),UNIQUE(space,title_key));
                CREATE TABLE IF NOT EXISTS revisions(space TEXT NOT NULL,page TEXT NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(space,page,revision));
                CREATE TABLE IF NOT EXISTS changes(space TEXT NOT NULL,id TEXT NOT NULL,page TEXT NOT NULL,base INTEGER NOT NULL,result INTEGER NOT NULL,policy_revision INTEGER NOT NULL,status TEXT NOT NULL,reason TEXT NOT NULL,created INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(space,id));
                CREATE INDEX IF NOT EXISTS change_history ON changes(space,status,created);
                CREATE TABLE IF NOT EXISTS processed(space TEXT NOT NULL,document TEXT NOT NULL,fingerprint TEXT NOT NULL,PRIMARY KEY(space,document));
                CREATE TABLE IF NOT EXISTS jobs(space TEXT PRIMARY KEY,status TEXT NOT NULL,message TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS calls(space TEXT NOT NULL, day INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(space,day));
                CREATE VIRTUAL TABLE IF NOT EXISTS page_search USING fts5(space UNINDEXED,page UNINDEXED,title,summary,sections);
                PRAGMA user_version=1;
                COMMIT;
            ").map_err(error)?;
            Ok(c)
        }
        _ => Err("Wiki 存储版本不受支持".into()),
    }
}

fn encode<T: Serialize>(value: &T) -> Result<String, String> {
    let text = serde_json::to_string(value).map_err(error)?;
    if text.len() > MAX_PAYLOAD {
        return Err("Wiki 页面超过保存上限".into());
    }
    Ok(text)
}

fn decode<T: DeserializeOwned>(raw: &str) -> Result<T, String> {
    if raw.len() > MAX_PAYLOAD {
        return Err("Wiki 存储内容超过安全上限".into());
    }
    serde_json::from_str(raw).map_err(error)
}

pub(super) fn policy(c: &Connection, space: &str) -> Result<Policy, String> {
    let raw: Option<String> = c
        .query_row(
            "SELECT payload FROM policies WHERE space=?",
            [space],
            |row| row.get(0),
        )
        .optional()
        .map_err(error)?;
    raw.map(|value| decode(&value))
        .transpose()
        .map(Option::unwrap_or_default)
}

pub(super) fn save_policy(c: &Connection, space: &str, policy: &Policy) -> Result<(), String> {
    c.execute("INSERT INTO policies VALUES(?,?) ON CONFLICT(space) DO UPDATE SET payload=excluded.payload", params![space,encode(policy)?]).map_err(error)?;
    Ok(())
}

pub(super) fn pages(c: &Connection, space: &str) -> Result<Vec<(String, i64, Content)>, String> {
    let mut stmt = c.prepare("SELECT p.id,p.current,r.payload FROM pages p JOIN revisions r ON r.space=p.space AND r.page=p.id AND r.revision=p.current WHERE p.space=? ORDER BY p.title_key,p.id LIMIT 200").map_err(error)?;
    let rows = stmt
        .query_map([space], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get::<_, String>(2)?))
        })
        .map_err(error)?;
    rows.map(|row| {
        let (id, revision, raw) = row.map_err(error)?;
        Ok((id, revision, decode(&raw)?))
    })
    .collect()
}

pub(super) fn topic_titles(c: &Connection, space: &str) -> Result<Vec<String>, String> {
    let mut stmt = c.prepare("SELECT json_extract(r.payload,'$.title') FROM pages p JOIN revisions r ON r.space=p.space AND r.page=p.id AND r.revision=p.current WHERE p.space=? ORDER BY p.title_key LIMIT 40").map_err(error)?;
    let rows = stmt
        .query_map([space], |row| row.get::<_, String>(0))
        .map_err(error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(error)
}

pub(super) fn title_key(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

pub(super) fn find(
    c: &Connection,
    space: &str,
    key: &str,
) -> Result<Option<(String, i64)>, String> {
    c.query_row(
        "SELECT id,current FROM pages WHERE space=? AND title_key=?",
        params![space, key],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .optional()
    .map_err(error)
}

pub(super) fn current_revision(c: &Connection, space: &str, page: &str) -> Result<i64, String> {
    let value: Option<i64> = c
        .query_row(
            "SELECT current FROM pages WHERE space=? AND id=?",
            params![space, page],
            |row| row.get(0),
        )
        .optional()
        .map_err(error)?;
    Ok(value.unwrap_or(0))
}

pub(super) fn revision(
    c: &Connection,
    space: &str,
    page: &str,
    revision: i64,
) -> Result<Content, String> {
    let raw: String = c
        .query_row(
            "SELECT payload FROM revisions WHERE space=? AND page=? AND revision=?",
            params![space, page, revision],
            |row| row.get(0),
        )
        .optional()
        .map_err(error)?
        .ok_or("Wiki 页面或版本不存在")?;
    decode(&raw)
}

pub(super) struct Change {
    pub id: String,
    pub page_id: String,
    pub base: i64,
    pub result: i64,
    pub policy_revision: i64,
    pub status: String,
    pub reason: String,
    pub created: i64,
    pub content: Content,
}

const CHANGE_FIELDS: &str = "id,page,base,result,policy_revision,status,reason,created,payload";

fn change_row(row: &rusqlite::Row) -> rusqlite::Result<Change> {
    let raw: String = row.get(8)?;
    Ok(Change {
        id: row.get(0)?,
        page_id: row.get(1)?,
        base: row.get(2)?,
        result: row.get(3)?,
        policy_revision: row.get(4)?,
        status: row.get(5)?,
        reason: row.get(6)?,
        created: row.get(7)?,
        content: decode(&raw).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(8, rusqlite::types::Type::Text, e.into())
        })?,
    })
}

pub(super) fn changes(c: &Connection, space: &str) -> Result<Vec<Change>, String> {
    let mut stmt = c.prepare(&format!("SELECT {CHANGE_FIELDS} FROM changes WHERE space=? ORDER BY status='pending' DESC,created DESC,rowid DESC LIMIT 240")).map_err(error)?;
    let rows = stmt.query_map([space], change_row).map_err(error)?;
    rows.collect::<Result<_, _>>().map_err(error)
}

pub(super) fn pending_title(
    c: &Connection,
    space: &str,
    key: &str,
) -> Result<Option<Change>, String> {
    let mut stmt = c.prepare(&format!("SELECT {CHANGE_FIELDS} FROM changes WHERE space=? AND status='pending' ORDER BY created DESC,rowid DESC LIMIT 200")).map_err(error)?;
    let rows = stmt.query_map([space], change_row).map_err(error)?;
    for row in rows {
        let change = row.map_err(error)?;
        if title_key(&change.content.title) == key {
            return Ok(Some(change));
        }
    }
    Ok(None)
}

pub(super) fn supersede(c: &Connection, space: &str, id: &str) -> Result<(), String> {
    c.execute(
        "UPDATE changes SET status='superseded' WHERE space=? AND id=? AND status='pending'",
        params![space, id],
    )
    .map_err(error)?;
    Ok(())
}

pub(super) fn change(c: &Connection, space: &str, id: &str) -> Result<Change, String> {
    c.query_row(
        &format!("SELECT {CHANGE_FIELDS} FROM changes WHERE space=? AND id=?"),
        params![space, id],
        change_row,
    )
    .optional()
    .map_err(error)?
    .ok_or("Wiki 改动不存在".into())
}

pub(super) fn pending_count(c: &Connection, space: &str) -> Result<i64, String> {
    c.query_row(
        "SELECT COUNT(*) FROM changes WHERE space=? AND status='pending'",
        [space],
        |row| row.get(0),
    )
    .map_err(error)
}

pub(super) fn save_change(c: &Connection, space: &str, change: &Change) -> Result<(), String> {
    if change.status == "pending" && pending_count(c, space)? >= 200 {
        return Err("待审阅改动已达 200 条，请先处理一些改动".into());
    }
    c.execute(
        "INSERT INTO changes VALUES(?,?,?,?,?,?,?,?,?,?)",
        params![
            space,
            change.id,
            change.page_id,
            change.base,
            change.result,
            change.policy_revision,
            change.status,
            change.reason,
            change.created,
            encode(&change.content)?
        ],
    )
    .map_err(error)?;
    Ok(())
}

pub(super) fn reject(c: &Connection, space: &str, id: &str) -> Result<(), String> {
    c.execute(
        "UPDATE changes SET status='rejected' WHERE space=? AND id=? AND status='pending'",
        params![space, id],
    )
    .map_err(error)?;
    Ok(())
}

pub(super) fn publish(c: &Connection, space: &str, change: &Change) -> Result<(), String> {
    let revision = change.base.checked_add(1).ok_or("Wiki 版本号超过上限")?;
    let title_key = title_key(&change.content.title);
    if find(c, space, &title_key)?.is_some_and(|(id, _)| id != change.page_id) {
        return Err("同名主题已发布，请重新整理以合并内容".into());
    }
    if change.base == 0 {
        let count: i64 = c
            .query_row("SELECT COUNT(*) FROM pages WHERE space=?", [space], |row| {
                row.get(0)
            })
            .map_err(error)?;
        if count >= MAX_PAGES {
            return Err("本空间已达到 200 个 Wiki 页的上限".into());
        }
    }
    c.execute(
        "INSERT INTO revisions VALUES(?,?,?,?)",
        params![space, change.page_id, revision, encode(&change.content)?],
    )
    .map_err(error)?;
    c.execute("INSERT INTO pages VALUES(?,?,?,?) ON CONFLICT(space,id) DO UPDATE SET current=excluded.current,title_key=excluded.title_key", params![space,change.page_id,title_key,revision]).map_err(error)?;
    c.execute(
        "DELETE FROM page_search WHERE space=? AND page=?",
        params![space, change.page_id],
    )
    .map_err(error)?;
    let title = format!(
        "{} {}",
        change.content.title,
        change.content.aliases.join(" ")
    );
    let section_names = change
        .content
        .sections
        .iter()
        .map(|s| s.heading.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    c.execute(
        "INSERT INTO page_search VALUES(?,?,?,?,?)",
        params![
            space,
            change.page_id,
            db::tokenize(&title),
            db::tokenize(&change.content.summary()),
            db::tokenize(&section_names)
        ],
    )
    .map_err(error)?;
    c.execute(
        "UPDATE changes SET status='published',result=? WHERE space=? AND id=?",
        params![revision, space, change.id],
    )
    .map_err(error)?;
    c.execute("UPDATE changes SET status='superseded' WHERE space=? AND page=? AND status='pending' AND id<>?", params![space,change.page_id,change.id]).map_err(error)?;
    Ok(())
}

pub(super) fn record_job(
    c: &Connection,
    space: &str,
    status: &str,
    message: &str,
) -> Result<(), String> {
    c.execute("INSERT INTO jobs VALUES(?,?,?) ON CONFLICT(space) DO UPDATE SET status=excluded.status,message=excluded.message", params![space,status,message]).map_err(error)?;
    Ok(())
}

pub(super) fn reserve_call(c: &Connection, space: &str) -> Result<(), String> {
    let day = now() / 86_400;
    let changed = c.execute("INSERT INTO calls VALUES(?,?,1) ON CONFLICT(space,day) DO UPDATE SET count=count+1 WHERE count<6", params![space,day]).map_err(error)?;
    if changed == 0 {
        return Err("本空间今日已达到 6 次 Wiki 整理模型调用上限".into());
    }
    Ok(())
}

pub(super) fn processed(
    c: &Connection,
    space: &str,
    doc: &str,
    fingerprint: &str,
) -> Result<bool, String> {
    c.query_row(
        "SELECT EXISTS(SELECT 1 FROM processed WHERE space=? AND document=? AND fingerprint=?)",
        params![space, doc, fingerprint],
        |row| row.get(0),
    )
    .map_err(error)
}

pub(super) fn mark_processed(
    c: &Connection,
    space: &str,
    doc: &str,
    fingerprint: &str,
) -> Result<(), String> {
    c.execute("INSERT INTO processed VALUES(?,?,?) ON CONFLICT(space,document) DO UPDATE SET fingerprint=excluded.fingerprint", params![space,doc,fingerprint]).map_err(error)?;
    Ok(())
}

pub(crate) fn validate_snapshot(file: &Path) -> Result<(), String> {
    let c = read_at(file)?;
    let ok: String = c
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(error)?;
    if ok != "ok" {
        return Err("Wiki 数据库完整性检查失败".into());
    }
    for table in [
        "policies",
        "pages",
        "revisions",
        "changes",
        "processed",
        "jobs",
        "calls",
        "page_search",
    ] {
        c.prepare(&format!("SELECT * FROM {table} LIMIT 0"))
            .map_err(error)?;
    }
    let bad: i64 = c.query_row("SELECT COUNT(*) FROM pages p WHERE p.current<1 OR NOT EXISTS (SELECT 1 FROM revisions r WHERE r.space=p.space AND r.page=p.id AND r.revision=p.current) OR NOT EXISTS(SELECT 1 FROM policies w WHERE w.space=p.space)", [], |row| row.get(0)).map_err(error)?;
    if bad > 0 {
        return Err("Wiki 页面引用了不存在的发布版本或授权".into());
    }
    let mut stmt = c.prepare("SELECT payload FROM policies").map_err(error)?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(error)?;
    for row in rows {
        let policy: Policy = decode(&row.map_err(error)?)?;
        if policy.revision < 1
            || policy.topic.chars().count() > 120
            || policy.document_ids.len() > MAX_SOURCES
            || (policy.enabled && (policy.topic.is_empty() || policy.document_ids.is_empty()))
        {
            return Err("Wiki 备份的授权范围无效".into());
        }
    }
    let mut stmt = c
        .prepare("SELECT payload FROM revisions UNION ALL SELECT payload FROM changes")
        .map_err(error)?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(error)?;
    for row in rows {
        let content: Content = decode(&row.map_err(error)?)?;
        if content.title.is_empty()
            || content.title.chars().count() > 120
            || content.sections.is_empty()
            || content.sections.len() > MAX_SECTIONS
            || content.originals().count() > MAX_REFS
        {
            return Err("Wiki 备份的页面结构无效".into());
        }
        for source in content.originals() {
            crate::files::validate_relative(&source.path)?;
            if source.start_line == 0
                || source.end_line < source.start_line
                || source.end_line - source.start_line >= 12
                || source.hash.len() != 64
                || !source.hash.bytes().all(|c| c.is_ascii_hexdigit())
                || source.quote.is_empty()
                || source.quote.chars().count() > 1200
            {
                return Err("Wiki 备份的来源范围无效".into());
            }
        }
    }
    Ok(())
}
