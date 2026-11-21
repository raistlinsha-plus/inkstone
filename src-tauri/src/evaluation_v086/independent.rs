//! The hash-pinned public packet supplies all questions and document text.
use super::*;

const PACKET_HASH: &str = "6fd92300fede2d70bf01b4f882d048af7a1dd4513f3bb907c740c83de2ffe97f";
const SUITE: Suite = Suite {
    id: "v100-independent",
    env_prefix: "INKSTONE_100_INDEPENDENT",
    fixture: "",
    rubric: "",
    hashes: "",
    max_requests: 104,
    max_seconds: 1200,
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Packet {
    cases: Vec<PublicCase>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PublicCase {
    id: String,
    question: String,
    documents: Vec<PublicDocument>,
    follow_up_to: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PublicDocument {
    id: String,
    title: String,
    lines: Vec<String>,
}

fn load_packet() -> Result<Fixture, &'static str> {
    let path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../evals/v1.0/independent/questions.json");
    let bytes = fs::read(path).map_err(|_| "missing-public-packet")?;
    if files::hash(&bytes) != PACKET_HASH {
        return Err("unexpected-public-packet-hash");
    }
    let packet: Packet = serde_json::from_slice(&bytes).map_err(|_| "invalid-public-packet")?;
    let mut documents = HashMap::new();
    let mut cases = Vec::new();
    let mut roots: HashMap<String, String> = HashMap::new();
    for case in packet.cases {
        let mut ids = Vec::new();
        for document in case.documents {
            ids.push(document.id.clone());
            documents
                .entry(document.id.clone())
                .or_insert_with(|| Document {
                    id: document.id,
                    title: document.title,
                    text: document.lines.join("\n"),
                });
        }
        let root = match &case.follow_up_to {
            Some(parent) => roots.get(parent).ok_or("invalid-prior-turn")?.clone(),
            None => case.id.clone(),
        };
        roots.insert(case.id.clone(), root.clone());
        cases.push(Case {
            conversation: root,
            id: case.id,
            question: case.question,
            documents: ids,
            space: None,
            expected: String::new(),
            required: vec![],
        });
    }
    let mut documents: Vec<_> = documents.into_values().collect();
    documents.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(Fixture {
        documents,
        cases,
        spaces: HashMap::new(),
    })
}

#[test]
#[ignore = "Explicit keyword-mode live run on the hash-pinned, synthetic public questions only"]
fn live_keyword_packet() -> Result<(), &'static str> {
    if std::env::var("INKSTONE_100_INDEPENDENT_LIVE").as_deref() != Ok("1")
        || cfg!(feature = "desktop-e2e")
    {
        return Err("requires explicit LIVE=1 and standard build");
    }
    let fixture = load_packet()?;
    let config = saved_settings()?;
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|_| "runtime initialization failed")?;
    let result = runtime.block_on(run_fixture(
        &SUITE,
        "keyword",
        config,
        true,
        fixture,
        ReportTarget {
            path: report_path(&SUITE)?,
            fixture_hash: PACKET_HASH,
            rubric_hash: None,
        },
    ));
    runtime.shutdown_background();
    result
}

#[tokio::test]
async fn offline_public_packet_preserves_scope_and_history() -> Result<(), &'static str> {
    let fixture = load_packet()?;
    assert_eq!(fixture.documents.len(), 25);
    assert_eq!(fixture.cases.len(), 52);
    let scope_and_history: Vec<_> = fixture
        .cases
        .iter()
        .map(|case| {
            (
                case.id.clone(),
                case.documents.clone(),
                case.conversation.clone(),
                case.question.clone(),
            )
        })
        .collect();
    let temporary = tempfile::tempdir().map_err(|_| "temporary-report-directory-failed")?;
    let path = temporary.path().join("offline.json");
    run_fixture(
        &SUITE,
        "keyword",
        Settings::default(),
        false,
        fixture,
        ReportTarget {
            path: path.clone(),
            fixture_hash: PACKET_HASH,
            rubric_hash: None,
        },
    )
    .await?;
    let report: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    assert_eq!(report["fixtureSha256"], PACKET_HASH);
    assert_eq!(report["status"], "complete");
    assert_eq!(report["usage"]["httpAttempts"], 0);
    assert_eq!(report["live"], false);
    let records = report["records"].as_array().unwrap();
    assert_eq!(records.len(), scope_and_history.len());
    let mut histories: HashMap<String, Vec<String>> = HashMap::new();
    let mut followups = 0;
    for (row, (id, docs, root, question)) in records.iter().zip(scope_and_history) {
        assert_eq!(row["id"], id);
        assert_eq!(row["question"], question);
        assert_eq!(row["selectedDocuments"], json!(docs));
        let actual = row["workspaceDocuments"].as_object().unwrap();
        assert_eq!(actual.len(), docs.len());
        assert!(docs.iter().all(|id| actual.contains_key(id)));
        if docs.len() == 1 {
            assert_eq!(row["scope"], actual[&docs[0]]);
        } else {
            assert!(row["scope"].is_null());
        }
        assert_eq!(row["outOfScopePath"], false);
        assert!(row["failure"].is_null());
        assert!(row["sourceDocuments"]
            .as_array()
            .unwrap()
            .iter()
            .all(|source| source
                .as_str()
                .is_some_and(|source| actual.contains_key(source))));
        let history = histories.entry(root).or_default();
        assert_eq!(row["previousQuestions"], json!(history), "{id}");
        followups += usize::from(!history.is_empty());
        history.push(question);
    }
    assert_eq!(followups, 7);
    Ok(())
}
