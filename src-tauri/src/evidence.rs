//! Lexical support for explicitly named comparisons. Relevance scores never grant support.
use crate::{db, models::SearchResult};
use std::{collections::HashSet, path::Path};

mod predicate;
pub(crate) mod wiki_alias;

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

fn source_name(r: &SearchResult, name: &str) -> bool {
    r.title
        .as_ref()
        .is_some_and(|t| t.to_lowercase().contains(name))
        || Path::new(&r.path)
            .file_stem()
            .is_some_and(|t| t.to_string_lossy().to_lowercase().contains(name))
}

// Each side is attributed using the document's title. The factual part still
// has to match the original body, and a document naming both sides is ambiguous.
fn attributed_comparison(query: &str) -> Option<(Vec<String>, [&str; 2])> {
    let (fact, attribution) = query
        .trim_end_matches(['？', '?'])
        .split_once(['，', ','])?;
    let pair = [
        "的规定一致吗",
        "的记录一致吗",
        "的说法一致吗",
        "的结论一致吗",
        "的规定是否一致",
        "的记录是否一致",
        "的说法是否一致",
        "的结论是否一致",
    ]
    .into_iter()
    .find_map(|suffix| attribution.trim().strip_suffix(suffix))?;
    let (a, b) = pair.split_once(['和', '与', '及'])?;
    let labels = [a.trim(), b.trim()];
    if labels[0].contains(labels[1])
        || labels[1].contains(labels[0])
        || labels.iter().any(|name| {
            !(2..=16).contains(&name.chars().count()) || name.chars().any(|c| !c.is_alphanumeric())
        })
    {
        return None;
    }
    let fact = comparison_terms(fact);
    (fact.len() >= 2).then_some((fact, labels))
}

fn subquestion_terms(query: &str) -> Vec<(&str, Vec<String>)> {
    let clauses = query
        .split(['？', '?', '；', ';'])
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    if !(2..=4).contains(&clauses.len()) {
        return vec![];
    }
    clauses
        .into_iter()
        .map(|question| {
            // Refuse to split statements or a clause with a trailing side
            // constraint. Each accepted clause is a standalone question.
            let clause = [
                "是多少",
                "多少",
                "是什么",
                "什么",
                "是谁",
                "谁",
                "在哪里",
                "在哪",
            ]
            .into_iter()
            .find_map(|ending| question.strip_suffix(ending))?
            .trim();
            if clause.contains(['，', ',', '。', '：', ':', '“', '”', '"'])
                || [
                    "其中",
                    "前者",
                    "后者",
                    "只看",
                    "仅限",
                    "只根据",
                    "仅根据",
                    "只用",
                    "仅用",
                    "限定",
                    "排除",
                    "不要",
                    "不考虑",
                    "不引用",
                    "以及",
                    "同样",
                    "也",
                ]
                .iter()
                .any(|part| clause.contains(part))
            {
                return None;
            }
            let words = terms(clause);
            (words.len() >= 2).then_some((question, words))
        })
        .collect::<Option<Vec<_>>>()
        .unwrap_or_default()
}

// A value question needs a factual body clause, even when the title contains
// every query term. Unannounced or explicitly inapplicable values cannot fill it.
fn requested_value(query: &str, body: &str) -> bool {
    let query = query.trim().trim_end_matches(['？', '?', '。', '.']);
    let Some(prefix) = [
        "多少分贝",
        "多少分钟",
        "多少小时",
        "多少个月",
        "多少天",
        "多少年",
        "多少周",
        "多少支",
        "多少件",
        "多少个",
        "多少钱",
        "几天",
        "几小时",
        "设定是多少",
        "是多少",
        "有多长",
        "多长",
        "多久",
        "多少",
        "是几度",
        "几度",
    ]
    .into_iter()
    .find_map(|ending| query.strip_suffix(ending)) else {
        return true;
    };
    let prefix = prefix
        .trim_end_matches([' ', '为'])
        .trim_end_matches("具体");
    let relation = if ["有效期", "有效时长"]
        .iter()
        .any(|attribute| prefix.ends_with(attribute))
    {
        wiki_alias::Relation::Validity
    } else if prefix.ends_with("温度") {
        wiki_alias::Relation::Temperature
    } else {
        for (attribute, units) in [
            ("最低库存", &["支", "件", "个", "瓶", "盒", "包"][..]),
            ("补助", &["元", "美元"][..]),
            ("噪声上限", &["分贝", "db"][..]),
        ] {
            if let Some(subject) = prefix.strip_suffix(attribute) {
                return wiki_alias::supports_named_quantity(subject, attribute, units, body);
            }
        }
        return true;
    };
    wiki_alias::supports_value(relation, query, body)
}

