"""
Which Chromium the server launches, and the three dependency checks the plugin
declares in plugin.json `requires`.

Imports nothing heavy: no browser_use, no mcp, no playwright. The checks run
through `uv run --offline --no-config --script mcp-server.py --check-…` on every
session start, so each one is a few file reads.

  --check-env            exit 0. Reaching this line means uv built or reused
                         the script's env offline, which is the whole check.
  --check-chromium       exit 0 when _resolve_chromium_binary would find a
                         Chromium to launch.
  --check-chromium-libs  the same answer. On Linux a cached Chromium is
                         launchable only once its host libraries validated,
                         which is what this requirement installs.

Both checks call the launcher's own resolver, so a check cannot pass while the
launcher raises, or fail while it would start a browser.

A cached Chromium is launchable when its binary is there and its revision
directory holds Playwright's INSTALLATION_COMPLETE marker — and, on Linux,
DEPENDENCIES_VALIDATED, which Playwright writes only after its own host-library
validation passed. Any revision counts, not only the one the pinned playwright
ships: browser-use drives Chromium over CDP, not through Playwright.
"""

from __future__ import annotations

import glob
import importlib.util
import os
import re
import sys
from pathlib import Path

# Shown wherever the plugin finds something missing. magus-cli installs the
# pinned Playwright's Chromium into the script's own uv env.
INSTALL_HINT = "magus doctor --fix"

# Current Playwright cache layouts. The macOS pattern globs the .app bundle
# rather than naming "Google Chrome for Testing", so the next upstream rename
# cannot reintroduce the real-Chrome hijack.
_CHROMIUM_GLOBS = {
    "darwin": "chromium-*/chrome-mac*/*.app/Contents/MacOS/*",
    "linux": "chromium-*/chrome-linux*/chrome",
    "win32": "chromium-*/chrome-win*/chrome.exe",
}


def _platform_key() -> str:
    """Map sys.platform onto the three Playwright cache layouts."""
    if sys.platform == "darwin":
        return "darwin"
    if sys.platform.startswith("win"):
        return "win32"
    return "linux"


def playwright_package_dir() -> Path | None:
    """The installed playwright package directory, found without importing it."""
    spec = importlib.util.find_spec("playwright")
    if spec is None or not spec.origin:
        return None
    return Path(spec.origin).parent


def _playwright_cache_root() -> Path | None:
    """
    Playwright's browser registry directory, by Playwright's own rule:
    PLAYWRIGHT_BROWSERS_PATH (`0` means the package-local `.local-browsers`),
    else ~/Library/Caches/ms-playwright on macOS, %LOCALAPPDATA%\\ms-playwright
    on Windows, and ${XDG_CACHE_HOME:-~/.cache}/ms-playwright on Linux.

    None only for `PLAYWRIGHT_BROWSERS_PATH=0` without an installed playwright.
    """
    override = os.environ.get("PLAYWRIGHT_BROWSERS_PATH")
    if override == "0":
        package = playwright_package_dir()
        return package / "driver" / "package" / ".local-browsers" if package else None
    if override:
        return Path(override).expanduser()

    key = _platform_key()
    if key == "darwin":
        return Path.home() / "Library" / "Caches" / "ms-playwright"
    if key == "win32":
        local_app_data = os.environ.get("LOCALAPPDATA")
        base = Path(local_app_data) if local_app_data else Path.home() / "AppData" / "Local"
        return base / "ms-playwright"
    xdg = os.environ.get("XDG_CACHE_HOME")
    return (Path(xdg) if xdg else Path.home() / ".cache") / "ms-playwright"


def _revision_dir(binary: Path) -> Path | None:
    """The `chromium-<rev>` directory a cached binary sits in, or None."""
    for parent in binary.parents:
        if re.fullmatch(r"chromium-\d+", parent.name):
            return parent
    return None


def _chromium_revision(path: Path) -> int:
    """
    Parse the integer revision out of a `chromium-<rev>` path component.

    Sorting on this instead of the raw string is load-bearing: upstream does
    matches.sort() then matches[-1], which picks chromium-999 over chromium-1234
    the moment the revision number changes digit width.
    """
    for part in path.parts:
        match = re.fullmatch(r"chromium-(\d+)", part)
        if match:
            return int(match.group(1))
    return -1


