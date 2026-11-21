//! Let the reader judge predicate equivalence, after the application has located
//! the subject. Only verbatim fields from one admissible assertion can be cited.
use super::{binding, records, Quote, Sentence};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Claim {
    pub id: usize,
    subject: String,
    predicate: String,
    value: String,
}

const DAYS: [&str; 7] = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

fn normalized_time(s: &str) -> String {
    s.replace("星期", "周")
        .replace("礼拜", "周")
        .replace("周天", "周日")
        .split_whitespace()
        .collect()
}

// Distribute only an explicit, unambiguous date filter. Arbitrary relative
// clauses or instructions still stay attached to their original question.
pub(super) fn shared_condition(question: &str) -> Option<(&str, &str)> {
    let candidate = question
        .strip_prefix("只看")
        .or_else(|| question.strip_prefix("仅看"))
        .unwrap_or(question)
        .trim_start();
    for intro in ["星期", "礼拜", "周", "工作日", "周末"] {
        if let Some(rest) = candidate.strip_prefix(intro) {
            let len = if matches!(intro, "工作日" | "周末") {
                0
            } else {
                let Some(day) = rest
                    .chars()
                    .next()
                    .filter(|c| "一二三四五六日天".contains(*c))
                else {
                    continue;
                };
                day.len_utf8()
            };
            let end = question.len() - rest.len() + len;
            let body = question[end..]
                .trim_start_matches(|c: char| c.is_whitespace() || "，,：:".contains(c));
            if !body.is_empty() {
                return Some((&question[..end], body));
            }
        }
    }
    None
}

fn numeric_char(c: char) -> bool {
    c.is_ascii_digit() || "零〇一二三四五六七八九十百两".contains(c)
}

fn qualifiers(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for token in DAYS.into_iter().chain([
        "周末",
        "工作日",
        "节假日",
        "早班",
        "晚班",
        "夜班",
        "日班",
        "本周",
        "上周",
        "下周",
        "本月",
        "去年",
        "今年",
        "旧版",
        "新版",
        "初版",
        "终版",
    ]) {
        if text.contains(token) {
            out.push(token.to_owned());
        }
    }
    for (at, unit) in text.match_indices(['年', '月', '日', '号', '版']) {
        let digits = text[..at].rsplit(|c| !numeric_char(c)).next().unwrap_or("");
        if !digits.is_empty() {
            out.push(format!("{digits}{unit}"));
        }
    }
    for token in text.split(|c: char| !c.is_ascii_digit() && !matches!(c, '-' | '/')) {
        let mut parts = token.split(['-', '/']);
        if let (Some(year), Some(month), Some(day), None) =
            (parts.next(), parts.next(), parts.next(), parts.next())
        {
            if year.len() == 4
                && month.len() <= 2
                && day.len() <= 2
                && !month.is_empty()
                && !day.is_empty()
            {
                out.extend([
                    format!("{year}年"),
                    format!("{}月", month.trim_start_matches('0')),
                    format!("{}日", day.trim_start_matches('0')),
                ]);
            }
        }
    }
    for (at, _) in text.match_indices(['v', 'V']) {
        let version: String = text[at + 1..]
            .chars()
            .take_while(|c| c.is_ascii_digit() || *c == '.')
            .collect();
        if version.starts_with(|c: char| c.is_ascii_digit()) {
            out.push(format!("v{}", version.trim_end_matches('.')));
        }
    }
    out
}

pub(super) struct Request {
    text: String,
    conditions: Vec<String>,
    enabled: bool,
    scoped_ellipsis: bool,
}

fn heading_label(sentence: &Sentence) -> Option<&str> {
    sentence
        .section
        .as_ref()
        .map(|h| h.text.trim_start_matches('#').trim())
}

fn clauses(line: &str) -> impl Iterator<Item = &str> {
    line.split(['，', ',', '；', ';'])
        .map(|c| c.trim_matches(|ch: char| ch.is_whitespace() || "。！!?？.".contains(ch)))
        .filter(|c| !c.is_empty())
}

