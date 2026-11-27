use crate::{documents, library, AppState};
use std::{fs, path::Path};
use tauri::State;
#[cfg(all(test, target_os = "macos"))]
std::thread_local! { static OCR_CALLS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) }; }
#[cfg(target_os = "macos")]
fn decode(src: &Path, preview: &Path, recognize: bool) -> Result<String, String> {
    use std::{
        ffi::{CStr, CString},
        os::unix::ffi::OsStrExt,
    };
    extern "C" {
        fn inkstone_decode(src: *const i8, preview: *const i8, recognize: i32) -> *mut i8;
        fn inkstone_free(p: *mut i8);
    }
    let path = |p: &Path| CString::new(p.as_os_str().as_bytes()).map_err(|e| e.to_string());
    let src = path(src)?;
    let preview = path(preview)?;
    #[cfg(test)]
    if recognize {
        OCR_CALLS.set(OCR_CALLS.get() + 1);
    }
    let result = unsafe { inkstone_decode(src.as_ptr(), preview.as_ptr(), i32::from(recognize)) };
    if result.is_null() {
        return Err("系统无法解码这张图片".into());
    }
    let text = unsafe { CStr::from_ptr(result) }
        .to_string_lossy()
        .into_owned();
    unsafe { inkstone_free(result) };
    Ok(text)
}
#[cfg(not(target_os = "macos"))]
fn decode(_: &Path, _: &Path, _: bool) -> Result<String, String> {
    Err("需要 macOS 图片解码服务".into())
}

