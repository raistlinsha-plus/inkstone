//! Two-input arithmetic from explicitly attributed, unqualified measurements.
//! Both operands are parsed from the cited originals. Unsupported grammar leaves
//! generation with the original excerpts and no calculated result.
const UNITS: &[&str] = &[
    "件", "台", "本", "份", "张", "支", "人", "名", "个", "元", "分钟", "小时", "天", "千克", "克",
    "毫升", "升", "米", "千米",
];

#[derive(Clone, Copy, PartialEq, Eq)]
enum Operation {
    Sum,
    Difference,
}

struct Request<'a> {
    labels: [&'a str; 2],
    metric: &'a str,
    expected_unit: Option<&'a str>,
    op: Operation,
}

fn parse(question: &str) -> Option<Request<'_>> {
    let question = question.trim().trim_end_matches(['？', '?', '。']);
    let question = question.strip_prefix("请问").unwrap_or(question).trim();
    if super::binding::has(
        question,
        &[
            "如果",
            "只有",
            "仅",
            "不含",
            "不包括",
            "排除",
            "除了",
            "上周",
            "本周",
            "下周",
            "周末",
            "工作日",
            "假日",
            "今天",
            "昨天",
            "本月",
            "上月",
            "今年",
            "去年",
            "旧版",
            "新版",
            "草案",
            "截至",
            "时段",
            "期间",
            "相比",
        ],
    ) || crate::evidence::month_days(question).next().is_some()
    {
        return None;
    }
    let (prefix, op, tail) = [
        ("合计", Operation::Sum),
        ("总共", Operation::Sum),
        ("相差", Operation::Difference),
        ("差值", Operation::Difference),
    ]
    .into_iter()
    .find_map(|(word, op)| {
        question
            .split_once(word)
            .map(|(prefix, tail)| (prefix, op, tail))
    })?;
    // Explicitly bind the same named metric to two distinct named subjects.
    let (pair, metric) = prefix.trim().trim_end_matches('的').rsplit_once('的')?;
    let (left, right) = pair.split_once(['和', '与'])?;
    let labels = [left.trim(), right.trim()];
    let metric = metric.trim().trim_end_matches('的');
    if labels.iter().any(|name| {
        !(2..=32).contains(&name.chars().count()) || !name.chars().all(char::is_alphanumeric)
    }) || labels[0].contains(labels[1])
        || labels[1].contains(labels[0])
        || !(2..=16).contains(&metric.chars().count())
        || !metric.chars().all(char::is_alphanumeric)
        || pair.matches(['与', '和']).count() != 1
    {
        return None;
    }
    let unit = ["是多少", "有多少", "多少", "为多少", "是几", "几"]
        .iter()
        .find_map(|intro| tail.trim().strip_prefix(intro))?;
    if !unit.is_empty() && !UNITS.contains(&unit) {
        return None;
    }
    Some(Request {
        labels,
        metric,
        expected_unit: (!unit.is_empty()).then_some(unit),
        op,
    })
}

struct Operand<'a> {
    milli: i64,
    value: &'a str,
    unit: &'a str,
    citation: usize,
}

fn operand<'a>(sources: &[(usize, &'a str)], name: &str, metric: &str) -> Option<Operand<'a>> {
    let mut input = None;
    for &(citation, source) in sources {
        if !source.contains(name) || !source.contains(metric) {
            continue;
        }
        // A date, second value, version, condition or qualification within the
        // source must never be silently dropped while isolating a number.
        let text = source.trim().trim_end_matches(['。', '.']).trim();
        let field = text
            .strip_prefix(name)?
            .trim_start()
            .trim_start_matches('的')
            .strip_prefix(metric)?
            .trim();
        let number_and_unit = ["为", "是", "有", "：", ":", "="]
            .iter()
            .find_map(|p| field.strip_prefix(p))?
            .trim();
        let unit = UNITS
            .iter()
            .filter(|u| number_and_unit.ends_with(**u))
            .max_by_key(|u| u.len())
            .copied()?;
        let value = number_and_unit.strip_suffix(unit)?.trim();
        let (whole, fraction) = value.split_once('.').unwrap_or((value, ""));
        if citation == 0
            || input.is_some()
            || whole.is_empty()
            || !whole.bytes().all(|b| b.is_ascii_digit())
            || fraction.len() > 3
            || !fraction.bytes().all(|b| b.is_ascii_digit())
            || value.ends_with('.')
        {
            return None;
        }
        let milli = whole
            .parse::<i64>()
            .ok()?
            .checked_mul(1000)?
            .checked_add(format!("{fraction:0<3}").parse().ok()?)?;
        input = Some(Operand {
            milli,
            value,
            unit,
            citation,
        });
    }
    input
}

