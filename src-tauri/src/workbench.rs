//! Durable organization and checked, per-file index status. Never confuses an external source
//! update with a change to the authoritative managed copy.
use crate::{db, files, library, models::*, providers};
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use std::{
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
pub fn pins(data: &Path, ws: &Workspace) -> Result<Vec<String>, String> {
    let project = library::project_at_root(data, &ws.root).ok_or("置顶仅用于文档空间")?;
    let c = library::conn(data)?;
    let raw: Option<String> = c
        .query_row(
            "SELECT value FROM preferences WHERE key=?",
            [format!("pins:{project}")],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let stored: Vec<String> = raw
        .map(|s| serde_json::from_str(&s))
        .transpose()
        .map_err(|_| "置顶记录损坏，请先核对资料库")?
        .unwrap_or_default();
    let view = library::list(data)?;
    Ok(stored
        .into_iter()
        .filter(|id| {
            view.documents
                .iter()
                .any(|d| d.id == *id && d.project_id == project && d.status == "ready")
        })
        .collect())
}
pub fn set_pin(data: &Path, ws: &Workspace, id: &str, pinned: bool) -> Result<(), String> {
    let _permit = crate::maintenance::mutation(data)?;
    let project = library::project_at_root(data, &ws.root).ok_or("置顶仅用于文档空间")?;
    let d = library::get(data, id)?;
    if d.project_id != project || d.status != "ready" {
        return Err("文档不在当前空间或已移除".into());
    }
    let mut c = library::conn(data)?;
    let tx = c
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let key = format!("pins:{project}");
    let raw: Option<String> = tx
        .query_row("SELECT value FROM preferences WHERE key=?", [&key], |r| {
            r.get(0)
        })
        .optional()
        .map_err(|e| e.to_string())?;
    let mut ids: Vec<String> = raw
        .map(|s| serde_json::from_str(&s))
        .transpose()
        .map_err(|_| "置顶记录损坏")?
        .unwrap_or_default();
    ids.retain(|v| v != id);
    if pinned {
        ids.push(id.to_string());
    }
    tx.execute(
        "INSERT OR REPLACE INTO preferences VALUES(?,?)",
        params![key, serde_json::to_string(&ids).map_err(|e| e.to_string())?],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentIndexState {
    path: String,
    title: String,
    document_id: Option<String>,
    included: bool,
    reason: Option<String>,
    source_hash: Option<String>,
    indexed_hash: Option<String>,
    keyword_state: String,
    vector_state: String,
    strategy: Option<String>,
    parser_version: Option<u32>,
    indexed_at: Option<i64>,
    error: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatusSnapshot {
    checked_at: i64,
    embedding_profile: String,
    documents: Vec<DocumentIndexState>,
}
pub fn index_status(
    data: &Path,
    ws: &Workspace,
    config: &Provider,
    active_path: Option<&str>,
) -> Result<IndexStatusSnapshot, String> {
    let profile = providers::fingerprint(config);
    let project = library::project_at_root(data, &ws.root);
    let managed_root = data.join("library/projects");
    if project.is_none()
        && ws
            .root
            .starts_with(managed_root.canonicalize().unwrap_or(managed_root))
    {
        return Err("文档目录不可用，未将受管理资料当作外部目录扫描。".into());
    }
    let candidates: Vec<(String, String, Option<String>)> = if let Some(project) = project {
        library::list(data)?
            .documents
            .into_iter()
            .filter(|d| d.project_id == project && d.status == "ready")
            .map(|d| (d.path, d.title, Some(d.id)))
            .collect()
    } else {
        fn flatten(entries: Vec<FileEntry>, out: &mut Vec<(String, String, Option<String>)>) {
            for e in entries {
                if e.directory {
                    flatten(e.children, out)
                } else {
                    out.push((e.path, e.name, None));
                }
            }
        }
        let mut out = vec![];
        flatten(files::list_tree(&ws.root)?, &mut out);
        out
    };
    let index = db::open(&ws.db);
    let mut states = vec![];
    for (path, title, document_id) in candidates {
        let stored = index.as_ref().ok().and_then(|c| {
            c.query_row(
                "SELECT hash,embedding_profile,indexed_at FROM documents WHERE path=?",
                [&path],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, i64>(2)?,
                    ))
                },
            )
            .optional()
            .ok()
            .flatten()
        });
        let excluded = index.is_ok() && path.to_lowercase().ends_with(".json") && stored.is_none();
        let disk = files::resolve(&ws.root, &path, false)
            .and_then(|p| files::read_text(&p))
            .map(files::hash);
        let source_hash = disk.as_ref().ok().cloned();
        let mut error = disk
            .err()
            .map(|_| "当前副本无法读取，请核对文档或重新导入。".to_string());
        let mut keyword = if excluded {
            "excluded"
        } else if error.is_some() {
            "unknown"
        } else if index.is_err() {
            error = Some("本地索引不可用，可重建索引；正文未受影响。".into());
            "error"
        } else if stored.is_none() {
            "missing"
        } else if stored.as_ref().map(|v| &v.0) != source_hash.as_ref() {
            "stale"
        } else if index.as_ref().is_ok_and(|c| {
            source_hash
                .as_ref()
                .is_some_and(|hash| db::keyword_complete(c, &path, hash))
        }) {
            "ready"
        } else {
            error = Some("关键词索引不完整，请更新该文档。".into());
            "error"
        };
        let manifest = index
            .as_ref()
            .ok()
            .and_then(|c| db::chunk_manifest(c, &path).ok().flatten());
        let attempt = index
            .as_ref()
            .ok()
            .and_then(|c| db::index_attempt(c, &path).ok().flatten())
            .filter(|a| Some(&a.source_hash) == source_hash.as_ref() && a.profile == profile);
        let complete = index.as_ref().ok().is_some_and(|c| {
            source_hash
                .as_ref()
                .is_some_and(|hash| db::vectors_complete(c, &path, hash, &profile))
        });
        let vector = if excluded {
            "excluded"
        } else if !config.enabled {
            "disabled"
        } else if source_hash.is_none() {
            "unknown"
        } else if index.is_err() {
            "error"
        } else if keyword == "stale" {
            "stale"
        } else if let Some(a) = &attempt {
            if a.status == "failed" {
                error = Some("上次索引未完成，请重试或检查模型设置。".into());
                "error"
            } else if a.status == "processing" {
                if active_path == Some(path.as_str()) {
                    "processing"
                } else {
                    "interrupted"
                }
            } else if complete {
                "ready"
            } else if stored
                .as_ref()
                .is_some_and(|s| !s.1.is_empty() && s.1 != profile && s.1 != "keyword-v3")
            {
                "profile_changed"
            } else {
                "missing"
            }
        } else if complete {
            "ready"
        } else if stored
            .as_ref()
            .is_some_and(|s| !s.1.is_empty() && s.1 != profile && s.1 != "keyword-v3")
        {
            "profile_changed"
        } else {
            "missing"
        };
        if keyword == "ready" && manifest.is_none() { /* old index is usable, parser provenance is unknown */
        }
        if excluded {
            keyword = "excluded";
        }
        states.push(DocumentIndexState {
            path,
            title,
            document_id,
            included: !excluded,
            reason: excluded.then(|| "独立 JSON 默认不自动建库；可显式更新当前文档。".into()),
            source_hash,
            indexed_hash: stored.as_ref().map(|s| s.0.clone()),
            keyword_state: keyword.into(),
            vector_state: vector.into(),
            strategy: manifest.as_ref().map(|m| m.strategy.clone()),
            parser_version: manifest.as_ref().map(|m| m.version),
            indexed_at: stored.map(|s| s.2),
            error,
        });
    }
    Ok(IndexStatusSnapshot {
        checked_at: now(),
        embedding_profile: profile,
        documents: states,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn status_distinguishes_running_interrupted_failed_and_broken_keyword_rows() {
        let d = tempfile::tempdir().unwrap();
        let doc =
            library::create_document(d.path(), "inbox", "文档.md", "需核对的预算 36 万元").unwrap();
        let ws = crate::documents::library_workspace(d.path(), "inbox").unwrap();
        let mut p = Provider::default();
        p.enabled = true;
        p.model = "synthetic".into();
        crate::documents::refresh_local(&ws, d.path(), &doc.path, "需核对的预算 36 万元").unwrap();
        let c = db::open(&ws.db).unwrap();
        let hash = files::hash("需核对的预算 36 万元");
        let profile = providers::fingerprint(&p);
        db::record_attempt(&c, &doc.path, &hash, &profile, "processing").unwrap();
        assert_eq!(
            index_status(d.path(), &ws, &p, Some(&doc.path))
                .unwrap()
                .documents[0]
                .vector_state,
            "processing"
        );
        assert_eq!(
            index_status(d.path(), &ws, &p, None).unwrap().documents[0].vector_state,
            "interrupted"
        );
        db::record_attempt(&c, &doc.path, &hash, &profile, "failed").unwrap();
        assert_eq!(
            index_status(d.path(), &ws, &p, None).unwrap().documents[0].vector_state,
            "error"
        );
        c.execute("DELETE FROM chunk_fts", []).unwrap();
        assert_eq!(
            index_status(d.path(), &ws, &p, None).unwrap().documents[0].keyword_state,
            "error"
        );
        std::fs::write(ws.root.join(&doc.path), "版本已经变化").unwrap();
        let s = index_status(d.path(), &ws, &p, None).unwrap();
        assert_eq!(s.documents[0].keyword_state, "stale");
        assert_eq!(s.documents[0].vector_state, "stale");
    }
    #[test]
    fn status_checks_saved_copy_and_survives_model_and_file_changes() {
        let d = tempfile::tempdir().unwrap();
        let doc = library::create_document(d.path(), "inbox", "资料.md", "苹果预算 120").unwrap();
        let ws = crate::documents::library_workspace(d.path(), "inbox").unwrap();
        let mut p = Provider::default();
        let s = index_status(d.path(), &ws, &p, None).unwrap();
        assert_eq!(s.documents[0].keyword_state, "missing");
        crate::documents::refresh_local(&ws, d.path(), &doc.path, "苹果预算 120").unwrap();
        assert_eq!(
            index_status(d.path(), &ws, &p, None).unwrap().documents[0].keyword_state,
            "ready"
        );
        p.enabled = true;
        p.model = "model-a".into();
        assert_eq!(
            index_status(d.path(), &ws, &p, None).unwrap().documents[0].vector_state,
            "missing"
        );
        let c = db::open(&ws.db).unwrap();
        db::mark_plain(&c, &doc.path, &providers::fingerprint(&p)).unwrap();
        assert_ne!(
            index_status(d.path(), &ws, &p, None).unwrap().documents[0].vector_state,
            "ready"
        );
        let ids: Vec<i64> = c
            .prepare("SELECT id FROM chunks WHERE path=?")
            .unwrap()
            .query_map([&doc.path], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        drop(c);
        let mut c = db::open(&ws.db).unwrap();
        db::put_vectors_checked(
            &mut c,
            &doc.path,
            &files::hash("苹果预算 120"),
            &providers::fingerprint(&p),
            &ids,
            &vec![vec![1.0, 0.0]; ids.len()],
        )
        .unwrap();
        assert_eq!(
            index_status(d.path(), &ws, &p, None).unwrap().documents[0].vector_state,
            "ready"
        );
        p.model = "model-b".into();
        assert_eq!(
            index_status(d.path(), &ws, &p, None).unwrap().documents[0].vector_state,
            "profile_changed"
        );
        std::fs::write(ws.root.join(&doc.path), "实际磁盘已变").unwrap();
        assert_eq!(
            index_status(d.path(), &ws, &p, None).unwrap().documents[0].keyword_state,
            "stale"
        );
        std::fs::remove_file(ws.root.join(&doc.path)).unwrap();
        assert_eq!(
            index_status(d.path(), &ws, &p, None).unwrap().documents[0].keyword_state,
            "unknown"
        );
    }
    #[test]
    fn pins_are_durable_scoped_and_not_renames() {
        let d = tempfile::tempdir().unwrap();
        let doc = library::create_document(d.path(), "inbox", "文档.md", "正文").unwrap();
        let ws = crate::documents::library_workspace(d.path(), "inbox").unwrap();
        set_pin(d.path(), &ws, &doc.id, true).unwrap();
        set_pin(d.path(), &ws, &doc.id, true).unwrap();
        assert_eq!(pins(d.path(), &ws).unwrap(), vec![doc.id.clone()]);
        library::rename(d.path(), &doc.id, "新标题.md").unwrap();
        assert_eq!(pins(d.path(), &ws).unwrap(), vec![doc.id.clone()]);
        library::trash(d.path(), &doc.id, false).unwrap();
        assert!(pins(d.path(), &ws).unwrap().is_empty());
    }
}
