//! A conservative numeric support check, not a claim that labels, units or the
//! model's interpretation have been fact-checked. Rejected blocks stay verbatim.
use crate::models::SearchResult;
use pulldown_cmark::{CodeBlockKind, Event, Parser, Tag, TagEnd};
use serde_json::value::RawValue;
use serde_json::Value;
use std::ops::Range;

mod citations;
pub(crate) use citations::{audit_citations, CitationCheck};
pub(crate) use citations::{audit_wiki_summary, SummaryIssue};

#[derive(Default)]
pub struct ChartAudit {
    pub warnings: Vec<String>,
    pub rejected: Vec<usize>,
}

fn decimal_identity(raw: &str) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() || raw.len() > 2048 {
        return None;
    }
    let negative = raw.starts_with('-');
    let unsigned = raw.trim_start_matches(['-', '+']);
    let mut parts = unsigned.split(['e', 'E']);
    let mantissa = parts.next()?;
    let mut exponent = match parts.next() {
        Some(p) => p.parse::<i32>().ok()?,
        None => 0,
    };
    if parts.next().is_some() {
        return None;
    }
    let mut fraction = false;
    let mut digits = String::new();
    for b in mantissa.bytes() {
        if b == b'.' && !fraction {
            fraction = true;
            continue;
        }
        if !b.is_ascii_digit() {
            return None;
        }
        digits.push(b as char);
        if fraction {
            exponent = exponent.checked_sub(1)?;
        }
    }
    let stripped = digits.trim_start_matches('0');
    if stripped.is_empty() {
        return Some("0".into());
    }
    let digits = stripped.trim_end_matches('0');
    exponent = exponent.checked_add((stripped.len() - digits.len()) as i32)?;
    Some(format!(
        "{}{digits}e{exponent}",
        if negative { "-" } else { "" }
    ))
}

fn numeric_tokens(text: &str) -> Vec<String> {
    number_spans(text, false)
        .into_iter()
        .map(|(_, value)| value)
        .collect()
}

fn number_spans(text: &str, allow_unit_suffix: bool) -> Vec<(Range<usize>, String)> {
    let bytes = text.as_bytes();
    let mut tokens = vec![];
    let mut i = 0;
    while i < bytes.len() {
        let begins = bytes[i].is_ascii_digit()
            || (bytes[i] == b'.' && bytes.get(i + 1).is_some_and(u8::is_ascii_digit))
            || (matches!(bytes[i], b'+' | b'-')
                && (bytes.get(i + 1).is_some_and(u8::is_ascii_digit)
                    || (bytes.get(i + 1) == Some(&b'.')
                        && bytes.get(i + 2).is_some_and(u8::is_ascii_digit))));
        if !begins {
            i += 1;
            continue;
        }
        let start = i;
        if matches!(bytes[i], b'+' | b'-') {
            i += 1;
        }
        while bytes.get(i).is_some_and(u8::is_ascii_digit) {
            i += 1;
        }
        let mut grouped = false;
        while bytes.get(i) == Some(&b',')
            && (1..=3).all(|n| bytes.get(i + n).is_some_and(u8::is_ascii_digit))
            && !bytes.get(i + 4).is_some_and(u8::is_ascii_digit)
        {
            grouped = true;
            i += 4;
        }
        if bytes.get(i) == Some(&b'.') && bytes.get(i + 1).is_some_and(u8::is_ascii_digit) {
            i += 1;
            while bytes.get(i).is_some_and(u8::is_ascii_digit) {
                i += 1;
            }
        }
        if matches!(bytes.get(i), Some(b'e' | b'E')) {
            let mut end = i + 1;
            if matches!(bytes.get(end), Some(b'+' | b'-')) {
                end += 1;
            }
            let digits = end;
            while bytes.get(end).is_some_and(u8::is_ascii_digit) {
                end += 1;
            }
            if end > digits {
                i = end;
            }
        }
        // Do not extract a numeric suffix of an identifier as support.
        let left = start == 0
            || !matches!(bytes[start - 1], b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'_');
        let right = !bytes
            .get(i)
            .is_some_and(|c| c.is_ascii_alphabetic() || *c == b'_');
        if left && (right || allow_unit_suffix) {
            let token = if grouped {
                text[start..i].replace(',', "")
            } else {
                text[start..i].to_string()
            };
            if let Some(n) = decimal_identity(&token) {
                tokens.push((start..i, n));
            }
        }
    }
    tokens
}

