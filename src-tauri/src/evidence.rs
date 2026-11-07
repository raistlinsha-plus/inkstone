//! Lexical support for explicitly named comparisons. Relevance scores never grant support.
use crate::{db, models::SearchResult};
use std::{collections::HashSet, path::Path};

fn terms(query: &str) -> Vec<String> {
    db::query_terms(query)
        .into_iter()
        .filter(|s| s.chars().count() > 1 || query.trim() == s)
        .collect()
}
fn covered(terms: &[String], content: &HashSet<String>) -> bool {
    !terms.is_empty()
        && terms
            .iter()
            .filter(|t| content.contains(t.as_str()))
            .count()
            * 3
            >= terms.len() * 2
}
fn comparison_terms(query: &str) -> Vec<String> {
    terms(query)
        .into_iter()
        .filter(|s| {
            ![
                "比较", "对比", "分别", "分开", "引用", "来源", "列出", "两处", "两者", "各自",
                "各有", "方面", "在", "并", "各", "规定", "要求", "不同", "相同",
            ]
            .contains(&s.as_str())
        })
        .collect()
}
fn names(query: &str, results: &[SearchResult]) -> Vec<String> {
    if !["比较", "对比", "分别", "各自", "各有"]
        .iter()
        .any(|s| query.contains(s))
    {
        return vec![];
    }
    let mut found = results
        .iter()
        .flat_map(|r| {
            [
                r.title.as_deref(),
                Path::new(&r.path).file_stem().and_then(|s| s.to_str()),
            ]
            .into_iter()
            .flatten()
            .map(|name| {
                Path::new(name)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or(name)
                    .trim()
                    .to_lowercase()
            })
            .collect::<Vec<_>>()
        })
        .filter(|name| {
            name.chars().count() >= 4 && name.chars().count() <= 80 && query.contains(name)
        })
        .collect::<Vec<_>>();
    found.sort();
    found.dedup();
    // Overlapping names cannot identify independent comparison subjects safely.
    if found.iter().enumerate().any(|(i, a)| {
        found
            .iter()
            .enumerate()
            .any(|(j, b)| i != j && b.contains(a))
    }) {
        return vec![];
    }
    if (2..=4).contains(&found.len()) {
        found
    } else {
        vec![]
    }
}

pub fn mark(query: &str, results: &mut [SearchResult]) {
    let query = query.to_lowercase();
    let original = terms(&query);
    let names = names(&query, results);
    let mut shared = query.clone();
    for name in &names {
        shared = shared.replace(name, " ");
    }
    let attributes = comparison_terms(&shared);
    for r in results {
        let has_body = r.text.lines().any(|line| {
            let line = line.trim();
            if line.is_empty() {
                return false;
            }
            let hashes = line.bytes().take_while(|b| *b == b'#').count();
            !(hashes > 0 && hashes <= 6 && line[hashes..].starts_with(char::is_whitespace))
        });
        let text = format!(
            "{} {} {}",
            r.title.as_deref().unwrap_or(""),
            r.heading,
            r.text
        )
        .to_lowercase();
        let tokens = db::tokenize(&text)
            .split_whitespace()
            .map(str::to_owned)
            .collect::<HashSet<_>>();
        let supported = if names.is_empty() {
            covered(&original, &tokens)
        } else {
            let own = names
                .iter()
                .filter(|name| {
                    r.title
                        .as_deref()
                        .is_some_and(|t| t.to_lowercase().trim_end_matches(".md") == name.as_str())
                        || Path::new(&r.path)
                            .file_stem()
                            .is_some_and(|t| t.to_string_lossy().to_lowercase() == name.as_str())
                })
                .collect::<Vec<_>>();
            let mut scoped = query.clone();
            for name in names.iter().filter(|name| !own.contains(name)) {
                scoped = scoped.replace(name, " ");
            }
            // Apply the same 2/3 rule separately to the scoped question AND shared
            // attributes. Long subject names cannot outvote a missing requested fact.
            own.len() == 1
                && covered(&comparison_terms(&scoped), &tokens)
                && covered(&attributes, &tokens)
                && attributes
                    .iter()
                    .filter(|t| t.chars().any(|c| c.is_ascii_digit()))
                    .all(|t| tokens.contains(t))
        };
        let wiki = r.match_kind == "wiki";
        r.evidence = (r.bm25_rank.is_some() || wiki) && has_body && supported;
        r.match_kind = if wiki {
            "wiki"
        } else if r.evidence {
            "keyword"
        } else {
            "candidate"
        }
        .into();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn hit(name: &str, body: &str) -> SearchResult {
        serde_json::from_value(serde_json::json!({
            "id":1,"path":format!("{name}.md"),"title":name,"heading":"预约时长", "text":body,
            "startLine":1,"endLine":2,"hash":"h","score":1.0,"bm25Rank":1,
            "evidence":false,"matchKind":"candidate"
        }))
        .unwrap()
    }
    #[test]
    fn named_subjects_are_checked_separately_and_each_requires_the_shared_fact() {
        let mut hits = vec![
            hit("晨露绘图室", "预约时长：最多80分钟。"),
            hit("白帆制图社", "预约时长：最多95分钟。"),
            hit("远山手作社", "预约时长：最多90分钟。"),
        ];
        mark(
            "比较晨露绘图室与白帆制图社的预约时长，分别列出规定并引用来源",
            &mut hits,
        );
        assert!(
            hits[0].evidence && hits[1].evidence,
            "attributes={:?}; scoped={:?}",
            comparison_terms("与 的预约时长，分别列出规定并引用来源"),
            comparison_terms("比较晨露绘图室与 的预约时长，分别列出规定并引用来源")
        );
        assert!(!hits[2].evidence);
        mark("比较晨露绘图室与白帆制图社的2028年私人手机号码", &mut hits);
        assert!(hits.iter().all(|h| !h.evidence));
    }
    #[test]
    fn comparison_keeps_numeric_constraints_and_vector_only_never_grants_evidence() {
        let mut hits = vec![
            hit("晨露绘图室", "预约时长：2026年最多80分钟。"),
            hit("白帆制图社", "预约时长：2025年最多95分钟。"),
        ];
        mark("比较晨露绘图室与白帆制图社2026年的预约时长", &mut hits);
        assert!(hits[0].evidence);
        assert!(!hits[1].evidence);
        hits[0].bm25_rank = None;
        mark("比较晨露绘图室与白帆制图社2026年的预约时长", &mut hits);
        assert!(hits.iter().all(|h| !h.evidence));
    }
    #[test]
    fn title_mentions_without_a_requested_attribute_are_not_sufficient() {
        let mut hits = vec![
            hit("晨露绘图室", "预约时长：最多80分钟。"),
            hit("白帆制图社", "预约时长：最多95分钟。"),
        ];
        mark("比较晨露绘图室与白帆制图社，分别引用来源", &mut hits);
        assert!(hits.iter().all(|h| !h.evidence));
    }
    #[test]
    fn a_section_heading_alone_cannot_be_cited_as_its_missing_rule() {
        let mut hits = vec![
            hit("晨露绘图室", "## 预约时长\n\n"),
            hit("白帆制图社", "预约时长最多95分钟。"),
        ];
        mark("比较晨露绘图室与白帆制图社的预约时长", &mut hits);
        assert!(!hits[0].evidence);
        assert!(hits[1].evidence);
    }
}
