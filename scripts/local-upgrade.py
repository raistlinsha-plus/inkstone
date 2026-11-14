#!/usr/bin/env python3
"""Preflight, install, or roll back a locally built Inkstone release on macOS."""

import argparse
from contextlib import contextmanager
import ctypes
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import plistlib
import re
import shutil
import stat
import subprocess
import sys
import tempfile
from zipfile import BadZipFile, ZipFile


ROOT = Path(__file__).resolve().parent.parent
APP = Path("/Applications/Inkstone.app")
BUNDLE_ID = "local.inkstone.desktop"
BINARY = Path("Contents/MacOS/inkstone")
PLIST = Path("Contents/Info.plist")
MANIFEST_BUNDLE = Path("src-tauri/target/release/bundle/macos/Inkstone.app")
BUILD_INPUTS = ("package-lock.json", "src-tauri/Cargo.lock", "toolchain.json")
VERSION = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?")
SHA256 = re.compile(r"[0-9a-f]{64}")


class UpgradeError(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise UpgradeError(message)


def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def canonical(path, kind):
    require(path.resolve(strict=True) == path, f"需要真实{kind}路径，不能使用符号链接：{path}")


def sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_receipt(path, value):
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                     prefix=".receipt-", delete=False) as file:
        tmp = Path(file.name)
        json.dump(value, file, ensure_ascii=False, indent=2, sort_keys=True)
        file.write("\n")
        file.flush()
        os.fsync(file.fileno())
    tmp.replace(path)
    directory = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def saved(state):
    return read_json(state / "upgrade.json")


def record(state, receipt, phase):
    receipt["phase"] = phase
    receipt["updated_at"] = datetime.now(timezone.utc).isoformat()
    write_receipt(state / "upgrade.json", receipt)


def process_closed():
    names = run("/bin/ps", "-axo", "comm=", capture_output=True, text=True).stdout
    require(
        not any(Path(name.strip()).name.lower() == "inkstone" for name in names.splitlines()),
        "先保存并正常退出 Inkstone，再重试。若有隔离验收中的 Inkstone，也需要先关掉。",
    )


def fingerprint(path):
    """Digest file names, permissions, and contents without opening any database."""
    if not os.path.lexists(path):
        return None
    h = hashlib.sha256()

    def visit(item):
        mode = item.lstat().st_mode
        if stat.S_ISDIR(mode):
            entry = ("dir",)
        elif stat.S_ISREG(mode):
            entry = ("file", item.stat().st_size, sha256(item))
        else:
            raise UpgradeError(f"快照包含符号链接或特殊文件：{item}")
        h.update(json.dumps((item.relative_to(path).as_posix(), stat.S_IMODE(mode), *entry)).encode())
        h.update(b"\n")
        if stat.S_ISDIR(mode):
            for child in sorted(item.iterdir()):
                visit(child)

    visit(path)
    return h.hexdigest()


def copy(src, dst):
    require(not os.path.lexists(dst), f"复制目标已经存在：{dst}")
    run("/usr/bin/ditto", src, dst)


def application(app, version=None, hashes=None):
    canonical(app, "应用")
    canonical(app / "Contents", "Contents")
    canonical(app / BINARY, "可执行文件")
    canonical(app / PLIST, "Info.plist")
    with (app / PLIST).open("rb") as file:
        info = plistlib.load(file)
    actual = info["CFBundleShortVersionString"]
    require(info["CFBundleIdentifier"] == BUNDLE_ID and info["CFBundleExecutable"] == "inkstone",
            "应用标识或可执行文件名称不匹配")
    require(version is None or version == actual, f"应用版本应为 {version}，实际为 {actual}")
    archs = run("/usr/bin/lipo", "-archs", app / BINARY, capture_output=True, text=True).stdout
    require("arm64" in archs.split(), "应用缺少 arm64 可执行文件")
    run("/usr/bin/codesign", "--verify", "--deep", "--strict", app)
    measured = {str(path): sha256(app / path) for path in (BINARY, PLIST)}
    require(hashes is None or hashes == measured, "应用二进制或 Info.plist 与发行指纹不同")
    return actual, measured


def git_head():
    head = run("git", "-C", ROOT, "rev-parse", "HEAD", capture_output=True, text=True).stdout
    status = run("git", "-C", ROOT, "status", "--porcelain", capture_output=True, text=True).stdout
    require(not status.strip(), "请从干净且已提交的构建源码工作树运行")
    return head.strip()


def cargo_test(*args, **kwargs):
    cargo = Path.home() / ".cargo/bin/cargo"
    run(cargo, "test", "--locked", "--lib", "--features", "desktop-e2e",
        "--manifest-path", ROOT / "src-tauri/Cargo.toml", *args, cwd=ROOT, **kwargs)


