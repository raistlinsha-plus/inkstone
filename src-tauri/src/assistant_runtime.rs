//! Routing and evidence preparation shared by scoped and standalone answers.
use crate::{
    answer_validation, assistant,
    assistant_sources::{Evidence, ExternalSource, Trace, WebAccess},
    db, documents, files, library,
    models::{ChatResponse, ChatStatusEvent, Provider, SearchResult},
    providers, retrieval, web_retrieval, AppState,
};
use std::{collections::HashSet, sync::atomic::Ordering, time::Duration};
use tauri::Emitter;

const GENERAL_SYSTEM: &str = "你是砚台 AI 助手。按当前用户请求进行解释、写作、翻译、代码示例或对话。使用清晰的 Markdown。上轮回答仅作编辑与追问语境，不代表已核验事实。不要伪造引用、声称已经联网或执行操作。输出不要包含 HTML 和远程图片。";

#[derive(Default)]
pub struct WebTurn {
    pub evidence: Vec<Evidence>,
    pub expected: bool,
    pub warning: Option<String>,
    examined: Option<usize>,
}

pub fn progress(app: &tauri::AppHandle, request_id: &str, stage: &str, detail: &str) {
    let _ = app.emit(
        "chat-status",
        ChatStatusEvent {
            request_id: request_id.into(),
            stage: stage.into(),
            detail: detail.into(),
        },
    );
}

#[derive(Debug, PartialEq, Eq)]
enum WebRoute {
    Skip,
    Blocked,
    Plan { evidence_expected: bool },
}

// Quoted input is content to transform, not a search instruction. Keep an
// unmatched quote literal so it cannot hide the rest of a user's request.
fn request_text(question: &str) -> (String, bool) {
    let mut remaining = question;
    let mut request = String::new();
    let mut quoted = false;
    while let Some((at, open)) = remaining
        .char_indices()
        .find(|(_, c)| matches!(c, '“' | '‘' | '「' | '『' | '"' | '`'))
    {
        let close = match open {
            '“' => '”',
            '‘' => '’',
            '「' => '」',
            '『' => '』',
            _ => open,
        };
        let end = at + open.len_utf8();
        let tail = &remaining[end..];
        if let Some(close_at) = tail.find(close) {
            request.push_str(&remaining[..at]);
            request.push(' ');
            quoted |= !tail[..close_at].trim().is_empty();
            remaining = &tail[close_at + close.len_utf8()..];
        } else {
            request.push_str(&remaining[..end]);
            remaining = tail;
        }
    }
    request.push_str(remaining);
    (request.to_lowercase(), quoted)
}

fn web_route(question: &str, access: WebAccess) -> WebRoute {
    let (request, quoted) = request_text(question);
    let has = |terms: &[&str]| terms.iter().any(|term| request.contains(term));
    let textual_limit = web_retrieval::explicitly_offline(question);
    let explicit_lookup = has(&[
        "联网搜",
        "联网查",
        "上网查",
        "网上查",
        "搜索网页",
        "搜索互联网",
        "浏览网页",
        "帮我查",
        "search the web",
        "search online",
        "look up online",
        "browse the web",
    ]);
    let public_source = has(&[
        "官网",
        "官方网站",
        "公开报道",
        "官方公告",
        "官方文档",
        "official website",
        "official site",
        "official announcement",
    ]) || (!textual_limit && has(&["网页", "网站", "webpage", "website"]));
    let fresh = has(&[
        "最新",
        "刚刚",
        "今天",
        "今日",
        "实时",
        "latest",
        "today",
        "current price",
        "live price",
    ]);
    let current = fresh || has(&["当前", "目前", "明天", "current", "tomorrow"]);
    let verification = has(&[
        "核对",
        "核实",
        "查证",
        "查询",
        "verify",
        "fact-check",
        "look up",
    ]);
    let revision = has(&[
        "翻译",
        "改写",
        "润色",
        "重写",
        "校对",
        "总结",
        "概括",
        "提炼",
        "translate",
        "rewrite",
        "rephrase",
        "proofread",
        "summarize",
        "summarise",
        "paraphrase",
    ]);
    let writing = has(&["写一", "写封", "拟一", "draft a", "write a"]);
    let needs_source = revision && public_source && !quoted;
    if (revision || writing)
        && !explicit_lookup
        && !(verification && (current || public_source))
        && !needs_source
    {
        return WebRoute::Skip;
    }
    let evidence_expected = explicit_lookup
        || public_source
        || fresh
        || (current && verification)
        || (current
            && has(&[
                "天气",
                "气温",
                "新闻",
                "价格",
                "汇率",
                "开门",
                "营业",
                "weather",
                "news",
                "price",
                "opening hours",
            ]));
    if access == WebAccess::LocalOnly || textual_limit {
        if evidence_expected {
            WebRoute::Blocked
        } else {
            WebRoute::Skip
        }
    } else {
        WebRoute::Plan { evidence_expected }
    }
}

