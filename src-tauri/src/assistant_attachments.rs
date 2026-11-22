use super::{authorize, err, open, GENERAL_OWNER};
use crate::{assistant_sources::Selection, files, maintenance};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Serialize;
use std::{collections::HashSet, path::Path};
use tauri::State;

const FILE_MAX: usize = 2 * 1024 * 1024;
const STORE_MAX: i64 = 32 * 1024 * 1024;
const CONVERSATION_LIMIT: i64 = 12;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub title: String,
    pub size: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Content {
    pub id: String,
    pub title: String,
    pub text: String,
}

pub(super) fn migrate(c: &mut Connection) -> Result<(), String> {
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(err)?;
    tx.execute_batch("CREATE TABLE IF NOT EXISTS assistant_attachments(
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        title TEXT NOT NULL, content TEXT NOT NULL, size INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS assistant_attachment_owner ON assistant_attachments(conversation_id);
        CREATE TABLE IF NOT EXISTS turn_sources(
        turn_id TEXT PRIMARY KEY REFERENCES turns(id) ON DELETE CASCADE, selection TEXT NOT NULL);")
        .map_err(err)?;
    tx.pragma_update(None, "user_version", 3).map_err(err)?;
    tx.commit().map_err(err)
}

pub(super) fn selection(c: &Connection, turn: &str) -> Result<Option<Selection>, String> {
    let raw: Option<String> = c
        .query_row(
            "SELECT selection FROM turn_sources WHERE turn_id=?",
            [turn],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    raw.map(|value| {
        let selection: Selection = serde_json::from_str(&value).map_err(err)?;
        selection.validate()?;
        Ok(selection)
    })
    .transpose()
}

pub(super) fn validate_owned(
    c: &Connection,
    conversation: &str,
    ids: &[String],
) -> Result<(), String> {
    let mut seen = HashSet::new();
    for id in ids {
        if !seen.insert(id) {
            return Err("同一附件只可选一次".into());
        }
        let exists: bool = c.query_row(
            "SELECT EXISTS(SELECT 1 FROM assistant_attachments WHERE id=? AND conversation_id=?)",
            params![id, conversation], |r|r.get(0)).map_err(err)?;
        if !exists {
            return Err("所选附件已删除或不在当前会话".into());
        }
    }
    Ok(())
}

fn add(data: &Path, conversation: &str, path: &Path) -> Result<Attachment, String> {
    let _permit = maintenance::mutation(data)?;
    let mut c = open(data)?;
    authorize(&c, GENERAL_OWNER, conversation)?;
    let title = path
        .file_name()
        .and_then(|s| s.to_str())
        .filter(|s| s.chars().count() <= 120 && !s.chars().any(char::is_control))
        .ok_or("附件名称无效")?
        .to_string();
    if !path.is_absolute()
        || !path
            .metadata()
            .is_ok_and(|m| m.is_file() && m.len() <= FILE_MAX as u64)
    {
        return Err("仅支持 2 MB 以内的普通文本文件".into());
    }
    let content = files::read_text(path)?;
    if content.len() > FILE_MAX || content.trim().is_empty() {
        return Err("附件为空或超过 2 MB".into());
    }
    let size = content.len() as i64;
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(err)?;
    authorize(&tx, GENERAL_OWNER, conversation)?;
    let count: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM assistant_attachments WHERE conversation_id=?",
            [conversation],
            |r| r.get(0),
        )
        .map_err(err)?;
    let total: i64 = tx
        .query_row(
            "SELECT COALESCE(SUM(size),0) FROM assistant_attachments",
            [],
            |r| r.get(0),
        )
        .map_err(err)?;
    if count >= CONVERSATION_LIMIT || total + size > STORE_MAX {
        return Err("会话附件已达存储上限，请删除不再需要的附件".into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    tx.execute(
        "INSERT INTO assistant_attachments VALUES(?,?,?,?,?)",
        params![id, conversation, title, content, size],
    )
    .map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(Attachment { id, title, size })
}

pub fn read(data: &Path, conversation: &str, id: &str) -> Result<Content, String> {
    let _permit = maintenance::mutation(data)?;
    let c = open(data)?;
    authorize(&c, GENERAL_OWNER, conversation)?;
    c.query_row(
        "SELECT id,title,content FROM assistant_attachments WHERE id=? AND conversation_id=?",
        params![id, conversation],
        |r| {
            Ok(Content {
                id: r.get(0)?,
                title: r.get(1)?,
                text: r.get(2)?,
            })
        },
    )
    .optional()
    .map_err(err)?
    .ok_or_else(|| "附件已删除或不在当前会话".into())
}

#[tauri::command]
pub fn assistant_attachment_add(
    state: State<'_, crate::AppState>,
    conversation_id: String,
    path: String,
) -> Result<Attachment, String> {
    add(&state.data_dir, &conversation_id, Path::new(&path))
}

#[tauri::command]
pub fn assistant_attachment_list(
    state: State<'_, crate::AppState>,
    conversation_id: String,
) -> Result<Vec<Attachment>, String> {
    let _permit = maintenance::mutation(&state.data_dir)?;
    let c = open(&state.data_dir)?;
    authorize(&c, GENERAL_OWNER, &conversation_id)?;
    let mut stmt = c.prepare("SELECT id,title,size FROM assistant_attachments WHERE conversation_id=? ORDER BY rowid").map_err(err)?;
    let rows = stmt
        .query_map([conversation_id], |r| {
            Ok(Attachment {
                id: r.get(0)?,
                title: r.get(1)?,
                size: r.get(2)?,
            })
        })
        .map_err(err)?;
    rows.map(|row| row.map_err(err)).collect()
}

#[tauri::command]
pub fn assistant_attachment_read(
    state: State<'_, crate::AppState>,
    conversation_id: String,
    attachment_id: String,
) -> Result<Content, String> {
    read(&state.data_dir, &conversation_id, &attachment_id)
}

#[tauri::command]
pub fn assistant_attachment_delete(
    state: State<'_, crate::AppState>,
    conversation_id: String,
    attachment_id: String,
) -> Result<(), String> {
    let _permit = maintenance::mutation(&state.data_dir)?;
    let c = open(&state.data_dir)?;
    authorize(&c, GENERAL_OWNER, &conversation_id)?;
    c.execute(
        "DELETE FROM assistant_attachments WHERE id=? AND conversation_id=?",
        params![attachment_id, conversation_id],
    )
    .map_err(err)?;
    Ok(())
}

pub(super) fn validate_snapshot(c: &Connection) -> Result<(), String> {
    let violations: bool = c.query_row("SELECT EXISTS(
      SELECT 1 FROM assistant_attachments a JOIN conversations c ON a.conversation_id=c.id
      WHERE c.workspace_id<>'general' OR a.size<>length(CAST(a.content AS BLOB)) OR a.size NOT BETWEEN 1 AND ? OR length(a.title) NOT BETWEEN 1 AND 120
      UNION ALL SELECT 1 FROM assistant_attachments GROUP BY conversation_id HAVING COUNT(*)>?
      UNION ALL SELECT 1 FROM (SELECT COALESCE(SUM(size),0) AS total FROM assistant_attachments) WHERE total>?
    )", params![FILE_MAX,CONVERSATION_LIMIT,STORE_MAX], |r|r.get(0)).map_err(err)?;
    if violations {
        return Err("会话附件备份超出范围或限制".into());
    }
    let mut stmt = c.prepare("SELECT t.turn_id,t.selection,c.workspace_id FROM turn_sources t JOIN turns r ON t.turn_id=r.id JOIN conversations c ON r.conversation_id=c.id").map_err(err)?;
    let mut rows = stmt.query([]).map_err(err)?;
    while let Some(row) = rows.next().map_err(err)? {
        let owner: String = row.get(2).map_err(err)?;
        if owner != GENERAL_OWNER {
            return Err("资料范围快照不属于通用会话".into());
        }
        let id: String = row.get(0).map_err(err)?;
        selection(c, &id)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(target_os = "macos")]
    #[test]
    fn private_credentials_stay_out_of_documents_attachments_index_and_backup() {
        use std::{fs, io::Read, sync::atomic::AtomicBool};
        // Run with a synthetic home in a child process so unrelated parallel tests
        // and the user's installed preferences never participate in this fixture.
        let marker = "INKSTONE_CREDENTIAL_FIXTURE_HOME";
        let Some(fake_home) = std::env::var_os(marker) else {
            let home = tempfile::tempdir().unwrap();
            let fixture = home.path().canonicalize().unwrap();
            let private = fixture.join("Library/Preferences/local.inkstone.desktop");
            fs::create_dir_all(&private).unwrap();
            fs::write(private.join("credentials.json"), "private-fixture-key-127").unwrap();
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", std::thread::current().name().unwrap()])
                .env("HOME", &fixture)
                .env(marker, &fixture)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            assert!(String::from_utf8_lossy(&output.stdout).contains("1 passed"));
            return;
        };
        let home = Path::new(&fake_home);
        assert_eq!(std::env::home_dir().unwrap(), home);
        assert!(home.starts_with(std::env::temp_dir().canonicalize().unwrap()));
        let prefs = home.join("Library/Preferences");
        let private = prefs.join("local.inkstone.desktop");
        let key = private.join("credentials.json");
        let ordinary = prefs.join("credentials.json");
        fs::write(&ordinary, "user-authored example").unwrap();
        let alias = prefs.join("alias.json");
        std::os::unix::fs::symlink(&key, &alias).unwrap();
        let hard_link = prefs.join("alternate.json");
        fs::hard_link(&key, &hard_link).unwrap();
        let data = tempfile::tempdir().unwrap();
        let data = data.path();
        let scope = crate::models::Workspace {
            root: prefs.clone(),
            db: home.join("work.sqlite3"),
        };
        assert!(files::scan(&scope, Some("local.inkstone.desktop/credentials.json")).is_err());
        assert_eq!(
            files::scan(&scope, Some("credentials.json"))
                .unwrap()
                .0
                .len(),
            1
        );
        let tree = files::list_tree(&prefs).unwrap();
        assert_eq!(tree.len(), 1);
        assert_eq!(tree[0].name, "credentials.json");

        let conversation =
            super::super::create(data, GENERAL_OWNER, None, "fixture".into(), None).unwrap();
        for path in [&key, &alias, &hard_link] {
            assert!(add(data, &conversation.id, path).is_err());
        }
        assert!(add(data, &conversation.id, &ordinary).is_ok());
        let batch = crate::library::import(
            data,
            "inbox",
            &[
                prefs.to_string_lossy().into_owned(),
                key.to_string_lossy().into_owned(),
            ],
            true,
            true,
            &AtomicBool::new(false),
            |_| {},
        )
        .unwrap();
        assert_eq!(batch.items.len(), 1);
        assert!(batch.items[0].document_id.is_some());
        crate::local_credentials::save(
            data,
            "chat",
            "fixture",
            Some("private-fixture-key-127"),
            false,
        )
        .unwrap();
        let backup = home.join("backup.zip");
        crate::maintenance::create_backup(data, &backup).unwrap();
        let validated = crate::maintenance::validate_backup(&backup).unwrap();
        assert_eq!(serde_json::to_value(validated).unwrap()["valid"], true);
        let mut archive = zip::ZipArchive::new(fs::File::open(backup).unwrap()).unwrap();
        let marker = b"private-fixture-key-127";
        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).unwrap();
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes).unwrap();
            assert!(!bytes.windows(marker.len()).any(|part| part == marker));
        }
    }

    #[test]
    fn attachment_scope_and_frozen_turn_survive_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path();
        let a = super::super::create(data, GENERAL_OWNER, None, "通用问答".into(), None).unwrap();
        let b = super::super::create(data, GENERAL_OWNER, None, "通用问答".into(), None).unwrap();
        let file = data.join("fixture.txt");
        std::fs::write(&file, "合成附件").unwrap();
        let f = add(data, &a.id, &file).unwrap();
        assert!(read(data, &b.id, &f.id).is_err());
        std::fs::write(&file, "替换原件").unwrap();
        assert_eq!(read(data, &a.id, &f.id).unwrap().text, "合成附件");
        let selection = Selection {
            attachments: vec![f.id],
            ..Default::default()
        };
        let begun = super::super::begin_with_sources(
            data,
            GENERAL_OWNER,
            &a.id,
            a.revision,
            "请总结",
            None,
            None,
            "fixture-attach",
            "keyword",
            Some(selection.clone()),
            None,
        )
        .unwrap();
        let result = super::super::get(data, GENERAL_OWNER, &a.id).unwrap();
        assert_eq!(result.turns[0].sources, Some(selection.clone()));
        assert_eq!(begun.sources, Some(selection));
    }
}