fn predicate_boundary(tail: &str) -> bool {
    if tail.is_empty()
        || tail.starts_with(|c: char| {
            c.is_whitespace() || "的于在由把将被会要需应可几谁哪怎何？?，,:：=".contains(c)
        })
    {
        return true;
    }
    let time = normalized_time(tail);
    if DAYS.iter().any(|d| time.starts_with(d)) {
        return true;
    }
    crate::db::segmenter()
        .tag(tail, true)
        .first()
        .is_some_and(|t| t.tag.starts_with(['v', 'p', 'd', 'r', 'u']))
}

fn question_boundary(tail: &str) -> bool {
    if predicate_boundary(tail) {
        return true;
    }
    // A nominalized action before 的 can modify the object of the question.
    let words = crate::db::segmenter().tag(tail, true);
    words
        .first()
        .is_some_and(|w| w.tag == "n" && w.word.chars().count() >= 2)
        && words.get(1).is_some_and(|w| w.word == "的")
}

fn subject_start(before: &str) -> bool {
    before.is_empty()
        || before.ends_with([
            '于', '把', '将', '给', '替', '对', '在', '《', '“', '：', '，', ',',
        ])
        || crate::db::segmenter()
            .tag(before, true)
            .last()
            .is_some_and(|t| t.tag.starts_with(['v', 'p']))
}

fn legal_anchor(s: &str) -> bool {
    (2..=64).contains(&s.chars().count())
        && s.chars().any(char::is_alphabetic)
        && ![
            "这个", "那个", "文中", "笔记", "资料", "这里", "方法", "怎么", "如何", "应该", "可以",
            "需要", "周六", "周日",
        ]
        .contains(&s)
}

impl Request {
    pub(super) fn new(question: &str, body: &str) -> Self {
        let text = body
            .trim()
            .trim_end_matches(['？', '?', '。'])
            .trim_start_matches("请问")
            .trim();
        let scoped_ellipsis = [
            "怎么",
            "怎样",
            "如何",
            "为什么",
            "什么时候",
            "哪里",
            "几时",
            "几点",
            "要用什么",
            "这份笔记",
            "本文",
            "文中",
            "这篇笔记",
            "这份文档",
            "这篇文档",
        ]
        .iter()
        .any(|w| text.starts_with(w));
        // A possessive question or explicit object following a question word is
        // still about that object. Only use the implicit-document shortcut for
        // a truly subject-free question or an explicit reference to the text.
        let tags = crate::db::segmenter().tag(text, true);
        let scoped_ellipsis = (scoped_ellipsis
            || tags
                .first()
                .is_some_and(|t| t.tag.starts_with(['v', 'd', 'p'])))
            && !text.contains('的')
            && !text.contains(['《', '“'])
            && !tags
                .iter()
                .any(|t| matches!(t.tag, "nr" | "ns" | "nt" | "nz" | "eng"));
        Self {
            text: text.into(),
            conditions: qualifiers(&normalized_time(question).to_lowercase()),
            enabled: text.chars().count() <= 200
                && !text.is_empty()
                && !binding::has(
                    text,
                    &[
                        "只看",
                        "仅看",
                        "仅根据",
                        "只根据",
                        "只用",
                        "排除",
                        "除了",
                        "不考虑",
                        "如果",
                        "假如",
                        "除非",
                        "前者",
                        "后者",
                        "分别",
                        "各自",
                        "合计",
                        "总共",
                        "相差",
                    ],
                )
                && !text.contains(['？', '?', '；', ';']),
            scoped_ellipsis,
        }
    }

    pub(super) fn conditions_match(&self, clause: &str, heading: Option<&Quote>) -> bool {
        if self.conditions.is_empty() {
            return true;
        }
        let row = qualifiers(&normalized_time(clause).to_lowercase());
        let heading = heading.map_or_else(Vec::new, |h| {
            qualifiers(&normalized_time(&h.text).to_lowercase())
        });
        self.conditions.iter().all(|c| {
            let group = |v: &str| {
                if DAYS.contains(&v) {
                    return "weekday";
                }
                if v.starts_with('v') || v.ends_with('版') {
                    return "version";
                }
                for suffix in ["月", "年", "日", "号"] {
                    if v.ends_with(suffix) {
                        return suffix;
                    }
                }
                ""
            };
            if !group(c).is_empty() && row.iter().any(|v| group(v) == group(c) && v != c) {
                return false;
            }
            row.contains(c) || heading.contains(c)
        })
    }

