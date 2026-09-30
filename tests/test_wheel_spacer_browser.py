"""Real-browser checks for the dimensioned CALSIS wheel assembly diagram."""
from pathlib import Path
import unittest
from zipfile import ZipFile

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class WheelSpacerBrowserTests(unittest.TestCase):
    def test_actual_stack_geometry_images_and_mobile(self):
        with sync_playwright() as pw:
            browser = pw.chromium.launch(executable_path='/usr/bin/chromium', headless=True)
            try:
                page = browser.new_page(viewport={'width': 1000, 'height': 1100})
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.goto((ROOT / 'Calsis160WheelSpacerCalc.html').as_uri())
                expect(page.locator('#assemblyPanel')).to_be_hidden()
                # Drawing example, rounding both ways, multiple thin blocks,
                # no spacers after rounding, and a 90 mm total built from the
                # existing sizes (the future 90 mm part is not selectable).
                for diameter, stack, bolt, pieces in [
                    ('242.3', 40, 65, [40]),
                    ('180', 9, 35, [5, 3, 1]),
                    ('179', 8, 35, [5, 3]),
                    ('467', 152, 175, [40, 40, 40, 20, 10, 1, 1]),
                    ('162.5', 0, 25, []),
                    ('342.3', 90, 115, [40, 40, 10]),
                ]:
                    with self.subTest(diameter=diameter):
                        page.locator('#pipeDia').fill(diameter)
                        expect(page.locator('#boltValue')).to_have_text(f'M8 × {bolt}')
                        expect(page.locator('#assemblyPanel')).to_be_visible()
                        geometry = page.locator('#assemblySvg').evaluate('''svg => {
                            const box = selector => {
                                const r = svg.querySelector(selector);
                                return Object.fromEntries(['x','y','width','height'].map(k => [k,Number(r.getAttribute(k))]));
                            };
                            return {wheel:box('#wheelImage'), bolt:box('#boltShaft'),
                                pieces:[...svg.querySelectorAll('.spacer')].map(r => ({
                                    mm:Number(r.dataset.mm), y:Number(r.getAttribute('y')),
                                    height:Number(r.getAttribute('height')),width:Number(r.getAttribute('width'))
                                }))};
                        }''')
                        self.assertEqual([p['mm'] for p in geometry['pieces']], pieces)
                        scale = geometry['wheel']['width'] / 63
                        bottom = geometry['wheel']['y'] + 31.9 * scale
                        self.assertAlmostEqual(geometry['bolt']['y'], bottom - 7.5 * scale)
                        self.assertAlmostEqual(geometry['bolt']['height'], bolt * scale)
                        self.assertAlmostEqual(geometry['bolt']['x'] + 4 * scale,
                                               geometry['wheel']['x'] + 9 * scale)
                        for piece in geometry['pieces']:
                            self.assertAlmostEqual(piece['width'], 63.5 * scale)
                            self.assertAlmostEqual(piece['y'], bottom)
                            self.assertAlmostEqual(piece['height'], piece['mm'] * scale)
                            bottom += piece['height']
                        engagement = bolt - 7.5 - stack
                        tip = geometry['bolt']['y'] + geometry['bolt']['height']
                        self.assertAlmostEqual(tip - bottom, engagement * scale)
                        expect(page.locator('#assemblySummary')).to_contain_text(f'{engagement:g} mm engagement')

                # Both supplied PNGs must really decode, not just have an href.
                for asset in ['wheel-bracket.png', 'thread-20mm.png']:
                    loaded = page.evaluate('''async url => {
                        const im = new Image(); im.src = url; await im.decode();
                        return im.naturalWidth > 0 && im.naturalHeight > 0;
                    }''', f'assets/calsis-wheel/{asset}')
                    self.assertTrue(loaded)
                page.locator('#showBoltPath').check()
                expect(page.locator('#assemblySvg > g')).to_have_attribute('opacity', '.25')
                page.locator('#assemblyExample').click()
                expect(page.locator('#pipeDia')).to_have_value('242.3')
                expect(page.locator('#assemblySvg .spacer')).to_have_count(1)
                page.locator('#showBoltPath').uncheck()
                expect(page.locator('#assemblySvg > g')).to_have_attribute('opacity', '1')
                page.locator('#assemblyPanel').screenshot(path='/tmp/wheel-spacer-desktop.png')
                page.set_viewport_size({'width': 390, 'height': 844})
                self.assertTrue(page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
                self.assertTrue(page.locator('.assembly-scroll').evaluate('e => e.scrollWidth <= e.clientWidth'))
                page.locator('#assemblyPanel').screenshot(path='/tmp/wheel-spacer-mobile.png')
                page.emulate_media(media='print')
                expect(page.locator('#assemblyPanel')).to_be_visible()
                expect(page.locator('.assembly-toolbar')).to_be_hidden()
                page.emulate_media(media='screen')
                # Invalid/cleared input cannot leave a stale diagram visible.
                for value in ['100', '', '1e100']:
                    page.locator('#pipeDia').fill(value)
                    expect(page.locator('#assemblyPanel')).to_be_hidden()
                    expect(page.locator('#assemblySvg')).to_be_empty()
                # Avoid an unbounded DOM for an accidentally huge entry.
                page.locator('#pipeDia').fill('1000000')
                expect(page.locator('#assemblySvg .spacer')).to_have_count(1)
                expect(page.locator('#assemblySvgDesc')).to_contain_text('Individual blocks omitted')
                self.assertEqual(errors, [])
            finally:
                browser.close()

    def test_original_reference_upload_retains_future_spacer(self):
        with ZipFile(ROOT / 'assets/calsis-wheel/reference-images.zip') as archive:
            self.assertIn('90mm spacer.PNG', archive.namelist())
            self.assertIn('90mm spacer dimesnion .png', archive.namelist())
            self.assertIn('wheel and spacer assembly dimesnions.png', archive.namelist())


if __name__ == '__main__':
    unittest.main()
