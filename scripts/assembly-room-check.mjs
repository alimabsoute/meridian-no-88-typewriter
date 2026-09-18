import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { launchBrowser, ensurePreviewServer, enterStudio, DEFAULT_PREVIEW_URL } from './browser-test-helpers.mjs';
import { BRAND } from '../src/brand.js';

const targetUrl = process.env.TARGET_URL || DEFAULT_PREVIEW_URL;
const output = process.env.ROOM_CHECK_OUTPUT || 'visual-checks/assembly-room';
await mkdir(output, { recursive: true });
const preview = await ensurePreviewServer({ targetUrl });
const browser = await launchBrowser();
const report = { targetUrl, checkedAt: new Date().toISOString(), scenarios: [], errors: [] };
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();
page.on('pageerror', error => report.errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
const requests = [];
page.on('request', request => { if (request.url().includes('/media/')) requests.push(request.url()); });
async function decorState() {
  return page.evaluate(() => {
    const decor = window.__OCTOBERLINE_211__.room.decor;
    const video = decor.video;
    let frameHash = null;
    if (video?.readyState >= 2) {
      const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 36;
      const ctx = canvas.getContext('2d'); ctx.drawImage(video, 0, 0, 64, 36);
      frameHash = ctx.getImageData(0, 0, 64, 36).data.reduce((hash, value) => ((hash * 31) + value) >>> 0, 0);
    }
    return { ...decor.getState(), frameHash, screenUsesVideo: decor.screenMaterial.map === decor.videoTexture,
      screenColor: decor.screenMaterial.color.getHexString(), videoPaused: video?.paused,
      videoSeeking: video?.seeking, videoReadyState: video?.readyState, videoEnded: video?.ended };
  });
}
try {
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load', { timeout: 30000 });
  await page.waitForFunction(() => ['assembling', 'complete'].includes(window.__OCTOBERLINE_LANDING__?.assembly?.getState().phase), null, { timeout: 60000 });
  const early = await page.evaluate(() => {
    const assembly = window.__OCTOBERLINE_LANDING__.assembly;
    if (assembly.getState().phase === 'complete') assembly.replay();
    return assembly.getState();
  });
  await page.screenshot({ path: `${output}/desktop-assembling.png` });
  await page.waitForFunction(() => window.__OCTOBERLINE_LANDING__.assembly.getState().phase === 'complete', null, { timeout: 60000 });
  const complete = await page.evaluate(() => window.__OCTOBERLINE_LANDING__.assembly.getState());
  assert(complete.restTransformError < 1e-12); assert.equal(complete.groupCount, 21);
  assert.deepEqual(requests, [], 'TV and art stay deferred until room entry');
  await page.screenshot({ path: `${output}/desktop-complete.png` });
  report.scenarios.push({ name: 'authored-model-assembly', early, complete });
  await enterStudio(page);
  await page.waitForFunction(() => window.__OCTOBERLINE_211__.room.decor.getState().artLoaded
    && window.__OCTOBERLINE_211__.room.decor.video.currentTime > 0.5, null, { timeout: 60000 });
  await page.keyboard.type('A little Philadelphia.', { delay: 70 });
  // Check real keyboard delivery and the mechanical queue independently of a
  // software GPU's frame cadence. Video advancement below still uses real time.
  const input = await page.evaluate(() => {
    const { model, document: sheet } = window.__OCTOBERLINE_211__;
    for (let step = 0; step < 128; step++) {
      if (!model.returning && !model.tabMotion && !model.activeStrikes.length && !model.commandQueue.length) return { settled: true, text: sheet.toPlainText() };
      model.update(0.04);
    }
    return { settled: false, text: sheet.toPlainText() };
  });
  assert(input.settled); assert(input.text.includes('A little Philadelphia.'));
  report.scenarios.push({ name: 'fresh-room-keyboard-input', ...input });
  const active = await decorState();
  assert(active.muted && active.looping && active.screenUsesVideo && active.artLoaded);
  await page.waitForFunction(time => window.__OCTOBERLINE_211__.room.decor.video.currentTime > time + 1, active.currentTime);
  const advanced = await decorState();
  assert.notEqual(active.frameHash, advanced.frameHash, 'Decoded film imagery must change');
  await page.screenshot({ path: `${output}/room-front.png` });
  await page.evaluate(() => window.__OCTOBERLINE_211__.setAtmospherePaused(true));
  const paused = await decorState(); await page.waitForTimeout(350);
  const still = await decorState();
  assert(still.videoPaused); assert(Math.abs(still.currentTime - paused.currentTime) < 0.08);
  await page.evaluate(() => window.__OCTOBERLINE_211__.setAtmospherePaused(false));
  await page.waitForFunction(time => window.__OCTOBERLINE_211__.room.decor.video.currentTime > time + 0.25, still.currentTime);
  report.scenarios.push({ name: 'room-media-play-pause-resume', active, advanced, paused, still, mediaRequests: requests });
  const disposed = await page.evaluate(() => ({ state: window.__OCTOBERLINE_LANDING__.assembly.getState(), canvases: document.querySelectorAll('#landing-assembly canvas').length }));
  assert(disposed.state.disposed && !disposed.state.activeFrame && disposed.canvases === 0);
  report.scenarios.push({ name: 'preview-released-before-room', ...disposed });
  if (await page.locator('#coach-skip').isVisible()) await page.click('#coach-skip');
  await page.click('[data-workbench="room"]');
  await page.click('#tv-toggle');
  const poweredOff = await decorState();
  assert.equal(poweredOff.tvEnabled, false); assert.equal(poweredOff.screenColor, '080d10');
  assert.equal(await page.locator('#tv-toggle').getAttribute('aria-pressed'), 'false');
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || '{}').tvPlaying === false, BRAND.simulatorStorageKey);
  await page.screenshot({ path: `${output}/room-tv-control.png` });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load', { timeout: 30000 });
  const requestCount = requests.filter(url => url.includes('philly-tv.mp4')).length;
  await enterStudio(page);
  const restoredOff = await decorState();
  assert.equal(restoredOff.tvEnabled, false); assert(restoredOff.videoPaused);
  assert.equal(requests.filter(url => url.includes('philly-tv.mp4')).length, requestCount, 'Saved OFF does not request the film');
  await page.click('[data-workbench="room"]');
  await page.click('#tv-toggle');
  await page.waitForFunction(() => window.__OCTOBERLINE_211__.room.decor.video.currentTime > 0.4);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => window.__OCTOBERLINE_211__.room.decor.getState().paused);
  const reducedRoom = await decorState(); assert(reducedRoom.videoPaused);
  assert.equal(await page.locator('#tv-toggle b').textContent(), 'PAUSED');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForFunction(time => window.__OCTOBERLINE_211__.room.decor.video.currentTime > time + 0.25, reducedRoom.currentTime);
  const loopBoundary = await page.evaluate(() => {
    const video = window.__OCTOBERLINE_211__.room.decor.video;
    video.currentTime = video.duration - 0.3;
    return video.currentTime;
  });
  // Prove time wrapped behind the seek point. A slow renderer can miss the
  // first two seconds of the new loop even while the video plays correctly.
  try {
    await page.waitForFunction(boundary => {
      const v = window.__OCTOBERLINE_211__.room.decor.video;
      return !v.seeking && v.currentTime < boundary - 1 && !v.paused;
    }, loopBoundary, { timeout: 15000, polling: 100 });
  } catch (error) {
    report.loopFailure = { loopBoundary, state: await decorState() };
    throw error;
  }
  report.scenarios.push({ name: 'tv-off-restored-reduced-motion-and-loop', poweredOff, restoredOff, reducedRoom, loopBoundary, looped: await decorState() });
  await context.close();
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const small = await mobile.newPage();
  await small.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await small.waitForFunction(() => window.__OCTOBERLINE_LANDING__?.assembly?.getState().phase === 'static', null, { timeout: 60000 });
  await small.screenshot({ path: `${output}/mobile-complete.png`, fullPage: true });
  const mobileLayout = await small.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
    button: document.querySelector('#enter-studio').getBoundingClientRect().toJSON(), assembly: window.__OCTOBERLINE_LANDING__.assembly.getState() }));
  assert(mobileLayout.scrollWidth <= mobileLayout.width + 1);
  report.scenarios.push({ name: 'mobile-static-composition', ...mobileLayout });
  await mobile.close();
  assert.deepEqual(report.errors, []); report.passed = true;
} catch (error) { report.failure = error.stack; report.passed = false; throw error; }
finally {
  await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close(); await preview.close();
}