    pub(super) fn compatible_original_conditions(&self, text: &str, label: &str) -> bool {
        if self.conditions.is_empty() {
            return true;
        }
        let canonical = |values: Vec<String>| {
            values
                .into_iter()
                .map(|v| {
                    for suffix in ["月", "日", "号"] {
                        if let Some(n) = v
                            .strip_suffix(suffix)
                            .and_then(crate::evidence::date_number)
                        {
                            return format!("{n}{}", if suffix == "号" { "日" } else { suffix });
                        }
                    }
                    v
                })
                .collect::<Vec<_>>()
        };
        let required = canonical(self.conditions.clone());
        let seen = canonical(qualifiers(&normalized_time(text).to_lowercase()));
        let label = canonical(qualifiers(&normalized_time(label).to_lowercase()));
        // A comparison can need records from different days. Each supplied
        // day/version/date must belong to the requested set for that component.
        let family = |v: &str| {
            if DAYS.contains(&v) {
                return "weekday";
            }
            if v.starts_with('v') || v.ends_with('版') {
                return "version";
            }
            ["月", "年", "日", "号"]
                .into_iter()
                .find(|suffix| v.ends_with(suffix))
                .unwrap_or("")
        };
        required.iter().all(|condition| {
            let group = family(condition);
            if group.is_empty() {
                return seen.contains(condition) || label.contains(condition);
            }
            let scope: Vec<_> = seen
                .iter()
                .chain(&label)
                .filter(|v| family(v) == group)
                .collect();
            !scope.is_empty() && scope.iter().all(|v| required.contains(v))
        })
    }

    pub(super) fn needs_heading(&self, s: &Sentence) -> bool {
        !self.conditions.is_empty() && !self.conditions_match(&s.row.text, None)
    }

