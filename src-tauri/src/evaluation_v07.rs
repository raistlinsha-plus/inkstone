//! Small synthetic multi-turn smoke. Default tests never read a key or call a provider.
use crate::{assistant, evaluation_v065 as shared, files, models::*, providers, retrieval};
use serde_json::{json, Value};
use std::{
    fs,
    path::PathBuf,
    sync::atomic::AtomicBool,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const QUESTIONS: [&str; 3] = [
    "青禾方案2026年11月10日的活动地点、报名人数、参与年龄、报名渠道和活动时长分别是什么？",
    "它的报名人数是多少？",
    "它的预算是多少？",
];
const DOCUMENT:&str="# 青屿阅读室的青禾方案\n\n青屿阅读室青禾方案于2026年11月10日举办，活动地点是东侧阅览室。报名人数为120人，参与年龄为18岁以上，报名渠道是阅读室登记台，活动时长为90分钟。\n";
fn corpus() -> shared::Corpus {
    serde_json::from_value(
        json!({"documents":[{"path":"青屿阅读室青禾方案.md","text":DOCUMENT}],"cases":[]}),
    )
    .unwrap()
}
fn sources(
    data: &std::path::Path,
    ws: &Workspace,
    c: &rusqlite::Connection,
    started: &assistant::Started,
) -> Result<Vec<SearchResult>, String> {
    let prepared = assistant::grounding::prepare(data, ws, started)?;
    if prepared.clarification.is_some() {
        return Ok(vec![]);
    }
    let query = retrieval::knowledge_query(&prepared.retrieval_question);
    let mut hits = shared::candidates(ws, c, &query, "bm25", None)?;
    retrieval::retain_current_sources(ws, &mut hits);
    if let Some(gate) = prepared.gate.as_ref() {
        assistant::grounding::tighten(gate, &mut hits);
    }
    retrieval::finish_ranking(&mut hits);
    Ok(retrieval::generation_context(ws, &hits, 10000, false))
}
fn response(text: String, sources: Vec<SearchResult>, finish: &str) -> ChatResponse {
    ChatResponse {
        finish_reason: finish.into(),
        text,
        sources,
        warning: None,
        retrieval_mode: "keyword".into(),
        rerank_status: "not-requested".into(),
        model: String::new(),
        scope: None,
        chart_warnings: vec![],
        rejected_charts: vec![],
    }
}
fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .into()
}
fn report_path() -> Result<PathBuf, String> {
    let name = std::env::var("INKSTONE_07_REPORT_NAME")
        .map_err(|_| "Explicit report identity required")?;
    if !name.starts_with("remote-multiturn-")
        || !name.ends_with(".json")
        || name.contains('/')
        || name.contains('\\')
    {
        return Err("Invalid smoke report name".into());
    }
    Ok(root()
        .join("artifacts/v0.7-development/evaluation")
        .join(name))
}
fn save(path: &std::path::Path, value: &Value) -> Result<(), String> {
    fs::create_dir_all(path.parent().unwrap())
        .map_err(|_| "Cannot create smoke report directory")?;
    let tmp = path.with_extension("json.tmp");
    fs::write(
        &tmp,
        serde_json::to_vec_pretty(value).map_err(|_| "Report serialization failed")?,
    )
    .map_err(|_| "Report write failed")?;
    fs::rename(tmp, path).map_err(|_| "Report finalization failed".into())
}

#[test]
fn followup_missing_attribute_cannot_borrow_prior_question_coverage() {
    let (_fixture, ws, c) = shared::setup(&corpus());
    let data = tempfile::tempdir().unwrap();
    let workspace = assistant::workspace_id(data.path(), &ws);
    let mut conversation =
        assistant::create(data.path(), &workspace, None, "合成阅读室".into(), None).unwrap();
    let mut parent = None;
    for (index, question) in QUESTIONS.iter().enumerate() {
        let started = assistant::begin_with_mode(
            data.path(),
            &workspace,
            &conversation.id,
            conversation.revision,
            question,
            parent.as_deref(),
            None,
            &format!("offline-smoke-{index}"),
            "keyword",
        )
        .unwrap();
        let picked = sources(data.path(), &ws, &c, &started).unwrap();
        if index == 2 {
            assert!(picked.is_empty(),"Missing current predicate '预算' was admitted using old user terms. Grounded query: {}",started.grounded_question);
        } else {
            assert!(
                !picked.is_empty(),
                "Supported synthetic turn was refused: {question}"
            )
        }
        // Deliberately put an untrusted made-up budget into old assistant output; history must not replay it.
        let reply = response(
            "资料中的时间人数可核对。[1] 预算999万元（故意错误的历史测试文本）".into(),
            picked,
            if index == 2 { "no_evidence" } else { "stop" },
        );
        conversation =
            assistant::finish(data.path(), &workspace, &started, Ok(&reply), false).unwrap();
        assert!(!started.prompt_question.contains("999万元"));
        parent = Some(started.turn_id);
    }
}

