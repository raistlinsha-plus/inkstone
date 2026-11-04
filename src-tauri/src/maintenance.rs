//! Managed-library snapshots. All application mutations enter the gate before accepting work.
//! A snapshot closes admission, drains accepted work, and releases admission on every error path.
use crate::{files, library, models::Workspace};
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::{
    collections::{BTreeSet, HashMap, HashSet},
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::{Arc, Condvar, Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

fn private_directory(path: &Path, recursive: bool) -> Result<(), String> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(recursive);
    #[cfg(unix)]
    builder.mode(0o700);
    builder.create(path).map_err(err)
}
fn private_file(path: &Path) -> Result<File, String> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);
    options.open(path).map_err(err)
}
fn secure_tree(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    for entry in walkdir::WalkDir::new(path).follow_links(false) {
        let entry = entry.map_err(err)?;
        if entry.file_type().is_symlink() {
            return Err("恢复目录中不能出现符号链接".into());
        }
        fs::set_permissions(
            entry.path(),
            fs::Permissions::from_mode(if entry.file_type().is_dir() {
                0o700
            } else {
                0o600
            }),
        )
        .map_err(err)?;
    }
    Ok(())
}
#[derive(Default)]
struct GateState {
    active: usize,
    preparing: bool,
    blocked: Option<String>,
}
#[derive(Default)]
struct Gate {
    state: Mutex<GateState>,
    drained: Condvar,
}
fn gate(data: &Path) -> Arc<Gate> {
    static GATES: OnceLock<Mutex<HashMap<PathBuf, Arc<Gate>>>> = OnceLock::new();
    let mut map = GATES
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    map.entry(data.canonicalize().unwrap_or_else(|_| data.to_path_buf()))
        .or_default()
        .clone()
}
pub struct MutationPermit(Arc<Gate>);
impl Drop for MutationPermit {
    fn drop(&mut self) {
        if let Ok(mut s) = self.0.state.lock() {
            s.active = s.active.saturating_sub(1);
            self.0.drained.notify_all();
        }
    }
}
pub fn mutation(data: &Path) -> Result<MutationPermit, String> {
    mutation_scope(data, true)
}
pub fn is_managed_root(data: &Path, root: &Path) -> bool {
    let parent = data.join("library/projects");
    root.canonicalize()
        .unwrap_or_else(|_| root.to_path_buf())
        .starts_with(parent.canonicalize().unwrap_or(parent))
}
pub fn mutation_scope(data: &Path, managed: bool) -> Result<MutationPermit, String> {
    let g = gate(data);
    {
        let mut s = g.state.lock().map_err(|_| "资料维护状态不可用")?;
        if s.preparing {
            return Err("正在生成资料备份，请稍后重试；当前编辑仍保留在窗口。".into());
        }
        if managed {
            if let Some(error) = &s.blocked {
                return Err(format!("资料库需要修复，已暂停受管理写入：{error}"));
            }
        }
        s.active += 1;
    }
    let permit = MutationPermit(g);
    if managed {
        if let Err(error) = library::conn(data) {
            set_managed_error(data, Some(error.clone()));
            return Err(format!("资料库暂不可核对，已暂停受管理写入：{error}"));
        }
    }
    Ok(permit)
}
pub fn set_managed_error(data: &Path, error: Option<String>) {
    if let Ok(mut s) = gate(data).state.lock() {
        s.blocked = error;
    }
}
struct SnapshotGuard(Arc<Gate>);
impl SnapshotGuard {
    fn acquire(data: &Path) -> Result<Self, String> {
        let g = gate(data);
        {
            let mut s = g.state.lock().map_err(|_| "资料维护状态不可用")?;
            if s.preparing {
                return Err("已有备份任务正在运行".into());
            }
            s.preparing = true;
            while s.active > 0 {
                match g.drained.wait(s) {
                    Ok(next) => s = next,
                    Err(e) => {
                        let mut next = e.into_inner();
                        next.preparing = false;
                        return Err("无法等待当前保存完成".into());
                    }
                }
            }
        }
        Ok(Self(g))
    }
}
impl Drop for SnapshotGuard {
    fn drop(&mut self) {
        if let Ok(mut s) = self.0.state.lock() {
            s.preparing = false;
            self.0.drained.notify_all();
        }
    }
}
const FORMAT: u32 = 2;
const MAX_TOTAL: u64 = 2 * 1024 * 1024 * 1024;
const MAX_FILE: u64 = 128 * 1024 * 1024;
const MAX_FILES: usize = 50000;
fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    path: String,
    size: u64,
    sha256: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DraftLocation {
    entry: String,
    project: String,
    path: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoreSnapshot {
    path: String,
    schema_version: i64,
    resource_version: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    format: u32,
    app_version: String,
    created_at: i64,
    schema_version: i64,
    files: Vec<Entry>,
    drafts: Vec<DraftLocation>,
    excluded: Vec<String>,
    #[serde(default)]
    stores: Vec<StoreSnapshot>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupReport {
    path: String,
    files: usize,
    total_bytes: u64,
    created_at: i64,
    manifest_hash: String,
    mode: String,
    warnings: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupValidation {
    valid: bool,
    path: String,
    files: usize,
    total_bytes: u64,
    created_at: i64,
    schema_version: i64,
    manifest_hash: String,
    issues: Vec<String>,
    warnings: Vec<String>,
}
fn warnings() -> Vec<String> {
    vec!["备份包含所有受管理空间、正文、附件、历史与恢复草稿；会话与角色数据范围按备份清单逐项说明；不含外部原件、未应用的块表单、系统设置和凭据。".into(),"知识索引和日历投影可重建；恢复到新目录仅作预演，不切换或覆盖当前资料库。".into()]
}
fn manifest_warnings(manifest: &Manifest) -> Vec<String> {
    let mut result = warnings();
    for (name, label) in [("assistant.sqlite3", "知识会话历史和草稿"), ("companion.sqlite3", "角色进度、偏好和待处理经历")] {
        if manifest.stores.iter().any(|s| s.path == name) {
            result.push(format!("此备份包含{label}，恢复可能带回以前删除的记录；不会自动合并当前数据。"));
        } else {
            result.push(format!("此备份不包含{label}；恢复预演不会补建这些数据。"));
        }
    }
    result
}
fn validate_name(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name.contains('\\')
        || name.contains('\0')
        || Path::new(name)
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err("备份条目路径不安全".into());
    }
    if name != "library/catalog.sqlite3"
        && !name.starts_with("library/projects/")
        && !name.starts_with("library/history/")
        && !name.starts_with("drafts/")
        && !matches!(name, "assistant.sqlite3" | "companion.sqlite3")
    {
        return Err("备份包含范围外的条目".into());
    }
    Ok(())
}
fn hash_file(path: &Path) -> Result<(u64, String), String> {
    let mut input = File::open(path).map_err(err)?;
    hash_reader(&mut input)
}
fn hash_reader(input: &mut impl Read) -> Result<(u64, String), String> {
    let mut hash = Sha256::new();
    let mut size = 0;
    let mut buf = [0u8; 32768];
    loop {
        let n = input.read(&mut buf).map_err(err)?;
        if n == 0 {
            break;
        }
        size += n as u64;
        if size > MAX_FILE {
            return Err("单个备份文件超过128 MB限制".into());
        }
        hash.update(&buf[..n]);
    }
    Ok((size, format!("{:x}", hash.finalize())))
}
fn add_source(
    sources: &mut Vec<(String, PathBuf)>,
    data: &Path,
    directory: &Path,
) -> Result<(), String> {
    if !directory.exists() {
        return Ok(());
    }
    for entry in walkdir::WalkDir::new(directory).follow_links(false) {
        let entry = entry.map_err(err)?;
        if entry.file_type().is_symlink() {
            return Err("资料中含符号链接，请核对后备份".into());
        }
        if entry.file_type().is_file() {
            let rel = entry
                .path()
                .strip_prefix(data)
                .map_err(err)?
                .to_str()
                .ok_or("备份文件名不是有效UTF-8")?
                .replace('\\', "/");
            validate_name(&rel)?;
            sources.push((rel, entry.path().to_path_buf()));
        }
    }
    Ok(())
}
fn parent_target(target: &Path) -> Result<PathBuf, String> {
    let parent = target
        .parent()
        .ok_or("请选择完整目标路径")?
        .canonicalize()
        .map_err(|_| "目标父目录不存在")?;
    let name = target.file_name().ok_or("请选择目标文件名")?;
    Ok(parent.join(name))
}
fn sql_read(path: &Path) -> Result<Connection, String> {
    Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(err)
}
fn catalog_check(path: &Path, schema: i64) -> Result<(), String> {
    let c = sql_read(path)?;
    let actual: i64 = c
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(err)?;
    if actual != schema || !(1..=3).contains(&actual) {
        return Err("备份目录版本不兼容".into());
    }
    let quick: String = c
        .query_row("PRAGMA quick_check", [], |r| r.get(0))
        .map_err(err)?;
    if quick != "ok" {
        return Err("备份目录完整性检查未通过".into());
    }
    let mut q = c.prepare("PRAGMA foreign_key_check").map_err(err)?;
    if q.query([]).map_err(err)?.next().map_err(err)?.is_some() {
        return Err("备份目录身份关联无效".into());
    }
    Ok(())
}
fn auxiliary_check(path: &Path, schema: i64) -> Result<(), String> {
    let c = sql_read(path)?;
    let version: i64 = c.pragma_query_value(None, "user_version", |r| r.get(0)).map_err(err)?;
    if version != schema || version != 1 { return Err("角色或会话数据库版本不兼容".into()); }
    let quick: String = c.query_row("PRAGMA quick_check", [], |r| r.get(0)).map_err(err)?;
    if quick != "ok" { return Err("角色或会话数据库完整性检查未通过".into()); }
    if c.prepare("PRAGMA foreign_key_check").map_err(err)?.query([]).map_err(err)?.next().map_err(err)?.is_some() {
        return Err("角色或会话数据关联无效".into());
    }
    Ok(())
}
fn auxiliary_members(data: &Path) -> Result<BTreeSet<String>, String> {
    let mut found = BTreeSet::new();
    for name in ["assistant.sqlite3", "companion.sqlite3"] {
        let path = data.join(name);
        match fs::symlink_metadata(&path) {
            Ok(m) if m.is_file() && !m.file_type().is_symlink() => { found.insert(name.into()); },
            Ok(_) => return Err("角色或会话数据库必须是普通文件".into()),
            Err(e) if e.kind()==std::io::ErrorKind::NotFound => {},
            Err(e) => return Err(err(e)),
        }
    }
    Ok(found)
}
// Logical rows, not SQLite page bytes/data_version: normal library::conn() calls may
// repeat harmless PRAGMAs. A read transaction keeps each digest internally consistent.
fn catalog_digest(path: &Path) -> Result<String, String> {
    let mut c = sql_read(path)?;
    let tx = c.transaction().map_err(err)?;
    let mut tables = tx.prepare("SELECT name,sql FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map_err(err)?;
    let tables = tables
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    let mut hash = Sha256::new();
    for (name, definition) in tables {
        hash.update((name.len() as u64).to_le_bytes());
        hash.update(name.as_bytes());
        hash.update((definition.len() as u64).to_le_bytes());
        hash.update(definition.as_bytes());
        let quoted = name.replace('"', "\"\"");
        let mut query = tx
            .prepare(&format!("SELECT * FROM \"{quoted}\""))
            .map_err(err)?;
        let columns = query.column_count();
        let mut rows = query.query([]).map_err(err)?;
        let mut encoded_rows = vec![];
        while let Some(row) = rows.next().map_err(err)? {
            let mut encoded = vec![];
            for i in 0..columns {
                use rusqlite::types::ValueRef;
                match row.get_ref(i).map_err(err)? {
                    ValueRef::Null => encoded.push(0),
                    ValueRef::Integer(v) => {
                        encoded.push(1);
                        encoded.extend(v.to_le_bytes());
                    }
                    ValueRef::Real(v) => {
                        encoded.push(2);
                        encoded.extend(v.to_bits().to_le_bytes());
                    }
                    ValueRef::Text(v) | ValueRef::Blob(v) => {
                        encoded.push(
                            if matches!(row.get_ref(i).map_err(err)?, ValueRef::Text(_)) {
                                3
                            } else {
                                4
                            },
                        );
                        encoded.extend((v.len() as u64).to_le_bytes());
                        encoded.extend(v);
                    }
                }
            }
            encoded_rows.push(encoded);
        }
        encoded_rows.sort();
        for row in encoded_rows {
            hash.update((row.len() as u64).to_le_bytes());
            hash.update(row);
        }
    }
    Ok(format!("{:x}", hash.finalize()))
}
fn source_members(data: &Path) -> Result<BTreeSet<String>, String> {
    let mut entries = vec![];
    for root in ["library/projects", "library/history", "drafts"] {
        add_source(&mut entries, data, &data.join(root))?;
    }
    Ok(entries.into_iter().map(|(name, _)| name).collect())
}
fn recheck_sources(
    data: &Path,
    sources: &[(String, PathBuf)],
    manifest: &Manifest,
    members: &BTreeSet<String>,
    catalog_hash: &str,
) -> Result<(), String> {
    for ((name, path), entry) in sources.iter().zip(&manifest.files) {
        if *name != entry.path || hash_file(path)? != (entry.size, entry.sha256.clone()) {
            return Err("备份期间源文件发生变化，请重试".into());
        }
    }
    if &source_members(data)? != members
        || catalog_digest(&data.join("library/catalog.sqlite3"))? != catalog_hash
    {
        return Err("备份期间目录或文件清单发生变化，请重试".into());
    }
    Ok(())
}
pub fn create_backup(data: &Path, target: &Path) -> Result<BackupReport, String> {
    create_backup_with_hook(data, target, |_| Ok(()))
}
fn create_backup_with_hook(
    data: &Path,
    target: &Path,
    mut copied_hook: impl FnMut(&Path) -> Result<(), String>,
) -> Result<BackupReport, String> {
    let target = parent_target(target)?;
    if target.exists() {
        return Err("目标文件已存在，请选择新的备份文件名".into());
    }
    if target.starts_with(data.canonicalize().map_err(err)?) {
        return Err("备份请保存在应用资料目录之外".into());
    }
    let _freeze = SnapshotGuard::acquire(data)?;
    let c = library::conn(data)?;
    let stage = target.with_file_name(format!(".inkstone-snapshot-{}", uuid::Uuid::new_v4()));
    private_directory(&stage, false)?;
    let result = (|| {
        let catalog = stage.join("catalog.sqlite3");
        // VACUUM accepts an existing empty file; precreate it with private permissions.
        drop(private_file(&catalog)?);
        c.execute("VACUUM INTO ?1", [catalog.to_string_lossy().as_ref()])
            .map_err(err)?;
        let schema = c
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .map_err(err)?;
        catalog_check(&catalog, schema)?;
        let catalog_hash = catalog_digest(&catalog)?;
        let members = source_members(data)?;
        let mut sources = vec![("library/catalog.sqlite3".to_string(), catalog)];
        let auxiliary_names = auxiliary_members(data)?;
        let mut auxiliary_digests = vec![];
        let mut stores = vec![];
        for name in &auxiliary_names {
            let source = data.join(name);
            auxiliary_check(&source, 1)?;
            let digest = catalog_digest(&source)?;
            let snapshot = stage.join(name);
            drop(private_file(&snapshot)?);
            sql_read(&source)?.execute("VACUUM INTO ?1", [snapshot.to_string_lossy().as_ref()]).map_err(err)?;
            auxiliary_check(&snapshot, 1)?;
            if catalog_digest(&snapshot)? != digest { return Err("会话或角色快照发生变化，请重试".into()); }
            sources.push((name.clone(), snapshot));
            stores.push(StoreSnapshot { path: name.clone(), schema_version: 1, resource_version: env!("CARGO_PKG_VERSION").into() });
            auxiliary_digests.push((name.clone(), digest));
        }
        add_source(&mut sources, data, &data.join("library/projects"))?;
        add_source(&mut sources, data, &data.join("library/history"))?;
        let view = library::list(data)?;
        let mut drafts = vec![];
        for d in view.documents {
            let root = library::project_root(data, &d.project_id)?;
            let ws = Workspace {
                root,
                db: PathBuf::new(),
            };
            let path = files::draft_path(data, &ws, &d.path);
            if path.is_file() {
                let entry = format!(
                    "drafts/{}",
                    path.file_name().ok_or("草稿名称无效")?.to_string_lossy()
                );
                if fs::symlink_metadata(&path)
                    .map_err(err)?
                    .file_type()
                    .is_symlink()
                {
                    return Err("草稿不能是符号链接".into());
                }
                sources.push((entry.clone(), path));
                drafts.push(DraftLocation {
                    entry,
                    project: d.project_id,
                    path: d.path,
                });
            }
        }
        sources.sort_by(|a, b| a.0.cmp(&b.0));
        if sources.len() > MAX_FILES {
            return Err("备份超过50000个文件".into());
        }
        let mut entries = vec![];
        let mut total = 0;
        for (name, path) in &sources {
            let (size, sha256) = hash_file(path)?;
            total += size;
            if total > MAX_TOTAL {
                return Err("备份超过2 GB限制".into());
            }
            entries.push(Entry {
                path: name.clone(),
                size,
                sha256,
            });
        }
        let manifest = Manifest {
            format: FORMAT,
            app_version: env!("CARGO_PKG_VERSION").into(),
            created_at: now(),
            schema_version: schema,
            files: entries,
            drafts,
            stores,
            excluded: vec![
                "external-originals".into(),
                "settings-and-credentials".into(),
                "unapplied-block-forms".into(),
                "rebuildable-index-and-calendar".into(),
            ],
        };
        let raw = serde_json::to_vec_pretty(&manifest).map_err(err)?;
        let archive = stage.join("backup.inkstone.zip");
        let mut zip = ZipWriter::new(private_file(&archive)?);
        let options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored)
            .unix_permissions(0o600);
        zip.start_file("manifest.json", options).map_err(err)?;
        zip.write_all(&raw).map_err(err)?;
        for ((name, path), entry) in sources.iter().zip(&manifest.files) {
            zip.start_file(name, options).map_err(err)?;
            let mut input = File::open(path).map_err(err)?;
            let copied = std::io::copy(&mut input, &mut zip).map_err(err)?;
            if copied != entry.size || hash_file(path)? != (entry.size, entry.sha256.clone()) {
                return Err("备份期间源文件发生变化，请重试".into());
            }
            copied_hook(path)?;
        }
        zip.finish().map_err(err)?.sync_all().map_err(err)?;
        let validation = validate_backup(&archive)?;
        if !validation.valid {
            return Err(format!("备份校验未通过：{}", validation.issues.join("；")));
        }
        // An external editor does not enter the application gate. Recheck all earlier
        // files and directory membership after the entire archive has been validated.
        recheck_sources(data, &sources, &manifest, &members, &catalog_hash)?;
        if auxiliary_members(data)? != auxiliary_names { return Err("备份期间会话或角色数据库清单变化".into()); }
        for (name, digest) in &auxiliary_digests {
            auxiliary_check(&data.join(name), 1)?;
            if catalog_digest(&data.join(name))? != *digest { return Err("备份期间会话或角色资料发生变化，请重试".into()); }
        }
        secure_tree(&stage)?;
        // A hard link publishes without replacing a concurrently created target.
        fs::hard_link(&archive, &target).map_err(|_| "无法发布备份，目标可能已存在或磁盘不支持")?;
        Ok(BackupReport {
            path: target.display().to_string(),
            files: manifest.files.len(),
            total_bytes: total,
            created_at: manifest.created_at,
            manifest_hash: files::hash(&raw),
            mode: "backup".into(),
            warnings: manifest_warnings(&manifest),
        })
    })();
    let _ = fs::remove_dir_all(&stage);
    result
}
fn read_manifest(zip: &mut ZipArchive<File>) -> Result<(Manifest, Vec<u8>), String> {
    if zip.len() > MAX_FILES + 1 {
        return Err("备份文件数超限".into());
    }
    let mut raw = vec![];
    let mut file = zip.by_name("manifest.json").map_err(|_| "缺少备份清单")?;
    if file.size() > 8 * 1024 * 1024 {
        return Err("备份清单过大".into());
    }
    file.read_to_end(&mut raw).map_err(err)?;
    let m: Manifest = serde_json::from_slice(&raw).map_err(|_| "备份清单格式无效")?;
    if !(1..=FORMAT).contains(&m.format) || !(1..=3).contains(&m.schema_version) {
        return Err("备份格式或目录版本不兼容".into());
    }
    Ok((m, raw))
}
fn inspect(zip: &mut ZipArchive<File>, manifest: &Manifest) -> Result<(), String> {
    let mut known = HashMap::new();
    let mut total = 0u64;
    for e in &manifest.files {
        validate_name(&e.path)?;
        if known.insert(e.path.clone(), e).is_some() {
            return Err("清单包含重复文件".into());
        }
        total = total.checked_add(e.size).ok_or("备份大小无效")?;
        if total > MAX_TOTAL || e.size > MAX_FILE {
            return Err("备份文件大小超限".into());
        }
    }
    if !known.contains_key("library/catalog.sqlite3") {
        return Err("清单缺少目录数据库".into());
    }
    let mut store_paths = HashSet::new();
    for store in &manifest.stores {
        if manifest.format < 2 || !matches!(store.path.as_str(), "assistant.sqlite3" | "companion.sqlite3")
            || store.schema_version != 1 || !store_paths.insert(store.path.clone()) || !known.contains_key(&store.path) {
            return Err("角色或会话备份声明无效".into());
        }
    }
    for name in ["assistant.sqlite3", "companion.sqlite3"] {
        if known.contains_key(name) != store_paths.contains(name) { return Err("角色或会话备份清单不一致".into()); }
    }
    let mut seen = HashSet::new();
    for i in 0..zip.len() {
        let mut file = zip.by_index(i).map_err(err)?;
        let name = file.name().map_err(err)?.into_owned();
        if !seen.insert(name.clone()) {
            return Err("备份包含重复条目".into());
        }
        if file.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000) {
            return Err("备份不能包含符号链接".into());
        }
        if name == "manifest.json" {
            continue;
        }
        let expected = known.get(&name).ok_or("备份包含清单外文件")?;
        if file.size() != expected.size {
            return Err("备份文件长度不符".into());
        }
        let (size, hash) = hash_reader(&mut file)?;
        if size != expected.size || hash != expected.sha256 {
            return Err(format!("备份文件校验失败：{name}"));
        }
    }
    if seen.len() != known.len() + 1 {
        return Err("备份缺少清单中的文件".into());
    }
    let mut mapped_entries = HashSet::new();
    let mut mapped_documents = HashSet::new();
    for d in &manifest.drafts {
        if !mapped_entries.insert(d.entry.clone())
            || !mapped_documents.insert((d.project.clone(), d.path.clone()))
        {
            return Err("草稿映射重复，无法确定恢复身份".into());
        }
        files::validate_relative(&d.path)?;
        if d.project != "inbox" && uuid::Uuid::parse_str(&d.project).is_err() {
            return Err("草稿空间身份无效".into());
        }
        if !d.entry.starts_with("drafts/") || !known.contains_key(&d.entry) {
            return Err("草稿映射无效".into());
        }
    }
    if known
        .keys()
        .any(|name| name.starts_with("drafts/") && !mapped_entries.contains(name))
    {
        return Err("备份草稿缺少身份映射".into());
    }
    Ok(())
}
fn extract(zip: &mut ZipArchive<File>, m: &Manifest, stage: &Path) -> Result<(), String> {
    for e in &m.files {
        let target = stage.join(&e.path);
        private_directory(target.parent().ok_or("备份路径无效")?, true)?;
        let mut out = private_file(&target)?;
        let mut input = zip.by_name(&e.path).map_err(err)?;
        std::io::copy(&mut input, &mut out).map_err(err)?;
        out.sync_all().map_err(err)?;
    }
    Ok(())
}
fn restored_catalog_check(stage: &Path, m: &Manifest) -> Result<(), String> {
    catalog_check(&stage.join("library/catalog.sqlite3"), m.schema_version)?;
    for store in &m.stores {
        let path = stage.join(&store.path);
        auxiliary_check(&path, store.schema_version)?;
        if store.path == "assistant.sqlite3" { crate::assistant::validate_snapshot(&path)?; }
        if store.path == "companion.sqlite3" { crate::companion::validate_snapshot(&path)?; }
    }
    let c = sql_read(&stage.join("library/catalog.sqlite3"))?;
    let mut q = c
        .prepare("SELECT project,path,status FROM documents")
        .map_err(err)?;
    let rows = q
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(err)?;
    for row in rows {
        let (project, path, status) = row.map_err(err)?;
        if project != "inbox" && uuid::Uuid::parse_str(&project).is_err() {
            return Err("目录空间身份无效".into());
        }
        files::validate_relative(&path)?;
        if status != "pending"
            && !stage
                .join("library/projects")
                .join(project)
                .join(path)
                .is_file()
        {
            return Err("目录中有文档缺失，未切换资料库".into());
        }
    }
    let mut versions = c
        .prepare("SELECT id,document,content_hash,attachment_count FROM document_history")
        .map_err(err)?;
    for version in versions
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, usize>(3)?,
            ))
        })
        .map_err(err)?
    {
        let (id, doc, expected, count) = version.map_err(err)?;
        uuid::Uuid::parse_str(&id).map_err(|_| "历史版本身份无效")?;
        uuid::Uuid::parse_str(&doc).map_err(|_| "历史文档身份无效")?;
        let dir = stage.join("library/history").join(doc).join(id);
        let snapshot: serde_json::Value = serde_json::from_slice(
            &fs::read(dir.join("snapshot.json")).map_err(|_| "备份缺少历史快照")?,
        )
        .map_err(|_| "历史快照格式无效")?;
        let content = snapshot
            .get("content")
            .and_then(|v| v.as_str())
            .ok_or("历史正文无效")?;
        if files::hash(content) != expected
            || snapshot.get("content_hash").and_then(|v| v.as_str()) != Some(&expected)
        {
            return Err("历史正文校验失败".into());
        }
        let assets = snapshot
            .get("assets")
            .and_then(|v| v.as_array())
            .ok_or("历史附件清单无效")?;
        if assets.len() != count {
            return Err("历史附件数量不符".into());
        }
        for asset in assets {
            let path = asset
                .get("path")
                .and_then(|v| v.as_str())
                .ok_or("历史附件路径无效")?;
            files::validate_relative(path)?;
            let expected = asset
                .get("hash")
                .and_then(|v| v.as_str())
                .ok_or("历史附件指纹无效")?;
            if hash_file(&dir.join(path))?.1 != expected {
                return Err("历史附件校验失败".into());
            }
        }
    }
    for draft in &m.drafts {
        let exists: bool = c
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM documents WHERE project=? AND path=?)",
                rusqlite::params![draft.project, draft.path],
                |r| r.get(0),
            )
            .map_err(err)?;
        if !exists {
            return Err("草稿不对应备份中的文档身份".into());
        }
        let bytes = fs::read(stage.join(&draft.entry)).map_err(|_| "备份缺少恢复草稿")?;
        let saved: crate::models::Draft =
            serde_json::from_slice(&bytes).map_err(|_| "恢复草稿格式损坏，不能标为已校验")?;
        if saved.content.len() as u64 > files::MAX_FILE {
            return Err("恢复草稿正文超过2 MB限制".into());
        }
    }
    Ok(())
}
fn with_checked_archive<T>(
    path: &Path,
    action: impl FnOnce(&mut ZipArchive<File>, &Manifest, &[u8]) -> Result<T, String>,
) -> Result<T, String> {
    let mut zip = ZipArchive::new(File::open(path).map_err(err)?).map_err(|_| "备份包无法打开")?;
    let (m, raw) = read_manifest(&mut zip)?;
    inspect(&mut zip, &m)?;
    action(&mut zip, &m, &raw)
}
pub fn validate_backup(path: &Path) -> Result<BackupValidation, String> {
    let outcome = with_checked_archive(path, |zip, m, raw| {
        let stage = std::env::temp_dir().join(format!("inkstone-check-{}", uuid::Uuid::new_v4()));
        private_directory(&stage, false)?;
        let result = (|| {
            extract(zip, m, &stage)?;
            restored_catalog_check(&stage, m)?;
            Ok(BackupValidation {
                valid: true,
                path: path.display().to_string(),
                files: m.files.len(),
                total_bytes: m.files.iter().map(|e| e.size).sum(),
                created_at: m.created_at,
                schema_version: m.schema_version,
                manifest_hash: files::hash(raw),
                issues: vec![],
                warnings: manifest_warnings(m),
            })
        })();
        let _ = fs::remove_dir_all(&stage);
        result
    });
    match outcome {
        Ok(report) => Ok(report),
        Err(error) => Ok(BackupValidation {
            valid: false,
            path: path.display().to_string(),
            files: 0,
            total_bytes: 0,
            created_at: 0,
            schema_version: 0,
            manifest_hash: String::new(),
            issues: vec![error],
            warnings: warnings(),
        }),
    }
}
pub fn restore_backup(path: &Path, target: &Path, data: &Path) -> Result<BackupReport, String> {
    restore_backup_with_hook(path, target, data, || Ok(()))
}
fn restore_backup_with_hook(
    path: &Path,
    target: &Path,
    data: &Path,
    before_publish: impl FnOnce() -> Result<(), String>,
) -> Result<BackupReport, String> {
    let target = parent_target(target)?;
    if target.exists() {
        return Err("恢复目标必须是尚不存在的新目录，原资料库不会被覆盖".into());
    }
    if target.starts_with(data.canonicalize().map_err(err)?) {
        return Err("恢复预演目录必须位于当前应用资料目录之外".into());
    }
    with_checked_archive(path, |zip, m, raw| {
        let stage = target.with_file_name(format!(".inkstone-restore-{}", uuid::Uuid::new_v4()));
        private_directory(&stage, false)?;
        let result = (|| {
            extract(zip, m, &stage)?;
            restored_catalog_check(&stage, m)?;
            // Recovery draft filenames depend on the workspace root, so rebind to the final new root.
            for d in &m.drafts {
                let ws = Workspace {
                    root: target.join("library/projects").join(&d.project),
                    db: PathBuf::new(),
                };
                let new = files::draft_path(&stage, &ws, &d.path);
                let old = stage.join(&d.entry);
                if new != old {
                    if new.exists() {
                        return Err("恢复草稿身份冲突".into());
                    }
                    fs::rename(old, new).map_err(err)?;
                }
            }
            let mut manifest_file = private_file(&stage.join("restore-manifest.json"))?;
            manifest_file.write_all(raw).map_err(err)?;
            manifest_file.sync_all().map_err(err)?;
            secure_tree(&stage)?;
            before_publish()?;
            // Atomically reserve this fresh name. Existing directories, files and even
            // dangling symlinks make create_dir fail rather than being replaced.
            private_directory(&target, false).map_err(|_| "恢复目标已出现，请改用新的目录")?;
            if let Err(error) = fs::rename(&stage, &target) {
                // Only remove our empty reservation; never recursively delete a target
                // someone populated after it appeared.
                let _ = fs::remove_dir(&target);
                return Err(err(error));
            }
            Ok(BackupReport {
                path: target.display().to_string(),
                files: m.files.len(),
                total_bytes: m.files.iter().map(|e| e.size).sum(),
                created_at: m.created_at,
                manifest_hash: files::hash(raw),
                mode: "restore-preview".into(),
                warnings: manifest_warnings(m),
            })
        })();
        if stage.exists() {
            let _ = fs::remove_dir_all(&stage);
        }
        result
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn snapshot_drains_accepted_writes_and_reopens_admission() {
        let d = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        let accepted = mutation(d.path()).unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::scope(|scope| {
            scope.spawn(|| {
                let _snapshot = SnapshotGuard::acquire(d.path()).unwrap();
                tx.send(()).unwrap();
            });
            while !gate(d.path()).state.lock().unwrap().preparing {
                std::thread::yield_now();
            }
            assert!(mutation(d.path()).is_err());
            assert!(mutation(other.path()).is_ok());
            assert!(rx.try_recv().is_err());
            drop(accepted);
            rx.recv_timeout(std::time::Duration::from_secs(2)).unwrap();
        });
        assert!(mutation(d.path()).is_ok());
        set_managed_error(d.path(), Some("损坏目录".into()));
        assert!(mutation(d.path()).is_err());
        assert!(mutation_scope(d.path(), false).is_ok());
        set_managed_error(d.path(), None);
        assert!(mutation(d.path()).is_ok());
    }
    fn history_fixture(data: &Path, source: &Path) -> (library::Document, Workspace) {
        let path = source.join("原文.md");
        fs::write(&path, "# 第一版\\n\\n![图](image.png)\\n\\n重要正文").unwrap();
        fs::write(source.join("image.png"), b"old image").unwrap();
        let imported = library::import(
            data,
            "inbox",
            &[path.to_string_lossy().into_owned()],
            true,
            true,
            &std::sync::atomic::AtomicBool::new(false),
            |_| {},
        )
        .unwrap();
        let doc = library::get(data, imported.items[0].document_id.as_ref().unwrap()).unwrap();
        fs::write(&path, "# 第二版\\n\\n![图](image.png)\\n\\n更多正文").unwrap();
        fs::write(source.join("image.png"), b"new image").unwrap();
        let preview = library::check_source_update(data, &doc.id).unwrap();
        assert!(preview.can_update);
        library::apply_source_update(
            data,
            &doc.id,
            &preview.managed_fingerprint,
            preview.source_fingerprint.as_ref().unwrap(),
            false,
        )
        .unwrap();
        let ws = crate::documents::library_workspace(data, "inbox").unwrap();
        (doc, ws)
    }
    #[test]
    fn snapshot_keeps_real_history_assets_and_rebound_draft() {
        let data = tempfile::tempdir().unwrap();
        let source = tempfile::tempdir().unwrap();
        let out = tempfile::tempdir().unwrap();
        let (doc, ws) = history_fixture(data.path(), source.path());
        let body = fs::read_to_string(ws.root.join(&doc.path)).unwrap();
        crate::documents::draft(
            &ws,
            data.path(),
            &doc.path,
            "未保存文字".into(),
            files::hash(&body),
        )
        .unwrap();
        let versions = library::history(data.path(), &doc.id).unwrap();
        assert_eq!(versions.len(), 1);
        assert_eq!(versions[0].attachment_count, 1);
        let file = out.path().join("backup.zip");
        let report = create_backup(data.path(), &file).unwrap();
        assert!(report.files >= 6);
        assert!(validate_backup(&file).unwrap().valid);
        let restored = out.path().join("recovered");
        restore_backup(&file, &restored, data.path()).unwrap();
        #[cfg(unix)]
        for entry in walkdir::WalkDir::new(&restored) {
            let entry = entry.unwrap();
            let mode = entry.metadata().unwrap().permissions().mode() & 0o777;
            assert_eq!(
                mode,
                if entry.file_type().is_dir() {
                    0o700
                } else {
                    0o600
                },
                "{}",
                entry.path().display()
            );
        }
        #[cfg(unix)]
        assert_eq!(
            fs::metadata(&file).unwrap().permissions().mode() & 0o777,
            0o600
        );
        let reopened = library::list(&restored).unwrap();
        assert!(reopened.documents.iter().any(|d| d.id == doc.id));
        let newws = crate::documents::library_workspace(&restored, "inbox").unwrap();
        assert_eq!(
            fs::read_to_string(newws.root.join(&doc.path)).unwrap(),
            body
        );
        assert_eq!(
            crate::documents::read(&newws, &restored, &doc.path)
                .unwrap()
                .draft
                .unwrap()
                .content,
            "未保存文字"
        );
        let history = library::history(&restored, &doc.id).unwrap();
        assert_eq!(history[0].id, versions[0].id);
        let p = library::check_source_update(&restored, &doc.id).unwrap();
        library::restore_version(&restored, &doc.id, &history[0].id, &p.managed_fingerprint)
            .unwrap();
        let original = fs::read_to_string(newws.root.join(&doc.path)).unwrap();
        assert!(original.contains("第一版"));
        let dir = newws.root.join(&doc.path).parent().unwrap().to_path_buf();
        assert!(walkdir::WalkDir::new(&dir)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|e| e.file_type().is_file())
            .any(|e| fs::read(e.path()).unwrap() == b"old image"));
        assert!(restore_backup(&file, &restored, data.path()).is_err());
        assert!(create_backup(data.path(), &file).is_err());
        assert_eq!(fs::read_to_string(ws.root.join(&doc.path)).unwrap(), body);
        fs::write(&file, b"corrupt").unwrap();
        assert!(!validate_backup(&file).unwrap().valid);
        assert!(restore_backup(&file, &out.path().join("bad"), data.path()).is_err());
        assert!(!out.path().join("bad").exists());
    }
    pub(super) fn rewrite_archive(source: &Path, target: &Path, mutate: impl Fn(&str, &mut Vec<u8>)) {
        let mut archive = ZipArchive::new(File::open(source).unwrap()).unwrap();
        let mut entries = vec![];
        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).unwrap();
            let name = entry.name().unwrap().into_owned();
            let mut bytes = vec![];
            entry.read_to_end(&mut bytes).unwrap();
            entries.push((name, bytes));
        }
        let mut manifest: Manifest = serde_json::from_slice(
            &entries
                .iter()
                .find(|(n, _)| n == "manifest.json")
                .unwrap()
                .1,
        )
        .unwrap();
        for (name, bytes) in &mut entries {
            if name == "manifest.json" {
                continue;
            }
            mutate(name, bytes);
            let entry = manifest.files.iter_mut().find(|e| &e.path == name).unwrap();
            entry.size = bytes.len() as u64;
            entry.sha256 = files::hash(bytes);
        }
        entries
            .iter_mut()
            .find(|(n, _)| n == "manifest.json")
            .unwrap()
            .1 = serde_json::to_vec(&manifest).unwrap();
        let mut output = ZipWriter::new(private_file(target).unwrap());
        for (name, bytes) in entries {
            output
                .start_file(name, SimpleFileOptions::default())
                .unwrap();
            output.write_all(&bytes).unwrap();
        }
        output.finish().unwrap();
    }
    #[test]
    fn self_consistent_archive_still_rejects_corrupt_history_and_assets() {
        let data = tempfile::tempdir().unwrap();
        let source = tempfile::tempdir().unwrap();
        let out = tempfile::tempdir().unwrap();
        let (doc, _) = history_fixture(data.path(), source.path());
        let backup = out.path().join("valid.zip");
        create_backup(data.path(), &backup).unwrap();
        let bad_image = out.path().join("bad-image.zip");
        rewrite_archive(&backup, &bad_image, |name, bytes| {
            if name.starts_with("library/history/") && name.ends_with(".png") {
                *bytes = b"corrupted history image".to_vec();
            }
        });
        assert!(!validate_backup(&bad_image).unwrap().valid);
        assert!(restore_backup(&bad_image, &out.path().join("bad-image"), data.path()).is_err());
        let bad_body = out.path().join("bad-body.zip");
        rewrite_archive(&backup, &bad_body, |name, bytes| {
            if name.starts_with("library/history/") && name.ends_with("snapshot.json") {
                let mut value: serde_json::Value = serde_json::from_slice(bytes).unwrap();
                value["content"] = serde_json::Value::String("tampered snapshot".into());
                *bytes = serde_json::to_vec(&value).unwrap();
            }
        });
        assert!(!validate_backup(&bad_body).unwrap().valid);
        let bad_path = out.path().join("bad-path.zip");
        rewrite_archive(&backup, &bad_path, |name, bytes| {
            if name.starts_with("library/history/") && name.ends_with("snapshot.json") {
                let mut value: serde_json::Value = serde_json::from_slice(bytes).unwrap();
                value["assets"][0]["path"] = "../escape.png".into();
                *bytes = serde_json::to_vec(&value).unwrap();
            }
        });
        assert!(!validate_backup(&bad_path).unwrap().valid);
        assert!(!out.path().join("escape.png").exists());
        assert_eq!(library::history(data.path(), &doc.id).unwrap().len(), 1);
    }
    fn rewrite_manifest(source: &Path, target: &Path, mutate: impl Fn(&mut Manifest)) {
        let mut archive = ZipArchive::new(File::open(source).unwrap()).unwrap();
        let mut output = ZipWriter::new(private_file(target).unwrap());
        for i in 0..archive.len() {
            let mut file = archive.by_index(i).unwrap();
            let name = file.name().unwrap().into_owned();
            let mut bytes = vec![];
            file.read_to_end(&mut bytes).unwrap();
            if name == "manifest.json" {
                let mut manifest: Manifest = serde_json::from_slice(&bytes).unwrap();
                mutate(&mut manifest);
                bytes = serde_json::to_vec(&manifest).unwrap();
            }
            output
                .start_file(name, SimpleFileOptions::default())
                .unwrap();
            output.write_all(&bytes).unwrap();
        }
        output.finish().unwrap();
    }
    #[test]
    fn corrupt_oversized_unmapped_and_duplicate_drafts_are_not_validated() {
        let data = tempfile::tempdir().unwrap();
        let out = tempfile::tempdir().unwrap();
        let doc = library::create_document(data.path(), "inbox", "A.md", "正文A").unwrap();
        let other = library::create_document(data.path(), "inbox", "B.md", "正文B").unwrap();
        let ws = crate::documents::library_workspace(data.path(), "inbox").unwrap();
        for d in [&doc, &other] {
            crate::documents::draft(
                &ws,
                data.path(),
                &d.path,
                "未保存文字".into(),
                files::hash("正文"),
            )
            .unwrap();
        }
        let source = out.path().join("valid.zip");
        create_backup(data.path(), &source).unwrap();
        let corrupt = out.path().join("corrupt-draft.zip");
        rewrite_archive(&source, &corrupt, |name, bytes| {
            if name.starts_with("drafts/") {
                *bytes = b"invalid draft json".to_vec();
            }
        });
        assert!(!validate_backup(&corrupt).unwrap().valid);
        assert!(
            restore_backup(&corrupt, &out.path().join("corrupt-restored"), data.path()).is_err()
        );
        let oversized = out.path().join("oversized-draft.zip");
        rewrite_archive(&source, &oversized, |name, bytes| {
            if name.starts_with("drafts/") {
                *bytes = serde_json::to_vec(&crate::models::Draft {
                    content: "a".repeat(files::MAX_FILE as usize + 1),
                    base_hash: files::hash("正文"),
                })
                .unwrap();
            }
        });
        assert!(!validate_backup(&oversized).unwrap().valid);
        for kind in [
            "duplicate-entry",
            "duplicate-owner",
            "unmapped",
            "unsafe-path",
        ] {
            let bad = out.path().join(format!("{kind}.zip"));
            rewrite_manifest(&source, &bad, |m| match kind {
                "duplicate-entry" => m.drafts[1].entry = m.drafts[0].entry.clone(),
                "duplicate-owner" => {
                    m.drafts[1].project = m.drafts[0].project.clone();
                    m.drafts[1].path = m.drafts[0].path.clone();
                }
                "unmapped" => {
                    m.drafts.pop();
                }
                "unsafe-path" => m.drafts[0].path = "../escape.md".into(),
                _ => unreachable!(),
            });
            assert!(!validate_backup(&bad).unwrap().valid, "{kind}");
            let target = out.path().join(format!("restore-{kind}"));
            assert!(
                restore_backup(&bad, &target, data.path()).is_err(),
                "{kind}"
            );
            assert!(!target.exists());
        }
        // A corrupted local draft must not silently become a successful backup.
        fs::write(files::draft_path(data.path(), &ws, &doc.path), b"corrupt").unwrap();
        let bad_local = out.path().join("bad-local.zip");
        assert!(create_backup(data.path(), &bad_local).is_err());
        assert!(!bad_local.exists());
        assert!(mutation(data.path()).is_ok());
        assert_eq!(fs::read_to_string(ws.root.join(doc.path)).unwrap(), "正文A");
    }
    #[test]
    fn final_recheck_catches_early_file_change_members_and_catalog() {
        for scenario in ["early-file", "member", "draft-member", "catalog"] {
            let data = tempfile::tempdir().unwrap();
            let out = tempfile::tempdir().unwrap();
            let doc =
                library::create_document(data.path(), "inbox", "正文.md", "原始正文").unwrap();
            let root = library::project_root(data.path(), "inbox").unwrap();
            let file = root.join(&doc.path);
            let target = out.path().join("backup.zip");
            let mut changed = false;
            let result = create_backup_with_hook(data.path(), &target, |copied| {
                if !changed && copied.ends_with(&doc.path) {
                    match scenario {
                        "early-file" => fs::write(&file, "外部应用的新正文").unwrap(),
                        "member" => {
                            fs::write(file.parent().unwrap().join("later.md"), "later").unwrap()
                        }
                        "draft-member" => {
                            fs::create_dir_all(data.path().join("drafts")).unwrap();
                            fs::write(data.path().join("drafts/new.json"), "{}").unwrap();
                        }
                        "catalog" => {
                            library::conn(data.path())
                                .unwrap()
                                .execute(
                                    "UPDATE documents SET title='外部标题' WHERE id=?",
                                    [&doc.id],
                                )
                                .unwrap();
                        }
                        _ => unreachable!(),
                    }
                    changed = true;
                }
                Ok(())
            });
            assert!(changed);
            assert!(result.is_err(), "{scenario}");
            assert!(!target.exists());
            assert!(mutation(data.path()).is_ok());
            assert!(!fs::read_dir(out.path()).unwrap().any(|e| e
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".inkstone-")));
        }
        let data = tempfile::tempdir().unwrap();
        let out = tempfile::tempdir().unwrap();
        library::create_document(data.path(), "inbox", "正常.md", "正文").unwrap();
        // Harmless repeated conn/pragma activity must not be considered a logical change.
        assert!(
            create_backup_with_hook(data.path(), &out.path().join("normal.zip"), |_| {
                library::conn(data.path())?;
                Ok(())
            })
            .is_ok()
        );
    }
    #[test]
    fn failed_snapshot_releases_gate_and_does_not_overwrite_concurrent_target() {
        let data = tempfile::tempdir().unwrap();
        let out = tempfile::tempdir().unwrap();
        library::create_document(data.path(), "inbox", "正文.md", "重要正文").unwrap();
        let failed = out.path().join("failed.zip");
        assert!(create_backup_with_hook(data.path(), &failed, |_| {
            assert!(mutation(data.path()).is_err());
            Err("injected I/O failure".into())
        })
        .is_err());
        assert!(mutation(data.path()).is_ok());
        assert!(!failed.exists());
        let race = out.path().join("race.zip");
        let mut created = false;
        assert!(create_backup_with_hook(data.path(), &race, |_| {
            if !created {
                fs::write(&race, b"concurrent target").unwrap();
                created = true;
            }
            Ok(())
        })
        .is_err());
        assert_eq!(fs::read(&race).unwrap(), b"concurrent target");
        assert!(mutation(data.path()).is_ok());
        let good = out.path().join("good.zip");
        create_backup(data.path(), &good).unwrap();
        let restore = out.path().join("restore");
        assert!(restore_backup_with_hook(&good, &restore, data.path(), || {
            fs::create_dir(&restore).unwrap();
            fs::write(restore.join("keep"), b"concurrent directory").unwrap();
            Ok(())
        })
        .is_err());
        assert_eq!(
            fs::read(restore.join("keep")).unwrap(),
            b"concurrent directory"
        );
        assert!(!fs::read_dir(out.path()).unwrap().any(|e| e
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".inkstone-")));
    }
    #[cfg(unix)]
    #[test]
    fn snapshot_and_restore_refuse_symlinks_and_respect_private_permissions() {
        use std::os::unix::fs::symlink;
        let data = tempfile::tempdir().unwrap();
        let out = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let doc = library::create_document(data.path(), "inbox", "正文.md", "重要正文").unwrap();
        let root = library::project_root(data.path(), "inbox").unwrap();
        symlink(outside.path(), root.join("outside")).unwrap();
        assert!(create_backup(data.path(), &out.path().join("bad.zip")).is_err());
        assert!(mutation(data.path()).is_ok());
        fs::remove_file(root.join("outside")).unwrap();
        let good = out.path().join("good.zip");
        let mut checked_stage = false;
        create_backup_with_hook(data.path(), &good, |copied| {
            if copied.file_name().unwrap() == "catalog.sqlite3" {
                let stage = copied.parent().unwrap();
                assert_eq!(
                    fs::metadata(stage).unwrap().permissions().mode() & 0o777,
                    0o700
                );
                assert_eq!(
                    fs::metadata(copied).unwrap().permissions().mode() & 0o777,
                    0o600
                );
                assert_eq!(
                    fs::metadata(stage.join("backup.inkstone.zip"))
                        .unwrap()
                        .permissions()
                        .mode()
                        & 0o777,
                    0o600
                );
                checked_stage = true;
            }
            Ok(())
        })
        .unwrap();
        assert!(checked_stage);
        let dangling = out.path().join("dangling");
        symlink(outside.path().join("absent"), &dangling).unwrap();
        assert!(restore_backup(&good, &dangling, data.path()).is_err());
        assert!(fs::symlink_metadata(&dangling)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(
            fs::read_to_string(root.join(&doc.path)).unwrap(),
            "重要正文"
        );
        assert!(!outside.path().join("absent").exists());
    }
    #[test]
    fn unlisted_and_traversal_archive_entries_are_refused() {
        let out = tempfile::tempdir().unwrap();
        let p = out.path().join("bad.zip");
        let mut z = ZipWriter::new(File::create(&p).unwrap());
        let m = Manifest {
            format: 1,
            app_version: "test".into(),
            created_at: 0,
            schema_version: 3,
            files: vec![Entry {
                path: "../escape".into(),
                size: 0,
                sha256: files::hash(""),
            }],
            drafts: vec![],
            excluded: vec![],
            stores: vec![],
        };
        z.start_file("manifest.json", SimpleFileOptions::default())
            .unwrap();
        z.write_all(&serde_json::to_vec(&m).unwrap()).unwrap();
        z.finish().unwrap();
        assert!(!validate_backup(&p).unwrap().valid);
        assert!(!out.path().join("escape").exists());
    }
}

#[cfg(test)]
#[path = "maintenance_v07_tests.rs"]
mod v07_tests;
