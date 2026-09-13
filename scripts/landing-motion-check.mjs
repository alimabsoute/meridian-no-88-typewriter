import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { launchBrowser } from './browser-test-helpers.mjs';

const targetUrl = process.env.TARGET_URL || 'http://127.0.0.1:5189/';
const output = 'visual-checks/landing';
await mkdir(output, { recursive: true });
const browser = await launchBrowser();
const results = { targetUrl, checkedAt: new Date().toISOString(), scenarios: [], errors: [] };

async function open({ mobile = false, reduced = false } = {}) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1600, height: 1000 },
    reducedMotion: reduced ? 'reduce' : 'no-preference',
    isMobile: mobile, hasTouch: mobile,
  });
  const page = await context.newPage();
  page.on('pageerror', error => results.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') results.errors.push(message.text()); });
  await page.addInitScript(() => {
    window.__landingAudioConstructions = 0;
    for (const name of ['AudioContext', 'webkitAudioContext']) {
      if (window[name]) window[name] = new Proxy(window[name], {
        construct(target, args) { window.__landingAudioConstructions += 1; return Reflect.construct(target, args); },
      });
    }
  });
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__OCTOBERLINE_211__), null, { timeout: 60000 });
  return { context, page };
}

async function snapshot(page) {
  return page.evaluate(() => {
    const api = window.__OCTOBERLINE_211__;
    const intro = document.querySelector('#intro-overlay');
    return {
      camera: api.camera.position.toArray(),
      text: api.document.toPlainText(), paper: api.paperState,
      audioConstructions: window.__landingAudioConstructions,
      audioContextExists: Boolean(api.audio.context || api.atmosphereAudio.context),
      introRunningAnimations: intro.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length,
      dismissed: intro.classList.contains('dismissed'), keyboardCaptured: api.keyboardCaptured,
    };
  });
}

async function bounds(page) {
  const value = await page.evaluate(() => ({
    width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth,
    buttons: ['enter-studio', 'intro-guide'].map(id => {
      const element = document.getElementById(id);
      const rect = element.getBoundingClientRect();
      return { id, disabled: element.disabled, x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    }),
  }));
  assert(value.documentWidth <= value.width + 1, 'Landing must not overflow horizontally');
  for (const button of value.buttons) {
    assert(!button.disabled, `${button.id} must be enabled before the cinematic settles`);
    assert(button.width > 0 && button.height > 0 && button.x >= 0 && button.y >= 0 && button.right <= value.width + 1 && button.bottom <= value.height + 1,
      `${button.id} must be within the viewport: ${JSON.stringify(button)}`);
  }
  return value;
}

async function enterAndType(page) {
  const before = await snapshot(page);
  const start = Date.now();
  await page.locator('#enter-studio').click({ force: true });
  await page.waitForFunction(() => window.__OCTOBERLINE_211__.keyboardCaptured && document.querySelector('#intro-overlay').classList.contains('dismissed'));
  const entryMs = Date.now() - start;
  // A real keyboard event follows entry; no debug typing API is used.
  await page.keyboard.press('q');
  await page.waitForFunction(text => window.__OCTOBERLINE_211__.document.toPlainText() !== text, before.text, { timeout: 15000 });
  await page.waitForTimeout(1600);
  const after = await snapshot(page);
  assert(after.text.toLowerCase().includes('q'), 'Normal keyboard input must create a document mark');
  assert.equal(after.introRunningAnimations, 0, 'Dismissed intro must not retain running CSS animations');
  assert(after.audioConstructions > 0, 'Entry gesture should enable audio');
  return { entryMs, textAfter: after.text, introRunningAnimations: after.introRunningAnimations, audioConstructions: after.audioConstructions };
}

try {
  // Test entry before arrival finishes on a fresh page.
  {
    const { context, page } = await open();
    const initial = await snapshot(page);
    assert.equal(initial.audioConstructions, 0);
    assert.equal(initial.audioContextExists, false);
    const layout = await bounds(page);
    const entry = await enterAndType(page);
    results.scenarios.push({ name: 'immediate-entry', layout, entry });
    await context.close();
  }
  {
    const { context, page } = await open();
    const initial = await snapshot(page);
    const frames = await page.evaluate(() => new Promise(resolve => {
      requestAnimationFrame(() => {
        const first = window.__OCTOBERLINE_211__.camera.position.toArray();
        requestAnimationFrame(() => resolve({ first, second: window.__OCTOBERLINE_211__.camera.position.toArray() }));
      });
    }));
    assert.notDeepEqual(frames.first, frames.second, 'Actual rendered camera frames must move during arrival');
    await page.waitForFunction(() => window.__OCTOBERLINE_211__.camera.position.z < 13.201, null, { timeout: 30000 });
    await page.waitForTimeout(4200); // Includes the second silent key-preview interval.
    const settled = await snapshot(page);
    assert.deepEqual(settled.paper, initial.paper, 'Silent preview must preserve the full paper lifecycle');
    assert.equal(settled.text, initial.text, 'Silent preview must not type');
    assert.equal(settled.audioConstructions, 0, 'Landing must construct no audio context');
    await page.mouse.move(120, 500);
    await page.waitForTimeout(1000);
    const left = (await snapshot(page)).camera;
    await page.mouse.move(1480, 500);
    await page.waitForTimeout(1000);
    const right = (await snapshot(page)).camera;
    assert(right[0] - left[0] > .1, 'Pointer movement should produce visible, bounded camera parallax');
    const layout = await bounds(page);
    await page.screenshot({ path: `${output}/desktop.png` });
    results.scenarios.push({ name: 'desktop-arrival-and-parallax', frames, left, right, layout, documentPreserved: true, paperPreserved: true, audioConstructions: settled.audioConstructions, entry: await enterAndType(page) });
    await context.close();
  }
  for (const mobile of [false, true]) {
    const { context, page } = await open({ mobile, reduced: true });
    const initial = await snapshot(page);
    await page.waitForTimeout(1700);
    await page.mouse.move(mobile ? 320 : 1400, 380);
    await page.waitForTimeout(500);
    const after = await snapshot(page);
    assert.deepEqual(after.camera, initial.camera, 'Reduced-motion camera must remain fixed');
    assert.deepEqual(after.paper, initial.paper);
    assert.equal(after.text, initial.text);
    assert.equal(after.introRunningAnimations, 0, 'Reduced motion must disable intro CSS animation');
    assert.equal(after.audioConstructions, 0);
    const layout = await bounds(page);
    await page.screenshot({ path: `${output}/${mobile ? 'mobile' : 'desktop'}-reduced.png` });
    results.scenarios.push({ name: `${mobile ? 'mobile' : 'desktop'}-reduced-motion`, layout, staticCamera: true, runningIntroAnimations: after.introRunningAnimations, entry: await enterAndType(page) });
    await context.close();
  }
  {
    const { context, page } = await open({ mobile: true });
    const layout = await bounds(page);
    await page.waitForTimeout(2300);
    await page.screenshot({ path: `${output}/mobile.png` });
    results.scenarios.push({ name: 'mobile-motion', layout, entry: await enterAndType(page) });
    await context.close();
  }
  assert.deepEqual(results.errors, [], 'All landing scenarios must have zero browser errors');
  results.passed = true;
} catch (error) {
  results.passed = false;
  results.failure = error.stack;
  throw error;
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
}
