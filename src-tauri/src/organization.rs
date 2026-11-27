use crate::{library, AppState};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use tauri::State;

#[derive(Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Layout {
    folders: BTreeSet<String>,
    locations: BTreeMap<String, String>,
    pinned: bool,
    archived: bool,
}
#[tauri::command]
pub async fn library_layout(
    state: State<'_, AppState>,
    project_id: String,
    action: Option<String>,
    value: Option<String>,
    document_id: Option<String>,
) -> Result<Layout, String> {
    let _guard = if action.is_some() {
        Some(crate::maintenance::mutation(&state.data_dir)?)
    } else {
        None
    };
    change_layout(&state.data_dir, project_id, action, value, document_id)
}

fn change_layout(
    data: &std::path::Path,
    project_id: String,
    action: Option<String>,
    value: Option<String>,
    document_id: Option<String>,
) -> Result<Layout, String> {
    let err = |e: rusqlite::Error| e.to_string();
    library::project_root(data, &project_id)?;
    let mut db = library::conn(data)?;
    let tx = db
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(err)?;
    let mut layout = load_layout(&tx, &project_id)?;
    let key = format!("workspace.layout.v1:{project_id}");
    let v = value.unwrap_or_default();
    if layout.archived && !matches!(action.as_deref(), None | Some("archive") | Some("pin")) {
        return Err("请先恢复已归档的空间".into());
    }
    match action.as_deref() {
        None => return Ok(layout),
        Some("folder") => {
            validate_path(&v)?;
            if let Some((parent, _)) = v.rsplit_once('/') {
                if !layout.folders.contains(parent) {
                    return Err("上级文件夹不存在".into());
                }
            }
            if !layout.folders.insert(v) {
                return Err("文件夹已存在".into());
            }
        }
        Some("relocateFolder") | Some("deleteFolder") => {
            let source = document_id.as_deref().ok_or("需要原文件夹")?;
            if !layout.folders.contains(source) {
                return Err("文件夹不存在".into());
            }
            let deleting = action.as_deref() == Some("deleteFolder");
            let prefix = format!("{source}/");
            let inside = |path: &str| path == source || path.starts_with(&prefix);
            // A running import holds its original folder in memory until its last item.
            let active: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM import_destinations d JOIN imports i ON i.id=d.job WHERE i.project=?1 AND i.status='running' AND (d.folder=?2 OR instr(d.folder,?3)=1))",
                params![project_id, source, prefix], |r| r.get(0)).map_err(err)?;
            if active {
                return Err("请等待此目录中的导入完成".into());
            }
            if deleting {
                let pending: bool = tx.query_row(
                    "SELECT EXISTS(SELECT 1 FROM pending_locations l JOIN documents d ON d.id=l.document WHERE d.project=?1 AND l.folder=?2) OR EXISTS(SELECT 1 FROM import_destinations d JOIN imports i ON i.id=d.job WHERE i.project=?1 AND d.folder=?2 AND i.status IN ('partial','interrupted','cancelled'))",
                    params![project_id,source], |r| r.get(0)).map_err(err)?;
                if pending || layout.folders.iter().any(|f| f.starts_with(&prefix)) {
                    return Err("只能删除空文件夹".into());
                }
                for (id, _) in layout
                    .locations
                    .iter()
                    .filter(|(_, folder)| folder.as_str() == source)
                {
                    let exists: bool = tx
                        .query_row(
                            "SELECT EXISTS(SELECT 1 FROM documents WHERE id=? AND project=?)",
                            params![id, project_id],
                            |r| r.get(0),
                        )
                        .map_err(err)?;
                    if exists {
                        return Err("只能删除空文件夹".into());
                    }
                }
                layout.locations.retain(|_, f| f != source);
                layout.folders.remove(source);
            } else {
                validate_path(&v)?;
                if inside(&v) || layout.folders.contains(&v) {
                    return Err("目标文件夹已存在或位于原目录内".into());
                }
                if let Some((parent, _)) = v.rsplit_once('/') {
                    if !layout.folders.contains(parent) {
                        return Err("上级文件夹不存在".into());
                    }
                }
                let rebase = |path: &str| format!("{v}{}", &path[source.len()..]);
                let moved = layout
                    .folders
                    .iter()
                    .filter(|f| inside(f))
                    .map(|f| rebase(f))
                    .collect::<Vec<_>>();
                for path in &moved {
                    validate_path(path)?;
                }
                layout.folders.retain(|f| !inside(f));
                layout.folders.extend(moved);
                for f in layout.locations.values_mut().filter(|f| inside(f)) {
                    *f = rebase(f);
                }
                tx.execute("UPDATE pending_locations SET folder=?1 || substr(folder,length(?2)+1) WHERE document IN (SELECT id FROM documents WHERE project=?3) AND (folder=?2 OR instr(folder,?4)=1)",params![v,source,project_id,prefix]).map_err(err)?;
                tx.execute("UPDATE import_destinations SET folder=?1 || substr(folder,length(?2)+1) WHERE job IN (SELECT id FROM imports WHERE project=?3) AND (folder=?2 OR instr(folder,?4)=1)",params![v,source,project_id,prefix]).map_err(err)?;
            }
        }
        Some("move") => {
            let id = document_id.ok_or("需要资料")?;
            if !v.is_empty() && !layout.folders.contains(&v) {
                return Err("目标文件夹不存在".into());
            }
            tx.query_row(
                "SELECT id FROM documents WHERE project=? AND id=? AND status='ready'",
                params![project_id, id],
                |r| r.get::<_, String>(0),
            )
            .map_err(err)?;
            if v.is_empty() {
                layout.locations.remove(&id);
            } else {
                layout.locations.insert(id, v);
            }
        }
        Some("pin") => layout.pinned = v == "true",
        Some("archive") if project_id != "inbox" => {
            if v == "true" && tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM document_purges WHERE project=? AND phase NOT IN ('completed','rolledBack'))",
                [&project_id], |r| r.get::<_, bool>(0),
            ).map_err(err)? {
                return Err("请先完成该空间中尚未结束的文档删除".into());
            }
            layout.archived = v == "true";
        }
        _ => return Err("无法执行此空间操作".into()),
    }
    tx.execute(
        "INSERT OR REPLACE INTO preferences(key,value) VALUES(?,?)",
        params![
            key,
            serde_json::to_string(&layout).map_err(|e| e.to_string())?
        ],
    )
    .map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(layout)
}