fn json_numbers(value: &RawValue, numbers: &mut Vec<String>) {
    json_numbers_depth(value, numbers, 0);
}
fn json_numbers_depth(value: &RawValue, numbers: &mut Vec<String>, depth: usize) {
    if depth > 32 || numbers.len() > 10000 {
        return;
    }
    let text = value.get().trim();
    if text.starts_with('{') {
        if let Ok(items) =
            serde_json::from_str::<std::collections::BTreeMap<String, &RawValue>>(text)
        {
            items
                .values()
                .for_each(|n| json_numbers_depth(n, numbers, depth + 1));
        }
    } else if text.starts_with('[') {
        if let Ok(items) = serde_json::from_str::<Vec<&RawValue>>(text) {
            items
                .iter()
                .for_each(|n| json_numbers_depth(n, numbers, depth + 1));
        }
    } else if text.starts_with(|c: char| c.is_ascii_digit() || c == '-') {
        if let Some(n) = decimal_identity(text) {
            numbers.push(n);
        }
    }
}
fn source_numbers(text: &str) -> Vec<String> {
    let mut numbers = vec![];
    if let Ok(value) = serde_json::from_str::<&RawValue>(text) {
        json_numbers(value, &mut numbers);
        return numbers;
    }
    let mut code = None::<String>;
    for event in Parser::new(text) {
        match event {
            Event::Start(Tag::CodeBlock(_)) => code = Some(String::new()),
            Event::Text(raw) if code.is_some() => code.as_mut().unwrap().push_str(&raw),
            Event::End(TagEnd::CodeBlock) if code.is_some() => {
                let raw = code.take().unwrap();
                if let Ok(value) = serde_json::from_str::<&RawValue>(&raw) {
                    json_numbers(value, &mut numbers);
                } else {
                    numbers.extend(numeric_tokens(&raw));
                }
            }
            Event::Code(raw) => {
                if let Ok(value) = serde_json::from_str::<&RawValue>(&raw) {
                    json_numbers(value, &mut numbers);
                } else {
                    numbers.extend(numeric_tokens(&raw));
                }
            }
            Event::Text(raw) => numbers.extend(numeric_tokens(&raw)),
            _ => {}
        }
    }
    numbers
}

fn check_chart(raw: &str, sources: &[SearchResult]) -> Result<(), &'static str> {
    if raw.len() > 50_000 {
        return Err("配置超过 50KB");
    }
    let value: Value = serde_json::from_str(raw).map_err(|_| "JSON 无效或不完整")?;
    let refs = value
        .get("sourceRefs")
        .and_then(Value::as_array)
        .ok_or("没有声明数值来源")?;
    if refs.is_empty() || refs.len() > sources.len() {
        return Err("没有可核对的来源");
    }
    let mut evidence = vec![];
    for reference in refs {
        let index = reference
            .as_str()
            .and_then(|s| s.strip_prefix('S'))
            .and_then(|s| {
                if s.starts_with('0') || s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
                    return None;
                }
                s.parse::<usize>().ok()?.checked_sub(1)
            })
            .ok_or("来源编号无效")?;
        let source = sources.get(index).ok_or("来源不属于本轮证据")?;
        evidence.extend(source_numbers(&source.text));
    }
    let series = value
        .get("series")
        .and_then(Value::as_array)
        .ok_or("缺少数值系列")?;
    if series.is_empty() || series.len() > 8 {
        return Err("数值系列数量无效");
    }
    let mut count = 0;
    for item in series {
        let values = item
            .get("values")
            .and_then(Value::as_array)
            .ok_or("系列数值无效")?;
        for number in values {
            count += 1;
            if count > 1000 {
                return Err("数据点超过保护上限");
            }
            if number.is_null() {
                continue;
            }
            let n = number
                .as_f64()
                .filter(|n| n.is_finite())
                .ok_or("数据点不是有限数值")?;
            if n.fract() == 0.0 && n.abs() > 9_007_199_254_740_991.0 {
                return Err("数值超过安全整数范围");
            }
            let identity = decimal_identity(&number.to_string()).ok_or("数据点格式无效")?;
            if !evidence.contains(&identity) {
                return Err("部分数值未在声明来源中找到，或需要尚未验证的计算");
            }
        }
    }
    if count == 0 {
        return Err("没有可核对的数据点");
    }
    Ok(())
}

