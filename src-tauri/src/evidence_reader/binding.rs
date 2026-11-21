//! Independent checks on an ID selection. Relevance or a valid location alone
//! cannot bind a subject, qualifier, predicate and value to the same assertion.
use crate::db;

pub(super) fn has(text: &str, words: &[&str]) -> bool {
    words.iter().any(|word| text.contains(word))
}

pub(super) fn speculative(text: &str) -> bool {
    has(
        &text.to_lowercase(),
        &[
            "草案",
            "拟议",
            "提案",
            "拟定",
            "拟于",
            "预计",
            "预估",
            "可能",
            "也许",
            "假如",
            "如果",
            "原定",
            "原计划",
            "假设",
            "据说",
            "传闻",
            "待核实",
            "待确认",
            "尚未确认",
            "未生效",
            "征求意见",
            "作废",
            "已废止",
            "已废弃",
            "已停用",
            "已失效",
            "已取消",
            "暂定",
            "已撤回",
            "仅供讨论",
            "据猜测",
            "是否",
            "忽略之前",
            "忽略上述",
            "ignore previous",
            "ignore all",
            "proposed",
            "tentative",
            "draft",
            "maybe",
            "possibly",
            "hypothetical",
        ],
    )
}

pub(super) fn independent(text: &str) -> bool {
    has(
        text,
        &[
            "几",
            "多少",
            "多久",
            "多长",
            "何时",
            "何处",
            "何人",
            "何日",
            "谁",
            "哪",
            "什么",
            "能否",
            "能不能",
            "可否",
            "是否",
            "可不可以",
            "吗",
            "怎么",
            "如何",
            "怎样",
            "啥",
            "咋",
            "when",
            "where",
            "who",
            "what",
        ],
    ) && !["其中", "那它", "那么", "前者", "后者", "这两"]
        .iter()
        .any(|prefix| text.trim_start().starts_with(prefix))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum Support {
    Absent,
    Review,
    Exact,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Value {
    Clock,
    Date,
    Person,
    Place,
    Duration,
    Quantity,
    Money,
    Permission,
    Field,
}

fn normalize(text: &str) -> String {
    let mut lower = text.to_lowercase();
    for (from, to) in [
        ("星期", "周"),
        ("礼拜", "周"),
        ("周天", "周日"),
        ("关门", "关闭"),
        ("闭馆", "关闭"),
        ("打烊", "关闭"),
        ("收摊", "关闭"),
        ("停止开放", "关闭"),
        ("停止接待", "关闭"),
        ("开门", "开放"),
        ("开馆", "开放"),
        ("开始营业", "开放"),
        ("闭店", "关闭"),
        ("开讲", "开始"),
        ("开场", "开始"),
        ("开幕", "开始"),
        ("开课", "开始"),
        ("结束时间", "结束"),
        ("最迟", "截止"),
        ("截至", "截止"),
        ("最后一班", "末班"),
        ("第一班", "首班"),
        ("持续时间", "时长"),
        ("持续多久", "时长多久"),
        ("需要多久", "时长多久"),
        ("要多久", "时长多久"),
        ("由谁负责", "负责人是谁"),
        ("谁负责", "负责人是谁"),
        ("负责人员", "负责人"),
        ("由谁保管", "保管人是谁"),
        ("谁保管", "保管人是谁"),
        ("保管员", "保管人"),
        ("联系谁", "联系人是谁"),
        ("找谁联系", "联系人是谁"),
        ("到哪里", "在哪里"),
        ("到哪儿", "在哪里"),
        ("在哪儿", "在哪里"),
        ("多少块钱", "多少钱"),
        ("交还", "归还"),
        ("交回", "归还"),
        ("多久有效", "有效期多久"),
        ("存放位置", "存放地点"),
    ] {
        lower = lower.replace(from, to);
    }
    lower
}

pub(super) fn clock(text: &str) -> bool {
    text.match_indices([':', '：', '时', '点'])
        .any(|(at, separator)| {
            let digits = text[..at]
                .bytes()
                .rev()
                .take_while(u8::is_ascii_digit)
                .count();
            if !(1..=2).contains(&digits) {
                return false;
            }
            let hour = text[at - digits..at].parse::<u8>().unwrap_or(255);
            let right = &text[at + separator.len()..];
            let mins = right.bytes().take_while(u8::is_ascii_digit).count();
            hour < 24
                && if separator == "点" || separator == "时" {
                    mins == 0 || mins <= 2 && right[..mins].parse::<u8>().is_ok_and(|m| m < 60)
                } else {
                    mins == 2 && right[..mins].parse::<u8>().is_ok_and(|m| m < 60)
                }
        })
}

const UNPUBLISHED: &[&str] = &[
    "另行通知",
    "尚未公布",
    "尚未确定",
    "未公布",
    "未确定",
    "待定",
    "未定",
    "未发布",
];
pub(super) const UNITS: &[&str] = &[
    "毫克",
    "微克",
    "微米",
    "纳米",
    "千克",
    "公斤",
    "毫升",
    "毫米",
    "厘米",
    "千米",
    "公里",
    "毫秒",
    "秒",
    "工作日",
    "小时",
    "分钟",
    "秒钟",
    "个月",
    "天",
    "周",
    "元",
    "人",
    "名",
    "件",
    "张",
    "台",
    "本",
    "次",
    "份",
    "个",
    "米",
    "升",
    "克",
    "分贝",
    "度",
];
fn quantified(text: &str, units: &[&str]) -> bool {
    units.iter().any(|unit| {
        text.match_indices(unit).any(|(at, _)| {
            // A metric prefix can itself be a Chinese numeral (千克, 千米).
            // Match the complete unit attached to the number.
            if UNITS.iter().any(|other| {
                other.len() > unit.len()
                    && other.ends_with(unit)
                    && text[..at + unit.len()].ends_with(other)
            }) {
                return false;
            }
            text[..at]
                .trim_end()
                .chars()
                .next_back()
                .is_some_and(|c| c.is_ascii_digit() || "零一二两三四五六七八九十百千万".contains(c))
        })
    })
}

struct Relation {
    // Readable predicates shared by question and assertion after normalization.
    query: &'static [&'static str],
    facts: &'static [&'static str],
}
const RELATIONS: &[Relation] = &[
    Relation {
        query: &["关闭"],
        facts: &[
            "关闭",
            "开放至",
            "开放到",
            "营业至",
            "营业到",
            "延长至",
            "延长到",
        ],
    },
    Relation {
        query: &["结束"],
        facts: &["结束", "收工", "散场"],
    },
    Relation {
        query: &["开放"],
        facts: &["开放", "营业", "接待开始"],
    },
    Relation {
        query: &["开始"],
        facts: &["开始", "举行", "启动"],
    },
    Relation {
        query: &["截止"],
        facts: &["截止", "关闭报名"],
    },
    Relation {
        query: &["末班"],
        facts: &["末班"],
    },
    Relation {
        query: &["首班"],
        facts: &["首班"],
    },
    Relation {
        query: &["负责人"],
        facts: &["负责人", "负责", "牵头人", "承办人"],
    },
    Relation {
        query: &["联系人"],
        facts: &["联系人", "联系", "对接人"],
    },
    Relation {
        query: &["保管人"],
        facts: &["保管人", "保管"],
    },
    Relation {
        query: &["费用", "价格", "收费", "票价"],
        facts: &["费用", "价格", "收费", "票价", "售价", "免费", "免收"],
    },
    Relation {
        query: &["时长"],
        facts: &["时长", "持续", "耗时", "用时", "需要", "历时"],
    },
];
pub(super) struct Question {
    kind: Value,
    relation: Option<&'static Relation>,
    anchors: Vec<String>,
    phrase: String,
    unit: Option<&'static str>,
    valid: bool,
}