pub async fn web(
    app: &tauri::AppHandle,
    state: &AppState,
    config: &Provider,
    question: &str,
    request_id: &str,
    access: WebAccess,
) -> WebTurn {
    let expected = match web_route(question, access) {
        WebRoute::Skip => return WebTurn::default(),
        WebRoute::Blocked => {
            return WebTurn {
                expected: true,
                warning: Some("本轮按你的范围限制没有联网，公开信息未核验。".into()),
                ..Default::default()
            }
        }
        WebRoute::Plan { evidence_expected } => evidence_expected,
    };
    let unavailable = |reason: &str| WebTurn {
        expected,
        warning: expected.then(|| reason.to_string()),
        ..Default::default()
    };
    if !web_retrieval::is_enabled(state) {
        return unavailable("自动联网尚未配置或已关闭，公开时效资料未核验。");
    }
    progress(app, request_id, "planning", "正在判断本轮需要哪些来源");
    let cancel = &state.cancel_chat;
    let plan = async {
        let key = crate::read_key(state, "chat", &config.base_url, cancel).await?;
        providers::complete_json(&state.client, config, key.as_deref(),
            r#"只根据当前问题判断是否需要查询公开网页。最新公开事实、官网核对、外部对照需要查。写作、翻译、概念解释和内部材料问题通常不需要。用户限定仅用指定材料或不联网时返回 false。仅输出 JSON {"search":true,"query":"可公开查询的短语"} 或 {"search":false,"query":""}。查询词应取自用户当前问题，去除私人信息、路径和标识；无法提取安全的公开目标时返回 false。"#,
            &question.chars().take(1500).collect::<String>(), cancel).await
    };
    let plan = match tokio::time::timeout(Duration::from_secs(5), plan).await {
        Ok(Ok(value)) => value,
        _ => return unavailable("联网规划不可用，公开资料未核验。"),
    };
    if plan["search"].as_bool() != Some(true) {
        return unavailable("未找到适合本轮的公开查询，公开资料未核验。");
    }
    let query = match web_retrieval::safe_query(question, plan["query"].as_str().unwrap_or("")) {
        Ok(query) => query,
        Err(_) => {
            return WebTurn {
                expected: true,
                warning: Some("公开查询未通过范围校验，没有发送搜索词。".into()),
                ..Default::default()
            }
        }
    };
    progress(app, request_id, "web_search", "正在搜索网页并核对公开来源");
    match web_retrieval::search(state, query, cancel).await {
        Ok(result) => {
            let mut out = WebTurn {
                expected: true,
                examined: Some(result.searched),
                ..Default::default()
            };
            for item in result.evidence {
                let metadata = item.metadata;
                out.evidence.push(Evidence {
                    text: item.text,
                    metadata: ExternalSource {
                        id: files::hash(metadata.url.as_bytes()),
                        kind: "web".into(),
                        label: metadata
                            .title
                            .chars()
                            .filter(|c| !c.is_control())
                            .take(240)
                            .collect(),
                        citation: 0,
                        url: Some(metadata.url),
                        excerpt: None,
                        captured_at: Some(metadata.fetched_at),
                        published_at: metadata.published_at,
                        content_hash: Some(metadata.content_hash),
                        attachment_id: None,
                        project_id: None,
                        document_id: None,
                    },
                });
            }
            if out.evidence.is_empty() {
                out.warning = Some("未取得可引用的网页正文，搜索摘要未用作证据。".into());
            } else if result.discarded > 0 {
                out.warning = Some(format!(
                    "{} 条网页候选无法安全读取或已去重。",
                    result.discarded
                ));
            }
            out
        }
        _ => WebTurn {
            expected: true,
            warning: Some("联网搜索暂不可用，公开资料未核验。".into()),
            ..Default::default()
        },
    }
}

