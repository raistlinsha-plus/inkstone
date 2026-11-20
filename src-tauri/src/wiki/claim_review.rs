//! Derive source-attributed findings from the actual displayed excerpts. Model output
//! can nominate evidence, but it cannot decide how many distinct files attest to it.
use super::{Content, Original, SummaryIssue};
use serde::Serialize;
use std::collections::{HashMap, HashSet};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ClaimReview {
    claim: String,
    status: &'static str,
    ref_indices: Vec<usize>,
}

fn statements(text: &str) -> impl Iterator<Item = &str> {
    text.split(['。', '；', ';', '\n'])
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

/// Quotes must retain the conditions on either side of a sentence. In particular,
/// the final sentence in an excerpt may withdraw the preceding rule.
fn quoted_unit(quote: &str) -> &str {
    quote.trim().trim_end_matches(['。', ';', '；']).trim_end()
}

fn relation_label(text: &str) -> bool {
    let lower = text.to_lowercase();
    [
        "差异",
        "不同",
        "冲突",
        "一致",
        "相同",
        "相反",
        "取代",
        "改为",
        "改成",
        "改至",
        "调整",
        "变更",
        "迁至",
        "迁往",
        "迁到",
        "更改",
        "代替",
        "改用",
        "取缔",
        "取而代之",
        "改动",
        "异于",
        "新增",
        "删除",
        "替代",
        "均为",
        "均提到",
        "都提到",
        "两者",
        "两份",
        "分别",
        "共同",
        "contradict",
        "both ",
        "differ",
        "replaces ",
    ]
    .iter()
    .any(|cue| lower.contains(cue))
}

pub(super) fn unverified_label(label: &str, content: &Content) -> bool {
    // Ordinary subject headings are allowed. Generated transitions and factual
    // predicates need an exact title or complete excerpt, never a partial match.
    if label == content.title
        && content.summary.is_empty()
        && content.sections.len() == 1
        && content.sections[0].heading == "已核验原文"
    {
        if let Some((prefix, suffix)) = label.rsplit_once(" · ") {
            if suffix.len() == 12
                && suffix.bytes().all(|b| b.is_ascii_hexdigit())
                && content.originals().next().is_some_and(|r| {
                    prefix
                        == format!(
                            "原文摘录 · {}",
                            r.title.chars().take(80).collect::<String>()
                        )
                })
            {
                return false;
            }
        }
    }
    let factual = label.contains(['：', ':', '→'])
        || fact(label).is_some_and(|f| f.comparable.is_some())
        || label.contains("由") && label.contains('至');
    (relation_label(label) || factual)
        && !content
            .originals()
            .any(|r| r.title == label || (!relation_label(label) && quoted_unit(&r.quote) == label))
}

pub(super) fn issues(content: &Content) -> Vec<SummaryIssue> {
    // A source-qualified quotation can coexist with a different value from a
    // second file. Verify the complete statement in precisely the named file.
    let mut unqualified = Vec::new();
    for claim in statements(&content.summary) {
        let named = claim
            .strip_prefix('《')
            .and_then(|s| s.split_once("》记载："));
        if let Some((title, statement)) = named {
            let mut ids = HashSet::new();
            let mut matches = false;
            for source in content.originals().filter(|r| {
                r.title == title
                    || std::path::Path::new(&r.title)
                        .file_stem()
                        .and_then(|s| s.to_str())
                        == Some(title)
            }) {
                ids.insert(&source.document_id);
                matches |= quoted_unit(&source.quote) == statement;
            }
            if ids.len() == 1 && matches {
                continue;
            }
        }
        unqualified.push(claim);
    }
    let mut issues = super::audit_wiki_summary(
        &unqualified.join("。"),
        content.originals().map(|r| r.quote.as_str()),
    );
    let originals: HashSet<_> = content.originals().map(|r| quoted_unit(&r.quote)).collect();
    for claim in unqualified
        .into_iter()
        .filter(|s| !originals.contains(s) || relation_label(s))
        .chain(
            std::iter::once(&content.title)
                .chain(content.sections.iter().map(|s| &s.heading))
                .chain(&content.aliases)
                .chain(&content.related)
                .filter(|label| unverified_label(label, content))
                .map(String::as_str),
        )
    {
        if issues.len() >= 16 {
            break;
        }
        let excerpt: String = claim.chars().take(150).collect();
        if !issues.iter().any(|issue| issue.claim.starts_with(&excerpt)) {
            issues.push(SummaryIssue {
                claim: excerpt,
                reason: "missing",
            });
        }
    }
    issues
}

struct Fact<'a> {
    field: &'a str,
    value: &'a str,
    // Equal classes describe the same type of comparable value. Free-text values
    // can be shown side by side but different spellings do not prove a conflict.
    class: &'a str,
    comparable: Option<String>,
}