impl Question {
    pub(super) fn new(text: &str) -> Self {
        let mut q = normalize(text.trim().trim_end_matches(['？', '?', '。']));
        if q.ends_with("几点关") {
            q.push('闭');
        }
        let relational = RELATIONS.iter().find(|r| has(&q, r.query));
        let kind = if has(&q, &["几点", "何时", "什么时候", "什么时间", "时刻"]) {
            Value::Clock
        } else if has(&q, &["哪天", "哪一天", "何日", "日期", "几月", "几号"]) {
            Value::Date
        } else if has(
            &q,
            &[
                "在哪里",
                "在哪",
                "哪里",
                "哪儿",
                "何处",
                "什么地方",
                "哪个地点",
                "位置",
                "地点",
            ],
        ) {
            Value::Place
        } else if has(&q, &["谁", "哪位", "何人"]) {
            Value::Person
        } else if has(
            &q,
            &[
                "多久",
                "多长时间",
                "多少分钟",
                "几个小时",
                "几小时",
                "几天",
                "时长",
            ],
        ) {
            Value::Duration
        } else if has(
            &q,
            &[
                "多少钱",
                "几元",
                "多少元",
                "费用",
                "收费",
                "价格",
                "票价",
                "押金",
                "租金",
            ],
        ) {
            Value::Money
        } else if has(
            &q,
            &[
                "能否",
                "能不能",
                "允不允许",
                "可否",
                "可不可以",
                "是否允许",
                "可以",
                "允许",
            ],
        ) {
            Value::Permission
        } else if has(
            &q,
            &[
                "编号", "代码", "号码", "代号", "地址", "型号", "颜色", "口令",
            ],
        ) {
            Value::Field
        } else if has(&q, &["多少", "几个", "几名", "几人", "几次", "几份"]) {
            Value::Quantity
        } else {
            Value::Field
        };
        let mut subject = q.clone();
        if let Some(rel) = relational {
            for word in rel.query {
                subject = subject.replace(word, " ");
            }
        }
        let unit = UNITS.iter().copied().find(|u| {
            ["多少", "几个", "几"]
                .iter()
                .any(|prefix| q.contains(&format!("{prefix}{u}")))
        });
        for word in [
            "请问",
            "请告诉我",
            "请告诉",
            "我想知道",
            "该文档中",
            "这份文档",
            "这篇文档",
            "这份资料",
            "当前文档",
            "是什么时候",
            "在什么时候",
            "什么时候",
            "什么时间",
            "几点钟",
            "几点",
            "哪一天",
            "哪天",
            "何日",
            "几月几号",
            "几月几日",
            "多少时间",
            "多长时间",
            "在哪里",
            "在哪个位置",
            "在哪个地方",
            "在哪个地点",
            "在哪",
            "哪里",
            "哪儿",
            "何处",
            "什么地方",
            "位置",
            "地点",
            "何时",
            "时刻",
            "是什么",
            "是什么人",
            "哪位",
            "何人",
            "是谁",
            "谁",
            "是几",
            "是多少钱",
            "多少钱",
            "为多少",
            "是多少",
            "有多少",
            "多少",
            "多久",
            "多长",
            "能不能",
            "可不可以",
            "允不允许",
            "是否允许",
            "允许",
            "能否",
            "可否",
            "可以",
            "是否",
            "哪个",
            "什么",
            "几个",
            "几",
            "的",
            "吗",
            "呢",
            "？",
            "?",
            "。",
            "是",
            "为",
        ] {
            subject = subject.replace(word, " ");
        }
        if let Some(unit) = unit {
            subject = subject.replace(unit, " ");
        }
        let raw: Vec<_> = db::query_terms(subject.trim())
            .into_iter()
            .filter(|t| t.chars().all(char::is_alphanumeric))
            .collect();
        let anchors: Vec<_> = raw
            .iter()
            .filter(|t| {
                !raw.iter()
                    .any(|other| t != &other && other.contains(t.as_str()))
            })
            .cloned()
            .collect();
        let valid = independent(&q)
            && q.chars().count() <= 200
            && !anchors.is_empty()
            && !has(
                &q,
                &[
                    "只看",
                    "只用",
                    "只根据",
                    "只查",
                    "仅根据",
                    "不要",
                    "排除",
                    "除了",
                    "假设",
                    "假如",
                    "前者",
                    "后者",
                    "其中",
                    "合计",
                    "总共",
                    "相差",
                    "分别",
                    "各自",
                    "它",
                    "那个",
                    "这个",
                    "这两个",
                    "这两份",
                ],
            )
            && !q.contains(['？', '?', '；', ';', '，', ',']);
        Self {
            kind,
            relation: relational,
            phrase: subject.split_whitespace().collect(),
            anchors,
            unit,
            valid,
        }
    }

