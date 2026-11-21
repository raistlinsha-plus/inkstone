//! Development-only evidence ablation. Gold labels are consulted only after search and reading.
use crate::{
    credentials::CredentialReader,
    db, documents, evaluation_v086, evidence_reader, files, library,
    models::{SearchResult, Settings, Workspace},
    providers, retrieval, AppState,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
    time::Instant,
};

const DIGEST: &str = "ef9e3d9c968723c5b12e74b044596660b520cd5c38a7f92b3722c24cc80982ee";
const MAX_SOURCE_CHARS: usize = 4000;

#[derive(Deserialize)]
struct Case {
    id: String,
    kind: String,
    question: String,
    previous_turn: Option<Previous>,
    points: Vec<Point>,
    gap_context: Vec<String>,
    skip: Vec<Skipped>,
}
#[derive(Deserialize)]
struct Point {
    point: String,
    accept_any_line: Vec<String>,
}
#[derive(Deserialize)]
struct Skipped {
    line: String,
    reason: String,
}
#[derive(Deserialize)]
struct Previous {
    user: String,
    assistant: String,
}

struct Corpus {
    workspace: Workspace,
    originals: BTreeMap<String, SearchResult>,
}

fn load(data: &Path) -> Result<(Corpus, Vec<Case>), String> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../evals/v1.0/rc3");
    let manifest = fs::read_to_string(dir.join("fixture.sha256")).map_err(|e| e.to_string())?;
    assert_eq!(files::hash(&manifest), DIGEST);
    let project = library::create_project(data, "RC3 合成开发空间")?;
    let workspace = documents::library_workspace(data, &project.id)?;
    let mut conn = db::open(&workspace.db)?;
    let mut originals = BTreeMap::new();
    let mut cases = vec![];
    for record in manifest.lines() {
        let (sha, relative) = record.split_once("  ").ok_or("invalid manifest")?;
        let body = fs::read_to_string(dir.join(relative)).map_err(|e| e.to_string())?;
        assert_eq!(files::hash(&body), sha);
        let path = Path::new(relative);
        if path.extension().is_some_and(|x| x == "json") {
            cases.extend(serde_json::from_str::<Vec<Case>>(&body).map_err(|e| e.to_string())?);
            continue;
        }
        let title = path.file_stem().unwrap().to_str().unwrap();
        let managed = library::create_document(data, &project.id, title, &body)?;
        let chunks = db::local_chunks(&body, relative, 1200);
        let ids = db::index_text(&mut conn, &managed.path, sha, &chunks)?;
        db::update_title(&conn, &managed.path, title)?;
        originals.insert(
            title.to_owned(),
            SearchResult {
                id: ids[0],
                path: managed.path,
                title: Some(title.into()),
                document_id: Some(managed.id),
                heading: title.into(),
                text: body.clone(),
                start_line: 1,
                end_line: body.lines().count(),
                hash: sha.into(),
                score: 0.0,
                bm25_score: None,
                vector_distance: None,
                bm25_rank: None,
                vector_rank: None,
                rerank_score: None,
                evidence: true,
                match_kind: "gold".into(),
            },
        );
    }
    Ok((
        Corpus {
            workspace,
            originals,
        },
        cases,
    ))
}

fn doc(hit: &SearchResult) -> &str {
    hit.title
        .as_deref()
        .unwrap_or(&hit.path)
        .trim_end_matches(".md")
}

fn prompt(c: &Case) -> String {
    match &c.previous_turn {
        None => c.question.clone(),
        Some(p) => format!(
            "历史问题（仅用于识别对象）：{}\n历史答复（不作为证据）：{}\n当前问题：{}",
            p.user, p.assistant, c.question
        ),
    }
}

fn labels(corpus: &Corpus, src: &[SearchResult]) -> BTreeSet<String> {
    let mut lines = BTreeSet::new();
    for hit in src {
        let original = &corpus.originals[doc(hit)];
        assert_eq!(original.hash, hit.hash);
        for (i, line) in original
            .text
            .lines()
            .enumerate()
            .skip(hit.start_line - 1)
            .take(hit.end_line - hit.start_line + 1)
        {
            // A range may contain only part of a source line. Require the labelled statement itself.
            let statement = line.trim().trim_end_matches(['。', '！', '？']);
            if !statement.is_empty() && hit.text.contains(statement) {
                lines.insert(format!("{}#{}", doc(hit), i + 1));
            }
        }
    }
    lines
}

fn snippets(corpus: &Corpus, c: &Case) -> Vec<SearchResult> {
    let lines: BTreeSet<_> = c
        .points
        .iter()
        .flat_map(|p| &p.accept_any_line)
        .chain(&c.gap_context)
        .collect();
    lines
        .into_iter()
        .map(|label| {
            let (title, line) = label.rsplit_once('#').unwrap();
            let n: usize = line.parse().unwrap();
            let mut hit = corpus.originals[title].clone();
            hit.text = hit.text.lines().nth(n - 1).unwrap().to_owned();
            hit.start_line = n;
            hit.end_line = n;
            hit
        })
        .collect()
}

