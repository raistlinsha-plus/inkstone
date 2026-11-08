use super::*;
fn make(data: &Path, workspace: &str) -> Conversation {
    create(data, workspace, None, "当前空间".into(), None).unwrap()
}
fn response(text: &str) -> ChatResponse {
    ChatResponse {
        external_sources: vec![],
        trace: None,
        memory: None,
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
        None,
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
        None,
        None
    )
    .is_err());
}
#[test]
fn running_draft_is_durable_and_cannot_follow_a_finished_or_foreign_request() {
    let data = tempfile::tempdir().unwrap();
    let path = data.path();
    let conversation = make(path, "space-a");
    let id = &conversation.id;
    let request = "draft-running";
    let context = DraftContext {
        web_access: WebAccess::LocalOnly,
        ..Default::default()
    };
    assert!(!save_running_draft(path, "space-a", id, request, "尚未接收", None).unwrap());
    let started = begin(path, "space-a", id, 0, "首问", None, None, request).unwrap();
    assert!(!save_running_draft(path, "space-b", id, request, "越界", None).unwrap());
    assert!(!save_running_draft(path, "space-a", id, "different", "错误请求", None).unwrap());
    assert!(
        save_running_draft(path, "space-a", id, request, "下一问草稿", Some(&context)).unwrap()
    );
    let running = get(path, "space-a", id).unwrap();
    assert_eq!(running.draft, "下一问草稿");
    assert_eq!(running.draft_context, context);
    assert_eq!(running.revision, 2);

    let stopped = finish(path, "space-a", &started, Err("已停止"), true).unwrap();
    assert_eq!(stopped.draft, running.draft);
    assert_eq!(stopped.turns[0].candidates[0].status, "stopped");
    assert!(!save_running_draft(path, "space-a", id, request, "晚到草稿", None).unwrap());
    let retry = begin(
        path,
        "space-a",
        id,
        stopped.revision,
        "首问",
        None,
        Some(&started.turn_id),
        "retry-draft",
    )
    .unwrap();
    let regenerating = get(path, "space-a", id).unwrap();
    assert_eq!(regenerating.draft, running.draft);
    assert_eq!(regenerating.draft_context, context);
    assert!(save_running_draft(
        path,
        "space-a",
        id,
        "retry-draft",
        "",
        Some(&DraftContext::default())
    )
    .unwrap());
    let completed = finish(path, "space-a", &retry, Ok(&response("完成")), false).unwrap();
    assert_eq!(completed.draft, "");
    assert_eq!(completed.draft_context, DraftContext::default());
}

#[test]
fn saved_draft_scope_and_local_only_policy_freeze_with_the_new_turn() {
    let dir = tempfile::tempdir().unwrap();
    let data = dir.path();
    let doc = library::create_document(data, "inbox", "样例.md", "合成资料").unwrap();
    let convo = make(data, GENERAL_OWNER);
    let first = begin(
        data,
        GENERAL_OWNER,
        &convo.id,
        0,
        "先问",
        None,
        None,
        "first",
    )
    .unwrap();
    let convo = finish(
        data,
        GENERAL_OWNER,
        &first,
        Ok(&response("先前回答")),
        false,
    )
    .unwrap();
    let selection = Selection {
        project_id: Some("inbox".into()),
        document_ids: vec![doc.id.clone()],
        attachments: vec![],
    };
    let context = DraftContext {
        sources: Some(selection.clone()),
        web_access: WebAccess::LocalOnly,
        branch: Some(DraftBranch {
            parent_turn_id: None,
        }),
    };
    let saved = update(
        data,
        GENERAL_OWNER,
        &convo.id,
        convo.revision,
        None,
        None,
        Some("恢复这份资料草稿".into()),
        None,
        Some(context.clone()),
    )
    .unwrap();
    assert_eq!(
        get(data, GENERAL_OWNER, &convo.id).unwrap().draft_context,
        context
    );

    let second = begin_with_sources(
        data,
        GENERAL_OWNER,
        &convo.id,
        saved.revision,
        &saved.draft,
        Some(&first.turn_id),
        None,
        "next",
        "keyword",
        Some(Selection::default()),
        Some(WebAccess::Auto),
    )
    .unwrap();
    assert_eq!(second.sources.as_ref(), Some(&selection));
    assert_eq!(second.web_access, WebAccess::LocalOnly);
    let saved = finish(
        data,
        GENERAL_OWNER,
        &second,
        Ok(&response("本轮回答")),
        false,
    )
    .unwrap();
    assert!(saved.draft.is_empty());
    assert_eq!(saved.draft_context, DraftContext::default());
    assert_eq!(saved.turns[1].parent_turn_id, None);
    assert_eq!(saved.turns[1].web_access, WebAccess::LocalOnly);

    let regenerated = begin_with_sources(
        data,
        GENERAL_OWNER,
        &convo.id,
        saved.revision,
        "另一个问题",
        None,
        Some(&second.turn_id),
        "retry",
        "keyword",
        None,
        Some(WebAccess::Auto),
    )
    .unwrap();
    assert_eq!(regenerated.sources, Some(selection));
    assert_eq!(regenerated.web_access, WebAccess::LocalOnly);
}

