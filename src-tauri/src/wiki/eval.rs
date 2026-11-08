use super::*;
use crate::retrieval;
use std::collections::BTreeMap;

#[path = "eval_v075.rs"]
mod v075;

#[derive(Deserialize)]
struct Fixture {
    #[serde(flatten)]
    corpus: Corpus,
    cases: Vec<Case>,
}

#[derive(Deserialize)]
struct Corpus {
    documents: BTreeMap<String, SourceDocument>,
    pages: Vec<SeedPage>,
}

#[derive(Deserialize)]
struct SourceDocument {
    title: String,
    content: String,
}

#[derive(Deserialize)]
struct SeedPage {
    id: String,
    title: String,
    summary: String,
    aliases: Vec<String>,
    sections: Vec<SeedSection>,
}

#[derive(Deserialize)]
struct SeedSection {
    heading: String,
    refs: Vec<Line>,
}

#[derive(Deserialize, Serialize)]
struct Line {
    document: String,
    line: usize,
}

#[derive(Deserialize)]
struct Case {
    id: String,
    query: String,
    scope: Option<String>,
    edit: Option<String>,
    expected: Vec<Line>,
    context: bool,
}

fn source_line(document: &SourceDocument, line: usize) -> &str {
    document.content.lines().nth(line - 1).unwrap()
}

struct Seeded {
    data: tempfile::TempDir,
    ws: Workspace,
    index: Connection,
    docs: BTreeMap<String, library::Document>,
}

fn seed(corpus: &Corpus, chunk_chars: usize, wiki_authorized: impl Fn(&str) -> bool) -> Seeded {
    let data = tempfile::tempdir().unwrap();
    let space = library::create_project(data.path(), "离线 Wiki 评测")
        .unwrap()
        .id;
    let ws = Workspace {
        root: library::project_root(data.path(), &space).unwrap(),
        db: data.path().join("index.sqlite3"),
    };
    let mut index = db::open(&ws.db).unwrap();
    let mut docs = BTreeMap::new();
    for (key, source) in &corpus.documents {
        let doc =
            library::create_document(data.path(), &space, &source.title, &source.content).unwrap();
        let chunks = db::local_chunks(&source.content, &doc.path, chunk_chars);
        db::refresh_lexical(
            &mut index,
            &doc.path,
            &files::hash(&source.content),
            &chunks,
            &doc.title,
        )
        .unwrap();
        docs.insert(key.clone(), doc);
    }
    let policy = Policy {
        revision: 1,
        enabled: true,
        topic: "离线 Wiki 评测".into(),
        document_ids: docs
            .iter()
            .filter(|(key, _)| wiki_authorized(key))
            .map(|(_, doc)| doc.id.clone())
            .collect(),
        ..Default::default()
    };
    let mut wiki = store::write(data.path()).unwrap();
    let tx = wiki.transaction().unwrap();
    store::save_policy(&tx, &space, &policy).unwrap();
    for seed in &corpus.pages {
        let mut change = store::Change {
            id: format!("change-{}", seed.id),
            page_id: seed.id.clone(),
            base: 0,
            result: 0,
            policy_revision: policy.revision,
            status: "pending".into(),
            reason: "authored eval".into(),
            created: store::now(),
            content: Content {
                title: seed.title.clone(),
                summary: seed.summary.clone(),
                aliases: seed.aliases.clone(),
                related: vec![],
                sections: seed
                    .sections
                    .iter()
                    .map(|section| Section {
                        heading: section.heading.clone(),
                        refs: section
                            .refs
                            .iter()
                            .map(|item| {
                                let doc = &docs[&item.document];
                                let source = &corpus.documents[&item.document];
                                Original {
                                    document_id: doc.id.clone(),
                                    title: doc.title.clone(),
                                    path: doc.path.clone(),
                                    start_line: item.line,
                                    end_line: item.line,
                                    quote: source_line(source, item.line).into(),
                                    hash: files::hash(&source.content),
                                }
                            })
                            .collect(),
                    })
                    .collect(),
                inputs: vec![],
            },
        };
        change.content.inputs = change
            .content
            .originals()
            .map(super::InputVersion::from)
            .collect::<std::collections::HashSet<_>>()
            .into_iter()
            .collect();
        store::save_change(&tx, &space, &change).unwrap();
        // The frozen corpus includes a summary from before the publication guard.
        // Seed it as archived data so retrieval still has to handle legacy input.
        store::publish(&tx, &space, &change).unwrap();
    }
    tx.commit().unwrap();
    Seeded {
        data,
        ws,
        index,
        docs,
    }
}

