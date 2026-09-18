import { mkdir, writeFile } from 'node:fs/promises';
import { launchBrowser, ensurePreviewServer } from './browser-test-helpers.mjs';

const url = process.env.TARGET_URL || 'https://octoberline211.com/';
const preview = await ensurePreviewServer({ targetUrl: url });
const browser = await launchBrowser({ headless: process.env.HEADED !== '1' });
const results = [];
await mkdir('visual-checks/cadence', { recursive: true });

function summarize(frames) {
  const gaps = frames.slice(1).map((frame, index) => frame.t - frames[index].t).sort((a, b) => a - b);
  const work = frames.map(frame => frame.durationMs).sort((a, b) => a - b);
  const percentile = (values, fraction) => values.length ? values[Math.min(values.length - 1, Math.floor(values.length * fraction))] : null;
  return {
    frames: frames.length,
    durationMs: frames.length > 1 ? frames.at(-1).t - frames[0].t : 0,
    fps: gaps.length ? 1000 / (gaps.reduce((sum, value) => sum + value, 0) / gaps.length) : null,
    p50: percentile(gaps, 0.5),
    p95: percentile(gaps, 0.95),
    max: gaps.at(-1) ?? null,
    renderSubmissionWorkP95: percentile(work, 0.95),
  };
}

try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, reducedMotion: 'no-preference' });
    try {
      await context.addInitScript(() => {
        window.__landingResourceAudit = { webgl: 0, audio: 0 };
        const contexts = new WeakSet();
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type, ...args) {
          const context = original.call(this, type, ...args);
          if (/^(webgl2?|experimental-webgl)$/.test(type) && context && !contexts.has(context)) {
            contexts.add(context);
            window.__landingResourceAudit.webgl += 1;
          }
          return context;
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
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => {
        return ['complete', 'unavailable'].includes(document.querySelector('#landing-assembly')?.dataset.assemblyState);
      }, null, { timeout: 60000, polling: 100 });
      const initial = await page.evaluate(() => window.__OCTOBERLINE_LANDING__.assembly.getState());
      if (initial.phase !== 'complete') throw new Error(`Preview could not render: ${initial.error}`);
      await page.locator('#landing-assembly').scrollIntoViewIfNeeded();

      // Measure the real preview renderer's own bounded timestamps. This replay
      // uses the same controller as the visible Replay button; it does not call
      // model.update(), simulate elapsed time, or create an independent RAF loop.
      const baseline = await page.evaluate(() => {
        const stage = window.__OCTOBERLINE_LANDING__.assembly;
        const frame = stage.getState().frameCount;
        const replayed = stage.replay();
        return { frame, replayed };
      });
      if (!baseline.replayed) throw new Error('Preview replay did not start');
      await page.waitForFunction(() => document.querySelector('#landing-assembly')?.dataset.assemblyState === 'complete', null, { timeout: 60000, polling: 100 });
      await page.waitForTimeout(3000);
      const sample = await page.evaluate(() => {
        const landing = window.__OCTOBERLINE_LANDING__;
        const stage = landing.assembly.getState();
        const overlay = document.querySelector('#intro-overlay');
        return {
          stage,
          landing: { status: landing.status, started: landing.started },
          initialized: Boolean(window.__OCTOBERLINE_211__),
          resources: { ...window.__landingResourceAudit },
          visible: overlay.getBoundingClientRect().height > 0 && getComputedStyle(overlay).visibility !== 'hidden',
          paint: performance.getEntriesByType('paint').map(({ name, startTime }) => ({ name, startTime })),
          environment: { userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency, devicePixelRatio },
        };
      });
      const frames = sample.stage.renderTimeline.filter(row => row[2] > baseline.frame)
        .map(([t, durationMs, frame, phaseCode, progress]) => ({ t, durationMs, frame, phaseCode, progress }));
      const assembly = summarize(frames.filter(frame => frame.phaseCode === 1));
      const settled = summarize(frames.filter(frame => frame.phaseCode === 2));
      const { renderTimeline: _timeline, ...stage } = sample.stage;
      const result = {
        url, width, checkedAt: new Date().toISOString(), errors,
        measurement: 'Actual preview renderer submissions during coalescence and settled camera drift; hardware-dependent, not display-present or full-room FPS',
        phaseCodes: { 1: 'assembling', 2: 'settled', 3: 'reduced-motion static' },
        ...sample,
        stage,
        firstPreviewRenderMs: initial.firstRenderAt,
        droppedFramesFromBoundedHistory: sample.stage.frameCount - baseline.frame - frames.length,
        assembly,
        settled,
        fps: assembly.fps,
        p95: assembly.p95,
        max: assembly.max,
        frames,
      };
      results.push(result);
      if (errors.length || !sample.visible || sample.initialized || sample.landing.status !== 'idle'
        || sample.landing.started !== false || sample.resources.webgl !== 1 || sample.resources.audio !== 0
        || stage.phase !== 'complete' || stage.restTransformError >= 1e-8 || assembly.frames < 4 || settled.frames < 4) {
        throw new Error(`Preview cadence contract failed: ${JSON.stringify({ ...result, frames: undefined })}`);
      }
      // Performance is reported as observed evidence. A slower GPU is not
      // converted into a fabricated 60 fps result or hidden by a synthetic gate.
      console.log(JSON.stringify({ width, assembly, settled, resources: sample.resources }));
      await page.screenshot({ path: `visual-checks/cadence/${width}.png` });
    } finally {
      await context.close();
    }
  }
} finally {
  await writeFile('visual-checks/cadence/results.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results.map(({ frames, ...rest }) => rest), null, 2));
  await browser.close();
  await preview.close();
}
