//! Review unresolved questions against current, authorized originals. The reader returns
//! identifiers; source paths, versions, lines, and citation text stay application-owned.
use crate::{
    assistant::grounding::FollowupGate,
    evidence_reader::{self, Reading},
    files,
    models::{Provider, SearchResponse, SearchResult, Workspace},
    providers, retrieval, AppState,
};
use std::{collections::HashMap, sync::atomic::Ordering, time::Instant};

pub(crate) fn unresolved(question: &str, fast: &[SearchResult]) -> Vec<String> {
    let facets = evidence_reader::split_facets(question);
    // Whole-passage relevance cannot establish that every independently requested
    // value is present. Bind compound questions to exact quotes before generation.
    if fast.is_empty()
        || facets.len() > 1
        || evidence_reader::named_value::Naming::parse(question).is_some()
        || crate::assistant::grounding::weekday(question).is_some()
    {
        facets
    } else {
        Vec::new()
    }
}

/// An ordinary search may expand an approved excerpt to its parent paragraph.
/// Strict reranking and follow-ups approve only the retrieved line range.
pub(crate) fn fast_context(
    ws: &Workspace,
    found: &SearchResponse,
    budget: usize,
    scope: Option<&str>,
    gate: Option<&FollowupGate>,
) -> Vec<SearchResult> {
    if found.strict_reader_floor.is_none() && gate.is_none() {
        return retrieval::generation_context(ws, &found.results, budget, scope.is_some());
    }
    approved_ranges(ws, found, budget, scope, gate, false)
}

fn approved_ranges(
    ws: &Workspace,
    found: &SearchResponse,
    budget: usize,
    scope: Option<&str>,
    gate: Option<&FollowupGate>,
    include_scoped_clues: bool,
) -> Vec<SearchResult> {
    let mut sources = Vec::new();
    let mut originals = HashMap::new();
    let mut remaining = budget;
    for hit in found.results.iter().filter(|s| {
        s.evidence
            || (include_scoped_clues
                && scope.is_some()
                && found.strict_reader_floor.is_none()
                && s.match_kind == "scoped-related")
    }) {
        if scope.is_some_and(|p| p != hit.path)
            || found
                .strict_reader_floor
                .is_some_and(|f| hit.rerank_score.is_none_or(|score| score < f))
            || gate.is_some_and(|g| !crate::assistant::grounding::in_followup_range(g, hit))
        {
            continue;
        }
        let body = originals.entry(&hit.path).or_insert_with(|| {
            files::resolve(&ws.root, &hit.path, false)
                .and_then(|p| files::read_text(&p))
                .ok()
        });
        let Some(body) = body.as_ref().filter(|b| files::hash(b) == hit.hash) else {
            continue;
        };
        if hit.start_line == 0 || hit.end_line < hit.start_line {
            continue;
        }
        let lines = body.lines().collect::<Vec<_>>();
        let Some(lines) = lines.get(hit.start_line - 1..hit.end_line) else {
            continue;
        };
        let mut exact = hit.clone();
        exact.text = lines.join("\n");
        let cost = exact.text.chars().count() + 200;
        if cost > remaining {
            continue;
        }
        remaining -= cost;
        sources.push(exact);
        if sources.len() == 6 {
            break;
        }
    }
    sources
}

pub(crate) const RELATED_NOTE: &str = "相关原文，逐项核实不足。请逐项核对所附原文，只回答对象、条件和取值都得到原文支持的部分，为其引用来源；其余明确指出本轮片段不足以核实。";
pub(crate) const RELATED_STATUS: &str = "相关原文，逐项核实不足；已按普通资料问答处理";

