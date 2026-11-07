use crate::{db, files, models::*};
use std::collections::{HashMap, HashSet};

/// Only consume an explicit leading rendering request. A format name elsewhere
/// can be the subject of the question (or an identifier such as JSON-A).
fn presentation_payload(clause: &str, formats: &[&str]) -> Option<String> {
    let mut rest = ["请用", "请以", "请采用", "请按照"]
        .iter()
        .find_map(|prefix| clause.strip_prefix(prefix))?
        .trim_start();
    let mut consumed = false;
    loop {
        let lower = rest.to_ascii_lowercase();
        let name = formats.iter().find(|name| {
            lower.starts_with(**name)
                && (!name.is_ascii()
                    || rest[name.len()..]
                        .chars()
                        .next()
                        .is_none_or(|c| !c.is_ascii_alphanumeric() && c != '-' && c != '_'))
        });
        let Some(name) = name else { break };
        consumed = true;
        rest = rest[name.len()..].trim_start();
        for separator in ["和", "与", "及", "、", "/", "+"] {
            if let Some(after) = rest.strip_prefix(separator) {
                let after = after.trim_start();
                let lower = after.to_ascii_lowercase();
                if formats.iter().any(|name| lower.starts_with(name)) {
                    rest = after;
                    break;
                }
            }
        }
    }
    if !consumed {
        return None;
    }
    let rest = [
        "对比", "比较", "展示", "呈现", "列出", "汇总", "解释", "说明", "回答", "整理", "输出",
    ]
    .iter()
    .find_map(|action| rest.strip_prefix(action))?
    .trim();
    (!rest.is_empty()).then(|| rest.to_string())
}

/// Remove explicit presentation instructions only. Unclassified clauses and entity,
/// date, identifier, unit and numeric residues remain in the retrieval question.
/// Generation must still receive the untouched original question.
pub fn knowledge_query(question: &str) -> String {
    let mut kept = Vec::new();
    let mut changed = false;
    for raw in query_clauses(question) {
        let clause = raw.trim();
        if clause.is_empty() {
            continue;
        }
        if matches!(
            clause,
            "附来源"
                | "附上来源"
                | "请附来源"
                | "附引用"
                | "注明来源"
                | "请标明来源"
                | "带来源"
                | "请附引用"
        ) {
            changed = true;
            continue;
        }
        let lower = clause.to_ascii_lowercase();
        if let Some((name, value)) = clause.split_once([':', '：']) {
            if name.trim().eq_ignore_ascii_case("sourceRefs") {
                let value = value.replace(['“', '”'], "\"");
                if serde_json::from_str::<Vec<String>>(&value)
                    .ok()
                    .is_some_and(|ids| {
                        !ids.is_empty()
                            && ids.iter().all(|id| {
                                id.strip_prefix('S').is_some_and(|s| {
                                    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
                                })
                            })
                    })
                {
                    changed = true;
                    continue;
                }
            }
        }
        let format_words = [
            "markdown",
            "chart",
            "json",
            "表格",
            "柱状图",
            "折线图",
            "饼图",
            "环形图",
            "脑图",
            "思维导图",
            "mermaid",
        ];
        let has_format = format_words.iter().any(|word| lower.contains(word));

        if has_format {
            if let Some(payload) = presentation_payload(clause, &format_words) {
                changed = true;
                kept.push(payload);
                continue;
            }
            let mut residue = clause.to_string();
            // Removing explicit format vocabulary must not discard a factual constraint
            // merely because it appears after a comma in the same sentence.
            for word in format_words {
                while let Some(start) = residue.to_ascii_lowercase().find(word) {
                    residue.replace_range(start..start + word.len(), " ");
                }
            }
            for prefix in [
                "请将结果",
                "请按照",
                "请采用",
                "输出格式",
                "回答格式",
                "格式要求",
                "请输出",
                "请用",
                "请以",
                "并用",
                "并以",
            ] {
                if let Some(value) = residue.trim().strip_prefix(prefix) {
                    residue = value.to_string();
                    break;
                }
            }
            let residue = residue
                .split_whitespace()
                .filter(|word| {
                    ![
                        "的形式",
                        "的格式",
                        "形式",
                        "格式",
                        "呈现",
                        "展示",
                        "输出",
                        "比较",
                        "以及",
                        "并且",
                        "使用",
                        "和",
                        "及",
                        "并",
                    ]
                    .contains(word)
                })
                .collect::<Vec<_>>()
                .join(" ");
            let residue = residue.trim_matches(|c: char| {
                c.is_whitespace() || matches!(c, ':' | '：' | '、' | '/' | '+' | '。' | '.')
            });
            if residue.is_empty() {
                changed = true;
                continue;
            }
        }
        kept.push(clause.to_string());
    }
    let query = kept.join("，");
    // A question about formatting itself must never turn into an empty query.
    if !changed || query.trim().is_empty() {
        question.trim().into()
    } else {
        query
    }
}

