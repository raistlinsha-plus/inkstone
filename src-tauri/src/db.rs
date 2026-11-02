use crate::{files, models::*};
use rusqlite::{params, Connection, OptionalExtension};
use std::{
    collections::{HashMap, HashSet},
    path::Path,
    sync::Once,
};

static INIT: Once = Once::new();
pub fn open(path: &Path) -> Result<Connection, String> {
    open_with_timeout(path, std::time::Duration::from_secs(5))
}
pub fn open_with_timeout(path: &Path, timeout: std::time::Duration) -> Result<Connection, String> {
    INIT.call_once(|| unsafe {
        rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute(
            sqlite_vec::sqlite3_vec_init as *const (),
        )));
    });
    let mut conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.busy_timeout(timeout).map_err(|e| e.to_string())?;
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if version > 3 {
        return Err("知识索引由更新版本创建，请使用新版应用".into());
    }
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS documents(path TEXT PRIMARY KEY, hash TEXT NOT NULL, embedding_profile TEXT NOT NULL DEFAULT '', indexed_at INTEGER NOT NULL DEFAULT (unixepoch()));
        CREATE TABLE IF NOT EXISTS chunks(id INTEGER PRIMARY KEY, path TEXT NOT NULL REFERENCES documents(path) ON DELETE CASCADE, hash TEXT NOT NULL, text TEXT NOT NULL, heading TEXT NOT NULL, start_line INTEGER NOT NULL, end_line INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS chunks_path ON chunks(path);").map_err(|e| e.to_string())?;
    if version < 2 {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let has_title: bool = tx
            .prepare("PRAGMA table_info(documents)")
            .and_then(|mut q| {
                q.query_map([], |r| r.get::<_, String>(1))?
                    .collect::<Result<Vec<_>, _>>()
            })
            .map_err(|e| e.to_string())?
            .iter()
            .any(|x| x == "title");
        if !has_title {
            tx.execute(
                "ALTER TABLE documents ADD COLUMN title TEXT NOT NULL DEFAULT ''",
                [],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.execute_batch("DROP TABLE IF EXISTS chunk_fts; CREATE VIRTUAL TABLE chunk_fts USING fts5(title,heading,field_path,text);").map_err(|e| e.to_string())?;
        let rows = tx
            .prepare("SELECT id,path,heading,text FROM chunks")
            .and_then(|mut q| {
                q.query_map([], |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()
            })
            .map_err(|e| e.to_string())?;
        for (id, path, heading, text) in rows {
            let title = file_title(&path);
            tx.execute(
                "UPDATE documents SET title=? WHERE path=? AND title=''",
                params![title, path],
            )
            .map_err(|e| e.to_string())?;
            write_fts(&tx, id, &title, &heading, &text)?;
        }
        tx.pragma_update(None, "user_version", 2)
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    conn.execute_batch("CREATE TABLE IF NOT EXISTS chunk_manifests(path TEXT PRIMARY KEY REFERENCES documents(path) ON DELETE CASCADE,manifest TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS index_attempts(path TEXT PRIMARY KEY,source_hash TEXT NOT NULL,profile TEXT NOT NULL,status TEXT NOT NULL,updated INTEGER NOT NULL DEFAULT (unixepoch()));
CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(title,heading,field_path,text);
PRAGMA user_version=3;").map_err(|e|e.to_string())?;
    Ok(conn)
}

pub fn chunk_manifest(conn: &Connection, path: &str) -> Result<Option<ChunkManifest>, String> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT manifest FROM chunk_manifests WHERE path=?",
            [path],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    raw.map(|v| serde_json::from_str(&v).map_err(|_| "切片来源记录损坏".to_string()))
        .transpose()
}
pub fn set_chunk_manifest(
    conn: &Connection,
    path: &str,
    manifest: &ChunkManifest,
) -> Result<(), String> {
    let matches: bool = conn
        .query_row(
            "SELECT hash=? FROM documents WHERE path=?",
            params![manifest.source_hash, path],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or(false);
    if !matches {
        return Err("文档已变，切片来源记录未提交".into());
    }
    conn.execute(
        "INSERT OR REPLACE INTO chunk_manifests VALUES(?,?)",
        params![
            path,
            serde_json::to_string(manifest).map_err(|e| e.to_string())?
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
pub struct IndexAttempt {
    pub source_hash: String,
    pub profile: String,
    pub status: String,
}
pub fn index_attempt(conn: &Connection, path: &str) -> Result<Option<IndexAttempt>, String> {
    conn.query_row(
        "SELECT source_hash,profile,status FROM index_attempts WHERE path=?",
        [path],
        |r| {
            Ok(IndexAttempt {
                source_hash: r.get(0)?,
                profile: r.get(1)?,
                status: r.get(2)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}
pub fn record_attempt(
    conn: &Connection,
    path: &str,
    hash: &str,
    profile: &str,
    status: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO index_attempts(path,source_hash,profile,status) VALUES(?,?,?,?)",
        params![path, hash, profile, status],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
fn file_title(path: &str) -> String {
    Path::new(path)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string()
}
fn write_fts(
    conn: &Connection,
    id: i64,
    title: &str,
    heading: &str,
    text: &str,
) -> Result<(), String> {
    let field = heading.rsplit(" / ").next().unwrap_or("");
    conn.execute(
        "INSERT INTO chunk_fts(rowid,title,heading,field_path,text) VALUES(?,?,?,?,?)",
        params![
            id,
            tokenize(title),
            tokenize(heading),
            tokenize(field),
            tokenize(text)
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn meta(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM meta WHERE key=?", [key], |r| r.get(0))
        .optional()
        .ok()
        .flatten()
}
pub fn set_meta(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO meta VALUES(?,?)",
        params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
fn has_vectors(conn: &Connection) -> bool {
    conn.query_row(
        "SELECT count(*) FROM sqlite_master WHERE name='vectors'",
        [],
        |r| r.get::<_, i64>(0),
    )
    .unwrap_or(0)
        > 0
}
pub fn delete_document(conn: &Connection, path: &str) -> Result<(), String> {
    if has_vectors(conn) {
        conn.execute(
            "DELETE FROM vectors WHERE rowid IN (SELECT id FROM chunks WHERE path=?)",
            [path],
        )
        .map_err(|e| e.to_string())?;
    }
    conn.execute(
        "DELETE FROM chunk_fts WHERE rowid IN (SELECT id FROM chunks WHERE path=?)",
        [path],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM documents WHERE path=?", [path])
        .map_err(|e| e.to_string())?;
    Ok(())
}
/// An expired indexing job may invalidate only its own document version.
pub fn delete_document_if_hash(
    conn: &mut Connection,
    path: &str,
    expected_hash: &str,
) -> Result<bool, String> {
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let matches = tx
        .query_row(
            "SELECT hash=? FROM documents WHERE path=?",
            params![expected_hash, path],
            |r| r.get::<_, bool>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or(false);
    if matches {
        delete_document(&tx, path)?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(matches)
}
pub fn tokenize(text: &str) -> String {
    static JIEBA: std::sync::OnceLock<jieba_rs::Jieba> = std::sync::OnceLock::new();
    JIEBA
        .get_or_init(jieba_rs::Jieba::new)
        .cut_for_search(text, true)
        .into_iter()
        .filter(|s| s.chars().any(char::is_alphanumeric))
        .map(str::to_lowercase)
        .collect::<Vec<_>>()
        .join(" ")
}
pub fn index_text(
    conn: &mut Connection,
    path: &str,
    hash: &str,
    chunks: &[ChunkInput],
) -> Result<Vec<i64>, String> {
    let title = conn
        .query_row("SELECT title FROM documents WHERE path=?", [path], |r| {
            r.get::<_, String>(0)
        })
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| file_title(path));
    replace_text(conn, path, hash, chunks, &title)
}
fn replace_text(
    conn: &mut Connection,
    path: &str,
    hash: &str,
    chunks: &[ChunkInput],
    title: &str,
) -> Result<Vec<i64>, String> {
    let title = if title.trim().is_empty() {
        file_title(path)
    } else {
        title.to_string()
    };
    let title = title.as_str();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    delete_document(&tx, path)?;
    tx.execute(
        "INSERT INTO documents(path,hash,title) VALUES(?,?,?)",
        params![path, hash, title],
    )
    .map_err(|e| e.to_string())?;
    let mut ids = vec![];
    for c in chunks {
        tx.execute(
            "INSERT INTO chunks(path,hash,text,heading,start_line,end_line) VALUES(?,?,?,?,?,?)",
            params![path, hash, c.text, c.heading, c.start_line, c.end_line],
        )
        .map_err(|e| e.to_string())?;
        let id = tx.last_insert_rowid();
        write_fts(&tx, id, title, &c.heading, &c.text)?;
        ids.push(id);
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(ids)
}
pub fn update_title(conn: &Connection, path: &str, title: &str) -> Result<(), String> {
    let title = if title.trim().is_empty() {
        file_title(path)
    } else {
        title.to_string()
    };
    let title = title.as_str();
    let old: Option<String> = conn
        .query_row("SELECT title FROM documents WHERE path=?", [path], |r| {
            r.get(0)
        })
        .optional()
        .map_err(|e| e.to_string())?;
    if old.as_deref() == Some(title) || old.is_none() {
        return Ok(());
    }
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let rows = tx
        .prepare("SELECT id,heading,text FROM chunks WHERE path=?")
        .and_then(|mut q| {
            q.query_map([path], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()
        })
        .map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE documents SET title=? WHERE path=?",
        params![title, path],
    )
    .map_err(|e| e.to_string())?;
    for (id, heading, text) in rows {
        tx.execute("DELETE FROM chunk_fts WHERE rowid=?", [id])
            .map_err(|e| e.to_string())?;
        write_fts(&tx, id, title, &heading, &text)?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}
/// A local title refresh must not discard paid vectors for unchanged body content.
pub fn refresh_lexical(
    conn: &mut Connection,
    path: &str,
    hash: &str,
    chunks: &[ChunkInput],
    title: &str,
) -> Result<Vec<i64>, String> {
    let unchanged = conn
        .query_row(
            "SELECT hash=? FROM documents WHERE path=?",
            params![hash, path],
            |r| r.get::<_, bool>(0),
        )
        .unwrap_or(false);
    if unchanged {
        update_title(conn, path, title)?;
        return conn
            .prepare("SELECT id FROM chunks WHERE path=? ORDER BY id")
            .and_then(|mut q| {
                q.query_map([path], |r| r.get(0))?
                    .collect::<Result<Vec<_>, _>>()
            })
            .map_err(|e| e.to_string());
    }
    let ids = replace_text(conn, path, hash, chunks, title)?;
    set_chunk_manifest(
        conn,
        path,
        &ChunkManifest {
            strategy: "lexical".into(),
            version: 1,
            source_hash: hash.into(),
            embedding_profile: None,
        },
    )?;
    Ok(ids)
}
/// Bounded local-only slicing for immediate keyword visibility; semantic indexing keeps its richer worker parser.
pub fn local_chunks(content: &str, path: &str, max: usize) -> Vec<ChunkInput> {
    let max = max.clamp(128, 12000);
    let mut chunks = vec![];
    let mut buffer = String::new();
    let mut heading = String::new();
    let mut start = 1;
    let mut end = 1;
    let mut fence = false;
    let markdown =
        path.to_lowercase().ends_with(".md") || path.to_lowercase().ends_with(".markdown");
    let flush = |chunks: &mut Vec<ChunkInput>,
                 buffer: &mut String,
                 heading: &str,
                 start: usize,
                 end: usize| {
        if !buffer.trim().is_empty() {
            chunks.push(ChunkInput {
                text: std::mem::take(buffer),
                heading: heading.to_string(),
                start_line: start,
                end_line: end,
            });
        } else {
            buffer.clear();
        }
    };
    for (i, line) in content.lines().enumerate() {
        let number = i + 1;
        let trim = line.trim_start();
        if markdown
            && !fence
            && trim.starts_with('#')
            && trim.chars().take_while(|c| *c == '#').count() <= 6
        {
            flush(&mut chunks, &mut buffer, &heading, start, end);
            heading = trim
                .trim_start_matches('#')
                .trim()
                .chars()
                .take(180)
                .collect();
        }
        if markdown && (trim.starts_with("~~~") || trim.as_bytes().starts_with(&[96, 96, 96])) {
            fence = !fence;
        }
        let chars: Vec<char> = line.chars().collect();
        for part in chars.chunks(max - 1) {
            if !buffer.is_empty() && buffer.chars().count() + part.len() + 1 > max {
                flush(&mut chunks, &mut buffer, &heading, start, end);
            }
            if buffer.is_empty() {
                start = number;
            }
            buffer.extend(part);
            buffer.push('\n');
            end = number;
            if buffer.chars().count() >= max {
                flush(&mut chunks, &mut buffer, &heading, start, end);
            }
        }
        if chars.is_empty() && !buffer.is_empty() {
            buffer.push('\n');
            end = number;
            if !fence || buffer.chars().count() >= max {
                flush(&mut chunks, &mut buffer, &heading, start, end);
            }
        }
    }
    flush(&mut chunks, &mut buffer, &heading, start, end);
    chunks
}

pub fn indexed(conn: &Connection, path: &str, hash: &str, profile: &str) -> bool {
    conn.query_row(
        "SELECT hash=? AND embedding_profile=? FROM documents WHERE path=?",
        params![hash, profile, path],
        |r| r.get::<_, bool>(0),
    )
    .unwrap_or(false)
}
pub fn keyword_complete(conn: &Connection, path: &str, hash: &str) -> bool {
    conn.query_row("SELECT hash=?2 AND (SELECT count(*) FROM chunks WHERE path=?1 AND hash=?2)=(SELECT count(*) FROM chunk_fts WHERE rowid IN (SELECT id FROM chunks WHERE path=?1 AND hash=?2)) FROM documents WHERE path=?1",params![path,hash],|r|r.get::<_,bool>(0)).unwrap_or(false)
}
/// A profile marker alone cannot prove vectors survived a cache repair or interruption.
pub fn vectors_complete(conn: &Connection, path: &str, hash: &str, profile: &str) -> bool {
    if !indexed(conn, path, hash, profile) {
        return false;
    }
    let chunks: usize = conn
        .query_row(
            "SELECT count(*) FROM chunks WHERE path=? AND hash=?",
            params![path, hash],
            |r| r.get(0),
        )
        .unwrap_or(usize::MAX);
    if chunks == 0 {
        return true;
    }
    if !has_vectors(conn) || meta(conn, "vector_profile").as_deref() != Some(profile) {
        return false;
    }
    conn.query_row("SELECT count(*) FROM vectors v JOIN chunks c ON c.id=v.rowid WHERE c.path=? AND c.hash=? AND v.doc_path=c.path",params![path,hash],|r|r.get::<_,usize>(0)).is_ok_and(|count|count==chunks)
}
pub fn mark_plain(conn: &Connection, path: &str, profile: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE documents SET embedding_profile=? WHERE path=?",
        params![profile, path],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
pub fn ensure_vectors(conn: &Connection, profile: &str, dim: usize) -> Result<(), String> {
    if dim == 0 || dim > 16384 {
        return Err("模型返回的向量维度无效（支持 1～16384）".into());
    }
    if meta(conn, "vector_profile").as_deref() != Some(profile)
        || meta(conn, "vector_dim").as_deref() != Some(&dim.to_string())
        || !has_vectors(conn)
    {
        conn.execute_batch(&format!("DROP TABLE IF EXISTS vectors; CREATE VIRTUAL TABLE vectors USING vec0(embedding float[{dim}], doc_path text); UPDATE documents SET embedding_profile='';")).map_err(|e|e.to_string())?;
        set_meta(conn, "vector_profile", profile)?;
        set_meta(conn, "vector_dim", &dim.to_string())?;
    }
    Ok(())
}
pub fn put_vectors_checked(
    conn: &mut Connection,
    path: &str,
    expected_hash: &str,
    profile: &str,
    ids: &[i64],
    vectors: &[Vec<f32>],
) -> Result<(), String> {
    if ids.len() != vectors.len() || vectors.is_empty() {
        return Err("向量数量与切片不一致".into());
    }
    let dim = vectors[0].len();
    if dim == 0
        || dim > 16384
        || vectors
            .iter()
            .any(|v| v.len() != dim || v.iter().any(|x| !x.is_finite()))
    {
        return Err("向量维度或数值无效".into());
    }
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let current = tx
        .query_row(
            "SELECT hash=? FROM documents WHERE path=?",
            params![expected_hash, path],
            |r| r.get::<_, bool>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or(false);
    let count: usize = tx
        .query_row(
            "SELECT count(*) FROM chunks WHERE path=? AND hash=?",
            params![path, expected_hash],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !current || count != ids.len() || ids.iter().collect::<HashSet<_>>().len() != ids.len() {
        return Err("文档版本或切片已失效，请更新索引".into());
    }
    {
        let mut q = tx
            .prepare("SELECT EXISTS(SELECT 1 FROM chunks WHERE id=? AND path=? AND hash=?)")
            .map_err(|e| e.to_string())?;
        for id in ids {
            if !q
                .query_row(params![id, path, expected_hash], |r| r.get::<_, bool>(0))
                .map_err(|e| e.to_string())?
            {
                return Err("文档版本或切片已失效，请更新索引".into());
            }
        }
    }
    ensure_vectors(&tx, profile, vectors[0].len())?;
    for (id, vec) in ids.iter().zip(vectors) {
        tx.execute(
            "INSERT INTO vectors(rowid,embedding,doc_path) VALUES(?,?,?)",
            params![id, serde_json::to_string(vec).unwrap(), path],
        )
        .map_err(|e| e.to_string())?;
    }
    mark_plain(&tx, path, profile)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}
#[cfg(test)]
pub fn put_vectors(
    conn: &mut Connection,
    path: &str,
    profile: &str,
    ids: &[i64],
    vectors: &[Vec<f32>],
) -> Result<(), String> {
    let hash: String = conn
        .query_row("SELECT hash FROM documents WHERE path=?", [path], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;
    put_vectors_checked(conn, path, &hash, profile, ids, vectors)
}
pub fn paths(conn: &Connection) -> Result<Vec<String>, String> {
    let mut s = conn
        .prepare("SELECT path FROM documents")
        .map_err(|e| e.to_string())?;
    let rows = s.query_map([], |r| r.get(0)).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}
pub fn stats(conn: &Connection, profile: &str) -> Stats {
    let count = |sql: &str| {
        conn.query_row(sql, [], |r| r.get::<_, usize>(0))
            .unwrap_or(0)
    };
    let matching = meta(conn, "vector_profile").as_deref() == Some(profile) && has_vectors(conn);
    let vectors = if matching {
        count("SELECT count(*) FROM vectors")
    } else {
        0
    };
    let documents = count("SELECT count(*) FROM documents");
    let vector_documents = if matching {
        conn.query_row("SELECT count(*) FROM documents WHERE embedding_profile=? AND EXISTS(SELECT 1 FROM vectors WHERE doc_path=documents.path)", [profile], |r|r.get::<_,usize>(0)).unwrap_or(0)
    } else {
        0
    };
    Stats {
        documents,
        keyword_documents: documents,
        vector_documents,
        total_documents: None,
        chunks: count("SELECT count(*) FROM chunks"),
        vectors,
        embedding_ready: vectors > 0,
    }
}
#[derive(Clone, Debug)]
pub struct RankedHit {
    pub id: i64,
    pub score: f64,
    pub hash: Option<String>,
}
pub fn query_terms(query: &str) -> Vec<String> {
    let stop: HashSet<&str> = [
        "的",
        "了",
        "是",
        "我",
        "你",
        "请",
        "什么",
        "如何",
        "怎么",
        "有哪些",
        "吗",
        "呢",
        "多少",
        "是否",
        "可以",
        "一个",
        "这个",
        "资料",
        "文档",
        "中",
        "里",
        "根据",
        "请问",
        "告诉",
        "告诉我",
        "怎样",
        "何时",
        "哪里",
        "哪儿",
        "哪个",
        "哪些",
        "多久",
        "多长",
        "为什么",
        "为何",
        "能否",
        "应该",
        "需要",
        "需",
        "才",
        "能",
        "会",
        "应",
        "与",
        "和",
        "及",
        "从",
        "把",
        "被",
        "将",
    ]
    .into_iter()
    .collect();
    let mut seen = HashSet::new();
    tokenize(query)
        .split_whitespace()
        .filter(|s| !stop.contains(s) && seen.insert((*s).to_string()))
        .take(40)
        .map(str::to_string)
        .collect()
}
pub fn lexical_scored(
    conn: &Connection,
    query: &str,
    scope: Option<&str>,
) -> Result<Vec<RankedHit>, String> {
    let terms = query_terms(query)
        .iter()
        .map(|s| format!("\"{}\"", s.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" OR ");
    if terms.is_empty() {
        return Ok(vec![]);
    }
    let sql="SELECT chunk_fts.rowid,bm25(chunk_fts,5.0,3.0,2.0,1.0),c.hash FROM chunk_fts JOIN chunks c ON c.id=chunk_fts.rowid WHERE chunk_fts MATCH ?1 AND (?2 IS NULL OR c.path=?2) ORDER BY bm25(chunk_fts,5.0,3.0,2.0,1.0),chunk_fts.rowid LIMIT 60";
    conn.prepare(sql)
        .and_then(|mut q| {
            q.query_map(params![terms, scope], |r| {
                Ok(RankedHit {
                    id: r.get(0)?,
                    score: r.get(1)?,
                    hash: r.get(2)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()
        })
        .map_err(|_| "本地关键词索引查询失败，请更新或重建知识库".into())
}
#[cfg(test)]
pub fn lexical(conn: &Connection, query: &str, scope: Option<&str>) -> Vec<i64> {
    lexical_scored(conn, query, scope)
        .unwrap_or_default()
        .into_iter()
        .map(|x| x.id)
        .collect()
}
pub fn nearest_scored(
    conn: &Connection,
    vector: &[f32],
    scope: Option<&str>,
) -> Result<Vec<RankedHit>, String> {
    if !has_vectors(conn) {
        return Ok(vec![]);
    }
    let json = serde_json::to_string(vector).map_err(|e| e.to_string())?;
    let (sql, bindings): (&str, Vec<rusqlite::types::Value>) = if let Some(scope) = scope {
        ("SELECT vectors.rowid,vectors.distance,chunks.hash FROM vectors JOIN chunks ON chunks.id=vectors.rowid WHERE embedding MATCH ? AND k=60 AND doc_path=? ORDER BY distance",vec![json.into(),scope.to_string().into()])
    } else {
        (
            "SELECT vectors.rowid,vectors.distance,chunks.hash FROM vectors JOIN chunks ON chunks.id=vectors.rowid WHERE embedding MATCH ? AND k=60 ORDER BY distance",
            vec![json.into()],
        )
    };
    conn.prepare(sql)
        .and_then(|mut q| {
            q.query_map(rusqlite::params_from_iter(bindings), |r| {
                Ok(RankedHit {
                    id: r.get(0)?,
                    score: r.get(1)?,
                    hash: r.get(2)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()
        })
        .map_err(|_| "向量索引查询失败".into())
}
#[cfg(test)]
pub fn nearest(conn: &Connection, vector: &[f32], scope: Option<&str>) -> Result<Vec<i64>, String> {
    Ok(nearest_scored(conn, vector, scope)?
        .into_iter()
        .map(|x| x.id)
        .collect())
}
pub fn merge_candidates(
    conn: &Connection,
    workspace: &Workspace,
    lexical: &[RankedHit],
    vectors: &[RankedHit],
) -> Result<Vec<SearchResult>, String> {
    let mut scores = HashMap::<i64, f64>::new();
    for ranking in [lexical, vectors] {
        for (rank, hit) in ranking.iter().enumerate() {
            *scores.entry(hit.id).or_default() += 1.0 / (61.0 + rank as f64);
        }
    }
    let mut scored = scores.into_iter().collect::<Vec<_>>();
    scored.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
    let mut valid = HashMap::<String, bool>::new();
    let mut results = vec![];
    let mut stmt=conn.prepare("SELECT c.path,c.text,c.heading,c.start_line,c.end_line,c.hash,d.title FROM chunks c JOIN documents d ON d.path=c.path WHERE c.id=?").map_err(|e|e.to_string())?;
    for (id, score) in scored {
        let bm25_rank = lexical.iter().position(|h| h.id == id).map(|i| i + 1);
        let vector_rank = vectors.iter().position(|h| h.id == id).map(|i| i + 1);
        let result = stmt.query_row([id], |r| {
            Ok(SearchResult {
                id,
                path: r.get(0)?,
                text: r.get(1)?,
                heading: r.get(2)?,
                start_line: r.get(3)?,
                end_line: r.get(4)?,
                hash: r.get(5)?,
                score,
                title: r.get::<_, Option<String>>(6)?,
                document_id: None,
                bm25_score: lexical.iter().find(|h| h.id == id).map(|h| h.score),
                vector_distance: vectors.iter().find(|h| h.id == id).map(|h| h.score),
                bm25_rank,
                vector_rank,
                rerank_score: None,
                evidence: bm25_rank.is_some(),
                match_kind: if bm25_rank.is_some() {
                    "keyword".into()
                } else {
                    "candidate".into()
                },
            })
        });
        if let Ok(mut result) = result {
            let valid_hit = |hit: &&RankedHit| {
                hit.id == id && hit.hash.as_ref().is_none_or(|hash| hash == &result.hash)
            };
            result.bm25_rank = lexical
                .iter()
                .enumerate()
                .find(|(_, hit)| valid_hit(hit))
                .map(|(rank, _)| rank + 1);
            result.vector_rank = vectors
                .iter()
                .enumerate()
                .find(|(_, hit)| valid_hit(hit))
                .map(|(rank, _)| rank + 1);
            result.bm25_score = lexical.iter().find(valid_hit).map(|h| h.score);
            result.vector_distance = vectors.iter().find(valid_hit).map(|h| h.score);
            if result.bm25_rank.is_none() && result.vector_rank.is_none() {
                continue;
            }
            result.score = result
                .bm25_rank
                .into_iter()
                .chain(result.vector_rank)
                .map(|rank| 1.0 / (60.0 + rank as f64))
                .sum();
            result.evidence = result.bm25_rank.is_some();
            result.match_kind = if result.evidence {
                "keyword"
            } else {
                "candidate"
            }
            .into();
            let current = *valid.entry(result.path.clone()).or_insert_with(|| {
                files::resolve(&workspace.root, &result.path, false)
                    .and_then(|p| files::read_text(&p))
                    .map(|s| files::hash(s) == result.hash)
                    .unwrap_or(false)
            });
            if current {
                results.push(result);
            }
        }
    }
    results.sort_by(|a, b| b.score.total_cmp(&a.score).then(a.id.cmp(&b.id)));
    Ok(results)
}
#[cfg(test)]
pub fn merge(conn: &Connection, workspace: &Workspace, ranks: &[Vec<i64>]) -> Vec<SearchResult> {
    let hits = |ranking: Option<&Vec<i64>>| {
        ranking
            .into_iter()
            .flatten()
            .map(|id| RankedHit {
                id: *id,
                score: 0.0,
                hash: None,
            })
            .collect::<Vec<_>>()
    };
    merge_candidates(conn, workspace, &hits(ranks.first()), &hits(ranks.get(1)))
        .unwrap_or_default()
        .into_iter()
        .take(12)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stats_distinguish_keyword_documents_from_selected_profile_vector_documents() {
        let dir = tempfile::tempdir().unwrap();
        let mut conn = open(&dir.path().join("index.db")).unwrap();
        for path in ["a.md", "b.md"] {
            let ids = index_text(
                &mut conn,
                path,
                "hash",
                &[ChunkInput {
                    text: "测试资料".into(),
                    heading: String::new(),
                    start_line: 1,
                    end_line: 1,
                }],
            )
            .unwrap();
            if path == "a.md" {
                put_vectors(&mut conn, path, "model-a", &ids, &[vec![1.0, 0.0]]).unwrap();
            }
        }
        let current = stats(&conn, "model-a");
        assert_eq!(current.documents, 2);
        assert_eq!(current.keyword_documents, 2);
        assert_eq!(current.vector_documents, 1);
        assert_eq!(current.total_documents, None);
        let switched = stats(&conn, "model-b");
        assert_eq!(switched.vector_documents, 0);
        assert!(!switched.embedding_ready);
    }
    #[test]
    fn chinese_search_vectors_scope_and_delete() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let ws = Workspace {
            root: root.clone(),
            db: root.join("index.db"),
        };
        let mut c = open(&ws.db).unwrap();
        for (path, text, vec) in [
            ("a.md", "苹果电脑的本地知识库", vec![1.0, 0.0]),
            ("b.md", "苹果电脑上的网络搜索", vec![0.0, 1.0]),
        ] {
            std::fs::write(root.join(path), text).unwrap();
            let ids = index_text(
                &mut c,
                path,
                &files::hash(text),
                &[ChunkInput {
                    text: text.into(),
                    heading: "测试".into(),
                    start_line: 1,
                    end_line: 1,
                }],
            )
            .unwrap();
            put_vectors(&mut c, path, "model-a", &ids, &[vec]).unwrap();
        }
        assert_eq!(lexical(&c, "知识库", None).len(), 1);
        assert_eq!(nearest(&c, &[1.0, 0.0], Some("b.md")).unwrap().len(), 1);
        let ranks = vec![
            lexical(&c, "苹果", None),
            nearest(&c, &[1.0, 0.0], None).unwrap(),
        ];
        assert_eq!(merge(&c, &ws, &ranks).len(), 2);
        std::fs::write(root.join("a.md"), "已更新").unwrap();
        assert_eq!(merge(&c, &ws, &ranks).len(), 1);
        delete_document(&c, "b.md").unwrap();
        assert_eq!(stats(&c, "model-a").vectors, 1);
        ensure_vectors(&c, "model-b", 3).unwrap();
        assert_eq!(stats(&c, "model-b").vectors, 0);
    }
}

#[cfg(test)]
mod migration_tests {
    use super::*;
    fn chunks(text: &str) -> Vec<ChunkInput> {
        vec![ChunkInput {
            text: text.into(),
            heading: "正文".into(),
            start_line: 1,
            end_line: 1,
        }]
    }
    #[test]
    fn migration_preserves_paid_vectors_and_title_changes_do_not_replace_ids() {
        let d = tempfile::tempdir().unwrap();
        let path = d.path().join("index.sqlite3");
        let mut c = open(&path).unwrap();
        let ids = index_text(&mut c, "a.md", "hash", &chunks("保留的内容")).unwrap();
        put_vectors(&mut c, "a.md", "model", &ids, &[vec![1.0, 0.0]]).unwrap();
        c.execute_batch("DROP TABLE chunk_fts; CREATE VIRTUAL TABLE chunk_fts USING fts5(text); ALTER TABLE documents DROP COLUMN title; PRAGMA user_version=1;").unwrap();
        drop(c);
        let mut c = open(&path).unwrap();
        assert_eq!(stats(&c, "model").vectors, 1);
        assert_eq!(nearest_scored(&c, &[1.0, 0.0], None).unwrap()[0].id, ids[0]);
        let same = refresh_lexical(
            &mut c,
            "a.md",
            "hash",
            &chunks("不得覆盖旧块"),
            "量子石墨烯项目",
        )
        .unwrap();
        assert_eq!(same, ids);
        assert_eq!(stats(&c, "model").vectors, 1);
        assert!(!lexical_scored(&c, "石墨烯", None).unwrap().is_empty());
        assert_eq!(
            c.query_row("SELECT text FROM chunks WHERE id=?", [ids[0]], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "保留的内容"
        );
        refresh_lexical(
            &mut c,
            "a.md",
            "new-hash",
            &chunks("最新离线正文"),
            "量子石墨烯项目",
        )
        .unwrap();
        assert_eq!(stats(&c, "model").vectors, 0);
        assert!(!lexical_scored(&c, "最新离线正文", None).unwrap().is_empty());
    }
    #[test]
    fn broken_fts_is_an_error_not_a_false_empty_result() {
        let d = tempfile::tempdir().unwrap();
        let c = open(&d.path().join("index")).unwrap();
        c.execute_batch("DROP TABLE chunk_fts").unwrap();
        assert!(lexical_scored(&c, "源码", None).is_err());
    }
    #[test]
    fn local_keyword_chunks_keep_real_lines_and_unicode_bounds() {
        let text = format!(
            "# 第一节\n\n{}\n\n# 第二节\n精确数值 9007199254740993\n",
            "中文".repeat(180)
        );
        let chunks = local_chunks(&text, "test.md", 128);
        assert!(chunks.iter().all(|c| c.text.chars().count() <= 128
            && c.start_line > 0
            && c.end_line >= c.start_line));
        assert!(chunks.iter().any(|c| c.heading == "第二节"
            && c.text.contains("9007199254740993")
            && c.end_line == 6));
    }
    #[test]
    fn fenced_blank_lines_cannot_exceed_keyword_chunk_bound() {
        let text = format!(
            "~~~json\n{{\n{}\"key\":\"value\"\n}}\n~~~\n",
            "\n".repeat(500)
        );
        let chunks = local_chunks(&text, "test.md", 128);
        assert!(chunks.iter().all(|c| c.text.chars().count() <= 128));
        assert!(chunks
            .iter()
            .any(|c| c.text.contains("value") && c.start_line <= 503 && c.end_line >= 503));
    }
}

#[cfg(test)]
mod version_snapshot_tests {
    use super::*;
    fn chunks(text: &str) -> Vec<ChunkInput> {
        vec![ChunkInput {
            text: text.into(),
            heading: "".into(),
            start_line: 1,
            end_line: 1,
        }]
    }
    #[test]
    fn delayed_embedding_and_cleanup_preserve_new_local_keyword_version() {
        let d = tempfile::tempdir().unwrap();
        let db = d.path().join("index");
        let mut old_job = open(&db).unwrap();
        let old_hash = files::hash("旧苹果");
        let new_hash = files::hash("新香蕉");
        let ids =
            refresh_lexical(&mut old_job, "a.md", &old_hash, &chunks("旧苹果"), "旧标题").unwrap();
        put_vectors_checked(
            &mut old_job,
            "a.md",
            &old_hash,
            "model",
            &ids,
            &[vec![1.0, 0.0]],
        )
        .unwrap();
        assert!(stats(&old_job, "model").embedding_ready);
        let mut save = open(&db).unwrap();
        let new_ids =
            refresh_lexical(&mut save, "a.md", &new_hash, &chunks("新香蕉"), "新标题").unwrap();
        assert_eq!(ids, new_ids, "fixture exercises reused chunk IDs");
        assert!(put_vectors_checked(
            &mut old_job,
            "a.md",
            &old_hash,
            "model",
            &ids,
            &[vec![1.0, 0.0]]
        )
        .is_err());
        assert!(!delete_document_if_hash(&mut old_job, "a.md", &old_hash).unwrap());
        assert_eq!(lexical_scored(&save, "香蕉", None).unwrap().len(), 1);
        assert_eq!(stats(&save, "model").vectors, 0);
        assert!(
            !stats(&save, "model").embedding_ready,
            "an empty vector table must not trigger a remote query embedding"
        );
        put_vectors_checked(
            &mut save,
            "a.md",
            &new_hash,
            "model",
            &new_ids,
            &[vec![0.0, 1.0]],
        )
        .unwrap();
        assert!(!delete_document_if_hash(&mut old_job, "a.md", &old_hash).unwrap());
        assert_eq!(stats(&save, "model").vectors, 1);
        assert!(indexed(&save, "a.md", &new_hash, "model"));
    }
    #[test]
    fn checked_vector_commit_requires_exact_document_chunk_membership() {
        let d = tempfile::tempdir().unwrap();
        let mut c = open(&d.path().join("index")).unwrap();
        let mut a = chunks("苹果");
        a.extend(chunks("梨子"));
        let ids = index_text(&mut c, "a.md", "same-hash", &a).unwrap();
        let foreign = index_text(&mut c, "b.md", "same-hash", &a).unwrap();
        for invalid in [vec![ids[0], foreign[0]], vec![ids[0], ids[0]], vec![ids[0]]] {
            let vectors = vec![vec![1.0, 0.0]; invalid.len()];
            assert!(
                put_vectors_checked(&mut c, "a.md", "same-hash", "model", &invalid, &vectors)
                    .is_err()
            );
            assert!(
                !has_vectors(&c),
                "rejection must not mutate vector schema or profiles"
            );
        }
        put_vectors_checked(
            &mut c,
            "a.md",
            "same-hash",
            "model",
            &ids,
            &[vec![1.0, 0.0], vec![0.0, 1.0]],
        )
        .unwrap();
        assert_eq!(stats(&c, "model").vectors, 2);
        assert!(delete_document_if_hash(&mut c, "a.md", "same-hash").unwrap());
        assert!(!delete_document_if_hash(&mut c, "a.md", "same-hash").unwrap());
        assert_eq!(
            lexical_scored(&c, "苹果", None).unwrap().len(),
            1,
            "other document remains indexed"
        );
        assert_eq!(stats(&c, "model").vectors, 0);
    }
    #[test]
    fn save_waits_for_initial_index_snapshot_then_keeps_new_keyword_content() {
        use std::{sync::mpsc, time::Duration};
        let data = tempfile::tempdir().unwrap();
        let root = data.path().canonicalize().unwrap();
        let ws = Workspace {
            db: root.join("index"),
            root: root.clone(),
        };
        let file = root.join("a.md");
        std::fs::write(&file, "旧苹果").unwrap();
        let expected = files::hash("旧苹果");
        let mut c = open(&ws.db).unwrap();
        let (started_tx, started_rx) = mpsc::channel();
        let (done_tx, done_rx) = mpsc::channel();
        let writer_ws = ws.clone();
        let writer_data = root.clone();
        let writer_hash = expected.clone();
        let handle = crate::documents::with_write_lock(&file, || {
            assert_eq!(files::hash(files::read_text(&file)?), expected);
            let handle = std::thread::spawn(move || {
                started_tx.send(()).unwrap();
                let result = crate::documents::save(
                    &writer_ws,
                    &writer_data,
                    "a.md",
                    "新香蕉",
                    &writer_hash,
                );
                done_tx.send(result).unwrap();
            });
            started_rx.recv_timeout(Duration::from_secs(2)).unwrap();
            assert!(
                matches!(
                    done_rx.recv_timeout(Duration::from_millis(100)),
                    Err(mpsc::RecvTimeoutError::Timeout)
                ),
                "save must wait until file check and initial index commit are complete"
            );
            index_text(&mut c, "a.md", &expected, &chunks("旧苹果"))?;
            Ok(handle)
        })
        .unwrap();
        let result = done_rx
            .recv_timeout(Duration::from_secs(3))
            .unwrap()
            .unwrap();
        handle.join().unwrap();
        assert_eq!(result.hash, files::hash("新香蕉"));
        assert!(result.warning.is_none());
        assert!(lexical_scored(&c, "苹果", None).unwrap().is_empty());
        assert_eq!(lexical_scored(&c, "香蕉", None).unwrap().len(), 1);
    }
    #[test]
    fn ranks_from_deleted_versions_cannot_attach_to_reused_rowids() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().canonicalize().unwrap();
        let ws = Workspace {
            db: root.join("index"),
            root: root.clone(),
        };
        let mut c = open(&ws.db).unwrap();
        std::fs::write(root.join("a.md"), "旧苹果").unwrap();
        let make = |text: &str| {
            vec![ChunkInput {
                text: text.into(),
                heading: "".into(),
                start_line: 1,
                end_line: 1,
            }]
        };
        let first =
            refresh_lexical(&mut c, "a.md", &files::hash("旧苹果"), &make("旧苹果"), "").unwrap();
        let ranks = lexical_scored(&c, "苹果", None).unwrap();
        assert_eq!(ranks.len(), 1);
        std::fs::write(root.join("a.md"), "新香蕉").unwrap();
        let second =
            refresh_lexical(&mut c, "a.md", &files::hash("新香蕉"), &make("新香蕉"), "").unwrap();
        assert_eq!(first, second, "fixture demonstrates SQLite rowid reuse");
        assert!(merge_candidates(&c, &ws, &ranks, &[]).unwrap().is_empty());
        let vector = vec![RankedHit {
            id: second[0],
            score: 0.1,
            hash: Some(files::hash("新香蕉")),
        }];
        let current = merge_candidates(&c, &ws, &ranks, &vector).unwrap();
        assert_eq!(current.len(), 1);
        assert!(current[0].bm25_rank.is_none());
        assert_eq!(current[0].vector_rank, Some(1));
        assert!(!current[0].evidence);
    }
}
