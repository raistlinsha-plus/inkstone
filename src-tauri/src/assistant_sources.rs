use crate::{files, models::SearchResult};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum WebAccess {
    #[default]
    Auto,
    LocalOnly,
}

impl WebAccess {
    pub(super) fn stored(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::LocalOnly => "local-only",
        }
    }

    pub(super) fn from_stored(value: &str) -> Result<Self, String> {
        match value {
            "auto" => Ok(Self::Auto),
            "local-only" => Ok(Self::LocalOnly),
            _ => Err("会话联网权限无效".into()),
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct Selection {
    pub project_id: Option<String>,
    pub document_ids: Vec<String>,
    pub attachments: Vec<String>,
}

impl Selection {
    pub fn validate(&self) -> Result<(), String> {
        let valid = |id: &str| uuid::Uuid::parse_str(id).is_ok();
        if self.document_ids.len() > 5
            || self.attachments.len() > 5
            || (!self.document_ids.is_empty() && self.project_id.is_none())
            || self
                .project_id
                .as_deref()
                .is_some_and(|id| id != "inbox" && !valid(id))
            || self
                .document_ids
                .iter()
                .chain(&self.attachments)
                .any(|id| !valid(id))
            || self
                .document_ids
                .iter()
                .enumerate()
                .any(|(index, id)| self.document_ids[..index].contains(id))
        {
            return Err("每轮仅可选一个空间、至多五篇文档和五份会话附件".into());
        }
        Ok(())
    }

    pub fn is_empty(&self) -> bool {
        self.project_id.is_none() && self.attachments.is_empty()
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalSource {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub citation: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub excerpt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub captured_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub published_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attachment_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_hash: Option<String>,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Trace {
    pub route: String,
    pub steps: Vec<String>,
    pub unread: Vec<String>,
}

pub struct Evidence {
    pub metadata: ExternalSource,
    pub text: String,
}

impl Evidence {
    pub fn as_prompt(&self) -> String {
        let e = &self.metadata;
        let title = serde_json::to_string(&e.label).unwrap_or_default();
        let date = e.published_at.as_deref().unwrap_or("未知");
        format!(
            "\n正文引用：[{}]；结构化来源ID：S{}；类型：{}；标题：{}；发布日期：{}\n{}\n",
            e.citation, e.citation, e.kind, title, date, self.text
        )
    }

    pub fn chart_source(&self) -> SearchResult {
        let e = &self.metadata;
        SearchResult {
            id: e.citation as i64,
            path: String::new(),
            text: self.text.clone(),
            heading: String::new(),
            start_line: 1,
            end_line: self.text.lines().count(),
            hash: files::hash(&self.text),
            score: 1.0,
            title: Some(e.label.clone()),
            document_id: None,
            bm25_score: None,
            vector_distance: None,
            bm25_rank: None,
            vector_rank: None,
            rerank_score: None,
            evidence: true,
            match_kind: e.kind.clone(),
        }
    }
}

pub fn validate_metadata(sources: &serde_json::Value, base: usize) -> Result<(), String> {
    let sources = sources.as_array().ok_or("外部引用快照格式无效")?;
    if sources.len() > 32 {
        return Err("外部引用过多".into());
    }
    for (i, raw) in sources.iter().enumerate() {
        let value: ExternalSource =
            serde_json::from_value(raw.clone()).map_err(|_| "外部引用快照格式无效")?;
        let bounded = |s: &str, max| !s.trim().is_empty() && s.chars().count() <= max;
        let uid = |v: Option<&str>| v.is_some_and(|id| uuid::Uuid::parse_str(id).is_ok());
        let valid = match value.kind.as_str() {
            "web" => {
                value
                    .url
                    .as_deref()
                    .is_some_and(crate::web_retrieval::valid_source_url)
                    && value.excerpt.is_none()
            }
            "attachment" => uid(value.attachment_id.as_deref()) && value.url.is_none(),
            "document" => {
                uid(value.document_id.as_deref())
                    && (value.project_id.as_deref() == Some("inbox")
                        || uid(value.project_id.as_deref()))
                    && value.url.is_none()
            }
            _ => false,
        };
        if !valid
            || !bounded(&value.id, 128)
            || !bounded(&value.label, 256)
            || value.citation != base + i + 1
            || value
                .excerpt
                .as_deref()
                .is_some_and(|text| text.chars().count() > 3200)
            || value
                .captured_at
                .as_deref()
                .is_some_and(|text| !bounded(text, 80))
            || value
                .published_at
                .as_deref()
                .is_some_and(|text| !bounded(text, 80))
        {
            return Err("外部引用范围或编号无效".into());
        }
    }
    Ok(())
}

pub fn validate_trace(value: &serde_json::Value) -> Result<(), String> {
    let trace: Trace = serde_json::from_value(value.clone()).map_err(|_| "查阅轨迹格式无效")?;
    if ![
        "direct",
        "local",
        "mixed",
        "web",
        "no-evidence",
        "web-unavailable",
    ]
    .contains(&trace.route.as_str())
        || trace.steps.len() > 24
        || trace.unread.len() > 32
        || trace
            .steps
            .iter()
            .chain(&trace.unread)
            .any(|s| s.chars().count() > 320)
    {
        return Err("查阅轨迹超出限制".into());
    }
    Ok(())
}