#[tokio::test]
#[ignore = "Explicit synthetic real-API smoke; <=24 HTTP attempts/180 seconds; no production keys or default calls"]
async fn remote_multiturn_smoke() -> Result<(), String> {
    // Always fail locally before reading API credentials if the current-predicate guard regresses.
    followup_missing_attribute_cannot_borrow_prior_question_coverage();
    let attempts = std::env::var("INKSTONE_07_MAX_REQUESTS")
        .map_err(|_| "Explicit attempt budget required")?
        .parse::<usize>()
        .map_err(|_| "Invalid attempt budget")?;
    let seconds = std::env::var("INKSTONE_07_MAX_SECONDS")
        .map_err(|_| "Explicit time budget required")?
        .parse::<u64>()
        .map_err(|_| "Invalid time budget")?;
    if !(1..=24).contains(&attempts) || !(1..=180).contains(&seconds) {
        return Err("Smoke budget exceeds 24 attempts/180 seconds".into());
    }
    let path = report_path()?;
    if path.exists() {
        return Err("Smoke report already exists; immutable run identity required".into());
    }
    let chat = Provider {
        enabled: true,
        base_url: std::env::var("INKSTONE_EVAL_BASE_URL")
            .map_err(|_| "Explicit endpoint required")?,
        model: std::env::var("INKSTONE_ANSWER_EVAL_MODEL")
            .map_err(|_| "Explicit chat model required")?,
        context_chars: 12000,
        ..Default::default()
    };
    providers::validate(&chat)?;
    let key = std::env::var("INKSTONE_EVAL_API_KEY")
        .map_err(|_| "Explicit in-memory API key required; evaluator never reads Keychain")?;
    if key.trim().is_empty() {
        return Err("Empty explicit key".into());
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|_| "Client setup failed")?;
    let trace = crate::eval_trace::Trace::new(attempts, seconds);
    let cancel = AtomicBool::new(false);
    let (_fixture, ws, c) = shared::setup(&corpus());
    let data = tempfile::tempdir().map_err(|_| "Synthetic data setup failed")?;
    let workspace = assistant::workspace_id(data.path(), &ws);
    let mut conversation =
        assistant::create(data.path(), &workspace, None, "合成阅读室".into(), None)?;
    let mut parent = None;
    let mut rows = Vec::<Value>::new();
    let pipeline_hash = files::hash(concat!(
        include_str!("assistant.rs"),
        include_str!("assistant_grounding.rs"),
        include_str!("retrieval.rs"),
        include_str!("evidence.rs"),
        include_str!("providers.rs"),
        include_str!("evaluation_v07.rs")
    ));
    let fixture_hash = files::hash(format!("{DOCUMENT}\n{}", QUESTIONS.join("\n")));
    let started_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let snapshot = |rows: &Vec<Value>, status: &str, error: Option<&str>| json!({"version":"0.7","status":status,"error":error,"startedAtUnix":started_at,"fixtureHash":fixture_hash,"pipelineHash":pipeline_hash,"syntheticOnly":true,"authorIndependent":false,"keychainAccessedByEvaluator":false,"mode":"BM25 local retrieval + configured remote chat; no embedding or rerank validation","model":chat.model,"usage":trace.snapshot(),"records":rows,"scope":"actual assistant history ownership and live retrieval/evidence/context/provider primitives; no UI/AppState/Keychain integration claim","manualReview":{"reviewer":null,"factAndCitationSupport":null}});
    save(&path, &snapshot(&rows, "started", None))?;
    let operation=crate::eval_trace::TRACE.scope(trace.clone(),async{
  for (index,question) in QUESTIONS.iter().enumerate(){
   let clock=Instant::now();
   let started=assistant::begin_with_mode(data.path(),&workspace,&conversation.id,conversation.revision,question,parent.as_deref(),None,&format!("remote-smoke-{index}"),"keyword")?;
   let picked=sources(data.path(),&ws,&c,&started)?;
   if index==2&&!picked.is_empty(){return Err("Missing current attribute admitted before model call".to_string())}
   let called=!picked.is_empty();
   let reply=if called{
    let answer=providers::chat(&client,&chat,Some(&key),&started.prompt_question,&picked,&cancel,None,&format!("v07-smoke-{index}")).await.map_err(|_|"Configured chat service failed; response body omitted, HTTP attempt/status recorded".to_string())?;
    response(answer.text,picked,&answer.finish_reason)
   }else{response("资料没有提供该方案的预算，无法从当前资料确定。".into(),vec![],"no_evidence")};
   let expected_fact=if index==2{reply.sources.is_empty()&&reply.finish_reason=="no_evidence"}else if index==0{reply.text.contains("120")&&reply.text.contains("90")}else{reply.text.contains("120")};
   let citation_present=!called||reply.text.contains("[1]");
   rows.push(json!({"turn":index+1,"question":question,"groundedQuestion":started.grounded_question,"promptQuestion":started.prompt_question,"modelCalled":called,"finishReason":reply.finish_reason,"answer":reply.text,"sources":reply.sources,"expectedFactMarkersPresent":expected_fact,"citationMarkerPresent":citation_present,"elapsedMs":clock.elapsed().as_millis(),"manualReview":null}));
   conversation=assistant::finish(data.path(),&workspace,&started,Ok(&reply),false)?;parent=Some(started.turn_id);
   save(&path,&snapshot(&rows,"running",None))?;
  }
  Ok::<(),String>(())
 });
    let result = tokio::time::timeout(Duration::from_secs(seconds), operation)
        .await
        .unwrap_or_else(|_| Err("Smoke time budget reached".into()));
    save(
        &path,
        &snapshot(
            &rows,
            if result.is_ok() {
                "completed"
            } else {
                "failed-or-budget-stopped"
            },
            result.as_ref().err().map(String::as_str),
        ),
    )?;
    if result.is_ok() {
        println!(
            "v0.7 synthetic smoke saved; {} HTTP attempts",
            trace.snapshot()["httpAttempts"]
        );
    }
    result
}