fn validate_path(value: &str) -> Result<(), String> {
    let mut parts = value.split('/');
    if value.len() > 600
        || parts.clone().count() > 12
        || parts.any(|p| {
            p.trim() != p
                || p.is_empty()
                || p.len() > 120
                || p == "."
                || p == ".."
                || p.contains(['\\', '\0'])
        })
    {
        Err("文件夹路径无效".into())
    } else {
        Ok(())
    }
}

fn load_layout(db: &rusqlite::Connection, project_id: &str) -> Result<Layout, String> {
    let key = format!("workspace.layout.v1:{project_id}");
    let raw: Option<String> = db
        .query_row("SELECT value FROM preferences WHERE key=?", [&key], |r| {
            r.get(0)
        })
        .optional()
        .map_err(|e| e.to_string())?;
    serde_json::from_str(raw.as_deref().unwrap_or("{}")).map_err(|e| e.to_string())
}

pub(crate) fn is_archived(data: &std::path::Path, project: &str) -> Result<bool, String> {
    Ok(load_layout(&library::conn(data)?, project)?.archived)
}

pub(crate) fn document_folder(
    db: &rusqlite::Connection,
    project: &str,
    document_id: &str,
) -> Result<String, String> {
    Ok(load_layout(db, project)?
        .locations
        .remove(document_id)
        .unwrap_or_default())
}

pub(crate) fn check_destination(
    db: &rusqlite::Connection,
    project: &str,
    folder: &str,
) -> Result<(), String> {
    let layout = load_layout(db, project)?;
    if layout.archived {
        return Err("请先恢复已归档的空间".into());
    }
    if !folder.is_empty() && !layout.folders.contains(folder) {
        return Err("目标文件夹不存在".into());
    }
    Ok(())
}

