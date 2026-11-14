//! Managed plain-text library. The catalogue is disposable metadata; content stays in files.
use crate::files;
use pulldown_cmark::{Event, Parser, Tag};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};
pub mod lifecycle;
mod links;
mod recovery;
mod updates;
pub use links::{relink_apply, relink_preview, RelinkChoice, RelinkPreview};
pub use recovery::{recovery_report, RecoveryItem, RecoveryReport};
pub use updates::{
    apply_source_update, check_source_update, history, restore_version, HistoryVersion,
    SourceUpdatePreview, UpdateResult,
};
fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
pub fn base(data: &Path) -> PathBuf {
    data.join("library")
}
pub(crate) fn conn(data: &Path) -> Result<Connection, String> {
    fs::create_dir_all(base(data)).map_err(err)?;
    let mut c = Connection::open(base(data).join("catalog.sqlite3")).map_err(err)?;
    c.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(err)?;
    let version: i64 = c
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(err)?;
    if version > 4 {
        return Err("文档库来自更新版本，请使用对应应用打开".into());
    }
    if version > 0 && version < 4 {
        // SQLite itself copies the live database and WAL consistently before migration.
        let backup = base(data).join("backups");
        if fs::symlink_metadata(&backup).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err("升级备份目录不能是符号链接，未迁移".into());
        }
        fs::create_dir_all(&backup).map_err(err)?;
        let backup = backup.join(format!(
            "catalog-schema{version}-{}.sqlite3",
            uuid::Uuid::new_v4()
        ));
        c.execute("VACUUM INTO ?1", [backup.to_string_lossy().as_ref()])
            .map_err(|e| format!("升级前目录备份失败，未迁移：{e}"))?;
    }
    c.execute_batch("PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,title TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,project TEXT NOT NULL REFERENCES projects(id),path TEXT NOT NULL,title TEXT NOT NULL,original_hash TEXT NOT NULL,source TEXT NOT NULL,updated INTEGER NOT NULL,opened INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL,UNIQUE(project,path));
 CREATE TABLE IF NOT EXISTS imports(id TEXT PRIMARY KEY,project TEXT NOT NULL,paths TEXT NOT NULL,created INTEGER NOT NULL,status TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS import_items(job TEXT NOT NULL,source TEXT NOT NULL,status TEXT NOT NULL,document TEXT,message TEXT NOT NULL,PRIMARY KEY(job,source));
 CREATE TABLE IF NOT EXISTS preferences(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 ").map_err(err)?;
    let migration = c
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(err)?;
    let columns = migration
        .prepare("PRAGMA table_info(documents)")
        .map_err(err)?
        .query_map([], |r| r.get::<_, String>(1))
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    if !columns.iter().any(|name| name == "import_fingerprint") {
        migration
            .execute(
                "ALTER TABLE documents ADD COLUMN import_fingerprint TEXT NOT NULL DEFAULT ''",
                [],
            )
            .map_err(err)?;
    }
    if !columns.iter().any(|name| name == "trashed_at") {
        migration
            .execute("ALTER TABLE documents ADD COLUMN trashed_at INTEGER", [])
            .map_err(err)?;
    }
    if !columns.iter().any(|name| name == "lifecycle_revision") {
        migration
            .execute(
                "ALTER TABLE documents ADD COLUMN lifecycle_revision INTEGER NOT NULL DEFAULT 0",
                [],
            )
            .map_err(err)?;
    }
    migration.execute_batch("CREATE TABLE IF NOT EXISTS source_baselines(document TEXT PRIMARY KEY REFERENCES documents(id),source_fingerprint TEXT NOT NULL,managed_fingerprint TEXT NOT NULL,allowed_root TEXT NOT NULL,attachments INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS document_history(id TEXT PRIMARY KEY,document TEXT NOT NULL REFERENCES documents(id),created INTEGER NOT NULL,reason TEXT NOT NULL,content_hash TEXT NOT NULL,attachment_count INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS library_operations(id TEXT PRIMARY KEY,document TEXT NOT NULL REFERENCES documents(id),before_version TEXT NOT NULL,target_hash TEXT NOT NULL,metadata TEXT NOT NULL,status TEXT NOT NULL);").map_err(err)?;
    migration.execute_batch("CREATE TABLE IF NOT EXISTS document_purges(id TEXT PRIMARY KEY,document TEXT NOT NULL,project TEXT NOT NULL,phase TEXT NOT NULL,payload TEXT NOT NULL,error TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS purge_previews(token TEXT PRIMARY KEY,document TEXT NOT NULL,project TEXT NOT NULL,expires INTEGER NOT NULL,digest TEXT NOT NULL);").map_err(err)?;
    migration
        .pragma_update(None, "user_version", 4)
        .map_err(err)?;
    migration.commit().map_err(err)?;
    c.execute(
        "INSERT OR IGNORE INTO projects VALUES('inbox','收件箱',?)",
        [now()],
    )
    .map_err(err)?;
    Ok(c)
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub title: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub id: String,
    pub project_id: String,
    pub path: String,
    pub title: String,
    pub source: String,
    pub updated: i64,
    pub opened: i64,
    pub status: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryView {
    pub projects: Vec<Project>,
    pub documents: Vec<Document>,
    pub pending_imports: Vec<ImportTask>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportTask {
    pub id: String,
    pub project_id: String,
    pub paths: Vec<String>,
    pub status: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportItem {
    pub source: String,
    pub status: String,
    pub document_id: Option<String>,
    pub message: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgress {
    pub job_id: String,
    pub done: usize,
    pub total: usize,
    pub item: ImportItem,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub job_id: String,
    pub project_id: String,
    pub items: Vec<ImportItem>,
    pub warnings: Vec<String>,
    pub cancelled: bool,
}
fn doc_row(r: &rusqlite::Row) -> rusqlite::Result<Document> {
    Ok(Document {
        id: r.get(0)?,
        project_id: r.get(1)?,
        path: r.get(2)?,
        title: r.get(3)?,
        source: r.get(4)?,
        updated: r.get(5)?,
        opened: r.get(6)?,
        status: r.get(7)?,
    })
}
const DOC_COLS: &str = "id,project,path,title,source,updated,opened,status";
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ViewPreferences {
    pub version: u32,
    pub sort: String,
    pub pinned_collapsed: bool,
}
impl Default for ViewPreferences {
    fn default() -> Self {
        Self {
            version: 1,
            sort: "nameAsc".into(),
            pinned_collapsed: false,
        }
    }
}
pub fn get_view(data: &Path, project: &str) -> Result<ViewPreferences, String> {
    use rusqlite::OptionalExtension;
    project_root(data, project)?;
    let raw: Option<String> = conn(data)?
        .query_row(
            "SELECT value FROM preferences WHERE key=?",
            [format!("library.view.v1:{project}")],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    let p: ViewPreferences = match raw {
        Some(raw) => serde_json::from_str(&raw).map_err(|_| "排序偏好损坏")?,
        None => ViewPreferences::default(),
    };
    validate_view(&p)?;
    Ok(p)
}
fn validate_view(p: &ViewPreferences) -> Result<(), String> {
    if p.version != 1 || !["nameAsc", "nameDesc", "updatedDesc"].contains(&p.sort.as_str()) {
        return Err("排序偏好不兼容".into());
    }
    Ok(())
}
pub fn set_view(data: &Path, project: &str, p: &ViewPreferences) -> Result<(), String> {
    validate_view(p)?;
    project_root(data, project)?;
    conn(data)?
        .execute(
            "INSERT OR REPLACE INTO preferences VALUES(?,?)",
            params![
                format!("library.view.v1:{project}"),
                serde_json::to_string(p).map_err(err)?
            ],
        )
        .map_err(err)?;
    Ok(())
}
pub fn list(data: &Path) -> Result<LibraryView, String> {
    let c = conn(data)?;
    let projects = c
        .prepare("SELECT id,title FROM projects ORDER BY created,id")
        .map_err(err)?
        .query_map([], |r| {
            Ok(Project {
                id: r.get(0)?,
                title: r.get(1)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    let documents=c.prepare(&format!("SELECT {DOC_COLS} FROM documents WHERE status!='pending' ORDER BY opened DESC,updated DESC,id")).map_err(err)?.query_map([],doc_row).map_err(err)?.collect::<Result<Vec<_>,_>>().map_err(err)?;
    let pending_imports=c.prepare("SELECT id,project,paths,status FROM imports WHERE status IN ('interrupted','cancelled','partial') ORDER BY created DESC LIMIT 20").map_err(err)?.query_map([],|r|{let raw:String=r.get(2)?;Ok(ImportTask{id:r.get(0)?,project_id:r.get(1)?,paths:serde_json::from_str(&raw).unwrap_or_default(),status:r.get(3)?})}).map_err(err)?.collect::<Result<Vec<_>,_>>().map_err(err)?;
    Ok(LibraryView {
        projects,
        documents,
        pending_imports,
    })
}
pub fn project_root(data: &Path, id: &str) -> Result<PathBuf, String> {
    let c = conn(data)?;
    let exists: bool = c
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM projects WHERE id=?)",
            [id],
            |r| r.get(0),
        )
        .map_err(err)?;
    if !exists {
        return Err("项目不存在".into());
    }
    // An ID must come from the catalogue, but still reject path components explicitly.
    if id != "inbox" && uuid::Uuid::parse_str(id).is_err() {
        return Err("项目标识无效".into());
    }
    let parent = base(data).join("projects");
    fs::create_dir_all(&parent).map_err(err)?;
    let root = parent.join(id);
    if fs::symlink_metadata(&root).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err("文档库项目目录不能是符号链接".into());
    }
    fs::create_dir_all(&root).map_err(err)?;
    let root = root.canonicalize().map_err(err)?;
    if !root.starts_with(parent.canonicalize().map_err(err)?) {
        return Err("文档库路径越界".into());
    }
    Ok(root)
}
pub fn project_at_root(data: &Path, root: &Path) -> Option<String> {
    let parent = base(data).join("projects").canonicalize().ok()?;
    let relative = root.strip_prefix(parent).ok()?;
    if relative.components().count() != 1 {
        return None;
    }
    let id = relative.to_str()?;
    project_root(data, id)
        .ok()
        .filter(|p| p == root)
        .map(|_| id.into())
}
pub fn project_title(data: &Path, id: &str) -> Result<String, String> {
    conn(data)?
        .query_row("SELECT title FROM projects WHERE id=?", [id], |r| r.get(0))
        .map_err(err)
}
pub fn last_project(data: &Path) -> String {
    conn(data)
        .ok()
        .and_then(|c| {
            c.query_row(
                "SELECT value FROM preferences WHERE key='lastProject'",
                [],
                |r| r.get(0),
            )
            .ok()
        })
        .unwrap_or("inbox".into())
}
pub fn select_project(data: &Path, id: &str) -> Result<(), String> {
    conn(data)?
        .execute(
            "INSERT OR REPLACE INTO preferences VALUES('lastProject',?)",
            [id],
        )
        .map_err(err)?;
    Ok(())
}
fn title(name: &str) -> Result<String, String> {
    let s = name.trim();
    if s.is_empty()
        || s.chars().count() > 120
        || s.contains(['/', '\\', '\0', '\n', '\r'])
        || s == "."
        || s == ".."
    {
        return Err("名称应为 1～120 字且不包含路径分隔符".into());
    }
    Ok(s.into())
}
pub fn create_project(data: &Path, name: &str) -> Result<Project, String> {
    let title = title(name)?;
    let id = uuid::Uuid::new_v4().to_string();
    conn(data)?
        .execute(
            "INSERT INTO projects VALUES(?,?,?)",
            params![id, title, now()],
        )
        .map_err(err)?;
    project_root(data, &id)?;
    Ok(Project { id, title })
}
pub fn rename_project(data: &Path, id: &str, name: &str) -> Result<Project, String> {
    let name = title(name)?;
    let c = conn(data)?;
    if c.execute("UPDATE projects SET title=? WHERE id=?", params![name, id])
        .map_err(err)?
        == 0
    {
        return Err("文档空间不存在".into());
    }
    Ok(Project {
        id: id.into(),
        title: name,
    })
}
pub fn get(data: &Path, id: &str) -> Result<Document, String> {
    conn(data)?
        .query_row(
            &format!("SELECT {DOC_COLS} FROM documents WHERE id=?"),
            [id],
            doc_row,
        )
        .map_err(|_| "文档不存在".into())
}
fn unique_title(c: &Connection, project: &str, name: &str) -> String {
    let name = name.to_string();
    let p = Path::new(&name);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("文档");
    let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("md");
    let mut wanted = name.clone();
    let mut n = 2;
    while c
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM documents WHERE project=? AND lower(title)=lower(?))",
            params![project, wanted],
            |r| r.get::<_, bool>(0),
        )
        .unwrap_or(true)
    {
        wanted = format!("{stem} 副本{n}.{ext}");
        n += 1;
    }
    wanted
}
pub fn create_document(
    data: &Path,
    project: &str,
    name: &str,
    content: &str,
) -> Result<Document, String> {
    create_managed_document(data, project, name, content, None)
}

fn create_managed_document(
    data: &Path,
    project: &str,
    name: &str,
    content: &str,
    remembered: Option<&str>,
) -> Result<Document, String> {
    let mut name = title(name)?;
    if Path::new(&name).extension().is_none() {
        name.push_str(".md")
    }
    if !files::supported(Path::new(&name)) {
        return Err("文件名需要 .md、.txt、.json 或 .mmd 后缀".into());
    }
    if content.len() as u64 > files::MAX_FILE {
        return Err("文档超过 2 MB".into());
    }
    let root = project_root(data, project)?;
    let mut c = conn(data)?;
    let tx = c
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(err)?;
    if let Some(key) = remembered {
        let existing = tx.query_row(
            &format!("SELECT {} FROM documents WHERE project=? AND id=(SELECT value FROM preferences WHERE key=?)", DOC_COLS),
            params![project, key],
            doc_row,
        ).optional().map_err(err)?;
        if let Some(existing) = existing {
            return match existing.status.as_str() {
                "ready" => Ok(existing),
                "trashed" => Err("离线样例在回收站中，请先恢复该文档。".into()),
                _ => Err("离线样例仍在保存或清理中，请稍后重试。".into()),
            };
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    let name = unique_title(&tx, project, &name);
    let path = format!("documents/{id}/{name}");
    tx.execute("INSERT INTO documents(id,project,path,title,original_hash,source,updated,status) VALUES(?,?,?,?,?,'',?,'pending')",params![id,project,path,name,files::hash(content),now()]).map_err(err)?;
    if let Some(key) = remembered {
        tx.execute(
            "INSERT OR REPLACE INTO preferences(key,value) VALUES(?,?)",
            params![key, id],
        )
        .map_err(err)?;
    }
    tx.commit().map_err(err)?;
    let dest = root.join(&path);
    if let Err(e) = fs::create_dir_all(dest.parent().unwrap())
        .map_err(err)
        .and_then(|_| files::write_atomic(&dest, content.as_bytes()))
    {
        let _ = c.execute("DELETE FROM documents WHERE id=?", [&id]);
        return Err(e);
    }
    c.execute("UPDATE documents SET status='ready' WHERE id=?", [&id])
        .map_err(err)?;
    get(data, &id)
}

pub(crate) fn prepare_local_example(data: &Path, project: &str) -> Result<Document, String> {
    let document = create_managed_document(
        data,
        project,
        "离线体验：社区阅读活动.md",
        include_str!("../../examples/v0.8.5/离线体验：社区阅读活动.md"),
        Some(&format!("library.local-example.v1:{project}")),
    )?;
    let ws = crate::documents::library_workspace(data, project)?;
    let path = files::resolve(&ws.root, &document.path, false)?;
    crate::documents::with_write_lock(&path, || {
        let current = files::read_text(&path)?;
        crate::documents::refresh_local(&ws, data, &document.path, &current)
    })
    .map_err(|error| format!("样例已保存，本地关键词索引未完成。请重试：{error}"))?;
    Ok(document)
}
pub fn touch(data: &Path, root: &Path, path: &str) {
    if let Some(project) = project_at_root(data, root) {
        if let Ok(c) = conn(data) {
            let _ = c.execute(
                "UPDATE documents SET opened=? WHERE project=? AND path=? AND status='ready'",
                params![now(), project, path],
            );
        }
    }
}
pub fn saved(data: &Path, root: &Path, path: &str) {
    if let Some(project) = project_at_root(data, root) {
        if let Ok(c) = conn(data) {
            let _ = c.execute(
                "UPDATE documents SET updated=?,lifecycle_revision=lifecycle_revision+1 WHERE project=? AND path=? AND status='ready'",
                params![now(), project, path],
            );
        }
    }
}
pub fn title_for(data: &Path, root: &Path, path: &str) -> Option<(String, String)> {
    let project = project_at_root(data, root)?;
    conn(data)
        .ok()?
        .query_row(
            "SELECT id,title FROM documents WHERE project=? AND path=? AND status='ready'",
            params![project, path],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok()
}
pub fn rename(data: &Path, id: &str, name: &str) -> Result<(), String> {
    let d = get(data, id)?;
    let mut name = title(name)?;
    let ext = Path::new(&d.path)
        .extension()
        .unwrap_or_default()
        .to_string_lossy();
    if Path::new(&name).extension().is_none() {
        name = format!("{name}.{ext}")
    };
    if Path::new(&name)
        .extension()
        .map(|s| s.to_string_lossy().to_lowercase())
        != Some(ext.to_lowercase())
    {
        return Err("重命名不改变格式，请保留原后缀".into());
    }
    conn(data)?
        .execute(
            "UPDATE documents SET title=?,updated=?,lifecycle_revision=lifecycle_revision+1 WHERE id=? AND status='ready'",
            params![name, now(), id],
        )
        .map_err(err)?;
    Ok(())
}
pub fn trash(data: &Path, id: &str, restore: bool) -> Result<(), String> {
    let d = get(data, id)?;
    if d.status == "purging" {
        return Err("删除未完成，请先重试清理".into());
    }
    conn(data)?
        .execute(
            "UPDATE documents SET status=?,trashed_at=?,lifecycle_revision=lifecycle_revision+1 WHERE id=?",
            params![if restore { "ready" } else { "trashed" }, if restore { None } else { Some(now()) }, id],
        )
        .map_err(err)?;
    Ok(())
}
pub fn recover(data: &Path) -> Result<RecoveryReport, String> {
    recovery::run(data)
}
#[derive(Clone)]
struct Input {
    path: PathBuf,
    allowed: PathBuf,
}
fn excluded(name: &str) -> bool {
    name.starts_with('.')
        || matches!(
            name,
            "node_modules" | "target" | "dist" | "build" | "vendor"
        )
}
fn inputs(paths: &[String], warnings: &mut Vec<String>) -> Vec<Input> {
    let mut seen = HashSet::new();
    let mut files = vec![];
    for path in paths {
        let p = PathBuf::from(path);
        let Ok(meta) = fs::symlink_metadata(&p) else {
            warnings.push(format!("{path}：无法访问"));
            continue;
        };
        if meta.file_type().is_symlink() {
            warnings.push(format!("{path}：跳过符号链接"));
            continue;
        }
        let Ok(p) = p.canonicalize() else { continue };
        let allowed = if p.is_dir() {
            p.clone()
        } else {
            p.parent().unwrap().to_path_buf()
        };
        for entry in walkdir::WalkDir::new(&p)
            .follow_links(false)
            .max_depth(13)
            .into_iter()
            .filter_entry(|e| e.depth() == 0 || !excluded(&e.file_name().to_string_lossy()))
        {
            let e = match entry {
                Ok(e) => e,
                Err(e) => {
                    warnings.push(e.to_string());
                    continue;
                }
            };
            if !e.file_type().is_file() {
                continue;
            }
            if !files::supported(e.path()) {
                if p.is_file() {
                    warnings.push(format!(
                        "{}：支持 MD/TXT/JSON/MMD，未导入此格式",
                        p.display()
                    ))
                }
                continue;
            }
            if seen.insert(e.path().to_path_buf()) {
                files.push(Input {
                    path: e.path().to_path_buf(),
                    allowed: allowed.clone(),
                });
            }
            if files.len() >= 2000 {
                warnings.push("本次最多导入 2000 篇，请分批导入。".into());
                return files;
            }
        }
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    files
}
fn local_url(url: &str) -> Option<(&str, &str)> {
    if url.starts_with('#') || url.starts_with('/') || url.contains(':') || url.starts_with("//") {
        return None;
    }
    let at = url.find(['#', '?']).unwrap_or(url.len());
    Some((&url[..at], &url[at..]))
}
fn decoded(url: &str) -> Result<String, String> {
    percent_encoding::percent_decode_str(url)
        .decode_utf8()
        .map(|s| s.into_owned())
        .map_err(err)
}
fn encoded(path: &str) -> String {
    path.split('/')
        .map(|s| {
            percent_encoding::utf8_percent_encode(s, percent_encoding::NON_ALPHANUMERIC).to_string()
        })
        .collect::<Vec<_>>()
        .join("/")
}
/// A CommonMark parser identifies destinations so code examples are never treated as attachments.
fn rewrite_links(
    mut text: String,
    mut change: impl FnMut(&str, bool) -> Option<String>,
    warnings: &mut Vec<String>,
) -> String {
    let parser = Parser::new(&text);
    let definitions = parser
        .reference_definitions()
        .iter()
        .map(|(_, d)| (d.dest.to_string(), d.span.clone()))
        .collect::<Vec<_>>();
    let mut edits = vec![];
    for (event, range) in parser.into_offset_iter() {
        let (url, image, title) = match event {
            Event::Start(Tag::Image {
                dest_url, title, ..
            }) => (dest_url, true, title),
            Event::Start(Tag::Link {
                dest_url, title, ..
            }) => (dest_url, false, title),
            _ => continue,
        };
        if let Some(new) = change(&url, image) {
            let raw = &text[range.clone()];
            if let Some(offset) = raw.rfind(url.as_ref()) {
                edits.push((range.start + offset, range.start + offset + url.len(), new));
            } else if let Some((_, definition)) =
                definitions.iter().find(|(dest, _)| dest == url.as_ref())
            {
                let raw = &text[definition.clone()];
                if let Some(offset) = raw.find(url.as_ref()) {
                    edits.push((
                        definition.start + offset,
                        definition.start + offset + url.len(),
                        new,
                    ));
                } else {
                    warnings.push(format!("引用链接保留原文，请核对：{url}"));
                }
            } else if let Some(end) = raw.rfind("](") {
                let title = if title.is_empty() {
                    String::new()
                } else {
                    format!(" \"{}\"", title.replace('"', "\\\""))
                };
                edits.push((range.start + end + 1, range.end, format!("({new}{title})")));
            } else {
                warnings.push(format!("链接保留原文，请核对：{url}"));
            }
        }
    }
    edits.sort_by_key(|e| e.0);
    edits.dedup_by(|a, b| a.0 == b.0);
    for (from, to, value) in edits.into_iter().rev() {
        text.replace_range(from..to, &value);
    }
    text
}

struct Plan {
    input: Input,
    id: String,
    path: String,
    title: String,
    text: String,
    original_hash: String,
}

/// The original Markdown hash alone cannot distinguish equal relative image
/// paths whose bytes differ. Hash only resources the import is allowed to copy;
/// code examples and remote/out-of-range resources never trigger file reads.
fn import_fingerprint(input: &Input, text: &str, original_hash: &str, attachments: bool) -> String {
    let markdown = matches!(
        input
            .path
            .extension()
            .and_then(|s| s.to_str())
            .map(str::to_lowercase)
            .as_deref(),
        Some("md" | "markdown")
    );
    let mut parts = vec![original_hash.to_string()];
    if attachments && markdown {
        let mut cache = HashMap::<PathBuf, String>::new();
        let mut total = 0u64;
        for event in Parser::new(text) {
            let url = match event {
                Event::Start(Tag::Image { dest_url, .. })
                | Event::Start(Tag::Link { dest_url, .. }) => dest_url,
                _ => continue,
            };
            let Some((url, _)) = local_url(&url) else {
                continue;
            };
            let Ok(value) = decoded(url) else {
                continue;
            };
            let joined = input.path.parent().unwrap_or(&input.allowed).join(&value);
            let extension = joined
                .extension()
                .and_then(|x| x.to_str())
                .unwrap_or("")
                .to_lowercase();
            if !matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif") {
                continue;
            }
            let Ok(path) = joined.canonicalize() else {
                parts.push("unresolved-image".into());
                continue;
            };
            if !path.starts_with(&input.allowed) {
                parts.push("unresolved-image".into());
                continue;
            }
            if let Some(digest) = cache.get(&path) {
                parts.push(digest.clone());
                continue;
            }
            let digest = (|| {
                let bytes = fs::metadata(&path).ok()?.len();
                if bytes > 8 * 1024 * 1024 || total.saturating_add(bytes) > 100 * 1024 * 1024 {
                    return None;
                }
                use std::io::Read;
                let mut data = Vec::with_capacity(bytes as usize);
                fs::File::open(&path)
                    .ok()?
                    .take(8 * 1024 * 1024 + 1)
                    .read_to_end(&mut data)
                    .ok()?;
                if data.len() as u64 != bytes || data.len() > 8 * 1024 * 1024 {
                    return None;
                }
                total += bytes;
                Some(files::hash(data))
            })()
            .unwrap_or_else(|| "unresolved-image".into());
            cache.insert(path, digest.clone());
            parts.push(digest);
        }
    }
    format!(
        "v2:{}",
        files::hash(serde_json::to_vec(&parts).expect("string list is serializable"))
    )
}
fn read_attachment(path: &Path) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let mut bytes = vec![];
    fs::File::open(path)
        .map_err(err)?
        .take(8 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(err)?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("附件超过 8MB".into());
    }
    Ok(bytes)
}
pub fn import(
    data: &Path,
    project: &str,
    paths: &[String],
    skip_duplicates: bool,
    attachments: bool,
    cancel: &AtomicBool,
    progress: impl Fn(ImportProgress),
) -> Result<ImportResult, String> {
    let root = project_root(data, project)?;
    let c = conn(data)?;
    let job = uuid::Uuid::new_v4().to_string();
    c.execute(
        "INSERT INTO imports VALUES(?,?,?,?, 'running')",
        params![
            job,
            project,
            serde_json::to_string(paths).map_err(err)?,
            now()
        ],
    )
    .map_err(err)?;
    let mut warnings = vec![];
    let incoming = inputs(paths, &mut warnings);
    let total = incoming.len();
    let mut plans = vec![];
    let mut items = vec![];
    let mut sum = 0usize;
    for input in incoming {
        if cancel.load(Ordering::SeqCst) {
            break;
        }
        let result = (|| {
            let mut content = files::read_text(&input.path)?;
            if content.starts_with('\u{feff}') {
                content.remove(0);
            }
            sum += content.len();
            if sum > 30 * 1024 * 1024 {
                return Err("本批文本超过 30 MB，请分批导入".to_string());
            }
            let hash = files::hash(&content);
            let fingerprint = import_fingerprint(&input, &content, &hash, attachments);
            if skip_duplicates {
                let candidates = c.prepare("SELECT id,path,import_fingerprint FROM documents WHERE project=? AND original_hash=? AND status IN ('ready','pending') ORDER BY updated").map_err(err)?
                    .query_map(params![project,hash], |r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?))).map_err(err)?
                    .collect::<Result<Vec<_>,_>>().map_err(err)?;
                for (id, stored_path, stored_fingerprint) in candidates {
                    // A stale catalogue entry is not a reusable document. Do
                    // not skip a fresh copy when its retained body disappeared.
                    if files::resolve(&root, &stored_path, false)
                        .and_then(|path| files::read_text(&path))
                        .is_err()
                    {
                        continue;
                    }
                    let stored_fingerprint = if stored_fingerprint.is_empty() {
                        // Migrate lazily using the managed copy's retained image
                        // bytes, never the possibly changed external original.
                        let stored = root.join(&stored_path);
                        match files::read_text(&stored) {
                            Ok(text) => import_fingerprint(
                                &Input {
                                    path: stored.clone(),
                                    allowed: stored.parent().unwrap().to_path_buf(),
                                },
                                &text,
                                &hash,
                                true,
                            ),
                            Err(_) => continue,
                        }
                    } else {
                        stored_fingerprint
                    };
                    if fingerprint == stored_fingerprint {
                        c.execute(
                            "UPDATE documents SET import_fingerprint=? WHERE id=?",
                            params![stored_fingerprint, id],
                        )
                        .map_err(err)?;
                        return Ok(Err(ImportItem {
                            source: input.path.display().to_string(),
                            status: "skipped".into(),
                            document_id: Some(id),
                            message: "正文与可复制附件相同，保留已有副本".into(),
                        }));
                    }
                }
            }
            let id = uuid::Uuid::new_v4().to_string();
            let name = title(&input.path.file_name().unwrap_or_default().to_string_lossy())?;
            let name = unique_title(&c, project, &name);
            let path = format!("documents/{id}/{name}");
            c.execute("INSERT INTO documents(id,project,path,title,original_hash,source,updated,status,import_fingerprint) VALUES(?,?,?,?,?,?,?,'pending',?)",params![id,project,path,name,hash,input.path.display().to_string(),now(),fingerprint]).map_err(err)?;
            Ok(Ok(Plan {
                input: input.clone(),
                id,
                path,
                title: name,
                text: content,
                original_hash: hash,
            }))
        })();
        match result {
            Ok(Ok(plan)) => plans.push(plan),
            Ok(Err(item)) => items.push(item),
            Err(e) => items.push(ImportItem {
                source: input.path.display().to_string(),
                status: "failed".into(),
                document_id: None,
                message: e,
            }),
        }
    }
    let mut preferred = vec![];
    for p in &plans {
        preferred.push((
            p.input.path.clone(),
            links::LinkTarget {
                id: p.id.clone(),
                title: p.title.clone(),
                path: p.path.clone(),
            },
        ));
    }
    for item in &items {
        if item.status == "skipped" {
            if let Some(id) = &item.document_id {
                if let Ok(d) = get(data, id) {
                    preferred.push((
                        PathBuf::from(&item.source),
                        links::LinkTarget {
                            id: d.id,
                            title: d.title,
                            path: d.path,
                        },
                    ));
                }
            }
        }
    }
    let resolver = links::LinkResolver::new(data, project, &preferred)?;
    let mut attachment_bytes = 0u64;
    let mut done = items.len();
    for item in &items {
        c.execute(
            "INSERT OR REPLACE INTO import_items VALUES(?,?,?,?,?)",
            params![
                job,
                item.source,
                item.status,
                item.document_id,
                item.message
            ],
        )
        .map_err(err)?;
    }
    for plan in plans {
        if cancel.load(Ordering::SeqCst) {
            let _ = c.execute(
                "DELETE FROM documents WHERE id=? AND status='pending'",
                [&plan.id],
            );
            continue;
        }
        let stage = root.join(format!(".pending-{}", plan.id));
        let target = root.join("documents").join(&plan.id);
        let result = (|| {
            fs::create_dir_all(&stage).map_err(err)?;
            let mut attached = HashMap::<PathBuf, String>::new();
            let mut text = plan.text.clone();
            let mut link_warnings = vec![];
            if plan.path.to_lowercase().ends_with(".md")
                || plan.path.to_lowercase().ends_with(".markdown")
            {
                text = rewrite_links(
                    text,
                    |url, image| {
                        let (url, suffix) = local_url(url)?;
                        let value = decoded(url).ok()?;
                        let source = plan.input.path.parent()?.join(&value);
                        if !image && !updates::image_path(&source) {
                            match resolver.resolve(&source) {
                                links::Match::Unique(target) => {
                                    return links::target_url(&target, suffix)
                                }
                                links::Match::Ambiguous(_) => {
                                    warnings.push(format!(
                                        "{}：同一来源存在多个副本，请用重新关联链接选择目标：{url}",
                                        plan.title
                                    ));
                                    return None;
                                }
                                links::Match::Missing => {}
                            }
                        }
                        let source = match source.canonicalize() {
                            Ok(p) => p,
                            Err(_) => {
                                warnings.push(format!("{}：附件或链接不存在 {url}", plan.title));
                                return None;
                            }
                        };
                        let ext = source
                            .extension()
                            .and_then(|x| x.to_str())
                            .unwrap_or("")
                            .to_lowercase();
                        if attachments
                            && source.starts_with(&plan.input.allowed)
                            && matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif")
                        {
                            if let Some(dest) = attached.get(&source) {
                                return Some(format!("{}{}", encoded(dest), suffix));
                            }
                            let bytes = fs::metadata(&source).ok()?.len();
                            if bytes > 8 * 1024 * 1024 {
                                warnings.push(format!("附件超过 8 MB：{}", source.display()));
                                return None;
                            }
                            if attachment_bytes.saturating_add(bytes) > 100 * 1024 * 1024 {
                                warnings.push(format!(
                                    "本批附件超过 100 MB，未复制：{}",
                                    source.display()
                                ));
                                return None;
                            }
                            let name = format!(
                                "assets/{}-{}",
                                &files::hash(source.to_string_lossy().as_bytes())[..12],
                                source.file_name()?.to_string_lossy()
                            );
                            let dest = stage.join(&name);
                            let image = read_attachment(&source).ok()?;
                            if attachment_bytes.saturating_add(image.len() as u64)
                                > 100 * 1024 * 1024
                            {
                                return None;
                            }
                            if fs::create_dir_all(dest.parent()?).is_ok()
                                && files::write_atomic(&dest, &image).is_ok()
                            {
                                attachment_bytes += image.len() as u64;
                                attached.insert(source, name.clone());
                                return Some(format!("{}{}", encoded(&name), suffix));
                            }
                        }
                        if image || files::supported(&source) {
                            warnings.push(format!(
                                "{}：本地资源未复制（超出范围、未选择或附件未启用）：{url}",
                                plan.title
                            ));
                        }
                        None
                    },
                    &mut link_warnings,
                );
                warnings.extend(link_warnings);
            }
            files::write_atomic(&stage.join(&plan.title), text.as_bytes())?;
            fs::create_dir_all(target.parent().unwrap()).map_err(err)?;
            fs::rename(&stage, &target).map_err(err)?;
            let copied_input = Input {
                path: target.join(&plan.title),
                allowed: target.clone(),
            };
            let actual_fingerprint =
                import_fingerprint(&copied_input, &text, &plan.original_hash, attachments);
            c.execute(
                "UPDATE documents SET status='ready',import_fingerprint=? WHERE id=?",
                params![actual_fingerprint, plan.id],
            )
            .map_err(err)?;
            // The baseline is the actual copied body and attachments, not the
            // possibly changed original. Failure must not undo a saved import.
            if let Err(error) =
                updates::record_import_baseline(data, &plan.id, &plan.input.allowed, attachments)
            {
                warnings.push(format!(
                    "{}：副本已保存，来源更新基线未建立：{error}",
                    plan.title
                ));
            }
            Ok(())
        })();
        let item = match result {
            Ok(()) => ImportItem {
                source: plan.input.path.display().to_string(),
                status: "imported".into(),
                document_id: Some(plan.id.clone()),
                message: format!("已复制为 {}", plan.title),
            },
            Err(e) => {
                let _ = fs::remove_dir_all(&stage);
                let _ = c.execute(
                    "DELETE FROM documents WHERE id=? AND status='pending'",
                    [&plan.id],
                );
                ImportItem {
                    source: plan.input.path.display().to_string(),
                    status: "failed".into(),
                    document_id: None,
                    message: e,
                }
            }
        };
        c.execute(
            "INSERT OR REPLACE INTO import_items VALUES(?,?,?,?,?)",
            params![
                job,
                item.source,
                item.status,
                item.document_id,
                item.message
            ],
        )
        .map_err(err)?;
        done += 1;
        progress(ImportProgress {
            job_id: job.clone(),
            done,
            total,
            item: item.clone(),
        });
        items.push(item);
    }
    let cancelled = cancel.load(Ordering::SeqCst);
    c.execute(
        "UPDATE imports SET status=? WHERE id=?",
        params![
            if cancelled {
                "cancelled"
            } else if items.iter().any(|i| i.status == "failed") {
                "partial"
            } else {
                "complete"
            },
            job
        ],
    )
    .map_err(err)?;
    Ok(ImportResult {
        job_id: job,
        project_id: project.into(),
        items,
        warnings,
        cancelled,
    })
}
pub fn export_file(data: &Path, id: &str, target: &Path) -> Result<(), String> {
    let d = get(data, id)?;
    let root = project_root(data, &d.project_id)?;
    let content = files::read_text(&files::resolve(&root, &d.path, false)?)?;
    if target.extension() != Path::new(&d.path).extension() {
        return Err("请保留导出文件的格式后缀".into());
    }
    files::write_atomic(target, content.as_bytes())
}
pub fn export_bundle(
    data: &Path,
    project: &str,
    document: Option<&str>,
    target: &Path,
) -> Result<(), String> {
    if target.extension().is_none_or(|x| x != "zip") {
        return Err("请保存为 ZIP 包".into());
    }
    let root = project_root(data, project)?;
    let all = list(data)?
        .documents
        .into_iter()
        .filter(|d| d.project_id == project && d.status == "ready")
        .collect::<Vec<_>>();
    let mut included = all
        .iter()
        .filter(|d| document.is_none_or(|id| d.id == id))
        .map(|d| d.id.clone())
        .collect::<HashSet<_>>();
    if document.is_some() {
        let mut scanned = HashSet::new();
        loop {
            let mut expanded = false;
            for d in &all {
                if !included.contains(&d.id) || !scanned.insert(d.id.clone()) {
                    continue;
                }
                let path = files::resolve(&root, &d.path, false)?;
                if let Ok(content) = files::read_text(&path) {
                    for event in Parser::new(&content) {
                        if let Event::Start(Tag::Link { dest_url, .. }) = event {
                            if let Some((url, _)) = local_url(&dest_url) {
                                if let Ok(decoded) = decoded(url) {
                                    if let Ok(target) =
                                        path.parent().unwrap().join(decoded).canonicalize()
                                    {
                                        if let Some(other) =
                                            all.iter().find(|o| root.join(&o.path) == target)
                                        {
                                            expanded |= included.insert(other.id.clone());
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            if !expanded {
                break;
            }
        }
    }
    let docs = all
        .iter()
        .filter(|d| included.contains(&d.id))
        .collect::<Vec<_>>();
    if docs.is_empty() {
        return Err("没有可导出的文档".into());
    }
    let temp = base(data).join(format!(".export-{}", uuid::Uuid::new_v4()));
    let folder = temp.join("Inkstone文档");
    fs::create_dir_all(&folder).map_err(err)?;
    let result = (|| {
        let mut mapped = HashMap::new();
        let mut names = HashSet::new();
        for d in &docs {
            let mut name = d.title.clone();
            let mut n = 2;
            while !names.insert(name.to_lowercase()) {
                name = format!(
                    "{}-{n}.{}",
                    Path::new(&d.title)
                        .file_stem()
                        .unwrap_or_default()
                        .to_string_lossy(),
                    Path::new(&d.path)
                        .extension()
                        .unwrap_or_default()
                        .to_string_lossy()
                );
                n += 1;
            }
            mapped.insert(root.join(&d.path).canonicalize().map_err(err)?, name);
        }
        for d in &docs {
            let path = files::resolve(&root, &d.path, false)?;
            let mut content = files::read_text(&path)?;
            if matches!(
                path.extension().and_then(|s| s.to_str()),
                Some("md" | "markdown")
            ) {
                content = rewrite_links(
                    content,
                    |url, _| {
                        let (url, suffix) = local_url(url)?;
                        let source = path
                            .parent()?
                            .join(decoded(url).ok()?)
                            .canonicalize()
                            .ok()?;
                        if let Some(name) = mapped.get(&source) {
                            return Some(format!("{}{}", encoded(name), suffix));
                        }
                        if !source.starts_with(&root) {
                            return None;
                        }
                        let ext = source.extension()?.to_str()?.to_lowercase();
                        if !matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif") {
                            return None;
                        }
                        let name = format!(
                            "assets/{}-{}",
                            &files::hash(source.to_string_lossy().as_bytes())[..12],
                            source.file_name()?.to_string_lossy()
                        );
                        let dest = folder.join(&name);
                        fs::create_dir_all(dest.parent()?).ok()?;
                        fs::copy(source, dest).ok()?;
                        Some(format!("{}{}", encoded(&name), suffix))
                    },
                    &mut vec![],
                );
            }
            files::write_atomic(
                &folder.join(mapped.get(&path).ok_or("导出映射丢失")?),
                content.as_bytes(),
            )?;
        }
        // The ZIP writer explicitly marks non-ASCII names as UTF-8 and omits macOS metadata.
        let archive = temp.join("export.zip");
        let mut zip = zip::ZipWriter::new(fs::File::create(&archive).map_err(err)?);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored)
            .unix_permissions(0o644);
        for entry in walkdir::WalkDir::new(&folder).follow_links(false) {
            let entry = entry.map_err(err)?;
            if !entry.file_type().is_file() {
                continue;
            }
            let name = format!(
                "Inkstone文档/{}",
                entry
                    .path()
                    .strip_prefix(&folder)
                    .map_err(err)?
                    .to_string_lossy()
            );
            zip.start_file(name, options).map_err(err)?;
            std::io::copy(&mut fs::File::open(entry.path()).map_err(err)?, &mut zip)
                .map_err(err)?;
        }
        zip.finish().map_err(err)?;
        files::write_atomic(target, &fs::read(archive).map_err(err)?)
    })();
    let _ = fs::remove_dir_all(temp);
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_example_reuses_edited_and_renamed_document_and_refreshes_keyword_index() {
        let data = tempfile::tempdir().unwrap();
        let first = prepare_local_example(data.path(), "inbox").unwrap();
        let workspace = crate::documents::library_workspace(data.path(), "inbox").unwrap();
        let connection = crate::db::open(&workspace.db).unwrap();
        assert!(!crate::db::lexical_scored(&connection, "阅读活动", Some(&first.path))
            .unwrap()
            .is_empty());
        let path = workspace.root.join(&first.path);
        let edited = "# 用户已改名的样例\n\n草地灯笼活动的主题是亲子朗读。\n";
        files::write_atomic(&path, edited.as_bytes()).unwrap();
        rename(data.path(), &first.id, "我的样例.md").unwrap();
        let reused = prepare_local_example(data.path(), "inbox").unwrap();
        assert_eq!(reused.id, first.id);
        assert_eq!(reused.path, first.path);
        assert_eq!(reused.title, "我的样例.md");
        assert_eq!(files::read_text(&path).unwrap(), edited);
        assert!(!crate::db::lexical_scored(&connection, "草地灯笼", Some(&first.path))
            .unwrap()
            .is_empty());
        let live_hash = files::hash(edited);
        assert!(crate::db::lexical_scored(&connection, "阅读活动", Some(&first.path))
            .unwrap()
            .iter()
            .all(|hit| hit.hash.as_deref() == Some(live_hash.as_str())));
        let other = create_project(data.path(), "其他空间").unwrap();
        let own = prepare_local_example(data.path(), &other.id).unwrap();
        assert_eq!(own.project_id, other.id);
        assert_ne!(own.id, first.id);
    }

    #[test]
    fn local_example_reserves_one_document_and_respects_recoverable_trash() {
        let data = tempfile::tempdir().unwrap();
        let connection = conn(data.path()).unwrap();
        std::thread::scope(|threads| {
            let pending: Vec<_> = (0..4)
                .map(|_| threads.spawn(|| prepare_local_example(data.path(), "inbox")))
                .collect();
            for task in pending {
                // Reopen during the short pending window may request a retry.
                let _ = task.join().unwrap();
            }
        });
        let view = list(data.path()).unwrap();
        assert_eq!(view.documents.len(), 1);
        let stored = &view.documents[0];
        assert_eq!(prepare_local_example(data.path(), "inbox").unwrap().id, stored.id);
        trash(data.path(), &stored.id, false).unwrap();
        assert!(matches!(
            prepare_local_example(data.path(), "inbox"),
            Err(error) if error.contains("回收站")
        ));
        assert_eq!(list(data.path()).unwrap().documents.len(), 1);
        trash(data.path(), &stored.id, true).unwrap();
        assert_eq!(prepare_local_example(data.path(), "inbox").unwrap().id, stored.id);
        // Registered identity refers to a catalogue entry, so permanent
        // removal permits an explicit fresh sample without replaying old data.
        connection.execute("DELETE FROM documents WHERE id=?", [&stored.id]).unwrap();
        let fresh = prepare_local_example(data.path(), "inbox").unwrap();
        assert_ne!(fresh.id, stored.id);
        assert_eq!(list(data.path()).unwrap().documents.len(), 1);
    }
    #[test]
    fn copied_documents_survive_original_removal_and_trash_is_recoverable() {
        let d = tempfile::tempdir().unwrap();
        let source = tempfile::tempdir().unwrap();
        let p = source.path().join("中文.md");
        fs::write(&p, "# 原文\n\n正文").unwrap();
        let result = import(
            d.path(),
            "inbox",
            &[p.display().to_string()],
            true,
            true,
            &AtomicBool::new(false),
            |_| {},
        )
        .unwrap();
        let id = result.items[0].document_id.as_ref().unwrap();
        let doc = get(d.path(), id).unwrap();
        fs::remove_file(p).unwrap();
        assert!(
            files::read_text(&project_root(d.path(), "inbox").unwrap().join(doc.path))
                .unwrap()
                .contains("正文")
        );
        trash(d.path(), id, false).unwrap();
        assert_eq!(get(d.path(), id).unwrap().status, "trashed");
        trash(d.path(), id, true).unwrap();
        rename(d.path(), id, "新标题.md").unwrap();
        assert_eq!(get(d.path(), id).unwrap().title, "新标题.md");
    }
    #[test]
    fn import_handles_duplicates_bom_links_assets_and_bad_files() {
        let d = tempfile::tempdir().unwrap();
        let s = tempfile::tempdir().unwrap();
        fs::write(
            s.path().join("a.md"),
            "\u{feff}# A\n\n![图片](pic.png)\n\n[B](b.md)",
        )
        .unwrap();
        fs::write(s.path().join("b.md"), "# B").unwrap();
        fs::write(s.path().join("pic.png"), [1, 2, 3]).unwrap();
        fs::write(s.path().join("bad.txt"), [0xff, 0xfe]).unwrap();
        let paths = vec![s.path().display().to_string()];
        let result = import(
            d.path(),
            "inbox",
            &paths,
            true,
            true,
            &AtomicBool::new(false),
            |_| {},
        )
        .unwrap();
        assert_eq!(
            result
                .items
                .iter()
                .filter(|i| i.status == "imported")
                .count(),
            2
        );
        assert_eq!(
            result.items.iter().filter(|i| i.status == "failed").count(),
            1
        );
        let a = result
            .items
            .iter()
            .find(|i| i.source.ends_with("a.md"))
            .unwrap();
        let doc = get(d.path(), a.document_id.as_ref().unwrap()).unwrap();
        let root = project_root(d.path(), "inbox").unwrap();
        let text = fs::read_to_string(root.join(&doc.path)).unwrap();
        assert!(!text.starts_with('\u{feff}'));
        assert!(text.contains("assets/"));
        assert!(!text.contains("](b.md)"));
        let again = import(
            d.path(),
            "inbox",
            &paths,
            true,
            true,
            &AtomicBool::new(false),
            |_| {},
        )
        .unwrap();
        assert_eq!(
            again.items.iter().filter(|i| i.status == "skipped").count(),
            2
        );
        assert!(project_root(d.path(), "../escape").is_err());
    }
    #[test]
    fn duplicate_import_compares_attachment_bytes_and_preserves_user_copy() {
        let data = tempfile::tempdir().unwrap();
        let source_a = tempfile::tempdir().unwrap();
        let source_b = tempfile::tempdir().unwrap();
        let text =
            "# 同文不同图\n\n![图][pic]\n\n[pic]: pic.png\n\n```md\n![只是示例](other.png)\n```";
        for source in [&source_a, &source_b] {
            fs::write(source.path().join("a.md"), text).unwrap();
        }
        fs::write(source_a.path().join("pic.png"), b"image A").unwrap();
        fs::write(source_b.path().join("pic.png"), b"image B").unwrap();
        let run = |source: &Path, attachments| {
            import(
                data.path(),
                "inbox",
                &[source.join("a.md").display().to_string()],
                true,
                attachments,
                &AtomicBool::new(false),
                |_| {},
            )
            .unwrap()
        };
        let first = run(source_a.path(), true);
        let id = first.items[0].document_id.as_ref().unwrap();
        let doc = get(data.path(), id).unwrap();
        let path = project_root(data.path(), "inbox").unwrap().join(&doc.path);
        let original = files::read_text(&path).unwrap();
        files::write_atomic(&path, format!("{original}\n用户自己的备注").as_bytes()).unwrap();
        assert_eq!(run(source_b.path(), true).items[0].status, "imported");
        assert_eq!(run(source_a.path(), true).items[0].status, "skipped");
        assert!(files::read_text(&path).unwrap().contains("用户自己的备注"));
        assert_eq!(list(data.path()).unwrap().documents.len(), 2);
        // Disabling attachments creates a distinct copy, and is repeatable.
        assert_eq!(run(source_a.path(), false).items[0].status, "imported");
        assert_eq!(run(source_a.path(), false).items[0].status, "skipped");
    }
    #[test]
    fn legacy_attachment_fingerprint_uses_managed_bytes_not_changed_original() {
        let data = tempfile::tempdir().unwrap();
        let source = tempfile::tempdir().unwrap();
        fs::write(source.path().join("a.md"), "![图](pic.png)").unwrap();
        fs::write(source.path().join("pic.png"), b"before").unwrap();
        let run = || {
            import(
                data.path(),
                "inbox",
                &[source.path().display().to_string()],
                true,
                true,
                &AtomicBool::new(false),
                |_| {},
            )
            .unwrap()
        };
        let first = run();
        conn(data.path())
            .unwrap()
            .execute(
                "UPDATE documents SET import_fingerprint='' WHERE id=?",
                [first.items[0].document_id.as_ref().unwrap()],
            )
            .unwrap();
        assert_eq!(run().items[0].status, "skipped");
        conn(data.path())
            .unwrap()
            .execute("UPDATE documents SET import_fingerprint=''", [])
            .unwrap();
        fs::write(source.path().join("pic.png"), b"after").unwrap();
        assert_eq!(run().items[0].status, "imported");
    }
    #[test]
    fn unresolved_images_are_repeatable_but_newly_available_images_create_a_copy() {
        let data = tempfile::tempdir().unwrap();
        let source = tempfile::tempdir().unwrap();
        fs::write(source.path().join("a.md"), "![图片](later.png)").unwrap();
        let run = || {
            import(
                data.path(),
                "inbox",
                &[source.path().display().to_string()],
                true,
                true,
                &AtomicBool::new(false),
                |_| {},
            )
            .unwrap()
        };
        assert_eq!(run().items[0].status, "imported");
        assert_eq!(run().items[0].status, "skipped");
        fs::write(source.path().join("later.png"), [1, 2, 3]).unwrap();
        assert_eq!(run().items[0].status, "imported");
    }
    #[test]
    fn cancellation_retry_and_trash_never_index_partial_or_removed_documents() {
        let d = tempfile::tempdir().unwrap();
        let source = tempfile::tempdir().unwrap();
        for n in 0..3 {
            fs::write(source.path().join(format!("{n}.md")), format!("# 文档 {n}")).unwrap();
        }
        let cancel = AtomicBool::new(false);
        let paths = vec![source.path().display().to_string()];
        let first = import(d.path(), "inbox", &paths, true, true, &cancel, |_| {
            cancel.store(true, Ordering::SeqCst)
        })
        .unwrap();
        assert!(first.cancelled);
        assert_eq!(list(d.path()).unwrap().documents.len(), 1);
        let retry = import(
            d.path(),
            "inbox",
            &paths,
            true,
            true,
            &AtomicBool::new(false),
            |_| {},
        )
        .unwrap();
        assert_eq!(
            retry
                .items
                .iter()
                .filter(|i| i.status == "imported")
                .count(),
            2
        );
        let records = list(d.path()).unwrap().documents;
        assert_eq!(records.len(), 3);
        trash(d.path(), &records[0].id, false).unwrap();
        assert_eq!(scan_documents(d.path(), "inbox", None).unwrap().0.len(), 2);
        assert_eq!(flat_tree(d.path(), "inbox").unwrap().len(), 2);
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn exported_bundle_rewrites_links_and_reference_images_and_includes_linked_documents() {
        let d = tempfile::tempdir().unwrap();
        let source = tempfile::tempdir().unwrap();
        fs::write(
            source.path().join("a.md"),
            "# A\n\n[B](b.md)\n\n![图片][pic]\n\n[pic]: <image space.png> \"保留标题\"\n",
        )
        .unwrap();
        fs::write(source.path().join("b.md"), "# B").unwrap();
        fs::write(source.path().join("image space.png"), [1, 2, 3]).unwrap();
        let result = import(
            d.path(),
            "inbox",
            &[source.path().display().to_string()],
            true,
            true,
            &AtomicBool::new(false),
            |_| {},
        )
        .unwrap();
        let id = result
            .items
            .iter()
            .find(|i| i.source.ends_with("a.md"))
            .unwrap()
            .document_id
            .as_ref()
            .unwrap();
        let b = result
            .items
            .iter()
            .find(|i| i.source.ends_with("b.md"))
            .unwrap()
            .document_id
            .as_ref()
            .unwrap();
        rename(d.path(), b, "新的标题.md").unwrap();
        let target = d.path().join("bundle.zip");
        export_bundle(d.path(), "inbox", Some(id), &target).unwrap();
        let mut archive = zip::ZipArchive::new(fs::File::open(&target).unwrap()).unwrap();
        assert!(archive.by_name("Inkstone文档/新的标题.md").is_ok());
        assert!(!archive.file_names().any(|n| n.unwrap().contains("/._")));
        let out = d.path().join("unpacked");
        fs::create_dir(&out).unwrap();
        assert!(std::process::Command::new("/usr/bin/ditto")
            .args(["-x", "-k"])
            .arg(target)
            .arg(&out)
            .status()
            .unwrap()
            .success());
        let root = out.join("Inkstone文档");
        let text = fs::read_to_string(root.join("a.md")).unwrap();
        assert!(root.join("新的标题.md").exists());
        let mut local = 0;
        for event in Parser::new(&text) {
            let url = match event {
                Event::Start(Tag::Image { dest_url, .. })
                | Event::Start(Tag::Link { dest_url, .. }) => dest_url,
                _ => continue,
            };
            if let Some((url, _)) = local_url(&url) {
                assert!(
                    root.join(decoded(url).unwrap()).exists(),
                    "missing exported destination {url}"
                );
                local += 1;
            }
        }
        assert_eq!(local, 2);
        assert!(text.contains("保留标题"));
    }

    #[test]
    fn interrupted_pending_records_recover_without_half_documents() {
        let d = tempfile::tempdir().unwrap();
        let c = conn(d.path()).unwrap();
        let root = project_root(d.path(), "inbox").unwrap();
        fs::create_dir_all(root.join("documents/test")).unwrap();
        fs::write(root.join("documents/test/a.md"), "完整正文").unwrap();
        for (id, path) in [
            ("ready", "documents/test/a.md"),
            ("missing", "documents/lost/a.md"),
        ] {
            c.execute(
                "INSERT INTO documents(id,project,path,title,original_hash,source,updated,opened,status) VALUES(?,'inbox',?,'a.md','','',0,0,'pending')",
                params![id, path],
            )
            .unwrap();
        }
        recover(d.path()).unwrap();
        assert_eq!(get(d.path(), "ready").unwrap().status, "ready");
        assert!(get(d.path(), "missing").is_err());
    }
}

pub fn retried(data: &Path, id: &str) -> Result<(), String> {
    conn(data)?.execute("UPDATE imports SET status='retried' WHERE id=? AND status IN ('partial','interrupted','cancelled')",[id]).map_err(err)?;
    Ok(())
}

pub fn flat_tree(data: &Path, project: &str) -> Result<Vec<crate::models::FileEntry>, String> {
    Ok(list(data)?
        .documents
        .into_iter()
        .filter(|d| d.project_id == project && d.status == "ready")
        .map(|d| crate::models::FileEntry {
            path: d.path,
            name: d.title,
            directory: false,
            children: vec![],
        })
        .collect())
}
pub fn scan_documents(
    data: &Path,
    project: &str,
    scope: Option<&str>,
) -> Result<(Vec<crate::models::IndexDocument>, Vec<String>), String> {
    let root = project_root(data, project)?;
    let mut docs = vec![];
    let mut warnings = vec![];
    let mut total = 0usize;
    for d in list(data)?
        .documents
        .into_iter()
        .filter(|d| d.project_id == project && d.status == "ready")
    {
        if scope.is_some_and(|s| s != d.path)
            || (scope.is_none() && d.path.to_lowercase().ends_with(".json"))
        {
            continue;
        }
        if docs.len() >= 2000 {
            return Err("单次最多索引 2000 篇，请选择更小的范围".into());
        }
        match files::resolve(&root, &d.path, false).and_then(|p| files::read_text(&p)) {
            Ok(content) => {
                total += content.len();
                if total > 30 * 1024 * 1024 {
                    return Err("本次资料超过 30 MB，请分批建库".into());
                }
                docs.push(crate::models::IndexDocument {
                    path: d.path,
                    hash: files::hash(&content),
                    content,
                });
            }
            Err(e) => warnings.push(format!("{}：{e}", d.title)),
        }
    }
    Ok((docs, warnings))
}

/// Archive only hides a completed/interrupted task record; original files and journal items remain.
pub fn archive_import(data: &Path, id: &str) -> Result<(), String> {
    let c = conn(data)?;
    let changed=c.execute("UPDATE imports SET status='archived' WHERE id=? AND status IN ('cancelled','partial','interrupted','retried','completed')",[id]).map_err(err)?;
    if changed == 0 {
        return Err("任务不存在或仍在进行中".into());
    }
    Ok(())
}
