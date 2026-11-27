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
        let result = documents::save_if_clean(&ws, &data, &doc.path, &content, &expected_hash)?;
        // documents::save_if_clean refreshes just this document's projection under its write lock.
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

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::Manager;

    #[tokio::test]
    async fn archiving_an_open_space_preserves_source_until_restored() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path();
        let app = tauri::test::mock_builder()
            .manage(
                crate::evaluation_v086::isolated_state(
                    data,
                    Default::default(),
                    Default::default(),
                )
                .unwrap(),
            )
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let project = library::create_project(data, "本地测试").unwrap().id;
        let seed = r#"# Notes

- [ ] task <!--inkstone-task:v1 {"id":"b2e919cb-88b6-4c9c-82cf-06d39c32c495","due":"2026-11-28"}-->

~~~calendar
{"schema":"inkstone.calendar/v1","id":"d85dab54-d06f-410f-b743-87282c9c3c2b","view":"month","timeZone":"Asia/Shanghai","events":[{"id":"11bec4c6-dfa0-4f80-a591-564e971f3305","title":"First meeting","start":"2026-11-28T10:00:00+08:00","end":"2026-11-28T11:00:00+08:00","timeZone":"Asia/Shanghai","allDay":false,"status":"planned","notes":""}]}
~~~
"#;
        let doc = library::create_document(data, &project, "Notes.md", seed).unwrap();
        let root = library::project_root(data, &project).unwrap();
        let path = root.join(&doc.path);
        crate::library_commands::open_library(app.state(), Some(project.clone()))
            .await
            .unwrap();
        let active = seed.replace("# Notes", "# Active");
        let ordinary_save = |text: &str, expected: &str| {
            crate::save_file_for(
                &app.state(),
                doc.path.clone(),
                text.into(),
                expected.into(),
                root.to_string_lossy().into_owned(),
            )
        };
        ordinary_save(&active, &files::hash(seed)).unwrap();
        let hash = files::hash(&active);
        let set_archive = |value: &str| {
            crate::organization::library_layout(
                app.state(),
                project.clone(),
                Some("archive".into()),
                Some(value.to_owned()),
                None,
            )
        };
        set_archive("true").await.unwrap();
        // The editor opened before archival and still holds the previously valid hash.
        assert!(ordinary_save("replacement", &hash)
            .err()
            .unwrap()
            .contains("归档"));
        let draft = active.replace("[ ] task", "[ ] edited task");
        documents::draft(
            &workspace(&app.state()).unwrap(),
            data,
            &doc.path,
            draft.clone(),
            hash.clone(),
        )
        .unwrap();
        let read = documents::read(&workspace(&app.state()).unwrap(), data, &doc.path).unwrap();
        assert_eq!(read.draft.unwrap().content, draft);
        assert_eq!(read.hash, hash);
        // Use the actual planning commands on the archived project, including a fresh open.
        crate::library_commands::open_library(app.state(), Some(project.clone()))
            .await
            .unwrap();
        assert_eq!(
            calendar_list(app.state(), project.clone())
                .await
                .unwrap()
                .documents[0]
                .hash,
            hash
        );
        let tick = active.replace("- [ ]", "- [x]");
        // Clear the recovery draft by restoring its bytes to the original, so the refusal
        // below can only come from the space's archive state.
        documents::draft(
            &workspace(&app.state()).unwrap(),
            data,
            &doc.path,
            active.clone(),
            hash.clone(),
        )
        .unwrap();
        let patch = |content: String, expected_hash: String| {
            calendar_save(
                app.state(),
                project.clone(),
                doc.id.clone(),
                expected_hash,
                content,
            )
        };
        assert!(patch(tick.clone(), hash.clone())
            .await
            .err()
            .unwrap()
            .contains("归档"));
        assert_eq!(files::hash(std::fs::read(&path).unwrap()), hash);
        let renamed = active.replace("First meeting", "Rescheduled meeting");
        assert!(patch(renamed, hash.clone())
            .await
            .err()
            .unwrap()
            .contains("归档"));
        assert_eq!(files::hash(std::fs::read(&path).unwrap()), hash);
        set_archive("false").await.unwrap();
        assert!(patch(tick.clone(), files::hash(seed))
            .await
            .err()
            .unwrap()
            .starts_with("CONFLICT"));
        assert_eq!(files::hash(std::fs::read(&path).unwrap()), hash);
        let result = patch(tick.clone(), hash).await.unwrap();
        assert_eq!(result.hash, files::hash(&tick));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), tick);
    }
}