pub(crate) fn related_originals(
    ws: &Workspace,
    found: &SearchResponse,
    budget: usize,
    scope: Option<&str>,
    gate: Option<&FollowupGate>,
    question: &str,
) -> Vec<SearchResult> {
    let question = retrieval::knowledge_query(question);
    if gate.is_some_and(|g| {
        g.named_subject.is_none()
            || evidence_reader::scoped_clause::Frame::parse(&question).is_none()
    }) {
        return vec![];
    }
    let mut sources = Vec::new();
    // Keep original approved indexes/ranges and the exact retrieved order.
    // Nothing in the reader's broader candidate pool can enter here.
    for hit in approved_ranges(ws, found, budget, scope, gate, true) {
        let lines = if gate.is_some() {
            evidence_reader::scoped_clause::Frame::parse(&question)
                .map_or_else(Vec::new, |frame| frame.related(&hit))
        } else {
            evidence_reader::compatible_original_lines(&question, &hit)
        };
        for part in lines {
            if sources.iter().any(|s: &SearchResult| {
                s.path == part.path
                    && s.start_line == part.start_line
                    && s.end_line == part.end_line
            }) {
                continue;
            }
            sources.push(part);
            if providers::chat_source_text(&sources).chars().count()
                + RELATED_NOTE.chars().count()
                + 1
                > budget
            {
                sources.pop();
            }
            if sources.len() == 6 {
                return sources;
            }
        }
    }
    sources
}

pub(crate) fn workspace_candidates(
    state: &AppState,
    ws: &Workspace,
    scope: Option<&str>,
    found: &SearchResponse,
    gate: Option<&FollowupGate>,
) -> Result<Vec<SearchResult>, String> {
    let catalogue = crate::managed_sources(&state.data_dir, ws)?;
    let mut passages = Vec::new();
    let mut originals = HashMap::new();
    // The public search list puts pre-approved evidence first. For unresolved
    // facets inspect candidates in retrieval order; admission is a separate step.
    let mut ranked = found.results.iter().collect::<Vec<_>>();
    ranked.sort_by(|a, b| {
        b.rerank_score
            .unwrap_or(-1.0)
            .total_cmp(&a.rerank_score.unwrap_or(-1.0))
            .then_with(|| b.score.total_cmp(&a.score))
            .then_with(|| a.id.cmp(&b.id))
    });
    for hit in ranked {
        if scope.is_some_and(|s| hit.path != s)
            || found
                .strict_reader_floor
                .is_some_and(|floor| hit.rerank_score.is_none_or(|s| s < floor))
        {
            continue;
        }
        if let Some(gate) = gate {
            if !crate::assistant::grounding::in_followup_range(gate, hit) {
                continue;
            }
        }
        match &catalogue {
            Some(docs)
                if !docs
                    .get(&hit.path)
                    .is_some_and(|(id, _)| hit.document_id.as_ref() == Some(id)) =>
            {
                return Err("资料已移除或不再属于当前空间，请重新提问".into())
            }
            None if hit.document_id.is_some() => return Err("资料归属已变化，请重新提问".into()),
            _ => (),
        }
        if !originals.contains_key(&hit.path) {
            let body = files::read_text(&files::resolve(&ws.root, &hit.path, false)?)?;
            if files::hash(&body) != hit.hash {
                return Err("资料版本已变化，请重新提问".into());
            }
            originals.insert(hit.path.clone(), body);
        }
        let body = &originals[&hit.path];
        let lines = body.lines().collect::<Vec<_>>();
        let Some(start) = hit.start_line.checked_sub(1) else {
            continue;
        };
        if hit.end_line <= start || hit.end_line > lines.len() {
            continue;
        }
        let mut passage = hit.clone();
        if scope.is_some() {
            passage.match_kind = "scoped-original".into();
        }
        let (from, to) = if gate.is_some() || found.strict_reader_floor.is_some() {
            (start, hit.end_line - 1)
        } else {
            retrieval::parent_range(&lines, start, hit.end_line - 1, 4000)
        };
        passage.start_line = from + 1;
        passage.end_line = to + 1;
        passage.text = lines[from..=to].join("\n");
        if passages.iter().any(|s: &SearchResult| {
            s.path == passage.path
                && s.start_line == passage.start_line
                && s.end_line == passage.end_line
        }) {
            continue;
        }
        passages.push(passage);
        if passages.len() == 8 {
            break;
        }
    }
    // A frozen, short single-document scope can be read even before its index is ready.
    // A direct read has no rerank score. A resolved weekday continuation must also
    // match its prior document identity and hash before the reader checks the new day.
    if let Some(path) = scope
        .filter(|_| found.strict_reader_floor.is_none() && gate.is_none_or(|g| g.recheck_weekday))
    {
        let doc = catalogue
            .as_ref()
            .map(|docs| docs.get(path).ok_or("所选文档已移除"))
            .transpose()?;
        let body = files::read_text(&files::resolve(&ws.root, path, false)?)?;
        if !body.trim().is_empty() && body.chars().count() <= 2800 {
            let mut hit = explicit_passage(
                path,
                doc.map_or(path, |(_, title)| title),
                &files::hash(&body),
                1,
                body.lines().count(),
                body.lines().collect::<Vec<_>>().join("\n"),
            );
            hit.document_id = doc.map(|(id, _)| id.clone());
            if gate.is_none_or(|g| crate::assistant::grounding::in_followup_range(g, &hit)) {
                passages.clear();
                passages.push(hit);
            }
        }
    }
    Ok(passages)
}