fn query_clauses(question: &str) -> Vec<&str> {
    let mut clauses = Vec::new();
    let mut start = 0;
    let mut depth = 0usize;
    let mut quote = None;
    let mut escape = false;
    let chars = question.char_indices().collect::<Vec<_>>();
    for (index, &(byte, ch)) in chars.iter().enumerate() {
        if let Some(end) = quote {
            if escape {
                escape = false;
            } else if ch == '\\' {
                escape = true;
            } else if ch == end {
                quote = None;
            }
            continue;
        }
        match ch {
            '"' => quote = Some('"'),
            '“' => quote = Some('”'),
            '[' | '{' => depth += 1,
            ']' | '}' => depth = depth.saturating_sub(1),
            _ => {}
        }
        let numeric_comma = ch == ','
            && index > 0
            && chars
                .get(index + 1)
                .is_some_and(|(_, next)| next.is_ascii_digit())
            && chars[index - 1].1.is_ascii_digit();
        if depth == 0
            && !numeric_comma
            && matches!(ch, '，' | ',' | '；' | ';' | '\n' | '。' | '？')
        {
            clauses.push(&question[start..byte]);
            start = byte + ch.len_utf8();
        }
    }
    clauses.push(&question[start..]);
    clauses
}

/// Explicit per-query modes override global defaults. Legacy clients retain their
/// semantic switch and global reranker behavior until they send a mode.
#[derive(Debug, PartialEq)]
pub struct RetrievalPlan {
    pub semantic: bool,
    pub rerank: bool,
}
pub fn query_plan(
    requested: Option<&str>,
    semantic: bool,
    reranker_enabled: bool,
) -> Result<RetrievalPlan, String> {
    let (semantic, rerank) = match requested {
        None => (semantic, reranker_enabled),
        Some("keyword") => (false, false),
        Some("hybrid") => (true, false),
        Some("rerank") => (true, reranker_enabled),
        Some(_) => return Err("不支持的检索模式，请选择关键词、混合检索或混合加重排".into()),
    };
    Ok(RetrievalPlan { semantic, rerank })
}

/// Lexical evidence is a conservative signal, never a probability derived from RRF.
pub fn mark_lexical_evidence(query: &str, results: &mut [SearchResult]) {
    crate::evidence::mark(query, results);
}
fn source_hash(ws: &Workspace, path: &str) -> Option<String> {
    files::resolve(&ws.root, path, false)
        .and_then(|p| files::read_text(&p))
        .ok()
        .map(files::hash)
}
pub fn source_versions_current(ws: &Workspace, sources: &[SearchResult]) -> bool {
    let mut hashes = HashMap::new();
    sources.iter().all(|s| {
        hashes
            .entry(s.path.as_str())
            .or_insert_with(|| source_hash(ws, &s.path))
            .as_deref()
            == Some(s.hash.as_str())
    })
}
pub fn retain_current_sources(ws: &Workspace, sources: &mut Vec<SearchResult>) -> usize {
    let before = sources.len();
    let mut hashes = HashMap::new();
    sources.retain(|s| {
        hashes
            .entry(s.path.clone())
            .or_insert_with(|| source_hash(ws, &s.path))
            .as_deref()
            == Some(s.hash.as_str())
    });
    before - sources.len()
}
/// Shared by live search and evaluations; never confuse retrieval order with evidence order.
pub fn finish_ranking(results: &mut Vec<SearchResult>) {
    results.sort_by(|a, b| {
        b.evidence
            .cmp(&a.evidence)
            .then(
                b.rerank_score
                    .unwrap_or(-1.0)
                    .total_cmp(&a.rerank_score.unwrap_or(-1.0)),
            )
            .then(b.score.total_cmp(&a.score))
            .then(a.id.cmp(&b.id))
    });
    results.truncate(12);
}
pub fn generation_context(
    ws: &Workspace,
    results: &[SearchResult],
    mut remaining: usize,
    current_scope: bool,
) -> Vec<SearchResult> {
    let mut sources = vec![];
    for s in answer_context(ws, results, 2400, current_scope) {
        if remaining < 200 {
            break;
        }
        let cost = s.text.chars().count() + 200;
        // A partial table/fence or clipped negation is not a faithful citation.
        // Skip an oversized source, allowing a later complete source to fit.
        if cost > remaining {
            continue;
        }
        remaining -= cost;
        sources.push(s);
    }
    sources
}
pub fn merge_wiki(results: &mut Vec<SearchResult>, wiki: Vec<SearchResult>) {
    let mut credited = HashSet::new();
    for hit in wiki {
        let overlaps = |candidate: &SearchResult| {
            candidate.path == hit.path
                && candidate.hash == hit.hash
                && candidate.start_line <= hit.end_line
                && hit.start_line <= candidate.end_line
        };
        if let Some(candidate) = results.iter_mut().find(|item| overlaps(item)) {
            if credited.insert((
                candidate.path.clone(),
                candidate.start_line,
                candidate.end_line,
            )) {
                candidate.score += hit.score;
                candidate.match_kind = "wiki".into();
            }
        } else {
            results.push(hit);
        }
    }
    results.sort_by(|a, b| {
        b.score
            .total_cmp(&a.score)
            .then(a.path.cmp(&b.path))
            .then(a.start_line.cmp(&b.start_line))
    });
}

