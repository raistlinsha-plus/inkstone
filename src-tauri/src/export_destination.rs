use std::path::{Path, PathBuf};
use tauri_plugin_dialog::DialogExt;

/// The save panel is the authority for a destination. The renderer supplies content, never a path.
pub(crate) async fn choose(
    app: &tauri::AppHandle,
    file_name: &str,
    label: &str,
    extension: &str,
) -> Result<Option<PathBuf>, String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("选择导出位置")
        .set_file_name(file_name)
        .add_filter(label, &[extension])
        .save_file(move |path| {
            let _ = send.send(path);
        });
    let path = receive.await.map_err(|_| "导出位置选择未完成")?;
    path.map(|path| {
        let target = path.into_path().map_err(|_| "请选择本机文件位置")?;
        checked(&target, extension)
    })
    .transpose()
}

fn checked(target: &Path, extension: &str) -> Result<PathBuf, String> {
    if target
        .extension()
        .is_none_or(|actual| !actual.eq_ignore_ascii_case(extension))
    {
        return Err(format!("请保留 .{extension} 文件后缀"));
    }
    let parent = target
        .parent()
        .filter(|_| target.is_absolute())
        .and_then(|parent| parent.canonicalize().ok())
        .ok_or("导出的目标目录不存在")?;
    let name = target.file_name().ok_or("请选择导出文件名")?;
    let path = parent.join(name);
    match path.symlink_metadata() {
        Ok(metadata) if !metadata.file_type().is_file() => {
            return Err("导出位置必须为普通文件，不能是目录或符号链接".into())
        }
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => return Err(error.to_string()),
        _ => {}
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_destination_requires_a_real_parent_and_expected_extension() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("chart.SVG");
        assert_eq!(
            checked(&path, "svg").unwrap(),
            root.path().canonicalize().unwrap().join("chart.SVG")
        );
        assert!(checked(&path, "png").is_err());
        assert!(checked(Path::new("chart.svg"), "svg").is_err());
        assert!(checked(&root.path().join("absent/chart.svg"), "svg").is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(root.path().join("other"), &path).unwrap();
            assert!(checked(&path, "svg").is_err());
        }
    }
}
