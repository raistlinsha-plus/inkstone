//! Canonical asset names inside a managed photo, including photos from older exports.
use super::{decoded, err, local_url, Event, Parser, Path, PathBuf, Tag};
use std::fs;

pub(super) const MARKER: &str = "<!-- inkstone-image:v1 -->";

pub(crate) fn is_sidecar(text: &str) -> bool {
    text.trim_start_matches('\u{feff}')
        .lines()
        .next()
        .is_some_and(|s| s.trim() == MARKER)
}

pub(super) struct Asset {
    pub path: PathBuf,
    pub name: String,
}

pub(super) fn read(sidecar: &Path, allowed: &Path, text: &str) -> Result<Vec<Asset>, String> {
    let mut assets = Vec::<Asset>::new();
    if !is_sidecar(text) {
        return Ok(assets);
    }
    for event in Parser::new(text) {
        let (url, is_image) = match event {
            Event::Start(Tag::Image { dest_url, .. }) => (dest_url, true),
            Event::Start(Tag::Link { dest_url, .. }) => (dest_url, false),
            _ => continue,
        };
        let Some((url, _)) = local_url(&url) else {
            continue;
        };
        let relative = decoded(url)?;
        let filename = Path::new(&relative)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");
        let name = crate::media::asset_name(filename).to_ascii_lowercase();
        if !(is_image && name == "preview.jpg"
            || !is_image
                && name.starts_with("original.")
                && crate::media::supported(Path::new(&name)))
        {
            continue;
        }
        let path = sidecar
            .parent()
            .ok_or("无效图片资料路径")?
            .join(relative)
            .canonicalize()
            .map_err(|_| format!("图片资料缺少 {name}，请重新导入原件"))?;
        if !path.starts_with(allowed) || !path.is_file() {
            return Err(format!("图片资源超出目录范围：{name}"));
        }
        crate::files::require_document_path(&path)?;
        if fs::metadata(&path).map_err(err)?.len() > 64 * 1024 * 1024 {
            return Err(format!("图片资源超过 64 MB：{name}"));
        }
        if !assets.iter().any(|a| a.path == path && a.name == name) {
            assets.push(Asset { path, name });
        }
    }
    if assets.len() != 2
        || !assets.iter().any(|a| a.name == "preview.jpg")
        || !assets.iter().any(|a| a.name.starts_with("original."))
    {
        return Err("图片资料缺少可用的原件或预览，请从原图重新导入".into());
    }
    Ok(assets)
}
