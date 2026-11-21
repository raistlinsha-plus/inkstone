//! Opt-in live scoring input. All content comes from the frozen synthetic fixture.
mod independent;

use crate::{
    assistant, assistant_sources::WebAccess, db, documents, eval_trace, files, library, models,
    providers, AppState, Settings,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

const FIXTURE: &str = include_str!("../../evals/v0.8.6/grounded-holdout.json");
const RUBRIC: &str = include_str!("../../evals/v0.8.6/RUBRIC.md");
const HASHES: &str = include_str!("../../evals/v0.8.6/SHA256SUMS");
const NEXT_FIXTURE: &str = include_str!("../../evals/v0.9.1/grounded-holdout.json");
const NEXT_RUBRIC: &str = include_str!("../../evals/v0.9.1/RUBRIC.md");
const NEXT_HASHES: &str = include_str!("../../evals/v0.9.1/SHA256SUMS");

struct Suite {
    id: &'static str,
    env_prefix: &'static str,
    fixture: &'static str,
    rubric: &'static str,
    hashes: &'static str,
    max_requests: usize,
    max_seconds: u64,
}

const ORIGINAL: Suite = Suite {
    id: "v086",
    env_prefix: "INKSTONE_086",
    fixture: FIXTURE,
    rubric: RUBRIC,
    hashes: HASHES,
    max_requests: 40,
    max_seconds: 240,
};

const EXTENDED: Suite = Suite {
    id: "v091",
    env_prefix: "INKSTONE_091",
    fixture: NEXT_FIXTURE,
    rubric: NEXT_RUBRIC,
    hashes: NEXT_HASHES,
    max_requests: 160,
    max_seconds: 600,
};

#[derive(Deserialize)]
struct Fixture {
    documents: Vec<Document>,
    cases: Vec<Case>,
    #[serde(default)]
    spaces: HashMap<String, Vec<String>>,
}

#[derive(Deserialize)]
struct Document {
    id: String,
    title: String,
    text: String,
}

#[derive(Deserialize)]
struct Case {
    id: String,
    conversation: String,
    space: Option<String>,
    question: String,
    documents: Vec<String>,
    expected: String,
    required: Vec<Requirement>,
}

#[derive(Deserialize)]
struct Requirement {
    document: String,
    quote: String,
    claim: String,
}

fn fixture(suite: &Suite) -> Fixture {
    let expected: Vec<_> = suite.hashes.lines().collect();
    assert_eq!(expected.len(), 2);
    for (line, bytes) in expected.into_iter().zip([suite.fixture, suite.rubric]) {
        assert_eq!(files::hash(bytes), line.split_whitespace().next().unwrap());
    }
    serde_json::from_str(suite.fixture).expect("valid frozen fixture")
}

#[test]
fn frozen_holdout_declares_valid_evidence_and_an_unselected_distractor() {
    let f = fixture(&ORIGINAL);
    check_requirements(&f);
    assert_eq!(f.cases.len(), 12);
    assert_eq!(f.cases.iter().filter(|q| q.expected == "refuse").count(), 3);
    let private = f.documents.iter().find(|d| d.id == "staging").unwrap();
    assert!(private.text.contains("240元"));
    assert!(f.cases.iter().all(|q| !q.documents.contains(&private.id)));
}

#[test]
fn extended_holdout_declares_scopes_and_frozen_requirements() {
    let f = fixture(&EXTENDED);
    check_requirements(&f);
    assert_eq!(f.cases.len(), 40);
    assert_eq!(f.spaces.len(), 5);
    assert_eq!(f.cases.iter().filter(|q| q.expected == "refuse").count(), 6);
    assert!(f
        .documents
        .iter()
        .filter(|d| d.id.ends_with("-private"))
        .all(|d| { f.cases.iter().all(|q| !q.documents.contains(&d.id)) }));
}

fn check_requirements(f: &Fixture) {
    let mut ids = HashSet::new();
    let mut conversations = HashMap::new();
    for case in &f.cases {
        assert!(ids.insert(&case.id));
        assert!(!case.documents.is_empty());
        if let Some(space) = &case.space {
            assert!(case.documents.iter().all(|d| f.spaces[space].contains(d)));
        }
        if case.conversation != "standalone" {
            let previous = conversations.insert(&case.conversation, &case.documents);
            assert!(previous.is_none_or(|previous| previous == &case.documents));
        }
        assert_eq!(case.expected == "refuse", case.required.is_empty());
        for requirement in &case.required {
            assert!(case.documents.contains(&requirement.document));
            let document = f
                .documents
                .iter()
                .find(|d| d.id == requirement.document)
                .unwrap();
            assert!(document.text.contains(&requirement.quote));
            assert!(!requirement.claim.is_empty());
        }
    }
}

fn isolated_state(data: &Path, settings: Settings) -> Result<AppState, &'static str> {
    Ok(AppState {
        credentials: Default::default(),
        workspace: Mutex::new(None),
        workspace_generation: AtomicU64::new(0),
        settings: Mutex::new(settings),
        settings_write: Mutex::new(()),
        // Only address-bound saved credentials. No legacy migration during an evaluation.
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
        data_dir: data.to_path_buf(),
        config_file: data.join("settings.json"),
        client: reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(35))
            .build()
            .map_err(|_| "provider-client-setup-failed")?,
    })
}

