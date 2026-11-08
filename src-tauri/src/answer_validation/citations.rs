//! Check narrow, explicit statements against the exact excerpts sent to the model.
use super::number_spans;
use crate::models::SearchResult;
use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
use serde::Serialize;
use std::collections::HashSet;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CitationCheck {
    pub excerpt: String,
    pub citations: Vec<usize>,
    pub status: Status,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Status {
    Conflict,
    Unverified,
}

#[derive(Default)]
struct Clause {
    text: String,
    citations: Vec<usize>,
}

fn prose(markdown: &str) -> String {
    let mut text = String::new();
    let mut hidden = 0_usize;
    for event in Parser::new_ext(markdown, Options::ENABLE_TABLES) {
        match event {
            Event::Start(
                Tag::CodeBlock(_) | Tag::Image { .. } | Tag::Link { .. } | Tag::Heading { .. },
            ) => {
                hidden += 1;
                text.push(' ');
            }
            Event::End(TagEnd::CodeBlock | TagEnd::Image | TagEnd::Link | TagEnd::Heading(_)) => {
                hidden = hidden.saturating_sub(1);
                text.push(' ');
            }
            Event::Text(raw) if hidden == 0 => text.push_str(&raw),
            Event::Code(_) if hidden == 0 => text.push(' '),
            Event::SoftBreak
            | Event::HardBreak
            | Event::End(TagEnd::Paragraph | TagEnd::Item | TagEnd::TableCell)
                if hidden == 0 =>
            {
                text.push('\n');
            }
            _ => {}
        }
    }
    text
}

fn take_citation(tail: &str) -> Option<(usize, usize)> {
    let body = tail.strip_prefix('[')?;
    let end = body.bytes().take(6).position(|c| c == b']')?;
    let raw = &body[..end];
    if raw.is_empty() || raw.len() > 5 || !raw.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some((
        if raw.starts_with('0') {
            0
        } else {
            raw.parse().ok()?
        },
        end + 2,
    ))
}

fn clauses(text: &str) -> Vec<Clause> {
    let mut result = Vec::new();
    for line in text.lines() {
        let mut current = Clause::default();
        let mut boundary = false;
        let mut chars = line.char_indices().peekable();
        while let Some((at, c)) = chars.next() {
            if c == '[' {
                if let Some((citation, len)) = take_citation(&line[at..]) {
                    if !current.citations.contains(&citation) {
                        current.citations.push(citation);
                    }
                    while chars.next_if(|(offset, _)| *offset < at + len).is_some() {}
                    boundary = true;
                    continue;
                }
            }
            if matches!(c, '。' | '！' | '？' | '；' | '!' | '?' | ';')
                || c == '.' && chars.peek().is_none_or(|(_, next)| !next.is_ascii_digit())
            {
                boundary = true;
                continue;
            }
            if boundary && !c.is_whitespace() && !matches!(c, '，' | ',' | '、') {
                result.push(std::mem::take(&mut current));
                boundary = false;
            }
            current.text.push(c);
        }
        result.push(current);
    }
    result
}

#[derive(PartialEq, Eq)]
struct Value {
    // Use the explicit unit instead of inferring conversion or currency.
    unit: &'static str,
    number: String,
}

fn take_digits(raw: &str) -> Option<(u32, &str)> {
    let end = raw.bytes().take_while(u8::is_ascii_digit).count();
    if !(1..=4).contains(&end) {
        return None;
    }
    Some((raw[..end].parse().ok()?, &raw[end..]))
}

fn date(year: &str, rest: &str) -> Option<(String, usize)> {
    if year.len() != 4 || !year.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let (month, day, tail) = if let Some(tail) = rest.trim_start().strip_prefix('年') {
        let (month, tail) = take_digits(tail.trim_start())?;
        let (day, tail) = take_digits(tail.trim_start().strip_prefix('月')?.trim_start())?;
        (month, day, tail.trim_start().strip_prefix(['日', '号'])?)
    } else {
        let sep = rest.chars().next()?;
        if !matches!(sep, '-' | '/') {
            return None;
        }
        let (month, tail) = take_digits(rest.strip_prefix(sep)?)?;
        let (day, tail) = take_digits(tail.strip_prefix(sep)?)?;
        if tail.starts_with(|c: char| c.is_ascii_alphanumeric() || matches!(c, '/' | '-')) {
            return None;
        }
        (month, day, tail)
    };
    ((1..=12).contains(&month) && (1..=31).contains(&day)).then(|| {
        (
            format!("{year}-{month:02}-{day:02}"),
            rest.len() - tail.len(),
        )
    })
}

fn unit(suffix: &str) -> Option<&'static str> {
    let groups: &[(&str, &[&str])] = &[
        ("ms", &["毫秒", "milliseconds", "millisecond", "ms"]),
        ("second", &["秒钟", "秒", "seconds", "second", "sec"]),
        ("minute", &["分钟", "minutes", "minute", "min"]),
        ("hour", &["小时", "hours", "hour", "hrs", "hr"]),
        ("day", &["天", "days", "day"]),
        ("week", &["星期", "周", "weeks", "week"]),
        ("month", &["个月", "months", "month"]),
        ("year", &["年", "years", "year"]),
        ("celsius", &["摄氏度", "℃", "°c"]),
        ("fahrenheit", &["华氏度", "℉", "°f"]),
        ("degree", &["度"]),
        ("percent", &["%", "％", "percent"]),
        ("cny-100m", &["亿元"]),
        ("cny-10k", &["万元"]),
        ("cny", &["人民币", "元", "cny", "rmb"]),
        ("usd", &["美元", "usd"]),
        ("km", &["公里", "千米", "km"]),
        ("cm", &["厘米", "cm"]),
        ("mm", &["毫米", "mm"]),
        ("m", &["米", "meters", "meter"]),
        ("kg", &["千克", "公斤", "kg"]),
        ("g", &["克", "grams", "gram"]),
    ];
    let suffix = suffix.trim_start();
    groups.iter().find_map(|(name, spellings)| {
        spellings
            .iter()
            .any(|spelling| {
                suffix
                    .split_at_checked(spelling.len())
                    .is_some_and(|(head, tail)| {
                        head.eq_ignore_ascii_case(spelling)
                            && (!spelling.ends_with(|c: char| c.is_ascii_alphabetic())
                                || !tail.starts_with(|c: char| c.is_ascii_alphabetic()))
                    })
            })
            .then_some(*name)
    })
}