def materialize_candidate(zip_path, destination):
    # ditto preserves the signed app. Validate entry paths and types before extraction.
    with ZipFile(zip_path) as archive:
        seen = set()
        for member in archive.infolist():
            path = PurePosixPath(member.filename)
            mode = stat.S_IFMT(member.external_attr >> 16)
            parts = path.parts
            require(parts and not path.is_absolute() and ".." not in parts
                    and "\\" not in member.filename and path not in seen
                    and mode in (0, stat.S_IFDIR, stat.S_IFREG)
                    and (parts[0] == "Inkstone.app" or parts[:2] == ("__MACOSX", "Inkstone.app") or
                         (parts == ("__MACOSX",) and member.is_dir())),
                    f"ZIP 中有异常路径或文件类型：{member.filename}")
            seen.add(path)
    run("/usr/bin/ditto", "-x", "-k", zip_path, destination)


def preflight(artifact_dir, from_version):
    manifest = read_json(artifact_dir / "release-manifest.json")
    version = manifest["version"]
    require(bool(VERSION.fullmatch(version)) and version != from_version, "候选版本无效或与已安装版本相同")
    source = git_head()
    require(manifest["sourceDirty"] is False and manifest["sourceCommit"] == source
            and manifest["target"] == "aarch64-apple-darwin"
            and manifest["signing"]["commandExit"] == 0,
            "发行清单的目标、签名或源码提交不匹配")
    for path in BUILD_INPUTS:
        require(sha256(ROOT / path) == manifest["hashes"][path],
                f"发行清单的构建输入指纹不匹配：{path}")
    zip_path = artifact_dir / f"Inkstone-v{version}-macos-arm64.zip"
    lines = (artifact_dir / "SHA256SUMS").read_text(encoding="utf-8").splitlines()
    expected = []
    for line in lines:
        fields = line.split(maxsplit=1)
        if len(fields) == 2 and fields[1].lstrip("*") == zip_path.name:
            expected.append(fields[0])
    require(len(expected) == 1 and SHA256.fullmatch(expected[0]) and sha256(zip_path) == expected[0],
            "候选 ZIP 校验和不匹配")
    hashes = {str(path): manifest["hashes"][str(MANIFEST_BUNDLE / path)] for path in (BINARY, PLIST)}
    _, old = application(APP, from_version)
    artifacts = ROOT / "artifacts"
    artifacts.mkdir(exist_ok=True)
    canonical(artifacts, "验收目录")
    state = Path(tempfile.mkdtemp(prefix=f"local-upgrade-v{version}.", dir=artifacts))
    try:
        materialize_candidate(zip_path, state / "candidate")
        # An archive/staging copy should not register as a second macOS app.
        (state / "candidate/Inkstone.app").rename(state / "bundle")
        (state / "candidate").rmdir()
        application(state / "bundle", version, hashes)
        same_volume(APP / "Contents", state / "bundle/Contents")
        cargo_test("--no-run")
        record(state, {
            "version": version, "from_version": from_version, "bundle_id": BUNDLE_ID,
            "application": str(APP), "app_inode": APP.stat().st_ino,
            "source_commit": source, "archive_sha256": expected[0],
            "candidate": hashes, "prior": old,
        }, "prepared")
    except BaseException:
        shutil.rmtree(state)
        raise
    return state


def sources():
    library = Path.home().resolve() / "Library"
    return {
        "data": library / "Application Support" / BUNDLE_ID,
        "preferences": library / "Preferences" / f"{BUNDLE_ID}.plist",
        "webkit": library / "WebKit" / BUNDLE_ID,
    }


def capture_raw(state, receipt):
    snapshot = state / "pre-upgrade"
    existing = receipt.get("snapshot")
    if existing:
        require(all(fingerprint(snapshot / name) == value for name, value in existing.items()),
                "升级前快照指纹错误")
        require(all(fingerprint(path) == existing[name] for name, path in sources().items()),
                "资料在快照后变动，请重新预检并使用新的事务目录")
        return
    require(not snapshot.exists(), "快照未完成，请使用新的事务目录")
    snapshot.mkdir(mode=0o700)
    try:
        require(sources()["data"].is_dir(), "找不到当前 Inkstone 资料目录")
        baseline = {}
        for name, path in sources().items():
            value = fingerprint(path)
            baseline[name] = value
            if value is not None:
                canonical(path, "备份来源")
                copy(path, snapshot / name)
        process_closed()
        for name, path in sources().items():
            require(fingerprint(snapshot / name) == baseline[name] == fingerprint(path),
                    f"{name} 原件在备份中发生变化")
        receipt["snapshot"] = baseline
        record(state, receipt, "prepared")
    except BaseException:
        # Never reuse an incomplete copy after the next run.
        if "snapshot" not in saved(state):
            shutil.rmtree(snapshot)
        raise


