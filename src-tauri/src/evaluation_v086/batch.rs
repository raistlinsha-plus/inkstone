//! One opt-in process with address-bound local credentials and separate workload traces.
use super::*;
use crate::credentials::CredentialReader;

const PHASES: &[&str] = &["hybrid-40", "rerank-40", "keyword-52", "wiki"];
const READER_PHASES: &[&str] = &[
    "keyword-52",
    "causal-dev",
    "keyword-40",
    "hybrid-40",
    "rerank-40",
];
const AUTH_SECONDS: u64 = 300;

#[test]
#[ignore = "Explicit single-process evaluation on frozen synthetic documents"]
fn live_saved_services() -> Result<(), &'static str> {
    if cfg!(feature = "desktop-e2e") || std::env::var("INKSTONE_BATCH_LIVE").as_deref() != Ok("1") {
        return Err("requires INKSTONE_BATCH_LIVE=1 and standard build");
    }
    let path = std::env::var_os("INKSTONE_BATCH_REPORT_DIR")
        .map(PathBuf::from)
        .ok_or("specify a new absolute batch report directory")?;
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|_| "runtime initialization failed")?;
    let selection = std::env::var("INKSTONE_BATCH_RC3_READER").unwrap_or_default();
    let rc4 = std::env::var("INKSTONE_BATCH_RC4_READER").as_deref() == Ok("1");
    let reader_trial = rc4 || matches!(selection.as_str(), "1" | "confirm");
    let mut phases = Vec::new();
    if rc4 {
        phases.extend_from_slice(&["rc4-blind", "keyword-52", "keyword-40"]);
    } else if selection == "confirm" {
        phases.extend_from_slice(&["keyword-52", "keyword-40"]);
    } else if reader_trial {
        phases.extend_from_slice(READER_PHASES);
    } else {
        if std::env::var("INKSTONE_BATCH_KEYWORD_BASELINE").as_deref() == Ok("1") {
            phases.push("keyword-40");
        }
        phases.extend_from_slice(PHASES);
    }
    let config = saved_settings().map(|mut settings| {
        // An explicit evaluator choice applies only to the synthetic fixture.
        settings.candidate_reading = reader_trial;
        settings
    });
    let outcome = runtime.block_on(CREDENTIAL_DIRECTORY.scope(
        saved_credential_directory()?,
        run(&path, config, CredentialReader::default(), &phases),
    ));
    runtime.shutdown_background();
    outcome
}

async fn run_phase(
    phase: &str,
    config: Settings,
    credentials: CredentialReader,
    path: PathBuf,
) -> Result<(), &'static str> {
    match phase {
        "keyword-40" | "hybrid-40" | "rerank-40" => {
            let (mode, _) = phase.split_once('-').ok_or("unknown-batch-phase")?;
            run_fixture(
                &EXTENDED,
                mode,
                config,
                Some(credentials),
                checked_fixture(&EXTENDED)?,
                ReportTarget {
                    path,
                    fixture_hash: &files::hash(EXTENDED.fixture),
                    rubric_hash: Some(&files::hash(EXTENDED.rubric)),
                },
            )
            .await
        }
        "keyword-52" => {
            run_fixture(
                &independent::SUITE,
                "keyword",
                config,
                Some(credentials),
                independent::load_packet()?,
                ReportTarget {
                    path,
                    fixture_hash: independent::PACKET_HASH,
                    rubric_hash: None,
                },
            )
            .await
        }
        "rc4-blind" => super::rc4::live_with_settings(&path, config, credentials).await,
        "causal-dev" => crate::evaluation_rc3::live_with_settings(&path, config, credentials).await,
        "wiki" => crate::wiki::run_batch_wiki(config, credentials, &path).await,
        _ => Err("unknown-batch-phase"),
    }
}