    fn affirmative_required(&self, clause: &str) -> bool {
        self.kind != Value::Permission
            && clause.contains(['不', '没', '未', '勿', '别', '无'])
            && crate::db::segmenter().tag(clause, true).iter().any(|part| {
                ["不", "没", "未", "勿", "无", "禁止", "严禁", "别"].contains(&part.word)
                    || part.word.starts_with(['不', '没', '未', '勿', '无'])
                        && part.tag.starts_with(['v', 'd'])
            })
    }

    // Explicit semantic conflicts also exclude a legacy search hit from
    // ordinary model context. Unknown values can themselves be evidence.
    pub(super) fn conflicts_with_original(&self, text: &str) -> bool {
        let line = normalize(text);
        if !self.phrase.is_empty()
            && line.match_indices(&self.phrase).any(|(at, name)| {
                let tail = line[at + name.len()..].trim_start();
                let rest = tail.trim_start_matches(|c: char| {
                    c.is_ascii_digit() || "一二三四五六七八九十".contains(c)
                });
                rest != tail
                    && rest
                        .trim_start()
                        .starts_with(['号', '型', '代', '班', '组', '期', '馆', '室'])
            })
        {
            return true;
        }
        if let Some(relation) = self.relation {
            let named_other = line.split(['，', ',', '；', ';', '。']).any(|clause| {
                let Some(before) = relation
                    .facts
                    .iter()
                    .filter_map(|label| clause.split_once(label).map(|p| p.0))
                    .min_by_key(|p| p.len())
                else {
                    return false;
                };
                let subject = before.trim().trim_end_matches(['的', '在', '于']);
                self.phrase.chars().count() >= 2
                    && subject.chars().count() >= 2
                    && subject.chars().all(char::is_alphabetic)
                    && !self.phrase.contains(subject)
                    && !subject.contains(&self.phrase)
                    && crate::db::segmenter()
                        .tag(subject, true)
                        .iter()
                        .all(|p| p.tag.starts_with('n'))
            });
            if named_other {
                return true;
            }
        }
        // For a fact question, a denied action is not an affirmative value.
        // A question about permission or an explicit “未公布” retains its natural polarity.
        let relevant = self.relation.is_some_and(|r| has(&line, r.facts))
            || self.anchors.iter().any(|a| line.contains(a));
        relevant
            && self.kind != Value::Permission
            && !has(&line, UNPUBLISHED)
            && has(
                &line,
                &[
                    "并非",
                    "并不",
                    "并未",
                    "不是",
                    "不会",
                    "不代表",
                    "无关",
                    "未生效",
                    "不得",
                    "禁止",
                    "从未",
                    "不在",
                    "没有",
                ],
            )
    }

