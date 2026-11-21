use crate::{files, library, AppState};
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde::Serialize;
use std::path::Path;
use tauri::State;

const STORE: &str = "external-connections.sqlite3";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Grant {
    pub id: String,
    pub name: String,
    pub space: String,
}

fn write_store(data: &Path) -> Result<Connection, String> {
    let c = Connection::open(data.join(STORE)).map_err(|_| "无法打开本机连接设置")?;
    c.execute_batch("CREATE TABLE IF NOT EXISTS grants(id TEXT PRIMARY KEY, name TEXT NOT NULL, space TEXT NOT NULL, digest TEXT UNIQUE NOT NULL)").map_err(|_| "无法保存本机连接设置")?;
    Ok(c)
}

pub(super) fn authorize(data: &Path, token: &str, space: &str) -> Result<(), super::AccessError> {
    if uuid::Uuid::parse_str(token).is_err() {
        return Err(super::AccessError::Denied);
    }
    let c = Connection::open_with_flags(data.join(STORE), OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|_| super::AccessError::Denied)?;
    let found: Option<i64> = c
        .query_row(
            "SELECT 1 FROM grants WHERE digest=? AND space=?",
            params![files::hash(token), space],
            |r| r.get(0),
        )
        .optional()?;
    found.map(|_| ()).ok_or(super::AccessError::Denied)
}

pub(super) fn create(data: &Path, space: &str, name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 60 || name.chars().any(char::is_control) {
        return Err("请输入 1～60 字的连接名称".into());
    }
    library::project_title(data, space)?;
    let token = uuid::Uuid::new_v4().to_string();
    write_store(data)?
        .execute(
            "INSERT INTO grants(id,name,space,digest) VALUES(?,?,?,?)",
            params![
                uuid::Uuid::new_v4().to_string(),
                name,
                space,
                files::hash(&token)
            ],
        )
        .map_err(|_| "创建连接失败")?;
    Ok(token)
}

#[tauri::command]
pub(crate) fn external_grant_create(
    state: State<'_, AppState>,
    space: String,
    name: String,
) -> Result<String, String> {
    create(&state.data_dir, &space, &name)
}

pub(super) fn list(data: &Path) -> Result<Vec<Grant>, String> {
    if !data.join(STORE).exists() {
        return Ok(vec![]);
    }
    let c = Connection::open_with_flags(data.join(STORE), OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|_| "无法读取连接列表")?;
    let mut stmt = c
        .prepare("SELECT id,name,space FROM grants ORDER BY rowid")
        .map_err(|_| "无法读取连接列表")?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Grant {
                id: r.get(0)?,
                name: r.get(1)?,
                space: r.get(2)?,
            })
        })
        .map_err(|_| "无法读取连接列表")?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|_| "无法读取连接列表".into())
}

#[tauri::command]
pub(crate) fn external_grants(state: State<'_, AppState>) -> Result<Vec<Grant>, String> {
    list(&state.data_dir)
}

pub(super) fn revoke(data: &Path, id: &str) -> Result<(), String> {
    write_store(data)?
        .execute("DELETE FROM grants WHERE id=?", [id])
        .map_err(|_| "撤销连接失败")?;
    Ok(())
}

#[tauri::command]
pub(crate) fn external_grant_revoke(state: State<'_, AppState>, id: String) -> Result<(), String> {
    revoke(&state.data_dir, &id)
}
