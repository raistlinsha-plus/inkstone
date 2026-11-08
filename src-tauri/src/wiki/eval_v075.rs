//! Fixed v0.7.5 retrieval benchmark. No model client, production data, or credentials.
use super::*;
use serde_json::{json, Value};
use std::{path::PathBuf, time::Instant};

const FIXTURE: &str = include_str!("../../../evals/v0.7.5/retrieval-cases.json");
const CONTEXT_BUDGET: usize = 6000;
const MODES: [&str; 2] = ["bm25", "bm25+wiki"];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Benchmark {
    #[serde(flatten)]
    corpus: Corpus,
    wiki_excluded: Vec<String>,
    cases: Vec<Trial>,
}

#[derive(Deserialize)]
struct Trial {
    id: String,
    family: String,
    query: String,
    scope: Option<String>,
    replace: Option<String>,
    expectation: Expectation,
    required: Vec<Line>,
}

#[derive(Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum Expectation {
    Complete,
    Conflict,
    Partial,
    None,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Measurement<'a> {
    candidate_count: usize,
    context_count: usize,
    required_in_candidates: Vec<&'a Line>,
    required_in_context: Vec<&'a Line>,
    context_sources: Vec<ContextSource<'a>>,
    retrieval_micros: u128,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ContextSource<'a> {
    document: &'a str,
    start_line: usize,
    end_line: usize,
    match_kind: &'a str,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct Totals {
    required_in_candidates: usize,
    required_in_context: usize,
    complete_cases_with_all_passages: usize,
    conflict_cases_with_both_passages: usize,
    partial_cases_with_known_passage: usize,
    no_support_cases_with_context: usize,
    context_ranges_verified: usize,
    p50_retrieval_micros: u128,
    p95_retrieval_micros: u128,
    #[serde(skip)]
    timings: Vec<u128>,
}

impl Totals {
    fn add(&mut self, case: &Trial, measurement: &Measurement<'_>) {
        let candidate_count = measurement.required_in_candidates.len();
        let context_count = measurement.required_in_context.len();
        self.required_in_candidates += candidate_count;
        self.required_in_context += context_count;
        self.context_ranges_verified += measurement.context_count;
        self.timings.push(measurement.retrieval_micros);
        match case.expectation {
            Expectation::Complete => {
                self.complete_cases_with_all_passages +=
                    usize::from(context_count == case.required.len());
            }
            Expectation::Conflict => {
                self.conflict_cases_with_both_passages +=
                    usize::from(context_count == case.required.len());
            }
            Expectation::Partial => {
                self.partial_cases_with_known_passage += usize::from(context_count > 0)
            }
            Expectation::None => {
                self.no_support_cases_with_context += usize::from(measurement.context_count > 0)
            }
        }
    }

    fn summarize_timings(&mut self) {
        self.timings.sort_unstable();
        self.p50_retrieval_micros = self.timings[(self.timings.len() * 50).div_ceil(100) - 1];
        self.p95_retrieval_micros = self.timings[(self.timings.len() * 95).div_ceil(100) - 1];
    }
}

fn retrieve(
    seed: &Seeded,
    question: &str,
    scope: Option<&str>,
    use_wiki: bool,
) -> (Vec<SearchResult>, Vec<SearchResult>, u128) {
    let start = Instant::now();
    let query = retrieval::knowledge_query(question);
    let lexical = db::lexical_scored(&seed.index, &query, scope).unwrap();
    let mut results = db::merge_candidates(&seed.index, &seed.ws, &lexical, &[]).unwrap();
    if use_wiki {
        let hits = recall(seed.data.path(), &seed.ws, &query, scope).unwrap();
        retrieval::merge_wiki(&mut results, hits);
    }
    let catalogue = crate::managed_sources(seed.data.path(), &seed.ws)
        .unwrap()
        .unwrap();
    results.retain_mut(|result| {
        let Some((id, title)) = catalogue.get(&result.path) else {
            return false;
        };
        result.document_id = Some(id.clone());
        result.title = Some(title.clone());
        true
    });
    retrieval::mark_lexical_evidence(&query, &mut results);
    retrieval::retain_current_sources(&seed.ws, &mut results);
    retrieval::finish_ranking(&mut results);
    let context =
        retrieval::generation_context(&seed.ws, &results, CONTEXT_BUDGET, scope.is_some());
    (results, context, start.elapsed().as_micros())
}

fn covered<'a>(
    corpus: &Corpus,
    seed: &Seeded,
    required: &'a [Line],
    results: &[SearchResult],
) -> Vec<&'a Line> {
    required
        .iter()
        .filter(|passage| {
            let doc = &seed.docs[&passage.document];
            let text = source_line(&corpus.documents[&passage.document], passage.line);
            results.iter().any(|hit| {
                hit.document_id.as_deref() == Some(doc.id.as_str())
                    && (hit.start_line..=hit.end_line).contains(&passage.line)
                    && hit.text.lines().nth(passage.line - hit.start_line) == Some(text)
            })
        })
        .collect()
}