pub(crate) fn explicit_passage(
    id: &str,
    title: &str,
    hash: &str,
    start: usize,
    end: usize,
    text: String,
) -> SearchResult {
    SearchResult {
        id: 0,
        path: id.into(),
        text,
        heading: String::new(),
        start_line: start,
        end_line: end,
        hash: hash.into(),
        score: 0.0,
        title: Some(title.into()),
        document_id: None,
        bm25_score: None,
        vector_distance: None,
        bm25_rank: None,
        vector_rank: None,
        rerank_score: None,
        evidence: false,
        match_kind: "scoped-original".into(),
    }
}

#[derive(Clone, Copy, serde::Serialize)]
pub(crate) struct ReviewStats {
    pub calls: usize,
    pub chars: usize,
    pub passages: usize,
}

pub(crate) struct Review {
    pub stats: ReviewStats,
    pub reading: Reading,
    pub step: String,
    pub warning: Option<String>,
}

fn check(state: &AppState, current: &impl Fn() -> bool) -> Result<(), String> {
    if state.cancel_chat.load(Ordering::SeqCst) {
        return Err("已停止候选核对，已撤回本轮结果".into());
    }
    if !current() {
        return Err("候选原文、归属或空间已变化，请重新提问".into());
    }
    Ok(())
}

pub(crate) fn provider_allowed(state: &AppState, config: &Provider) -> Result<bool, String> {
    crate::settings(state).map(|s| {
        s.candidate_reading
            && s.chat.enabled
            && s.chat.base_url == config.base_url
            && s.chat.model == config.model
    })
}