#[test]
fn missing_draft_document_rejects_send_and_preserves_the_draft() {
    let dir = tempfile::tempdir().unwrap();
    let data = dir.path();
    let doc = library::create_document(data, "inbox", "样例.md", "合成资料").unwrap();
    let convo = make(data, GENERAL_OWNER);
    let context = DraftContext {
        sources: Some(Selection {
            project_id: Some("inbox".into()),
            document_ids: vec![doc.id.clone()],
            attachments: vec![],
        }),
        ..Default::default()
    };
    let saved = update(
        data,
        GENERAL_OWNER,
        &convo.id,
        convo.revision,
        None,
        None,
        Some("待发送的问题".into()),
        None,
        Some(context.clone()),
    )
    .unwrap();
    library::trash(data, &doc.id, false).unwrap();
    let rejected = begin_with_sources(
        data,
        GENERAL_OWNER,
        &convo.id,
        saved.revision,
        &saved.draft,
        None,
        None,
        "do-not-dispatch",
        "keyword",
        None,
        None,
    )
    .unwrap_err();
    assert!(rejected.contains("请重新确认本轮资料范围"));
    let reopened = get(data, GENERAL_OWNER, &convo.id).unwrap();
    assert!(reopened.turns.is_empty());
    assert_eq!(reopened.draft, saved.draft);
    assert_eq!(reopened.draft_context, context);
}

