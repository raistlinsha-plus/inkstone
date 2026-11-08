//! Admit paraphrased requests only when an original clause supplies the requested
//! predicate and its subject. A scenario quantity belongs to the question, not
//! necessarily to the underlying rule being looked up.

use super::{wiki_alias::concrete_quantity, years};

const DURATIONS: &[&str] = &["小时", "分钟", "天", "周", "个月", "年"];
const MONEY: &[&str] = &["元", "美元"];
const COUNT: &[&str] = &["支", "件", "个", "瓶", "盒", "包"];
const PEOPLE: &[&str] = &["人", "名"];

#[derive(Clone, Copy)]
enum Fact<'a> {
    Validity,
    Quantity(&'static [&'static str], &'static [&'static str]),
    Clock,
    Deadline,
    Inclusion(&'a str),
    Publication,
    Restock(&'a str, &'a str),
}

pub(super) struct Request<'a> {
    fact: Fact<'a>,
    subjects: Vec<String>,
    year: Option<&'a str>,
}

fn before<'a>(text: &'a str, cues: &[&str]) -> Option<(&'a str, &'a str)> {
    cues.iter().find_map(|cue| text.split_once(cue))
}

fn contains_any(text: &str, cues: &[&str]) -> bool {
    cues.iter().any(|cue| text.contains(cue))
}

fn clean_subject(subject: &str, fact: Fact<'_>) -> String {
    let subject = subject.trim().trim_matches(['的', '，', ',', '。']);
    let mut compact: String = subject.chars().filter(|ch| !ch.is_whitespace()).collect();
    match fact {
        Fact::Validity => {
            for (word, replacement) in [
                ("访客凭证", "访客证"),
                ("来访凭证", "访客证"),
                ("办理的", ""),
                ("领取的", ""),
                ("签发的", ""),
            ] {
                compact = compact.replace(word, replacement);
            }
            for origin in [
                "自签发时起",
                "自签发之时起",
                "自签发起",
                "自领取之日起",
                "自领取起",
                "从领取时起",
            ] {
                if let Some(subject) = compact.strip_suffix(origin) {
                    compact = subject.to_owned();
                    break;
                }
            }
        }
        Fact::Quantity(_, PEOPLE) | Fact::Deadline => {
            for suffix in ["培训课程", "培训", "课程", "课", "讲解团"] {
                if let Some(subject) = compact.strip_suffix(suffix) {
                    // “讲解团” is the entity; “培训/课程” here are activity forms.
                    compact = if suffix == "讲解团" {
                        format!("{subject}讲解")
                    } else {
                        subject.to_owned()
                    };
                    break;
                }
            }
        }
        Fact::Publication => {
            for suffix in ["标准", "规定", "上限"] {
                if let Some(subject) = compact.strip_suffix(suffix) {
                    compact = subject.to_owned();
                    break;
                }
            }
        }
        _ => {}
    }
    compact
}

fn clock_index(text: &str) -> Option<usize> {
    text.match_indices([':', '：']).find_map(|(i, colon)| {
        let left = text[..i]
            .bytes()
            .rev()
            .take_while(u8::is_ascii_digit)
            .count();
        let after = &text[i + colon.len()..];
        let right = after.bytes().take_while(u8::is_ascii_digit).count();
        if !(1..=2).contains(&left) || right != 2 {
            return None;
        }
        let hour = text[i - left..i].parse::<u8>().ok()?;
        let minute = after[..right].parse::<u8>().ok()?;
        (hour <= 23 && minute <= 59).then_some(i - left)
    })
}

fn declared_time(value: &str) -> &str {
    let value = value.trim_start_matches([' ', ':', '：', '=']);
    ["为", "于", "是", "在"]
        .iter()
        .find_map(|prefix| value.strip_prefix(prefix))
        .unwrap_or(value)
        .trim_start()
}

