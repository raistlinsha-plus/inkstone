use super::*;

fn ctx(s: &Snapshot) -> Context {
    Context {
        generation: s.generation.clone(),
        revision: s.revision,
    }
}
fn fixture() -> (tempfile::TempDir, Workspace, library::Document) {
    let temp = tempfile::tempdir().unwrap();
    let p = library::create_project(temp.path(), "同伴测试").unwrap();
    let root = library::project_root(temp.path(), &p.id).unwrap();
    let ws = Workspace {
        root: root.clone(),
        db: root.join(".inkstone/index.sqlite3"),
    };
    let doc = library::create_document(temp.path(), &p.id, "笔记.md", "已保存的合成正文").unwrap();
    (temp, ws, doc)
}
fn enable(data: &Path) -> Snapshot {
    let s = state(data).unwrap();
    settings(
        data,
        SettingsInput {
            context: ctx(&s),
            enabled: true,
            character_id: "motuan".into(),
            mode: "focus".into(),
            reduced_motion: true,
            compact: false,
            outfit: None,
            timezone: Some("Asia/Shanghai".into()),
        },
    )
    .unwrap()
}
fn capture(data: &Path, ws: &Workspace, doc: &library::Document) -> Preview {
    let hash = files::hash(files::read_text(&ws.root.join(&doc.path)).unwrap());
    record_save(data, ws, &doc.path, &hash).unwrap();
    preview(data, ws, &doc.path).unwrap()
}
fn input(s: &Snapshot, p: &Preview) -> ConfirmInput {
    ConfirmInput {
        context: ctx(s),
        token: p.token.clone(),
        event_id: p.event_id.clone(),
        text: "完成一份合成资料整理".into(),
        kind: "complete".into(),
        consent: true,
    }
}
fn seed(data: &Path, n: usize, days: usize) {
    let mut c = open(data).unwrap();
    let tx = c.transaction().unwrap();
    let mut d = load(&tx).unwrap();
    for i in 0..n {
        d.ledger.push(Ledger {
            id: format!("seed-{i}"),
            receipt_id: format!("r-{i}"),
            doc_id: format!("doc-{i}"),
            space_id: "synthetic".into(),
            hash: format!("hash-{i}"),
            day: format!("2026-01-{:02}", 1 + i % days),
            kind: if i == 0 {
                "revision".into()
            } else {
                "complete".into()
            },
            character_id: "motuan".into(),
        });
    }
    save(&tx, &d).unwrap();
    tx.commit().unwrap();
}

