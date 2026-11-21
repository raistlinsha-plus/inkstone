//! Match independently answerable Chinese clauses against original prose. A title
//! can identify the subject, but cannot by itself supply the requested fact.
use super::{requested_value, terms};
use crate::models::SearchResult;

fn normalize(text: &str) -> String {
    let mut value = text.to_owned();
    for (from, to) in [
        ("什么时候", "何时"),
        ("哪一天", "何日"),
        ("什么时间", "何时"),
        ("最后一班", "末班"),
        ("第一班", "首班"),
        ("截止报名", "报名截止"),
        ("补报名", "补报"),
        ("暂放", "暂存"),
        ("临时放", "暂存"),
        ("未登记", "未录入"),
        ("还没录入", "未录入"),
        ("单日", "每日"),
        ("试用", "试行"),
        ("坐垫", "座垫"),
    ] {
        if value.contains(from) {
            value = value.replace(from, to);
        }
    }
    value
}

fn has(text: &str, items: &[&str]) -> bool {
    items.iter().any(|item| text.contains(item))
}

fn non_subject(word: &str) -> bool {
    matches!(
        word,
        "现在"
            | "时候"
            | "几点"
            | "哪边"
            | "哪种"
            | "哪天"
            | "一侧"
            | "一天"
            | "能不能"
            | "不行"
            | "如果"
            | "哪样"
            | "一样"
            | "相同"
            | "什么样"
            | "是否"
            | "分别"
            | "说法"
            | "规则"
            | "具体"
            | "有无"
            | "有出入"
            | "到底"
            | "明确"
            | "数值"
            | "应该"
    )
}

struct Facet {
    question: String,
    anchors: Vec<String>,
    attribution: Option<[String; 2]>,
}

pub(super) struct Request(Vec<Facet>);

// Strip source names from a comparison only when each side identifies a
// different result title. Keep the fact and its value requirements separate.
fn attributed_parts(part: &str) -> Option<(&str, &str, &str)> {
    let (labels, fact) = if let Some((fact, attribution)) = part.split_once(['，', ',']) {
        let labels = ["有出入吗", "一致吗", "一样吗", "相同吗", "有区别吗"]
            .iter()
            .find_map(|suffix| attribution.trim().strip_suffix(suffix))?;
        (labels, fact)
    } else {
        ["分别记了", "分别写了", "分别规定", "给的", "记载的"]
            .iter()
            .find_map(|cue| part.split_once(cue))?
    };
    let (a, b) = labels.split_once(['和', '与'])?;
    Some((a, b, fact))
}

fn attributed_paths(a: &str, b: &str, results: &[SearchResult]) -> Option<[String; 2]> {
    // Users often include a date or activity before a short source name.
    // Require each identifying suffix to match exactly one title in this set.
    let identify = |label: &str| {
        let label = label.trim();
        let mut chars: Vec<_> = label.char_indices().map(|(i, _)| i).collect();
        if chars.len() < 3 {
            return None;
        }
        chars.truncate(chars.len() - 2);
        for i in chars {
            let suffix = &label[i..];
            let qualifiers = terms(&label[..i]);
            let mut found = results
                .iter()
                .filter(|hit| {
                    hit.title.as_deref().is_some_and(|title| {
                        title.contains(suffix)
                            && qualifiers
                                .iter()
                                .all(|term| title.contains(term) || hit.text.contains(term))
                    })
                })
                .map(|hit| &hit.path)
                .collect::<Vec<_>>();
            found.sort_unstable();
            found.dedup();
            if let [one] = found.as_slice() {
                return Some(one.to_string());
            }
            if found.len() > 1 {
                return None;
            }
        }
        None
    };
    let paths = [identify(a)?, identify(b)?];
    (paths[0] != paths[1]).then_some(paths)
}
impl Request {
    pub(super) fn parse(query: &str, results: &[SearchResult]) -> Self {
        // A split after a scope, a conditional or an exclusion must not make
        // the rest of the question searchable on its own.
        if !has(
            query,
            &[
                "？",
                "?",
                "几点",
                "何时",
                "多久",
                "在哪",
                "哪里",
                "多少",
                "是否",
                "什么时候",
            ],
        ) || has(
            query,
            &[
                "只看",
                "只查",
                "仅看",
                "只用",
                "仅用",
                "只根据",
                "仅根据",
                "限定",
                "排除",
                "不包括",
                "除了",
                "不要",
                "如果",
                "假如",
                "只要",
                "除非",
                "前者",
                "后者",
                "其中",
            ],
        ) {
            return Self(vec![]);
        }
        let parts: Vec<_> = query
            .split(['？', '?', '；', ';'])
            .map(str::trim)
            .filter(|q| !q.is_empty())
            .collect();
        if parts.len() > 4 {
            return Self(vec![]);
        }
        Self(
            parts
                .into_iter()
                .filter(|q| q.chars().count() <= 110)
                .filter_map(|part| {
                    let (attribution, fact) = match attributed_parts(part) {
                        Some((left, right, fact)) => {
                            (Some(attributed_paths(left, right, results)?), fact)
                        }
                        None => (None, part),
                    };
                    let question = normalize(fact);
                    let words = terms(&question);
                    // Jieba search mode intentionally emits overlapping tokens. One noun
                    // (e.g. 图书馆/图书) must not count as two independent supports.
                    let anchors = words
                        .iter()
                        .filter(|word| {
                            !non_subject(word)
                                && !words
                                    .iter()
                                    .any(|other| other != *word && other.contains(word.as_str()))
                        })
                        .cloned()
                        .collect();
                    Some(Facet {
                        question,
                        anchors,
                        attribution,
                    })
                })
                .collect(),
        )
    }

