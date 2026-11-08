//! A published alias can identify a subject. Only the verified original line
//! may supply the requested relation and value.

pub(crate) const ANCHORED: &str = "wiki-anchored";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Relation {
    Validity,
    Temperature,
    CleanedStorage,
}

pub(crate) fn requested<'a>(query: &str, aliases: &'a [String]) -> Option<(Relation, &'a str)> {
    let query = query.trim().trim_end_matches(['？', '?', '。', '.']).trim();
    let query = query.strip_prefix("请问").unwrap_or(query).trim_start();
    aliases
        .iter()
        .filter(|alias| alias.trim().chars().count() >= 4)
        .filter_map(|alias| {
            let tail = query.strip_prefix(alias.trim())?.trim_start();
            Some((alias.trim(), tail))
        })
        .max_by_key(|(alias, _)| alias.chars().count())
        .and_then(|(alias, tail)| {
            let tail = tail.strip_prefix('的').unwrap_or(tail);
            if [
                "能用几天",
                "能用几小时",
                "能用多久",
                "可以用几天",
                "可以用几小时",
                "可以用多久",
                "有效多久",
                "有效期多长",
                "有效期是多少",
            ]
            .contains(&tail)
            {
                return Some((Relation::Validity, alias));
            }
            if [
                "要求几度",
                "几度",
                "多少度",
                "要求多少度",
                "是多少度",
                "温度是多少",
            ]
            .contains(&tail)
            {
                return Some((Relation::Temperature, alias));
            }
            let tail = tail.trim_start_matches(['，', ',']).trim_start();
            let tail = tail.strip_prefix('时').unwrap_or(tail);
            let tail = tail.trim_start_matches(['，', ',']).trim_start();
            let suffix = ["清洗后", "擦洗过的", "清洗过的", "洗过的"]
                .iter()
                .find_map(|start| tail.strip_prefix(start))?;
            let suffix = ["东西", "工具", "器具", "物品"]
                .iter()
                .find_map(|noun| suffix.strip_prefix(noun))
                .unwrap_or(suffix);
            ["收在哪", "放在哪", "放在哪里", "归还到哪里"]
                .contains(&suffix)
                .then_some((Relation::CleanedStorage, alias))
        })
}

pub(super) fn concrete_quantity(value: &str, units: &[&str]) -> bool {
    let value = value
        .split(['，', ',', '。', '；', ';'])
        .next()
        .unwrap_or("")
        .trim_start_matches(|c: char| c.is_whitespace() || matches!(c, ':' | '：' | '='));
    let value = [
        "设定为",
        "设定在",
        "限定为",
        "规定为",
        "要求为",
        "保持在",
        "维持在",
        "不得超过",
        "不超过",
        "不长于",
        "最多",
        "至少",
        "至多",
        "大约",
        "约为",
        "设为",
        "均为",
        "为",
        "是",
    ]
    .iter()
    .find_map(|prefix| value.strip_prefix(prefix))
    .unwrap_or(value)
    .trim_start();
    let value = ["每次", "每晚", "每人", "每份"]
        .iter()
        .find_map(|prefix| value.strip_prefix(prefix))
        .unwrap_or(value);
    let numeric = |c: char| c.is_ascii_digit() || "零一二两三四五六七八九十百千万半〇".contains(c);
    units.iter().any(|unit| {
        value.match_indices(unit).any(|(start, _)| {
            let number = value[..start].trim_end();
            number.chars().next_back().is_some_and(numeric)
                && number
                    .chars()
                    .all(|c| numeric(c) || c.is_whitespace() || "+-−.到至~～—".contains(c))
        })
    })
}

pub(crate) fn supports_named_quantity(
    subject: &str,
    attribute: &str,
    units: &[&str],
    quote: &str,
) -> bool {
    let subject = subject.trim().trim_end_matches('的');
    let subject = ["每次", "每晚", "每人", "每份"]
        .iter()
        .find_map(|suffix| subject.strip_suffix(suffix))
        .unwrap_or(subject)
        .trim();
    quote
        .lines()
        .filter(|line| !line.trim_start().starts_with('#'))
        .flat_map(|line| line.split(['，', ',', '。', '；', ';']))
        .any(|line| {
            line.split_once(attribute).is_some_and(|(before, value)| {
                let original = before.trim().trim_end_matches('的');
                (subject.is_empty()
                    || (original.chars().count() >= 2
                        && (subject.ends_with(original) || original.ends_with(subject))))
                    && concrete_quantity(
                        value.trim_start_matches(['：', ':', ' ', '上', '限']),
                        units,
                    )
            })
        })
}

