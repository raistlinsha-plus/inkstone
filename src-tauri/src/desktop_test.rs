//! Compiled only into explicitly isolated test builds. No production credential backend.
use std::path::{Path, PathBuf};
pub const IDENTIFIER: &str = "local.inkstone.desktop.e2e";
pub fn paths(
    identifier: &str,
    data: PathBuf,
    config: PathBuf,
) -> Result<(PathBuf, PathBuf), String> {
    if identifier != IDENTIFIER {
        return Err("测试feature必须使用隔离identifier，拒绝启动生产身份".into());
    }
    for path in [&data, &config] {
        if path.file_name().and_then(|x| x.to_str()) != Some(IDENTIFIER) {
            return Err("测试数据目录不匹配隔离身份".into());
        }
        if std::fs::symlink_metadata(path).is_ok_and(|x| x.file_type().is_symlink()) {
            return Err("测试数据目录不能是符号链接".into());
        }
        std::fs::create_dir_all(path).map_err(|e| e.to_string())?;
        if path
            .canonicalize()
            .map_err(|e| e.to_string())?
            .file_name()
            .and_then(|x| x.to_str())
            != Some(IDENTIFIER)
        {
            return Err("测试目录实际位置不匹配".into());
        }
    }
    Ok((data, config))
}
pub fn workspace(data: &Path, root: &Path) -> Result<(), String> {
    if !root
        .canonicalize()
        .map_err(|e| e.to_string())?
        .starts_with(data.canonicalize().map_err(|e| e.to_string())?)
    {
        return Err("隔离测试构建不能打开测试目录以外的工作区".into());
    }
    Ok(())
}
pub fn endpoint(address: &str) -> Result<(), String> {
    let url = reqwest::Url::parse(address).map_err(|_| "无效测试服务地址")?;
    if url.scheme() != "http"
        || !matches!(url.host_str(), Some("127.0.0.1" | "[::1]" | "::1"))
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("隔离测试构建仅允许数字loopback HTTP协议桩".into());
    }
    Ok(())
}
pub fn record_bootstrap(data: &Path) -> Result<(), String> {
    std::fs::write(data.join("bootstrap-probe.json"), serde_json::to_vec(&serde_json::json!({"identifier":IDENTIFIER,"credentials":"disabled-at-compile-time","models":"fresh-disabled-settings","bootstrapAt":std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e|e.to_string())?.as_millis()})).map_err(|e|e.to_string())?).map_err(|e|e.to_string())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_production_identifier_and_symlink_alias() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join(IDENTIFIER);
        assert!(paths("local.inkstone.desktop", p.clone(), p.clone()).is_err());
        assert!(paths(IDENTIFIER, tmp.path().into(), p.clone()).is_err());
        let (a, b) = paths(IDENTIFIER, p.clone(), p.clone()).unwrap();
        assert_eq!(a, b);
        let outside = tempfile::tempdir().unwrap();
        assert!(workspace(&a, outside.path()).is_err());
        #[cfg(unix)]
        {
            let alias = outside.path().join(IDENTIFIER);
            std::os::unix::fs::symlink(&a, &alias).unwrap();
            assert!(paths(IDENTIFIER, alias.clone(), alias).is_err());
        }
    }
    #[test]
    fn rejects_remote_dns_and_non_http_destinations() {
        for url in [
            "https://api.example.com/v1",
            "http://localhost:1234",
            "http://127.0.0.1.example.com/",
            "https://127.0.0.1/",
            "http://user@127.0.0.1/",
        ] {
            assert!(endpoint(url).is_err());
        }
        assert!(endpoint("http://127.0.0.1:9999/v1").is_ok());
    }
}