    // Exact proper name in the source, ending at an assertion boundary in
    // both strings. Check every start in the question to allow inverted word
    // order ("该怎么保养雾青盘"). A common middle word cannot name the owner.
    fn common_subject<'a>(&self, clause: &'a str) -> Option<&'a str> {
        self.text
            .char_indices()
            .filter_map(|(at, _)| {
                let question = &self.text[at..];
                let len = question
                    .chars()
                    .zip(clause.chars())
                    .take_while(|(a, b)| a == b)
                    .map(|(c, _)| c.len_utf8())
                    .sum::<usize>();
                let subject = &clause[..len];
                if !legal_anchor(subject) {
                    return None;
                }
                let before = &self.text[..at];
                (subject_start(before)
                    && question_boundary(&question[len..])
                    && predicate_boundary(&clause[len..]))
                .then_some(subject)
            })
            .max_by_key(|s| s.len())
    }

    pub(super) fn named_in_question(&self, name: &str) -> bool {
        legal_anchor(name)
            && self.text.match_indices(name).any(|(at, _)| {
                let tail = &self.text[at + name.len()..];
                subject_start(&self.text[..at])
                    && (question_boundary(tail) || tail.starts_with(['》', '”']))
            })
    }

    fn owner<'a>(&self, s: &'a Sentence, clause: &'a str) -> Option<(&'a str, bool)> {
        // A literal possessive owner cannot inherit a different heading.
        if let Some((name, _)) = clause.split_once('的') {
            if legal_anchor(name) && self.named_in_question(name) {
                return Some((name, false));
            }
        }
        if let Some(name) = self.common_subject(clause) {
            return Some((name, false));
        }
        // Never move another subject's possessive declaration under this heading.
        if clause.split_once('的').is_some_and(|(subject, _)| {
            s.section_field()
                || crate::db::segmenter()
                    .tag(subject, true)
                    .iter()
                    .all(|w| w.tag.starts_with(['n', 'm', 'q']))
        }) {
            return None;
        }
        let implied_subject = s.section_field()
            || predicate_boundary(clause)
            || ["先", "再", "然后", "最后", "首先"]
                .iter()
                .any(|prefix| clause.starts_with(prefix));
        if let Some(label) = heading_label(s).filter(|l| self.named_in_question(l)) {
            if implied_subject {
                return Some((label, true));
            }
        }
        if let Some(title) = s
            .scope_title
            .as_deref()
            .filter(|t| self.named_in_question(t))
        {
            if implied_subject {
                return Some((title, false));
            }
        }
        (s.scoped && self.scoped_ellipsis && implied_subject).then_some(("", false))
    }

    fn admissible(&self, s: &Sentence, record: Option<&records::Request>) -> bool {
        self.enabled
            && s.header.is_none()
            && !binding::speculative(&s.row.text)
            && !binding::has(
                &s.row.text,
                &[
                    "并非",
                    "不代表",
                    "已废止",
                    "作废",
                    "并未",
                    "并不",
                    "未核实",
                    "不是",
                    "以往",
                    "旧数据",
                    "曾经",
                    "原本",
                ],
            )
            && !record.is_some_and(|r| r.blocks_semantic(s))
    }

    pub(super) fn can_review(
        &self,
        s: &Sentence,
        lexical: &binding::Question,
        record: Option<&records::Request>,
    ) -> bool {
        self.admissible(s, record)
            && clauses(&s.row.text).any(|c| {
                self.conditions_match(c, s.section.as_ref())
                    && lexical.semantic_value(c, c)
                    && self.owner(s, c).is_some()
            })
    }

    pub(super) fn verify(
        &self,
        s: &Sentence,
        lexical: &binding::Question,
        record: Option<&records::Request>,
        claim: &Claim,
    ) -> Option<(Quote, Option<Quote>)> {
        if !self.admissible(s, record)
            || [&claim.predicate, &claim.value]
                .iter()
                .any(|f| f.trim().is_empty() || !f.chars().any(char::is_alphanumeric))
            || claim.predicate == claim.value
            || claim.value == claim.subject
        {
            return None;
        }
        for clause in clauses(&s.row.text) {
            if !self.conditions_match(clause, s.section.as_ref())
                || !clause.contains(&claim.predicate)
                || !clause.contains(&claim.value)
                || !lexical.semantic_value(clause, clause)
                || !lexical.semantic_value(clause, &claim.value)
            {
                continue;
            }
            let Some((subject, from_heading)) = self.owner(s, clause) else {
                continue;
            };
            let same_subject = subject == claim.subject
                || (!from_heading
                    && !claim.subject.is_empty()
                    && subject.strip_prefix(&claim.subject).is_some_and(|tail| {
                        tail.starts_with(['的', '把', '将', '在', '于', '由'])
                    })
                    && self.named_in_question(&claim.subject));
            if !same_subject || claim.subject == claim.predicate {
                continue;
            }
            // Keep the complete original sentence so a qualifier outside the
            // named spans is visible in the citation.
            return Some((
                s.row.clone(),
                (from_heading || self.needs_heading(s))
                    .then(|| s.section.clone())
                    .flatten(),
            ));
        }
        None
    }

    pub(super) fn literal_procedure(&self, s: &Sentence) -> binding::Support {
        // Local fast path for a literal procedure: explicit owner and action
        // in the question, followed immediately by steps in its own clause.
        if !self.enabled || !self.admissible(s, None) {
            return binding::Support::Absent;
        }
        let Some((owner, action)) = self
            .text
            .split_once("怎么")
            .or_else(|| self.text.split_once("如何"))
        else {
            return binding::Support::Absent;
        };
        if !legal_anchor(owner) || action.chars().count() < 2 {
            return binding::Support::Absent;
        }
        let prefix = format!("{owner}{action}");
        if clauses(&s.row.text).any(|c| {
            self.conditions_match(c, s.section.as_ref())
                && c.strip_prefix(&prefix).is_some_and(|rest| {
                    ["时应", "时须", "时要", "时先", "需要", "应先", "须先"]
                        .iter()
                        .any(|w| {
                            rest.strip_prefix(w)
                                .is_some_and(|step| step.chars().count() >= 2)
                        })
                })
        }) {
            binding::Support::Exact
        } else {
            binding::Support::Absent
        }
    }
}