struct FixtureWorkspace {
    workspace: models::Workspace,
    paths: HashMap<String, String>,
}

fn workspace_members(fixture: &Fixture, case: &Case) -> Vec<String> {
    let mut members = match &case.space {
        Some(space) if case.documents.len() == 1 => fixture.spaces[space].clone(),
        Some(_) => case.documents.clone(),
        None => match case.documents[0].as_str() {
            "shuttle" => vec!["shuttle".into(), "march".into()],
            "hall" if case.documents.len() == 1 => vec!["hall".into(), "staging".into()],
            _ => case.documents.clone(),
        },
    };
    members.sort();
    members
}

fn copy_fixture(
    data: &Path,
    fixture: &Fixture,
    embeddings: Option<(&models::Provider, &HashMap<String, Vec<Vec<f32>>>)>,
) -> Result<HashMap<Vec<String>, FixtureWorkspace>, String> {
    let mut workspaces = HashMap::new();
    for case in &fixture.cases {
        let members = workspace_members(fixture, case);
        if workspaces.contains_key(&members) {
            continue;
        }
        let project = library::create_project(data, &format!("评测空间 {}", workspaces.len() + 1))?;
        let ws = documents::library_workspace(data, &project.id)?;
        let mut conn = db::open(&ws.db)?;
        let mut paths = HashMap::new();
        for doc in fixture
            .documents
            .iter()
            .filter(|doc| members.contains(&doc.id))
        {
            let managed = library::create_document(data, &project.id, &doc.title, &doc.text)?;
            let hash = files::hash(&doc.text);
            let ids = db::index_text(&mut conn, &managed.path, &hash, &chunks(doc))?;
            db::update_title(&conn, &managed.path, &doc.title)?;
            if let Some((provider, vectors)) = embeddings.and_then(|(provider, vectors)| {
                vectors.get(&doc.id).map(|values| (provider, values))
            }) {
                db::put_vectors_checked(
                    &mut conn,
                    &managed.path,
                    &hash,
                    &providers::fingerprint(provider),
                    &ids,
                    vectors,
                )?;
            }
            paths.insert(doc.id.clone(), managed.path);
        }
        workspaces.insert(
            members,
            FixtureWorkspace {
                workspace: ws,
                paths,
            },
        );
    }
    Ok(workspaces)
}

fn chunks(doc: &Document) -> Vec<models::ChunkInput> {
    db::local_chunks(&doc.text, "fixture.md", 1200)
}