async fn run(
    dir: &Path,
    settings: Result<Settings, &'static str>,
    credentials: CredentialReader,
    stages: &[&'static str],
) -> Result<(), &'static str> {
    if !dir.is_absolute() {
        return Err("use a new absolute batch report directory");
    }
    let mut directory = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        directory.mode(0o700);
    }
    directory
        .create(dir)
        .map_err(|_| "cannot create new batch report directory")?;
    let mut phases: Vec<_> = stages
        .iter()
        .map(|name| json!({"name":name,"status":"not-started"}))
        .collect();
    let mut stage = "settings";
    let started = Instant::now();
    let result = async {
        let config = settings?;
        if !config.chat.enabled || providers::validate(&config.chat).is_err() {
            return Err("batch requires a valid enabled chat service");
        }
        stage = "verify-inputs";
        independent::load_packet()?;
        checked_fixture(&EXTENDED)?;

        let isolated = tempfile::tempdir().map_err(|_| "authorization setup failed")?;
        let auth_state = isolated_state(isolated.path(), config.clone(), credentials.clone())?;
        let first_mode = if config.candidate_reading { "keyword" } else { "rerank" };
        eprintln!("Checking saved service authorization for {first_mode}.");
        tokio::time::timeout(Duration::from_secs(AUTH_SECONDS),
            check_keys(&auth_state, &config, first_mode, &mut stage, &mut Vec::new())
        ).await.map_err(|_| "authorization-time-budget-exhausted")??;

        for (phase, record) in stages.iter().copied().zip(&mut phases) {
            stage = phase;
            eprintln!("Starting {phase}");
            let file = format!("{phase}.json");
            let path = dir.join(&file);
            let start = Instant::now();
            let outcome = run_phase(phase, config.clone(), credentials.clone(), path.clone()).await;
            *record = json!({"name":phase,"status":if outcome.is_ok() {"complete"} else {"incomplete"},
                "report":path.is_file().then_some(file), "error":outcome.as_ref().err(),
                "elapsedMs":start.elapsed().as_millis()});
            if let Err(error) = outcome {
                if matches!(error, "local-credential-read-failed" | "authorization-time-budget-exhausted"
                        | "saved-address-bound-key-missing" | "provider-authorization-denied") {
                    return Err(error);
                }
            }
        }
        stage = "finished";
        if phases.iter().any(|record| record["status"] == "incomplete") {
            return Err("one-or-more-stages-incomplete");
        }
        Ok(())
    }.await;
    let summary = json!({"version":env!("CARGO_PKG_VERSION"),"status":if result.is_ok() {"complete"} else {"incomplete"},
        "stage":stage,"error":result.as_ref().err(),"phases":phases,"syntheticOnly":true,
        "authorizationBudgetSeconds":AUTH_SECONDS,"elapsedMs":started.elapsed().as_millis(),"manualReview":null});
    save_report(&dir.join("batch.json"), &summary, &[])?;
    result
}

#[tokio::test]
async fn offline_missing_bound_key_stops_batch_before_any_stage() {
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("batch");
    let reader = CredentialReader::default();
    let mut config = Settings::default();
    config.chat = models::Provider {
        enabled: true,
        model: "offline".into(),
        base_url: "https://offline.invalid/v1".into(),
        ..Default::default()
    };
    config.embedding = config.chat.clone();
    config.rerank = models::RerankProvider {
        enabled: true,
        model: "offline".into(),
        endpoint: "https://offline.invalid/rerank".into(),
        ..Default::default()
    };
    crate::local_credentials::save(
        dir.path(),
        "chat",
        &config.chat.base_url,
        Some("SYNTHETIC_LOCAL_ONLY"),
        false,
    )
    .unwrap();
    assert_eq!(
        CREDENTIAL_DIRECTORY
            .scope(
                dir.path().to_path_buf(),
                run(&out, Ok(config), reader, PHASES)
            )
            .await,
        Err("saved-address-bound-key-missing")
    );
    let files: Vec<_> = fs::read_dir(&out).unwrap().collect();
    assert_eq!(files.len(), 1);
    let raw = fs::read_to_string(out.join("batch.json")).unwrap();
    assert!(!raw.contains("SYNTHETIC_LOCAL_ONLY") && !raw.contains("offline.invalid"));
    let result: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(result["stage"], "read-embedding-key");
    assert_eq!(result["status"], "incomplete");
    assert_eq!(result["phases"].as_array().unwrap().len(), 4);
    assert!(result["phases"]
        .as_array()
        .unwrap()
        .iter()
        .all(|r| r["status"] == "not-started"));
}

#[tokio::test]
async fn offline_stage_workspaces_share_only_the_role_and_address_bound_reader() {
    let dir = tempfile::tempdir().unwrap();
    let config = Settings::default();
    let reader = CredentialReader::default();
    for (role, address) in [
        ("chat", config.chat.base_url.as_str()),
        ("embedding", config.embedding.base_url.as_str()),
        ("rerank", config.rerank.endpoint.as_str()),
    ] {
        crate::local_credentials::save(
            dir.path(),
            role,
            address,
            Some(&format!("synthetic-{role}")),
            false,
        )
        .unwrap();
    }
    for (mode, expected) in [
        ("hybrid", vec!["synthetic-chat", "synthetic-embedding"]),
        (
            "rerank",
            vec!["synthetic-chat", "synthetic-embedding", "synthetic-rerank"],
        ),
        ("keyword", vec!["synthetic-chat"]),
    ] {
        let state = isolated_state(&dir.path().join(mode), config.clone(), reader.clone()).unwrap();
        let mut observed = Vec::new();
        let mut stage = "start";
        CREDENTIAL_DIRECTORY
            .scope(
                dir.path().to_path_buf(),
                check_keys(&state, &config, mode, &mut stage, &mut observed),
            )
            .await
            .unwrap();
        assert_eq!(observed, expected);
        assert!(state.workspace.lock().unwrap().is_none());
    }
}