fn context_summary(corpus: &Corpus, c: &Case, hits: &[SearchResult]) -> Value {
    let lines = labels(corpus, hits);
    let covered: Vec<_> = c
        .points
        .iter()
        .filter(|p| p.accept_any_line.iter().any(|l| lines.contains(l)))
        .map(|p| &p.point)
        .collect();
    let distractors: Vec<_> = c
        .skip
        .iter()
        .filter(|s| lines.contains(&s.line))
        .map(|s| json!({"line":s.line,"reason":s.reason}))
        .collect();
    json!({"coveredPoints":covered,"labelledDistractorsPresent":distractors,"sources":hits.iter().map(|h|json!({
        "doc":doc(h),"sha256":h.hash,"first":h.start_line,"last":h.end_line,"text":h.text
    })).collect::<Vec<_>>()})
}

async fn dev_row(
    state: &AppState,
    corpus: &Corpus,
    c: &Case,
    config: &Settings,
    key: Option<&str>,
) -> Result<Value, &'static str> {
    let clock = Instant::now();
    // One fixed transcript for every arm. Prior questions aid retrieval; prior answers are not evidence.
    let query = match &c.previous_turn {
        Some(p) => format!("{} {}", p.user, c.question),
        None => c.question.clone(),
    };
    let question = prompt(c);
    let found = crate::search_inner(
        state,
        &query,
        None,
        false,
        Some("keyword"),
        &state.cancel_chat,
        None,
    )
    .await
    .map_err(|_| "synthetic-search-failed")?;
    let search_ms = clock.elapsed().as_millis();
    let baseline_start = Instant::now();
    let remaining = config
        .chat
        .context_chars
        .saturating_sub(providers::ANSWER_SYSTEM.chars().count() + question.chars().count() + 500);
    let budget = remaining.min(MAX_SOURCE_CHARS);
    let baseline = retrieval::generation_context(&corpus.workspace, &found.results, budget, false);
    let baseline_ms = baseline_start.elapsed().as_millis();
    let reader_start = Instant::now();
    let context = crate::candidate_reading::scoped_context(
        state,
        &corpus.workspace,
        None,
        &query,
        &found,
        None,
        &config.chat,
        budget,
        false,
        0,
        key.is_some(),
        true,
    )
    .await
    .map_err(|_| "synthetic-scoped-context-failed")?;
    let read_ms = reader_start.elapsed().as_millis();
    let read_status = if context.warning.as_deref().is_some_and(|w| {
        w.lines()
            .any(|line| line != crate::candidate_reading::RELATED_STATUS)
    }) {
        "service-fallback"
    } else if context
        .sources
        .iter()
        .any(|s| s.match_kind == "related-original")
    {
        "related-original"
    } else if context.step.is_none() {
        "fast-path"
    } else if key.is_none() {
        "local"
    } else {
        "review-complete"
    };
    let selected = context.sources;
    let mut raw = found.results;
    // The screen sorts admitted evidence first. Recover BM25 order before computing raw top-eight recall.
    raw.sort_by_key(|s| (s.bm25_rank.unwrap_or(usize::MAX), s.id));
    raw.truncate(8);
    // Isolate evidence selection. The facet-specific generation hints are deliberately not appended
    // to any arm, so the generator is exposed to exactly one changed input: the source array.
    let gold_start = Instant::now();
    let gold = snippets(corpus, c);
    let gold_ms = gold_start.elapsed().as_millis();
    let mut arms = serde_json::Map::new();
    let top = context_summary(corpus, c, &raw);
    for (arm, src, context_ms) in [
        ("rc2Gate", &baseline, search_ms + baseline_ms),
        ("rc3Reader", &selected, search_ms + read_ms),
        ("gold", &gold, gold_ms),
    ] {
        let mut entry = context_summary(corpus, c, src);
        if let Some(key) = key {
            let start = Instant::now();
            let total = providers::chat_source_text(src).chars().count()
                + question.chars().count()
                + providers::ANSWER_SYSTEM.chars().count()
                + 30;
            if total > config.chat.context_chars {
                return Err("generator-context-overflow");
            }
            let result = providers::chat(
                &state.client,
                &config.chat,
                Some(key),
                &question,
                src,
                &state.cancel_chat,
                None,
                "rc3-synthetic-dev",
            )
            .await;
            let generation_ms = start.elapsed().as_millis();
            entry["generationMs"] = json!(generation_ms);
            entry["pathMs"] = json!(context_ms + generation_ms);
            match result {
                Ok(answer) => {
                    entry["text"] = json!(answer.text);
                    entry["finish"] = json!(answer.finish_reason);
                }
                Err(_) => entry["error"] = json!("generator-service-failure"),
            }
        }
        arms.insert(arm.into(), entry);
    }
    Ok(
        json!({"id":c.id,"kind":c.kind,"question":c.question,"requiredPoints":c.points.len(),"top8":top,"arms":arms,
        "searchMs":search_ms,"readerStatus":read_status,"readerMs":read_ms,"readerStep":context.step,
        "readerCalls":context.stats.map_or(0,|s| s.calls),"readerChars":context.stats.map_or(0,|s|s.chars),
        "readerPassages":context.stats.map_or(0,|s|s.passages),
        "elapsedMs":clock.elapsed().as_millis()}),
    )
}

