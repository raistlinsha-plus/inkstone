use crate::{companion, models::Workspace, workspace, AppState};
use std::path::PathBuf;
use tauri::State;
fn current(state: &AppState, root: &str) -> Result<Workspace, String> {
    let ws = workspace(state)?;
    if ws.root != PathBuf::from(root) {
        return Err("工作空间已变化，请重新打开同伴功能".into());
    }
    Ok(ws)
}
#[tauri::command]
pub fn companion_state(state: State<'_, AppState>) -> Result<companion::Snapshot, String> {
    companion::state(&state.data_dir)
}
#[tauri::command]
pub fn companion_settings(
    state: State<'_, AppState>,
    input: companion::SettingsInput,
) -> Result<companion::Snapshot, String> {
    companion::settings(&state.data_dir, input)
}
#[tauri::command]
pub fn companion_preview(
    state: State<'_, AppState>,
    path: String,
    workspace_root: String,
) -> Result<companion::Preview, String> {
    let ws = current(&state, &workspace_root)?;
    companion::preview(&state.data_dir, &ws, &path)
}
#[tauri::command]
pub fn companion_confirm(
    state: State<'_, AppState>,
    input: companion::ConfirmInput,
    workspace_root: String,
) -> Result<companion::ConfirmResult, String> {
    let ws = current(&state, &workspace_root)?;
    companion::confirm(&state.data_dir, &ws, input)
}
#[tauri::command]
pub fn companion_story(
    state: State<'_, AppState>,
    input: companion::StoryInput,
) -> Result<companion::Snapshot, String> {
    companion::complete_story(&state.data_dir, input)
}
#[tauri::command]
pub fn companion_card(
    state: State<'_, AppState>,
    input: companion::CardInput,
) -> Result<companion::Snapshot, String> {
    companion::mutate_card(&state.data_dir, input)
}
#[tauri::command]
pub fn companion_preference(
    state: State<'_, AppState>,
    input: companion::PreferenceInput,
) -> Result<companion::Snapshot, String> {
    let ws = workspace(&state).ok();
    companion::mutate_preference(&state.data_dir, ws.as_ref(), input)
}
#[tauri::command]
pub fn companion_reset(
    state: State<'_, AppState>,
    context: companion::Context,
) -> Result<companion::Snapshot, String> {
    companion::reset(&state.data_dir, context)
}
#[tauri::command]
pub fn companion_export(state: State<'_, AppState>) -> Result<String, String> {
    companion::export(&state.data_dir)
}

#[tauri::command]
pub async fn companion_recall(
    state: State<'_, AppState>,
    workspace_root: String,
    journal: bool,
) -> Result<companion::Recall, String> {
    let ws = current(&state, &workspace_root)?;
    let data = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || companion::recall(&data, &ws, journal))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn companion_recall_setting(
    state: State<'_, AppState>,
    context: companion::Context,
    enabled: bool,
) -> Result<companion::Snapshot, String> {
    companion::recall_setting(&state.data_dir, context, enabled)
}

#[tauri::command]
pub async fn companion_recall_source(
    state: State<'_, AppState>,
    workspace_root: String,
    card_id: String,
) -> Result<String, String> {
    let ws = current(&state, &workspace_root)?;
    let data = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || companion::recall_source(&data, &ws, &card_id))
        .await
        .map_err(|error| error.to_string())?
}
