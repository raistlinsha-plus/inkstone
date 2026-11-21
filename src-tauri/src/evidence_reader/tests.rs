use super::*;

fn source(path: &str, start: usize, text: &str) -> SearchResult {
    SearchResult {
        id: start as i64,
        text: text.into(),
        path: path.into(),
        start_line: start,
        end_line: start + text.lines().count().saturating_sub(1),
        hash: crate::files::hash(text),
        document_id: None,
        title: None,
        heading: String::new(),
        score: 0.,
        bm25_rank: None,
        bm25_score: None,
        vector_rank: None,
        vector_distance: None,
        rerank_score: None,
        evidence: false,
        match_kind: "candidate".into(),
    }
}

#[test]
fn partial_compound_points_to_exact_sentence_and_line() {
    let hits = [source(
        "a.md",
        12,
        "# 服务\n本月试运营。云杉书屋营业至 19:30。",
    )];
    let read = prepare("云杉书屋几点打烊，钟楼展演几点开场？", &hits, 4000);
    assert_eq!(read.facets().len(), 2);
    let quote = &read.facets()[0].quotes[0];
    assert_eq!(
        (quote.source_index, quote.start_line, quote.end_line),
        (0, 13, 13)
    );
    assert_eq!(quote.text, "云杉书屋营业至 19:30。");
    assert!(read.facets()[1].quotes.is_empty());
    let request: Value = serde_json::from_str(&read.model_request().unwrap()).unwrap();
    assert_eq!(request["facets"].as_array().unwrap().len(), 1);
    assert_eq!(request["facets"][0]["id"], 2);
    assert!(!request.to_string().contains("a.md"));
}

#[test]
fn preserves_conditions_units_and_actions_even_if_model_selects_otherwise() {
    for (question, text) in [
        ("云杉书屋周日几点打烊？", "云杉书屋周六 19:30 关闭。"),
        (
            "云杉书屋几点打烊？",
            "云杉书屋 09:30 开门，山丘影院 19:30 关闭。",
        ),
        (
            "北区滤芯更换时长是多少分钟？",
            "北区滤芯更换时长为 3 小时。",
        ),
        ("云杉书屋几点打烊？", "云杉书屋拟于 19:30 关闭。"),
        ("灯塔讲座几点开始？", "灯塔讲座地点另行通知。"),
        ("北门展览几点开场？", "南门展览于 10:30 开始。"),
        ("它几点打烊？", "云杉书屋营业至 19:30。"),
    ] {
        let hits = [source("a", 1, text)];
        let mut read = prepare(question, &hits, 4000);
        assert!(read.facets()[0].quotes.is_empty(), "{question}");
        if read.model_request().is_some() {
            read.apply_model(&json!({"selections":[{"facet":1,"sentences":[1]}]}))
                .unwrap();
            assert!(read.facets()[0].quotes.is_empty(), "{question} - {text}");
        }
    }
}

#[test]
fn model_can_bind_explicit_pending_notice_but_cannot_supply_quote_or_unknown_id() {
    let hits = [source("a", 8, "灯塔讲座安排另行通知。")];
    let question = "灯塔讲座几点开始？";
    let mut read = prepare(question, &hits, 4000);
    assert!(read.facets()[0].quotes.is_empty());
    assert!(read.model_request().is_some());
    read.apply_model(&json!({"selections":[{"facet":1,"sentences":[1]}]}))
        .unwrap();
    assert_eq!(read.facets()[0].quotes[0].text, hits[0].text);
    assert!(read.model_request().is_none());
    for invalid in [
        json!({"selections":[{"facet":1,"sentences":[3]}]}),
        json!({"selections":[{"facet":1,"sentences":[1],"answer":"10:00"}]}),
        json!({"selections":[{"facet":1,"sentences":[1,1]}]}),
        json!({"selections":[{"facet":1,"sentences":[1]},{"facet":1,"sentences":[]}]}),
        json!({"selections":[]}),
    ] {
        let mut read = prepare(question, &hits, 4000);
        assert!(read.apply_model(&invalid).is_err());
        assert!(read.facets()[0].quotes.is_empty());
        assert!(read.model_request().is_none());
    }
}

