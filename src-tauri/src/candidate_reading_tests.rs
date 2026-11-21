//! Exercise live routing and source ownership using only an isolated loopback server.
use super::*;
use crate::{
    assistant, assistant_runtime,
    assistant_sources::{Selection, WebAccess},
    credentials, evaluation_v086, library,
    models::Settings,
};
use serde_json::{json, Value};
use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::TcpListener,
    path::Path,
    sync::Arc,
    time::Duration,
};

fn setup(data: &Path, consent: bool) -> (Arc<AppState>, TcpListener) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let mut settings = Settings::default();
    settings.chat = Provider {
        enabled: true,
        base_url: format!("http://{}", listener.local_addr().unwrap()),
        model: "isolated-test".into(),
        ..Default::default()
    };
    settings.candidate_reading = consent;
    let state =
        evaluation_v086::isolated_state(data, settings, credentials::CredentialReader::default())
            .unwrap();
    (Arc::new(state), listener)
}

fn serve(
    listener: TcpListener,
    status: u16,
    message: &str,
    action: impl FnOnce() + Send + 'static,
) -> std::thread::JoinHandle<Value> {
    let body =
        json!({"choices":[{"message":{"content":message},"finish_reason":"stop"}]}).to_string();
    std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut stream = loop {
            if let Ok((socket, _)) = listener.accept() {
                break socket;
            }
            assert!(
                Instant::now() < deadline,
                "expected a single local model request"
            );
            std::thread::sleep(Duration::from_millis(10));
        };
        stream.set_nonblocking(false).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let mut r = BufReader::new(&stream);
        let mut length = None;
        loop {
            let mut header = String::new();
            assert!(r.read_line(&mut header).unwrap() > 0);
            if header == "\r\n" {
                break;
            }
            if let Some(size) = header.to_lowercase().strip_prefix("content-length:") {
                length = Some(size.trim().parse::<usize>().unwrap());
            }
        }
        let mut content = vec![0; length.unwrap()];
        r.read_exact(&mut content).unwrap();
        let request = serde_json::from_slice(&content).unwrap();
        action();
        let _=write!(stream,"HTTP/1.1 {status} Fixture\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len());
        request
    })
}

fn scope(state: &AppState) -> (Workspace, library::Document) {
    let doc = library::create_document(
        &state.data_dir,
        "inbox",
        "山河.md",
        "# 值班\n云杉书屋营业至 19:30。\n不公开标记：合成干扰行。",
    )
    .unwrap();
    let ws = crate::documents::library_workspace(&state.data_dir, "inbox").unwrap();
    *state.workspace.lock().unwrap() = Some(ws.clone());
    (ws, doc)
}

#[tokio::test]
async fn scoped_unindexed_short_file_answers_one_facet_without_sending_candidates() {
    let data = tempfile::tempdir().unwrap();
    let (state, listener) = setup(data.path(), false);
    let (_, doc) = scope(&state);
    let server = serve(
        listener,
        200,
        "云杉书屋营业至 19:30[1]。钟楼演出时间待核实。",
        || {},
    );
    let q = "云杉书屋几点打烊，钟楼展演几点开场？";
    let output = crate::ask_pipeline(
        None,
        &state,
        q,
        q,
        Some(doc.path.clone()),
        "ask",
        Some(false),
        Some("keyword".into()),
        None,
        None,
        None,
        WebAccess::LocalOnly,
    )
    .await
    .unwrap();
    let sent = server.join().unwrap();
    assert_eq!(sent["stream"], true);
    assert!(!sent.to_string().contains("合成干扰行"));
    let prompt = sent["messages"][1]["content"].as_str().unwrap();
    assert!(prompt.contains("不足以核实此项"));
    assert_eq!(output.finish_reason, "stop");
    assert_eq!(output.sources.len(), 1);
    assert_eq!(
        output.sources[0].document_id.as_deref(),
        Some(doc.id.as_str())
    );
    assert_eq!(output.sources[0].start_line, 2);
    assert!(output
        .trace
        .unwrap()
        .steps
        .iter()
        .any(|s| s.contains("额外请求 0 次")));
}

fn selected_turn(data: &Path, question: &str, attachment: bool) -> (assistant::Started, String) {
    let c = assistant::create(data, assistant::GENERAL_OWNER, None, "通用".into(), None).unwrap();
    let body = "# 通知\n云杉书屋营业至 19:30。\n灯塔讲座安排另行通知。合成干扰行。";
    let (selection, id) = if attachment {
        let id = uuid::Uuid::new_v4().to_string();
        let conn = rusqlite::Connection::open(data.join("assistant.sqlite3")).unwrap();
        conn.execute(
            "INSERT INTO assistant_attachments VALUES(?,?,?,?,?)",
            rusqlite::params![id, c.id, "通知.txt", body, body.len()],
        )
        .unwrap();
        (
            Selection {
                attachments: vec![id.clone()],
                ..Default::default()
            },
            id,
        )
    } else {
        let doc = library::create_document(data, "inbox", "值班.md", body).unwrap();
        (
            Selection {
                project_id: Some("inbox".into()),
                document_ids: vec![doc.id.clone()],
                ..Default::default()
            },
            doc.id,
        )
    };
    let started = assistant::begin_with_sources(
        data,
        assistant::GENERAL_OWNER,
        &c.id,
        c.revision,
        question,
        None,
        None,
        "q",
        "keyword",
        Some(selection),
        Some(WebAccess::LocalOnly),
    )
    .unwrap();
    (started, id)
}

