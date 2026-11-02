//! Frozen same-author checks. Golds are used only by scoring, never evidence selection.
use crate::{evaluation_v065 as shared, files, providers, retrieval};
use serde_json::{json, Value};
use std::{
    fs,
    path::PathBuf,
    time::{Instant, SystemTime, UNIX_EPOCH},
};

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .to_owned()
}
fn output() -> PathBuf {
    root().join("artifacts/v0.6.6-development/evaluation")
}
fn save(name: &str, report: &Value) {
    fs::create_dir_all(output()).unwrap();
    let path = output().join(name);
    let temp = path.with_extension("tmp");
    fs::write(&temp, serde_json::to_vec_pretty(report).unwrap()).unwrap();
    fs::rename(temp, path).unwrap();
}
fn protocol() -> Value {
    serde_json::from_slice(&fs::read(root().join("evals/v0.6.6/protocol.json")).unwrap()).unwrap()
}
fn summarize(records: &[Value], mode: &str) -> Value {
    let mut result = shared::summary(records, mode);
    result["latencyScope"] = json!("Local retrieval/context plus rerank only. Remote rows separately report measured online query embedding and generation; local-only checks have neither.");
    result["allTargetsMet"] = json!(
        result["degraded"] == 0
            && result["goldEvidenceContextRate"]
                .as_f64()
                .is_some_and(|v| v >= 0.85)
            && result["unsupportedEvidencePositiveRate"] == 0.0
    );
    result
}
#[test]
fn local_frozen_quality_report() {
    let phase = std::env::var("INKSTONE_066_PHASE").unwrap_or("final".into());
    let id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    for (label, file) in [
        ("corrected-observed-32", "corrected-observed-32.json"),
        ("new-40", "new-check.json"),
    ] {
        let (corpus, hash) = shared::load("v0.6.6", file);
        let (_temp, ws, conn) = shared::setup(&corpus);
        let mut records = vec![];
        for case in &corpus.cases {
            let started = Instant::now();
            let query = retrieval::knowledge_query(&case.question);
            let mut hits = shared::candidates(&ws, &conn, &query, "bm25", None).unwrap();
            retrieval::finish_ranking(&mut hits);
            let sources = retrieval::generation_context(
                &ws,
                &hits,
                12000usize.saturating_sub(
                    case.question.chars().count() + providers::ANSWER_SYSTEM.chars().count() + 500,
                ),
                false,
            );
            records.push(json!({"id":case.id,"question":case.question,"mode":"bm25","status":"completed","answerable":case.answerable,"kind":case.kind,"metrics":shared::metrics(case,&hits,&sources),"retrievalEvidenceMs":started.elapsed().as_secs_f64()*1000.0,"sources":sources,"terms":crate::db::query_terms(&query)}));
        }
        save(
            &format!("local-{phase}-{label}-{id}.json"),
            &json!({"version":"0.6.6","phase":phase,"corpus":label,"corpusHash":hash,"authorIndependent":false,"generation":"not_run","externalCalls":0,"keychainAccessed":false,"protocol":protocol(),"summary":summarize(&records,"bm25"),"records":records}),
        );
    }
}

#[test]
fn recorded_final_charts_remain_valid_with_the_locked_markdown_parser() {
    let path = root().join("evals/v0.6.6/evidence/remote-new-40-1793628260326-0d30a017.json");
    let report: Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
    let mut charts = 0;
    for row in report["records"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| r["modelCalled"] == true && r["kind"] == "chart")
    {
        let sources: Vec<crate::models::SearchResult> =
            serde_json::from_value(row["sources"].clone()).unwrap();
        let audit =
            crate::answer_validation::audit_charts(row["answer"].as_str().unwrap(), &sources);
        assert!(
            audit.rejected.is_empty(),
            "Captured chart {} changed validation under the locked parser",
            row["id"]
        );
        charts += 1;
    }
    assert_eq!(charts, 3);
}

