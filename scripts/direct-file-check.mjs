import { enterStudio } from './browser-test-helpers.mjs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser } from './browser-test-helpers.mjs';

const buildPath = path.resolve('dist/index.html');
await access(buildPath);
const targetUrl = `${pathToFileURL(buildPath).href}?quality=low`;

async function verifyStandaloneFile() {
  // Ordinary double-click security: optional external media falls back locally.
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
    page.setDefaultTimeout(60000);
    const errors = [];
    const externalRequests = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(error.stack || error.message));
    page.on('request', (request) => {
      const url = request.url();
      if (!url.startsWith('file:') && !url.startsWith('data:') && !url.startsWith('blob:')) externalRequests.push(url);
    });

    await page.goto(targetUrl, { waitUntil: 'load' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'load' });
    await enterStudio(page);
    await page.keyboard.type('Offline proof.', { delay: 12 });
    await page.waitForFunction(() => !window.__OCTOBERLINE_211__.model.busy);
    await page.waitForTimeout(650); // Allow the idle persistence checkpoint to commit.

    const typed = await page.evaluate(() => window.__OCTOBERLINE_211__.document.toPlainText());
    if (typed !== 'Offline proof.') throw new Error(`Direct-file typing mismatch: ${JSON.stringify(typed)}`);

    await page.reload({ waitUntil: 'load' });
    await enterStudio(page);
    const restored = await page.evaluate(() => window.__OCTOBERLINE_211__.document.toPlainText());
    if (restored !== typed) throw new Error(`Direct-file persistence mismatch: ${JSON.stringify(restored)}`);
    if (externalRequests.length) throw new Error(`Standalone build made external requests: ${externalRequests.join(' | ')}`);
    if (errors.length) throw new Error(`Direct-file browser errors: ${errors.join(' | ')}`);
    return { typed, restored, externalRequests: externalRequests.length };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function verifyWebglFallback() {
  const browser = await launchBrowser({ disableWebgl: true });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
    await page.goto(targetUrl, { waitUntil: 'load' });
    await page.click('#enter-studio');
    await page.waitForFunction(() => window.__OCTOBERLINE_LANDING__?.status === 'error', null, { timeout: 30000 });
    const fallback = await page.evaluate(() => ({
      messageVisible: /WebGL 2 is required/i.test(document.querySelector('#intro-load-status')?.textContent || ''),
      retryEnabled: !document.querySelector('#enter-studio').disabled,
      simulatorStarted: Boolean(window.__OCTOBERLINE_211__),
    }));
    if (!fallback.messageVisible || !fallback.retryEnabled || fallback.simulatorStarted) {
      throw new Error(`WebGL fallback mismatch: ${JSON.stringify(fallback)}`);
    }
    return fallback;
  } finally {
    await browser.close().catch(() => {});
  }
}

const standalone = await verifyStandaloneFile();
const fallback = await verifyWebglFallback();
process.stdout.write(`${JSON.stringify({ ok: true, buildPath, ...standalone, fallback }, null, 2)}\n`);