fn quantity_prefix(text: &str) -> &str {
    text.rsplit(['，', ',', '、', '|', '；', ';'])
        .next()
        .unwrap_or_default()
        .trim()
}

const MODIFIERS: &[&str] = &[
    "不适用",
    "不超过",
    "不得超过",
    "至少",
    "至多",
    "最多",
    "最少",
    "大约",
    "约为",
    "超过",
    "不足",
    "不少于",
    "不低于",
    "不高于",
    "并非",
    "不是",
    "不要",
    "不得",
    "不能",
    "禁止",
    "within",
    "at least",
    "at most",
    "about",
    "no more than",
];

fn quantity_atoms(text: &str, wiki: bool) -> Vec<(&str, Value, &str)> {
    let mut atoms = Vec::new();
    let mut covered_to = 0;
    for (span, number) in number_spans(text, true) {
        if span.start < covered_to {
            continue;
        }
        let rest = &text[span.end..];
        let prefix = quantity_prefix(&text[..span.start]);
        if prefix.is_empty() && !wiki {
            continue;
        }
        if let Some((number, length)) = date(&text[span.clone()], rest) {
            covered_to = span.end + length;
            atoms.push((
                prefix,
                Value {
                    unit: "date",
                    number,
                },
                &text[span.start..covered_to],
            ));
        } else if let Some(unit) = unit(rest) {
            atoms.push((prefix, Value { unit, number }, &text[span]));
        } else if wiki {
            // Wiki summaries are short plain text. Check bare values and explicit
            // counters there too, while retaining the chat checker’s existing scope.
            let suffix = rest.trim_start().chars().next();
            let counter = suffix.and_then(|c| {
                [
                    "个", "人", "份", "条", "次", "页", "件", "支", "瓶", "盒", "套",
                ]
                .into_iter()
                .find(|counter| counter.starts_with(c))
            });
            atoms.push((
                prefix,
                Value {
                    unit: counter.unwrap_or_else(|| {
                        if suffix.is_none_or(|c| !c.is_alphanumeric()) {
                            "bare"
                        } else {
                            "unknown"
                        }
                    }),
                    number,
                },
                &text[span],
            ));
        }
    }
    atoms
}

