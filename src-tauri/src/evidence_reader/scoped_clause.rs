//! Carry an explicitly written topic and condition across elliptical questions.
//! A line satisfying just the topic is still only a retrieval candidate.
use super::binding;
use crate::{db, models::SearchResult};

pub(crate) struct Frame<'a> {
    subject: &'a str,
    condition: &'a str,
    body: &'a str,
}

impl<'a> Frame<'a> {
    pub(crate) fn parse(query: &'a str) -> Option<Self> {
        let (subject, tail) = query.trim().split_once(['在', '的'])?;
        let word =
            |s: &str| (2..=16).contains(&s.chars().count()) && s.chars().all(char::is_alphanumeric);
        // Admit a literal noun phrase only; instructions and pronouns cannot
        // establish a document subject or silently cancel a scope restriction.
        if !word(subject)
            || binding::has(
                subject,
                &["只", "根据", "分别", "其中", "比较", "它", "这个", "排除"],
            )
        {
            return None;
        }
        let index = tail.find([
            '里', '时', '从', '要', '先', '用', '需', '应', '能', '可', '，', ',',
        ])?;
        let condition = &tail[..index];
        if !word(condition) {
            return None;
        }
        let body = tail[index..].trim_start_matches(['里', '时', '，', ',']);
        if !binding::independent(body) || body.is_empty() {
            return None;
        }
        Some(Self {
            subject,
            condition,
            body,
        })
    }

    /// Read only lines which repeat the complete subject *and* condition.
    /// Keep each as an unverified original for normal grounded generation.
    /// A second named subject or condition must not inherit this frame.
    pub(crate) fn related(&self, hit: &SearchResult) -> Vec<SearchResult> {
        let clauses: Vec<_> = self
            .body
            .split(['，', ',', '？', '?', '；', ';'])
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .collect();
        if clauses.is_empty() || clauses.iter().any(|q| !binding::independent(q)) {
            return vec![];
        }
        let terms: Vec<_> = clauses
            .iter()
            .flat_map(|q| {
                db::segmenter().tag(q, true).into_iter().filter_map(|t| {
                    (t.word.chars().count() >= 2
                        && t.tag.starts_with(['n', 'v'])
                        && !matches!(
                            t.word,
                            "可以" | "能否" | "需要" | "应该" | "开始" | "时候" | "什么" | "是否"
                        ))
                    .then_some(t.word)
                })
            })
            .collect();
        if binding::speculative(&hit.heading)
            || hit.title.as_deref().is_some_and(binding::speculative)
        {
            return vec![];
        }
        // A single meaningful action immediately before an interrogative can
        // be written as a compound in the answer (e.g. 留几天 → 留存三天).
        let cloze_verbs: Vec<_> = clauses
            .iter()
            .filter_map(|q| {
                let at = q.find(['几', '哪', '谁'])?;
                q[..at]
                    .chars()
                    .last()
                    .filter(|c| !"的有是为要从在于用第".contains(*c))
            })
            .collect();
        let mut has_relation = false;
        let mut result = vec![];
        let mut fence = false;
        let mut excluded_level = None;
        for (idx, raw) in hit.text.lines().enumerate() {
            let text = raw.trim();
            if text.starts_with("```") || text.starts_with("~~~") {
                fence = !fence;
                continue;
            }
            if fence {
                continue;
            }
            if text.starts_with('#') {
                let level = text.bytes().take_while(|b| *b == b'#').count();
                if excluded_level.is_some_and(|blocked| level <= blocked) {
                    excluded_level = None;
                }
                if excluded_level.is_none() && binding::speculative(text) {
                    excluded_level = Some(level);
                }
                continue;
            }
            // Never combine two clauses to manufacture a match. Reject notes,
            // examples and multi-sentence lines where attribution is ambiguous.
            let statement = text.trim_end_matches(['。', '！', '.', '!']);
            if excluded_level.is_some()
                || statement.is_empty()
                || statement.starts_with(['>', '|', '<'])
                || statement.contains(['。', '？', '?', '；', ';'])
                || statement
                    .split_once(['，', ','])
                    .is_some_and(|(prefix, tail)| {
                        tail.contains(['，', ','])
                            || !prefix.contains(self.subject)
                            || !prefix.contains(self.condition)
                            || !prefix.ends_with(['时', '后', '前'])
                    })
                || binding::speculative(statement)
                || !statement.match_indices(self.subject).any(|(at, subject)| {
                    let before = &statement[..at];
                    let after = &statement[at + subject.len()..];
                    (before.is_empty()
                        || before.ends_with(self.condition)
                        || before.ends_with(['在', '给', '把', '将', '为', '于', '的', '记']))
                        && !after.starts_with(|c: char| {
                            c.is_ascii_digit() || "一二三四五六七八九十".contains(c)
                        })
                        && !["分馆", "分站", "副本", "抄件", "备件"]
                            .iter()
                            .any(|x| after.starts_with(x))
                })
                || !statement.contains(self.condition)
            {
                continue;
            }
            let assertion = statement
                .replace(self.subject, "")
                .replace(self.condition, "");
            has_relation |= terms.iter().any(|term| assertion.contains(term))
                || cloze_verbs.iter().any(|verb| assertion.contains(*verb));
            let mut source = hit.clone();
            source.start_line += idx;
            source.end_line = source.start_line;
            source.text = raw.to_owned();
            source.match_kind = "related-original".into();
            result.push(source);
        }
        if has_relation {
            result
        } else {
            vec![]
        }
    }
}
