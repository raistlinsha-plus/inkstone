//! Read-only document evidence for separately authorized local tools.
pub(crate) mod grants;
#[cfg(test)]
mod tests;

use crate::{db, files, library, models::Workspace, retrieval};
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde::Serialize;
use std::{collections::HashMap, path::Path, time::Duration};

const MAX_LINES: usize = 40;
const MAX_CHARS: usize = 2_400;

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AccessError {
    Denied,
    BadRequest,
    IndexNotReady,
    UpgradeRequired,
    TemporarilyBusy,
    ReferenceUnavailable,
    StaleReference,
    StorageUnavailable,
}
impl From<rusqlite::Error> for AccessError {
    fn from(err: rusqlite::Error) -> Self {
        match err.sqlite_error_code() {
            Some(rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked) => {
                Self::TemporarilyBusy
            }
            _ => Self::StorageUnavailable,
        }
    }
}

fn open_readonly(path: &Path, version: i64) -> Result<Connection, AccessError> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    conn.busy_timeout(Duration::from_millis(800))?;
    if conn.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))? != version {
        return Err(AccessError::UpgradeRequired);
    }
    Ok(conn)
}

struct Source {
    title: String,
    path: String,
}

struct Space<'a> {
    data: &'a Path,
    id: &'a str,
    token: &'a str,
    workspace: Workspace,
    catalog: Connection,
}

impl<'a> Space<'a> {
    fn open(data: &'a Path, id: &'a str, token: &'a str) -> Result<Self, AccessError> {
        if id != "inbox" && uuid::Uuid::parse_str(id).is_err() {
            return Err(AccessError::Denied);
        }
        grants::authorize(data, token, id)?;
        let base = library::base(data);
        let catalog = open_readonly(&base.join("catalog.sqlite3"), 4)?;
        let parent = base
            .join("projects")
            .canonicalize()
            .map_err(|_| AccessError::StorageUnavailable)?;
        let root = parent.join(id);
        if root.canonicalize().ok().as_ref() != Some(&root) {
            return Err(AccessError::ReferenceUnavailable);
        }
        let db = crate::workspace_index_path(data, &root);
        Ok(Self {
            data,
            id,
            token,
            workspace: Workspace { root, db },
            catalog,
        })
    }
    fn source(&self, doc: &str) -> Result<Source, AccessError> {
        self.catalog
            .query_row(
                "SELECT title,path FROM documents WHERE project=? AND id=? AND status='ready'",
                params![self.id, doc],
                |r| {
                    Ok(Source {
                        title: r.get(0)?,
                        path: r.get(1)?,
                    })
                },
            )
            .optional()?
            .ok_or(AccessError::ReferenceUnavailable)
    }
    fn excerpt(&self, reference: &Reference) -> Result<Excerpt, AccessError> {
        let src = self.source(reference.doc)?;
        let path = files::resolve(&self.workspace.root, &src.path, false)
            .map_err(|_| AccessError::ReferenceUnavailable)?;
        if path != self.workspace.root.join(&src.path) {
            return Err(AccessError::ReferenceUnavailable);
        }
        let text = files::read_text(&path).map_err(|_| AccessError::ReferenceUnavailable)?;
        if files::hash(&text) != reference.hash {
            return Err(AccessError::StaleReference);
        }
        let mut lines = text.split('\n').skip(reference.start - 1);
        let mut excerpt = String::new();
        let mut remaining_chars = MAX_CHARS;
        let mut truncated = false;
        for line_no in reference.start..=reference.end {
            let line = lines.next().ok_or(AccessError::ReferenceUnavailable)?;
            if line_no > reference.start {
                if remaining_chars == 0 {
                    truncated = true;
                    break;
                }
                excerpt.push('\n');
                remaining_chars -= 1;
            }
            let mut chars = line.chars();
            let part = chars.by_ref().take(remaining_chars).collect::<String>();
            remaining_chars -= part.chars().count();
            excerpt.push_str(&part);
            if chars.next().is_some() {
                truncated = true;
                break;
            }
        }
        Ok(Excerpt {
            title: src.title,
            document_id: reference.doc.to_owned(),
            version: reference.hash.to_owned(),
            start_line: reference.start,
            end_line: reference.end,
            text: excerpt,
            truncated,
        })
    }

    fn verify_grant(&self) -> Result<(), AccessError> {
        grants::authorize(self.data, self.token, self.id)
    }
}

