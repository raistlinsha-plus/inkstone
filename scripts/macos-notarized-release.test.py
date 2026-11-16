from argparse import Namespace
from contextlib import redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import plistlib
import shutil
import stat
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from zipfile import ZipFile, ZipInfo


sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location(
    "macos_notarized_release", Path(__file__).with_name("macos-notarized-release.py")
)
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)

VERSION = "0.9.0-beta.1"
TEAM = "A123456789"
COMMIT = "1" * 40
CDHASH = "2" * 40
SUBMISSION = "aaaabbbb-cccc-dddd-eeee-ffff11112222"


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name).resolve()
        self.input = self.root / release.APP
        self.binary = self.input / release.BINARY
        self.binary.parent.mkdir(parents=True)
        self.binary.write_text("fixture executable")
        self.plist = self.input / release.PLIST
        self.info = {
            "CFBundleIdentifier": release.BUNDLE_ID,
            "CFBundleExecutable": release.BINARY.name,
            "CFBundleShortVersionString": "0.9.0",
            "CFBundleVersion": "9001",
            "InkstoneReleaseVersion": VERSION,
        }
        self.plist.write_bytes(plistlib.dumps(self.info))
        self.manifest = self.root / "release-manifest.json"
        self.manifest.write_text(json.dumps({
            "hashes": {str(release.MANIFEST_BUNDLE / path): release.sha256(self.input / path)
                       for path in (release.BINARY, release.PLIST)},
        }))
        self.output = self.root / "published"
        self.args = Namespace(app=self.input, output_dir=self.output, manifest=self.manifest,
                              profile="private-profile", team_id=TEAM)
        self.mock_notary_status = "Accepted"
        self.mock_notary_hash = CDHASH
        self.mock_flags = "0x10000(runtime)"
        self.staple_lost_on_extract = False
        self.commands = []

    def emulate_tools(self, *args, label, private=False):
        self.commands.append(args)
        command, *rest = map(str, args)
        paths = list(map(Path, rest))
        if command == "/usr/bin/ditto":
            if rest[0] == "-c":
                with ZipFile(paths[-1], "w") as zip_file:
                    for path in paths[-2].rglob("*"):
                        zip_file.write(path, path.relative_to(paths[-2].parent))
            elif rest[0] == "-x":
                with ZipFile(paths[-2]) as zip_file:
                    zip_file.extractall(paths[-1])
                if self.staple_lost_on_extract:
                    (paths[-1] / release.APP / "ticket.fixture").unlink()
            else:
                shutil.copytree(paths[-2], paths[-1])
        if label == "Mach-O architecture check":
            return SimpleNamespace(stdout="arm64\n")
        if label == "Signature metadata inspection":
            return SimpleNamespace(stderr=f"CodeDirectory flags={self.mock_flags}\nCDHash={CDHASH}\n"
                                          "Timestamp=Nov 16, 2026 at 12:00:00 PM\n")
        if rest[:2] == ["notarytool", "submit"]:
            self.assertTrue(private)
            self.submitted = paths[2]
            return SimpleNamespace(stdout=json.dumps({"id": SUBMISSION, "status": self.mock_notary_status}))
        if rest[:2] == ["notarytool", "log"]:
            self.assertTrue(private)
            return SimpleNamespace(stdout=json.dumps({
                "jobId": SUBMISSION, "status": "Accepted", "sha256": release.sha256(self.submitted),
                "ticketContents": [{"path": f"{self.submitted.name}/{release.APP}",
                                    "arch": "arm64", "cdhash": self.mock_notary_hash}],
            }))
        if rest[:2] == ["stapler", "staple"]:
            (paths[-1] / "ticket.fixture").touch()
        if rest[:2] == ["stapler", "validate"] and not (paths[-1] / "ticket.fixture").is_file():
            raise release.ReleaseError("Stapled ticket validation failed on extracted app")
        if command == "/usr/sbin/spctl":
            return SimpleNamespace(stdout="", stderr="source=Notarized Developer ID\n")
        return SimpleNamespace(stdout="", stderr="")

    def package(self):
        with (patch.object(release, "run", self.emulate_tools),
              patch.object(release, "check_manifest", return_value=(VERSION, COMMIT)),
              patch.object(release, "current_commit", return_value=COMMIT),
              redirect_stdout(io.StringIO())):
            release.package(self.args)

    def test_verified_zip_and_receipt_recheck_with_original_bytes(self):
        self.package()
        archive = self.output / release.archive_name(VERSION)
        receipt = self.output / "notarization.json"
        report = release.read_json(receipt)
        self.assertEqual(report["archiveSha256"], release.sha256(archive))
        self.assertEqual(report["appleNotarization"]["submissionId"], SUBMISSION)
        self.assertIn(f"{release.sha256(receipt)}  {receipt.name}\n",
                      (self.output / "SHA256SUMS.txt").read_text())
        self.assertNotIn(self.args.profile, receipt.read_text())
        args = Namespace(archive=archive, receipt=receipt, team_id=TEAM, source_commit=COMMIT)
        with patch.object(release, "run", self.emulate_tools), redirect_stdout(io.StringIO()):
            release.verify(args)
            archive.write_bytes(archive.read_bytes() + b"modified after receipt")
            with self.assertRaisesRegex(release.ReleaseError, "ZIP checksum"):
                release.verify(args)

    def test_unaccepted_or_wrong_ticket_submission_produces_no_release(self):
        self.mock_notary_status = "Invalid"
        with self.assertRaisesRegex(release.ReleaseError, "did not accept"):
            self.package()
        self.assertFalse(self.output.exists())
        self.mock_notary_status = "Accepted"
        self.mock_notary_hash = "3" * 40
        with self.assertRaisesRegex(release.ReleaseError, "ticket does not cover"):
            self.package()
        self.assertFalse(self.output.exists())

    def test_missing_staple_after_repack_produces_no_release(self):
        self.staple_lost_on_extract = True
        with self.assertRaisesRegex(release.ReleaseError, "ticket validation failed on extracted app"):
            self.package()
        self.assertFalse(self.output.exists())

    def test_ad_hoc_and_wrong_beta_fail_before_submit(self):
        self.mock_flags = "0x10002(adhoc,runtime)"
        with self.assertRaisesRegex(release.ReleaseError, "without an ad-hoc signature"):
            self.package()
        self.mock_flags = "0x10000(runtime)"
        self.info["InkstoneReleaseVersion"] = "0.9.0-beta.2"
        self.plist.write_bytes(plistlib.dumps(self.info))
        with self.assertRaisesRegex(release.ReleaseError, "signed version"):
            self.package()
        self.assertFalse(self.output.exists())
        self.assertFalse(any("notarytool" in command for command in self.commands))

    def test_archive_rejects_symlinks_and_traversal_before_extraction(self):
        archive = self.root / "unexpected.zip"
        link = ZipInfo(f"{release.APP}/link")
        link.create_system = 3
        link.external_attr = stat.S_IFLNK << 16
        for member in (link, f"{release.APP}/../outside", "companion-installer.pkg"):
            with self.subTest(member=member):
                with ZipFile(archive, "w") as zip_file:
                    zip_file.writestr(member, "input")
                with (patch.object(release, "run") as external,
                      self.assertRaisesRegex(release.ReleaseError, "ZIP contains an unexpected path")):
                    release.extract_app(archive, self.root / "outside")
                external.assert_not_called()

    @unittest.skipUnless(sys.platform == "darwin", "ditto is supplied by macOS")
    def test_ditto_preserves_mac_metadata_and_single_app_shape(self):
        # Finder-style AppleDouble sidecar entries shouldn't escape into the extracted directory.
        release.run("/usr/bin/xattr", "-w", "org.inkstone.fixture", "preserved", self.input,
                    label="Fixture xattr")
        release.run("/usr/bin/xattr", "-w", "org.inkstone.fixture", "preserved", self.binary,
                    label="Fixture xattr")
        archive = self.root / "ditto.zip"
        release.zip_app(self.input, archive)
        app = release.extract_app(archive, self.root / "extracted")
        result = release.run("/usr/bin/xattr", "-p", "org.inkstone.fixture", app / release.BINARY,
                             label="Read extracted xattr")
        self.assertEqual(result.stdout.strip(), "preserved")


if __name__ == "__main__":
    unittest.main()