fn supporting_clauses(relation: Relation, quote: &str) -> impl Iterator<Item = &str> {
    quote
        .lines()
        .filter(|line| !line.trim_start().starts_with('#'))
        .flat_map(move |line| {
            line.split(move |c| {
                matches!(c, '。' | '；' | ';')
                    || (relation != Relation::CleanedStorage && matches!(c, '，' | ','))
            })
        })
        .map(str::trim)
        .filter(move |line| {
            if [
                "未公布",
                "未规定",
                "另行公布",
                "另行通知",
                "不适用",
                "无效",
                "不是",
                "并非",
                "尚未",
                "待定",
                "未知",
                "不明确",
                "?",
                "？",
            ]
            .iter()
            .any(|term| line.contains(term))
            {
                return false;
            }
            match relation {
                Relation::Validity => ["有效期", "有效时长"]
                    .iter()
                    .find_map(|attribute| line.split_once(attribute).map(|(_, value)| value))
                    .is_some_and(|value| {
                        concrete_quantity(value, &["小时", "分钟", "天", "周", "个月", "年"])
                            || ["无限期", "永久有效", "长期有效"].iter().any(|phrase| {
                                value
                                    .trim_start_matches(['为', '是', '：', ':', ' '])
                                    .starts_with(phrase)
                            })
                    }),
                Relation::Temperature => line
                    .split_once("温度")
                    .is_some_and(|(_, value)| concrete_quantity(value, &["摄氏度", "℃", "度"])),
                Relation::CleanedStorage => ["清洗后", "擦洗后", "洗净后"]
                    .iter()
                    .find_map(|action| line.split_once(action).map(|(_, place)| place))
                    .is_some_and(|place| {
                        let place = place.split(['。', '；', ';']).next().unwrap_or("");
                        if ["不得", "不要", "禁止", "不应", "不能", "不必"]
                            .iter()
                            .any(|term| place.contains(term))
                        {
                            return false;
                        }
                        ["放入", "放在", "归还至", "归还到"]
                            .iter()
                            .find_map(|verb| place.split_once(verb).map(|(_, value)| value))
                            .is_some_and(|value| {
                                value
                                    .trim()
                                    .chars()
                                    .take_while(|c| c.is_alphanumeric())
                                    .count()
                                    >= 2
                                    && !["另行", "自行", "适当", "相关", "指定地点"]
                                        .iter()
                                        .any(|vague| value.contains(vague))
                            })
                    }),
            }
        })
}

#[cfg(test)]
fn supports(relation: Relation, quote: &str) -> bool {
    supporting_clauses(relation, quote).next().is_some()
}

// Page-wide aliases are generated labels. They can route recall, but the
// original body must independently name the same kind of entity or material.
fn subject_terms(relation: Relation) -> &'static [&'static [&'static str]] {
    match relation {
        Relation::Validity => &[
            &["访客", "来访人员", "访客证", "参观者"],
            &["停车", "泊车"],
            &["志愿者"],
            &["通行", "出入", "门禁", "入场"],
        ],
        Relation::Temperature => &[
            &["釉料", "釉彩"],
            &["低温转运", "样本运输", "样本配送", "冷链"],
        ],
        Relation::CleanedStorage => &[&["器材", "器具", "教具", "工具"]],
    }
}

fn contains_term(text: &str, group: &[&str]) -> bool {
    group.iter().any(|term| text.contains(term))
}

fn categories(relation: Relation, text: &str) -> Vec<usize> {
    let groups = subject_terms(relation);
    let mut found = groups
        .iter()
        .enumerate()
        .filter_map(|(index, group)| contains_term(text, group).then_some(index))
        .collect::<Vec<_>>();
    // A visitor or parking access permit keeps the more specific category.
    if relation == Relation::Validity
        && found.len() > 1
        && found.last() == Some(&(groups.len() - 1))
    {
        found.pop();
    }
    found
}

fn matches_subject(relation: Relation, subject: &str, quote: &str, line: &str) -> Option<bool> {
    let expected = categories(relation, subject);
    let category = *expected.first()?;
    // If multiple categories are named, a page alias cannot disambiguate them.
    if expected.len() > 1 {
        return Some(false);
    }
    let original_subject = explicit_subject(relation, line).unwrap_or("");
    let mut original = categories(relation, original_subject);
    if original.is_empty() {
        original = categories(
            relation,
            if relation == Relation::Validity {
                line
            } else {
                quote
            },
        );
    }
    Some(original == [category])
}

pub(crate) fn supports_value(relation: Relation, query: &str, quote: &str) -> bool {
    supporting_clauses(relation, quote)
        .any(|line| matches_subject(relation, query, quote, line).unwrap_or(true))
}

pub(crate) fn supports_alias(relation: Relation, alias: &str, quote: &str) -> bool {
    supporting_clauses(relation, quote).any(|line| {
        matches_subject(relation, alias, quote, line).unwrap_or_else(|| {
            explicit_subject(relation, line).is_some_and(|subject| {
                subject.chars().count() >= 3 && (alias.contains(subject) || subject.contains(alias))
            })
        })
    })
}

