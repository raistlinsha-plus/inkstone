//! Deterministic referents for follow-ups. Old questions/answers cannot supply attributes.
use super::*;
use crate::{
    db,
    models::{FileEntry, SearchResult},
};
use std::collections::HashSet;

#[derive(Clone, Debug)]
pub struct PriorSource {
    pub path: String,
    pub document_id: Option<String>,
    pub hash: String,
}
#[derive(Clone, Debug)]
pub struct FollowupGate {
    pub sources: Vec<PriorSource>,
    pub attributes: Vec<String>,
    pub clock: Option<&'static str>,
    pub clock_day: Option<(u8, u8)>,
}
#[derive(Clone, Debug)]
pub struct Prepared {
    pub retrieval_question: String,
    pub gate: Option<FollowupGate>,
    pub clarification: Option<String>,
}
pub fn is_followup(question: &str, has_parent: bool) -> bool {
    let q = question.trim_start();
    let pointer = [
        "它",
        "这",
        "那个",
        "那份",
        "那些",
        "那种",
        "那两",
        "那它",
        "那这",
        "那哪个",
        "那么",
        "哪个",
        "其中",
        "上面",
        "前面",
    ]
    .iter()
    .any(|p| q.starts_with(p));
    let continuation = ["分别", "再问", "再比较", "再列", "再给", "再解释", "再看"]
        .iter()
        .any(|p| q.starts_with(p));
    pointer || (has_parent && (continuation || followup_clock(q, None).is_some()))
}

/// Resolve a bounded, explicit service-time paraphrase without treating an
/// arbitrary question starting in "那" or a changed date as a continuation.
pub(crate) fn followup_clock(question: &str, previous: Option<&str>) -> Option<&'static str> {
    let question = question.trim().trim_end_matches(['？', '?', '。']);
    [
        ("最后一班", "末班"),
        ("末班", "末班"),
        ("第一班", "首班"),
        ("首班", "首班"),
    ]
    .into_iter()
    .find_map(|(label, canonical)| {
        let rest = question
            .strip_prefix('那')?
            .trim_start()
            .strip_prefix(label)?;
        let detail = rest.trim();
        let asks_time = matches!(
            detail,
            "几点" | "几点发车" | "什么时候发车" | "什么时间发车" | "的发车时间"
        );
        let continues_time = matches!(detail, "" | "呢")
            && previous.is_some_and(|question| {
                ["几点", "发车时间", "什么时候发车", "什么时间发车"]
                    .iter()
                    .any(|part| question.contains(part))
            });
        (asks_time || continues_time).then_some(canonical)
    })
}

pub(crate) fn supports_clock(body: &str, canonical: &str) -> bool {
    let labels = if canonical == "末班" {
        ["末班", "最后一班"]
    } else {
        ["首班", "第一班"]
    };
    body.split(['\n', '。', '；', ';', '，', ',', '！', '？'])
        .any(|clause| {
            let Some(after) = labels
                .iter()
                .find_map(|label| clause.split_once(label).map(|(_, rest)| rest))
            else {
                return false;
            };
            if after.contains("未公布") || after.contains("取消") {
                return false;
            }
            // Require a real clock time after the requested service marker in
            // this clause. A departure time from the preceding clause is irrelevant.
            after.match_indices([':', '：', '时']).any(|(at, mark)| {
                let prefix = after[..at].trim_end();
                let hour = prefix.bytes().rev().take_while(u8::is_ascii_digit).count();
                let suffix = after[at + mark.len()..].trim_start();
                let mins = suffix.bytes().take_while(u8::is_ascii_digit).count();
                (1..=2).contains(&hour)
                    && (1..=2).contains(&mins)
                    && (mark != "时" || suffix[mins..].starts_with('分'))
                    && prefix[prefix.len() - hour..]
                        .parse::<u8>()
                        .is_ok_and(|h| h <= 23)
                    && suffix[..mins].parse::<u8>().is_ok_and(|m| m < 60)
            })
        })
}

