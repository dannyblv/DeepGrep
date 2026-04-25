#!/usr/bin/env python3
"""
Detect the Electron version bundled in the latest stable VS Code release.

Writes `version=<x.y.z>` and `vscode_tag=<tag>` to $GITHUB_OUTPUT.
Falls back to the locally-installed VS Code app if the update API returns
an invalid or missing value (e.g. a key rename in a future VS Code release).
"""
import json
import os
import re
import sys
import urllib.request

SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+$")
LOCAL_VSCODE_PKG = "/Applications/Visual Studio Code.app/Contents/Resources/app/package.json"


def fetch_json(url):
    with urllib.request.urlopen(url) as r:
        return json.load(r)


def electron_from_pkg(pkg):
    return pkg.get("electronVersion") or pkg.get("electron") or ""


# ── 1. Resolve latest stable VS Code tag ──────────────────────────────────────
data = fetch_json("https://update.code.visualstudio.com/api/releases/stable")
item = data[0]
vscode_tag = (
    item if isinstance(item, str)
    else (item.get("productVersion") or item.get("tag") or item.get("version") or "")
)
print(f"VS Code tag: {vscode_tag}", file=sys.stderr)

# ── 2. Read electronVersion from VS Code source at that tag ───────────────────
electron_version = ""
if vscode_tag:
    try:
        pkg = fetch_json(
            f"https://raw.githubusercontent.com/microsoft/vscode/{vscode_tag}/package.json"
        )
        electron_version = electron_from_pkg(pkg)
        if not electron_version:
            print(f"Keys present in VS Code package.json: {list(pkg.keys())}", file=sys.stderr)
    except Exception as exc:
        print(f"WARNING: failed to fetch VS Code package.json: {exc}", file=sys.stderr)

# ── 3. Fallback: read from locally installed VS Code ─────────────────────────
if not SEMVER_RE.match(electron_version):
    print(
        f"WARNING: API returned '{electron_version}' — falling back to local VS Code.",
        file=sys.stderr,
    )
    try:
        with open(LOCAL_VSCODE_PKG) as f:
            local_pkg = json.load(f)
        electron_version = electron_from_pkg(local_pkg)
        vscode_tag = local_pkg.get("version", "unknown")
    except Exception as exc:
        print(f"WARNING: could not read local VS Code: {exc}", file=sys.stderr)

# ── 4. Hard failure if still nothing ─────────────────────────────────────────
if not SEMVER_RE.match(electron_version):
    print(f"FATAL: could not determine Electron version (got: '{electron_version}')", file=sys.stderr)
    sys.exit(1)

print(f"Electron version: {electron_version}", file=sys.stderr)

# ── 5. Write outputs ──────────────────────────────────────────────────────────
github_output = os.environ.get("GITHUB_OUTPUT", "")
if github_output:
    with open(github_output, "a") as f:
        f.write(f"version={electron_version}\n")
        f.write(f"vscode_tag={vscode_tag}\n")
else:
    print(f"version={electron_version}")
    print(f"vscode_tag={vscode_tag}")
