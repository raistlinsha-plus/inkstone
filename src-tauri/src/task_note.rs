//! Quick capture into the space's remembered Markdown document.
use crate::{
    calendar::{tasks, CalendarDocument},
    documents, files, library, maintenance, workspace, AppState,
};
use serde::Serialize;
use std::path::Path;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendResult {
    document: CalendarDocument,
    before_content: String,
    warning: Option<String>,
}

#[tauri::command]
pub async fn task_note_append(
    state: State<'_, AppState>,
    project_id: String,
    title: String,
    task_line: String,
) -> Result<AppendResult, String> {
    let data = state.data_dir.clone();
    if library::project_at_root(&data, &workspace(&state)?.root).as_deref() != Some(&project_id) {
        return Err("空间已切换，请在当前空间重新添加任务。".into());
    }
    tauri::async_runtime::spawn_blocking(move || append(&data, &project_id, &title, &task_line))
        .await
        .map_err(|_| "任务保存未完成".to_string())?
}

fn append(data: &Path, project: &str, title: &str, line: &str) -> Result<AppendResult, String> {
    if line.len() > 16384
        || line.contains(['\r', '\n', '\0'])
        || !line.starts_with("- [ ] ")
        || !matches!(title, "任务清单.md" | "Tasks.md")
    {
        return Err("任务标题或格式无效".into());
    }
    let input = tasks::rows(line);
    let [new_task] = input.as_slice() else {
        return Err("无效的任务标记".into());
    };
    let _permit = maintenance::mutation(data)?;
    let ws = documents::library_workspace(data, project)?;
    // Serialize quick captures in this space. Normal editor writes still use the file lock and expected hash.
    documents::with_write_lock(&ws.root, || {
        let header = format!("# {}\n", title.trim_end_matches(".md"));
        let initial = format!("{header}\n{line}\n");
        let (doc, created) = library::create_managed_document(
            data,
            project,
            title,
            &initial,
            Some(library::RememberedNote::TaskList),
        )?;
        let prior = documents::read(&ws, data, &doc.path)?;
        if prior.draft.is_some() || prior.missing {
            return Err("任务清单有未处理的草稿，请先打开并保存。".into());
        }
        let mut content = prior.content;
        let mut before_content = content.clone();
        let mut warning = None;
        let already_present = tasks::rows(&content)
            .iter()
            .any(|row| row.id().eq_ignore_ascii_case(new_task.id()));
        if created && content == initial {
            before_content = header;
            let saved_path = files::resolve(&ws.root, &doc.path, false)?;
            let refreshed = documents::with_write_lock(&saved_path, || {
                let current = files::read_text(&saved_path)?;
                documents::refresh_local(&ws, data, &doc.path, &current)?;
                crate::calendar::refresh_saved(data, &ws.root, &doc.path, &current)
            });
            if refreshed.is_err() {
                warning = Some("任务已保存，本地索引需刷新。".into());
            }
        } else if !already_present {
            let nl = if content.contains("\r\n") {
                "\r\n"
            } else {
                "\n"
            };
            if !content.is_empty() && !content.ends_with('\n') {
                content.push_str(nl);
            }
            content.push_str(nl);
            content.push_str(line);
            content.push_str(nl);
            if !tasks::rows(&content)
                .iter()
                .any(|row| row.id().eq_ignore_ascii_case(new_task.id()))
            {
                return Err("文末无法插入任务，请检查原文是否有未闭合的代码块。".into());
            }
            warning =
                documents::save_if_clean(&ws, data, &doc.path, &content, &prior.hash)?.warning;
        }
        let hash = files::hash(&content);
        Ok(AppendResult {
            document: CalendarDocument {
                document_id: doc.id,
                title: doc.title,
                path: doc.path,
                task_hash: hash.clone(),
                hash,
                task_rows: tasks::rows(&content),
                content,
                chat_task_ids: Vec::new(),
            },
            before_content,
            warning,
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn task(title: &str) -> String {
        format!(
            "- [ ] {title} <!--inkstone-task:v1 {{\"id\":\"{}\",\"due\":\"2026-11-23\"}}-->",
            uuid::Uuid::new_v4()
        )
    }
    #[test]
    fn concurrent_quick_captures_share_one_document() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path();
        library::project_root(data, "inbox").unwrap();
        std::thread::scope(|scope| {
            let a = scope.spawn(|| append(data, "inbox", "Tasks.md", &task("first")).unwrap());
            let b = scope.spawn(|| append(data, "inbox", "Tasks.md", &task("second")).unwrap());
            assert_eq!(
                a.join().unwrap().document.document_id,
                b.join().unwrap().document.document_id
            );
        });
        let view = crate::calendar::refresh(data, "inbox").unwrap();
        assert_eq!(view.documents.len(), 1);
        assert_eq!(view.documents[0].task_rows.len(), 2);
    }
    #[test]
    fn first_capture_rename_retry_and_projection_keep_one_note() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path();
        assert!(append(data, "inbox", "任务清单.md", "bad").is_err());
        let other =
            library::create_document(data, "inbox", "任务清单.md", "已有私人的清单").unwrap();
        let a = task("一");
        let b = task("二");
        let first = append(data, "inbox", "任务清单.md", &a).unwrap().document;
        assert_ne!(first.document_id, other.id);
        library::rename(data, &first.document_id, "行动.md").unwrap();
        let second = append(data, "inbox", "Tasks.md", &b).unwrap();
        assert_eq!(second.before_content, first.content);
        assert_eq!(second.document.title, "行动.md");
        let retry = append(data, "inbox", "Tasks.md", &b).unwrap();
        assert_eq!(retry.document.content, second.document.content);
        assert_eq!(retry.document.task_rows.len(), 2);
        let projection = crate::calendar::refresh(data, "inbox").unwrap();
        assert_eq!(
            projection
                .documents
                .iter()
                .find(|d| d.document_id == first.document_id)
                .unwrap()
                .task_rows
                .len(),
            2
        );
        library::trash(data, &first.document_id, false).unwrap();
        let replacement = append(data, "inbox", "Tasks.md", &task("三"))
            .unwrap()
            .document;
        assert_ne!(replacement.document_id, first.document_id);
        assert_eq!(replacement.task_rows.len(), 1);
        library::trash(data, &first.document_id, true).unwrap();
        assert_eq!(
            append(data, "inbox", "Tasks.md", &task("四"))
                .unwrap()
                .document
                .document_id,
            replacement.document_id
        );
    }
}
