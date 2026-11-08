use super::*;
use crate::{assistant, companion};
use serde_json::{json, Value};

fn context(snapshot: &companion::Snapshot) -> companion::Context {
    companion::Context {
        generation: snapshot.generation.clone(),
        revision: snapshot.revision,
    }
}
struct Fixture {
    doc: library::Document,
    ws: Workspace,
    conversation: assistant::Conversation,
    companion: companion::Snapshot,
}
fn fixture(data: &Path) -> Fixture {
    let doc = library::create_document(data, "inbox", "备份会话.md", "原始资料").unwrap();
    let ws = crate::documents::library_workspace(data, "inbox").unwrap();
    let initial = companion::state(data).unwrap();
    let enabled = companion::settings(
        data,
        companion::SettingsInput {
            context: context(&initial),
            enabled: true,
            character_id: "motuan".into(),
            mode: "gentle".into(),
            reduced_motion: true,
            compact: false,
            outfit: None,
            timezone: Some("Asia/Shanghai".into()),
        },
    )
    .unwrap();
    companion::complete_story(
        data,
        companion::StoryInput {
            context: context(&enabled),
            character_id: "motuan".into(),
            stage: 0,
            skipped: false,
            choice_id: None,
        },
    )
    .unwrap();
    let body = "# 实际已保存的合成工作\n\n甲方案为120人。";
    let saved =
        crate::documents::save(&ws, data, &doc.path, body, &files::hash("原始资料")).unwrap();
    companion::record_save(data, &ws, &doc.path, &saved.hash).unwrap();
    let preview = companion::preview(data, &ws, &doc.path).unwrap();
    let counted = companion::confirm(
        data,
        &ws,
        companion::ConfirmInput {
            context: preview.context,
            token: preview.token,
            event_id: preview.event_id,
            text: "完成一份合成资料整理".into(),
            kind: "complete".into(),
            consent: true,
        },
    )
    .unwrap();
    let pref = companion::mutate_preference(
        data,
        Some(&ws),
        companion::PreferenceInput {
            context: context(&counted.snapshot),
            id: None,
            key: "answerStyle".into(),
            value: "先给结论再列来源".into(),
            scope: "global".into(),
            scope_id: "global".into(),
            enabled: true,
            delete: false,
        },
    )
    .unwrap();
    let space = assistant::workspace_id(data, &ws);
    let convo = assistant::create(
        data,
        &space,
        Some(doc.path.clone()),
        "当前文档 · 备份会话".into(),
        None,
    )
    .unwrap();
    let request = assistant::begin_with_mode(
        data,
        &space,
        &convo.id,
        convo.revision,
        "方案有多少人？",
        None,
        None,
        "backup-question",
        "keyword",
    )
    .unwrap();
    let source=serde_json::from_value(json!({"id":1,"path":doc.path,"text":"甲方案为120人。","heading":"实际已保存的合成工作","startLine":3,"endLine":3,"hash":saved.hash,"score":1.0,"documentId":doc.id,"title":doc.title,"evidence":true,"matchKind":"keyword"})).unwrap();
    let response = crate::models::ChatResponse {
        external_sources: vec![],
        trace: None,
        memory: None,
        finish_reason: "stop".into(),
        text: "甲方案为120人。[S1]".into(),
        sources: vec![source],
        warning: None,
        retrieval_mode: "bm25".into(),
        rerank_status: "disabled".into(),
        model: "local-fixture".into(),
        scope: Some(doc.path.clone()),
        chart_warnings: vec![],
        rejected_charts: vec![],
        citation_checks: vec![],
    };
    let convo = assistant::finish(data, &space, &request, Ok(&response), false).unwrap();
    let stopped = assistant::begin_with_mode(
        data,
        &space,
        &convo.id,
        convo.revision,
        "它的满意度呢？",
        Some(&request.turn_id),
        None,
        "backup-stopped",
        "hybrid",
    )
    .unwrap();
    let convo = assistant::finish(data, &space, &stopped, Err("已停止生成"), true).unwrap();
    let conversation = assistant::update(
        data,
        &space,
        &convo.id,
        convo.revision,
        Some("保留两轮及引用".into()),
        None,
        Some("下一次要核对的中文问题".into()),
        None,
        None,
    )
    .unwrap();
    Fixture {
        doc,
        ws,
        conversation,
        companion: pref,
    }
}
fn entries(path: &Path) -> Vec<(String, Vec<u8>)> {
    let mut archive = ZipArchive::new(File::open(path).unwrap()).unwrap();
    (0..archive.len())
        .map(|index| {
            let mut file = archive.by_index(index).unwrap();
            let name = file.name().unwrap().into_owned();
            let mut bytes = vec![];
            file.read_to_end(&mut bytes).unwrap();
            (name, bytes)
        })
        .collect()
}
fn archive_with(source: &Path, target: &Path, mutator: impl FnOnce(&mut Vec<(String, Vec<u8>)>)) {
    let mut entries = entries(source);
    mutator(&mut entries);
    let mut writer = ZipWriter::new(File::create(target).unwrap());
    for (name, bytes) in entries {
        writer
            .start_file(name, SimpleFileOptions::default())
            .unwrap();
        writer.write_all(&bytes).unwrap();
    }
    writer.finish().unwrap();
}
#[test]
fn both_domain_snapshots_preserve_real_conversations_cards_preferences_and_wal_commits() {
    let data = tempfile::tempdir().unwrap();
    let out = tempfile::tempdir().unwrap();
    let f = fixture(data.path());
    // Keep WAL mode live: backup must include committed rows through its read-only source.
    let wal = Connection::open(data.path().join("assistant.sqlite3")).unwrap();
    wal.pragma_update(None, "journal_mode", "WAL").unwrap();
    wal.execute_batch("BEGIN; SELECT COUNT(*) FROM conversations;")
        .unwrap();
    let current = assistant::update(
        data.path(),
        &assistant::workspace_id(data.path(), &f.ws),
        &f.conversation.id,
        f.conversation.revision,
        None,
        None,
        Some("WAL里的最终草稿".into()),
        None,
        Some(assistant::DraftContext {
            web_access: crate::assistant_sources::WebAccess::LocalOnly,
            branch: Some(assistant::DraftBranch {
                parent_turn_id: Some(f.conversation.turns[0].id.clone()),
            }),
            ..Default::default()
        }),
    )
    .unwrap();
    assert!(data.path().join("assistant.sqlite3-wal").is_file());
    let backup = out.path().join("both.zip");
    create_backup(data.path(), &backup).unwrap();
    let mut archive = ZipArchive::new(File::open(&backup).unwrap()).unwrap();
    let (manifest, _) = read_manifest(&mut archive).unwrap();
    assert_eq!(manifest.format, 2);
    assert_eq!(manifest.stores.len(), 2);
    assert!(manifest
        .stores
        .iter()
        .any(|s| s.path == "assistant.sqlite3" && s.schema_version == crate::assistant::SCHEMA));
    assert!(manifest
        .stores
        .iter()
        .any(|s| s.path == "companion.sqlite3" && s.schema_version == 1));
    drop(archive);
    assert!(validate_backup(&backup).unwrap().valid);
    let target = out.path().join("new-profile");
    restore_backup(&backup, &target, data.path()).unwrap();
    let restored_ws = crate::documents::library_workspace(&target, "inbox").unwrap();
    assert_eq!(
        fs::read_to_string(restored_ws.root.join(&f.doc.path)).unwrap(),
        fs::read_to_string(f.ws.root.join(&f.doc.path)).unwrap()
    );
    let conversation = assistant::get(
        &target,
        &assistant::workspace_id(&target, &restored_ws),
        &current.id,
    )
    .unwrap();
    assert_eq!(
        serde_json::to_value(conversation).unwrap(),
        serde_json::to_value(current).unwrap()
    );
    let restored = companion::state(&target).unwrap();
    assert_eq!(
        serde_json::to_value(restored).unwrap(),
        serde_json::to_value(f.companion).unwrap()
    );
    assert!(!target.join("settings.json").exists());
    assert!(mutation(data.path()).is_ok());
    wal.execute_batch("ROLLBACK").unwrap();
    drop(wal);
}
#[test]
fn semantic_auxiliary_corruption_is_rejected_even_with_matching_archive_hashes() {
    for store in ["assistant.sqlite3", "companion.sqlite3"] {
        let data = tempfile::tempdir().unwrap();
        let out = tempfile::tempdir().unwrap();
        let _ = fixture(data.path());
        let backup = out.path().join("good.zip");
        create_backup(data.path(), &backup).unwrap();
        let modified = out.path().join("modified.sqlite3");
        fs::copy(data.path().join(store), &modified).unwrap();
        let c = Connection::open(&modified).unwrap();
        if store == "assistant.sqlite3" {
            c.execute("UPDATE turns SET parent_turn_id=id", []).unwrap();
        } else {
            let raw: String = c
                .query_row("SELECT payload FROM companion_state WHERE id=1", [], |r| {
                    r.get(0)
                })
                .unwrap();
            let mut value: Value = serde_json::from_str(&raw).unwrap();
            value["roles"]["motuan"]["read"] = json!([2]);
            value["roles"]["motuan"]["outfit"] = json!(2);
            c.execute(
                "UPDATE companion_state SET payload=? WHERE id=1",
                [serde_json::to_string(&value).unwrap()],
            )
            .unwrap();
        }
        drop(c);
        let bad = out.path().join("bad.zip");
        let changed = fs::read(modified).unwrap();
        super::tests::rewrite_archive(&backup, &bad, |name, bytes| {
            if name == store {
                *bytes = changed.clone();
            }
        });
        let validation = validate_backup(&bad).unwrap();
        assert!(!validation.valid, "{store}");
        let target = out.path().join("must-not-publish");
        assert!(restore_backup(&bad, &target, data.path()).is_err());
        assert!(!target.exists());
        assert!(!fs::read_dir(out.path()).unwrap().any(|p| p
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".inkstone-")));
        assert!(validate_backup(&backup).unwrap().valid);
    }
}
#[test]
fn final_recheck_detects_external_auxiliary_rows_schema_and_membership_changes() {
    for scenario in [
        "assistant-row",
        "companion-row",
        "assistant-schema",
        "store-removed",
        "store-added",
    ] {
        let data = tempfile::tempdir().unwrap();
        let out = tempfile::tempdir().unwrap();
        if scenario == "store-added" {
            library::create_document(data.path(), "inbox", "无角色.md", "工作正文").unwrap();
        } else {
            let _ = fixture(data.path());
        }
        let target = out.path().join("must-not-publish.zip");
        let mut ran = false;
        let result = create_backup_with_hook(data.path(), &target, |copied| {
            if !ran && copied.file_name().is_some_and(|n| n == "catalog.sqlite3") {
                match scenario {
                    "assistant-row" => {
                        Connection::open(data.path().join("assistant.sqlite3"))
                            .unwrap()
                            .execute("UPDATE conversations SET title='外部改写'", [])
                            .unwrap();
                    }
                    "companion-row" => {
                        let c = Connection::open(data.path().join("companion.sqlite3")).unwrap();
                        let raw: String = c
                            .query_row("SELECT payload FROM companion_state WHERE id=1", [], |r| {
                                r.get(0)
                            })
                            .unwrap();
                        let mut p: Value = serde_json::from_str(&raw).unwrap();
                        p["settings"]["mode"] = json!("focus");
                        c.execute("UPDATE companion_state SET payload=?", [p.to_string()])
                            .unwrap();
                    }
                    "assistant-schema" => {
                        Connection::open(data.path().join("assistant.sqlite3"))
                            .unwrap()
                            .pragma_update(None, "user_version", 99)
                            .unwrap();
                    }
                    "store-removed" => {
                        fs::remove_file(data.path().join("companion.sqlite3")).unwrap()
                    }
                    "store-added" => {
                        Connection::open(data.path().join("assistant.sqlite3"))
                            .unwrap()
                            .execute("CREATE TABLE external_content(value TEXT)", [])
                            .unwrap();
                    }
                    _ => unreachable!(),
                }
                ran = true;
            }
            Ok(())
        });
        assert!(ran);
        assert!(result.is_err(), "failed to detect {scenario}");
        assert!(!target.exists(), "published after {scenario}");
        assert!(mutation(data.path()).is_ok());
    }
}
#[test]
fn legacy_format_one_remains_readable_without_fabricating_missing_stores() {
    let data = tempfile::tempdir().unwrap();
    let out = tempfile::tempdir().unwrap();
    let doc = library::create_document(data.path(), "inbox", "旧格式.md", "旧版工作资料").unwrap();
    let newer = out.path().join("format2.zip");
    create_backup(data.path(), &newer).unwrap();
    let legacy = out.path().join("format1.zip");
    archive_with(&newer, &legacy, |entries| {
        let raw = &mut entries
            .iter_mut()
            .find(|(name, _)| name == "manifest.json")
            .unwrap()
            .1;
        let mut value: Value = serde_json::from_slice(raw).unwrap();
        value["format"] = json!(1);
        value.as_object_mut().unwrap().remove("stores");
        *raw = serde_json::to_vec(&value).unwrap();
    });
    let validation = validate_backup(&legacy).unwrap();
    assert!(validation.valid);
    assert!(validation.warnings.iter().any(|w| w.contains("不包含角色")));
    assert!(validation
        .warnings
        .iter()
        .any(|w| w.contains("不包含知识会话")));

    let restored = out.path().join("legacy-profile");
    restore_backup(&legacy, &restored, data.path()).unwrap();
    assert!(!restored.join("assistant.sqlite3").exists());
    assert!(!restored.join("companion.sqlite3").exists());
    let ws = crate::documents::library_workspace(&restored, "inbox").unwrap();
    assert_eq!(
        fs::read_to_string(ws.root.join(doc.path)).unwrap(),
        "旧版工作资料"
    );
}