def portable_backup(state, receipt):
    result = state / "backup.json"
    archive = state / "before-update.inkstone.zip"
    require(fingerprint(state / "pre-upgrade/data") == receipt["snapshot"]["data"], "原始快照受损")
    if "portable_backup_sha256" in receipt:
        require(read_json(result)["validation"]["valid"] is True
                and sha256(archive) == receipt["portable_backup_sha256"], "便携备份指纹受损")
        return
    # A crash can leave an unverified portable archive. Retain it and retry from
    # the exact read-only raw snapshot with a new disposable source copy.
    for path in (result, archive):
        if path.exists():
            path.rename(state / f"{path.name}.interrupted-{datetime.now(timezone.utc).timestamp()}")
    with tempfile.TemporaryDirectory(prefix="portable-source-", dir=state) as directory:
        work = Path(directory) / "data"
        copy(state / "pre-upgrade/data", work)
        require(fingerprint(work) == receipt["snapshot"]["data"], "便携备份工作副本指纹错误")
        env = dict(os.environ, INKSTONE_LOCAL_OPERATION="backup-closed-snapshot",
                   INKSTONE_LOCAL_SNAPSHOT=str(work), INKSTONE_LOCAL_REPORT_DIR=str(state))
        with (state / "backup.log").open("a", encoding="utf-8") as output:
            try:
                cargo_test("local_acceptance::backup_local_snapshot", "--", "--ignored", "--exact",
                           env=env, stdout=output, stderr=subprocess.STDOUT)
            except subprocess.CalledProcessError as error:
                raise UpgradeError(f"便携备份未通过，日志：{state / 'backup.log'}") from error
    require(read_json(result)["validation"]["valid"] is True, "便携备份验证未通过")
    require(fingerprint(state / "pre-upgrade/data") == receipt["snapshot"]["data"], "原始快照受损")
    receipt["portable_backup_sha256"] = sha256(archive)
    record(state, receipt, "prepared")


def same_volume(source, target):
    require(source.stat().st_dev == target.stat().st_dev, "备份和应用需要位于同一卷以原子替换")


def exchange(source, target):
    rename = ctypes.CDLL(None, use_errno=True).renamex_np
    rename.argtypes = (ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint)
    rename.restype = ctypes.c_int
    if rename(os.fsencode(source), os.fsencode(target), 2) != 0:  # RENAME_SWAP
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error), str(target))


def app_root(receipt):
    require(receipt["application"] == str(APP) and receipt["bundle_id"] == BUNDLE_ID
            and APP.stat().st_ino == receipt["app_inode"], "原应用根目录已改变")
    canonical(APP / "Contents", "应用 Contents")


def apply(state):
    process_closed()
    receipt = saved(state)
    app_root(receipt)
    phase = receipt["phase"]
    require(phase in ("prepared", "installing", "installed"), f"当前事务状态不能升级：{phase}")
    candidate = state / "bundle"
    current = {str(path): sha256(APP / path) for path in (BINARY, PLIST)}
    require(git_head() == receipt["source_commit"], "当前源码提交与候选构建不同")
    if phase == "installed":
        application(APP, receipt["version"], receipt["candidate"])
        return
    if phase == "prepared":
        application(APP, receipt["from_version"], receipt["prior"])
        application(candidate, receipt["version"], receipt["candidate"])
        capture_raw(state, receipt)
        portable_backup(state, receipt)
        record(state, receipt, "installing")
    else:
        capture_raw(state, receipt)
        portable_backup(state, receipt)
    # A restarted install either has the prior bundle or has already exchanged
    # its Contents. The candidate directory then holds the signed prior bundle.
    require(all(fingerprint(path) == receipt["snapshot"][name] for name, path in sources().items()),
            "资料在快照后变动，停止安装")
    process_closed()
    if current == receipt["prior"]:
        application(candidate, receipt["version"], receipt["candidate"])
        same_volume(APP / "Contents", candidate / "Contents")
        process_closed()
        exchange(candidate / "Contents", APP / "Contents")
    else:
        require(current == receipt["candidate"], "当前应用与本次候选均不匹配")
    try:
        app_root(receipt)
        application(APP, receipt["version"], receipt["candidate"])
        application(candidate, receipt["from_version"], receipt["prior"])
    except BaseException:
        # The app has never been launched in this command. Its data remains unchanged.
        process_closed()
        exchange(candidate / "Contents", APP / "Contents")
        application(APP, receipt["from_version"], receipt["prior"])
        record(state, receipt, "prepared")
        raise
    record(state, receipt, "installed")


