import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  args: ['--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
const errors = [];
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
page.on('pageerror', (error) => errors.push(error.message));
const targetUrl = process.env.TARGET_URL || 'http://127.0.0.1:4177/?quality=low';
await page.goto(targetUrl, { waitUntil: 'networkidle' });
try {
  await page.waitForFunction(() => Boolean(window.__MERIDIAN__), null, { timeout: 60000 });
} catch (error) {
  throw new Error(`Simulator did not initialize: ${errors.join(' | ') || error.message}`);
}
await page.click('#enter-studio');

await page.click('#guide-open');
await page.waitForFunction(() => document.querySelector('#field-guide')?.open);
await page.click('.guide-close');
await page.waitForFunction(() => document.activeElement?.id === 'scene');

await page.keyboard.down('ShiftRight');
await page.waitForFunction(() => window.__MERIDIAN__.model.keys.get('ShiftRight')?.depression > 0.35);
const shiftState = await page.evaluate(() => ({
  left: window.__MERIDIAN__.model.keys.get('ShiftLeft')?.depression ?? 0,
  right: window.__MERIDIAN__.model.keys.get('ShiftRight')?.depression ?? 0,
}));
await page.keyboard.up('ShiftRight');
if (shiftState.right <= 0.35 || shiftState.left >= 0.2) throw new Error(`Shift-side mismatch: ${JSON.stringify(shiftState)}`);

const averageFrameMs = await page.evaluate(() => new Promise((resolve) => {
  let frames = 0;
  let first = 0;
  function sample(now) {
    if (!first) first = now;
    frames += 1;
    if (frames >= 60) resolve((now - first) / (frames - 1));
    else requestAnimationFrame(sample);
  }
  requestAnimationFrame(sample);
}));

await page.keyboard.type('The quick brown fox jumps over 13 lazy dogs!', { delay: 12 });
await page.waitForFunction(() => window.__MERIDIAN__.document.marks.length >= 36, null, { timeout: 30000 });
const first = await page.evaluate(() => window.__MERIDIAN__.document.toPlainText());
if (first !== 'The quick brown fox jumps over 13 lazy dogs!') throw new Error(`First line mismatch: ${JSON.stringify(first)}`);

await page.keyboard.press('Enter');
await page.waitForFunction(() => window.__MERIDIAN__.document.line === 1, null, { timeout: 10000 });
await page.click('[data-ink="red"]');
await page.waitForFunction(() => document.activeElement?.id === 'scene');
await page.keyboard.type('Red ribbon test?', { delay: 12 });
await page.waitForFunction(() => window.__MERIDIAN__.document.column === 16, null, { timeout: 20000 });
await page.keyboard.press('Backspace');
await page.keyboard.type('!');
await page.waitForFunction(() => window.__MERIDIAN__.document.marks.at(-1)?.character === '!', null, { timeout: 10000 });
const state = await page.evaluate(() => ({
  text: window.__MERIDIAN__.document.toPlainText(),
  column: window.__MERIDIAN__.document.column,
  line: window.__MERIDIAN__.document.line,
  marks: window.__MERIDIAN__.document.marks.length,
  redMarks: window.__MERIDIAN__.document.marks.filter((mark) => mark.ink === 'red').length,
  marginBellDistance: window.__MERIDIAN__.document.bellDistance,
}));
if (!state.text.includes('Red ribbon test!') || state.redMarks !== 15) throw new Error(`Final state mismatch: ${JSON.stringify(state)}`);

await page.click('#document-toggle');
page.once('dialog', (dialog) => dialog.accept());
await page.click('#new-sheet');
await page.waitForFunction(() => Boolean(window.__MERIDIAN__.model.paperLoading));
await page.waitForFunction(() => window.__MERIDIAN__.model.paperLoading === null, null, { timeout: 10000 });
const newSheetState = await page.evaluate(() => ({
  sheetNumber: window.__MERIDIAN__.document.sheetNumber,
  marks: window.__MERIDIAN__.document.marks.length,
  focused: document.activeElement?.id,
}));
if (newSheetState.sheetNumber !== 2 || newSheetState.marks !== 0 || newSheetState.focused !== 'scene') {
  throw new Error(`New-sheet mismatch: ${JSON.stringify(newSheetState)}`);
}
if (errors.length) throw new Error(`Console errors: ${errors.join(' | ')}`);

const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const mobilePage = await mobileContext.newPage();
const mobileErrors = [];
mobilePage.on('console', (message) => { if (message.type() === 'error') mobileErrors.push(message.text()); });
mobilePage.on('pageerror', (error) => mobileErrors.push(error.message));
await mobilePage.goto(targetUrl, { waitUntil: 'networkidle' });
await mobilePage.waitForFunction(() => Boolean(window.__MERIDIAN__));
await mobilePage.click('#enter-studio');
await mobilePage.waitForFunction(() => {
  const element = document.querySelector('#mobile-input');
  return element && getComputedStyle(element).display !== 'none' && element.getBoundingClientRect().height > 0;
});
await mobilePage.focus('#mobile-input');
await mobilePage.evaluate(() => {
  document.querySelector('#mobile-input').dispatchEvent(new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    inputType: 'insertText',
    data: 'Hi',
  }));
});
await mobilePage.waitForFunction(() => window.__MERIDIAN__.document.marks.length === 2, null, { timeout: 10000 });
const mobileText = await mobilePage.evaluate(() => window.__MERIDIAN__.document.toPlainText());
if (mobileText !== 'Hi') throw new Error(`Mobile input mismatch: ${JSON.stringify(mobileText)}`);
if (mobileErrors.length) throw new Error(`Mobile console errors: ${mobileErrors.join(' | ')}`);
await mobileContext.close();

process.stdout.write(`${JSON.stringify({ ok: true, averageFrameMs, approximateFps: Math.round(1000 / averageFrameMs), shiftState, state, newSheetState, mobileText }, null, 2)}\n`);
await browser.close();