pub fn balance_candidates(results: &mut Vec<SearchResult>) {
    let mut seen = HashSet::new();
    let (first, rest): (Vec<_>, Vec<_>) = std::mem::take(results)
        .into_iter()
        .partition(|item| seen.insert(item.path.clone()));
    results.extend(first.into_iter().chain(rest));
}

pub fn apply_rerank_policy(
    results: &mut [SearchResult],
    ranking: &[(usize, f64)],
    min_score: f64,
    strict: bool,
) {
    let original = results
        .iter()
        .map(|r| (r.evidence, r.match_kind == "wiki"))
        .collect::<Vec<_>>();
    for (i, item) in results.iter_mut().enumerate() {
        item.rerank_score = None;
        item.evidence = !strict && original[i].0;
    }
    for &(i, score) in ranking {
        if let Some(item) = results.get_mut(i) {
            item.rerank_score = Some(score);
            item.evidence = original[i].0 && (!strict || score >= min_score);
            item.match_kind = match (original[i].1, item.evidence) {
                (true, true) => "wiki-reranked",
                (true, false) => "wiki",
                (_, true) => "reranked",
                _ => "candidate",
            }
            .into();
        }
    }
}

#[cfg(test)]
pub fn apply_rerank(results: &mut [SearchResult], ranking: &[(usize, f64)], min_score: f64) {
    // Relevance is not entailment: a high score for an entity's document does
    // not prove it contains the requested phone number, year or other fact.
    let eligible = results.iter().map(|r| r.evidence).collect::<Vec<_>>();
    for r in results.iter_mut() {
        r.evidence = false;
        r.match_kind = "candidate".into();
        r.rerank_score = None;
    }
    for &(index, score) in ranking {
        if let Some(r) = results.get_mut(index) {
            r.rerank_score = Some(score);
            r.evidence = eligible[index] && score >= min_score;
            r.match_kind = if r.evidence { "reranked" } else { "candidate" }.into();
        }
    }
    results.sort_by(|a, b| {
        b.rerank_score
            .unwrap_or(-1.0)
            .total_cmp(&a.rerank_score.unwrap_or(-1.0))
            .then(b.score.total_cmp(&a.score))
            .then(a.id.cmp(&b.id))
    });
}
pub fn rerank_failed(results: &mut [SearchResult], strict: bool) -> &'static str {
    if strict {
        for r in results {
            r.evidence = false;
            r.match_kind = "candidate".into();
            r.rerank_score = None;
        }
        "strict-unavailable"
    } else {
        "fallback"
    }
}
fn fence(line: &str) -> Option<(u8, usize)> {
    let text = line.trim_start().as_bytes();
    let c = *text.first()?;
    if c != 96 && c != b'~' {
        return None;
    }
    let n = text.iter().take_while(|&&x| x == c).count();
    if n < 3 {
        return None;
    }
    Some((c, n))
}
/// Expand inside one fenced parent block; small JSON fields should not consume six separate citations.
fn parent_range(lines: &[&str], from: usize, to: usize, max_chars: usize) -> (usize, usize) {
    let mut open: Option<(usize, u8, usize)> = None;
    for (i, line) in lines.iter().enumerate() {
        if let Some((c, n)) = fence(line) {
            if let Some((start, oc, on)) = open {
                let closing = line.trim().as_bytes().iter().all(|x| *x == oc);
                if c == oc && n >= on && closing {
                    if start <= from
                        && i >= to
                        && i - start <= 100
                        && lines[start..=i]
                            .iter()
                            .map(|s| s.chars().count() + 1)
                            .sum::<usize>()
                            <= max_chars
                    {
                        return (start, i);
                    }
                    open = None;
                }
            } else {
                open = Some((i, c, n));
            }
        }
        if i > to && open.is_none() {
            break;
        }
    }
    table_parent_range(lines, from, to, max_chars).unwrap_or((from, to))
}