pub fn select_external(
    items: Vec<Evidence>,
    base: usize,
    remaining: usize,
    omitted: &mut Vec<String>,
) -> Vec<Evidence> {
    let mut remaining = remaining;
    let mut selected = Vec::new();
    for mut item in items {
        item.metadata.citation = base + selected.len() + 1;
        let cost = item.as_prompt().chars().count();
        if cost > remaining {
            if !omitted.contains(&item.metadata.label) {
                omitted.push(item.metadata.label.clone());
            }
            continue;
        }
        remaining -= cost;
        selected.push(item);
    }
    selected
}

fn snippets(question: &str, path: &str, content: &str) -> Vec<(String, usize, usize)> {
    if content.chars().count() <= 2800 {
        return vec![(content.to_string(), 1, content.lines().count())];
    }
    let terms = db::query_terms(question);
    let mut chunks = db::local_chunks(content, path, 1800);
    chunks.sort_by_key(|chunk| {
        std::cmp::Reverse(
            terms
                .iter()
                .filter(|t| {
                    chunk.heading.to_lowercase().contains(t.as_str())
                        || chunk.text.to_lowercase().contains(t.as_str())
                })
                .count(),
        )
    });
    chunks
        .into_iter()
        .take(2)
        .map(|c| (c.text, c.start_line, c.end_line))
        .collect()
}

fn local_item(
    kind: &str,
    id: &str,
    title: &str,
    project: Option<&str>,
    content: &str,
    part: (String, usize, usize),
) -> Evidence {
    let (text, start, end) = part;
    let excerpt = (kind == "document").then(|| text.chars().take(3000).collect());
    Evidence {
        metadata: ExternalSource {
            id: format!("{id}:{start}-{end}"),
            kind: kind.into(),
            label: format!("{title} · 第 {start}–{end} 行"),
            citation: 0,
            url: None,
            excerpt,
            captured_at: None,
            published_at: None,
            attachment_id: (kind == "attachment").then(|| id.into()),
            project_id: project.map(str::to_string),
            document_id: (kind == "document").then(|| id.into()),
            content_hash: Some(files::hash(content)),
        },
        text,
    }
}

fn document(
    data: &std::path::Path,
    project: &str,
    id: &str,
) -> Result<(library::Document, String), String> {
    let doc = library::get(data, id)?;
    if doc.project_id != project || doc.status != "ready" {
        return Err("所选文档不在当前授权空间或已移除".into());
    }
    let root = library::project_root(data, project)?;
    let content = files::read_text(&files::resolve(&root, &doc.path, false)?)?;
    Ok((doc, content))
}

fn current(data: &std::path::Path, conversation: &str, items: &[Evidence]) -> bool {
    items.iter().all(|e| {
        let m = &e.metadata;
        let text = match m.kind.as_str() {
            "attachment" => m
                .attachment_id
                .as_deref()
                .and_then(|id| assistant::attachments::read(data, conversation, id).ok())
                .map(|a| a.text),
            "document" => m
                .project_id
                .as_deref()
                .zip(m.document_id.as_deref())
                .and_then(|(project, id)| document(data, project, id).ok())
                .map(|(_, s)| s),
            _ => return true,
        };
        text.as_ref()
            .is_some_and(|text| m.content_hash.as_deref() == Some(files::hash(text).as_str()))
    })
}

pub fn web_trace(trace: &mut Trace, web: &WebTurn, has_local: bool) {
    if let Some(examined) = web.examined {
        trace
            .steps
            .push(format!("公开网页 · 检查 {examined} 条候选"));
    }
    trace.route = match (has_local, !web.evidence.is_empty()) {
        (true, true) => "mixed",
        (true, false) => "local",
        (false, true) => "web",
        (false, false) => {
            if web.expected {
                "web-unavailable"
            } else {
                "direct"
            }
        }
    }
    .into();
}

