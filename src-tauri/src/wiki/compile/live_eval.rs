//! Opt-in provider smoke. Only synthetic files are sent, with a two-attempt HTTP limit.

use super::*;
use crate::credentials::CredentialReader;
use crate::eval_trace::{Trace, TRACE};
use serde_json::{json, Value};
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
use std::{fs::OpenOptions, sync::atomic::AtomicU64, time::Instant};

const MANUAL: &str = "蓝港演练值守手册";
const NOTICE: &str = "蓝港演练流程公告";
const OLD: &str = "# 蓝港演练值守手册\n普通工单须在 72 小时内初次响应。\n涉及安全事故的工单须在 2 小时内初次响应。";
const NEW: &str = "# 蓝港演练值守手册\n普通工单须在 48 小时内初次响应。\n涉及安全事故的工单须在 2 小时内初次响应。";
const OTHER: &str = "# 蓝港演练流程公告\n普通工单须在 24 小时内初次响应。\n每周五更新值守名单。";

#[derive(Clone, Copy, PartialEq, Eq)]
enum KeySource {
    StandaloneSaved,
    BatchSaved,
    Environment,
}

fn state(
    data: &Path,
    ws: &Workspace,
    chat: Provider,
    credentials: CredentialReader,
) -> Result<AppState, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|_| "无法创建评测客户端")?;
    Ok(AppState {
        credentials,
        workspace: Mutex::new(Some(ws.clone())),
        workspace_generation: AtomicU64::new(0),
        settings: Mutex::new(crate::Settings {
            chat,
            ..Default::default()
        }),
        settings_write: Mutex::new(()),
        legacy_key_origins: HashMap::new(),
        last_workspace: Mutex::new(None),
        job: Mutex::new(None),
        import_busy: Arc::new(AtomicBool::new(false)),
        import_cancel: Arc::new(AtomicBool::new(false)),
        cancel_index: AtomicBool::new(false),
        indexing_path: Mutex::new(None),
        cancel_chat: AtomicBool::new(false),
        provider_test: Mutex::new(None),
        search_request: Mutex::new(None),
        chat_request: Mutex::new(None),
        chat_busy: AtomicBool::new(false),
        allow_quit: AtomicBool::new(false),
        data_dir: data.to_path_buf(),
        config_file: data.join("settings.json"),
        client,
    })
}

async fn compile_phase(
    state: &AppState,
    ws: &Workspace,
    space: &str,
    provider: &Provider,
    use_saved: bool,
    record: &mut Value,
) -> Result<(), String> {
    let plan =
        prepare(&state.data_dir, ws, space, provider, false)?.ok_or("没有可整理的合成资料")?;
    let job = Job::start(&state.data_dir, space)?;
    record["inputs"] = json!(plan
        .input
        .iter()
        .map(|input| &input.excerpt)
        .collect::<Vec<_>>());
    record["systemPromptSha256"] = json!(files::hash(SYSTEM));
    let key = if use_saved {
        record["stage"] = json!("read-chat-key");
        crate::evaluation_v086::saved_key(state, "chat", &provider.base_url)
            .await
            .map(Some)?
    } else {
        std::env::var("INKSTONE_ANSWER_EVAL_API_KEY")
            .ok()
            .filter(|s| !s.trim().is_empty())
    };
    record["stage"] = json!("model");
    let start = Instant::now();
    let mut output = tokio::time::timeout(
        Duration::from_secs(45),
        providers::complete_json(
            &state.client,
            provider,
            key.as_deref(),
            SYSTEM,
            &plan.prompt,
            &job.cancelled,
        ),
    )
    .await
    .map_err(|_| "Wiki 模型评测超时")??;
    if let Some(key) = key.as_deref() {
        redact(&mut output, key);
    }
    drop(key);
    record["modelMs"] = json!(start.elapsed().as_millis());
    record["modelOutput"] = output.clone();
    persist_output(state, ws, space, &plan, output, &job, 0)?;
    drop(job);

    let mut db = store::write(&state.data_dir)?;
    let tx = db.transaction().map_err(error)?;
    let pending = store::changes(&tx, space)?
        .into_iter()
        .filter(|change| change.status == "pending")
        .collect::<Vec<_>>();
    record["pending"] = json!(pending
        .iter()
        .map(|change| &change.content)
        .collect::<Vec<_>>());
    if pending.is_empty() {
        return Err("模型没有产出可发布的 Wiki 候选".into());
    }
    for change in &pending {
        let action = if change.content.summary_issues().is_empty() {
            "publish"
        } else {
            record["excerptOnlyPublication"] = json!(true);
            "publish-excerpts"
        };
        super::super::apply_review(&tx, &state.data_dir, ws, space, &change.id, action)?;
    }
    tx.commit().map_err(error)?;
    record["publishedByFixture"] = json!(store::pages(&db, space)?
        .into_iter()
        .map(|(_, revision, content)| json!({"revision":revision,"content":content}))
        .collect::<Vec<_>>());
    record["coverage"] = json!(status(&state.data_dir, ws, space)?.coverage);
    Ok(())
}

