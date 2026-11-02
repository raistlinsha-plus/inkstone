//! Versioned, opt-in service evaluation using the live query/ranking/context functions.
//! Fixtures are synthetic. Expected answers are used only AFTER retrieval for scoring.
use crate::{answer_validation, db, eval_trace, files, models::*, providers, retrieval};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::atomic::AtomicBool,
    time::Instant,
};

#[derive(Deserialize)]
pub(super) struct Corpus {
    pub(super) documents: Vec<Document>,
    pub(super) cases: Vec<Case>,
}
#[derive(Deserialize)]
pub(super) struct Document {
    pub(super) path: String,
    pub(super) text: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Case {
    pub(super) id: String,
    pub(super) question: String,
    pub(super) answerable: bool,
    pub(super) kind: String,
    pub(super) gold_sources: Vec<Gold>,
    pub(super) rubric: Value,
}
#[derive(Deserialize)]
pub(super) struct Gold {
    pub(super) path: String,
    pub(super) line: usize,
    pub(super) quote: String,
}
const MODES: [&str; 4] = ["bm25", "vector", "hybrid", "rerank"];
fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .into()
}
fn out() -> PathBuf {
    root().join("artifacts/v0.6.5-development/evaluation")
}
fn write(name: &str, value: &Value) {
    fs::create_dir_all(out()).unwrap();
    let dest = out().join(name);
    let tmp = dest.with_extension("tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(value).unwrap()).unwrap();
    fs::rename(tmp, dest).unwrap();
}
pub(super) fn load(version: &str, name: &str) -> (Corpus, String) {
    let dir = root().join(format!("evals/{version}"));
    let manifest: Value =
        serde_json::from_slice(&fs::read(dir.join("manifest.json")).unwrap()).unwrap();
    for (file, expected) in manifest["files"].as_object().unwrap() {
        assert_eq!(
            files::hash(fs::read(dir.join(file)).unwrap()),
            expected.as_str().unwrap(),
            "Frozen input changed: {file}"
        );
    }
    let bytes = fs::read(dir.join(name)).unwrap();
    let hash = files::hash(&bytes);
    let c: Corpus = serde_json::from_slice(&bytes).unwrap();
    let mut ids = HashSet::new();
    for d in &c.documents {
        files::validate_relative(&d.path).unwrap();
    }
    for q in &c.cases {
        assert!(ids.insert(&q.id));
        assert_eq!(q.answerable, !q.gold_sources.is_empty());
        for g in &q.gold_sources {
            assert!(c
                .documents
                .iter()
                .find(|d| d.path == g.path)
                .unwrap()
                .text
                .lines()
                .nth(g.line - 1)
                .unwrap()
                .contains(&g.quote));
        }
    }
    (c, hash)
}
pub(super) fn setup(c: &Corpus) -> (tempfile::TempDir, Workspace, rusqlite::Connection) {
    let t = tempfile::tempdir().unwrap();
    let ws = Workspace {
        root: t.path().canonicalize().unwrap(),
        db: t.path().join("index.sqlite3"),
    };
    let mut conn = db::open(&ws.db).unwrap();
    for d in &c.documents {
        let p = ws.root.join(&d.path);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, &d.text).unwrap();
        db::refresh_lexical(
            &mut conn,
            &d.path,
            &files::hash(&d.text),
            &db::local_chunks(&d.text, &d.path, 1200),
            &d.path,
        )
        .unwrap();
    }
    (t, ws, conn)
}
pub(super) fn candidates(
    ws: &Workspace,
    conn: &rusqlite::Connection,
    query: &str,
    mode: &str,
    vector: Option<&[f32]>,
) -> Result<Vec<SearchResult>, String> {
    let lex = if mode == "vector" {
        vec![]
    } else {
        db::lexical_scored(conn, query, None)?
    };
    let sem = if mode == "bm25" {
        vec![]
    } else if let Some(v) = vector {
        db::nearest_scored(conn, v, None)?
    } else {
        vec![]
    };
    let mut hits = db::merge_candidates(conn, ws, &lex, &sem)?;
    retrieval::mark_lexical_evidence(query, &mut hits);
    Ok(hits)
}
pub(super) fn metrics(case: &Case, ranked: &[SearchResult], sources: &[SearchResult]) -> Value {
    let mut paths = vec![];
    for r in ranked {
        if !paths.contains(&r.path) {
            paths.push(r.path.clone());
        }
    }
    let ranks = case
        .gold_sources
        .iter()
        .map(|g| paths.iter().position(|p| p == &g.path).map(|i| i + 1))
        .collect::<Vec<_>>();
    let rank = if ranks.is_empty() || ranks.iter().any(Option::is_none) {
        None
    } else {
        ranks.into_iter().flatten().max()
    };
    json!({"allGoldDocumentRank":rank,"recallAt5":rank.is_some_and(|r|r<=5),"reciprocalRankAt10":rank.filter(|r|*r<=10).map(|r|1.0/r as f64).unwrap_or(0.0),"goldEvidenceInContext":case.answerable&&case.gold_sources.iter().all(|g|sources.iter().any(|s|s.path==g.path&&s.text.contains(&g.quote))),"unsupportedEvidencePositive":!case.answerable&&!sources.is_empty(),"noContext":sources.is_empty(),"sourceCount":sources.len(),"topDocuments":paths.into_iter().take(10).collect::<Vec<_>>()})
}
pub(super) fn summary(records: &[Value], mode: &str) -> Value {
    let rows = records
        .iter()
        .filter(|r| r["mode"] == mode && r["status"] == "completed")
        .collect::<Vec<_>>();
    let pos = rows
        .iter()
        .filter(|r| r["answerable"] == true)
        .collect::<Vec<_>>();
    let neg = rows
        .iter()
        .filter(|r| r["answerable"] == false)
        .collect::<Vec<_>>();
    let rate = |v: usize, n: usize| {
        if n == 0 {
            Value::Null
        } else {
            json!(v as f64 / n as f64)
        }
    };
    let mut ms = rows
        .iter()
        .filter_map(|r| r["retrievalEvidenceMs"].as_f64())
        .collect::<Vec<_>>();
    ms.sort_by(f64::total_cmp);
    let p = |q: f64| {
        ms.get(((ms.len() as f64 * q).ceil() as usize).saturating_sub(1))
            .copied()
    };
    let recall = rate(
        pos.iter()
            .filter(|r| r["metrics"]["recallAt5"] == true)
            .count(),
        pos.len(),
    );
    let mrr = if pos.is_empty() {
        Value::Null
    } else {
        json!(
            pos.iter()
                .map(|r| r["metrics"]["reciprocalRankAt10"].as_f64().unwrap())
                .sum::<f64>()
                / pos.len() as f64
        )
    };
    let evidence = rate(
        pos.iter()
            .filter(|r| r["metrics"]["goldEvidenceInContext"] == true)
            .count(),
        pos.len(),
    );
    let unsupported = rate(
        neg.iter()
            .filter(|r| r["metrics"]["unsupportedEvidencePositive"] == true)
            .count(),
        neg.len(),
    );
    let degraded = rows.iter().filter(|r| r["stageError"].is_string()).count();
    json!({"degraded":degraded,"completed":rows.len(),"answerable":pos.len(),"unsupported":neg.len(),"recallAt5":recall,"mrrAt10":mrr,"goldEvidenceContextRate":evidence,"unsupportedEvidencePositiveRate":unsupported,"retrievalEvidenceP50ms":p(0.5),"retrievalEvidenceP95ms":p(0.95),"allTargetsMet":degraded==0&&!pos.is_empty()&&!neg.is_empty()&&recall.as_f64().unwrap()>=0.9&&mrr.as_f64().unwrap()>=0.8&&evidence.as_f64().unwrap()>=0.85&&unsupported.as_f64().unwrap()<=0.1,"latencyScope":"Query vectors are batch-precomputed; this is local retrieval/context + rerank only, NOT online total latency"})
}
fn summaries(records: &[Value]) -> Value {
    MODES
        .into_iter()
        .map(|mode| (mode.into(), summary(records, mode)))
        .collect::<serde_json::Map<String, Value>>()
        .into()
}
fn review() -> Value {
    json!({"factualSupport":null,"citationSupport":null,"correctRefusal":null,"chartSemantics":null,"reviewer":null,"notes":null})
}
fn protocol() -> Value {
    serde_json::from_slice(&fs::read(root().join("evals/v0.6.5/protocol.json")).unwrap()).unwrap()
}
#[test]
fn local_frozen_quality_report() {
    let phase = std::env::var("INKSTONE_065_PHASE").unwrap_or("final".into());
    for (label, version, file) in [
        ("seen-100", "v0.6.2", "corpus.json"),
        ("new-32", "v0.6.5", "new-check.json"),
    ] {
        if phase == "baseline" && label == "new-32" {
            continue;
        }
        let (corpus, hash) = load(version, file);
        let (_temp, ws, c) = setup(&corpus);
        let mut records = vec![];
        for case in &corpus.cases {
            let start = Instant::now();
            let query = retrieval::knowledge_query(&case.question);
            let mut hits = candidates(&ws, &c, &query, "bm25", None).unwrap();
            // Diagnostic contains query terms for observed old failures, never added to live prompts.
            retrieval::finish_ranking(&mut hits);
            let sources = retrieval::generation_context(
                &ws,
                &hits,
                12000usize.saturating_sub(
                    case.question.chars().count() + providers::ANSWER_SYSTEM.chars().count() + 500,
                ),
                false,
            );
            records.push(json!({"id":case.id,"mode":"bm25","question":case.question,"retrievalQuestion":query,"terms":db::query_terms(&query),"answerable":case.answerable,"kind":case.kind,"status":"completed","metrics":metrics(case,&hits,&sources),"retrievalEvidenceMs":start.elapsed().as_secs_f64()*1000.0,"generation":"not_run","manualReview":review()}));
        }
        let report = json!({"version":"0.6.5","phase":phase,"corpus":label,"corpusHash":hash,"oldCasesAlreadyObserved":label=="seen-100","authorIndependent":false,"externalCalls":0,"keychainAccessed":false,"targets":protocol()["targets"],"summary":summary(&records,"bm25"),"records":records});
        let name = format!("local-{phase}-{label}.json");
        write(&name, &report);
        let first = out().join(format!("first-local-{label}.json"));
        if !first.exists() {
            fs::copy(out().join(&name), first).unwrap();
        }
    }
}