fn context_sources<'a>(
    seed: &'a Seeded,
    case: &Trial,
    context: &'a [SearchResult],
) -> Vec<ContextSource<'a>> {
    context
        .iter()
        .map(|hit| {
            let (key, doc) = seed
                .docs
                .iter()
                .find(|(_, doc)| doc.path == hit.path)
                .unwrap();
            let original = files::read_text(&seed.ws.root.join(&doc.path)).unwrap();
            assert_eq!(
                hit.document_id.as_deref(),
                Some(doc.id.as_str()),
                "{}",
                case.id
            );
            assert_eq!(hit.hash, files::hash(&original), "{}", case.id);
            assert!(
                hit.start_line > 0
                    && hit.start_line <= hit.end_line
                    && hit.end_line <= original.lines().count(),
                "{}",
                case.id
            );
            let expected = original
                .lines()
                .skip(hit.start_line - 1)
                .take(hit.end_line - hit.start_line + 1);
            assert!(
                hit.text.lines().eq(expected),
                "{} context is not the cited original",
                case.id
            );
            ContextSource {
                document: key,
                start_line: hit.start_line,
                end_line: hit.end_line,
                match_kind: &hit.match_kind,
            }
        })
        .collect()
}

#[test]
fn independent_offline_retrieval_v075() {
    let benchmark: Benchmark = serde_json::from_str(FIXTURE).unwrap();
    let seed = seed(&benchmark.corpus, 1200, |key| {
        !benchmark.wiki_excluded.iter().any(|item| item == key)
    });
    let mut totals = [Totals::default(), Totals::default()];
    let mut trials = Vec::<Value>::new();
    let mut ids = HashSet::new();
    for (i, case) in benchmark.cases.iter().enumerate() {
        assert!(ids.insert(&case.id), "Duplicate case ID {}", case.id);
        assert_eq!(
            case.required.is_empty(),
            case.expectation == Expectation::None,
            "{}",
            case.id
        );
        let scope = case.scope.as_ref().map(|id| seed.docs[id].path.as_str());
        let changed = case.replace.as_ref().map(|content| {
            let path = seed
                .ws
                .root
                .join(scope.expect("Stale fixture must name a scoped document"));
            files::write_atomic(&path, content.as_bytes()).unwrap();
            path
        });
        let mut measurements = serde_json::Map::new();
        // Alternate which mode sees the question first to share any warm-cache effect.
        for mode in [i % 2, (i + 1) % 2] {
            let (candidates, context, retrieval_micros) =
                retrieve(&seed, &case.query, scope, mode == 1);
            if let Some(path) = scope {
                assert!(
                    candidates
                        .iter()
                        .chain(&context)
                        .all(|hit| hit.path == path),
                    "{}",
                    case.id
                );
            }
            if case
                .scope
                .as_ref()
                .is_some_and(|id| benchmark.wiki_excluded.contains(id))
            {
                assert!(
                    candidates.iter().all(|hit| hit.match_kind != "wiki"),
                    "{} used a document outside Wiki policy",
                    case.id
                );
            }
            if changed.is_some() {
                assert!(
                    candidates.is_empty() && context.is_empty(),
                    "{} leaked a stale original",
                    case.id
                );
            }
            let measurement = Measurement {
                candidate_count: candidates.len(),
                context_count: context.len(),
                required_in_candidates: covered(
                    &benchmark.corpus,
                    &seed,
                    &case.required,
                    &candidates,
                ),
                required_in_context: covered(&benchmark.corpus, &seed, &case.required, &context),
                context_sources: context_sources(&seed, case, &context),
                retrieval_micros,
            };
            totals[mode].add(case, &measurement);
            measurements.insert(
                MODES[mode].into(),
                serde_json::to_value(measurement).unwrap(),
            );
        }
        if let Some(path) = changed {
            let document = &benchmark.corpus.documents[case.scope.as_ref().unwrap()];
            files::write_atomic(&path, document.content.as_bytes()).unwrap();
        }
        trials.push(json!({
            "id": case.id,
            "family": case.family,
            "expectation": case.expectation,
            "required": case.required,
            "measurements": measurements
        }));
    }
    for total in &mut totals {
        total.summarize_timings();
    }
    let report = json!({
        "schema": 1,
        "fixtureSha256": files::hash(FIXTURE),
        "documents": seed.docs.len(),
        "wikiPages": benchmark.corpus.pages.len(),
        "cases": benchmark.cases.len(),
        "requiredPassages": benchmark.cases.iter().map(|case| case.required.len()).sum::<usize>(),
        "contextBudgetChars": CONTEXT_BUDGET,
        "providerCalls": 0,
        "answerQuality": null,
        "answerCitationSupport": null,
        "totals": { (MODES[0]): totals[0], (MODES[1]): totals[1] },
        "trials": trials
    });
    if let Some(path) = std::env::var_os("INKSTONE_V075_RETRIEVAL_REPORT") {
        let path = PathBuf::from(path);
        assert!(path.is_absolute(), "Report path must be absolute");
        let file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(path)
            .unwrap();
        serde_json::to_writer_pretty(file, &report).unwrap();
    }
    println!("v0.7.5 offline retrieval summary: {}", report["totals"]);
}
