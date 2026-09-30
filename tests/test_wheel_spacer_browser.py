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
                # existing sizes with the default original kit.
                for diameter, stack, bolt, pieces in [
                    ('242.3', 40, 65, [40]),
                    ('180', 9, 35, [5, 3, 1]),
                    ('179', 8, 35, [5, 3]),
                    ('467', 152, 180, [40, 40, 40, 20, 10, 1, 1]),
                    ('162.5', 0, 25, []),
                    ('342.3', 90, 110, [40, 40, 10]),
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

                # Stock lengths step by 10 mm from 70 onward. These ranges
                # independently cover both ends of the transition and the new
                # engagement allowance (42 mm stack allows 21.5 mm engagement).
                for stack, minimum, maximum in [(40,55,65),(41,55,70),(42,55,70),
                                                (45,60,70),(50,65,70),(51,65,80),
                                                (57,70,80),(58,80,80)]:
                    page.locator('#pipeDia').fill(str(2 * stack + 162.3))
                    expect(page.locator('#boltValue')).to_have_text(f'M8 × {maximum}')
                    expect(page.locator('.bolt-range-end .bolt-name')).to_have_text(
                        [f'M8 × {minimum}', f'M8 × {maximum}'])
                    self.assertLessEqual(maximum - stack - 7.5, 22)
                expect(page.locator('#assemblySvg')).not_to_contain_text('Wheel Ø')
                self.assertEqual(page.locator('#pipeDia').evaluate(
                    "e => getComputedStyle(e).appearance"), 'textfield')
                # The supplied PNGs must really decode, not just have an href.
                for asset in ['wheel-bracket.png', 'thread-20mm.png', '90mm-t-spacer.png']:
                    loaded = page.evaluate('''async url => {
                        const im = new Image(); im.src = url; await im.decode();
                        return im.naturalWidth > 0 && im.naturalHeight > 0;
                    }''', f'assets/calsis-wheel/{asset}')
                    self.assertTrue(loaded)
                page.locator('#pipeDia').fill('242.3')
                expect(page.locator('#assemblySvg .spacer')).to_have_count(1)
                expect(page.locator('#showBoltPath, #assemblyExample, #boltBreakdown')).to_have_count(0)
                page.locator('#assemblyPanel').screenshot(path='/tmp/wheel-spacer-desktop.png')
                page.set_viewport_size({'width': 390, 'height': 844})
                self.assertTrue(page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
                self.assertTrue(page.locator('.assembly-scroll').evaluate('e => e.scrollWidth <= e.clientWidth'))
                page.locator('#assemblyPanel').screenshot(path='/tmp/wheel-spacer-mobile.png')
                page.emulate_media(media='print')
                expect(page.locator('#assemblyPanel')).to_be_visible()
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

    def test_standard_kits_stacked_t_screws_and_threshold(self):
        with sync_playwright() as pw:
            browser = pw.chromium.launch(executable_path='/usr/bin/chromium', headless=True)
            try:
                page = browser.new_page(viewport={'width': 1000, 'height': 1100})
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.goto((ROOT / 'Calsis160WheelSpacerCalc.html').as_uri())
                # Hand-calculated examples exercise both 90 mm types, thin
                # spacers, repeated plain 90s, and stacked T spacers.
                cases = [
                    ('342.3', 90, 110, 25, {'original':[40,40,10], 'plain':[90], 'tee':[90]}),
                    ('362.3', 100, 120, 35, {'original':[40,40,20], 'plain':[90,10], 'tee':[10,90]}),
                    ('450.3', 144, 170, 80, {'original':[40,40,40,20,3,1], 'plain':[90,40,10,3,1], 'tee':[40,10,3,1,90]}),
                    ('522.3', 180, 200, 25, {'original':[40,40,40,40,20], 'plain':[90,90], 'tee':[90,90]}),
                ]
                # For 180 mm: clearance 187.5, longest allowed bolt is 200.
                for diameter, stack, full_bolt, tee_bolt, choices in cases:
                    page.locator('#pipeDia').fill(diameter)
                    expect(page.locator('#kitPanel')).to_be_visible()
                    for kit, pieces in choices.items():
                        with self.subTest(stack=stack, kit=kit):
                            page.locator(f'[data-kit="{kit}"]').click()
                            t_total = (stack // 90) * 90 if kit == 'tee' else 0
                            bolt = tee_bolt if kit == 'tee' else full_bolt
                            engagement = bolt - (stack - t_total) - 7.5
                            expect(page.locator('#boltValue')).to_have_text(f'M8 × {bolt}')
                            expect(page.locator(f'[data-kit="{kit}"]')).to_have_attribute('aria-pressed','true')
                            self.assertEqual(page.locator('#assemblySvg .spacer').evaluate_all(
                                '(items) => items.map(item => Number(item.dataset.mm))'), pieces)
                            expect(page.locator('#assemblySummary')).to_contain_text(f'{stack} mm actual stack')
                            expect(page.locator('#assemblySummary')).to_contain_text(f'{engagement:g} mm engagement')
                            self.assertLessEqual(engagement,22)
                            self.assertGreaterEqual(engagement,5)
                            if kit == 'tee':
                                expect(page.locator('#comboBody')).to_contain_text('90 mm T')
                                geometry = page.locator('#assemblySvg').evaluate('''svg => {
                                    const wheel=svg.querySelector('#wheelImage'),t=svg.querySelector('.t-spacer'),bolt=svg.querySelector('#boltShaft');
                                    const attr=(el,k)=>Number(el.getAttribute(k));
                                    return {scale:attr(wheel,'width')/63,tY:attr(t,'y'),tH:attr(t,'height'),
                                        tip:attr(bolt,'y')+attr(bolt,'height'),entry:Number(svg.dataset.threadEntry),
                                        bracketBottom:attr(wheel,'y')+attr(wheel,'height')};
                                }''')
                                self.assertAlmostEqual(geometry['tH'],90*geometry['scale'])
                                self.assertAlmostEqual(geometry['tY'],geometry['bracketBottom']+(stack-t_total)*geometry['scale'])
                                self.assertAlmostEqual(geometry['entry'],geometry['tY'])
                                self.assertAlmostEqual(geometry['tip']-geometry['tY'],engagement*geometry['scale'])
                                self.assertLess(geometry['tip'],geometry['tY']+25*geometry['scale'])
                # The 90 mm choice follows the actual rounded stack. Below that
                # threshold the original kit is used even after selecting T.
                page.locator('#pipeDia').fill('341.1')
                expect(page.locator('#kitPanel')).to_be_hidden()
                expect(page.locator('[data-kit=tee]')).to_be_disabled()
                expect(page.locator('#boltValue')).to_have_text('M8 × 110')
                expect(page.locator('.t-spacer')).to_have_count(0)
                page.locator('#pipeDia').fill('341.3')
                expect(page.locator('#kitPanel')).to_be_visible()
                expect(page.locator('[data-kit="tee"]')).to_have_attribute('aria-pressed','true')
                expect(page.locator('#boltValue')).to_have_text('M8 × 25')
                page.locator('#pipeDia').fill('362.3')
                page.get_by_role('button',name='Plain 90 mm Through holes').focus()
                page.keyboard.press('Enter')
                expect(page.locator('#boltValue')).to_have_text('M8 × 120')
                page.locator('[data-kit="tee"]').click()
                for dimensions in [{'width':1000,'height':1100},{'width':390,'height':844}]:
                    page.set_viewport_size(dimensions)
                    self.assertTrue(page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
                    page.screenshot(path=f"/tmp/wheel-kits-{dimensions['width']}.png",full_page=True)
                for value in ['','100','1e100']:
                    page.locator('#pipeDia').fill(value)
                    expect(page.locator('#kitPanel')).to_be_hidden()
                    expect(page.locator('#assemblyPanel')).to_be_hidden()
                self.assertEqual(errors,[])
            finally:
                browser.close()

    def test_custom_t_once_fixed_top_and_bottom_and_left_labels(self):
        with sync_playwright() as pw:
            browser = pw.chromium.launch(executable_path='/usr/bin/chromium', headless=True)
            try:
                page=browser.new_page(viewport={'width':1000,'height':1100})
                errors=[]
                page.on('pageerror',lambda error:errors.append(str(error)))
                page.goto((ROOT/'Calsis160WheelSpacerCalc.html').as_uri())
                page.locator('#pipeDia').fill('562.3')  # 200 mm stack
                page.locator('[data-kit=tee]').click()
                expect(page.locator('#boltValue')).to_have_text('M8 × 45')
                expect(page.locator('.t-spacer')).to_have_count(2)
                self.assertEqual(page.locator('#comboBody tr').nth(1).locator('td').all_text_contents(),
                                 ['90 mm T','2','12','18'])
                page.locator('[data-kit=custom]').click()
                expect(page.locator('#customTeeFields')).to_be_visible()
                page.locator('#customTeeHeight').fill('120')
                expect(page.locator('#boltValue')).to_have_text('M8 × 100')
                expect(page.locator('.t-spacer')).to_have_count(1)
                self.assertEqual(page.locator('#comboBody tr').last.locator('td').all_text_contents(),
                                 ['120 mm T','1','6','9'])
                geometry=page.locator('#assemblySvg').evaluate('''svg=>{
                    const t=svg.querySelector('.t-spacer'),wheel=svg.querySelector('#wheelImage'),bolt=svg.querySelector('#boltShaft');
                    const a=(el,k)=>Number(el.getAttribute(k));
                    const vertical=[...t.querySelector('path').getAttribute('d').matchAll(/V ([0-9.]+)/g)].map(m=>Number(m[1]));
                    return {scale:a(wheel,'width')/63,y:a(t,'y'),height:a(t,'height'),vertical,
                        tip:a(bolt,'y')+a(bolt,'height'),entry:Number(svg.dataset.threadEntry)};
                }''')
                self.assertAlmostEqual(geometry['height'],120*geometry['scale'])
                self.assertAlmostEqual(geometry['vertical'][0],25*geometry['scale'])
                self.assertAlmostEqual(geometry['height']-geometry['vertical'][1],15*geometry['scale'])
                self.assertAlmostEqual(geometry['entry'],geometry['y'])
                self.assertAlmostEqual(geometry['tip']-geometry['y'],12.5*geometry['scale'])
                self.assertLess(geometry['tip'],geometry['y']+25*geometry['scale'])
                # No kit selector or T spacer is used below the 90 mm threshold.
                page.locator('#pipeDia').fill('312.3')  # 75 mm stack
                expect(page.locator('#kitPanel')).to_be_hidden()
                expect(page.locator('#boltValue')).to_have_text('M8 × 100')
                expect(page.locator('.t-spacer')).to_have_count(0)
                page.locator('#pipeDia').fill('562.3')
                expect(page.locator('#kitPanel')).to_be_visible()
                expect(page.locator('#boltValue')).to_have_text('M8 × 100')
                # Too-short, fractional, absent or too-tall custom sizes clear
                # the old result; the same input can recover without a popup.
                for value in ['89','120.5','','201']:
                    page.locator('#customTeeHeight').fill(value)
                    expect(page.locator('#customTeeError')).to_be_visible()
                    expect(page.locator('#assemblyPanel')).to_be_hidden()
                    expect(page.locator('#comboPanel')).to_be_hidden()
                    expect(page.locator('#boltValue')).to_have_text('—')
                page.locator('#customTeeHeight').fill('120')
                expect(page.locator('#customTeeError')).to_be_hidden()
                expect(page.locator('#assemblyPanel')).to_be_visible()
                for dimensions in [{'width':1000,'height':1100},{'width':390,'height':844}]:
                    page.set_viewport_size(dimensions)
                    bounds=page.locator('#assemblySvg').evaluate('''svg=>{
                        const labels=[...svg.querySelectorAll('.engagement-label')].map(e=>e.getBoundingClientRect());
                        const spacer=svg.querySelector('.spacer').getBoundingClientRect();
                        return {labelRight:Math.max(...labels.map(r=>r.right)),spacerLeft:spacer.left};
                    }''')
                    self.assertLess(bounds['labelRight'],bounds['spacerLeft'])
                    displayed_font = page.locator('#assemblySvg .spacer-label').first.evaluate('''label => {
                        const matrix = label.getScreenCTM();
                        return parseFloat(getComputedStyle(label).fontSize) * Math.hypot(matrix.a, matrix.b);
                    }''')
                    self.assertAlmostEqual(displayed_font, 14, places=1)
                    self.assertTrue(page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
                    expect(page.locator('#assemblyExplanation, .assembly-reference')).to_have_count(0)
                    page.screenshot(path=f"/tmp/wheel-custom-final-{dimensions['width']}.png",full_page=True)
                page.locator('#pipeDia').fill('200') # stack too short for any T
                expect(page.locator('#kitPanel')).to_be_hidden()
                expect(page.locator('#boltValue')).to_have_text('M8 × 45')
                expect(page.locator('.t-spacer')).to_have_count(0)
                self.assertEqual(errors,[])
            finally:
                browser.close()

    def test_original_reference_upload_retains_spacer_sources(self):
        with ZipFile(ROOT / 'assets/calsis-wheel/reference-images.zip') as archive:
            self.assertIn('90mm spacer.PNG', archive.namelist())
            self.assertIn('90mm spacer dimesnion .png', archive.namelist())
            self.assertIn('wheel and spacer assembly dimesnions.png', archive.namelist())


if __name__ == '__main__':
    unittest.main()
