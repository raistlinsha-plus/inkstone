//! Local knowledge conversations. Historical model text is never retrieval evidence.
use crate::{
    files, library, maintenance,
    models::{ChatResponse, Workspace},
};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    path::Path,
    sync::OnceLock,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

const SCHEMA: i64 = 1;
const MAX_TURNS: i64 = 200;
const MAX_CANDIDATES: i64 = 12;
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub id: String,
    pub request_id: String,
    pub requested_mode: String,
    pub status: String,
    pub created_at: String,
    pub error: Option<String>,
    pub response: Option<Value>,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Turn {
    pub id: String,
    pub parent_turn_id: Option<String>,
    pub question: String,
    pub created_at: String,
    pub selected_candidate_id: Option<String>,
    pub candidates: Vec<Candidate>,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub scope: Option<String>,
    pub scope_label: String,
    pub archived: bool,
    pub draft: String,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
    pub active_leaf_id: Option<String>,
    pub turns: Vec<Turn>,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub id: String,
    pub title: String,
    pub scope: Option<String>,
    pub scope_label: String,
    pub archived: bool,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
    pub active_leaf_id: Option<String>,
    pub turn_count: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Export {
    pub markdown: String,
    pub all_markdown: String,
    pub json: String,
}
#[derive(Clone, Debug)]
pub struct Started {
    pub conversation_id: String,
    pub turn_id: String,
    pub candidate_id: String,
    pub followup_sources: Option<Vec<grounding::PriorSource>>,
    pub grounded_question: String,
    pub prompt_question: String,
    pub scope: Option<String>,
}
fn err(e: impl std::fmt::Display) -> String {
    format!("会话存储：{e}")
}
fn now() -> String {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ms)
        .unwrap()
        .to_rfc3339()
}
fn process_id() -> &'static str {
    static ID: OnceLock<String> = OnceLock::new();
    ID.get_or_init(|| Uuid::new_v4().to_string())
}
fn open(data: &Path) -> Result<Connection, String> {
    fs::create_dir_all(data).map_err(err)?;
    let path = data.join("assistant.sqlite3");
    if path.exists() {
        if fs::symlink_metadata(&path)
            .map_err(err)?
            .file_type()
            .is_symlink()
        {
            return Err("会话数据库不能是符号链接".into());
        }
    } else {
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(&path) {
            Ok(_) => (),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => (),
            Err(e) => return Err(err(e)),
        }
    }
    let c = Connection::open(path).map_err(err)?;
    c.busy_timeout(Duration::from_millis(1500)).map_err(err)?;
    let version: i64 = c
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(err)?;
    if version > SCHEMA {
        return Err("会话库版本较新，请使用对应版本应用".into());
    }
    c.execute_batch("PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,title TEXT NOT NULL,scope TEXT,scope_label TEXT NOT NULL,archived INTEGER NOT NULL DEFAULT 0,draft TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,active_leaf_id TEXT);
      CREATE TABLE IF NOT EXISTS turns(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,parent_turn_id TEXT,question TEXT NOT NULL,created_at TEXT NOT NULL,selected_candidate_id TEXT);
      CREATE TABLE IF NOT EXISTS candidates(id TEXT PRIMARY KEY,turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,request_id TEXT NOT NULL UNIQUE,status TEXT NOT NULL,created_at TEXT NOT NULL,error TEXT,response TEXT,process_id TEXT NOT NULL,requested_mode TEXT NOT NULL DEFAULT 'hybrid');
      CREATE INDEX IF NOT EXISTS assistant_workspace ON conversations(workspace_id,updated_at);
      CREATE INDEX IF NOT EXISTS assistant_turns ON turns(conversation_id);").map_err(err)?;
    let has_mode: bool = c.query_row("SELECT EXISTS(SELECT 1 FROM pragma_table_info('candidates') WHERE name='requested_mode')", [], |r|r.get(0)).map_err(err)?;
    if !has_mode {
        c.execute(
            "ALTER TABLE candidates ADD COLUMN requested_mode TEXT NOT NULL DEFAULT 'hybrid'",
            [],
        )
        .map_err(err)?;
    }
    c.pragma_update(None, "user_version", SCHEMA).map_err(err)?;
    c.execute("UPDATE candidates SET status='failed',error='上次生成未完成，请重新生成。' WHERE status='generating' AND process_id<>?",[process_id()]).map_err(err)?;
    Ok(c)
}
pub fn workspace_id(data: &Path, ws: &Workspace) -> String {
    library::project_at_root(data, &ws.root)
        .map(|id| format!("managed:{id}"))
        .unwrap_or_else(|| {
            format!(
                "external:{}",
                files::hash(
                    ws.root
                        .canonicalize()
                        .unwrap_or_else(|_| ws.root.clone())
                        .to_string_lossy()
                        .as_bytes()
                )
            )
        })
}
fn authorize(c: &Connection, workspace: &str, id: &str) -> Result<(), String> {
    let owner: Option<String> = c
        .query_row(
            "SELECT workspace_id FROM conversations WHERE id=?",
            [id],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    if owner.as_deref() != Some(workspace) {
        return Err("会话不存在、已删除或不属于当前资料空间".into());
    }
    Ok(())
}
fn revision(c: &Connection, workspace: &str, id: &str, expected: i64) -> Result<(), String> {
    authorize(c, workspace, id)?;
    let actual: i64 = c
        .query_row("SELECT revision FROM conversations WHERE id=?", [id], |r| {
            r.get(0)
        })
        .map_err(err)?;
    if actual != expected {
        return Err("REVISION_CONFLICT:会话已变化，请刷新后重试。".into());
    }
    Ok(())
}
fn clean(value: &str, max: usize, label: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > max || value.contains('\0') {
        Err(format!("{label}为空或超过{max}字限制"))
    } else {
        Ok(value.into())
    }
}
fn read(c: &Connection, workspace: &str, id: &str) -> Result<Conversation, String> {
    authorize(c, workspace, id)?;
    let mut out=c.query_row("SELECT id,title,scope,scope_label,archived,draft,revision,created_at,updated_at,active_leaf_id FROM conversations WHERE id=?",[id],|r|Ok(Conversation{id:r.get(0)?,title:r.get(1)?,scope:r.get(2)?,scope_label:r.get(3)?,archived:r.get(4)?,draft:r.get(5)?,revision:r.get(6)?,created_at:r.get(7)?,updated_at:r.get(8)?,active_leaf_id:r.get(9)?,turns:vec![]})).map_err(err)?;
    let mut statement=c.prepare("SELECT id,parent_turn_id,question,created_at,selected_candidate_id FROM turns WHERE conversation_id=? ORDER BY rowid").map_err(err)?;
    let turns = statement
        .query_map([id], |r| {
            Ok(Turn {
                id: r.get(0)?,
                parent_turn_id: r.get(1)?,
                question: r.get(2)?,
                created_at: r.get(3)?,
                selected_candidate_id: r.get(4)?,
                candidates: vec![],
            })
        })
        .map_err(err)?;
    for t in turns {
        let mut t = t.map_err(err)?;
        let mut st=c.prepare("SELECT id,request_id,status,created_at,error,response,requested_mode FROM candidates WHERE turn_id=? ORDER BY rowid").map_err(err)?;
        let rows = st
            .query_map([&t.id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, Option<String>>(5)?,
                    r.get::<_, String>(6)?,
                ))
            })
            .map_err(err)?;
        for row in rows {
            let (id, request_id, status, created_at, error, response, requested_mode) =
                row.map_err(err)?;
            t.candidates.push(Candidate {
                id,
                request_id,
                requested_mode,
                status,
                created_at,
                error,
                response: response
                    .map(|x| serde_json::from_str(&x).map_err(err))
                    .transpose()?,
            });
        }
        out.turns.push(t);
    }
    Ok(out)
}
pub fn list(
    data: &Path,
    workspace: &str,
    include_archived: bool,
    query: &str,
) -> Result<Vec<Summary>, String> {
    list_page(data, workspace, include_archived, query, 0)
}
pub fn list_page(
    data: &Path,
    workspace: &str,
    include_archived: bool,
    query: &str,
    offset: u32,
) -> Result<Vec<Summary>, String> {
    let _permit = maintenance::mutation(data)?;
    let c = open(data)?;
    if query.chars().count() > 200 {
        return Err("会话搜索最多200字".into());
    }
    let mut st=c.prepare("SELECT c.id,c.title,c.scope,c.scope_label,c.archived,c.revision,c.created_at,c.updated_at,c.active_leaf_id,(SELECT COUNT(*) FROM turns t WHERE t.conversation_id=c.id) FROM conversations c WHERE c.workspace_id=? AND (? OR c.archived=0) AND instr(lower(c.title),lower(?))>0 ORDER BY c.updated_at DESC,c.rowid DESC LIMIT 200 OFFSET ?").map_err(err)?;
    let rows = st
        .query_map(
            params![workspace, include_archived, query.trim(), offset],
            |r| {
                Ok(Summary {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    scope: r.get(2)?,
                    scope_label: r.get(3)?,
                    archived: r.get(4)?,
                    revision: r.get(5)?,
                    created_at: r.get(6)?,
                    updated_at: r.get(7)?,
                    active_leaf_id: r.get(8)?,
                    turn_count: r.get(9)?,
                })
            },
        )
        .map_err(err)?;
    rows.map(|r| r.map_err(err)).collect()
}
pub fn create(
    data: &Path,
    workspace: &str,
    scope: Option<String>,
    scope_label: String,
    title: Option<String>,
) -> Result<Conversation, String> {
    let _permit = maintenance::mutation(data)?;
    let c = open(data)?;
    let id = Uuid::new_v4().to_string();
    let time = now();
    let title = clean(title.as_deref().unwrap_or("新会话"), 80, "会话标题")?;
    c.execute("INSERT INTO conversations(id,workspace_id,title,scope,scope_label,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",params![id,workspace,title,scope,scope_label,time,time]).map_err(err)?;
    read(&c, workspace, &id)
}
pub fn get(data: &Path, workspace: &str, id: &str) -> Result<Conversation, String> {
    let _permit = maintenance::mutation(data)?;
    read(&open(data)?, workspace, id)
}
pub fn update(
    data: &Path,
    workspace: &str,
    id: &str,
    expected: i64,
    title: Option<String>,
    archived: Option<bool>,
    draft: Option<String>,
    active_leaf_id: Option<String>,
) -> Result<Conversation, String> {
    let _permit = maintenance::mutation(data)?;
    let mut c = open(data)?;
    let tx = c
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(err)?;
    revision(&tx, workspace, id, expected)?;
    if let Some(title) = title {
        tx.execute(
            "UPDATE conversations SET title=? WHERE id=?",
            params![clean(&title, 80, "会话标题")?, id],
        )
        .map_err(err)?;
    }
    if let Some(archived) = archived {
        tx.execute(
            "UPDATE conversations SET archived=? WHERE id=?",
            params![archived, id],
        )
        .map_err(err)?;
    }
    if let Some(draft) = draft {
        if draft.chars().count() > 16000 {
            return Err("问题草稿超过16000字限制".into());
        }
        tx.execute(
            "UPDATE conversations SET draft=? WHERE id=?",
            params![draft, id],
        )
        .map_err(err)?;
    }
    if let Some(leaf) = active_leaf_id {
        owned_turn(&tx, id, &leaf)?;
        tx.execute(
            "UPDATE conversations SET active_leaf_id=? WHERE id=?",
            params![leaf, id],
        )
        .map_err(err)?;
    }
    bump(&tx, id)?;
    tx.commit().map_err(err)?;
    read(&c, workspace, id)
}
fn bump(tx: &Transaction<'_>, id: &str) -> Result<(), String> {
    tx.execute(
        "UPDATE conversations SET revision=revision+1,updated_at=? WHERE id=?",
        params![now(), id],
    )
    .map_err(err)?;
    Ok(())
}
fn owned_turn(c: &Connection, conversation: &str, turn: &str) -> Result<(), String> {
    let owner: Option<String> = c
        .query_row(
            "SELECT conversation_id FROM turns WHERE id=?",
            [turn],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    if owner.as_deref() != Some(conversation) {
        Err("轮次不属于当前会话".into())
    } else {
        Ok(())
    }
}
pub fn delete(data: &Path, workspace: &str, id: &str, expected: i64) -> Result<(), String> {
    let _permit = maintenance::mutation(data)?;
    let mut c = open(data)?;
    let tx = c
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(err)?;
    revision(&tx, workspace, id, expected)?;
    tx.execute("DELETE FROM conversations WHERE id=?", [id])
        .map_err(err)?;
    tx.commit().map_err(err)
}
pub fn select(
    data: &Path,
    workspace: &str,
    id: &str,
    turn: &str,
    candidate: &str,
    expected: i64,
) -> Result<Conversation, String> {
    let _permit = maintenance::mutation(data)?;
    let mut c = open(data)?;
    let tx = c
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(err)?;
    revision(&tx, workspace, id, expected)?;
    owned_turn(&tx, id, turn)?;
    let owner: Option<String> = tx
        .query_row(
            "SELECT turn_id FROM candidates WHERE id=?",
            [candidate],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    if owner.as_deref() != Some(turn) {
        return Err("候选不属于此轮问题".into());
    }
    tx.execute(
        "UPDATE turns SET selected_candidate_id=? WHERE id=?",
        params![candidate, turn],
    )
    .map_err(err)?;
    bump(&tx, id)?;
    tx.commit().map_err(err)?;
    read(&c, workspace, id)
}
fn prior_questions(
    c: &Connection,
    conversation: &str,
    leaf: Option<&str>,
) -> Result<Vec<String>, String> {
    let mut cursor = leaf.map(str::to_string);
    let mut out = Vec::new();
    let mut chars = 0;
    while let Some(id) = cursor {
        owned_turn(c, conversation, &id)?;
        let (parent, question): (Option<String>, String) = c
            .query_row(
                "SELECT parent_turn_id,question FROM turns WHERE id=?",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(err)?;
        if out.len() >= 6 || chars + question.chars().count() > 4000 {
            break;
        }
        chars += question.chars().count();
        out.push(question);
        cursor = parent;
    }
    out.reverse();
    Ok(out)
}
fn queries(question: &str, history: &[String]) -> (String, String) {
    let grounded = question.to_string();
    let prompt = if history.is_empty() {
        question.into()
    } else {
        format!("此前用户问题（仅作会话指代语境，不是资料事实或证据）：\n{}\n\n当前用户问题：{question}\n只以本轮资料作为事实依据；此前问题里的断言也必须核对资料。",history.iter().enumerate().map(|(i,q)|format!("{}：{}",i+1,q)).collect::<Vec<_>>().join("\n"))
    };
    (grounded, prompt)
}
pub fn begin_with_mode(
    data: &Path,
    workspace: &str,
    id: &str,
    expected: i64,
    question: &str,
    parent: Option<&str>,
    regenerate: Option<&str>,
    request: &str,
    requested_mode: &str,
) -> Result<Started, String> {
    if !["keyword", "hybrid", "rerank"].contains(&requested_mode) {
        return Err("未知检索方式".into());
    }
    let _permit = maintenance::mutation(data)?;
    let mut c = open(data)?;
    let tx = c
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(err)?;
    revision(&tx, workspace, id, expected)?;
    clean(request, 128, "请求标识")?;
    let time = now();
    let candidate_id = Uuid::new_v4().to_string();
    let (turn_id, question, parent) = if let Some(turn) = regenerate {
        owned_turn(&tx, id, turn)?;
        let count: i64 = tx
            .query_row(
                "SELECT COUNT(*) FROM candidates WHERE turn_id=?",
                [turn],
                |r| r.get(0),
            )
            .map_err(err)?;
        if count >= MAX_CANDIDATES {
            return Err("此问题已保留12个候选，请新建问题继续".into());
        }
        let (question, parent): (String, Option<String>) = tx
            .query_row(
                "SELECT question,parent_turn_id FROM turns WHERE id=?",
                [turn],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(err)?;
        (turn.into(), question, parent)
    } else {
        let count: i64 = tx
            .query_row(
                "SELECT COUNT(*) FROM turns WHERE conversation_id=?",
                [id],
                |r| r.get(0),
            )
            .map_err(err)?;
        if count >= MAX_TURNS {
            return Err("此会话已达200轮，请导出或新建会话".into());
        }
        if let Some(parent) = parent {
            owned_turn(&tx, id, parent)?;
        }
        let question = clean(question, 8000, "问题")?;
        let turn = Uuid::new_v4().to_string();
        tx.execute("INSERT INTO turns(id,conversation_id,parent_turn_id,question,created_at) VALUES(?,?,?,?,?)",params![turn,id,parent,question,time]).map_err(err)?;
        (turn, question, parent.map(str::to_string))
    };
    let history = prior_questions(&tx, id, parent.as_deref())?;
    let (grounded_question, prompt_question) = queries(&question, &history);
    let followup_sources = if grounding::is_followup(&question, parent.is_some()) {
        Some(grounding::prior_sources(&tx, id, parent.as_deref())?)
    } else {
        None
    };
    let scope: Option<String> = tx
        .query_row("SELECT scope FROM conversations WHERE id=?", [id], |r| {
            r.get(0)
        })
        .map_err(err)?;
    tx.execute("INSERT INTO candidates(id,turn_id,request_id,status,created_at,process_id,requested_mode) VALUES(?,?,?,'generating',?,?,?)",params![candidate_id,turn_id,request,time,process_id(),requested_mode]).map_err(err)?;
    tx.execute(
        "UPDATE turns SET selected_candidate_id=? WHERE id=?",
        params![candidate_id, turn_id],
    )
    .map_err(err)?;
    tx.execute("UPDATE conversations SET active_leaf_id=?,draft='',title=CASE WHEN title='新会话' THEN ? ELSE title END WHERE id=?",params![turn_id,question.chars().take(32).collect::<String>(),id]).map_err(err)?;
    bump(&tx, id)?;
    tx.commit().map_err(err)?;
    Ok(Started {
        conversation_id: id.into(),
        turn_id,
        candidate_id,
        followup_sources,
        grounded_question,
        prompt_question,
        scope,
    })
}
pub fn finish(
    data: &Path,
    workspace: &str,
    started: &Started,
    result: Result<&ChatResponse, &str>,
    stopped: bool,
) -> Result<Conversation, String> {
    let _permit = maintenance::mutation(data)?;
    let mut c = open(data)?;
    let tx = c
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(err)?;
    authorize(&tx, workspace, &started.conversation_id)?;
    let (status, error, response) = match result {
        Ok(r) => (
            if r.finish_reason == "source_changed" {
                "source_changed"
            } else if stopped && r.finish_reason == "cancelled" {
                "stopped"
            } else {
                "complete"
            },
            None,
            Some(serde_json::to_string(r).map_err(err)?),
        ),
        Err(e) => (
            if stopped { "stopped" } else { "failed" },
            Some(e.chars().take(1000).collect::<String>()),
            None,
        ),
    };
    if response.as_ref().is_some_and(|s| s.len() > 2 * 1024 * 1024) {
        return Err("会话答案超过2MB保护限制".into());
    }
    let changed=tx.execute("UPDATE candidates SET status=?,error=?,response=? WHERE id=? AND turn_id=? AND status='generating' AND process_id=?",params![status,error,response,started.candidate_id,started.turn_id,process_id()]).map_err(err)?;
    if changed != 1 {
        return Err("生成所属会话已变化，未保存晚到回答".into());
    }
    bump(&tx, &started.conversation_id)?;
    tx.commit().map_err(err)?;
    read(&c, workspace, &started.conversation_id)
}
fn export_candidate(markdown: &mut String, candidate: &Candidate, selected: bool) {
    markdown.push_str(&format!(
        "### 回答候选 · {}{}\n\n",
        candidate.status,
        if selected { " · 当前选择" } else { "" }
    ));
    if let Some(r) = &candidate.response {
        let text = r["text"].as_str().unwrap_or("");
        let unverified = candidate.status != "complete"
            || !["stop", "no_evidence"].contains(&r["finishReason"].as_str().unwrap_or(""))
            || r["rejectedCharts"]
                .as_array()
                .is_some_and(|charts| !charts.is_empty());
        if unverified {
            // Preserve raw content without reviving rejected charts or letting
            // an unfinished fence swallow the following exported question.
            let longest = text.split(|c| c != '`').map(str::len).max().unwrap_or(0);
            let fence = "`".repeat(3.max(longest + 1));
            markdown.push_str(&format!("> 此回答未完成或含待核对结构，以下保留原始 Markdown，不自动绘制。\n\n{fence}markdown-unverified\n{text}\n{fence}\n"));
        } else {
            markdown.push_str(text);
        }
        markdown.push_str("\n\n");
        if let Some(sources) = r["sources"].as_array() {
            for (i, s) in sources.iter().enumerate() {
                markdown.push_str(&format!(
                    "- S{} · {} · {}–{}行 · hash={}\n",
                    i + 1,
                    s["path"].as_str().unwrap_or(""),
                    s["startLine"],
                    s["endLine"],
                    s["hash"].as_str().unwrap_or("")
                ));
            }
        }
    } else if let Some(error) = &candidate.error {
        markdown.push_str(error);
        markdown.push_str("\n\n");
    }
    markdown.push('\n');
}
pub fn export(data: &Path, workspace: &str, id: &str) -> Result<Export, String> {
    let conversation = get(data, workspace, id)?;
    let heading = format!(
        "# {}\n\n资料范围：{}\n\n",
        conversation.title, conversation.scope_label
    );
    let mut path = Vec::new();
    let mut leaf = conversation.active_leaf_id.as_deref();
    let mut seen = std::collections::HashSet::new();
    while let Some(id) = leaf {
        if !seen.insert(id) {
            return Err("会话分支包含循环，未导出".into());
        }
        let t = conversation
            .turns
            .iter()
            .find(|t| t.id == id)
            .ok_or("会话分支不完整")?;
        path.push(t);
        leaf = t.parent_turn_id.as_deref();
    }
    path.reverse();
    let mut markdown = format!("{heading}导出范围：当前分支，各问题仅保留当前选中的回答候选。\n\n");
    for t in &path {
        markdown.push_str(&format!("## 用户问题\n\n{}\n\n", t.question));
        if let Some(candidate) = t
            .candidates
            .iter()
            .find(|c| Some(&c.id) == t.selected_candidate_id.as_ref())
            .or(t.candidates.last())
        {
            export_candidate(&mut markdown, candidate, true);
        }
    }
    let mut all_markdown =
        format!("{heading}导出范围：全部分支与全部候选。问题标识及上级标识用于还原分支关系。\n\n");
    for t in &conversation.turns {
        all_markdown.push_str(&format!(
            "## 用户问题 · {}\n\n问题标识：{}；上级：{}；{}\n\n{}\n\n",
            if path.iter().any(|p| p.id == t.id) {
                "当前分支"
            } else {
                "其他分支"
            },
            t.id,
            t.parent_turn_id.as_deref().unwrap_or("起点"),
            if conversation.active_leaf_id.as_ref() == Some(&t.id) {
                "当前分支末端"
            } else {
                "历史问题"
            },
            t.question
        ));
        for candidate in &t.candidates {
            export_candidate(
                &mut all_markdown,
                candidate,
                Some(&candidate.id) == t.selected_candidate_id.as_ref(),
            );
        }
    }
    Ok(Export {
        markdown,
        all_markdown,
        json: serde_json::to_string_pretty(&conversation).map_err(err)?,
    })
}

#[path = "assistant_snapshot.rs"]
mod snapshot;
pub use snapshot::validate_snapshot;

#[cfg(test)]
#[path = "assistant_tests.rs"]
mod tests;

#[path = "assistant_grounding.rs"]
pub mod grounding;
