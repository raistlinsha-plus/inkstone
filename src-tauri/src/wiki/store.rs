use super::{error, Content, Policy, MAX_REFS, MAX_SECTIONS, MAX_SOURCES};
use crate::db;
use rusqlite::{params, Connection, OpenFlags, OptionalExtension, TransactionBehavior};
use serde::{de::DeserializeOwned, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const SCHEMA: i64 = 2;
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
    Ok(c)
}

pub(super) fn read(data: &Path) -> Result<Connection, String> {
    if !exists(data)? {
        return Err("尚未建立 Wiki".into());
    }
    let c = read_at(&path(data))?;
    if version(&c)? == 1 {
        drop(c);
        upgrade_legacy(data)?;
        return read_at(&path(data));
    }
    if version(&c)? != SCHEMA {
        return Err("Wiki 存储版本不受支持".into());
    }
    Ok(c)
}

pub(super) fn write(data: &Path) -> Result<Connection, String> {
    exists(data)?;
    let mut c = Connection::open(path(data)).map_err(error)?;
    c.busy_timeout(std::time::Duration::from_secs(2))
        .map_err(error)?;
    c.pragma_update(None, "secure_delete", true)
        .map_err(error)?;
    if version(&c)? == SCHEMA {
        return Ok(c);
    }
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(error)?;
    match version(&tx)? {
        SCHEMA => (),
        1 => {
            // Older revisions record citations only. No part of the generated payload can
            // reliably be attributed to the inputs it read, including titles and aliases.
            tx.execute_batch("
                DELETE FROM page_search;
                INSERT INTO page_search(page_search) VALUES('rebuild');
                DELETE FROM changes;
                DELETE FROM revisions;
                DELETE FROM pages;
                DELETE FROM processed;
                UPDATE jobs SET status='idle',message='旧版 Wiki 未记录完整来源，已移除旧生成内容。授权范围仍保留，可重新整理。';
                INSERT OR IGNORE INTO jobs SELECT space,'idle','旧版 Wiki 未记录完整来源，已移除旧生成内容。授权范围仍保留，可重新整理。' FROM policies;
                PRAGMA user_version=2;
            ").map_err(error)?;
        }
        0 => {
            tx.execute_batch("
                CREATE TABLE IF NOT EXISTS policies(space TEXT PRIMARY KEY,payload TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS pages(space TEXT NOT NULL,id TEXT NOT NULL,title_key TEXT NOT NULL,current INTEGER NOT NULL,PRIMARY KEY(space,id),UNIQUE(space,title_key));
                CREATE TABLE IF NOT EXISTS revisions(space TEXT NOT NULL,page TEXT NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(space,page,revision));
                CREATE TABLE IF NOT EXISTS changes(space TEXT NOT NULL,id TEXT NOT NULL,page TEXT NOT NULL,base INTEGER NOT NULL,result INTEGER NOT NULL,policy_revision INTEGER NOT NULL,status TEXT NOT NULL,reason TEXT NOT NULL,created INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(space,id));
                CREATE INDEX IF NOT EXISTS change_history ON changes(space,status,created);
                CREATE TABLE IF NOT EXISTS processed(space TEXT NOT NULL,document TEXT NOT NULL,fingerprint TEXT NOT NULL,PRIMARY KEY(space,document));
                CREATE TABLE IF NOT EXISTS jobs(space TEXT PRIMARY KEY,status TEXT NOT NULL,message TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS calls(space TEXT NOT NULL, day INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(space,day));
                CREATE VIRTUAL TABLE IF NOT EXISTS page_search USING fts5(space UNINDEXED,page UNINDEXED,title,summary,sections);
                PRAGMA user_version=2;
            ").map_err(error)?;
        }
        _ => return Err("Wiki 存储版本不受支持".into()),
    }
    tx.commit().map_err(error)?;
    Ok(c)
}

pub(crate) fn upgrade_legacy(data: &Path) -> Result<(), String> {
    if exists(data)? && version(&read_at(&path(data))?)? == 1 {
        write(data)?;
    }
    Ok(())
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

pub(super) fn allow_manual_retry(
    c: &Connection,
    space: &str,
    doc: &str,
    fingerprint: &str,
) -> Result<(), String> {
    if coverage(c, space, doc, fingerprint)?.0 == "included" {
        mark_coverage(c, space, doc, fingerprint, "retry")?;
    }
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

pub(super) fn coverage(
    c: &Connection,
    space: &str,
    doc: &str,
    fingerprint: &str,
) -> Result<(&'static str, i64), String> {
    let stored: Option<(String, i64)> = c
        .query_row(
            "SELECT fingerprint,rowid FROM processed WHERE space=? AND document=?",
            params![space, doc],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(error)?;
    if let Some((stored, order)) = stored {
        if let Some((status, _)) = stored
            .split_once(':')
            .filter(|(_, version)| *version == fingerprint)
        {
            if let Some(status) = ["included", "omitted", "partial", "retry"]
                .into_iter()
                .find(|known| *known == status)
            {
                return Ok((status, order));
            }
        }
    }
    Ok(("pending", 0))
}

pub(super) fn purge_derived(
    tx: &Connection,
    space: &str,
    documents: &[&str],
) -> Result<(), String> {
    if documents.is_empty() {
        return Ok(());
    }
    let documents = encode(&documents)?;
    const READ_DOCUMENT: &str = "EXISTS (SELECT 1 FROM json_each(payload,'$.inputs') i WHERE json_extract(i.value,'$.documentId') IN (SELECT value FROM json_each(?2)))";
    let affected_pages = {
        let mut stmt = tx
            .prepare(&format!(
                "SELECT DISTINCT page FROM revisions WHERE space=?1 AND {READ_DOCUMENT}"
            ))
            .map_err(error)?;
        let rows = stmt
            .query_map(params![space, documents], |r| r.get::<_, String>(0))
            .map_err(error)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(error)?
    };
    // A synthesized page can paraphrase the deleted source anywhere. Do not preserve its history
    // or expose another revision of it silently. Unrelated pages remain available.
    for page in &affected_pages {
        for table in ["changes", "revisions", "page_search"] {
            tx.execute(
                &format!("DELETE FROM {table} WHERE space=? AND page=?"),
                params![space, page],
            )
            .map_err(error)?;
        }
        tx.execute(
            "DELETE FROM pages WHERE space=? AND id=?",
            params![space, page],
        )
        .map_err(error)?;
    }
    let removed_candidates = tx
        .execute(
            &format!("DELETE FROM changes WHERE space=?1 AND {READ_DOCUMENT}"),
            params![space, documents],
        )
        .map_err(error)?;
    if !affected_pages.is_empty() {
        // Rebuild the FTS shadow index so deleted terms are also absent from later backups.
        tx.execute("INSERT INTO page_search(page_search) VALUES('rebuild')", [])
            .map_err(error)?;
    }
    if !affected_pages.is_empty() || removed_candidates > 0 {
        // Allow still-authorized sources of discarded pages/candidates to be organized again.
        tx.execute("DELETE FROM processed WHERE space=?", [space])
            .map_err(error)?;
        record_job(
            tx,
            space,
            "idle",
            "已清理退出资料范围的文档所影响的 Wiki 内容，可重新整理剩余资料",
        )?;
    } else {
        tx.execute(
            "DELETE FROM processed WHERE space=? AND document IN (SELECT value FROM json_each(?))",
            params![space, documents],
        )
        .map_err(error)?;
    }
    Ok(())
}

pub(crate) fn purge_document(data: &Path, space: &str, doc: &str) -> Result<(), String> {
    if !exists(data)? {
        return Ok(());
    }
    let mut c = write(data)?;
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(error)?;
    purge_derived(&tx, space, &[doc])?;
    let mut policy = policy(&tx, space)?;
    if policy.document_ids.iter().any(|id| id == doc) {
        policy.document_ids.retain(|id| id != doc);
        policy.revision = policy
            .revision
            .checked_add(1)
            .ok_or("Wiki 授权版本号超过上限")?;
        policy.enabled &= !policy.document_ids.is_empty();
        save_policy(&tx, space, &policy)?;
    }
    tx.commit().map_err(error)
}

pub(super) fn mark_coverage(
    c: &Connection,
    space: &str,
    doc: &str,
    fingerprint: &str,
    status: &str,
) -> Result<(), String> {
    let value = format!("{status}:{fingerprint}");
    // Give retried sources a new position so an oversized document cannot starve other retries.
    c.execute(
        "INSERT OR REPLACE INTO processed VALUES(?,?,?)",
        params![space, doc, value],
    )
    .map_err(error)?;
    Ok(())
}

pub(crate) fn validate_snapshot(file: &Path) -> Result<(), String> {
    let c = crate::maintenance::open_snapshot_db(file)?;
    let schema = version(&c)?;
    if !(1..=SCHEMA).contains(&schema) {
        return Err("Wiki 存储版本不受支持".into());
    }
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
        if schema == SCHEMA {
            if content.inputs.is_empty()
                || content.inputs.len() > MAX_SOURCES
                || content
                    .inputs
                    .iter()
                    .collect::<std::collections::HashSet<_>>()
                    .len()
                    != content.inputs.len()
                || content
                    .originals()
                    .any(|r| !content.inputs.contains(&r.into()))
            {
                return Err("Wiki 备份未记录完整的编纂来源".into());
            }
            for input in &content.inputs {
                crate::files::validate_relative(&input.path)?;
                if input.document_id.is_empty()
                    || input.hash.len() != 64
                    || !input.hash.bytes().all(|c| c.is_ascii_hexdigit())
                {
                    return Err("Wiki 备份的编纂来源无效".into());
                }
            }
        }
    }
    Ok(())
}
