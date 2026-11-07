use super::*;
fn response(sources: Vec<SearchResult>) -> ChatResponse {
    ChatResponse {
        memory: None,
        finish_reason: "stop".into(),
        text: "OLD_MODEL_UNSUPPORTED_满意度100%".into(),
        sources,
        warning: None,
        retrieval_mode: "bm25".into(),
        rerank_status: "disabled".into(),
        model: "local-fixture".into(),
        scope: None,
        chart_warnings: vec![],
        rejected_charts: vec![],
    }
}
fn fixture(data: &Path) -> (Workspace, Conversation, String, Vec<SearchResult>) {
    let mut sources = vec![];
    for (title, body) in [
        ("青石阅读站.md", "人数：甲方案120人。日期：周二。场地：北岸馆。年龄：12岁。渠道：现场报名。时长：60分钟。费用：0元。容量：200人。老师：青禾。电话：未提供。地址：北岸路。路线：步行。座位：120个。图书：20册。"),
        ("白帆读书社.md", "人数：乙方案80人。日期：周四。场地：白帆馆。年龄：15岁。渠道：线上报名。时长：90分钟。费用：0元。容量：100人。老师：白帆。电话：未提供。地址：白帆路。路线：步行。座位：80个。图书：20册。"),
    ] {
        let d = library::create_document(data, "inbox", title, body).unwrap();
        sources.push(serde_json::from_value(serde_json::json!({"id":sources.len()+1,"path":d.path,"documentId":d.id,"title":d.title,"text":body,"heading":"人数","hash":files::hash(body),"startLine":1,"endLine":1,"score":1.0,"bm25Rank":1,"evidence":true,"matchKind":"keyword"})).unwrap());
    }
    let ws = crate::documents::library_workspace(data, "inbox").unwrap();
    let space = workspace_id(data, &ws);
    let c = create(data, &space, None, "当前空间".into(), None).unwrap();
    let start = begin_with_mode(
        data,
        &space,
        &c.id,
        c.revision,
        "比较青石阅读站与白帆读书社的人数、日期、场地、年龄、渠道、时长、费用、容量、老师、电话、地址、路线、座位和图书",
        None,
        None,
        "grounding-first",
        "keyword",
    )
    .unwrap();
    let c = finish(data, &space, &start, Ok(&response(sources.clone())), false).unwrap();
    (ws, c, start.turn_id, sources)
}
fn follow(data: &Path, ws: &Workspace, c: &Conversation, parent: &str, question: &str) -> Started {
    begin_with_mode(
        data,
        &workspace_id(data, ws),
        &c.id,
        c.revision,
        question,
        Some(parent),
        None,
        &Uuid::new_v4().to_string(),
        "hybrid",
    )
    .unwrap()
}
#[test]
fn current_satisfaction_requirement_cannot_be_granted_by_previous_count_question_or_model_claim() {
    let data = tempfile::tempdir().unwrap();
    let (ws, c, parent, mut candidates) = fixture(data.path());
    // Reproduce the unsafe old approach: many prior attributes outvote one missing
    // new attribute under the global 2/3 evidence rule.
    let unsafe_history_query = format!("{}\n追问：它们哪个满意度更高？", c.turns[0].question);
    crate::retrieval::mark_lexical_evidence(&unsafe_history_query, &mut candidates);
    assert!(
        candidates.iter().all(|r| r.evidence),
        "fixture must reproduce historical predicate dilution"
    );
    let start = follow(data.path(), &ws, &c, &parent, "它们哪个满意度更高？");
    let prepared = prepare(data.path(), &ws, &start).unwrap();
    assert!(prepared.clarification.is_none());
    assert!(prepared.retrieval_question.contains("青石阅读站"));
    assert!(prepared.retrieval_question.contains("满意度"));
    assert!(!prepared.retrieval_question.contains("人数"));
    assert!(!prepared.retrieval_question.contains("100%"));
    assert!(!start.prompt_question.contains("OLD_MODEL_UNSUPPORTED"));
    tighten(prepared.gate.as_ref().unwrap(), &mut candidates);
    assert!(candidates.iter().all(|r| !r.evidence));
    assert!(crate::retrieval::generation_context(&ws, &candidates, 16000, false).is_empty());
}
#[test]
fn trusted_names_assist_same_attribute_recall_but_never_upgrade_a_rerank_reject() {
    let data = tempfile::tempdir().unwrap();
    let (ws, c, parent, mut candidates) = fixture(data.path());
    let start = follow(data.path(), &ws, &c, &parent, "它们的人数呢？");
    let prepared = prepare(data.path(), &ws, &start).unwrap();
    crate::retrieval::mark_lexical_evidence(&prepared.retrieval_question, &mut candidates);
    assert!(candidates.iter().all(|r| r.evidence));
    let gate = prepared.gate.unwrap();
    assert_eq!(gate.attributes, vec!["人数"]);
    tighten(&gate, &mut candidates);
    assert!(candidates.iter().all(|r| r.evidence));
    candidates[0].evidence = false;
    tighten(&gate, &mut candidates);
    assert!(!candidates[0].evidence);
    assert!(candidates[1].evidence);
    let mut foreign = candidates[1].clone();
    foreign.path = "other.md".into();
    foreign.evidence = true;
    tighten(&gate, std::slice::from_mut(&mut foreign));
    assert!(!foreign.evidence);
}
#[test]
fn no_trusted_source_or_no_current_attribute_returns_local_clarification() {
    let data = tempfile::tempdir().unwrap();
    let (ws, c, parent, _) = fixture(data.path());
    let start = follow(data.path(), &ws, &c, &parent, "哪个更高？");
    assert!(prepare(data.path(), &ws, &start)
        .unwrap()
        .clarification
        .is_some());
    let empty = begin_with_mode(
        data.path(),
        &workspace_id(data.path(), &ws),
        &c.id,
        get(data.path(), &workspace_id(data.path(), &ws), &c.id)
            .unwrap()
            .revision,
        "它们的满意度呢",
        None,
        None,
        "no-source",
        "keyword",
    )
    .unwrap();
    assert!(prepare(data.path(), &ws, &empty)
        .unwrap()
        .clarification
        .is_some());
}
#[test]
fn changed_or_removed_referents_cannot_silently_bind_to_new_content() {
    let data = tempfile::tempdir().unwrap();
    let (ws, c, parent, sources) = fixture(data.path());
    let start = follow(data.path(), &ws, &c, &parent, "它们的人数呢？");
    let path = files::resolve(&ws.root, &sources[0].path, false).unwrap();
    fs::write(path, "外部修改后的新内容").unwrap();
    assert!(prepare(data.path(), &ws, &start)
        .unwrap()
        .clarification
        .is_some());
}

