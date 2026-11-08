use crate::{calendar, documents, files, library, models::Workspace, workspace, AppState};
use tauri::State;
#[tauri::command]
pub async fn calendar_list(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<calendar::CalendarView, String> {
    let data = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || calendar::refresh(&data, &project_id))
        .await
        .map_err(|_| "日历读取未完成".to_string())?
}
#[tauri::command]
pub async fn calendar_save(
    state: State<'_, AppState>,
    project_id: String,
    document_id: String,
    expected_hash: String,
    content: String,
) -> Result<documents::SaveResult, String> {
    let active = workspace(&state)?;
    if library::project_at_root(&state.data_dir, &active.root).as_deref() != Some(&project_id) {
        return Err("项目已切换，日程未写入其他项目".into());
    }
    let doc = library::get(&state.data_dir, &document_id)?;
    if doc.project_id != project_id || doc.status != "ready" {
        return Err("原文已移除或不在此项目中".into());
    }
    if !doc.path.to_lowercase().ends_with(".md") && !doc.path.to_lowercase().ends_with(".markdown")
    {
        return Err("日程仅保存到 Markdown 文档".into());
    }

    let data = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let root = library::project_root(&data, &project_id)?;
        let ws = Workspace {
            root,
            db: active.db,
        };
        let before = files::read_text(&files::resolve(&ws.root, &doc.path, false)?)?;
        calendar::validate_edit(&before, &content)?;
        let result = documents::save(&ws, &data, &doc.path, &content, &expected_hash)?;
        // Projection is disposable; a cache error must not report the authoritative save as failed.
        let _ = calendar::refresh(&data, &project_id);
        Ok(result)
    })
    .await
    .map_err(|_| "日程保存未完成，请核对原文".to_string())?
}
#[tauri::command]
pub async fn export_calendar_ics(
    app: tauri::AppHandle,
    name: String,
    content: String,
) -> Result<(), String> {
    if content.len() > 8 * 1024 * 1024
        || !content.starts_with("BEGIN:VCALENDAR")
        || !content.contains("END:VCALENDAR")
    {
        return Err("请导出有效的 ICS 文件（最多 8 MB）".into());
    }
    let name = if name.len() <= 240
        && !name.contains(['/', '\\', ':', '\0'])
        && name.to_ascii_lowercase().ends_with(".ics")
    {
        &name
    } else {
        "Inkstone-日程.ics"
    };
    if let Some(target) =
        crate::export_destination::choose(&app, name, "iCalendar 日历", "ics").await?
    {
        files::write_atomic(&target, content.as_bytes())?;
    }
    Ok(())
}
