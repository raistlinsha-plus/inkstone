//! Space-local, versioned Wiki. The answer pipeline only receives checked original text.
mod compile;
#[cfg(test)]
mod eval;
mod store;

use crate::{
    answer_validation::{audit_wiki_summary, SummaryIssue},
    db, files, library,
    models::{SearchResult, Workspace},
    workspace, AppState,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    path::Path,
};
use tauri::State;

pub(crate) use compile::schedule;
pub(crate) use store::{purge_document, upgrade_legacy, validate_snapshot};

const MAX_SOURCES: usize = 100;
const MAX_SECTIONS: usize = 12;
const MAX_REFS: usize = 48;

fn error(e: impl std::fmt::Display) -> String {
    format!("Wiki：{e}")
}

fn managed(data: &Path, ws: &Workspace) -> Result<String, String> {
    library::project_at_root(data, &ws.root).ok_or_else(|| "Wiki 仅适用于受管理的文档空间".into())
}

fn active(state: &AppState) -> Result<(Workspace, String), String> {
    let ws = workspace(state)?;
    let space = managed(&state.data_dir, &ws)?;
    Ok((ws, space))
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
struct Policy {
    revision: i64,
    enabled: bool,
    paused: bool,
    automatic: bool,
    topic: String,
    document_ids: Vec<String>,
    provider_fingerprint: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PolicyInput {
    expected_revision: i64,
    enabled: bool,
    paused: bool,
    automatic: bool,
    topic: String,
    document_ids: Vec<String>,
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Original {
    document_id: String,
    title: String,
    path: String,
    start_line: usize,
    end_line: usize,
    quote: String,
    hash: String,
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct Section {
    heading: String,
    refs: Vec<Original>,
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
struct InputVersion {
    document_id: String,
    title: String,
    path: String,
    hash: String,
}

impl From<&Original> for InputVersion {
    fn from(source: &Original) -> Self {
        Self {
            document_id: source.document_id.clone(),
            title: source.title.clone(),
            path: source.path.clone(),
            hash: source.hash.clone(),
        }
    }
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct Content {
    title: String,
    summary: String,
    aliases: Vec<String>,
    related: Vec<String>,
    sections: Vec<Section>,
    #[serde(default)]
    inputs: Vec<InputVersion>,
}

impl Content {
    fn originals(&self) -> impl Iterator<Item = &Original> {
        self.sections.iter().flat_map(|section| &section.refs)
    }

    fn summary(&self) -> String {
        if self.summary.is_empty() {
            self.originals().next().map_or_else(String::new, |source| {
                source.quote.chars().take(150).collect()
            })
        } else {
            self.summary.clone()
        }
    }

    fn summary_issues(&self) -> Vec<SummaryIssue> {
        audit_wiki_summary(
            &self.summary,
            self.originals().map(|source| source.quote.as_str()),
        )
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PageSummary {
    id: String,
    title: String,
    summary: String,
    revision: i64,
    source_count: usize,
    stale: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Page {
    #[serde(flatten)]
    summary: PageSummary,
    body: String,
    refs: Vec<Original>,
    related: Vec<RelatedPage>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    summary_issues: Vec<SummaryIssue>,
}

#[derive(Serialize)]
struct RelatedPage {
    id: String,
    title: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChangeSummary {
    id: String,
    page_id: String,
    title: String,
    status: String,
    reason: String,
    created: i64,
    source_count: usize,
    can_restore: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    summary_issues: Vec<SummaryIssue>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    restore_summary_issues: Vec<SummaryIssue>,
}

#[derive(Serialize)]
struct Job {
    status: String,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Status {
    policy: Policy,
    pages: Vec<PageSummary>,
    changes: Vec<ChangeSummary>,
    job: Job,
    coverage: Vec<SourceCoverage>,
    current_pending_count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SourceCoverage {
    document_id: String,
    title: String,
    status: &'static str,
}

fn read_document(
    data: &Path,
    ws: &Workspace,
    space: &str,
    id: &str,
) -> Result<(library::Document, String), String> {
    let document = library::get(data, id)?;
    if document.project_id != space || document.status != "ready" {
        return Err("来源已移除或不属于当前文档空间".into());
    }
    let content = files::read_text(&files::resolve(&ws.root, &document.path, false)?)?;
    Ok((document, content))
}

type SourceVersions = HashMap<String, Option<InputVersion>>;

fn current_version<'a>(
    data: &Path,
    ws: &Workspace,
    space: &str,
    policy: &Policy,
    id: &str,
    hashes: &'a mut SourceVersions,
) -> Option<&'a InputVersion> {
    if !policy.document_ids.iter().any(|source| source == id) {
        return None;
    }
    hashes
        .entry(id.to_owned())
        .or_insert_with(|| {
            read_document(data, ws, space, id)
                .ok()
                .map(|(doc, text)| InputVersion {
                    document_id: doc.id,
                    title: doc.title,
                    path: doc.path,
                    hash: files::hash(text),
                })
        })
        .as_ref()
}

fn source_current(
    data: &Path,
    ws: &Workspace,
    space: &str,
    policy: &Policy,
    source: &Original,
    hashes: &mut SourceVersions,
) -> bool {
    current_version(data, ws, space, policy, &source.document_id, hashes).is_some_and(|version| {
        version.title == source.title && version.path == source.path && version.hash == source.hash
    })
}

fn inputs_current(
    data: &Path,
    ws: &Workspace,
    space: &str,
    policy: &Policy,
    content: &Content,
    hashes: &mut SourceVersions,
) -> bool {
    !content.inputs.is_empty()
        && content.inputs.iter().all(|expected| {
            current_version(data, ws, space, policy, &expected.document_id, hashes)
                == Some(expected)
        })
}

fn verified_original(
    data: &Path,
    ws: &Workspace,
    space: &str,
    policy: &Policy,
    source: &Original,
) -> bool {
    if !policy.document_ids.contains(&source.document_id)
        || source.start_line == 0
        || source.end_line < source.start_line
        || source.end_line - source.start_line >= 12
    {
        return false;
    }
    let Ok((doc, text)) = read_document(data, ws, space, &source.document_id) else {
        return false;
    };
    if doc.path != source.path || doc.title != source.title || files::hash(&text) != source.hash {
        return false;
    }
    let length = source.end_line - source.start_line + 1;
    let lines = text
        .lines()
        .skip(source.start_line - 1)
        .take(length)
        .collect::<Vec<_>>();
    lines.len() == length && lines.join("\n") == source.quote
}

fn describe(
    id: String,
    revision: i64,
    content: &Content,
    data: &Path,
    ws: &Workspace,
    space: &str,
    policy: &Policy,
    hashes: &mut SourceVersions,
) -> PageSummary {
    let stale = !inputs_current(data, ws, space, policy, content, hashes);
    PageSummary {
        id,
        title: content.title.clone(),
        summary: if stale {
            String::new()
        } else {
            content.summary()
        },
        revision,
        source_count: content
            .originals()
            .filter(|r| !stale || source_current(data, ws, space, policy, r, hashes))
            .map(|r| &r.document_id)
            .collect::<HashSet<_>>()
            .len(),
        stale,
    }
}

fn status(data: &Path, ws: &Workspace, space: &str) -> Result<Status, String> {
    let idle = || Job {
        status: "idle".into(),
        message: String::new(),
    };
    if !store::exists(data)? {
        return Ok(Status {
            policy: Policy::default(),
            pages: vec![],
            changes: vec![],
            job: idle(),
            coverage: vec![],
            current_pending_count: 0,
        });
    }
    let db = store::read(data)?;
    let policy = store::policy(&db, space)?;
    let mut hashes = HashMap::new();
    let coverage = policy
        .document_ids
        .iter()
        .map(|id| {
            let (title, status) = match read_document(data, ws, space, id) {
                Ok((doc, text)) if text.trim().is_empty() => (doc.title, "empty"),
                Ok((doc, text)) => {
                    let hash = files::hash(text);
                    let fingerprint = compile::source_fingerprint(&policy, &doc.title, &hash);
                    let title = doc.title.clone();
                    hashes.insert(
                        id.clone(),
                        Some(InputVersion {
                            document_id: doc.id,
                            title: doc.title,
                            path: doc.path,
                            hash,
                        }),
                    );
                    (title, store::coverage(&db, space, id, &fingerprint)?.0)
                }
                Err(_) => {
                    hashes.insert(id.clone(), None);
                    (String::new(), "unavailable")
                }
            };
            Ok(SourceCoverage {
                document_id: id.clone(),
                title,
                status,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let pages = store::pages(&db, space)?
        .into_iter()
        .map(|(id, revision, page)| {
            let mut view = describe(id, revision, &page, data, ws, space, &policy, &mut hashes);
            if !page.summary_issues().is_empty() {
                view.summary.clear();
            }
            view
        })
        .collect();
    let changes = store::changes(&db, space)?
        .into_iter()
        .map(|change| {
            let can_restore = change.base > 0 && change.result > 0;
            let restore_summary_issues = if can_restore {
                store::revision(&db, space, &change.page_id, change.base)
                    .ok()
                    .map_or_else(Vec::new, |historical| historical.summary_issues())
            } else {
                Vec::new()
            };
            let summary_issues = change.content.summary_issues();
            ChangeSummary {
                id: change.id,
                page_id: change.page_id,
                title: change.content.title.clone(),
                status: change.status,
                reason: change.reason,
                created: change.created,
                source_count: change
                    .content
                    .originals()
                    .map(|r| &r.document_id)
                    .collect::<HashSet<_>>()
                    .len(),
                can_restore,
                summary_issues,
                restore_summary_issues,
            }
        })
        .collect();
    let job = if compile::running(data, space) {
        Job {
            status: "running".into(),
            message: "正在整理已授权的资料".into(),
        }
    } else {
        db.query_row(
            "SELECT status,message FROM jobs WHERE space=?",
            [space],
            |row| {
                Ok(Job {
                    status: row.get(0)?,
                    message: row.get(1)?,
                })
            },
        )
        .optional()
        .map_err(error)?
        .unwrap_or_else(idle)
    };
    Ok(Status {
        policy,
        pages,
        changes,
        job,
        coverage,
        current_pending_count: store::pending_count(&db, space)?,
    })
}

#[tauri::command]
pub(crate) async fn wiki_compile(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    retry_change_id: Option<String>,
) -> Result<Status, String> {
    if let Some(id) = retry_change_id {
        let (_, space) = active(&state)?;
        let _permit = crate::maintenance::mutation(&state.data_dir)?;
        let mut db = store::write(&state.data_dir)?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(error)?;
        let policy = store::policy(&tx, &space)?;
        let change = store::change(&tx, &space, &id)?;
        if change.status != "rejected" || !policy.enabled || policy.paused {
            return Err("只能在启用 Wiki 时重新整理已拒绝的改动".into());
        }
        allow_change_retry(&tx, &space, &policy, &change)?;
        tx.commit().map_err(error)?;
    }
    compile::invoke(&app, &state).await
}

#[tauri::command]
pub(crate) fn wiki_cancel(state: State<'_, AppState>) -> Result<(), String> {
    let (_, space) = active(&state)?;
    compile::cancel(&state.data_dir, &space);
    Ok(())
}

#[tauri::command]
pub(crate) fn wiki_status(state: State<'_, AppState>) -> Result<Status, String> {
    let (ws, space) = active(&state)?;
    let mut view = status(&state.data_dir, &ws, &space)?;
    let chat = crate::settings(&state)?.chat;
    if view.policy.enabled
        && !view.policy.paused
        && view.job.status != "running"
        && (!chat.enabled
            || view.policy.provider_fingerprint != crate::providers::fingerprint(&chat))
    {
        view.job = Job {
            status: "error".into(),
            message: "问答模型已变化，请重新确认 Wiki 授权".into(),
        };
    }
    Ok(view)
}

#[tauri::command]
pub(crate) fn wiki_set_policy(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: PolicyInput,
) -> Result<Status, String> {
    let (ws, space) = active(&state)?;
    let mut ids = input.document_ids;
    ids.sort();
    ids.dedup();
    let topic = input.topic.trim();
    if ids.len() > MAX_SOURCES
        || topic.chars().count() > 120
        || topic.chars().any(char::is_control)
        || (input.enabled && (ids.is_empty() || topic.is_empty()))
    {
        return Err("启用 Wiki 需填写 1–120 字主题并选择 1–100 篇文档".into());
    }
    // Removed sources can remain visible while pausing, but cannot be newly authorized.
    let _permit = crate::maintenance::mutation(&state.data_dir)?;
    let mut db = store::write(&state.data_dir)?;
    let tx = db
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(error)?;
    let previous = store::policy(&tx, &space)?;
    if previous.revision != input.expected_revision {
        return Err("Wiki 设置已变化，请刷新后重试".into());
    }
    for id in &ids {
        if !previous.document_ids.contains(id) {
            let doc = library::get(&state.data_dir, id)?;
            if doc.project_id != space || doc.status != "ready" {
                return Err("只能授权本空间内可用的资料".into());
            }
        }
    }
    let chat = crate::settings(&state)?.chat;
    let fingerprint = crate::providers::fingerprint(&chat);
    if input.enabled && !input.paused && !chat.enabled {
        return Err("请先启用问答模型，再授权 Wiki 整理".into());
    }
    let policy = Policy {
        revision: previous
            .revision
            .checked_add(1)
            .ok_or("Wiki 授权版本号超过上限")?,
        enabled: input.enabled,
        paused: input.paused,
        automatic: input.automatic,
        topic: topic.into(),
        document_ids: ids,
        provider_fingerprint: fingerprint,
    };
    let removed = previous
        .document_ids
        .iter()
        .filter(|id| !policy.document_ids.contains(id))
        .map(String::as_str)
        .collect::<Vec<_>>();
    store::purge_derived(&tx, &space, &removed)?;
    store::save_policy(&tx, &space, &policy)?;
    tx.commit().map_err(error)?;
    drop(_permit);
    compile::cancel(&state.data_dir, &space);
    if policy.enabled && policy.automatic && !policy.paused {
        schedule(app);
    }
    status(&state.data_dir, &ws, &space)
}

#[derive(Deserialize)]
pub(crate) struct ReviewInput {
    id: String,
    action: String,
}

#[tauri::command]
pub(crate) fn wiki_review(
    state: State<'_, AppState>,
    input: ReviewInput,
) -> Result<Status, String> {
    let (ws, space) = active(&state)?;
    let _permit = crate::maintenance::mutation(&state.data_dir)?;
    let mut db = store::write(&state.data_dir)?;
    let tx = db
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(error)?;
    apply_review(&tx, &state.data_dir, &ws, &space, &input.id, &input.action)?;
    tx.commit().map_err(error)?;
    status(&state.data_dir, &ws, &space)
}

fn apply_review(
    db: &Connection,
    data: &Path,
    ws: &Workspace,
    space: &str,
    id: &str,
    action: &str,
) -> Result<(), String> {
    let policy = store::policy(db, space)?;
    let change = store::change(db, space, id)?;
    match action {
        "reject" if change.status == "pending" => reject_change(db, space, &policy, &change),
        "publish" if change.status == "pending" => {
            publish_checked(db, data, ws, space, &policy, &change)
        }
        "publish-excerpts" if change.status == "pending" => {
            let content =
                excerpts_only(data, ws, space, &policy, &change.page_id, &change.content)?;
            let replacement = store::Change {
                id: uuid::Uuid::new_v4().to_string(),
                policy_revision: policy.revision,
                reason: "仅发布已核验的原文摘录".into(),
                content,
                ..change
            };
            store::supersede(db, space, id)?;
            store::save_change(db, space, &replacement)?;
            publish_checked(db, data, ws, space, &policy, &replacement)
        }
        "restore" | "restore-excerpts"
            if policy.enabled && !policy.paused && change.base > 0 && change.result > 0 =>
        {
            let historical = store::revision(db, space, &change.page_id, change.base)?;
            let current = store::current_revision(db, space, &change.page_id)?;
            if current == 0 || current == change.base {
                return Err("没有可恢复的新旧版本差异".into());
            }
            let (content, reason) = if action == "restore-excerpts" {
                (
                    excerpts_only(data, ws, space, &policy, &change.page_id, &historical)?,
                    format!("仅恢复历史版本 {} 的已核验原文摘录", change.base),
                )
            } else {
                (historical, format!("恢复历史版本 {}", change.base))
            };
            let replacement = store::Change {
                id: uuid::Uuid::new_v4().to_string(),
                page_id: change.page_id,
                base: current,
                result: 0,
                policy_revision: policy.revision,
                status: "pending".into(),
                reason,
                created: store::now(),
                content,
            };
            store::save_change(db, space, &replacement)?;
            publish_checked(db, data, ws, space, &policy, &replacement)
        }
        _ => Err("当前改动状态不支持这项操作".into()),
    }
}

fn excerpts_only(
    data: &Path,
    ws: &Workspace,
    space: &str,
    policy: &Policy,
    page_id: &str,
    content: &Content,
) -> Result<Content, String> {
    let refs = content
        .originals()
        .filter(|source| verified_original(data, ws, space, policy, source))
        .cloned()
        .collect::<Vec<_>>();
    let source = refs.first().ok_or("没有仍可核验的原文，请重新整理")?;
    let source_title = source.title.chars().take(80).collect::<String>();
    let page_key = files::hash(page_id);
    let mut seen = HashSet::new();
    let inputs = refs
        .iter()
        .map(InputVersion::from)
        .filter(|input| seen.insert(input.clone()))
        .collect();
    Ok(Content {
        title: format!("原文摘录 · {source_title} · {}", &page_key[..12]),
        summary: String::new(),
        aliases: vec![],
        related: vec![],
        sections: vec![Section {
            heading: "已核验原文".into(),
            refs,
        }],
        inputs,
    })
}

fn reject_change(
    db: &Connection,
    space: &str,
    policy: &Policy,
    change: &store::Change,
) -> Result<(), String> {
    store::reject(db, space, &change.id)?;
    allow_change_retry(db, space, policy, change)?;
    let pending = store::pending_count(db, space)?;
    store::record_job(
        db,
        space,
        "ready",
        &format!("已拒绝这项改动，待审阅 {pending} 项。可手动重新整理。"),
    )
}

fn allow_change_retry(
    db: &Connection,
    space: &str,
    policy: &Policy,
    change: &store::Change,
) -> Result<(), String> {
    for source in change.content.originals() {
        if policy.document_ids.contains(&source.document_id) {
            let fingerprint = compile::source_fingerprint(policy, &source.title, &source.hash);
            store::allow_manual_retry(db, space, &source.document_id, &fingerprint)?;
        }
    }
    Ok(())
}

fn publish_checked(
    db: &Connection,
    data: &Path,
    ws: &Workspace,
    space: &str,
    policy: &Policy,
    change: &store::Change,
) -> Result<(), String> {
    if !policy.enabled || policy.paused {
        return Err("Wiki 已暂停或授权发生变化".into());
    }
    if change.base != store::current_revision(db, space, &change.page_id)? {
        return Err("页面已有更新，请重新整理后再发布".into());
    }
    if !inputs_current(
        data,
        ws,
        space,
        policy,
        &change.content,
        &mut HashMap::new(),
    ) || change
        .content
        .originals()
        .any(|r| !verified_original(data, ws, space, policy, r))
    {
        return Err("原文已变化、不可用或不在 Wiki 授权范围，当前改动未发布".into());
    }
    if !change.content.summary_issues().is_empty() {
        return Err(
            "Wiki 摘要含缺少引文或与引文冲突的结论。请重新整理，或仅发布已核验的原文摘录。".into(),
        );
    }
    store::publish(db, space, change)
}

fn markdown_text(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        if matches!(
            c,
            '\\' | '<' | '>' | '[' | ']' | '*' | '_' | '`' | '!' | '#' | '|'
        ) {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

#[tauri::command]
pub(crate) fn wiki_read(
    state: State<'_, AppState>,
    page_id: String,
    change_id: Option<String>,
) -> Result<Page, String> {
    let (ws, space) = active(&state)?;
    let db = store::read(&state.data_dir)?;
    let policy = store::policy(&db, &space)?;
    let (revision, content) = if let Some(change_id) = change_id.as_deref() {
        let change = store::change(&db, &space, change_id)?;
        if change.page_id != page_id {
            return Err("改动与页面不匹配".into());
        }
        (change.result.max(change.base), change.content)
    } else {
        let revision = store::current_revision(&db, &space, &page_id)?;
        (revision, store::revision(&db, &space, &page_id, revision)?)
    };
    let mut hashes = HashMap::new();
    let mut summary = describe(
        page_id,
        revision,
        &content,
        &state.data_dir,
        &ws,
        &space,
        &policy,
        &mut hashes,
    );
    let summary_issues = content.summary_issues();
    let hide_summary = change_id.is_none() && !summary_issues.is_empty();
    if hide_summary {
        summary.summary.clear();
    }
    let mut body = format!(
        "# {}\n\n{}\n",
        markdown_text(&content.title),
        if summary.stale || hide_summary {
            String::new()
        } else {
            markdown_text(&content.summary)
        }
    );
    let mut refs = Vec::new();
    for section in &content.sections {
        let sources = section
            .refs
            .iter()
            .filter(|source| {
                source_current(&state.data_dir, &ws, &space, &policy, source, &mut hashes)
            })
            .collect::<Vec<_>>();
        if sources.is_empty() {
            continue;
        }
        if !summary.stale {
            body.push_str(&format!("\n## {}\n", markdown_text(&section.heading)));
        } else if refs.is_empty() {
            body.push_str("\n## 仍可核对的原文\n");
        }
        for source in sources {
            refs.push(source.clone());
            body.push_str(&format!(
                "\n**{} · {}–{} 行**\n\n",
                markdown_text(&source.title),
                source.start_line,
                source.end_line
            ));
            for line in source.quote.lines() {
                body.push_str(&format!("> {}\n", markdown_text(line)));
            }
        }
    }
    if !summary.stale && !content.related.is_empty() {
        body.push_str(&format!(
            "\n## 相关主题\n\n{}\n",
            markdown_text(&content.related.join(" · "))
        ));
    }
    let mut related = Vec::new();
    if !summary.stale {
        for title in &content.related {
            if let Some((id, _)) = store::find(&db, &space, &store::title_key(title))? {
                if id != summary.id {
                    related.push(RelatedPage {
                        id,
                        title: title.clone(),
                    });
                }
            }
        }
    }
    Ok(Page {
        summary,
        body,
        refs,
        related,
        summary_issues,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SourceRequest {
    page_id: String,
    revision: i64,
    change_id: Option<String>,
    document_id: String,
    start_line: usize,
    end_line: usize,
    hash: String,
}

fn displayed_original(
    db: &Connection,
    space: &str,
    input: &SourceRequest,
) -> Result<Original, String> {
    let page = if let Some(change_id) = &input.change_id {
        let change = store::change(db, space, change_id)?;
        if change.page_id != input.page_id || change.result.max(change.base) != input.revision {
            return Err("改动版本已变化，请重新打开后核对原文".into());
        }
        change.content
    } else {
        store::revision(db, space, &input.page_id, input.revision)?
    };
    let source = page
        .originals()
        .find(|source| {
            source.document_id == input.document_id
                && source.start_line == input.start_line
                && source.end_line == input.end_line
                && source.hash == input.hash
        })
        .cloned()
        .ok_or("该版本的原文定位不存在，请重新打开后核对")?;
    Ok(source)
}

#[tauri::command]
pub(crate) fn wiki_source(
    state: State<'_, AppState>,
    input: SourceRequest,
) -> Result<Original, String> {
    let (ws, space) = active(&state)?;
    let db = store::read(&state.data_dir)?;
    let policy = store::policy(&db, &space)?;
    let source = displayed_original(&db, &space, &input)?;
    if !verified_original(&state.data_dir, &ws, &space, &policy, &source) {
        return Err("原文已变化、已移除或不在当前 Wiki 授权范围".into());
    }
    Ok(source)
}

fn relevant(terms: &[String], field: &str) -> usize {
    let words = db::tokenize(field);
    let words = words.split_whitespace().collect::<HashSet<_>>();
    terms
        .iter()
        .filter(|term| words.contains(term.as_str()))
        .count()
}

pub(crate) fn recall(
    data: &Path,
    ws: &Workspace,
    query: &str,
    scope: Option<&str>,
) -> Result<Vec<SearchResult>, String> {
    let Some(space) = library::project_at_root(data, &ws.root) else {
        return Ok(vec![]);
    };
    if !store::exists(data)? {
        return Ok(vec![]);
    }
    let db = store::read(data)?;
    let policy = store::policy(&db, &space)?;
    if !policy.enabled {
        return Ok(vec![]);
    }
    let terms = db::query_terms(query);
    if terms.is_empty() {
        return Ok(vec![]);
    }
    let lookup = terms
        .iter()
        .take(16)
        .map(|term| format!("\"{}\"", term.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" OR ");
    let mut stmt = db.prepare("SELECT page FROM page_search WHERE space=? AND page_search MATCH ? ORDER BY bm25(page_search),page LIMIT 8").map_err(error)?;
    let ids = stmt
        .query_map(params![space, lookup], |row| row.get::<_, String>(0))
        .map_err(error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(error)?;
    let mut sections = Vec::new();
    let mut hashes = HashMap::new();
    let mut alias_pages = 0;
    for (rank, id) in ids.into_iter().enumerate() {
        let rev = store::current_revision(&db, &space, &id)?;
        let page = store::revision(&db, &space, &id, rev)?;
        if !inputs_current(data, ws, &space, &policy, &page, &mut hashes) {
            continue;
        }
        if !page.summary_issues().is_empty()
            && std::iter::once(page.title.as_str())
                .chain(page.aliases.iter().map(String::as_str))
                .chain(page.sections.iter().map(|section| section.heading.as_str()))
                .chain(page.originals().map(|source| source.quote.as_str()))
                .all(|text| relevant(&terms, text) == 0)
        {
            // Previously published summaries remain in history. Their unsupported
            // prose cannot be the only reason to retrieve the current page.
            continue;
        }
        let relation = crate::evidence::wiki_alias::requested(query, &page.aliases);
        alias_pages += usize::from(relation.is_some());
        let alias = relation.and_then(|(relation, alias)| {
            crate::evidence::wiki_alias::eligible_section(
                relation,
                page.sections
                    .iter()
                    .map(|section| section.refs.iter().map(|source| source.quote.as_str())),
            )
            .map(|index| (index, relation, alias.to_owned()))
        });
        for (index, mut section) in page.sections.into_iter().enumerate() {
            section.refs.retain(|r| {
                scope.is_none_or(|path| path == r.path)
                    && source_current(data, ws, &space, &policy, r, &mut hashes)
            });
            if section.refs.is_empty() {
                continue;
            }
            let score = 3 * relevant(&terms, &section.heading)
                + section
                    .refs
                    .iter()
                    .map(|r| relevant(&terms, &r.quote))
                    .max()
                    .unwrap_or(0);
            let relation = alias
                .as_ref()
                .filter(|(selected, _, _)| *selected == index)
                .map(|(_, relation, alias)| (*relation, alias.clone()));
            sections.push((score, rank, relation, section));
        }
    }
    sections.sort_by_key(|(score, rank, _, _)| (std::cmp::Reverse(*score), *rank));
    let mut seen = HashSet::new();
    let mut results = Vec::new();
    for (_, rank, relation, section) in sections.into_iter().take(4) {
        for r in section.refs {
            if results.len() == 12 {
                return Ok(results);
            }
            if !seen.insert((
                r.document_id.clone(),
                r.start_line,
                r.end_line,
                r.hash.clone(),
            )) || !verified_original(data, ws, &space, &policy, &r)
            {
                continue;
            }
            let digest = files::hash(format!(
                "{}:{}:{}:{}",
                r.document_id, r.start_line, r.end_line, r.hash
            ));
            let id = -(i64::from_str_radix(&digest[..14], 16).unwrap_or(1).max(1));
            let anchored = alias_pages == 1
                && relation.as_ref().is_some_and(|(relation, alias)| {
                    crate::evidence::wiki_alias::supports_alias(*relation, alias, &r.quote)
                });
            results.push(SearchResult {
                id,
                path: r.path,
                text: r.quote,
                // Generated labels route recall but must not count as original evidence.
                heading: String::new(),
                start_line: r.start_line,
                end_line: r.end_line,
                hash: r.hash,
                score: 0.5 / (61 + rank) as f64,
                title: Some(r.title),
                document_id: Some(r.document_id),
                bm25_score: None,
                vector_distance: None,
                bm25_rank: None,
                vector_rank: None,
                rerank_score: None,
                evidence: false,
                match_kind: if anchored {
                    crate::evidence::wiki_alias::ANCHORED
                } else {
                    "wiki"
                }
                .into(),
            });
        }
    }
    Ok(results)
}
