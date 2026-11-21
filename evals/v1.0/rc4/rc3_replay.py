#!/usr/bin/env python3
"""Run the same frozen offline packet against the pinned pre-RC4 product."""

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[3]
PIN = "339bc87980b15c57ce47b5734989529434e022d3"
FILES = [
    "src-tauri",
    "evals",
    "examples",
    "licenses",
    "LICENSE",
    "README.md",
    "NOTICE",
    "THIRD_PARTY_NOTICES.md",
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    args = parser.parse_args()
    report = args.report.absolute()
    if report.exists() or not report.parent.is_dir():
        parser.error("Use a new file in an existing directory.")
    with tempfile.TemporaryDirectory(prefix="inkstone-rc3-replay-") as directory:
        target = Path(directory)
        with tempfile.TemporaryFile() as archive:
            subprocess.run(
                ["git", "archive", PIN, *FILES], cwd=ROOT, stdout=archive, check=True
            )
            archive.seek(0)
            subprocess.run(["tar", "-x", "-C", directory], stdin=archive, check=True)
        (target / "dist").symlink_to(ROOT / "dist", target_is_directory=True)
        bundle = target / "evals/v1.0/rc4"
        bundle.mkdir()
        shutil.copy2(ROOT / "evals/v1.0/rc4/packet.json", bundle)
        src = target / "src-tauri/src"
        shutil.copy2(ROOT / "src-tauri/src/evaluation_rc4.rs", src)
        bridge = src / "evaluation_v086.rs"
        text = bridge.read_text()
        mount = "mod independent;"
        stage = '"requiredEvidenceStages": offline_hits.map('
        if text.count(mount) != 1 or text.count(stage) != 1:
            raise RuntimeError("Historical harness differs from pinned source")
        text = text.replace(
            mount, mount + '\n#[path = "evaluation_rc4.rs"]\npub(crate) mod rc4;'
        )
        field = '"rc4Candidates": offline_hits.as_ref().map(|hits| rc4::candidate_snapshot(hits, paths)),'
        bridge.write_text(text.replace(stage, field + "\n                " + stage))
        env = dict(os.environ, INKSTONE_RC4_OFFLINE_REPORT=str(report))
        env.setdefault("CARGO_TARGET_DIR", str(ROOT / "src-tauri/target"))
        subprocess.run(
            [
                "cargo",
                "test",
                "--offline",
                "--manifest-path",
                str(target / "src-tauri/Cargo.toml"),
                "--lib",
                "evaluation_v086::rc4::offline_frozen_packet",
                "--",
                "--exact",
            ],
            env=env,
            cwd=target,
            check=True,
        )


if __name__ == "__main__":
    main()