fn fact(text: &str) -> Option<Fact<'_>> {
    if text.contains([
        '。', ';', '；', '\n', '，', ',', '?', '？', '!', '！', '（', '(', '|',
    ]) {
        return None;
    }
    let parts = text
        .split_once(['：', ':'])
        .or_else(|| text.split_once("为"))
        .or_else(|| text.split_once("位于"))
        .or_else(|| text.split_once("设在"))
        .or_else(|| {
            text.find(|c: char| c.is_ascii_digit())
                .map(|i| text.split_at(i))
        })?;
    let (field, value) = (parts.0.trim(), parts.1.trim());
    if !(2..=32).contains(&field.chars().count())
        || !(1..=36).contains(&value.chars().count())
        || field.contains(['不', '未', '若', '当', '如', '从', '至', '约', '≥', '≤'])
        || value.contains(['：', ':', '、', '/', '若', '或', '约', '至'])
    {
        return None;
    }
    // Only compare complete, non-negative decimal quantities in the same unit.
    let number = value.trim_end_matches(|c: char| !c.is_ascii_digit() && c != '.');
    let unit = value[number.len()..].trim();
    let mut comparable = None;
    let mut class = "text";
    if [
        "分钟", "小时", "秒", "天", "场", "次", "人", "元", "%", "件",
    ]
    .contains(&unit)
    {
        let n = number.trim();
        let (integer, fraction) = n.split_once('.').unwrap_or((n, ""));
        if !integer.is_empty()
            && integer.bytes().all(|b| b.is_ascii_digit())
            && fraction.bytes().all(|b| b.is_ascii_digit())
        {
            let integer = integer.trim_start_matches('0');
            let fraction = fraction.trim_end_matches('0');
            comparable = Some(format!(
                "{}.{fraction}",
                if integer.is_empty() { "0" } else { integer }
            ));
            class = unit;
        }
    } else if ["开放", "关闭"].contains(&value) {
        comparable = Some(value.into());
        class = "open";
    } else if ["启用", "停用"].contains(&value) {
        comparable = Some(value.into());
        class = "enabled";
    }
    Some(Fact {
        field,
        value,
        class,
        comparable,
    })
}

/// Use the whole surrounding text as a scope check. A heading several lines
/// before the quote or a condition following it may change how a value applies.
/// For large documents preserve the excerpts and skip automatic comparison.
pub(super) fn excerpt_contexts(
    refs: &[Original],
    mut load: impl FnMut(&Original) -> Option<String>,
) -> Vec<Option<String>> {
    const CONTEXT_BUDGET: usize = 64 * 1024;
    let mut contexts = vec![None; refs.len()];
    let mut documents: HashMap<&str, Vec<usize>> = HashMap::new();
    for (i, r) in refs.iter().enumerate() {
        documents.entry(&r.document_id).or_default().push(i);
    }
    let mut title_counts = HashMap::new();
    for indices in documents.values() {
        *title_counts
            .entry(refs[indices[0]].title.as_str())
            .or_insert(0) += 1;
    }
    for indices in documents.into_values() {
        let r = &refs[indices[0]];
        if title_counts[r.title.as_str()] < 2 {
            continue;
        }
        let Some(text) = load(r) else { continue };
        if text.len() > CONTEXT_BUDGET || crate::files::hash(&text) != r.hash {
            continue;
        }
        let lines: Vec<_> = text.lines().collect();
        for i in indices {
            let Some(start) = refs[i].start_line.checked_sub(1) else {
                continue;
            };
            let end = refs[i].end_line;
            if end <= start || end > lines.len() {
                continue;
            }
            let mut context = r.title.clone();
            context.push('\0');
            for line in &lines[..start] {
                context.push_str(line);
                context.push('\n');
            }
            context.push_str("\0");
            for line in &lines[end..] {
                context.push('\n');
                context.push_str(line);
            }
            contexts[i] = Some(crate::files::hash(context));
        }
    }
    contexts
}

