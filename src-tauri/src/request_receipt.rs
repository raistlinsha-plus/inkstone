//! Per-answer transport observations. Store counts, never payloads, URLs or keys.
use crate::{assistant_sources::Evidence, models::SearchResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{cell::RefCell, future::Future};

const MAX_ATTEMPTS: usize = 128;
tokio::task_local! { static ACTIVE: RefCell<Receipt>; }

tokio::task_local! { static ANSWER_SOURCES: SourceCounts; }

#[derive(Default, Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceCounts {
    pub documents: usize,
    pub wiki: usize,
    pub attachments: usize,
    pub web: usize,
}
pub async fn with_sources<F: Future>(
    local: &[SearchResult],
    external: &[Evidence],
    run: F,
) -> F::Output {
    let wiki = local
        .iter()
        .filter(|s| s.match_kind.contains("wiki"))
        .count();
    let mut counts = SourceCounts {
        documents: local.len() - wiki,
        wiki,
        ..Default::default()
    };
    for e in external {
        match e.metadata.kind.as_str() {
            "web" => counts.web += 1,
            "attachment" => counts.attachments += 1,
            "document" => counts.documents += 1,
            _ => {}
        }
    }
    ANSWER_SOURCES.scope(counts, run).await
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Service {
    WebPlan,
    ReviewPassages,
    Answer,
    Structured,
    Embedding,
    Rerank,
    WebSearch,
    WebPage,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Attempt {
    pub service: Service,
    pub input_chars: usize,
    pub http_status: Option<u16>,
    pub sources: Option<SourceCounts>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Receipt {
    pub attempts: Vec<Attempt>,
    pub overflow: usize,
    pub cited_sources: Option<usize>,
}

tokio::task_local! { static PURPOSE: Service; }
pub async fn structured<F: Future>(service: Service, future: F) -> F::Output {
    PURPOSE.scope(service, future).await
}
pub fn structured_purpose() -> Service {
    PURPOSE
        .try_with(|kind| *kind)
        .unwrap_or(Service::Structured)
}

pub async fn observe<F: Future>(work: F) -> F::Output {
    ACTIVE.scope(RefCell::new(Receipt::default()), work).await
}

pub fn snapshot() -> Option<Receipt> {
    ACTIVE.try_with(|record| record.borrow().clone()).ok()
}

#[derive(Clone, Copy)]
pub struct Handle(usize);

pub fn begin(service: Service, input_chars: usize) -> Option<Handle> {
    ACTIVE
        .try_with(|cell| {
            let mut record = cell.borrow_mut();
            if record.attempts.len() >= MAX_ATTEMPTS {
                record.overflow += 1;
                return None;
            }
            let index = record.attempts.len();
            let sources = if matches!(service, Service::Answer) {
                ANSWER_SOURCES.try_with(|s| *s).ok()
            } else {
                None
            };
            record.attempts.push(Attempt {
                service,
                input_chars,
                http_status: None,
                sources,
                input_tokens: None,
                output_tokens: None,
            });
            Some(Handle(index))
        })
        .ok()
        .flatten()
}

impl Handle {
    pub fn status(self, code: u16) {
        let _ = ACTIVE.try_with(|c| c.borrow_mut().attempts[self.0].http_status = Some(code));
    }
    pub fn usage(self, value: &Value) {
        if let Some(u) = value.get("usage") {
            let _ = ACTIVE.try_with(|cell| {
                let mut record = cell.borrow_mut();
                let row = &mut record.attempts[self.0];
                if let Some(n) = u["prompt_tokens"].as_u64() {
                    row.input_tokens = Some(n);
                }
                if let Some(n) = u["completion_tokens"].as_u64() {
                    row.output_tokens = Some(n);
                }
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn scopes_are_independent_and_missing_usage_stays_unknown() {
        assert!(snapshot().is_none());
        observe(async {
            let failed = begin(Service::Answer, 5).unwrap();
            failed.status(429);
            let retry = begin(Service::Answer, 5).unwrap();
            retry.status(200);
            retry.usage(&serde_json::json!({"usage":{"prompt_tokens":12}}));
            observe(async {
                assert!(snapshot().unwrap().attempts.is_empty());
            })
            .await;
            let rows = snapshot().unwrap().attempts;
            assert_eq!(rows.len(), 2);
            assert_eq!(rows[0].http_status, Some(429));
            assert_eq!(rows[1].input_tokens, Some(12));
            assert_eq!(rows[1].output_tokens, None);
        })
        .await;
    }
}
