//! Compare durations per session for two named activities. Bind each number
//! to the requested unit in original prose, independently of the other activity.
pub(super) struct Request<'a> {
    day: Option<&'a str>,
    subjects: [&'a str; 2],
    unit: &'a str,
}

impl<'a> Request<'a> {
    pub(super) fn parse(q: &'a str) -> Option<Self> {
        let q = ["多长", "多久", "几分钟", "几小时"]
            .iter()
            .find_map(|suffix| q.strip_suffix(suffix))?;
        let unit = ["每节", "每场", "每次", "每轮", "每班"]
            .into_iter()
            .find(|unit| q.ends_with(unit))?;
        let subjects = q.strip_suffix(unit)?;
        let day = [
            "周一", "周二", "周三", "周四", "周五", "周六", "周日", "周天",
        ]
        .into_iter()
        .find(|s| subjects.starts_with(s));
        let subjects = day
            .and_then(|d| subjects.strip_prefix(d))
            .unwrap_or(subjects);
        let (a, b) = subjects.split_once(['和', '与'])?;
        if [a, b].iter().any(|s| {
            !(2..=12).contains(&s.chars().count())
                || !s.chars().all(|c| ('\u{4e00}'..='\u{9fff}').contains(&c))
                || s.contains(['和', '与'])
        }) {
            return None;
        }
        Some(Self {
            day,
            subjects: [a, b],
            unit,
        })
    }

    pub(super) fn supports(&self, title: &str, sentence: &str) -> bool {
        sentence
            .split(['；', ';'])
            .any(|clause| self.supports_clause(title, clause.trim()))
    }

    fn supports_clause(&self, title: &str, clause: &str) -> bool {
        let Some((prefix, tail)) = clause.split_once(self.unit) else {
            return false;
        };
        if self.day.is_some_and(|day| !prefix.contains(day)) {
            return false;
        }
        let subject_phrase = self
            .day
            .map_or_else(|| prefix.to_string(), |day| prefix.replace(day, ""));
        let subject_phrase = subject_phrase.trim_matches([' ', '，', ',']);
        let tail = [
            "预约上限为",
            "时长上限为",
            "可预约",
            "最长为",
            "时长为",
            "安排",
            "预约",
            "可排",
            "最多",
            "上限",
            "限时",
            "约",
            "为",
        ]
        .iter()
        .find_map(|p| tail.strip_prefix(p))
        .unwrap_or(tail)
        .trim_start();
        let count = tail.bytes().take_while(u8::is_ascii_digit).count();
        if count == 0
            || !["分钟", "小时", "秒"].iter().any(|unit| {
                tail[count..]
                    .trim_start()
                    .strip_prefix(unit)
                    .is_some_and(|rest| {
                        rest.trim().is_empty() || rest.starts_with(['，', ',', '；', ';'])
                    })
            })
        {
            return false;
        }
        // An unlabelled duration can inherit its subject only from a title
        // that identifies exactly one activity. A comparison title cannot
        // tell us which activity an otherwise anonymous number belongs to.
        if subject_phrase.is_empty() {
            let matches = self
                .subjects
                .iter()
                .filter(|subject| {
                    let kind = subject
                        .strip_prefix("普通")
                        .or_else(|| subject.strip_prefix('新'))
                        .unwrap_or(subject);
                    kind.chars().count() >= 2 && title.contains(kind)
                })
                .count();
            if matches != 1 || title.contains(['和', '与', '、', '及']) {
                return false;
            }
        }
        self.subjects.iter().any(|subject| {
            if subject_phrase == *subject || (subject_phrase.is_empty() && title.contains(subject))
            {
                return true;
            }
            let subject = *subject;
            if let Some(kind) = subject.strip_prefix("普通") {
                return kind.chars().count() >= 2
                    && subject_phrase.is_empty()
                    && title.contains(kind)
                    && !["特殊", "专用", "特别", "临时", "新增", "进阶", "试行"]
                        .iter()
                        .any(|qualifier| title.contains(qualifier));
            }
            subject.strip_prefix('新').is_some_and(|kind| {
                kind.chars().count() >= 2
                    && ["新增", "新设", "新开"]
                        .iter()
                        .any(|word| subject_phrase.strip_prefix(word) == Some(kind))
            })
        })
    }
}
