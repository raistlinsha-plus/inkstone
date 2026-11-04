mod answer_validation;
mod assistant;
mod assistant_commands;
mod calendar;
mod calendar_commands;
mod companion;
mod companion_commands;
mod credentials;
mod db;
#[cfg(feature = "desktop-e2e")]
mod desktop_test;
mod documents;
#[cfg(test)]
mod eval_trace;
#[cfg(test)]
mod evaluation;
#[cfg(test)]
mod evaluation_v062;
#[cfg(test)]
mod evaluation_v065;
#[cfg(test)]
mod evaluation_v066;
#[cfg(test)]
mod evaluation_v07;
mod evidence;
mod files;
mod library;
mod library_commands;
mod maintenance;
mod models;
mod providers;
mod retrieval;
mod workbench;

use models::*;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use tauri::{Emitter, Manager, State};

struct AppState {
    credentials: credentials::CredentialReader,
    workspace: Mutex<Option<Workspace>>,
    workspace_generation: AtomicU64,
    settings: Mutex<Settings>,
    settings_write: Mutex<()>,
    legacy_key_origins: HashMap<String, String>,
    last_workspace: Mutex<Option<String>>,
    job: Mutex<Option<Job>>,
    import_busy: Arc<AtomicBool>,
    import_cancel: Arc<AtomicBool>,
    cancel_index: AtomicBool,
    indexing_path: Mutex<Option<(String, String)>>,
    cancel_chat: AtomicBool,
    provider_test: Mutex<Option<Arc<AtomicBool>>>,
    search_request: Mutex<Option<(String, Arc<AtomicBool>)>>,
    chat_request: Mutex<Option<String>>,
    chat_busy: AtomicBool,
    allow_quit: AtomicBool,
    data_dir: PathBuf,
    config_file: PathBuf,
    client: reqwest::Client,
}
#[derive(Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct SavedConfig {
    settings: Settings,
    last_workspace: Option<String>,
    legacy_key_origins: Option<HashMap<String, String>>,
}
fn decode_saved_config(bytes: &[u8]) -> Option<(SavedConfig, HashMap<String, String>)> {
    let raw: serde_json::Value = serde_json::from_slice(bytes).ok()?;
    let config: SavedConfig = serde_json::from_value(raw.clone()).ok()?;
    let origins = config.legacy_key_origins.clone().unwrap_or_else(|| {
        let mut origins = HashMap::new();
        // Only explicit addresses from a decoded saved file may bind legacy role-only keys.
        for (kind, field) in [
            ("embedding", "baseUrl"),
            ("chat", "baseUrl"),
            ("rerank", "endpoint"),
        ] {
            if let Some(address) = raw
                .get("settings")
                .and_then(|s| s.get(kind))
                .and_then(|s| s.get(field))
                .and_then(serde_json::Value::as_str)
                .filter(|s| !s.trim().is_empty())
            {
                let valid = match kind {
                    "embedding" => providers::validate(&config.settings.embedding),
                    "chat" => providers::validate(&config.settings.chat),
                    _ => providers::validate_reranker(&config.settings.rerank),
                };
                if valid.is_ok() {
                    origins.insert(kind.to_string(), providers::credential_origin(address));
                }
            }
        }
        origins
    });
    Some((config, origins))
}
fn legacy_key_allowed(state: &AppState, kind: &str, address: &str) -> bool {
    state
        .legacy_key_origins
        .get(kind)
        .is_some_and(|origin| origin == &providers::credential_origin(address))
}
fn validate_explicit_key_clear(key: Option<&str>, clear: bool, label: &str) -> Result<(), String> {
    if clear && key.is_some_and(|s| !s.trim().is_empty()) {
        return Err(format!("删除{}密钥时不能同时输入新密钥", label));
    }
    Ok(())
}
fn should_read_test_key(
    typed_key: Option<&str>,
    skip_stored: bool,
    saved: &str,
    requested: &str,
) -> bool {
    !skip_stored && !typed_key.is_some_and(|s| !s.trim().is_empty()) && saved == requested
}
fn rerank_test_reuse_source(
    stored: &Settings,
    endpoint: &str,
    typed_key: Option<&str>,
    source: Option<&str>,
    skip_stored: bool,
) -> Result<Option<(String, String)>, String> {
    if skip_stored && source.is_some_and(|s| !s.trim().is_empty()) {
        return Err("已选择不使用已保存密钥，不能同时复用来源密钥".into());
    }
    rerank_reuse_source(stored, endpoint, typed_key, source, false, false, false)
}
fn rerank_reuse_source(
    stored: &Settings,
    endpoint: &str,
    typed_key: Option<&str>,
    source: Option<&str>,
    clear_target: bool,
    clear_embedding: bool,
    clear_chat: bool,
) -> Result<Option<(String, String)>, String> {
    let typed = typed_key.is_some_and(|s| !s.trim().is_empty());
    let source = source.filter(|s| !s.trim().is_empty());
    if clear_target && (typed || source.is_some()) {
        return Err("删除重排密钥时不能同时输入或复用密钥".into());
    }
    // An explicitly entered target key takes precedence over any stale reuse selection.
    if typed {
        return Ok(None);
    }
    let Some(role) = source else {
        return Ok(None);
    };
    if (role == "embedding" && clear_embedding) || (role == "chat" && clear_chat) {
        return Err("已选择删除来源密钥，不能同时复用".into());
    }
    Ok(Some((
        role.to_string(),
        providers::key_reuse_address(stored, role, endpoint)?,
    )))
}
fn managed_sources(
    data: &std::path::Path,
    ws: &Workspace,
) -> Result<Option<HashMap<String, (String, String)>>, String> {
    let parent = library::base(data).join("projects");
    let parent = parent.canonicalize().unwrap_or(parent);
    if ws.root.parent() != Some(parent.as_path()) {
        if ws.root.starts_with(&parent) {
            return Err("请选择文档空间，不可将其内部目录作为外部资料扫描".into());
        }
        return Ok(None);
    }
    let id = ws
        .root
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or("文档库项目路径无效")?;
    let view = library::list(data).map_err(|_| "文档库状态暂不可核对，请稍后重试")?;
    if !view.projects.iter().any(|p| p.id == id) {
        return Err("文档库项目已移除，未使用旧索引".into());
    }
    Ok(Some(
        view.documents
            .into_iter()
            .filter(|d| d.project_id == id && d.status == "ready")
            .map(|d| (d.path, (d.id, d.title)))
            .collect(),
    ))
}
fn sources_current(state: &AppState, ws: &Workspace, sources: &[SearchResult]) -> bool {
    if !retrieval::source_versions_current(ws, sources) {
        return false;
    }
    match managed_sources(&state.data_dir, ws) {
        Ok(Some(documents)) => sources.iter().all(|s| {
            documents
                .get(&s.path)
                .is_some_and(|(id, _)| s.document_id.as_ref() == Some(id))
        }),
        Ok(None) => sources.iter().all(|s| s.document_id.is_none()),
        Err(_) => false,
    }
}
#[cfg(test)]
mod config_credential_tests {
    use super::*;
    #[test]
    fn legacy_origins_require_a_decoded_file_with_explicit_saved_addresses() {
        assert!(decode_saved_config(b"{broken").is_none());
        assert!(decode_saved_config(b"{}").unwrap().1.is_empty());
        let (_, origins) = decode_saved_config(
            br#"{"settings":{"embedding":{"baseUrl":"https://a.example/v1"}}}"#,
        )
        .unwrap();
        assert_eq!(
            origins.get("embedding"),
            Some(&providers::credential_origin("https://a.example/v1"))
        );
        assert!(!origins.contains_key("chat"));
        let (config, preserved) = decode_saved_config(br#"{"settings":{"embedding":{"baseUrl":"https://b.example/v1"}},"legacyKeyOrigins":{"embedding":"old-binding"}}"#).unwrap();
        assert_eq!(config.settings.embedding.base_url, "https://b.example/v1");
        assert_eq!(
            preserved.get("embedding").map(String::as_str),
            Some("old-binding")
        );
    }
    #[test]
    fn rerank_reuse_is_opt_in_typed_key_wins_and_delete_flags_fail_closed() {
        let mut s = Settings::default();
        s.embedding.base_url = "https://aihubmix.com/v1".into();
        s.chat.base_url = "https://aihubmix.com/chat".into();
        let target = "https://aihubmix.com/v1/rerank";
        assert!(
            rerank_reuse_source(&s, target, None, None, false, false, false)
                .unwrap()
                .is_none()
        );
        assert_eq!(
            rerank_reuse_source(&s, target, None, Some("embedding"), false, false, false).unwrap(),
            Some(("embedding".into(), s.embedding.base_url.clone()))
        );
        assert!(rerank_reuse_source(
            &s,
            target,
            Some("typed-target-key"),
            Some("invalid-stale-source"),
            false,
            true,
            true
        )
        .unwrap()
        .is_none());
        for (typed, source, target_clear, embedding_clear, chat_clear) in [
            (None, Some("embedding"), true, false, false),
            (Some("typed"), None, true, false, false),
            (None, Some("embedding"), false, true, false),
            (None, Some("chat"), false, false, true),
        ] {
            assert!(rerank_reuse_source(
                &s,
                target,
                typed,
                source,
                target_clear,
                embedding_clear,
                chat_clear
            )
            .is_err());
        }
        assert!(rerank_reuse_source(
            &s,
            "https://other.example/rerank",
            None,
            Some("embedding"),
            false,
            false,
            false
        )
        .is_err());
    }
    #[test]
    fn pending_delete_blocks_stored_test_keys_and_any_explicit_reuse() {
        let saved = "https://aihubmix.com/v1";
        assert!(should_read_test_key(None, false, saved, saved));
        assert!(!should_read_test_key(None, true, saved, saved));
        assert!(!should_read_test_key(
            Some("typed-test-key"),
            false,
            saved,
            saved
        ));
        assert!(!should_read_test_key(
            None,
            false,
            saved,
            "https://other.example/v1"
        ));
        let mut s = Settings::default();
        s.embedding.base_url = saved.into();
        assert!(rerank_test_reuse_source(
            &s,
            "https://aihubmix.com/v1/rerank",
            None,
            Some("embedding"),
            true
        )
        .is_err());
        assert!(rerank_test_reuse_source(
            &s,
            "https://aihubmix.com/v1/rerank",
            Some("typed"),
            Some("embedding"),
            true
        )
        .is_err());
        assert!(
            rerank_test_reuse_source(&s, "https://aihubmix.com/v1/rerank", None, None, true)
                .unwrap()
                .is_none()
        );
    }
    #[test]
    fn explicit_role_delete_and_typed_key_are_rejected_before_any_keychain_work() {
        for label in ["向量", "问答", "重排"] {
            assert!(validate_explicit_key_clear(Some("typed-key"), true, label).is_err());
            assert!(validate_explicit_key_clear(Some("typed-key"), false, label).is_ok());
            assert!(validate_explicit_key_clear(Some("  "), true, label).is_ok());
        }
    }
    #[test]
    fn managed_catalogue_errors_never_reclassify_project_files_as_external() {
        let data = tempfile::tempdir().unwrap();
        let doc = library::create_document(data.path(), "inbox", "资料.md", "本地资料").unwrap();
        let ws = Workspace {
            root: library::project_root(data.path(), "inbox").unwrap(),
            db: data.path().join("index"),
        };
        assert!(managed_sources(data.path(), &ws)
            .unwrap()
            .unwrap()
            .contains_key(&doc.path));
        library::trash(data.path(), &doc.id, false).unwrap();
        assert!(managed_sources(data.path(), &ws)
            .unwrap()
            .unwrap()
            .is_empty());
        let c =
            rusqlite::Connection::open(library::base(data.path()).join("catalog.sqlite3")).unwrap();
        c.pragma_update(None, "user_version", 99).unwrap();
        assert!(managed_sources(data.path(), &ws).is_err());
    }
}
fn workspace(state: &AppState) -> Result<Workspace, String> {
    state
        .workspace
        .lock()
        .map_err(|_| "内部状态不可用")?
        .clone()
        .ok_or("请先打开一个本地目录".into())
}
fn settings(state: &AppState) -> Result<Settings, String> {
    Ok(state.settings.lock().map_err(|_| "内部状态不可用")?.clone())
}
fn persist(state: &AppState) -> Result<(), String> {
    let config = SavedConfig {
        settings: settings(state)?,
        legacy_key_origins: Some(state.legacy_key_origins.clone()),
        last_workspace: state
            .last_workspace
            .lock()
            .map_err(|_| "内部状态不可用")?
            .clone(),
    };
    files::write_atomic(
        &state.config_file,
        &serde_json::to_vec_pretty(&config).map_err(|e| e.to_string())?,
    )
}
fn check_idle(state: &AppState) -> Result<(), String> {
    if state.import_busy.load(Ordering::SeqCst) {
        return Err("请先完成或停止导入".into());
    }
    if state.job.lock().map_err(|_| "内部状态不可用")?.is_some()
        || state.chat_busy.load(Ordering::SeqCst)
    {
        return Err("请先停止正在进行的建库或问答".into());
    }
    Ok(())
}
fn validate_job(state: &AppState, id: &str, ws: &Workspace, profile: &str) -> Result<(), String> {
    if state.cancel_index.load(Ordering::SeqCst) {
        return Err("建库已取消".into());
    }
    let lock = state.job.lock().map_err(|_| "内部状态不可用")?;
    if lock
        .as_ref()
        .is_none_or(|j| j.id != id || j.root != ws.root || j.profile != profile)
    {
        return Err("建库任务已失效，请重新开始".into());
    }
    Ok(())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Bootstrap {
    settings: SettingsView,
    last_workspace: Option<String>,
    data_dir: String,
}
#[tauri::command]
async fn bootstrap(state: State<'_, AppState>) -> Result<Bootstrap, String> {
    #[cfg(feature = "desktop-e2e")]
    desktop_test::record_bootstrap(&state.data_dir)?;
    Ok(Bootstrap {
        settings: get_settings(state.clone()).await?,
        last_workspace: state
            .last_workspace
            .lock()
            .map_err(|_| "内部状态不可用")?
            .clone(),
        data_dir: state.data_dir.display().to_string(),
    })
}
#[tauri::command]
async fn get_settings(state: State<'_, AppState>) -> Result<SettingsView, String> {
    let s = settings(&state)?;
    let embedding = providers::has_key_for(
        "embedding",
        &s.embedding.base_url,
        legacy_key_allowed(&state, "embedding", &s.embedding.base_url),
    );
    let chat = providers::has_key_for(
        "chat",
        &s.chat.base_url,
        legacy_key_allowed(&state, "chat", &s.chat.base_url),
    );
    let rerank = providers::has_key_for(
        "rerank",
        &s.rerank.endpoint,
        legacy_key_allowed(&state, "rerank", &s.rerank.endpoint),
    );
    let key_warning = if state.credentials.pending() {
        Some(credentials::PENDING.into())
    } else if embedding.is_err() || chat.is_err() || (s.rerank.enabled && rerank.is_err()) {
        Some("钥匙串暂不可用，本地编辑和关键词检索不受影响。请在设置中重试。".into())
    } else {
        None
    };
    Ok(SettingsView {
        embedding: s.embedding,
        chat: s.chat,
        rerank: s.rerank,
        has_embedding_key: embedding.unwrap_or(false),
        has_chat_key: chat.unwrap_or(false),
        has_rerank_key: rerank.unwrap_or(false),
        key_warning,
    })
}
#[tauri::command]
async fn save_settings(
    state: State<'_, AppState>,
    value: Settings,
    embedding_key: Option<String>,
    chat_key: Option<String>,
    clear_embedding_key: bool,
    clear_chat_key: bool,
    rerank_key: Option<String>,
    clear_rerank_key: Option<bool>,
    reuse_rerank_key_from: Option<String>,
) -> Result<SettingsView, String> {
    validate_explicit_key_clear(embedding_key.as_deref(), clear_embedding_key, "向量")?;
    validate_explicit_key_clear(chat_key.as_deref(), clear_chat_key, "问答")?;
    validate_explicit_key_clear(
        rerank_key.as_deref(),
        clear_rerank_key.unwrap_or(false),
        "重排",
    )?;
    check_idle(&state)?;
    providers::validate(&value.embedding)?;
    providers::validate(&value.chat)?;
    providers::validate_reranker(&value.rerank)?;
    let reuse = rerank_reuse_source(
        &settings(&state)?,
        &value.rerank.endpoint,
        rerank_key.as_deref(),
        reuse_rerank_key_from.as_deref(),
        clear_rerank_key.unwrap_or(false),
        clear_embedding_key,
        clear_chat_key,
    )?;
    let reused = if let Some((role, address)) = reuse {
        let cancel = AtomicBool::new(false);
        let key = read_key(&state, &role, &address, &cancel)
            .await?
            .ok_or("来源服务尚未保存可用密钥，请先配置来源服务")?;
        Some((role, address, key))
    } else {
        None
    };
    {
        let _write = state
            .settings_write
            .lock()
            .map_err(|_| "模型设置保存状态不可用")?;
        check_idle(&state)?;
        providers::validate(&value.embedding)?;
        providers::validate(&value.chat)?;
        providers::validate_reranker(&value.rerank)?;
        let old = settings(&state)?;
        if let Some((role, address, _)) = &reused {
            if providers::key_reuse_address(&old, role, &value.rerank.endpoint)? != *address {
                return Err("来源服务配置已变化，请重新选择复用来源".into());
            }
        }
        // Persist legacy bindings before any credential mutation; restart must preserve their original address.
        persist(&state)?;
        if clear_embedding_key
            || clear_chat_key
            || clear_rerank_key.unwrap_or(false)
            || old.embedding.base_url != value.embedding.base_url
            || old.chat.base_url != value.chat.base_url
            || old.rerank.endpoint != value.rerank.endpoint
            || embedding_key.as_ref().is_some_and(|s| !s.trim().is_empty())
            || chat_key.as_ref().is_some_and(|s| !s.trim().is_empty())
            || rerank_key.as_ref().is_some_and(|s| !s.trim().is_empty())
            || reused.is_some()
        {
            let pending = state.credentials.pending();
            state.credentials.invalidate();
            if pending {
                return Err(
                    "仍有钥匙串读取等待系统授权；请完成或取消系统弹窗后再保存密钥设置。".into(),
                );
            }
        }
        providers::set_key_for(
            "embedding",
            &value.embedding.base_url,
            embedding_key.as_deref(),
            clear_embedding_key || old.embedding.base_url != value.embedding.base_url,
        )?;
        providers::set_key_for(
            "chat",
            &value.chat.base_url,
            chat_key.as_deref(),
            clear_chat_key || old.chat.base_url != value.chat.base_url,
        )?;
        providers::set_key_for(
            "rerank",
            &value.rerank.endpoint,
            rerank_key
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .or_else(|| reused.as_ref().map(|(_, _, key)| key.as_str())),
            clear_rerank_key.unwrap_or(false) || old.rerank.endpoint != value.rerank.endpoint,
        )?;
        *state.settings.lock().map_err(|_| "内部状态不可用")? = value;
        if let Err(error) = persist(&state) {
            *state.settings.lock().map_err(|_| "内部状态不可用")? = old;
            return Err(error);
        }
    }
    get_settings(state).await
}

async fn read_key(
    state: &AppState,
    kind: &str,
    address: &str,
    cancel: &AtomicBool,
) -> Result<Option<String>, String> {
    let allow_legacy = legacy_key_allowed(state, kind, address);
    let identity = credentials::Identity::new(kind, address, allow_legacy);
    let kind = kind.to_string();
    let address = address.to_string();
    state
        .credentials
        .read(identity, cancel, move || {
            providers::key_for(&kind, &address, allow_legacy)
        })
        .await
}
#[tauri::command]
fn cancel_provider_test(state: State<'_, AppState>) {
    if let Ok(lock) = state.provider_test.lock() {
        if let Some(token) = lock.as_ref() {
            token.store(true, Ordering::SeqCst);
        }
    }
}
#[tauri::command]
async fn test_provider(
    state: State<'_, AppState>,
    kind: String,
    provider: Provider,
    key: Option<String>,
    skip_stored_key: Option<bool>,
) -> Result<String, String> {
    providers::validate(&provider)?;
    if !matches!(kind.as_str(), "embedding" | "chat") {
        return Err("未知模型服务".into());
    }
    let cancel = Arc::new(AtomicBool::new(false));
    if let Some(old) = state
        .provider_test
        .lock()
        .map_err(|_| "内部状态不可用")?
        .replace(cancel.clone())
    {
        old.store(true, Ordering::SeqCst);
    }
    let stored = settings(&state)?;
    let old = if kind == "embedding" {
        stored.embedding
    } else {
        stored.chat
    };
    let key = if key.as_ref().is_some_and(|k| !k.trim().is_empty()) {
        key.map(|k| k.trim().to_string())
    } else if should_read_test_key(
        key.as_deref(),
        skip_stored_key.unwrap_or(false),
        &old.base_url,
        &provider.base_url,
    ) {
        read_key(&state, &kind, &provider.base_url, &cancel).await?
    } else {
        None
    };
    if kind == "embedding" {
        let result = providers::embed(
            &state.client,
            &provider,
            key.as_deref(),
            &["测试：本地知识库".into()],
            &cancel,
        )
        .await?;
        Ok(format!("连接成功，返回 {} 维向量", result[0].len()))
    } else {
        let source = SearchResult {
            id: 0,
            path: "连接测试.md".into(),
            text: "测试结果：服务已连接。".into(),
            heading: "测试".into(),
            start_line: 1,
            end_line: 1,
            hash: String::new(),
            score: 0.0,
            title: None,
            document_id: None,
            bm25_score: None,
            vector_distance: None,
            bm25_rank: None,
            vector_rank: None,
            rerank_score: None,
            evidence: true,
            match_kind: "keyword".into(),
        };
        providers::chat(
            &state.client,
            &provider,
            key.as_deref(),
            "请简短确认测试结果",
            &[source],
            &cancel,
            None,
            "",
        )
        .await?;
        Ok("连接成功，已收到回答文本".into())
    }
}
#[tauri::command]
async fn test_reranker(
    state: State<'_, AppState>,
    provider: RerankProvider,
    key: Option<String>,
    reuse_key_from: Option<String>,
    skip_stored_key: Option<bool>,
) -> Result<String, String> {
    let mut provider = provider;
    provider.enabled = true;
    providers::validate_reranker(&provider)?;
    let cancel = Arc::new(AtomicBool::new(false));
    if let Some(old) = state
        .provider_test
        .lock()
        .map_err(|_| "内部状态不可用")?
        .replace(cancel.clone())
    {
        old.store(true, Ordering::SeqCst);
    }
    let stored = settings(&state)?;
    let reuse = rerank_test_reuse_source(
        &stored,
        &provider.endpoint,
        key.as_deref(),
        reuse_key_from.as_deref(),
        skip_stored_key.unwrap_or(false),
    )?;
    let operation = async {
        let key = if key.as_ref().is_some_and(|k| !k.trim().is_empty()) {
            key.map(|s| s.trim().to_string())
        } else if let Some((role, address)) = reuse {
            Some(
                read_key(&state, &role, &address, &cancel)
                    .await?
                    .ok_or("来源服务尚未保存可用密钥")?,
            )
        } else if should_read_test_key(
            key.as_deref(),
            skip_stored_key.unwrap_or(false),
            &stored.rerank.endpoint,
            &provider.endpoint,
        ) {
            read_key(&state, "rerank", &provider.endpoint, &cancel).await?
        } else {
            None
        };
        let mut docs = vec![
            "本地文档保存在自己的电脑上，支持关键词检索。".into(),
            "香蕉是一种水果。".into(),
        ];
        docs.truncate(provider.candidate_count.min(2));
        let result = providers::rerank(
            &state.client,
            &provider,
            key.as_deref(),
            "本地文档如何检索",
            &docs,
            &cancel,
        )
        .await?;
        Ok::<_, String>(format!(
            "连接成功，返回 {} 个有效重排结果；请用自己的资料校准分数门槛。",
            result.len()
        ))
    };
    tokio::time::timeout(
        std::time::Duration::from_millis(provider.timeout_ms),
        operation,
    )
    .await
    .map_err(|_| "重排连接测试超时，可调整超时后重试".to_string())?
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceView {
    root: String,
    name: String,
    files: Vec<FileEntry>,
    stats: Stats,
    warning: Option<String>,
    managed_project_id: Option<String>,
}
#[tauri::command]
async fn open_workspace(state: State<'_, AppState>, root: String) -> Result<WorkspaceView, String> {
    #[cfg(feature = "desktop-e2e")]
    desktop_test::workspace(&state.data_dir, std::path::Path::new(&root))?;
    check_idle(&state)?;
    let generation = state.workspace_generation.fetch_add(1, Ordering::SeqCst) + 1;
    let root = PathBuf::from(root)
        .canonicalize()
        .map_err(|_| "无法打开目录，请重新选择")?;
    if !root.is_dir() {
        return Err("请选择一个文件夹".into());
    }
    let tree = if let Some(id) = library::project_at_root(&state.data_dir, &root) {
        library::flat_tree(&state.data_dir, &id)?
    } else {
        files::list_tree(&root)?
    };
    let db_dir = state.data_dir.join("workspaces");
    fs::create_dir_all(&db_dir).map_err(|e| e.to_string())?;
    let ws = Workspace {
        db: db_dir.join(format!(
            "{}.sqlite3",
            files::hash(root.to_string_lossy().as_bytes())
        )),
        root,
    };
    let profile = providers::fingerprint(&settings(&state)?.embedding);
    let (stats, warning) = match db::open(&ws.db) {
        Ok(conn) => (db::stats(&conn, &profile), None),
        Err(_) => (
            Stats {
                documents: 0,
                keyword_documents: 0,
                vector_documents: 0,
                total_documents: None,
                chunks: 0,
                vectors: 0,
                embedding_ready: false,
            },
            Some("知识索引暂不可用，本地文件仍可编辑。请稍后重建索引。".into()),
        ),
    };
    let mut result = WorkspaceView {
        root: ws.root.display().to_string(),
        managed_project_id: library::project_at_root(&state.data_dir, &ws.root),
        name: ws
            .root
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        files: tree,
        stats,
        warning,
    };
    if let Some(id) = &result.managed_project_id {
        result.name = library::project_title(&state.data_dir, id)?;
    }
    let mut selected_workspace = state.workspace.lock().map_err(|_| "内部状态不可用")?;
    if state.workspace_generation.load(Ordering::SeqCst) != generation {
        return Err("目录请求已被新的选择取代".into());
    }
    *state.last_workspace.lock().map_err(|_| "内部状态不可用")? = Some(result.root.clone());
    *selected_workspace = Some(ws);
    persist(&state)?;
    Ok(result)
}
#[tauri::command]
async fn list_files(state: State<'_, AppState>) -> Result<Vec<FileEntry>, String> {
    let ws = workspace(&state)?;
    if let Some(id) = library::project_at_root(&state.data_dir, &ws.root) {
        library::flat_tree(&state.data_dir, &id)
    } else {
        files::list_tree(&ws.root)
    }
}
#[tauri::command]
async fn read_file(state: State<'_, AppState>, path: String) -> Result<FileData, String> {
    let ws = workspace(&state)?;
    if library::project_at_root(&state.data_dir, &ws.root).is_some()
        && library::title_for(&state.data_dir, &ws.root, &path).is_none()
    {
        return Err("文档已移到回收站或未完成导入，请在文档库恢复后打开。".into());
    }
    let result = documents::read(&ws, &state.data_dir, &path)?;
    library::touch(&state.data_dir, &ws.root, &path);
    Ok(result)
}
#[tauri::command]
async fn file_hash(state: State<'_, AppState>, path: String) -> Result<String, String> {
    let ws = workspace(&state)?;
    Ok(files::hash(files::read_text(&files::resolve(
        &ws.root, &path, false,
    )?)?))
}
#[tauri::command]
async fn resolve_image(
    state: State<'_, AppState>,
    document_path: String,
    url: String,
) -> Result<String, String> {
    let ws = workspace(&state)?;
    let document = files::resolve(&ws.root, &document_path, false)?;
    if url.contains("://") || url.starts_with("data:") || url.starts_with('/') {
        return Err("仅预览工作区内的相对路径图片".into());
    }
    let path = document
        .parent()
        .ok_or("文件路径无效")?
        .join(url)
        .canonicalize()
        .map_err(|_| "图片不存在")?;
    if !path.starts_with(&ws.root)
        || !matches!(
            path.extension()
                .and_then(|s| s.to_str())
                .map(str::to_lowercase)
                .as_deref(),
            Some("png" | "jpg" | "jpeg" | "webp" | "gif")
        )
    {
        return Err("图片格式或路径不支持".into());
    }
    if fs::metadata(&path).map_err(|_| "无法读取图片")?.len() > 8 * 1024 * 1024 {
        return Err("图片超过 8 MB 预览上限".into());
    }
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("png")
        .to_lowercase();
    let mime = if ext == "jpg" || ext == "jpeg" {
        "jpeg"
    } else {
        ext.as_str()
    };
    use base64::Engine;
    Ok(format!(
        "data:image/{mime};base64,{}",
        base64::engine::general_purpose::STANDARD
            .encode(fs::read(path).map_err(|_| "无法读取图片")?)
    ))
}
#[tauri::command]
async fn save_file(
    state: State<'_, AppState>,
    path: String,
    content: String,
    expected_hash: String,
    workspace_root: String,
) -> Result<documents::SaveResult, String> {
    let ws = workspace(&state)?;
    if ws.root != PathBuf::from(workspace_root) {
        return Err("工作区已变化，未保存到其他目录。请重新打开文档。".into());
    }
    let mut result = documents::save(&ws, &state.data_dir, &path, &content, &expected_hash)?;
    if result.hash != expected_hash {
        if let Err(error) = companion::record_save(&state.data_dir, &ws, &path, &result.hash) {
            let warning = format!("正文已保存；同伴操作凭据暂未保存：{error}");
            result.warning = Some(
                result
                    .warning
                    .map(|prior| format!("{prior}\n{warning}"))
                    .unwrap_or(warning),
            );
        }
    }
    Ok(result)
}
#[tauri::command]
async fn save_draft(
    state: State<'_, AppState>,
    path: String,
    content: String,
    base_hash: String,
    workspace_root: String,
) -> Result<(), String> {
    let ws = workspace(&state)?;
    if ws.root != PathBuf::from(workspace_root) {
        return Err("工作区已变化，请保留当前编辑并另存。".into());
    }
    documents::draft(&ws, &state.data_dir, &path, content, base_hash)
}
#[tauri::command]
async fn discard_draft(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let ws = workspace(&state)?;
    let _permit = maintenance::mutation_scope(
        &state.data_dir,
        maintenance::is_managed_root(&state.data_dir, &ws.root),
    )?;
    let p = files::draft_path(&state.data_dir, &ws, &path);
    if p.exists() {
        fs::remove_file(p).map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
async fn create_file(
    state: State<'_, AppState>,
    path: String,
    content: Option<String>,
) -> Result<(), String> {
    let ws = workspace(&state)?;
    let _permit = maintenance::mutation_scope(
        &state.data_dir,
        maintenance::is_managed_root(&state.data_dir, &ws.root),
    )?;
    let p = files::resolve(&ws.root, &path, true)?;
    if !files::supported(&p) {
        return Err("文件名请使用 .md、.txt、.json 或 .mmd 后缀".into());
    }
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(p)
        .map_err(|_| "文件已存在或无法创建")?;
    use std::io::Write;
    file.write_all(content.unwrap_or_default().as_bytes())
        .map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
async fn rename_file(
    state: State<'_, AppState>,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    check_idle(&state)?;
    let ws = workspace(&state)?;
    let _permit = maintenance::mutation_scope(
        &state.data_dir,
        maintenance::is_managed_root(&state.data_dir, &ws.root),
    )?;
    let old = files::resolve(&ws.root, &old_path, false)?;
    let new = files::resolve(&ws.root, &new_path, true)?;
    if !files::supported(&new) || !old.is_file() {
        return Err("只能重命名受支持的文本文件".into());
    }
    if new.exists() {
        return Err("目标文件已存在".into());
    }
    fs::rename(old, new).map_err(|e| e.to_string())?;
    let _ = db::open_with_timeout(&ws.db, std::time::Duration::from_millis(80))
        .and_then(|conn| db::delete_document(&conn, &old_path));
    Ok(())
}
#[tauri::command]
async fn index_stats(state: State<'_, AppState>) -> Result<Stats, String> {
    let ws = workspace(&state)?;
    let mut stats = db::stats(
        &db::open(&ws.db)?,
        &providers::fingerprint(&settings(&state)?.embedding),
    );
    stats.total_documents = managed_sources(&state.data_dir, &ws)?.map(|documents| documents.len());
    Ok(stats)
}
#[tauri::command]
async fn workspace_index_status(
    state: State<'_, AppState>,
) -> Result<workbench::IndexStatusSnapshot, String> {
    let ws = workspace(&state)?;
    let config = settings(&state)?.embedding;
    let data = state.data_dir.clone();
    let active = state
        .indexing_path
        .lock()
        .map_err(|_| "索引状态不可用")?
        .clone();
    let active_path = active
        .filter(|(id, _)| {
            state
                .job
                .lock()
                .is_ok_and(|j| j.as_ref().is_some_and(|j| j.id == *id && j.root == ws.root))
        })
        .map(|(_, p)| p);
    tauri::async_runtime::spawn_blocking(move || {
        workbench::index_status(&data, &ws, &config, active_path.as_deref())
    })
    .await
    .map_err(|_| "索引核对未完成".to_string())?
}
#[tauri::command]
async fn workspace_pins(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    workbench::pins(&state.data_dir, &workspace(&state)?)
}
#[tauri::command]
async fn workspace_set_pin(
    state: State<'_, AppState>,
    id: String,
    pinned: bool,
) -> Result<(), String> {
    workbench::set_pin(&state.data_dir, &workspace(&state)?, &id, pinned)
}
#[tauri::command]
async fn library_create_backup(
    state: State<'_, AppState>,
    target: String,
) -> Result<maintenance::BackupReport, String> {
    check_idle(&state)?;
    let data = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        maintenance::create_backup(&data, &PathBuf::from(target))
    })
    .await
    .map_err(|_| "备份任务未完成".to_string())?
}
#[tauri::command]
async fn library_validate_backup(path: String) -> Result<maintenance::BackupValidation, String> {
    tauri::async_runtime::spawn_blocking(move || maintenance::validate_backup(&PathBuf::from(path)))
        .await
        .map_err(|_| "备份校验未完成".to_string())?
}
#[tauri::command]
async fn library_restore_backup(
    state: State<'_, AppState>,
    path: String,
    target: String,
) -> Result<maintenance::BackupReport, String> {
    let data = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        maintenance::restore_backup(&PathBuf::from(path), &PathBuf::from(target), &data)
    })
    .await
    .map_err(|_| "恢复预演未完成，当前资料库未切换".to_string())?
}
#[tauri::command]
async fn begin_index(
    state: State<'_, AppState>,
    scope: Option<String>,
) -> Result<IndexPlan, String> {
    check_idle(&state)?;
    let ws = workspace(&state)?;
    let managed = managed_sources(&state.data_dir, &ws)?.is_some();
    let _permit = maintenance::mutation_scope(&state.data_dir, managed)?;
    let config = settings(&state)?.embedding;
    providers::validate(&config)?;
    let profile = providers::fingerprint(&config);
    let (mut documents, warnings) = if managed {
        let id = ws
            .root
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or("空间身份无效")?;
        library::scan_documents(&state.data_dir, id, scope.as_deref())?
    } else {
        files::scan(&ws, scope.as_deref())?
    };
    if managed {
        documents.retain(|d| library::title_for(&state.data_dir, &ws.root, &d.path).is_some());
    }
    let conn = db::open(&ws.db)?;
    for path in db::paths(&conn)? {
        if files::resolve(&ws.root, &path, false).is_err()
            || (managed && library::title_for(&state.data_dir, &ws.root, &path).is_none())
        {
            db::delete_document(&conn, &path)?;
        }
    }
    let count = documents.len();
    let documents = documents
        .into_iter()
        .filter(|d| {
            !db::keyword_complete(&conn, &d.path, &d.hash)
                || !(if config.enabled {
                    db::vectors_complete(&conn, &d.path, &d.hash, &profile)
                } else {
                    db::indexed(&conn, &d.path, &d.hash, &profile)
                })
                || !db::chunk_manifest(&conn, &d.path)
                    .ok()
                    .flatten()
                    .is_some_and(|m| {
                        m.strategy == "structured" && m.version == 1 && m.source_hash == d.hash
                    })
        })
        .collect::<Vec<_>>();
    let skipped = count - documents.len();
    let id = uuid::Uuid::new_v4().to_string();
    state.cancel_index.store(false, Ordering::SeqCst);
    *state.job.lock().map_err(|_| "内部状态不可用")? = Some(Job {
        id: id.clone(),
        root: ws.root,
        profile,
    });
    Ok(IndexPlan {
        job_id: id,
        documents,
        skipped,
        warnings,
        max_chunk_chars: config.max_input_chars,
        remote: config.enabled
            && !config.base_url.contains("localhost")
            && !config.base_url.contains("127.0.0.1"),
    })
}
#[tauri::command]
async fn index_document(
    state: State<'_, AppState>,
    job_id: String,
    path: String,
    hash: String,
    chunks: Vec<ChunkInput>,
    manifest: Option<ChunkManifest>,
) -> Result<usize, String> {
    let ws = workspace(&state)?;
    let config = settings(&state)?.embedding;
    let profile = providers::fingerprint(&config);
    validate_job(&state, &job_id, &ws, &profile)?;
    let mut manifest = manifest.unwrap_or(ChunkManifest {
        strategy: "structured".into(),
        version: 1,
        source_hash: hash.clone(),
        embedding_profile: None,
    });
    if manifest.strategy != "structured"
        || manifest.version != 1
        || manifest.source_hash != hash
        || manifest
            .embedding_profile
            .as_ref()
            .is_some_and(|p| p != &profile)
    {
        return Err("切片清单与当前文档或模型不一致".into());
    }
    manifest.embedding_profile = Some(profile.clone());
    {
        let mut active = state.indexing_path.lock().map_err(|_| "索引状态不可用")?;
        if active.is_some() {
            return Err("已有文档正在处理，请等待或取消".into());
        }
        *active = Some((job_id.clone(), path.clone()));
    }
    let _active = ActiveIndexPath {
        state: &state,
        job_id: job_id.clone(),
        path: path.clone(),
    };
    if !record_index_attempt_if_current(&state, &job_id, &ws, &path, &hash, &profile, "processing")?
    {
        return Err("建库任务已失效，请重新开始".into());
    }
    let result = index_document_inner(
        state.clone(),
        job_id.clone(),
        path.clone(),
        hash.clone(),
        chunks,
        manifest,
    )
    .await;
    // The job mutex spans identity check and diagnostic write. An end/clear
    // racing a late response cannot resurrect an attempt in a cleared cache.
    let _ = record_index_attempt_if_current(
        &state,
        &job_id,
        &ws,
        &path,
        &hash,
        &profile,
        if result.is_ok() { "complete" } else { "failed" },
    );
    result
}
fn record_index_attempt_if_current(
    state: &AppState,
    job_id: &str,
    ws: &Workspace,
    path: &str,
    hash: &str,
    profile: &str,
    status: &str,
) -> Result<bool, String> {
    let job = state.job.lock().map_err(|_| "建库任务状态不可用")?;
    if !job
        .as_ref()
        .is_some_and(|j| j.id == job_id && j.root == ws.root && j.profile == profile)
    {
        return Ok(false);
    }
    db::record_attempt(&db::open(&ws.db)?, path, hash, profile, status)?;
    Ok(true)
}
struct ActiveIndexPath<'a> {
    state: &'a AppState,
    job_id: String,
    path: String,
}
impl Drop for ActiveIndexPath<'_> {
    fn drop(&mut self) {
        if let Ok(mut active) = self.state.indexing_path.lock() {
            if active.as_ref() == Some(&(self.job_id.clone(), self.path.clone())) {
                *active = None;
            }
        }
    }
}
async fn index_document_inner(
    state: State<'_, AppState>,
    job_id: String,
    path: String,
    hash: String,
    chunks: Vec<ChunkInput>,
    manifest: ChunkManifest,
) -> Result<usize, String> {
    let ws = workspace(&state)?;
    let config = settings(&state)?.embedding;
    let profile = providers::fingerprint(&config);
    validate_job(&state, &job_id, &ws, &profile)?;
    let file = files::resolve(&ws.root, &path, false)?;
    if chunks.len() > 6000
        || chunks.iter().any(|c| {
            c.text.chars().count() + c.heading.chars().count() + 2 > config.max_input_chars
                || c.start_line == 0
                || c.end_line < c.start_line
        })
    {
        return Err("切片长度或来源范围无效".into());
    }
    let ids = documents::with_write_lock(&file, || {
        validate_job(&state, &job_id, &ws, &profile)?;
        if files::hash(files::read_text(&file)?) != hash {
            return Err("文档已变化，请再次更新索引".into());
        }
        let mut conn = db::open(&ws.db)?;
        let ids = db::index_text(&mut conn, &path, &hash, &chunks)?;
        db::set_chunk_manifest(&conn, &path, &manifest)?;
        if let Some((_, title)) = library::title_for(&state.data_dir, &ws.root, &path) {
            db::update_title(&conn, &path, &title)?;
        }
        if !config.enabled || chunks.is_empty() {
            db::mark_plain(&conn, &path, &profile)?;
        }
        Ok(ids)
    })?;
    if !config.enabled || chunks.is_empty() {
        return Ok(ids.len());
    }
    let inputs = chunks
        .iter()
        .map(|c| format!("{}\n\n{}", c.heading, c.text))
        .collect::<Vec<_>>();
    let key = read_key(&state, "embedding", &config.base_url, &state.cancel_index).await?;
    let vectors = providers::embed(
        &state.client,
        &config,
        key.as_deref(),
        &inputs,
        &state.cancel_index,
    )
    .await?;
    documents::with_write_lock(&file, || {
        validate_job(&state, &job_id, &ws, &profile)?;
        if files::hash(files::read_text(&file)?) != hash {
            db::delete_document_if_hash(&mut db::open(&ws.db)?, &path, &hash)?;
            return Err("文档在处理期间变化，请再次更新索引".into());
        }
        let mut conn = db::open(&ws.db)?;
        db::put_vectors_checked(&mut conn, &path, &hash, &profile, &ids, &vectors)
    })?;
    Ok(ids.len())
}
#[tauri::command]
async fn end_index(state: State<'_, AppState>, job_id: String) -> Result<(), String> {
    let mut job = state.job.lock().map_err(|_| "内部状态不可用")?;
    if job.as_ref().is_some_and(|j| j.id == job_id) {
        *job = None;
    }
    Ok(())
}
#[tauri::command]
fn cancel_index(state: State<'_, AppState>) {
    state.cancel_index.store(true, Ordering::SeqCst);
}
#[tauri::command]
async fn clear_index(state: State<'_, AppState>) -> Result<(), String> {
    check_idle(&state)?;
    let ws = workspace(&state)?;
    let mut conn = db::open(&ws.db)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute_batch("DROP TABLE IF EXISTS vectors; DROP TABLE IF EXISTS chunk_fts; CREATE VIRTUAL TABLE chunk_fts USING fts5(title,heading,field_path,text); DELETE FROM chunks; DELETE FROM documents; DELETE FROM meta; DELETE FROM index_attempts;").map_err(|e|e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}
async fn search_inner(
    state: &AppState,
    query: &str,
    scope: Option<&str>,
    semantic: bool,
    requested_mode: Option<&str>,
    cancel: &AtomicBool,
    progress: Option<(&tauri::AppHandle, &str)>,
) -> Result<SearchResponse, String> {
    if query.trim().is_empty() || query.chars().count() > 1500 {
        return Err("请输入 1～1500 字符的查询内容".into());
    }
    let knowledge_query = retrieval::knowledge_query(query);
    let query_adjusted = knowledge_query.trim() != query.trim();
    let query = knowledge_query.as_str();
    let ws = workspace(state)?;
    let generation = state.workspace_generation.load(Ordering::SeqCst);
    if let Some(scope) = scope {
        files::resolve(&ws.root, scope, false)?;
    }
    let settings = settings(state)?;
    let plan = retrieval::query_plan(requested_mode, semantic, settings.rerank.enabled)?;
    let semantic = plan.semantic;
    let report = |stage: &str, detail: &str| {
        if let Some((app, request_id)) = progress {
            let _ = app.emit(
                "chat-status",
                ChatStatusEvent {
                    request_id: request_id.into(),
                    stage: stage.into(),
                    detail: detail.into(),
                },
            );
        }
    };
    report("keyword", "正在检索本地关键词");
    let config = settings.embedding;
    let profile = providers::fingerprint(&config);
    let catalogue = managed_sources(&state.data_dir, &ws)?;
    let (lexical, ready) = {
        let conn = db::open(&ws.db)?;
        if let Some(documents) = &catalogue {
            for (path, (_, title)) in documents {
                db::update_title(&conn, path, title)?;
            }
        }
        (
            db::lexical_scored(&conn, query, scope)?,
            db::stats(&conn, &profile).embedding_ready,
        )
    };
    let mut vectors = vec![];
    let mut warnings = vec![];
    if query_adjusted {
        warnings.push("已将输出格式要求与知识查询分离；生成仍使用完整问题。".into());
    }
    let mut used = false;
    if requested_mode == Some("rerank") && !settings.rerank.enabled {
        warnings.push("重排服务尚未启用，本次未执行重排。".into());
    }
    if semantic && config.enabled && ready {
        report("embedding", "正在获取语义向量并融合本地候选");
        let attempt = async {
            let key = read_key(state, "embedding", &config.base_url, cancel).await?;
            let vecs = providers::embed(
                &state.client,
                &config,
                key.as_deref(),
                &[query.into()],
                cancel,
            )
            .await?;
            let conn = db::open(&ws.db)?;
            if db::meta(&conn, "vector_dim").as_deref() != Some(&vecs[0].len().to_string()) {
                return Err("模型返回维度与知识库不符，请重建索引".to_string());
            }
            db::nearest_scored(&conn, &vecs[0], scope)
        };
        let (hits, semantic_used, warning) = retrieval::semantic_fallback(attempt, cancel).await?;
        vectors = hits;
        used = semantic_used;
        if let Some(warning) = warning {
            warnings.push(warning);
        }
    } else if semantic && config.enabled {
        warnings.push("当前模型尚无有效向量索引，请更新知识库；当前使用关键词。".into());
    } else if semantic {
        warnings.push("向量服务尚未启用，本次使用本地关键词。".into());
    }
    if cancel.load(Ordering::SeqCst) {
        return Err("操作已取消".into());
    }
    if workspace(state)?.root != ws.root
        || state.workspace_generation.load(Ordering::SeqCst) != generation
    {
        return Err("项目已切换，已忽略旧检索".into());
    }
    let mut results = db::merge_candidates(&db::open(&ws.db)?, &ws, &lexical, &vectors)?;
    if let Some(documents) = &catalogue {
        results.retain_mut(|r| {
            if let Some((id, title)) = documents.get(&r.path) {
                r.document_id = Some(id.clone());
                r.title = Some(title.clone());
                true
            } else {
                false
            }
        });
    }
    retrieval::mark_lexical_evidence(query, &mut results);
    let reranker = settings.rerank;
    let mut rerank_status = if plan.rerank {
        "no-candidates"
    } else if requested_mode.is_some() && requested_mode != Some("rerank") {
        "not-requested"
    } else {
        "disabled"
    }
    .to_string();
    if plan.rerank && !results.is_empty() {
        report("reranking", "正在重排候选并核对证据");
        let count = reranker.candidate_count.min(results.len());
        let documents = results[..count]
            .iter()
            .map(|r| {
                format!(
                    "{}
{}
{}",
                    r.title.as_deref().unwrap_or(""),
                    r.heading,
                    r.text
                )
            })
            .collect::<Vec<_>>();
        let operation = async {
            let key = read_key(state, "rerank", &reranker.endpoint, cancel).await?;
            providers::rerank(
                &state.client,
                &reranker,
                key.as_deref(),
                query,
                &documents,
                cancel,
            )
            .await
        };
        match tokio::time::timeout(
            std::time::Duration::from_millis(reranker.timeout_ms),
            operation,
        )
        .await
        {
            Ok(Ok(ranking)) => {
                retrieval::apply_rerank(&mut results, &ranking, reranker.min_score);
                rerank_status = "applied".into();
            }
            failure => {
                if cancel.load(Ordering::SeqCst) {
                    return Err("操作已取消".into());
                }
                let e = match failure {
                    Ok(Err(e)) => e,
                    _ => "重排超时".into(),
                };
                warnings.push(format!(
                    "{e}；{}",
                    if reranker.strict {
                        "严格模式不使用未通过重排筛选的证据"
                    } else {
                        "已保留关键词证据和融合候选"
                    }
                ));
                rerank_status = retrieval::rerank_failed(&mut results, reranker.strict).into();
            }
        }
    }
    if cancel.load(Ordering::SeqCst) {
        return Err("操作已取消".into());
    }
    if workspace(state)?.root != ws.root
        || state.workspace_generation.load(Ordering::SeqCst) != generation
    {
        return Err("项目已切换，已忽略旧检索".into());
    }
    report("validating", "正在核对资料版本与引用范围");
    let removed = retrieval::retain_current_sources(&ws, &mut results);
    if removed > 0 {
        warnings.push("部分资料在检索期间已更新或移除，已忽略旧版本，请重新检索。".into());
    }
    if let Some(documents) = managed_sources(&state.data_dir, &ws)? {
        let before = results.len();
        results.retain_mut(|s| {
            if let Some((_, title)) = documents
                .get(&s.path)
                .filter(|(id, _)| s.document_id.as_ref() == Some(id))
            {
                s.title = Some(title.clone());
                true
            } else {
                false
            }
        });
        if results.len() != before {
            warnings.push("部分来源已移入回收站或身份变化，已忽略旧结果。".into());
        }
    }
    let candidate_count = results.len();
    if cancel.load(Ordering::SeqCst) {
        return Err("操作已取消".into());
    }
    if workspace(state)?.root != ws.root
        || state.workspace_generation.load(Ordering::SeqCst) != generation
    {
        return Err("项目已切换，已忽略旧检索".into());
    }
    retrieval::finish_ranking(&mut results);
    let evidence_count = results.iter().filter(|r| r.evidence).count();
    if evidence_count == 0 && candidate_count > 0 {
        warnings.push("只找到可能相关的候选，尚无足够直接证据；候选不会自动用于生成答案。".into());
    }
    Ok(SearchResponse {
        results,
        warning: if warnings.is_empty() {
            None
        } else {
            Some(warnings.join(
                "
",
            ))
        },
        semantic: used,
        evidence_count,
        candidate_count,
        retrieval_mode: if used { "hybrid" } else { "bm25" }.into(),
        rerank_status,
    })
}
#[tauri::command]
async fn search(
    state: State<'_, AppState>,
    query: String,
    scope: Option<String>,
    semantic: bool,
    request_id: Option<String>,
    retrieval_mode: Option<String>,
) -> Result<SearchResponse, String> {
    let id = request_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let cancel = Arc::new(AtomicBool::new(false));
    if let Some((_, old)) = state
        .search_request
        .lock()
        .map_err(|_| "内部状态不可用")?
        .replace((id.clone(), cancel.clone()))
    {
        old.store(true, Ordering::SeqCst);
    }
    let response = search_inner(
        &state,
        &query,
        scope.as_deref(),
        semantic,
        retrieval_mode.as_deref(),
        &cancel,
        None,
    )
    .await;
    let mut active = state.search_request.lock().map_err(|_| "内部状态不可用")?;
    if active
        .as_ref()
        .is_some_and(|(current, token)| current == &id && Arc::ptr_eq(token, &cancel))
    {
        *active = None;
    } else {
        return Err("新查询已替代旧检索".into());
    }
    response
}
#[tauri::command]
fn cancel_search(state: State<'_, AppState>, request_id: Option<String>) {
    if let Ok(active) = state.search_request.lock() {
        if let Some((id, token)) = active.as_ref() {
            if request_id.as_ref().is_none_or(|requested| requested == id) {
                token.store(true, Ordering::SeqCst);
            }
        }
    }
}

struct BusyGuard<'a>(&'a AtomicBool, &'a Mutex<Option<String>>);
impl Drop for BusyGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut active) = self.1.lock() {
            *active = None;
        }
        self.0.store(false, Ordering::SeqCst);
    }
}
#[tauri::command]
async fn ask_question(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    question: String,
    scope: Option<String>,
    request_id: String,
    semantic: Option<bool>,
    retrieval_mode: Option<String>,
) -> Result<ChatResponse, String> {
    let _guard = begin_chat(&state, &request_id)?;
    ask_pipeline(
        &app,
        &state,
        &question,
        &question,
        scope,
        &request_id,
        semantic,
        retrieval_mode,
        None,
    )
    .await
}
fn begin_chat<'a>(state: &'a AppState, request_id: &str) -> Result<BusyGuard<'a>, String> {
    if state.chat_busy.swap(true, Ordering::SeqCst) {
        return Err("已有回答正在生成".into());
    }
    let guard = BusyGuard(&state.chat_busy, &state.chat_request);
    {
        let mut active = state.chat_request.lock().map_err(|_| "内部状态不可用")?;
        state.cancel_chat.store(false, Ordering::SeqCst);
        *active = Some(request_id.to_string());
    }
    Ok(guard)
}
async fn ask_pipeline(
    app: &tauri::AppHandle,
    state: &AppState,
    retrieval_question: &str,
    prompt_question: &str,
    scope: Option<String>,
    request_id: &str,
    semantic: Option<bool>,
    retrieval_mode: Option<String>,
    followup_gate: Option<&assistant::grounding::FollowupGate>,
) -> Result<ChatResponse, String> {
    let generation = state.workspace_generation.load(Ordering::SeqCst);
    let config = settings(&state)?.chat;
    if !config.enabled {
        return Err("请在模型设置中启用问答服务".into());
    }
    let mut found = search_inner(
        &state,
        retrieval_question,
        scope.as_deref(),
        semantic.unwrap_or(true),
        retrieval_mode.as_deref(),
        &state.cancel_chat,
        Some((app, request_id)),
    )
    .await?;
    if generation != state.workspace_generation.load(Ordering::SeqCst) {
        return Err("资料空间已变化，已撤回旧回答".into());
    }
    if let Some(gate) = followup_gate {
        assistant::grounding::tighten(gate, &mut found.results);
        found.evidence_count = found.results.iter().filter(|r| r.evidence).count();
    }
    let actual_mode = found.retrieval_mode.clone();
    let rerank_status = found.rerank_status.clone();
    let context_workspace = workspace(&state)?;
    let (prompt_question, preference_warning) =
        match companion::format_preferences(&state.data_dir, &context_workspace) {
            Ok(value) if !value.is_empty() => (format!("{prompt_question}\n\n{value}"), None),
            Ok(_) => (prompt_question.to_string(), None),
            Err(_) => (
                prompt_question.to_string(),
                Some("角色表达偏好暂不可用，本轮按默认格式回答。".to_string()),
            ),
        };
    let sources = retrieval::generation_context(
        &context_workspace,
        &found.results,
        config.context_chars.saturating_sub(
            prompt_question.chars().count() + providers::ANSWER_SYSTEM.chars().count() + 500,
        ),
        scope.is_some(),
    );
    if sources.is_empty() {
        return Ok(ChatResponse{finish_reason:"no_evidence".into(),text:"当前资料中没有找到足够直接、可引用的证据。请检查资料范围、更新索引，或换一个更具体的问题；可能相关的候选未被当作答案依据。".into(),sources,warning:found.warning,retrieval_mode:actual_mode,rerank_status,model:String::new(),scope,chart_warnings:vec![],rejected_charts:vec![]});
    }
    let key = read_key(&state, "chat", &config.base_url, &state.cancel_chat).await?;
    if state.cancel_chat.load(Ordering::SeqCst) {
        return Err("已停止生成".into());
    }
    let current = generation == state.workspace_generation.load(Ordering::SeqCst)
        && sources_current(state, &context_workspace, &sources);
    if state.cancel_chat.load(Ordering::SeqCst) {
        return Err("已停止生成".into());
    }
    if !current {
        return Ok(ChatResponse {
            finish_reason: "source_changed".into(),
            text: "所用资料已更新或移除，尚未发送过期内容。请重新提问以使用最新原文。".into(),
            sources: vec![],
            warning: Some("资料版本已变化，已撤回旧引用。".into()),
            retrieval_mode: actual_mode,
            rerank_status,
            model: String::new(),
            scope,
            chart_warnings: vec![],
            rejected_charts: vec![],
        });
    }
    let _ = app.emit(
        "chat-sources",
        ChatSourcesEvent {
            request_id: request_id.to_string(),
            sources: sources.clone(),
        },
    );
    let _ = app.emit(
        "chat-status",
        ChatStatusEvent {
            request_id: request_id.to_string(),
            stage: "generating".into(),
            detail: "正在依据已保存且版本校验通过的资料生成回答".into(),
        },
    );
    let output = providers::chat(
        &state.client,
        &config,
        key.as_deref(),
        &prompt_question,
        &sources,
        &state.cancel_chat,
        Some(app),
        request_id,
    )
    .await;
    if state.cancel_chat.load(Ordering::SeqCst) {
        return Err("已停止生成".into());
    }
    let current = generation == state.workspace_generation.load(Ordering::SeqCst)
        && sources_current(state, &context_workspace, &sources);
    if state.cancel_chat.load(Ordering::SeqCst) {
        return Err("已停止生成".into());
    }
    if !current {
        return Ok(ChatResponse { finish_reason: "source_changed".into(), text: "生成期间所用资料发生变化或已被移除，已撤回过期答案和引用。请重新提问以核对最新原文。".into(), sources: vec![], warning: Some("原文已变化，请勿使用生成期间显示的旧内容。".into()), retrieval_mode:actual_mode, rerank_status, model:config.model.clone(), scope,chart_warnings:vec![],rejected_charts:vec![] });
    }
    let output = output?;
    let chart_audit = answer_validation::audit_charts(&output.text, &sources);
    let mut warnings = found
        .warning
        .into_iter()
        .chain(preference_warning)
        .collect::<Vec<_>>();
    if output.finish_reason == "length" {
        warnings.push("回答达到输出长度限制，内容已截断。请缩小问题范围后重试。".into());
    } else if output.finish_reason != "stop" {
        warnings.push(format!(
            "服务结束原因：{}，请核对回答是否完整。",
            output.finish_reason
        ));
    }
    Ok(ChatResponse {
        finish_reason: output.finish_reason.clone(),
        retrieval_mode: actual_mode,
        rerank_status,
        model: config.model,
        scope,
        chart_warnings: chart_audit.warnings,
        rejected_charts: chart_audit.rejected,
        text: output.text,
        sources,
        warning: if warnings.is_empty() {
            None
        } else {
            Some(warnings.join("\n"))
        },
    })
}
#[tauri::command]
fn cancel_chat(state: State<'_, AppState>, request_id: Option<String>) {
    if let Ok(active) = state.chat_request.lock() {
        if chat_cancel_matches(active.as_deref(), request_id.as_deref()) {
            state.cancel_chat.store(true, Ordering::SeqCst);
        }
    }
}
fn chat_cancel_matches(active: Option<&str>, requested: Option<&str>) -> bool {
    requested.is_none() || requested.is_some_and(|id| active == Some(id))
}
#[tauri::command]
async fn export_svg(path: String, content: String) -> Result<(), String> {
    let target = PathBuf::from(path);
    if target
        .extension()
        .is_none_or(|e| !e.eq_ignore_ascii_case("svg"))
        || content.len() > 10 * 1024 * 1024
        || !content.contains("<svg")
    {
        return Err("请导出为 SVG 文件（上限 10 MB）".into());
    }
    files::write_atomic(&target, content.as_bytes())
}

