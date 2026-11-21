//! Lexical support for explicitly named comparisons. Relevance scores never grant support.
use crate::{
    db,
    models::{ChunkInput, SearchResult},
};
use std::{collections::HashSet, path::Path};

mod availability;
mod dated_clock;
mod facets;
mod per_unit;
mod predicate;
pub(crate) mod wiki_alias;

pub(crate) fn lexical_aliases(query: &str) -> Vec<String> {
    query
        .split(['？', '?', '；', ';'])
        .filter_map(availability::Availability::parse)
        .filter_map(|request| request.lexical_alias())
        .collect()
}

fn statements(text: &str) -> impl Iterator<Item = &str> {
    text.lines()
        .filter(|line| !line.trim_start().starts_with('#'))
        .flat_map(|line| line.split_inclusive(['。', '！', '？', '!', '?']))
        .map(str::trim)
        .filter(|line| !line.ends_with(['？', '?']))
        .map(|line| line.trim_end_matches(['。', '！', '!']).trim())
}

fn provisional(text: &str) -> bool {
    [
        "草案",
        "提案",
        "未生效",
        "征求意见",
        "拟议",
        "待确认",
        "未确认",
        "待核实",
        "未核实",
        "尚不确定",
        "尚未确定",
        "可能",
        "假设",
        "假如",
        "如果",
        "是否",
        "仅供讨论",
        "提议",
        "撤回",
        "作废",
    ]
    .iter()
    .any(|word| text.contains(word))
}

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

struct AttributedComparison<'a> {
    fact: Vec<String>,
    labels: [&'a str; 2],
    subject: Option<&'a str>,
}

fn comparison_labels(pair: &str) -> Option<[&str; 2]> {
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
    Some(labels)
}

// Each side is attributed using the document's title. Its original body
// must still support the fact, and a document naming both sides is ambiguous.
fn attributed_comparison(query: &str) -> Option<AttributedComparison<'_>> {
    let mut sentences = query
        .split(['？', '?'])
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let first = sentences.next()?;
    if sentences.any(|s| !matches!(s, "分别怎么说" | "各自怎么说" | "分别是什么")) {
        return None;
    }
    for (split, _) in first.match_indices('对') {
        let rest = first[split + '对'.len_utf8()..].trim();
        if let Some((subject, pair)) = first[..split].trim().rsplit_once('的') {
            let subject = subject.trim();
            let fact = [
                "说法一样吗",
                "说法一样",
                "说法是否一致",
                "说法一致",
                "说法相同",
            ]
            .iter()
            .find_map(|ending| rest.strip_suffix(ending))
            .map(comparison_terms);
            if let Some((fact, labels)) = fact.zip(comparison_labels(pair)).filter(|(fact, _)| {
                (2..=32).contains(&subject.chars().count())
                    && subject.chars().all(char::is_alphanumeric)
                    && fact.len() >= 2
            }) {
                return Some(AttributedComparison {
                    fact,
                    labels,
                    subject: Some(subject),
                });
            }
        }
    }
    let (fact, attribution) = first.split_once(['，', ','])?;
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
    let fact = comparison_terms(fact);
    Some(AttributedComparison {
        fact: (fact.len() >= 2).then_some(fact)?,
        labels: comparison_labels(pair)?,
        subject: None,
    })
}

struct Subquestion<'a> {
    question: &'a str,
    words: Vec<String>,
    duration: Option<DurationFact>,
}

#[derive(Clone, Copy)]
enum DurationFact {
    Confirmation,
    Resolution,
}

fn duration_subject(question: &str) -> Option<(&str, DurationFact)> {
    let resolution = [
        "应该多久处理完",
        "需要多久处理完",
        "多久能处理完",
        "多久处理完",
        "多久处置完",
    ]
    .iter()
    .find_map(|ending| question.strip_suffix(ending))
    .map(|subject| (subject, DurationFact::Resolution));
    resolution.or_else(|| {
        [
            "确认收到的时限是多少",
            "确认收到的期限是多少",
            "多久必须确认收到",
        ]
        .iter()
        .find_map(|ending| question.strip_suffix(ending))
        .map(|subject| (subject, DurationFact::Confirmation))
    })
}

fn normalized_day_question(q: &str) -> Option<String> {
    let day = crate::assistant::grounding::weekday(q)?;
    q.starts_with(day)
        .then(|| q.replacen(&format!("{day}，"), day, 1))
}