    pub(super) fn supports(&self, hit: &SearchResult) -> bool {
        if self.0.is_empty() {
            return false;
        }
        let body = normalize(&hit.text);
        self.0
            .iter()
            .filter(|facet| {
                facet
                    .attribution
                    .as_ref()
                    .is_none_or(|paths| paths.contains(&hit.path))
            })
            .any(|facet| {
                body.lines()
                    .filter(|line| !line.trim_start().starts_with('#'))
                    .flat_map(|line| line.split(['。', '！', '？']))
                    .any(|line| {
                        facet.supports(hit.title.as_deref().unwrap_or(&hit.heading), line.trim())
                    })
            })
    }
}

impl Facet {
    fn supports(&self, title: &str, line: &str) -> bool {
        let q = self.question.as_str();
        if line.is_empty() || self.anchors.is_empty() || !requested_value(q, line) {
            return false;
        }
        // Numbers, identifier fragments and weekdays constrain every match.
        if self.anchors.iter().any(|word| {
            (word.bytes().any(|b| b.is_ascii_digit())
                || word.starts_with("周") && word.chars().count() == 2)
                && !title.contains(word)
                && !line.contains(word)
        }) {
            return false;
        }
        let body_hits = self
            .anchors
            .iter()
            .filter(|word| line.contains(word.as_str()))
            .count();
        let matches = self
            .anchors
            .iter()
            .filter(|word| line.contains(word.as_str()) || title.contains(word.as_str()))
            .count();
        if matches * 3 < self.anchors.len() * 2 || body_hits == 0 {
            return false;
        }

        // Money, identifiers, quantitative attributes and dates are especially
        // easy to "answer" with a different number found in the same sentence.
        // The strict existing value/attribution rules handle those queries.
        if has(
            q,
            &[
                "多少",
                "费用",
                "收费",
                "押金",
                "价格",
                "票价",
                "浓度",
                "有效期",
                "编号",
                "最低",
                "最高",
                "温度",
            ],
        ) {
            return false;
        }
        // A two-anchor match in original prose needs either a full lexical
        // match or an independently recognizable value of the requested kind.
        let clock = super::predicate::clock_index(line).is_some();
        let unknown = has(line, &["未公布", "未确定", "未定", "未发布", "未注明"]);
        if has(q, &["几点", "何时", "时间", "截止"]) {
            let duration = has(line, &["小时", "分钟", "秒钟", "工作日"])
                && line.bytes().any(|b| b.is_ascii_digit());
            return (clock || (!q.contains("几点") && duration) || unknown)
                && (body_hits >= 2 || matches == self.anchors.len());
        }
        if has(q, &["多久", "多长", "几小时"]) {
            return has(line, &["分钟", "小时", "工作日", "时限", "时长"])
                && (unknown || line.bytes().any(|b| b.is_ascii_digit()))
                && body_hits >= 2;
        }
        if q.contains("颜色") {
            return body_hits >= 2 && line.contains('色');
        }
        if has(q, &["在哪", "哪边", "哪里", "在哪儿", "哪一侧", "去哪"]) {
            return body_hits >= 2
                && has(
                    line,
                    &[
                        "在", "位于", "至", "从", "侧", "处", "室", "区", "台", "层", "窗",
                    ],
                );
        }
        if has(
            q,
            &[
                "能否",
                "能不能",
                "可以",
                "能",
                "允许",
                "禁止",
                "一样",
                "相同",
            ],
        ) {
            return body_hits >= 2
                && has(
                    line,
                    &[
                        "允许", "可以", "不得", "禁止", "不能", "不可", "才能", "可", "仅限",
                    ],
                );
        }
        body_hits >= 2 && matches == self.anchors.len()
    }
}
