import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from zipfile import ZipFile
import sys

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location(
    "local_upgrade", Path(__file__).with_name("local-upgrade.py")
)
upgrade = importlib.util.module_from_spec(spec)
spec.loader.exec_module(upgrade)


class UpgradeTests(unittest.TestCase):
    def setUp(self):
        staging = tempfile.TemporaryDirectory()
        self.addCleanup(staging.cleanup)
        self.root = Path(staging.name).resolve()
        self.app = self.root / "Inkstone.app"
        self.state = self.root / "local-upgrade-v0.8.5.fixture"
        self.candidate = self.state / "bundle"
        self.data = self.root / "data"
        self.data.mkdir()
        self.db = self.data / "library.sqlite3"
        self.db.write_text("original")
        self.source_paths = {
            "data": self.data,
            "preferences": self.root / "prefs.plist",
            "webkit": self.root / "WebKit",
        }
        self.source_paths["preferences"].write_text("old preferences")
        self.old = self.make_app(self.app, "0.8.4")
        self.new = self.make_app(self.candidate, "0.8.5")
        receipt = {
            "version": "0.8.5", "from_version": "0.8.4",
            "application": str(self.app), "bundle_id": upgrade.BUNDLE_ID,
            "app_inode": self.app.stat().st_ino, "candidate": self.new, "prior": self.old,
            "source_commit": "fixture", "archive_sha256": "fixture",
        }
        upgrade.record(self.state, receipt, "prepared")
        self.patch("APP", self.app)
        self.patch("sources", lambda: self.source_paths)
        self.patch("application", self.check_app)
        self.patch("git_head", lambda: "fixture")
        self.patch("process_closed", lambda: None)
        self.patch("cargo_test", self.portable_fixture)

    def patch(self, key, value):
        p = patch.object(upgrade, key, value)
        p.start()
        self.addCleanup(p.stop)

    def make_app(self, app, version):
        for path in (upgrade.BINARY, upgrade.PLIST):
            (app / path).parent.mkdir(parents=True, exist_ok=True)
            (app / path).write_text(version + str(path))
        return self.hashes(app)

    def hashes(self, app):
        return {str(path): upgrade.sha256(app / path) for path in (upgrade.BINARY, upgrade.PLIST)}

    def check_app(self, app, version=None, hashes=None):
        measured = self.hashes(app)
        upgrade.require(hashes is None or measured == hashes, "fixture app mismatch")
        return version, hashes

    def portable_fixture(self, *args, env, **kwargs):
        work = Path(env["INKSTONE_LOCAL_SNAPSHOT"])
        (work / self.db.name).write_text("portable validation changes a database header")
        (self.state / "before-update.inkstone.zip").write_text("portable archive")
        upgrade.write_receipt(self.state / "backup.json", {"validation": {"valid": True}})

    def test_install_keeps_root_and_unmodified_raw_snapshot_then_rollback_preserves_new_state(self):
        inode = self.app.stat().st_ino
        upgrade.apply(self.state)
        self.assertEqual(self.hashes(self.app), self.new)
        self.assertEqual(self.app.stat().st_ino, inode)
        self.assertEqual(self.db.read_text(), "original")
        self.assertEqual((self.state / "pre-upgrade/data" / self.db.name).read_text(), "original")
        upgrade.apply(self.state)
        self.db.write_text("new work")
        self.source_paths["preferences"].unlink()
        self.source_paths["webkit"].mkdir()
        (self.source_paths["webkit"] / "test").write_text("new UI state")
        upgrade.rollback(self.state)
        upgrade.rollback(self.state)
        self.assertEqual(self.hashes(self.app), self.old)
        self.assertEqual(self.db.read_text(), "original")
        self.assertEqual((self.source_paths["webkit"] / "test").read_text(), "new UI state")
        self.assertFalse(self.source_paths["preferences"].exists())
        self.assertEqual((self.state / "return-stage/data" / self.db.name).read_text(), "new work")
        self.assertEqual((self.state / "pre-upgrade/preferences").read_text(), "old preferences")
        self.assertEqual(self.app.stat().st_ino, inode)

    def test_install_resumes_after_interruption_at_exchange(self):
        old_exchange = upgrade.exchange

        def exchange_then_interrupt(source, target):
            old_exchange(source, target)
            raise KeyboardInterrupt

        with patch.object(upgrade, "exchange", exchange_then_interrupt):
            with self.assertRaises(KeyboardInterrupt):
                upgrade.apply(self.state)
        self.assertEqual(upgrade.saved(self.state)["phase"], "installing")
        self.assertEqual(self.hashes(self.app), self.new)
        upgrade.apply(self.state)
        self.assertEqual(upgrade.saved(self.state)["phase"], "installed")

    def test_rollback_resumes_after_data_exchange(self):
        upgrade.apply(self.state)
        self.db.write_text("new work")
        old_exchange = upgrade.exchange

        def exchange_then_interrupt(source, target):
            old_exchange(source, target)
            raise KeyboardInterrupt

        with patch.object(upgrade, "exchange", exchange_then_interrupt):
            with self.assertRaises(KeyboardInterrupt):
                upgrade.rollback(self.state)
        self.assertEqual(upgrade.saved(self.state)["phase"], "rolling-back")
        self.assertEqual(self.db.read_text(), "original")
        self.assertEqual(self.hashes(self.app), self.new)
        upgrade.rollback(self.state)
        self.assertEqual(upgrade.saved(self.state)["phase"], "rolled-back")
        self.assertEqual(self.hashes(self.app), self.old)
        self.assertEqual((self.state / "return-stage/data" / self.db.name).read_text(), "new work")

    def test_failed_post_install_verification_restores_old_app(self):
        def fail_installed_certificate(app, version=None, hashes=None):
            result = self.check_app(app, version, hashes)
            if app == self.app and version == "0.8.5":
                raise upgrade.UpgradeError("invalid installed signature")
            return result

        with patch.object(upgrade, "application", fail_installed_certificate):
            with self.assertRaisesRegex(upgrade.UpgradeError, "invalid installed signature"):
                upgrade.apply(self.state)
        self.assertEqual(self.hashes(self.app), self.old)
        self.assertEqual(upgrade.saved(self.state)["phase"], "prepared")
        upgrade.apply(self.state)
        self.assertEqual(self.hashes(self.app), self.new)

    def test_refuses_stale_snapshot(self):
        receipt = upgrade.saved(self.state)
        upgrade.capture_raw(self.state, receipt)
        self.db.write_text("new changes")
        with self.assertRaisesRegex(upgrade.UpgradeError, "资料在快照后变动"):
            upgrade.apply(self.state)
        self.assertEqual(self.hashes(self.app), self.old)
        self.assertEqual(self.db.read_text(), "new changes")

    def test_zip_path_escape_is_rejected_before_extraction(self):
        path = self.root / "unsafe.zip"
        with ZipFile(path, "w") as archive:
            archive.writestr("Inkstone.app/../../escape", "unsafe")
        with self.assertRaisesRegex(upgrade.UpgradeError, "ZIP 中有异常路径"):
            upgrade.materialize_candidate(path, self.root / "out")

    def test_snapshot_refuses_symlinks(self):
        os.symlink(self.source_paths["preferences"], self.data / "link")
        with self.assertRaisesRegex(upgrade.UpgradeError, "符号链接"):
            upgrade.apply(self.state)
        self.assertFalse((self.state / "pre-upgrade").exists())

    def test_refuses_running_app_before_snapshot(self):
        with patch.object(upgrade, "process_closed", side_effect=upgrade.UpgradeError("running")):
            with self.assertRaisesRegex(upgrade.UpgradeError, "running"):
                upgrade.apply(self.state)
        self.assertFalse((self.state / "pre-upgrade").exists())

    def test_preflight_rejects_corrupt_archive_and_wrong_source(self):
        self.patch("ROOT", self.root)
        work = self.root / "release"
        work.mkdir()
        artifact = work / "Inkstone-v0.8.5-macos-arm64.zip"
        archive_hashes = {}
        for name in upgrade.BUILD_INPUTS:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("fixture")
            archive_hashes[name] = upgrade.sha256(path)
        manifest = {
            "version": "0.8.5", "sourceDirty": False, "sourceCommit": "different",
            "target": "aarch64-apple-darwin", "signing": {"commandExit": 0},
            "hashes": archive_hashes,
        }
        manifest_path = work / "release-manifest.json"
        upgrade.write_receipt(manifest_path, manifest)
        with self.assertRaisesRegex(upgrade.UpgradeError, "源码提交不匹配"):
            upgrade.preflight(work, "0.8.4")

        manifest["sourceCommit"] = "fixture"
        upgrade.write_receipt(manifest_path, manifest)
        artifact.write_text("corrupt")
        (work / "SHA256SUMS").write_text(f"{'0' * 64}  {artifact.name}\n")
        with self.assertRaisesRegex(upgrade.UpgradeError, "ZIP 校验和不匹配"):
            upgrade.preflight(work, "0.8.4")


if __name__ == "__main__":
    unittest.main()
