use crate::{assistant, files, library, models::*, workspace, AppState};
use assistant::memory;
use std::{path::Path, sync::atomic::Ordering};
use tauri::{Emitter, State};

fn context(state: &AppState) -> Result<(Workspace, String), String> {
    let ws = workspace(state)?;
    let id = assistant::workspace_id(&state.data_dir, &ws);
    Ok((ws, id))
}

fn memory_context(state: &AppState, root: &str) -> Result<(Workspace, String), String> {
    let (ws, id) = context(state)?;
    if ws.root != Path::new(root) {
        return Err("资料空间已切换，请重新打开记忆设置".into());
    }
    Ok((ws, id))
}

#[tauri::command]
pub fn assistant_memory_settings(
    state: State<'_, AppState>,
    workspace_root: String,
) -> Result<serde_json::Value, String> {
    let (ws, id) = memory_context(&state, &workspace_root)?;
    let (preferences, handled) = memory::preferences(&state.data_dir, &id)?;
    let legacy = crate::companion::legacy_answer_preferences(&state.data_dir, &ws)?
        .into_iter()
        .filter(|p| !handled.contains(&p.id))
        .collect::<Vec<_>>();
    Ok(serde_json::json!({"preferences":preferences,"legacy":legacy}))
}

#[tauri::command]
pub fn assistant_memory_update(
    state: State<'_, AppState>,
    workspace_root: String,
    change: memory::Change,
) -> Result<serde_json::Value, String> {
    let (ws, id) = memory_context(&state, &workspace_root)?;
    if let Some(legacy_id) = &change.legacy_id {
        if !crate::companion::legacy_answer_preferences(&state.data_dir, &ws)?
            .iter()
            .any(|p| {
                p.id == *legacy_id
                    && p.scope == change.scope
                    && memory::Key::legacy(&p.key) == Some(change.key)
            })
        {
            return Err("旧偏好不在当前范围或已失效".into());
        }
    }
    memory::update(&state.data_dir, &id, change)?;
    assistant_memory_settings(state, workspace_root)
}