fn explicit_subject(relation: Relation, line: &str) -> Option<&str> {
    let attributes: &[&str] = match relation {
        Relation::Validity => &["有效期", "有效时长"],
        Relation::Temperature => &["温度"],
        Relation::CleanedStorage => &["清洗后", "擦洗后", "洗净后"],
    };
    let before = attributes
        .iter()
        .find_map(|attribute| line.split_once(attribute).map(|(before, _)| before))?;
    let subject = before
        .rsplit(['，', ',', '。', '：', ':', '|'])
        .next()?
        .trim()
        .trim_end_matches('的')
        .trim();
    (2..=64)
        .contains(&subject.chars().count())
        .then_some(subject)
}

/// A page-wide alias may guide evidence in one unambiguous original section.
/// Evaluate the published section before narrowing to a requested document, so
/// a narrower scope cannot accidentally remove the sign of another subject.
pub(crate) fn eligible_section<'a, I, J>(relation: Relation, sections: I) -> Option<usize>
where
    I: IntoIterator<Item = J>,
    J: IntoIterator<Item = &'a str>,
{
    let mut matches = sections
        .into_iter()
        .enumerate()
        .filter_map(|(index, quotes)| {
            let mut lines = quotes
                .into_iter()
                .flat_map(|quote| supporting_clauses(relation, quote));
            let subject = explicit_subject(relation, lines.next()?);
            let consistent =
                lines.all(|line| subject.is_some() && explicit_subject(relation, line) == subject);
            Some((index, consistent))
        });
    let (index, consistent) = matches.next()?;
    (consistent && matches.next().is_none()).then_some(index)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alias_must_name_the_question_subject_and_keeps_unknown_constraints() {
        let aliases = vec!["活动器材善后".into()];
        assert_eq!(
            requested("活动器材善后时，擦洗过的东西收在哪？", &aliases),
            Some((Relation::CleanedStorage, "活动器材善后"))
        );
        for query in [
            "另一个项目的活动器材善后能用几天？",
            "活动器材善后限周五，东西收在哪？",
            "活动器材善后时，运送费用多少？",
        ] {
            assert_eq!(requested(query, &aliases), None, "{query}");
        }
    }

    #[test]
    fn a_value_must_follow_the_right_relation_in_original_body() {
        assert!(supports(Relation::Validity, "访客证的有效期为72小时。"));
        assert!(!supports(
            Relation::Validity,
            "访客证有效期尚未公布，开门时间是8小时。"
        ));
        assert!(!supports(
            Relation::Validity,
            "访客证为72小时开放，须查验有效期。"
        ));
        assert!(!supports(
            Relation::Validity,
            "请查看访客证的有效期，开门时间是8小时。"
        ));
        assert!(!supports(
            Relation::Validity,
            "访客证有效期重新申请后72小时完成。"
        ));
        assert!(supports(Relation::Validity, "访客证有效期为三天。"));
        assert!(supports(Relation::Validity, "访客证有效期：长期有效。"));
        assert!(supports(Relation::Temperature, "保存温度为8摄氏度。"));
        assert!(!supports(
            Relation::Temperature,
            "建议低温保存，温度值尚未公布。"
        ));
        assert!(supports(
            Relation::CleanedStorage,
            "器具清洗后放入蓝色网篮。"
        ));
        assert!(!supports(
            Relation::CleanedStorage,
            "器具清洗后放入指定地点。"
        ));
        assert!(!supports(
            Relation::CleanedStorage,
            "器具清洗后不得放入蓝色网篮。"
        ));
    }

    #[test]
    fn alias_cannot_grant_evidence_across_multiple_subjects_or_sections() {
        let admission = "访客证的有效期为72小时。";
        let parking = "停车券的有效期为2小时。";
        let admission_variant = "访客证有效期为24小时。";
        assert_eq!(
            eligible_section(Relation::Validity, [[admission], [parking]]),
            None
        );
        assert_eq!(
            eligible_section(Relation::Validity, [[admission, parking]]),
            None
        );
        assert_eq!(
            eligible_section(
                Relation::Validity,
                [["访客证的有效期为72小时。\n停车券的有效期为2小时。"]]
            ),
            None
        );
        assert_eq!(
            eligible_section(
                Relation::Validity,
                [["访客证的有效期为72小时，停车券的有效期为2小时。"]]
            ),
            None
        );
        assert_eq!(
            eligible_section(Relation::Validity, [[admission, admission_variant]]),
            Some(0)
        );
    }

    #[test]
    fn an_alias_needs_the_same_subject_and_an_affirmative_original_value() {
        let alias = "展馆访客凭条";
        for quote in [
            "停车证有效期为72小时。",
            "访客证有效期不适用72小时规则。",
            "访客证有效期另行公布，开门时间是72小时。",
            "访客证有效期没有公开。停车证有效期为72小时。",
        ] {
            assert!(!supports_alias(Relation::Validity, alias, quote), "{quote}");
        }
        assert!(supports_alias(
            Relation::Validity,
            alias,
            "展馆访客证有效期为72小时。"
        ));
        assert!(supports_alias(
            Relation::Validity,
            "双闸出入凭证",
            "临时通行证有效期为36小时。"
        ));
        assert!(supports_alias(
            Relation::Validity,
            "展馆访客通行凭条",
            "展馆访客通行证有效期为72小时。"
        ));
    }
}