async fn embed_fixture(
    state: &AppState,
    fixture: &Fixture,
    config: &models::Provider,
    key: &str,
) -> Result<HashMap<String, Vec<Vec<f32>>>, &'static str> {
    let mut names = Vec::new();
    let mut inputs = Vec::new();
    for doc in &fixture.documents {
        // The scope-negative distractor is indexed lexically only, so its text is
        // absent from outbound evaluation requests, even during index preparation.
        if !fixture
            .cases
            .iter()
            .any(|case| case.documents.contains(&doc.id))
        {
            continue;
        }
        for chunk in chunks(doc) {
            names.push(doc.id.clone());
            inputs.push(format!("{}\n\n{}", chunk.heading, chunk.text));
        }
    }
    let vectors = providers::embed(
        &state.client,
        config,
        Some(key),
        &inputs,
        &state.cancel_index,
    )
    .await
    .map_err(|_| "fixture-embedding-failed")?;
    let mut documents = HashMap::<_, Vec<_>>::new();
    for (name, vector) in names.into_iter().zip(vectors) {
        documents.entry(name).or_default().push(vector);
    }
    Ok(documents)
}

fn save_report(path: &Path, report: &Value, secrets: &[String]) -> Result<(), &'static str> {
    let mut report = report.clone();
    fn redact(value: &mut Value, secrets: &[String]) {
        match value {
            Value::String(text) => {
                for secret in secrets {
                    *text = text.replace(secret, "[redacted]");
                }
            }
            Value::Object(object) => object.values_mut().for_each(|value| redact(value, secrets)),
            Value::Array(array) => array.iter_mut().for_each(|value| redact(value, secrets)),
            _ => {}
        }
    }
    redact(&mut report, secrets);
    let bytes = serde_json::to_vec_pretty(&report).map_err(|_| "report-encoding-failed")?;
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).map_err(|_| "report-create-failed")?;
    file.write_all(&bytes).map_err(|_| "report-write-failed")
}

pub(crate) fn saved_settings() -> Result<Settings, &'static str> {
    let path = PathBuf::from(std::env::var_os("HOME").ok_or("missing home directory")?)
        .join("Library/Application Support/local.inkstone.desktop/settings.json");
    let bytes = fs::read(path).map_err(|_| "saved settings are unavailable")?;
    let (config, _) = crate::decode_saved_config(&bytes).ok_or("saved settings are invalid")?;
    Ok(config.settings)
}

pub(crate) async fn saved_key(
    state: &AppState,
    role: &str,
    address: &str,
) -> Result<String, &'static str> {
    // Explicit live runs can leave an OS authorization prompt open for the tester.
    // Polling observes the same in-flight keychain request; interactive desktop reads keep their usual timeout.
    let wait = std::env::var("INKSTONE_EVAL_KEYCHAIN_WAIT_SECONDS")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0)
        .min(300);
    let deadline = std::time::Instant::now() + Duration::from_secs(wait);
    loop {
        match crate::read_key(state, role, address, &state.cancel_chat).await {
            Err(error)
                if error == crate::credentials::PENDING && std::time::Instant::now() < deadline =>
            {
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
            value => {
                return match value {
                    Ok(Some(key)) if !key.trim().is_empty() => Ok(key),
                    Err(error) if error == crate::credentials::PENDING => {
                        Err("keychain-authorization-pending")
                    }
                    Err(_) => Err("keychain-read-failed"),
                    _ => Err("saved-address-bound-key-missing"),
                }
            }
        }
    }
}

#[test]
#[ignore = "Explicit live evaluation with saved address-bound keys and synthetic documents only"]
fn live_grounded_holdout() -> Result<(), &'static str> {
    run_live(&ORIGINAL)
}

#[test]
#[ignore = "Explicit live evaluation with saved address-bound keys and synthetic documents only"]
fn live_extended_holdout() -> Result<(), &'static str> {
    run_live(&EXTENDED)
}

