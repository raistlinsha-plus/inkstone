//! A generation is an explicit request. The preview remains in the window's
//! memory until the user selects a destination and asks to save it.
use crate::{files, library, local_credentials, media, models::Provider, providers, AppState};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::State;

const SETTINGS: &str = "image-generation.json";
const MAX_RESPONSE: usize = 32 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationConfig {
    base_url: String,
    model: String,
    use_chat_key: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigView {
    config: GenerationConfig,
    chat_base_url: String,
    chat_enabled: bool,
    has_key: bool,
}

#[tauri::command]
pub fn image_generation_settings(state: State<'_, AppState>) -> Result<ConfigView, String> {
    let chat = crate::settings(&state)?.chat;
    let mut config = match fs::read(state.data_dir.join(SETTINGS)) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| "无法读取图片生成设置")?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => GenerationConfig {
            base_url: chat.base_url.clone(),
            model: String::new(),
            use_chat_key: chat.enabled,
        },
        Err(_) => return Err("无法读取图片生成设置".into()),
    };
    if !chat.enabled || config.base_url != chat.base_url {
        config.use_chat_key = false;
    }
    let has_key = crate::has_local_key(&state, "generation", &config.base_url)?;
    Ok(ConfigView {
        config,
        chat_base_url: chat.base_url,
        chat_enabled: chat.enabled,
        has_key,
    })
}

#[derive(Default)]
pub struct ActiveGeneration(Mutex<Option<(uuid::Uuid, Arc<AtomicBool>)>>);

#[tauri::command]
pub fn image_generation_cancel(
    active: State<'_, ActiveGeneration>,
    request_id: String,
) -> Result<(), String> {
    let id = uuid::Uuid::parse_str(&request_id).map_err(|_| "请求标识无效")?;
    let mut slot = active.0.lock().map_err(|_| "请求状态不可用")?;
    if let Some((_, flag)) = slot.as_ref().filter(|(current, _)| *current == id) {
        flag.store(true, Ordering::SeqCst);
        *slot = None;
    }
    Ok(())
}

fn format_of(bytes: &[u8]) -> Result<(&'static str, &'static str), String> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Ok(("png", "image/png"))
    } else if bytes.starts_with(&[255, 216, 255]) {
        Ok(("jpg", "image/jpeg"))
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Ok(("webp", "image/webp"))
    } else {
        Err("服务返回了不支持的图片格式".into())
    }
}

async fn generate(
    client: &reqwest::Client,
    provider: &Provider,
    key: Option<&str>,
    prompt: &str,
    cancel: &AtomicBool,
) -> Result<String, String> {
    let mut body = serde_json::json!({"model":provider.model,"prompt":prompt,"n":1});
    // GPT Image always returns inline base64. DALL-E uses an explicit format.
    if !provider.model.starts_with("gpt-image") {
        body["response_format"] = serde_json::json!("b64_json");
    }
    let res =
        providers::request(client, provider, key, "images/generations", body, cancel, 1).await?;
    let value = providers::bounded_json(res, MAX_RESPONSE, cancel).await?;
    let b64 = value["data"][0]["b64_json"]
        .as_str()
        .ok_or("服务需返回 b64_json 图片")?;
    let bytes = STANDARD.decode(b64).map_err(|_| "图片编码无效")?;
    let (_, mime) = format_of(&bytes)?;
    Ok(format!("data:{mime};base64,{b64}"))
}

#[tauri::command]
pub async fn image_generation_preview(
    state: State<'_, AppState>,
    active: State<'_, ActiveGeneration>,
    request_id: String,
    mut config: GenerationConfig,
    api_key: Option<String>,
    prompt: String,
) -> Result<String, String> {
    let id = uuid::Uuid::parse_str(&request_id).map_err(|_| "请求标识无效")?;
    let prompt = prompt.trim();
    if prompt.is_empty() || prompt.chars().count() > 12000 {
        return Err("请输入 1–12000 个字符的提示词".into());
    }
    config.base_url = config.base_url.trim().to_owned();
    config.model = config.model.trim().to_owned();
    if config.model.len() > 256
        || config.base_url.len() > 2048
        || api_key.as_ref().is_some_and(|k| k.len() > 8192)
    {
        return Err("模型设置过长".into());
    }
    let p = Provider {
        enabled: true,
        base_url: config.base_url.clone(),
        model: config.model.clone(),
        ..Provider::default()
    };
    providers::validate(&p)?;
    let chat = crate::settings(&state)?.chat;
    if config.use_chat_key && (!chat.enabled || chat.base_url.trim() != config.base_url) {
        return Err("仅可在已启用的同一问答地址使用问答密钥".into());
    }
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut slot = active.0.lock().map_err(|_| "请求状态不可用")?;
        if slot.is_some() {
            return Err("已有图片正在生成".into());
        }
        *slot = Some((id, Arc::clone(&cancel)));
    }
    let result = async {
        let key = {
            let _mutation = crate::maintenance::mutation(&state.data_dir)?;
            if !config.use_chat_key {
                local_credentials::save(
                    &state.data_dir,
                    "generation",
                    &p.base_url,
                    api_key.as_deref(),
                    false,
                )?;
            }
            files::write_atomic(
                &state.data_dir.join(SETTINGS),
                &serde_json::to_vec(&config).map_err(|e| e.to_string())?,
            )?;
            crate::local_key(
                &state,
                if config.use_chat_key {
                    "chat"
                } else {
                    "generation"
                },
                &p.base_url,
            )?
        };
        generate(&state.client, &p, key.as_deref(), prompt, &cancel).await
    }
    .await;
    let mut slot = active.0.lock().map_err(|_| "请求状态不可用")?;
    if slot.as_ref().is_some_and(|(current, _)| *current == id) {
        *slot = None;
    }
    result
}