fn full_date(value: &str) -> bool {
    let value = declared_time(value);
    let Some((year, rest)) = value.split_once('年') else {
        return false;
    };
    let Some((month, rest)) = rest.split_once('月') else {
        return false;
    };
    let Some((day, _)) = rest.split_once(['日', '号']) else {
        return false;
    };
    let (Ok(year), Ok(month), Ok(day)) = (
        year.trim().parse(),
        month.trim().parse(),
        day.trim().parse(),
    ) else {
        return false;
    };
    chrono::NaiveDate::from_ymd_opt(year, month, day).is_some()
}

fn subjects<'a>(question: &'a str) -> Option<(Fact<'a>, Vec<String>)> {
    let single = |fact, subject: &str| Some((fact, vec![clean_subject(subject, fact)]));
    if let Some((subjects, _)) = before(question, &["有效期各是", "有效时长各是"]) {
        let (left, right) = subjects.split_once(['和', '与', '及'])?;
        return Some((
            Fact::Validity,
            [left, right]
                .map(|s| clean_subject(s, Fact::Validity))
                .to_vec(),
        ));
    }
    if question.contains("分别") && question.contains("报名截止") {
        if let Some((pair, activity)) = question.split_once("两地") {
            let (left, right) = pair.split_once(['和', '与', '及'])?;
            let (activity, _) = before(activity, &["哪边", "哪一边", "的报名截止", "报名截止"])?;
            let subjects = [left, right]
                .map(|side| clean_subject(&format!("{side}{activity}"), Fact::Deadline));
            return Some((Fact::Deadline, subjects.to_vec()));
        }
    }
    if let Some((subject, tail)) = before(question, &["有效期", "有效时长"]) {
        if [
            "是多少",
            "多少",
            "多久",
            "多长",
            "具体多少小时",
            "具体多少天",
            "有多长",
        ]
        .contains(&tail)
        {
            return single(Fact::Validity, subject);
        }
    }
    if let Some((subject, tail)) = question.split_once(['，', ',']) {
        if contains_any(tail, &["领证算起", "领取后", "签发后", "领证后"])
            && contains_any(tail, &["能用多久", "能用多长", "可以用多久", "有效多久"])
        {
            return single(
                Fact::Validity,
                subject.strip_prefix('按').unwrap_or(subject),
            );
        }
    }
    if let Some((subject, tail)) = before(question, &["弄丢后", "遗失后", "丢失后"]) {
        if contains_any(tail, &["重办", "补办"])
            && contains_any(tail, &["多少钱", "费用多少", "收费多少"])
        {
            return single(
                Fact::Quantity(&["补办费", "补领费", "补发费"], MONEY),
                subject,
            );
        }
    }
    if let Some((subject, tail)) = before(question, &["能否把", "一班可以排", "每班可以排"])
    {
        if tail.chars().any(|ch| ch.is_ascii_digit()) && contains_any(question, &["班", "小组"])
        {
            return single(
                Fact::Quantity(&["每班最多", "每班限额", "每班上限", "每班限"], PEOPLE),
                subject,
            );
        }
    }
    if let Some((subject, tail)) = before(question, &["留了", "存放了", "保存了"]) {
        if contains_any(tail, &["规定内", "超过期限", "超期"]) && concrete_quantity(tail, DURATIONS)
        {
            return single(
                Fact::Quantity(&["保留", "保存期限", "留存"], DURATIONS),
                subject,
            );
        }
    }
    if let Some((subject, tail)) = before(question, &["只剩", "剩余", "现有"]) {
        if tail.contains("最低库存") {
            return single(Fact::Quantity(&["最低库存", "库存下限"], COUNT), subject);
        }
    }
    if let Some((scope, requested)) = before(
        question,
        &["一次最多能补多少", "单次最多能补多少", "每单最多可补多少"],
    ) {
        if let Some((unit, item)) = COUNT
            .iter()
            .find_map(|unit| requested.strip_prefix(unit).map(|item| (*unit, item)))
        {
            if item.chars().count() >= 2 {
                return single(Fact::Restock(unit, item), scope);
            }
        }
    }
    if let Some((subject, _)) = before(
        question,
        &["最多能带几个人", "最多可以带几个人", "最多可带几个人"],
    ) {
        let subject = subject.replace("一次", "").replace("每次", "");
        return single(
            Fact::Quantity(&["每组最多", "每团最多", "每组人数上限"], PEOPLE),
            &subject,
        );
    }
    if let Some((subject, tail)) = question.split_once('让') {
        if tail.chars().any(|ch| ch.is_ascii_digit())
            && contains_any(
                tail,
                &["是否超额", "会不会超额", "是否超出容量", "能否同时容纳"],
            )
        {
            return single(
                Fact::Quantity(&["最多容纳", "最大容纳人数", "人数上限"], PEOPLE),
                subject,
            );
        }
    }
    if let Some((subject, item)) = before(question, &["能直接使用", "是否包含", "能否直接使用"])
    {
        let item = item.trim_end_matches('吗').trim();
        if (2..=24).contains(&item.chars().count()) && !item.contains(['，', ',', '、', '？', '?'])
        {
            return single(Fact::Inclusion(item), subject);
        }
    }
    if contains_any(
        question,
        &["能否入场", "能否按资料入场", "还能入场", "还能进场"],
    ) {
        if let Some(index) = clock_index(question) {
            return single(Fact::Clock, &question[..index]);
        }
    }
    if let Some((subject, tail)) = before(question, &["已经公布", "已经公告", "有没有公布"])
    {
        if ["了", "了吗", "吗", ""].contains(&tail) {
            return single(Fact::Publication, subject);
        }
    }
    None
}

