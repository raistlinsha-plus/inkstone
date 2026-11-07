//! Explicit local acceptance operators, compiled only into the isolated test feature.
use crate::maintenance;
use std::{fs, path::PathBuf};
#[test]
#[ignore = "Explicit backup of a closed-app snapshot under ignored artifacts; never default"]
fn backup_local_snapshot() {
    assert_eq!(
        std::env::var("INKSTONE_LOCAL_OPERATION").as_deref(),
        Ok("backup-closed-snapshot")
    );
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .to_path_buf();
    let artifacts = root.join("artifacts").canonicalize().unwrap();
    let data = PathBuf::from(std::env::var("INKSTONE_LOCAL_SNAPSHOT").unwrap())
        .canonicalize()
        .unwrap();
    assert!(
        data.starts_with(&artifacts),
        "Operator accepts only an existing private snapshot, never the active data directory"
    );
    let out = PathBuf::from(std::env::var("INKSTONE_LOCAL_REPORT_DIR").unwrap())
        .canonicalize()
        .unwrap();
    assert!(out.starts_with(&artifacts));
    let target = out.join("before-update.inkstone.zip");
    assert!(!target.exists());
    let backup = maintenance::create_backup(&data, &target).unwrap();
    let validation = serde_json::to_value(maintenance::validate_backup(&target).unwrap()).unwrap();
    assert_eq!(validation["valid"], true, "{validation}");
    fs::write(out.join("backup.json"),serde_json::to_vec_pretty(&serde_json::json!({"backup":backup,"validation":validation,"credentialsAccessed":false,"scope":"closed-app copied snapshot; live catalog not migrated by this operator"})).unwrap()).unwrap();
}

#[test]
#[ignore = "Explicit closed-app project document synchronization, guarded by a validated snapshot"]
fn sync_closed_project() {
    use crate::{documents, library};
    use std::sync::atomic::AtomicBool;
    assert_eq!(
        std::env::var("INKSTONE_LOCAL_OPERATION").as_deref(),
        Ok("sync-closed-project")
    );
    let processes = std::process::Command::new("ps")
        .args(["-axo", "comm="])
        .output()
        .unwrap();
    assert!(
        !String::from_utf8_lossy(&processes.stdout)
            .lines()
            .any(|p| p.trim().ends_with(".app/Contents/MacOS/inkstone")),
        "Close Inkstone before this explicit operation"
    );
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .to_path_buf();
    let artifacts = root.join("artifacts").canonicalize().unwrap();
    let out = PathBuf::from(std::env::var("INKSTONE_LOCAL_REPORT_DIR").unwrap())
        .canonicalize()
        .unwrap();
    assert!(out.starts_with(&artifacts));
    let backup: serde_json::Value =
        serde_json::from_slice(&fs::read(out.join("backup.json")).unwrap()).unwrap();
    assert_eq!(backup["validation"]["valid"], true);
    let plan: serde_json::Value =
        serde_json::from_slice(&fs::read(out.join("sync-plan.json")).unwrap()).unwrap();
    let data = PathBuf::from(plan["dataDir"].as_str().unwrap())
        .canonicalize()
        .unwrap();
    let allowed = PathBuf::from(std::env::var("HOME").unwrap())
        .join("Library/Application Support/local.inkstone.desktop")
        .canonicalize()
        .unwrap();
    assert_eq!(data, allowed);
    let project = plan["projectId"].as_str().unwrap();
    let before = library::list(&data).unwrap();
    let mut updates = vec![];
    let mut skipped = vec![];
    for value in plan["updates"].as_array().unwrap() {
        let id = value.as_str().unwrap();
        let d = library::get(&data, id).unwrap();
        assert_eq!(d.project_id, project);
        let p = library::check_source_update(&data, id).unwrap();
        if p.can_update {
            let r = library::apply_source_update(
                &data,
                id,
                &p.managed_fingerprint,
                p.source_fingerprint.as_deref().unwrap(),
                false,
            )
            .unwrap();
            assert_eq!(r.document.id, id);
            updates.push(id.to_string());
        } else if p.status != "unchanged" {
            skipped.push(serde_json::json!({"id":id,"status":p.status}));
        }
    }
    let paths = plan["imports"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect::<Vec<_>>();
    let imported = library::import(
        &data,
        project,
        &paths,
        true,
        true,
        &AtomicBool::new(false),
        |_| {},
    )
    .unwrap();
    assert!(!imported.items.iter().any(|i| i.status == "failed"));
    documents::refresh_project(&data, project).unwrap();
    let after = library::list(&data).unwrap();
    assert!(before
        .documents
        .iter()
        .all(|d| after.documents.iter().any(|n| n.id == d.id)));
    fs::write(out.join("sync-result.json"),serde_json::to_vec_pretty(&serde_json::json!({"updated":updates,"preservedLocalChanges":skipped,"imported":imported,"beforeCount":before.documents.len(),"afterCount":after.documents.len(),"allExistingIdsPreserved":true})).unwrap()).unwrap();
}
