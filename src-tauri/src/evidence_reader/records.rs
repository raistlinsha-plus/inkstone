//! Explicit named records. Match the whole subject and field label before a
//! value can be used. No topic dictionary or fuzzy subject comparison.
use super::{binding, Sentence};
use binding::Support;

pub(super) enum Request {
    Fields {
        owners: Vec<String>,
        fields: Vec<String>,
        unit: Option<String>,
        paraphrase: bool,
    },
    Parallel {
        owners: Vec<String>,
        shared: String,
        expected: Expected,
    },
}

fn atom(text: &str) -> bool {
    (1..=40).contains(&text.chars().count())
        && text
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | ' '))
}

fn label(text: &str) -> &str {
    text.trim()
        .trim_matches(['《', '》', '“', '”', '「', '」', '『', '』'])
        .trim()
}

fn labels(text: &str, enumerate: bool) -> Option<Vec<String>> {
    let words: Vec<_> = if enumerate {
        text.split(['和', '与', '、']).map(label).collect()
    } else {
        vec![label(text)]
    };
    if words.len() > 3 || words.iter().any(|w| !atom(w)) {
        return None;
    }
    Some(words.into_iter().map(str::to_owned).collect())
}

fn declaration(text: &str) -> Option<(&str, &str)> {
    let at = text
        .char_indices()
        .find(|(_, c)| matches!(c, '：' | ':' | '=' | '是' | '为'))?;
    let key = text[..at.0].trim();
    let value = text[at.0 + at.1.len_utf8()..]
        .trim()
        .trim_end_matches(['。', '！', '!', '.']);
    if key.is_empty() || !usable(value) {
        return None;
    }
    Some((key, value))
}

fn usable(value: &str) -> bool {
    !value.trim().is_empty()
        && value.chars().any(char::is_alphanumeric)
        && !binding::speculative(value)
        && !binding::has(
            value,
            &[
                "不代表",
                "并非",
                "不是",
                "没有",
                "未填",
                "不适用",
                "作废",
                "无关",
                "仅供",
                "训练用",
                "暂定",
                "未核准",
                "假定",
                "不确定",
                "以往",
                "已停用",
            ],
        )
}

fn restricted(q: &str) -> bool {
    binding::has(
        q,
        &[
            "只看",
            "只用",
            "只根据",
            "仅",
            "排除",
            "除了",
            "不要",
            "不考虑",
            "如果",
            "假如",
            "假设",
            "除非",
            "以前",
            "前者",
            "后者",
            "它",
            "那个",
            "这个",
            "合计",
            "相差",
            "总共",
        ],
    )
}

pub(super) enum Expected {
    Time { day: bool, clock: bool },
    Quantity(&'static str),
}

impl Expected {
    fn parse(tail: &str) -> Option<Self> {
        let tail = tail
            .strip_prefix('是')
            .or_else(|| tail.strip_prefix('在'))
            .unwrap_or(tail);
        if let Some(unit) = tail.strip_prefix("多少") {
            return binding::UNITS
                .iter()
                .copied()
                .find(|u| *u == unit)
                .map(Self::Quantity);
        }
        let parts: Vec<_> = tail.split(['、', '和', '及']).collect();
        if parts.len() > 2
            || !parts
                .iter()
                .all(|s| matches!(*s, "周几" | "星期几" | "几点" | "几点钟"))
        {
            return None;
        }
        Some(Self::Time {
            day: parts.iter().any(|s| matches!(*s, "周几" | "星期几")),
            clock: parts.iter().any(|s| matches!(*s, "几点" | "几点钟")),
        })
    }

