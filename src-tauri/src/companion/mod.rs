//! Opt-in local companion data. Document saves and this database are independent.
use crate::{files, library, maintenance, models::Workspace};
use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;
mod types;
mod validation;
pub use types::*;
pub use validation::validate_snapshot;

const CHARACTERS: [&str; 3] = ["motuan", "yanzhou", "zhiwei"];
const TTL: i64 = 15 * 60;
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
fn uuid() -> String {
    Uuid::new_v4().to_string()
}
fn valid_character(v: &str) -> bool {
    CHARACTERS.contains(&v)
}
pub fn database_path(data: &Path) -> PathBuf {
    data.join("companion.sqlite3")
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct Data {
    generation: String,
    revision: u64,
    timezone: String,
    last_time: i64,
    settings: Settings,
    ledger: Vec<Ledger>,
    cards: Vec<Card>,
    roles: BTreeMap<String, RoleProgress>,
    preferences: Vec<Preference>,
}
impl Default for Data {
    fn default() -> Self {
        Self {
            generation: uuid(),
            revision: 0,
            timezone: "Asia/Shanghai".into(),
            last_time: 0,
            settings: Settings::default(),
            ledger: vec![],
            cards: vec![],
            roles: BTreeMap::new(),
            preferences: vec![],
        }
    }
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct Receipt {
    id: String,
    doc_id: String,
    space_id: String,
    hash: String,
    occurred: i64,
    day: String,
    generation: String,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct Token {
    receipt: Receipt,
    character_id: String,
    expires: i64,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Pending {
    pub token: String,
    pub event_id: String,
    pub text: String,
    pub kind: String,
    receipt: Receipt,
    character_id: String,
}

fn open(data: &Path) -> Result<Connection, String> {
    fs::create_dir_all(data).map_err(err)?;
    let path = database_path(data);
    if fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err("角色数据库不能为符号链接".into());
    }
    let c = Connection::open(&path).map_err(err)?;
    let version: i64 = c
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(err)?;
    if version > 1 {
        return Err("角色数据库来自更新版本，请升级应用后再打开。".into());
    }
    c.busy_timeout(std::time::Duration::from_secs(2))
        .map_err(err)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).map_err(err)?;
    }
    c.execute_batch("PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS companion_state(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS companion_receipts(id TEXT PRIMARY KEY,doc_id TEXT NOT NULL,payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS companion_tokens(id TEXT PRIMARY KEY,payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS companion_pending(id TEXT PRIMARY KEY,payload TEXT NOT NULL); PRAGMA user_version=1;").map_err(err)?;
    Ok(c)
}
fn load(c: &Connection) -> Result<Data, String> {
    c.query_row("SELECT payload FROM companion_state WHERE id=1", [], |r| {
        r.get::<_, String>(0)
    })
    .optional()
    .map_err(err)?
    .map(|s| serde_json::from_str(&s).map_err(err))
    .unwrap_or_else(|| Ok(Data::default()))
}
fn save(c: &Connection, d: &Data) -> Result<(), String> {
    c.execute("INSERT INTO companion_state(id,payload) VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",[serde_json::to_string(d).map_err(err)?]).map_err(err)?;
    Ok(())
}
fn check(d: &Data, ctx: &Context) -> Result<(), String> {
    if ctx.generation != d.generation {
        Err("STALE_CONTEXT：角色数据已重置，请重新打开。".into())
    } else if ctx.revision != d.revision {
        Err("REVISION_CONFLICT：角色数据已变化，请刷新后重试。".into())
    } else {
        Ok(())
    }
}
fn level(p: &RoleProgress) -> u8 {
    if p.read.contains(&2) {
        2
    } else if p.read.contains(&1) {
        1
    } else {
        0
    }
}
fn eligible(d: &Data, id: &str) -> Option<u8> {
    let p = d.roles.get(id).cloned().unwrap_or_default();
    if !p.read.contains(&0) {
        return Some(0);
    }
    let days = d
        .ledger
        .iter()
        .map(|e| &e.day)
        .collect::<std::collections::BTreeSet<_>>()
        .len();
    if !p.read.contains(&1) && d.ledger.len() >= 3 && days >= 2 {
        Some(1)
    } else if p.read.contains(&1)
        && !p.read.contains(&2)
        && d.ledger.len() >= 8
        && days >= 5
        && d.ledger.iter().any(|e| e.kind == "revision")
    {
        Some(2)
    } else {
        None
    }
}
fn pending(c: &Connection) -> Result<Vec<Pending>, String> {
    let mut s = c
        .prepare("SELECT payload FROM companion_pending ORDER BY rowid")
        .map_err(err)?;
    let rows = s.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
    rows.map(|v| serde_json::from_str(&v.map_err(err)?).map_err(err))
        .collect()
}
fn snapshot(c: &Connection, d: Data) -> Result<Snapshot, String> {
    let e = eligible(&d, &d.settings.character_id);
    Ok(Snapshot {
        generation: d.generation,
        revision: d.revision,
        timezone: d.timezone,
        events: d.ledger.len(),
        days: d
            .ledger
            .iter()
            .map(|e| &e.day)
            .collect::<std::collections::BTreeSet<_>>()
            .len(),
        settings: d.settings,
        roles: d.roles,
        cards: d.cards,
        preferences: d.preferences,
        pending: pending(c)?,
        eligible: e,
    })
}
pub fn state(data: &Path) -> Result<Snapshot, String> {
    let _permit = maintenance::mutation(data)?;
    let mut c = open(data)?;
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(err)?;
    let d = load(&tx)?;
    save(&tx, &d)?;
    let s = snapshot(&tx, d)?;
    tx.commit().map_err(err)?;
    Ok(s)
}
fn mutate(
    data: &Path,
    ctx: &Context,
    f: impl FnOnce(&Connection, &mut Data) -> Result<(), String>,
) -> Result<Snapshot, String> {
    let _permit = maintenance::mutation(data)?;
    let mut c = open(data)?;
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(err)?;
    let mut d = load(&tx)?;
    check(&d, ctx)?;
    f(&tx, &mut d)?;
    d.revision += 1;
    save(&tx, &d)?;
    let s = snapshot(&tx, d)?;
    tx.commit().map_err(err)?;
    Ok(s)
}
pub fn settings(data: &Path, i: SettingsInput) -> Result<Snapshot, String> {
    mutate(data, &i.context, |_, d| {
        if !valid_character(&i.character_id) || !["focus", "gentle"].contains(&i.mode.as_str()) {
            return Err("角色或陪伴模式无效".into());
        }
        if let Some(tz) = i.timezone {
            let _: Tz = tz.parse().map_err(|_| "时区无效")?;
            if !d.ledger.is_empty() && tz != d.timezone {
                return Err("已有经历后暂不支持更改日界时区；历史日期保持不变。".into());
            }
            d.timezone = tz;
        }
        if let Some(outfit) = i.outfit {
            let p = d.roles.entry(i.character_id.clone()).or_default();
            if outfit > level(p) {
                return Err("尚未解锁该形象".into());
            }
            p.outfit = outfit;
        }
        d.settings = Settings {
            enabled: i.enabled,
            character_id: i.character_id,
            mode: i.mode,
            reduced_motion: i.reduced_motion,
            compact: i.compact,
        };
        Ok(())
    })
}
fn day_at(timestamp: i64, timezone: &str) -> Result<String, String> {
    let tz: Tz = timezone.parse().map_err(|_| "时区无效")?;
    let dt = DateTime::<Utc>::from_timestamp(timestamp, 0).ok_or("日期无效")?;
    Ok(dt.with_timezone(&tz).format("%Y-%m-%d").to_string())
}
fn identity(data: &Path, ws: &Workspace, path: &str) -> Result<(String, String), String> {
    let space = library::project_at_root(data, &ws.root)
        .ok_or("仅受管理文档空间支持记录经历；外部目录仍可使用陪伴。")?;
    let (id, _) = library::title_for(data, &ws.root, path)
        .ok_or("SOURCE_UNAVAILABLE：文档不在当前空间或已移入回收站。")?;
    Ok((space, id))
}
pub fn record_save(data: &Path, ws: &Workspace, path: &str, hash: &str) -> Result<(), String> {
    let _permit = maintenance::mutation(data)?;
    let mut c = open(data)?;
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(err)?;
    let d = load(&tx)?;
    if !d.settings.enabled {
        return Ok(());
    }
    let Ok((space, doc)) = identity(data, ws, path) else {
        return Ok(());
    };
    let at = now();
    if at < d.last_time - 300 {
        return Err("系统时间倒退，暂未记录本次工作凭据；正文已保存。".into());
    }
    let r = Receipt {
        id: uuid(),
        doc_id: doc.clone(),
        space_id: space,
        hash: hash.into(),
        occurred: at,
        day: day_at(at, &d.timezone)?,
        generation: d.generation.clone(),
    };
    tx.execute("DELETE FROM companion_receipts WHERE doc_id=?1", [doc])
        .map_err(err)?;
    tx.execute(
        "INSERT INTO companion_receipts VALUES(?1,?2,?3)",
        params![r.id, r.doc_id, serde_json::to_string(&r).map_err(err)?],
    )
    .map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(())
}
pub fn preview(data: &Path, ws: &Workspace, path: &str) -> Result<Preview, String> {
    let _permit = maintenance::mutation(data)?;
    let mut c = open(data)?;
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(err)?;
    let d = load(&tx)?;
    if !d.settings.enabled {
        return Err("DISABLED：请先开启陪伴。".into());
    }
    let (space, doc) = identity(data, ws, path)?;
    let raw: String = tx
        .query_row(
            "SELECT payload FROM companion_receipts WHERE doc_id=?1",
            [&doc],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?
        .ok_or("WORK_NOT_SAVED：开启陪伴后，请先修改并成功保存这份文档。")?;
    let r: Receipt = serde_json::from_str(&raw).map_err(err)?;
    verify_receipt(data, ws, path, &d, &r)?;
    if d.ledger.iter().any(|e| e.doc_id == doc && e.day == r.day) {
        return Err("这份文档在该有效日已经计入；普通保存不会重复成长。".into());
    }
    if d.ledger.iter().filter(|e| e.day == r.day).count() >= 2 {
        return Err("DAILY_LIMIT：该有效日已记录两条经历，工作仍可继续。".into());
    }
    let can_revise = d.ledger.iter().any(|e| e.doc_id == doc && e.hash != r.hash);
    if now() > r.occurred + TTL {
        return Err("TOKEN_EXPIRED：请重新修改并保存本次工作。".into());
    }
    let token = uuid();
    let expires = r.occurred + TTL;
    let t = Token {
        receipt: r.clone(),
        character_id: d.settings.character_id.clone(),
        expires,
    };
    tx.execute(
        "INSERT INTO companion_tokens VALUES(?1,?2)",
        params![token, serde_json::to_string(&t).map_err(err)?],
    )
    .map_err(err)?;
    // Bound expired previews and stale save receipts without deleting any confirmed history.
    tx.execute("DELETE FROM companion_tokens WHERE id NOT IN (SELECT id FROM companion_pending) AND rowid NOT IN (SELECT rowid FROM companion_tokens ORDER BY rowid DESC LIMIT 100)",[]).map_err(err)?;
    let out = Preview {
        token: token.clone(),
        event_id: r.id,
        suggested_text: "完成一份资料整理".into(),
        day: t.receipt.day,
        can_revise,
        expires_at: expires,
        context: Context {
            generation: d.generation,
            revision: d.revision,
        },
    };
    let _ = space;
    tx.commit().map_err(err)?;
    Ok(out)
}
fn verify_receipt(
    data: &Path,
    ws: &Workspace,
    path: &str,
    d: &Data,
    r: &Receipt,
) -> Result<(), String> {
    if r.generation != d.generation {
        return Err("STALE_CONTEXT：工作凭据已过期。".into());
    }
    let (space, doc) = identity(data, ws, path)?;
    if space != r.space_id || doc != r.doc_id {
        return Err("STALE_CONTEXT：文档空间已变化。".into());
    }
    let content = files::read_text(&files::resolve(&ws.root, path, false)?)?;
    if files::hash(content.as_bytes()) != r.hash {
        return Err("SOURCE_CHANGED：文档内容已变化，请重新保存后预览。".into());
    }
    Ok(())
}

pub fn confirm(data: &Path, ws: &Workspace, i: ConfirmInput) -> Result<ConfirmResult, String> {
    confirm_at(data, ws, i, now(), false)
}
#[cfg(test)]
pub(crate) fn confirm_pending_for_backup_test(
    data: &Path,
    ws: &Workspace,
    i: ConfirmInput,
) -> Result<ConfirmResult, String> {
    confirm_at(data, ws, i, now(), true)
}
fn confirm_at(
    data: &Path,
    ws: &Workspace,
    i: ConfirmInput,
    at: i64,
    fail_after_pending: bool,
) -> Result<ConfirmResult, String> {
    let _permit = maintenance::mutation(data)?;
    if !i.consent
        || i.text.trim().is_empty()
        || i.text.chars().count() > 160
        || !["complete", "revision", "milestone"].contains(&i.kind.as_str())
    {
        return Err("请确认160字以内的经历内容与有效分类。".into());
    }
    let mut c = open(data)?;
    // Persist the user's accepted intent before attempting its reward transaction.
    let intent = {
        let tx = c
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(err)?;
        let d = load(&tx)?;
        if d.generation != i.context.generation {
            return Err("STALE_CONTEXT：角色数据已重置。".into());
        }
        if d.ledger.iter().any(|e| e.id == i.event_id) {
            let s = snapshot(&tx, d)?;
            tx.commit().map_err(err)?;
            return Ok(ConfirmResult {
                status: "duplicate".into(),
                snapshot: s,
            });
        }
        check(&d, &i.context)?;
        if !d.settings.enabled {
            return Err("DISABLED：陪伴已关闭，未新增经历。".into());
        }
        let old: Option<String> = tx
            .query_row(
                "SELECT payload FROM companion_pending WHERE id=?1",
                [&i.token],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        let intent = if let Some(raw) = old {
            let p: Pending = serde_json::from_str(&raw).map_err(err)?;
            if p.event_id != i.event_id {
                return Err("经历标识不匹配".into());
            }
            p
        } else {
            let raw: String = tx
                .query_row(
                    "SELECT payload FROM companion_tokens WHERE id=?1",
                    [&i.token],
                    |r| r.get(0),
                )
                .optional()
                .map_err(err)?
                .ok_or("TOKEN_EXPIRED：请重新预览这次经历。")?;
            let token: Token = serde_json::from_str(&raw).map_err(err)?;
            if token.expires < at || token.receipt.id != i.event_id {
                return Err("TOKEN_EXPIRED：请重新预览这次经历。".into());
            }
            Pending {
                token: i.token.clone(),
                event_id: i.event_id.clone(),
                text: i.text.trim().into(),
                kind: i.kind.clone(),
                receipt: token.receipt,
                character_id: token.character_id,
            }
        };
        validate_intent(data, ws, &d, &intent, at)?;
        tx.execute(
            "INSERT INTO companion_pending VALUES(?1,?2) ON CONFLICT(id) DO NOTHING",
            params![intent.token, serde_json::to_string(&intent).map_err(err)?],
        )
        .map_err(err)?;
        tx.commit().map_err(err)?;
        intent
    };
    if fail_after_pending {
        return Err("STORAGE_ERROR：工作已保存，经历待保存，可重试。".into());
    }
    let doc = library::get(data, &intent.receipt.doc_id)?;
    let file = files::resolve(&ws.root, &doc.path, false)?;
    crate::documents::with_write_lock(&file, || {
        let tx = c
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(err)?;
        let mut d = load(&tx)?;
        check(&d, &i.context)?;
        validate_intent(data, ws, &d, &intent, at)?;
        let status = if d.ledger.iter().any(|e| {
            e.receipt_id == intent.receipt.id
                || e.doc_id == intent.receipt.doc_id && e.day == intent.receipt.day
        }) {
            "duplicate"
        } else if d
            .ledger
            .iter()
            .filter(|e| e.day == intent.receipt.day)
            .count()
            >= 2
        {
            "daily_limit"
        } else {
            d.ledger.push(Ledger {
                id: intent.event_id.clone(),
                receipt_id: intent.receipt.id.clone(),
                doc_id: intent.receipt.doc_id.clone(),
                space_id: intent.receipt.space_id.clone(),
                hash: intent.receipt.hash.clone(),
                day: intent.receipt.day.clone(),
                kind: intent.kind.clone(),
                character_id: intent.character_id.clone(),
            });
            d.cards.push(Card {
                id: intent.event_id.clone(),
                text: intent.text.clone(),
                space_id: intent.receipt.space_id.clone(),
                day: intent.receipt.day.clone(),
                character_id: intent.character_id.clone(),
                kind: intent.kind.clone(),
            });
            "counted"
        };
        tx.execute("DELETE FROM companion_pending WHERE id=?1", [&intent.token])
            .map_err(err)?;
        tx.execute("DELETE FROM companion_tokens WHERE id=?1", [&intent.token])
            .map_err(err)?;
        d.last_time = d.last_time.max(at);
        d.revision += 1;
        save(&tx, &d)?;
        let s = snapshot(&tx, d)?;
        tx.commit().map_err(err)?;
        Ok(ConfirmResult {
            status: status.into(),
            snapshot: s,
        })
    })
}

fn validate_intent(
    data: &Path,
    ws: &Workspace,
    d: &Data,
    p: &Pending,
    at: i64,
) -> Result<(), String> {
    if !d.settings.enabled {
        return Err("DISABLED：陪伴已关闭，未新增经历。".into());
    }
    if p.character_id != d.settings.character_id || p.receipt.generation != d.generation {
        return Err("STALE_CONTEXT：角色或档案已变化，请重新预览。".into());
    }
    if at < d.last_time - 300 {
        return Err("系统时间倒退，暂不计入新经历；已有进度保留。".into());
    }
    let doc = library::get(data, &p.receipt.doc_id)?;
    verify_receipt(data, ws, &doc.path, d, &p.receipt)?;
    if p.kind == "revision"
        && !d
            .ledger
            .iter()
            .any(|e| e.doc_id == p.receipt.doc_id && e.hash != p.receipt.hash)
    {
        return Err("复盘需要该文档已有经历，且本次实际保存的内容已变化。".into());
    }
    Ok(())
}
pub fn complete_story(data: &Path, i: StoryInput) -> Result<Snapshot, String> {
    mutate(data, &i.context, |_, d| {
        if !valid_character(&i.character_id) || i.stage > 2 {
            return Err("故事不存在".into());
        }
        if !d.settings.enabled {
            return Err("请先开启陪伴".into());
        }
        let role = d.roles.get(&i.character_id).cloned().unwrap_or_default();
        if !role.read.contains(&i.stage) && eligible(d, &i.character_id) != Some(i.stage) {
            return Err("尚未满足章节条件".into());
        }
        let story: serde_json::Value =
            serde_json::from_str(include_str!("stories.json")).map_err(err)?;
        let ep = &story["characters"]
            .as_array()
            .ok_or("剧情不可用")?
            .iter()
            .find(|v| v["id"] == i.character_id)
            .ok_or("角色不存在")?["episodes"][i.stage as usize];
        let p = d.roles.entry(i.character_id.clone()).or_default();
        if let Some(choice) = i.choice_id {
            if i.stage != 2
                || !ep["choices"]
                    .as_array()
                    .is_some_and(|a| a.iter().any(|c| c["id"] == choice))
            {
                return Err("故事选项无效".into());
            }
            if let Some(previous) = p.choices.get("c1") {
                if previous != &choice {
                    return Err("已有选择保留，重看不能覆盖".into());
                }
            }
            p.choices.insert("c1".into(), choice);
        }
        if i.stage == 2 && !i.skipped && !p.choices.contains_key("c1") {
            return Err("请先选择同行分支，或明确跳过本章。".into());
        }
        if !p.read.contains(&i.stage) {
            p.read.push(i.stage);
            p.outfit = i.stage;
        }
        Ok(())
    })
}
pub fn mutate_card(data: &Path, i: CardInput) -> Result<Snapshot, String> {
    mutate(data, &i.context, |c, d| {
        if let Some(text) = i.text {
            if text.trim().is_empty() || text.chars().count() > 160 {
                return Err("经历卡须为1–160字".into());
            }
            let card = d
                .cards
                .iter_mut()
                .find(|c| c.id == i.id)
                .ok_or("卡片已删除")?;
            card.text = text.trim().into();
        } else {
            d.cards.retain(|c| c.id != i.id);
            for p in pending(c)? {
                if p.event_id == i.id {
                    c.execute("DELETE FROM companion_pending WHERE id=?1", [&p.token])
                        .map_err(err)?;
                    c.execute("DELETE FROM companion_tokens WHERE id=?1", [&p.token])
                        .map_err(err)?;
                }
            }
        }
        Ok(())
    })
}
pub fn mutate_preference(
    data: &Path,
    ws: Option<&Workspace>,
    i: PreferenceInput,
) -> Result<Snapshot, String> {
    mutate(data, &i.context, |_, d| {
        if i.delete {
            d.preferences.retain(|p| Some(&p.id) != i.id.as_ref());
            return Ok(());
        }
        if !["answerStyle", "answerLength", "displayUnit", "nickname"].contains(&i.key.as_str())
            || i.value.trim().is_empty()
            || i.value.chars().count() > 100
        {
            return Err("请填写允许的偏好字段及100字以内内容".into());
        }
        let scope_id = match i.scope.as_str() {
            "global" => "global".to_string(),
            "character" if valid_character(&i.scope_id) => i.scope_id.clone(),
            "space" => {
                let ws = ws.ok_or("请先打开空间")?;
                let id = library::project_at_root(data, &ws.root).ok_or("该范围不是文档空间")?;
                if id != i.scope_id {
                    return Err("偏好空间已变化".into());
                }
                id
            }
            _ => return Err("偏好范围无效".into()),
        };
        if (i.key == "nickname" && i.scope == "space")
            || (i.key != "nickname" && i.scope == "character")
        {
            return Err("称呼按角色/全局保存，资料表达按空间/全局保存。".into());
        }
        let id = i.id.unwrap_or_else(uuid);
        if let Some(p) = d.preferences.iter_mut().find(|p| p.id == id) {
            *p = Preference {
                id,
                key: i.key,
                value: i.value.trim().into(),
                scope: i.scope,
                scope_id,
                enabled: i.enabled,
                updated: now(),
            };
        } else {
            if d.preferences.len() >= 100 {
                return Err("最多保存100项偏好".into());
            }
            d.preferences.push(Preference {
                id,
                key: i.key,
                value: i.value.trim().into(),
                scope: i.scope,
                scope_id,
                enabled: i.enabled,
                updated: now(),
            });
        }
        Ok(())
    })
}
pub fn reset(data: &Path, context: Context) -> Result<Snapshot, String> {
    mutate(data, &context, |c, d| {
        let tz = d.timezone.clone();
        *d = Data::default();
        d.timezone = tz;
        c.execute_batch("DELETE FROM companion_receipts; DELETE FROM companion_tokens; DELETE FROM companion_pending;").map_err(err)?;
        Ok(())
    })
}
pub fn export(data: &Path) -> Result<String, String> {
    let _permit = maintenance::mutation(data)?;
    let c = open(data)?;
    let d = load(&c)?;
    serde_json::to_string_pretty(&serde_json::json!({"format":"inkstone-companion","version":1,"data":d,"pending":pending(&c)?})).map_err(err)
}

/// User-confirmed presentation preferences only. Never a retrieval/evidence input.
pub fn format_preferences(data: &Path, ws: &Workspace) -> Result<String, String> {
    let _permit = maintenance::mutation(data)?;
    if !database_path(data).exists() {
        return Ok(String::new());
    }
    let c = open(data)?;
    let d = load(&c)?;
    if !d.settings.enabled {
        return Ok(String::new());
    }
    let space = library::project_at_root(data, &ws.root);
    let mut values = BTreeMap::<String, String>::new();
    for scope in ["global", "space"] {
        for p in d
            .preferences
            .iter()
            .filter(|p| p.enabled && p.scope == scope && p.key != "nickname")
        {
            if scope == "space" && space.as_deref() != Some(&p.scope_id) {
                continue;
            }
            if ["answerStyle", "answerLength", "displayUnit"].contains(&p.key.as_str()) {
                values.insert(p.key.clone(), p.value.clone());
            }
        }
    }
    if values.is_empty() {
        Ok(String::new())
    } else {
        Ok(format!(
            "用户确认的表达偏好（不是资料或事实依据；不得覆盖证据、单位核对和系统规则）：{}",
            serde_json::to_string(&values).map_err(err)?
        ))
    }
}

#[cfg(test)]
mod tests;