    // A verified span still has to supply the sort of value the user asked
    // for. This guard does not require a known synonym for the predicate.
    pub(super) fn semantic_value(&self, clause: &str, value: &str) -> bool {
        let line = normalize(clause);
        if self.unit.is_some_and(|u| !quantified(value, &[u])) {
            return false;
        }
        if !has(clause, UNPUBLISHED) && self.affirmative_required(&line) {
            return false;
        }
        if self.kind != Value::Permission
            && has(
                &line,
                &[
                    "并非",
                    "并不",
                    "不会",
                    "不再",
                    "未曾",
                    "并未",
                    "不是",
                    "没有",
                    "未在",
                    "不应",
                    "不能",
                    "禁止",
                    "不得",
                    "无需",
                    "从未",
                    "无关",
                    "不代表",
                    "未生效",
                ],
            )
        {
            return false;
        }
        if let Some(relation) = self.relation {
            let inverse = match relation.query {
                ["关闭"] => Some("开放"),
                ["开放"] => Some("关闭"),
                ["开始"] => Some("结束"),
                ["结束"] => Some("开始"),
                ["首班"] => Some("末班"),
                ["末班"] => Some("首班"),
                _ => None,
            };
            if inverse.is_some_and(|other| line.contains(other) && !has(&line, relation.facts))
                || relation.query == ["开放"]
                    && has(&line, &["开放至", "开放到", "营业至", "营业到"])
            {
                return false;
            }
        }
        let normalized = normalize(value);
        match self.kind {
            Value::Clock => {
                clock(&normalized)
                    || (has(value, UNPUBLISHED) && has(&line, &["时间", "安排", "日程"]))
            }
            Value::Date => {
                crate::evidence::month_days(value).next().is_some()
                    || ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
                        .iter()
                        .any(|day| normalized.contains(day))
            }
            Value::Duration => quantified(
                value,
                &["分钟", "小时", "秒钟", "秒", "天", "工作日", "周", "个月"],
            ),
            Value::Quantity => {
                quantified(value, UNITS)
                    || self.unit.is_none() && value.chars().any(|c| c.is_ascii_digit())
            }
            Value::Money => quantified(value, &["元"]) || has(value, &["免费", "免收"]),
            Value::Place => {
                !(has(&normalized, &["在周", "每周", "在工作日", "在节假日"]) || clock(value))
            }
            Value::Person => !clock(value) && !value.contains(|c: char| c.is_ascii_digit()),
            Value::Field | Value::Permission => true,
        }
    }

