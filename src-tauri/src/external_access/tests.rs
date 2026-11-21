use super::*;

#[test]
fn missing_grant_cannot_create_or_open_a_library() {
    let data = tempfile::tempdir().unwrap();
    let result = search(
        data.path(),
        "inbox",
        &uuid::Uuid::new_v4().to_string(),
        "示例",
    );
    assert!(matches!(result, Err(AccessError::Denied)));
    assert_eq!(data.path().read_dir().unwrap().count(), 0);
}

fn fixture(data: &Path, space: &str, text: &str) -> (library::Document, Workspace) {
    let doc = library::create_document(data, space, "活动.md", text).unwrap();
    let root = library::project_root(data, space).unwrap();
    let workspace = Workspace {
        db: crate::workspace_index_path(data, &root),
        root,
    };
    std::fs::create_dir_all(workspace.db.parent().unwrap()).unwrap();
    index(&workspace, &doc, text);
    (doc, workspace)
}

fn index(workspace: &Workspace, doc: &library::Document, text: &str) {
    let mut index = db::open(&workspace.db).unwrap();
    db::refresh_lexical(
        &mut index,
        &doc.path,
        &files::hash(text),
        &db::local_chunks(text, &doc.path, 900),
        &doc.title,
    )
    .unwrap();
}

#[test]
fn same_title_scope_version_reindex_trash_and_revocation() {
    let tmp = tempfile::tempdir().unwrap();
    let data = tmp.path();
    let other = library::create_project(data, "其他空间").unwrap();
    let (doc, ws) = fixture(data, "inbox", "阅读活动原计划四场。\n周三举办。");
    fixture(data, &other.id, "其他活动内容不可见。");
    let token = grants::create(data, "inbox", "示例工具").unwrap();
    let other_token = grants::create(data, &other.id, "另一工具").unwrap();
    assert!(matches!(
        search(data, &other.id, &token, "活动"),
        Err(AccessError::Denied)
    ));
    let result = search(data, "inbox", &token, "阅读活动").unwrap();
    assert_eq!(result.results.len(), 1);
    let hit = &result.results[0];
    assert_eq!(hit.excerpt.document_id, doc.id);
    assert!(hit.excerpt.text.contains("原计划四场"));
    let conn = db::open(&ws.db).unwrap();
    let lexical = db::lexical_scored(&conn, "阅读活动", None).unwrap();
    let expected = db::merge_candidates(&conn, &ws, &lexical, &[]).unwrap();
    assert_eq!(
        (
            expected[0].hash.as_str(),
            expected[0].start_line,
            expected[0].end_line
        ),
        (
            hit.excerpt.version.as_str(),
            hit.excerpt.start_line,
            hit.excerpt.end_line
        )
    );
    assert!(matches!(
        read(data, &other.id, &other_token, &hit.reference),
        Err(AccessError::ReferenceUnavailable)
    ));
    let write = library::conn(data).unwrap();
    write.execute_batch("BEGIN IMMEDIATE").unwrap();
    let excerpt = read(data, "inbox", &token, &hit.reference).unwrap();
    assert_eq!(excerpt.text, hit.excerpt.text);
    assert_eq!(
        search(data, "inbox", &token, "阅读活动")
            .unwrap()
            .results
            .len(),
        1
    );
    write.execute_batch("ROLLBACK").unwrap();
    let previous = std::fs::read_to_string(ws.root.join(&doc.path)).unwrap();
    files::write_atomic(&ws.root.join(&doc.path), "阅读活动改为五场。".as_bytes()).unwrap();
    assert!(matches!(
        read(data, "inbox", &token, &hit.reference),
        Err(AccessError::StaleReference)
    ));
    assert!(search(data, "inbox", &token, "阅读活动")
        .unwrap()
        .results
        .is_empty());
    files::write_atomic(&ws.root.join(&doc.path), previous.as_bytes()).unwrap();
    db::delete_document(&conn, &doc.path).unwrap();
    index(&ws, &doc, &previous);
    assert_eq!(
        read(data, "inbox", &token, &hit.reference).unwrap().text,
        previous
    );
    write
        .execute(
            "UPDATE documents SET status='trashed' WHERE id=?",
            [&doc.id],
        )
        .unwrap();
    assert!(matches!(
        read(data, "inbox", &token, &hit.reference),
        Err(AccessError::ReferenceUnavailable)
    ));
    assert!(search(data, "inbox", &token, "阅读活动")
        .unwrap()
        .results
        .is_empty());
    let grant = grants::list(data)
        .unwrap()
        .into_iter()
        .find(|g| g.space == "inbox")
        .unwrap();
    grants::revoke(data, &grant.id).unwrap();
    assert!(matches!(
        read(data, "inbox", &token, &hit.reference),
        Err(AccessError::Denied)
    ));
    assert!(matches!(
        search(data, "inbox", &token, "阅读活动"),
        Err(AccessError::Denied)
    ));
}

#[test]
fn legacy_and_missing_indexes_remain_untouched_and_output_is_bounded() {
    let tmp = tempfile::tempdir().unwrap();
    let data = tmp.path();
    let (doc, ws) = fixture(data, "inbox", &"知识笔记".repeat(1000));
    let token = grants::create(data, "inbox", "示例工具").unwrap();
    let conn = db::open(&ws.db).unwrap();
    let changes = || {
        conn.pragma_query_value(None, "data_version", |r| r.get::<_, i64>(0))
            .unwrap()
    };
    let before = changes();
    let result = search(data, "inbox", &token, "知识笔记").unwrap();
    assert!(!result.results.is_empty());
    assert!(result
        .results
        .iter()
        .all(|h| h.excerpt.text.chars().count() <= MAX_CHARS));
    assert_eq!(changes(), before);
    let reference = format!(
        "v1:inbox:{}:{}:1:10000000",
        doc.id, result.results[0].excerpt.version
    );
    assert!(matches!(
        read(data, "inbox", &token, &reference),
        Err(AccessError::BadRequest)
    ));
    conn.pragma_update(None, "user_version", 2).unwrap();
    assert!(matches!(
        search(data, "inbox", &token, "知识笔记"),
        Err(AccessError::UpgradeRequired)
    ));
    assert_eq!(
        conn.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        2
    );
    drop(conn);
    std::fs::remove_file(&ws.db).unwrap();
    assert!(matches!(
        search(data, "inbox", &token, "知识笔记"),
        Err(AccessError::IndexNotReady)
    ));
    assert!(!ws.db.exists());
}