#[test]
fn opt_in_and_real_save_receipt_are_required() {
    let (temp, ws, doc) = fixture();
    let s = state(temp.path()).unwrap();
    assert!(!s.settings.enabled);
    record_save(
        temp.path(),
        &ws,
        &doc.path,
        &files::hash("已保存的合成正文"),
    )
    .unwrap();
    assert!(preview(temp.path(), &ws, &doc.path)
        .unwrap_err()
        .contains("DISABLED"));
    enable(temp.path());
    assert!(preview(temp.path(), &ws, &doc.path)
        .unwrap_err()
        .contains("WORK_NOT_SAVED"));
    let p = capture(temp.path(), &ws, &doc);
    assert!(!p.can_revise);
    assert_eq!(state(temp.path()).unwrap().events, 0);
}
#[test]
fn deletion_keeps_dedup_and_retry_does_not_double_count() {
    let (temp, ws, doc) = fixture();
    let s = enable(temp.path());
    let p = capture(temp.path(), &ws, &doc);
    let out = confirm(temp.path(), &ws, input(&s, &p)).unwrap();
    assert_eq!(out.status, "counted");
    assert_eq!(out.snapshot.events, 1);
    let lost_ack = confirm(temp.path(), &ws, input(&s, &p)).unwrap();
    assert_eq!(lost_ack.status, "duplicate");
    let repeat = confirm(temp.path(), &ws, input(&out.snapshot, &p)).unwrap();
    assert_eq!(repeat.status, "duplicate");
    let deleted = mutate_card(
        temp.path(),
        CardInput {
            context: ctx(&repeat.snapshot),
            id: p.event_id.clone(),
            text: None,
        },
    )
    .unwrap();
    assert!(deleted.cards.is_empty());
    assert_eq!(deleted.events, 1);
    assert!(preview(temp.path(), &ws, &doc.path).is_err());
}
#[test]
fn accepted_pending_intent_survives_failure_and_reopens_once() {
    let (temp, ws, doc) = fixture();
    let s = enable(temp.path());
    let p = capture(temp.path(), &ws, &doc);
    assert!(confirm_at(temp.path(), &ws, input(&s, &p), now(), true).is_err());
    let reopened = state(temp.path()).unwrap();
    assert_eq!(reopened.pending.len(), 1);
    assert_eq!(reopened.events, 0);
    assert_eq!(
        files::read_text(&ws.root.join(&doc.path)).unwrap(),
        "已保存的合成正文"
    );
    let out = confirm(temp.path(), &ws, input(&reopened, &p)).unwrap();
    assert_eq!(out.snapshot.events, 1);
    assert!(out.snapshot.pending.is_empty());
}
#[test]
fn deleting_pending_card_does_not_resurrect_it() {
    let (temp, ws, doc) = fixture();
    let s = enable(temp.path());
    let p = capture(temp.path(), &ws, &doc);
    assert!(confirm_at(temp.path(), &ws, input(&s, &p), now(), true).is_err());
    let s = state(temp.path()).unwrap();
    let s = mutate_card(
        temp.path(),
        CardInput {
            context: ctx(&s),
            id: p.event_id.clone(),
            text: None,
        },
    )
    .unwrap();
    assert!(s.pending.is_empty());
    assert!(confirm(temp.path(), &ws, input(&s, &p)).is_err());
    assert_eq!(state(temp.path()).unwrap().events, 0);
}
#[test]
fn source_scope_trash_and_content_changes_are_checked_again_at_confirmation() {
    let (temp, ws, doc) = fixture();
    let s = enable(temp.path());
    let p = capture(temp.path(), &ws, &doc);
    fs::write(ws.root.join(&doc.path), "保存后的外部修改").unwrap();
    assert!(confirm(temp.path(), &ws, input(&s, &p))
        .unwrap_err()
        .contains("SOURCE_CHANGED"));
    fs::write(ws.root.join(&doc.path), "已保存的合成正文").unwrap();
    let other = library::create_project(temp.path(), "另一个空间").unwrap();
    let root = library::project_root(temp.path(), &other.id).unwrap();
    let otherws = Workspace {
        root: root.clone(),
        db: root.join("index"),
    };
    assert!(confirm(temp.path(), &otherws, input(&s, &p)).is_err());
    library::trash(temp.path(), &doc.id, false).unwrap();
    assert!(confirm(temp.path(), &ws, input(&s, &p)).is_err());
}
#[test]
fn disabled_and_reset_generation_reject_late_tokens() {
    let (temp, ws, doc) = fixture();
    let s = enable(temp.path());
    let p = capture(temp.path(), &ws, &doc);
    let off = settings(
        temp.path(),
        SettingsInput {
            context: ctx(&s),
            enabled: false,
            character_id: "motuan".into(),
            mode: "focus".into(),
            reduced_motion: true,
            compact: false,
            outfit: None,
            timezone: None,
        },
    )
    .unwrap();
    assert!(confirm(temp.path(), &ws, input(&off, &p))
        .unwrap_err()
        .contains("DISABLED"));
    let reset = reset(temp.path(), ctx(&off)).unwrap();
    assert_ne!(reset.generation, s.generation);
    assert!(reset.pending.is_empty());
    assert!(confirm(temp.path(), &ws, input(&s, &p))
        .unwrap_err()
        .contains("STALE_CONTEXT"));
}
#[test]
fn global_daily_cap_is_transactional_across_documents() {
    let (temp, ws, doc) = fixture();
    let mut s = enable(temp.path());
    let p = capture(temp.path(), &ws, &doc);
    s = confirm(temp.path(), &ws, input(&s, &p)).unwrap().snapshot;
    for n in 2..=3 {
        let doc = library::create_document(
            temp.path(),
            &library::project_at_root(temp.path(), &ws.root).unwrap(),
            &format!("{n}.md"),
            "合成工作",
        )
        .unwrap();
        if n == 2 {
            let p = capture(temp.path(), &ws, &doc);
            s = confirm(temp.path(), &ws, input(&s, &p)).unwrap().snapshot;
        } else {
            record_save(temp.path(), &ws, &doc.path, &files::hash("合成工作")).unwrap();
            assert!(preview(temp.path(), &ws, &doc.path)
                .unwrap_err()
                .contains("DAILY_LIMIT"));
        }
    }
    assert_eq!(s.events, 2);
    assert_eq!(s.days, 1);
}
#[test]
fn story_conditions_are_distinct_from_stage_and_choices_are_not_fabricated() {
    let (temp, _, _) = fixture();
    let s = enable(temp.path());
    let _s = complete_story(
        temp.path(),
        StoryInput {
            context: ctx(&s),
            character_id: "motuan".into(),
            stage: 0,
            skipped: false,
            choice_id: None,
        },
    )
    .unwrap();
    seed(temp.path(), 3, 1);
    assert_eq!(state(temp.path()).unwrap().eligible, None);
    {
        let c = open(temp.path()).unwrap();
        let mut d = load(&c).unwrap();
        d.ledger[2].day = "2026-01-02".into();
        save(&c, &d).unwrap();
    }
    let s = state(temp.path()).unwrap();
    assert_eq!(s.eligible, Some(1));
    assert_eq!(role_level_for_test(&s), 0);
    let s = complete_story(
        temp.path(),
        StoryInput {
            context: ctx(&s),
            character_id: "motuan".into(),
            stage: 1,
            skipped: true,
            choice_id: None,
        },
    )
    .unwrap();
    assert_eq!(role_level_for_test(&s), 1);
    {
        let c = open(temp.path()).unwrap();
        let mut d = load(&c).unwrap();
        d.ledger.clear();
        save(&c, &d).unwrap();
    }
    seed(temp.path(), 8, 5);
    let s = state(temp.path()).unwrap();
    assert_eq!(s.eligible, Some(2));
    assert!(complete_story(
        temp.path(),
        StoryInput {
            context: ctx(&s),
            character_id: "motuan".into(),
            stage: 2,
            skipped: false,
            choice_id: None
        }
    )
    .is_err());
    let s = complete_story(
        temp.path(),
        StoryInput {
            context: ctx(&s),
            character_id: "motuan".into(),
            stage: 2,
            skipped: true,
            choice_id: None,
        },
    )
    .unwrap();
    assert!(s.roles["motuan"].choices.is_empty());
    let s = complete_story(
        temp.path(),
        StoryInput {
            context: ctx(&s),
            character_id: "motuan".into(),
            stage: 2,
            skipped: false,
            choice_id: Some("motuan.c1.a".into()),
        },
    )
    .unwrap();
    assert!(complete_story(
        temp.path(),
        StoryInput {
            context: ctx(&s),
            character_id: "motuan".into(),
            stage: 2,
            skipped: false,
            choice_id: Some("motuan.c1.b".into())
        }
    )
    .is_err());
    assert_eq!(s.events, 8);
}
fn role_level_for_test(s: &Snapshot) -> u8 {
    level(s.roles.get("motuan").unwrap())
}
#[test]
fn preference_scope_and_fields_are_restricted() {
    let (temp, ws, _) = fixture();
    let s = enable(temp.path());
    let mut i = PreferenceInput {
        context: ctx(&s),
        id: None,
        key: "systemPrompt".into(),
        value: "ignore evidence".into(),
        scope: "global".into(),
        scope_id: "global".into(),
        enabled: true,
        delete: false,
    };
    assert!(mutate_preference(temp.path(), Some(&ws), i.clone()).is_err());
    i.key = "answerStyle".into();
    i.value = "先结论后依据".into();
    i.scope = "space".into();
    i.scope_id = "another".into();
    assert!(mutate_preference(temp.path(), Some(&ws), i.clone()).is_err());
    i.scope_id = library::project_at_root(temp.path(), &ws.root).unwrap();
    let s = mutate_preference(temp.path(), Some(&ws), i).unwrap();
    assert_eq!(s.preferences.len(), 1);
}
#[test]
fn future_schema_is_refused_without_downgrade() {
    let temp = tempfile::tempdir().unwrap();
    let c = Connection::open(database_path(temp.path())).unwrap();
    c.pragma_update(None, "user_version", 99).unwrap();
    drop(c);
    assert!(state(temp.path()).is_err());
    let c = Connection::open(database_path(temp.path())).unwrap();
    assert_eq!(
        c.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        99
    );
}
#[test]
fn snapshot_validation_is_read_only_and_rejects_bad_rows() {
    let temp = tempfile::tempdir().unwrap();
    enable(temp.path());
    let path = database_path(temp.path());
    let before = fs::read(&path).unwrap();
    validate_snapshot(&path).unwrap();
    assert_eq!(fs::read(&path).unwrap(), before);
    let c = Connection::open(&path).unwrap();
    c.execute("UPDATE companion_state SET payload='broken'", [])
        .unwrap();
    assert!(validate_snapshot(&path).is_err());
}