fn normalize(text: &str) -> String {
    text.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn aligned_quantity(answer: &str, source: &str) -> bool {
    let answer = normalize(answer);
    let source = normalize(source);
    let strip = |text: String| {
        for ending in [
            "设定为",
            "规定为",
            "长达",
            "为",
            "是",
            "有",
            "is",
            "are",
            "at",
        ] {
            if let Some(prefix) = text.strip_suffix(ending) {
                return prefix.to_string();
            }
        }
        text
    };
    let answer = strip(answer);
    let source = strip(source);
    answer == source && answer.chars().count() >= 2
}

fn words(text: &str) -> Option<(String, String, bool)> {
    // Compare explicit permission/prohibition for the same literal action.
    // Leave vague claims or different wording for manual review.
    let text = text.to_ascii_lowercase();
    for (markers, negative) in [
        (
            &[
                "不允许",
                "不可以",
                "不得",
                "禁止",
                "不可",
                "不能",
                "不适用",
                " may not ",
                " must not ",
                " is not allowed to ",
                " are not allowed to ",
            ][..],
            true,
        ),
        (
            &[
                "允许",
                "可以",
                "适用",
                " may ",
                " is allowed to ",
                " are allowed to ",
            ][..],
            false,
        ),
    ] {
        if let Some((before, after)) = markers.iter().find_map(|marker| text.split_once(marker)) {
            let subject = normalize(before);
            let action = normalize(after);
            if action.chars().count() >= 2 {
                return Some((subject, action, negative));
            }
        }
    }
    None
}

fn quantity_status(prefix: &str, claim: &Value, evidence: &[&str], wiki: bool) -> Option<Status> {
    if claim.unit == "unknown" {
        return Some(Status::Unverified);
    }
    let mut same = false;
    let mut different = false;
    let modified = |s: &str| {
        let normalized = s.to_ascii_lowercase();
        MODIFIERS.iter().any(|m| normalized.contains(m))
    };
    for text in evidence {
        for (source_prefix, value, _) in quantity_atoms(text, wiki) {
            if !aligned_quantity(prefix, source_prefix) {
                continue;
            }
            let comparable =
                claim.unit == value.unit && !modified(prefix) && !modified(source_prefix);
            same |=
                claim == &value && (comparable || normalize(prefix) == normalize(source_prefix));
            different |= comparable && claim != &value;
        }
    }
    match (same, different) {
        (true, false) => None,
        (false, true) => Some(Status::Conflict),
        _ => Some(Status::Unverified),
    }
}

fn polarity_status(claim: &(String, String, bool), evidence: &[&str]) -> Option<Status> {
    let mut same = false;
    let mut different = false;
    for statement in evidence
        .iter()
        .flat_map(|text| text.split(['，', ',', '、']))
    {
        let Some(source) = words(statement) else {
            continue;
        };
        if source.0 == claim.0 && source.1 == claim.1 {
            same |= source.2 == claim.2;
            different |= source.2 != claim.2;
        }
    }
    match (same, different) {
        (true, false) => None,
        (false, true) => Some(Status::Conflict),
        _ => Some(Status::Unverified),
    }
}

pub(crate) fn audit_citations(
    answer: &str,
    finish: &str,
    sources: &[SearchResult],
) -> Vec<CitationCheck> {
    if finish != "stop" || sources.is_empty() {
        return Vec::new();
    }
    let source_clauses = sources
        .iter()
        .map(|source| clauses(&prose(&source.text)))
        .collect::<Vec<_>>();
    clauses(&prose(answer))
        .into_iter()
        .filter_map(|clause| {
            let quantities = quantity_atoms(&clause.text, false);
            let polarity = words(&clause.text);
            let citations = clause
                .citations
                .iter()
                .copied()
                .filter(|number| (1..=sources.len()).contains(number))
                .collect::<Vec<_>>();
            let evidence = citations
                .iter()
                .filter_map(|number| source_clauses.get(number - 1))
                .flat_map(|source| source.iter().map(|clause| clause.text.as_str()))
                .collect::<Vec<_>>();
            let status = if evidence.is_empty() || citations.len() < clause.citations.len() {
                (!quantities.is_empty() || polarity.is_some() || !clause.citations.is_empty())
                    .then_some(Status::Unverified)
            } else {
                quantities
                    .iter()
                    .filter_map(|(prefix, value, _)| {
                        quantity_status(prefix, value, &evidence, false)
                    })
                    .chain(
                        polarity
                            .as_ref()
                            .and_then(|claim| polarity_status(claim, &evidence)),
                    )
                    .max_by_key(|status| *status == Status::Conflict)
            }?;
            let excerpt = clause.text.trim().chars().take(180).collect::<String>();
            if excerpt.is_empty() {
                return None;
            }
            Some(CitationCheck {
                excerpt,
                citations,
                status,
            })
        })
        .take(16)
        .collect()
}

#[derive(Serialize)]
pub(crate) struct SummaryIssue {
    claim: String,
    reason: &'static str,
}

fn wiki_punctuation(text: &str) -> String {
    text.chars()
        .map(|c| match c {
            '０'..='９' => char::from_u32(c as u32 - '０' as u32 + '0' as u32).unwrap_or(c),
            '－' => '-',
            '．' => '.',
            _ => c,
        })
        .collect()
}

fn wiki_statements(text: &str) -> impl Iterator<Item = &str> {
    // A quoted fragment is usable only for the same literal subject and predicate.
    // Split enumerated clauses so the prior assertion cannot provide that subject.
    text.split(['，', ',', '、']).map(str::trim)
}

const WIKI_NEGATIONS: &[&str] = &[
    "不提供",
    "不支持",
    "不包含",
    "不含",
    "没有",
    "尚未",
    "未公布",
    "未开放",
    "无需",
    "无须",
    " do not ",
    " does not ",
    " did not ",
    " cannot ",
    " no longer ",
];

pub(crate) fn audit_wiki_summary<'a>(
    summary: &str,
    quotes: impl IntoIterator<Item = &'a str>,
) -> Vec<SummaryIssue> {
    if summary.is_empty() {
        return Vec::new();
    }
    let source_clauses = quotes
        .into_iter()
        .flat_map(|quote| clauses(&wiki_punctuation(quote)))
        .collect::<Vec<_>>();
    let evidence = source_clauses
        .iter()
        .flat_map(|clause| wiki_statements(&clause.text))
        .collect::<Vec<_>>();
    let exact = evidence.iter().copied().collect::<HashSet<_>>();
    let mut seen = HashSet::new();
    let mut issues = Vec::new();
    for clause in clauses(&wiki_punctuation(summary)) {
        for statement in wiki_statements(&clause.text) {
            let exactly_quoted = exact.contains(statement);
            let excerpt = statement.chars().take(150).collect::<String>();
            let quantities = quantity_atoms(statement, true);
            let polarity = words(statement);
            let extra_negation = WIKI_NEGATIONS
                .iter()
                .any(|marker| statement.to_ascii_lowercase().contains(marker));
            let mut add_issue = |claim: String, status| {
                if seen.insert(claim.clone()) {
                    issues.push(SummaryIssue {
                        claim,
                        reason: if status == Status::Conflict {
                            "conflict"
                        } else {
                            "missing"
                        },
                    });
                }
            };
            let multiple_values = quantities.len() > 1;
            for (prefix, value, raw) in quantities {
                if (prefix.is_empty() || value.unit == "unknown") && exactly_quoted {
                    continue;
                }
                if let Some(status) = quantity_status(prefix, &value, &evidence, true) {
                    let claim = if multiple_values {
                        format!("{excerpt}（核对值 {raw}）")
                    } else {
                        excerpt.clone()
                    };
                    add_issue(claim, status);
                }
            }
            if let Some(status) = polarity
                .as_ref()
                .and_then(|claim| polarity_status(claim, &evidence))
                .or_else(|| {
                    (extra_negation && polarity.is_none() && !exactly_quoted)
                        .then_some(Status::Unverified)
                })
            {
                add_issue(excerpt, status);
            }
        }
    }
    issues.truncate(16);
    issues
}