/// Keep a small Markdown table together with its nearby same-section title and
/// units. This expands already-approved evidence; it never grants evidence to a
/// previously rejected candidate or crosses another heading/fenced block.
fn table_parent_range(
    lines: &[&str],
    from: usize,
    to: usize,
    max_chars: usize,
) -> Option<(usize, usize)> {
    let mut outside = vec![true; lines.len()];
    let mut open: Option<(u8, usize)> = None;
    for (i, line) in lines.iter().enumerate() {
        outside[i] = open.is_none();
        if let Some((c, n)) = fence(line) {
            outside[i] = false;
            if let Some((oc, on)) = open {
                if c == oc && n >= on && line.trim().bytes().all(|b| b == oc) {
                    open = None;
                }
            } else {
                open = Some((c, n));
            }
        }
    }
    if !(from..=to).all(|i| outside[i]) {
        return None;
    }
    let heading = |i: usize| outside[i] && lines[i].trim_start().starts_with('#');
    let start = (0..=from).rev().find(|i| heading(*i)).unwrap_or(0);
    let end = (to + 1..lines.len())
        .find(|i| heading(*i))
        .unwrap_or(lines.len());
    let separator = |line: &str| {
        let cells = line
            .trim()
            .trim_matches('|')
            .split('|')
            .map(str::trim)
            .collect::<Vec<_>>();
        cells.len() >= 2
            && cells.iter().all(|cell| {
                cell.bytes().filter(|c| *c == b'-').count() >= 3
                    && cell.bytes().all(|b| b == b'-' || b == b':')
            })
    };
    let seed_metadata = lines[from..=to].iter().any(|line| {
        line.contains("单位")
            || line.contains("指标")
            || line.contains("口径")
            || line.trim_start().starts_with('#')
    });
    for divider in start + 1..end {
        if !outside[divider]
            || !outside[divider - 1]
            || !separator(lines[divider])
            || !lines[divider - 1].contains('|')
        {
            continue;
        }
        let header = divider - 1;
        let mut last = divider;
        while last + 1 < end
            && outside[last + 1]
            && !lines[last + 1].trim().is_empty()
            && lines[last + 1].contains('|')
        {
            last += 1;
        }
        let overlaps = from <= last && to >= header;
        let adjacent = seed_metadata
            && ((to < header && header - to <= 6) || (from > last && from - last <= 6));
        if !overlaps && !adjacent {
            continue;
        }
        let mut left = header.min(from);
        let mut right = last.max(to);
        if header - start <= 8 {
            left = start.min(left);
        } else {
            // Do not sweep arbitrary paragraphs into a citation. Only the
            // immediately preceding short metadata paragraph is eligible.
            for i in (header.saturating_sub(4).max(start)..header).rev() {
                if lines[i].contains("单位")
                    || lines[i].contains("指标")
                    || lines[i].contains("口径")
                {
                    left = i.min(left);
                }
            }
        }
        // Units sometimes follow the table; include only an explicit short
        // metadata line, without crossing a heading or a fenced block.
        for i in last + 1..(last + 4).min(end) {
            if !outside[i] {
                break;
            }
            if lines[i].contains("单位") || lines[i].contains("指标") || lines[i].contains("口径")
            {
                right = i.max(right);
            }
        }
        if right - left <= 100
            && (left..=right).all(|i| outside[i])
            && lines[left..=right]
                .iter()
                .map(|s| s.chars().count() + 1)
                .sum::<usize>()
                <= max_chars
        {
            return Some((left, right));
        }
    }
    None
}
pub fn answer_context(
    ws: &Workspace,
    results: &[SearchResult],
    max_chars: usize,
    current_scope: bool,
) -> Vec<SearchResult> {
    let mut files_cache = HashMap::<String, Option<String>>::new();
    let mut seen = HashSet::new();
    let mut prepared = vec![];
    for r in results.iter().filter(|r| r.evidence) {
        let content = files_cache.entry(r.path.clone()).or_insert_with(|| {
            files::resolve(&ws.root, &r.path, false)
                .and_then(|p| files::read_text(&p))
                .ok()
                .filter(|s| files::hash(s) == r.hash)
        });
        let Some(content) = content.as_ref() else {
            continue;
        };
        let lines = content.lines().collect::<Vec<_>>();
        if lines.is_empty() {
            continue;
        }
        let start = r.start_line.saturating_sub(1).min(lines.len() - 1);
        let end = r.end_line.saturating_sub(1).min(lines.len() - 1).max(start);
        let small_json = r.path.to_lowercase().ends_with(".json")
            && lines.len() <= 100
            && content.chars().count() <= max_chars;
        let (from, to) = if small_json {
            (0, lines.len() - 1)
        } else {
            parent_range(&lines, start, end, max_chars)
        };
        if !seen.insert((r.path.clone(), from, to)) {
            continue;
        }
        let mut item = r.clone();
        if small_json || from != start || to != end {
            item.text = lines[from..=to].join("\n");
            item.start_line = from + 1;
            item.end_line = to + 1;
        }
        prepared.push(item);
    }
    if current_scope {
        return prepared.into_iter().take(6).collect();
    }
    let mut counts = HashMap::<String, usize>::new();
    let mut selected = vec![];
    let mut duplicates = vec![];
    let mut deferred = vec![];
    for r in prepared {
        let n = counts.entry(r.path.clone()).or_default();
        if *n == 0 {
            *n += 1;
            selected.push(r);
        } else if *n < 3 {
            *n += 1;
            duplicates.push(r);
        } else {
            deferred.push(r);
        }
    }
    selected.extend(duplicates);
    selected.extend(deferred);
    selected.into_iter().take(6).collect()
}