pub(crate) fn has_bound_intro(question: &str, sentence: &str) -> bool {
    if let Some((intro, _)) = question.split_once(['，', ',']) {
        let subject = intro
            .strip_suffix('里')
            .or_else(|| intro.strip_suffix('中'));
        if let Some((context, assertion)) = sentence.split_once(['，', ',']) {
            if subject.is_some_and(|s| s.chars().count() >= 2 && context.contains(s))
                && context.trim_end().ends_with(['里', '中'])
                && !assertion.contains(['，', ','])
            {
                return true;
            }
        }
    }
    let q = question.trim_end_matches(['？', '?']);
    let normal = normalized_day_question(q);
    per_unit::Request::parse(normal.as_deref().unwrap_or(q)).is_some()
}

// Compact notebook entries sometimes omit 是 or 为 between a named field
// and its measurement. Accept only the complete subject and field followed
// immediately by one finite value, with the requested unit when supplied.
fn measured_field(question: &str, clause: &str) -> bool {
    let Some((left, unit)) = question.rsplit_once("是多少") else {
        return false;
    };
    let Some((owner, field)) = left.rsplit_once('的') else {
        return false;
    };
    if [owner, field]
        .iter()
        .any(|s| s.chars().count() < 2 || !s.chars().all(char::is_alphanumeric))
    {
        return false;
    }
    let Some(rest) = clause.trim().strip_prefix(owner) else {
        return false;
    };
    let rest = ["只登记", "已登记", "记录的", "登记的", "记录", "登记", "的"]
        .iter()
        .find_map(|p| rest.strip_prefix(p))
        .unwrap_or(rest);
    let Some(value) = rest.strip_prefix(field) else {
        return false;
    };
    let value = value.trim_start_matches([' ', '为', '是', '：', ':', '=']);
    let digits = value
        .find(|c: char| !c.is_ascii_digit() && c != '.' && c != '-')
        .unwrap_or(value.len());
    if !value[..digits].parse::<f64>().is_ok_and(f64::is_finite) {
        return false;
    }
    let stated = value[digits..].trim();
    if !unit.is_empty() {
        return stated == unit;
    }
    // The whole remainder must be a unit, never a qualifier such as “旧值”.
    stated.is_empty()
        || [
            "K", "°C", "℃", "m", "cm", "mm", "kg", "g", "Hz", "kHz", "MHz", "V", "A", "W", "kW",
            "%", "元", "米", "千克", "公斤", "分钟", "小时", "次", "个", "份", "台", "件",
        ]
        .contains(&stated)
}

/// Reuse the typed evidence gates on a single current source assertion. This
/// intentionally omits the broad passage-level keyword threshold.
pub(crate) fn supports_typed_assertion(
    question: &str,
    hit: &SearchResult,
    assertion: &str,
) -> bool {
    let mut q = question.trim().trim_end_matches(['？', '?', '。']);
    let text = assertion
        .trim_end_matches(['。', '；', ';', '！', '!'])
        .trim();
    if text.is_empty() || text.contains(['?', '？']) {
        return false;
    }
    if let Some((intro, rest)) = q.split_once(['，', ',']) {
        if let Some(subject) = intro
            .strip_suffix('里')
            .or_else(|| intro.strip_suffix('中'))
        {
            if ![assertion, &hit.heading, hit.title.as_deref().unwrap_or("")]
                .iter()
                .any(|part| part.contains(subject))
            {
                return false;
            }
            q = rest.trim();
        }
    }
    if !provisional(text) && !text.contains(['，', ',']) && measured_field(q, text) {
        return true;
    }
    let normal = normalized_day_question(q);
    let q = normal.as_deref().unwrap_or(q);
    if let Some((subject, duration)) = duration_subject(q) {
        let words = terms(subject);
        return !words.is_empty() && supports_duration(duration, &words, text);
    }
    if let Some(request) = availability::Availability::parse(q) {
        return !provisional(text) && request.supports(text);
    }
    if let Some(request) = per_unit::Request::parse(q) {
        return !provisional(text) && request.supports(hit.title.as_deref().unwrap_or(""), text);
    }
    if let Some(request) = dated_clock::Request::parse(q) {
        return request.supports(hit.title.as_deref().unwrap_or(""), &hit.heading, text);
    }
    predicate::Request::parse(q)
        .is_some_and(|r| r.supports(hit.title.as_deref(), &hit.heading, text))
}

