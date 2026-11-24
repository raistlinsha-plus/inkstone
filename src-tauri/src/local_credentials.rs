//! User-owned model credentials. Production preferences live outside the managed library.
use serde::{Deserialize, Serialize};
#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt};
use std::{
    collections::BTreeMap,
    fs::{self, File, Metadata, OpenOptions},
    io::{self, Write},
    path::{Component, Path, PathBuf},
};
use uuid::Uuid;

const STORE: &str = "credentials.json";
const ACCESS: &str = "本机凭据配置无法访问，请检查当前用户的文件权限。";
const UNSAFE: &str = "本机凭据配置路径或权限异常，已停止访问。";
const FORMAT: &str = "本机凭据配置格式无效，已有内容已保留。";

#[derive(Clone, PartialEq, Eq)]
pub enum LocalKey {
    Missing,
    Cleared,
    Saved(String),
}

impl std::fmt::Debug for LocalKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Missing => "Missing",
            Self::Cleared => "Cleared",
            Self::Saved(_) => "Saved([redacted])",
        })
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Store {
    version: u32,
    entries: BTreeMap<String, Option<String>>,
}

impl Store {
    fn get(&self, account: &str) -> LocalKey {
        match self.entries.get(account) {
            Some(Some(value)) => LocalKey::Saved(value.clone()),
            Some(None) => LocalKey::Cleared,
            None => LocalKey::Missing,
        }
    }

    fn load(dir: &Path) -> Result<Self, String> {
        let path = dir.join(STORE);
        let Some(file) = open_existing(&path, false)? else {
            return Ok(Self {
                version: 1,
                entries: BTreeMap::new(),
            });
        };
        let store: Self = serde_json::from_reader(file).map_err(|_| FORMAT)?;
        if store.version != 1
            || store
                .entries
                .values()
                .flatten()
                .any(|v| v.trim().is_empty())
        {
            return Err(FORMAT.into());
        }
        Ok(store)
    }

    fn write(&self, dir: &Path, directory: &File) -> Result<(), String> {
        let tmp = dir.join(format!(".credentials-{}.tmp", Uuid::new_v4()));
        let mut options = OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        options.mode(0o600);
        let mut file = options.open(&tmp).map_err(|_| ACCESS)?;
        let result = (|| -> io::Result<()> {
            serde_json::to_writer(&mut file, self)?;
            file.write_all(b"\n")?;
            file.sync_all()?;
            fs::rename(&tmp, dir.join(STORE))?;
            directory.sync_all()
        })();
        if result.is_err() {
            let _ = fs::remove_file(&tmp);
        }
        result.map_err(|_| ACCESS.into())
    }
}

fn account(kind: &str, address: &str) -> String {
    format!("{kind}:{}", crate::files::hash(address))
}

fn location(data: &Path) -> Result<PathBuf, String> {
    if !cfg!(unix) || !data.is_absolute() || data.components().any(|v| v == Component::ParentDir) {
        return Err(UNSAFE.into());
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::home_dir().ok_or(ACCESS)?;
        mac_location(data, &home, cfg!(feature = "desktop-e2e"))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(data.join("private"))
    }
}

#[cfg(target_os = "macos")]
fn mac_location(data: &Path, home: &Path, isolated: bool) -> Result<PathBuf, String> {
    let daily = home.join("Library/Application Support/local.inkstone.desktop");
    if data == daily {
        if isolated || fs::symlink_metadata(data).is_ok_and(|m| m.is_symlink()) {
            return Err(UNSAFE.into());
        }
        let preferences = home.join("Library/Preferences");
        if fs::symlink_metadata(&preferences).is_ok_and(|m| m.is_symlink()) {
            return Err(UNSAFE.into());
        }
        return Ok(preferences.join("local.inkstone.desktop"));
    }
    // Reject aliases into the real data directory, including in an isolated build.
    if let (Ok(actual), Ok(production)) = (data.canonicalize(), daily.canonicalize()) {
        if actual.starts_with(production) {
            return Err(UNSAFE.into());
        }
    }
    Ok(data.join("private"))
}