    fn accepts(&self, value: &str) -> bool {
        match self {
            Self::Quantity(unit) => numeric_with_unit(value, unit),
            Self::Time { day, clock } => {
                let value = value.replace("星期", "周").replace("礼拜", "周");
                let Some(week) = value.strip_prefix('周') else {
                    return !*day && *clock && plain_clock(&value);
                };
                let Some(weekday) = week.chars().next() else {
                    return false;
                };
                let rest = week[weekday.len_utf8()..].trim();
                "一二三四五六日天".contains(weekday)
                    && if rest.is_empty() {
                        !*clock
                    } else {
                        plain_clock(rest)
                    }
            }
        }
    }
}

fn numeric_with_unit(value: &str, unit: &str) -> bool {
    value
        .strip_suffix(unit)
        .is_some_and(|number| number.trim().parse::<f64>().is_ok_and(f64::is_finite))
}

fn parallel_fields(q: &str, sentences: &[Sentence]) -> Option<Request> {
    let (names, tail) = q.split_once("分别").or_else(|| q.split_once("各"))?;
    let expected = Expected::parse(tail)?;
    let (a, b_and_shared) = names.split_once(['和', '与', '、'])?;
    if !atom(a) || a.chars().count() < 2 {
        return None;
    }
    let candidates: std::collections::BTreeSet<_> = sentences
        .iter()
        .filter_map(|s| {
            let (owner, _) = s.row.text.split_once('的')?;
            (owner != a
                && owner.chars().count() >= 2
                && atom(owner)
                && b_and_shared.starts_with(owner))
            .then_some(owner)
        })
        .collect();
    // Never guess where a second proper name ends by counting characters.
    if candidates.len() != 1 {
        return None;
    }
    let b = *candidates.first()?;
    let shared = b_and_shared.strip_prefix(b)?.trim_start_matches('的');
    if !atom(shared) || shared.chars().count() < 2 {
        return None;
    }
    Some(Request::Parallel {
        owners: vec![a.into(), b.into()],
        shared: shared.into(),
        expected,
    })
}

impl Request {
    pub(super) fn parse(text: &str, sentences: &[Sentence]) -> Option<Self> {
        let q = text.trim().trim_end_matches(['？', '?']);
        if q.chars().count() > 180 || restricted(q) || q.contains(['？', '?', '；', ';']) {
            return None;
        }
        let q = q.strip_prefix("请问").unwrap_or(q).trim();
        if let Some(request) = parallel_fields(q, sentences) {
            return Some(request);
        }
        let mut paraphrase = false;
        let endings = [
            "具体填写的是什么",
            "一栏填的是什么",
            "一栏写的是什么",
            "一栏填了什么",
            "栏里写的是什么",
            "分别是什么",
            "各是什么",
            "分别是多少",
            "各是多少",
            "是什么",
            "是多少",
            "为何值",
        ];
        let (left, unit) = if let Some((end, left)) = endings
            .iter()
            .find_map(|e| q.strip_suffix(e).map(|l| (*e, l)))
        {
            paraphrase = end.contains("填") || end.contains("写");
            (left, None)
        } else {
            let (left, unit) = q.rsplit_once("是多少")?;
            if !binding::UNITS.contains(&unit) {
                return None;
            }
            (left, Some(unit.to_owned()))
        };
        let (owner, keys) = if let Some(scope) = left
            .strip_prefix("关于")
            .or_else(|| left.strip_prefix("对于"))
        {
            let (owner, key) = scope.split_once(['，', ','])?;
            (owner, key.trim_start_matches('其'))
        } else {
            left.rsplit_once('的')?
        };
        let enumerate = q.contains("分别") || q.contains("各是");
        let owners = labels(owner, enumerate)?;
        let fields = labels(keys.trim_end_matches("分别"), enumerate)?;
        if owners.len() > 1 && fields.len() > 1 {
            return None;
        }
        if owners.iter().any(|o| o.chars().count() < 2)
            || fields.iter().any(|k| k.chars().count() < 2)
        {
            return None;
        }
        Some(Request::Fields {
            owners,
            fields,
            unit,
            paraphrase,
        })
    }

    // A named slot, table row, or explicit parallel record has its own structural owner.
    // Falling back to token containment here could turn "飞梭二型" into "飞梭".
    pub(super) fn applies_to(&self, sentence: &Sentence) -> bool {
        matches!(self, Self::Parallel { .. })
            || sentence.header.is_some()
            || sentence.section.is_some()
            || declaration(&sentence.row.text).is_some_and(|(k, _)| k.contains('的'))
    }