#[test]
fn table_cites_separate_original_header_and_matching_row() {
    let text="| 场馆 | 关闭时间 | 开放时间 |\n| --- | --- | --- |\n| 黄鹂室 | 17:00 | 06:00 |\n| 山雀室 | 19:00 | 07:00 |";
    let mut read = prepare("山雀室几点关门？", &[source("t", 31, text)], 4000);
    let quotes = &read.facets()[0].quotes;
    assert_eq!(quotes.len(), 2);
    assert_eq!((quotes[0].start_line, quotes[1].start_line), (31, 34));
    assert_eq!(quotes[1].text, "| 山雀室 | 19:00 | 07:00 |");
    read = prepare(
        "山雀室几点关门？",
        &[source("t", 31, &text.replace("19:00", "—"))],
        4000,
    );
    read.apply_model(&json!({"selections":[{"facet":1,"sentences":[2]}]}))
        .unwrap();
    assert!(read.facets()[0].quotes.is_empty());
}

#[test]
fn capped_packet_is_deduplicated_and_keeps_complete_unicode_sentences() {
    let mut hits: Vec<_> = (0..12)
        .map(|i| {
            source(
                &i.to_string(),
                1,
                &format!("灯塔{i}。{}", "晨光。".repeat(600)),
            )
        })
        .collect();
    let dup = hits[1].clone();
    hits[0] = dup;
    for budget in [0, 12, 3999, 7000] {
        let read = prepare("何时开灯？", &hits, budget);
        assert!(read.source_chars() <= budget.min(4000));
        assert!(read.passage_count() <= 7);
        if let Some(request) = read.model_request() {
            let request: Value = serde_json::from_str(&request).unwrap();
            let rows = request["sentences"].as_array().unwrap();
            assert!(rows
                .iter()
                .all(|s| s["text"].as_str().unwrap().ends_with('。')
                    && s["passage"].as_u64().unwrap() <= 8));
            assert_eq!(
                read.source_chars(),
                rows.iter()
                    .map(|s| s["text"].as_str().unwrap().chars().count())
                    .sum::<usize>()
            );
        }
    }
}

#[test]
fn preserves_contradictory_versions_and_never_splits_off_shared_restrictions() {
    let hits = [
        source("may", 4, "鹤鸣室 5 月通告规定 18:00 关闭。"),
        source("june", 2, "鹤鸣室 6 月通告规定 19:00 关闭。"),
    ];
    assert_eq!(
        prepare("鹤鸣室几点关门？", &hits, 4000).facets()[0]
            .quotes
            .len(),
        2
    );
    for question in [
        "仅根据六月记录，鹤鸣室几点关门？白鹤室几点关门？",
        "如果周日开放，鹤鸣室几点关门？白鹤室几点关门？",
        "鹤鸣室几点关门？其中几天提前？",
    ] {
        assert_eq!(split_facets(question), [question]);
    }
}

#[test]
fn rejects_denials_inverted_hours_and_nonanswers_of_the_same_topic() {
    for (question, text) in [
        ("云杉书屋几点关门？", "云杉书屋并非 20:00 关闭。"),
        ("云杉书屋几点开门？", "云杉书屋营业至 20:00。"),
        ("云杉书屋在哪里？", "云杉书屋在周五开放。"),
        ("云杉书屋负责人是谁？", "云杉书屋负责人演讲定于 09:30。"),
        ("云杉书屋编号是多少？", "云杉书屋编号复核流程是抽样。"),
    ] {
        let mut read = prepare(question, &[source("a", 1, text)], 4000);
        assert!(read.facets()[0].quotes.is_empty(), "{text}");
        read.apply_model(&json!({"selections":[{"facet":1,"sentences":[1]}]}))
            .unwrap();
        assert!(read.facets()[0].quotes.is_empty(), "{text}");
    }
}

#[test]
fn skips_draft_sections_until_another_section_at_the_same_level() {
    let body="# 记录\n## 草案\n云杉书屋 19:00 关闭。\n### 周日\n云杉书屋 18:00 关闭。\n## 已生效\n云杉书屋 20:00 关闭。";
    let read = prepare("云杉书屋几点打烊？", &[source("v", 1, body)], 4000);
    let quotes = &read.facets()[0].quotes;
    assert_eq!(quotes.len(), 1);
    assert_eq!(quotes[0].start_line, 7);
}