/// Recognize an explicit per-session duration inside longer prose, preserving
/// dates, other quantities, qualifiers and any replacement disclaimer in the row.
fn session_duration(text: &str) -> Option<Fact<'_>> {
    for unit in ["每场", "每节", "每次"] {
        let Some((_, tail)) = text.split_once(unit) else {
            continue;
        };
        if tail.contains(unit) {
            return None;
        }
        let tail = tail.trim_start().trim_start_matches("时长").trim_start();
        let tail = ["记为", "记录为", "为", "持续", "约"]
            .iter()
            .find_map(|prefix| tail.strip_prefix(prefix))
            .unwrap_or(tail)
            .trim_start();
        let n = tail
            .bytes()
            .take_while(|b| b.is_ascii_digit() || *b == b'.')
            .count();
        if n == 0 {
            continue;
        }
        let after = tail[n..].trim_start();
        let duration = ["分钟", "小时", "秒"]
            .iter()
            .find(|u| after.starts_with(**u))?;
        return Some(Fact {
            field: unit,
            value: &tail[..tail.len() - after.len() + duration.len()],
            class: "contextual-duration",
            comparable: None,
        });
    }
    None
}

fn grouping_fact(text: &str) -> Option<Fact<'_>> {
    session_duration(text).or_else(|| fact(text))
}