    pub(super) fn heading_field(&self, heading: &str, row: &str) -> Support {
        let Some((label, _)) = row.split_once(['：', ':', '=']) else {
            return Support::Absent;
        };
        let label = normalize(label.trim());
        let action = label
            .strip_suffix("时间")
            .or_else(|| label.strip_suffix("时刻"))
            .unwrap_or(&label);
        if !self.relation.is_some_and(|r| r.facts.contains(&action)) {
            return Support::Absent;
        }
        self.prose_clause(&format!("{heading} {row}"))
    }

    pub(super) fn prose_clause(&self, text: &str) -> Support {
        if self.valid {
            self.clause(&normalize(text))
        } else {
            Support::Absent
        }
    }

    fn clause(&self, clause: &str) -> Support {
        if self.anchors.iter().any(|a| !clause.contains(a)) {
            return Support::Absent;
        }
        // A name followed by a model or branch number identifies another
        // object even when all the query terms and the predicate are present.
        if !self.phrase.is_empty()
            && clause.contains(&self.phrase)
            && clause.match_indices(&self.phrase).all(|(at, _)| {
                let tail = clause[at + self.phrase.len()..].trim_start();
                let digits = tail.trim_start_matches(|c: char| {
                    c.is_ascii_digit() || "一二三四五六七八九十".contains(c)
                });
                digits != tail
                    && digits
                        .trim_start()
                        .starts_with(['号', '型', '代', '班', '组', '期', '馆', '室'])
            })
        {
            return Support::Absent;
        }
        if !has(clause, UNPUBLISHED) && self.affirmative_required(clause) {
            return Support::Absent;
        }
        let relation = self.relation.is_none_or(|rel| has(clause, rel.facts));
        let unknown = has(clause, UNPUBLISHED);
        if !relation {
            // A notice may explicitly defer the whole event. It cannot answer
            // a time query by deferring an unrelated attribute such as its venue.
            return if self.kind == Value::Clock
                && unknown
                && has(clause, &["安排另行通知", "时间另行通知", "时间待定"])
                && !has(clause, &["地点", "场地", "位置", "票价"])
            {
                Support::Review
            } else {
                Support::Absent
            };
        }
        // A denied numeric statement supplies no affirmative time or value.
        if self.kind != Value::Permission
            && !unknown
            && has(
                clause,
                &[
                    "不会",
                    "并非",
                    "不是",
                    "没有",
                    "不得",
                    "并未",
                    "不在",
                    "不于",
                    "未在",
                    "不开放",
                    "不关闭",
                    "未开始",
                    "并不",
                    "不代表",
                    "并无",
                    "无关",
                    "禁止",
                ],
            )
        {
            return Support::Absent;
        }
        if self.relation.is_some_and(|rel| rel.query == ["开放"])
            && has(
                clause,
                &["开放至", "开放到", "营业至", "营业到", "停止营业"],
            )
        {
            return Support::Absent;
        }

        let declared = has(
            clause,
            &["为", "是", "：", ":", "由", "设在", "设于", "定于", "交给"],
        );
        let value = match self.kind {
            Value::Clock => clock(clause) || unknown,
            Value::Date => crate::evidence::month_days(clause).next().is_some() || unknown,
            Value::Duration => {
                quantified(
                    clause,
                    &["分钟", "小时", "秒钟", "天", "工作日", "周", "个月"],
                ) || unknown
            }
            Value::Money => {
                quantified(clause, &["元"]) || has(clause, &["免费", "免收"]) || unknown
            }
            Value::Quantity => {
                self.unit
                    .map_or_else(|| quantified(clause, UNITS), |u| quantified(clause, &[u]))
                    || unknown
            }
            Value::Person => {
                self.relation.is_some_and(|rel| {
                    rel.facts.iter().any(|label| {
                        clause.split_once(label).is_some_and(|(before, after)| {
                            has(before, &["由"])
                                || ["为", "是", "：", ":"].iter().any(|link| {
                                    after.trim_start().strip_prefix(link).is_some_and(|name| {
                                        name.trim().starts_with(char::is_alphabetic)
                                    })
                                })
                        })
                    })
                }) || unknown
            }
            Value::Place => {
                // A temporal 在 (e.g. "在周五开放") does not provide a place.
                [
                    "位于",
                    "设在",
                    "设于",
                    "放在",
                    "存于",
                    "归还至",
                    "归还到",
                    "地点为",
                    "地点是",
                    "位置为",
                    "位置是",
                    "在",
                ]
                .iter()
                .any(|link| {
                    clause.split_once(link).is_some_and(|(_, place)| {
                        let place = place
                            .trim_matches(|c: char| c.is_whitespace() || "。；.！".contains(c));
                        !place.is_empty()
                            && !["周", "每", "当天", "本周", "工作日", "节假日"]
                                .iter()
                                .any(|word| place.starts_with(word))
                            && (link != &"在"
                                || has(
                                    place,
                                    &[
                                        "门", "楼", "层", "馆", "站", "厅", "库", "室", "台", "区",
                                        "街", "路", "处", "侧", "柜", "箱", "架", "桥", "园", "场",
                                        "桌", "道",
                                    ],
                                ))
                    })
                }) || unknown
            }
            Value::Permission => has(
                clause,
                &[
                    "允许",
                    "许可",
                    "不得",
                    "不准",
                    "禁止",
                    "可以",
                    "不能",
                    "不可",
                    "准许",
                    "仅限",
                    "无需",
                    "不允许",
                ],
            ),
            Value::Field => {
                declared
                    && self.anchors.iter().any(|anchor| {
                        clause.split_once(anchor).is_some_and(|(_, after)| {
                            ["为", "是", "：", ":", "="].iter().any(|link| {
                                after.trim_start().strip_prefix(link).is_some_and(|value| {
                                    value
                                        .trim()
                                        .chars()
                                        .next()
                                        .is_some_and(char::is_alphanumeric)
                                })
                            })
                        })
                    })
            }
        };
        if !value || !unknown && self.unit.is_some_and(|unit| !quantified(clause, &[unit])) {
            return Support::Absent;
        }
        // A number without an explicit action or field name can be a different
        // attribute of the same subject. Delegate close readings to the model.
        let specific = self.relation.is_some()
            || self.anchors.len() >= 2
            || matches!(self.kind, Value::Place | Value::Permission);
        if specific && self.phrase.chars().count() >= 2 && clause.contains(&self.phrase) {
            Support::Exact
        } else {
            Support::Review
        }
    }

