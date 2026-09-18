import { mkdir, writeFile } from 'node:fs/promises';
import { launchBrowser, ensurePreviewServer } from './browser-test-helpers.mjs';
const url = process.env.TARGET_URL || 'https://octoberline211.com/';
const preview = await ensurePreviewServer({ targetUrl: url });
const browser = await launchBrowser({ headless: process.env.HEADED !== '1' });
const results = [];
await mkdir('visual-checks/cadence', { recursive: true });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, reducedMotion: 'no-preference' });
    await context.addInitScript(() => {
      window.__landingResourceAudit = { webgl: 0, audio: 0 };
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, ...args) {
        if (/^(webgl2?|experimental-webgl)$/.test(type)) window.__landingResourceAudit.webgl += 1;
        return original.call(this, type, ...args);
      };
      for (const name of ['AudioContext', 'webkitAudioContext']) {
        if (window[name]) window[name] = new Proxy(window[name], {
          construct(target, args) {
            window.__landingResourceAudit.audio += 1;
            return Reflect.construct(target, args);
          },
        });
      }
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__OCTOBERLINE_LANDING__?.status === 'idle', null, { timeout: 60000 });
    const sample = await page.evaluate(() => new Promise(resolve => {
      const frames = [];
      const overlay = document.querySelector('#intro-overlay');
      let start;
      function sample(now) {
        start ??= now;
        frames.push({ t: now });
        if (now - start < 7000) requestAnimationFrame(sample);
        else resolve({
          measurement: 'CSS landing requestAnimationFrame cadence; no room renderer active',
          frames,
          landing: { ...window.__OCTOBERLINE_LANDING__ },
          initialized: Boolean(window.__OCTOBERLINE_211__),
          resources: { ...window.__landingResourceAudit },
          visible: overlay.getBoundingClientRect().height > 0 && getComputedStyle(overlay).visibility !== 'hidden',
          cssAnimations: overlay.getAnimations({ subtree: true }).map(animation => ({
            name: animation.animationName ?? null,
            playState: animation.playState,
            currentTime: animation.currentTime,
          })),
          paint: performance.getEntriesByType('paint').map(({ name, startTime }) => ({ name, startTime })),
        });
      }
      requestAnimationFrame(sample);
    }));
    const gaps = sample.frames.slice(1).map((f, i) => f.t - sample.frames[i].t).sort((a,b) => a-b);
    const result = { url, width, errors, ...sample, fps: 1000 / (gaps.reduce((a,b) => a+b,0)/gaps.length), p95: gaps[Math.floor(gaps.length*.95)], max: gaps.at(-1) };
    results.push(result);
    if (errors.length || !sample.visible || sample.initialized || sample.landing.status !== 'idle'
      || sample.landing.started !== false || sample.resources.webgl !== 0 || sample.resources.audio !== 0) {
      throw new Error(`CSS landing contract failed: ${JSON.stringify({ ...result, frames: undefined })}`);
    }
    console.log(JSON.stringify({ width, fps: result.fps, p95: result.p95, resources: sample.resources }));
    await page.screenshot({ path: `visual-checks/cadence/${width}.png` });
    await context.close();
  }
} finally {
  await writeFile('visual-checks/cadence/results.json', JSON.stringify(results,null,2));
  console.log(JSON.stringify(results.map(({frames,...rest}) => rest),null,2));
  await browser.close();
  await preview.close();
}
