//! Space-local document identities, shared by import, source updates and repair.
use super::*;
use std::path::Component;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkTarget {
    pub id: String,
    pub title: String,
    pub path: String,
}
pub(super) enum Match {
    Unique(LinkTarget),
    Ambiguous(Vec<LinkTarget>),
    Missing,
}
pub(super) struct LinkResolver {
    sources: HashMap<PathBuf, Vec<LinkTarget>>,
}
fn normalized(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}
fn aliases(path: &Path) -> Vec<PathBuf> {
    let lexical = normalized(path);
    let mut result = vec![lexical.clone()];
    if let Ok(canonical) = path.canonicalize() {
        if canonical != lexical {
            result.push(canonical);
        }
    }
    result
}
impl LinkResolver {
    /// Source updates retain explicit identities already present in the saved
    /// body. A filename/source path alone is never evidence of which duplicate
    /// the user chose. Multiple bound IDs from one source remain ambiguous.
    pub(super) fn for_source_update(
        data: &Path,
        d: &Document,
        current: &str,
    ) -> Result<Self, String> {
        let root = project_root(data, &d.project_id)?;
        let directory = root
            .join(&d.path)
            .parent()
            .ok_or("文档目录不可用")?
            .to_path_buf();
        let docs = list(data)?
            .documents
            .into_iter()
            .filter(|doc| {
                doc.project_id == d.project_id && doc.status == "ready" && !doc.source.is_empty()
            })
            .collect::<Vec<_>>();
        let mut preferred = vec![];
        let mut seen = HashSet::new();
        for event in Parser::new(current) {
            let url = match event {
                Event::Start(Tag::Link { dest_url, .. }) => dest_url,
                _ => continue,
            };
            let Some((relative, _)) = local_url(&url) else {
                continue;
            };
            let Ok(value) = decoded(relative) else {
                continue;
            };
            if updates::image_path(Path::new(&value)) {
                continue;
            }
            let joined = normalized(&directory.join(&value));
            let Some(target) = docs.iter().find(|doc| {
                normalized(&root.join(&doc.path)) == joined
                    && files::resolve(&root, &doc.path, false).is_ok()
            }) else {
                continue;
            };
            if seen.insert(target.id.clone()) {
                preferred.push((
                    PathBuf::from(&target.source),
                    LinkTarget {
                        id: target.id.clone(),
                        title: target.title.clone(),
                        path: target.path.clone(),
                    },
                ));
            }
        }
        let own_aliases = aliases(Path::new(&d.source));
        if !preferred.iter().any(|(source, _)| {
            aliases(source)
                .iter()
                .any(|source| own_aliases.contains(source))
        }) {
            preferred.push((
                PathBuf::from(&d.source),
                LinkTarget {
                    id: d.id.clone(),
                    title: d.title.clone(),
                    path: d.path.clone(),
                },
            ));
        }
        Self::new(data, &d.project_id, &preferred)
    }
    pub(super) fn new(
        data: &Path,
        project: &str,
        preferred: &[(PathBuf, LinkTarget)],
    ) -> Result<Self, String> {
        let mut sources = HashMap::<PathBuf, Vec<LinkTarget>>::new();
        let root = project_root(data, project)?;
        for d in list(data)?
            .documents
            .into_iter()
            .filter(|d| d.project_id == project && d.status == "ready" && !d.source.is_empty())
        {
            if files::resolve(&root, &d.path, false).is_err() {
                continue;
            }
            for alias in aliases(Path::new(&d.source)) {
                sources.entry(alias).or_default().push(LinkTarget {
                    id: d.id.clone(),
                    title: d.title.clone(),
                    path: d.path.clone(),
                });
            }
        }
        // The explicit current batch (new or deliberately reused) wins. When
        // a batch itself contains multiple targets it remains ambiguous.
        let mut batch = HashMap::<PathBuf, Vec<LinkTarget>>::new();
        for (source, target) in preferred {
            for alias in aliases(source) {
                batch.entry(alias).or_default().push(target.clone());
            }
        }
        sources.extend(batch);
        for targets in sources.values_mut() {
            targets.sort_by(|a, b| a.id.cmp(&b.id));
            targets.dedup_by(|a, b| a.id == b.id);
        }
        Ok(Self { sources })
    }
    pub(super) fn resolve(&self, path: &Path) -> Match {
        let mut targets = vec![];
        for alias in aliases(path) {
            if let Some(found) = self.sources.get(&alias) {
                targets.extend(found.clone());
            }
        }
        targets.sort_by(|a, b| a.id.cmp(&b.id));
        targets.dedup_by(|a, b| a.id == b.id);
        match targets.len() {
            0 => Match::Missing,
            1 => Match::Unique(targets.remove(0)),
            _ => Match::Ambiguous(targets),
        }
    }
}
pub(super) fn target_url(target: &LinkTarget, suffix: &str) -> Option<String> {
    Some(format!(
        "{}{}",
        encoded(&format!("../{}", target.path.strip_prefix("documents/")?)),
        suffix
    ))
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelinkChoice {
    pub url: String,
    pub document_id: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelinkEntry {
    pub url: String,
    pub status: String,
    pub target_document_id: Option<String>,
    pub replacement: Option<String>,
    pub candidates: Vec<LinkTarget>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelinkPreview {
    pub document_id: String,
    pub managed_fingerprint: String,
    pub catalog_fingerprint: String,
    pub current_content: String,
    pub projected_content: String,
    pub links: Vec<RelinkEntry>,
    pub warnings: Vec<String>,
}
fn catalog_fingerprint(data: &Path, project: &str) -> Result<String, String> {
    let mut docs = list(data)?
        .documents
        .into_iter()
        .filter(|d| d.project_id == project)
        .collect::<Vec<_>>();
    docs.sort_by(|a, b| a.id.cmp(&b.id));
    let root = project_root(data, project)?;
    let identity = docs
        .iter()
        .map(|d| {
            (
                &d.id,
                &d.path,
                &d.source,
                &d.status,
                files::resolve(&root, &d.path, false)
                    .ok()
                    .map(|p| p.to_string_lossy().into_owned()),
            )
        })
        .collect::<Vec<_>>();
    Ok(files::hash(serde_json::to_vec(&identity).map_err(err)?))
}
pub fn relink_preview(
    data: &Path,
    id: &str,
    choices: &[RelinkChoice],
) -> Result<RelinkPreview, String> {
    let d = get(data, id)?;
    let current = updates::managed(data, &d)?;
    let root = project_root(data, &d.project_id)?;
    let resolver = LinkResolver::new(data, &d.project_id, &[])?;
    let docs = list(data)?
        .documents
        .into_iter()
        .filter(|v| v.project_id == d.project_id && v.status == "ready")
        .collect::<Vec<_>>();
    let fingerprint = catalog_fingerprint(data, &d.project_id)?;
    let mut links = vec![];
    let mut warnings = vec![];
    let mut parse_warnings = vec![];
    let mut seen = HashSet::new();
    let mut used = HashSet::new();
    let projected = if updates::markdown(&d.path) {
        rewrite_links(
            current.text.clone(),
            |url, image| {
                let (path, suffix) = local_url(url)?;
                let value = decoded(path).ok()?;
                if !seen.insert(url.to_string()) {
                    return links
                        .iter()
                        .find(|e: &&RelinkEntry| e.url == url)
                        .and_then(|e| e.replacement.clone());
                }
                let mut entry = RelinkEntry {
                    url: url.into(),
                    status: "unresolved".into(),
                    target_document_id: None,
                    replacement: None,
                    candidates: vec![],
                };
                if image || updates::image_path(Path::new(&value)) {
                    entry.status = "image".into();
                    links.push(entry);
                    return None;
                }
                let joined = normalized(&current.path.parent()?.join(&value));
                // Preserve valid managed links by identity before considering the
                // original source path. Retargeting a valid binding is forbidden.
                if let Some(target) = docs.iter().find(|v| {
                    normalized(&root.join(&v.path)) == joined
                        && files::resolve(&root, &v.path, false).is_ok()
                }) {
                    entry.status = "kept".into();
                    entry.target_document_id = Some(target.id.clone());
                    links.push(entry);
                    return None;
                }
                if !d.source.is_empty() {
                    let source = Path::new(&d.source).parent()?.join(&value);
                    match resolver.resolve(&source) {
                        Match::Unique(target) => {
                            entry.candidates = vec![target];
                        }
                        Match::Ambiguous(targets) => {
                            entry.status = "ambiguous".into();
                            entry.candidates = targets;
                        }
                        Match::Missing => {}
                    }
                }
                let choice = choices.iter().find(|c| c.url == url);
                let target = if let Some(choice) = choice {
                    used.insert(url.to_string());
                    entry
                        .candidates
                        .iter()
                        .find(|v| v.id == choice.document_id)
                        .cloned()
                } else if entry.candidates.len() == 1 {
                    entry.candidates.first().cloned()
                } else {
                    None
                };
                if let Some(target) = target {
                    if files::resolve(&root, &target.path, false).is_ok() {
                        entry.status = "resolved".into();
                        entry.target_document_id = Some(target.id.clone());
                        entry.replacement = target_url(&target, suffix);
                    } else {
                        warnings.push(format!("目标正文不可访问：{}", target.title));
                    }
                }
                let replacement = entry.replacement.clone();
                links.push(entry);
                replacement
            },
            &mut parse_warnings,
        )
    } else {
        current.text.clone()
    };
    warnings.extend(parse_warnings);
    if choices.iter().any(|c| {
        !used.contains(&c.url)
            || !links.iter().any(|e| {
                e.url == c.url && e.target_document_id.as_deref() == Some(c.document_id.as_str())
            })
    }) {
        return Err("CONFLICT:链接目标选择已失效，请重新预览".into());
    }
    Ok(RelinkPreview {
        document_id: id.into(),
        managed_fingerprint: current.fingerprint,
        catalog_fingerprint: fingerprint,
        current_content: current.text,
        projected_content: projected,
        links,
        warnings,
    })
}
pub fn relink_apply(
    data: &Path,
    id: &str,
    expected_managed_fingerprint: &str,
    expected_catalog_fingerprint: &str,
    choices: &[RelinkChoice],
) -> Result<UpdateResult, String> {
    let d = get(data, id)?;
    let path = project_root(data, &d.project_id)?.join(&d.path);
    crate::documents::with_write_lock(&path, || {
        let preview = relink_preview(data, id, choices)?;
        if preview.managed_fingerprint != expected_managed_fingerprint
            || preview.catalog_fingerprint != expected_catalog_fingerprint
        {
            return Err("CONFLICT:正文或空间目标在预览后变化，请重新预览".into());
        }
        if preview.links.iter().any(|e| e.status == "ambiguous") {
            return Err("请先选择有歧义的链接目标，或取消此次修复".into());
        }
        if preview.current_content == preview.projected_content {
            return Ok(UpdateResult {
                document: d.clone(),
                warning: Some("没有需要重新关联的链接，当前内容保持不变。".into()),
            });
        }
        let current = updates::managed(data, &d)?;
        // Only an exact old managed baseline may advance through this pure
        // link projection. Never bless independent user edits as source data.
        let b = updates::baseline(data, &d, &current)?
            .filter(|b| b.managed_fingerprint == current.fingerprint);
        updates::replace_with_guard(
            data,
            &d,
            &current,
            &preview.projected_content,
            &[],
            "重新关联链接前",
            updates::OperationMetadata {
                baseline: b,
                original_hash: None,
                import_fingerprint: None,
            },
            || {
                if catalog_fingerprint(data, &d.project_id)? != expected_catalog_fingerprint {
                    return Err("CONFLICT:链接目标已经变化，请重新预览".into());
                }
                Ok(())
            },
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn import_one(data: &Path, path: &Path, skip: bool) -> Document {
        let result = import(
            data,
            "inbox",
            &[path.to_string_lossy().into_owned()],
            skip,
            true,
            &AtomicBool::new(false),
            |_| {},
        )
        .unwrap();
        get(data, result.items[0].document_id.as_ref().unwrap()).unwrap()
    }
    fn body(data: &Path, d: &Document) -> String {
        files::read_text(&project_root(data, &d.project_id).unwrap().join(&d.path)).unwrap()
    }
    #[test]
    fn cross_batch_import_and_source_refresh_use_same_registered_targets() {
        let data = tempfile::tempdir().unwrap();
        let source = tempfile::tempdir().unwrap();
        let a = source.path().join("导航.md");
        let b = source.path().join("中文 目标.md");
        fs::write(&b, "# 目标").unwrap();
        let target = import_one(data.path(), &b, true);
        fs::write(&a,"[目标](中文%20目标.md#节)\n\n```md\n[例](中文%20目标.md)\n```\n\n[引用][ref]\n\n[ref]: 中文%20目标.md").unwrap();
        let doc = import_one(data.path(), &a, true);
        let text = body(data.path(), &doc);
        assert_eq!(
            text.matches(&encoded(&format!(
                "../{}",
                target.path.strip_prefix("documents/").unwrap()
            )))
            .count(),
            2
        );
        assert!(text.contains("```md\n[例](中文%20目标.md)\n```"));
        assert!(text.contains("#节"));
        fs::write(&a, "# 更新\n\n[目标](中文%20目标.md#节)").unwrap();
        let p = check_source_update(data.path(), &doc.id).unwrap();
        assert!(p.can_update, "{}", p.message);
        apply_source_update(
            data.path(),
            &doc.id,
            &p.managed_fingerprint,
            p.source_fingerprint.as_deref().unwrap(),
            false,
        )
        .unwrap();
        assert!(body(data.path(), &doc).contains(&target.id.replace('-', "%2D")));
    }
    #[test]
    fn offline_repair_is_idempotent_preserves_code_and_advances_only_exact_baseline() {
        let data = tempfile::tempdir().unwrap();
        let source = tempfile::tempdir().unwrap();
        let a = source.path().join("a.md");
        let b = source.path().join("b.md");
        fs::write(
            &a,
            "[B](b.md)\n\n```json\n{\"href\":\"b.md\"}\n```\n\n`[B](b.md)`",
        )
        .unwrap();
        fs::write(&b, "目标").unwrap();
        let doc = import_one(data.path(), &a, true);
        let target = import_one(data.path(), &b, true);
        fs::remove_file(&a).unwrap();
        fs::remove_file(&b).unwrap();
        let p = relink_preview(data.path(), &doc.id, &[]).unwrap();
        assert_eq!(p.links.len(), 1);
        assert_eq!(p.links[0].status, "resolved");
        relink_apply(
            data.path(),
            &doc.id,
            &p.managed_fingerprint,
            &p.catalog_fingerprint,
            &[],
        )
        .unwrap();
        let text = body(data.path(), &doc);
        assert!(text.contains(&target.id.replace('-', "%2D")));
        assert!(text.contains("`[B](b.md)`"));
        assert!(text.contains("{\"href\":\"b.md\"}"));
        assert_eq!(history(data.path(), &doc.id).unwrap().len(), 1);
        let current = updates::managed(data.path(), &doc).unwrap();
        assert_eq!(
            updates::baseline(data.path(), &doc, &current)
                .unwrap()
                .unwrap()
                .managed_fingerprint,
            current.fingerprint
        );
        let p = relink_preview(data.path(), &doc.id, &[]).unwrap();
        assert_eq!(p.links[0].status, "kept");
        relink_apply(
            data.path(),
            &doc.id,
            &p.managed_fingerprint,
            &p.catalog_fingerprint,
            &[],
        )
        .unwrap();
        assert_eq!(history(data.path(), &doc.id).unwrap().len(), 1);
    }
    #[test]
    fn ambiguous_sources_require_choice_and_target_or_body_changes_reject_commit() {
        let data = tempfile::tempdir().unwrap();
        let source = tempfile::tempdir().unwrap();
        let a = source.path().join("a.md");
        let b = source.path().join("b.md");
        fs::write(&a, "[B](b.md)").unwrap();
        fs::write(&b, "目标").unwrap();
        let doc = import_one(data.path(), &a, false);
        let first = import_one(data.path(), &b, false);
        let _second = import_one(data.path(), &b, false);
        let p = relink_preview(data.path(), &doc.id, &[]).unwrap();
        assert_eq!(p.links[0].status, "ambiguous");
        assert_eq!(p.links[0].candidates.len(), 2);
        assert!(relink_apply(
            data.path(),
            &doc.id,
            &p.managed_fingerprint,
            &p.catalog_fingerprint,
            &[]
        )
        .is_err());
        let choices = [RelinkChoice {
            url: "b.md".into(),
            document_id: first.id.clone(),
        }];
        let p = relink_preview(data.path(), &doc.id, &choices).unwrap();
        trash(data.path(), &first.id, true).unwrap(); // No identity change when already ready.
        trash(data.path(), &first.id, false).unwrap();
        assert!(relink_apply(
            data.path(),
            &doc.id,
            &p.managed_fingerprint,
            &p.catalog_fingerprint,
            &choices
        )
        .is_err());
        assert_eq!(body(data.path(), &doc), "[B](b.md)");
        trash(data.path(), &first.id, true).unwrap();
        let p = relink_preview(data.path(), &doc.id, &choices).unwrap();
        fs::write(
            project_root(data.path(), "inbox").unwrap().join(&doc.path),
            "用户已编辑 [B](b.md)",
        )
        .unwrap();
        assert!(relink_apply(
            data.path(),
            &doc.id,
            &p.managed_fingerprint,
            &p.catalog_fingerprint,
            &choices
        )
        .is_err());
        let p = relink_preview(data.path(), &doc.id, &choices).unwrap();
        relink_apply(
            data.path(),
            &doc.id,
            &p.managed_fingerprint,
            &p.catalog_fingerprint,
            &choices,
        )
        .unwrap();
        fs::write(&a, "来源也已编辑 [B](b.md)").unwrap();
        // The selected target is retained, while independent local edits still
        // prevent source replacement rather than being blessed as a baseline.
        let update = check_source_update(data.path(), &doc.id).unwrap();
        assert!(!update.can_update);
        assert_eq!(update.status, "conflict");
        let current = updates::managed(data.path(), &doc).unwrap();
        assert_ne!(
            updates::baseline(data.path(), &doc, &current)
                .unwrap()
                .unwrap()
                .managed_fingerprint,
            current.fingerprint
        );
    }
    #[test]
    fn old_bound_id_is_kept_and_other_spaces_never_supply_targets() {
        let data = tempfile::tempdir().unwrap();
        let source = tempfile::tempdir().unwrap();
        let a = source.path().join("a.md");
        let b = source.path().join("b.md");
        fs::write(&b, "B").unwrap();
        fs::write(&a, "[B](b.md)").unwrap();
        let target = import_one(data.path(), &b, false);
        let doc = import_one(data.path(), &a, false);
        let _another = import_one(data.path(), &b, false);
        let p = relink_preview(data.path(), &doc.id, &[]).unwrap();
        assert_eq!(p.links[0].status, "kept");
        assert_eq!(
            p.links[0].target_document_id.as_deref(),
            Some(target.id.as_str())
        );
        let project = create_project(data.path(), "另一个空间").unwrap();
        let other = import(
            data.path(),
            &project.id,
            &[a.to_string_lossy().into_owned()],
            false,
            true,
            &AtomicBool::new(false),
            |_| {},
        )
        .unwrap();
        let p = relink_preview(
            data.path(),
            other.items[0].document_id.as_deref().unwrap(),
            &[],
        )
        .unwrap();
        assert_eq!(p.links[0].status, "unresolved");
    }
    #[test]
    fn missing_managed_copy_is_not_a_duplicate_or_link_target() {
        let data = tempfile::tempdir().unwrap();
        let source = tempfile::tempdir().unwrap();
        let b = source.path().join("b.md");
        let a = source.path().join("a.md");
        fs::write(&b, "目标正文").unwrap();
        fs::write(&a, "[目标](b.md)").unwrap();
        let old = import_one(data.path(), &b, true);
        fs::remove_file(project_root(data.path(), "inbox").unwrap().join(&old.path)).unwrap();
        let doc = import_one(data.path(), &a, true);
        assert_eq!(body(data.path(), &doc), "[目标](b.md)");
        let target = import_one(data.path(), &b, true);
        assert_ne!(old.id, target.id);
        assert_eq!(body(data.path(), &target), "目标正文");
        let p = relink_preview(data.path(), &doc.id, &[]).unwrap();
        assert_eq!(p.links[0].status, "resolved");
        assert_eq!(
            p.links[0].target_document_id.as_deref(),
            Some(target.id.as_str())
        );
    }
    #[test]
    fn source_update_preserves_one_explicit_saved_binding_among_duplicate_sources() {
        let data = tempfile::tempdir().unwrap();
        let source = tempfile::tempdir().unwrap();
        let a = source.path().join("a.md");
        let b = source.path().join("b.md");
        fs::write(&b, "背景故事").unwrap();
        let first = import_one(data.path(), &b, false);
        fs::write(&a, "第一版 [背景](b.md#初遇)").unwrap();
        let doc = import_one(data.path(), &a, false);
        let second = import_one(data.path(), &b, false);
        // Recent/open/title metadata must not decide the identity.
        touch(
            data.path(),
            &project_root(data.path(), "inbox").unwrap(),
            &second.path,
        );
        let second_url = target_url(
            &LinkTarget {
                id: second.id.clone(),
                title: second.title.clone(),
                path: second.path.clone(),
            },
            "",
        )
        .unwrap();
        let current = format!(
            "{}\n\n```markdown\n[仅示例]({second_url})\n```",
            body(data.path(), &doc)
        );
        let resolver = LinkResolver::for_source_update(data.path(), &doc, &current).unwrap();
        assert!(matches!(resolver.resolve(&b),Match::Unique(target) if target.id==first.id));
        fs::write(&a, "第二版 [背景](b.md#同行)").unwrap();
        let preview = check_source_update(data.path(), &doc.id).unwrap();
        assert!(
            preview.can_update,
            "{} {:?}",
            preview.message, preview.warnings
        );
        let projected = preview.source_content.as_ref().unwrap();
        assert!(projected.contains(&first.id.replace('-', "%2D")));
        assert!(!projected.contains(&second.id.replace('-', "%2D")));
        assert!(projected.contains("#同行"));
        apply_source_update(
            data.path(),
            &doc.id,
            &preview.managed_fingerprint,
            preview.source_fingerprint.as_deref().unwrap(),
            false,
        )
        .unwrap();
        assert!(body(data.path(), &doc).contains(&first.id.replace('-', "%2D")));
        assert_eq!(history(data.path(), &doc.id).unwrap().len(), 1);
    }
    #[test]
    fn source_update_does_not_choose_when_current_body_binds_two_ids_from_one_source() {
        let data = tempfile::tempdir().unwrap();
        let source = tempfile::tempdir().unwrap();
        let a = source.path().join("a.md");
        let b = source.path().join("b.md");
        fs::write(&b, "背景故事").unwrap();
        let _first = import_one(data.path(), &b, false);
        fs::write(&a, "[背景](b.md)").unwrap();
        let doc = import_one(data.path(), &a, false);
        let second = import_one(data.path(), &b, false);
        let second_url = target_url(
            &LinkTarget {
                id: second.id,
                title: second.title,
                path: second.path,
            },
            "",
        )
        .unwrap();
        let text = format!(
            "{}\n\n[另一个已绑定版本]({second_url})",
            body(data.path(), &doc)
        );
        fs::write(
            project_root(data.path(), "inbox").unwrap().join(&doc.path),
            &text,
        )
        .unwrap();
        fs::write(&a, "来源更新 [背景](b.md)").unwrap();
        let preview = check_source_update(data.path(), &doc.id).unwrap();
        assert!(!preview.can_update);
        assert!(preview.warnings.iter().any(|w| w.contains("多个")));
        assert_eq!(body(data.path(), &doc), text);
    }
    #[test]
    fn source_update_never_reuses_a_saved_binding_to_a_trashed_target() {
        let data = tempfile::tempdir().unwrap();
        let source = tempfile::tempdir().unwrap();
        let a = source.path().join("a.md");
        let b = source.path().join("b.md");
        fs::write(&b, "背景故事").unwrap();
        let first = import_one(data.path(), &b, false);
        fs::write(&a, "[背景](b.md)").unwrap();
        let doc = import_one(data.path(), &a, false);
        let second = import_one(data.path(), &b, false);
        trash(data.path(), &first.id, false).unwrap();
        fs::write(&a, "第二版 [背景](b.md)").unwrap();
        let preview = check_source_update(data.path(), &doc.id).unwrap();
        assert!(preview.can_update, "{}", preview.message);
        let projected = preview.source_content.unwrap();
        assert!(!projected.contains(&first.id.replace('-', "%2D")));
        assert!(projected.contains(&second.id.replace('-', "%2D")));
        // With more than one remaining ready target there is no valid saved
        // binding to break the tie, so the source update remains unavailable.
        let _third = import_one(data.path(), &b, false);
        let preview = check_source_update(data.path(), &doc.id).unwrap();
        assert!(!preview.can_update);
        assert!(preview.warnings.iter().any(|w| w.contains("多个")));
    }
}
