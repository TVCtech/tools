"""Real-browser checks using only temporary pages and public fixture passwords.

Install playwright and Chromium, then run:
  TVC_NODE=/path/to/node python3 -m unittest discover -s tests -p test_staff_browser.py -v
Optional TVC_CHROMIUM overrides the Chromium executable.
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import threading
import unittest

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
PASSWORDS = {"technician": "fixture-technician-password", "admin": "fixture-admin-password"}


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


class StaffBrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="tvc-staff-browser-")
        cls.base = Path(cls.temp.name)
        cls.site = cls.base / "site"
        cls.site.mkdir()
        for name in ("index.html", "staff.html"):
            shutil.copy2(ROOT / name, cls.site / name)
        shutil.copytree(ROOT / "assets", cls.site / "assets")
        source = cls.base / "private"
        shutil.copytree(ROOT / "examples/staff", source)
        subprocess.run(
            [os.environ.get("TVC_NODE", "node"), str(ROOT / "scripts/build-staff.cjs")],
            input=json.dumps({"source": str(source), "output": str(cls.site), "passwords": PASSWORDS}),
            text=True, encoding="utf-8", check=True,
        )
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(cls.site)))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}"
        cls.pw = sync_playwright().start()

    @classmethod
    def tearDownClass(cls):
        cls.pw.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.temp.cleanup()

    def context(self, profile):
        return self.pw.chromium.launch_persistent_context(
            str(self.base / profile), headless=True,
            executable_path=os.environ.get("TVC_CHROMIUM", shutil.which("chromium")),
            args=["--disable-dev-shm-usage"],
        )

    def login(self, page, role, remember=False, password=None):
        page.goto(self.url + f"/{role}.html")
        expect(page.locator("#login-button")).to_be_enabled()
        page.locator("#password").fill(password or PASSWORDS[role])
        page.locator("#remember").set_checked(remember)
        page.locator("#login-button").click()

    def test_roles_remember_restart_logout_tabs_and_back(self):
        context = self.context("remembered-profile")
        try:
            page = context.pages[0]
            page.goto(self.url)
            page.get_by_role("link", name="Login", exact=True).click()
            expect(page).to_have_url(self.url + "/users.html")
            expect(page.get_by_role("heading", name="Users", exact=True)).to_be_visible()
            expect(page.locator("#role")).to_be_visible()
            page.locator("#password").fill("visible test input")
            page.get_by_role("button", name="Show password", exact=True).click()
            expect(page.locator("#password")).to_have_attribute("type", "text")
            expect(page.locator("#password")).to_have_value("visible test input")
            page.get_by_role("button", name="Hide password", exact=True).click()
            expect(page.locator("#password")).to_have_attribute("type", "password")
            page.locator("#role").select_option("admin")
            expect(page).to_have_url(self.url + "/admin.html")
            expect(page.locator("#role")).to_have_value("admin")
            expect(page.locator("#password")).to_have_value("")
            page.goto(self.url + "/staff.html")
            expect(page).to_have_url(self.url + "/users.html")
            self.login(page, "admin", password=PASSWORDS["technician"])
            expect(page.locator("#login-message")).to_have_text("Incorrect password for this user.", timeout=30000)
            expect(page.locator("#tools-panel")).to_be_hidden()
            self.login(page, "technician", remember=True)
            expect(page.locator("#tools-panel")).to_be_visible(timeout=30000)
            expect(page.locator("#tool-list button")).to_have_count(1)
            page.get_by_role("button", name="Technician test page").click()
            page.frame_locator("#tool-frame").get_by_role("button", name="Test button").click()
            expect(page.frame_locator("#tool-frame").locator("#result")).to_have_text("The technician tool is working.")
            page.reload()
            expect(page.locator("#tools-panel")).to_be_visible(timeout=30000)
        finally:
            context.close()
        context = self.context("remembered-profile")
        try:
            page = context.pages[0]
            page.goto(self.url + "/technician.html")
            expect(page.locator("#tools-panel")).to_be_visible(timeout=30000)
            admin = context.new_page()
            self.login(admin, "admin", remember=True)
            expect(admin.locator("#tool-list button")).to_have_count(2, timeout=30000)
            admin.get_by_role("button", name="Technician test page").click()
            expect(admin.frame_locator("#tool-frame").get_by_role("heading", name="Technician test page")).to_be_visible()
            admin.locator("#back-to-tools").click()
            admin.get_by_role("button", name="Admin test page").click()
            expect(admin.frame_locator("#tool-frame").get_by_role("heading", name="Admin test page")).to_be_visible()
            # Leave an authenticated page in history, then log out from a second visit.
            admin.goto(self.url + "/admin.html?second-visit=1")
            expect(admin.locator("#tool-list button")).to_have_count(2, timeout=30000)
            admin.get_by_role("button", name="Admin test page").click()
            admin.locator("#logout").click()
            expect(admin).to_have_url(self.url + "/users.html?logged-out=1")
            expect(page.locator("#login-panel")).to_be_visible()
            expect(page.locator("#tools-panel")).to_be_hidden()
            self.assertIsNone(page.locator("#tool-frame").get_attribute("srcdoc"))
            self.assertEqual(admin.evaluate("Object.keys(localStorage).filter(k => k.startsWith('tvc-tools.staff.v1.') && !k.endsWith('.logout'))"), [])
            admin.go_back()
            # Frame navigation can add history entries at the same outer URL.
            expect(admin).to_have_url(re.compile(re.escape(self.url + "/admin.html") + r"(\?.*)?$"))
            expect(admin.locator("#tools-panel")).to_be_hidden()
            expect(admin.locator("#viewer")).to_be_hidden()
            for role in ("admin", "technician"):
                admin.goto(self.url + f"/{role}.html")
                expect(admin.locator("#login-button")).to_be_enabled()
                expect(admin.locator("#tools-panel")).to_be_hidden()
            # Confirm a fresh technician login works immediately after admin logout.
            self.login(admin, "technician")
            expect(admin.locator("#tool-list button")).to_have_count(1, timeout=30000)
        finally:
            context.close()

    def test_unchecked_remember_and_disabled_storage(self):
        context = self.context("session-profile")
        try:
            page = context.pages[0]
            self.login(page, "technician")
            expect(page.locator("#tools-panel")).to_be_visible(timeout=30000)
            self.assertIsNone(page.evaluate("localStorage.getItem('tvc-tools.staff.v1.technician')"))
            page.reload()
            expect(page.locator("#tools-panel")).to_be_visible(timeout=30000)
            page.locator("#logout").click()
            expect(page).to_have_url(self.url + "/users.html?logged-out=1")
            page.add_init_script("Object.defineProperty(window, 'localStorage', {get() {throw new Error('blocked');}})")
            self.login(page, "admin", remember=True)
            expect(page.locator("#tool-list button")).to_have_count(2, timeout=30000)
            expect(page.locator("#notice")).to_contain_text("could not save your login")
            expect(page.locator("#notice")).to_be_visible()
            page.locator("#logout").click()
            expect(page).to_have_url(self.url + "/users.html?logged-out=1")
        finally:
            context.close()


if __name__ == "__main__":
    unittest.main()
