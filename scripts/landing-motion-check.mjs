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
    for (const name of ['AudioContext', 'webkitAudioContext']) if (window[name]) window[name] = new Proxy(window[name], {
      construct(target, args) { window.__landingProof.audio++; return Reflect.construct(target, args); },
    });
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      if (/webgl/i.test(type)) window.__landingProof.webgl++;
      return getContext.call(this, type, ...args);
    };
  });
}
async function state(page) {
  return page.evaluate(() => {
    const intro = document.querySelector('#intro-overlay'), title = document.querySelector('#intro-title');
    const css = getComputedStyle(title);
    return {
      title: title.textContent.trim(), titleVisible: css.visibility !== 'hidden' && Number(css.opacity) > 0 && title.getBoundingClientRect().height > 0,
      status: window.__OCTOBERLINE_LANDING__?.status, started: window.__OCTOBERLINE_LANDING__?.started,
      engine: Boolean(window.__OCTOBERLINE_211__), constructors: window.__landingProof,
      width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
      buttons: ['enter-studio','intro-guide'].map(id => {
        const e = document.getElementById(id), r = e.getBoundingClientRect();
        return { id, text: e.textContent.trim(), disabled: e.disabled, font: parseFloat(getComputedStyle(e).fontSize), x: r.x, right: r.right, height: r.height };
      }),
      animations: intro.getAnimations({ subtree: true }).filter(a => a.playState === 'running').length,
      paperTransform: getComputedStyle(document.querySelector('.landing-paper')).transform,
    };
  });
}
function assertIdle(s) {
  assert(s.titleVisible, 'Headline must paint without constructing the room');
  assert.equal(s.status, 'idle'); assert.equal(s.started, false); assert.equal(s.engine, false);
  assert.deepEqual(s.constructors, { audio: 0, webgl: 0 });
  assert(s.scrollWidth <= s.width + 1, 'No horizontal scrolling');
  for (const b of s.buttons) {
    assert(!b.disabled && b.height >= 44 && b.x >= 0 && b.right <= s.width + 1, `${b.id} is readable and fits horizontally`);
    assert(b.font >= (b.id === 'enter-studio' ? 20 : 18), `${b.id} has readable type`);
  }
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
  const result = await page.evaluate(() => ({ text: window.__OCTOBERLINE_211__.document.toPlainText(), captured: window.__OCTOBERLINE_211__.keyboardCaptured, status: window.__OCTOBERLINE_LANDING__.status, constructors: window.__landingProof }));
  assert(result.constructors.webgl > 0 && result.captured);
  return { ...result, mechanics };
}
try {
  // Serve actual production HTML as two chunks. The simulator tail is withheld,
  // so a painted, working guide and queued entry cannot depend on that bundle.
  const html = await readFile('dist/index.html');
  let releaseTail;
  const tail = new Promise(resolve => { releaseTail = resolve; });
  const server = createServer(async (_req, res) => {
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
    const partial = await state(page); assertIdle(partial); await guide(page);
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
    report.scenarios.push({ name: 'first-30000-bytes-streamed', partial, queued, entered });
  } finally { releaseTail(); await context.close(); await new Promise(resolve => server.close(resolve)); }

  for (const [name, width, height, reduced] of [
    ['desktop',1600,1000,false], ['mobile',390,844,false], ['small-mobile',320,740,false], ['short-landscape',844,390,false],
    ['desktop-reduced',1600,1000,true], ['mobile-reduced',390,844,true],
  ]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
    const page = await context.newPage(); await instrument(page);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__OCTOBERLINE_LANDING__));
    const first = await state(page); assertIdle(first);
    await page.screenshot({ path: `${output}/${name}-initial.png`, fullPage: true });
    // Short viewports may cull offscreen compositor work. Observe the paper
    // in view, then require its rendered transform to advance normally.
    await page.locator('.landing-paper').evaluate(e => e.scrollIntoView({ block: 'center' }));
    const motionStart = await state(page);
    if (reduced) await page.waitForTimeout(300);
    else await page.waitForFunction(transform => getComputedStyle(document.querySelector('.landing-paper')).transform !== transform, motionStart.paperTransform);
    const next = await state(page); assertIdle(next);
    if (reduced) { assert.equal(next.animations, 0); assert.equal(next.paperTransform, motionStart.paperTransform); }
    else { assert(next.animations > 0); assert.notEqual(next.paperTransform, motionStart.paperTransform, 'CSS paper animation must actually advance'); }
    await guide(page);
    for (const button of ['#enter-studio', '#intro-guide']) { await page.locator(button).scrollIntoViewIfNeeded(); assert(await page.locator(button).isVisible()); }
    await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
    const entry = name === 'mobile' ? await typeAfterEntry(page, 'Mobile proof.') : undefined;
    report.scenarios.push({ name, first, next, entry }); await context.close();
  }
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
