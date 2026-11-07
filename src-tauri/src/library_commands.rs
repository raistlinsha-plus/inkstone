use crate::{
    calendar, check_idle, documents, library, open_workspace, workspace, AppState, WorkspaceView,
};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use tauri::{Emitter, State};
#[tauri::command]
pub async fn library_trash_detail(
    state: State<'_, AppState>,
    project_id: String,
    document_id: String,
) -> Result<library::lifecycle::TrashDetail, String> {
    let data = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        library::lifecycle::detail(&data, &project_id, &document_id)
    })
    .await
    .map_err(|_| "回收站详情读取失败".to_string())?
}
#[tauri::command]
pub async fn library_purge_preview(
    state: State<'_, AppState>,
    project_id: String,
    document_id: String,
) -> Result<library::lifecycle::PurgePreview, String> {
    check_idle(&state)?;
    let data = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        library::lifecycle::preview(&data, &project_id, &document_id)
    })
    .await
    .map_err(|_| "删除预览未完成".to_string())?
}
#[tauri::command]
pub async fn library_purge_execute(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    project_id: String,
    document_id: String,
    token: String,
    operation_id: String,
    confirmation: String,
) -> Result<library::lifecycle::PurgeResult, String> {
    check_idle(&state)?;
    let data = state.data_dir.clone();
    let project = project_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        library::lifecycle::execute(
            &data,
            &project_id,
            &document_id,
            &token,
            &operation_id,
            &confirmation,
        )
    })
    .await
    .map_err(|_| "删除结果暂不可读，请查询操作状态".to_string())??;
    let _ = app.emit(
        "library-lifecycle-changed",
        serde_json::json!({"projectId":project,"status":result.status}),
    );
    Ok(result)
}
#[tauri::command]
pub async fn library_purge_status(
    state: State<'_, AppState>,
    project_id: String,
    operation_id: String,
) -> Result<library::lifecycle::PurgeResult, String> {
    library::lifecycle::status(&state.data_dir, &project_id, &operation_id)
}
#[tauri::command]
pub async fn library_get_view(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<library::ViewPreferences, String> {
    library::get_view(&state.data_dir, &project_id)
}
#[tauri::command]
pub async fn library_set_view(
    state: State<'_, AppState>,
    project_id: String,
    preferences: library::ViewPreferences,
) -> Result<(), String> {
    let _permit = crate::maintenance::mutation(&state.data_dir)?;
    library::set_view(&state.data_dir, &project_id, &preferences)
}
#[tauri::command]
pub async fn library_list(state: State<'_, AppState>) -> Result<library::LibraryView, String> {
    library::list(&state.data_dir)
}
#[tauri::command]
pub async fn open_library(
    state: State<'_, AppState>,
    project_id: Option<String>,
) -> Result<WorkspaceView, String> {
    check_idle(&state)?;
    let id = project_id.unwrap_or_else(|| library::last_project(&state.data_dir));
    let root = library::project_root(&state.data_dir, &id)?;
    library::select_project(&state.data_dir, &id)?;
    let mut view = open_workspace(state.clone(), root.display().to_string()).await?;
    let data = state.data_dir.clone();
    let project = id.clone();
    let refreshed = tauri::async_runtime::spawn_blocking(move || {
        let _permit = crate::maintenance::mutation(&data)?;
        let result = documents::refresh_project(&data, &project);
        let _ = calendar::refresh(&data, &project);
        result
    })
    .await;
    if !matches!(refreshed, Ok(Ok(()))) {
        view.warning = Some("文档可用；本地索引有未完成项，可在知识库中更新。".into());
    }
    if let Ok(ws) = workspace(&state) {
        if let Ok(c) = crate::db::open(&ws.db) {
            view.stats = crate::db::stats(
                &c,
                &crate::providers::fingerprint(&crate::settings(&state)?.embedding),
            );
        }
    }
    Ok(view)
}
#[tauri::command]
pub async fn library_create_project(
    state: State<'_, AppState>,
    title: String,
) -> Result<library::Project, String> {
    let _permit = crate::maintenance::mutation(&state.data_dir)?;
    library::create_project(&state.data_dir, &title)
}
#[tauri::command]
pub async fn library_rename_project(
    state: State<'_, AppState>,
    id: String,
    title: String,
) -> Result<library::Project, String> {
    let _permit = crate::maintenance::mutation(&state.data_dir)?;
    library::rename_project(&state.data_dir, &id, &title)
}

#[tauri::command]
pub async fn library_check_source_update(
    state: State<'_, AppState>,
    id: String,
) -> Result<library::SourceUpdatePreview, String> {
    let data = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || library::check_source_update(&data, &id))
        .await
        .map_err(|_| "来源检查未完成".to_string())?
}
#[tauri::command]
pub async fn library_history(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<library::HistoryVersion>, String> {
    let data = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || library::history(&data, &id))
        .await
        .map_err(|_| "历史读取未完成".to_string())?
}
fn refresh_update(
    data: &std::path::Path,
    mut result: library::UpdateResult,
) -> library::UpdateResult {
    let d = &result.document;
    let refreshed = (|| {
        let ws = documents::library_workspace(data, &d.project_id)?;
        let path = crate::files::resolve(&ws.root, &d.path, false)?;
        documents::with_write_lock(&path, || {
            let text = crate::files::read_text(&path)?;
            documents::refresh_local(&ws, data, &d.path, &text)
        })
    })();
    if refreshed.is_err() {
        result.warning = Some(format!(
            "{}正文已保存；本地索引稍后需要更新。",
            result.warning.map(|s| s + "\n").unwrap_or_default()
        ));
    }
    let _ = calendar::refresh(data, &d.project_id);
    result
}
#[tauri::command]
pub async fn library_apply_source_update(
    state: State<'_, AppState>,
    id: String,
    expected_managed_fingerprint: String,
    expected_source_fingerprint: String,
    keep_both: bool,
) -> Result<library::UpdateResult, String> {
    let _permit = crate::maintenance::mutation(&state.data_dir)?;
    check_idle(&state)?;
    let data = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = library::apply_source_update(
            &data,
            &id,
            &expected_managed_fingerprint,
            &expected_source_fingerprint,
            keep_both,
        )?;
        Ok(refresh_update(&data, result))
    })
    .await
    .map_err(|_| "来源更新未完成，请核对文档和历史记录".to_string())?
}
#[tauri::command]
pub async fn library_restore_version(
    state: State<'_, AppState>,
    id: String,
    version_id: String,
    expected_managed_fingerprint: String,
) -> Result<library::UpdateResult, String> {
    let _permit = crate::maintenance::mutation(&state.data_dir)?;
    check_idle(&state)?;
    let data = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result =
            library::restore_version(&data, &id, &version_id, &expected_managed_fingerprint)?;
        Ok(refresh_update(&data, result))
    })
    .await
    .map_err(|_| "历史恢复未完成，请核对文档和历史记录".to_string())?
}
#[tauri::command]
pub async fn library_create_document(
    state: State<'_, AppState>,
    project_id: String,
    title: String,
    content: String,
    from_assistant: Option<bool>,
) -> Result<library::Document, String> {
    let _permit = crate::maintenance::mutation(&state.data_dir)?;
    let doc = library::create_document_with_origin(
        &state.data_dir,
        &project_id,
        &title,
        &content,
        from_assistant.unwrap_or(false),
    )?;
    if let Ok(ws) = documents::library_workspace(&state.data_dir, &project_id) {
        let _ = documents::refresh_local(&ws, &state.data_dir, &doc.path, &content);
    }
    Ok(doc)
}
#[tauri::command]
pub async fn library_rename(
    state: State<'_, AppState>,
    id: String,
    title: String,
) -> Result<(), String> {
    let _permit = crate::maintenance::mutation(&state.data_dir)?;
    library::rename(&state.data_dir, &id, &title)?;
    let d = library::get(&state.data_dir, &id)?;
    if let Ok(ws) = documents::library_workspace(&state.data_dir, &d.project_id) {
        if let Ok(path) = crate::files::resolve(&ws.root, &d.path, false) {
            let _ = documents::with_write_lock(&path, || {
                let text = crate::files::read_text(&path)?;
                documents::refresh_local(&ws, &state.data_dir, &d.path, &text)
            });
        }
    }
    Ok(())
}
#[tauri::command]
pub async fn library_trash(
    state: State<'_, AppState>,
    id: String,
    restore: bool,
) -> Result<(), String> {
    let _permit = crate::maintenance::mutation(&state.data_dir)?;
    let d = library::get(&state.data_dir, &id)?;
    library::trash(&state.data_dir, &id, restore)?;
    if let Ok(ws) = workspace(&state) {
        if library::project_at_root(&state.data_dir, &ws.root).as_deref() == Some(&d.project_id) {
            let _ = crate::db::open_with_timeout(&ws.db, std::time::Duration::from_millis(80))
                .and_then(|c| crate::db::delete_document(&c, &d.path));
        }
    }
    if restore {
        if let Ok(ws) = documents::library_workspace(&state.data_dir, &d.project_id) {
            if let Ok(path) = crate::files::resolve(&ws.root, &d.path, false) {
                let _ = documents::with_write_lock(&path, || {
                    let text = crate::files::read_text(&path)?;
                    documents::refresh_local(&ws, &state.data_dir, &d.path, &text)
                });
            }
        }
    }
    let _ = calendar::refresh(&state.data_dir, &d.project_id);
    Ok(())
}
struct ImportGuard(Arc<AtomicBool>);
impl Drop for ImportGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst)
    }
}
#[tauri::command]
pub async fn library_import(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    project_id: String,
    paths: Vec<String>,
    skip_duplicates: bool,
    attachments: bool,
    resume_job_id: Option<String>,
) -> Result<library::ImportResult, String> {
    let _permit = crate::maintenance::mutation(&state.data_dir)?;
    check_idle(&state)?;
    if state.import_busy.swap(true, Ordering::SeqCst) {
        return Err("已有导入正在进行".into());
    }
    let guard = ImportGuard(state.import_busy.clone());
    state.import_cancel.store(false, Ordering::SeqCst);
    let data = state.data_dir.clone();
    let cancel = state.import_cancel.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let mut result = library::import(
            &data,
            &project_id,
            &paths,
            skip_duplicates,
            attachments,
            &cancel,
            |p| {
                let _ = app.emit("import-progress", p);
            },
        )?;
        if documents::refresh_project(&data, &project_id).is_err() {
            result
                .warnings
                .push("副本已保存；本地索引有未完成项，请更新知识库。".into());
        }
        let _ = calendar::refresh(&data, &project_id);
        crate::wiki::schedule(app);
        if !result.cancelled {
            if let Some(id) = resume_job_id {
                let _ = library::retried(&data, &id);
            }
        }
        Ok(result)
    })
    .await
    .map_err(|_| "导入任务未完成，请重新打开文档库查看恢复记录".to_string())?
}
#[tauri::command]
pub fn cancel_import(state: State<'_, AppState>) {
    state.import_cancel.store(true, Ordering::SeqCst)
}
#[tauri::command]
pub async fn library_export(
    state: State<'_, AppState>,
    project_id: String,
    document_id: Option<String>,
    path: String,
    bundle: bool,
) -> Result<(), String> {
    let data = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let target = PathBuf::from(path);
        if bundle {
            library::export_bundle(&data, &project_id, document_id.as_deref(), &target)
        } else {
            library::export_file(&data, &document_id.ok_or("请选择文档")?, &target)
        }
    })
    .await
    .map_err(|_| "导出任务未完成".to_string())?
}
#[tauri::command]
pub async fn library_reveal(state: State<'_, AppState>, project_id: String) -> Result<(), String> {
    let root = library::project_root(&state.data_dir, &project_id)?;
    std::process::Command::new("/usr/bin/open")
        .arg(root)
        .spawn()
        .map_err(|_| "无法在访达中打开".to_string())?;
    Ok(())
}

