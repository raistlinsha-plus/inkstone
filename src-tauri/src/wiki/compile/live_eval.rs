//! Opt-in provider smoke. Only synthetic files are sent, with a two-attempt HTTP limit.

use super::*;
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

fn state(data: &Path, ws: &Workspace, chat: Provider) -> Result<AppState, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|_| "无法创建评测客户端")?;
    Ok(AppState {
        credentials: crate::credentials::CredentialReader::default(),
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
    key: Option<&str>,
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
    let start = Instant::now();
    let output = tokio::time::timeout(
        Duration::from_secs(45),
        providers::complete_json(
            &state.client,
            provider,
            key,
            SYSTEM,
            &plan.prompt,
            &job.cancelled,
        ),
    )
    .await
    .map_err(|_| "Wiki 模型评测超时")??;
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
        publish_checked(&tx, &state.data_dir, ws, space, &plan.policy, change)?;
    }
    tx.commit().map_err(error)?;
    record["publishedByFixture"] = json!(store::pages(&db, space)?
        .into_iter()
        .map(|(_, revision, content)| json!({"revision":revision,"content":content}))
        .collect::<Vec<_>>());
    record["coverage"] = json!(status(&state.data_dir, ws, space)?.coverage);
    Ok(())
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

#[tokio::test]
#[ignore = "explicit compatible endpoint, synthetic data, at most two billed attempts"]
async fn real_wiki_compile_and_refresh_smoke() -> Result<(), String> {
    if std::env::var("INKSTONE_WIKI_EVAL").as_deref() != Ok("1") {
        return Err("设置 INKSTONE_WIKI_EVAL=1 以运行显式 Wiki 模型评测".into());
    }
    let provider = Provider {
        enabled: true,
        base_url: std::env::var("INKSTONE_ANSWER_EVAL_BASE_URL").map_err(|_| "缺少评测服务地址")?,
        model: std::env::var("INKSTONE_ANSWER_EVAL_MODEL").map_err(|_| "缺少评测模型")?,
        context_chars: 4200,
        ..Default::default()
    };
    providers::validate(&provider)?;
    let key = std::env::var("INKSTONE_ANSWER_EVAL_API_KEY")
        .ok()
        .filter(|key| !key.trim().is_empty());
    let report =
        PathBuf::from(std::env::var_os("INKSTONE_WIKI_EVAL_REPORT").ok_or("缺少评测报告路径")?);
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
    let state = state(data.path(), &ws, provider.clone())?;
    let trace = Trace::new(2, 75);
    let mut result = json!({
        "schema": 1,
        "fixtureSha256": files::hash([OLD, NEW, OTHER].join("\n")),
        "model": provider.model,
        "syntheticSourcesOnly": true,
        "keychainAccessed": false,
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
            tokio::time::timeout(Duration::from_secs(75), async {
                compile_phase(
                    &state,
                    &ws,
                    &space,
                    &provider,
                    key.as_deref(),
                    &mut result["initial"],
                )
                .await?;
                files::write_atomic(&ws.root.join(&manual.path), NEW.as_bytes())?;
                let before = status(data.path(), &ws, &space)?.pages;
                let stale_metadata_cleared = before
                    .iter()
                    .all(|page| page.stale && page.summary.is_empty());
                result["refresh"]["beforeRecompile"] = json!(before);
                result["refresh"]["staleMetadataCleared"] = json!(stale_metadata_cleared);
                if !stale_metadata_cleared {
                    return Err("来源变更后仍显示旧版摘要".into());
                }
                compile_phase(
                    &state,
                    &ws,
                    &space,
                    &provider,
                    key.as_deref(),
                    &mut result["refresh"],
                )
                .await
            }),
        )
        .await
        .map_err(|_| "Wiki 模型评测总预算已用尽")
        .and_then(|value| value.map_err(|_| "Wiki 模型评测未完成，检查已保存的阶段和 HTTP 记录"));
    result["trace"] = trace.snapshot();
    result["completed"] = json!(outcome.is_ok());
    if let Some(key) = key.as_deref() {
        redact(&mut result, key);
    }
    serde_json::to_writer_pretty(report, &result).map_err(|_| "Wiki 评测报告保存失败")?;
    outcome.map_err(str::to_owned)
}
