//! Match a short question about opening under a stated condition with a
//! declaration about that same condition. Extra qualifiers stay in the subject.
pub(super) struct Availability<'a> {
    condition: &'a str,
    weather: Option<&'a str>,
}

impl<'a> Availability<'a> {
    pub(super) fn parse(question: &'a str) -> Option<Self> {
        let condition = ["还开吗", "还开放吗", "还营业吗", "照常开放吗", "照常营业吗"]
            .iter()
            .find_map(|suffix| question.trim().strip_suffix(suffix))?;
        if !(2..=12).contains(&condition.chars().count())
            || !condition
                .chars()
                .all(|c| ('\u{4e00}'..='\u{9fff}').contains(&c))
        {
            return None;
        }
        let weather = condition
            .strip_prefix('下')
            .filter(|event| event.chars().count() <= 3 && event.ends_with(['雨', '雪', '雹']));
        Some(Self { condition, weather })
    }

    // A conditional paraphrase contributes to candidate recall only. The
    // evidence check separately verifies both condition and declared status.
    pub(super) fn lexical_alias(&self) -> Option<String> {
        self.weather.map(|event| format!("{event}天"))
    }

    pub(super) fn supports(&self, sentence: &str) -> bool {
        let alias = self.lexical_alias();
        sentence
            .strip_prefix(self.condition)
            .or_else(|| {
                alias
                    .as_deref()
                    .and_then(|start| sentence.strip_prefix(start))
            })
            .is_some_and(|rest| {
                let rest = rest.trim_start_matches(['，', ',', '时']);
                let status = [
                    "仍然", "仍", "照常", "继续", "暂停", "停止", "不再", "不", "暂不",
                ]
                .iter()
                .find_map(|adverb| rest.strip_prefix(adverb))
                .unwrap_or(rest);
                ["开放", "营业", "闭馆", "关闭"].iter().any(|verb| {
                    status.strip_prefix(verb).is_some_and(|tail| {
                        tail.is_empty() || tail.starts_with(['，', ',', '；', ';'])
                    })
                })
            })
    }
}