// Only current, readable page references can satisfy an expected fact. A copy
// of the sentence from the wrong document or a stale version does not count.
fn cites_line(refs: &[Original], id: &str, text: &str, line: usize) -> bool {
    let expected = text.lines().nth(line - 1).expect("fixed fixture line");
    let hash = files::hash(text);
    refs.iter().any(|r| {
        r.document_id == id
            && r.hash == hash
            && r.start_line <= line
            && line <= r.end_line
            && r.quote.lines().nth(line - r.start_line) == Some(expected)
    })
}

fn assess_published(
    data: &Path,
    ws: &Workspace,
    space: &str,
    manual: &str,
    notice: &str,
    text: &str,
) -> Result<Value, String> {
    let pages = status(data, ws, space)?.pages;
    let mut refs = Vec::new();
    for item in pages.into_iter().filter(|item| !item.stale) {
        let page = super::super::read_page(data, ws, space, item.id, None)?;
        refs.extend(page.refs);
    }
    let manual_deadline = cites_line(&refs, manual, text, 2);
    let notice_deadline = cites_line(&refs, notice, OTHER, 2);
    let incident_deadline = cites_line(&refs, manual, text, 3);
    Ok(
        json!({"manualOrdinaryRule": manual_deadline, "noticeOrdinaryRule": notice_deadline,
        "incidentRule": incident_deadline, "allExpectedFactsCited": manual_deadline && notice_deadline && incident_deadline}),
    )
}

#[test]
fn wiki_smoke_credits_the_current_document_version_and_exact_source_line() {
    let make = |doc: &str, body: &str, start_line, end_line, quote: &str| Original {
        document_id: doc.into(),
        title: MANUAL.into(),
        path: "fictional.md".into(),
        start_line,
        end_line,
        quote: quote.into(),
        hash: files::hash(body),
    };
    let refs = vec![make(
        "manual",
        NEW,
        2,
        3,
        &NEW.lines().skip(1).collect::<Vec<_>>().join("\n"),
    )];
    assert!(cites_line(&refs, "manual", NEW, 3));
    assert!(!cites_line(&refs, "manual", OLD, 3));
    assert!(!cites_line(&refs, "notice", NEW, 3));
    assert!(!cites_line(
        &[make("manual", NEW, 2, 2, OTHER.lines().nth(1).unwrap())],
        "manual",
        NEW,
        2
    ));
}

fn redact(value: &mut Value, secret: &str) {
    match value {
        Value::String(text) => *text = text.replace(secret, "[redacted]"),
        Value::Array(items) => items.iter_mut().for_each(|item| redact(item, secret)),
        Value::Object(object) => {
            *object = std::mem::take(object)
                .into_iter()
                .map(|(field, mut item)| {
                    redact(&mut item, secret);
                    (field.replace(secret, "[redacted]"), item)
                })
                .collect();
        }
        _ => (),
    }
}

