//! A declared count of a named item in the current configuration. All four
//! parts (owner, time, action, unit/item) must bind inside one assertion.
const CURRENT: &[&str] = &["目前", "现在", "当前", "本期", "现时"];
const ACTIONS: &[&[&str]] = &[
    &["装", "安装", "装有"],
    &["配", "配备", "配置"],
    &["放", "摆放", "放置"],
    &["留", "留存", "保留"],
    &["存", "存放", "保存"],
    &["用", "使用"],
];

pub(super) struct Request {
    owner: String,
    item: String,
    action: &'static [&'static str],
}

impl Request {
    pub(super) fn parse(question: &str) -> Option<Self> {
        let q = question.trim().trim_end_matches(['？', '?']);
        let (owner, tail) = CURRENT.iter().find_map(|t| q.split_once(t))?;
        let (verb, item) = tail.split_once("多少").or_else(|| tail.split_once('几'))?;
        let action = ACTIONS
            .iter()
            .copied()
            .find(|words| words.contains(&verb))?;
        let valid_name = |name: &str| {
            (2..=24).contains(&name.chars().count()) && name.chars().all(char::is_alphanumeric)
        };
        if !valid_name(owner)
            || !valid_name(item)
            || !item.starts_with([
                '个', '件', '枚', '颗', '只', '台', '条', '层', '套', '张', '本', '箱', '组', '片',
                '块', '瓶', '支', '根', '架',
            ])
        {
            return None;
        }
        Some(Self {
            owner: owner.into(),
            item: item.into(),
            action,
        })
    }

    pub(super) fn supports(&self, line: &str) -> bool {
        let line = line.trim().trim_end_matches(['。', '.']);
        let Some(head) = line.strip_suffix(&self.item) else {
            return false;
        };
        let prefix = head.trim_end_matches(|c: char| {
            c.is_ascii_digit() || "零〇一二三四五六七八九十百千万两".contains(c)
        });
        let number = &head[prefix.len()..];
        if number.is_empty() || number.chars().count() > 12 {
            return false;
        }

        // Require a real current-period statement and a complete literal owner.
        // After consuming the owner only location and action grammar may remain.
        let current_first = CURRENT.iter().find_map(|t| prefix.strip_prefix(t));
        let remainder = if let Some(body) = current_first {
            body.strip_prefix('在')
                .unwrap_or(body)
                .strip_prefix(&self.owner)
        } else {
            prefix
                .strip_prefix(&self.owner)
                .and_then(|body| CURRENT.iter().find_map(|t| body.strip_prefix(t)))
        };
        let Some(remainder) = remainder else {
            return false;
        };
        let remainder = remainder.strip_prefix('的').unwrap_or(remainder);
        let locations = [
            "背板", "面板", "底座", "背面", "顶部", "底部", "里面", "内部", "内", "上",
        ];
        let remainder = locations
            .iter()
            .find_map(|p| remainder.strip_prefix(p))
            .unwrap_or(remainder);
        let remainder = remainder.strip_prefix("共").unwrap_or(remainder);
        self.action.contains(&remainder.trim_end_matches('了'))
    }
}