fn run_live(suite: &Suite) -> Result<(), &'static str> {
    if std::env::var(format!("{}_LIVE", suite.env_prefix)).as_deref() != Ok("1")
        || cfg!(feature = "desktop-e2e")
    {
        return Err("requires the suite's explicit LIVE=1 and the standard build");
    }
    let mode = std::env::var(format!("{}_MODE", suite.env_prefix))
        .map_err(|_| "choose keyword, hybrid or rerank")?;
    if !matches!(mode.as_str(), "keyword" | "hybrid" | "rerank") {
        return Err("choose keyword, hybrid or rerank");
    }
    let config = saved_settings()?;
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|_| "runtime initialization failed")?;
    let result = runtime.block_on(grounded_holdout(suite, &mode, config, true));
    // A timed-out macOS system authorization may still own the native
    // credential thread. This explicit test must report without waiting on it.
    runtime.shutdown_background();
    result
}

#[tokio::test]
#[ignore = "Explicit report destination for the offline evidence check"]
async fn offline_grounded_holdout() -> Result<(), &'static str> {
    grounded_holdout(&ORIGINAL, "keyword", Settings::default(), false).await
}

#[tokio::test]
#[ignore = "Explicit report destination for the offline evidence check"]
async fn offline_extended_holdout() -> Result<(), &'static str> {
    grounded_holdout(&EXTENDED, "keyword", Settings::default(), false).await
}

async fn offline_context(
    state: &AppState,
    ws: &models::Workspace,
    started: &assistant::Started,
    prepared: &assistant::grounding::Prepared,
    budget: usize,
) -> Result<(models::ChatResponse, Vec<models::SearchResult>), String> {
    let mut found = crate::search_inner(
        state,
        &prepared.retrieval_question,
        started.scope.as_deref(),
        false,
        Some("keyword"),
        &state.cancel_chat,
        None,
    )
    .await?;
    if let Some(gate) = &prepared.gate {
        assistant::grounding::tighten(gate, &mut found.results);
    }
    let budget = budget.saturating_sub(
        started.prompt_question.chars().count() + providers::ANSWER_SYSTEM.chars().count() + 500,
    );
    let sources =
        crate::retrieval::generation_context(ws, &found.results, budget, started.scope.is_some());
    Ok((
        models::ChatResponse {
            external_sources: vec![],
            trace: None,
            memory: None,
            finish_reason: "offline_evidence_only".into(),
            text: String::new(),
            sources,
            warning: found.warning,
            retrieval_mode: found.retrieval_mode,
            rerank_status: found.rerank_status,
            model: String::new(),
            scope: started.scope.clone(),
            chart_warnings: vec![],
            rejected_charts: vec![],
            citation_checks: vec![],
        },
        found.results,
    ))
}

struct ReportTarget<'a> {
    path: PathBuf,
    fixture_hash: &'a str,
    rubric_hash: Option<&'a str>,
}

fn report_path(suite: &Suite) -> Result<PathBuf, &'static str> {
    std::env::var_os(format!("{}_REPORT", suite.env_prefix))
        .map(PathBuf::from)
        .ok_or("report path required")
}

async fn grounded_holdout(
    suite: &Suite,
    mode: &str,
    config: Settings,
    live: bool,
) -> Result<(), &'static str> {
    run_fixture(
        suite,
        mode,
        config,
        live,
        fixture(suite),
        ReportTarget {
            path: report_path(suite)?,
            fixture_hash: &files::hash(suite.fixture),
            rubric_hash: Some(&files::hash(suite.rubric)),
        },
    )
    .await
}