#[test]
#[ignore = "explicit compatible endpoint, synthetic data, at most two billed attempts"]
fn real_wiki_compile_and_refresh_smoke() -> Result<(), String> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(error)?;
    let result = runtime.block_on(check_live_wiki());
    runtime.shutdown_background();
    result
}

async fn check_live_wiki() -> Result<(), String> {
    if std::env::var("INKSTONE_WIKI_EVAL").as_deref() != Ok("1") {
        return Err("设置 INKSTONE_WIKI_EVAL=1 以运行显式 Wiki 模型评测".into());
    }
    let use_saved = std::env::var("INKSTONE_WIKI_EVAL_SAVED").as_deref() == Ok("1");
    if use_saved && cfg!(feature = "desktop-e2e") {
        return Err("隔离桌面测试不使用系统凭据".into());
    }
    let provider = if use_saved {
        crate::evaluation_v086::saved_settings()?.chat
    } else {
        Provider {
            enabled: true,
            base_url: std::env::var("INKSTONE_ANSWER_EVAL_BASE_URL")
                .map_err(|_| "缺少评测服务地址")?,
            model: std::env::var("INKSTONE_ANSWER_EVAL_MODEL").map_err(|_| "缺少评测模型")?,
            context_chars: 4200,
            ..Default::default()
        }
    };
    let report =
        PathBuf::from(std::env::var_os("INKSTONE_WIKI_EVAL_REPORT").ok_or("缺少评测报告路径")?);
    let source = if use_saved {
        KeySource::StandaloneSaved
    } else {
        KeySource::Environment
    };
    let run = run_wiki(provider, CredentialReader::default(), &report, source);
    if use_saved {
        crate::evaluation_v086::CREDENTIAL_DIRECTORY
            .scope(crate::evaluation_v086::saved_credential_directory()?, run)
            .await
    } else {
        run.await
    }
}

fn credential_error(reason: &str) -> Option<&'static str> {
    match reason {
        "local-credential-read-failed" => Some("local-credential-read-failed"),
        "provider-authorization-denied" => Some("provider-authorization-denied"),
        "saved-address-bound-key-missing" => Some("saved-address-bound-key-missing"),
        _ => None,
    }
}

const WIKI_MISSING_EVIDENCE: &str = "wiki-expected-evidence-not-verified";

pub(crate) async fn run_batch_wiki(
    config: crate::Settings,
    credentials: CredentialReader,
    path: &Path,
) -> Result<(), &'static str> {
    if cfg!(feature = "desktop-e2e") {
        return Err("requires the standard build");
    }
    run_wiki(config.chat, credentials, path, KeySource::BatchSaved)
        .await
        .map_err(|reason| match reason.as_str() {
            WIKI_MISSING_EVIDENCE => WIKI_MISSING_EVIDENCE,
            other => credential_error(other).unwrap_or("wiki-evaluation-incomplete"),
        })
}

