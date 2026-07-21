import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const shotDir = path.resolve('visual-checks');
await mkdir(shotDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ['--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(90000);
const consoleErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => consoleErrors.push(error.stack || error.message));

await page.goto('http://127.0.0.1:4177/?quality=low', { waitUntil: 'networkidle' });
await page.waitForFunction(() => Boolean(window.__MERIDIAN__));
await page.waitForTimeout(2200);

await page.click('#enter-studio');
await page.waitForTimeout(1400);

await page.keyboard.type('The quick brown fox jumps over 13 lazy dogs!', { delay: 26 });
await page.waitForFunction(() => window.__MERIDIAN__.document.toPlainText() === 'The quick brown fox jumps over 13 lazy dogs!', null, { timeout: 45000 });
const firstLine = await page.evaluate(() => window.__MERIDIAN__.document.toPlainText());
if (firstLine !== 'The quick brown fox jumps over 13 lazy dogs!') {
  throw new Error(`Unexpected first line: ${JSON.stringify(firstLine)}`);
}

await page.keyboard.press('Enter');
await page.waitForTimeout(1100);
await page.click('[data-ink="red"]');
await page.click('canvas');
await page.keyboard.type('Red ribbon test?', { delay: 35 });
await page.waitForFunction(() => window.__MERIDIAN__.document.column === 16, null, { timeout: 30000 });
await page.keyboard.press('Backspace');
await page.keyboard.type('!');
await page.waitForFunction(() => window.__MERIDIAN__.document.marks.at(-1)?.character === '!', null, { timeout: 15000 });

const state = await page.evaluate(() => ({
  text: window.__MERIDIAN__.document.toPlainText(),
  column: window.__MERIDIAN__.document.column,
  line: window.__MERIDIAN__.document.line,
  marks: window.__MERIDIAN__.document.marks.length,
  redMarks: window.__MERIDIAN__.document.marks.filter((mark) => mark.ink === 'red').length,
}));

if (!state.text.includes('Red ribbon test!') || state.line !== 1 || state.column !== 16 || state.redMarks < 10) {
  throw new Error(`Unexpected final state: ${JSON.stringify(state)}`);
}

await page.screenshot({ path: path.join(shotDir, '03-typed-paper.png'), animations: 'disabled' });
await page.click('#inspection-toggle');
await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(shotDir, '04-inspection-view.png'), animations: 'disabled' });

await page.click('#guide-open');
await page.click('[data-tab="mechanics"]');
const dialogVisible = await page.locator('#field-guide').evaluate((element) => element.open);
if (!dialogVisible) throw new Error('Field guide did not open.');
await page.screenshot({ path: path.join(shotDir, '05-field-guide.png'), animations: 'disabled' });

if (consoleErrors.length) throw new Error(`Browser console errors:\n${consoleErrors.join('\n')}`);

process.stdout.write(`${JSON.stringify({ ok: true, state, screenshots: shotDir }, null, 2)}\n`);
await browser.close();
