#!/usr/bin/env python3
"""Package or independently verify the notarized Apple silicon release."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import stat
import subprocess
import sys
import tempfile
import unicodedata
from zipfile import BadZipFile, ZipFile


ROOT = Path(__file__).resolve().parent.parent
APP = "Inkstone.app"
BUNDLE_ID = "local.inkstone.desktop"
TARGET = "aarch64-apple-darwin"
BINARY = Path("Contents/MacOS/inkstone")
PLIST = Path("Contents/Info.plist")
MANIFEST_BUNDLE = Path("src-tauri/target/release/bundle/macos") / APP
BUILD_INPUTS = ("package-lock.json", "src-tauri/Cargo.lock", "toolchain.json")
VERSION = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)?")
BUNDLE_BUILD = re.compile(r"[0-9]+(?:\.[0-9]+){0,2}")
TEAM = re.compile(r"[A-Z0-9]{10}")
COMMIT = re.compile(r"[0-9a-f]{40}(?:[0-9a-f]{24})?")
SUBMISSION_ID = re.compile(r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}")
SHA256 = re.compile(r"[0-9a-f]{64}")
CDHASH = re.compile(r"[0-9a-f]{40}")
SYSPOLICY = Path("/usr/bin/syspolicy_check")


class ReleaseError(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise ReleaseError(message)


def matches(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def run(*args, label, private=False):
    result = subprocess.run(args, capture_output=True, text=True,
                            env={**os.environ, "LC_ALL": "C"})
    if result.returncode:
        # Apple account errors can include account/profile details. Keep them out of logs.
        detail = "" if private else (result.stderr or result.stdout).strip()
        raise ReleaseError(f"{label} failed (exit {result.returncode})"
                           + (f"\n{detail}" if detail else ""))
    return result


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def current_commit():
    status = run("git", "-C", ROOT, "status", "--porcelain", label="Git status").stdout
    require(not status.strip(), "Use a clean committed checkout to package a release")
    return run("git", "-C", ROOT, "rev-parse", "HEAD", label="Git HEAD").stdout.strip()


def check_manifest(manifest):
    require(isinstance(manifest, dict), "Release manifest must be a JSON object")
    version = manifest.get("version")
    source = manifest.get("sourceCommit")
    require(matches(VERSION, version) and matches(COMMIT, source),
            "Release manifest is missing a valid version or source commit")
    require(manifest.get("sourceDirty") is False and manifest.get("target") == TARGET
            and source == current_commit(), "Release manifest differs from the clean checkout or target")
    config = read_json(ROOT / "src-tauri/tauri.conf.json")
    require(read_json(ROOT / "package.json")["version"] == config["version"] == version,
            "Package, Tauri, and manifest versions must agree")
    require(config["identifier"] == BUNDLE_ID, "Tauri bundle identifier differs from release identity")
    for path in BUILD_INPUTS:
        require(manifest["hashes"][path] == sha256(ROOT / path),
                f"Release manifest does not match build input {path}")
    return version, source


def inspect_app(app, version, team_id):
    for path in (app, app / BINARY, app / PLIST):
        require(path.resolve(strict=True) == path, "Bundle or main file uses a symbolic link")
    with (app / PLIST).open("rb") as file:
        info = plistlib.load(file)
    short_version = info.get("CFBundleShortVersionString")
    release_version = info.get("InkstoneReleaseVersion", short_version)
    require(info.get("CFBundleIdentifier") == BUNDLE_ID
            and info.get("CFBundleExecutable") == BINARY.name
            and short_version == version.split("-", 1)[0]
            and release_version == version
            and matches(BUNDLE_BUILD, info.get("CFBundleVersion")),
            "Bundle identifier, executable, or signed version differs from release metadata")
    archs = run("/usr/bin/lipo", "-archs", app / BINARY, label="Mach-O architecture check").stdout
    require(archs.split() == ["arm64"], "Expected a thin arm64 Mach-O executable")
    # Check Apple's Developer ID Application certificate markers and the expected signing team.
    requirement = (f'identifier "{BUNDLE_ID}" and anchor apple generic '
                   'and certificate 1[field.1.2.840.113635.100.6.2.6] exists '
                   'and certificate leaf[field.1.2.840.113635.100.6.1.13] exists '
                   f'and certificate leaf[subject.OU] = "{team_id}"')
    run("/usr/bin/codesign", "--verify", "--deep", "--strict", "--all-architectures", app,
        label="Bundle signature verification")
    run("/usr/bin/codesign", "--verify", "--strict", "-R", "=" + requirement, app,
        label="Developer ID Application identity check")
    signing = run("/usr/bin/codesign", "--display", "--verbose=4", app,
                  label="Signature metadata inspection").stderr
    flags = re.search(r"\bflags=0x([0-9a-f]+)\b", signing)
    cdhash = re.search(r"^CDHash=([0-9a-f]{40})$", signing, re.MULTILINE)
    require(flags and int(flags[1], 16) & 0x10000 and not int(flags[1], 16) & 0x2,
            "Release requires Hardened Runtime without an ad-hoc signature")
    require(re.search(r"^Timestamp=.+$", signing, re.MULTILINE) is not None,
            "Developer ID signature is missing a secure timestamp")
    require(cdhash is not None, "Cannot read code directory hash")
    return {"cdhash": cdhash[1], "binarySha256": sha256(app / BINARY),
            "infoPlistSha256": sha256(app / PLIST)}


def check_distribution(app):
    run("/usr/bin/xcrun", "stapler", "validate", app, label="Stapled ticket validation")
    if SYSPOLICY.is_file():
        run(SYSPOLICY, "distribution", app, label="macOS distribution policy check")
        return "syspolicy_check distribution"
    report = run("/usr/sbin/spctl", "--assess", "--type", "execute", "--ignore-cache", "--no-cache",
                 "--verbose=4", app, label="Gatekeeper assessment")
    require("source=Notarized Developer ID" in (report.stdout + report.stderr).splitlines(),
            "Gatekeeper did not report an accepted notarized Developer ID bundle")
    return "spctl --assess --type execute"


def zip_app(app, archive):
    run("/usr/bin/ditto", "-c", "-k", "--keepParent", "--sequesterRsrc", app, archive,
        label="Create app ZIP")


def extract_app(archive, destination):
    # Reject extra payloads, traversal, special files, and filename collisions before using ditto.
    seen = set()
    with ZipFile(archive) as zip_file:
        for member in zip_file.infolist():
            name = member.orig_filename.rstrip("/")
            parts = name.split("/")
            normalized = unicodedata.normalize("NFD", name).casefold()
            mode = stat.S_IFMT(member.external_attr >> 16)
            metadata = (parts == ["__MACOSX"] and member.is_dir()
                        or parts[:2] == ["__MACOSX", APP]
                        or parts == ["__MACOSX", f"._{APP}"] and not member.is_dir())
            require(not any(part in ("", ".", "..") for part in parts)
                    and "\\" not in name and "\x00" not in name
                    and normalized not in seen
                    and mode in (0, stat.S_IFDIR, stat.S_IFREG)
                    and (parts[0] == APP or metadata),
                    "Release ZIP contains an unexpected path or file type")
            seen.add(normalized)
    run("/usr/bin/ditto", "-x", "-k", archive, destination, label="Extract app ZIP")
    require(list(destination.iterdir()) == [destination / APP], "Expected a single Inkstone.app")
    return destination / APP


def notary_log(archive, profile, cdhash):
    auth = ("--keychain-profile", profile)
    submit = run("/usr/bin/xcrun", "notarytool", "submit", archive, *auth,
                 "--wait", "--timeout", "30m", "--output-format", "json",
                 label="Apple submission (check the Keychain profile and notarytool history)",
                 private=True)
    response = json.loads(submit.stdout)
    require(isinstance(response, dict), "Apple returned an invalid notarization response")
    job = response.get("id")
    require(matches(SUBMISSION_ID, job), "Apple returned no valid notarization submission ID")
    require(response.get("status") == "Accepted",
            f"Apple did not accept submission {job}. Inspect its log or current status with notarytool.")
    result = run("/usr/bin/xcrun", "notarytool", "log", job, *auth,
                 label=f"Apple log retrieval for {job}", private=True)
    log = json.loads(result.stdout)
    require(isinstance(log, dict) and matches(SUBMISSION_ID, log.get("jobId"))
            and log["jobId"].lower() == job.lower() and log.get("status") == "Accepted"
            and log.get("sha256") == sha256(archive),
            "Apple's notarization log does not match the accepted submission and ZIP")
    require(any(entry.get("path") == f"{archive.name}/{APP}"
                and entry.get("arch") == "arm64" and entry.get("cdhash") == cdhash
                for entry in log.get("ticketContents") or [] if isinstance(entry, dict)),
            "The Apple ticket does not cover this arm64 app's code directory hash")
    issues = log.get("issues") or []
    require(isinstance(issues, list)
            and all(isinstance(issue, dict) and issue.get("severity") == "warning" for issue in issues),
            "Apple returned unexpected issues for an accepted submission")
    if issues:
        print(f"Apple reported {len(issues)} warning(s). Review the notarytool log for {job}.",
              file=sys.stderr)
    return {"status": "Accepted", "submissionId": job, "submittedSha256": log["sha256"],
            "warningCount": len(issues)}


def archive_name(version):
    return f"inkstone-{version}-macos-arm64.zip"


def check_archive(archive, stage, version, team_id, expected):
    app = extract_app(archive, stage)
    measured = inspect_app(app, version, team_id)
    require(measured == expected, "Extracted app executable or signing metadata differs")
    return check_distribution(app)


def package(args):
    require(matches(TEAM, args.team_id), "Expected the 10-character Apple Developer Team ID")
    source_app = args.app.resolve(strict=True)
    require(source_app.name == APP, f"Expected a built {APP}")
    output = args.output_dir.absolute()
    require(not os.path.lexists(output), "Output directory already exists")
    manifest = read_json(args.manifest)
    version, source = check_manifest(manifest)
    with tempfile.TemporaryDirectory(prefix=".inkstone-notary-", dir=output.parent) as scratch:
        stage = Path(scratch).resolve()
        app = stage / APP
        run("/usr/bin/ditto", source_app, app, label="Stage signed app")
        signing = inspect_app(app, version, args.team_id)
        require(signing["binarySha256"] == manifest["hashes"][str(MANIFEST_BUNDLE / BINARY)]
                and signing["infoPlistSha256"] == manifest["hashes"][str(MANIFEST_BUNDLE / PLIST)],
                "Signed app differs from the release manifest")
        submission = stage / "notary-input.zip"
        zip_app(app, submission)
        notarization = notary_log(submission, args.profile, signing["cdhash"])
        run("/usr/bin/xcrun", "stapler", "staple", app, label="Attach Apple notarization ticket")
        verified = stage / "verified"
        verified.mkdir()
        archive = verified / archive_name(version)
        zip_app(app, archive)
        policy = check_archive(archive, stage / "extracted", version, args.team_id, signing)
        require(current_commit() == source, "Source checkout changed while packaging")
        archive_hash = sha256(archive)
        receipt = {
            "schema": 1, "version": version, "sourceCommit": source, "target": TARGET,
            "archive": archive.name, "archiveSha256": archive_hash, "bundleId": BUNDLE_ID,
            "teamId": args.team_id, "signing": signing, "appleNotarization": notarization,
            "distributionCheck": policy, "verifiedAt": datetime.now(timezone.utc).isoformat(),
        }
        receipt_path = verified / "notarization.json"
        receipt_path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
        (verified / "SHA256SUMS.txt").write_text(
            f"{archive_hash}  {archive.name}\n{sha256(receipt_path)}  {receipt_path.name}\n",
            encoding="utf-8",
        )
        require(not os.path.lexists(output), "Output directory already exists")
        verified.rename(output)
    print(f"Notarized ZIP and verification receipt: {output}")


def verify(args):
    receipt = read_json(args.receipt)
    require(isinstance(receipt, dict) and receipt.get("schema") == 1
            and receipt.get("target") == TARGET and receipt.get("bundleId") == BUNDLE_ID,
            "Unrecognized notarization receipt")
    version = receipt.get("version")
    team_id = receipt.get("teamId")
    source = receipt.get("sourceCommit")
    require(matches(VERSION, version) and matches(TEAM, team_id) and matches(COMMIT, source),
            "Invalid version, developer team, or source commit in notarization receipt")
    require(args.team_id is None or args.team_id == team_id, "Developer team does not match")
    require(args.source_commit is None or args.source_commit == source, "Source commit does not match")
    archive = args.archive.resolve(strict=True)
    require(archive.name == receipt.get("archive") == archive_name(version)
            and matches(SHA256, receipt.get("archiveSha256"))
            and sha256(archive) == receipt["archiveSha256"], "Release ZIP checksum or filename differs")
    notarization = receipt.get("appleNotarization", {})
    require(isinstance(notarization, dict) and notarization.get("status") == "Accepted"
            and matches(SUBMISSION_ID, notarization.get("submissionId"))
            and matches(SHA256, notarization.get("submittedSha256")),
            "Receipt has no accepted Apple notarization submission")
    signing = receipt.get("signing", {})
    require(isinstance(signing, dict) and matches(CDHASH, signing.get("cdhash"))
            and matches(SHA256, signing.get("binarySha256"))
            and matches(SHA256, signing.get("infoPlistSha256")), "Invalid signing digests")
    with tempfile.TemporaryDirectory(prefix="inkstone-notary-verify-") as scratch:
        policy = check_archive(archive, Path(scratch).resolve() / "extracted", version, team_id, signing)
    print(f"Verified notarized release {version} ({policy})")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_subparsers(dest="mode", required=True)
    build = modes.add_parser("package", help="submit an already signed app and create the public ZIP")
    build.add_argument("--app", type=Path, required=True)
    build.add_argument("--manifest", type=Path, required=True)
    build.add_argument("--profile", required=True, help="notarytool Keychain profile name")
    build.add_argument("--team-id", required=True)
    build.add_argument("--output-dir", type=Path, required=True, help="new directory in an existing parent")
    check = modes.add_parser("verify", help="verify release ZIP and receipt on a Mac")
    check.add_argument("--archive", type=Path, required=True)
    check.add_argument("--receipt", type=Path, required=True)
    check.add_argument("--team-id", help="expected Apple Developer Team ID")
    check.add_argument("--source-commit", help="expected full release source commit")
    args = parser.parse_args()
    try:
        require(sys.platform == "darwin", "Apple codesign, stapler, and Gatekeeper checks require macOS")
        (package if args.mode == "package" else verify)(args)
    except (ReleaseError, OSError, BadZipFile, ValueError, KeyError, TypeError, plistlib.InvalidFileException) as error:
        parser.exit(1, f"Inkstone notarized release: {error}\n")


if __name__ == "__main__":
    main()