pub(crate) fn import_into_folder(
    data: &Path,
    project: &str,
    source: &Path,
    skip: bool,
    folder: &str,
) -> Result<ImageImportResult, String> {
    let err = |e: std::io::Error| e.to_string();
    checked_source(source)?;
    let ext = source
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let root = library::project_root(data, project)?;
    let tmp = root.join(format!(".pending-media-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&tmp).map_err(err)?;
    let result = (|| {
        let original = tmp.join(format!("original.{ext}"));
        fs::copy(source, &original).map_err(err)?;
        let fingerprint = image_fingerprint(&original)?;
        if skip {
            let existing = documents::with_write_lock(&root, || {
                let mut db = library::conn(data)?;
                let tx = db.transaction().map_err(|e| e.to_string())?;
                crate::organization::check_destination(&tx, project, folder)?;
                let matched = library::existing_image(&tx, &root, project, &fingerprint, true)?;
                Ok(matched.map(|document| {
                    let location = crate::organization::document_folder(&tx, project, &document.id);
                    ImageImportResult::existing(document, location)
                }))
            })?;
            if let Some(existing) = existing {
                return Ok(existing);
            }
        }
        let text = decode(&original, &tmp.join("preview.jpg"), true)?;
        let name = source
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or("无效图片名称")?;
        let body=format!("<!-- inkstone-image:v1 -->\n# {name}\n\n![图片](assets/preview.jpg)\n\n[原始图片](assets/original.{ext})\n\n## 图中文字\n\n{text}\n");
        // OCR can run concurrently. Serialize the short catalog / asset publication so
        // another import in this space observes the completed document and its location.
        let (document, created) = documents::with_write_lock(&root, || {
            library::create_with_assets(
                data,
                project,
                &format!("{name}.md"),
                &body,
                None,
                Some((&tmp, &fingerprint, skip)),
                folder,
            )
        })?;
        if !created {
            let location = library::conn(data)
                .and_then(|db| crate::organization::document_folder(&db, project, &document.id));
            return Ok(ImageImportResult::existing(document, location));
        }
        let index = documents::library_workspace(data, project)
            .and_then(|ws| documents::refresh_local(&ws, data, &document.path, &body));
        Ok(ImageImportResult {
            document,
            existing: false,
            actual_folder: Some(folder.to_owned()),
            warning: index
                .err()
                .map(|e| format!("图片已保存，本地索引待更新。{e}")),
        })
    })();
    if tmp.exists() {
        let _ = fs::remove_dir_all(tmp);
    }
    result
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageImportResult {
    pub(crate) document: library::Document,
    pub(crate) existing: bool,
    actual_folder: Option<String>,
    pub(crate) warning: Option<String>,
}

impl ImageImportResult {
    fn existing(document: library::Document, location: Result<String, String>) -> Self {
        let (actual_folder, warning) = match location {
            Ok(folder) => (Some(folder), None),
            Err(e) => (
                None,
                Some(format!("图片已在空间中，暂时无法读取其目录。{e}")),
            ),
        };
        Self {
            document,
            existing: true,
            actual_folder,
            warning,
        }
    }
}

#[tauri::command]
pub async fn media_import(
    state: State<'_, AppState>,
    project_id: String,
    path: String,
    folder: Option<String>,
) -> Result<ImageImportResult, String> {
    let data = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = crate::maintenance::mutation(&data)?;
        import_into_folder(
            &data,
            &project_id,
            Path::new(&path),
            true,
            folder.as_deref().unwrap_or(""),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn media_describe(
    state: State<'_, AppState>,
    document_id: String,
    question: String,
    model: String,
) -> Result<String, String> {
    use base64::Engine;
    let d = library::get(&state.data_dir, &document_id)?;
    if d.status != "ready" {
        return Err("图片不可用".into());
    }
    let root = library::project_root(&state.data_dir, &d.project_id)?;
    let doc = crate::files::resolve(&root, &d.path, false)?;
    let src = stored_asset(&doc, true)?;
    if fs::metadata(&src).map_err(|e| e.to_string())?.len() > 8 * 1024 * 1024 {
        return Err("图片无法用于视觉问答".into());
    }
    if question.len() > 8000 {
        return Err("问题过长".into());
    }
    let mut p = crate::settings(&state)?.chat;
    if !model.trim().is_empty() {
        p.model = model.trim().into()
    }
    let key = crate::local_key(&state, "chat", &p.base_url)?;
    let img =
        base64::engine::general_purpose::STANDARD.encode(fs::read(src).map_err(|e| e.to_string())?);
    let body = serde_json::json!({"model":p.model,"messages":[{"role":"user","content":[{"type":"text","text":question},{"type":"image_url","image_url":{"url":format!("data:image/jpeg;base64,{img}")}}]}]});
    let cancel = std::sync::atomic::AtomicBool::new(false);
    let res = crate::providers::request(
        &state.client,
        &p,
        key.as_deref(),
        "chat/completions",
        body,
        &cancel,
        1,
    )
    .await?;
    let value = crate::providers::bounded_json(res, 512 * 1024, &cancel).await?;
    value["choices"][0]["message"]["content"]
        .as_str()
        .filter(|v| !v.trim().is_empty())
        .map(String::from)
        .ok_or("模型未返回描述".into())
}
#[tauri::command]
pub async fn media_generate(
    state: State<'_, AppState>,
    project_id: String,
    title: String,
    model: String,
    prompt: String,
    folder: Option<String>,
) -> Result<library::Document, String> {
    use base64::Engine;
    let name = title.trim();
    if name.is_empty()
        || name.len() > 140
        || name.contains(['/', '\\', '\0'])
        || name.starts_with('.')
        || prompt.trim().is_empty()
        || prompt.len() > 12000
        || model.trim().is_empty()
    {
        return Err("请输入有效的图片名称、提示词和模型 ID".into());
    }
    let root = library::project_root(&state.data_dir, &project_id)?;
    let folder = folder.unwrap_or_default();
    crate::organization::check_destination(&library::conn(&state.data_dir)?, &project_id, &folder)?;
    let mut p = crate::settings(&state)?.chat;
    p.model = model.trim().into();
    let key = crate::local_key(&state, "chat", &p.base_url)?;
    let cancel = std::sync::atomic::AtomicBool::new(false);
    let body =
        serde_json::json!({"model":p.model,"prompt":prompt,"n":1,"response_format":"b64_json"});
    let res = crate::providers::request(
        &state.client,
        &p,
        key.as_deref(),
        "images/generations",
        body,
        &cancel,
        1,
    )
    .await?;
    let value = crate::providers::bounded_json(res, 32 * 1024 * 1024, &cancel).await?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(
            value["data"][0]["b64_json"]
                .as_str()
                .ok_or("服务需返回 b64_json 图片")?,
        )
        .map_err(|_| "图片数据无效")?;
    let ext = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        "png"
    } else if bytes.starts_with(&[255, 216, 255]) {
        "jpg"
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        "webp"
    } else {
        return Err("生图响应格式不支持".into());
    };
    let name = format!("{name}.{ext}");
    let data = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = crate::maintenance::mutation(&data)?;
        let tmp = root.join(format!(".pending-generation-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&tmp).map_err(|e| e.to_string())?;
        let path = tmp.join(name);
        let result = fs::write(&path, bytes)
            .map_err(|e| e.to_string())
            .and_then(|_| {
                import_into_folder(&data, &project_id, &path, false, &folder).map(|r| r.document)
            });
        let _ = fs::remove_dir_all(tmp);
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

pub(crate) fn supported(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "jpg" | "jpeg" | "png" | "heic" | "heif" | "webp" | "gif"
    )
}
pub(crate) fn image_fingerprint(path: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    checked_source(path)?;
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let limit = 64 * 1024 * 1024;
    let mut digest = Sha256::new();
    let size = std::io::copy(&mut file.take(limit + 1), &mut digest).map_err(|e| e.to_string())?;
    if size > limit {
        return Err("图片超过 64 MB".into());
    }
    Ok(format!("image:{:x}", digest.finalize()))
}

fn checked_source(path: &Path) -> Result<(), String> {
    let canonical = path.canonicalize().map_err(|e| e.to_string())?;
    crate::files::require_document_path(&canonical)?;
    let meta = path.symlink_metadata().map_err(|e| e.to_string())?;
    if !supported(path) || !meta.is_file() || meta.len() > 64 * 1024 * 1024 {
        return Err("请选择 64 MB 以内的图片文件".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn media_preview(path: String) -> Result<String, String> {
    use base64::Engine;
    tauri::async_runtime::spawn_blocking(move || {
        let source = Path::new(&path);
        checked_source(source)?;
        let temp = tempfile::tempdir().map_err(|e| e.to_string())?;
        let preview = temp.path().join("preview.jpg");
        decode(source, &preview, false)?;
        let bytes = fs::read(preview).map_err(|e| e.to_string())?;
        Ok(format!(
            "data:image/jpeg;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Older photo packages were copied through the generic Markdown importer,
/// which prefixed local asset names with one or more path hashes.
pub(crate) fn stored_asset(document: &Path, preview: bool) -> Result<std::path::PathBuf, String> {
    let dir = document.parent().ok_or("无效图片目录")?;
    let assets = dir
        .join("assets")
        .canonicalize()
        .map_err(|_| "图片附件不存在")?;
    if !assets.starts_with(dir) {
        return Err("图片目录无效".into());
    }
    let mut matches = Vec::new();
    for entry in fs::read_dir(&assets).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().is_ok_and(|v| v.is_file()) {
            continue;
        }
        let filename = entry.file_name();
        let Some(name) = filename.to_str() else {
            continue;
        };
        let canonical = asset_name(name);
        if (preview && canonical == "preview.jpg")
            || (!preview && canonical.starts_with("original.") && supported(Path::new(canonical)))
        {
            let path = entry.path();
            checked_source(&path)?;
            if name == canonical {
                return Ok(path);
            }
            matches.push(path);
        }
    }
    if matches.len() == 1 {
        return Ok(matches.remove(0));
    }
    Err("无法确定图片附件，请重新导入原图".into())
}

pub(crate) fn asset_name(mut name: &str) -> &str {
    while let Some((hash, tail)) = name.split_once('-') {
        if hash.len() != 12 || !hash.bytes().all(|c| c.is_ascii_hexdigit()) {
            break;
        }
        name = tail;
    }
    name
}

#[tauri::command]
pub async fn media_export_original(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    document_id: String,
) -> Result<(), String> {
    let doc = library::get(&state.data_dir, &document_id)?;
    if doc.status != "ready" {
        return Err("图片不可用".into());
    }
    let root = library::project_root(&state.data_dir, &doc.project_id)?;
    let path = crate::files::resolve(&root, &doc.path, false)?;
    let original = stored_asset(&path, false)?;
    let ext = original
        .extension()
        .and_then(|s| s.to_str())
        .ok_or("无效图片格式")?;
    let name = doc.title.trim_end_matches(".md");
    let name = if name.to_lowercase().ends_with(&format!(".{ext}")) {
        name.to_owned()
    } else {
        format!("{name}.{ext}")
    };
    if let Some(dest) = crate::export_destination::choose(&app, &name, "Image", ext).await? {
        crate::files::require_document_path(&dest)?;
        crate::files::write_atomic_from(
            &dest,
            fs::File::open(original).map_err(|e| e.to_string())?,
        )?;
    }
    Ok(())
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    #[test]
    fn saved_visual_description_is_retrievable_at_the_original_photo() {
        let data = tempfile::tempdir().unwrap();
        let fixture = Path::new(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/native/fixtures/media-board.png"
        ));
        let added = import_into_folder(data.path(), "inbox", fixture, true, "").unwrap();
        let path = &added.document.path;
        let ws = documents::library_workspace(data.path(), "inbox").unwrap();
        let source = fs::read_to_string(ws.root.join(path)).unwrap();
        let description = "quartzfalcon";
        let db = crate::db::open(&ws.db).unwrap();
        assert!(crate::db::lexical(&db, description, None).is_empty());
        let edited = format!("{source}\n\n## 模型描述\n\n{description}\n");
        let receipt = documents::save(
            &ws,
            data.path(),
            path,
            &edited,
            &crate::files::hash(&source),
        )
        .unwrap();
        let hits = crate::db::merge(&db, &ws, &[crate::db::lexical(&db, description, None)]);
        let hit = hits
            .iter()
            .find(|r| r.path == *path && r.text.contains(description))
            .unwrap();
        assert_eq!(hit.hash, receipt.hash);
        assert!(edited
            .lines()
            .skip(hit.start_line - 1)
            .take(hit.end_line - hit.start_line + 1)
            .any(|line| line == description));
    }

    #[test]
    fn portable_gallery_preserves_originals_descriptions_and_note_links() {
        let data = tempfile::tempdir().unwrap();
        let sources = tempfile::tempdir().unwrap();
        let root = sources.path();
        let fixture = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/native/fixtures/media-board.png"
        );
        fs::copy(fixture, root.join("Board.png")).unwrap();
        for (name, format) in [("Board.heic", "heic"), ("Board.jpeg", "jpeg")] {
            assert!(std::process::Command::new("/usr/bin/sips")
                .args(["-s", "format", format, fixture, "--out"])
                .arg(root.join(name))
                .output()
                .unwrap()
                .status
                .success());
        }
        fs::copy(root.join("Board.heic"), root.join("Board.heif")).unwrap();
        let originals: std::collections::HashMap<_, _> = ["heic", "heif", "jpeg", "png"]
            .into_iter()
            .map(|ext| (ext, fs::read(root.join(format!("Board.{ext}"))).unwrap()))
            .collect();
        // HEIC and HEIF contain identical source bytes and were explicitly requested as separate documents.
        let ingest = |path: &Path, dest: &Path, skip: bool| {
            let imported = library::import(
                dest,
                "inbox",
                &[path.display().to_string()],
                skip,
                false,
                &std::sync::atomic::AtomicBool::new(false),
                |_| {},
            )
            .unwrap();
            assert!(
                imported.items.iter().all(|i| i.status == "imported"),
                "{:?}",
                imported
                    .items
                    .iter()
                    .map(|i| &i.message)
                    .collect::<Vec<_>>()
            );
            imported
        };
        let imported = ingest(root, data.path(), false);
        assert_eq!(imported.items.len(), 4);
        let library_root = library::project_root(data.path(), "inbox").unwrap();
        let mut refs = String::new();
        for item in imported.items {
            let d = library::get(data.path(), item.document_id.as_ref().unwrap()).unwrap();
            let md = library_root.join(&d.path);
            let mut body = fs::read_to_string(&md).unwrap();
            body.push_str("\n## 校订说明\n\n白板记录了一次评审。\n");
            fs::write(md, body).unwrap();
            refs.push_str(&format!("[{}](../{}/{})\n", d.title, d.id, d.title));
        }
        library::create_document(data.path(), "inbox", "Notes.md", &refs).unwrap();
        let dest = tempfile::tempdir().unwrap();
        let zip = dest.path().join("photos.zip");
        library::export_bundle(data.path(), "inbox", None, &zip).unwrap();
        let mut archive = zip::ZipArchive::new(fs::File::open(zip).unwrap()).unwrap();
        archive.extract(dest.path()).unwrap();
        let empty = tempfile::tempdir().unwrap();
        let restored = ingest(&dest.path().join("Inkstone文档"), empty.path(), true);
        assert_eq!(restored.items.len(), 5);
        let root = library::project_root(empty.path(), "inbox").unwrap();
        let docs = library::list(empty.path()).unwrap().documents;
        let notes = docs.iter().find(|d| d.title == "Notes.md").unwrap();
        let references = fs::read_to_string(root.join(&notes.path)).unwrap();
        for d in docs.iter().filter(|d| d.id != notes.id) {
            let path = root.join(&d.path);
            let original = stored_asset(&path, false).unwrap();
            let ext = original.extension().unwrap().to_str().unwrap();
            assert_eq!(fs::read(&original).unwrap(), originals[ext]);
            assert!(fs::read(stored_asset(&path, true).unwrap())
                .unwrap()
                .starts_with(&[255, 216, 255]));
            let body = fs::read_to_string(&path).unwrap();
            assert!(
                body.contains("RESEARCH") && body.contains("白板记录了一次评审。"),
                "{body}"
            );
            assert!(
                percent_encoding::percent_decode_str(&references)
                    .decode_utf8()
                    .unwrap()
                    .contains(&d.id),
                "{references}"
            );
            assert!(
                import_into_folder(empty.path(), "inbox", &original, true, "")
                    .unwrap()
                    .existing
            );
        }
    }
    #[test]
    fn concurrent_image_adds_share_location_and_keep_receipt_if_indexing_fails() {
        let data = tempfile::tempdir().unwrap();
        let path = data.path();
        let source = Path::new(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/native/fixtures/media-board.png"
        ));
        let ws = documents::library_workspace(path, "inbox").unwrap();
        fs::create_dir(&ws.db).unwrap(); // deterministic index-open failure after publication
        library::conn(path)
            .unwrap()
            .execute(
                "INSERT INTO preferences(key,value) VALUES('workspace.layout.v1:inbox',?)",
                [r#"{"folders":["A","B"]}"#],
            )
            .unwrap();
        let start = std::sync::Barrier::new(4);
        let results = std::thread::scope(|scope| {
            let handles: Vec<_> = ["A", "B", "A", "B"]
                .into_iter()
                .map(|folder| {
                    let start = &start;
                    scope.spawn(move || {
                        start.wait();
                        import_into_folder(path, "inbox", source, true, folder).unwrap()
                    })
                })
                .collect();
            handles
                .into_iter()
                .map(|h| h.join().unwrap())
                .collect::<Vec<_>>()
        });
        assert_eq!(results.iter().filter(|r| !r.existing).count(), 1);
        let saved = results.iter().find(|r| !r.existing).unwrap();
        assert!(saved.warning.as_deref().unwrap().contains("索引"));
        assert!(matches!(saved.actual_folder.as_deref(), Some("A" | "B")));
        assert!(ws.root.join(&saved.document.path).is_file());
        for result in &results {
            assert_eq!(result.document.id, saved.document.id);
            assert_eq!(result.actual_folder, saved.actual_folder);
        }
        assert_eq!(library::list(path).unwrap().documents.len(), 1);
    }

    #[test]
    fn pending_image_is_not_reported_ready_or_duplicated_and_explicit_copies_remain_allowed() {
        let data = tempfile::tempdir().unwrap();
        let path = data.path();
        let source = Path::new(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/native/fixtures/media-board.png"
        ));
        let add = |skip| import_into_folder(path, "inbox", source, skip, "");
        let first = add(true).unwrap();
        library::conn(path)
            .unwrap()
            .execute(
                "UPDATE documents SET status='pending' WHERE id=?",
                [&first.document.id],
            )
            .unwrap();
        assert!(add(true).err().unwrap().contains("正在保存"));
        let copies: usize = library::conn(path)
            .unwrap()
            .query_row("SELECT COUNT(*) FROM documents", [], |r| r.get(0))
            .unwrap();
        assert_eq!(copies, 1);
        let copy = add(false).unwrap();
        assert!(!copy.existing);
        assert_ne!(copy.document.id, first.document.id);
        let repeat = add(true).unwrap();
        assert!(repeat.existing);
        assert_eq!(repeat.document.id, copy.document.id);
    }

    #[test]
    fn heic_original_preview_ocr_and_repeat_import() {
        let data = tempfile::tempdir().unwrap();
        let sources = tempfile::tempdir().unwrap();
        let heic = sources.path().join("Board.HEIC");
        assert!(std::process::Command::new("/usr/bin/sips")
            .args(["-s", "format", "heic"])
            .arg(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/native/fixtures/media-board.png"
            ))
            .arg("--out")
            .arg(&heic)
            .output()
            .unwrap()
            .status
            .success());
        let run = || {
            library::import(
                data.path(),
                "inbox",
                &[heic.display().to_string()],
                true,
                true,
                &std::sync::atomic::AtomicBool::new(false),
                |_| {},
            )
            .unwrap()
        };
        let first = run();
        assert_eq!(
            first.items[0].status, "imported",
            "{}",
            first.items[0].message
        );
        let doc = library::get(data.path(), first.items[0].document_id.as_ref().unwrap()).unwrap();
        let file = library::project_root(data.path(), "inbox")
            .unwrap()
            .join(doc.path);
        let assets = file.parent().unwrap().join("assets");
        assert_eq!(
            fs::read(assets.join("original.heic")).unwrap(),
            fs::read(&heic).unwrap()
        );
        assert!(fs::read(assets.join("preview.jpg"))
            .unwrap()
            .starts_with(&[255, 216, 255]));
        let body = fs::read_to_string(file).unwrap();
        assert!(body.contains("RESEARCH"), "{body}");
        assert_eq!(OCR_CALLS.get(), 1);
        let second = run();
        assert_eq!(
            OCR_CALLS.get(),
            1,
            "an existing original must skip native OCR"
        );
        assert_eq!(second.items[0].status, "skipped");
        assert!(import_into_folder(data.path(), "inbox", &heic, true, "missing-folder").is_err());
        assert_eq!(
            OCR_CALLS.get(),
            1,
            "invalid destinations must not disclose a match"
        );
        assert_eq!(second.items[0].document_id, first.items[0].document_id);
    }
}