fn save_preview(
    data: &Path,
    project: &str,
    folder: &str,
    title: &str,
    preview: &str,
) -> Result<media::ImageImportResult, String> {
    let title = title.trim();
    if title.is_empty()
        || title.len() > 140
        || title.starts_with('.')
        || title.contains(['/', '\\'])
        || title.chars().any(char::is_control)
    {
        return Err("请输入有效的图片名称".into());
    }
    let (prefix, b64) = preview.split_once(',').ok_or("图片数据无效")?;
    if b64.len() > MAX_RESPONSE {
        return Err("图片数据过大".into());
    }
    let bytes = STANDARD.decode(b64).map_err(|_| "图片编码无效")?;
    let (ext, mime) = format_of(&bytes)?;
    if prefix != format!("data:{mime};base64") {
        return Err("图片格式不一致".into());
    }
    library::project_root(data, project)?;
    crate::organization::check_destination(&library::conn(data)?, project, folder)?;
    let mut builder = tempfile::Builder::new();
    builder.prefix("inkstone-generation-");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        builder.permissions(fs::Permissions::from_mode(0o700));
    }
    let temp = builder.tempdir().map_err(|e| e.to_string())?;
    let path = temp.path().join(format!("{title}.{ext}"));
    fs::write(&path, bytes).map_err(|e| e.to_string())?;
    media::import_image(
        data,
        project,
        &path,
        media::Duplicates::Folder(folder),
        folder,
    )
}

#[tauri::command]
pub async fn image_generation_save(
    state: State<'_, AppState>,
    project_id: String,
    folder: String,
    title: String,
    preview: String,
) -> Result<media::ImageImportResult, String> {
    let data = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _mutation = crate::maintenance::mutation(&data)?;
        save_preview(&data, &project_id, &folder, &title, &preview)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    #[tokio::test]
    async fn preview_from_provider_only_commits_to_catalog_on_save() {
        let dir = tempfile::tempdir().unwrap();
        let png = include_bytes!("../native/fixtures/media-board.png");
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let api = format!("http://{}/v1", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut incoming = Vec::new();
            let mut chunk = [0; 4096];
            let head_end = loop {
                let n = socket.read(&mut chunk).unwrap();
                assert!(n > 0);
                incoming.extend_from_slice(&chunk[..n]);
                if let Some(pos) = incoming.windows(4).position(|it| it == b"\r\n\r\n") {
                    break pos + 4;
                }
            };
            let head = String::from_utf8_lossy(&incoming[..head_end]).to_lowercase();
            assert!(head.starts_with("post /v1/images/generations "));
            assert!(head.contains("authorization: bearer fixture-key"));
            let length: usize = head
                .lines()
                .find_map(|l| l.strip_prefix("content-length: "))
                .unwrap()
                .parse()
                .unwrap();
            while incoming.len() < head_end + length {
                let n = socket.read(&mut chunk).unwrap();
                assert!(n > 0);
                incoming.extend_from_slice(&chunk[..n]);
            }
            let body: serde_json::Value =
                serde_json::from_slice(&incoming[head_end..head_end + length]).unwrap();
            assert_eq!(
                body,
                serde_json::json!({"model":"gpt-image-test","prompt":"A paper lantern","n":1})
            );
            let response =
                serde_json::json!({"data":[{"b64_json":STANDARD.encode(png)}]}).to_string();
            write!(
                socket,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                response.len(),
                response
            )
            .unwrap();
        });
        let provider = Provider {
            enabled: true,
            base_url: api,
            model: "gpt-image-test".into(),
            ..Provider::default()
        };
        let preview = generate(
            &reqwest::Client::new(),
            &provider,
            Some("fixture-key"),
            "A paper lantern",
            &AtomicBool::new(false),
        )
        .await
        .unwrap();
        server.join().unwrap();
        // The preview stage does not even need a space or a catalog.
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
        let db = library::conn(dir.path()).unwrap();
        db.execute(
            "INSERT INTO preferences(key,value) VALUES('workspace.layout.v1:inbox',?)",
            [r#"{"folders":["Design"]}"#],
        )
        .unwrap();
        assert!(save_preview(dir.path(), "inbox", "Unknown", "Lantern", &preview).is_err());
        assert!(save_preview(dir.path(), "inbox", "Design", "../escape", &preview).is_err());
        let result = save_preview(dir.path(), "inbox", "Design", "Lantern", &preview).unwrap();
        assert_eq!(
            crate::organization::document_folder(&db, "inbox", &result.document.id).unwrap(),
            "Design"
        );
        let doc = library::project_root(dir.path(), "inbox")
            .unwrap()
            .join(&result.document.path);
        assert_eq!(
            fs::read(media::stored_asset(&doc, false).unwrap()).unwrap(),
            png.as_slice()
        );
        let again = save_preview(dir.path(), "inbox", "Design", "Lantern", &preview).unwrap();
        let copy = save_preview(dir.path(), "inbox", "", "Cover", &preview).unwrap();
        assert!(!copy.existing);
        assert_ne!(copy.document.id, result.document.id);
        assert_eq!(
            crate::organization::document_folder(&db, "inbox", &result.document.id).unwrap(),
            "Design"
        );
        assert_eq!(
            crate::organization::document_folder(&db, "inbox", &copy.document.id).unwrap(),
            ""
        );
        assert!(again.existing);
        assert_eq!(again.document.id, result.document.id);
    }
}