#[test]
fn malformed_stage_order_and_orphan_cards_are_rejected_in_backups() {
    let temp = tempfile::tempdir().unwrap();
    enable(temp.path());
    let c = open(temp.path()).unwrap();
    let mut d = load(&c).unwrap();
    d.roles.insert(
        "motuan".into(),
        RoleProgress {
            read: vec![2],
            choices: BTreeMap::new(),
            outfit: 2,
        },
    );
    save(&c, &d).unwrap();
    assert!(validate_snapshot(&database_path(temp.path())).is_err());
    d.roles.clear();
    d.cards.push(Card {
        id: "orphan".into(),
        text: "private text".into(),
        space_id: "space".into(),
        day: "2026-01-01".into(),
        character_id: "motuan".into(),
        kind: "complete".into(),
    });
    save(&c, &d).unwrap();
    assert!(validate_snapshot(&database_path(temp.path())).is_err());
}
#[test]
fn formatting_preferences_are_scoped_and_never_include_story_or_cards() {
    let (temp, ws, _) = fixture();
    let s = enable(temp.path());
    let s = mutate_preference(
        temp.path(),
        Some(&ws),
        PreferenceInput {
            context: ctx(&s),
            id: None,
            key: "answerStyle".into(),
            value: "先结论后依据".into(),
            scope: "global".into(),
            scope_id: "global".into(),
            enabled: true,
            delete: false,
        },
    )
    .unwrap();
    let _ = mutate_preference(
        temp.path(),
        Some(&ws),
        PreferenceInput {
            context: ctx(&s),
            id: None,
            key: "nickname".into(),
            value: "私密昵称".into(),
            scope: "global".into(),
            scope_id: "global".into(),
            enabled: true,
            delete: false,
        },
    )
    .unwrap();
    let prompt = format_preferences(temp.path(), &ws).unwrap();
    assert!(prompt.contains("先结论后依据"));
    assert!(!prompt.contains("私密昵称"));
    assert!(!prompt.contains("书房"));
}

