//! Durable deletion of an explicitly confirmed managed copy. No source path is a target.
use super::*;
use crate::{documents, maintenance, models::Workspace};
use rusqlite::OptionalExtension;
use sha2::{Digest, Sha256};
use std::io::Read;

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TrashDetail {
    pub document_id: String,
    pub project_id: String,
    pub title: String,
    pub status: String,
    pub trashed_at: Option<i64>,
    pub attachments: usize,
    pub history: usize,
    pub bytes: u64,
    pub operation_id: Option<String>,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PurgePreview {
    pub detail: TrashDetail,
    pub token: String,
    pub expires_at: i64,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PurgeResult {
    pub operation_id: String,
    pub status: String,
    pub message: String,
}
#[derive(Clone, Serialize, Deserialize)]
struct Plan {
    document: Document,
    roots: Vec<String>,
    digest: String,
}
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
struct Member {
    root: usize,
    path: String,
    directory: bool,
    bytes: u64,
    hash: String,
}

pub fn require_ready(data: &Path, ws: &Workspace, path: &str) -> Result<(), String> {
    if maintenance::is_managed_root(data, &ws.root) && title_for(data, &ws.root, path).is_none() {
        return Err("SOURCE_UNAVAILABLE:文档不在当前空间、已移入回收站或正在彻底删除".into());
    }
    Ok(())
}
fn checked(data: &Path, project: &str, id: &str) -> Result<Document, String> {
    let d = get(data, id)?;
    if d.project_id != project {
        return Err("文档不在指定空间".into());
    }
    uuid::Uuid::parse_str(id).map_err(|_| "文档标识无效")?;
    let prefix = format!("documents/{id}/");
    if !d.path.starts_with(&prefix) || Path::new(&d.path).components().count() != 3 {
        return Err("SOURCE_UNSAFE:副本路径不是文档专属目录".into());
    }
    Ok(d)
}
/// Reject symlinks at every component, including dangling links and directory roots.
fn safe(data: &Path, relative: &str) -> Result<PathBuf, String> {
    files::validate_relative(relative)?;
    let mut p = data.to_path_buf();
    for part in Path::new(relative).components() {
        p.push(part);
        match fs::symlink_metadata(&p) {
            Ok(m) if m.file_type().is_symlink() => {
                return Err("SOURCE_UNSAFE:清理路径包含符号链接".into())
            }
            Ok(_) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => return Err(err(e)),
        }
    }
    Ok(p)
}
fn sync_parent(path: &Path) -> Result<(), String> {
    fs::File::open(path.parent().ok_or("目录不存在")?)
        .map_err(err)?
        .sync_all()
        .map_err(err)
}
fn make_stage(data: &Path, op: &str) -> Result<PathBuf, String> {
    let p = safe(data, &format!("library/purge-staging/{op}"))?;
    fs::create_dir_all(&p).map_err(err)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&p, fs::Permissions::from_mode(0o700)).map_err(err)?;
    }
    sync_parent(&p)?;
    Ok(p)
}
fn roots(data: &Path, d: &Document) -> Result<Vec<String>, String> {
    let canonical_data = data.canonicalize().map_err(err)?;
    let ws = documents::library_workspace(data, &d.project_id)?;
    let doc = ws.root.join("documents").join(&d.id);
    let history = base(data).join("history").join(&d.id);
    let draft = files::draft_path(data, &ws, &d.path);
    [doc, history, draft]
        .into_iter()
        .map(|p| {
            p.strip_prefix(data)
                .or_else(|_| p.strip_prefix(&canonical_data))
                .map(|p| p.to_string_lossy().into_owned())
                .map_err(err)
        })
        .collect()
}
fn inventory(data: &Path, paths: &[String], stage: Option<&Path>) -> Result<Vec<Member>, String> {
    let mut out = vec![];
    let mut total = 0u64;
    for (i, relative) in paths.iter().enumerate() {
        let root = match stage {
            Some(stage) => stage.join(i.to_string()),
            None => safe(data, relative)?,
        };
        match fs::symlink_metadata(&root) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(err(e)),
            Ok(_) => (),
        }
        for e in walkdir::WalkDir::new(&root).follow_links(false) {
            let e = e.map_err(err)?;
            if e.file_type().is_symlink() || !(e.file_type().is_file() || e.file_type().is_dir()) {
                return Err("SOURCE_UNSAFE:副本包含不支持的链接或文件".into());
            }
            let relative = e
                .path()
                .strip_prefix(&root)
                .map_err(err)?
                .to_string_lossy()
                .into_owned();
            let directory = e.file_type().is_dir();
            let bytes = if directory {
                0
            } else {
                e.metadata().map_err(err)?.len()
            };
            total = total.checked_add(bytes).ok_or("副本体积超限")?;
            if out.len() >= 50000 || total > 2 * 1024 * 1024 * 1024 {
                return Err("副本与历史体积超出安全清理范围，请先检查资料".into());
            }
            let hash = if directory {
                String::new()
            } else {
                let mut input = fs::File::open(e.path()).map_err(err)?;
                let mut digest = Sha256::new();
                let mut buffer = [0u8; 65536];
                loop {
                    let n = input.read(&mut buffer).map_err(err)?;
                    if n == 0 {
                        break;
                    }
                    digest.update(&buffer[..n]);
                }
                format!("{:x}", digest.finalize())
            };
            out.push(Member {
                root: i,
                path: relative,
                directory,
                bytes,
                hash,
            });
        }
    }
    out.sort();
    Ok(out)
}
fn digest(
    data: &Path,
    d: &Document,
    paths: &[String],
    members: &[Member],
) -> Result<String, String> {
    let c = conn(data)?;
    let revision: i64 = c
        .query_row(
            "SELECT lifecycle_revision FROM documents WHERE id=?",
            [&d.id],
            |r| r.get(0),
        )
        .map_err(err)?;
    Ok(files::hash(
        serde_json::to_vec(&(d, revision, paths, members)).map_err(err)?,
    ))
}
pub fn detail(data: &Path, project: &str, id: &str) -> Result<TrashDetail, String> {
    let d = checked(data, project, id)?;
    if d.status != "trashed" && d.status != "purging" {
        return Err("NOT_TRASHED:文档不在回收站".into());
    }
    let paths = roots(data, &d)?;
    let members = inventory(data, &paths, None)?;
    let c = conn(data)?;
    Ok(TrashDetail {
        document_id: id.into(),
        project_id: project.into(),
        title: d.title,
        status: d.status,
        trashed_at: c
            .query_row("SELECT trashed_at FROM documents WHERE id=?", [id], |r| {
                r.get(0)
            })
            .map_err(err)?,
        attachments: members
            .iter()
            .filter(|m| m.root == 0 && !m.directory)
            .count()
            .saturating_sub(1),
        history: c
            .query_row(
                "SELECT COUNT(*) FROM document_history WHERE document=?",
                [id],
                |r| r.get(0),
            )
            .map_err(err)?,
        bytes: members.iter().map(|m| m.bytes).sum(),
        operation_id: c.query_row("SELECT id FROM document_purges WHERE document=? AND phase IN ('prepared','committed') ORDER BY rowid DESC LIMIT 1",[id],|r|r.get(0)).optional().map_err(err)?,
    })
}
pub fn preview(data: &Path, project: &str, id: &str) -> Result<PurgePreview, String> {
    let _permit = maintenance::mutation(data)?;
    let d = checked(data, project, id)?;
    if d.status != "trashed" {
        return Err("NOT_TRASHED:请先将文档移入回收站".into());
    }
    let paths = roots(data, &d)?;
    let members = inventory(data, &paths, None)?;
    let hash = digest(data, &d, &paths, &members)?;
    let token = uuid::Uuid::new_v4().to_string();
    let expires = now() + 300;
    let c = conn(data)?;
    c.execute("DELETE FROM purge_previews WHERE expires<?", [now()])
        .map_err(err)?;
    c.execute(
        "INSERT INTO purge_previews VALUES(?,?,?,?,?)",
        params![token, id, project, expires, hash],
    )
    .map_err(err)?;
    Ok(PurgePreview {
        detail: detail(data, project, id)?,
        token,
        expires_at: expires,
    })
}
fn result(op: &str, status: &str, message: &str) -> PurgeResult {
    PurgeResult {
        operation_id: op.into(),
        status: status.into(),
        message: message.into(),
    }
}
pub fn status(data: &Path, project: &str, op: &str) -> Result<PurgeResult, String> {
    let row: (String, String) = conn(data)?
        .query_row(
            "SELECT phase,error FROM document_purges WHERE id=? AND project=?",
            params![op, project],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(err)?;
    Ok(result(
        op,
        if row.0 == "completed" {
            "completed"
        } else if row.0 == "rolledBack" {
            "notStarted"
        } else {
            "pendingCleanup"
        },
        &row.1,
    ))
}
pub fn execute(
    data: &Path,
    project: &str,
    id: &str,
    token: &str,
    op: &str,
    confirmation: &str,
) -> Result<PurgeResult, String> {
    if confirmation != "删除" {
        return Err("请输入“删除”确认".into());
    }
    uuid::Uuid::parse_str(op).map_err(|_| "操作标识无效")?;
    let _exclusive = maintenance::exclusive(data)?;
    let mut c = conn(data)?;
    c.pragma_update(None, "synchronous", "FULL").map_err(err)?;
    let old: Option<(String, String, String)> = c
        .query_row(
            "SELECT document,project,phase FROM document_purges WHERE id=?",
            [op],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(err)?;
    if let Some((doc, space, phase)) = old {
        if doc != id || space != project {
            return Err("操作标识与文档不符".into());
        }
        if phase == "completed" {
            return Ok(result(op, "completed", "已彻底删除"));
        }
        if phase == "rolledBack" {
            return Ok(result(op, "notStarted", "尚未删除，请重新预览"));
        }
        return resume(data, op);
    }
    let d = checked(data, project, id)?;
    if d.status != "trashed" {
        return Err("NOT_TRASHED:文档已不在回收站".into());
    }
    let row: Option<(i64, String)> = c
        .query_row(
            "SELECT expires,digest FROM purge_previews WHERE token=? AND document=? AND project=?",
            params![token, id, project],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(err)?;
    let (expires, expected) = row.ok_or("STALE_PREVIEW:删除预览已失效，请重新核对")?;
    let paths = roots(data, &d)?;
    let members = inventory(data, &paths, None)?;
    if expires < now() || expected != digest(data, &d, &paths, &members)? {
        return Err("STALE_PREVIEW:文档状态已变化，尚未删除".into());
    }
    // Persist intent before the first move. Missing destinations can be reconstructed.
    let plan = Plan {
        document: d,
        roots: paths,
        digest: files::hash(serde_json::to_vec(&members).map_err(err)?),
    };
    let tx = c.transaction().map_err(err)?;
    tx.execute(
        "INSERT INTO document_purges(id,document,project,phase,payload) VALUES(?,?,?,'prepared',?)",
        params![op, id, project, serde_json::to_string(&plan).map_err(err)?],
    )
    .map_err(err)?;
    tx.execute(
        "UPDATE documents SET status='purging',lifecycle_revision=lifecycle_revision+1 WHERE id=?",
        [id],
    )
    .map_err(err)?;
    tx.execute("DELETE FROM purge_previews WHERE document=?", [id])
        .map_err(err)?;
    tx.commit().map_err(err)?;
    let staged: Result<(), String> = (|| {
        let stage = make_stage(data, op)?;
        for (i, p) in plan.roots.iter().enumerate() {
            let source = safe(data, p)?;
            let dest = stage.join(i.to_string());
            if fs::symlink_metadata(&source).is_ok() {
                fs::rename(&source, &dest).map_err(err)?;
                sync_parent(&source)?;
                sync_parent(&dest)?;
            }
        }
        if files::hash(
            serde_json::to_vec(&inventory(data, &plan.roots, Some(&stage))?).map_err(err)?,
        ) != plan.digest
        {
            return Err("副本在准备期间变化，尚未删除".into());
        }
        fault("prepared")?;
        c.execute(
            "UPDATE document_purges SET phase='committed' WHERE id=?",
            [op],
        )
        .map_err(err)?;
        Ok(())
    })();
    if let Err(error) = staged {
        rollback(data, op, &plan).map_err(|rollback| {
            let message = format!("删除准备未完成且需修复：{error}；{rollback}");
            maintenance::set_managed_error(data, Some(message.clone()));
            message
        })?;
        return Ok(result(op, "notStarted", &format!("尚未删除：{error}")));
    }
    resume(data, op)
}
fn rollback(data: &Path, op: &str, plan: &Plan) -> Result<(), String> {
    let stage = safe(data, &format!("library/purge-staging/{op}"))?;
    for (i, p) in plan.roots.iter().enumerate().rev() {
        let from = stage.join(i.to_string());
        let to = safe(data, p)?;
        if fs::symlink_metadata(&from).is_ok() {
            if fs::symlink_metadata(&to).is_ok() {
                return Err("原位置已有文件，请保留两份并修复".into());
            }
            fs::create_dir_all(to.parent().ok_or("原目录不可用")?).map_err(err)?;
            fs::rename(&from, &to).map_err(err)?;
            sync_parent(&from)?;
            sync_parent(&to)?;
        }
    }
    let mut c = conn(data)?;
    let tx = c.transaction().map_err(err)?;
    tx.execute(
        "UPDATE documents SET status='trashed',lifecycle_revision=lifecycle_revision+1 WHERE id=?",
        [&plan.document.id],
    )
    .map_err(err)?;
    tx.execute("UPDATE document_purges SET phase='rolledBack',payload='',error='尚未删除，请重新预览' WHERE id=?",[op]).map_err(err)?;
    tx.commit().map_err(err)?;
    if stage.exists() {
        fs::remove_dir(&stage).map_err(err)?;
        sync_parent(&stage)?
    }
    Ok(())
}
fn resume(data: &Path, op: &str) -> Result<PurgeResult, String> {
    uuid::Uuid::parse_str(op).map_err(|_| "删除操作标识无效")?;
    let c = conn(data)?;
    let (phase, payload): (String, String) = c
        .query_row(
            "SELECT phase,payload FROM document_purges WHERE id=?",
            [op],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(err)?;
    let plan: Plan = serde_json::from_str(&payload).map_err(err)?;
    validate_plan(data, &plan)?;
    if phase == "prepared" {
        rollback(data, op, &plan)?;
        return Ok(result(op, "notStarted", "尚未删除，已恢复到回收站"));
    }
    let cleaned: Result<(), String> = (|| {
        fault("committed")?;
        let d = &plan.document;
        let ws = documents::library_workspace(data, &d.project_id)?;
        let data_root = data.canonicalize().map_err(err)?;
        for p in [&ws.db, &data.join("calendar.sqlite3")] {
            let relative = p
                .strip_prefix(data)
                .or_else(|_| p.strip_prefix(&data_root))
                .map_err(err)?;
            safe(data, &relative.to_string_lossy())?;
        }
        if ws.db.exists() {
            let mut index = crate::db::open(&ws.db)?;
            let tx = index.transaction().map_err(err)?;
            crate::db::delete_document(&tx, &d.path)?;
            tx.execute("DELETE FROM index_attempts WHERE path=?", [&d.path])
                .map_err(err)?;
            tx.commit().map_err(err)?;
        }
        crate::calendar::purge_document(data, &d.project_id, &d.id)?;
        crate::companion::purge_source(data, &d.id)?;
        fault("derived")?;
        let stage = safe(data, &format!("library/purge-staging/{op}"))?;
        if stage.exists() {
            for entry in fs::read_dir(&stage).map_err(err)? {
                let entry = entry.map_err(err)?;
                let name = entry.file_name().to_string_lossy().into_owned();
                if !(0..plan.roots.len()).any(|i| i.to_string() == name) {
                    return Err("SOURCE_UNSAFE:清理暂存区出现未知文件".into());
                }
            }
        }
        // Resuming a partially removed tree is allowed; links introduced since staging are not.
        let _ = inventory(data, &plan.roots, Some(&stage))?;
        if stage.exists() {
            fs::remove_dir_all(&stage).map_err(err)?;
            sync_parent(&stage)?;
        }
        // Refuse success if an unexpected late writer recreated an owned root.
        if plan
            .roots
            .iter()
            .any(|p| safe(data, p).is_ok_and(|p| fs::symlink_metadata(p).is_ok()))
        {
            return Err("检测到副本重新出现，请核对后重试清理".into());
        }
        let mut c = conn(data)?;
        let tx = c.transaction().map_err(err)?;
        for table in ["document_history", "source_baselines", "library_operations"] {
            tx.execute(&format!("DELETE FROM {table} WHERE document=?"), [&d.id])
                .map_err(err)?;
        }
        tx.execute(
            "UPDATE import_items SET document=NULL WHERE document=?",
            [&d.id],
        )
        .map_err(err)?;
        let key = format!("pins:{}", d.project_id);
        let pins: Option<String> = tx
            .query_row("SELECT value FROM preferences WHERE key=?", [&key], |r| {
                r.get(0)
            })
            .optional()
            .map_err(err)?;
        if let Some(raw) = pins {
            let mut ids: Vec<String> = serde_json::from_str(&raw).map_err(err)?;
            ids.retain(|id| id != &d.id);
            tx.execute(
                "UPDATE preferences SET value=? WHERE key=?",
                params![serde_json::to_string(&ids).map_err(err)?, key],
            )
            .map_err(err)?;
        }
        tx.execute(
            "DELETE FROM documents WHERE id=? AND status='purging'",
            [&d.id],
        )
        .map_err(err)?;
        tx.execute(
            "UPDATE document_purges SET phase='completed',payload='',error='' WHERE id=?",
            [op],
        )
        .map_err(err)?;
        tx.commit().map_err(err)?;
        Ok(())
    })();
    match cleaned {
        Ok(()) => Ok(result(op, "completed", "已彻底删除")),
        Err(error) => {
            c.execute(
                "UPDATE document_purges SET error=? WHERE id=?",
                params![error, op],
            )
            .map_err(err)?;
            Ok(result(
                op,
                "pendingCleanup",
                &format!("删除未完成，请重试清理：{error}"),
            ))
        }
    }
}
fn validate_plan(data: &Path, plan: &Plan) -> Result<(), String> {
    uuid::Uuid::parse_str(&plan.document.id).map_err(|_| "删除日志文档标识无效")?;
    let d = get(data, &plan.document.id)?;
    if d.status != "purging"
        || d.project_id != plan.document.project_id
        || d.path != plan.document.path
        || roots(data, &d)? != plan.roots
    {
        return Err("删除日志与副本身份不符".into());
    }
    for p in &plan.roots {
        safe(data, p)?;
    }
    Ok(())
}
pub fn recover(data: &Path) -> Result<(), String> {
    let c = conn(data)?;
    let ops = c
        .prepare(
            "SELECT id FROM document_purges WHERE phase IN ('prepared','committed') ORDER BY id",
        )
        .map_err(err)?
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    for op in ops {
        let result = resume(data, &op)?;
        if result.status == "pendingCleanup" {
            return Err(result.message);
        }
    }
    Ok(())
}
#[cfg(not(test))]
fn fault(_: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (tempfile::TempDir, Document, Workspace) {
        let data = tempfile::tempdir().unwrap();
        let d = create_document(
            data.path(),
            "inbox",
            "计划.md",
            "# 有效资料\n\n甲方案有120人。",
        )
        .unwrap();
        let ws = documents::library_workspace(data.path(), "inbox").unwrap();
        documents::refresh_local(&ws, data.path(), &d.path, "甲方案有120人。").unwrap();
        documents::draft(&ws, data.path(), &d.path, "待恢复正文".into(), "old".into()).unwrap();
        trash(data.path(), &d.id, false).unwrap();
        (data, d, ws)
    }
    fn purge(data: &Path, d: &Document) -> PurgeResult {
        let p = preview(data, &d.project_id, &d.id).unwrap();
        execute(
            data,
            &d.project_id,
            &d.id,
            &p.token,
            &uuid::Uuid::new_v4().to_string(),
            "删除",
        )
        .unwrap()
    }
    #[test]
    fn purge_removes_owned_copy_history_draft_and_index_but_keeps_source_and_neighbour() {
        let (data, d, ws) = fixture();
        let external = tempfile::tempdir().unwrap();
        let original = external.path().join("原件.md");
        fs::write(&original, "不能删除原件").unwrap();
        conn(data.path())
            .unwrap()
            .execute(
                "UPDATE documents SET source=? WHERE id=?",
                params![original.to_string_lossy(), d.id],
            )
            .unwrap();
        let neighbour = create_document(data.path(), "inbox", "其他.md", "不能改变").unwrap();
        let owned = ws.root.join(&d.path).parent().unwrap().to_path_buf();
        fs::create_dir(owned.join("assets")).unwrap();
        fs::write(owned.join("assets/a.png"), b"asset").unwrap();
        let h = base(data.path())
            .join("history")
            .join(&d.id)
            .join("version");
        fs::create_dir_all(&h).unwrap();
        fs::write(h.join("body.md"), "历史").unwrap();
        let p = preview(data.path(), "inbox", &d.id).unwrap();
        assert_eq!(p.detail.attachments, 1);
        let op = uuid::Uuid::new_v4().to_string();
        let r = execute(data.path(), "inbox", &d.id, &p.token, &op, "删除").unwrap();
        assert_eq!(r.status, "completed");
        assert!(!owned.exists());
        assert!(!h.exists());
        assert!(!files::draft_path(data.path(), &ws, &d.path).exists());
        assert!(get(data.path(), &d.id).is_err());
        assert_eq!(fs::read_to_string(original).unwrap(), "不能删除原件");
        assert_eq!(
            fs::read_to_string(ws.root.join(&neighbour.path)).unwrap(),
            "不能改变"
        );
        assert!(!crate::db::paths(&crate::db::open(&ws.db).unwrap())
            .unwrap()
            .contains(&d.path));
        assert_eq!(
            execute(data.path(), "inbox", &d.id, &p.token, &op, "删除")
                .unwrap()
                .status,
            "completed"
        );
        assert_eq!(
            status(data.path(), "inbox", &op).unwrap().status,
            "completed"
        );
    }
    #[test]
    fn preview_rejects_ready_cross_space_changed_and_expired_sources() {
        let (data, d, ws) = fixture();
        assert!(preview(data.path(), "wrong", &d.id).is_err());
        let p = preview(data.path(), "inbox", &d.id).unwrap();
        fs::write(ws.root.join(&d.path), "外部修改").unwrap();
        assert!(execute(
            data.path(),
            "inbox",
            &d.id,
            &p.token,
            &uuid::Uuid::new_v4().to_string(),
            "删除"
        )
        .unwrap_err()
        .contains("STALE_PREVIEW"));
        let p = preview(data.path(), "inbox", &d.id).unwrap();
        conn(data.path())
            .unwrap()
            .execute(
                "UPDATE purge_previews SET expires=0 WHERE token=?",
                [&p.token],
            )
            .unwrap();
        assert!(execute(
            data.path(),
            "inbox",
            &d.id,
            &p.token,
            &uuid::Uuid::new_v4().to_string(),
            "删除"
        )
        .is_err());
        trash(data.path(), &d.id, true).unwrap();
        assert!(preview(data.path(), "inbox", &d.id).is_err());
    }
    #[test]
    fn preparing_failure_rolls_back_body_and_draft() {
        let (data, d, ws) = fixture();
        FAULT.with(|f| *f.borrow_mut() = Some("prepared"));
        let r = purge(data.path(), &d);
        assert_eq!(r.status, "notStarted");
        assert_eq!(get(data.path(), &d.id).unwrap().status, "trashed");
        assert!(ws.root.join(&d.path).exists());
        assert!(files::draft_path(data.path(), &ws, &d.path).exists());
        assert_eq!(purge(data.path(), &d).status, "completed");
    }
    #[test]
    fn committed_failure_stays_unavailable_and_resumes_after_restart() {
        let (data, d, ws) = fixture();
        FAULT.with(|f| *f.borrow_mut() = Some("committed"));
        let r = purge(data.path(), &d);
        assert_eq!(r.status, "pendingCleanup");
        assert_eq!(get(data.path(), &d.id).unwrap().status, "purging");
        assert!(trash(data.path(), &d.id, true).is_err());
        assert!(documents::read(&ws, data.path(), &d.path).is_err());
        assert!(documents::draft(&ws, data.path(), &d.path, "晚到草稿".into(), "".into()).is_err());
        let output = tempfile::tempdir().unwrap();
        assert!(
            maintenance::create_backup(data.path(), &output.path().join("blocked.zip")).is_err()
        );
        recover(data.path()).unwrap();
        assert_eq!(
            status(data.path(), "inbox", &r.operation_id)
                .unwrap()
                .status,
            "completed"
        );
        assert!(get(data.path(), &d.id).is_err());
    }
    #[test]
    fn partial_derived_cleanup_is_idempotent() {
        let (data, d, _) = fixture();
        FAULT.with(|f| *f.borrow_mut() = Some("derived"));
        let r = purge(data.path(), &d);
        assert_eq!(r.status, "pendingCleanup");
        recover(data.path()).unwrap();
        assert!(get(data.path(), &d.id).is_err());
    }
    #[test]
    fn prepared_process_interruption_restores_already_moved_root() {
        let (data, d, _) = fixture();
        let paths = roots(data.path(), &d).unwrap();
        let members = inventory(data.path(), &paths, None).unwrap();
        let op = uuid::Uuid::new_v4().to_string();
        let plan = Plan {
            document: d.clone(),
            roots: paths.clone(),
            digest: files::hash(serde_json::to_vec(&members).unwrap()),
        };
        let c = conn(data.path()).unwrap();
        c.execute("INSERT INTO document_purges(id,document,project,phase,payload) VALUES(?,?,?,'prepared',?)",params![op,d.id,d.project_id,serde_json::to_string(&plan).unwrap()]).unwrap();
        c.execute("UPDATE documents SET status='purging' WHERE id=?", [&d.id])
            .unwrap();
        let stage = make_stage(data.path(), &op).unwrap();
        fs::rename(safe(data.path(), &paths[0]).unwrap(), stage.join("0")).unwrap();
        recover(data.path()).unwrap();
        assert_eq!(get(data.path(), &d.id).unwrap().status, "trashed");
        assert!(safe(data.path(), &paths[0]).unwrap().exists());
    }
    #[test]
    fn existing_mutation_rejects_purge_before_any_move() {
        let (data, d, ws) = fixture();
        let p = preview(data.path(), "inbox", &d.id).unwrap();
        let _writer = maintenance::mutation(data.path()).unwrap();
        assert!(execute(
            data.path(),
            "inbox",
            &d.id,
            &p.token,
            &uuid::Uuid::new_v4().to_string(),
            "删除"
        )
        .unwrap_err()
        .contains("BUSY"));
        assert!(ws.root.join(&d.path).exists());
    }
    #[cfg(unix)]
    #[test]
    fn symlink_inside_owned_tree_never_deletes_external_target() {
        let (data, d, ws) = fixture();
        let target = tempfile::tempdir().unwrap();
        fs::write(target.path().join("keep"), "保留").unwrap();
        std::os::unix::fs::symlink(
            target.path(),
            ws.root.join(&d.path).parent().unwrap().join("unsafe"),
        )
        .unwrap();
        assert!(preview(data.path(), "inbox", &d.id)
            .unwrap_err()
            .contains("SOURCE_UNSAFE"));
        assert_eq!(
            fs::read_to_string(target.path().join("keep")).unwrap(),
            "保留"
        );
    }
    #[test]
    fn view_preferences_persist_per_space_and_validate_values() {
        let (data, _, _) = fixture();
        let p = create_project(data.path(), "另一个空间").unwrap();
        let prefs = ViewPreferences {
            sort: "nameDesc".into(),
            ..Default::default()
        };
        set_view(data.path(), "inbox", &prefs).unwrap();
        assert_eq!(get_view(data.path(), "inbox").unwrap().sort, "nameDesc");
        assert_eq!(get_view(data.path(), &p.id).unwrap().sort, "nameAsc");
        assert!(set_view(
            data.path(),
            "inbox",
            &ViewPreferences {
                sort: "opened".into(),
                ..prefs
            }
        )
        .is_err());
    }
}
#[cfg(test)]
thread_local! {static FAULT:std::cell::RefCell<Option<&'static str>>=const{std::cell::RefCell::new(None)};}
#[cfg(test)]
fn fault(at: &str) -> Result<(), String> {
    FAULT.with(|f| {
        if f.borrow().as_ref().is_some_and(|v| *v == at) {
            *f.borrow_mut() = None;
            Err(format!("synthetic {at} failure"))
        } else {
            Ok(())
        }
    })
}