struct Reference<'a> {
    doc: &'a str,
    hash: &'a str,
    start: usize,
    end: usize,
}
impl<'a> Reference<'a> {
    fn parse(space: &str, value: &'a str) -> Result<Self, AccessError> {
        let fields: Vec<_> = value.split(':').take(7).collect();
        let ["v1", scope, doc, hash, start, end] = fields.as_slice() else {
            return Err(AccessError::BadRequest);
        };
        if *scope != space {
            return Err(AccessError::ReferenceUnavailable);
        }
        if uuid::Uuid::parse_str(doc).is_err()
            || hash.len() != 64
            || !hash.bytes().all(|c| c.is_ascii_hexdigit())
        {
            return Err(AccessError::BadRequest);
        }
        let start = start
            .parse::<usize>()
            .map_err(|_| AccessError::BadRequest)?;
        let end = end.parse::<usize>().map_err(|_| AccessError::BadRequest)?;
        if start == 0
            || end < start
            || end - start >= MAX_LINES
            || end > files::MAX_FILE as usize + 1
        {
            return Err(AccessError::BadRequest);
        }
        Ok(Self {
            doc,
            hash,
            start,
            end,
        })
    }
    fn encode(&self, space: &str) -> String {
        format!(
            "v1:{space}:{}:{}:{}:{}",
            self.doc, self.hash, self.start, self.end
        )
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Excerpt {
    title: String,
    document_id: String,
    version: String,
    start_line: usize,
    end_line: usize,
    text: String,
    truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    #[serde(rename = "ref")]
    reference: String,
    evidence: bool,
    #[serde(flatten)]
    excerpt: Excerpt,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Search {
    pub status: &'static str,
    pub mode: &'static str,
    pub results: Vec<Hit>,
}

pub fn read(data: &Path, space: &str, token: &str, value: &str) -> Result<Excerpt, AccessError> {
    let space = Space::open(data, space, token)?;
    let reference = Reference::parse(space.id, value)?;
    let excerpt = space.excerpt(&reference)?;
    space.source(reference.doc)?;
    space.verify_grant()?;
    Ok(excerpt)
}

pub fn search(data: &Path, space: &str, token: &str, query: &str) -> Result<Search, AccessError> {
    let space = Space::open(data, space, token)?;
    if query.trim().is_empty() || query.chars().count() > 1500 {
        return Err(AccessError::BadRequest);
    }
    if !space.workspace.db.is_file() {
        return Err(AccessError::IndexNotReady);
    }
    let index = open_readonly(&space.workspace.db, 3)?;
    // Pin a single WAL read snapshot across FTS ranking and chunk lookup.
    index.execute_batch("BEGIN")?;
    let mut docs = space
        .catalog
        .prepare("SELECT path,id,title FROM documents WHERE project=? AND status='ready'")?;
    let catalog = docs
        .query_map([space.id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                (r.get::<_, String>(1)?, r.get::<_, String>(2)?),
            ))
        })?
        .collect::<Result<HashMap<_, _>, _>>()?;
    if !catalog.is_empty()
        && !index.query_row("SELECT EXISTS(SELECT 1 FROM documents)", [], |r| {
            r.get::<_, bool>(0)
        })?
    {
        return Err(AccessError::IndexNotReady);
    }
    let query = retrieval::knowledge_query(query);
    let lexical =
        db::lexical_scored(&index, &query, None).map_err(|_| AccessError::IndexNotReady)?;
    let mut ranked = db::merge_candidates(&index, &space.workspace, &lexical, &[])
        .map_err(|_| AccessError::IndexNotReady)?;
    ranked.retain_mut(|hit| {
        if let Some((id, title)) = catalog.get(&hit.path) {
            hit.document_id = Some(id.clone());
            hit.title = Some(title.clone());
            true
        } else {
            false
        }
    });
    retrieval::mark_lexical_evidence(&query, &mut ranked);
    retrieval::finish_ranking(&mut ranked);
    let mut results = vec![];
    for hit in ranked {
        if hit.start_line == 0 || hit.end_line < hit.start_line {
            continue;
        }
        let Some(doc) = hit.document_id.as_deref() else {
            continue;
        };
        let reference = Reference {
            doc,
            hash: &hit.hash,
            start: hit.start_line,
            end: hit
                .end_line
                .min(hit.start_line.saturating_add(MAX_LINES - 1)),
        };
        match space.excerpt(&reference) {
            Ok(excerpt) => results.push(Hit {
                reference: reference.encode(space.id),
                evidence: hit.evidence,
                excerpt,
            }),
            Err(AccessError::StaleReference | AccessError::ReferenceUnavailable) => continue,
            Err(e) => return Err(e),
        }
    }
    space.verify_grant()?;
    let status = if results.is_empty() {
        "no_results"
    } else if results.iter().any(|h| h.evidence) {
        "ok"
    } else {
        "candidates_only"
    };
    Ok(Search {
        status,
        mode: "bm25",
        results,
    })
}
