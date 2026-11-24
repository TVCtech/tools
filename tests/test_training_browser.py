"""Encrypted integration checks; set TVC_TRAINING_SOURCE to the private course folder.

No course content, answers, production keys or passwords are written to this test.
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import unittest
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass

@unittest.skipUnless(os.environ.get('TVC_TRAINING_SOURCE'), 'Private training source is optional')
class TrainingBrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='tvc-training-browser-')
        cls.base = Path(cls.temp.name)
        cls.site = cls.base / 'site'
        cls.site.mkdir()
        shutil.copytree(ROOT / 'assets', cls.site / 'assets')
        shutil.copytree(ROOT / 'examples/staff', cls.base / 'tools')
        subprocess.run([os.environ.get('TVC_NODE', 'node'), str(ROOT / 'scripts/build-staff.cjs')], input=json.dumps({
            'source': str(cls.base / 'tools'), 'output': str(cls.site), 'keyFile': str(cls.base / 'keys.json'),
            'passwords': {'technician': 'fixture-technician-password', 'admin': 'fixture-admin-password'},
            'companyAccounts': [{'id': a, 'label': a, 'password': 'fixture-' + a + '-password'} for a in ['ss7', 'training', 'ptl']],
            'trainingSource': os.environ['TVC_TRAINING_SOURCE'],
        }), text=True, check=True, capture_output=True)
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(cls.site)))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f'http://127.0.0.1:{cls.server.server_port}'
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(executable_path=os.environ.get('TVC_CHROMIUM', shutil.which('chromium')), headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close(); cls.pw.stop()
        cls.server.shutdown(); cls.server.server_close(); cls.thread.join(); cls.temp.cleanup()

    def start(self, account='ss7', mobile=False, remember=True):
        context = self.browser.new_context(viewport={'width': 390 if mobile else 1280, 'height': 900}, accept_downloads=True)
        self.addCleanup(context.close)
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(self.url + '/' + account + '.html')
        page.locator('#remember').set_checked(remember)
        page.locator('#password').fill('fixture-' + account + '-password')
        requests = []
        page.on('request', lambda request: requests.append(request.url))
        page.locator('#login-button').click()
        expect(page.locator('#tools-panel')).to_be_visible(timeout=30000)
        self.assertFalse(any(url.endswith('.bin') for url in requests), 'Login fetched course resources')
        if account == 'ptl':
            expect(page.locator('[data-training]')).to_have_count(0)
            return page, None, errors
        page.locator('[data-training]').click()
        frame = page.frame_locator('#tool-frame')
        expect(frame.locator('.choice')).to_have_count(3, timeout=30000)
        self.assertLess(len([url for url in requests if url.endswith('.bin')]), 15)
        return page, frame, errors

    def quiz(self, page, frame, company=None, test='technician'):
        frame.locator('.choice').nth(2).click()
        expect(frame.locator('#start-button')).to_be_enabled(timeout=15000)
        frame.locator('#person-name').fill('Browser Test')
        if company is not None:
            expect(frame.locator('#person-company')).to_be_visible()
            frame.locator('#person-company').fill(company)
        else:
            expect(frame.locator('#person-company')).to_be_hidden()
            expect(frame.locator('#company-fixed')).to_have_text('SubSea7')
        frame.locator('[name=test-choice][value="' + test + '"]').check()
        # Capture only within this test browser; nothing is exposed in the production page.
        frame.locator('body').evaluate('''async (element, test) => {
          window.testBank = await TrainingHost.readJson('questions-' + test + '.json');
          const selectQuestions = TrainingQuestionSelection.selectQuestions;
          TrainingQuestionSelection.selectQuestions = (questions, settings) => {
            const selected = selectQuestions(questions, settings);
            window.testSelectedQuestions = selected;
            return selected;
          };
          window.testEvents = [];
          const original = TrainingHost.submitAttempt;
          TrainingHost.submitAttempt = record => { testEvents.push(record); return original(record); };
          const draw = TrainingCertificate.drawCertificate;
          TrainingCertificate.drawCertificate = spec => { window.testDraft = spec.isTestDraft; return draw(spec); };
        }''', test)
        frame.locator('#start-button').click()
        expect(frame.locator('#question-view')).to_be_visible(timeout=15000)

    def answer(self, frame, correct_count):
        for index in range(20):
            expect(frame.locator('#progress-label')).to_have_text(f'Question {index + 1} of 20')
            option = frame.locator('body').evaluate('''(element, spec) => {
                const q = testSelectedQuestions[spec.index];
                return spec.correct ? q.answer : q.options.find(o => o.id !== q.answer).id;
            }''', {'index': index, 'correct': index < correct_count})
            frame.locator('[name=answer][value="' + option + '"]').check()
            frame.locator('#next-button').click()
        expect(frame.locator('#result-view')).to_be_visible()

    def test_manual_search_panels_mobile_and_sandbox(self):
        page, frame, errors = self.start(mobile=True)
        frame.locator('.choice').first.click()
        expect(frame.locator('#search-box')).to_be_visible(timeout=15000)
        frame.locator('#search-box').fill('zzzznoresultszzzz')
        expect(frame.locator('.module-card:visible')).to_have_count(0)
        frame.locator('#search-box').fill('')
        frame.locator('.module-card').first.click()
        expect(frame.locator('.panel')).not_to_have_count(0, timeout=15000)
        dimensions = frame.locator('.stage').first.evaluate('(e) => ({height:e.clientHeight,width:e.clientWidth,flow:getComputedStyle(e).display})')
        self.assertEqual(dimensions['flow'], 'flex')
        self.assertGreater(dimensions['height'], dimensions['width'] * 9 / 16)
        self.assertTrue(frame.locator('body').evaluate('''() => {try {localStorage.getItem('x');return false;} catch {return true;}}'''))
        self.assertTrue(frame.locator('body').evaluate('''async () => await TrainingHost.writeStoredValue('browser-test', 7) && await TrainingHost.readStoredValue('browser-test', 0) === 7'''))
        self.assertTrue(frame.locator('body').evaluate('''() => !('__TVC_TRAINING_CONTEXT__' in window) || !('key' in __TVC_TRAINING_CONTEXT__)'''))
        panel_id = frame.locator('.panel').last.get_attribute('id')
        frame.locator('#panel-jump').select_option(panel_id)
        expect(frame.locator('#panel-jump')).to_have_value(panel_id)
        source = Path(os.environ['TVC_TRAINING_SOURCE'])
        board_page = next(p.relative_to(source).as_posix() for p in source.rglob('*.html') if 'href="#' in p.read_text())
        frame.locator('body').evaluate('(e, path) => TrainingHost.openPage(\"../\" + path)', board_page)
        expect(frame.locator('.stage a[data-training-link^=\"#\"]')).not_to_have_count(0, timeout=15000)
        frame.locator('.stage a[data-training-link^=\"#\"]').first.click()
        expect(frame.locator('#training-load-error')).to_have_count(0)
        page.locator('#logout').click()
        expect(page.locator('#login-panel')).to_be_visible()
        self.assertIsNone(page.locator('#tool-frame').get_attribute('srcdoc'))
        self.assertEqual(errors, [])

    def test_each_test_and_retry_has_picture_and_hint_minimums(self):
        for bank in ['technician', 'inspector']:
            with self.subTest(bank=bank):
                page, frame, errors = self.start()
                self.quiz(page, frame, test=bank)
                available_hints = frame.locator('body').evaluate('() => testBank.questions.filter(q => q.hint).length')
                draws = []
                for attempt in range(2):
                    pictures = 0; hints = 0; identifiers = []
                    for index in range(20):
                        expect(frame.locator('#progress-label')).to_have_text(f'Question {index + 1} of 20')
                        question = frame.locator('body').evaluate('''(element, index) => {
                            const q = testSelectedQuestions[index];
                            return {id:q.id, answer:q.answer, text:q.question};
                        }''', index)
                        expect(frame.locator('#question-text')).to_have_text(question['text'])
                        identifiers.append(question['id'])
                        if frame.locator('#question-picture').is_visible() or frame.locator('#question-options img').count(): pictures += 1
                        if frame.locator('#hint-button').is_visible():
                            hints += 1
                            if hints == 1:
                                frame.locator('#hint-button').click()
                                expect(frame.locator('#hint-panel')).to_be_visible()
                        frame.locator('[name=answer][value="' + question['answer'] + '"]').check()
                        frame.locator('#next-button').click()
                    expect(frame.locator('#result-grade')).to_have_text('Pass with Distinction')
                    self.assertEqual(len(set(identifiers)), 20)
                    self.assertGreaterEqual(pictures, 5)
                    if available_hints: self.assertGreaterEqual(hints, 1)
                    else: self.assertEqual(hints, 0)
                    events = frame.locator('body').evaluate('() => testEvents.filter(e => e.status === "Finished").map(e => ({hints:e.hintsUsed,score:e.score}))')
                    self.assertEqual(events[-1], {'hints': 1 if hints else 0, 'score': 20})
                    draws.append(set(identifiers))
                    if attempt == 0:
                        frame.locator('#retry-button').click()
                        expect(frame.locator('#question-view')).to_be_visible(timeout=15000)
                self.assertNotEqual(draws[0], draws[1])
                self.assertEqual(errors, [])

    def test_admin_question_bank_is_unlisted_searchable_and_read_only(self):
        page, frame, errors = self.start(account='admin', mobile=True)
        requests = []
        page.on('request', lambda request: requests.append((request.method, request.url)))
        self.assertEqual(frame.locator('[data-training-link*=\"question-bank\"]').count(), 0)
        # Exercise the exact URL Alex will receive, including login restoration.
        page.goto(self.url + '/admin.html#training=calsis-160&page=quiz%2Fquestion-bank.html')
        frame = page.frame_locator('#tool-frame')
        count = len(json.loads((Path(os.environ['TVC_TRAINING_SOURCE']) / 'quiz/questions-technician.json').read_text())['questions'])
        expect(frame.locator('.bank-question')).to_have_count(count, timeout=30000)
        expect(frame.locator('.correct-badge:visible')).to_have_count(count)
        frame.locator('#show-answers').uncheck()
        expect(frame.locator('.correct-badge:visible')).to_have_count(0)
        frame.locator('#show-answers').check()
        first_id = frame.locator('.bank-question').first.get_attribute('id').removeprefix('question-')
        frame.locator('#bank-search').fill(first_id)
        expect(frame.locator('.bank-question:visible')).to_have_count(1)
        frame.locator('#bank-search').fill('zzzznoresultszzzz')
        expect(frame.locator('.bank-question:visible')).to_have_count(0)
        frame.locator('#bank-search').fill('')
        image = frame.locator('.bank-question img:not(.hint-picture)').first
        image.scroll_into_view_if_needed()
        expect(image).to_have_attribute('src', __import__('re').compile('^blob:'), timeout=15000)
        image.click()
        expect(frame.locator('.picture-zoom')).to_be_visible()
        page.keyboard.press('Escape')
        expect(frame.locator('.picture-zoom')).to_be_hidden()
        self.assertTrue(frame.locator('body').evaluate('() => document.documentElement.scrollWidth <= innerWidth'))
        self.assertFalse(any(method == 'POST' or 'script.google.com' in url for method, url in requests))
        self.assertEqual(errors, [])

    def test_company_can_paste_both_unlisted_links_without_remember(self):
        for account in ['ss7', 'training']:
            with self.subTest(account=account):
                page, frame, errors = self.start(account=account, mobile=True, remember=False)
                requests = []
                page.on('request', lambda request: requests.append((request.method, request.url)))
                stored = page.evaluate('() => JSON.stringify(localStorage)')
                for bank, filename in [('technician', 'question-bank.html'), ('inspector', 'question-bank-inspector.html')]:
                    page.goto(self.url + '/users.html#training=calsis-160&page=quiz%2F' + filename)
                    frame = page.frame_locator('#tool-frame')
                    count = len(json.loads((Path(os.environ['TVC_TRAINING_SOURCE']) / f'quiz/questions-{bank}.json').read_text())['questions'])
                    expect(frame.locator('h1')).to_have_text(bank.title() + ' Question Bank', timeout=30000)
                    expect(frame.locator('.bank-question')).to_have_count(count, timeout=15000)
                    expect(frame.locator('.correct-badge:visible')).to_have_count(count)
                    expect(page.locator('#your-tools-home')).to_have_attribute('href', account + '.html')
                    frame.locator('#bank-search').fill('zzzznoresultszzzz')
                    expect(frame.locator('.bank-question:visible')).to_have_count(0)
                    frame.locator('#bank-search').fill('')
                    self.assertTrue(frame.locator('body').evaluate('() => document.documentElement.scrollWidth <= innerWidth'))
                    self.assertEqual(page.evaluate('() => JSON.stringify(localStorage)'), stored)
                    page.locator('#your-tools-home').click()
                    expect(page.locator('[data-training]')).to_have_count(1)
                    page.locator('[data-training]').click()
                    expect(frame.locator('.choice')).to_have_count(3, timeout=15000)
                    expect(frame.locator('[data-training-link*=\"question-bank\"]')).to_have_count(0)
                self.assertFalse(any(method == 'POST' or 'script.google.com' in url for method, url in requests))
                self.assertEqual(errors, [])

    def test_question_link_requires_login_and_preserves_destination(self):
        context = self.browser.new_context()
        self.addCleanup(context.close)
        page = context.new_page()
        requests = []
        page.on('request', lambda request: requests.append(request.url))
        page.goto(self.url + '/users.html#training=calsis-160&page=quiz%2Fquestion-bank-inspector.html')
        expect(page.locator('#login-panel')).to_be_visible()
        self.assertFalse(any(url.endswith('.bin') for url in requests))
        page.locator('#role').fill('ss7')
        page.locator('#password').fill('fixture-ss7-password')
        page.locator('#login-button').click()
        frame = page.frame_locator('#tool-frame')
        expect(frame.locator('h1')).to_have_text('Inspector Question Bank', timeout=30000)
        expect(frame.locator('.bank-question')).to_have_count(100)
        expect(page.locator('#your-tools-home')).to_have_attribute('href', 'ss7.html')

    def test_fail_retry_pass_distinction_download_and_new_tab(self):
        page, frame, errors = self.start()
        self.quiz(page, frame)
        # Decode all picture paths used by the question banks, including answers and hints.
        counts = frame.locator('body').evaluate('''async () => {
            const banks = await Promise.all(['questions-technician.json','questions-inspector.json'].map(p => TrainingHost.readJson(p)));
            const paths = new Set();
            banks.forEach(b => b.questions.forEach(q => {if(q.picture)paths.add(q.picture);if(q.hint)paths.add(q.hint.picture);q.options.forEach(o=>{if(o.picture)paths.add(o.picture);});}));
            for(const path of paths){const url=await TrainingHost.assetUrl(path);await new Promise((ok,no)=>{const image=new Image();image.onload=ok;image.onerror=no;image.src=url;});}
            return paths.size;
        }''')
        self.assertGreater(counts, 0)
        self.answer(frame, 0)
        expect(frame.locator('#result-grade')).to_have_text('Not passed')
        expect(frame.locator('#download-button')).to_be_hidden()
        expect(frame.locator('#recording-notice')).to_contain_text('not recorded centrally yet')
        with page.context.expect_page() as new_page:
            frame.locator('#review-list a').first.click()
        manual = new_page.value
        expect(manual.locator('#viewer')).to_be_visible(timeout=30000)
        expect(manual.frame_locator('#tool-frame').locator('.panel')).not_to_have_count(0, timeout=30000)
        manual.close()
        expect(frame.locator('#result-view')).to_be_visible()
        frame.locator('#retry-button').click()
        expect(frame.locator('#test-label')).to_contain_text('attempt 2', timeout=15000)
        self.answer(frame, 14)
        expect(frame.locator('#result-grade')).to_have_text('Pass')
        frame.locator('#retry-button').click()
        expect(frame.locator('#test-label')).to_contain_text('attempt 3', timeout=15000)
        self.answer(frame, 20)
        expect(frame.locator('#result-grade')).to_have_text('Pass with Distinction')
        self.assertTrue(frame.locator('body').evaluate('() => testDraft'))
        with page.expect_download() as download:
            frame.locator('#download-button').click()
        pdf = Path(download.value.path()).read_bytes()
        self.assertTrue(pdf.startswith(b'%PDF-'))
        self.assertIn(b'%%EOF', pdf)
        self.assertEqual(frame.locator('body').evaluate('() => testEvents.map(e => e.status)'), ['Started','Finished'] * 3)
        self.assertEqual(errors, [])

    def test_shared_company_and_failed_receipt_retry(self):
        page, frame, errors = self.start('training')
        # Exercise the real host POST/receipt handling with a local browser response.
        page.evaluate('''() => {
          const open = TVCTrainingViewer.prototype.submit;
          TVCTrainingViewer.prototype.submit = function(record) {
            this.descriptor.recording = {enabled:true,endpoint:'https://script.google.com/macros/s/fixture/exec',token:'fixture-token'};
            return open.call(this, record);
          };
        }''')
        captured = []
        failed = [True]
        def receive(route):
            data = json.loads(route.request.post_data)
            captured.append(data)
            record = data['record']
            route.fulfill(status=200, headers={'Access-Control-Allow-Origin':'*'}, json={
                'status': 'failed' if failed[0] else 'saved', 'attemptId': record['attemptId'], 'eventStatus': record['status'],
            })
        page.route('https://script.google.com/macros/s/fixture/exec', receive)
        self.quiz(page, frame, company='Other Company')
        self.answer(frame, 20)
        expect(frame.locator('#retry-recording')).to_be_visible(timeout=15000)
        failed[0] = False
        frame.locator('#retry-recording').click()
        expect(frame.locator('#recording-notice')).to_have_text('Your result has been recorded.', timeout=15000)
        expect(frame.locator('#retry-recording')).to_be_hidden()
        for status in ['Started', 'Finished']:
            records = [r['record'] for r in captured if r['record']['status'] == status]
            self.assertGreaterEqual(len(records), 2)
            self.assertTrue(all(r == records[0] for r in records))
        self.assertTrue(all(r['account'] == 'training' and r['record']['company'] == 'Other Company' for r in captured))
        self.assertEqual(errors, [])

    def test_unconfigured_customer_keeps_tool_access(self):
        self.start('ptl')