    pub(super) fn support(&self, sentence: &Sentence) -> Support {
        match self {
            Self::Parallel {
                owners,
                shared,
                expected,
            } => {
                let Some((first, rest)) = sentence.row.text.split_once(['，', ',']) else {
                    return Support::Absent;
                };
                let Some((owner, qualifiers)) = first.split_once('的') else {
                    return Support::Absent;
                };
                let Some((field, value)) = declaration(rest) else {
                    return Support::Absent;
                };
                if !owners.iter().any(|o| o == owner) || !usable(first) {
                    return Support::Absent;
                }
                let action = match expected {
                    Expected::Time { .. } => field
                        .strip_suffix("时间")
                        .or_else(|| field.strip_suffix("时刻"))
                        .unwrap_or(field),
                    Expected::Quantity(_) => field,
                };
                let Some(qualifier) = shared.strip_suffix(action) else {
                    return Support::Absent;
                };
                // Explicit field=value continuation. The preceding subject owns the qualifier;
                // a clause with its own subject (e.g. 南库交接时间) must not be attributed to it.
                if action.chars().count() < 2
                    || !qualifiers.starts_with(qualifier)
                    || value.contains(['，', ',', '；', ';'])
                {
                    return Support::Absent;
                }
                if !expected.accepts(value) {
                    return Support::Absent;
                }
                Support::Exact
            }
            Self::Fields {
                owners,
                fields,
                unit,
                paraphrase,
            } => {
                let valid = |owner: &str, field: &str, value: &str| {
                    if !owners.iter().any(|o| o == owner) || !usable(value) {
                        return false;
                    }
                    let (key, column_unit) = label_unit(field);
                    fields.iter().any(|k| k == key)
                        && match unit {
                            None => true,
                            Some(u) if column_unit == Some(u.as_str()) => {
                                value.trim().parse::<f64>().is_ok_and(f64::is_finite)
                            }
                            Some(u) if column_unit.is_none() => value
                                .trim()
                                .strip_suffix(u)
                                .is_some_and(|v| v.trim().parse::<f64>().is_ok_and(f64::is_finite)),
                            _ => false,
                        }
                };
                let supported = if let Some(header) = &sentence.header {
                    let split = |s: &str| {
                        s.trim()
                            .trim_matches('|')
                            .split('|')
                            .map(str::trim)
                            .map(str::to_owned)
                            .collect::<Vec<_>>()
                    };
                    let columns = split(&header.text);
                    let values = split(&sentence.row.text);
                    columns.len() == values.len()
                        && columns.len() >= 2
                        && columns
                            .iter()
                            .zip(&values)
                            .skip(1)
                            .any(|(field, v)| valid(&values[0], field, v))
                } else {
                    // Only a bare structured field can inherit the nearest source heading.
                    // Qualified or declarative prose must bind the subject in that same clause.
                    let text = sentence.row.text.trim_end_matches(['。', '.', '！']);
                    if text.contains(['，', ',']) || !usable(text) {
                        return Support::Absent;
                    }
                    declaration(text).is_some_and(|(key, value)| {
                        if let Some((owner, field)) = key.split_once('的') {
                            valid(label(owner), field, value)
                        } else {
                            sentence.section.as_ref().is_some_and(|h| {
                                text.contains(['：', ':', '='])
                                    && valid(label(h.text.trim_start_matches('#')), key, value)
                            })
                        }
                    })
                };
                if !supported {
                    Support::Absent
                } else if *paraphrase {
                    Support::Review
                } else {
                    Support::Exact
                }
            }
        }
    }
}

/// A missing slot must remain a missing facet. Only distribute a literal
/// possessive record request with explicit enumeration and no shared restriction.
pub(super) fn split_named_fields(question: &str) -> Option<Vec<String>> {
    let Request::Fields {
        owners,
        fields,
        unit,
        ..
    } = Request::parse(question, &[])?
    else {
        return None;
    };
    if owners.len() * fields.len() <= 1 {
        return None;
    }
    let ending = unit.map_or_else(|| "是什么".to_owned(), |u| format!("是多少{u}"));
    Some(
        owners
            .into_iter()
            .flat_map(|owner| {
                fields.iter().map({
                    let ending = &ending;
                    move |field| format!("关于{owner}，{field}{ending}？")
                })
            })
            .collect(),
    )
}

fn label_unit(label: &str) -> (&str, Option<&str>) {
    if let Some((name, tail)) = label.split_once(['（', '(']) {
        let unit = tail.trim_end_matches(['）', ')']);
        if unit != tail && binding::UNITS.contains(&unit) {
            return (name.trim(), Some(unit));
        }
    }
    (label.trim(), None)
}

fn plain_clock(text: &str) -> bool {
    let Some((h, m)) = text.split_once([':', '：']) else {
        return false;
    };
    (1..=2).contains(&h.len())
        && m.len() == 2
        && h.bytes().chain(m.bytes()).all(|b| b.is_ascii_digit())
        && h.parse::<u8>().is_ok_and(|v| v < 24)
        && m.parse::<u8>().is_ok_and(|v| v < 60)
}
