# TVC Tools

The existing calculators remain public. `index.html` links to each calculator
and has a **Login** link at the top left.

## CALSIS wheel and spacer assembly

`Calsis160WheelSpacerCalc.html` includes a live SVG side view using the owner's
wheel/bracket and thread captures. The drawing updates with the actual selected
spacers and recommended bolt. A hidden-bolt-path checkbox makes the covering
parts translucent; it does not change the calculation. The 40 mm example sets
pipe ID to 242.3 mm. Bolt engagement uses the rounded fitted stack, with the
existing 7.5 mm bracket/washer allowance, 5 mm minimum and owner-selected 20 mm
maximum. Bolt sizes remain 5 mm increments. These limits are calculation inputs,
not an independent verification of the hardware's thread strength or clearance.

Supplied drawing dimensions: bracket width 63 mm, assembly height 31.9 mm,
wheel diameter 29.8 mm, rectangular spacer width 63.5 mm. Individual spacer
heights and exposed thread length share one physical scale. The bolt image is
registered under the left socket head; its 8 mm-wide/20 mm-long thread texture
is repeated and clipped, so changing bolt length does not stretch the pitch.
For more than 80 blocks, the drawing shows a combined stack and retains the
quantities instead of creating an unbounded number of SVG elements.

`assets/calsis-wheel/` contains cropped/downsampled browser copies and dimension
references. `reference-images.zip` preserves the original upload, including
both future 90 mm spacer images. The 90 mm spacer is **not** an available
calculator size; it remains a reference. No generation or redrawing was applied
to the wheel/thread captures. Keep the assets folder alongside the HTML when
using it offline.

Focused browser checks (Playwright and Chromium, as below):

```sh
python3 -m unittest discover -s tests -p test_wheel_spacer_browser.py -v
```

They check actual-stack rounding, image loading, per-block dimensions, bolt
origin/length and exposed engagement, path visibility, invalid-input clearing,
mobile and print layout, and retention of the future spacer upload.

## Stock Cut plan

`stock_cut_plan.html` is a public, self-contained HTML/CSS/JavaScript calculator.
It runs offline too, without libraries or uploads. It plans up to 2,000 pieces
from one stock length with start/end trims and saw kerf. All calculations use
integer thousandths of a millimetre; finer inputs are rejected, not rounded.

Bare cut-list pairs mean **length × quantity**: `400 x 2` is two 400 mm pieces.
Quantity-first entries need an explicit unit: `2 x 400mm`. This fixes the
original Python parser's ambiguous interpretation of `400 x 2`. Units mm, cm
and m can be mixed in the list; the separate settings fields are in mm.

The accepted default reserves a full kerf after each piece, except when the
last piece finishes exactly at the usable stock end. Trims are total removed
lengths, including trim-cut kerf. An explicit between-pieces-only option is
also available. Offcuts, kerf loss and trim loss are reported separately;
diagrams account for every part of each purchased length.

The planner compares first-fit and best-fit decreasing. For at most 24 pieces
it also tries a bounded search (20,000 nodes). It claims a minimum stock count
only when the plan reaches a valid lower bound or the search completes. Other
results explicitly remain heuristic; minimum stock count does not mean the
best possible distribution of reusable offcuts. Identical cutting patterns
are grouped. Edited/cleared inputs invalidate both the displayed plan and its
exports. Reports can be copied, downloaded as text, or printed with diagrams.

Focused checks:

```sh
node tests/stock-cut-plan.test.cjs
python3 -m unittest discover -s tests -p test_stock_cut_browser.py -v
```

The browser check requires Playwright and Chromium, as described below. It
also checks the standalone file, mobile layout, scaled segments and report
exports. Algorithm checks include an independent exhaustive small-case oracle.

## User access

`users.html` opens the login form directly, with a **Technician** / **Admin** dropdown and a **Show/Hide password** button. The old `staff.html` bookmark redirects here. Each role unlocks a separate
encrypted bundle. Technician receives technician tools only. Admin receives
both technician and admin tools, all unlocked by the admin password. Select
Admin to use the admin password; it does not log in as Technician.

**Remember this browser** stores an unlocking value in that browser profile,
with no expiry. Unchecked, access is retained in tab-session storage instead.
**Logout** clears both roles' remembered and session access, clears the current
tool, and signals other open user tabs to lock. Back/Forward navigation
rechecks access rather than restoring an unlocked tool. This does not log out
another device or erase downloaded/copied content.

The included pages are dummy examples, deliberately public under
`examples/staff/`. Real private tool source must live **outside this repository**.
Only encrypted output belongs here. Before passwords are configured, the two
role pages display a setup message and cannot be unlocked.

## Set passwords and build locally

Requires Python 3 and Node.js 24 LTS. Install the pinned build dependency:

