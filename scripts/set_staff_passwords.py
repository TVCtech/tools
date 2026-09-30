"""Privately prompt for role passwords and build encrypted user pages."""
import argparse
import getpass
import json
from pathlib import Path
import shutil
import subprocess
import sys
import warnings

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT.parent / "tools-private")
    parser.add_argument("--node", default=shutil.which("node") or str(ROOT / ".runtime/node/bin/node"))
    parser.add_argument("--show-passwords", action="store_true",
                        help="Show passwords as you type them instead of hiding input.")
    args = parser.parse_args()
    if not sys.stdin.isatty():
        parser.error("Run this yourself in an interactive terminal.")
    if not Path(args.node).is_file() and not shutil.which(args.node):
        parser.error("Install Node.js 24 LTS, run npm ci, then try again.")
    if not (ROOT / "node_modules/staticrypt").is_dir():
        parser.error("Run npm ci in this repository first.")
    source = args.source.expanduser().resolve()
    if source == ROOT or ROOT in source.parents:
        parser.error("Keep private source outside this public repository.")
    if not source.exists():
        shutil.copytree(ROOT / "examples/staff", source)
        print(f"Created private source folder with dummy pages: {source}")
    print("Enter two different passwords. Use long, unique passphrases.")
    if args.show_passwords:
        print("Passwords will be visible in your terminal. The script does not save them.")
    else:
        print("Nothing you type at the password prompts is displayed or saved.")
    prompt = input if args.show_passwords else getpass.getpass
    passwords = {}
    # Do not fall back to an echoing password prompt on unsupported terminals.
    with warnings.catch_warnings():
        warnings.simplefilter("error", getpass.GetPassWarning)
        for role in ("technician", "admin"):
            value = prompt(f"{role.title()} password: ")
            confirmation = prompt(f"Confirm {role} password: ")
            if not value or value != confirmation:
                parser.error("Passwords were empty or did not match; no pages were changed.")
            passwords[role] = value
    if passwords["admin"] == passwords["technician"]:
        parser.error("Admin and Technician must have different passwords; no pages were changed.")
    result = subprocess.run(
        [args.node, str(ROOT / "scripts/build-staff.cjs")],
        input=json.dumps({"source": str(source), "passwords": passwords}),
        text=True, encoding="utf-8", cwd=ROOT,
    )
    if result.returncode:
        return result.returncode
    print("Ready for local testing. Nothing has been pushed or published.")
    print("Run: python3 -m http.server 8000 --bind 127.0.0.1")
    print("Then open http://localhost:8000/users.html on this machine.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (KeyboardInterrupt, EOFError, getpass.GetPassWarning):
        print("\nCancelled; no passwords saved.", file=sys.stderr)
        raise SystemExit(1)
