//! Date-specific opening and closing times with an optionally excluded
//! monthly record. Keep the requested date, subject, action and clock together.
use super::{date_number, predicate::clock_index, single_month_day};

pub(super) struct Request<'a> {
    date: (u8, u8),
    subject: &'a str,
    opening: bool,
    exclude: Option<u8>,
}

impl<'a> Request<'a> {
    pub(super) fn parse(question: &'a str) -> Option<Self> {
        let question = question.trim_end_matches(['。', '？', '?']);
        let (question, exclude) = match question.split_once(['，', ',']) {
            Some((main, exclusion)) => {
                let exclusion = ["不要", "排除", "不含"]
                    .iter()
                    .find_map(|p| exclusion.trim().strip_prefix(p))?;
                let (month, doc) = exclusion.split_once('月')?;
                if !["记录", "的记录", "资料", "的资料", "版本", "的版本"].contains(&doc)
                {
                    return None;
                }
                let month = date_number(month).filter(|m| (1..=12).contains(m))?;
                (main, Some(month))
            }
            None => (question, None),
        };
        let date = single_month_day(question)?;
        let (prefix, suffix) = question.split_once(['日', '号'])?;
        let (month, day) = prefix.split_once('月')?;
        if date_number(month) != Some(date.0)
            || date_number(day) != Some(date.1)
            || exclude == Some(date.0)
        {
            return None;
        }
        let (subject, action) = suffix.split_once("几点")?;
        let opening = match action {
            "开" | "开放" | "开门" | "开始" => true,
            "关" | "关闭" | "关门" | "结束" => false,
            _ => return None,
        };
        if !(2..=30).contains(&subject.chars().count())
            || !subject.chars().all(char::is_alphanumeric)
        {
            return None;
        }
        Some(Self {
            date,
            subject,
            opening,
            exclude,
        })
    }

    pub(super) fn supports(&self, title: &str, heading: &str, body: &str) -> bool {
        let excluded = |text: &str| {
            self.exclude.is_some()
                && text.match_indices('月').any(|(idx, _)| {
                    let number = text[..idx]
                        .rsplit(|c: char| {
                            !c.is_ascii_digit() && !"十零一二三四五六七八九".contains(c)
                        })
                        .next()
                        .unwrap_or("");
                    date_number(number) == self.exclude
                })
        };
        if excluded(title) || excluded(heading) {
            return false;
        }
        let verbs: &[&str] = if self.opening {
            &["开放", "开门", "开始", "营业"]
        } else {
            &["关闭", "关门", "结束", "闭馆"]
        };
        super::statements(body)
            .filter(|sentence| !super::provisional(sentence))
            .flat_map(|line| line.split(['，', ',', '；', ';']))
            .any(|clause| {
                let Some((_, fact)) = clause.split_once(self.subject) else {
                    return false;
                };
                if single_month_day(clause) != Some(self.date) || excluded(clause) {
                    return false;
                }
                let Some(clock) = clock_index(fact) else {
                    return false;
                };
                let (prefix, timed) = fact.split_at(clock);
                let end = timed
                    .find(|c: char| !c.is_ascii_digit() && ![':', '：'].contains(&c))
                    .unwrap_or(timed.len());
                (["", "于", "在"].contains(&prefix.trim())
                    && verbs.iter().any(|v| timed[end..].trim() == *v))
                    || timed[end..].trim().is_empty()
                        && verbs.iter().any(|v| {
                            prefix.trim().strip_prefix(v).is_some_and(|s| {
                                ["时间为", "时间是", "时间", "于", "在"].contains(&s.trim())
                            })
                        })
            })
    }
}
