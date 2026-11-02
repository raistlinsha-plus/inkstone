use crate::models::*;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
};

pub const MAX_FILE: u64 = 2 * 1024 * 1024;
pub fn hash(value: impl AsRef<[u8]>) -> String {
    format!("{:x}", Sha256::digest(value.as_ref()))
}
pub fn supported(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|x| x.to_str())
            .map(|x| x.to_lowercase())
            .as_deref(),
        Some("md" | "markdown" | "txt" | "json" | "mmd")
    )
}

pub fn validate_relative(relative: &str) -> Result<(), String> {
    let rel = Path::new(relative);
    if relative.is_empty()
        || rel.is_absolute()
        || rel.components().any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err("文件路径无效".into());
    }
    Ok(())
}

pub fn resolve(root: &Path, relative: &str, new: bool) -> Result<PathBuf, String> {
    validate_relative(relative)?;
    let rel = Path::new(relative);
    let path = root.join(rel);
    let canonical = if new && !path.exists() {
        let parent = path
            .parent()
            .ok_or("文件路径无效")?
            .canonicalize()
            .map_err(|_| "上级目录不存在")?;
        parent.join(path.file_name().ok_or("文件名无效")?)
    } else {
        path.canonicalize().map_err(|_| "文件不存在或无法访问")?
    };
    if !canonical.starts_with(root) {
        return Err("只能访问当前工作区内的文件".into());
    }
    Ok(canonical)
}
pub fn read_text(path: &Path) -> Result<String, String> {
    if !supported(path) {
        return Err("支持 TXT、Markdown、JSON 和 MMD 文件".into());
    }
    if fs::metadata(path).map_err(|e| e.to_string())?.len() > MAX_FILE {
        return Err("文件超过首版 2 MB 的编辑上限".into());
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let value = String::from_utf8(bytes).map_err(|_| "文件不是 UTF-8 编码，请先转换编码后打开")?;
    if value.contains('\0') {
        return Err("无法将二进制文件作为文本打开".into());
    }
    Ok(value)
}
pub fn write_atomic(path: &Path, content: &[u8]) -> Result<(), String> {
    let temporary = path.with_file_name(format!(".inkstone-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|e| e.to_string())?;
        if let Ok(meta) = fs::metadata(path) {
            fs::set_permissions(&temporary, meta.permissions()).map_err(|e| e.to_string())?;
        }
        file.write_all(content).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        fs::rename(&temporary, path).map_err(|e| e.to_string())?;
        if let Some(parent) = path.parent() {
            if let Ok(dir) = fs::File::open(parent) {
                let _ = dir.sync_all();
            }
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}
pub fn draft_path(data_dir: &Path, workspace: &Workspace, relative: &str) -> PathBuf {
    data_dir.join("drafts").join(format!(
        "{}.json",
        hash(format!("{}:{relative}", workspace.root.display()))
    ))
}
fn excluded(name: &str) -> bool {
    name.starts_with('.')
        || matches!(
            name,
            "node_modules" | "target" | "dist" | "build" | "vendor"
        )
}
pub fn list_tree(root: &Path) -> Result<Vec<FileEntry>, String> {
    fn entries(
        root: &Path,
        dir: &Path,
        depth: usize,
        count: &mut usize,
    ) -> Result<Vec<FileEntry>, String> {
        if depth > 12 {
            return Ok(vec![]);
        }
        let mut list = vec![];
        for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
            if *count >= 3000 {
                return Err("目录条目超过 3000 个，请选择更小的工作区".into());
            }
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if excluded(&name) {
                continue;
            }
            let ty = entry.file_type().map_err(|e| e.to_string())?;
            if ty.is_symlink() {
                continue;
            }
            let path = entry.path();
            let directory = ty.is_dir();
            if !directory && !supported(&path) {
                continue;
            }
            *count += 1;
            let children = if directory {
                entries(root, &path, depth + 1, count)?
            } else {
                vec![]
            };
            list.push(FileEntry {
                path: path
                    .strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .into_owned(),
                name,
                directory,
                children,
            });
        }
        list.sort_by(|a, b| {
            b.directory
                .cmp(&a.directory)
                .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok(list)
    }
    entries(root, root, 0, &mut 0)
}
pub fn scan(
    workspace: &Workspace,
    scope: Option<&str>,
) -> Result<(Vec<IndexDocument>, Vec<String>), String> {
    let start = if let Some(p) = scope {
        resolve(&workspace.root, p, false)?
    } else {
        workspace.root.clone()
    };
    let mut documents = vec![];
    let mut warnings = vec![];
    let mut total = 0usize;
    for entry in walkdir::WalkDir::new(start)
        .follow_links(false)
        .max_depth(13)
        .into_iter()
        .filter_entry(|e| e.depth() == 0 || !excluded(&e.file_name().to_string_lossy()))
    {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                warnings.push(e.to_string());
                continue;
            }
        };
        if !entry.file_type().is_file() || !supported(entry.path()) {
            continue;
        }
        if documents.len() >= 2000 {
            return Err("首版最多索引 2000 个文件，请缩小建库范围".into());
        }
        if entry
            .path()
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("json"))
            && scope.is_none_or(|p| !p.to_lowercase().ends_with(".json"))
        {
            continue;
        }
        let path = entry
            .path()
            .strip_prefix(&workspace.root)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .into_owned();
        match read_text(entry.path()) {
            Ok(content) => {
                total += content.len();
                if total > 30 * 1024 * 1024 {
                    return Err("本次资料超过 30 MB，请选择更小的建库范围".into());
                }
                documents.push(IndexDocument {
                    path,
                    hash: hash(&content),
                    content,
                });
            }
            Err(e) => warnings.push(format!("{path}：{e}")),
        }
    }
    Ok((documents, warnings))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn paths_cannot_escape() {
        let d = tempfile::tempdir().unwrap();
        assert!(resolve(d.path(), "../secret.md", true).is_err());
        assert!(resolve(d.path(), "/etc/passwd", false).is_err());
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("secret.md"), "secret").unwrap();
        std::os::unix::fs::symlink(outside.path(), d.path().join("link")).unwrap();
        assert!(resolve(d.path(), "link/secret.md", false).is_err());
    }
    #[test]
    fn atomic_write_preserves_utf8() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("中文.md");
        write_atomic(&p, "# 你好\r\n世界".as_bytes()).unwrap();
        assert_eq!(read_text(&p).unwrap(), "# 你好\r\n世界");
    }
    #[test]
    fn json_requires_explicit_file_scope_but_mmd_is_indexable() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        fs::write(root.join("配置.json"), "{\"apiKey\":\"不应默认发送\"}").unwrap();
        fs::write(root.join("图.mmd"), "flowchart LR\n A --> B").unwrap();
        fs::write(root.join("笔记.md"), "# 本地资料").unwrap();
        let ws = Workspace {
            db: root.join("index.sqlite3"),
            root,
        };
        let (all, _) = scan(&ws, None).unwrap();
        assert_eq!(all.len(), 2);
        assert!(all.iter().all(|d| !d.path.ends_with(".json")));
        assert_eq!(scan(&ws, Some("配置.json")).unwrap().0.len(), 1);
    }
}
