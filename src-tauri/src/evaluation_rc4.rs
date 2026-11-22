//! Frozen RC4 evaluation adapter. Only the scoring tool reads the answer key.
use super::*;

const PACKET: &str = include_str!("../../evals/v1.0/rc4/packet.json");
const PACKET_HASH: &str = "82ad39942669040f9aabdd704935f71a451a23d7a2845e97b30ae636a1132038";
const RUBRIC_HASH: &str = "946d28ddb306fd2df2120d334a6fbf1decfbea3b2602616eb6cfa14df9be2225";
const SUITE: Suite = Suite {
    id: "rc4-blind",
    env_prefix: "INKSTONE_RC4",
    fixture: PACKET,
    rubric: "",
    hashes: "",
    max_requests: 120,
    max_seconds: 1500,
};

#[derive(Deserialize)]
struct Packet {
    documents: Vec<Document>,
    cases: Vec<Question>,
    spaces: HashMap<String, Vec<String>>,
}

#[derive(Deserialize)]
struct Question {
    id: String,
    conversation: String,
    space: String,
    question: String,
    documents: Vec<String>,
    follow_up_to: Option<String>,
}

fn load() -> Result<Fixture, &'static str> {
    if files::hash(PACKET) != PACKET_HASH {
        return Err("rc4-public-packet-hash-mismatch");
    }
    let p: Packet = serde_json::from_str(PACKET).map_err(|_| "invalid-rc4-packet")?;
    let mut previous = HashMap::new();
    let mut cases = Vec::new();
    for q in p.cases {
        if previous.insert(q.conversation.clone(), q.id.clone()) != q.follow_up_to {
            return Err("rc4-conversation-order-mismatch");
        }
        cases.push(Case {
            id: q.id,
            conversation: q.conversation,
            space: Some(q.space),
            question: q.question,
            documents: q.documents,
            expected: String::new(),
            required: vec![],
        });
    }
    Ok(Fixture {
        cases,
        documents: p.documents,
        spaces: p.spaces,
    })
}

pub(super) fn candidate_snapshot(
    hits: &[models::SearchResult],
    paths: &HashMap<String, String>,
) -> Value {
    let passage = |hit: &models::SearchResult| {
        let document = paths
            .iter()
            .find(|(_, path)| **path == hit.path)
            .map(|(id, _)| id);
        json!({"doc":document, "text": hit.text, "sha256":hit.hash, "first":hit.start_line,
            "last":hit.end_line, "bm25Rank":hit.bm25_rank,"matchKind":hit.match_kind})
    };
    let mut ranked: Vec<_> = hits.iter().filter(|h| h.bm25_rank.is_some()).collect();
    ranked.sort_by_key(|h| (h.bm25_rank, h.id));
    json!({
        "top8": ranked.into_iter().take(8).map(passage).collect::<Vec<_>>(),
        "admitted": hits.iter().filter(|h| h.evidence).map(passage).collect::<Vec<_>>(),
    })
}

async fn execute(
    path: &Path,
    settings: Settings,
    credentials: Option<crate::credentials::CredentialReader>,
) -> Result<(), &'static str> {
    run_fixture(
        &SUITE,
        "keyword",
        settings,
        credentials,
        load()?,
        ReportTarget {
            path: path.to_owned(),
            fixture_hash: PACKET_HASH,
            rubric_hash: Some(RUBRIC_HASH),
        },
    )
    .await
}

pub(crate) async fn live_with_settings(
    path: &Path,
    config: Settings,
    credentials: crate::credentials::CredentialReader,
) -> Result<(), &'static str> {
    execute(path, config, Some(credentials)).await
}

#[test]
#[ignore = "Explicit synthetic live evaluation, saved endpoint and key required"]
fn live_frozen_packet() -> Result<(), &'static str> {
    if cfg!(feature = "desktop-e2e") || std::env::var("INKSTONE_RC4_LIVE").as_deref() != Ok("1") {
        return Err("standard build and INKSTONE_RC4_LIVE=1 required");
    }
    let mut config = saved_settings()?;
    config.candidate_reading = true;
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|_| "runtime-initialization-failed")?;
    let result = runtime.block_on(CREDENTIAL_DIRECTORY.scope(
        saved_credential_directory()?,
        live_with_settings(&report_path(&SUITE)?, config, Default::default()),
    ));
    runtime.shutdown_background();
    result
}

#[tokio::test]
async fn offline_frozen_packet() -> Result<(), &'static str> {
    let temporary = tempfile::tempdir().map_err(|_| "temporary-dir-failed")?;
    let path = std::env::var_os("INKSTONE_RC4_OFFLINE_REPORT")
        .map(PathBuf::from)
        .unwrap_or_else(|| temporary.path().join("offline.json"));
    execute(&path, Settings::default(), None).await?;
    let report: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    assert_eq!(report["fixtureSha256"], PACKET_HASH);
    assert_eq!(report["live"], false);
    assert_eq!(report["status"], "complete");
    assert_eq!(report["usage"]["httpAttempts"], 0);
    let f = load()?;
    let rows = report["records"].as_array().unwrap();
    assert_eq!(rows.len(), 50);
    assert_eq!(f.cases.len(), rows.len());
    let mut histories: HashMap<String, Vec<String>> = HashMap::new();
    let mut followups = 0;
    for (row, case) in rows.iter().zip(f.cases) {
        assert_eq!(row["id"], case.id);
        assert_eq!(row["question"], case.question);
        assert_eq!(row["outOfScopePath"], false);
        assert!(row["failure"].is_null());
        assert_eq!(row["selectedDocuments"], json!(case.documents));
        assert_eq!(row["workspaceDocuments"].as_object().unwrap().len(), 2);
        assert_eq!(row["scope"], row["workspaceDocuments"][&case.documents[0]]);
        let history = histories.entry(case.conversation).or_default();
        assert_eq!(row["previousQuestions"], json!(history));
        followups += usize::from(!history.is_empty());
        history.push(case.question);
        if row["clarification"].is_null() {
            let stages = &row["rc4Candidates"];
            for stage in ["top8", "admitted"] {
                let candidates = stages[stage]
                    .as_array()
                    .expect("missing RC4 candidate trace");
                if stage == "top8" {
                    assert!(candidates.len() <= 8);
                }
                assert!(candidates.iter().all(|h| h["doc"] == case.documents[0]));
            }
        }
    }
    assert_eq!(followups, 10);
    Ok(())
}
