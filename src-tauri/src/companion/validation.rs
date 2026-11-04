use super::*;

/// Read-only validation of a staged backup. Never initializes or mutates a store.
pub fn validate_snapshot(path: &Path) -> Result<(), String> {
    let c = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(err)?;
    let version: i64 = c
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(err)?;
    if version != 1 {
        return Err("角色数据库schema不受支持".into());
    }
    for name in [
        "companion_state",
        "companion_receipts",
        "companion_tokens",
        "companion_pending",
    ] {
        let found: i64 = c
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1",
                [name],
                |r| r.get(0),
            )
            .map_err(err)?;
        if found != 1 {
            return Err("角色数据库缺少必要表".into());
        }
    }
    let d = load(&c)?;
    if !valid_character(&d.settings.character_id)
        || !["focus", "gentle"].contains(&d.settings.mode.as_str())
        || d.timezone.parse::<Tz>().is_err()
    {
        return Err("角色数据设置无效".into());
    }
    let mut ids = std::collections::BTreeSet::new();
    let mut receipts = std::collections::BTreeSet::new();
    let mut objects = std::collections::BTreeSet::new();
    let mut days = BTreeMap::<&str, usize>::new();
    for e in &d.ledger {
        if !ids.insert(&e.id)
            || !receipts.insert(&e.receipt_id)
            || !objects.insert((&e.doc_id, &e.day))
            || !valid_character(&e.character_id)
            || !["complete", "revision", "milestone"].contains(&e.kind.as_str())
            || e.doc_id.is_empty()
            || e.space_id.is_empty()
            || e.hash.is_empty()
            || chrono::NaiveDate::parse_from_str(&e.day, "%Y-%m-%d").is_err()
        {
            return Err("角色经历账本约束无效".into());
        }
        let count = days.entry(&e.day).or_default();
        *count += 1;
        if *count > 2 {
            return Err("角色经历日上限无效".into());
        }
    }
    for (id, p) in &d.roles {
        if !valid_character(id)
            || p.read.iter().any(|n| *n > 2)
            || p.outfit > level(p)
            || p.read
                .iter()
                .collect::<std::collections::BTreeSet<_>>()
                .len()
                != p.read.len()
            || p.read.contains(&1) && !p.read.contains(&0)
            || p.read.contains(&2) && (!p.read.contains(&0) || !p.read.contains(&1))
            || p.choices.iter().any(|(key, value)| {
                key != "c1"
                    || ![format!("{id}.c1.a"), format!("{id}.c1.b")].contains(value)
                    || !p.read.contains(&2)
            })
        {
            return Err("角色故事进度无效".into());
        }
    }
    let mut cards = std::collections::BTreeSet::new();
    for card in &d.cards {
        let Some(e) = d.ledger.iter().find(|e| e.id == card.id) else {
            return Err("经历卡缺少账本身份".into());
        };
        if !cards.insert(&card.id)
            || card.text.trim().is_empty()
            || card.text.chars().count() > 160
            || card.space_id != e.space_id
            || card.day != e.day
            || card.character_id != e.character_id
            || card.kind != e.kind
        {
            return Err("经历卡数据约束无效".into());
        }
    }
    for p in pending(&c)? {
        let raw: String = c
            .query_row(
                "SELECT payload FROM companion_tokens WHERE id=?1",
                [&p.token],
                |r| r.get(0),
            )
            .map_err(err)?;
        let token: Token = serde_json::from_str(&raw).map_err(err)?;
        if p.receipt.generation != d.generation
            || !valid_character(&p.character_id)
            || p.event_id != p.receipt.id
            || token.receipt.id != p.receipt.id
            || token.receipt.hash != p.receipt.hash
            || token.character_id != p.character_id
            || p.text.trim().is_empty()
            || p.text.chars().count() > 160
            || !["complete", "revision", "milestone"].contains(&p.kind.as_str())
        {
            return Err("待保存经历代际无效".into());
        }
    }
    Ok(())
}