fn png_export_bytes(path: &str, data_url: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    if PathBuf::from(path)
        .extension()
        .is_none_or(|e| !e.eq_ignore_ascii_case("png"))
    {
        return Err("请导出为 PNG 文件".into());
    }
    let raw = data_url
        .strip_prefix("data:image/png;base64,")
        .ok_or("PNG 数据格式无效")?;
    if raw.len() > 14 * 1024 * 1024 {
        return Err("PNG 超过 10 MB 保护上限".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(raw)
        .map_err(|_| "PNG 编码无效")?;
    if bytes.len() > 10 * 1024 * 1024
        || bytes.len() < 33
        || !bytes.starts_with(b"\x89PNG\r\n\x1a\n")
        || bytes[8..12] != 13u32.to_be_bytes()
        || &bytes[12..16] != b"IHDR"
        || !bytes.ends_with(b"\0\0\0\0IEND\xaeB`\x82")
    {
        return Err("PNG 文件无效或超过 10 MB".into());
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
    if width == 0
        || height == 0
        || width > 8192
        || height > 8192
        || u64::from(width) * u64::from(height) > 32_000_000
    {
        return Err("PNG 尺寸超过保护上限".into());
    }
    Ok(bytes)
}
#[tauri::command]
async fn export_png(path: String, data_url: String) -> Result<(), String> {
    let bytes = png_export_bytes(&path, &data_url)?;
    files::write_atomic(&PathBuf::from(path), &bytes)
}

#[cfg(test)]
mod v05_io_tests {
    use super::*;
    fn index_test_app(
        data: PathBuf,
        ws: Workspace,
        settings: Settings,
    ) -> tauri::App<tauri::test::MockRuntime> {
        let state = AppState {
            credentials: credentials::CredentialReader::default(),
            workspace: Mutex::new(Some(ws)),
            workspace_generation: AtomicU64::new(0),
            settings: Mutex::new(settings),
            settings_write: Mutex::new(()),
            legacy_key_origins: HashMap::new(),
            last_workspace: Mutex::new(None),
            job: Mutex::new(None),
            import_busy: Arc::new(AtomicBool::new(false)),
            import_cancel: Arc::new(AtomicBool::new(false)),
            cancel_index: AtomicBool::new(false),
            indexing_path: Mutex::new(None),
            cancel_chat: AtomicBool::new(false),
            provider_test: Mutex::new(None),
            search_request: Mutex::new(None),
            chat_request: Mutex::new(None),
            chat_busy: AtomicBool::new(false),
            allow_quit: AtomicBool::new(false),
            config_file: data.join("settings.json"),
            data_dir: data,
            client: reqwest::Client::new(),
        };
        tauri::test::mock_builder()
            .manage(state)
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap()
    }
    #[tokio::test]
    async fn index_plan_fails_closed_on_catalogue_errors_and_global_recovery_block() {
        let data = tempfile::tempdir().unwrap();
        let good = library::create_document(data.path(), "inbox", "ready.md", "健康资料").unwrap();
        let trashed =
            library::create_document(data.path(), "inbox", "trashed.md", "不应发送的回收站正文")
                .unwrap();
        library::trash(data.path(), &trashed.id, false).unwrap();
        let ws = documents::library_workspace(data.path(), "inbox").unwrap();
        let app = index_test_app(data.path().to_path_buf(), ws, Settings::default());
        let state = app.state::<AppState>();
        let plan = begin_index(state.clone(), None).await.unwrap();
        assert_eq!(plan.documents.len(), 1);
        assert_eq!(plan.documents[0].path, good.path);
        end_index(state.clone(), plan.job_id).await.unwrap();
        let c =
            rusqlite::Connection::open(library::base(data.path()).join("catalog.sqlite3")).unwrap();
        c.pragma_update(None, "user_version", 99).unwrap();
        assert!(begin_index(state.clone(), None).await.is_err());
        assert!(state.job.lock().unwrap().is_none());
        c.pragma_update(None, "user_version", 3).unwrap();
        maintenance::set_managed_error(data.path(), Some("synthetic recovery failure".into()));
        assert!(begin_index(state.clone(), None)
            .await
            .err()
            .unwrap()
            .contains("暂停受管理写入"));
        assert!(state.job.lock().unwrap().is_none());
        maintenance::set_managed_error(data.path(), None);
    }
    #[tokio::test]
    async fn index_plan_repairs_missing_vectors_and_fts_despite_unchanged_hash_profile_and_manifest(
    ) {
        let data = tempfile::tempdir().unwrap();
        let doc =
            library::create_document(data.path(), "inbox", "资料.md", "预算明细 128").unwrap();
        let ws = documents::library_workspace(data.path(), "inbox").unwrap();
        let mut config = Settings::default();
        config.embedding.enabled = true;
        config.embedding.model = "synthetic-embedding".into();
        let profile = providers::fingerprint(&config.embedding);
        let hash = files::hash("预算明细 128");
        let mut c = db::open(&ws.db).unwrap();
        let chunks = db::local_chunks("预算明细 128", &doc.path, 1200);
        let ids = db::index_text(&mut c, &doc.path, &hash, &chunks).unwrap();
        db::set_chunk_manifest(
            &c,
            &doc.path,
            &ChunkManifest {
                strategy: "structured".into(),
                version: 1,
                source_hash: hash.clone(),
                embedding_profile: Some(profile.clone()),
            },
        )
        .unwrap();
        db::put_vectors_checked(
            &mut c,
            &doc.path,
            &hash,
            &profile,
            &ids,
            &vec![vec![1.0, 0.0]; ids.len()],
        )
        .unwrap();
        let app = index_test_app(data.path().to_path_buf(), ws.clone(), config);
        let state = app.state::<AppState>();
        let ready = begin_index(state.clone(), None).await.unwrap();
        assert!(ready.documents.is_empty());
        assert_eq!(ready.skipped, 1);
        end_index(state.clone(), ready.job_id).await.unwrap();
        c.execute("DELETE FROM vectors WHERE rowid=?", [ids[0]])
            .unwrap();
        assert!(db::indexed(&c, &doc.path, &hash, &profile));
        assert!(!db::vectors_complete(&c, &doc.path, &hash, &profile));
        let repair = begin_index(state.clone(), None).await.unwrap();
        assert_eq!(repair.documents.len(), 1);
        end_index(state.clone(), repair.job_id).await.unwrap();
        db::put_vectors_checked(
            &mut c,
            &doc.path,
            &hash,
            &profile,
            &ids,
            &vec![vec![1.0, 0.0]; ids.len()],
        )
        .unwrap();
        c.execute("DELETE FROM chunk_fts WHERE rowid=?", [ids[0]])
            .unwrap();
        assert!(!db::keyword_complete(&c, &doc.path, &hash));
        let repair = begin_index(state.clone(), None).await.unwrap();
        assert_eq!(repair.documents.len(), 1);
        end_index(state.clone(), repair.job_id).await.unwrap();
        c.execute_batch("DROP TABLE chunk_fts").unwrap();
        let repair = begin_index(state.clone(), None).await.unwrap();
        assert_eq!(repair.documents.len(), 1);
        end_index(state.clone(), repair.job_id).await.unwrap();
        clear_index(state.clone()).await.unwrap();
        assert!(db::paths(&db::open(&ws.db).unwrap()).unwrap().is_empty());
        assert!(db::chunk_manifest(&db::open(&ws.db).unwrap(), &doc.path)
            .unwrap()
            .is_none());
        assert_eq!(
            fs::read_to_string(ws.root.join(&doc.path)).unwrap(),
            "预算明细 128"
        );
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn canonical_data_alias_cannot_bypass_managed_write_gate_but_external_editing_still_works(
    ) {
        let data = tempfile::tempdir().unwrap();
        let aliases = tempfile::tempdir().unwrap();
        let alias = aliases.path().join("data-alias");
        std::os::unix::fs::symlink(data.path(), &alias).unwrap();
        let doc = library::create_document(&alias, "inbox", "原稿.md", "原稿").unwrap();
        let ws = documents::library_workspace(&alias, "inbox").unwrap();
        let app = index_test_app(alias.clone(), ws.clone(), Settings::default());
        let state = app.state::<AppState>();
        maintenance::set_managed_error(&alias, Some("synthetic blocked catalogue".into()));
        let expected = files::hash("原稿");
        let workspace_root = ws.root.to_string_lossy().into_owned();
        assert!(save_file(
            state.clone(),
            doc.path.clone(),
            "不能写入".into(),
            expected.clone(),
            workspace_root.clone()
        )
        .await
        .is_err());
        assert!(save_draft(
            state.clone(),
            doc.path.clone(),
            "不能写入草稿".into(),
            expected.clone(),
            workspace_root.clone()
        )
        .await
        .is_err());
        assert!(
            create_file(state.clone(), "new.md".into(), Some("new".into()))
                .await
                .is_err()
        );
        assert!(
            rename_file(state.clone(), doc.path.clone(), "renamed.md".into())
                .await
                .is_err()
        );
        let draft = files::draft_path(&alias, &ws, &doc.path);
        fs::create_dir_all(draft.parent().unwrap()).unwrap();
        fs::write(&draft, b"retained draft").unwrap();
        assert!(discard_draft(state.clone(), doc.path.clone())
            .await
            .is_err());
        assert!(draft.exists());
        assert_eq!(fs::read_to_string(ws.root.join(&doc.path)).unwrap(), "原稿");
        let external = tempfile::tempdir().unwrap();
        let external_ws = Workspace {
            root: external.path().canonicalize().unwrap(),
            db: external.path().join("index"),
        };
        fs::write(external_ws.root.join("outside.md"), "外部原稿").unwrap();
        *state.workspace.lock().unwrap() = Some(external_ws.clone());
        save_file(
            state.clone(),
            "outside.md".into(),
            "外部仍可保存".into(),
            files::hash("外部原稿"),
            external_ws.root.to_string_lossy().into_owned(),
        )
        .await
        .unwrap();
        assert_eq!(
            fs::read_to_string(external_ws.root.join("outside.md")).unwrap(),
            "外部仍可保存"
        );
        maintenance::set_managed_error(&alias, None);
    }
    #[tokio::test]
    async fn ended_index_late_reply_cannot_revive_attempts_after_clear_or_replace_new_job() {
        use std::io::{Read, Write};
        let data = tempfile::tempdir().unwrap();
        let doc =
            library::create_document(data.path(), "inbox", "资料.md", "唯一预算 128").unwrap();
        let ws = documents::library_workspace(data.path(), "inbox").unwrap();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(false).unwrap();
        let address = format!("http://{}/v1", listener.local_addr().unwrap());
        let (arrive_tx, arrive_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                .unwrap();
            let mut request = [0u8; 16384];
            let _ = stream.read(&mut request).unwrap();
            let _ = arrive_tx.send(());
            release_rx
                .recv_timeout(std::time::Duration::from_secs(5))
                .unwrap();
            let body = r#"{"data":[{"index":0,"embedding":[1.0,0.0]}]}"#;
            let response=format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body);
            let _ = stream.write_all(response.as_bytes());
        });
        let mut config = Settings::default();
        config.embedding.enabled = true;
        config.embedding.base_url = address.clone();
        config.embedding.model = "synthetic".into();
        config.embedding.dimensions = Some(2);
        let app = index_test_app(data.path().to_path_buf(), ws.clone(), config);
        let state = app.state::<AppState>();
        // Seed only this isolated reader's process cache; real read_key then
        // returns None from cache and never invokes the production Keychain.
        state
            .credentials
            .read(
                credentials::Identity::new("embedding", &address, false),
                &AtomicBool::new(false),
                || Ok(None),
            )
            .await
            .unwrap();
        let plan = begin_index(state.clone(), None).await.unwrap();
        let old = plan.job_id;
        let file = &plan.documents[0];
        let chunks = db::local_chunks(&file.content, &file.path, 1200);
        let work = index_document(
            state.clone(),
            old.clone(),
            file.path.clone(),
            file.hash.clone(),
            chunks,
            None,
        );
        let interrupt = async {
            tokio::time::timeout(std::time::Duration::from_secs(5), arrive_rx)
                .await
                .unwrap()
                .unwrap();
            end_index(state.clone(), old.clone()).await.unwrap();
            clear_index(state.clone()).await.unwrap();
            let new = begin_index(state.clone(), None).await.unwrap();
            release_tx.send(()).unwrap();
            new.job_id
        };
        let (result, new) = tokio::join!(work, interrupt);
        assert!(result.is_err());
        server.join().unwrap();
        let c = db::open(&ws.db).unwrap();
        assert!(db::index_attempt(&c, &doc.path).unwrap().is_none());
        assert!(db::paths(&c).unwrap().is_empty());
        assert!(state.indexing_path.lock().unwrap().is_none());
        assert_eq!(state.job.lock().unwrap().as_ref().unwrap().id, new);
        end_index(state.clone(), new).await.unwrap();
    }
    #[test]
    fn late_cancel_cannot_stop_another_answer_and_finished_ids_are_cleared() {
        assert!(!chat_cancel_matches(Some("new"), Some("old")));
        assert!(chat_cancel_matches(Some("new"), Some("new")));
        assert!(!chat_cancel_matches(None, Some("old")));
        assert!(chat_cancel_matches(Some("new"), None));
        let busy = AtomicBool::new(true);
        let active = Mutex::new(Some("finished".to_string()));
        drop(BusyGuard(&busy, &active));
        assert!(!busy.load(Ordering::SeqCst));
        assert!(active.lock().unwrap().is_none());
    }
    #[test]
    fn png_export_checks_format_extension_and_dimensions_before_writing() {
        use base64::Engine;
        let raw = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";
        let data = format!("data:image/png;base64,{raw}");
        assert!(png_export_bytes("chart.png", &data).is_ok());
        assert!(png_export_bytes("chart.txt", &data).is_err());
        assert!(png_export_bytes("chart.png", "data:image/svg+xml;base64,PHN2Zz4=").is_err());
        assert!(png_export_bytes("chart.png", "data:image/png;base64,AAAA").is_err());
        let mut bytes = base64::engine::general_purpose::STANDARD
            .decode(raw)
            .unwrap();
        bytes[16..20].copy_from_slice(&9000u32.to_be_bytes());
        let oversized = format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        );
        assert!(png_export_bytes("chart.png", &oversized)
            .unwrap_err()
            .contains("尺寸"));
    }
    #[tokio::test]
    async fn keyword_mode_stays_local_with_ready_vectors_and_enabled_remote_reranker() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let data_dir = root.join("application");
        fs::create_dir_all(&data_dir).unwrap();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        let settings = Settings {
            embedding: Provider {
                enabled: true,
                base_url: format!("{address}/v1"),
                model: "test".into(),
                dimensions: Some(2),
                ..Default::default()
            },
            rerank: RerankProvider {
                enabled: true,
                endpoint: format!("{address}/rerank"),
                model: "test".into(),
                ..Default::default()
            },
            ..Default::default()
        };
        let ws = Workspace {
            root: root.clone(),
            db: root.join("index.sqlite3"),
        };
        let content = "本地苹果资料";
        fs::write(root.join("a.md"), content).unwrap();
        let mut conn = db::open(&ws.db).unwrap();
        let ids = db::index_text(
            &mut conn,
            "a.md",
            &files::hash(content),
            &[ChunkInput {
                text: content.into(),
                heading: "苹果".into(),
                start_line: 1,
                end_line: 1,
            }],
        )
        .unwrap();
        db::put_vectors(
            &mut conn,
            "a.md",
            &providers::fingerprint(&settings.embedding),
            &ids,
            &[vec![1.0, 0.0]],
        )
        .unwrap();
        assert!(db::stats(&conn, &providers::fingerprint(&settings.embedding)).embedding_ready);
        drop(conn);
        let state = AppState {
            credentials: credentials::CredentialReader::default(),
            workspace: Mutex::new(Some(ws)),
            workspace_generation: AtomicU64::new(0),
            settings: Mutex::new(settings),
            settings_write: Mutex::new(()),
            legacy_key_origins: HashMap::new(),
            last_workspace: Mutex::new(None),
            job: Mutex::new(None),
            import_busy: Arc::new(AtomicBool::new(false)),
            import_cancel: Arc::new(AtomicBool::new(false)),
            cancel_index: AtomicBool::new(false),
            indexing_path: Mutex::new(None),
            cancel_chat: AtomicBool::new(false),
            provider_test: Mutex::new(None),
            search_request: Mutex::new(None),
            chat_request: Mutex::new(None),
            chat_busy: AtomicBool::new(false),
            allow_quit: AtomicBool::new(false),
            config_file: data_dir.join("settings.json"),
            data_dir,
            client: reqwest::Client::new(),
        };
        let result = search_inner(
            &state,
            "苹果",
            None,
            true,
            Some("keyword"),
            &AtomicBool::new(false),
            None,
        )
        .await
        .unwrap();
        assert_eq!(result.retrieval_mode, "bm25");
        assert_eq!(result.rerank_status, "not-requested");
        assert_eq!(result.evidence_count, 1);
        assert!(result.warning.is_none());
        assert_eq!(
            listener.accept().unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
    }
}
#[tauri::command]
async fn open_external(url: String) -> Result<(), String> {
    let parsed = reqwest::Url::parse(&url).map_err(|_| "链接无效")?;
    if !matches!(parsed.scheme(), "https" | "http") || parsed.host_str().is_none() {
        return Err("仅支持 HTTP/HTTPS 外部链接".into());
    }
    std::process::Command::new("/usr/bin/open")
        .arg(parsed.as_str())
        .spawn()
        .map_err(|_| "无法打开链接")?;
    Ok(())
}
#[tauri::command]
fn quit_app(app: tauri::AppHandle, state: State<'_, AppState>) {
    state.credentials.invalidate();
    state.allow_quit.store(true, Ordering::SeqCst);
    app.exit(0);
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let config_dir = app.path().app_config_dir()?;
            #[cfg(feature = "desktop-e2e")]
            let (data_dir, config_dir) = desktop_test::paths(&app.config().identifier, data_dir, config_dir)?;
            fs::create_dir_all(data_dir.join("drafts"))?;
            fs::create_dir_all(&config_dir)?;
            let config_file = config_dir.join("settings.json");
            #[cfg(not(feature = "desktop-e2e"))]
            let (config, legacy_key_origins) = fs::read(&config_file)
                .ok()
                .and_then(|b| decode_saved_config(&b))
                .unwrap_or_else(|| (SavedConfig::default(), HashMap::new()));
            #[cfg(feature = "desktop-e2e")]
            let (config, legacy_key_origins) = {
                let _ = config_file;
                eprintln!("Inkstone E2E: isolated identity verified; system credentials disabled; fresh model settings; data={}",data_dir.display());
                (SavedConfig::default(), HashMap::new())
            };
            let client = reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(std::time::Duration::from_secs(15))
                .timeout(std::time::Duration::from_secs(120))
                .build()?;
            maintenance::set_managed_error(&data_dir, library::recover(&data_dir).err());
            app.manage(AppState {
                credentials: credentials::CredentialReader::default(),
                workspace: Mutex::new(None),
                import_busy: Arc::new(AtomicBool::new(false)),
                import_cancel: Arc::new(AtomicBool::new(false)),
                workspace_generation: AtomicU64::new(0),
                settings: Mutex::new(config.settings),
                settings_write: Mutex::new(()),
                legacy_key_origins,
                last_workspace: Mutex::new(config.last_workspace),
                job: Mutex::new(None),
                cancel_index: AtomicBool::new(false),
                indexing_path: Mutex::new(None),
                cancel_chat: AtomicBool::new(false),
                provider_test: Mutex::new(None),
                search_request: Mutex::new(None),
                chat_request: Mutex::new(None),
                chat_busy: AtomicBool::new(false),
                allow_quit: AtomicBool::new(false),
                data_dir,
                config_file,
                client,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            calendar_commands::calendar_list,
            calendar_commands::calendar_save,
            calendar_commands::export_calendar_ics,
            library_commands::library_archive_import,
            library_commands::library_list,
            library_commands::open_library,
            library_commands::library_create_project,
            library_commands::library_rename_project,
            library_commands::library_create_document,
            library_commands::library_rename,
            library_commands::library_trash,
            library_commands::library_import,
            library_commands::cancel_import,
            library_commands::library_export,
            library_commands::library_reveal,
            library_commands::library_check_source_update,
            library_commands::library_apply_source_update,
            library_commands::library_history,
            library_commands::library_restore_version,
            library_commands::library_recovery_report,
            library_commands::library_retry_recovery,
            library_commands::library_relink_preview,
            library_commands::library_relink_apply,
            bootstrap,
            get_settings,
            save_settings,
            test_provider,
            test_reranker,
            cancel_provider_test,
            open_workspace,
            list_files,
            read_file,
            file_hash,
            resolve_image,
            save_file,
            save_draft,
            discard_draft,
            create_file,
            rename_file,
            index_stats,
            workspace_index_status,
            workspace_pins,
            workspace_set_pin,
            library_create_backup,
            library_validate_backup,
            library_restore_backup,
            begin_index,
            index_document,
            end_index,
            cancel_index,
            clear_index,
            search,
            cancel_search,
            assistant_commands::assistant_list,
            assistant_commands::assistant_create,
            assistant_commands::assistant_get,
            assistant_commands::assistant_update,
            assistant_commands::assistant_delete,
            assistant_commands::assistant_export,
            assistant_commands::assistant_select_candidate,
            assistant_commands::assistant_ask,
            companion_commands::companion_state,
            companion_commands::companion_settings,
            companion_commands::companion_preview,
            companion_commands::companion_confirm,
            companion_commands::companion_story,
            companion_commands::companion_card,
            companion_commands::companion_preference,
            companion_commands::companion_reset,
            companion_commands::companion_export,
            ask_question,
            cancel_chat,
            export_svg,
            export_png,
            open_external,
            quit_app
        ])
        .build(tauri::generate_context!())
        .expect("无法启动砚台桌面应用")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if !app.state::<AppState>().allow_quit.load(Ordering::SeqCst) {
                    api.prevent_exit();
                    let _ = app.emit("request-close", ());
                }
            }
        });
}