pub(crate) async fn review(
    state: &AppState,
    config: &Provider,
    facets: &[String],
    passages: &[SearchResult],
    admitted: &[SearchResult],
    budget: usize,
    allow_model: bool,
    current: impl Fn() -> bool,
) -> Result<Review, String> {
    let started = Instant::now();
    check(state, &current)?;
    let mut limit = 4000.min(budget).min(
        config
            .context_chars
            .saturating_sub(evidence_reader::SYSTEM_PROMPT.chars().count()),
    );
    let dispatch_enabled = allow_model && provider_allowed(state, config)?;
    let (mut reading, payload) = loop {
        let mut reading = evidence_reader::prepare_facets(facets, passages, limit);
        reading.recover_fast(passages, admitted);
        let payload = reading.model_request();
        let size = evidence_reader::SYSTEM_PROMPT.chars().count()
            + payload.as_ref().map_or(0, |p| p.chars().count());
        if !dispatch_enabled || size <= config.context_chars || limit == 0 {
            break (reading, payload.filter(|_| size <= config.context_chars));
        }
        // Serialized IDs and table headers can outweigh the sentence text. A
        // proportional reduction retains a usable subset on small contexts.
        limit = (limit.saturating_mul(config.context_chars) / size).min(limit - 1);
    };
    let mut outcome = if payload.is_some() {
        "local-only"
    } else if reading.passage_count() == 0 {
        "no-passages"
    } else {
        "local"
    };
    let mut calls = 0;
    let mut warning = None;
    if let Some(payload) = payload {
        if dispatch_enabled && provider_allowed(state, config)? {
            let key = crate::read_key(state, "chat", &config.base_url, &state.cancel_chat).await;
            check(state, &current)?;
            if !provider_allowed(state, config)? {
                return Err("候选核对的传输设置已变化，请重新提问".into());
            }
            let result = match key {
                Ok(key) => {
                    calls = 1;
                    outcome = "provider";
                    crate::request_receipt::structured(
                        crate::request_receipt::Service::ReviewPassages,
                        providers::json_completion(
                            &state.client,
                            config,
                            key.as_deref(),
                            evidence_reader::SYSTEM_PROMPT,
                            &payload,
                            &state.cancel_chat,
                            1,
                        ),
                    )
                    .await
                }
                Err(reason) => Err(reason),
            };
            check(state, &current)?;
            if !provider_allowed(state, config)? {
                return Err("候选核对的传输设置已变化，已撤回本轮结果".into());
            }
            if result.and_then(|json| reading.apply_model(&json)).is_err() {
                outcome = "service-fallback";
                warning = Some(
                    "候选选句服务未能完成核对，仅保留本机已核实的项目。可检查问答服务后重试。"
                        .into(),
                );
            }
        }
    }
    check(state, &current)?;
    let supported = reading
        .facets()
        .iter()
        .filter(|f| !f.quotes.is_empty())
        .count();
    let step = format!(
        "候选选句 · {} 段，{} 原文字符，核实 {supported}/{} 项，额外请求 {calls} 次，{} ms",
        reading.passage_count(),
        reading.source_chars(),
        facets.len(),
        started.elapsed().as_millis()
    );
    eprintln!("inkstone candidate_reader passages={} chars={} facets={} supported={} attempts={} elapsed_ms={} outcome={outcome}",reading.passage_count(),reading.source_chars(),facets.len(),supported,calls,started.elapsed().as_millis());
    let stats = ReviewStats {
        calls,
        chars: reading.source_chars(),
        passages: reading.passage_count(),
    };
    Ok(Review {
        reading,
        step,
        warning,
        stats,
    })
}

pub(crate) fn verified_quote(
    passage: &SearchResult,
    quote: &evidence_reader::Quote,
) -> Result<SearchResult, String> {
    let start = quote
        .start_line
        .checked_sub(passage.start_line)
        .ok_or("引文起始行无效")?;
    let count = quote
        .end_line
        .checked_sub(quote.start_line)
        .ok_or("引文结束行无效")?
        + 1;
    if quote.end_line > passage.end_line
        || quote.text.trim().is_empty()
        || !passage
            .text
            .lines()
            .skip(start)
            .take(count)
            .collect::<Vec<_>>()
            .join("\n")
            .contains(&quote.text)
    {
        return Err("引文未在当前原文行内找到".into());
    }
    let mut source = passage.clone();
    source.start_line = quote.start_line;
    source.end_line = quote.end_line;
    source.text = quote.text.clone();
    source.evidence = true;
    source.match_kind = "selected-quote".into();
    Ok(source)
}

