import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { launchBrowser, enterStudio, ensurePreviewServer, DEFAULT_PREVIEW_URL } from './browser-test-helpers.mjs';
const targetUrl = process.env.TARGET_URL || DEFAULT_PREVIEW_URL;
const output = 'visual-checks/landing';
await mkdir(output, { recursive: true });
const preview = await ensurePreviewServer({ targetUrl });
const browser = await launchBrowser({ allowFileAccess: true });
const report = { targetUrl, checkedAt: new Date().toISOString(), scenarios: [], errors: [] };
async function instrument(page) {
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  await page.addInitScript(() => {
    window.__landingProof = { audio: 0, webgl: 0 };
    window.__landingContextRecords = [];
    const contexts = new WeakSet();
    for (const name of ['AudioContext', 'webkitAudioContext']) if (window[name]) window[name] = new Proxy(window[name], {
      construct(target, args) { window.__landingProof.audio++; return Reflect.construct(target, args); },
    });
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      const context = getContext.call(this, type, ...args);
      if (/webgl/i.test(type) && context && !contexts.has(context)) {
        contexts.add(context);
        window.__landingProof.webgl++;
        window.__landingContextRecords.push({ canvas: this, context });
      }
      return context;
    };
  });
}
async function state(page, { replay = false } = {}) {
  return page.evaluate(replay => {
    // Capture the replay baseline in the same browser task as its reset. A
    // separate CDP round trip can observe an already-finished short animation.
    const replayed = replay ? window.__OCTOBERLINE_LANDING__.assembly.replay() : undefined;
    const intro = document.querySelector('#intro-overlay'), title = document.querySelector('#intro-title');
    const css = getComputedStyle(title);
    return {
      title: title.textContent.trim(), titleVisible: css.visibility !== 'hidden' && Number(css.opacity) > 0 && title.getBoundingClientRect().height > 0,
      status: window.__OCTOBERLINE_LANDING__?.status, started: window.__OCTOBERLINE_LANDING__?.started,
      engine: Boolean(window.__OCTOBERLINE_211__), constructors: window.__landingProof,
      preview: window.__OCTOBERLINE_LANDING__?.assembly?.getState() ?? null,
      replayed,
      previewCanvases: document.querySelectorAll('#landing-assembly canvas').length,
      contexts: window.__landingContextRecords?.map(({ canvas, context }) => ({ connected: canvas.isConnected, lost: context.isContextLost() })) ?? [],
      width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
      buttons: ['enter-studio','intro-guide'].map(id => {
        const e = document.getElementById(id), r = e.getBoundingClientRect();
        return { id, text: e.textContent.trim(), disabled: e.disabled, font: parseFloat(getComputedStyle(e).fontSize), x: r.x, right: r.right, height: r.height };
      }),
      animations: intro.getAnimations({ subtree: true }).filter(a => a.playState === 'running').length,
    };
  }, replay);
}
function assertIdle(s, { beforeBundle = false } = {}) {
  assert(s.titleVisible, 'Headline must paint without constructing the room');
  assert.equal(s.status, 'idle'); assert.equal(s.started, false); assert.equal(s.engine, false);
  assert.equal(s.constructors.audio, 0, 'Preview must never construct an audio context');
  assert(s.constructors.webgl <= 1, 'At most one isolated preview context may exist before entry');
  if (beforeBundle) {
    assert.equal(s.constructors.webgl, 0, 'The streamed shell must not initialize the preview before its bundle arrives');
    assert.equal(s.preview, null);
  }
  assert(s.scrollWidth <= s.width + 1, 'No horizontal scrolling');
  for (const b of s.buttons) {
    assert(!b.disabled && b.height >= 44 && b.x >= 0 && b.right <= s.width + 1, `${b.id} is readable and fits horizontally`);
    assert(b.font >= (b.id === 'enter-studio' ? 20 : 18), `${b.id} has readable type`);
  }
}
function assertRenderedPreview(s, { reduced = false } = {}) {
  assertIdle(s);
  assert.equal(s.constructors.webgl, 1);
  assert.equal(s.previewCanvases, 1);
  assert.equal(s.preview.groupCount, 21, 'All authored mechanical assembly groups must be present');
  assert.equal(s.preview.keyInstanceCount, 235, 'Five instanced parts for all 47 keys must remain attached');
  assert(s.preview.meshCount > 200, 'The actual detailed machine must be rendered');
  assert(s.preview.renderer.drawCalls > 0 && s.preview.renderer.triangles > 0);
  assert.equal(s.preview.error, null);
  assert.equal(s.preview.disposed, false);
  if (reduced) {
    assert.equal(s.preview.phase, 'static');
    assert.equal(s.preview.progress, 1);
    assert.equal(s.preview.activeFrame, false, 'Reduced motion must not keep a preview RAF loop alive');
  }
}
function assertDisposedPreview(s, { constructed = true } = {}) {
  assert.equal(s.preview.phase, 'disposed');
  assert.equal(s.preview.disposed, true);
  assert.equal(s.preview.activeFrame, false);
  assert.equal(s.previewCanvases, 0, 'Preview canvas must be removed before the app renders');
  if (constructed) {
    assert.equal(s.preview.released.instanceBuffers, 13, 'All authored instanced GPU allocations must be released');
    assert(s.preview.released.geometries > 0 && s.preview.released.textures > 0);
    assert.deepEqual(s.contexts[0], { connected: false, lost: true }, 'The preview native WebGL context must actually be retired');
    assert.equal(s.constructors.webgl, 2, 'The live machine gets its own context after preview teardown');
  } else {
    assert.equal(s.preview.frameCount, 0);
    assert.equal(s.constructors.webgl, 1, 'Canceled initialization must never create a preview context');
  }
}
async function waitForPreview(page) {
  await page.waitForFunction(() => {
    const preview = window.__OCTOBERLINE_LANDING__?.assembly?.getState();
    return preview && ['assembling', 'complete', 'static', 'unavailable'].includes(preview.phase);
  }, null, { timeout: 60000 });
  const result = await state(page);
  assert.notEqual(result.preview.phase, 'unavailable', `Optional preview failed on this WebGL-capable browser: ${result.preview.error}`);
  return result;
}
async function guide(page) {
  await page.click('#intro-guide');
  await page.waitForFunction(() => document.querySelector('#landing-guide').open);
  assert.equal(await page.evaluate(() => Boolean(window.__OCTOBERLINE_211__)), false);
  assert.match(await page.locator('#landing-guide').innerText(), /keyboard/i);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'intro-guide');
  assertIdle(await state(page));
}
async function typeAfterEntry(page, text) {
  await enterStudio(page);
  await page.waitForFunction(() => window.__OCTOBERLINE_LANDING__.status === 'ready');
  await page.keyboard.type(text, { delay: 90 });
  // Prove actual keyboard delivery through the normal mechanical queue. This
  // landing regression does not certify software-rendered CI frame cadence.
  const mechanics = await page.evaluate(() => {
    const { model, document: sheet } = window.__OCTOBERLINE_211__;
    const before = sheet.toPlainText();
    for (let step = 0; step < 128; step++) {
      if (!model.returning && !model.tabMotion && !model.activeStrikes.length && !model.commandQueue.length) return { settled: true, step, before };
      model.update(0.04);
    }
    return { settled: false, before, queue: model.commandQueue.length, active: model.activeStrikes.length };
  });
  assert(mechanics.settled, `Real typing queue did not settle: ${JSON.stringify(mechanics)}`);
  try {
    await page.waitForFunction(text => window.__OCTOBERLINE_211__.document.toPlainText().includes(text), text, { timeout: 15000 });
  } catch (error) {
    const diagnostic = await page.evaluate(() => {
      const api = window.__OCTOBERLINE_211__;
      return { actualText: api.document.toPlainText(), focused: document.activeElement?.id, captured: api.keyboardCaptured, status: window.__OCTOBERLINE_LANDING__.status, queue: api.model.commandQueue, active: api.model.activeStrikes };
    });
    throw new Error(`Entry typing failed: ${JSON.stringify({ expected: text, mechanics, diagnostic })}`, { cause: error });
  }
  const result = await page.evaluate(() => ({
    text: window.__OCTOBERLINE_211__.document.toPlainText(), captured: window.__OCTOBERLINE_211__.keyboardCaptured,
    status: window.__OCTOBERLINE_LANDING__.status, constructors: window.__landingProof,
    preview: window.__OCTOBERLINE_LANDING__.assembly?.getState() ?? null,
    previewCanvases: document.querySelectorAll('#landing-assembly canvas').length,
    contexts: window.__landingContextRecords.map(({ canvas, context }) => ({ connected: canvas.isConnected, lost: context.isContextLost() })),
  }));
  assert(result.constructors.webgl > 0 && result.captured);
  return { ...result, mechanics };
}
try {
  // Serve actual production HTML as two chunks. The simulator tail is withheld,
  // so a painted, working guide and queued entry cannot depend on that bundle.
  const html = await readFile('dist/index.html');
  const media = new Map(await Promise.all([
    ['/media/philly-tv.mp4', 'video/mp4', 'dist/media/philly-tv.mp4'],
    ['/media/philly-tv-poster.jpg', 'image/jpeg', 'dist/media/philly-tv-poster.jpg'],
    ['/media/philly-wall-art.png', 'image/png', 'dist/media/philly-wall-art.png'],
  ].map(async ([url, type, file]) => [url, { type, bytes: await readFile(file) }])));
  let releaseTail;
  const tail = new Promise(resolve => { releaseTail = resolve; });
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    const asset = media.get(pathname);
    if (asset) {
      const headers = { 'Content-Type': asset.type, 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' };
      const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      if (range) {
        const start = Number(range[1]);
        const end = range[2] ? Math.min(Number(range[2]), asset.bytes.length - 1) : asset.bytes.length - 1;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= asset.bytes.length) {
          res.writeHead(416, { ...headers, 'Content-Range': `bytes */${asset.bytes.length}` });
          res.end(); return;
        }
        res.writeHead(206, { ...headers, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${asset.bytes.length}` });
        res.end(req.method === 'HEAD' ? undefined : asset.bytes.subarray(start, end + 1)); return;
      }
      res.writeHead(200, { ...headers, 'Content-Length': asset.bytes.length });
      res.end(req.method === 'HEAD' ? undefined : asset.bytes); return;
    }
    if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (pathname !== '/' && pathname !== '/index.html') { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.write(html.subarray(0, 30000));
    await tail;
    res.end(html.subarray(30000));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  try {
    const page = await context.newPage(); await instrument(page);
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'commit' });
    await page.locator('#intro-title').waitFor({ state: 'visible' });
    await page.waitForFunction(() => Boolean(window.__OCTOBERLINE_LANDING__));
    const partial = await state(page); assertIdle(partial, { beforeBundle: true }); await guide(page);
    // Playwright waits for document.fonts.ready, which cannot settle while this
    // HTML response is intentionally open. Capture the actual partial paint.
    const capture = await context.newCDPSession(page);
    const painted = await capture.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(`${output}/partial-stream-first-paint.png`, Buffer.from(painted.data, 'base64'));
    await capture.detach();
    await page.click('#enter-studio');
    const queued = await state(page); assert.equal(queued.status, 'loading'); assert(queued.started && !queued.engine); assert.equal(queued.constructors.webgl, 0);
    assert(await page.locator('#intro-load-status').innerText());
    assert.equal(await page.locator('#enter-studio').getAttribute('aria-busy'), 'true');
    assert(await page.locator('#intro-guide').isDisabled(), 'Guide must not interrupt room loading');
    assert.equal(await page.locator('#landing-guide').evaluate(e => e.open), false);
    releaseTail(); await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => Boolean(window.__OCTOBERLINE_211__?.keyboardCaptured), null, { timeout: 60000 });
    const entered = await typeAfterEntry(page, 'Stream proof.');
    assertDisposedPreview(entered, { constructed: false });
    report.scenarios.push({ name: 'first-30000-bytes-streamed', partial, queued, entered });
  } finally { releaseTail(); await context.close(); await new Promise(resolve => server.close(resolve)); }

  for (const [name, width, height, reduced] of [
    ['desktop',1600,1000,false], ['mobile',390,844,false], ['small-mobile',320,740,false], ['short-landscape',844,390,false],
    ['desktop-reduced',1600,1000,true], ['mobile-reduced',390,844,true],
  ]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
    const page = await context.newPage(); await instrument(page);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    // Native load and the readable landing must complete independently of entry.
    await page.waitForLoadState('load', { timeout: 30000 });
    await page.waitForFunction(() => Boolean(window.__OCTOBERLINE_LANDING__));
    const first = await state(page); assertIdle(first);
    await page.screenshot({ path: `${output}/${name}-initial.png`, fullPage: true });
    await page.locator('#landing-assembly').evaluate(e => e.scrollIntoView({ block: 'center' }));
    await waitForPreview(page);
    // ResizeObserver may submit one initial static frame; let that settle before
    // checking that the reduced-motion preview has no continuously running loop.
    if (reduced) await page.waitForTimeout(200);
    const motionStart = await state(page, { replay: !reduced }); assertRenderedPreview(motionStart, { reduced });
    if (!reduced) {
      assert(motionStart.replayed);
      assert.equal(motionStart.preview.progress, 0);
      assert(motionStart.preview.restTransformError > 1e-3, 'Replay must actually separate the machine from its assembled pose');
    }
    if (reduced) await page.waitForTimeout(350);
    else {
      try {
        await page.waitForFunction(previous => {
          const current = window.__OCTOBERLINE_LANDING__.assembly.getState();
          // The largest remaining displacement belongs to the paper, which
          // deliberately waits for its stagger. That maximum can stay constant
          // while casting and key rows move. Observe those authored groups and
          // actual render submissions here; require exact transform parity at
          // completion below instead of timing an unrelated aggregate maximum.
          return current.progress > previous.progress && current.frameCount > previous.frameCount
            && current.groups.some((group, index) => group.progress > previous.groups[index].progress);
        }, motionStart.preview, { timeout: 30000 });
      } catch (error) {
        const stalled = await state(page);
        const compact = preview => preview ? { ...preview, renderTimeline: preview.renderTimeline?.slice(-12) } : null;
        report.motionFailure = { scenario: name, start: compact(motionStart.preview), current: compact(stalled.preview), contexts: stalled.contexts };
        throw new Error(`Preview groups did not advance: ${JSON.stringify(report.motionFailure)}`, { cause: error });
      }
    }
    const next = await state(page); assertRenderedPreview(next, { reduced });
    if (reduced) {
      assert.equal(next.animations, 0);
      assert.equal(next.preview.frameCount, motionStart.preview.frameCount, 'Static reduced-motion model must not keep redrawing');
      assert(next.preview.restTransformError < 1e-8);
    } else {
      assert(next.preview.progress > motionStart.preview.progress);
      assert(next.preview.groups.some((group, index) => group.progress > motionStart.preview.groups[index].progress), 'Authored assembly groups must advance');
    }
    await guide(page);
    for (const button of ['#enter-studio', '#intro-guide']) { await page.locator(button).scrollIntoViewIfNeeded(); assert(await page.locator(button).isVisible()); }
    await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
    let entry;
    let finalPose;
    let replay;
    if (name === 'mobile') {
      // A real CTA click during a fresh assembly must synchronously retire the
      // preview before keyboard, paper, audio and the complete room initialize.
      const duringAssembly = await state(page, { replay: true });
      assert(duringAssembly.replayed);
      assert.equal(duringAssembly.preview.phase, 'assembling');
      assert(duringAssembly.preview.progress < 1);
      entry = await typeAfterEntry(page, 'Mobile proof.');
      assertDisposedPreview(entry);
      entry.duringAssembly = duringAssembly.preview;
    } else {
      await page.waitForFunction(() => ['complete', 'static'].includes(window.__OCTOBERLINE_LANDING__.assembly.getState().phase), null, { timeout: 60000 });
      finalPose = await state(page);
      assert.equal(finalPose.preview.progress, 1);
      assert(finalPose.preview.restTransformError < 1e-8, 'Coalescence must restore every original transform and key instance');
      if (!reduced) assert(finalPose.preview.restTransformError < motionStart.preview.restTransformError, 'Rendered assembly must close the actual separated transforms');
      assert(finalPose.preview.groups.every(group => group.progress === 1));
      if (name === 'desktop') {
        await page.evaluate(() => {
          document.querySelector('#replay-assembly').addEventListener('click', () => {
            window.__landingUiReplayState = window.__OCTOBERLINE_LANDING__.assembly.getState();
          }, { once: true });
        });
        await page.locator('#replay-assembly').click();
        replay = await state(page);
        replay.clickState = await page.evaluate(() => window.__landingUiReplayState);
        assert.equal(replay.clickState.phase, 'assembling');
        assert.equal(replay.clickState.progress, 0);
        assert(replay.clickState.restTransformError > 1e-3);
      }
    }
    report.scenarios.push({ name, first, motionStart, next, finalPose, replay, entry }); await context.close();
  }
  // Hold the idle scheduler before a renderer can be created, then enter via
  // the real CTA. Also deliver the canceled callback late to exercise the race.
  const pendingContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pendingPage = await pendingContext.newPage(); await instrument(pendingPage);
  await pendingPage.addInitScript(() => {
    window.__landingIdleProof = { scheduled: 0, canceled: 0 };
    let callback;
    const nativeRequest = window.requestIdleCallback?.bind(window) ?? (work => setTimeout(work, 0));
    const nativeCancel = window.cancelIdleCallback?.bind(window) ?? clearTimeout;
    window.requestIdleCallback = (work, options) => {
      if (callback) return nativeRequest(work, options);
      callback = work; window.__landingIdleProof.scheduled++; return -211;
    };
    window.cancelIdleCallback = (handle) => {
      if (handle === -211) window.__landingIdleProof.canceled++;
      else nativeCancel(handle);
    };
    window.__deliverCanceledLandingIdle = () => callback?.({ didTimeout: false, timeRemaining: () => 0 });
  });
  await pendingPage.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await pendingPage.waitForFunction(() => window.__landingIdleProof.scheduled === 1);
  const pending = await state(pendingPage); assertIdle(pending);
  assert.equal(pending.preview.phase, 'preparing');
  assert.equal(pending.constructors.webgl, 0);
  const pendingEntry = await typeAfterEntry(pendingPage, 'Early entry proof.');
  assertDisposedPreview(pendingEntry, { constructed: false });
  await pendingPage.evaluate(() => window.__deliverCanceledLandingIdle());
  await pendingPage.waitForTimeout(150);
  const lateCallback = await state(pendingPage);
  assertDisposedPreview(lateCallback, { constructed: false });
  const idleProof = await pendingPage.evaluate(() => window.__landingIdleProof);
  assert.equal(idleProof.canceled, 1);
  report.scenarios.push({ name: 'entry-before-preview-idle-with-late-callback', pending, entered: pendingEntry, lateCallback, idleProof });
  await pendingContext.close();
  // Critical HTML/CSS remains readable even when no JavaScript can execute.
  const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const noJsPage = await noJs.newPage(); await noJsPage.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  assert(await noJsPage.locator('#intro-title').isVisible()); assert(await noJsPage.locator('#enter-studio').isVisible());
  await noJsPage.screenshot({ path: `${output}/no-javascript-first-paint.png`, fullPage: true });
  report.scenarios.push({ name: 'no-javascript-readable', passed: true }); await noJs.close();
  // A simulator parse/load failure before entry must not strand the CTA.
  const failedModule = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const failedPage = await failedModule.newPage();
  const moduleErrors = [];
  failedPage.on('pageerror', error => moduleErrors.push(error.message));
  await failedPage.route(targetUrl, async route => {
    const response = await route.fetch();
    const html = (await response.text()).replace(/<script\b[^>]*type="module"[^>]*>[\s\S]*?<\/script>/, '<script type="module">throw new Error("Intentional simulator module failure")</script>');
    await route.fulfill({ response, body: html });
  });
  await failedPage.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await failedPage.waitForFunction(() => window.__OCTOBERLINE_LANDING__?.bootError);
  assert(await failedPage.locator('#intro-title').isVisible());
  await failedPage.click('#enter-studio');
  await failedPage.waitForFunction(() => window.__OCTOBERLINE_LANDING__.status === 'error');
  assert.equal(await failedPage.evaluate(() => Boolean(window.__OCTOBERLINE_211__)), false);
  assert(await failedPage.locator('#enter-studio').isEnabled());
  assert(await failedPage.locator('#intro-load-status').innerText());
  assert.deepEqual(moduleErrors, ['Intentional simulator module failure']);
  report.scenarios.push({ name: 'pre-entry-module-error-retry', passed: true });
  await failedModule.close();
  await browser.close();
  const fallbackBrowser = await launchBrowser({ disableWebgl: true });
  try {
    const page = await fallbackBrowser.newPage({ viewport: { width: 390, height: 844 } });
    const expectedErrors = [];
    page.on('pageerror', error => expectedErrors.push(error.message));
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__OCTOBERLINE_LANDING__?.assembly?.getState().phase === 'unavailable', null, { timeout: 30000 });
    assert.equal(await page.evaluate(() => window.__OCTOBERLINE_LANDING__.status), 'idle', 'Optional graphics failure must not disable the initial CTA');
    assert(await page.locator('#enter-studio').isEnabled());
    await page.click('#intro-guide'); assert(await page.locator('#landing-guide').evaluate(e => e.open)); await page.keyboard.press('Escape');
    await page.click('#enter-studio');
    await page.waitForFunction(() => window.__OCTOBERLINE_LANDING__?.status === 'error', null, { timeout: 30000 });
    const errorState = await page.evaluate(() => ({
      status: window.__OCTOBERLINE_LANDING__.status, engine: Boolean(window.__OCTOBERLINE_211__),
      message: document.querySelector('#intro-load-status').textContent,
      retryEnabled: !document.querySelector('#enter-studio').disabled,
    }));
    assert.equal(errorState.engine, false); assert(errorState.retryEnabled); assert.match(errorState.message, /WebGL 2/i);
    await page.click('#intro-guide'); assert(await page.locator('#landing-guide').evaluate(e => e.open)); await page.keyboard.press('Escape');
    await page.screenshot({ path: `${output}/webgl-error-retry.png`, fullPage: true });
    await page.click('#enter-studio');
    await page.waitForFunction(() => window.__OCTOBERLINE_LANDING__?.status === 'idle');
    assert.equal(await page.evaluate(() => Boolean(window.__OCTOBERLINE_211__)), false);
    assert(expectedErrors.every(message => /WebGL/i.test(message)), `Unexpected fallback errors: ${expectedErrors}`);
    report.scenarios.push({ name: 'webgl-error-retry', errorState, expectedErrors, reloadRecoveredIdle: true });
  } finally { await fallbackBrowser.close(); }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch(error) { report.passed = false; report.failure = error.stack; throw error; }
finally { await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); await browser.close(); await preview.close(); }