#[tokio::test]
#[ignore = "Explicit paid API environment and bounded runner required; synthetic data only"]
async fn remote_quality_matrix() -> Result<(), String> {
    use crate::{answer_validation, db, eval_trace, models::*, providers};
    use std::{collections::HashMap, sync::atomic::AtomicBool, time::Duration};
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
            .map_err(|_| "Missing rerank endpoint")?,
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
            .filter(|v| *v)
            .and(key.clone())
    });
    let attempts = std::env::var("INKSTONE_066_REMAINING_ATTEMPTS")
        .map_err(|_| "Use bounded runner")?
        .parse::<usize>()
        .map_err(|_| "Invalid budget")?;
    let seconds = std::env::var("INKSTONE_066_REMAINING_SECONDS")
        .map_err(|_| "Use bounded runner")?
        .parse::<u64>()
        .map_err(|_| "Invalid time budget")?;
    if attempts == 0 || attempts > 240 || seconds == 0 || seconds > 1800 {
        return Err("Budget exceeds frozen maximum".into());
    }
    let trace = eval_trace::Trace::new(attempts, seconds);
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|_| "Client setup failed")?;
    let (mut corpus, hash) = shared::load("v0.6.6", "new-check.json");
    let selected = std::env::var("INKSTONE_066_CASE_IDS").unwrap_or_default();
    if !selected.is_empty() {
        let ids = selected
            .split(',')
            .collect::<std::collections::HashSet<_>>();
        if ids.len() != selected.split(',').count()
            || ids
                .iter()
                .any(|id| !corpus.cases.iter().any(|c| c.id == *id))
        {
            return Err("Unknown or duplicate follow-up case ID".into());
        }
        corpus.cases.retain(|c| ids.contains(c.id.as_str()));
    }
    let selected_case_ids = corpus
        .cases
        .iter()
        .map(|c| c.id.clone())
        .collect::<Vec<_>>();
    let (_temp, ws, mut conn) = shared::setup(&corpus);
    let cancel = AtomicBool::new(false);
    let name = std::env::var("INKSTONE_066_REPORT_NAME").map_err(|_| "Missing report identity")?;
    if !name.starts_with("remote-new-40-") || name.contains('/') || name.contains('\\') {
        return Err("Invalid report identity".into());
    }
    let pipeline_hash = files::hash(concat!(
        include_str!("db.rs"),
        include_str!("evidence.rs"),
        include_str!("retrieval.rs"),
        include_str!("providers.rs"),
        include_str!("models.rs"),
        include_str!("evaluation_v066.rs")
    ));
    let mut records = vec![];
    let mut index_ms = 0u128;
    let snapshot = |rows: &Vec<Value>, status: &str, error: Option<&str>, index_ms: u128| {
        let summaries = ["bm25", "hybrid", "rerank"]
            .into_iter()
            .map(|m| (m.to_owned(), summarize(rows, m)))
            .collect::<serde_json::Map<String, Value>>();
        save(
            &name,
            &json!({"version":"0.6.6","status":status,"error":error,"corpus":"new-40","selectedCaseIds":selected_case_ids,"corpusHash":hash,"pipelineHash":pipeline_hash,"protocol":p,"authorIndependent":false,"baselinePreviouslyObserved":true,"keychainAccessedByEvaluator":false,"endpoint":embedding.base_url,"models":{"embedding":embedding.model,"chat":chat.model,"rerank":reranker.model},"usage":trace.snapshot(),"documentIndexEmbeddingMs":index_ms,"queryVectorsBatchPrecomputed":false,"queryVectorReusedAcrossSemanticModes":true,"summary":summaries,"records":rows}),
        );
    };
    snapshot(&records, "started", None, index_ms);
    let operation=eval_trace::TRACE.scope(trace.clone(),async {
        let chunks=conn.prepare("SELECT id,path,heading,text FROM chunks ORDER BY id").map_err(|_|"Chunk read failed")?.query_map([],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,String>(1)?,format!("{}\n\n{}",r.get::<_,String>(2)?,r.get::<_,String>(3)?)))).map_err(|_|"Chunk read failed")?.collect::<Result<Vec<_>,_>>().map_err(|_|"Chunk read failed")?;
        let index_start=Instant::now();
        let inputs=chunks.iter().map(|r|r.2.clone()).collect::<Vec<_>>();
        let vectors=providers::embed(&client,&embedding,key.as_deref(),&inputs,&cancel).await?;
        let profile=providers::fingerprint(&embedding);
        let mut groups=HashMap::<String,(Vec<i64>,Vec<Vec<f32>>)>::new();
        for ((id,path,_),v) in chunks.into_iter().zip(vectors) {let group=groups.entry(path).or_default();group.0.push(id);group.1.push(v);}
        for (path,(ids,vectors)) in groups {db::put_vectors(&mut conn,&path,&profile,&ids,&vectors)?;}
        index_ms=index_start.elapsed().as_millis();
        snapshot(&records,"indexed",None,index_ms);
        for case in &corpus.cases {
            let query=retrieval::knowledge_query(&case.question);
            let embedding_start=Instant::now();
            let vector=providers::embed(&client,&embedding,key.as_deref(),std::slice::from_ref(&query),&cancel).await?;
            let embedding_ms=embedding_start.elapsed().as_secs_f64()*1000.0;
            for mode in ["bm25","hybrid","rerank"] {
                let started=Instant::now();
                let mut hits=shared::candidates(&ws,&conn,&query,mode,Some(&vector[0]))?;
                let mut rerank_status="not-requested";
                let mut stage_error=None;
                if mode=="rerank" && !hits.is_empty() {
                    let docs=hits.iter().take(reranker.candidate_count).map(|r|format!("{}\n{}\n{}",r.title.as_deref().unwrap_or(""),r.heading,r.text)).collect::<Vec<_>>();
                    match providers::rerank(&client,&reranker,rkey.as_deref(),&query,&docs,&cancel).await {
                        Ok(ranking)=>{retrieval::apply_rerank(&mut hits,&ranking,reranker.min_score);rerank_status="applied";},
                        Err(e)=>{rerank_status=retrieval::rerank_failed(&mut hits,false);stage_error=Some(e);}
                    }
                }
                retrieval::retain_current_sources(&ws,&mut hits);
                retrieval::finish_ranking(&mut hits);
                let sources=retrieval::generation_context(&ws,&hits,chat.context_chars.saturating_sub(case.question.chars().count()+providers::ANSWER_SYSTEM.chars().count()+500),false);
                let retrieval_ms=started.elapsed().as_secs_f64()*1000.0;
                let generate=mode=="rerank" && p["generationCaseIds"].as_array().unwrap().iter().any(|id|id==&case.id);
                let generation_start=Instant::now();
                let (answer,finish,generation_error)=if !generate {(None,"not_run".into(),None)} else if sources.is_empty() {(Some("当前资料中没有足够直接、可引用的证据。".into()),"no_evidence".into(),None)} else {
                    match providers::chat(&client,&chat,key.as_deref(),&case.question,&sources,&cancel,None,&format!("v066-{}",case.id)).await {
                        Ok(a)=>(Some(a.text),a.finish_reason,None),Err(e)=>(None,"error".into(),Some(e))
                    }
                };
                let generation_ms=if generate {generation_start.elapsed().as_secs_f64()*1000.0} else {0.0};
                let audit=answer.as_ref().map(|a|answer_validation::audit_charts(a,&sources));
                let online_ms=if mode=="bm25"{0.0}else{embedding_ms}+retrieval_ms+generation_ms;
                records.push(json!({"id":case.id,"mode":mode,"status":"completed","question":case.question,"answerable":case.answerable,"kind":case.kind,"retrievalQuestion":query,"rerankStatus":rerank_status,"stageError":stage_error,"metrics":shared::metrics(case,&hits,&sources),"queryEmbeddingMs":if mode=="bm25"{0.0}else{embedding_ms},"retrievalEvidenceMs":retrieval_ms,"generationRequested":generate,"modelCalled":generate&&!sources.is_empty(),"generationMs":generation_ms,"onlineTotalMs":online_ms,"onlineTimingScope":"measured query embedding + local retrieval/rerank/context + generation; same query vector reused across hybrid/rerank, no batch precomputation; excludes document indexing and UI rendering","answer":answer,"finishReason":finish,"generationError":generation_error,"sources":sources,"rubric":case.rubric,"rejectedChartCount":audit.as_ref().map(|a|a.rejected.len()),"chartWarnings":audit.as_ref().map(|a|&a.warnings),"manualReview":{"reviewer":null,"factualSupport":null,"citationSupport":null,"chartSemantics":null,"notes":null}}));
                snapshot(&records,"running",None,index_ms);
                if trace.snapshot()["httpAttempts"].as_u64().unwrap()>=attempts as u64 {return Err("Evaluation attempt budget reached".into());}
            }
            println!("v066: {} recorded",case.id);
        }
        Ok::<(),String>(())
    });
    let result = tokio::time::timeout(Duration::from_secs(seconds), operation)
        .await
        .unwrap_or_else(|_| Err("Evaluation time budget reached".into()));
    snapshot(
        &records,
        if result.is_ok() {
            "completed"
        } else {
            "failed-or-budget-stopped"
        },
        result.as_ref().err().map(String::as_str),
        index_ms,
    );
    println!("Saved bounded synthetic report: {name}");
    result
}