#[tauri::command]
pub fn library_archive_import(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let _permit = crate::maintenance::mutation(&state.data_dir)?;
    library::archive_import(&state.data_dir, &id)
}

#[tauri::command]
pub async fn library_recovery_report(
    state: State<'_, AppState>,
) -> Result<library::RecoveryReport, String> {
    library::recovery_report(&state.data_dir)
}
#[tauri::command]
pub async fn library_retry_recovery(
    state: State<'_, AppState>,
) -> Result<library::RecoveryReport, String> {
    check_idle(&state)?;
    let data = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _exclusive = crate::maintenance::exclusive_recovery(&data)?;
        let result = library::lifecycle::recover(&data).and_then(|_| library::recover(&data));
        crate::maintenance::set_managed_error(&data, result.as_ref().err().cloned());
        result
    })
    .await
    .map_err(|_| "恢复检查未完成，原文件保留".to_string())?
}
#[tauri::command]
pub async fn library_relink_preview(
    state: State<'_, AppState>,
    id: String,
    choices: Option<Vec<library::RelinkChoice>>,
) -> Result<library::RelinkPreview, String> {
    let data = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        library::relink_preview(&data, &id, &choices.unwrap_or_default())
    })
    .await
    .map_err(|_| "链接预览未完成".to_string())?
}
#[tauri::command]
pub async fn library_relink_apply(
    state: State<'_, AppState>,
    id: String,
    expected_managed_fingerprint: String,
    expected_catalog_fingerprint: String,
    choices: Vec<library::RelinkChoice>,
) -> Result<library::UpdateResult, String> {
    let _permit = crate::maintenance::mutation(&state.data_dir)?;
    check_idle(&state)?;
    let data = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = library::relink_apply(
            &data,
            &id,
            &expected_managed_fingerprint,
            &expected_catalog_fingerprint,
            &choices,
        )?;
        Ok(refresh_update(&data, result))
    })
    .await
    .map_err(|_| "链接修复未完成，请核对正文与历史".to_string())?
}
