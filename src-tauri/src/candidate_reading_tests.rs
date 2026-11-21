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
    drop(listener);
    let trace = crate::eval_trace::Trace::new(2, 5);
    let q = "云杉书屋几点打烊，钟楼展演几点开场？";
    let output = crate::eval_trace::TRACE
        .scope(
            trace.clone(),
            crate::ask_pipeline(
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
            ),
        )
        .await
        .unwrap();
    assert_eq!(trace.snapshot()["httpAttempts"], 0);
    assert!(output.model.is_empty());
    assert!(output.text.contains("19:30。 [1]"));
    assert!(output
        .text
        .contains("钟楼展演几点开场：本轮本地片段不足以核实"));
    assert!(!output.text.contains("合成干扰行"));
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
    for change in [
        "consent",
        "document",
        "document-title",
        "attachment",
        "attachment-title",
        "attachment-owner",
        "workspace",
        "cancel",
    ] {
        let data = tempfile::tempdir().unwrap();
        let (state, listener) = setup(data.path(), true);
        let (turn, id) = selected_turn(
            data.path(),
            "灯塔讲座几点开始？",
            change.starts_with("attachment"),
        );
        let mutate = state.clone();
        let server = serve(
            listener,
            200,
            r#"{"selections":[{"facet":1,"sentences":[]}]}"#,
            move || match change {
                "consent" => mutate.settings.lock().unwrap().candidate_reading = false,
                "document" => library::trash(&mutate.data_dir, &id, false).unwrap(),
                "document-title" => library::rename(&mutate.data_dir, &id, "新资料名.md").unwrap(),
                "attachment-title" => {
                    rusqlite::Connection::open(mutate.data_dir.join("assistant.sqlite3"))
                        .unwrap()
                        .execute(
                            "UPDATE assistant_attachments SET title='新附件名.txt' WHERE id=?",
                            [id],
                        )
                        .unwrap();
                }
                "attachment-owner" => {
                    let other = assistant::create(
                        &mutate.data_dir,
                        assistant::GENERAL_OWNER,
                        None,
                        "另一会话".into(),
                        None,
                    )
                    .unwrap();
                    rusqlite::Connection::open(mutate.data_dir.join("assistant.sqlite3"))
                        .unwrap()
                        .execute(
                            "UPDATE assistant_attachments SET conversation_id=? WHERE id=?",
                            [other.id, id],
                        )
                        .unwrap();
                }
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
async fn in_flight_scope_title_binding_is_withdrawn_after_metadata_only_rename() {
    let data = tempfile::tempdir().unwrap();
    let (state, listener) = setup(data.path(), true);
    let (ws, doc) = scope(&state);
    let body = "先用清水冲洗表面。";
    fs::write(ws.root.join(&doc.path), body).unwrap();
    let hash = files::hash(body);
    let mut passage = explicit_passage(&doc.path, &doc.title, &hash, 1, 1, body.to_owned());
    passage.document_id = Some(doc.id.clone());
    let other_project = library::create_project(data.path(), "另一空间").unwrap();
    let other = library::create_document(data.path(), &other_project.id, &doc.title, body).unwrap();
    let other_ws = crate::documents::library_workspace(data.path(), &other_project.id).unwrap();
    let mut other_hit = explicit_passage(&other.path, &other.title, &hash, 1, 1, body.to_owned());
    other_hit.document_id = Some(other.id.clone());
    assert!(crate::sources_current(&state, &other_ws, &[other_hit]));
    assert!(!crate::sources_current(
        &state,
        &other_ws,
        std::slice::from_ref(&passage)
    ));
    assert!(crate::sources_current(
        &state,
        &ws,
        std::slice::from_ref(&passage)
    ));
    let mutate = state.clone();
    let server = serve(
        listener,
        200,
        r#"{"selections":[{"facet":1,"sentences":[{"id":1,"subject":"山河","predicate":"冲洗","value":"清水"}]}]}"#,
        move || library::rename(&mutate.data_dir, &doc.id, "别册.md").unwrap(),
    );
    let passages = [passage];
    let result = review(
        &state,
        &crate::settings(&state).unwrap().chat,
        &["《山河》怎么清理？".to_owned()],
        &passages,
        &[],
        4000,
        true,
        || crate::sources_current(&state, &ws, &passages),
    )
    .await;
    let packet: Value = serde_json::from_str(
        server.join().unwrap()["messages"][1]["content"]
            .as_str()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(packet["scopeTitles"], json!({"山河":[1]}));
    assert!(result.err().unwrap().contains("已变化"));
    assert_eq!(
        files::hash(fs::read_to_string(ws.root.join(&doc.path)).unwrap()),
        hash
    );
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
    found.results[0].evidence = true;
    found.results[0].start_line = 2;
    found.results[0].end_line = 2;
    let exact = fast_context(&ws, &found, 4000, Some(&doc.path), None);
    assert_eq!(exact.len(), 1);
    assert_eq!(exact[0].text, "云杉书屋营业至 19:30。");
    assert!(!exact[0].text.contains("合成干扰行"));
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
        &[],
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

#[tokio::test]
async fn indexed_space_and_general_project_keep_only_the_exact_supported_facet() {
    let data = tempfile::tempdir().unwrap();
    let (state, listener) = setup(data.path(), false);
    drop(listener);
    let (ws, doc) = scope(&state);
    let body = fs::read_to_string(ws.root.join(&doc.path)).unwrap();
    crate::db::index_text(
        &mut crate::db::open(&ws.db).unwrap(),
        &doc.path,
        &files::hash(&body),
        &crate::db::local_chunks(&body, &doc.path, 1000),
    )
    .unwrap();
    let q = "云杉书屋几点打烊，钟楼展演几点开场？";
    let trace = crate::eval_trace::Trace::new(2, 8);
    let scoped = crate::eval_trace::TRACE
        .scope(
            trace.clone(),
            crate::ask_pipeline(
                None,
                &state,
                q,
                q,
                None,
                "space",
                Some(false),
                Some("keyword".into()),
                None,
                None,
                None,
                WebAccess::LocalOnly,
            ),
        )
        .await
        .unwrap();
    assert_eq!(scoped.sources.len(), 1, "{}", scoped.text);
    assert_eq!(scoped.sources[0].start_line, 2);
    let c = assistant::create(
        data.path(),
        assistant::GENERAL_OWNER,
        None,
        "通用".into(),
        None,
    )
    .unwrap();
    let turn = assistant::begin_with_sources(
        data.path(),
        assistant::GENERAL_OWNER,
        &c.id,
        c.revision,
        q,
        None,
        None,
        "general-space",
        "keyword",
        Some(Selection {
            project_id: Some("inbox".into()),
            ..Default::default()
        }),
        Some(WebAccess::LocalOnly),
    )
    .unwrap();
    let selected = crate::eval_trace::TRACE
        .scope(
            trace.clone(),
            assistant_runtime::general(
                None,
                &state,
                &turn,
                "general-space",
                "keyword",
                &Default::default(),
            ),
        )
        .await
        .unwrap();
    assert_eq!(trace.snapshot()["httpAttempts"], 0);
    assert_eq!(selected.text, scoped.text);
    assert!(scoped.citation_checks.is_empty());
    assert!(selected.citation_checks.is_empty());
    assert_eq!(selected.external_sources.len(), 1);
    assert_eq!(selected.external_sources[0].id, format!("{}:2-2", doc.id));
    assert_eq!(
        selected.external_sources[0].excerpt.as_deref(),
        Some("云杉书屋营业至 19:30。")
    );
    let persisted = assistant::finish(
        data.path(),
        assistant::GENERAL_OWNER,
        &turn,
        Ok(&selected),
        false,
    )
    .unwrap();
    assert_eq!(persisted.turns[0].candidates[0].status, "complete");
}

#[tokio::test]
async fn weekday_followup_reads_new_day_and_changed_selection_drops_old_subject() {
    let data = tempfile::tempdir().unwrap();
    let (state, listener) = setup(data.path(), false);
    let body = "云杉书屋周六营业至 19:30。\n云杉书屋周日营业至 17:00。\n梧桐书屋周日营业至 16:00。";
    let doc = library::create_document(data.path(), "inbox", "服务时间.md", body).unwrap();
    let other =
        library::create_document(data.path(), "inbox", "其他通知.md", "另一项安排。").unwrap();
    let c = assistant::create(
        data.path(),
        assistant::GENERAL_OWNER,
        None,
        "通用".into(),
        None,
    )
    .unwrap();
    let begin = |rev, doc: &str, q: &str, parent: Option<&str>, req: &str| {
        assistant::begin_with_sources(
            data.path(),
            assistant::GENERAL_OWNER,
            &c.id,
            rev,
            q,
            parent,
            None,
            req,
            "keyword",
            Some(Selection {
                project_id: Some("inbox".into()),
                document_ids: vec![doc.to_string()],
                ..Default::default()
            }),
            Some(WebAccess::LocalOnly),
        )
        .unwrap()
    };
    let parent = begin(c.revision, &doc.id, "周六云杉书屋几点打烊？", None, "sat");
    let server = serve(
        listener.try_clone().unwrap(),
        200,
        "旧回答误写为梧桐书屋 16:00[1]。",
        || {},
    );
    let first =
        assistant_runtime::general(None, &state, &parent, "sat", "keyword", &Default::default())
            .await
            .unwrap();
    assert_eq!(first.external_sources[0].id, format!("{}:1-1", doc.id));
    server.join().unwrap();
    let c = assistant::finish(
        data.path(),
        assistant::GENERAL_OWNER,
        &parent,
        Ok(&first),
        false,
    )
    .unwrap();
    let sunday = begin(
        c.revision,
        &doc.id,
        "那周日呢？",
        Some(&parent.turn_id),
        "sun",
    );
    let server = serve(listener, 200, "周日营业至 17:00[1]。", || {});
    let result =
        assistant_runtime::general(None, &state, &sunday, "sun", "keyword", &Default::default())
            .await
            .unwrap();
    assert_eq!(result.external_sources.len(), 1);
    assert_eq!(result.external_sources[0].id, format!("{}:2-2", doc.id));
    let sent = server.join().unwrap().to_string();
    assert!(!sent.contains("16:00") && !sent.contains("19:30") && !sent.contains("误写"));
    let c = assistant::finish(
        data.path(),
        assistant::GENERAL_OWNER,
        &sunday,
        Ok(&result),
        false,
    )
    .unwrap();
    let switched = begin(
        c.revision,
        &other.id,
        "那周一呢？",
        Some(&sunday.turn_id),
        "switch",
    );
    assert!(switched.previous_questions.is_empty());
    let trace = crate::eval_trace::Trace::new(1, 2);
    let answer = crate::eval_trace::TRACE
        .scope(
            trace.clone(),
            assistant_runtime::general(
                None,
                &state,
                &switched,
                "switch",
                "keyword",
                &Default::default(),
            ),
        )
        .await
        .unwrap();
    assert_eq!(trace.snapshot()["httpAttempts"], 0);
    assert!(answer.text.contains("周一") && answer.text.contains("哪个对象"));
    assert!(answer.external_sources.is_empty());
}

#[tokio::test]
async fn explicit_unknown_is_quotable_while_an_absent_facet_is_named_without_citation() {
    let data = tempfile::tempdir().unwrap();
    let (state, listener) = setup(data.path(), false);
    drop(listener);
    let doc = library::create_document(
        data.path(),
        "inbox",
        "近期活动.md",
        "灯塔讲座开始时间另行通知。",
    )
    .unwrap();
    let ws = crate::documents::library_workspace(data.path(), "inbox").unwrap();
    *state.workspace.lock().unwrap() = Some(ws);
    let q = "灯塔讲座几点开始，钟楼展演几点开场？";
    let trace = crate::eval_trace::Trace::new(1, 3);
    let result = crate::eval_trace::TRACE
        .scope(
            trace.clone(),
            crate::ask_pipeline(
                None,
                &state,
                q,
                q,
                Some(doc.path),
                "unknown",
                Some(false),
                Some("keyword".into()),
                None,
                None,
                None,
                WebAccess::LocalOnly,
            ),
        )
        .await
        .unwrap();
    assert_eq!(trace.snapshot()["httpAttempts"], 0);
    assert_eq!(result.sources.len(), 1);
    assert!(
        result.text.contains("灯塔讲座开始时间另行通知。 [1]"),
        "{}",
        result.text
    );
    assert!(result
        .text
        .contains("钟楼展演几点开场：本轮本地片段不足以核实"));
}

#[tokio::test]
async fn qualified_provider_choice_is_reread_before_a_partial_answer_is_saved() {
    let data = tempfile::tempdir().unwrap();
    let (state, listener) = setup(data.path(), true);
    let body = "霜灯站把捡到的雨具寄存在蓝木箱。";
    let doc = library::create_document(data.path(), "inbox", "失物管理.md", body).unwrap();
    let c = assistant::create(
        data.path(),
        assistant::GENERAL_OWNER,
        None,
        "通用".into(),
        None,
    )
    .unwrap();
    let turn = assistant::begin_with_sources(
        data.path(),
        assistant::GENERAL_OWNER,
        &c.id,
        c.revision,
        "霜灯站遗失的伞应该去哪里领？钟楼展演几点开场？",
        None,
        None,
        "semantic",
        "keyword",
        Some(Selection {
            project_id: Some("inbox".into()),
            document_ids: vec![doc.id.clone()],
            ..Default::default()
        }),
        Some(WebAccess::LocalOnly),
    )
    .unwrap();
    let server = serve(
        listener,
        200,
        r#"{"selections":[{"facet":1,"sentences":[{"id":1,"subject":"霜灯站","predicate":"寄存在","value":"蓝木箱"}]},{"facet":2,"sentences":[]}]}"#,
        || {},
    );
    let trace = crate::eval_trace::Trace::new(2, 8);
    let result = crate::eval_trace::TRACE
        .scope(
            trace.clone(),
            assistant_runtime::general(
                None,
                &state,
                &turn,
                "semantic",
                "keyword",
                &Default::default(),
            ),
        )
        .await
        .unwrap();
    assert_eq!(trace.snapshot()["httpAttempts"], 1);
    let sent = server.join().unwrap();
    assert_eq!(sent["stream"], false);
    assert!(!sent.to_string().contains("失物管理.md"));
    assert!(result.text.contains("蓝木箱。 [1]"), "{}", result.text);
    assert!(result
        .text
        .contains("钟楼展演几点开场：本轮本地片段不足以核实"));
    assert_eq!(result.external_sources[0].id, format!("{}:1-1", doc.id));
    let c = assistant::finish(
        data.path(),
        assistant::GENERAL_OWNER,
        &turn,
        Ok(&result),
        false,
    )
    .unwrap();
    assert_eq!(c.turns[0].candidates[0].status, "complete");
}

#[tokio::test]
async fn previous_no_evidence_can_recover_a_user_named_subject_on_another_day() {
    let data = tempfile::tempdir().unwrap();
    let (state, listener) = setup(data.path(), false);
    let body = "云杉书屋周日营业至 17:00。";
    let doc = library::create_document(data.path(), "inbox", "新开时段.md", body).unwrap();
    let ws = crate::documents::library_workspace(data.path(), "inbox").unwrap();
    *state.workspace.lock().unwrap() = Some(ws.clone());
    let owner = assistant::workspace_id(data.path(), &ws);
    let c = assistant::create(
        data.path(),
        &owner,
        Some(doc.path.clone()),
        "此文档".into(),
        None,
    )
    .unwrap();
    let sat = assistant::begin_with_mode(
        data.path(),
        &owner,
        &c.id,
        c.revision,
        "周六云杉书屋几点打烊？",
        None,
        None,
        "sat",
        "keyword",
    )
    .unwrap();
    let first = crate::ask_pipeline(
        None,
        &state,
        &sat.grounded_question,
        &sat.prompt_question,
        sat.scope.clone(),
        "sat",
        Some(false),
        Some("keyword".into()),
        None,
        None,
        None,
        WebAccess::LocalOnly,
    )
    .await
    .unwrap();
    assert_eq!(first.finish_reason, "no_evidence");
    let c = assistant::finish(data.path(), &owner, &sat, Ok(&first), false).unwrap();
    let sun = assistant::begin_with_mode(
        data.path(),
        &owner,
        &c.id,
        c.revision,
        "那周日呢？",
        Some(&sat.turn_id),
        None,
        "sun",
        "keyword",
    )
    .unwrap();
    let prepared = assistant::grounding::prepare(data.path(), &ws, &sun).unwrap();
    assert_eq!(prepared.retrieval_question, "周日云杉书屋几点打烊？");
    let server = serve(listener, 200, "周日营业至 17:00[1]。", || {});
    let answer = crate::ask_pipeline(
        None,
        &state,
        &prepared.retrieval_question,
        &sun.prompt_question,
        sun.scope.clone(),
        "sun",
        Some(false),
        Some("keyword".into()),
        prepared.gate.as_ref(),
        None,
        None,
        WebAccess::LocalOnly,
    )
    .await
    .unwrap();
    let sent = server.join().unwrap().to_string();
    assert!(!sent.contains("本轮指定的本地片段不足以核实"));
    assert_eq!(answer.sources[0].text, body);
    assert_eq!(answer.sources[0].document_id, Some(doc.id));
}

#[test]
fn generated_literal_reference_does_not_suppress_clickable_facet_citation() {
    let coverage = FacetCoverage(vec![("甲项".into(), vec![1]), ("乙项".into(), vec![2])]);
    let mut markdown = "甲项已核实[1]。示例数据为 `[2]`。".to_owned();
    coverage.complete_text(&mut markdown, |id| Some(format!("第{id}项原句")));
    assert!(markdown.contains("乙项：第2项原句 [2]"));
    assert!(!markdown.contains("第1项原句"));
}

#[test]
fn previously_admitted_typed_statement_recovers_only_the_matching_clause_in_its_range() {
    let text = "青棠样品只登记频率 18 kHz，采购费用未复核。\n下雪仍开放。\n普通故障须在30分钟内确认；未来方案仅供讨论。";
    let passage = explicit_passage("a.md", "值班", &files::hash(text), 4, 6, text.into());
    let mut admitted = passage.clone();
    admitted.evidence = true;
    admitted.end_line = 5;
    let facets = vec![
        "青棠样品的频率是多少".to_string(),
        "青棠样品的频率是多少MHz".to_string(),
        "青棠样品二型的频率是多少".to_string(),
        "下雪还开吗".to_string(),
        "普通故障确认收到的时限是多少".to_string(),
    ];
    let mut reading =
        evidence_reader::prepare_facets(&facets, std::slice::from_ref(&passage), 3000);
    reading.recover_fast(std::slice::from_ref(&passage), &[admitted.clone()]);
    assert_eq!(
        reading.facets()[0].quotes[0].text,
        "青棠样品只登记频率 18 kHz"
    );
    assert!(reading.facets()[1].quotes.is_empty());
    assert!(reading.facets()[2].quotes.is_empty());
    assert_eq!(reading.facets()[3].quotes[0].start_line, 5);
    assert!(reading.facets()[4].quotes.is_empty());
    admitted.hash = files::hash("other revision");
    let mut stale =
        evidence_reader::prepare_facets(&facets[0..1], std::slice::from_ref(&passage), 3000);
    stale.recover_fast(&[passage], &[admitted]);
    assert!(stale.facets()[0].quotes.is_empty());
}

#[tokio::test]
async fn all_unresolved_facets_can_reuse_authorized_search_context_without_claiming_verification() {
    let data = tempfile::tempdir().unwrap();
    let (state, listener) = setup(data.path(), false);
    let content = "巡演社琴房可以借用两套调音叉，须在退场时归还。";
    let doc =
        library::create_document(data.path(), "inbox", "巡演社琴房借用说明.md", content).unwrap();
    let ws = crate::documents::library_workspace(data.path(), "inbox").unwrap();
    *state.workspace.lock().unwrap() = Some(ws.clone());
    crate::db::index_text(
        &mut crate::db::open(&ws.db).unwrap(),
        &doc.path,
        &files::hash(content),
        &crate::db::local_chunks(content, &doc.path, 1000),
    )
    .unwrap();
    let q = "巡演社琴房能借什么、能借多少、什么时候还？";
    for entry in ["document", "space", "general"] {
        let server = serve(listener.try_clone().unwrap(), 200, "退场时归还[1]。", || {});
        let trace = crate::eval_trace::Trace::new(2, 6);
        let answer = if entry == "general" {
            let c = assistant::create(
                data.path(),
                assistant::GENERAL_OWNER,
                None,
                "通用".into(),
                None,
            )
            .unwrap();
            let turn = assistant::begin_with_sources(
                data.path(),
                assistant::GENERAL_OWNER,
                &c.id,
                c.revision,
                q,
                None,
                None,
                entry,
                "keyword",
                Some(Selection {
                    project_id: Some("inbox".into()),
                    ..Default::default()
                }),
                Some(WebAccess::LocalOnly),
            )
            .unwrap();
            crate::eval_trace::TRACE
                .scope(
                    trace.clone(),
                    assistant_runtime::general(
                        None,
                        &state,
                        &turn,
                        entry,
                        "keyword",
                        &Default::default(),
                    ),
                )
                .await
                .unwrap()
        } else {
            crate::eval_trace::TRACE
                .scope(
                    trace.clone(),
                    crate::ask_pipeline(
                        None,
                        &state,
                        q,
                        q,
                        (entry == "document").then(|| doc.path.clone()),
                        entry,
                        Some(false),
                        Some("keyword".into()),
                        None,
                        None,
                        None,
                        WebAccess::LocalOnly,
                    ),
                )
                .await
                .unwrap()
        };
        assert_eq!(
            trace.snapshot()["httpAttempts"],
            1,
            "{entry}: {}",
            answer.text
        );
        let request = server.join().unwrap();
        assert_eq!(request["stream"], true);
        let prompt = request["messages"][1]["content"].as_str().unwrap();
        assert!(
            prompt.contains(RELATED_NOTE) && prompt.contains(content),
            "{entry}: {prompt}"
        );
        assert!(!prompt.contains("只依据 [1] 回答此项"));
        assert!(answer
            .trace
            .unwrap()
            .steps
            .iter()
            .any(|s| s.contains(RELATED_STATUS)));
        assert_eq!(answer.sources.len() + answer.external_sources.len(), 1);
        if entry != "general" {
            assert_eq!(answer.sources[0].match_kind, "related-original");
        }
    }
}

#[test]
fn related_context_keeps_strict_scope_and_rejects_known_conflicts() {
    let data = tempfile::tempdir().unwrap();
    let (state, _) = setup(data.path(), false);
    let (ws, doc) = scope(&state);
    let body = fs::read_to_string(ws.root.join(&doc.path)).unwrap();
    let mut hit = explicit_passage(
        &doc.path,
        &doc.title,
        &files::hash(&body),
        2,
        2,
        "云杉书屋营业至 19:30。".into(),
    );
    hit.document_id = Some(doc.id);
    hit.evidence = true;
    let mut found = SearchResponse {
        results: vec![hit.clone()],
        warning: None,
        semantic: false,
        evidence_count: 1,
        strict_reader_floor: Some(0.75),
        candidate_count: 1,
        retrieval_mode: "rerank".into(),
        rerank_status: "applied".into(),
    };
    assert!(related_originals(&ws, &found, 4000, None, None, "云杉书屋几点打烊？").is_empty());
    found.results[0].rerank_score = Some(0.85);
    assert!(related_originals(
        &ws,
        &found,
        4000,
        Some("foreign.md"),
        None,
        "云杉书屋几点打烊？"
    )
    .is_empty());
    let related = related_originals(&ws, &found, 4000, None, None, "云杉书屋几点打烊？");
    assert_eq!(related.len(), 1);
    assert_eq!(related[0].start_line, 2);
    assert!(!related[0].text.contains("合成干扰行"));
    found.results[0].evidence = false;
    assert!(related_originals(&ws, &found, 4000, None, None, "云杉书屋几点打烊？").is_empty());
    for (q, bad) in [
        ("周日书屋几点关门？", "周六书屋营业至 19:00。"),
        ("雾灯的色温和电压分别是什么？", "霜河的色温为 3000 K。"),
        ("水星站几点关闭？", "水星站二号馆营业至 19:00。"),
        ("青田馆几点关闭？", "青田馆并非 19:00 关闭。"),
        ("青田馆几点关闭？", "草案：青田馆营业至 19:00。"),
        (
            "2027年5月4日青田馆几点关闭？",
            "2027年5月6日青田馆营业至 19:00。",
        ),
    ] {
        hit.text = bad.into();
        assert!(
            evidence_reader::compatible_original_lines(q, &hit).is_empty(),
            "{q} / {bad}"
        );
    }
}
