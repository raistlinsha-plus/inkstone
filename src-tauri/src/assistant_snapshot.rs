use super::*;

/// Read-only domain validation for backup restore. Does not initialize or mutate a snapshot.
pub fn validate_snapshot(path: &Path) -> Result<(), String> {
    let c = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(err)?;
    let version: i64 = c
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(err)?;
    if version != SCHEMA {
        return Err("会话备份schema不兼容".into());
    }
    let quick: String = c
        .pragma_query_value(None, "quick_check", |r| r.get(0))
        .map_err(err)?;
    if quick != "ok" {
        return Err("会话备份完整性检查失败".into());
    }
    let fk = c
        .prepare("PRAGMA foreign_key_check")
        .map_err(err)?
        .exists([])
        .map_err(err)?;
    if fk {
        return Err("会话备份引用关系损坏".into());
    }
    let mut st = c
        .prepare("SELECT id,workspace_id FROM conversations")
        .map_err(err)?;
    let rows = st
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(err)?;
    for row in rows {
        let (id, workspace) = row.map_err(err)?;
        let convo = read(&c, &workspace, &id)?;
        if workspace.is_empty()
            || convo.title.trim().is_empty()
            || convo.title.chars().count() > 80
            || convo.draft.chars().count() > 16000
            || convo.revision < 0
            || convo.turns.len() > MAX_TURNS as usize
        {
            return Err("会话备份字段超出允许范围".into());
        }
        if let Some(scope) = &convo.scope {
            files::validate_relative(scope)?;
        }
        if let Some(leaf) = &convo.active_leaf_id {
            owned_turn(&c, &id, leaf)?;
        }
        let mut prior = std::collections::HashSet::new();
        for turn in &convo.turns {
            if turn.question.trim().is_empty()
                || turn.question.chars().count() > 8000
                || turn.candidates.is_empty()
                || turn.candidates.len() > MAX_CANDIDATES as usize
            {
                return Err("问题轮次字段无效".into());
            }
            if let Some(parent) = &turn.parent_turn_id {
                if !prior.contains(parent) {
                    return Err("会话分支父节点缺失、越界或成环".into());
                }
            }
            prior.insert(turn.id.clone());
            if turn.selected_candidate_id.as_ref().is_none_or(|selected| {
                !turn
                    .candidates
                    .iter()
                    .any(|candidate| &candidate.id == selected)
            }) {
                return Err("会话选中候选缺失".into());
            }
            for candidate in &turn.candidates {
                if !["keyword", "hybrid", "rerank"].contains(&candidate.requested_mode.as_str()) {
                    return Err("会话检索方式无效".into());
                }
                if ![
                    "generating",
                    "complete",
                    "stopped",
                    "failed",
                    "source_changed",
                ]
                .contains(&candidate.status.as_str())
                {
                    return Err("会话候选状态无效".into());
                }
                if let Some(response) = &candidate.response {
                    if !["complete", "source_changed", "stopped"]
                        .contains(&candidate.status.as_str())
                        || (candidate.status == "stopped"
                            && response["finishReason"] != "cancelled")
                        || response["text"]
                            .as_str()
                            .is_none_or(|text| text.len() > 2 * 1024 * 1024)
                        || !response["finishReason"].is_string()
                    {
                        return Err("会话回答快照无效".into());
                    }
                    let sources = response["sources"].as_array().ok_or("会话来源快照无效")?;
                    if sources.len() > 200 {
                        return Err("会话来源快照过大".into());
                    }
                    for source in sources {
                        let path = source["path"].as_str().ok_or("会话来源路径无效")?;
                        files::validate_relative(path)?;
                        if convo.scope.as_ref().is_some_and(|scope| scope != path) {
                            return Err("来源超出会话冻结范围".into());
                        }
                        if !source["hash"].is_string()
                            || !source["text"].is_string()
                            || !source["startLine"].is_u64()
                            || !source["endLine"].is_u64()
                        {
                            return Err("会话来源元数据无效".into());
                        }
                    }
                } else if ["complete", "source_changed"].contains(&candidate.status.as_str()) {
                    return Err("完整候选缺少回答快照".into());
                }
            }
        }
    }
    Ok(())
}