async fn run_wiki(
    provider: Provider,
    credentials: CredentialReader,
    report: &Path,
    source: KeySource,
) -> Result<(), String> {
    let stage_budget = Duration::from_secs(75);
    let batch_deadline = tokio::time::Instant::now() + stage_budget;
    let use_saved = source != KeySource::Environment;
    if !provider.enabled {
        return Err("请先启用问答模型".into());
    }
    providers::validate(&provider)?;
    if !report.is_absolute() {
        return Err("评测报告需使用绝对路径".into());
    }
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);
    let report = options
        .open(report)
        .map_err(|_| "无法创建新的 Wiki 评测报告")?;

    let data = tempfile::tempdir().map_err(error)?;
    let space = library::create_project(data.path(), "蓝港演练评测")?.id;
    let ws = Workspace {
        root: library::project_root(data.path(), &space)?,
        db: data.path().join("index.sqlite3"),
    };
    let manual = library::create_document(data.path(), &space, MANUAL, OLD)?;
    let notice = library::create_document(data.path(), &space, NOTICE, OTHER)?;
    let policy = Policy {
        revision: 1,
        enabled: true,
        automatic: false,
        topic: "蓝港演练工单初次响应规则，整理冲突和原文出处".into(),
        document_ids: vec![manual.id.clone(), notice.id.clone()],
        provider_fingerprint: providers::fingerprint(&provider),
        ..Default::default()
    };
    store::save_policy(&store::write(data.path())?, &space, &policy)?;
    let state = state(data.path(), &ws, provider.clone(), credentials)?;
    // Check the saved local key before starting the model budget.
    if source == KeySource::StandaloneSaved {
        if let Err(reason) =
            crate::evaluation_v086::saved_key(&state, "chat", &provider.base_url).await
        {
            let failure = json!({"schema": 1, "completed": false, "stage": "read-chat-key", "error": reason,
                "keychainAccessed": false, "localCredentialsAccessed": true, "syntheticSourcesOnly": true, "trace": {"httpAttempts": 0}});
            serde_json::to_writer_pretty(report, &failure).map_err(error)?;
            return Err(reason.into());
        }
    }
    let trace = Trace::new(2, stage_budget.as_secs());
    let deadline = if source == KeySource::BatchSaved {
        batch_deadline
    } else {
        tokio::time::Instant::now() + stage_budget
    };
    let mut result = json!({
        "schema": 1,
        "fixtureSha256": files::hash([OLD, NEW, OTHER].join("\n")),
        "model": provider.model,
        "syntheticSourcesOnly": true,
        "keychainAccessed": false, "localCredentialsAccessed": use_saved,
        "inputBudgetChars": provider.context_chars,
        "maxOutputTokensPerRequest": 3000,
        "initial": {},
        "refresh": {},
        "manualReview": null,
        "rubric": [
            "初次整理保留普通工单 72 与 24 小时两条有冲突的原文，标明不同出处。",
            "安全事故 2 小时是独立条件，不能用于调和普通工单的冲突。",
            "变更后旧页摘要应隐藏，更新后引用当前手册中的 48 小时，不将 72 小时表示为有效规则。",
            "核对新旧主题是否正确关联，区分遗漏、过时历史和已发布结论。"
        ]
    });
    let outcome = TRACE
        .scope(
            trace.clone(),
            tokio::time::timeout_at(deadline, async {
                result["stage"] = json!("initial");
                compile_phase(
                    &state,
                    &ws,
                    &space,
                    &provider,
                    use_saved,
                    &mut result["initial"],
                )
                .await?;
                result["initial"]["evidenceCheck"] = assess_published(data.path(), &ws, &space, &manual.id, &notice.id, OLD)?;
                let dependent: HashSet<_> = store::pages(&store::read(data.path())?, &space)?
                    .into_iter()
                    .filter(|(_, _, content)| content.inputs.iter().any(|input| input.document_id == manual.id)
                        || content.originals().any(|reference| reference.document_id == manual.id))
                    .map(|(id, _, _)| id)
                    .collect();
                files::write_atomic(&ws.root.join(&manual.path), NEW.as_bytes())?;
                let before = status(data.path(), &ws, &space)?.pages;
                let stale_metadata_cleared = !dependent.is_empty()
                    && dependent.iter().all(|id| before.iter().any(|page|
                        &page.id == id && page.stale && page.summary.is_empty()))
                    && before.iter().filter(|page| !dependent.contains(&page.id)).all(|page| !page.stale);
                result["refresh"]["affectedPageCount"] = json!(dependent.len());
                result["refresh"]["beforeRecompile"] = json!(before);
                result["refresh"]["staleMetadataCleared"] = json!(stale_metadata_cleared);
                if !stale_metadata_cleared {
                    return Err("来源变更后仍显示旧版摘要".into());
                }
                result["stage"] = json!("refresh");
                compile_phase(
                    &state,
                    &ws,
                    &space,
                    &provider,
                    use_saved,
                    &mut result["refresh"],
                )
                .await?;
                result["refresh"]["evidenceCheck"] = assess_published(data.path(), &ws, &space, &manual.id, &notice.id, NEW)?;
                let query = "普通工单初次响应";
                let hits_before = super::super::recall(data.path(), &ws, query, None)?;
                let visible_before = hits_before.iter().any(|hit| hit.path == manual.path);
                let mut db = store::write(data.path())?;
                let tx = db.transaction().map_err(error)?;
                result["stage"] = json!("revocation");
                let removed = [manual.id.as_str()];
                let impact = store::removal_impact(&tx, &space, &removed)?;
                store::purge_derived(&tx, &space, &removed)?;
                let mut restricted = policy.clone();
                restricted.document_ids = vec![notice.id.clone()];
                restricted.revision += 1;
                store::save_policy(&tx, &space, &restricted)?;
                tx.commit().map_err(error)?;
                drop(db);
                let recalled = super::super::recall(data.path(), &ws, query, None)?;
                if impact.pages == 0
                    || recalled.iter().any(|hit| hit.path == manual.path)
                    || !ws.root.join(&manual.path).is_file()
                {
                    return Err("撤权后重新打开 Wiki 或查询出处失败".into());
                }
                result["revocation"] = json!({"affected": impact, "reopened": true,
                    "remainingTopics": store::pages(&store::read(data.path())?, &space)?.len(),
                    "sourceFoundBeforeRevocation": visible_before, "revokedSourceInRecall": false, "originalPreserved": true});
                Ok::<(), String>(())
            }),
        )
        .await;
    let phase = result["stage"].as_str().unwrap_or("setup");
    let waiting_for_key = result[phase]["stage"] == "read-chat-key";
    let outcome = match outcome {
        _ if trace.provider_denied() => Err("provider-authorization-denied"),
        Err(_) if waiting_for_key => Err("local-credential-read-failed"),
        Err(_) => Err("Wiki 模型评测总预算已用尽"),
        Ok(Err(reason)) => Err(credential_error(&reason)
            .unwrap_or("Wiki 模型评测未完成，检查已保存的阶段和 HTTP 记录")),
        Ok(Ok(())) => Ok(()),
    };
    if waiting_for_key {
        result["phase"] = json!(phase);
        result["stage"] = json!("read-chat-key");
    }
    result["trace"] = trace.snapshot();
    result["completed"] = json!(outcome.is_ok());
    let outcome = outcome.and_then(|()| {
        let passed = result["initial"]["evidenceCheck"]["allExpectedFactsCited"] == true
            && result["refresh"]["evidenceCheck"]["allExpectedFactsCited"] == true
            && result["revocation"]["sourceFoundBeforeRevocation"] == true;
        result["evidenceAndRevocationPassed"] = json!(passed);
        result["stage"] = json!("finished");
        if passed {
            Ok(())
        } else {
            Err(WIKI_MISSING_EVIDENCE)
        }
    });
    if let Err(reason) = &outcome {
        result["error"] = json!(reason);
    }
    serde_json::to_writer_pretty(report, &result).map_err(|_| "Wiki 评测报告保存失败")?;
    outcome.map_err(str::to_owned)
}

#[cfg(not(feature = "desktop-e2e"))]
#[tokio::test]
async fn batch_wiki_reports_a_missing_local_key_without_http() {
    let address = "https://wiki-fixture.invalid/v1".to_string();
    let credentials = CredentialReader::default();
    let mut config = crate::Settings::default();
    config.chat.enabled = true;
    config.chat.base_url = address;
    config.chat.model = "offline-fixture".into();
    let data = tempfile::tempdir().unwrap();
    let path = data.path().join("wiki.json");
    assert_eq!(
        run_batch_wiki(config, credentials, &path).await,
        Err("saved-address-bound-key-missing")
    );
    let report: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    assert_eq!(report["stage"], "read-chat-key");
    assert_eq!(report["trace"]["httpAttempts"], 0);
    assert_eq!(report["completed"], false);
}
