//! Frozen synthetic split evaluation; no Keychain, networking or gold vectors.
use crate::{db, files, models::*, retrieval};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    time::Instant,
};

#[derive(Deserialize)]
struct Corpus {
    documents: Vec<Document>,
    cases: Vec<Case>,
}
#[derive(Deserialize)]
struct Document {
    path: String,
    text: String,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct GoldSource {
    path: String,
    line: usize,
    quote: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Case {
    id: String,
    split: String,
    question: String,
    expected: Option<String>,
    kind: String,
    answerable: bool,
    gold_sources: Vec<GoldSource>,
    gold_answer: Value,
    rubric: Value,
}
fn fixture() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../evals/v0.6.2")
}
fn output() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../artifacts/v0.6.2-development/evaluation")
}
fn write(name: &str, value: &Value) {
    fs::create_dir_all(output()).unwrap();
    fs::write(
        output().join(name),
        serde_json::to_vec_pretty(value).unwrap(),
    )
    .unwrap();
}
fn verify_fixture() -> (Corpus, String, Value) {
    let manifest: Value =
        serde_json::from_slice(&fs::read(fixture().join("manifest.json")).unwrap()).unwrap();
    for (name, hash) in manifest["files"].as_object().unwrap() {
        assert_eq!(
            &files::hash(fs::read(fixture().join(name)).unwrap()),
            hash.as_str().unwrap(),
            "frozen fixture changed: {name}"
        );
    }
    let raw = fs::read(fixture().join("corpus.json")).unwrap();
    let hash = files::hash(&raw);
    let corpus: Corpus = serde_json::from_slice(&raw).unwrap();
    assert_eq!(corpus.documents.len(), 20);
    assert_eq!(corpus.cases.len(), 100);
    assert_eq!(
        corpus
            .cases
            .iter()
            .filter(|c| c.split == "calibration")
            .count(),
        40
    );
    assert_eq!(
        corpus.cases.iter().filter(|c| c.split == "heldout").count(),
        60
    );
    let mut ids = std::collections::HashSet::new();
    for case in &corpus.cases {
        assert!(ids.insert(&case.id));
        assert_eq!(case.answerable, case.expected.is_some());
        assert!(case.rubric["citationFormat"].is_string());
        assert!(case.rubric["chartSemantics"].is_string());
        for gold in &case.gold_sources {
            let doc = corpus
                .documents
                .iter()
                .find(|d| d.path == gold.path)
                .unwrap();
            assert!(doc
                .text
                .lines()
                .nth(gold.line - 1)
                .unwrap()
                .contains(&gold.quote));
        }
    }
    let protocol =
        serde_json::from_slice(&fs::read(fixture().join("protocol.json")).unwrap()).unwrap();
    (corpus, hash, protocol)
}
fn setup(corpus: &Corpus) -> (tempfile::TempDir, Workspace, rusqlite::Connection) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    let ws = Workspace {
        db: root.join("index.sqlite3"),
        root,
    };
    let mut c = db::open(&ws.db).unwrap();
    for doc in &corpus.documents {
        let path = ws.root.join(&doc.path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, &doc.text).unwrap();
        let chunks = db::local_chunks(&doc.text, &doc.path, 1200);
        db::refresh_lexical(
            &mut c,
            &doc.path,
            &files::hash(&doc.text),
            &chunks,
            &doc.path,
        )
        .unwrap();
    }
    (temp, ws, c)
}
fn run_split(corpus: &Corpus, split: &str, ws: &Workspace, c: &rusqlite::Connection) -> Vec<Value> {
    corpus.cases.iter().filter(|case|case.split==split).map(|case|{
        let start=Instant::now();let query=retrieval::knowledge_query(&case.question);
        let lexical=db::lexical_scored(c,&query,None).unwrap();
        let mut candidates=db::merge_candidates(c,ws,&lexical,&[]).unwrap();retrieval::mark_lexical_evidence(&query,&mut candidates);
        let sources=retrieval::answer_context(ws,&candidates,2400,false);
        let mut paths=vec![];for r in &candidates {if !paths.contains(&r.path){paths.push(r.path.clone());}}
        let rank=case.expected.as_ref().and_then(|p|paths.iter().position(|r|r==p)).map(|v|v+1);
        let gold_in_context=case.answerable&&case.gold_sources.iter().all(|gold|sources.iter().any(|s|s.path==gold.path&&s.text.contains(&gold.quote)));
        json!({"id":case.id,"split":split,"question":case.question,"retrievalQuestion":query,"expected":case.expected,"answerable":case.answerable,"kind":case.kind,"goldSources":case.gold_sources,"goldAnswer":case.gold_answer,"rubric":case.rubric,"rank":rank,"recallAt5":rank.is_some_and(|r|r<=5),"recallAt20":rank.is_some_and(|r|r<=20),"reciprocalRankAt10":rank.filter(|r|*r<=10).map(|r|1.0/r as f64).unwrap_or(0.0),"goldEvidenceInContext":gold_in_context,"unsupportedEvidencePositive":!case.answerable&&!sources.is_empty(),"wouldRefuseForNoContext":sources.is_empty(),"candidateCount":candidates.len(),"eligibleSourceCount":sources.len(),"top10":paths.into_iter().take(10).collect::<Vec<_>>(),"elapsedMs":start.elapsed().as_secs_f64()*1000.0,"answerGeneration":"not_run","answer":null,"manualReview":{"factualSupport":null,"citationSupport":null,"correctRefusal":null,"chartLabelsPeriodsUnitsAndMissingValues":null}})
    }).collect()
}
fn summary(records: &[Value]) -> Value {
    let positive = records
        .iter()
        .filter(|r| r["answerable"] == true)
        .collect::<Vec<_>>();
    let negative = records
        .iter()
        .filter(|r| r["answerable"] == false)
        .collect::<Vec<_>>();
    let p = positive.len() as f64;
    let n = negative.len() as f64;
    let mut latencies = records
        .iter()
        .map(|r| r["elapsedMs"].as_f64().unwrap())
        .collect::<Vec<_>>();
    latencies.sort_by(|a, b| a.total_cmp(b));
    let percent =
        |v: f64| latencies[((latencies.len() as f64 * v).ceil() as usize).saturating_sub(1)];
    json!({"caseCount":records.len(),"answerableCount":positive.len(),"unsupportedCount":negative.len(),"recallAt5":positive.iter().filter(|r|r["recallAt5"]==true).count()as f64/p,"recallAt20":positive.iter().filter(|r|r["recallAt20"]==true).count()as f64/p,"mrrAt10":positive.iter().map(|r|r["reciprocalRankAt10"].as_f64().unwrap()).sum::<f64>()/p,"goldEvidenceContextRate":positive.iter().filter(|r|r["goldEvidenceInContext"]==true).count()as f64/p,"unsupportedEvidenceFalsePositiveRate":negative.iter().filter(|r|r["unsupportedEvidencePositive"]==true).count()as f64/n,"noContextRefusalProxyRate":negative.iter().filter(|r|r["wouldRefuseForNoContext"]==true).count()as f64/n,"localRetrievalEvidenceP50ms":percent(0.5),"localRetrievalEvidenceP95ms":percent(0.95),"modelLatencyMs":null})
}
fn acceptance(metrics: &Value, targets: &Value) -> Value {
    let checks = vec![
        json!({"metric":"recallAt5","value":metrics["recallAt5"],"targetMin":targets["recallAt5"],"passed":metrics["recallAt5"].as_f64().unwrap()>=targets["recallAt5"].as_f64().unwrap()}),
        json!({"metric":"mrrAt10","value":metrics["mrrAt10"],"targetMin":targets["mrrAt10"],"passed":metrics["mrrAt10"].as_f64().unwrap()>=targets["mrrAt10"].as_f64().unwrap()}),
        json!({"metric":"goldEvidenceContextRate","value":metrics["goldEvidenceContextRate"],"targetMin":targets["goldEvidenceContextRate"],"passed":metrics["goldEvidenceContextRate"].as_f64().unwrap()>=targets["goldEvidenceContextRate"].as_f64().unwrap()}),
        json!({"metric":"unsupportedEvidenceFalsePositiveRate","value":metrics["unsupportedEvidenceFalsePositiveRate"],"targetMax":targets["unsupportedEvidenceFalsePositiveRateMax"],"passed":metrics["unsupportedEvidenceFalsePositiveRate"].as_f64().unwrap()<=targets["unsupportedEvidenceFalsePositiveRateMax"].as_f64().unwrap()}),
    ];
    json!({"allTargetsMet":checks.iter().all(|c|c["passed"]==true),"checks":checks,"notAReleaseQualityCertification":true})
}
#[test]
fn frozen_split_real_bm25_and_evidence_proxy_baseline() {
    let (corpus, hash, protocol) = verify_fixture();
    let (_temp, ws, c) = setup(&corpus);
    let calibration = run_split(&corpus, "calibration", &ws, &c);
    let calibration_summary = summary(&calibration);
    let baseline = json!({"corpusHash":hash,"split":"calibration","summary":calibration_summary,"records":calibration});
    fs::create_dir_all(output()).unwrap();
    let frozen_path = output().join("frozen-targets.json");
    let frozen = if frozen_path.exists() {
        let existing: Value = serde_json::from_slice(&fs::read(&frozen_path).unwrap()).unwrap();
        assert_eq!(
            existing["corpusHash"], hash,
            "new fixture requires a newly versioned evaluation directory"
        );
        assert_eq!(
            existing["targets"], protocol["targets"],
            "do not relax targets after viewing heldout"
        );
        assert_eq!(
            existing["calibrationBaselineHash"],
            files::hash(fs::read(output().join("calibration-baseline.json")).unwrap())
        );
        existing
    } else {
        write("calibration-baseline.json", &baseline);
        let frozen = json!({"version":1,"corpusHash":hash,"protocolHash":files::hash(fs::read(fixture().join("protocol.json")).unwrap()),"calibrationBaselineHash":files::hash(fs::read(output().join("calibration-baseline.json")).unwrap()),"freezeOrder":"calibration baseline saved -> targets persisted -> heldout evaluated","targets":protocol["targets"],"productionThresholdsChanged":false,"tuningPerformed":false});
        write("frozen-targets.json", &frozen);
        frozen
    };
    // Heldout cases are evaluated only after the targets above are on disk.
    let heldout = run_split(&corpus, "heldout", &ws, &c);
    let heldout_summary = summary(&heldout);
    let failures = heldout
        .iter()
        .filter(|r| {
            (r["answerable"] == true && r["goldEvidenceInContext"] == false)
                || (r["answerable"] == false && r["unsupportedEvidencePositive"] == true)
        })
        .map(|r| r["id"].clone())
        .collect::<Vec<_>>();
    let report = json!({"version":"0.6.2","corpusHash":hash,"manifestHash":files::hash(fs::read(fixture().join("manifest.json")).unwrap()),"scope":"20 fictional manuals; 40 calibration / 60 frozen heldout questions, author-generated and not independent or externally blinded. No production user data.","rankingUnit":"unique document, metrics calculated before UI ordering/cap","pipeline":"production local_chunks -> refresh_lexical -> knowledge_query -> lexical_scored (BM25) -> merge_candidates -> mark_lexical_evidence -> answer_context","credentialsRead":false,"keychainAccessed":false,"externalCalls":0,"productionThresholdsChanged":false,"tuningPerformed":false,"frozenTargets":frozen,"calibration":{"summary":calibration_summary,"records":calibration},"heldout":{"summary":heldout_summary,"acceptance":acceptance(&heldout_summary,&protocol["targets"]),"records":heldout,"proxyFailureCaseIds":failures},"vector":{"status":"not_run"},"hybrid":{"status":"not_run"},"rerank":{"status":"not_run"},"generation":{"status":"not_run","factualAccuracy":null,"citationSupport":null,"correctRefusal":null,"chartSemanticAccuracy":null},"caveats":["Gold-in-context measures evidence availability, not whether a generated answer uses it correctly.","An unsupported question retrieving context is a refusal-risk proxy; no generated false claim has been observed in this local-only run.","Target failures are retained. Passing this test means reproducible fixtures/reports, not passing every quality target.","Timing covers local retrieval/evidence work in temporary files with warm sequential execution; excludes indexing, network, first token and end-to-end latency."],"cost":null});
    if output().join("bm25-split-report.json").exists() {
        if !output().join("baseline-bm25-split-report.json").exists() {
            fs::copy(
                output().join("bm25-split-report.json"),
                output().join("baseline-bm25-split-report.json"),
            )
            .unwrap();
        }
        let mut exploratory = report.clone();
        exploratory["phase"]=json!("post-fix same-corpus exploratory regression; heldout was already observed, not new blind evaluation");
        exploratory["alreadyObservedHeldout"] = json!(true);
        exploratory["baselineReportHash"] = json!(files::hash(
            fs::read(output().join("baseline-bm25-split-report.json")).unwrap()
        ));
        write("post-fix-same-corpus-exploratory.json", &exploratory);
    } else {
        write("bm25-split-report.json", &report);
    }

    println!(
        "v0.6.2 evaluation: {}",
        json!({"calibration":report["calibration"]["summary"],"heldout":report["heldout"]["summary"],"acceptance":report["heldout"]["acceptance"]})
    );
    assert_eq!(report["heldout"]["records"].as_array().unwrap().len(), 60);
    assert_eq!(report["externalCalls"], 0);
}