pub async fn general(
    app: &tauri::AppHandle,
    state: &AppState,
    started: &assistant::Started,
    request: &str,
    mode: &str,
    memory: &assistant::memory::Options,
) -> Result<ChatResponse, String> {
    let config = crate::settings(state)?.chat;
    if !config.enabled {
        return Err("请在模型设置中启用问答服务".into());
    }
    let selection = started.sources.as_ref().ok_or("本轮资料范围未保存")?;
    let question = started.grounded_question.as_str();
    let data = &state.data_dir;
    let project = selection.project_id.as_deref();
    let local_search = async {
        let mut items = Vec::new();
        let mut steps = Vec::new();
        let mut unread = Vec::new();
        let mut notices = Vec::new();
        let mut mode_used = "direct".to_string();
        let mut rank_used = "not-requested".to_string();
        let mut source_pool = Vec::<Vec<Evidence>>::new();
        for id in &selection.attachments {
            let a = assistant::attachments::read(data, &started.conversation_id, id)?;
            let parts = snippets(question, &a.title, &a.text);
            if a.text.chars().count() > 2800 {
                unread.push(format!("{} · 仅读取相关片段", a.title));
            }
            source_pool.push(
                parts
                    .into_iter()
                    .map(|part| local_item("attachment", id, &a.title, None, &a.text, part))
                    .collect(),
            );
        }
        if !selection.attachments.is_empty() {
            steps.push(format!("临时附件 · {} 份", selection.attachments.len()));
        }
        if let Some(project) = project {
            let ws = documents::library_workspace(data, project)?;
            if selection.document_ids.is_empty() {
                let found = crate::search_workspace(
                    state,
                    question,
                    None,
                    mode != "keyword",
                    Some(mode),
                    &state.cancel_chat,
                    Some((app, request)),
                    Some(ws.clone()),
                )
                .await?;
                mode_used = found.retrieval_mode.clone();
                rank_used = found.rerank_status.clone();
                if let Some(warning) = found.warning {
                    notices.push(warning);
                }
                let results = retrieval::generation_context(
                    &ws,
                    &found.results,
                    config.context_chars / 2,
                    false,
                );
                if results.iter().any(|r| r.match_kind.contains("wiki")) {
                    steps.push("Wiki · 按主题定位原文片段".into());
                }
                let total = crate::managed_sources(data, &ws)?.map_or(0, |entries| entries.len());
                let found_docs = results
                    .iter()
                    .filter_map(|r| r.document_id.as_ref())
                    .collect::<HashSet<_>>()
                    .len();
                steps.push(format!("空间原文 · 已取证 {found_docs} 篇"));
                if found_docs < total {
                    unread.push(format!(
                        "空间内另有 {} 篇未进入本轮证据",
                        total - found_docs
                    ));
                }
                for r in results {
                    if let Some(id) = r.document_id.as_deref() {
                        let (doc, content) = document(data, project, id)?;
                        if files::hash(&content) == r.hash {
                            items.push(local_item(
                                "document",
                                id,
                                &doc.title,
                                Some(project),
                                &content,
                                (r.text, r.start_line, r.end_line),
                            ));
                        }
                    }
                }
            } else {
                for id in &selection.document_ids {
                    let (doc, content) = document(data, project, id)?;
                    let parts = snippets(question, &doc.title, &content);
                    if content.chars().count() > 2800 {
                        unread.push(format!("{} · 仅读取相关片段", doc.title));
                    }
                    source_pool.push(
                        parts
                            .into_iter()
                            .map(|part| {
                                local_item(
                                    "document",
                                    id,
                                    &doc.title,
                                    Some(project),
                                    &content,
                                    part,
                                )
                            })
                            .collect(),
                    );
                }
                steps.push(format!(
                    "直接查阅 · {} 篇文档",
                    selection.document_ids.len()
                ));
            }
        }
        // Make the first excerpt of every selected input compete before second excerpts.
        let mut second = Vec::new();
        for group in source_pool {
            for (index, item) in group.into_iter().enumerate() {
                if index == 0 {
                    items.push(item);
                } else {
                    second.push(item);
                }
            }
        }
        items.extend(second);
        Ok::<_, String>((items, steps, unread, notices, mode_used, rank_used))
    };
    // Check explicit files and attachment ownership before starting the web
    // planner. Whole-space retrieval can still run concurrently afterwards.
    let (local, mut web) = tokio::try_join!(biased; local_search, async {
        Ok::<_, String>(web(app, state, &config, question, request, started.web_access).await)
    })?;
    let (mut evidence, steps, unread, mut notices, local_mode, rank_used) = local;
    let mut trace = Trace {
        steps,
        unread,
        ..Default::default()
    };
    web_trace(&mut trace, &web, !evidence.is_empty());
    if let Some(warning) = web.warning {
        notices.push(warning);
    }
    let grounded = !selection.is_empty() || web.expected;
    let system = if grounded {
        providers::ANSWER_SYSTEM
    } else {
        GENERAL_SYSTEM
    };
    let mut prompt = if grounded {
        started.prompt_question.clone()
    } else {
        let original = serde_json::to_string(question).unwrap_or_default();
        let prior = started
            .previous_answer
            .as_deref()
            .map(|answer| serde_json::to_string(answer).unwrap_or_default())
            .unwrap_or_default();
        let previous = serde_json::to_string(
            &started
                .previous_questions
                .iter()
                .rev()
                .take(3)
                .map(|q| q.chars().take(350).collect::<String>())
                .collect::<Vec<_>>(),
        )
        .unwrap_or_default();
        format!("前几轮问题（由近到远，仅供对话）：{previous}\n上轮回答摘录（仅供编辑与追问）：{prior}\n当前问题：{original}")
    };
    let budget = config
        .context_chars
        .saturating_sub(system.chars().count() + prompt.chars().count() + 300);
    let external = if !evidence.is_empty() && !web.evidence.is_empty() {
        let mut local = select_external(evidence, 0, budget * 2 / 3, &mut trace.unread);
        let remaining =
            budget.saturating_sub(local.iter().map(|e| e.as_prompt().chars().count()).sum());
        let public = select_external(
            std::mem::take(&mut web.evidence),
            local.len(),
            remaining,
            &mut trace.unread,
        );
        local.extend(public);
        local
    } else {
        evidence.append(&mut web.evidence);
        select_external(evidence, 0, budget, &mut trace.unread)
    };
    let has_local = external.iter().any(|e| e.metadata.kind != "web");
    let has_web = external.iter().any(|e| e.metadata.kind == "web");
    trace.route = match (has_local, has_web) {
        (true, true) => "mixed",
        (true, false) => "local",
        (false, true) => "web",
        (false, false) if grounded => "no-evidence",
        _ => "direct",
    }
    .into();
    let unavailable = (grounded && external.is_empty()) || (!selection.is_empty() && !has_local);
    if unavailable {
        notices.push("所选范围未找到足够证据。请检查资料、索引或联网设置。".into());
        return Ok(response(
            "no_evidence",
            "未能从本轮指定资料核实请求。".into(),
            "",
            vec![],
            trace,
            notices,
            None,
            &local_mode,
            &rank_used,
        ));
    }
    if web.expected && !has_web {
        prompt.push_str("\n公开资料未核验，只回答本轮已有原文支持的部分，明确指出缺少的外部证据。");
    }
    let context = external.iter().map(Evidence::as_prompt).collect::<String>();
    let remaining = config.context_chars.saturating_sub(
        system.chars().count() + prompt.chars().count() + context.chars().count() + 120,
    );
    let (preferences, usage) =
        assistant::memory::compose(data, assistant::GENERAL_OWNER, None, memory, remaining);
    prompt.push_str(&preferences);
    let user = format!("资料开始\n{context}\n资料结束\n\n问题：{prompt}");
    let key = crate::read_key(state, "chat", &config.base_url, &state.cancel_chat).await?;
    if !current(data, &started.conversation_id, &external) {
        return Err("所选文档或附件已变化，请重新提问".into());
    }
    if state.cancel_chat.load(Ordering::SeqCst) {
        return Err("已停止生成".into());
    }
    progress(app, request, "generating", "正在生成回答");
    let output = providers::stream_chat(
        &state.client,
        &config,
        key.as_deref(),
        system,
        &user,
        &state.cancel_chat,
        Some(app),
        request,
    )
    .await?;
    if !current(data, &started.conversation_id, &external) {
        return Ok(response(
            "source_changed",
            "所选资料已变化，已撤回本轮结果。".into(),
            "",
            vec![],
            trace,
            vec![],
            None,
            &local_mode,
            &rank_used,
        ));
    }
    let mut answer = response(
        &output.finish_reason,
        output.text,
        &config.model,
        external,
        trace,
        notices,
        Some(usage),
        &local_mode,
        &rank_used,
    );
    if state.cancel_chat.load(Ordering::SeqCst) {
        answer.finish_reason = "cancelled".into();
    }
    Ok(answer)
}

