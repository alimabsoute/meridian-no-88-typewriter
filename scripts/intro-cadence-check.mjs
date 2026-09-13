import { mkdir, writeFile } from 'node:fs/promises';
import { launchBrowser } from './browser-test-helpers.mjs';
const url = process.env.TARGET_URL || 'https://octoberline211.com/';
const browser = await launchBrowser({ headless: process.env.HEADED !== '1' });
const results = [];
await mkdir('visual-checks/cadence', { recursive: true });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, reducedMotion: 'no-preference' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__OCTOBERLINE_211__, null, { timeout: 60000 });
    const sample = await page.evaluate(() => new Promise(resolve => {
      const api = window.__OCTOBERLINE_211__, frames = [];
      const canvas = document.querySelector('#scene');
      const gl = canvas.getContext('webgl2');
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      const costs = {};
      for (const name of ['model', 'room', 'paperView']) {
        const object = api[name], original = object.update;
        costs[name] = 0;
        object.update = function(...args) { const start = performance.now(); const value = original.apply(this,args); costs[name] += performance.now()-start; return value; };
      }
      let start;
      function sample(now) {
        start ??= now;
        frames.push({ t: now, camera: api.camera.position.toArray() });
        if (now - start < 7000) requestAnimationFrame(sample);
        else resolve({ gpu, frames, costs, ratio: canvas.width / canvas.clientWidth });
      }
      requestAnimationFrame(sample);
    }));
    const gaps = sample.frames.slice(1).map((f, i) => f.t - sample.frames[i].t).sort((a,b) => a-b);
    results.push({ url, width, errors, ...sample, fps: 1000 / (gaps.reduce((a,b) => a+b,0)/gaps.length), p95: gaps[Math.floor(gaps.length*.95)], max: gaps.at(-1) });
    console.log(JSON.stringify({ width, costs: sample.costs, fps: results.at(-1).fps, p95: results.at(-1).p95 }));
    await page.screenshot({ path: `visual-checks/cadence/${width}.png` });
    await context.close();
  }
} finally {
  await writeFile('visual-checks/cadence/results.json', JSON.stringify(results,null,2));
  console.log(JSON.stringify(results.map(({frames,...rest}) => rest),null,2));
  await browser.close();
}