pub(super) fn reviews(
    refs: &[Original],
    contexts: &[Option<String>],
    issues: &[SummaryIssue],
    stale: bool,
) -> Vec<ClaimReview> {
    let mut rows = Vec::new();
    let mut groups: Vec<Vec<(&str, usize)>> = Vec::new();
    let mut positions = HashMap::new();
    for (index, source) in refs.iter().enumerate() {
        let statement = quoted_unit(&source.quote);
        let key = grouping_fact(statement).map_or((false, statement), |f| (true, f.field));
        let slot = *positions.entry(key).or_insert_with(|| {
            groups.push(Vec::new());
            groups.len() - 1
        });
        groups[slot].push((statement, index));
    }
    for items in groups {
        let mut indices: Vec<_> = items.iter().map(|(_, i)| *i).collect();
        indices.sort_unstable();
        indices.dedup();
        let ids: HashSet<_> = indices.iter().map(|i| &refs[*i].document_id).collect();
        let first = items[0].0;
        if ids.len() > 1 && items.iter().all(|(text, _)| *text == first) {
            rows.push(ClaimReview {
                claim: first.into(),
                status: "supported",
                ref_indices: indices,
            });
            continue;
        }
        let parsed: Vec<_> = items
            .iter()
            .filter_map(|(text, idx)| grouping_fact(text).map(|f| (f, *idx)))
            .collect();
        if ids.len() > 1 && parsed.len() == items.len() {
            let mut by_doc = HashMap::new();
            let mut stable = true;
            for (item, idx) in &parsed {
                let doc = &refs[*idx].document_id;
                if let Some(previous) = by_doc.insert(doc, item.value) {
                    stable &= previous == item.value;
                }
            }
            if stable {
                let first = &parsed[0].0;
                let comparable = parsed
                    .iter()
                    .all(|(f, _)| f.class == first.class && f.comparable.is_some());
                let shared_context = contexts
                    .get(indices[0])
                    .and_then(Option::as_ref)
                    .is_some_and(|expected| {
                        indices
                            .iter()
                            .all(|i| contexts.get(*i).and_then(Option::as_ref) == Some(expected))
                    });
                let status = if !shared_context || !comparable {
                    "parallel"
                } else if parsed.iter().any(|(f, _)| f.comparable != first.comparable) {
                    "conflict"
                } else {
                    "supported"
                };
                let mut shown = HashSet::new();
                let values = parsed
                    .iter()
                    .filter(|(_, i)| shown.insert(&refs[*i].document_id))
                    .map(|(_, i)| {
                        format!(
                            "《{}》记载「{}」",
                            refs[*i].title,
                            quoted_unit(&refs[*i].quote)
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("，");
                rows.push(ClaimReview {
                    claim: format!("{}：{values}", first.field),
                    status,
                    ref_indices: indices,
                });
                continue;
            }
        }
        // Count evidence for each complete statement, even if two entries share a
        // field but one file gave different values under unspecified conditions.
        let mut seen = HashSet::new();
        for (statement, _) in &items {
            if !seen.insert(*statement) {
                continue;
            }
            let evidence: Vec<_> = indices
                .iter()
                .copied()
                .filter(|idx| items.iter().any(|(s, i)| s == statement && i == idx))
                .collect();
            let one = evidence
                .iter()
                .all(|i| refs[*i].document_id == refs[evidence[0]].document_id);
            let claim = if one {
                format!(
                    "本组摘录中仅《{}》记载：{}",
                    refs[evidence[0]].title, statement
                )
            } else {
                statement.to_string()
            };
            rows.push(ClaimReview {
                claim,
                status: if one { "singleSource" } else { "supported" },
                ref_indices: evidence,
            });
        }
    }
    for issue in issues {
        rows.push(ClaimReview {
            claim: issue.claim.clone(),
            status: "missing",
            ref_indices: vec![],
        });
    }
    if stale {
        rows.push(ClaimReview {
            claim: "部分来源已变更或已移出范围，请重新整理后核对综合结论。".into(),
            status: "sourceChanged",
            ref_indices: vec![],
        });
    }
    rows
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wiki::Section;

    fn original(file: &str, text: &str) -> Original {
        Original {
            title: format!("{file}.md"),
            document_id: file.into(),
            path: file.into(),
            start_line: 1,
            end_line: 1,
            hash: "v1".into(),
            quote: text.into(),
        }
    }

    #[test]
    fn facts_remain_with_their_sources_and_same_units() {
        for (left, right, expected) in [
            ("讲解时长为 45 分钟", "讲解时长：60分钟", "conflict"),
            ("讲解时长为 45.0 分钟", "讲解时长为 045 分钟", "supported"),
            ("讲解时长为 60 分钟", "讲解时长为 1 小时", "parallel"),
            ("前台状态：开放", "前台状态：关闭", "conflict"),
            ("前台地点：大厅", "前台地点：门厅", "parallel"),
            ("预约时间另行公布", "预约时间另行公布", "supported"),
        ] {
            let refs = [
                original("交接记录", left),
                original("活动笔记", right),
                original("交接记录", "签到处设在北门。"),
            ];
            let rows = reviews(
                &refs,
                &vec![Some("共同主题".into()); refs.len()],
                &[],
                false,
            );
            assert_eq!(rows.len(), 2);
            assert_eq!(rows[0].status, expected, "{left} vs {right}");
            assert_eq!(rows[0].ref_indices, [0, 1]);
            assert_eq!(rows[1].status, "singleSource");
            assert_eq!(rows[1].ref_indices, [2]);
            assert!(rows[1]
                .claim
                .contains("仅《交接记录.md》记载：签到处设在北门"));
        }
        for (a, b) in [
            (
                original("A", "开场活动时长为 45 分钟"),
                original("B", "闭幕活动时长为 60 分钟"),
            ),
            (
                original("A", "晴天，活动时长为 45 分钟"),
                original("B", "活动时长为 60 分钟"),
            ),
            (
                original("A", "讲解时长为 40 分钟"),
                original("A", "讲解时长为 60 分钟"),
            ),
        ] {
            assert!(reviews(&[a, b], &[], &[], false)
                .iter()
                .all(|r| r.status == "singleSource"));
        }
    }

    #[test]
    fn replay_activity_records_keeps_each_date_replacement_caveat_and_source() {
        let refs = [
            original(
                "原生验收-社区活动",
                "活动预计在12月3日于东区阅览室举行，共安排4场，每场45分钟。",
            ),
            original(
                "原生验收-交接记录",
                "交接记录将每场时长记为60分钟，未说明是否替代原活动安排。",
            ),
            original("原生验收-交接记录", "签到处位于西侧服务台。"),
        ];
        let rows = reviews(&refs, &[], &[], false);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].status, "parallel");
        assert_eq!(rows[0].ref_indices, [0, 1]);
        for cue in ["12月3日", "4场", "45分钟", "60分钟", "未说明是否替代"] {
            assert!(rows[0].claim.contains(cue));
        }
        assert_eq!(rows[1].status, "singleSource");
        assert_eq!(rows[1].ref_indices, [2]);
        let mut multiple = refs.clone();
        multiple[0].quote = "12月3日每场45分钟。12月4日每场50分钟。".into();
        let rows = reviews(&multiple, &[], &[], false);
        assert!(rows.iter().all(|r| r.status != "conflict"));
        assert!(rows
            .iter()
            .any(|r| r.claim.contains("12月3日每场45分钟。12月4日每场50分钟")));
    }

    #[test]
    fn never_drops_companion_conditions_from_quotes_or_attributed_summaries() {
        for (left, right, short) in [
            (
                "本段适用于工作日。每场时长为45分钟。",
                "本段适用于周末。每场时长为60分钟。",
                "每场时长为45分钟",
            ),
            (
                "时长：45分钟。仅工作日执行。",
                "时长：60分钟。仅周末执行。",
                "时长：45分钟",
            ),
            (
                "时长：45分钟。统计口径：工作日。",
                "时长：60分钟。统计口径：周末。",
                "时长：45分钟",
            ),
            (
                "前台状态：开放。观察地点：南门。",
                "前台状态：关闭。观察地点：北门。",
                "前台状态：开放",
            ),
        ] {
            let refs = vec![original("A", left), original("B", right)];
            let rows = reviews(
                &refs,
                &[Some("same".into()), Some("same".into())],
                &[],
                false,
            );
            assert!(rows.iter().all(|r| r.status != "conflict"));
            assert!(rows.iter().any(|r| r.claim.contains(quoted_unit(left))));
            assert!(rows.iter().any(|r| r.claim.contains(quoted_unit(right))));
            let mut content = Content {
                title: "活动安排".into(),
                summary: short.into(),
                aliases: vec![],
                related: vec![],
                inputs: vec![],
                sections: vec![Section {
                    heading: "活动".into(),
                    refs,
                }],
            };
            assert!(!issues(&content).is_empty());
            content.summary = format!("《A》记载：{short}。");
            assert!(!issues(&content).is_empty());
        }
    }

    #[test]
    fn compare_only_matching_context_even_when_a_later_line_limits_the_value() {
        let pair = [
            original("活动A", "时长：45分钟。"),
            original("活动B", "时长：60分钟。"),
        ];
        for (a, b, expected) in [
            (
                "# 澄湾\n## 开场\n时长：45分钟。",
                "# 澄湾\n## 闭幕\n时长：60分钟。",
                "parallel",
            ),
            (
                "甲\n开场\n时长：45分钟。",
                "乙\n开场\n时长：60分钟。",
                "parallel",
            ),
            (
                "# 澄湾\n共同说明\n时长：45分钟。\n仅工作日执行",
                "# 澄湾\n共同说明\n时长：60分钟。\n仅周末执行",
                "parallel",
            ),
            (
                "# 澄湾\n## 开场\n时长：45分钟。",
                "# 澄湾\n## 开场\n时长：60分钟。",
                "conflict",
            ),
        ] {
            let mut refs = pair.clone();
            for (r, text) in refs.iter_mut().zip([a, b]) {
                r.title = "澄湾讲解.md".into();
                r.hash = crate::files::hash(text);
                r.start_line = 3;
                r.end_line = 3;
            }
            let keys = excerpt_contexts(&refs, |r| {
                Some(if r.document_id == "活动A" { a } else { b }.into())
            });
            let rows = reviews(&refs, &keys, &[], false);
            assert_eq!(rows[0].status, expected);
            refs[1].title = "另一项活动.md".into();
            let keys = excerpt_contexts(&refs, |r| {
                Some(if r.document_id == "活动A" { a } else { b }.into())
            });
            assert_eq!(reviews(&refs, &keys, &[], false)[0].status, "parallel");
        }
    }

    #[test]
    fn assertions_must_match_the_claimed_source_and_cannot_infer_a_replacement() {
        let mut content = Content {
            title: "活动安排".into(),
            summary: String::new(),
            related: vec![],
            aliases: vec![],
            inputs: vec![],
            sections: vec![Section {
                heading: "活动".into(),
                refs: vec![
                    original("交接", "每场时长为 45 分钟。"),
                    original("交接", "签到处设在北门。"),
                    original("计划", "每场时长为 60 分钟。"),
                ],
            }],
        };
        for claim in [
            "两份资料的签到地点不同。",
            "计划取代了交接。",
            "两份资料都在北门签到。",
            "《计划》记载：签到处设在北门。",
            "签到处移到了南门。",
        ] {
            content.summary = claim.into();
            assert!(!issues(&content).is_empty(), "{claim}");
        }
        content.summary="《交接》记载：每场时长为 45 分钟。《计划.md》记载：每场时长为 60 分钟。《交接》记载：签到处设在北门。".into();
        assert!(issues(&content).is_empty());
        for phrase in [
            "两份资料的签到地点不同",
            "签到地点由北门改为南门",
            "地点调整至南门",
            "计划代替交接记录",
            "迁往新址",
        ] {
            content.sections[0].heading = phrase.into();
            assert!(unverified_label(phrase, &content));
            assert!(!issues(&content).is_empty());
        }
    }
}