// The labels are the actual citation numbers after context budgeting.
pub(crate) fn facet_note(facet: &str, citations: &[usize]) -> String {
    let refs = citations
        .iter()
        .map(|i| format!("[{i}]"))
        .collect::<Vec<_>>()
        .join(" ");
    let guidance = if refs.is_empty() {
        "本轮本地片段不足以核实此项，请明确标出缺项。".into()
    } else {
        format!("只依据 {refs} 回答此项，紧随结论引用；若原句冲突，逐条并列。")
    };
    format!(
        "\n小问 {}：{guidance}",
        serde_json::to_string(facet).unwrap_or_default()
    )
}

/// Use citation numbers from the assembled prompt; context admission and final
/// source ordering must both be complete before binding arithmetic inputs.
pub(crate) fn add_calculation(
    question: &str,
    sources: &[(usize, &str)],
    prompt: &mut String,
    available: usize,
) {
    if let Some(note) = evidence_reader::calculation_note(question, sources) {
        if note.chars().count() + 1 <= available {
            prompt.push('\n');
            prompt.push_str(&note);
        }
    }
}

/// The binding survives context budgeting so the response can identify exactly
/// which requested items the transmitted originals did and did not support.
#[derive(Default)]
pub(crate) struct FacetCoverage(pub Vec<(String, Vec<usize>)>);

fn display_literal(text: &str) -> String {
    // Source or question text can itself contain Markdown links, citations and fences.
    if !text.contains(['[', ']', '<', '>', '\n', '`', '*', '|', '#', '_', '~', '\\']) {
        return text.to_string();
    }
    let ticks = text.split(|c| c != '`').map(str::len).max().unwrap_or(0);
    let fence = "`".repeat(ticks + 1);
    format!("{fence} {} {fence}", text.replace(['\n', '\r'], " "))
}

impl FacetCoverage {
    pub fn note_missing(&self, text: &mut String) {
        let missing = self
            .0
            .iter()
            .filter(|(_, ids)| ids.is_empty())
            .map(|(q, _)| display_literal(q.trim_end_matches(['？', '?'])))
            .collect::<Vec<_>>();
        if !missing.is_empty() {
            text.push_str("\n\n本轮本地片段不足以核实：");
            text.push_str(&missing.join("；"));
            text.push('。');
        }
    }

    pub fn partial_text(&self, source: impl Fn(usize) -> Option<String>) -> Option<String> {
        if !self.0.iter().any(|(_, ids)| ids.is_empty())
            || !self.0.iter().any(|(_, ids)| !ids.is_empty())
        {
            return None;
        }
        let mut rows = Vec::new();
        for (q, ids) in &self.0 {
            let label = display_literal(q.trim_end_matches(['？', '?']));
            let facts = ids
                .iter()
                .map(|&id| source(id).map(|s| format!("{} [{id}]", display_literal(&s))))
                .collect::<Option<Vec<_>>>()?;
            let result = if facts.is_empty() {
                "本轮本地片段不足以核实。".into()
            } else {
                facts.join(" ")
            };
            rows.push(format!("- {label}：{result}"));
        }
        Some(rows.join("\n"))
    }

    pub fn complete_text(&self, text: &mut String, source: impl Fn(usize) -> Option<String>) {
        if self.0.len() < 2 {
            return;
        }
        // Preserve the generator's requested presentation. If it omitted a verified
        // citation, give the exact original next to its application-owned number.
        let mut cited = crate::answer_validation::cited_numbers(text);
        for (question, ids) in &self.0 {
            let missing = ids
                .iter()
                .filter(|id| cited.insert(**id))
                .filter_map(|id| source(*id).map(|s| format!("{} [{id}]", display_literal(&s))))
                .collect::<Vec<_>>();
            if !missing.is_empty() {
                text.push_str(&format!(
                    "\n\n{}：{}",
                    display_literal(question.trim_end_matches(['？', '?'])),
                    missing.join(" ")
                ));
            }
        }
        self.note_missing(text);
    }
}