#[test]
fn authored_offline_bm25_and_wiki_cases() {
    let fixture: Fixture =
        serde_json::from_str(include_str!("../../../evals/v0.7.2/wiki-cases.json")).unwrap();
    let Seeded {
        data,
        ws,
        index,
        docs,
    } = seed(&fixture.corpus, 1000, |key| key != "excluded");

    let mut totals = [[0; 2]; 2];
    let mut required = 0;
    let mut required_context = 0;
    for case in fixture.cases {
        if let Some(key) = &case.edit {
            files::write_atomic(&ws.root.join(&docs[key].path), "内容已更新。".as_bytes()).unwrap();
        }
        let scope = case.scope.as_ref().map(|key| docs[key].path.as_str());
        let lexical = db::lexical_scored(&index, &case.query, scope).unwrap();
        let baseline = db::merge_candidates(&index, &ws, &lexical, &[]).unwrap();
        let wiki_hits = recall(data.path(), &ws, &case.query, scope).unwrap();
        for hit in &wiki_hits {
            let body = files::read_text(&ws.root.join(&hit.path)).unwrap();
            assert_eq!(hit.hash, files::hash(&body));
            let excerpt = body
                .lines()
                .skip(hit.start_line - 1)
                .take(hit.end_line - hit.start_line + 1)
                .collect::<Vec<_>>()
                .join("\n");
            assert_eq!(hit.text, excerpt, "{}", case.id);
        }
        let mut combined = baseline.clone();
        retrieval::merge_wiki(&mut combined, wiki_hits);
        let count = |results: &[SearchResult]| {
            case.expected
                .iter()
                .filter(|item| {
                    let doc = &docs[&item.document];
                    let phrase = source_line(&fixture.corpus.documents[&item.document], item.line);
                    results.iter().any(|hit| {
                        hit.path == doc.path
                            && (hit.start_line..=hit.end_line).contains(&item.line)
                            && hit.text.contains(phrase)
                    })
                })
                .count()
        };
        let expected = case.expected.len();
        required += expected;
        if case.context {
            required_context += expected;
        }
        for (column, mut candidates) in [baseline, combined].into_iter().enumerate() {
            if let Some(path) = scope {
                assert!(candidates.iter().all(|hit| hit.path == path), "{}", case.id);
            }
            retrieval::mark_lexical_evidence(&case.query, &mut candidates);
            retrieval::finish_ranking(&mut candidates);
            let context = retrieval::generation_context(&ws, &candidates, 10_000, scope.is_some());
            let candidate_count = count(&candidates);
            let context_count = count(&context);
            totals[column][0] += candidate_count;
            totals[column][1] += context_count;
            if column == 1 {
                assert_eq!(candidate_count, expected, "{}", case.id);
            }
            if case.context {
                assert_eq!(context_count, expected, "{}", case.id);
            } else {
                assert!(context.is_empty(), "{}", case.id);
                if expected == 0 {
                    assert!(candidates.is_empty(), "{}", case.id);
                }
            }
            print!(
                "{} {} candidate={}/{} accepted={}  ",
                case.id,
                if column == 0 { "BM25" } else { "BM25+Wiki" },
                candidate_count,
                expected,
                context_count
            );
        }
        println!();
    }
    println!(
        "Required original passages: {required}; eligible passages: {required_context}; BM25 candidate/accepted {:?}; BM25+Wiki candidate/accepted {:?}",
        totals[0], totals[1]
    );
}
