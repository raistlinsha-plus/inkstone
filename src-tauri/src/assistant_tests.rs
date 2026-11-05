use super::*;
fn make(data: &Path, workspace: &str) -> Conversation {
    create(data, workspace, None, "当前空间".into(), None).unwrap()
}
fn response(text: &str) -> ChatResponse {
    ChatResponse {
        finish_reason: "stop".into(),
        text: text.into(),
        sources: vec![],
        warning: None,
        retrieval_mode: "bm25".into(),
        rerank_status: "disabled".into(),
        model: "test-fixture".into(),
        scope: None,
        chart_warnings: vec![],
        rejected_charts: vec![],
    }
}
fn start(data: &Path, c: &Conversation, q: &str, parent: Option<&str>) -> Started {
    begin(
        data,
        "space-a",
        &c.id,
        c.revision,
        q,
        parent,
        None,
        &Uuid::new_v4().to_string(),
    )
    .unwrap()
}
fn begin(
    data: &Path,
    workspace: &str,
    id: &str,
    expected: i64,
    question: &str,
    parent: Option<&str>,
    regenerate: Option<&str>,
    request: &str,
) -> Result<Started, String> {
    begin_with_mode(
        data, workspace, id, expected, question, parent, regenerate, request, "hybrid",
    )
}
#[test]
fn spaces_are_authorized_and_scope_draft_identity_survive_reopen() {
    let data = tempfile::tempdir().unwrap();
    let c = create(
        data.path(),
        "space-a",
        Some("note.md".into()),
        "当前文档 · note".into(),
        None,
    )
    .unwrap();
    assert!(get(data.path(), "space-b", &c.id).is_err());
    assert!(update(
        data.path(),
        "space-b",
        &c.id,
        c.revision,
        None,
        None,
        Some("not allowed".into()),
        None
    )
    .is_err());
    assert!(list(data.path(), "space-b", true, "").unwrap().is_empty());
    let u = update(
        data.path(),
        "space-a",
        &c.id,
        c.revision,
        Some("归档测试".into()),
        Some(true),
        Some("保留中文草稿".into()),
        None,
    )
    .unwrap();
    assert!(list(data.path(), "space-a", false, "").unwrap().is_empty());
    assert_eq!(
        get(data.path(), "space-a", &c.id).unwrap().draft,
        "保留中文草稿"
    );
    assert_eq!(u.scope.as_deref(), Some("note.md"));
    assert_eq!(list(data.path(), "space-a", true, "归档").unwrap().len(), 1);
    assert!(update(
        data.path(),
        "space-a",
        &c.id,
        c.revision,
        None,
        None,
        Some("stale".into()),
        None
    )
    .is_err());
}
#[test]
fn bounded_user_context_preserves_branches_but_never_replays_assistant_facts() {
    let data = tempfile::tempdir().unwrap();
    let c = make(data.path(), "space-a");
    let first = start(data.path(), &c, "比较甲乙方案人数", None);
    let c = finish(
        data.path(),
        "space-a",
        &first,
        Ok(&response("SECRET_UNSUPPORTED_MODEL_FACT")),
        false,
    )
    .unwrap();
    let follow = start(data.path(), &c, "它们满意度如何", Some(&first.turn_id));
    assert_eq!(follow.grounded_question, "它们满意度如何");
    assert!(!follow.grounded_question.contains("人数"));
    assert!(follow.prompt_question.contains("此前用户问题"));
    assert!(!follow
        .prompt_question
        .contains("SECRET_UNSUPPORTED_MODEL_FACT"));
    let c = finish(
        data.path(),
        "space-a",
        &follow,
        Ok(&response("资料不足")),
        false,
    )
    .unwrap();
    let branch = start(data.path(), &c, "改问丙方案", None);
    assert_eq!(branch.grounded_question, "改问丙方案");
    assert_eq!(branch.prompt_question, "改问丙方案");
    let c = finish(
        data.path(),
        "space-a",
        &branch,
        Ok(&response("另一分支")),
        false,
    )
    .unwrap();
    assert_eq!(c.turns.len(), 3);
    assert_eq!(
        c.turns[1].parent_turn_id.as_deref(),
        Some(first.turn_id.as_str())
    );
    assert_eq!(c.turns[2].parent_turn_id, None);
    validate_snapshot(&data.path().join("assistant.sqlite3")).unwrap();
}
#[test]
fn candidates_retry_and_draft_edit_are_independent() {
    let data = tempfile::tempdir().unwrap();
    let c = make(data.path(), "space-a");
    let first = begin_with_mode(
        data.path(),
        "space-a",
        &c.id,
        c.revision,
        "测试候选",
        None,
        None,
        "mode-first",
        "keyword",
    )
    .unwrap();
    let pending = get(data.path(), "space-a", &c.id).unwrap();
    let updated = update(
        data.path(),
        "space-a",
        &c.id,
        pending.revision,
        None,
        None,
        Some("生成时编辑下一问".into()),
        None,
    )
    .unwrap();
    let c = finish(data.path(), "space-a", &first, Err("已停止生成"), true).unwrap();
    assert_eq!(c.draft, "生成时编辑下一问");
    assert!(c.revision > updated.revision);
    assert_eq!(c.turns[0].candidates[0].status, "stopped");
    let retry = begin_with_mode(
        data.path(),
        "space-a",
        &c.id,
        c.revision,
        "客户端伪造的问题",
        None,
        Some(&first.turn_id),
        "retry-2",
        "rerank",
    )
    .unwrap();
    assert_eq!(retry.prompt_question, "测试候选");
    let c = finish(
        data.path(),
        "space-a",
        &retry,
        Ok(&response("重试答案")),
        false,
    )
    .unwrap();
    assert_eq!(c.turns.len(), 1);
    assert_eq!(c.turns[0].candidates.len(), 2);
    assert_eq!(c.turns[0].candidates[0].requested_mode, "keyword");
    assert_eq!(c.turns[0].candidates[1].requested_mode, "rerank");
    assert_eq!(c.draft, "");
    let selected = select(
        data.path(),
        "space-a",
        &c.id,
        &first.turn_id,
        &first.candidate_id,
        c.revision,
    )
    .unwrap();
    assert_eq!(
        selected.turns[0].selected_candidate_id.as_deref(),
        Some(first.candidate_id.as_str())
    );
    validate_snapshot(&data.path().join("assistant.sqlite3")).unwrap();
}
#[test]
fn deleting_conversation_prevents_late_results_and_removes_snapshots() {
    let data = tempfile::tempdir().unwrap();
    let c = make(data.path(), "space-a");
    let first = start(data.path(), &c, "删除竞争", None);
    let c = get(data.path(), "space-a", &c.id).unwrap();
    delete(data.path(), "space-a", &c.id, c.revision).unwrap();
    assert!(finish(
        data.path(),
        "space-a",
        &first,
        Ok(&response("晚到的私有事实")),
        false
    )
    .is_err());
    let c = open(data.path()).unwrap();
    for table in ["conversations", "turns", "candidates"] {
        let n: i64 = c
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0)
    }
}
#[test]
fn foreign_parent_and_candidate_cannot_cross_conversations() {
    let data = tempfile::tempdir().unwrap();
    let a = make(data.path(), "space-a");
    let b = make(data.path(), "space-a");
    let t = start(data.path(), &a, "第一个会话", None);
    assert!(begin(
        data.path(),
        "space-a",
        &b.id,
        b.revision,
        "非法分支",
        Some(&t.turn_id),
        None,
        "cross"
    )
    .is_err());
    let c = finish(data.path(), "space-a", &t, Ok(&response("事实")), false).unwrap();
    let bt = start(data.path(), &b, "另一个会话", None);
    let b = finish(data.path(), "space-a", &bt, Ok(&response("事实B")), false).unwrap();
    assert!(select(
        data.path(),
        "space-a",
        &c.id,
        &t.turn_id,
        &bt.candidate_id,
        c.revision
    )
    .is_err());
    assert!(select(
        data.path(),
        "space-a",
        &b.id,
        &t.turn_id,
        &t.candidate_id,
        b.revision
    )
    .is_err());
}
#[test]
fn schema_guard_does_not_downgrade_and_interrupted_generation_is_explicit() {
    let data = tempfile::tempdir().unwrap();
    let c = make(data.path(), "space-a");
    let t = start(data.path(), &c, "中断恢复", None);
    let db = open(data.path()).unwrap();
    db.execute(
        "UPDATE candidates SET process_id='previous-process' WHERE id=?",
        [&t.candidate_id],
    )
    .unwrap();
    drop(db);
    let c = get(data.path(), "space-a", &c.id).unwrap();
    assert_eq!(c.turns[0].candidates[0].status, "failed");
    let path = data.path().join("assistant.sqlite3");
    let db = Connection::open(&path).unwrap();
    db.pragma_update(None, "user_version", 99).unwrap();
    drop(db);
    assert!(get(data.path(), "space-a", &c.id).is_err());
    let db = Connection::open(path).unwrap();
    assert_eq!(
        db.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        99
    );
}
#[test]
fn snapshot_rejects_cross_branch_tampering_and_export_keeps_sources_per_candidate() {
    let data = tempfile::tempdir().unwrap();
    let c = make(data.path(), "space-a");
    let t = start(data.path(), &c, "导出测试", None);
    let c = finish(
        data.path(),
        "space-a",
        &t,
        Ok(&response("# 可保留的MD")),
        false,
    )
    .unwrap();
    let e = export(data.path(), "space-a", &c.id).unwrap();
    assert!(e.markdown.contains("# 可保留的MD"));
    assert!(e.json.contains("test-fixture"));
    let db = open(data.path()).unwrap();
    db.execute("UPDATE turns SET parent_turn_id=id", [])
        .unwrap();
    drop(db);
    assert!(validate_snapshot(&data.path().join("assistant.sqlite3")).is_err());
}
#[test]
fn context_budget_is_six_questions_and_four_thousand_characters() {
    let data = tempfile::tempdir().unwrap();
    let mut c = make(data.path(), "space-a");
    let mut parent = None;
    for n in 0..8 {
        let t = start(data.path(), &c, &format!("问题{n}"), parent.as_deref());
        parent = Some(t.turn_id.clone());
        c = finish(
            data.path(),
            "space-a",
            &t,
            Ok(&response("不进入历史提示的模型文本")),
            false,
        )
        .unwrap();
    }
    let next = start(data.path(), &c, "它们的条件呢", parent.as_deref());
    assert!(!next.prompt_question.contains("问题0"));
    assert!(!next.prompt_question.contains("问题1"));
    assert!(next.prompt_question.contains("问题2"));
    assert_eq!(
        next.prompt_question
            .matches("不进入历史提示的模型文本")
            .count(),
        0
    );
}

#[test]
fn history_search_reaches_older_pages_and_respects_workspace_and_archive() {
    let data = tempfile::tempdir().unwrap();
    let old = make(data.path(), "space-a");
    update(
        data.path(),
        "space-a",
        &old.id,
        old.revision,
        Some("旧专题独特标题".into()),
        None,
        None,
        None,
    )
    .unwrap();
    for _ in 0..201 {
        make(data.path(), "space-a");
    }
    assert_eq!(
        list_page(data.path(), "space-a", false, "", 0)
            .unwrap()
            .len(),
        200
    );
    assert_eq!(
        list_page(data.path(), "space-a", false, "", 200)
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        list(data.path(), "space-a", false, "独特标题").unwrap()[0].id,
        old.id
    );
    assert!(list(data.path(), "space-b", true, "独特标题")
        .unwrap()
        .is_empty());
    update(
        data.path(),
        "space-a",
        &old.id,
        1,
        None,
        Some(true),
        None,
        None,
    )
    .unwrap();
    assert!(list(data.path(), "space-a", false, "独特标题")
        .unwrap()
        .is_empty());
    assert_eq!(
        list(data.path(), "space-a", true, "独特标题")
            .unwrap()
            .len(),
        1
    );
}
