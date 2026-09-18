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
// Keep lifecycle regression tests deterministic even if an external archive is
// slow or removes a recording. LIVE_ARCHIVE_MEDIA=1 explicitly opts into source
// availability/CORS testing; fixture results are never labeled real news proof.
const liveArchive = process.env.LIVE_ARCHIVE_MEDIA === '1';
report.mediaMode = liveArchive ? 'live-archive' : 'local-video-fixture';
if (!liveArchive) await page.route('https://archive.org/download/**', route => route.fulfill({
  path: 'public/media/philly-tv.mp4', contentType: 'video/mp4',
  headers: { 'access-control-allow-origin': '*' },
}));
page.on('pageerror', error => report.errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
const requests = [];
page.on('request', request => { if (request.url().includes('/media/') || request.url().includes('archive.org/download/')) requests.push(request.url()); });
async function decorState() {
  return page.evaluate(() => {
    const decor = window.__OCTOBERLINE_211__.room.decor;
    const video = decor.video;
    let frameHash = null;
    if (!decor.nativeVideo && video?.readyState >= 2) {
      const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 36;
      const ctx = canvas.getContext('2d'); ctx.drawImage(video, 0, 0, 64, 36);
      frameHash = ctx.getImageData(0, 0, 64, 36).data.reduce((hash, value) => ((hash * 31) + value) >>> 0, 0);
    }
    return { ...decor.getState(), firstClipSource: decor.playlist[0].src, frameHash, decodedFrames: video?.getVideoPlaybackQuality?.().totalVideoFrames ?? 0,
      screenUsesVideo: decor.nativeVideo ? video?.classList.contains('television-video-surface') && getComputedStyle(video).visibility === 'visible' : decor.screenMaterial.map === decor.videoTexture,
      screenColor: decor.screenMaterial.color.getHexString(), videoPaused: video?.paused,
      videoSeeking: video?.seeking, videoReadyState: video?.readyState, videoEnded: video?.ended };
  });
}
function playbackProgress({ sample, seconds, expectedClipIndex }) {
  const decor = window.__OCTOBERLINE_211__.room.decor;
  const video = decor.video;
  if (expectedClipIndex !== undefined && decor.clipIndex !== expectedClipIndex) return false;
  if (!video || video.paused || video.seeking || video.ended || video.readyState < 2) return false;
  const decodedFrames = video.getVideoPlaybackQuality?.().totalVideoFrames;
  if (!Number.isFinite(decodedFrames)) return false;
  if (decor.nativeVideo && (!video.classList.contains('television-video-surface') || getComputedStyle(video).visibility !== 'visible')) return false;
  // Loading the 38s excerpt is a seek, not 38s of playback. Source changes also
  // reset the decoder counter. Begin a new measured interval after either one.
  if (sample.videoReadyState < 2 || sample.videoSeeking || sample.videoEnded
    || decor.clipIndex !== sample.clipIndex || video.currentTime < sample.currentTime || decodedFrames < sample.decodedFrames) {
    Object.assign(sample, { clipIndex: decor.clipIndex, currentTime: video.currentTime, decodedFrames,
      videoReadyState: video.readyState, videoSeeking: false, videoEnded: false });
    return false;
  }
  const mediaSeconds = video.currentTime - sample.currentTime;
  const newFrames = decodedFrames - sample.decodedFrames;
  if (mediaSeconds <= seconds || newFrames <= 0) return false;
  return { clipIndex: decor.clipIndex, fromTime: sample.currentTime, toTime: video.currentTime,
    fromFrames: sample.decodedFrames, toFrames: decodedFrames, mediaSeconds, newFrames };
}
async function waitForPlayback(baseline, seconds = 0.25, expectedClipIndex) {
  try {
    const result = await page.waitForFunction(playbackProgress, { sample: baseline, seconds, expectedClipIndex }, { timeout: 15000, polling: 100 });
    try { return await result.jsonValue(); } finally { await result.dispose(); }
  } catch (error) {
    report.mediaFailure = { baseline, seconds, expectedClipIndex, current: await decorState() };
    throw error;
  }
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
  await page.waitForFunction(() => {
    const decor = window.__OCTOBERLINE_211__.room.decor;
    const video = decor.video;
    return decor.getState().artLoaded && video.readyState >= 2 && !video.seeking && !video.paused && !video.ended;
  }, null, { timeout: 60000, polling: 100 });
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
  const initialPlayback = await waitForPlayback(active, 1);
  const advanced = await decorState();
  assert(advanced.muted && advanced.looping && advanced.screenUsesVideo && advanced.artLoaded);
  if (!active.nativeVideo) assert.notEqual(active.frameHash, advanced.frameHash, 'Decoded film imagery must change');
  await page.screenshot({ path: `${output}/room-front.png` });
  await page.evaluate(() => window.__OCTOBERLINE_211__.setAtmospherePaused(true));
  const paused = await decorState(); await page.waitForTimeout(350);
  const still = await decorState();
  assert(still.videoPaused); assert(Math.abs(still.currentTime - paused.currentTime) < 0.08);
  await page.evaluate(() => window.__OCTOBERLINE_211__.setAtmospherePaused(false));
  const resumedPlayback = await waitForPlayback(still);
  report.scenarios.push({ name: 'room-media-play-pause-resume', active, advanced, initialPlayback, paused, still, resumedPlayback, mediaRequests: requests });
  const disposed = await page.evaluate(() => ({ state: window.__OCTOBERLINE_LANDING__.assembly.getState(), canvases: document.querySelectorAll('#landing-assembly canvas').length }));
  assert(disposed.state.disposed && !disposed.state.activeFrame && disposed.canvases === 0);
  report.scenarios.push({ name: 'preview-released-before-room', ...disposed });
  if (await page.locator('#coach-skip').isVisible()) await page.click('#coach-skip');
  await page.click('[data-workbench="room"]');
  await page.click('#tv-mute');
  assert.equal((await decorState()).muted, false);
  await page.locator('#tv-volume').press('Home');
  for (let step = 0; step < 43; step++) await page.locator('#tv-volume').press('ArrowRight');
  assert.equal((await decorState()).volume, 0.43);
  await page.click('#tv-mute');
  assert.equal((await decorState()).muted, true);
  await page.click('#tv-toggle');
  const poweredOff = await decorState();
  assert.equal(poweredOff.tvEnabled, false); assert.equal(poweredOff.screenColor, '080d10');
  assert.equal(await page.locator('#tv-toggle').getAttribute('aria-pressed'), 'false');
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || '{}').tvPlaying === false, BRAND.simulatorStorageKey);
  await page.screenshot({ path: `${output}/room-tv-control.png` });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load', { timeout: 30000 });
  const requestCount = requests.filter(url => url.includes('archive.org/download/')).length;
  await enterStudio(page);
  const freshVisit = await decorState();
  assert.equal(freshVisit.tvEnabled, true, 'A fresh visit starts the television as requested');
  assert.equal(freshVisit.volume, 0.43, 'Television volume survives reload');
  assert.equal(freshVisit.muted, true, 'A fresh visit remains muted');
  const freshPlayback = await waitForPlayback(freshVisit, 0.4);
  const freshRequests = requests.filter(url => url.includes('archive.org/download/')).slice(requestCount);
  assert.equal(freshRequests[0], freshVisit.firstClipSource, 'A fresh visit must request the first recording before any playlist rollover');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => window.__OCTOBERLINE_211__.room.decor.getState().paused);
  const reducedRoom = await decorState(); assert(reducedRoom.videoPaused);
  assert.equal(await page.locator('#tv-toggle b').textContent(), 'PAUSED');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const reducedResume = await waitForPlayback(reducedRoom);
  const loopBoundary = await page.evaluate(() => {
    const decor = window.__OCTOBERLINE_211__.room.decor;
    const video = decor.video;
    video.currentTime = Math.min(video.duration, decor.playlist[decor.clipIndex].end) - 0.3;
    return { currentTime: video.currentTime, clipIndex: decor.clipIndex, clipCount: decor.playlist.length };
  });
  // Loading the next clip and proving decoded movement share the existing 15s
  // deadline; merely seeking to its nonzero start is not a playback success.
  let loopPlayback;
  try {
    loopPlayback = await waitForPlayback(loopBoundary, 0.25, (loopBoundary.clipIndex + 1) % loopBoundary.clipCount);
  } catch (error) {
    report.loopFailure = report.mediaFailure;
    throw error;
  }
  const looped = await decorState();
  report.scenarios.push({ name: 'tv-power-fresh-visit-reduced-motion-and-loop', poweredOff, freshVisit, freshPlayback,
    reducedRoom, reducedResume, loopBoundary, looped, loopPlayback });
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
