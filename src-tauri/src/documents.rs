use crate::{db, files, library, models::*};
use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock, Weak},
    time::Duration,
};

/// Serialize application-originated check/write transactions for the same canonical file.
pub fn with_write_lock<T>(
    path: &Path,
    action: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let key = path
        .canonicalize()
        .map_err(|_| "原文件无法访问，请核对路径")?;
    with_lock_key(key, action)
}
fn with_lock_key<T>(key: PathBuf, action: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    static LOCKS: OnceLock<Mutex<HashMap<PathBuf, Weak<Mutex<()>>>>> = OnceLock::new();
    let lock = {
        let mut map = LOCKS
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
            .map_err(|_| "文件保存状态不可用")?;
        if map.len() > 4096 {
            map.retain(|_, v| v.strong_count() > 0);
        }
        if let Some(lock) = map.get(&key).and_then(Weak::upgrade) {
            lock
        } else {
            let lock = Arc::new(Mutex::new(()));
            map.insert(key, Arc::downgrade(&lock));
            lock
        }
    };
    let _guard = lock.lock().map_err(|_| "文件保存状态不可用")?;
    action()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub hash: String,
    pub index_stale: bool,
    pub warning: Option<String>,
}
pub fn read(ws: &Workspace, data_dir: &Path, path: &str) -> Result<FileData, String> {
    library::lifecycle::require_ready(data_dir, ws, path)?;
    files::validate_relative(path)?;
    if !files::supported(Path::new(path)) {
        return Err("文件格式不支持".into());
    }
    let draft = fs::read(files::draft_path(data_dir, ws, path))
        .ok()
        .and_then(|b| serde_json::from_slice::<Draft>(&b).ok());
    let disk = files::resolve(&ws.root, path, false).and_then(|p| files::read_text(&p));
    match disk {
        Ok(content) => Ok(FileData {
            path: path.into(),
            hash: files::hash(&content),
            draft: draft.filter(|d| d.content != content),
            content,
            missing: false,
        }),
        Err(error) => {
            // A recovery draft is usable even when the original directory is gone.
            if let Some(draft) = draft {
                Ok(FileData {
                    path: path.into(),
                    content: String::new(),
                    hash: String::new(),
                    draft: Some(draft),
                    missing: true,
                })
            } else {
                Err(error)
            }
        }
    }
}
pub fn draft(
    ws: &Workspace,
    data_dir: &Path,
    path: &str,
    content: String,
    base_hash: String,
) -> Result<(), String> {
    let _permit = crate::maintenance::mutation_scope(
        data_dir,
        crate::maintenance::is_managed_root(data_dir, &ws.root),
    )?;
    library::lifecycle::require_ready(data_dir, ws, path)?;
    files::validate_relative(path)?;
    if !files::supported(Path::new(path)) {
        return Err("文件格式不支持".into());
    }
    if content.len() as u64 > files::MAX_FILE {
        return Err("草稿超过 2 MB 限制".into());
    }
    let target = files::draft_path(data_dir, ws, path);
    fs::create_dir_all(target.parent().ok_or("草稿目录不可用")?).map_err(|e| e.to_string())?;
    with_lock_key(target.clone(), || {
        files::write_atomic(
            &target,
            &serde_json::to_vec(&Draft { content, base_hash }).map_err(|e| e.to_string())?,
        )
    })
}
pub fn save(
    ws: &Workspace,
    data_dir: &Path,
    path: &str,
    content: &str,
    expected: &str,
) -> Result<SaveResult, String> {
    let _permit = crate::maintenance::mutation_scope(
        data_dir,
        crate::maintenance::is_managed_root(data_dir, &ws.root),
    )?;
    library::lifecycle::require_ready(data_dir, ws, path)?;
    if content.len() as u64 > files::MAX_FILE {
        return Err("内容超过 2 MB，无法保存".into());
    }
    let p = files::resolve(&ws.root, path, false)?;
    with_write_lock(&p, || {
        if files::hash(files::read_text(&p)?) != expected {
            return Err("CONFLICT:磁盘文件已被其他应用修改，请核对原文或另存为。".into());
        }
        files::write_atomic(&p, content.as_bytes())?;
        // File persistence is authoritative. A disposable index cannot turn success into failure.
        let invalidation = refresh_local(ws, data_dir, path, content);
        let calendar = crate::calendar::refresh_saved(data_dir, &ws.root, path, content);
        let warning = if invalidation.is_err() || calendar.is_err() {
            Some("正文已保存；本地索引暂不可用，稍后刷新或更新索引即可。".into())
        } else {
            None
        };
        let draft_path = files::draft_path(data_dir, ws, path);
        // A newer autosave may already contain text typed while this save was pending.
        let _ = with_lock_key(draft_path.clone(), || {
            if fs::read(&draft_path)
                .ok()
                .and_then(|b| serde_json::from_slice::<Draft>(&b).ok())
                .is_some_and(|draft| draft.content == content)
            {
                let _ = fs::remove_file(&draft_path);
            }
            Ok(())
        });
        library::saved(data_dir, &ws.root, path);
        Ok(SaveResult {
            hash: files::hash(content),
            index_stale: true,
            warning,
        })
    })
}

