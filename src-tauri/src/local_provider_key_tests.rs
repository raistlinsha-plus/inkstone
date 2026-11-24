use super::*;
use std::{path::Path, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    net::TcpListener,
};

fn app(data: &Path, settings: Settings) -> tauri::App<tauri::test::MockRuntime> {
    let mut state = evaluation_v086::isolated_state(data, settings, Default::default()).unwrap();
    state.client = reqwest::Client::builder().no_proxy().build().unwrap();
    tauri::test::mock_builder()
        .manage(state)
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap()
}

const TEST_KEY: &str = "synthetic-loopback-test-only";

async fn verify_authenticated_chat(state: State<'_, AppState>, listener: &TcpListener) {
    let provider = settings(&state).unwrap().chat;
    let call = test_provider(state, "chat".into(), provider, None, None);
    let server = async {
        let (socket, _) = listener.accept().await.unwrap();
        let mut connection = BufReader::new(socket);
        let mut lines = (&mut connection).lines();
        assert_eq!(
            lines.next_line().await.unwrap().unwrap(),
            "POST /v1/chat/completions HTTP/1.1"
        );
        let mut auth = Vec::new();
        let mut length = None;
        loop {
            let line = lines.next_line().await.unwrap().unwrap();
            if line.is_empty() {
                break;
            }
            let (name, value) = line.split_once(':').unwrap();
            if name.eq_ignore_ascii_case("authorization") {
                auth.push(value.trim().to_owned());
            }
            if name.eq_ignore_ascii_case("content-length") {
                length = Some(value.trim().parse::<usize>().unwrap());
            }
        }
        assert_eq!(auth, [format!("Bearer {TEST_KEY}")]);
        let mut body = vec![0; length.unwrap()];
        connection.read_exact(&mut body).await.unwrap();
        let request: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(request["model"], "loopback-chat");
        let answer = r#"{"choices":[{"message":{"content":"ok"}}]}"#;
        let reply = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{answer}",
            answer.len()
        );
        connection
            .get_mut()
            .write_all(reply.as_bytes())
            .await
            .unwrap();
    };
    tokio::time::timeout(Duration::from_secs(10), async {
        let (response, _) = tokio::join!(call, server);
        assert_eq!(response.unwrap(), "连接成功，已收到回答文本");
    })
    .await
    .expect("local model request timed out");
}

#[tokio::test]
async fn saved_chat_key_authenticates_repeated_requests_and_survives_restart() {
    let dir = tempfile::tempdir().unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let mut configured = Settings::default();
    configured.chat.enabled = true;
    configured.chat.base_url = format!("http://{}/v1", listener.local_addr().unwrap());
    configured.chat.model = "loopback-chat".into();
    {
        let first = app(dir.path(), Settings::default());
        let state = first.state::<AppState>();
        let saved = save_settings(
            state.clone(),
            configured,
            None,
            Some(TEST_KEY.into()),
            false,
            false,
            None,
            None,
            None,
        )
        .await
        .unwrap();
        assert!(saved.has_chat_key);
        verify_authenticated_chat(state.clone(), &listener).await;
        verify_authenticated_chat(state, &listener).await;
    }
    let bytes = fs::read(dir.path().join("settings.json")).unwrap();
    let (saved, _) = decode_saved_config(&bytes).unwrap();
    let reopened = app(dir.path(), saved.settings);
    verify_authenticated_chat(reopened.state::<AppState>(), &listener).await;
}
