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
    parser.add_argument("--training-source", type=Path, help="Private CALSIS training folder to rebuild")
    parser.add_argument("--training-configuration", type=Path, help="Private host configuration JSON")
    parser.add_argument("--output", type=Path, default=ROOT, help="Site destination; publishing is separate")
    parser.add_argument("--key-file", type=Path, default=Path.home() / ".config/tvc-tools/build-keys.json")
    args = parser.parse_args()
    key_file = args.key_file.expanduser().resolve()
    node = shutil.which("node") or str(ROOT / ".runtime/node/bin/node")
    if not key_file.is_file():
        parser.error("Run python3 scripts/set_staff_passwords.py once to save your private build keys.")
    configuration = json.loads(args.training_configuration.read_text(encoding="utf-8")) if args.training_configuration else None
    result = subprocess.run(
        [node, str(ROOT / "scripts/build-staff.cjs")],
        input=json.dumps({"source": str(args.source.expanduser().resolve()), "keyFile": str(key_file),
                          "output": str(args.output.expanduser().resolve()),
                          "trainingSource": str(args.training_source.expanduser().resolve()) if args.training_source else None,
                          "trainingConfiguration": configuration}),
        text=True, encoding="utf-8", cwd=ROOT,
    )
    if result.returncode == 0:
        print("Rebuilt locally using saved keys. Nothing has been pushed or published.")
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