pub(crate) struct ScopedContext {
    pub coverage: FacetCoverage,
    pub stats: Option<ReviewStats>,
    pub sources: Vec<SearchResult>,
    pub guidance: String,
    pub step: Option<String>,
    pub warning: Option<String>,
}

pub(crate) async fn scoped_context(
    state: &AppState,
    ws: &Workspace,
    scope: Option<&str>,
    question: &str,
    found: &SearchResponse,
    gate: Option<&FollowupGate>,
    config: &Provider,
    budget: usize,
    has_web: bool,
    generation: u64,
    allow_model: bool,
    allow_related: bool,
) -> Result<ScopedContext, String> {
    let fast = crate::assistant_runtime::local_first(budget, has_web, |n| {
        fast_context(ws, found, n, scope, gate)
    });
    let current_question = retrieval::knowledge_query(question);
    let facets = if gate.is_some_and(|g| g.named_subject.is_some()) {
        evidence_reader::split_facets(&current_question)
    } else {
        unresolved(&current_question, &fast)
    };
    let mut context = ScopedContext {
        coverage: FacetCoverage::default(),
        sources: if facets.is_empty() { fast } else { vec![] },
        guidance: String::new(),
        step: None,
        warning: None,
        stats: None,
    };
    if facets.is_empty() {
        return Ok(context);
    }
    let same_workspace = || {
        state.workspace_generation.load(Ordering::SeqCst) == generation
            && crate::workspace(state).is_ok_and(|w| w.root == ws.root)
    };
    check(state, &same_workspace)?;
    let passages = workspace_candidates(state, ws, scope, found, gate)?;
    let review = review(
        state,
        config,
        &facets,
        &passages,
        &found.results,
        budget,
        allow_model,
        || same_workspace() && crate::sources_current(state, ws, &passages),
    )
    .await?;
    for facet in review.reading.facets() {
        let before = context.sources.len();
        let mut citations = Vec::new();
        for q in &facet.quotes {
            let quote = verified_quote(&passages[q.source_index], q)?;
            let i = if let Some(i) = context.sources.iter().position(|s| {
                s.path == quote.path
                    && s.hash == quote.hash
                    && s.start_line == quote.start_line
                    && s.text == quote.text
            }) {
                i
            } else {
                context.sources.push(quote);
                context.sources.len() - 1
            };
            citations.push(i + 1);
        }
        let mut note = facet_note(&facet.question, &citations);
        if providers::chat_source_text(&context.sources)
            .chars()
            .count()
            + context.guidance.chars().count()
            + note.chars().count()
            > budget
        {
            context.sources.truncate(before);
            citations.clear();
            note = facet_note(&facet.question, &[]);
        }
        if providers::chat_source_text(&context.sources)
            .chars()
            .count()
            + context.guidance.chars().count()
            + note.chars().count()
            <= budget
        {
            context.guidance.push_str(&note);
        }
        context.coverage.0.push((facet.question.clone(), citations));
    }
    let mut used_related = false;
    if allow_related && review.reading.facets().iter().all(|f| f.quotes.is_empty()) {
        let related = related_originals(ws, found, budget, scope, gate, question);
        if !related.is_empty() {
            check(state, &|| {
                same_workspace() && crate::sources_current(state, ws, &related)
            })?;
            context.sources = related;
            context.coverage.0.clear();
            context.guidance = format!("\n{RELATED_NOTE}");
            used_related = true;
        }
    }
    context.stats = Some(review.stats);
    context.step = Some(if used_related {
        format!("{} · {RELATED_STATUS}", review.step)
    } else {
        review.step
    });
    context.warning = if used_related {
        Some(
            review
                .warning
                .into_iter()
                .chain(std::iter::once(RELATED_STATUS.to_owned()))
                .collect::<Vec<_>>()
                .join("\n"),
        )
    } else {
        review.warning
    };
    Ok(context)
}

#[cfg(all(test, feature = "desktop-e2e"))]
#[path = "candidate_reading_tests.rs"]
mod tests;
