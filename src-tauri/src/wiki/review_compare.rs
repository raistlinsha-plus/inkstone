use super::{store, Content, Policy};
use rusqlite::Connection;
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ReviewComparison {
    base_revision: i64,
    current_revision: i64,
    base_available: bool,
    summary_changed: bool,
    outline_changed: bool,
    sources: Vec<SourceChange>,
}

#[derive(Serialize)]
struct SourceChange {
    title: String,
    status: &'static str,
}

#[derive(Default, PartialEq, Eq)]
struct DocumentReferences<'a> {
    title: &'a str,
    locations: BTreeSet<(&'a str, &'a str, &'a str, usize, usize)>,
}

fn references<'a>(
    content: Option<&'a Content>,
    policy: &Policy,
) -> BTreeMap<&'a str, DocumentReferences<'a>> {
    let mut documents = BTreeMap::<&str, DocumentReferences<'_>>::new();
    let allowed = policy
        .document_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    for source in content.into_iter().flat_map(Content::originals) {
        if !allowed.contains(source.document_id.as_str()) {
            continue;
        }
        let entry = documents.entry(&source.document_id).or_default();
        entry.title = &source.title;
        entry.locations.insert((
            &source.hash,
            &source.title,
            &source.path,
            source.start_line,
            source.end_line,
        ));
    }
    documents
}

fn compare(
    change: &store::Change,
    current_revision: i64,
    baseline: Option<&Content>,
    policy: &Policy,
) -> ReviewComparison {
    let mut result = ReviewComparison {
        base_revision: change.base,
        current_revision,
        base_available: change.base == 0 || baseline.is_some(),
        summary_changed: false,
        outline_changed: false,
        sources: Vec::new(),
    };
    if !result.base_available {
        return result;
    }
    result.summary_changed =
        baseline.map_or("", |content| content.summary.as_str()) != change.content.summary;
    result.outline_changed = baseline.is_some_and(|before| {
        before.title != change.content.title
            || before.related != change.content.related
            || before.aliases != change.content.aliases
            || before
                .sections
                .iter()
                .map(|section| &section.heading)
                .ne(change
                    .content
                    .sections
                    .iter()
                    .map(|section| &section.heading))
    });
    let mut previous = references(baseline, policy);
    for (id, current) in references(Some(&change.content), policy) {
        let status = match previous.remove(id) {
            Some(prior) if prior == current => continue,
            Some(_) => "updated",
            None => "added",
        };
        result.sources.push(SourceChange {
            title: current.title.into(),
            status,
        });
    }
    for prior in previous.into_values() {
        result.sources.push(SourceChange {
            title: prior.title.into(),
            status: "removed",
        });
    }
    result
        .sources
        .sort_by(|a, b| a.title.cmp(&b.title).then(a.status.cmp(b.status)));
    result
}

pub(super) fn read(
    db: &Connection,
    space: &str,
    change: &store::Change,
    policy: &Policy,
) -> Result<ReviewComparison, String> {
    let current_revision = store::current_revision(db, space, &change.page_id)?;
    let baseline = if change.base == 0 {
        None
    } else {
        store::revision(db, space, &change.page_id, change.base).ok()
    };
    Ok(compare(change, current_revision, baseline.as_ref(), policy))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wiki::{Original, Section};

    fn source(id: &str, hash: &str) -> Original {
        Original {
            document_id: id.into(),
            title: format!("{id}.md"),
            path: format!("documents/{id}/source.md"),
            start_line: 4,
            end_line: 5,
            quote: "内部摘录不进入差异结果".into(),
            hash: hash.into(),
        }
    }

    fn content(summary: &str, heading: &str, refs: Vec<Original>) -> Content {
        Content {
            title: "主题".into(),
            summary: summary.into(),
            aliases: Vec::new(),
            related: Vec::new(),
            sections: vec![Section {
                heading: heading.into(),
                refs,
            }],
            inputs: Vec::new(),
        }
    }

    #[test]
    fn uses_generation_base_and_only_lists_authorized_reference_changes() {
        let baseline = content(
            "旧摘要",
            "旧小节",
            vec![
                source("removed", "original"),
                source("updated", "original"),
                source("unchanged", "same"),
                source("revoked", "original"),
            ],
        );
        let change = store::Change {
            id: "change".into(),
            page_id: "page".into(),
            base: 2,
            result: 0,
            policy_revision: 1,
            status: "pending".into(),
            reason: String::new(),
            created: 0,
            content: content(
                "新摘要",
                "新小节",
                vec![
                    source("unchanged", "same"),
                    source("added", "new"),
                    source("updated", "new"),
                ],
            ),
        };
        let policy = Policy {
            document_ids: ["added", "removed", "unchanged", "updated"]
                .map(str::to_owned)
                .into(),
            ..Default::default()
        };
        let value = serde_json::to_value(compare(&change, 3, Some(&baseline), &policy)).unwrap();
        assert_eq!(
            value,
            serde_json::json!({
                "baseRevision": 2, "currentRevision": 3, "baseAvailable": true,
                "summaryChanged": true, "outlineChanged": true,
                "sources": [
                    { "title": "added.md", "status": "added" },
                    { "title": "removed.md", "status": "removed" },
                    { "title": "updated.md", "status": "updated" }
                ]
            })
        );
        let missing = compare(&change, 3, None, &policy);
        assert!(!missing.base_available);
        assert!(missing.sources.is_empty());
    }
}