def rollback(state):
    process_closed()
    receipt = saved(state)
    app_root(receipt)
    phase = receipt["phase"]
    require(phase in ("installed", "rolling-back", "rolled-back"), f"当前事务状态不能回退：{phase}")
    if phase == "rolled-back":
        application(APP, receipt["from_version"], receipt["prior"])
        return
    stage = state / "return-stage"
    snapshot = state / "pre-upgrade"
    candidate = state / "bundle"
    # macOS and WebKit own the preference domains and can cache them outside
    # the app. Keep their pre-upgrade copies for inspection.
    data = sources()["data"]
    slot = stage / "data"
    old = receipt["snapshot"]["data"]
    if phase == "installed":
        application(APP, receipt["version"], receipt["candidate"])
        application(candidate, receipt["from_version"], receipt["prior"])
        # When "installed" is durable, this staging folder has never been
        # exchanged into live data. An interrupted copy can be replaced.
        if stage.exists():
            shutil.rmtree(stage)
        stage.mkdir(mode=0o700)
        try:
            canonical(data, "当前应用资料")
            same_volume(stage, data)
            before = fingerprint(data)
            require(fingerprint(snapshot / "data") == old, "升级前资料快照受损")
            copy(snapshot / "data", slot)
            require(fingerprint(slot) == old, "回退资料副本指纹错误")
            process_closed()
            require(fingerprint(data) == before, "资料在准备回退期间发生变化")
            receipt["data_before_rollback"] = before
            record(state, receipt, "rolling-back")
        except BaseException:
            if saved(state)["phase"] == "installed":
                shutil.rmtree(stage)
            raise

    # Both sides identify whether this atomic exchange already completed.
    new = receipt["data_before_rollback"]
    pair = (fingerprint(data), fingerprint(slot))
    if pair != (old, new):
        require(pair == (new, old), "回退中的资料发生变化；原始和回退资料仍保留")
        process_closed()
        exchange(slot, data)
        require((fingerprint(data), fingerprint(slot)) == (old, new), "回退后资料指纹不匹配")

    process_closed()
    current = {str(path): sha256(APP / path) for path in (BINARY, PLIST)}
    if current == receipt["candidate"]:
        application(candidate, receipt["from_version"], receipt["prior"])
        process_closed()
        exchange(candidate / "Contents", APP / "Contents")
    else:
        require(current == receipt["prior"], "回退中的应用已改变")
    application(APP, receipt["from_version"], receipt["prior"])
    application(candidate, receipt["version"], receipt["candidate"])
    record(state, receipt, "rolled-back")


@contextmanager
def locked_state(state):
    artifacts = ROOT / "artifacts"
    canonical(artifacts, "验收目录")
    canonical(state, "事务目录")
    require(state.parent == artifacts and state.name.startswith("local-upgrade-v")
            and state.stat().st_uid == os.getuid() and stat.S_IMODE(state.stat().st_mode) == 0o700,
            "事务必须是当前用户创建的私有升级目录")
    fd = os.open(state / "operation.lock", os.O_CREAT | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    prepare = commands.add_parser("preflight", help="核对来源、ZIP 与签名，预编译备份验证")
    prepare.add_argument("--artifact-dir", type=Path, required=True)
    prepare.add_argument("--from-version", required=True)
    commands.add_parser("apply", help="备份已关闭的应用数据并升级").add_argument(
        "--state", type=Path, required=True
    )
    restore = commands.add_parser("rollback", help="恢复升级前的应用和本机资料")
    restore.add_argument("--state", type=Path, required=True)
    args = parser.parse_args()
    try:
        require(platform.system() == "Darwin" and platform.machine() == "arm64"
                and os.geteuid() != 0, "需要在 Apple Silicon macOS 的普通用户会话运行")
        if args.command == "preflight":
            require(bool(VERSION.fullmatch(args.from_version)), "已安装版本格式错误")
            state = preflight(args.artifact_dir, args.from_version)
        else:
            state = Path(os.path.abspath(args.state.expanduser()))
            with locked_state(state):
                if args.command == "apply":
                    apply(state)
                else:
                    rollback(state)
        print(json.dumps({"state": str(state), **saved(state)}, ensure_ascii=False, sort_keys=True))
    except (OSError, ValueError, KeyError, BadZipFile, UpgradeError, subprocess.CalledProcessError) as error:
        print(f"本机升级：{error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