#[cfg(test)]
mod tests {
    #[test]
    fn presentation_instructions_are_separate_without_losing_factual_constraints() {
        use super::knowledge_query;
        assert_eq!(
            knowledge_query(
                "Q1 Q2 Q3 Q4 收入 成本，请用 Markdown 表格和 chart 柱状图比较，附来源。"
            ),
            "Q1 Q2 Q3 Q4 收入 成本"
        );
        assert_eq!(
            knowledge_query("Q1 收入，表格和 chart，sourceRefs:[\"S1\",\"S2\"]。"),
            "Q1 收入"
        );
        assert_eq!(
            knowledge_query("出差报销提交期限是什么？请用 Markdown 表格呈现，附来源。"),
            "出差报销提交期限是什么"
        );
        for text in [
            "Markdown 表格是什么？",
            "请用 JSON 表达",
            "2026年和田收入1,200万元与成本9007199254740993，限定人民币，资料是否充分？",
            "请用 JSON-A 和 JSON-B 比较2026年结果",
        ] {
            assert_eq!(knowledge_query(text), text);
        }
        let original="2026-10-29 和田项目 RAG-102 收入1,200万元，最多取2025与2026年度，请用 Markdown 表格和 chart 比较，附来源。";
        let query = knowledge_query(original);
        for entity in [
            "2026-10-29",
            "和田",
            "RAG-102",
            "1,200万元",
            "2025与2026年度",
        ] {
            assert!(query.contains(entity), "{query} lost {entity}");
        }
    }
    #[test]
    fn explicit_rendering_prefix_does_not_become_evidence_terms_or_erase_fact_format_names() {
        let query = knowledge_query(
            "请用柱状图对比桥北2028年和2029年库存，单位为箱，批次JSON-A，编号9007199254740993。",
        );
        assert!(!query.contains("柱状图"));
        for fact in [
            "桥北",
            "2028年",
            "2029年",
            "库存",
            "单位为箱",
            "JSON-A",
            "9007199254740993",
        ] {
            assert!(query.contains(fact), "lost factual constraint: {query}");
        }
        assert_eq!(
            knowledge_query("请用表格展示和田2026年收入"),
            "和田2026年收入"
        );
        assert_eq!(
            knowledge_query("请用表格解释“JSON”这个概念"),
            "“JSON”这个概念"
        );
        assert!(knowledge_query("请用 Markdown 说明JSON数组[1]的含义").contains("JSON数组[1]"));
        assert_eq!(
            knowledge_query("请用 JSON-A 和 JSON-B 比较2026年结果"),
            "请用 JSON-A 和 JSON-B 比较2026年结果"
        );
        assert_eq!(knowledge_query("柱状图是什么？"), "柱状图是什么？");
    }
    #[test]
    fn separated_question_restores_lexical_evidence_without_reclassifying_no_evidence() {
        use super::*;
        let question = "Q1 Q2 Q3 Q4 收入 成本，请用 Markdown 表格和 chart 柱状图比较，附来源。";
        let mut source=result("Q1 收入120 成本80；Q2 收入150 成本90；Q3 收入138 成本88；Q4 收入180 成本110，单位万元。");
        source.bm25_rank = Some(1);
        let mut before = vec![source.clone()];
        mark_lexical_evidence(question, &mut before);
        let mut after = vec![source];
        mark_lexical_evidence(&knowledge_query(question), &mut after);
        assert!(!before[0].evidence);
        assert!(after[0].evidence);
        mark_lexical_evidence(
            &knowledge_query("珠穆朗玛峰积雪厚度是多少，请用 Markdown 表格呈现，附来源。"),
            &mut after,
        );
        assert!(!after[0].evidence);
    }
    use super::*;
    #[test]
    fn explicit_query_modes_never_enable_unrequested_remote_stages() {
        assert_eq!(
            query_plan(Some("keyword"), true, true).unwrap(),
            RetrievalPlan {
                semantic: false,
                rerank: false
            }
        );
        assert_eq!(
            query_plan(Some("hybrid"), false, true).unwrap(),
            RetrievalPlan {
                semantic: true,
                rerank: false
            }
        );
        assert_eq!(
            query_plan(Some("rerank"), false, true).unwrap(),
            RetrievalPlan {
                semantic: true,
                rerank: true
            }
        );
        assert_eq!(
            query_plan(Some("rerank"), true, false).unwrap(),
            RetrievalPlan {
                semantic: true,
                rerank: false
            }
        );
        assert_eq!(
            query_plan(None, false, true).unwrap(),
            RetrievalPlan {
                semantic: false,
                rerank: true
            }
        );
        assert!(query_plan(Some("other"), true, true).is_err());
    }
    fn result(text: &str) -> SearchResult {
        SearchResult {
            id: 1,
            path: "a.md".into(),
            text: text.into(),
            heading: "写作".into(),
            start_line: 3,
            end_line: 3,
            hash: String::new(),
            score: 1.0,
            title: None,
            document_id: None,
            bm25_score: None,
            vector_distance: Some(0.5),
            bm25_rank: None,
            vector_rank: Some(1),
            rerank_score: None,
            evidence: false,
            match_kind: "candidate".into(),
        }
    }
    #[test]
    fn unrelated_vector_candidates_do_not_become_evidence() {
        let mut results = vec![result("本地保存 JSON 脑图和文档")];
        mark_lexical_evidence("香蕉种植的最佳海拔是多少", &mut results);
        assert!(!results[0].evidence);
        results[0].bm25_rank = Some(1);
        mark_lexical_evidence("香蕉种植的最佳海拔是多少", &mut results);
        assert!(!results[0].evidence);
        results[0].text = "原始数值 9007199254740993".into();
        mark_lexical_evidence("9007199254740993", &mut results);
        assert!(results[0].evidence);
    }
    #[test]
    fn mixed_topic_short_query_requires_more_than_half_keyword_coverage() {
        let mut hit = result("macOS 本地编辑器");
        hit.bm25_rank = Some(1);
        mark_lexical_evidence("macOS 香蕉", std::slice::from_mut(&mut hit));
        assert!(!hit.evidence);
        mark_lexical_evidence("macOS", std::slice::from_mut(&mut hit));
        assert!(hit.evidence);
    }
    #[test]
    fn question_grammar_does_not_erase_entities_conditions_or_unknown_attributes() {
        let terms = db::query_terms("请问白桦节点何时需要校验 XN-004 2028 温度 18 摄氏度");
        assert!(!terms.iter().any(|s| ["何时", "需要"].contains(&s.as_str())));
        for word in ["校验", "xn-004", "2028", "温度", "18", "摄氏度"] {
            assert!(
                terms.iter().any(|s| s == word),
                "lost factual constraint: {word}"
            );
        }
        let mut hit = result("白桦节点温度校验18摄氏度");
        hit.bm25_rank = Some(1);
        mark_lexical_evidence(
            "白桦节点负责人私人电话号码银行账号",
            std::slice::from_mut(&mut hit),
        );
        assert!(!hit.evidence);
    }
    #[test]
    fn context_budget_keeps_complete_sources_and_can_fit_later_smaller_evidence() {
        let d = tempfile::tempdir().unwrap();
        let ws = Workspace {
            root: d.path().canonicalize().unwrap(),
            db: d.path().join("index"),
        };
        let large = "# 数据\n\n| 类别 | 值 |\n| --- | --- |\n| 四月 | 19 |\n";
        let small = "未验收不可寄出。";
        let mut hits = vec![];
        for (name, text) in [("large.md", large), ("small.md", small)] {
            std::fs::write(ws.root.join(name), text).unwrap();
            let mut h = result(text);
            h.path = name.into();
            h.hash = files::hash(text);
            h.start_line = 1;
            h.end_line = text.lines().count();
            h.evidence = true;
            hits.push(h);
        }
        let budget = 200 + small.chars().count();
        let context = generation_context(&ws, &hits, budget, false);
        assert_eq!(context.len(), 1);
        assert_eq!(context[0].path, "small.md");
        assert_eq!(context[0].text, small);
        assert!(generation_context(&ws, &hits, 199, false).is_empty());
        std::fs::write(ws.root.join("small.md"), "已改变").unwrap();
        assert!(generation_context(&ws, &hits, budget, false).is_empty());
    }
    #[test]
    fn strict_failure_revokes_evidence_while_optional_failure_preserves_keyword_fallback() {
        let mut r = result("苹果本地编辑");
        r.bm25_rank = Some(1);
        let mut hits = vec![r];
        mark_lexical_evidence("苹果", &mut hits);
        assert!(hits[0].evidence);
        assert_eq!(rerank_failed(&mut hits, false), "fallback");
        assert!(hits[0].evidence);
        assert_eq!(rerank_failed(&mut hits, true), "strict-unavailable");
        assert!(!hits[0].evidence);
        assert_eq!(hits[0].match_kind, "candidate");
    }
    #[test]
    fn standalone_json_context_preserves_parent_literals_and_detects_later_mutation() {
        let d = tempfile::tempdir().unwrap();
        let ws = Workspace {
            root: d.path().canonicalize().unwrap(),
            db: d.path().join("index"),
        };
        let source = "{\n  \"id\":9007199254740993,\n  \"name\":\"配置\"\n}";
        std::fs::write(ws.root.join("a.json"), source).unwrap();
        let mut r = result("/id = 9007199254740993");
        r.path = "a.json".into();
        r.hash = files::hash(source);
        r.evidence = true;
        r.start_line = 2;
        r.end_line = 2;
        let expanded = answer_context(&ws, &[r], 2400, true);
        assert_eq!(expanded[0].text, source);
        assert!(source_versions_current(&ws, &expanded));
        std::fs::write(ws.root.join("a.json"), "{}").unwrap();
        assert!(!source_versions_current(&ws, &expanded));
        let mut stale = expanded;
        assert_eq!(retain_current_sources(&ws, &mut stale), 1);
        assert!(stale.is_empty());
    }
    #[test]
    fn rerank_score_threshold_and_input_mapping_control_evidence() {
        let mut results = vec![result("低分"), result("高分")];
        for r in &mut results {
            r.evidence = true;
        }
        results[1].id = 2;
        apply_rerank(&mut results, &[(1, 0.9), (0, 0.1)], 0.5);
        assert_eq!(results[0].text, "高分");
        assert!(results[0].evidence);
        assert!(!results[1].evidence);
    }
    #[test]
    fn reranker_cannot_promote_an_unsupported_candidate_even_at_maximum_relevance() {
        let mut known = result("条件充分的已准入证据");
        known.evidence = true;
        known.id = 1;
        let mut unknown = result("只与主题相关，所问属性未记载");
        unknown.id = 2;
        let mut hits = vec![known, unknown];
        apply_rerank(&mut hits, &[(1, 1.0), (0, 0.8)], 0.5);
        assert_eq!(hits[0].id, 2);
        assert!(!hits[0].evidence);
        assert!(hits[1].evidence);
        finish_ranking(&mut hits);
        assert_eq!(hits[0].id, 1);
    }
    #[test]
    fn context_reassembles_parent_and_rejects_changed_files() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let source =
            "# 数据\n\n~~~json\n{\n  \"big\":9007199254740993,\n  \"name\":\"砚台\"\n}\n~~~\n";
        std::fs::write(root.join("a.md"), source).unwrap();
        let ws = Workspace {
            root: root.clone(),
            db: root.join("index"),
        };
        let mut a = result("9007199254740993");
        a.hash = files::hash(source);
        a.start_line = 5;
        a.end_line = 5;
        a.evidence = true;
        let mut b = a.clone();
        b.id = 2;
        b.start_line = 6;
        b.end_line = 6;
        let found = answer_context(&ws, &[a.clone(), b], 2400, false);
        assert_eq!(found.len(), 1);
        assert!(found[0].text.contains("9007199254740993"));
        assert!(found[0].text.contains("砚台"));
        assert_eq!(found[0].start_line, 3);
        std::fs::write(root.join("a.md"), "已变更").unwrap();
        assert!(answer_context(&ws, &[a], 2400, false).is_empty());
    }
    #[test]
    fn approved_table_evidence_keeps_title_units_and_missing_values_inside_section_and_budget() {
        let temp = tempfile::tempdir().unwrap();
        let ws = Workspace {
            root: temp.path().canonicalize().unwrap(),
            db: temp.path().join("index"),
        };
        let source="# 北岭库存\n\n## 年度台账\n\n指标：库存；单位：箱。缺测不是零。\n\n| 月份 | 2028年 | 2029年 |\n| --- | ---: | ---: |\n| 一月 | 12 | 15 |\n| 二月 | 缺测 | 18 |\n\n## 其他业务\n\n另一项指标不能混入本表。";
        std::fs::write(ws.root.join("a.md"), source).unwrap();
        let mut seed = result("指标：库存；单位：箱。缺测不是零。");
        seed.hash = files::hash(source);
        seed.start_line = 5;
        seed.end_line = 5;
        seed.evidence = true;
        let expanded = answer_context(&ws, &[seed.clone()], 600, false);
        assert_eq!(expanded.len(), 1);
        assert!(expanded[0].text.starts_with("## 年度台账"));
        assert!(expanded[0].text.contains("单位：箱"));
        assert!(expanded[0].text.contains("二月 | 缺测 | 18"));
        assert!(!expanded[0].text.contains("其他业务"));
        assert!(expanded[0].text.chars().count() <= 600);
        let small = answer_context(&ws, &[seed.clone()], 40, false);
        assert_eq!(small[0].text, seed.text);
        assert_eq!(small[0].start_line, 5);
        seed.evidence = false;
        assert!(answer_context(&ws, &[seed.clone()], 600, false).is_empty());
        seed.evidence = true;
        std::fs::write(ws.root.join("a.md"), "已经修改").unwrap();
        assert!(answer_context(&ws, &[seed], 600, false).is_empty());
    }
    #[test]
    fn table_expansion_never_reaches_into_fenced_examples_or_another_heading() {
        let source = [
            "## 单位说明",
            "单位：吨。",
            "",
            "```markdown",
            "| 类别 | 值 |",
            "| --- | --- |",
            "| 例子 | 999 |",
            "```",
            "",
            "## 真正数据",
            "| 类别 | 值 |",
            "| --- | --- |",
            "| 另一节 | 888 |",
        ];
        assert_eq!(parent_range(&source, 1, 1, 2400), (1, 1));
    }
}