#[cfg(test)]
mod tests {
    use super::*;

    fn check(answer: &str, sources: &[&str]) -> Vec<CitationCheck> {
        let sources = sources
            .iter()
            .map(|text| {
                serde_json::from_value(serde_json::json!({
                    "id":1,"path":"rule.md","text":text,"heading":"","startLine":1,"endLine":1,
                    "hash":"h","score":1.0,"evidence":true,"matchKind":"keyword"
                }))
                .unwrap()
            })
            .collect::<Vec<_>>();
        audit_citations(answer, "stop", &sources)
    }

    #[test]
    fn wrong_value_on_a_valid_citation_is_a_conflict() {
        let result = check(
            "周末取件时限为 **72 小时**。[1]",
            &["周末取件时限为24小时。"],
        );
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].status, Status::Conflict);
        assert_eq!(result[0].citations, [1]);
        assert!(check("周末取件时限为24小时[1]。", &["周末取件时限为24小时。"]).is_empty());
    }

    #[test]
    fn values_need_the_same_attribute_and_explicit_unit() {
        for source in [
            "工作日取件时限为24小时。",
            "周末取件时限为3天。",
            "周末取件时限不超过24小时。",
        ] {
            let result = check("周末取件时限为72小时[1]。", &[source]);
            assert_eq!(result[0].status, Status::Unverified, "{source}");
        }
        let result = check(
            "周末取件时限为72小时[1][2]。",
            &["周末取件时限为24小时。", "周末取件时限为72小时。"],
        );
        assert_eq!(result[0].status, Status::Unverified);
    }

    #[test]
    fn calendar_dates_and_literal_polarity_are_compared_separately() {
        let result = check(
            "报名截止日期为2026-05-12。[1] 访客可以带宠物。[2]",
            &["报名截止日期为2026年5月13日。", "访客不允许带宠物。"],
        );
        assert_eq!(result.len(), 2);
        assert!(result.iter().all(|check| check.status == Status::Conflict));
        assert!(check(
            "报名截止日期为2026-05-12。[1]",
            &["报名截止日期为2026年5月12日。"]
        )
        .is_empty());
        let result = check(
            "Guests may bring pets.[1]",
            &["Guests are not allowed to bring pets."],
        );
        assert_eq!(result[0].status, Status::Conflict);
        let result = check(
            "报名截止日期为2026 年 5 月 12 日。[1]",
            &["报名截止日期为2026-05-13。"],
        );
        assert_eq!(result[0].status, Status::Conflict);
    }

    #[test]
    fn code_creative_answers_and_citation_scope_are_separate() {
        let text = "`周末取件时限为72小时[1]`\n\n```json\n[88]\n```\n\n周末取件时限为24小时[2]。";
        let result = check(text, &["周末取件时限为24小时。"]);
        assert_eq!(result.len(), 1);
        assert!(result[0].citations.is_empty());
        assert_eq!(result[0].status, Status::Unverified);
        assert!(check("周末取件时限为72小时。", &[]).is_empty());
        assert_eq!(
            check("周末取件时限为72小时。", &["周末取件时限为72小时。"])[0].status,
            Status::Unverified
        );
    }

    #[test]
    fn wiki_summary_issues_keep_facts_bound_to_the_quoted_subject() {
        let issues = audit_wiki_summary(
            "手册和周末通知分别写有 72 小时和 24 小时。",
            ["普通凭条有效期为72小时。", "仓库冷冻样本有效期为24小时。"],
        );
        assert!(issues.iter().any(|issue| issue.claim.contains("核对值 24")));
        let issues = audit_wiki_summary(
            "周末凭条有效期为72小时。截止日为2026-05-12。访客可以带宠物。",
            ["周末凭条有效期为24小时。截止日为2026年5月13日。访客不可以带宠物。"],
        );
        assert_eq!(issues.len(), 3);
        assert!(issues.iter().all(|issue| issue.reason == "conflict"));
        assert!(audit_wiki_summary(
            "周末凭条有效期为２４小时。截止日为2026-05-13。访客不可以带宠物。",
            ["周末凭条有效期为24小时。截止日为2026年5月13日。访客不可以带宠物。"],
        )
        .is_empty());
        assert!(!audit_wiki_summary("费用不含税。", ["费用说明稍后公布。"]).is_empty());
        assert!(!audit_wiki_summary("时限为24营业日。", ["时限为24工作小时。"]).is_empty());
        assert!(audit_wiki_summary("时限为24营业日。", ["时限为24营业日。"]).is_empty());
    }
}