pub(crate) fn prior_clock_day(started: &Started) -> Option<(u8, u8)> {
    started
        .previous_questions
        .last()
        .and_then(|q| crate::evidence::single_month_day(q))
}
pub fn prior_sources(
    c: &Connection,
    conversation: &str,
    parent: Option<&str>,
) -> Result<Vec<PriorSource>, String> {
    let Some(parent) = parent else {
        return Ok(vec![]);
    };
    owned_turn(c, conversation, parent)?;
    let raw:Option<String>=c.query_row("SELECT c.response FROM turns t JOIN candidates c ON c.id=t.selected_candidate_id AND c.turn_id=t.id WHERE t.id=? AND c.status='complete'",[parent],|r|r.get(0)).optional().map_err(err)?.flatten();
    let Some(raw) = raw else { return Ok(vec![]) };
    let response: Value = serde_json::from_str(&raw).map_err(err)?;
    let mut out = vec![];
    if let Some(sources) = response["sources"].as_array() {
        for source in sources {
            let (Some(path), Some(hash)) = (source["path"].as_str(), source["hash"].as_str())
            else {
                continue;
            };
            files::validate_relative(path)?;
            let document_id = source["documentId"].as_str().map(str::to_string);
            if !out
                .iter()
                .any(|s: &PriorSource| s.path == path && s.document_id == document_id)
            {
                out.push(PriorSource {
                    path: path.into(),
                    document_id,
                    hash: hash.into(),
                });
            }
        }
    }
    Ok(out)
}
fn attributes(question: &str) -> Vec<String> {
    let mut current = crate::retrieval::knowledge_query(question);
    for referential in [
        "它们的",
        "它的",
        "它们",
        "它",
        "这两个",
        "这两种",
        "这两份",
        "这两篇",
        "这些",
        "这个",
        "那个",
        "那些",
        "两者",
        "其中",
        "上面的",
        "前面的",
        "那么",
        "哪一个",
        "哪个",
        "分别",
        "再",
        "并引用来源",
        "引用来源",
        "列出",
        "比较",
        "对比",
        "更高",
        "更低",
        "更大",
        "更小",
        "相比",
    ] {
        current = current.replace(referential, " ");
    }
    db::query_terms(&current)
        .into_iter()
        .filter(|s| s.chars().count() > 1 || s.chars().any(|c| c.is_ascii_digit()))
        .collect()
}
pub fn prepare(data: &Path, ws: &Workspace, started: &Started) -> Result<Prepared, String> {
    let Some(referents) = &started.followup_sources else {
        return Ok(Prepared {
            retrieval_question: started.grounded_question.clone(),
            gate: None,
            clarification: None,
        });
    };
    // On a new conversation there is no previous source to resolve. A fixed
    // single-document range or an explicitly named current document is enough
    // to run ordinary retrieval, whose evidence checks remain unchanged.
    if referents.is_empty() {
        let q = started.grounded_question.trim_start();
        let local_pointer = ["这份", "这篇", "这个文档", "此文档", "当前文档"]
            .iter()
            .any(|p| q.starts_with(p));
        let tree = if let Some(project) = library::project_at_root(data, &ws.root) {
            library::flat_tree(data, &project)?
        } else {
            files::list_tree(&ws.root)?
        };
        fn named(entries: &[FileEntry], q: &str, scope: Option<&str>) -> bool {
            entries.iter().any(|e| {
                if e.directory {
                    return named(&e.children, q, scope);
                }
                let stem = Path::new(&e.name)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("");
                scope.is_none_or(|s| s == e.path) && stem.chars().count() >= 2 && q.contains(stem)
            })
        }
        if (local_pointer && started.scope.is_some()) || named(&tree, q, started.scope.as_deref()) {
            return Ok(Prepared {
                retrieval_question: [
                    "这份文档",
                    "这篇文档",
                    "这个文档",
                    "当前文档",
                    "此文档",
                    "这份资料",
                    "这篇资料",
                    "这份",
                    "这篇",
                ]
                .iter()
                .find_map(|p| q.strip_prefix(p))
                .unwrap_or(q)
                .trim_start_matches('的')
                .trim()
                .to_string(),
                gate: None,
                clarification: None,
            });
        }
    }
    let clock = followup_clock(
        &started.grounded_question,
        started.previous_questions.last().map(String::as_str),
    );
    let terms = clock.map_or_else(
        || attributes(&started.grounded_question),
        |canonical| vec![canonical.into()],
    );
    let clarify = |message: &str| {
        Ok(Prepared {
            retrieval_question: started.grounded_question.clone(),
            gate: None,
            clarification: Some(message.into()),
        })
    };
    if referents.is_empty() || referents.len() > 4 || terms.is_empty() {
        return clarify("请明确要继续核对的文档和指标；上一轮问题或回答不能替代本轮资料依据。");
    }
    let managed = library::project_at_root(data, &ws.root);
    let mut sources = vec![];
    let mut names = vec![];
    for prior in referents {
        let (path, name) = if let Some(space) = &managed {
            let Some(id) = &prior.document_id else {
                return clarify("此前引用的文档身份不可核对，请明确文档后重新提问。");
            };
            let Ok(doc) = library::get(data, id) else {
                return clarify("此前引用的资料已移除，请明确当前文档后重新提问。");
            };
            if &doc.project_id != space || doc.status != "ready" {
                return clarify("此前引用的资料不属于当前可用范围，请重新选择文档。");
            }
            (doc.path, doc.title)
        } else {
            if prior.document_id.is_some() {
                return clarify("资料空间身份已变化，请重新指定文档。");
            }
            (
                prior.path.clone(),
                Path::new(&prior.path)
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned(),
            )
        };
        if started.scope.as_ref().is_some_and(|scope| scope != &path) {
            return clarify("此前引用已不在本会话的冻结资料范围，请新建会话。");
        }
        let content =
            files::resolve(&ws.root, &path, false).and_then(|path| files::read_text(&path));
        if content.as_ref().ok().map(files::hash).as_deref() != Some(prior.hash.as_str()) {
            return clarify("此前引用的资料已变化，请明确文档重新提问以核对最新内容。");
        }
        names.push(
            Path::new(&name)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or(&name)
                .to_string(),
        );
        sources.push(PriorSource {
            path,
            document_id: prior.document_id.clone(),
            hash: prior.hash.clone(),
        });
    }
    // Names assist recall only. Strict attributes below are solely the CURRENT question.
    let operator = if names.len() > 1 { "比较" } else { "在" };
    Ok(Prepared {
        retrieval_question: format!("{operator} {} {}", names.join("与"), terms.join(" ")),
        gate: Some(FollowupGate {
            sources,
            attributes: terms,
            clock,
            clock_day: clock.and_then(|_| prior_clock_day(started)),
        }),
        clarification: None,
    })
}
pub fn tighten(gate: &FollowupGate, results: &mut [SearchResult]) {
    for result in results {
        let identity = gate.sources.iter().any(|s| {
            s.path == result.path && s.document_id == result.document_id && s.hash == result.hash
        });
        let tokens = db::tokenize(&format!("{} {}", result.heading, result.text))
            .split_whitespace()
            .map(str::to_owned)
            .collect::<HashSet<_>>();
        let relevant = match gate.clock {
            Some(canonical) => {
                supports_clock(&result.text, canonical)
                    && gate.clock_day.is_none_or(|day| {
                        [&result.heading, &result.text]
                            .iter()
                            .any(|text| crate::evidence::month_days(text).any(|seen| seen == day))
                    })
            }
            None => {
                !gate.attributes.is_empty()
                    && gate.attributes.iter().all(|term| tokens.contains(term))
            }
        };
        result.evidence &= identity && relevant;
        if !result.evidence {
            result.match_kind = "candidate".into();
        }
    }
}

#[cfg(test)]
#[path = "assistant_grounding_tests.rs"]
mod tests;
