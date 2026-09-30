"""Browser checks for the standalone public Stock Cut plan tool."""
from pathlib import Path
import tempfile
import unittest

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]


class StockCutBrowserTests(unittest.TestCase):
    def test_plan_diagrams_validation_exports_and_mobile(self):
        with sync_playwright() as pw:
            browser = pw.chromium.launch(executable_path='/usr/bin/chromium', headless=True)
            try:
                page = browser.new_page(viewport={'width': 1180, 'height': 1100}, accept_downloads=True)
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.add_init_script("Object.defineProperty(navigator, 'clipboard', {value: {writeText: () => Promise.reject(new Error('denied'))}})")
                page.goto((ROOT / 'index.html').as_uri())
                page.get_by_role('link', name='Stock Cut plan').click()
                expect(page.get_by_role('heading', name='Stock Cut plan', exact=True)).to_be_visible()
                expect(page.locator('#kerf-mode')).to_have_value('each')
                expect(page.locator('#bar-count')).to_have_text('3')
                expect(page.locator('#piece-count')).to_have_text('7')
                expect(page.locator('#quality')).to_contain_text('Minimum stock count confirmed')
                expect(page.locator('.bar-card')).to_have_count(2)
                page.screenshot(path='/tmp/stock-cut-plan-desktop.png', full_page=True)
                # Fractions, two end trims, and the final separating kerf.
                for field, value in [('stock','1000'),('kerf','2.5'),('trim-start','10'),('trim-end','20'),('cut-list','100 x 3')]:
                    page.locator('#' + field).fill(value)
                expect(page.locator('#results')).to_be_hidden()
                page.get_by_role('button', name='Plan cuts', exact=True).click()
                expect(page.locator('#offcuts')).to_have_text('662.5 mm')
                widths = page.locator('.diagram').evaluate('(element) => [...element.children].map(child => parseFloat(child.style.width))')
                self.assertAlmostEqual(sum(widths),100)
                self.assertEqual(widths,[1,10,.25,10,.25,10,.25,66.25,2])
                expect(page.locator('.segment.kerf')).to_have_count(3)
                with page.expect_download() as downloaded:
                    page.get_by_role('button', name='Download report').click()
                with tempfile.TemporaryDirectory() as directory:
                    destination = Path(directory) / 'report.txt'
                    downloaded.value.save_as(destination)
                    report = destination.read_text(encoding='utf-8')
                    self.assertIn('STOCK CUT PLAN',report)
                    self.assertIn('Total offcuts: 662.5 mm',report)
                    self.assertIn('Kerf loss: 7.5 mm',report)
                    self.assertIn('Trim loss: 30 mm',report)
                    self.assertIn('Pieces: 3',report)
                page.get_by_role('button', name='Copy report').click()
                expect(page.locator('#report-fallback')).to_be_visible()
                self.assertIn('Total offcuts: 662.5 mm',page.locator('#report-text').input_value())
                page.evaluate('window.print = () => {window.printInvoked = true;}')
                page.get_by_role('button', name='Print plan').click()
                self.assertTrue(page.evaluate('window.printInvoked'))
                page.emulate_media(media='print')
                expect(page.locator('#input-panel')).to_be_hidden()
                expect(page.locator('#results')).to_be_visible()
                page.emulate_media(media='screen')
                # Failed/new inputs must not leave an old plan available to export.
                page.locator('#cut-list').fill('1001')
                expect(page.locator('#results')).to_be_hidden()
                expect(page.locator('#report-fallback')).to_be_hidden()
                expect(page.locator('#report-text')).to_have_value('')
                page.get_by_role('button', name='Plan cuts', exact=True).click()
                expect(page.locator('#error')).to_contain_text('will not fit')
                page.get_by_role('button', name='Clear cut list').click()
                expect(page.locator('#cut-list')).to_have_value('')
                expect(page.locator('#bars .bar-card')).to_have_count(0)
                page.get_by_role('button', name='Plan cuts', exact=True).click()
                expect(page.locator('#error')).to_contain_text('at least one')
                page.get_by_role('button', name='Load example').click()
                expect(page.locator('#piece-count')).to_have_text('7')
                page.set_viewport_size({'width':390,'height':844})
                self.assertTrue(page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
                page.screenshot(path='/tmp/stock-cut-plan-mobile.png',full_page=True)
                self.assertEqual(errors,[])
            finally:
                browser.close()


if __name__ == '__main__':
    unittest.main()