fn subquestion_terms(query: &str) -> (Vec<String>, Vec<Subquestion<'_>>) {
    // An introductory qualifier applies to every following question. Only
    // peel a simple qualifier with no embedded scope instruction.
    let (qualifier, questions) = query
        .split_once(['，', ','])
        .filter(|(prefix, _)| {
            prefix.ends_with(['里', '中'])
                && prefix.chars().count() <= 32
                && prefix.chars().all(char::is_alphanumeric)
                && !["只", "仅", "不", "排除"]
                    .iter()
                    .any(|s| prefix.contains(s))
        })
        .map(|(prefix, questions)| (terms(prefix.trim_end_matches(['里', '中'])), questions))
        .unwrap_or_default();
    let questions = if qualifier.is_empty() {
        query
    } else {
        questions
    };
    let clauses = questions
        .split(['？', '?', '；', ';'])
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    if !(2..=4).contains(&clauses.len()) {
        return (vec![], vec![]);
    }
    let parts = clauses
        .into_iter()
        .map(|question| {
            // Refuse to split statements or a clause with a trailing side
            // constraint. Each accepted clause is a standalone question.
            let duration = duration_subject(question);
            let clause = duration
                .map(|(subject, _)| subject)
                .or_else(|| {
                    [
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
                    .find_map(|ending| question.strip_suffix(ending))
                })?
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
            ((duration.is_some() && !words.is_empty()) || words.len() >= 2).then_some(Subquestion {
                question,
                words,
                duration: duration.map(|(_, kind)| kind),
            })
        })
        .collect::<Option<Vec<_>>>()
        .unwrap_or_default();
    (qualifier, parts)
}

// A value question needs a factual body clause, even when the title contains
// every query term. Unannounced or explicitly inapplicable values cannot fill it.
fn requested_value(query: &str, body: &str) -> bool {
    let query = query.trim().trim_end_matches(['？', '?', '。', '.']);
    if (query.contains("多少") || query.contains("多少钱")) && query.contains("押金") {
        return body
            .lines()
            .filter(|s| !s.trim_start().starts_with('#'))
            .flat_map(|s| s.split(['。', '；', ';']))
            .any(|s| {
                s.contains("押金")
                    && ((s.contains('元') && s.chars().any(|c| c.is_ascii_digit()))
                        || ["免收", "无需", "未公布", "未确定", "不收"]
                            .iter()
                            .any(|word| s.contains(word)))
            });
    }
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
        "是多少元",
        "多少元",
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
        .trim_end_matches([' ', '为', '是'])
        .trim_end_matches("具体");
    if prefix.ends_with("票价") {
        return body
            .lines()
            .filter(|line| !line.trim_start().starts_with('#'))
            .flat_map(|line| line.split(['，', '。', '；', ';']))
            .any(|clause| {
                clause.contains("票价")
                    && (["未公布", "未确定", "另行通知"]
                        .iter()
                        .any(|s| clause.contains(s))
                        || (["元", "美元", "欧元"].iter().any(|s| clause.contains(s))
                            && clause.bytes().any(|c| c.is_ascii_digit())))
            });
    }
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

pub(crate) fn date_number(text: &str) -> Option<u8> {
    let digit = |s: &str| {
        let c = s.chars().next()?;
        (s.chars().count() == 1)
            .then(|| {
                "一二三四五六七八九"
                    .chars()
                    .position(|d| d == c)
                    .map(|i| i as u8 + 1)
            })
            .flatten()
    };
    if let Ok(number) = text.parse::<u8>() {
        return Some(number);
    }
    if let Some((tens, ones)) = text.split_once('十') {
        return Some(
            if tens.is_empty() { 1 } else { digit(tens)? } * 10
                + if ones.is_empty() { 0 } else { digit(ones)? },
        );
    }
    digit(text)
}

pub(crate) fn month_days(text: &str) -> impl Iterator<Item = (u8, u8)> + '_ {
    const DIGITS: &str = "一二三四五六七八九";
    let numeral = |c: char| c.is_ascii_digit() || c == '十' || DIGITS.contains(c);
    text.match_indices('月').filter_map(move |(at, label)| {
        let prefix = text[..at].trim_end();
        let month = date_number(prefix.rsplit(|c| !numeral(c)).next()?)?;
        let rest = text[at + label.len()..].trim_start();
        let day_end = rest.find(|c| !numeral(c))?;
        if !rest[day_end..].trim_start().starts_with(['日', '号']) {
            return None;
        }
        let day = date_number(&rest[..day_end])?;
        ((1..=12).contains(&month) && (1..=31).contains(&day)).then_some((month, day))
    })
}

pub(crate) fn single_month_day(text: &str) -> Option<(u8, u8)> {
    let mut days = month_days(text);
    let first = days.next()?;
    days.all(|day| day == first).then_some(first)
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

fn supports_duration(fact: DurationFact, words: &[String], body: &str) -> bool {
    body.split(['\n', '。', '；', ';', '，', ',', '！', '？'])
        .any(|clause| {
            let predicates: &[&str] = match fact {
                DurationFact::Confirmation => &["确认", "签收"],
                DurationFact::Resolution => &["处置", "处理", "解决", "修复"],
            };
            if !predicates.iter().any(|part| clause.contains(part)) {
                return false;
            }
            let tokens = db::tokenize(clause);
            let seen = tokens.split_whitespace().collect::<HashSet<_>>();
            let timed = ["时长", "时限", "时间", "分钟", "小时", "工作日", "天"]
                .iter()
                .any(|unit| clause.contains(unit));
            let explicit = ["尚未公布", "未公布", "尚未确定", "未明确", "另行通知"]
                .iter()
                .any(|state| clause.contains(state));
            // The confirmation interval is about a different action. It cannot
            // supply a resolution deadline even if it contains the same unit.
            timed
                && (explicit || clause.chars().any(|ch| ch.is_ascii_digit()))
                && words.iter().all(|word| seen.contains(word.as_str()))
        })
}

fn tokens(text: &str) -> HashSet<String> {
    db::tokenize(text)
        .split_whitespace()
        .map(str::to_owned)
        .collect()
}

impl Subquestion<'_> {
    fn supports(&self, text: &str, body: &HashSet<String>) -> bool {
        match self.duration {
            Some(duration) => supports_duration(duration, &self.words, text),
            None => {
                supports_clause(&self.words, body)
                    && requested_value(self.question, text)
                    && single_month_day(self.question)
                        .is_none_or(|day| month_days(text).any(|seen| seen == day))
            }
        }
    }
}

/// Keep a supported excerpt for each facet ahead of extra matches on the
/// same facet. The caller already sorted the chunks by retrieval relevance.
pub(crate) fn prioritize_selected_excerpts(query: &str, title: &str, chunks: &mut [ChunkInput]) {
    let (qualifier, parts) = subquestion_terms(query);
    if parts.is_empty() {
        return;
    }
    let mut first_per_facet = vec![false; parts.len()];
    let mut chosen = HashSet::new();
    for chunk in chunks.iter() {
        if first_per_facet.iter().all(|covered| *covered) {
            break;
        }
        if !qualifier.is_empty()
            && !supports_clause(
                &qualifier,
                &tokens(&format!("{title} {} {}", chunk.heading, chunk.text)),
            )
        {
            continue;
        }
        let body = tokens(&chunk.text);
        for (part, first) in parts.iter().zip(&mut first_per_facet) {
            if !*first && part.supports(&chunk.text, &body) {
                chosen.insert((chunk.start_line, chunk.end_line));
                *first = true;
            }
        }
    }
    chunks.sort_by_key(|chunk| !chosen.contains(&(chunk.start_line, chunk.end_line)));
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
    let (qualifier, subquestions) = if names.is_empty() && attributed.is_none() {
        subquestion_terms(&query)
    } else {
        (vec![], vec![])
    };
    let predicate = (names.is_empty() && attributed.is_none() && subquestions.is_empty())
        .then(|| predicate::Request::parse(&query))
        .flatten();
    let facets = (names.is_empty()
        && attributed.is_none()
        && subquestions.is_empty()
        && predicate.is_none())
    .then(|| facets::Request::parse(&query, results));
    let clock = dated_clock::Request::parse(&query);
    let typed = facets
        .as_ref()
        .is_some_and(facets::Request::has_typed_clause);
    let mut requested_years = years(&query);
    let year = requested_years
        .next()
        .filter(|first| subquestions.is_empty() && requested_years.all(|other| other == *first));
    let day = subquestions
        .is_empty()
        .then(|| single_month_day(&query))
        .flatten();
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
        let tokens = tokens(&text);
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
            let body = self::tokens(&r.text);
            if let Some(comp) = &attributed {
                comp.subject.is_none_or(|subject| source_name(r, subject))
                    && comp
                        .labels
                        .iter()
                        .filter(|label| source_name(r, label))
                        .count()
                        == 1
                    && supports_clause(&comp.fact, &body)
            } else {
                (qualifier.is_empty() || supports_clause(&qualifier, &tokens))
                    && subquestions
                        .iter()
                        .any(|part| part.supports(&r.text, &body))
            }
        } else {
            ordinary && requested_value(&query, &r.text)
        };
        let facet_support = (!wiki || original_alias_anchor)
            && facets.as_ref().is_some_and(|request| request.supports(r));
        let admitted = if let Some(request) = &clock {
            request.supports(r.title.as_deref().unwrap_or(""), &r.heading, &r.text)
        } else if typed {
            // A matching question, title or topic cannot substitute for a
            // statement of this predicate, including for an anchored Wiki hit.
            facet_support
        } else {
            supported
                || facet_support
                || original_alias_anchor
                || (!wiki
                    && predicate.as_ref().is_some_and(|request| {
                        request.supports(r.title.as_deref(), &r.heading, &r.text)
                    }))
        };
        r.evidence = (r.bm25_rank.is_some() || wiki)
            && has_body
            && year.is_none_or(|year| years(&text).any(|seen| seen == year))
            && day.is_none_or(|day| month_days(&text).any(|seen| seen == day))
            && admitted;
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
        assert!(
            subquestion_terms("只根据交接通知的预约时长是多少？服务凭据交给谁？")
                .1
                .is_empty()
        );
        assert!(subquestion_terms("2026年预约时长是多少？前者交给谁？")
            .1
            .is_empty());
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

    #[test]
    fn distinct_duration_facets_keep_original_unknown_separate_from_confirmation() {
        let q = "北岭无人机巡检中，普通故障确认收到的时限是多少？故障应该多久处理完？";
        let mut hits = [
            hit("北岭无人机巡检", "普通故障应在45分钟内确认。"),
            hit("北岭无人机巡检", "故障处置时长尚未确定。"),
            hit("南浦潜艇维护", "故障处置时长为60分钟。"),
            hit(
                "北岭无人机巡检",
                "确认故障后提交处置建议，会议时间为15分钟。",
            ),
        ];
        mark(q, &mut hits);
        assert_eq!(hits.map(|hit| hit.evidence), [true, true, false, false]);
    }

    #[test]
    fn source_first_comparison_keeps_the_subject_and_both_attributions() {
        let q = "北岭展馆的预约说明和交接记录对周日每场预约时长说法一样吗？分别怎么说？";
        let mut hits = [
            hit("北岭展馆预约说明", "周日每场预约上限为80分钟。"),
            hit("北岭展馆交接记录", "周日每场预约上限为75分钟。"),
            hit("南浦展馆交接记录", "周日每场预约上限为60分钟。"),
        ];
        mark(q, &mut hits);
        assert_eq!(hits.map(|hit| hit.evidence), [true, true, false]);
    }

    #[test]
    fn alternative_source_labels_need_distinct_documents_and_a_matching_fact() {
        let mut hits = [
            hit("楼宇联合巡检排班表", "周五注销窗口于17:30关闭。"),
            hit("前厅维修公告", "周五注销窗口于15:00关闭。"),
            hit("前厅访客手册", "周五注销窗口于22:30关闭。"),
        ];
        let q = "周五注销窗口关闭时间，巡检排班表和维修公告有出入吗？";
        let request = facets::Request::parse(q, &hits);
        assert!(request.supports(&hits[0]) && request.supports(&hits[1]));
        assert!(!request.supports(&hits[2]));
        hits[2].title = hits[0].title.clone();
        let ambiguous = facets::Request::parse(q, &hits);
        assert!(hits.iter().all(|hit| !ambiguous.supports(hit)));
    }
    #[test]
    fn subquestion_clock_requires_time_and_preserves_the_day() {
        let hits = [
            hit("培训简章", "周三签收回执，办理时限为48小时。"),
            hit("培训通知", "周四签收回执截止时间为17:00。"),
            hit("培训指南", "周三签收回执截止时间为19:20。"),
        ];
        let request = facets::Request::parse("周三签收回执几点截止？设备去哪里领取？", &hits);
        assert!(request.supports(&hits[2]));
        assert!(!request.supports(&hits[0]) && !request.supports(&hits[1]));
        let conditional = facets::Request::parse("如果有登记，周三签收回执几点截止？", &hits);
        assert!(!conditional.supports(&hits[2]));
    }
    #[test]
    fn conditional_opening_requires_the_same_condition_and_a_declared_status() {
        let q = "下雪还开吗？周六航班何时起飞？";
        let request = facets::Request::parse(q, &[]);
        assert!(lexical_aliases(q).contains(&"雪天".to_string()));
        assert!(request.supports(&hit("游客中心", "雪天仍然营业。")));
        assert!(request.supports(&hit("游客中心", "下雪时暂停开放。")));
        assert!(!request.supports(&hit("游客中心", "暴雪天仍然营业。")));
        assert!(!request.supports(&hit("游客中心", "雪天停车位仍然开放。")));
        assert!(!request.supports(&hit("游客中心", "雪天营业时间另行通知。")));
        assert!(!request.supports(&hit("游客中心", "周六航班起飞前确认通道仍开放。")));
    }

    #[test]
    fn compared_session_durations_bind_the_subject_weekday_and_unit() {
        let q = "周二常规演奏和新讲座每场多久？";
        let request = facets::Request::parse(q, &[]);
        assert!(request.supports(&hit("常规演奏排班", "周二每场最长为90分钟。")));
        assert!(request.supports(&hit("场馆简讯", "新增周二讲座，每场安排45分钟。")));
        assert!(!request.supports(&hit("常规演奏排班", "周一每场最长为90分钟。")));
        assert!(!request.supports(&hit("常规演奏排班", "周二每场可预约，提前90分钟入场。")));
        assert!(!request.supports(&hit("常规演奏排班", "周二每轮最长为90分钟。")));
        assert!(!request.supports(&hit("参观排班", "周二每场最长为90分钟。")));
        assert!(!request.supports(&hit("讲座", "周二原有讲座每场最长为90分钟。")));
    }

    #[test]
    fn typed_requests_reject_questions_and_qualified_drafts_through_mark() {
        for query in [
            "下雪还开吗？",
            "下雪还开吗",
            "下雪还开吗？周六航班何时起飞？",
        ] {
            let mut hits = [
                hit("下雪还开吗", "下雪还开吗？"),
                hit("下雪还开吗", "雪天照常营业？"),
                hit("下雪还开吗", "雪天照常营业，仅为草案，尚未确认。"),
                hit("下雪还开吗", "雪天照常营业。"),
            ];
            mark(query, &mut hits);
            assert_eq!(
                hits.map(|h| h.evidence),
                [false, false, false, true],
                "{query}"
            );
        }
        let q = "周二常规演奏和新讲座每场多久";
        let mut hits = [
            hit(q, q),
            hit(q, "周二每场最长为90分钟？"),
            hit(q, "周二每轮最长为90分钟。"),
            hit(q, "周二观影每场最长为90分钟。"),
            hit("常规演奏", "周二每场45分钟，仅作提案，尚未生效。"),
            hit("常规演奏和新讲座排班", "周二每场为90分钟。"),
            hit("常规演奏和新讲座排班", "周二常规演奏每场为90分钟。"),
            hit("常规演奏排班", "周二每场最长为90分钟。"),
        ];
        mark(q, &mut hits);
        assert_eq!(
            hits.map(|h| h.evidence),
            [false, false, false, false, false, false, true, true]
        );
    }

    #[test]
    fn dated_clock_excludes_superseded_month_and_binds_time_to_action() {
        let mut hits = [
            hit("九月通知", "9月6日东区车库于18:45关闭。"),
            hit("8月记录", "9月6日东区车库于17:45关闭。"),
            hit("九月通知", "9月7日东区车库于16:45关闭。"),
            hit("九月通知", "9月6日东区车库于16:45开放。"),
            hit("九月通知", "9月6日东区车库关闭，接驳车于16:45出发。"),
        ];
        mark("九月六号东区车库几点关，不要八月记录。", &mut hits);
        assert_eq!(hits.map(|h| h.evidence), [true, false, false, false, false]);
        assert!(dated_clock::Request::parse("只看南站九月六号东区车库几点关？").is_none());
    }

    #[test]
    fn deposit_needs_a_matching_value_in_a_factual_sentence() {
        let mut hits = [
            hit("器材预约押金", "每天可预约3次。"),
            hit("器材预约押金", "器材预约押金为30元。"),
        ];
        mark("预约器材要交多少押金？", &mut hits);
        assert!(!hits[0].evidence && hits[1].evidence);
    }
    #[test]
    fn calendar_guard_treats_mixed_and_chinese_dates_as_the_same_day() {
        assert_eq!(
            single_month_day("7月13日、七月13日、七月十三号"),
            Some((7, 13))
        );
        assert_eq!(single_month_day("十二月三十一日"), Some((12, 31)));
        assert_eq!(single_month_day("六月12日和五月十二日"), None);
        assert_eq!(single_month_day("十三月12日、六月三十二日"), None);
    }
}
