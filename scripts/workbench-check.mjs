import { enterStudio } from './browser-test-helpers.mjs';
import assert from 'node:assert/strict';
import { launchBrowser, ensurePreviewServer, DEFAULT_PREVIEW_URL, withQuality } from './browser-test-helpers.mjs';
const preview = await ensurePreviewServer({ targetUrl: process.env.OCTOBERLINE_UI_URL || withQuality(DEFAULT_PREVIEW_URL, 'low') });
const browser = await launchBrowser();
const url = preview.targetUrl;
try {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await enterStudio(page);
    await page.waitForFunction(() => document.querySelector('#intro-overlay').classList.contains('dismissed'));
    assert.equal(await page.locator('.workbench-ready').count(), 1, 'Workbench initialized');
    const ids = await page.locator('[id]').evaluateAll(els => els.map(el => el.id));
    assert.equal(new Set(ids).size, ids.length, 'All IDs unique');
    for (const name of ['paper', 'machine', 'room', 'view', 'ink', 'export']) {
      if (['ink', 'machine', 'export'].includes(name)) await page.click('#workbench-more');
      await page.click(`[data-workbench="${name}"]`);
      await page.waitForFunction(name => document.querySelector('#app').dataset.workbenchPanel === name, name);
      assert.equal(await page.locator('.workbench-panel:visible').count(), 1, 'One panel at a time');
      const dimensions = await page.locator('.workbench-panel:visible').boundingBox();
      assert(dimensions.x >= 0 && dimensions.x + dimensions.width <= viewport.width + 1, 'Panel fits viewport');
      if (name === 'room') {
        await page.selectOption('#weather-select', 'rain');
        await page.click('.audio-mix summary');
        assert.equal(await page.locator('.audio-mix input:visible').count(), 5, 'All five audio channels available');
      }
      if (name === 'view') assert.equal(await page.locator('[data-view]:visible').count(), 8);
      if (name === 'ink') assert.equal(await page.locator('[data-ink]:visible').count(), 3);
      if (name === 'export') {
        assert(await page.locator('#download-text').isVisible());
        assert(await page.locator('#paper-export-resolution').isVisible());
        assert(await page.locator('#print-selected-paper').isVisible());
      }
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.workbench-panel:visible').count(), 0);
      assert.equal(await page.locator(['ink', 'machine', 'export'].includes(name) ? '#workbench-more' : `[data-workbench="${name}"]`).evaluate(el => document.activeElement === el), true, 'Escape returns focus');
    }
    await page.click('[data-workbench="paper"]');
    await page.click('[data-workbench="room"]');
    assert.equal(await page.locator('.workbench-panel:visible').count(), 1, 'Direct switch closes paper');
    await page.click('[data-workbench="room"]');
    assert.equal(await page.locator('.workbench-panel:visible').count(), 0, 'Same button closes');
    assert.deepEqual(errors, [], 'No runtime errors');
    console.log(`Workbench passed ${viewport.width}x${viewport.height}: six panels, exports, audio, focus, bounds, IDs.`);
    await page.close();
  }
} finally { await browser.close(); await preview.close(); }
