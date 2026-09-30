"""Rebuild protected tools using private local keys, without password prompts."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT.parent / "tools-private")
    args = parser.parse_args()
    key_file = Path.home() / ".config/tvc-tools/build-keys.json"
    node = shutil.which("node") or str(ROOT / ".runtime/node/bin/node")
    if not key_file.is_file():
        parser.error("Run python3 scripts/set_staff_passwords.py once to save your private build keys.")
    result = subprocess.run(
        [node, str(ROOT / "scripts/build-staff.cjs")],
        input=json.dumps({"source": str(args.source.expanduser().resolve()), "keyFile": str(key_file)}),
        text=True, encoding="utf-8", cwd=ROOT,
    )
    if result.returncode == 0:
        print("Rebuilt locally using saved keys. Nothing has been pushed or published.")
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