#[test]
fn explicit_subject_prefixes_are_not_mistaken_for_a_missing_pronoun() {
    assert!(!is_followup("再生能源的补贴条件是什么", true));
    assert!(!is_followup("那曲县的人口是多少", true));
    assert!(!is_followup("那青禾方案的报名人数是多少", true));
    assert!(!is_followup("分别列出青禾方案和白帆方案的人数", false));
    assert!(is_followup("它的预算是多少", false));
    assert!(is_followup("那它的预算呢", true));
    assert!(is_followup("分别列出报名人数", true));
}

#[test]
fn first_question_resolves_fixed_document_or_explicit_name_but_not_unsupported_pronouns() {
    let data = tempfile::tempdir().unwrap();
    let doc = library::create_document(
        data.path(),
        "inbox",
        "青禾方案.md",
        "报名人数120人，未提供预算。",
    )
    .unwrap();
    let ws = crate::documents::library_workspace(data.path(), "inbox").unwrap();
    let space = workspace_id(data.path(), &ws);
    for (scope, q, clarify) in [
        (
            Some(doc.path.clone()),
            "这份青禾方案的报名人数是多少？",
            false,
        ),
        (Some(doc.path.clone()), "这份文档的预算是多少？", false),
        (None, "这份青禾方案的报名人数是多少？", false),
        (None, "它们的预算是多少？", true),
    ] {
        let c = create(data.path(), &space, scope, "当前范围".into(), None).unwrap();
        let s = begin_with_mode(
            data.path(),
            &space,
            &c.id,
            c.revision,
            q,
            None,
            None,
            &Uuid::new_v4().to_string(),
            "keyword",
        )
        .unwrap();
        let prepared = prepare(data.path(), &ws, &s).unwrap();
        assert_eq!(prepared.clarification.is_some(), clarify, "{q}");
        assert!(prepared.retrieval_question.contains(if q.contains("预算") {
            "预算"
        } else {
            "报名人数"
        }));
    }
}