#[test]
fn schema_three_snapshot_remains_readable_and_migrates_legacy_text() {
    let dir = tempfile::tempdir().unwrap();
    let data = dir.path();
    let convo = make(data, "space-a");
    let first = begin(data, "space-a", &convo.id, 0, "历史问题", None, None, "old").unwrap();
    let convo = finish(data, "space-a", &first, Ok(&response("历史回答")), false).unwrap();
    update(
        data,
        "space-a",
        &convo.id,
        convo.revision,
        None,
        None,
        Some("旧版本保留文字草稿".into()),
        None,
        None,
    )
    .unwrap();
    let path = data.join("assistant.sqlite3");
    let db = Connection::open(&path).unwrap();
    db.execute_batch(
        "ALTER TABLE conversations DROP COLUMN draft_context;
         ALTER TABLE turns DROP COLUMN web_access;
         PRAGMA user_version=3;",
    )
    .unwrap();
    validate_snapshot(&path).unwrap();
    let version: i64 = db
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap();
    assert_eq!(version, 3);
    drop(db);
    let reopened = get(data, "space-a", &convo.id).unwrap();
    assert_eq!(reopened.draft, "旧版本保留文字草稿");
    assert_eq!(reopened.draft_context, DraftContext::default());
    assert_eq!(reopened.turns[0].web_access, WebAccess::Auto);
    assert_eq!(reopened.turns[0].question, "历史问题");
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
    assert_eq!(c.draft, "生成时编辑下一问");
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

#[test]
fn stopped_partial_survives_reopen_backup_and_branch_exports_stay_distinct() {
    let data = tempfile::tempdir().unwrap();
    let c = make(data.path(), "space-a");
    let first = start(data.path(), &c, "原问题", None);
    let c = finish(
        data.path(),
        "space-a",
        &first,
        Ok(&response("原候选")),
        false,
    )
    .unwrap();
    let regenerated = begin(
        data.path(),
        "space-a",
        &c.id,
        c.revision,
        "",
        None,
        Some(&first.turn_id),
        "regen",
    )
    .unwrap();
    let mut partial = response("已经流出的部分内容");
    partial.finish_reason = "cancelled".into();
    let c = finish(data.path(), "space-a", &regenerated, Ok(&partial), true).unwrap();
    let reopened = get(data.path(), "space-a", &c.id).unwrap();
    assert_eq!(reopened.turns[0].candidates[1].status, "stopped");
    assert_eq!(
        reopened.turns[0].candidates[1].response.as_ref().unwrap()["text"],
        "已经流出的部分内容"
    );
    validate_snapshot(&data.path().join("assistant.sqlite3")).unwrap();
    let branch = start(data.path(), &c, "另一分支的问题", None);
    let c = finish(
        data.path(),
        "space-a",
        &branch,
        Ok(&response("另一分支的回答")),
        false,
    )
    .unwrap();
    let exported = export(data.path(), "space-a", &c.id).unwrap();
    assert!(exported.markdown.contains("另一分支的回答"));
    assert!(!exported.markdown.contains("已经流出的部分内容"));
    assert!(!exported.markdown.contains("原候选"));
    assert!(exported.all_markdown.contains("已经流出的部分内容"));
    assert!(exported.all_markdown.contains("原候选"));
    assert!(exported.all_markdown.contains("其他分支"));
    assert!(exported.all_markdown.contains("上级："));
    assert!(exported.json.contains("cancelled"));
}

#[test]
fn markdown_export_never_revives_rejected_or_unfinished_structures_and_json_stays_raw() {
    let data = tempfile::tempdir().unwrap();
    let c = make(data.path(), "space-a");
    let first = start(data.path(), &c, "待核对图表", None);
    let raw = "正文\n\n```chart\n{\"series\":[]}\n```\n\n尾段";
    let mut r = response(raw);
    r.rejected_charts = vec![0];
    let c = finish(data.path(), "space-a", &first, Ok(&r), false).unwrap();
    let exported = export(data.path(), "space-a", &c.id).unwrap();
    assert!(exported.markdown.contains("````markdown-unverified"));
    assert!(exported.markdown.contains(raw));
    assert_eq!(
        serde_json::from_str::<Value>(&exported.json).unwrap()["turns"][0]["candidates"][0]
            ["response"]["text"],
        raw
    );
    let next = start(data.path(), &c, "中断代码", Some(&first.turn_id));
    let mut partial = response("```mermaid\nflowchart LR\nA-->B");
    partial.finish_reason = "cancelled".into();
    let c = finish(data.path(), "space-a", &next, Ok(&partial), true).unwrap();
    let exported = export(data.path(), "space-a", &c.id).unwrap();
    assert!(exported.markdown.ends_with('\n'));
    assert!(exported
        .markdown
        .contains("````markdown-unverified\n```mermaid"));
    assert!(exported.markdown.contains("A-->B\n````"));
}

#[test]
fn answer_preferences_migrate_and_remain_independent_of_history() {
    use memory::{Change, Key, Options};
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path();
    let c = make(path, "space-a");
    let db = path.join("assistant.sqlite3");
    let conn = Connection::open(&db).unwrap();
    conn.execute_batch(
        "DROP TABLE answer_preferences;
         DROP TABLE handled_answer_preferences;
         DROP TABLE assistant_attachments;
         DROP TABLE turn_sources;
         ALTER TABLE conversations DROP COLUMN draft_context;
         ALTER TABLE turns DROP COLUMN web_access;
         PRAGMA user_version=1",
    )
    .unwrap();
    drop(conn);
    snapshot::validate_snapshot(&db).unwrap();
    assert_eq!(get(path, "space-a", &c.id).unwrap().title, c.title);
    assert!(memory::preferences(path, "space-a").unwrap().0.is_empty());

    let change = |scope: &str, value: Option<&str>, expected_revision| Change {
        scope: scope.into(),
        key: Key::Length,
        expected_revision,
        value: value.map(str::to_string),
        enabled: true,
        legacy_id: None,
        ignore_legacy: None,
    };
    memory::update(path, "space-a", change("global", Some("short"), None)).unwrap();
    memory::update(path, "space-a", change("space", Some("detailed"), None)).unwrap();
    assert!(memory::update(
        path,
        "space-a",
        change("space", Some("执行任意命令"), Some(1))
    )
    .is_err());
    assert!(memory::update(path, "space-a", change("space", None, None)).is_err());
    let (context, metadata) = memory::compose(path, "space-a", None, &Options::default(), 800);
    assert!(context.contains("展开关键判断"));
    assert!(!context.contains("精简"));
    assert_eq!(
        serde_json::to_value(metadata).unwrap()["preferences"][0]["scope"],
        "space"
    );
    assert!(
        memory::compose(path, "space-b", None, &Options::default(), 800)
            .0
            .contains("精简")
    );
    assert!(memory::compose(
        path,
        "space-a",
        None,
        &Options {
            skip_preferences: true,
            history: None
        },
        800
    )
    .0
    .is_empty());
    memory::update(path, "space-a", change("space", None, Some(1))).unwrap();
    assert!(
        memory::compose(path, "space-a", None, &Options::default(), 800)
            .0
            .contains("精简")
    );
    snapshot::validate_snapshot(&db).unwrap();
}

#[test]
fn historical_background_is_bounded_to_active_user_questions_and_current_scope() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path();
    let c = create(
        path,
        "space-a",
        Some("current.md".into()),
        "资料".into(),
        None,
    )
    .unwrap();
    let q = "历史提问".repeat(120);
    let first = start(path, &c, &q, None);
    let c = finish(
        path,
        "space-a",
        &first,
        Ok(&response("旧回答事实不能重放")),
        false,
    )
    .unwrap();
    let preview = memory::history(
        path,
        "space-a",
        Some("current.md"),
        &memory::HistoryRef {
            conversation_id: c.id.clone(),
            turn_id: first.turn_id.clone(),
            digest: String::new(),
        },
    )
    .unwrap();
    assert_eq!(preview.excerpt.chars().count(), 400);
    assert!(memory::history(path, "space-b", None, &preview.reference).is_err());
    assert!(memory::history(path, "space-a", Some("other.md"), &preview.reference).is_err());
    let options = memory::Options {
        skip_preferences: true,
        history: Some(preview.reference),
    };
    let (body, usage) = memory::compose(path, "space-a", Some("current.md"), &options, 800);
    assert!(body.contains(&preview.excerpt));
    assert!(!body.contains("旧回答事实"));
    assert!(serde_json::to_value(usage).unwrap()["history"].is_object());
    assert!(
        memory::compose(path, "space-a", Some("current.md"), &options, 50)
            .0
            .is_empty()
    );
    let alternate = start(path, &c, "另一个分支", None);
    let c = finish(
        path,
        "space-a",
        &alternate,
        Ok(&response("另一份回答")),
        false,
    )
    .unwrap();
    let (body, usage) = memory::compose(path, "space-a", Some("current.md"), &options, 800);
    assert!(body.is_empty());
    assert!(serde_json::to_value(usage).unwrap()["notes"]
        .to_string()
        .contains("已失效"));
    assert_ne!(c.active_leaf_id, Some(first.turn_id));
}