fn years(text: &str) -> impl Iterator<Item = &str> {
    text.match_indices('年').filter_map(|(at, _)| {
        let prefix = text[..at].trim_end();
        let digits = prefix.bytes().rev().take_while(u8::is_ascii_digit).count();
        (digits == 4).then(|| &prefix[prefix.len() - digits..])
    })
}

fn supports_clause(words: &[String], body: &HashSet<String>) -> bool {
    covered(words, body)
        && words
            .iter()
            .filter(|word| body.contains(word.as_str()))
            .count()
            >= 2
        && words
            .iter()
            .filter(|word| word.chars().any(|c| c.is_ascii_digit()))
            .all(|word| body.contains(word.as_str()))
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
    let attributed = attributed_comparison(&query);
    let subquestions = if names.is_empty() && attributed.is_none() {
        subquestion_terms(&query)
    } else {
        vec![]
    };
    let predicate = (names.is_empty() && attributed.is_none() && subquestions.is_empty())
        .then(|| predicate::Request::parse(&query))
        .flatten();
    let mut requested_years = years(&query);
    let year = requested_years
        .next()
        .filter(|first| subquestions.is_empty() && requested_years.all(|other| other == *first));
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
        let ordinary = if names.is_empty() {
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
        let wiki = r.match_kind.starts_with("wiki");
        let original_alias_anchor = r.match_kind == wiki_alias::ANCHORED;
        let supported = if attributed.is_some() || !subquestions.is_empty() {
            let body = db::tokenize(&r.text)
                .split_whitespace()
                .map(str::to_owned)
                .collect::<HashSet<_>>();
            if let Some((fact, labels)) = &attributed {
                labels.iter().filter(|label| source_name(r, label)).count() == 1
                    && supports_clause(fact, &body)
            } else {
                subquestions.iter().any(|(question, words)| {
                    supports_clause(words, &body) && requested_value(question, &r.text)
                })
            }
        } else {
            ordinary && requested_value(&query, &r.text)
        };
        r.evidence = (r.bm25_rank.is_some() || wiki)
            && has_body
            && year.is_none_or(|year| years(&text).any(|seen| seen == year))
            && (supported
                || original_alias_anchor
                || (!wiki
                    && predicate.as_ref().is_some_and(|request| {
                        request.supports(r.title.as_deref(), &r.heading, &r.text)
                    })));
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

    #[test]
    fn separate_questions_keep_numeric_and_scope_constraints() {
        let mut hits = vec![
            hit("活动票据", "2026年预约时长：最多80分钟。"),
            hit("交接通知", "服务凭据交给管理员。"),
            hit("错误年份", "2025年预约时长：最多90分钟。"),
        ];
        mark("2026年预约时长是多少？服务凭据交给谁？", &mut hits);
        assert!(hits[0].evidence && hits[1].evidence);
        assert!(!hits[2].evidence);
        assert!(subquestion_terms("只根据交接通知的预约时长是多少？服务凭据交给谁？").is_empty());
        assert!(subquestion_terms("2026年预约时长是多少？前者交给谁？").is_empty());
    }

    #[test]
    fn a_validity_question_needs_a_value_from_the_body() {
        let title = "飞行培训结业证书有效期";
        let mut hits = [
            hit(title, "证书复印件由教务处归档。"),
            hit(title, "有效期未公布。"),
            hit(title, "飞行培训结业证书有效期将在新通知中另行公布。"),
            hit(title, "飞行培训结业证书有效期为72小时。"),
            hit("归档流程", "资料归档责任人是教务组长。"),
        ];
        let question = "飞行培训结业证书有效期是多少？";
        mark(question, &mut hits);
        assert!(hits[..3].iter().all(|hit| !hit.evidence));
        assert!(hits[3].evidence);
        assert!(!hits[4].evidence);
        mark(&format!("{question}资料归档责任人是谁？"), &mut hits);
        assert!(hits[..3].iter().all(|hit| !hit.evidence));
        assert!(hits[3..].iter().all(|hit| hit.evidence));
    }

    #[test]
    fn source_attribution_keeps_two_named_versions_without_third_party() {
        let mut hits = vec![
            hit("北岭通知.md", "北岭取件期限为2天。"),
            hit("北岭手册.md", "北岭取件期限为3天。"),
            hit("北岭传闻.md", "北岭取件期限为5天。"),
            hit("北岭通知与手册.md", "北岭取件期限为4天。"),
        ];
        mark("北岭取件期限，通知和手册的说法一致吗？", &mut hits);
        assert!(hits[0].evidence && hits[1].evidence);
        assert!(!hits[2].evidence && !hits[3].evidence);
    }
}