#[tokio::test]
async fn explicit_facts_send_a_verified_line_and_transformations_keep_selected_text() {
    for attachment in [false, true] {
        for (q, transform) in [("云杉书屋几点打烊？", false), ("请翻译成英语", true)]
        {
            let data = tempfile::tempdir().unwrap();
            let (state, listener) = setup(data.path(), false);
            let (turn, id) = selected_turn(data.path(), q, attachment);
            let server = serve(listener, 200, "合成测试输出[1]。", || {});
            let answer = assistant_runtime::general(
                None,
                &state,
                &turn,
                "q",
                "keyword",
                &Default::default(),
            )
            .await
            .unwrap();
            assert_eq!(answer.finish_reason, "stop", "{}", answer.text);
            let sent = server.join().unwrap();
            assert_eq!(sent.to_string().contains("合成干扰行"), transform);
            assert_eq!(sent["stream"], true);
            assert_eq!(answer.external_sources.len(), 1);
            assert_eq!(
                answer.external_sources[0].id,
                format!("{id}:{}", if transform { "1-3" } else { "2-2" })
            );
        }
    }
}

#[tokio::test]
async fn authorized_unanswerable_selected_file_skips_all_http_requests() {
    let data = tempfile::tempdir().unwrap();
    let (state, listener) = setup(data.path(), true);
    // A mistaken dispatch gets a connection refusal immediately and is counted by
    // the transport trace. A local refusal has no model service warning.
    drop(listener);
    let (turn, _) = selected_turn(data.path(), "钟楼展演几点开场？", false);
    let trace = crate::eval_trace::Trace::new(1, 10);
    let answer = crate::eval_trace::TRACE
        .scope(
            trace.clone(),
            assistant_runtime::general(None, &state, &turn, "q", "keyword", &Default::default()),
        )
        .await
        .unwrap();
    assert_eq!(answer.finish_reason, "no_evidence");
    assert!(answer.external_sources.is_empty());
    assert_eq!(trace.snapshot()["httpAttempts"], 0);
    assert!(answer
        .trace
        .unwrap()
        .steps
        .iter()
        .any(|s| s.contains("额外请求 0 次")));
}

#[tokio::test]
async fn changed_consent_document_attachment_or_workspace_discards_in_flight_review() {
    for change in ["consent", "document", "attachment", "workspace", "cancel"] {
        let data = tempfile::tempdir().unwrap();
        let (state, listener) = setup(data.path(), true);
        let (turn, id) = selected_turn(data.path(), "灯塔讲座几点开始？", change == "attachment");
        let mutate = state.clone();
        let server = serve(
            listener,
            200,
            r#"{"selections":[{"facet":1,"sentences":[]}]}"#,
            move || match change {
                "consent" => mutate.settings.lock().unwrap().candidate_reading = false,
                "document" => library::trash(&mutate.data_dir, &id, false).unwrap(),
                "attachment" => {
                    rusqlite::Connection::open(mutate.data_dir.join("assistant.sqlite3"))
                        .unwrap()
                        .execute("DELETE FROM assistant_attachments WHERE id=?", [id])
                        .unwrap();
                }
                "workspace" => {
                    mutate.workspace_generation.fetch_add(1, Ordering::SeqCst);
                }
                "cancel" => mutate.cancel_chat.store(true, Ordering::SeqCst),
                _ => unreachable!(),
            },
        );
        let answer =
            assistant_runtime::general(None, &state, &turn, "q", "keyword", &Default::default())
                .await;
        assert!(answer.is_err(), "{change}");
        let sent = server.join().unwrap();
        assert_eq!(sent["stream"], false);
        assert!(!sent.to_string().contains("值班.md"));
    }
}

#[tokio::test]
async fn an_unavailable_reader_makes_one_http_attempt_then_reports_service_failure() {
    let data = tempfile::tempdir().unwrap();
    let (state, listener) = setup(data.path(), true);
    let (turn, _) = selected_turn(data.path(), "灯塔讲座几点开始？", false);
    let trace = crate::eval_trace::Trace::new(4, 15);
    let server = serve(listener, 503, "temporarily unavailable", || {});
    let response = crate::eval_trace::TRACE
        .scope(
            trace.clone(),
            assistant_runtime::general(None, &state, &turn, "q", "keyword", &Default::default()),
        )
        .await
        .unwrap();
    assert_eq!(server.join().unwrap()["stream"], false);
    assert_eq!(trace.snapshot()["httpAttempts"], 1);
    assert!(response.text.contains("服务未能完成"));
    assert!(response.external_sources.is_empty());
}

