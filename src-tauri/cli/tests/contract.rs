#![cfg(feature = "isolated-fixture")]

#[test]
fn external_process_searches_reads_and_observes_revocation() {
    let run = std::process::Command::new("python3")
        .arg(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/client.py"))
        .arg(env!("CARGO_BIN_EXE_inkstone-cli"))
        .output()
        .expect("launch the synthetic CLI client");
    assert!(
        run.status.success(),
        "{}",
        String::from_utf8_lossy(&run.stderr)
    );
}
