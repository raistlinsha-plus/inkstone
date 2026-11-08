//! A published alias can identify a subject. Only the verified original line
//! may supply the requested relation and value.

pub(crate) const ANCHORED: &str = "wiki-anchored";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Relation {
    Validity,
    Temperature,
    CleanedStorage,
}

pub(crate) fn requested(query: &str, aliases: &[String]) -> Option<Relation> {
    let query = query.trim().trim_end_matches(['？', '?', '。', '.']).trim();
    let query = query.strip_prefix("请问").unwrap_or(query).trim_start();
    aliases
        .iter()
        .filter(|alias| alias.trim().chars().count() >= 4)
        .filter_map(|alias| {
            let tail = query.strip_prefix(alias.trim())?.trim_start();
            Some((alias.chars().count(), tail))
        })
        .max_by_key(|(length, _)| *length)
        .and_then(|(_, tail)| {
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
                return Some(Relation::Validity);
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
                return Some(Relation::Temperature);
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
                .then_some(Relation::CleanedStorage)
        })
}

fn concrete_quantity(line: &str, units: &[&str]) -> bool {
    let line = line
        .split(['，', ',', '。', '；', ';'])
        .next()
        .unwrap_or("");
    units.iter().any(|unit| {
        line.match_indices(unit).any(|(start, _)| {
            line[..start]
                .trim_end()
                .chars()
                .next_back()
                .is_some_and(|c| c.is_ascii_digit())
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
                        concrete_quantity(value, &["小时", "分钟", "天", "周", "个月"])
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

pub(crate) fn supports(relation: Relation, quote: &str) -> bool {
    supporting_clauses(relation, quote).next().is_some()
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
            Some(Relation::CleanedStorage)
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
}