#[test]
fn posthoc_context_diagnostics_do_not_change_frozen_targets() {
    let (corpus, hash, _) = verify_fixture();
    let (_temp, ws, c) = setup(&corpus);
    let mut records = vec![];
    for case in corpus
        .cases
        .iter()
        .filter(|c| ["D02-Q4", "D01-Q2", "D03-Q3"].contains(&c.id.as_str()))
    {
        let query = retrieval::knowledge_query(&case.question);
        let terms = db::query_terms(&query)
            .into_iter()
            .filter(|s| s.chars().count() > 1 || query.trim() == s)
            .collect::<Vec<_>>();
        let hits = db::lexical_scored(&c, &query, None).unwrap();
        let mut candidates = db::merge_candidates(&c, &ws, &hits, &[]).unwrap();
        retrieval::mark_lexical_evidence(&query, &mut candidates);
        let sources = retrieval::answer_context(&ws, &candidates, 2400, false);
        let raw=candidates.iter().filter(|r|Some(&r.path)==case.expected.as_ref()).map(|r|{
            let text=format!("{} {} {}",r.title.as_deref().unwrap_or(""),r.heading,r.text).to_lowercase();let content=db::tokenize(&text).split_whitespace().map(str::to_string).collect::<std::collections::HashSet<_>>();
            let covered=terms.iter().filter(|t|content.contains(t.as_str())).collect::<Vec<_>>();let missing=terms.iter().filter(|t|!content.contains(t.as_str())).collect::<Vec<_>>();
            json!({"id":r.id,"path":r.path,"heading":r.heading,"startLine":r.start_line,"endLine":r.end_line,"text":r.text,"bm25Rank":r.bm25_rank,"evidence":r.evidence,"covered":covered,"missing":missing,"coveredCount":covered.len(),"termCount":terms.len()})
        }).collect::<Vec<_>>();
        records.push(json!({"id":case.id,"question":case.question,"retrievalQuestion":query,"terms":terms,"goldSources":case.gold_sources,"expectedPathCandidates":raw,"assembledSources":sources}));
    }
    write(
        if output()
            .join("baseline-three-case-diagnostics.json")
            .exists()
        {
            "post-fix-three-case-diagnostics.json"
        } else {
            "posthoc-three-case-diagnostics.json"
        },
        &json!({"corpusHash":hash,"phase":"posthoc diagnostics of already-observed heldout cases; not new blinded evaluation","productionThresholdsChanged":false,"records":records}),
    );
}