#[test]
fn accepted_pending_experience_survives_restore_and_retries_once_without_resaving_work() {
    let data = tempfile::tempdir().unwrap();
    let out = tempfile::tempdir().unwrap();
    let f = fixture(data.path());
    let doc = library::create_document(data.path(), "inbox", "待保存经历.md", "最初内容").unwrap();
    let saved = crate::documents::save(
        &f.ws,
        data.path(),
        &doc.path,
        "已确认但角色事务失败的工作",
        &files::hash("最初内容"),
    )
    .unwrap();
    companion::record_save(data.path(), &f.ws, &doc.path, &saved.hash).unwrap();
    let preview = companion::preview(data.path(), &f.ws, &doc.path).unwrap();
    let input = companion::ConfirmInput {
        context: preview.context,
        token: preview.token,
        event_id: preview.event_id,
        text: "待重试的已确认经历".into(),
        kind: "complete".into(),
        consent: true,
    };
    assert!(companion::confirm_pending_for_backup_test(data.path(), &f.ws, input.clone()).is_err());
    let pending = companion::state(data.path()).unwrap();
    assert_eq!(pending.events, 1);
    assert_eq!(pending.pending.len(), 1);
    let backup = out.path().join("pending.zip");
    create_backup(data.path(), &backup).unwrap();
    let target = out.path().join("pending-profile");
    restore_backup(&backup, &target, data.path()).unwrap();
    let restored = companion::state(&target).unwrap();
    assert_eq!(restored.events, 1);
    assert_eq!(restored.pending.len(), 1);
    let ws = crate::documents::library_workspace(&target, "inbox").unwrap();
    assert_eq!(
        files::hash(fs::read(ws.root.join(&doc.path)).unwrap()),
        saved.hash
    );
    let retried = companion::confirm(&target, &ws, input.clone()).unwrap();
    assert_eq!(retried.status, "counted");
    assert_eq!(retried.snapshot.events, 2);
    assert!(retried.snapshot.pending.is_empty());
    let duplicate = companion::confirm(&target, &ws, input).unwrap();
    assert_eq!(duplicate.status, "duplicate");
    assert_eq!(duplicate.snapshot.events, 2);
    assert_eq!(
        companion::state(data.path()).unwrap().pending.len(),
        1,
        "restore preview must not consume live profile intent"
    );
}