pub fn audit_charts(answer: &str, sources: &[SearchResult]) -> ChartAudit {
    let mut audit = ChartAudit::default();
    let mut raw = None::<String>;
    let mut index = 0;
    for event in Parser::new(answer) {
        match event {
            Event::Start(Tag::CodeBlock(CodeBlockKind::Fenced(language)))
                if language
                    .split_whitespace()
                    .next()
                    .is_some_and(|s| s.eq_ignore_ascii_case("chart")) =>
            {
                raw = Some(String::new())
            }
            Event::Text(text) if raw.is_some() => raw.as_mut().unwrap().push_str(&text),
            Event::End(TagEnd::CodeBlock) if raw.is_some() => {
                if let Err(reason) = check_chart(&raw.take().unwrap(), sources) {
                    audit.rejected.push(index);
                    audit.warnings.push(format!(
                        "图表 {}：{}，已保留原文并暂停绘制。",
                        index + 1,
                        reason
                    ));
                }
                index += 1;
            }
            _ => {}
        }
    }
    audit
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sources() -> Vec<SearchResult> {
        vec![serde_json::from_value(serde_json::json!({
            "id":1,"path":"data.md","text":"一季度收入120万元，二季度收入150万元。价格是-2.5。编号ID999与3000不可混淆。", "heading":"收入","startLine":1,"endLine":1,"hash":"a","score":1.0,"evidence":true,"matchKind":"keyword"
        })).unwrap()]
    }
    fn block(values: &str, refs: &str) -> String {
        format!("```chart\n{{\"series\":[{{\"values\":{values}}}],\"sourceRefs\":{refs}}}\n```\n")
    }
    #[test]
    fn only_numbers_in_declared_current_sources_are_supported() {
        let source = sources();
        assert!(
            audit_charts(&block("[120,150,-2.5,null]", "[\"S1\"]"), &source)
                .rejected
                .is_empty()
        );
        for (values, refs) in [
            ("[999]", "[\"S1\"]"),
            ("[30]", "[\"S1\"]"),
            ("[120]", "[\"S2\"]"),
            ("[120]", "[]"),
            ("[9007199254740993]", "[\"S1\"]"),
            ("[\"120\"]", "[\"S1\"]"),
        ] {
            assert_eq!(
                audit_charts(&block(values, refs), &source).rejected,
                vec![0]
            );
        }
    }
    #[test]
    fn chart_indices_ignore_other_fences_and_preserve_answer() {
        let text = format!(
            "```json\n[2026]\n```\n{}{}",
            block("[120]", "[\"S1\"]"),
            block("[5]", "[\"S1\"]")
        );
        let before = text.clone();
        let audit = audit_charts(&text, &sources());
        assert_eq!(audit.rejected, vec![1]);
        assert_eq!(text, before);
        assert!(audit_charts("```chart\n{broken", &sources())
            .rejected
            .contains(&0));
    }
    #[test]
    fn formatted_numbers_and_json_arrays_do_not_support_partial_numeric_fragments() {
        assert_eq!(source_numbers("收入 1,200 万元"), vec!["12e2"]);
        assert_eq!(
            source_numbers("{\"values\":[120,150],\"id\":\"300\"}"),
            vec!["12e1", "15e1"]
        );
        assert_eq!(
            source_numbers("```json\n{\"values\":[120,150]}\n```"),
            vec!["12e1", "15e1"]
        );
        assert!(!source_numbers("收入 1,200 万元").contains(&"2e2".to_string()));
        assert!(!source_numbers("`{\"id\":\"120\"}`").contains(&"12e1".to_string()));
        assert!(!source_numbers("{\"price\":0.10000000000000001}")
            .contains(&decimal_identity("0.1").unwrap()));
        assert_ne!(
            decimal_identity("9007199254740990.9"),
            decimal_identity("9007199254740991")
        );
        assert_eq!(decimal_identity("1.200e2"), decimal_identity("120"));
        assert_eq!(numeric_tokens("小数 .5 和 -.25"), vec!["5e-1", "-25e-2"]);
    }
}