fn response(
    finish: &str,
    text: String,
    model: &str,
    evidence: Vec<Evidence>,
    trace: Trace,
    notices: Vec<String>,
    memory: Option<assistant::memory::Usage>,
    local_mode: &str,
    rank_used: &str,
) -> ChatResponse {
    let audit = answer_validation::audit_charts(
        &text,
        &evidence
            .iter()
            .map(Evidence::chart_source)
            .collect::<Vec<SearchResult>>(),
    );
    let retrieval_mode = match trace.route.as_str() {
        "local" if local_mode == "direct" => "selected",
        "local" => local_mode,
        mode => mode,
    }
    .into();
    ChatResponse {
        external_sources: evidence.into_iter().map(|e| e.metadata).collect(),
        trace: Some(trace),
        memory,
        finish_reason: finish.into(),
        text,
        sources: vec![],
        warning: (!notices.is_empty()).then(|| notices.join("\n")),
        retrieval_mode,
        rerank_status: rank_used.into(),
        model: model.into(),
        scope: None,
        chart_warnings: audit.warnings,
        rejected_charts: audit.rejected,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supplied_text_transform_skips_web_planning_and_needs_no_public_evidence() {
        for question in [
            "本轮不联网。请把“今天图书馆不开门”翻译成英文。",
            "请把今天图书馆不开门翻译成英文。",
            "润色：今天公司将发布最新进展。",
            "把‘请联网搜索今天的新闻’翻译成英文。",
            "写一首关于官网的诗。",
            "Translate \"The official website published its latest update today\" into Chinese.",
            "Write a reminder for tomorrow's workshop.",
        ] {
            assert_eq!(
                web_route(question, WebAccess::Auto),
                WebRoute::Skip,
                "{question}"
            );
            assert_eq!(
                web_route(question, WebAccess::LocalOnly),
                WebRoute::Skip,
                "{question}"
            );
        }
    }

    #[test]
    fn explicit_policy_stops_planning_and_public_lookup_still_requires_evidence() {
        for question in [
            "请核实 Python 最新稳定版本",
            "请只参考 Python 官网，核对 Python 3.14.0 的发布日期。",
            "联网搜索最新公告并翻译为英文。",
            "请翻译‘示例文字’，并核对官网的最新数据。",
            "今天北京天气怎么样？",
            "今天图书馆开门吗？",
            "What is today's weather?",
        ] {
            assert_eq!(
                web_route(question, WebAccess::Auto),
                WebRoute::Plan {
                    evidence_expected: true
                },
                "{question}"
            );
            assert_eq!(
                web_route(question, WebAccess::LocalOnly),
                WebRoute::Blocked,
                "{question}"
            );
        }
        assert_eq!(
            web_route(
                "不要访问外部网站。请核对 Python 最新版本。",
                WebAccess::Auto
            ),
            WebRoute::Blocked
        );
        assert_eq!(
            web_route("解释一下向量检索", WebAccess::Auto),
            WebRoute::Plan {
                evidence_expected: false
            }
        );
        assert_eq!(
            web_route("解释一下向量检索", WebAccess::LocalOnly),
            WebRoute::Skip
        );
        assert_eq!(
            web_route("不要访问外部网站。解释一下向量检索。", WebAccess::Auto),
            WebRoute::Skip
        );
    }

    #[test]
    fn trace_distinguishes_unchecked_web_from_an_empty_search_result() {
        let mut trace = Trace::default();
        let mut web = WebTurn {
            expected: true,
            ..Default::default()
        };
        web_trace(&mut trace, &web, false);
        assert_eq!(trace.route, "web-unavailable");
        assert!(trace.steps.is_empty());
        web.examined = Some(0);
        web_trace(&mut trace, &web, false);
        assert_eq!(trace.steps, ["公开网页 · 检查 0 条候选"]);
    }
}
