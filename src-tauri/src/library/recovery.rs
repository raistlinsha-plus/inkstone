//! Durable, per-item recovery diagnostics. Recovery never replays body bytes.
use super::*;
use rusqlite::OptionalExtension;

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryItem {
    pub operation_id: String,
    pub document_id: Option<String>,
    pub project_id: Option<String>,
    pub kind: String,
    pub status: String,
    pub retryable: bool,
    pub message: String,
}
#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryReport {
    pub checked_at: i64,
    pub items: Vec<RecoveryItem>,
}
const KEY: &str = "recovery.diagnostics.v1";
pub fn recovery_report(data: &Path) -> Result<RecoveryReport, String> {
    let raw: Option<String> = conn(data)?
        .query_row("SELECT value FROM preferences WHERE key=?", [KEY], |r| {
            r.get(0)
        })
        .optional()
        .map_err(err)?;
    match raw {
        Some(raw) => serde_json::from_str(&raw)
            .map_err(|_| "恢复诊断记录损坏，请保留目录库并检查备份".into()),
        None => Ok(RecoveryReport::default()),
    }
}
pub(super) fn run(data: &Path) -> Result<RecoveryReport, String> {
    // Catalogue/migration errors remain global failures. A damaged individual
    // journal or file is isolated below and cannot stop healthy later items.
    let c = conn(data)?;
    let previous = recovery_report(data);
    let mut report = previous.clone().unwrap_or_default();
    if previous.is_err() {
        report.items.push(RecoveryItem {
            operation_id: "diagnostic-storage".into(),
            document_id: None,
            project_id: None,
            kind: "diagnostic".into(),
            status: "needs-review".into(),
            retryable: false,
            message:
                "旧诊断无法解析；原始值已保留在 recovery.diagnostics.corrupt，请核对目录备份。"
                    .into(),
        });
        c.execute("INSERT OR IGNORE INTO preferences(key,value) SELECT 'recovery.diagnostics.corrupt',value FROM preferences WHERE key=?", [KEY]).map_err(err)?;
    }
    let pending = c
        .prepare("SELECT id,project,path FROM documents WHERE status='pending' ORDER BY rowid")
        .map_err(err)?
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    let mut next = vec![];
    for (id, project, path) in pending {
        let result = (|| {
            let root = project_root(data, &project)?;
            files::validate_relative(&path)?;
            let joined = root.join(&path);
            // A missing staged body never becomes a half-document. Unreadable
            // or unsafe bodies remain isolated for review, never deleted.
            if !joined.try_exists().map_err(err)? {
                c.execute("DELETE FROM documents WHERE id=?", [&id])
                    .map_err(err)?;
                return Ok((
                    "interrupted",
                    false,
                    "导入在正文落盘前中断；当前资料未覆盖。".to_string(),
                ));
            }
            let p = files::resolve(&root, &path, false)?;
            files::read_text(&p)?;
            c.execute("UPDATE documents SET status='ready' WHERE id=?", [&id])
                .map_err(err)?;
            Ok((
                "recovered",
                false,
                "已找到完整正文，导入已恢复。".to_string(),
            ))
        })();
        let (status, retryable, message) = result.unwrap_or_else(|e: String| {
            (
                "needs-review",
                true,
                format!("导入记录待核对，原文件保留：{e}"),
            )
        });
        next.push(RecoveryItem {
            operation_id: format!("import:{id}"),
            document_id: Some(id),
            project_id: Some(project),
            kind: "import".into(),
            status: status.into(),
            retryable,
            message,
        });
    }
    c.execute(
        "UPDATE imports SET status='interrupted' WHERE status='running'",
        [],
    )
    .map_err(err)?;
    // Staging is retained for diagnosis instead of deleting evidence merely
    // because startup ran. Ready documents never live in .pending-* folders.
    next.extend(updates::recover_operations(data)?);
    for item in next {
        if let Some(old) = report
            .items
            .iter_mut()
            .find(|r| r.operation_id == item.operation_id)
        {
            *old = item;
        } else {
            report.items.push(item);
        }
    }
    report.checked_at = now();
    c.execute(
        "INSERT OR REPLACE INTO preferences(key,value) VALUES(?,?)",
        params![KEY, serde_json::to_string(&report).map_err(err)?],
    )
    .map_err(err)?;
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn damaged_first_operation_is_isolated_later_metadata_recovers_and_report_survives_restart() {
        let data = tempfile::tempdir().unwrap();
        let bad = create_document(data.path(), "inbox", "bad.md", "坏记录的正文仍保留").unwrap();
        let good = create_document(data.path(), "inbox", "good.md", "正文已写入").unwrap();
        let changed =
            create_document(data.path(), "inbox", "changed.md", "用户后来写的正文").unwrap();
        let c = conn(data.path()).unwrap();
        for (op, d, target, metadata) in [
            ("bad", &bad, files::hash("坏记录的正文仍保留"), "not-json"),
            (
                "good",
                &good,
                files::hash("正文已写入"),
                "{\"baseline\":null,\"original_hash\":null,\"import_fingerprint\":null}",
            ),
            (
                "changed",
                &changed,
                files::hash("旧正文"),
                "{\"baseline\":null,\"original_hash\":null,\"import_fingerprint\":null}",
            ),
        ] {
            c.execute(
                "INSERT INTO library_operations VALUES(?,?, '',?,?,'prepared')",
                params![op, d.id, target, metadata],
            )
            .unwrap();
        }
        let report = recover(data.path()).unwrap();
        assert_eq!(report.items.len(), 3);
        assert_eq!(
            report
                .items
                .iter()
                .find(|i| i.operation_id == "bad")
                .unwrap()
                .status,
            "needs-review"
        );
        assert_eq!(
            report
                .items
                .iter()
                .find(|i| i.operation_id == "good")
                .unwrap()
                .status,
            "recovered"
        );
        assert_eq!(
            report
                .items
                .iter()
                .find(|i| i.operation_id == "changed")
                .unwrap()
                .status,
            "interrupted"
        );
        assert_eq!(
            files::read_text(
                &project_root(data.path(), "inbox")
                    .unwrap()
                    .join(&changed.path)
            )
            .unwrap(),
            "用户后来写的正文"
        );
        assert_eq!(recovery_report(data.path()).unwrap().items.len(), 3);
        let report = recover(data.path()).unwrap();
        assert_eq!(report.items.len(), 3);
        assert_eq!(
            report
                .items
                .iter()
                .find(|i| i.operation_id == "good")
                .unwrap()
                .status,
            "recovered"
        );
        c.execute(
            "UPDATE library_operations SET metadata=? WHERE id='bad'",
            ["{\"baseline\":null,\"original_hash\":null,\"import_fingerprint\":null}"],
        )
        .unwrap();
        let report = recover(data.path()).unwrap();
        assert_eq!(
            report
                .items
                .iter()
                .find(|i| i.operation_id == "bad")
                .unwrap()
                .status,
            "recovered"
        );
        assert_eq!(history(data.path(), &bad.id).unwrap().len(), 0);
    }
    #[test]
    fn unsafe_pending_document_does_not_prevent_healthy_recovery_and_diagnostics_are_preserved() {
        let data = tempfile::tempdir().unwrap();
        let c = conn(data.path()).unwrap();
        let good = create_document(data.path(), "inbox", "good.md", "完整正文").unwrap();
        c.execute(
            "UPDATE documents SET status='pending' WHERE id=?",
            [&good.id],
        )
        .unwrap();
        c.execute("INSERT INTO documents(id,project,path,title,original_hash,source,updated,status) VALUES('unsafe','inbox','../unsafe.md','unsafe.md','','',0,'pending')",[]).unwrap();
        c.execute(
            "INSERT INTO preferences VALUES('recovery.diagnostics.v1','broken old report')",
            [],
        )
        .unwrap();
        let report = recover(data.path()).unwrap();
        assert_eq!(get(data.path(), &good.id).unwrap().status, "ready");
        assert!(report
            .items
            .iter()
            .any(|i| i.document_id.as_deref() == Some("unsafe") && i.status == "needs-review"));
        assert!(report.items.iter().any(|i| i.kind == "diagnostic"));
        let old: String = c
            .query_row(
                "SELECT value FROM preferences WHERE key='recovery.diagnostics.corrupt'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(old, "broken old report");
    }
}