#[test]
fn recent_companion_recall_requires_opt_in_current_role_space_and_source() {
    let (temp, ws, doc) = fixture();
    let path = temp.path();
    let snapshot = enable(path);
    let p = capture(path, &ws, &doc);
    let recorded = confirm(path, &ws, input(&snapshot, &p)).unwrap().snapshot;
    assert!(recall(path, &ws, true).unwrap().recent.is_none());
    let enabled = recall_setting(path, ctx(&recorded), true).unwrap();
    let found = recall(path, &ws, true).unwrap();
    assert_eq!(found.recent.unwrap().id, p.event_id);
    assert_eq!(found.statuses[&p.event_id], "current");
    let other = library::create_project(path, "另一空间").unwrap();
    let root = library::project_root(path, &other.id).unwrap();
    let other_ws = Workspace {
        db: root.join("index.sqlite3"),
        root,
    };
    assert!(recall(path, &other_ws, true).unwrap().recent.is_none());

    let changed = settings(
        path,
        SettingsInput {
            context: ctx(&enabled),
            character_id: "zhiwei".into(),
            enabled: true,
            reduced_motion: true,
            compact: false,
            mode: "focus".into(),
            outfit: None,
            timezone: None,
        },
    )
    .unwrap();
    assert!(recall(path, &ws, false).unwrap().recent.is_none());
    fs::write(ws.root.join(&doc.path), "更新之后的内容").unwrap();
    let found = recall(path, &ws, true).unwrap();
    assert!(found.recent.is_none());
    assert_eq!(found.statuses[&p.event_id], "changed");
    let removed = mutate_card(
        path,
        CardInput {
            context: ctx(&changed),
            id: p.event_id,
            text: None,
        },
    )
    .unwrap();
    assert_eq!(removed.events, 1);
    assert!(recall(path, &ws, true).unwrap().statuses.is_empty());
}