async fn run_fixture(
    suite: &Suite,
    mode: &str,
    config: Settings,
    live: bool,
    fixture: Fixture,
    target: ReportTarget<'_>,
) -> Result<(), &'static str> {
    let ReportTarget {
        path,
        fixture_hash,
        rubric_hash,
    } = target;
    if !path.is_absolute() || path.exists() {
        return Err("use an unused absolute report path");
    }
    if live && (!config.chat.enabled || providers::validate(&config.chat).is_err()) {
        return Err("enable a valid saved chat service");
    }
    if mode != "keyword"
        && (!config.embedding.enabled || providers::validate(&config.embedding).is_err())
    {
        return Err("configure a saved embedding service to run hybrid or rerank mode");
    }
    if mode == "rerank"
        && (!config.rerank.enabled || providers::validate_reranker(&config.rerank).is_err())
    {
        return Err("configure saved embedding and reranking services to run rerank mode");
    }
    let data = tempfile::tempdir().map_err(|_| "isolation setup failed")?;
    let state = isolated_state(data.path(), config.clone())?;
    let trace = eval_trace::Trace::new(suite.max_requests, suite.max_seconds);
    let mut keys = Vec::new();
    let mut rows = Vec::new();
    let mut stage = "setup";
    let operation = async {
        if live {
            stage = "read-chat-key";
            keys.push(saved_key(&state, "chat", &config.chat.base_url).await?);
        }
        let vectors = if mode != "keyword" {
            stage = "read-embedding-key";
            keys.push(saved_key(&state, "embedding", &config.embedding.base_url).await?);
            if mode == "rerank" {
                stage = "read-rerank-key";
                keys.push(saved_key(&state, "rerank", &config.rerank.endpoint).await?);
            }
            stage = "embed-fixture";
            Some(embed_fixture(&state, &fixture, &config.embedding, &keys[1]).await?)
        } else {
            None
        };
        stage = "index-fixture";
        let spaces = copy_fixture(
            data.path(),
            &fixture,
            vectors.as_ref().map(|vectors| (&config.embedding, vectors)),
        )
        .map_err(|_| "fixture-index-failed")?;
        let mut conversations = HashMap::new();
        for case in &fixture.cases {
            stage = "evaluate-question";
            let FixtureWorkspace {
                workspace: ws,
                paths,
            } = &spaces[&workspace_members(&fixture, case)];
            *state.workspace.lock().unwrap() = Some(ws.clone());
            let owner = assistant::workspace_id(data.path(), ws);
            let scope = (case.documents.len() == 1).then(|| paths[&case.documents[0]].clone());
            let conversation_key = if case.conversation == "standalone" {
                &case.id
            } else {
                &case.conversation
            };
            let conversation: assistant::Conversation = match conversations.remove(conversation_key)
            {
                Some(conversation) => conversation,
                None => assistant::create(data.path(), &owner, scope, "合成资料".into(), None)
                    .map_err(|_| "fixture-conversation-failed")?,
            };
            let request = format!("{}-{}", suite.id, case.id);
            let _busy = crate::begin_chat(&state, &request).map_err(|_| "fixture-turn-busy")?;
            let started = assistant::begin_with_sources(
                data.path(),
                &owner,
                &conversation.id,
                conversation.revision,
                &case.question,
                conversation.active_leaf_id.as_deref(),
                None,
                &request,
                mode,
                None,
                Some(WebAccess::LocalOnly),
            )
            .map_err(|_| "fixture-turn-failed")?;
            let start = Instant::now();
            let before = trace.snapshot()["httpAttempts"]
                .as_u64()
                .unwrap_or_default();
            let prepared = assistant::grounding::prepare(data.path(), ws, &started)
                .map_err(|_| "fixture-grounding-prepare-failed")?;
            let mut offline_hits = None;
            let (answer, clarification, failure) = if let Some(text) = prepared.clarification {
                let response = models::ChatResponse {
                    external_sources: vec![],
                    trace: None,
                    memory: None,
                    finish_reason: "no_evidence".into(),
                    text: text.clone(),
                    sources: vec![],
                    warning: Some("追问需要明确当前对象或指标，未调用模型。".into()),
                    retrieval_mode: "none".into(),
                    rerank_status: "not-requested".into(),
                    model: String::new(),
                    scope: started.scope.clone(),
                    chart_warnings: vec![],
                    rejected_charts: vec![],
                    citation_checks: vec![],
                };
                (Some(response), Some(text), None)
            } else {
                let result = if live {
                    crate::ask_pipeline(
                        None,
                        &state,
                        &prepared.retrieval_question,
                        &started.prompt_question,
                        started.scope.clone(),
                        &request,
                        None,
                        Some(mode.to_owned()),
                        prepared.gate.as_ref(),
                        Some(assistant::memory::Run {
                            workspace: owner.clone(),
                            options: Default::default(),
                        }),
                        Some(&started.grounded_question),
                        started.web_access,
                    )
                    .await
                } else {
                    offline_context(&state, ws, &started, &prepared, config.chat.context_chars)
                        .await
                        .map(|(response, hits)| {
                            offline_hits = Some(hits);
                            response
                        })
                };
                match result {
                    Ok(response) => (Some(response), None, None),
                    Err(error) if error == crate::credentials::PENDING => {
                        (None, None, Some("keychain-authorization-pending"))
                    }
                    Err(_) => (None, None, Some("answer-pipeline-error")),
                }
            };
            let expected_evidence = case
                .required
                .iter()
                .map(|required| {
                    answer.as_ref().is_some_and(|answer| {
                        answer.sources.iter().any(|source| {
                            source.path == paths[&required.document]
                                && source.text.contains(&required.quote)
                        })
                    })
                })
                .collect::<Vec<_>>();
            let out_of_scope_path = answer.as_ref().is_some_and(|answer| {
                answer
                    .sources
                    .iter()
                    .any(|source| !case.documents.iter().any(|doc| paths[doc] == source.path))
            });
            let source_documents = answer.as_ref().map(|answer| {
                answer
                    .sources
                    .iter()
                    .map(|source| {
                        paths
                            .iter()
                            .find(|(_, path)| **path == source.path)
                            .map(|(id, _)| id.as_str())
                    })
                    .collect::<Vec<_>>()
            });
            rows.push(json!({
                "id":case.id, "expected":case.expected, "question":case.question,
                "workspaceDocuments":paths, "selectedDocuments":case.documents, "scope":started.scope,
                "retrievalQuestion":prepared.retrieval_question,"promptQuestion":started.prompt_question,
                "previousQuestions":started.previous_questions, "previousAnswer":started.previous_answer,
                "elapsedMs":start.elapsed().as_millis(),
                "httpAttempts":trace.snapshot()["httpAttempts"].as_u64().unwrap_or_default() - before,
                "requiredEvidenceStages": offline_hits.map(|hits| case.required.iter().zip(&expected_evidence).map(|(required, in_context)| {
                    let matches = |hit: &models::SearchResult| hit.path == paths[&required.document] && hit.text.contains(&required.quote);
                    json!({"document": required.document, "candidate": hits.iter().any(matches),
                        "eligible": hits.iter().any(|hit| hit.evidence && matches(hit)), "inContext": in_context})
                }).collect::<Vec<_>>()),
                "expectedEvidenceInContext":expected_evidence, "sourceDocuments":source_documents,
                "outOfScopePath":out_of_scope_path,
                "clarification":clarification, "failure":failure, "response":answer
            }));
            let outcome = answer
                .as_ref()
                .ok_or(failure.unwrap_or("local-clarification"));
            let conversation = assistant::finish(data.path(), &owner, &started, outcome, false)
                .map_err(|_| "fixture-save-answer-failed")?;
            conversations.insert(conversation_key.clone(), conversation);
            if failure == Some("keychain-authorization-pending") {
                return Err("keychain-authorization-pending");
            }
        }
        stage = "finished";
        Ok::<_, &'static str>(())
    };
    let result = eval_trace::TRACE
        .scope(
            trace.clone(),
            tokio::time::timeout(Duration::from_secs(suite.max_seconds), operation),
        )
        .await
        .unwrap_or(Err("wall-time-budget-exhausted"));
    let report = json!({
        "version":env!("CARGO_PKG_VERSION"), "suite":suite.id,
        "fixtureSha256":fixture_hash, "rubricSha256":rubric_hash,
        "status":if result.is_ok() { "complete" } else { "incomplete" },
        "stage":stage, "error":result.as_ref().err(), "mode":mode, "live":live, "usage":trace.snapshot(),
        "models":{"chat":live.then_some(config.chat.model),"embedding":(mode != "keyword").then_some(config.embedding.model),
                  "rerank":(mode == "rerank").then_some(config.rerank.model)},
        "syntheticOnly":true,"independentFixtureAuthor":true,"externalBlindReview":false,
        "manualReview":null,"records":rows
    });
    save_report(&path, &report, &keys)?;
    result
}