impl<'a> Request<'a> {
    pub(super) fn parse(question: &'a str) -> Option<Self> {
        if question.contains(['；', ';', '“', '”', '"'])
            || question.len() > 480
            || contains_any(question, &["不考虑", "只根据", "仅根据", "仅限", "排除"])
        {
            return None;
        }
        let question = question
            .trim()
            .trim_end_matches(['？', '?', '。', '.'])
            .trim();
        if question.contains(['？', '?']) {
            return None;
        }
        let question = ["请问", "资料有写", "资料是否说明"]
            .into_iter()
            .find_map(|prefix| question.strip_prefix(prefix))
            .unwrap_or(question)
            .trim_start();
        let (fact, subjects) = subjects(question)?;
        if subjects
            .iter()
            .any(|subject| !(2..=64).contains(&subject.chars().count()))
        {
            return None;
        }
        let mut requested_years = years(question);
        let year = requested_years.next();
        if requested_years.any(|other| Some(other) != year) {
            return None;
        }
        Some(Self {
            fact,
            subjects,
            year,
        })
    }

    pub(super) fn supports(&self, title: Option<&str>, heading: &str, text: &str) -> bool {
        let title = title.unwrap_or_default();
        let metadata = format!("{title}\n{heading}");
        text.lines()
            .filter(|line| !line.trim_start().starts_with('#'))
            .flat_map(|line| line.split(['。', '；', ';', '，', ',']))
            .filter(|line| {
                !line.contains(['？', '?'])
                    && self.year.is_none_or(|year| {
                        years(line).any(|y| y == year) || years(&metadata).any(|y| y == year)
                    })
            })
            .any(|line| {
                let Some((subject, value)) = self.fact.clause(line.trim()) else {
                    return false;
                };
                let subject = clean_subject(subject, self.fact);
                self.subjects.iter().any(|wanted| {
                    if matches!(self.fact, Fact::Restock(..)) {
                        contains_scope(&metadata, wanted)
                    } else {
                        same_subject(wanted, &subject, &metadata)
                    }
                }) && value
            })
    }
}

fn contains_scope(metadata: &str, wanted: &str) -> bool {
    wanted.chars().count() >= 2
        && metadata
            .lines()
            .any(|label| label.trim().starts_with(wanted))
}

fn same_subject(wanted: &str, found: &str, metadata: &str) -> bool {
    if found.chars().count() < 2 {
        return false;
    }
    if wanted == found {
        return true;
    }
    // A document title can provide a missing namespace, but a different body
    // subject cannot be repaired by a title mentioning the requested subject.
    let Some(scope) = wanted.strip_suffix(found) else {
        return false;
    };
    contains_scope(metadata, scope.trim_end_matches('的'))
}