```sh
npm ci --ignore-scripts
python3 scripts/set_staff_passwords.py
```

The Python command creates a sibling `tools-private` directory with the two
dummy pages on first use. It prompts for and confirms each password with echo
disabled, and passes them to the builder through stdin. They are never saved
or included in command arguments. Use two different, long, unique passphrases.
It also saves derived encryption keys to `~/.config/tvc-tools/build-keys.json`,
outside the repository. The file is created with owner-only read/write
permissions (0600), in a new private directory (0700). These keys can unlock
the tools, so protect them like passwords and never commit or share them.
The password text itself is not saved. Run this setup again when changing
passwords or setting up another machine.

After this one-time setup, rebuild edited tools without entering passwords:

```sh
python3 scripts/rebuild_staff.py
```

This uses the local private keys and checks that they still unlock the current
encrypted pages before changing output. It refuses missing, outdated or
overly permissive key files. Both setup and rebuild only change local files;
publishing remains a separate Git operation. The build will not write keys
inside the public repository or generated output directory.

To see the passwords while typing and confirming them, use:

```sh
python3 scripts/set_staff_passwords.py --show-passwords
```

This explicitly enables visible terminal input; the script still does not save
passwords. Hidden entry remains the default.

Optional arguments: `--source /path/to/private-tools` and `--node /path/to/node`.
On this development machine the command also finds the local, ignored runtime
at `.runtime/node/bin/node`; that runtime and `node_modules` are not published.

The builder uses StatiCrypt 3.5.4 for encryption/decryption. `staff-salts.json`
contains public random salts, **not passwords**. Retain it across rebuilds so
remembered logins continue working when content changes. A password change
requires a fresh login to the newly encrypted content.

Generated files to commit after configuring passwords:

- `technician.html`, `admin.html` and `users.html`: encrypted bundles and login shell.
- `staff-salts.json`: public encryption configuration.
- `assets/staticrypt.js` and `assets/staticrypt.LICENSE.txt`: pinned runtime
  and its MIT licence; these are regenerated by the builder.

Preview from this repository with:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open `http://localhost:8000/users.html` on the same machine. If using SSH from
Windows, forward port 8000 (`ssh -L 8000:127.0.0.1:8000 alex@<host>`) and open
that localhost URL on Windows. Production login requires HTTPS. Opening the
HTML directly from disk is not the supported preview method.

Building changes local files only. Review and commit encrypted output, then
publish through the repository's normal GitHub Pages branch. No automatic
deployment or Pages configuration is added by this change.

## Add a private tool

Edit `tools-private/manifest.json` outside this repository:

```json
{
  "tools": [
    {"id": "example", "title": "Example calculator", "access": "technician", "file": "example.html"}
  ]
}
```

Use `"access": "admin"` for an admin-only tool. Technician tools are included
automatically in the admin bundle, so there is one source file to maintain.
File paths are relative to the private directory. Rebuild with
`python3 scripts/rebuild_staff.py`. Keep a private backup of that directory.

Tools must be self-contained HTML, with their private JavaScript, CSS and data
inline. The builder does not follow or encrypt external asset links. Tools run
in a sandboxed frame with scripts, forms, downloads and dialogs enabled; they
cannot navigate the parent or use its login storage. Tools needing browser
storage, external APIs or additional files need a separate integration check.

## Protection boundary

This is shared-password encryption for lightweight user tools, not an account
server. Someone who knows a password can copy the corresponding unlocked
tools. Remembered access grants the same capability to anyone using that
browser profile. All pages under `tvctech.github.io` share an origin, so only
trusted scripts should be published there.

Changing a password protects newly published content. It cannot revoke old
downloads or encrypted revisions still available in public Git history.
Never publish private plaintext even temporarily, and never put passwords or
unlocking values in Git, links, screenshots, logs or chat. `noindex` is a search
hint, not access control.

## Checks

```sh
npm test
```

Build tests verify role separation, admin inclusion of technician content,
absence of plaintext/passwords in output, stable salts, password changes and
private-source path checks, private key permissions, key-based rebuilds and
rejection of stale keys. Browser tests use temporary output and fixture
passwords only, never overwrite the configured site, and exercise both roles,
remembered access across a browser restart, logout across tabs, browser Back,
and disabled persistent storage:

```sh
python3 -m venv /tmp/tvc-tools-tests
/tmp/tvc-tools-tests/bin/python -m pip install playwright
/tmp/tvc-tools-tests/bin/python -m playwright install chromium
/tmp/tvc-tools-tests/bin/python -m unittest discover -s tests -p test_staff_browser.py -v
```

Set `TVC_NODE` or `TVC_CHROMIUM` if executables are outside PATH. For build
details see [StatiCrypt](https://github.com/robinmoisson/staticrypt).
