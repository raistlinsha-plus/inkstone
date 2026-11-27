//! A chat turn refers to the catalog image by ID. Only an explicit, fresh
//! confirmation allows pixels to leave the computer.
use crate::{files, library, media, AppState};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::{io::Read, path::Path};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ImageMode {
    Ocr,
    Description,
    Vision,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImageSelection {
    pub document_id: String,
    pub mode: ImageMode,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VisionConsent {
    pub document_id: String,
    pub base_url: String,
    pub model: String,
    pub preview_hash: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImagePreview {
    pub hash: String,
    pub url: String,
    preview_error: Option<String>,
    has_ocr: bool,
    has_description: bool,
}

pub fn preview(data: &Path, project: &str, id: &str) -> Result<ImagePreview, String> {
    let doc = library::get(data, id)?;
    if doc.status != "ready" || doc.project_id != project {
        return Err("所选图片已移除或不在当前空间".into());
    }
    let root = library::project_root(data, project)?;
    let path = files::resolve(&root, &doc.path, false)?;
    let content = files::read_text(&path)?;
    if content.lines().next() != Some("<!-- inkstone-image:v1 -->") {
        return Err("所选资料并非 Inkstone 图片".into());
    }
    let (hash, url, preview_error) = match jpeg_preview(&path) {
        Ok((hash, url)) => (hash, url, None),
        Err(error) => (String::new(), String::new(), Some(error)),
    };
    Ok(ImagePreview {
        hash,
        url,
        preview_error,
        has_ocr: section(&content, ImageMode::Ocr).is_ok(),
        has_description: section(&content, ImageMode::Description).is_ok(),
    })
}

fn jpeg_preview(document: &Path) -> Result<(String, String), String> {
    let path = media::stored_asset(document, true)?;
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .and_then(|f| f.take(8 * 1024 * 1024 + 1).read_to_end(&mut bytes))
        .map_err(|e| e.to_string())?;
    if bytes.len() > 8 * 1024 * 1024 || !bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return Err("图片预览不可用或过大".into());
    }
    Ok((
        files::hash(&bytes),
        format!(
            "data:image/jpeg;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ),
    ))
}

// Both image entry points send the very bytes checked here.
pub fn confirmed_pixels(
    data: &Path,
    project: &str,
    document_id: &str,
    provider: &crate::models::Provider,
    consent: &VisionConsent,
) -> Result<String, String> {
    if !provider.enabled
        || provider.base_url != consent.base_url
        || provider.model != consent.model
        || consent.model.trim().is_empty()
        || consent.model.len() > 256
        || consent.document_id != document_id
    {
        return Err("图片或目标模型已变化，请重新确认后发送".into());
    }
    let image = preview(data, project, document_id)?;
    if image.preview_error.is_some() || image.hash.is_empty() || image.hash != consent.preview_hash
    {
        return Err("图片已变化，请重新核对后发送".into());
    }
    Ok(image.url)
}

#[tauri::command]
pub async fn assistant_image_preview(
    state: tauri::State<'_, AppState>,
    project_id: String,
    document_id: String,
) -> Result<ImagePreview, String> {
    let data = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || preview(&data, &project_id, &document_id))
        .await
        .map_err(|e| e.to_string())?
}

// Slices retain line offsets into the backing Markdown so a citation can open
// the original image. OCR and reviewed descriptions have distinct boundaries.
pub fn section(content: &str, mode: ImageMode) -> Result<(String, usize), String> {
    if content.lines().next() != Some("<!-- inkstone-image:v1 -->") {
        return Err("所选文件不是受管理的图片".into());
    }
    let lines: Vec<&str> = content.lines().collect();
    if mode == ImageMode::Vision {
        let at = lines
            .iter()
            .take_while(|line| !line.starts_with("## "))
            .position(|line| {
                // Exports URL-encode dots and may prefix asset names with a digest.
                let Some((_, target)) = line
                    .trim()
                    .strip_prefix("![")
                    .and_then(|line| line.split_once("]("))
                else {
                    return false;
                };
                let Some(target) = target.strip_suffix(')') else {
                    return false;
                };
                percent_encoding::percent_decode_str(target)
                    .decode_utf8()
                    .ok()
                    .and_then(|path| {
                        path.strip_prefix("assets/")
                            .map(|name| media::asset_name(name) == "preview.jpg")
                    })
                    .unwrap_or(false)
            })
            .ok_or("图片预览不存在")?;
        return Ok((lines[at].to_owned(), at + 1));
    }
    let ocr = lines
        .iter()
        .position(|s| *s == "## 图中文字")
        .ok_or("找不到图片文字")?
        + 1;
    let description = lines[ocr..]
        .iter()
        .position(|s| matches!(*s, "## 模型描述" | "## Model description"))
        .map(|i| i + ocr);
    let (start, end) = match mode {
        ImageMode::Ocr => (ocr, description.unwrap_or(lines.len())),
        ImageMode::Description => (description.ok_or("图片尚无已保存的描述")? + 1, lines.len()),
        ImageMode::Vision => unreachable!(),
    };
    let text = lines[start..end].join("\n");
    if text.trim().is_empty() || (mode == ImageMode::Ocr && text.trim() == "（本机文字识别未完成）")
    {
        return Err("所选图片没有可用的文字，请更换读取方式".into());
    }
    Ok((text, start + 1))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn image_modes_keep_separate_content_and_original_offsets() {
        let md="<!-- inkstone-image:v1 -->\n# Report\n\n![图片](assets/preview.jpg)\n\n## 图中文字\n\nRevenue 42\n\n## Model description\n\nA green chart";
        assert_eq!(
            section(md, ImageMode::Ocr).unwrap(),
            ("\nRevenue 42\n".into(), 7)
        );
        assert_eq!(
            section(md, ImageMode::Description).unwrap(),
            ("\nA green chart".into(), 11)
        );
        assert_eq!(section(md, ImageMode::Vision).unwrap().1, 4);
        assert!(section("not an image", ImageMode::Vision).is_err());
        for asset in ["assets/preview%2Ejpg", "assets/0123abcd5678-preview%2Ejpg"] {
            let restored = md
                .replace("assets/preview.jpg", asset)
                .replace("\n", "\r\n");
            assert_eq!(section(&restored, ImageMode::Vision).unwrap().1, 4);
        }
        for missing in ["", "（本机文字识别未完成）"] {
            let restored = md.replace("Revenue 42", missing);
            assert!(section(&restored, ImageMode::Ocr).is_err());
            assert!(section(&restored, ImageMode::Description).is_ok());
        }
    }
}