#[tauri::command]
pub fn assistant_history_preview(
    state: State<'_, AppState>,
    workspace_root: String,
    scope: Option<String>,
    reference: memory::HistoryRef,
) -> Result<memory::HistoryPreview, String> {
    let (ws, id) = memory_context(&state, &workspace_root)?;
    scope_label(&state, &ws, scope.as_deref())?;
    memory::history(&state.data_dir, &id, scope.as_deref(), &reference)
}
fn scope_label(state: &AppState, ws: &Workspace, scope: Option<&str>) -> Result<String, String> {
    if let Some(scope) = scope {
        files::validate_relative(scope)?;
        if !files::supported(Path::new(scope)) {
            return Err("此格式不能用作问答资料范围".into());
        }
        files::resolve(&ws.root, scope, false)?;
        if library::project_at_root(&state.data_dir, &ws.root).is_some()
            && library::title_for(&state.data_dir, &ws.root, scope).is_none()
        {
            return Err("文档已移除或不属于当前空间".into());
        }
        Ok(format!(
            "当前文档 · {}",
            library::title_for(&state.data_dir, &ws.root, scope)
                .map(|x| x.1)
                .unwrap_or_else(|| Path::new(scope)
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned())
        ))
    } else {
        Ok("当前空间".into())
    }
}
#[tauri::command]
pub fn assistant_list(
    state: State<'_, AppState>,
    include_archived: Option<bool>,
    query: Option<String>,
    offset: Option<u32>,
) -> Result<Vec<assistant::Summary>, String> {
    let (_, id) = context(&state)?;
    assistant::list_page(
        &state.data_dir,
        &id,
        include_archived.unwrap_or(false),
        query.as_deref().unwrap_or(""),
        offset.unwrap_or(0),
    )
}
#[tauri::command]
pub fn assistant_create(
    state: State<'_, AppState>,
    scope: Option<String>,
    title: Option<String>,
) -> Result<assistant::Conversation, String> {
    let (ws, id) = context(&state)?;
    let label = scope_label(&state, &ws, scope.as_deref())?;
    assistant::create(&state.data_dir, &id, scope, label, title)
}
#[tauri::command]
pub fn assistant_get(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<assistant::Conversation, String> {
    let (_, id) = context(&state)?;
    assistant::get(&state.data_dir, &id, &conversation_id)
}
#[tauri::command]
pub fn assistant_update(
    state: State<'_, AppState>,
    conversation_id: String,
    expected_revision: i64,
    title: Option<String>,
    archived: Option<bool>,
    draft: Option<String>,
    active_leaf_id: Option<String>,
) -> Result<assistant::Conversation, String> {
    let (_, id) = context(&state)?;
    assistant::update(
        &state.data_dir,
        &id,
        &conversation_id,
        expected_revision,
        title,
        archived,
        draft,
        active_leaf_id,
    )
}
#[tauri::command]
pub fn assistant_save_running_draft(
    state: State<'_, AppState>,
    conversation_id: String,
    request_id: String,
    draft: String,
) -> Result<bool, String> {
    let (_, id) = context(&state)?;
    assistant::save_running_draft(&state.data_dir, &id, &conversation_id, &request_id, &draft)
}
#[tauri::command]
pub fn assistant_delete(
    state: State<'_, AppState>,
    conversation_id: String,
    expected_revision: i64,
) -> Result<(), String> {
    let (_, id) = context(&state)?;
    assistant::delete(&state.data_dir, &id, &conversation_id, expected_revision)
}
#[tauri::command]
pub fn assistant_export(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<assistant::Export, String> {
    let (_, id) = context(&state)?;
    assistant::export(&state.data_dir, &id, &conversation_id)
}
#[tauri::command]
pub fn assistant_select_candidate(
    state: State<'_, AppState>,
    conversation_id: String,
    turn_id: String,
    candidate_id: String,
    expected_revision: i64,
) -> Result<assistant::Conversation, String> {
    let (_, id) = context(&state)?;
    assistant::select(
        &state.data_dir,
        &id,
        &conversation_id,
        &turn_id,
        &candidate_id,
        expected_revision,
    )
}
#[tauri::command]
pub async fn assistant_ask(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    conversation_id: String,
    question: String,
    parent_turn_id: Option<String>,
    regenerate_turn_id: Option<String>,
    request_id: String,
    expected_revision: i64,
    semantic: Option<bool>,
    retrieval_mode: Option<String>,
    memory_options: Option<memory::Options>,
) -> Result<assistant::Conversation, String> {
    let _busy = crate::begin_chat(&state, &request_id)?;
    let (ws, id) = context(&state)?;
    let options = memory_options.unwrap_or_default();
    if let Some(reference) = &options.history {
        if reference.digest.is_empty() {
            return Err("请先预览历史问题".into());
        }
        let c = assistant::get(&state.data_dir, &id, &conversation_id)?;
        memory::history(&state.data_dir, &id, c.scope.as_deref(), reference)?;
    }
    let generation = state.workspace_generation.load(Ordering::SeqCst);
    let started = assistant::begin_with_mode(
        &state.data_dir,
        &id,
        &conversation_id,
        expected_revision,
        &question,
        parent_turn_id.as_deref(),
        regenerate_turn_id.as_deref(),
        &request_id,
        retrieval_mode
            .as_deref()
            .unwrap_or(if semantic == Some(false) {
                "keyword"
            } else {
                "hybrid"
            }),
    )?;
    // Acknowledgement follows durable acceptance. UI retains the input on all
    // failures before begin; a dropped event falls back to the final response.
    let _ = app.emit(
        "assistant-accepted",
        serde_json::json!({"requestId":request_id}),
    );
    let prepared = assistant::grounding::prepare(&state.data_dir, &ws, &started);
    let result = match prepared {
        Ok(prepared) if prepared.clarification.is_some() => Ok(ChatResponse {
            memory: None,
            finish_reason: "no_evidence".into(),
            text: prepared.clarification.unwrap_or_default(),
            sources: vec![],
            warning: Some("追问需要明确当前对象或指标，未调用模型。".into()),
            retrieval_mode: "none".into(),
            rerank_status: "not-requested".into(),
            model: String::new(),
            scope: started.scope.clone(),
            chart_warnings: vec![],
            rejected_charts: vec![],
        }),
        Ok(prepared) => match scope_label(&state, &ws, started.scope.as_deref()) {
            Ok(_) => {
                crate::ask_pipeline(
                    &app,
                    &state,
                    &prepared.retrieval_question,
                    &started.prompt_question,
                    started.scope.clone(),
                    &request_id,
                    semantic,
                    retrieval_mode,
                    prepared.gate.as_ref(),
                    Some(memory::Run {
                        workspace: id.clone(),
                        options,
                    }),
                )
                .await
            }
            Err(e) => Err(e),
        },
        Err(e) => Err(e),
    };
    let changed = generation != state.workspace_generation.load(Ordering::SeqCst);
    let result = if changed {
        Err("资料空间已变化，已撤回本轮生成结果".into())
    } else {
        result
    };
    let result = assistant::finish(
        &state.data_dir,
        &id,
        &started,
        result.as_ref().map_err(String::as_str),
        state.cancel_chat.load(Ordering::SeqCst),
    );
    if changed {
        return Err("资料空间已变化，请在当前空间继续问答".into());
    }
    result
}
