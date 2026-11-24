//! Resolve explicit declarations of a name. Retaining the full left-hand
//! description prevents a shared noun suffix from binding a neighboring object.
pub(crate) struct Naming(String);

impl Naming {
    pub(crate) fn parse(question: &str) -> Option<Self> {
        let question = question.trim().trim_end_matches(['？', '?']);
        let label = [
            "叫什么名字",
            "的名称是什么",
            "的名字是什么",
            "名叫什么",
            "叫什么",
        ]
        .iter()
        .find_map(|suffix| question.strip_suffix(suffix))?;
        let label = normalize(label);
        valid(&label).then_some(Self(label))
    }

    pub(crate) fn value<'a>(&self, line: &'a str) -> Option<&'a str> {
        if super::binding::speculative(line) {
            return None;
        }
        let line = line.trim().trim_end_matches(['。', '.']);
        let (label, value) = [
            "名称为",
            "名字是",
            "名叫",
            "名为",
            "叫作",
            "叫做",
            "称为",
            "为",
        ]
        .iter()
        .find_map(|marker| line.split_once(marker))?;
        let value = value.trim().trim_matches(['“', '”', '《', '》']);
        (valid(value) && normalize(label) == self.0).then_some(value)
    }
}

fn valid(text: &str) -> bool {
    (2..=32).contains(&text.chars().count()) && text.chars().all(char::is_alphanumeric)
}

fn normalize(label: &str) -> String {
    let label = label
        .trim()
        .trim_start_matches("请问")
        .replace("此轮", "本轮")
        .replace("这一轮", "本轮")
        .replace("这次", "本次");
    let label = label
        .strip_prefix("本次由")
        .map_or_else(|| label.clone(), |s| format!("本次{s}"));
    // Fronted “本次” and adverbial “本次” describe the same occurrence.
    let current = label.contains("本次");
    let bare = label.replace("本次", "");
    if current {
        format!("本次{bare}")
    } else {
        bare
    }
}