/// Every failure in the semantic path, including credentials and vector SQL, is recoverable independently of BM25.
pub async fn semantic_fallback<F>(
    attempt: F,
    cancel: &std::sync::atomic::AtomicBool,
) -> Result<(Vec<db::RankedHit>, bool, Option<String>), String>
where
    F: std::future::Future<Output = Result<Vec<db::RankedHit>, String>>,
{
    use std::sync::atomic::Ordering;
    if cancel.load(Ordering::SeqCst) {
        return Err("操作已取消".into());
    }
    let result = tokio::select! {
        value=attempt=>value,
        _=crate::providers::wait_cancel(cancel)=>return Err("操作已取消".into()),
    };
    if cancel.load(Ordering::SeqCst) {
        return Err("操作已取消".into());
    }
    match result {
        Ok(hits) => Ok((hits, true, None)),
        Err(e) => Ok((
            vec![],
            false,
            Some(format!("语义检索未完成，已回退关键词：{e}")),
        )),
    }
}
#[cfg(test)]
mod fallback_tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    #[tokio::test]
    async fn credentials_embedding_and_vector_failures_all_preserve_local_fallback() {
        for reason in ["钥匙串读取未完成", "模型维度不一致", "向量索引查询失败"]
        {
            let (hits, used, warning) =
                semantic_fallback(async { Err(reason.into()) }, &AtomicBool::new(false))
                    .await
                    .unwrap();
            assert!(hits.is_empty());
            assert!(!used);
            assert!(warning.unwrap().contains("已回退关键词"));
        }
    }
    #[tokio::test]
    async fn cancellation_never_turns_into_a_successful_fallback() {
        let cancel = AtomicBool::new(false);
        let stop = async {
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
            cancel.store(true, Ordering::SeqCst);
        };
        let pending = semantic_fallback(
            std::future::pending::<Result<Vec<db::RankedHit>, String>>(),
            &cancel,
        );
        let (_, result) = tokio::join!(stop, pending);
        assert!(result.unwrap_err().contains("取消"));
    }
}
