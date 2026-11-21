"""Create company logins with generated passwords and a private handover file."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("names", nargs="+", help="Company account names")
    parser.add_argument("--source", type=Path, default=ROOT.parent / "tools-private")
    parser.add_argument("--output", type=Path, default=ROOT)
    parser.add_argument("--key-file", type=Path,
                        default=Path.home() / ".config/tvc-tools/build-keys.json")
    parser.add_argument("--report", type=Path,
                        help="New password handover file, outside both Git repositories")
    args = parser.parse_args()
    output = args.output.expanduser().resolve()
    source = args.source.expanduser().resolve()
    key_file = args.key_file.expanduser().resolve()
    if not key_file.is_file():
        parser.error("Existing private build keys are needed to preserve the Admin and Technician logins.")

    accounts = []
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
    for name in args.names:
        label = name.strip()
        account_id = label.lower().replace(" ", "-")
        if not re.fullmatch(r"[a-z][a-z0-9-]{1,39}", account_id):
            parser.error("Use company names containing letters, numbers and single hyphens or spaces.")
        password = "-".join("".join(secrets.choice(alphabet) for _ in range(4)) for _ in range(4))
        accounts.append({"id": account_id, "label": label, "password": password})
    if len({account["id"] for account in accounts}) != len(accounts):
        parser.error("Company account names must be different.")

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    report = (args.report or Path.home() / ".local/state/tvc-tools" /
              f"company-logins-{stamp}.txt").expanduser().resolve()
    for directory in (ROOT, output, source):
        if report == directory or directory in report.parents:
            parser.error("Keep the password handover file outside the site and source repositories.")
    ancestor = report.parent
    while not ancestor.is_dir():
        ancestor = ancestor.parent
    repository = subprocess.run(
        ["git", "-C", str(ancestor), "rev-parse", "--show-toplevel"],
        text=True, encoding="utf-8", capture_output=True,
    )
    if repository.returncode == 0:
        parser.error("Keep the password handover file outside Git repositories.")
    report.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    lines = [
        "TVC Tools company logins", "Generated passwords; publication is separate.",
        "Login page: https://tvctech.github.io/tools/users.html", "Access: Technician", "",
    ]
    for account in accounts:
        lines.extend([f"Account: {account['label']}", f"Password: {account['password']}", ""])
    # Preserve generated credentials privately before invoking a build, including
    # if that build fails. Never print them or put them in command arguments.
    try:
        descriptor = os.open(report, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        parser.error("The handover file already exists; choose a new filename.")
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines))
    node = shutil.which("node") or str(ROOT / ".runtime/node/bin/node")
    result = subprocess.run(
        [node, str(ROOT / "scripts/build-staff.cjs")],
        input=json.dumps({"source": str(source), "output": str(output),
                         "keyFile": str(key_file), "companyAccounts": accounts}),
        text=True, encoding="utf-8", cwd=ROOT,
    )
    if result.returncode:
        print(f"Build failed. Generated passwords are preserved privately at: {report}", file=sys.stderr)
        return result.returncode
    print(f"Company accounts built locally. Private password handover file: {report}")
    print("Nothing has been pushed or published.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
