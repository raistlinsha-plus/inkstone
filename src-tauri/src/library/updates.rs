//! Explicit source refreshes. Content is authoritative; a persisted operation
//! journal reconciles a completed atomic body replacement after a process crash.
use super::*;
use rusqlite::OptionalExtension;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Baseline {
    pub(super) source_fingerprint: String,
    pub(super) managed_fingerprint: String,
    pub(super) allowed_root: String,
    pub(super) attachments: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceUpdatePreview {
    pub document_id: String,
    pub title: String,
    pub status: String,
    pub managed_hash: String,
    pub managed_fingerprint: String,
    pub source_fingerprint: Option<String>,
    pub can_update: bool,
    pub can_keep_both: bool,
    pub message: String,
    pub current_content: String,
    pub source_content: Option<String>,
    pub attachment_changes: Vec<String>,
    pub warnings: Vec<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryVersion {
    pub id: String,
    pub created: i64,
    pub reason: String,
    pub content_hash: String,
    pub attachment_count: usize,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateResult {
    pub document: Document,
    pub warning: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
struct Asset {
    path: String,
    hash: String,
}
#[derive(Serialize, Deserialize)]
struct Snapshot {
    content: String,
    content_hash: String,
    assets: Vec<Asset>,
}
pub(super) struct Managed {
    pub(super) path: PathBuf,
    pub(super) text: String,
    pub(super) fingerprint: String,
    pub(super) assets: Vec<(String, Vec<u8>)>,
}
struct Incoming {
    text: String,
    original_hash: String,
    source_fingerprint: String,
    assets: Vec<(String, Vec<u8>)>,
    warnings: Vec<String>,
    usable: bool,
}
#[derive(Serialize, Deserialize)]
pub(super) struct OperationMetadata {
    pub(super) baseline: Option<Baseline>,
    pub(super) original_hash: Option<String>,
    pub(super) import_fingerprint: Option<String>,
}

pub(super) fn image_path(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|x| x.to_str())
            .map(str::to_lowercase)
            .as_deref(),
        Some("png" | "jpg" | "jpeg" | "webp" | "gif")
    )
}
pub(super) fn markdown(path: &str) -> bool {
    matches!(
        Path::new(path)
            .extension()
            .and_then(|x| x.to_str())
            .map(str::to_lowercase)
            .as_deref(),
        Some("md" | "markdown")
    )
}
fn image_urls(text: &str) -> Vec<String> {
    Parser::new(text)
        .filter_map(|event| match event {
            Event::Start(Tag::Image { dest_url, .. })
            | Event::Start(Tag::Link { dest_url, .. }) => {
                let (path, _) = local_url(&dest_url)?;
                let path = decoded(path).ok()?;
                image_path(Path::new(&path)).then_some(path)
            }
            _ => None,
        })
        .collect()
}
fn bounded_asset(path: &Path, total: &mut usize) -> Result<Vec<u8>, String> {
    let bytes = read_attachment(path)?;
    *total += bytes.len();
    if *total > 100 * 1024 * 1024 {
        return Err("本篇附件超过 100 MB，不能执行来源替换".into());
    }
    Ok(bytes)
}
pub(super) fn managed(data: &Path, d: &Document) -> Result<Managed, String> {
    if d.status != "ready" {
        return Err("请先恢复回收站中的文档".into());
    }
    let root = project_root(data, &d.project_id)?;
    files::validate_relative(&d.path)?;
    let mut entry = root.clone();
    for part in Path::new(&d.path).components() {
        entry.push(part);
        if fs::symlink_metadata(&entry).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err("受管理文档路径不能是符号链接".into());
        }
    }
    let path = files::resolve(&root, &d.path, false)?;
    let directory = path.parent().ok_or("文档目录不可用")?;
    let text = files::read_text(&path)?;
    let mut parts = vec![files::hash(&text)];
    let mut assets = vec![];
    let mut seen = HashSet::new();
    let mut total = 0;
    if markdown(&d.path) {
        for relative in image_urls(&text) {
            if !seen.insert(relative.clone()) {
                continue;
            }
            parts.push(relative.clone());
            let joined = directory.join(&relative);
            match joined.canonicalize() {
                Ok(p) if p.starts_with(directory) && p.is_file() => {
                    // A snapshot owns its document's assets. It never writes
                    // through a symlink or copies another document's assets.
                    let safe_relative = p
                        .strip_prefix(directory)
                        .map_err(err)?
                        .to_string_lossy()
                        .to_string();
                    files::validate_relative(&safe_relative)?;
                    let bytes = bounded_asset(&p, &mut total)?;
                    parts.push(files::hash(&bytes));
                    if !assets.iter().any(|(name, _)| name == &safe_relative) {
                        if assets.len() >= 1024 {
                            return Err("本篇图片超过 1024 项，无法建立历史快照".into());
                        }
                        assets.push((safe_relative, bytes));
                    }
                }
                Ok(_) => {
                    return Err(
                        "文档含其他目录的图片，请先复制到本篇附件目录后再使用来源更新与历史恢复"
                            .into(),
                    )
                }
                Err(_) => parts.push("missing-image".into()),
            }
        }
    }
    Ok(Managed {
        path,
        text,
        fingerprint: files::hash(serde_json::to_vec(&parts).map_err(err)?),
        assets,
    })
}
pub(super) fn baseline(
    data: &Path,
    d: &Document,
    current: &Managed,
) -> Result<Option<Baseline>, String> {
    let c = conn(data)?;
    let found = c.query_row("SELECT source_fingerprint,managed_fingerprint,allowed_root,attachments FROM source_baselines WHERE document=?", [&d.id], |r| Ok(Baseline {source_fingerprint:r.get(0)?, managed_fingerprint:r.get(1)?,allowed_root:r.get(2)?,attachments:r.get(3)?})).optional().map_err(err)?;
    if found.is_some() || d.source.is_empty() {
        return Ok(found);
    }
    // Older catalogues do not contain a managed baseline. Recover one only if
    // exact body bytes still equal the original and all copied asset hashes
    // match the saved import fingerprint. Never bless an arbitrary edited copy.
    let (original, imported): (String, String) = c
        .query_row(
            "SELECT original_hash,import_fingerprint FROM documents WHERE id=?",
            [&d.id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(err)?;
    let source = PathBuf::from(&d.source);
    let Some(parent) = source.parent() else {
        return Ok(None);
    };
    let input = Input {
        path: current.path.clone(),
        allowed: current.path.parent().unwrap().to_path_buf(),
    };
    if files::hash(&current.text) == original
        && !imported.is_empty()
        && import_fingerprint(&input, &current.text, &original, true) == imported
    {
        return Ok(Some(Baseline {
            source_fingerprint: imported,
            managed_fingerprint: current.fingerprint.clone(),
            allowed_root: parent.to_string_lossy().into_owned(),
            attachments: true,
        }));
    }
    Ok(None)
}
fn write_baseline(c: &Connection, document: &str, b: &Baseline) -> Result<(), String> {
    c.execute(
        "INSERT OR REPLACE INTO source_baselines VALUES(?,?,?,?,?)",
        params![
            document,
            b.source_fingerprint,
            b.managed_fingerprint,
            b.allowed_root,
            b.attachments
        ],
    )
    .map_err(err)?;
    Ok(())
}
pub(super) fn record_import_baseline(
    data: &Path,
    id: &str,
    allowed: &Path,
    attachments: bool,
) -> Result<(), String> {
    let d = get(data, id)?;
    let current = managed(data, &d)?;
    let c = conn(data)?;
    let source_fingerprint = c
        .query_row(
            "SELECT import_fingerprint FROM documents WHERE id=?",
            [id],
            |r| r.get(0),
        )
        .map_err(err)?;
    write_baseline(
        &c,
        id,
        &Baseline {
            source_fingerprint,
            managed_fingerprint: current.fingerprint,
            allowed_root: allowed.to_string_lossy().into_owned(),
            attachments,
        },
    )
}

fn incoming(data: &Path, d: &Document, b: Option<&Baseline>) -> Result<Incoming, String> {
    if d.source.is_empty() {
        return Err("这是在空间内新建的文档，没有外部原件".into());
    }
    let source = PathBuf::from(&d.source);
    if fs::symlink_metadata(&source)
        .map_err(|_| "原件无法访问，当前副本保持不变")?
        .file_type()
        .is_symlink()
    {
        return Err("来源变为符号链接，未读取原件".into());
    }
    let source = source
        .canonicalize()
        .map_err(|_| "原件无法访问，当前副本保持不变")?;
    let allowed = b
        .map(|b| PathBuf::from(&b.allowed_root))
        .unwrap_or_else(|| source.parent().unwrap().to_path_buf())
        .canonicalize()
        .map_err(|_| "原件允许目录无法访问")?;
    if !source.starts_with(&allowed) {
        return Err("原件已超出导入时的允许目录".into());
    }
    let attachments = b.is_none_or(|b| b.attachments);
    let mut raw = files::read_text(&source)?;
    if raw.starts_with('\u{feff}') {
        raw.remove(0);
    }
    let original_hash = files::hash(&raw);
    let source_fingerprint = import_fingerprint(
        &Input {
            path: source.clone(),
            allowed: allowed.clone(),
        },
        &raw,
        &original_hash,
        attachments,
    );
    let mut assets = vec![];
    let mut warnings = vec![];
    let mut usable = true;
    let mut total = 0;
    let mut prepared = HashMap::<PathBuf, String>::new();
    let resolver = links::LinkResolver::for_source_update(data, d, &managed(data, d)?.text)?;
    let text = if markdown(&d.path) {
        rewrite_links(
            raw,
            |url, image| {
                let (relative, suffix) = local_url(url)?;
                let value = decoded(relative).ok()?;
                let joined = source.parent()?.join(value);
                let resolved = joined.canonicalize();
                if !image && !image_path(&joined) {
                    match resolver.resolve(&joined) {
                        links::Match::Unique(target) => return links::target_url(&target, suffix),
                        links::Match::Ambiguous(_) => {
                            usable = false;
                            warnings.push(format!(
                                "同一来源存在多个空间副本，请先重新关联链接：{relative}"
                            ));
                            return None;
                        }
                        links::Match::Missing => {}
                    }
                }
                if image_path(&joined) && attachments {
                    let path = match resolved {
                        Ok(p) if p.starts_with(&allowed) => p,
                        _ => {
                            usable = false;
                            warnings.push(format!("图片不存在或超出导入范围：{relative}"));
                            return None;
                        }
                    };
                    if let Some(name) = prepared.get(&path) {
                        return Some(format!("{}{}", encoded(name), suffix));
                    }
                    let bytes = match bounded_asset(&path, &mut total) {
                        Ok(bytes) => bytes,
                        Err(e) => {
                            usable = false;
                            warnings.push(e);
                            return None;
                        }
                    };
                    let name = format!(
                        "assets/source-{}-{}",
                        files::hash(&bytes),
                        path.file_name()?.to_string_lossy()
                    );
                    assets.push((name.clone(), bytes));
                    prepared.insert(path, name.clone());
                    return Some(format!("{}{}", encoded(&name), suffix));
                }
                if image || files::supported(&joined) {
                    warnings.push(format!("链接未映射到当前空间，请核对：{relative}"));
                }
                None
            },
            &mut vec![],
        )
    } else {
        raw
    };
    // Do not apply a snapshot whose source changed during attachment collection.
    let mut recheck = files::read_text(&source)?;
    if recheck.starts_with('\u{feff}') {
        recheck.remove(0);
    }
    if import_fingerprint(
        &Input {
            path: source,
            allowed,
        },
        &recheck,
        &files::hash(&recheck),
        attachments,
    ) != source_fingerprint
    {
        return Err("原件正在变化，请稍后重新检查来源更新".into());
    }
    Ok(Incoming {
        text,
        original_hash,
        source_fingerprint,
        assets,
        warnings,
        usable,
    })
}
pub fn check_source_update(data: &Path, id: &str) -> Result<SourceUpdatePreview, String> {
    let d = get(data, id)?;
    let current = managed(data, &d)?;
    let b = baseline(data, &d, &current)?;
    let mut preview = SourceUpdatePreview {
        document_id: d.id.clone(),
        title: d.title.clone(),
        status: "unavailable".into(),
        managed_hash: files::hash(&current.text),
        managed_fingerprint: current.fingerprint.clone(),
        source_fingerprint: None,
        can_update: false,
        can_keep_both: false,
        message: String::new(),
        current_content: current.text,
        source_content: None,
        attachment_changes: vec![],
        warnings: vec![],
    };
    let incoming = match incoming(data, &d, b.as_ref()) {
        Ok(value) => value,
        Err(e) => {
            preview.message = e;
            return Ok(preview);
        }
    };
    preview.source_fingerprint = Some(incoming.source_fingerprint.clone());
    preview.source_content = Some(incoming.text);
    preview.warnings = incoming.warnings;
    if !incoming.usable {
        preview.message = "原件的图片或链接目标未能安全确认，未允许替换当前副本".into();
        return Ok(preview);
    }
    preview.can_keep_both = true;
    let Some(b) = b else {
        preview.status = "baseline-unavailable".into();
        preview.message = "旧导入没有可验证的更新基线；请保留为新副本，避免覆盖已有修改".into();
        return Ok(preview);
    };
    let local_changed = preview.managed_fingerprint != b.managed_fingerprint;
    let source_changed = incoming.source_fingerprint != b.source_fingerprint;
    let (status, message) = match (source_changed, local_changed) {
        (false, false) => ("unchanged", "原件与空间副本都没有变化"),
        (true, false) => (
            "source-changed",
            "原件有更新；确认后更新当前文档，并保存可恢复的旧版本",
        ),
        (false, true) => ("local-changed", "空间副本已修改，原件未变化；保留当前编辑"),
        (true, true) => (
            "conflict",
            "原件和空间副本都已修改；请比较内容或保留两份，不能直接覆盖",
        ),
    };
    preview.status = status.into();
    preview.message = message.into();
    preview.can_update = source_changed && !local_changed;
    let mut old_images = current
        .assets
        .iter()
        .map(|(_, bytes)| files::hash(bytes))
        .collect::<Vec<_>>();
    let mut new_images = incoming
        .assets
        .iter()
        .map(|(_, bytes)| files::hash(bytes))
        .collect::<Vec<_>>();
    old_images.sort();
    new_images.sort();
    if source_changed && old_images != new_images {
        preview.attachment_changes.push(format!(
            "附件内容有变化：当前 {} 项，来源 {} 项；更新前保留当前图片快照",
            old_images.len(),
            new_images.len()
        ));
    }
    Ok(preview)
}

fn history_root(data: &Path, document: &str) -> Result<PathBuf, String> {
    uuid::Uuid::parse_str(document).map_err(|_| "文档标识无效")?;
    let parent = base(data).canonicalize().map_err(err)?;
    let mut path = parent.clone();
    for part in ["history", document] {
        path.push(part);
        if fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err("历史目录不能是符号链接".into());
        }
        fs::create_dir_all(&path).map_err(err)?;
    }
    let path = path.canonicalize().map_err(err)?;
    if !path.starts_with(parent) {
        return Err("历史目录越界".into());
    }
    Ok(path)
}
fn snapshot(data: &Path, d: &Document, current: &Managed, reason: &str) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let root = history_root(data, &d.id)?;
    let stage = root.join(format!(".pending-{id}"));
    let dest = root.join(&id);
    fs::create_dir(&stage).map_err(err)?;
    let result = (|| {
        let mut assets = vec![];
        for (relative, bytes) in &current.assets {
            files::validate_relative(relative)?;
            let target = stage.join(relative);
            fs::create_dir_all(target.parent().unwrap()).map_err(err)?;
            files::write_atomic(&target, bytes)?;
            assets.push(Asset {
                path: relative.clone(),
                hash: files::hash(bytes),
            });
        }
        let record = Snapshot {
            content: current.text.clone(),
            content_hash: files::hash(&current.text),
            assets,
        };
        files::write_atomic(
            &stage.join("snapshot.json"),
            &serde_json::to_vec(&record).map_err(err)?,
        )?;
        fs::rename(&stage, &dest).map_err(err)?;
        conn(data)?
            .execute(
                "INSERT INTO document_history VALUES(?,?,?,?,?,?)",
                params![
                    id,
                    d.id,
                    now(),
                    reason,
                    record.content_hash,
                    record.assets.len()
                ],
            )
            .map_err(err)?;
        Ok(id.clone())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(stage);
    }
    result
}
pub fn history(data: &Path, id: &str) -> Result<Vec<HistoryVersion>, String> {
    get(data, id)?;
    let c = conn(data)?;
    let mut query=c.prepare("SELECT id,created,reason,content_hash,attachment_count FROM document_history WHERE document=? ORDER BY created DESC,rowid DESC").map_err(err)?;
    let records = query
        .query_map([id], |r| {
            Ok(HistoryVersion {
                id: r.get(0)?,
                created: r.get(1)?,
                reason: r.get(2)?,
                content_hash: r.get(3)?,
                attachment_count: r.get(4)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(records)
}
fn finalize(
    c: &mut Connection,
    op: &str,
    d: &Document,
    m: &OperationMetadata,
) -> Result<(), String> {
    let tx = c
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(err)?;
    if let Some(b) = &m.baseline {
        write_baseline(&tx, &d.id, b)?;
    }
    if let (Some(hash), Some(fingerprint)) = (&m.original_hash, &m.import_fingerprint) {
        tx.execute(
            "UPDATE documents SET original_hash=?,import_fingerprint=?,updated=? WHERE id=?",
            params![hash, fingerprint, now(), d.id],
        )
        .map_err(err)?;
    } else {
        tx.execute(
            "UPDATE documents SET updated=? WHERE id=?",
            params![now(), d.id],
        )
        .map_err(err)?;
    }
    tx.execute(
        "UPDATE library_operations SET status='complete' WHERE id=?",
        [op],
    )
    .map_err(err)?;
    tx.commit().map_err(err)
}
fn replace(
    data: &Path,
    d: &Document,
    current: &Managed,
    text: &str,
    assets: &[(String, Vec<u8>)],
    reason: &str,
    metadata: OperationMetadata,
) -> Result<UpdateResult, String> {
    replace_with_guard(data, d, current, text, assets, reason, metadata, || Ok(()))
}
pub(super) fn replace_with_guard(
    data: &Path,
    d: &Document,
    current: &Managed,
    text: &str,
    assets: &[(String, Vec<u8>)],
    reason: &str,
    mut metadata: OperationMetadata,
    guard: impl Fn() -> Result<(), String>,
) -> Result<UpdateResult, String> {
    let before = snapshot(data, d, current, reason)?;
    let directory = current.path.parent().ok_or("文档目录不可用")?;
    for (relative, bytes) in assets {
        files::validate_relative(relative)?;
        let target = directory.join(relative);
        fs::create_dir_all(target.parent().unwrap()).map_err(err)?;
        let parent = target.parent().unwrap().canonicalize().map_err(err)?;
        if !parent.starts_with(directory) {
            return Err("附件目录越界，正文未替换".into());
        }
        // Immutable names include the content hash. A collision with changed
        // bytes is an external conflict, never permission to replace that file.
        if target.exists() {
            if fs::symlink_metadata(&target)
                .map_err(err)?
                .file_type()
                .is_symlink()
                || fs::read(&target).map_err(err)? != *bytes
            {
                return Err("附件发生冲突，正文未替换".into());
            }
        } else {
            files::write_atomic(&target, bytes)?;
        }
    }
    // Recheck after resources are staged. Existing body remains authoritative
    // until this exact expected fingerprint has been verified again.
    if managed(data, d)?.fingerprint != current.fingerprint {
        return Err("CONFLICT:空间副本在预览后变化，请重新检查".into());
    }
    guard()?;
    if let Some(b) = metadata.baseline.as_mut() {
        // Build the post-update baseline with the same fingerprint algorithm.
        let mut projected = vec![files::hash(text)];
        let mut seen = HashSet::new();
        if markdown(&d.path) {
            for relative in image_urls(text) {
                if !seen.insert(relative.clone()) {
                    continue;
                }
                projected.push(relative.clone());
                let p = directory.join(&relative).canonicalize().map_err(err)?;
                if !p.starts_with(directory) {
                    return Err("附件超出本篇目录".into());
                }
                projected.push(files::hash(read_attachment(&p)?));
            }
        }
        b.managed_fingerprint = files::hash(serde_json::to_vec(&projected).map_err(err)?);
    }
    let op = uuid::Uuid::new_v4().to_string();
    let mut c = conn(data)?;
    c.execute(
        "INSERT INTO library_operations VALUES(?,?,?,?,?,'prepared')",
        params![
            op,
            d.id,
            before,
            files::hash(text),
            serde_json::to_string(&metadata).map_err(err)?
        ],
    )
    .map_err(err)?;
    if managed(data, d)?.fingerprint != current.fingerprint {
        let _ = c.execute(
            "UPDATE library_operations SET status='interrupted' WHERE id=?",
            [&op],
        );
        return Err("CONFLICT:写入前空间副本已变化，请重新检查".into());
    }
    guard()?;
    if let Err(e) = files::write_atomic(&current.path, text.as_bytes()) {
        let _ = c.execute(
            "UPDATE library_operations SET status='aborted' WHERE id=?",
            [&op],
        );
        return Err(e);
    }
    let warning = finalize(&mut c, &op, d, &metadata)
        .err()
        .map(|_| "正文与附件已保存；更新元数据将在重启后恢复，请勿重复提交。".into());
    let mut document = d.clone();
    document.updated = now();
    Ok(UpdateResult { document, warning })
}
pub fn apply_source_update(
    data: &Path,
    id: &str,
    expected_managed_fingerprint: &str,
    expected_source_fingerprint: &str,
    keep_both: bool,
) -> Result<UpdateResult, String> {
    let d = get(data, id)?;
    let root = project_root(data, &d.project_id)?;
    let path = files::resolve(&root, &d.path, false)?;
    crate::documents::with_write_lock(&path, || {
        let current = managed(data, &d)?;
        if current.fingerprint != expected_managed_fingerprint {
            return Err("CONFLICT:空间副本在预览后变化，请重新检查".into());
        }
        let b = baseline(data, &d, &current)?;
        let next = incoming(data, &d, b.as_ref())?;
        if next.source_fingerprint != expected_source_fingerprint {
            return Err("CONFLICT:原件在预览后变化，请重新检查".into());
        }
        if !next.usable {
            return Err("原件图片或链接目标未能安全确认，未替换当前副本".into());
        }
        if keep_both {
            return keep_both_copy(data, &d, &next, b.as_ref());
        }
        let mut b = b.ok_or("旧导入没有可验证基线，请保留两份")?;
        if current.fingerprint != b.managed_fingerprint {
            return Err("CONFLICT:空间副本已有本地修改，请比较或保留两份".into());
        }
        if next.source_fingerprint == b.source_fingerprint {
            return Err("原件未变化，无需更新".into());
        }
        b.source_fingerprint = next.source_fingerprint.clone();
        replace(
            data,
            &d,
            &current,
            &next.text,
            &next.assets,
            "来源更新前",
            OperationMetadata {
                baseline: Some(b),
                original_hash: Some(next.original_hash),
                import_fingerprint: Some(next.source_fingerprint),
            },
        )
    })
}
pub fn restore_version(
    data: &Path,
    id: &str,
    version_id: &str,
    expected_managed_fingerprint: &str,
) -> Result<UpdateResult, String> {
    let d = get(data, id)?;
    let root = project_root(data, &d.project_id)?;
    let path = files::resolve(&root, &d.path, false)?;
    crate::documents::with_write_lock(&path, || {
        let current = managed(data, &d)?;
        if current.fingerprint != expected_managed_fingerprint {
            return Err("CONFLICT:空间副本已变化，请重新打开历史记录".into());
        }
        uuid::Uuid::parse_str(version_id).map_err(|_| "历史版本标识无效")?;
        if !history(data, id)?.iter().any(|v| v.id == version_id) {
            return Err("此历史版本不属于当前文档".into());
        }
        let parent = history_root(data, id)?;
        let version = parent.join(version_id).canonicalize().map_err(err)?;
        if !version.starts_with(parent) {
            return Err("历史版本目录越界".into());
        }
        let meta = version.join("snapshot.json").canonicalize().map_err(err)?;
        if !meta.starts_with(&version) {
            return Err("历史元数据路径越界".into());
        }
        if fs::metadata(&meta).map_err(err)?.len() > 10 * 1024 * 1024 {
            return Err("历史记录超过读取限制".into());
        }
        let bytes = fs::read(meta).map_err(err)?;
        let record: Snapshot = serde_json::from_slice(&bytes).map_err(|_| "历史记录损坏")?;
        if record.content.len() as u64 > files::MAX_FILE
            || files::hash(&record.content) != record.content_hash
        {
            return Err("历史正文校验失败，当前文档未变化".into());
        }
        let mut assets = vec![];
        let mut names = HashMap::new();
        let mut total = 0;
        for asset in record.assets {
            files::validate_relative(&asset.path)?;
            let p = version.join(&asset.path).canonicalize().map_err(err)?;
            if !p.starts_with(&version) || !image_path(&p) {
                return Err("历史附件路径无效".into());
            }
            let bytes = bounded_asset(&p, &mut total)?;
            if files::hash(&bytes) != asset.hash {
                return Err("历史附件校验失败，当前文档未变化".into());
            }
            let name = format!(
                "assets/history-{}-{}",
                asset.hash,
                p.file_name().unwrap().to_string_lossy()
            );
            names.insert(asset.path, name.clone());
            assets.push((name, bytes));
        }
        // Restore images under immutable names instead of overwriting a live
        // asset before the body changes. Relative links remain self-contained.
        let text = if markdown(&d.path) {
            rewrite_links(
                record.content,
                |url, _| {
                    let (relative, suffix) = local_url(url)?;
                    let key = normalized_relative(&decoded(relative).ok()?)?;
                    names
                        .get(&key)
                        .map(|name| format!("{}{}", encoded(name), suffix))
                },
                &mut vec![],
            )
        } else {
            record.content
        };
        replace(
            data,
            &d,
            &current,
            &text,
            &assets,
            "恢复历史前",
            OperationMetadata {
                baseline: None,
                original_hash: None,
                import_fingerprint: None,
            },
        )
    })
}
fn normalized_relative(value: &str) -> Option<String> {
    let mut parts = vec![];
    for component in Path::new(value).components() {
        match component {
            std::path::Component::Normal(s) => parts.push(s.to_string_lossy().into_owned()),
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                parts.pop()?;
            }
            _ => return None,
        }
    }
    (!parts.is_empty()).then(|| parts.join("/"))
}
fn keep_both_copy(
    data: &Path,
    d: &Document,
    next: &Incoming,
    b: Option<&Baseline>,
) -> Result<UpdateResult, String> {
    let root = project_root(data, &d.project_id)?;
    let c = conn(data)?;
    let id = uuid::Uuid::new_v4().to_string();
    let name = unique_title(&c, &d.project_id, &d.title);
    let path = format!("documents/{id}/{name}");
    let self_link = format!(
        "../{}",
        d.path.strip_prefix("documents/").ok_or("文档路径无效")?
    );
    let text = if markdown(&d.path) {
        rewrite_links(
            next.text.clone(),
            |url, _| {
                let (relative, suffix) = local_url(url)?;
                (decoded(relative).ok()? == self_link)
                    .then(|| format!("{}{}", encoded(&name), suffix))
            },
            &mut vec![],
        )
    } else {
        next.text.clone()
    };
    let stage = root.join(format!(".pending-{id}"));
    let target = root.join("documents").join(&id);
    c.execute("INSERT INTO documents(id,project,path,title,original_hash,source,updated,status,import_fingerprint) VALUES(?,?,?,?,?,?,?,'pending',?)",params![id,d.project_id,path,name,next.original_hash,d.source,now(),next.source_fingerprint]).map_err(err)?;
    let result = (|| {
        fs::create_dir(&stage).map_err(err)?;
        for (relative, bytes) in &next.assets {
            files::validate_relative(relative)?;
            let asset = stage.join(relative);
            fs::create_dir_all(asset.parent().unwrap()).map_err(err)?;
            files::write_atomic(&asset, bytes)?;
        }
        files::write_atomic(&stage.join(&name), text.as_bytes())?;
        fs::rename(&stage, &target).map_err(err)?;
        c.execute("UPDATE documents SET status='ready' WHERE id=?", [&id])
            .map_err(err)?;
        let allowed = b
            .map(|b| PathBuf::from(&b.allowed_root))
            .unwrap_or_else(|| PathBuf::from(&d.source).parent().unwrap().to_path_buf());
        record_import_baseline(data, &id, &allowed, b.is_none_or(|b| b.attachments))?;
        Ok(UpdateResult {
            document: get(data, &id)?,
            warning: (!next.warnings.is_empty()).then(|| next.warnings.join("\n")),
        })
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(stage);
        let _ = c.execute(
            "DELETE FROM documents WHERE id=? AND status='pending'",
            [&id],
        );
    }
    result
}
pub(super) fn recover_operations(data: &Path) -> Result<Vec<RecoveryItem>, String> {
    let mut c = conn(data)?;
    let pending=c.prepare("SELECT id,document,target_hash,metadata FROM library_operations WHERE status IN ('prepared','needs-review','metadata-pending') ORDER BY rowid").map_err(err)?.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?))).map_err(err)?.collect::<Result<Vec<_>,_>>().map_err(err)?;
    let mut results = vec![];
    for (op, document, target, raw) in pending {
        let mut project = None;
        let result: Result<(&str, bool, String), String> = (|| {
            let d = get(data, &document)?;
            project = Some(d.project_id.clone());
            let root = project_root(data, &d.project_id)?;
            let path = files::resolve(&root, &d.path, false)?;
            crate::documents::with_write_lock(&path, || {
                let hash = files::hash(files::read_text(&path)?);
                // Parse even when body differs: malformed journals are not silently
                // called interrupted or removed. Original raw metadata is retained.
                let metadata: OperationMetadata = serde_json::from_str(&raw)
                    .map_err(|_| "来源更新恢复记录损坏；正文与旧版本保留".to_string())?;
                if hash == target {
                    finalize(&mut c, &op, &d, &metadata).map_err(|e| format!("METADATA:{e}"))?;
                    Ok((
                        "recovered",
                        false,
                        "正文已保存，关系记录已恢复。".to_string(),
                    ))
                } else {
                    c.execute(
                        "UPDATE library_operations SET status='interrupted' WHERE id=?",
                        [&op],
                    )
                    .map_err(err)?;
                    Ok((
                        "interrupted",
                        false,
                        "操作已中断，当前正文保留；未重放旧内容。".to_string(),
                    ))
                }
            })
        })();
        let (status, retryable, message) = match result {
            Ok(result) => result,
            Err(e) => {
                let status = if e.starts_with("METADATA:") {
                    "metadata-pending"
                } else {
                    "needs-review"
                };
                c.execute(
                    "UPDATE library_operations SET status=? WHERE id=?",
                    params![status, op],
                )
                .map_err(err)?;
                (status, true, e.trim_start_matches("METADATA:").to_string())
            }
        };
        results.push(RecoveryItem {
            operation_id: op,
            document_id: Some(document),
            project_id: project,
            kind: "document-update".into(),
            status: status.into(),
            retryable,
            message,
        });
    }
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(markdown: bool) -> (tempfile::TempDir, tempfile::TempDir, PathBuf, Document) {
        let data = tempfile::tempdir().unwrap();
        let source = tempfile::tempdir().unwrap();
        let path = source
            .path()
            .join(if markdown { "资料.md" } else { "资料.txt" });
        fs::write(source.path().join("image.png"), b"old image").unwrap();
        fs::write(
            &path,
            if markdown {
                "# 第一版\n\n![图](./image.png)\n\n正文"
            } else {
                "第一版正文"
            },
        )
        .unwrap();
        let result = import(
            data.path(),
            "inbox",
            &[path.to_string_lossy().into_owned()],
            true,
            true,
            &AtomicBool::new(false),
            |_| {},
        )
        .unwrap();
        assert!(result.warnings.is_empty(), "{:?}", result.warnings);
        let document = get(data.path(), result.items[0].document_id.as_ref().unwrap()).unwrap();
        (data, source, path, document)
    }
    fn apply(data: &Path, id: &str) -> UpdateResult {
        let p = check_source_update(data, id).unwrap();
        assert!(p.can_update, "{} {}", p.status, p.message);
        apply_source_update(
            data,
            id,
            &p.managed_fingerprint,
            p.source_fingerprint.as_deref().unwrap(),
            false,
        )
        .unwrap()
    }
    fn image_bytes(data: &Path, d: &Document) -> Vec<u8> {
        managed(data, d).unwrap().assets[0].1.clone()
    }
    #[test]
    fn source_update_and_history_restore_preserve_identity_and_images() {
        let (data, source, path, d) = fixture(true);
        let original_path = d.path.clone();
        let initial = check_source_update(data.path(), &d.id).unwrap();
        assert_eq!(initial.status, "unchanged");
        fs::write(&path, "# 第二版\n\n![图](image.png)\n\n更多正文").unwrap();
        fs::write(source.path().join("image.png"), b"new image").unwrap();
        let updated = apply(data.path(), &d.id);
        assert_eq!(updated.document.id, d.id);
        assert_eq!(updated.document.path, original_path);
        assert_eq!(image_bytes(data.path(), &d), b"new image");
        assert_eq!(
            check_source_update(data.path(), &d.id).unwrap().status,
            "unchanged"
        );
        let versions = history(data.path(), &d.id).unwrap();
        assert_eq!(versions.len(), 1);
        assert_eq!(versions[0].attachment_count, 1);
        let expected = check_source_update(data.path(), &d.id)
            .unwrap()
            .managed_fingerprint;
        let restored = restore_version(data.path(), &d.id, &versions[0].id, &expected).unwrap();
        assert_eq!(restored.document.id, d.id);
        assert_eq!(restored.document.path, original_path);
        let restored = managed(data.path(), &d).unwrap();
        assert!(restored.text.contains("第一版"));
        assert_eq!(restored.assets[0].1, b"old image");
        assert_eq!(history(data.path(), &d.id).unwrap().len(), 2);
        assert_eq!(
            fs::read(source.path().join("image.png")).unwrap(),
            b"new image"
        );
        assert!(fs::read_to_string(path).unwrap().contains("第二版"));
        assert_eq!(
            check_source_update(data.path(), &d.id).unwrap().status,
            "local-changed"
        );
    }
    #[test]
    fn local_and_source_conflict_cannot_overwrite_but_can_keep_both() {
        let (data, source, path, d) = fixture(true);
        let current = managed(data.path(), &d).unwrap();
        files::write_atomic(
            &current.path,
            format!("{}\n我的修改", current.text).as_bytes(),
        )
        .unwrap();
        fs::write(&path, "# 原件更新\n\n![图](image.png)").unwrap();
        fs::write(source.path().join("image.png"), b"incoming image").unwrap();
        let p = check_source_update(data.path(), &d.id).unwrap();
        assert_eq!(p.status, "conflict");
        assert!(!p.can_update);
        assert!(p.can_keep_both);
        let result = apply_source_update(
            data.path(),
            &d.id,
            &p.managed_fingerprint,
            p.source_fingerprint.as_deref().unwrap(),
            false,
        );
        assert!(result.err().unwrap().contains("CONFLICT"));
        let result = apply_source_update(
            data.path(),
            &d.id,
            &p.managed_fingerprint,
            p.source_fingerprint.as_deref().unwrap(),
            true,
        )
        .unwrap();
        assert_ne!(result.document.id, d.id);
        assert!(result.document.title.contains("副本"));
        assert!(managed(data.path(), &d).unwrap().text.contains("我的修改"));
        assert_eq!(image_bytes(data.path(), &d), b"old image");
        assert_eq!(
            image_bytes(data.path(), &result.document),
            b"incoming image"
        );
        assert_eq!(
            check_source_update(data.path(), &result.document.id)
                .unwrap()
                .status,
            "unchanged"
        );
    }
    #[test]
    fn stale_preview_checks_both_source_and_managed_assets() {
        let (data, source, path, d) = fixture(true);
        fs::write(&path, "# 更新\n\n![图](image.png)").unwrap();
        let p = check_source_update(data.path(), &d.id).unwrap();
        fs::write(
            source.path().join("image.png"),
            b"source changed after preview",
        )
        .unwrap();
        assert!(apply_source_update(
            data.path(),
            &d.id,
            &p.managed_fingerprint,
            p.source_fingerprint.as_deref().unwrap(),
            false
        )
        .err()
        .unwrap()
        .contains("原件在预览后变化"));
        let p = check_source_update(data.path(), &d.id).unwrap();
        let current = managed(data.path(), &d).unwrap();
        fs::write(
            current.path.parent().unwrap().join(&current.assets[0].0),
            b"local changed image",
        )
        .unwrap();
        assert!(apply_source_update(
            data.path(),
            &d.id,
            &p.managed_fingerprint,
            p.source_fingerprint.as_deref().unwrap(),
            true
        )
        .err()
        .unwrap()
        .contains("空间副本在预览后变化"));
        assert_eq!(
            check_source_update(data.path(), &d.id).unwrap().status,
            "conflict"
        );
    }
    #[test]
    fn missing_source_or_image_never_replaces_managed_copy() {
        let (data, source, path, d) = fixture(true);
        let before = managed(data.path(), &d).unwrap().fingerprint;
        fs::remove_file(source.path().join("image.png")).unwrap();
        let p = check_source_update(data.path(), &d.id).unwrap();
        assert!(!p.can_update);
        assert!(!p.can_keep_both);
        assert!(!p.warnings.is_empty());
        fs::remove_file(path).unwrap();
        let p = check_source_update(data.path(), &d.id).unwrap();
        assert_eq!(p.status, "unavailable");
        assert!(p.source_fingerprint.is_none());
        assert_eq!(managed(data.path(), &d).unwrap().fingerprint, before);
    }
    #[test]
    fn attachment_only_change_and_local_asset_change_are_detected() {
        let (data, source, _, d) = fixture(true);
        fs::write(source.path().join("image.png"), b"only new image").unwrap();
        let p = check_source_update(data.path(), &d.id).unwrap();
        assert_eq!(p.status, "source-changed");
        assert!(!p.attachment_changes.is_empty());
        apply(data.path(), &d.id);
        let current = managed(data.path(), &d).unwrap();
        fs::write(
            current.path.parent().unwrap().join(&current.assets[0].0),
            b"locally changed",
        )
        .unwrap();
        assert_eq!(
            check_source_update(data.path(), &d.id).unwrap().status,
            "local-changed"
        );
    }
    #[test]
    fn old_import_with_rewritten_links_is_not_silently_blessed() {
        let (data, _source, path, d) = fixture(true);
        conn(data.path())
            .unwrap()
            .execute("DELETE FROM source_baselines WHERE document=?", [&d.id])
            .unwrap();
        fs::write(path, "# 来源已改变").unwrap();
        let p = check_source_update(data.path(), &d.id).unwrap();
        assert_eq!(p.status, "baseline-unavailable");
        assert!(!p.can_update);
        assert!(p.can_keep_both);
        assert!(apply_source_update(
            data.path(),
            &d.id,
            &p.managed_fingerprint,
            p.source_fingerprint.as_deref().unwrap(),
            false
        )
        .is_err());
    }
    #[test]
    fn old_exact_plain_text_can_recover_a_provable_baseline() {
        let (data, _source, path, d) = fixture(false);
        conn(data.path())
            .unwrap()
            .execute("DELETE FROM source_baselines WHERE document=?", [&d.id])
            .unwrap();
        fs::write(path, "第二版正文").unwrap();
        let updated = apply(data.path(), &d.id);
        assert_eq!(updated.document.id, d.id);
        assert_eq!(managed(data.path(), &d).unwrap().text, "第二版正文");
    }
    #[test]
    fn history_restore_rejects_stale_versions_and_corrupted_image_bytes() {
        let (data, _source, path, d) = fixture(true);
        fs::write(path, "# 第二版").unwrap();
        apply(data.path(), &d.id);
        let h = history(data.path(), &d.id).unwrap();
        let current = managed(data.path(), &d).unwrap();
        assert!(restore_version(data.path(), &d.id, &h[0].id, "stale")
            .err()
            .unwrap()
            .contains("CONFLICT"));
        let version = history_root(data.path(), &d.id).unwrap().join(&h[0].id);
        let record: Snapshot =
            serde_json::from_slice(&fs::read(version.join("snapshot.json")).unwrap()).unwrap();
        fs::write(version.join(&record.assets[0].path), b"corrupted").unwrap();
        assert!(
            restore_version(data.path(), &d.id, &h[0].id, &current.fingerprint)
                .err()
                .unwrap()
                .contains("附件校验失败")
        );
        assert_eq!(
            managed(data.path(), &d).unwrap().fingerprint,
            current.fingerprint
        );
    }
    #[test]
    fn journal_recovers_metadata_after_body_was_atomically_replaced() {
        let (data, _source, path, d) = fixture(false);
        let before = managed(data.path(), &d).unwrap();
        let version = snapshot(data.path(), &d, &before, "更新前").unwrap();
        fs::write(&path, "第二版正文").unwrap();
        let old = baseline(data.path(), &d, &before).unwrap().unwrap();
        let next = incoming(data.path(), &d, Some(&old)).unwrap();
        files::write_atomic(&before.path, next.text.as_bytes()).unwrap();
        let current = managed(data.path(), &d).unwrap();
        let metadata = OperationMetadata {
            baseline: Some(Baseline {
                source_fingerprint: next.source_fingerprint.clone(),
                managed_fingerprint: current.fingerprint,
                allowed_root: old.allowed_root,
                attachments: true,
            }),
            original_hash: Some(next.original_hash),
            import_fingerprint: Some(next.source_fingerprint),
        };
        conn(data.path())
            .unwrap()
            .execute(
                "INSERT INTO library_operations VALUES('interrupted',?,?,?,?, 'prepared')",
                params![
                    d.id,
                    version,
                    files::hash(&next.text),
                    serde_json::to_string(&metadata).unwrap()
                ],
            )
            .unwrap();
        recover(data.path()).unwrap();
        assert_eq!(
            check_source_update(data.path(), &d.id).unwrap().status,
            "unchanged"
        );
        assert_eq!(
            conn(data.path())
                .unwrap()
                .query_row(
                    "SELECT status FROM library_operations WHERE id='interrupted'",
                    [],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
            "complete"
        );
    }
    #[test]
    fn schema_two_migration_backs_up_once_and_space_rename_keeps_paths() {
        let data = tempfile::tempdir().unwrap();
        fs::create_dir_all(base(data.path())).unwrap();
        let raw = Connection::open(base(data.path()).join("catalog.sqlite3")).unwrap();
        raw.pragma_update(None, "user_version", 2).unwrap();
        drop(raw);
        let p = create_project(data.path(), "旧空间").unwrap();
        let d = create_document(data.path(), &p.id, "笔记.md", "正文").unwrap();
        let renamed = rename_project(data.path(), &p.id, "新空间").unwrap();
        assert_eq!(renamed.id, p.id);
        assert_eq!(get(data.path(), &d.id).unwrap().path, d.path);
        assert_eq!(
            conn(data.path())
                .unwrap()
                .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
                .unwrap(),
            4
        );
        assert_eq!(
            fs::read_dir(base(data.path()).join("backups"))
                .unwrap()
                .count(),
            1
        );
    }
    #[test]
    fn missing_history_snapshot_and_immutable_asset_collision_leave_body_unchanged() {
        let (data, _source, path, d) = fixture(true);
        fs::write(&path, "# 新来源\n\n![图](image.png)").unwrap();
        let current = managed(data.path(), &d).unwrap();
        let b = baseline(data.path(), &d, &current).unwrap();
        let next = incoming(data.path(), &d, b.as_ref()).unwrap();
        let collision = current.path.parent().unwrap().join(&next.assets[0].0);
        fs::write(&collision, b"unexpected existing bytes").unwrap();
        let preview = check_source_update(data.path(), &d.id).unwrap();
        assert!(apply_source_update(
            data.path(),
            &d.id,
            &preview.managed_fingerprint,
            preview.source_fingerprint.as_deref().unwrap(),
            false
        )
        .err()
        .unwrap()
        .contains("附件发生冲突"));
        assert_eq!(managed(data.path(), &d).unwrap().text, current.text);
        let version = history(data.path(), &d.id).unwrap()[0].id.clone();
        fs::remove_file(
            history_root(data.path(), &d.id)
                .unwrap()
                .join(&version)
                .join("snapshot.json"),
        )
        .unwrap();
        assert!(restore_version(data.path(), &d.id, &version, &current.fingerprint).is_err());
        assert_eq!(managed(data.path(), &d).unwrap().text, current.text);
    }
    #[test]
    fn incomplete_journal_before_body_write_never_replays_or_overwrites() {
        let (data, _source, _path, d) = fixture(false);
        let before = managed(data.path(), &d).unwrap();
        let version = snapshot(data.path(), &d, &before, "中断前").unwrap();
        let raw = serde_json::to_string(&OperationMetadata {
            baseline: None,
            original_hash: Some("new".into()),
            import_fingerprint: Some("new".into()),
        })
        .unwrap();
        conn(data.path())
            .unwrap()
            .execute(
                "INSERT INTO library_operations VALUES('before-write',?,?,?,?, 'prepared')",
                params![d.id, version, files::hash("尚未写入的正文"), raw],
            )
            .unwrap();
        recover(data.path()).unwrap();
        assert_eq!(managed(data.path(), &d).unwrap().text, before.text);
        assert_eq!(
            conn(data.path())
                .unwrap()
                .query_row(
                    "SELECT status FROM library_operations WHERE id='before-write'",
                    [],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
            "interrupted"
        );
    }
    #[cfg(unix)]
    #[test]
    fn symlinked_document_and_history_metadata_are_rejected() {
        use std::os::unix::fs::symlink;
        let (data, _source, path, d) = fixture(false);
        let current = managed(data.path(), &d).unwrap();
        let version = snapshot(data.path(), &d, &current, "旧版本").unwrap();
        let metadata = history_root(data.path(), &d.id)
            .unwrap()
            .join(&version)
            .join("snapshot.json");
        fs::remove_file(&metadata).unwrap();
        symlink(&path, &metadata).unwrap();
        assert!(
            restore_version(data.path(), &d.id, &version, &current.fingerprint)
                .err()
                .unwrap()
                .contains("元数据路径越界")
        );
        fs::remove_file(&current.path).unwrap();
        symlink(&path, &current.path).unwrap();
        assert!(check_source_update(data.path(), &d.id)
            .err()
            .unwrap()
            .contains("不能是符号链接"));
    }
    #[test]
    fn source_image_outside_explicit_import_scope_is_not_copied() {
        let (data, _source, path, d) = fixture(true);
        let outside = tempfile::tempdir().unwrap();
        fs::write(
            outside.path().join("private.png"),
            b"not in imported directory",
        )
        .unwrap();
        fs::write(
            &path,
            format!(
                "# 新内容\n\n![图]({})",
                outside.path().join("private.png").display()
            ),
        )
        .unwrap();
        // An absolute link remains literal and is never read as an imported asset.
        let current = managed(data.path(), &d).unwrap();
        let b = baseline(data.path(), &d, &current).unwrap();
        let next = incoming(data.path(), &d, b.as_ref()).unwrap();
        assert!(next.assets.is_empty());
        // A relative traversal to an existing image outside the allow-root is blocked.
        let relative = format!(
            "../{}/private.png",
            outside.path().file_name().unwrap().to_string_lossy()
        );
        fs::write(&path, format!("# 新内容\n\n![图]({relative})")).unwrap();
        let p = check_source_update(data.path(), &d.id).unwrap();
        assert!(!p.can_update);
        assert!(!p.can_keep_both);
        assert_eq!(
            managed(data.path(), &d).unwrap().fingerprint,
            current.fingerprint
        );
    }
}