/// Local keyword refresh never contacts a model and never blocks the primary save on index errors.
pub fn refresh_local(
    ws: &Workspace,
    data_dir: &Path,
    path: &str,
    content: &str,
) -> Result<(), String> {
    library::lifecycle::require_ready(data_dir, ws, path)?;
    let mut conn = db::open_with_timeout(&ws.db, Duration::from_millis(80))?;
    if path.to_lowercase().ends_with(".json") {
        let selected: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM documents WHERE path=?)",
                [path],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if !selected {
            return Ok(());
        }
    }
    let title = library::title_for(data_dir, &ws.root, path)
        .map(|(_, t)| t)
        .unwrap_or_else(|| {
            Path::new(path)
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned()
        });
    let chunks = db::local_chunks(content, path, 1800);
    db::refresh_lexical(&mut conn, path, &files::hash(content), &chunks, &title)?;
    Ok(())
}
pub fn library_workspace(data_dir: &Path, project: &str) -> Result<Workspace, String> {
    let root = library::project_root(data_dir, project)?;
    let dir = data_dir.join("workspaces");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(Workspace {
        db: dir.join(format!(
            "{}.sqlite3",
            files::hash(root.to_string_lossy().as_bytes())
        )),
        root,
    })
}
pub fn refresh_project(data_dir: &Path, project: &str) -> Result<(), String> {
    let ws = library_workspace(data_dir, project)?;
    let view = library::list(data_dir)?;
    let mut bytes = 0usize;
    for doc in view
        .documents
        .iter()
        .filter(|d| d.project_id == project && d.status == "ready")
    {
        if doc.path.to_lowercase().ends_with(".json") {
            continue;
        }
        let path = files::resolve(&ws.root, &doc.path, false)?;
        with_write_lock(&path, || {
            let content = files::read_text(&path)?;
            bytes += content.len();
            if bytes > 30 * 1024 * 1024 {
                return Err("本地索引文本超过 30 MB，请拆分项目".into());
            }
            refresh_local(&ws, data_dir, &doc.path, &content)
        })?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn runtime_catalog_failure_does_not_write_body_or_draft() {
        let data = tempfile::tempdir().unwrap();
        let doc = library::create_document(data.path(), "inbox", "原稿.md", "原始正文").unwrap();
        let ws = library_workspace(data.path(), "inbox").unwrap();
        let c = rusqlite::Connection::open(data.path().join("library/catalog.sqlite3")).unwrap();
        c.pragma_update(None, "user_version", 999).unwrap();
        drop(c);
        assert!(save(
            &ws,
            data.path(),
            &doc.path,
            "不能写入",
            &files::hash("原始正文")
        )
        .is_err());
        assert!(draft(
            &ws,
            data.path(),
            &doc.path,
            "不能写入草稿".into(),
            files::hash("原始正文")
        )
        .is_err());
        assert_eq!(
            fs::read_to_string(ws.root.join(&doc.path)).unwrap(),
            "原始正文"
        );
        assert!(!files::draft_path(data.path(), &ws, &doc.path).exists());
    }
    #[test]
    fn locked_index_does_not_fail_file_save_or_create_false_conflict() {
        let d = tempfile::tempdir().unwrap();
        let ws = Workspace {
            root: d.path().canonicalize().unwrap(),
            db: d.path().join("index.sqlite3"),
        };
        let p = d.path().join("文档.md");
        fs::write(&p, "原文").unwrap();
        let conn = db::open(&ws.db).unwrap();
        conn.execute_batch("BEGIN IMMEDIATE").unwrap();
        let first = save(&ws, d.path(), "文档.md", "新内容", &files::hash("原文")).unwrap();
        assert!(first.warning.is_some());
        assert_eq!(fs::read_to_string(&p).unwrap(), "新内容");
        let second = save(&ws, d.path(), "文档.md", "继续编辑", &first.hash).unwrap();
        assert_eq!(second.hash, files::hash("继续编辑"));
        conn.execute_batch("ROLLBACK").unwrap();
    }
    #[test]
    fn drafts_recover_after_source_and_parent_are_removed() {
        let d = tempfile::tempdir().unwrap();
        let ws = Workspace {
            root: d.path().canonicalize().unwrap(),
            db: d.path().join("index.sqlite3"),
        };
        draft(
            &ws,
            d.path(),
            "已移走/文档.md",
            "不能丢失".into(),
            "old".into(),
        )
        .unwrap();
        let file = read(&ws, d.path(), "已移走/文档.md").unwrap();
        assert!(file.missing);
        assert_eq!(file.draft.unwrap().content, "不能丢失");
        assert!(draft(&ws, d.path(), "../文档.md", "越界".into(), "".into()).is_err());
    }
    #[test]
    fn competing_saves_are_serialized_and_keep_newer_draft() {
        let d = tempfile::tempdir().unwrap();
        let ws = Workspace {
            root: d.path().canonicalize().unwrap(),
            db: d.path().join("index.sqlite3"),
        };
        fs::write(d.path().join("文档.md"), "原文").unwrap();
        draft(
            &ws,
            d.path(),
            "文档.md",
            "更新的草稿".into(),
            files::hash("原文"),
        )
        .unwrap();
        let results = std::thread::scope(|s| {
            let first = s.spawn(|| save(&ws, d.path(), "文档.md", "版本一", &files::hash("原文")));
            let second = s.spawn(|| save(&ws, d.path(), "文档.md", "版本二", &files::hash("原文")));
            [first.join().unwrap(), second.join().unwrap()]
        });
        assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter(|r| r.as_ref().is_err_and(|e| e.starts_with("CONFLICT:")))
                .count(),
            1
        );
        assert_eq!(
            read(&ws, d.path(), "文档.md")
                .unwrap()
                .draft
                .unwrap()
                .content,
            "更新的草稿"
        );
    }
}