    pub(super) fn table(&self, header: &str, row: &str) -> Support {
        if !self.valid {
            return Support::Absent;
        }
        let cells = |line: &str| {
            line.trim()
                .trim_matches('|')
                .split('|')
                .map(|c| normalize(c.trim()))
                .collect::<Vec<_>>()
        };
        let (columns, values) = (cells(header), cells(row));
        if columns.len() != values.len() || values.len() < 2 || values[0].is_empty() {
            return Support::Absent;
        }
        let key = &values[0];
        if !self.anchors.iter().any(|anchor| key.contains(anchor)) {
            return Support::Absent;
        }
        columns
            .iter()
            .zip(&values)
            .skip(1)
            .filter(|(_, val)| !val.trim().is_empty() && !matches!(val.trim(), "-" | "—" | "/"))
            .filter(|(column, _)| {
                self.relation.is_some_and(|rel| has(column, rel.facts))
                    || self.anchors.iter().any(|a| column.contains(a))
                    || self.kind == Value::Place && has(column, &["地点", "位置"])
                    || self.kind == Value::Clock && column.trim() == "时间"
            })
            .map(|(column, value)| {
                let mut assertion = format!("{key} {column}为{value}");
                // A numeric cell may take its unit from its own column header.
                if value.parse::<f64>().is_ok() {
                    if let Some(unit) = UNITS.iter().find(|unit| {
                        column.ends_with(&format!("（{unit}）"))
                            || column.ends_with(&format!("({unit})"))
                    }) {
                        assertion.push_str(unit);
                    }
                }
                self.clause(&assertion)
            })
            .max()
            .unwrap_or(Support::Absent)
    }
}