/// Order the file replacement against archival, including requests from another process.
pub(crate) fn write_project_file(
    catalog: &mut rusqlite::Connection,
    project: &str,
    path: &std::path::Path,
    content: &[u8],
) -> Result<(), String> {
    let tx = catalog
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    check_destination(&tx, project, "")?;
    // No catalog changes in this transaction. Its drop releases the writer lock.
    crate::files::write_atomic(path, content)
}

// Journal the destination with the pending document, so startup recovery can publish both together.
pub(crate) fn remember_destination(
    tx: &rusqlite::Transaction<'_>,
    project: &str,
    id: &str,
    folder: &str,
) -> Result<(), String> {
    if folder.is_empty() {
        return Ok(());
    }
    check_destination(tx, project, folder)?;
    tx.execute(
        "INSERT INTO pending_locations(document,folder) VALUES(?,?)",
        params![id, folder],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn finish_destination(
    tx: &rusqlite::Transaction<'_>,
    project: &str,
    id: &str,
) -> Result<(), String> {
    let folder: Option<String> = tx
        .query_row(
            "SELECT folder FROM pending_locations WHERE document=?",
            [id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(folder) = folder {
        let mut layout = load_layout(tx, project)?;
        layout.locations.insert(id.into(), folder);
        tx.execute(
            "INSERT OR REPLACE INTO preferences(key,value) VALUES(?,?)",
            params![
                format!("workspace.layout.v1:{project}"),
                serde_json::to_string(&layout).map_err(|e| e.to_string())?
            ],
        )
        .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM pending_locations WHERE document=?", [id])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Serialize)]
pub struct ArchivedPreview {
    hash: String,
    content: String,
    image: Option<String>,
}

#[tauri::command]
pub async fn library_archived_preview(
    state: State<'_, AppState>,
    project_id: String,
    document_id: String,
) -> Result<ArchivedPreview, String> {
    let data = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if !is_archived(&data, &project_id)? {
            return Err("空间未归档".into());
        }
        let doc = library::get(&data, &document_id)?;
        if doc.project_id != project_id || doc.status != "ready" {
            return Err("资料不可用".into());
        }
        let root = library::project_root(&data, &project_id)?;
        let source = crate::files::resolve(&root, &doc.path, false)?;
        let content = crate::files::read_text(&source)?;
        let image = if content.starts_with("<!-- inkstone-image:v1 -->") {
            use base64::Engine;
            let asset = crate::media::stored_asset(&source, true)?;
            if std::fs::metadata(&asset).map_err(|e| e.to_string())?.len() > 8 * 1024 * 1024 {
                return Err("预览超过 8 MB".into());
            }
            Some(format!(
                "data:image/jpeg;base64,{}",
                base64::engine::general_purpose::STANDARD
                    .encode(std::fs::read(asset).map_err(|e| e.to_string())?)
            ))
        } else {
            None
        };
        Ok(ArchivedPreview {
            hash: crate::files::hash(&content),
            content,
            image,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancelled_import_keeps_its_folder_but_a_new_drop_uses_root() {
        let data = tempfile::tempdir().unwrap();
        let source = tempfile::tempdir().unwrap();
        let paths = vec![source.path().join("first.md").display().to_string()];
        std::fs::write(&paths[0], "# First").unwrap();
        let folder = "A/B";
        for path in ["A", folder] {
            change_layout(
                data.path(),
                "inbox".into(),
                Some("folder".into()),
                Some(path.into()),
                None,
            )
            .unwrap();
        }
        let import = |paths: &[String], folder: &str, cancel| {
            library::import_into_folder(
                data.path(),
                "inbox",
                paths,
                true,
                true,
                &std::sync::atomic::AtomicBool::new(cancel),
                |_| {},
                folder,
            )
        };
        assert!(import(&paths, "missing", false).is_err());
        let cancelled = import(&paths, folder, true).unwrap();
        assert!(cancelled.cancelled);
        let saved = library::list(data.path())
            .unwrap()
            .pending_imports
            .into_iter()
            .find(|task| task.id == cancelled.job_id)
            .unwrap();
        assert_eq!(saved.folder, folder);
        let new_drop = import(&paths, "", false).unwrap();
        let root_id = new_drop.items[0].document_id.as_ref().unwrap();
        let replay = import(&saved.paths, &saved.folder, false).unwrap();
        assert_eq!(replay.items[0].status, "skipped");
        assert_eq!(replay.items[0].document_id.as_ref().unwrap(), root_id);
        let second = source.path().join("second.md");
        std::fs::write(&second, "# Second").unwrap();
        let child = import(&[second.display().to_string()], folder, false).unwrap();
        let layout = change_layout(data.path(), "inbox".into(), None, None, None).unwrap();
        assert!(!layout.locations.contains_key(root_id));
        assert_eq!(
            layout.locations[child.items[0].document_id.as_ref().unwrap()],
            folder
        );
    }

    #[test]
    fn archived_source_updates_and_history_preserve_current_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path();
        let sources = tempfile::tempdir().unwrap();
        let original = sources.path().join("notes.md");
        std::fs::write(&original, "# One").unwrap();
        let project = library::create_project(data, "Reading").unwrap().id;
        let result = library::import(
            data,
            &project,
            &[original.display().to_string()],
            true,
            true,
            &std::sync::atomic::AtomicBool::new(false),
            |_| {},
        )
        .unwrap();
        let id = result.items[0].document_id.as_ref().unwrap();
        let update = |keep_both| {
            let p = library::check_source_update(data, id)?;
            library::apply_source_update(
                data,
                id,
                &p.managed_fingerprint,
                p.source_fingerprint.as_deref().unwrap(),
                keep_both,
            )
        };
        std::fs::write(&original, "# Two").unwrap();
        let updated = update(false).unwrap();
        let body = library::project_root(data, &project)
            .unwrap()
            .join(updated.document.path);
        let previous = library::history(data, id).unwrap().remove(0);
        let archive = |value: &str| {
            change_layout(
                data,
                project.clone(),
                Some("archive".into()),
                Some(value.into()),
                None,
            )
        };
        archive("true").unwrap();
        std::fs::write(&original, "# Three").unwrap();
        let check = library::check_source_update(data, id).unwrap();
        for keep_both in [false, true] {
            assert!(update(keep_both).err().unwrap().contains("归档"));
        }
        assert!(
            library::restore_version(data, id, &previous.id, &check.managed_fingerprint)
                .err()
                .unwrap()
                .contains("归档")
        );
        assert_eq!(std::fs::read(&body).unwrap(), b"# Two");
        assert_eq!(library::history(data, id).unwrap().len(), 1);
        assert_eq!(library::list(data).unwrap().documents.len(), 1);
        archive("false").unwrap();
        update(false).unwrap();
        assert_eq!(std::fs::read(&body).unwrap(), b"# Three");
    }

    #[test]
    fn space_names_and_archived_destinations_are_checked_on_write() {
        let data = tempfile::tempdir().unwrap();
        let project = library::create_project(data.path(), "Research").unwrap().id;
        assert!(library::create_project(data.path(), " Research ").is_err());
        assert!(library::rename_project(data.path(), "inbox", "Research").is_err());
        library::rename_project(data.path(), &project, "Research").unwrap();
        change_layout(
            data.path(),
            project.clone(),
            Some("archive".into()),
            Some("true".into()),
            None,
        )
        .unwrap();
        assert!(library::create_document(data.path(), &project, "note.md", "draft").is_err());
    }

    #[test]
    fn recovery_publishes_document_and_target_folder_together() {
        let data = tempfile::tempdir().unwrap();
        change_layout(
            data.path(),
            "inbox".into(),
            Some("folder".into()),
            Some("A".into()),
            None,
        )
        .unwrap();
        let root = library::project_root(data.path(), "inbox").unwrap();
        let file = "documents/fixture/note.md";
        std::fs::create_dir_all(root.join("documents/fixture")).unwrap();
        std::fs::write(root.join(file), "# Recovered").unwrap();
        let mut db = library::conn(data.path()).unwrap();
        let tx = db.transaction().unwrap();
        tx.execute("INSERT INTO documents(id,project,path,title,original_hash,source,updated,opened,status) VALUES('fixture','inbox',?,'note.md','','',0,0,'pending')", [file]).unwrap();
        remember_destination(&tx, "inbox", "fixture", "A").unwrap();
        tx.commit().unwrap();
        library::recover(data.path()).unwrap();
        assert_eq!(
            library::get(data.path(), "fixture").unwrap().status,
            "ready"
        );
        assert_eq!(load_layout(&db, "inbox").unwrap().locations["fixture"], "A");
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM pending_locations", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn folder_operations_rebase_subtrees_and_preserve_identity() {
        let data = tempfile::tempdir().unwrap();
        let data = data.path();
        let change = |action: &str, to: &str, from: Option<&str>| {
            change_layout(
                data,
                "inbox".into(),
                Some(action.into()),
                Some(to.into()),
                from.map(String::from),
            )
        };
        for folder in ["项目", "项目/图片", "项目计划", "备份"] {
            change("folder", folder, None).unwrap();
        }
        let (doc, _) = library::create_with_assets(
            data,
            "inbox",
            "地图.mindmap.md",
            "# 明年旅行",
            None,
            None,
            "项目/图片",
        )
        .unwrap();
        assert!(change("relocateFolder", "项目/图片/递归", Some("项目")).is_err());
        assert!(change("relocateFolder", "备份", Some("项目")).is_err());
        assert!(change("deleteFolder", "", Some("项目/图片")).is_err());
        change("relocateFolder", "项目归档", Some("项目")).unwrap();
        let moved = change("relocateFolder", "备份/项目归档", Some("项目归档")).unwrap();
        assert!(moved.folders.contains("项目计划"));
        assert!(!moved.folders.contains("项目/图片"));
        assert_eq!(moved.locations[&doc.id], "备份/项目归档/图片");
        assert_eq!(library::get(data, &doc.id).unwrap().path, doc.path);
        change("move", "", Some(&doc.id)).unwrap();
        change("deleteFolder", "", Some("备份/项目归档/图片")).unwrap();
        change("deleteFolder", "", Some("备份/项目归档")).unwrap();
    }

    #[test]
    fn nested_folder_move_preserves_map_source_and_document_identity() {
        let root = tempfile::tempdir().unwrap();
        let data = root.path();
        let project = library::create_project(data, "Research").unwrap().id;
        let other = library::create_project(data, "Other").unwrap().id;
        let body = "# Work\n\n- Materials\n  - Photo\n";
        let doc = library::create_document(data, &project, "Research.mindmap.md", body).unwrap();
        let change = |act: &str, v: &str, id: Option<&str>| {
            change_layout(
                data,
                project.clone(),
                Some(act.to_owned()),
                Some(v.to_owned()),
                id.map(String::from),
            )
        };
        assert!(change("folder", "year/week", None).is_err());
        change("folder", "year", None).unwrap();
        change("folder", "year/week", None).unwrap();
        change("move", "year/week", Some(&doc.id)).unwrap();
        assert!(
            change_layout(data, other, Some("move".into()), None, Some(doc.id.clone())).is_err()
        );
        let saved = change_layout(data, project.clone(), None, None, None).unwrap();
        assert_eq!(saved.locations[&doc.id], "year/week");
        assert_eq!(library::get(data, &doc.id).unwrap().path, doc.path);
        assert_eq!(
            std::fs::read_to_string(
                library::project_root(data, &project)
                    .unwrap()
                    .join(doc.path)
            )
            .unwrap(),
            body
        );
        change("archive", "true", None).unwrap();
        assert!(library::list(data)
            .unwrap()
            .projects
            .iter()
            .any(|p| p.id == project && p.archived));
        change("archive", "false", None).unwrap();
    }
}