def _launchable(binary: Path) -> bool:
    """
    Did Playwright finish installing this cached Chromium? Its binary is a file
    and its revision holds INSTALLATION_COMPLETE; on Linux, DEPENDENCIES_VALIDATED
    too, because a Chromium whose host libraries never validated does not start.
    """
    revision = _revision_dir(binary)
    if revision is None or not binary.is_file():
        return False
    if not (revision / "INSTALLATION_COMPLETE").is_file():
        return False
    if _platform_key() == "linux":
        return (revision / "DEPENDENCIES_VALIDATED").is_file()
    return True


def _resolve_chromium_binary() -> str:
    """
    Return the Chromium executable to launch, or raise RuntimeError.

    Order:
      1. CHROME_EXECUTABLE_PATH — the explicit user override. It must name an
         existing FILE; a missing path or a directory is an error, never a
         silent fall-back. The directory check matters on macOS, where
         `/Applications/Google Chrome.app` is a plausible-looking value that
         exists but is a bundle, not the binary two levels inside it.
      2. Playwright's browser cache (see _playwright_cache_root): the newest
         launchable revision (see _launchable), by integer comparison. A
         revision Playwright did not finish installing is skipped.
      3. Nothing found — raise, naming `magus doctor --fix`.

    No branch can *silently* select the user's real Chrome — a loud, actionable
    error beats a hijacked browser. CHROME_EXECUTABLE_PATH can still name one,
    because that is the user asking for it explicitly; we warn on stderr when it
    resolves outside Playwright's cache so the choice is never invisible.
    """
    override = os.environ.get("CHROME_EXECUTABLE_PATH")
    if override:
        candidate = Path(override).expanduser()
        if candidate.is_dir():
            raise RuntimeError(
                f"CHROME_EXECUTABLE_PATH points at a directory, not an executable: "
                f"{override} — on macOS the binary lives inside the bundle, e.g. "
                "'<Bundle>.app/Contents/MacOS/<Name>'."
            )
        if candidate.is_file():
            # An override outside Playwright's cache is legitimate but easy to
            # set by accident — .env.example used to ship the user's real Chrome
            # as its example value. Say so rather than hijacking in silence.
            if "ms-playwright" not in str(candidate):
                print(
                    f"browser-use MCP: CHROME_EXECUTABLE_PATH={candidate} is not a "
                    "Playwright Chromium. Automation will drive this browser; on macOS "
                    "a real Chrome.app also takes over its single-instance slot. "
                    "Unset the variable to use Playwright's bundled Chromium.",
                    file=sys.stderr,
                )
            return str(candidate)
        raise RuntimeError(
            f"CHROME_EXECUTABLE_PATH points at a path that does not exist: {override} — "
            "fix it, or unset it to use Playwright's bundled Chromium "
            f"(run: {INSTALL_HINT})."
        )

    root = _playwright_cache_root()
    pattern = _CHROMIUM_GLOBS[_platform_key()]
    matches = [Path(p) for p in glob.glob(str(root / pattern))] if root else []
    matches = [p for p in matches if _launchable(p)]
    if matches:
        matches.sort(key=lambda p: (_chromium_revision(p), str(p)))
        return str(matches[-1])

    raise RuntimeError(
        f"No installed Playwright Chromium under {root} (looked for {pattern!r} "
        "with Playwright's INSTALLATION_COMPLETE marker"
        f"{' and DEPENDENCIES_VALIDATED' if _platform_key() == 'linux' else ''}). "
        f"Install it — run: {INSTALL_HINT}. "
        "Alternatively set CHROME_EXECUTABLE_PATH to a Chromium build of your "
        "choice. The plugin refuses to fall back to a browser it did not resolve "
        "explicitly, because that silently hijacks your real Chrome."
    )


def check(flag: str) -> int:
    """Exit status for one of the dependency-check flags."""
    if flag == "--check-env":
        return 0
    if flag not in ("--check-chromium", "--check-chromium-libs"):
        return 2
    try:
        _resolve_chromium_binary()
    except RuntimeError:
        return 1
    return 0


CHECK_FLAGS = ("--check-env", "--check-chromium", "--check-chromium-libs")