impl Fact<'_> {
    fn clause(self, line: &str) -> Option<(&str, bool)> {
        const NON_ASSERTIONS: &[&str] = &[
            "不适用",
            "另行通知",
            "另行公布",
            "待定",
            "尚未",
            "未公布",
            "不明确",
            "并非",
            "不是",
        ];
        match self {
            Fact::Publication => {
                let (subject, _) = before(
                    line,
                    &[
                        "待公告",
                        "待公布",
                        "另行公布",
                        "尚未公布",
                        "未公布",
                        "已公布",
                        "已公告",
                    ],
                )?;
                Some((subject, true))
            }
            Fact::Inclusion(wanted) => {
                let (subject, item) = before(line, &["包含", "包括", "含有"])?;
                Some((
                    subject.trim_end_matches(['不', '未']),
                    item.trim() == wanted,
                ))
            }
            Fact::Restock(unit, item) => {
                let (scope, value) =
                    before(line, &["每单补货上限", "单次补货上限", "每次补货上限"])?;
                let (quantity, _) = value.rsplit_once(item)?;
                Some((
                    "",
                    scope.is_empty()
                        && value.trim_end().ends_with(item)
                        && concrete_quantity(quantity, &[unit])
                        && !contains_any(line, NON_ASSERTIONS),
                ))
            }
            fact => {
                if contains_any(line, NON_ASSERTIONS) {
                    return None;
                }
                let (subject, supported) = match fact {
                    Fact::Validity => {
                        let (subject, value) =
                            before(line, &["有效期限", "有效期", "有效时长", "有效"])?;
                        (subject, concrete_quantity(value, DURATIONS))
                    }
                    Fact::Quantity(cues, units) => {
                        let (subject, value) = before(line, cues)?;
                        (subject, concrete_quantity(value, units))
                    }
                    Fact::Clock => {
                        let (subject, value) = before(
                            line,
                            &[
                                "末次入场时间",
                                "最晚入场时间",
                                "停止入场时间",
                                "最后入场时间",
                            ],
                        )?;
                        (subject, clock_index(declared_time(value)) == Some(0))
                    }
                    Fact::Deadline => {
                        let (subject, value) = before(line, &["报名截止", "报名截至"])?;
                        (subject, full_date(value))
                    }
                    _ => unreachable!(),
                };
                Some((subject.trim_end_matches('的'), supported))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capacity_scenario_requires_its_own_scope_and_a_real_body_limit() {
        let request = Request::parse("柏溪馆模型课程能否把 27 名学员排进一个班？").unwrap();
        let quote = "模型培训每班最多 20 人。";
        assert!(request.supports(None, "柏溪馆活动规则", quote));
        assert!(!request.supports(None, "另一家场馆", quote));
        assert!(!request.supports(None, "柏溪馆活动规则", "模型培训每班最多人数另行公布。"));
        assert!(!request.supports(None, "柏溪馆活动规则", "烘焙培训每班最多 20 人。"));
        assert!(!request.supports(None, "柏溪馆活动规则", "# 模型培训每班最多 20 人"));
    }

    #[test]
    fn source_subject_and_qualifier_both_survive_validity_paraphrases() {
        let request = Request::parse("白鹭湾周末访客证有效期是多少？").unwrap();
        let quote = "周末访客证自签发时起有效 12 小时。";
        assert!(request.supports(None, "白鹭湾通行规则", quote));
        assert!(!request.supports(None, "白鹭湖通行规则", quote));
        assert!(!request.supports(
            None,
            "白鹭湾通行规则",
            "工作日访客证自签发时起有效 12 小时。"
        ));
        assert!(!request.supports(None, "白鹭湾通行规则", "周末访客证不适用 12 小时有效期。"));
    }

    #[test]
    fn finding_a_publication_status_does_not_supply_the_missing_value() {
        let status = Request::parse("石城剧场的音量上限已经公布了吗？").unwrap();
        assert!(status.supports(None, "石城剧场", "音量上限待公告。"));
        assert!(Request::parse("石城剧场的音量上限为多少分贝？").is_none());
    }
}
