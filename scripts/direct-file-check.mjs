import { access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser } from './browser-test-helpers.mjs';

const buildPath = path.resolve('dist/index.html');
await access(buildPath);
const targetUrl = `${pathToFileURL(buildPath).href}?quality=low`;

async function verifyStandaloneFile() {
  const browser = await launchBrowser({ allowFileAccess: true });
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
    await page.waitForFunction(() => Boolean(window.__MERIDIAN__));
    await page.click('#enter-studio');
    await page.keyboard.type('Offline proof.', { delay: 12 });
    await page.waitForFunction(() => !window.__MERIDIAN__.model.busy);
    await page.waitForTimeout(650); // Allow the idle persistence checkpoint to commit.

    const typed = await page.evaluate(() => window.__MERIDIAN__.document.toPlainText());
    if (typed !== 'Offline proof.') throw new Error(`Direct-file typing mismatch: ${JSON.stringify(typed)}`);

    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => Boolean(window.__MERIDIAN__));
    const restored = await page.evaluate(() => window.__MERIDIAN__.document.toPlainText());
    if (restored !== typed) throw new Error(`Direct-file persistence mismatch: ${JSON.stringify(restored)}`);
    if (externalRequests.length) throw new Error(`Standalone build made external requests: ${externalRequests.join(' | ')}`);
    if (errors.length) throw new Error(`Direct-file browser errors: ${errors.join(' | ')}`);
    return { typed, restored, externalRequests: externalRequests.length };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function verifyWebglFallback() {
  const browser = await launchBrowser({ allowFileAccess: true, disableWebgl: true });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
    await page.goto(targetUrl, { waitUntil: 'load' });
    await page.getByText('WEBGL 2 REQUIRED').waitFor({ state: 'visible', timeout: 30000 });
    const fallback = await page.evaluate(() => ({
      messageVisible: document.body.innerText.includes('WEBGL 2 REQUIRED'),
      simulatorStarted: Boolean(window.__MERIDIAN__),
    }));
    if (!fallback.messageVisible || fallback.simulatorStarted) {
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