pub(super) fn input_facets(question: &str) -> Option<Vec<String>> {
    let request = parse(question)?;
    let unit = request.expected_unit.unwrap_or_default();
    Some(
        request
            .labels
            .iter()
            .map(|name| format!("{name}的{}是多少{unit}？", request.metric))
            .collect(),
    )
}

pub(crate) fn calculation_note(question: &str, sources: &[(usize, &str)]) -> Option<String> {
    let r = parse(question)?;
    let [left, right] = r.labels;
    let a = operand(sources, left, r.metric)?;
    let b = operand(sources, right, r.metric)?;
    if a.unit != b.unit
        || a.citation == b.citation
        || r.expected_unit.is_some_and(|unit| unit != a.unit)
    {
        return None;
    }
    let unit = a.unit;
    let (value, label, expr) = match r.op {
        Operation::Sum => (
            a.milli.checked_add(b.milli)?,
            "合计",
            format!("{} + {}", a.value, b.value),
        ),
        Operation::Difference => (
            (a.milli - b.milli).abs(),
            "绝对差值",
            format!("|{} − {}|", a.value, b.value),
        ),
    };
    let result = format!("{}.{:03}", value / 1000, value % 1000);
    let result = result.trim_end_matches('0').trim_end_matches('.');
    Some(format!("原文可复算的{}：{left} {} {unit} [{}]，{right} {} {unit} [{}]。{label}（{unit}）为 {expr} = {result}。",r.metric,a.value,a.citation,b.value,b.citation))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_sum_or_unsigned_difference_has_two_bound_citations() {
        let values = [
            (2, "青松组材料费为 0.10 元。"),
            (5, "岩雀组材料费为0.35元。"),
        ];
        for (question, output) in [
            ("青松组与岩雀组的材料费合计多少元？", "0.10 + 0.35 = 0.45"),
            ("青松组和岩雀组的材料费相差多少元？", "|0.10 − 0.35| = 0.25"),
        ] {
            let result = calculation_note(question, &values).unwrap();
            assert!(result.contains("青松组 0.10 元 [2]"));
            assert!(result.contains("岩雀组 0.35 元 [5]"));
            assert!(result.contains(output));
            assert_eq!(
                input_facets(question).unwrap(),
                ["青松组的材料费是多少元？", "岩雀组的材料费是多少元？"]
            );
        }
    }

    #[test]
    fn ambiguous_measurements_versions_units_or_overflow_have_no_total() {
        let question = "青松组与岩雀组的库存合计多少件？";
        let b = "岩雀组库存为4件。";
        for a in [
            "每周六青松组库存为6件。",
            "青松组入库为6件。",
            "青松组库存为6台。",
            "青松组库存为3件或4件。",
            "青松组库存为6件，尚未确认。",
            "青松组库存为9223372036854775807件。",
            "青松组库存为9223372036854775.807件。",
            "青松组库存为2.3456件。",
        ] {
            assert!(
                calculation_note(question, &[(2, a), (5, b)]).is_none(),
                "{a}"
            );
        }
        let a = "青松组库存为6件。";
        assert!(calculation_note(question, &[(1, a), (2, b), (3, "青松组库存为7件。")]).is_none());
        assert!(calculation_note(question, &[(1, a), (1, b)]).is_none());
        assert!(calculation_note("青松组与岩雀组的库存合计多少元？", &[(1, a), (2, b)]).is_none());
        assert!(calculation_note("青松组与青松组的库存合计多少件？", &[(1, a), (2, a)]).is_none());
        assert!(input_facets("青松组、岩雀组和甲组的库存合计多少件？").is_none());
        assert!(input_facets("上周青松组与岩雀组的库存合计多少件？").is_none());
    }
}