#[tokio::test]
#[ignore = "Explicit transient API environment and --ignored required. Synthetic documents only; real paid usage, bounded attempts/time."]
async fn remote_quality_matrix() -> Result<(), String> {
    let corpus_name = std::env::var("INKSTONE_065_CORPUS")
        .map_err(|_| "Set INKSTONE_065_CORPUS=seen-100|new-32")?;
    let (version, file) = match corpus_name.as_str() {
        "seen-100" => ("v0.6.2", "corpus.json"),
        "new-32" => ("v0.6.5", "new-check.json"),
        _ => return Err("Unknown frozen corpus".into()),
    };
    let (corpus, hash) = load(version, file);
    let p = protocol();
    let embedding = Provider {
        enabled: true,
        base_url: std::env::var("INKSTONE_EVAL_BASE_URL")
            .map_err(|_| "Missing explicit endpoint")?,
        model: std::env::var("INKSTONE_EVAL_EMBEDDING_MODEL")
            .map_err(|_| "Missing embedding model")?,
        batch_size: 16,
        ..Default::default()
    };
    let chat = Provider {
        model: std::env::var("INKSTONE_ANSWER_EVAL_MODEL").map_err(|_| "Missing chat model")?,
        context_chars: 12000,
        ..embedding.clone()
    };
    let reranker = RerankProvider {
        enabled: true,
        endpoint: std::env::var("INKSTONE_EVAL_RERANK_ENDPOINT")
            .map_err(|_| "Missing explicit rerank endpoint")?,
        model: std::env::var("INKSTONE_EVAL_RERANK_MODEL").map_err(|_| "Missing rerank model")?,
        timeout_ms: 15000,
        ..Default::default()
    };
    providers::validate(&embedding)?;
    providers::validate(&chat)?;
    providers::validate_reranker(&reranker)?;
    let key = std::env::var("INKSTONE_EVAL_API_KEY").ok();
    let rkey = std::env::var("INKSTONE_EVAL_RERANK_KEY").ok().or_else(|| {
        providers::same_service_origin(&embedding.base_url, &reranker.endpoint)
            .ok()
            .filter(|same| *same)
            .and(key.clone())
    });
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(90))
        .build()
        .map_err(|_| "Client setup failed")?;
    let max_attempts = std::env::var("INKSTONE_065_MAX_ATTEMPTS")
        .ok()
        .map(|s| {
            s.parse::<usize>()
                .map_err(|_| "Invalid evaluation attempt budget")
        })
        .transpose()?
        .unwrap_or(p["maxHttpAttempts"].as_u64().unwrap() as usize);
    if max_attempts == 0 || max_attempts > p["maxHttpAttempts"].as_u64().unwrap() as usize {
        return Err("Evaluation budget exceeds frozen maximum".into());
    }
    let pipeline_hash = files::hash(
        concat!(
            include_str!("db.rs"),
            include_str!("retrieval.rs"),
            include_str!("providers.rs"),
            include_str!("models.rs"),
            include_str!("evaluation_v065.rs")
        )
        .as_bytes(),
    );
    let trace = eval_trace::Trace::new(max_attempts, p["maxWallSeconds"].as_u64().unwrap());
    let (_temp, ws, mut conn) = setup(&corpus);
    let cancel = AtomicBool::new(false);
    let mut records = vec![];
    let run_id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let name = format!("remote-{corpus_name}-{run_id}.json");
    let save = |records: &Vec<Value>, status: &str, error: Option<&str>| {
        write(
            &name,
            &json!({"version":"0.6.5","runId":run_id,"pipelineHash":pipeline_hash,"status":status,"error":error,"corpus":corpus_name,"corpusHash":hash,"protocolHash":files::hash(fs::read(root().join("evals/v0.6.5/protocol.json")).unwrap()),"models":{"embedding":embedding.model,"chat":chat.model,"rerank":reranker.model},"endpoint":embedding.base_url,"rerankEndpoint":reranker.endpoint,"config":{"batchSize":16,"chunkChars":1200,"contextChars":12000,"rerankCandidates":40,"rerankMinScore":0.5,"rerankStrict":false},"authorIndependent":false,"oldCasesAlreadyObserved":corpus_name=="seen-100","keychainAccessedByEvaluator":false,"credentials":"transient environment; local execution bootstrap separately documented","generationSubsetIds":p["generationCaseIds"],"usage":trace.snapshot(),"summary":summaries(records),"records":records}),
        );
    };
    save(&records, "started", None);
    let operation=eval_trace::TRACE.scope(trace.clone(),async {
        let chunks=conn.prepare("SELECT id,path,heading,text FROM chunks ORDER BY id").map_err(|_|"Chunk read failed")?.query_map([],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,String>(1)?,format!("{}\n\n{}",r.get::<_,String>(2)?,r.get::<_,String>(3)?)))).map_err(|_|"Chunk read failed")?.collect::<Result<Vec<_>,_>>().map_err(|_|"Chunk read failed")?;
        let embedding_started=Instant::now();
        let inputs=chunks.iter().map(|r|r.2.clone()).collect::<Vec<_>>();
        let vecs=providers::embed(&client,&embedding,key.as_deref(),&inputs,&cancel).await?;
        let profile=providers::fingerprint(&embedding);let mut groups=HashMap::<String,(Vec<i64>,Vec<Vec<f32>>)>::new();
        for ((id,path,_),v) in chunks.into_iter().zip(vecs){let e=groups.entry(path).or_default();e.0.push(id);e.1.push(v);}
        for (path,(ids,vecs)) in groups {db::put_vectors(&mut conn,&path,&profile,&ids,&vecs)?;}
        let query_inputs=corpus.cases.iter().map(|c|retrieval::knowledge_query(&c.question)).collect::<Vec<_>>();
        let queries=providers::embed(&client,&embedding,key.as_deref(),&query_inputs,&cancel).await?;
        let embedding_batch_ms=embedding_started.elapsed().as_millis();
        for (index,case) in corpus.cases.iter().enumerate() {
            for mode in MODES {
                let start=Instant::now();let mut hits=candidates(&ws,&conn,&query_inputs[index],mode,Some(&queries[index]))?;
                let mut actual=if mode=="bm25" {"bm25"} else if mode=="vector" {"vector-diagnostic"} else {"hybrid"};let mut rerank_status="not-requested";let mut error=None;
                if mode=="rerank"&&!hits.is_empty(){
                    let docs=hits.iter().take(reranker.candidate_count).map(|r|format!("{}\n{}\n{}",r.title.as_deref().unwrap_or(""),r.heading,r.text)).collect::<Vec<_>>();
                    match providers::rerank(&client,&reranker,rkey.as_deref(),&query_inputs[index],&docs,&cancel).await {
                        Ok(r)=>{retrieval::apply_rerank(&mut hits,&r,reranker.min_score);rerank_status="applied";actual="hybrid+rerank";},
                        Err(e)=>{rerank_status=retrieval::rerank_failed(&mut hits,reranker.strict);error=Some(e);}
                    }
                }
                retrieval::retain_current_sources(&ws,&mut hits);retrieval::finish_ranking(&mut hits);
                let sources=retrieval::generation_context(&ws,&hits,chat.context_chars.saturating_sub(case.question.chars().count()+providers::ANSWER_SYSTEM.chars().count()+500),false);
                let retrieval_ms=start.elapsed().as_secs_f64()*1000.0;let m=metrics(case,&hits,&sources);
                let generate=corpus_name=="new-32"&&p["generationCaseIds"].as_array().unwrap().iter().any(|id|id==&case.id);
                let gen_start=Instant::now();let (answer,finish,gen_error)=if !generate {(None,"not_run".into(),None)} else if sources.is_empty(){(Some("当前资料中没有找到足够直接、可引用的证据。".into()),"no_evidence".into(),None)}else{
                    match providers::chat(&client,&chat,key.as_deref(),&case.question,&sources,&cancel,None,&format!("v065-{}-{mode}",case.id)).await {Ok(a)=>(Some(a.text),a.finish_reason,None),Err(e)=>(None,"error".into(),Some(e))}
                };
                let chart=answer.as_ref().map(|a|answer_validation::audit_charts(a,&sources));
                records.push(json!({"id":case.id,"question":case.question,"answerable":case.answerable,"kind":case.kind,"mode":mode,"actualMode":actual,"rerankStatus":rerank_status,"stageError":error,"status":"completed","retrievalQuestion":query_inputs[index],"metrics":m,"retrievalEvidenceMs":retrieval_ms,"embeddingBatchMs":embedding_batch_ms,"generationRequested":generate,"modelCalled":generate&&!sources.is_empty(),"generationMs":if generate{Some(gen_start.elapsed().as_millis())}else{None},"answer":answer,"finishReason":finish,"generationError":gen_error,"sources":sources,"rejectedChartCount":chart.as_ref().map(|c|c.rejected.len()),"chartWarnings":chart.as_ref().map(|c|&c.warnings),"rubric":case.rubric,"manualReview":review()}));
                save(&records,"running",None);
                if error_is_budget(records.last().unwrap()) {return Err("Request budget reached".into());}
            }
            println!("v065 {corpus_name}: {}/{} cases recorded",index+1,corpus.cases.len());
        }
        Ok::<(),String>(())
    });
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(p["maxWallSeconds"].as_u64().unwrap()),
        operation,
    )
    .await
    .unwrap_or_else(|_| Err("Evaluation wall-time budget reached".into()));
    save(
        &records,
        if result.is_ok() {
            "completed"
        } else {
            "failed-or-budget-stopped"
        },
        result.as_ref().err().map(String::as_str),
    );
    println!("Saved {name}; API errors and quality misses are retained.");
    result
}
fn error_is_budget(r: &Value) -> bool {
    ["stageError", "generationError"]
        .iter()
        .any(|k| r[k].as_str().is_some_and(|s| s.contains("预算")))
}