/// Only the app's own preferences are private. A user can still import a
/// credentials.json they authored elsewhere. Resolve links before reading.
pub(crate) fn is_private_document_path(path: &Path) -> bool {
    #[cfg(target_os = "macos")]
    {
        use std::sync::OnceLock;
        static PRIVATE: OnceLock<Option<PathBuf>> = OnceLock::new();
        let Some(root) = PRIVATE.get_or_init(|| {
            std::env::home_dir().map(|home| home.join("Library/Preferences/local.inkstone.desktop"))
        }) else {
            return true;
        };
        let direct = path.starts_with(root);
        if direct {
            return true;
        }
        let actual = match path.canonicalize() {
            Ok(existing) => existing,
            Err(_) => match path.parent().and_then(|p| p.canonicalize().ok()) {
                Some(parent) => parent,
                None => return false,
            },
        };
        if actual.starts_with(root) {
            return true;
        }
        // APFS can resolve alternate casing to the same directory. Check the
        // directory identity in that case, without blacklisting the name elsewhere.
        if let Some(dir) = actual.ancestors().find(|p| {
            p.file_name()
                .is_some_and(|name| name.eq_ignore_ascii_case("local.inkstone.desktop"))
                && p.parent()
                    .and_then(Path::file_name)
                    .is_some_and(|name| name.eq_ignore_ascii_case("Preferences"))
        }) {
            if let (Ok(a), Ok(b)) = (dir.metadata(), root.metadata()) {
                if a.dev() == b.dev() && a.ino() == b.ino() {
                    return true;
                }
            }
        }
        // A hard link to the actual secret file may have a different name.
        if let Ok(meta) = actual.metadata() {
            if meta.is_file() && meta.nlink() > 1 {
                return root
                    .join(STORE)
                    .metadata()
                    .is_ok_and(|key| key.dev() == meta.dev() && key.ino() == meta.ino());
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = path;
    false
}

fn safe(meta: &Metadata, directory: bool) -> bool {
    #[cfg(unix)]
    {
        static OWNER: std::sync::OnceLock<Option<u32>> = std::sync::OnceLock::new();
        let owner = OWNER.get_or_init(|| std::env::home_dir()?.metadata().ok().map(|m| m.uid()));
        if *owner != Some(meta.uid()) {
            return false;
        }
        if directory {
            meta.is_dir() && meta.mode() & 0o7777 == 0o700
        } else {
            meta.is_file() && meta.nlink() == 1 && meta.mode() & 0o7777 == 0o600
        }
    }
    #[cfg(not(unix))]
    {
        let _ = (meta, directory);
        false
    }
}

// Check both the directory entry and the opened handle before reading any bytes.
fn open_existing(path: &Path, directory: bool) -> Result<Option<File>, String> {
    let entry = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(ACCESS.into()),
    };
    if !safe(&entry, directory) {
        return Err(UNSAFE.into());
    }
    let file = File::open(path).map_err(|_| ACCESS)?;
    let meta = file.metadata().map_err(|_| ACCESS)?;
    #[cfg(unix)]
    if !safe(&meta, directory) || entry.dev() != meta.dev() || entry.ino() != meta.ino() {
        return Err(UNSAFE.into());
    }
    Ok(Some(file))
}

pub fn lookup(data: &Path, kind: &str, address: &str) -> Result<LocalKey, String> {
    let dir = location(data)?;
    let Some(handle) = open_existing(&dir, true)? else {
        return Ok(LocalKey::Missing);
    };
    handle.lock_shared().map_err(|_| ACCESS)?;
    Ok(Store::load(&dir)?.get(&account(kind, address)))
}

fn update(
    data: &Path,
    kind: &str,
    address: &str,
    value: Option<&str>,
    only_missing: bool,
) -> Result<LocalKey, String> {
    let dir = location(data)?;
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    builder.mode(0o700);
    match builder.create(&dir) {
        Ok(()) => (),
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => (),
        Err(_) => return Err(ACCESS.into()),
    }
    // The directory inode stays in place when credentials.json is atomically replaced.
    // Its advisory lock serializes the entire read/modify/rename across processes.
    let handle = open_existing(&dir, true)?.ok_or(ACCESS)?;
    handle.lock().map_err(|_| ACCESS)?;
    let mut store = Store::load(&dir)?;
    let account = account(kind, address);
    let current = store.get(&account);
    if only_missing && current != LocalKey::Missing {
        return Ok(current);
    }
    let replacement = value.map(str::to_owned);
    if store.entries.get(&account) != Some(&replacement) {
        store.entries.insert(account.clone(), replacement);
        store.write(&dir, &handle)?;
    }
    Ok(store.get(&account))
}

pub fn save(
    data: &Path,
    kind: &str,
    address: &str,
    value: Option<&str>,
    clear: bool,
) -> Result<(), String> {
    let value = value.map(str::trim).filter(|s| !s.is_empty());
    // A replacement accompanying an endpoint change takes priority over its clear flag.
    if value.is_some() || clear {
        update(data, kind, address, value, false)?;
    }
    Ok(())
}

pub fn import_if_missing(
    data: &Path,
    kind: &str,
    address: &str,
    value: &str,
) -> Result<LocalKey, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err("导入的凭据为空。".into());
    }
    update(data, kind, address, Some(value), true)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::{symlink, PermissionsExt};
    use std::sync::Barrier;

    #[cfg(target_os = "macos")]
    #[test]
    fn only_the_daily_installation_uses_preferences_and_isolation_rejects_aliases() {
        let home = tempfile::tempdir().unwrap();
        let daily = home
            .path()
            .join("Library/Application Support/local.inkstone.desktop");
        fs::create_dir_all(&daily).unwrap();
        let prefs = home.path().join("Library/Preferences");
        fs::create_dir(&prefs).unwrap();
        let alias = home.path().join("alias");
        symlink(&daily, &alias).unwrap();
        assert_eq!(
            mac_location(&daily, home.path(), false).unwrap(),
            prefs.join("local.inkstone.desktop")
        );
        assert!(mac_location(&daily, home.path(), true).is_err());
        assert!(mac_location(&alias, home.path(), true).is_err());
        let synthetic = home.path().join("mock");
        assert_eq!(
            mac_location(&synthetic, home.path(), true).unwrap(),
            synthetic.join("private")
        );
    }

    #[test]
    fn missing_read_is_side_effect_free_and_keys_are_exactly_scoped() {
        let data = tempfile::tempdir().unwrap();
        let p = data.path();
        let a = "https://model.invalid/v1";
        let b = "https://model.invalid/v2";
        assert_eq!(lookup(p, "chat", a).unwrap(), LocalKey::Missing);
        save(p, "chat", a, None, false).unwrap();
        assert!(!p.join("private").exists());
        save(p, "chat", a, Some(" example "), false).unwrap();
        assert_eq!(
            lookup(p, "chat", a).unwrap(),
            LocalKey::Saved("example".into())
        );
        assert_eq!(lookup(p, "embedding", a).unwrap(), LocalKey::Missing);
        assert_eq!(lookup(p, "chat", b).unwrap(), LocalKey::Missing);
        assert_eq!(
            fs::metadata(p.join("private")).unwrap().mode() & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(p.join("private").join(STORE)).unwrap().mode() & 0o777,
            0o600
        );
        assert_eq!(
            format!("{:?}", LocalKey::Saved("example".into())),
            "Saved([redacted])"
        );
    }

    #[test]
    fn cleared_credentials_and_manual_replacements_prevail_over_old_keys() {
        let data = tempfile::tempdir().unwrap();
        let p = data.path();
        let a = "https://model.invalid/v1";
        assert_eq!(
            import_if_missing(p, "chat", a, "old").unwrap(),
            LocalKey::Saved("old".into())
        );
        save(p, "chat", a, None, true).unwrap();
        assert_eq!(
            import_if_missing(p, "chat", a, "old").unwrap(),
            LocalKey::Cleared
        );
        save(p, "chat", a, Some("replacement"), true).unwrap();
        assert_eq!(
            import_if_missing(p, "chat", a, "old").unwrap(),
            LocalKey::Saved("replacement".into())
        );
    }

    #[test]
    fn concurrent_clients_merge_updates_and_import_cannot_overwrite_a_clear() {
        let data = tempfile::tempdir().unwrap();
        let p = data.path();
        let a = "https://service.invalid/v1";
        let start = Barrier::new(5);
        std::thread::scope(|threads| {
            for op in ["chat", "embedding", "rerank", "import", "clear"] {
                let start = &start;
                threads.spawn(move || {
                    start.wait();
                    match op {
                        "import" => {
                            import_if_missing(p, "web-brave", a, "old").unwrap();
                        }
                        "clear" => save(p, "web-brave", a, None, true).unwrap(),
                        role => save(p, role, a, Some("synthetic"), false).unwrap(),
                    }
                });
            }
        });
        for role in ["chat", "embedding", "rerank"] {
            assert_eq!(
                lookup(p, role, a).unwrap(),
                LocalKey::Saved("synthetic".into())
            );
        }
        assert_eq!(lookup(p, "web-brave", a).unwrap(), LocalKey::Cleared);
    }

    #[test]
    fn malformed_or_accessible_to_others_store_is_never_read_or_replaced() {
        let data = tempfile::tempdir().unwrap();
        let p = data.path();
        save(p, "chat", "a", Some("synthetic"), false).unwrap();
        let file = p.join("private").join(STORE);
        fs::write(&file, "made-up-secret malformed").unwrap();
        assert_eq!(lookup(p, "chat", "a").unwrap_err(), FORMAT);
        assert_eq!(
            save(p, "chat", "a", Some("other"), false).unwrap_err(),
            FORMAT
        );
        assert_eq!(
            fs::read_to_string(&file).unwrap(),
            "made-up-secret malformed"
        );
        fs::set_permissions(&file, fs::Permissions::from_mode(0o644)).unwrap();
        assert_eq!(lookup(p, "chat", "a").unwrap_err(), UNSAFE);
    }

    #[test]
    fn symlinks_and_nonregular_entries_fail_closed() {
        let data = tempfile::tempdir().unwrap();
        let p = data.path();
        let outside = tempfile::tempdir().unwrap();
        let private = p.join("private");
        symlink(outside.path(), &private).unwrap();
        assert_eq!(lookup(p, "chat", "a").unwrap_err(), UNSAFE);
        assert!(save(p, "chat", "a", Some("synthetic"), false).is_err());
        assert!(!outside.path().join(STORE).exists());
        fs::remove_file(&private).unwrap();
        save(p, "chat", "a", Some("synthetic"), false).unwrap();
        let file = private.join(STORE);
        fs::remove_file(&file).unwrap();
        symlink(outside.path().join("missing"), &file).unwrap();
        assert_eq!(lookup(p, "chat", "a").unwrap_err(), UNSAFE);
        assert!(save(p, "chat", "a", Some("other"), false).is_err());
        assert!(!outside.path().join("missing").exists());
        fs::remove_file(&file).unwrap();
        fs::create_dir(&file).unwrap();
        assert_eq!(lookup(p, "chat", "a").unwrap_err(), UNSAFE);
    }
}
