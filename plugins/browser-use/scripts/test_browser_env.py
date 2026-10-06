#!/usr/bin/env python3
"""
Tests for browser_env.py: the three dependency checks plugin.json declares, and
the pin the header carries.

The check tests build a fake Playwright registry under PLAYWRIGHT_BROWSERS_PATH,
so they need no browser, no network and no playwright install. Every one of
them holds the checks to the launcher: a check passes exactly when
_resolve_chromium_binary would hand the server a Chromium to start.

The pin test is the one that needs the real thing: it builds the script's own
uv env (`uv sync --no-config --script mcp-server.py`) and reads the pinned
Playwright's browsers.json there. PDEP-1's Chromium oracle names that
revision; this test fails on a Playwright bump that moves it, so the two move
in one commit. Without uv it skips locally and fails under CI=true.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import browser_env  # noqa: E402

SERVER = HERE / "mcp-server.py"

# Playwright pin → the Chromium revision it ships. Add a row with every bump.
PINNED_REVISIONS = {"1.63.0": "1243"}

_BINARY = {
    "darwin": Path("chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
    "linux": Path("chrome-linux/chrome"),
}


class CheckFlags(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="browser-env-"))
        self.registry = self.tmp / "registry"
        self.registry.mkdir()
        env = {
            k: v
            for k, v in os.environ.items()
            if k not in ("PLAYWRIGHT_BROWSERS_PATH", "CHROME_EXECUTABLE_PATH")
        }
        env["PLAYWRIGHT_BROWSERS_PATH"] = str(self.registry)
        patch = mock.patch.dict(os.environ, env, clear=True)
        patch.start()
        self.addCleanup(patch.stop)
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def _install(self, revision: int, platform: str, *markers: str) -> Path:
        """A cached Chromium binary of `revision`, with these Playwright markers."""
        rev_dir = self.registry / f"chromium-{revision}"
        binary = rev_dir / _BINARY[platform]
        binary.parent.mkdir(parents=True, exist_ok=True)
        binary.write_text("#!/bin/sh\nexit 0\n")
        for marker in markers:
            (rev_dir / marker).write_text("")
        return binary

    def _on(self, platform: str) -> mock._patch:
        return mock.patch.object(browser_env.sys, "platform", platform)

    def _resolves(self) -> str | None:
        try:
            return browser_env._resolve_chromium_binary()
        except RuntimeError:
            return None

    def _assert_agrees(self, platform: str) -> None:
        """Both checks answer exactly what the launcher would do."""
        launchable = self._resolves() is not None
        for flag in ("--check-chromium", "--check-chromium-libs"):
            self.assertEqual(browser_env.check(flag), 0 if launchable else 1, f"{platform} {flag}")

    def test_check_env_is_reaching_the_script(self) -> None:
        self.assertEqual(browser_env.check("--check-env"), 0)

    def test_an_unknown_flag_is_a_usage_error(self) -> None:
        self.assertEqual(browser_env.check("--check-nothing"), 2)

    def test_an_empty_registry_is_missing(self) -> None:
        for platform in ("darwin", "linux"):
            with self._on(platform):
                self.assertEqual(browser_env.check("--check-chromium"), 1, platform)
                self.assertEqual(browser_env.check("--check-chromium-libs"), 1, platform)
                self._assert_agrees(platform)

    def test_installation_complete_is_launchable_on_macos(self) -> None:
        binary = self._install(1243, "darwin", "INSTALLATION_COMPLETE")
        with self._on("darwin"):
            self.assertEqual(browser_env.check("--check-chromium"), 0)
            self.assertEqual(browser_env._resolve_chromium_binary(), str(binary))

    def test_on_linux_the_host_libraries_must_have_validated(self) -> None:
        self._install(1243, "linux", "INSTALLATION_COMPLETE")
        with self._on("linux"):
            self.assertEqual(
                browser_env.check("--check-chromium"),
                1,
                "a Chromium whose host libraries never validated does not start",
            )
            self.assertEqual(browser_env.check("--check-chromium-libs"), 1)
            self._assert_agrees("linux")
        self._install(1243, "linux", "DEPENDENCIES_VALIDATED")
        with self._on("linux"):
            self.assertEqual(browser_env.check("--check-chromium"), 0)
            self.assertEqual(browser_env.check("--check-chromium-libs"), 0)
            self._assert_agrees("linux")

    def test_a_revision_other_than_the_pinned_one_counts(self) -> None:
        # An install made by an earlier, unpinned `playwright install`: the
        # launcher starts it, so no banner may call it missing.
        binary = self._install(1234, "darwin", "INSTALLATION_COMPLETE")
        with self._on("darwin"):
            self.assertEqual(browser_env.check("--check-chromium"), 0)
            self.assertEqual(browser_env._resolve_chromium_binary(), str(binary))

    def test_an_unfinished_install_is_neither_launched_nor_present(self) -> None:
        self._install(1243, "darwin")  # downloaded, never marked complete
        with self._on("darwin"):
            self.assertEqual(browser_env.check("--check-chromium"), 1)
            self.assertIsNone(self._resolves())

    def test_the_newest_finished_revision_is_the_one_launched(self) -> None:
        older = self._install(999, "linux", "INSTALLATION_COMPLETE", "DEPENDENCIES_VALIDATED")
        self._install(1243, "linux", "INSTALLATION_COMPLETE")  # libraries not validated
        with self._on("linux"):
            self.assertEqual(browser_env._resolve_chromium_binary(), str(older))
            self.assertEqual(browser_env.check("--check-chromium"), 0)
        newer = self._install(1300, "linux", "INSTALLATION_COMPLETE", "DEPENDENCIES_VALIDATED")
        with self._on("linux"):
            self.assertEqual(browser_env._resolve_chromium_binary(), str(newer))

    def test_chrome_executable_path_is_what_launches_so_it_is_what_the_check_answers(self) -> None:
        own = self.tmp / "my-chromium"
        own.write_text("#!/bin/sh\nexit 0\n")
        with mock.patch.dict(os.environ, {"CHROME_EXECUTABLE_PATH": str(own)}), self._on("linux"):
            self.assertEqual(browser_env.check("--check-chromium"), 0)
            self._assert_agrees("linux")
        missing = self.tmp / "nowhere"
        self._install(1243, "linux", "INSTALLATION_COMPLETE", "DEPENDENCIES_VALIDATED")
        with mock.patch.dict(os.environ, {"CHROME_EXECUTABLE_PATH": str(missing)}), self._on("linux"):
            # A bad override raises in the launcher, cache or no cache.
            self.assertEqual(browser_env.check("--check-chromium"), 1)
            self._assert_agrees("linux")

    def test_browsers_path_zero_is_the_package_local_registry(self) -> None:
        package = self.tmp / "site-packages" / "playwright"
        with mock.patch.dict(os.environ, {"PLAYWRIGHT_BROWSERS_PATH": "0"}), mock.patch.object(
            browser_env, "playwright_package_dir", return_value=package
        ):
            self.assertEqual(
                browser_env._playwright_cache_root(),
                package / "driver" / "package" / ".local-browsers",
            )
        with mock.patch.dict(os.environ, {"PLAYWRIGHT_BROWSERS_PATH": "0"}), mock.patch.object(
            browser_env, "playwright_package_dir", return_value=None
        ):
            self.assertEqual(browser_env.check("--check-chromium"), 1)

    def test_linux_default_follows_xdg_cache_home(self) -> None:
        env = {k: v for k, v in os.environ.items() if k != "PLAYWRIGHT_BROWSERS_PATH"}
        env["XDG_CACHE_HOME"] = str(self.tmp / "xdg")
        with mock.patch.dict(os.environ, env, clear=True), self._on("linux"):
            self.assertEqual(browser_env._playwright_cache_root(), self.tmp / "xdg" / "ms-playwright")


class Pin(unittest.TestCase):
    def test_header_pins_playwright_exactly(self) -> None:
        header = SERVER.read_text(encoding="utf-8").split('"""', 1)[0]
        self.assertIn("# /// script", header)
        pins = re.findall(r'"playwright==([0-9.]+)"', header)
        self.assertEqual(len(pins), 1, "the PEP 723 header must pin playwright exactly once")
        self.assertIn(pins[0], PINNED_REVISIONS, f"add playwright {pins[0]} to PINNED_REVISIONS")

    def test_pinned_playwright_ships_the_recorded_chromium_revision(self) -> None:
        if shutil.which("uv") is None:
            if os.environ.get("CI"):
                self.fail("uv is required under CI: this is the pin's only test")
            self.skipTest("uv is not on PATH")
        pin = re.findall(r'"playwright==([0-9.]+)"', SERVER.read_text(encoding="utf-8"))[0]
        subprocess.run(["uv", "sync", "--no-config", "--script", str(SERVER)], check=True, capture_output=True)
        python = subprocess.run(
            ["uv", "python", "find", "--no-config", "--script", str(SERVER)],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        probe = (
            "import json, sys; sys.path.insert(0, sys.argv[1]); import browser_env;"
            "pkg = browser_env.playwright_package_dir();"
            "b = json.loads((pkg / 'driver' / 'package' / 'browsers.json').read_text());"
            "print(next(x['revision'] for x in b['browsers'] if x['name'] == 'chromium'))"
        )
        out = subprocess.run(
            [python, "-B", "-c", probe, str(HERE)], check=True, capture_output=True, text=True
        ).stdout.strip()
        self.assertEqual(out, PINNED_REVISIONS[pin])


if __name__ == "__main__":
    unittest.main(verbosity=2)