#[test]
fn source_heading_and_field_key_must_both_match_even_for_model_chosen_rows() {
    let body = "# 栗纹样片\n散射指数：K-71\n# 栗纹样盘\n散射指数：K-19\n散射指数复核方法：抽查";
    let hits = [source("private-path.md", 10, body)];
    let mut read = prepare("关于栗纹样片，散射指数一栏填了什么？", &hits, 4000);
    let request: Value = serde_json::from_str(&read.model_request().unwrap()).unwrap();
    assert_eq!(request["sentences"][0]["section"], "# 栗纹样片");
    assert!(!request.to_string().contains("private-path"));
    read.apply_model(&json!({"selections":[{"facet":1,"sentences":[1,2,3]}]}))
        .unwrap();
    let quotes = &read.facets()[0].quotes;
    assert_eq!(
        quotes
            .iter()
            .map(|s| (&*s.text, s.start_line))
            .collect::<Vec<_>>(),
        [("# 栗纹样片", 10), ("散射指数：K-71", 11)]
    );
}

#[test]
fn parallel_schedule_keeps_each_literal_owner_condition_and_value_together() {
    let hits=[source("r",1,"赤湾的夜班席由墨雪看管，换岗时间是周三 05:10。\n青沙的夜班席由松霭看管，换岗时间为周五 07:20。\n青沙的日班席已安排，换岗时间为周四 10:20。\n青沙的夜班席已安排，赤湾换岗时间为周四 19:40。\n赤湾的夜班席有两处，集合时间为周三 08:40。")];
    let read = prepare("赤湾和青沙夜班换岗分别在星期几、几点？", &hits, 4000);
    let q = &read.facets()[0].quotes;
    assert_eq!(q.iter().map(|s| s.start_line).collect::<Vec<_>>(), [1, 2]);
}

#[test]
fn explicit_record_keeps_conflicting_values_and_checks_the_column_unit() {
    let rows = [
        source(
            "a",
            1,
            "| 样品 | 形变量（米） |\n| --- | --- |\n| 五叶环 | 32 |\n| 五叶圈 | 44 |",
        ),
        source(
            "b",
            1,
            "| 样品 | 形变量（米） |\n| --- | --- |\n| 五叶环 | 33 |",
        ),
        source(
            "c",
            1,
            "| 样品 | 形变量（升） |\n| --- | --- |\n| 五叶环 | 39 |",
        ),
    ];
    let r = prepare("关于五叶环，形变量是多少米？", &rows, 4000);
    let q = &r.facets()[0].quotes;
    assert_eq!(
        q.iter()
            .filter(|s| s.text.contains("五叶"))
            .map(|s| s.text.as_str())
            .collect::<Vec<_>>(),
        ["| 五叶环 | 32 |", "| 五叶环 | 33 |"]
    );
}

#[test]
fn record_identity_is_whole_and_a_second_clause_cannot_disown_the_value() {
    for text in [
        "棕石二号的刻度为 4 米。",
        "棕石的刻度复核办法为 4 米。",
        "棕石的刻度为 4 米，但该数值已废止。",
        "棕石的刻度为 4 升。",
    ] {
        let mut read = prepare("棕石的刻度是多少米？", &[source("r", 1, text)], 4000);
        assert!(read.facets()[0].quotes.is_empty(), "{text}");
        if read.model_request().is_some() {
            read.apply_model(&json!({"selections":[{"facet":1,"sentences":[1]}]}))
                .unwrap();
            assert!(read.facets()[0].quotes.is_empty(), "{text}");
        }
    }
    let read = prepare(
        "和光试盘的饱和度是什么？",
        &[source("r", 1, "和光试盘的饱和度为 K-19。")],
        4000,
    );
    assert_eq!(read.facets()[0].quotes.len(), 1);
}

#[test]
fn coordinated_record_binds_non_time_quantities_with_an_explicit_unit() {
    let hits=[source("r",1,"东樽的满载样件已收，净重为 34 克。\n西尊的满载样件已收，净重为 37 克。\n西尊的空载样件已收，净重为 28 克。\n东樽的满载样件已收，净重为 7 升。")];
    let r = prepare("东樽与西尊满载净重分别是多少克？", &hits, 4000);
    assert_eq!(
        r.facets()[0]
            .quotes
            .iter()
            .map(|q| q.start_line)
            .collect::<Vec<_>>(),
        [1, 2]
    );
}

#[test]
fn enumerated_named_fields_preserve_the_missing_slot() {
    let r = prepare(
        "关于芦纹盘，刻度和表面涂层分别是什么？",
        &[source(
            "r",
            1,
            "# 芦纹盘\n刻度：四档\n# 芦纹袋\n表面涂层：漆面",
        )],
        4000,
    );
    assert_eq!(r.facets().len(), 2);
    assert_eq!(r.facets()[0].quotes[1].text, "刻度：四档");
    assert!(r.facets()[1].quotes.is_empty());
}