#[test]
fn strict_rerank_and_revoked_or_stale_documents_never_reenter_as_candidates() {
    let data = tempfile::tempdir().unwrap();
    let (state, _) = setup(data.path(), false);
    let (ws, doc) = scope(&state);
    let body = fs::read_to_string(ws.root.join(&doc.path)).unwrap();
    let mut hit = explicit_passage(
        &doc.path,
        &doc.title,
        &files::hash(&body),
        1,
        body.lines().count(),
        body,
    );
    hit.document_id = Some(doc.id.clone());
    let mut found = SearchResponse {
        results: vec![hit],
        warning: None,
        semantic: false,
        evidence_count: 0,
        strict_reader_floor: Some(0.75),
        candidate_count: 1,
        retrieval_mode: "hybrid".into(),
        rerank_status: "applied".into(),
    };
    for score in [None, Some(0.74)] {
        found.results[0].rerank_score = score;
        assert!(
            workspace_candidates(&state, &ws, Some(&doc.path), &found, None)
                .unwrap()
                .is_empty()
        );
    }
    found.results[0].rerank_score = Some(0.75);
    assert_eq!(
        workspace_candidates(&state, &ws, Some(&doc.path), &found, None)
            .unwrap()
            .len(),
        1
    );
    found.results[0].hash = files::hash("stale");
    assert!(workspace_candidates(&state, &ws, None, &found, None).is_err());
    library::trash(data.path(), &doc.id, false).unwrap();
    assert!(workspace_candidates(&state, &ws, Some(&doc.path), &found, None).is_err());
}

#[tokio::test]
async fn small_model_budget_fits_the_json_overhead_and_returns_current_originals() {
    let data = tempfile::tempdir().unwrap();
    let (state, listener) = setup(data.path(), true);
    let mut config = crate::settings(&state).unwrap().chat;
    config.context_chars = 2000;
    let body = std::iter::once("灯塔讲座安排另行通知。".to_string())
        .chain((0..800).map(|i| format!("段{i}。")))
        .collect::<String>();
    let passage = explicit_passage("a.md", "通知", &files::hash(&body), 1, 1, body);
    let passages = [passage];
    let server = serve(
        listener,
        200,
        r#"{"selections":[{"facet":1,"sentences":[1]}]}"#,
        || {},
    );
    let result = review(
        &state,
        &config,
        &["灯塔讲座几点开始？".into()],
        &passages,
        4000,
        true,
        || true,
    )
    .await
    .unwrap();
    assert_eq!(result.stats.calls, 1);
    assert!(result.stats.chars < 2000);
    let request = server.join().unwrap();
    let messages = request["messages"].as_array().unwrap();
    assert!(
        messages
            .iter()
            .map(|m| m["content"].as_str().unwrap().chars().count())
            .sum::<usize>()
            <= config.context_chars
    );
    let quote = &result.reading.facets()[0].quotes[0];
    assert_eq!(
        verified_quote(&passages[0], quote).unwrap().text,
        "灯塔讲座安排另行通知。"
    );
}

#[tokio::test]
async fn computed_sum_uses_both_actual_selected_source_numbers_in_generator_prompt() {
    let data = tempfile::tempdir().unwrap();
    let (state, listener) = setup(data.path(), false);
    let a = library::create_document(data.path(), "inbox", "青松.md", "青松组材料费为0.10元。")
        .unwrap();
    let b = library::create_document(data.path(), "inbox", "岩雀.md", "岩雀组材料费为0.35元。")
        .unwrap();
    let c = assistant::create(
        data.path(),
        assistant::GENERAL_OWNER,
        None,
        "通用".into(),
        None,
    )
    .unwrap();
    let question = "青松组与岩雀组的材料费合计多少元？";
    let selection = Selection {
        project_id: Some("inbox".into()),
        document_ids: vec![a.id, b.id],
        ..Default::default()
    };
    let turn = assistant::begin_with_sources(
        data.path(),
        assistant::GENERAL_OWNER,
        &c.id,
        c.revision,
        question,
        None,
        None,
        "sum",
        "keyword",
        Some(selection),
        Some(WebAccess::LocalOnly),
    )
    .unwrap();
    let server = serve(listener, 200, "合计0.45元[1][2]。", || {});
    let answer =
        assistant_runtime::general(None, &state, &turn, "sum", "keyword", &Default::default())
            .await
            .unwrap();
    assert_eq!(answer.finish_reason, "stop", "{}", answer.text);
    let sent = server.join().unwrap();
    let prompt = sent["messages"][1]["content"].as_str().unwrap();
    assert!(prompt.contains("0.10 + 0.35 = 0.45"), "{prompt}");
    assert!(
        prompt.contains("青松组 0.10 元 [1]") && prompt.contains("岩雀组 0.35 元 [2]"),
        "{prompt}"
    );
}