async fn run(
    path: &Path,
    mut config: Settings,
    credentials: CredentialReader,
    live: bool,
) -> Result<(), &'static str> {
    if !path.is_absolute() || path.exists() {
        return Err("specify an unused absolute report path");
    }
    if live && (!config.chat.enabled || providers::validate(&config.chat).is_err()) {
        return Err("enable a saved chat service");
    }
    config.candidate_reading = live; // The explicit experiment opts in only inside this temporary state.
    let data = tempfile::tempdir().map_err(|_| "tempdir-failed")?;
    let state = evaluation_v086::isolated_state(data.path(), config.clone(), credentials)?;
    let (corpus, cases) = load(data.path()).map_err(|_| "frozen-fixture-setup-failed")?;
    assert_eq!(cases.len(), 22);
    *state.workspace.lock().unwrap() = Some(corpus.workspace.clone());
    let mut rows = vec![];
    let mut secrets = vec![];
    let mut completed = true;
    let mut interrupted = None;
    for c in &cases {
        let key = if live {
            match evaluation_v086::saved_key(&state, "chat", &config.chat.base_url).await {
                Ok(value) => Some(value),
                Err(error) => {
                    interrupted = Some(error);
                    break;
                }
            }
        } else {
            None
        };
        if let Some(key) = &key {
            if !secrets.contains(key) {
                secrets.push(key.clone());
            }
        }
        let row = match dev_row(&state, &corpus, c, &config, key.as_deref()).await {
            Ok(row) => row,
            Err(error) => {
                interrupted = Some(error);
                break;
            }
        };
        completed &= !matches!(row["readerStatus"].as_str(), Some("service-fallback"));
        completed &= row["arms"]
            .as_object()
            .unwrap()
            .values()
            .all(|a| a.get("error").is_none() && (!live || a["finish"] == "stop"));
        rows.push(row);
    }
    completed &= interrupted.is_none();
    let report = json!({"schemaVersion":1,"fixtureManifestSha256":DIGEST,"live":live,"model":config.chat.model,
        "answerSystemSha256":files::hash(providers::ANSWER_SYSTEM),"readerSystemSha256":files::hash(evidence_reader::SYSTEM_PROMPT),
        "charBudget":MAX_SOURCE_CHARS,"contextLimit":config.chat.context_chars,"retrieval":"BM25","cases":rows,
        "semanticHumanReview":null,"serviceComplete":completed,"interrupted":interrupted});
    evaluation_v086::save_report(path, &report, &secrets)?;
    if let Some(error) = interrupted {
        return Err(error);
    }
    if !completed {
        return Err("one-or-more-incomplete-requests");
    }
    Ok(())
}

fn report_path() -> Result<PathBuf, &'static str> {
    std::env::var_os("INKSTONE_RC3_DEV_REPORT")
        .map(PathBuf::from)
        .ok_or("set INKSTONE_RC3_DEV_REPORT to unused absolute report path")
}

#[tokio::test]
#[ignore = "Write a paired synthetic development evidence report to an explicit path"]
async fn offline_causal_dev() -> Result<(), &'static str> {
    run(
        &report_path()?,
        Settings::default(),
        CredentialReader::default(),
        false,
    )
    .await
}

pub(crate) async fn live_with_settings(
    path: &Path,
    settings: Settings,
    credentials: CredentialReader,
) -> Result<(), &'static str> {
    run(path, settings, credentials, true).await
}

#[test]
#[ignore = "Explicit live three-arm development experiment using only frozen synthetic data"]
fn live_causal_dev() -> Result<(), &'static str> {
    if cfg!(feature = "desktop-e2e") || std::env::var("INKSTONE_RC3_DEV_LIVE").as_deref() != Ok("1")
    {
        return Err("requires standard build and INKSTONE_RC3_DEV_LIVE=1");
    }
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|_| "runtime-setup-failed")?;
    let out = runtime.block_on(live_with_settings(
        &report_path()?,
        evaluation_v086::saved_settings()?,
        CredentialReader::default(),
    ));
    runtime.shutdown_background();
    out
}
