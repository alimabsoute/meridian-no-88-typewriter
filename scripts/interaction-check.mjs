import { readFile } from 'node:fs/promises';
import {
  DEFAULT_PREVIEW_URL,
  ensurePreviewServer,
  launchBrowser,
  withQuality,
} from './browser-test-helpers.mjs';

const configuredTargetUrl = process.env.TARGET_URL || withQuality(DEFAULT_PREVIEW_URL, 'low');
const preview = await ensurePreviewServer({ targetUrl: configuredTargetUrl });
const targetUrl = preview.targetUrl;

function deterministicRandom() {
  let seed = 0x4d455249;
  Math.random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

function collectErrors(page) {
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.stack || error.message));
  return errors;
}

async function pressAndCaptureKeyPeak(page, { key, code, otherCodes = [], threshold = 0.18 }) {
  await page.evaluate(({ targetCode, comparisonCodes, targetThreshold }) => {
    const sample = {
      target: 0,
      others: Object.fromEntries(comparisonCodes.map((comparisonCode) => [comparisonCode, 0])),
      modeledName: window.__MERIDIAN__.model.keys.get(targetCode)?.group?.name,
      done: false,
    };
    window.__MERIDIAN_KEY_PEAK__ = sample;
    function capture() {
      sample.target = Math.max(
        sample.target,
        window.__MERIDIAN__.model.keys.get(targetCode)?.depression ?? 0,
      );
      for (const comparisonCode of comparisonCodes) {
        sample.others[comparisonCode] = Math.max(
          sample.others[comparisonCode],
          window.__MERIDIAN__.model.keys.get(comparisonCode)?.depression ?? 0,
        );
      }
      sample.done = sample.target > targetThreshold;
      if (!sample.done) requestAnimationFrame(capture);
    }
    requestAnimationFrame(capture);
  }, { targetCode: code, comparisonCodes: otherCodes, targetThreshold: threshold });

  await page.keyboard.down(key);
  try {
    await page.waitForFunction(
      () => window.__MERIDIAN_KEY_PEAK__?.done,
      null,
      { timeout: 5_000 },
    );
    return page.evaluate(() => ({ ...window.__MERIDIAN_KEY_PEAK__ }));
  } finally {
    await page.keyboard.up(key);
  }
}

async function waitForSimulator(page) {
  await page.goto(targetUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__MERIDIAN__), null, { timeout: 60000 });
}

async function openDocumentTray(page) {
  if (await page.locator('#document-toggle').getAttribute('aria-expanded') !== 'true') {
    await page.click('#document-toggle');
  }
  await page.waitForFunction(() => document.querySelector('#document-toggle')?.getAttribute('aria-expanded') === 'true');
}

let browser;
try {
browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
await page.addInitScript(deterministicRandom);
const errors = collectErrors(page);
await page.goto(targetUrl, { waitUntil: 'networkidle' });
try {
  await page.waitForFunction(() => Boolean(window.__MERIDIAN__), null, { timeout: 60000 });
} catch (error) {
  throw new Error(`Simulator did not initialize: ${errors.join(' | ') || error.message}`);
}
await page.click('#enter-studio');

const paperAudioState = await page.evaluate(() => {
  const control = document.getElementById('paper-volume');
  const machineBefore = window.__MERIDIAN__.audio.volume;
  control.value = '0.17';
  control.dispatchEvent(new Event('input', { bubbles: true }));
  return {
    controlValue: Number(control.value),
    paperVolume: window.__MERIDIAN__.audio.paperVolume,
    machineBefore,
    machineAfter: window.__MERIDIAN__.audio.volume,
  };
});
if (
  Math.abs(paperAudioState.controlValue - 0.17) > 0.001
  || Math.abs(paperAudioState.paperVolume - 0.17) > 0.001
  || paperAudioState.machineAfter !== paperAudioState.machineBefore
) {
  throw new Error(`Paper audio channel mismatch: ${JSON.stringify(paperAudioState)}`);
}

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

const geometryClearance = await page.evaluate(() => {
  const shell = window.__MERIDIAN__.model.getKeyShellClearanceSnapshot();
  const neighbors = window.__MERIDIAN__.model.getKeyNeighborClearanceSnapshot();
  return {
    unsupportedShells: shell.unsupportedShells,
    restIntersections: shell.rest.intersections,
    depressedIntersections: shell.depressed.intersections,
    sweepIntersections: shell.sweep.intersections,
    minimumShellClearance: shell.sweep.minimumClearance,
    neighborIntersections: neighbors.intersections,
    neighborMinimumClearances: neighbors.pairs.map(({ keys, minimumClearance }) => ({ keys, minimumClearance })),
  };
});
if (
  geometryClearance.unsupportedShells.length
  || geometryClearance.restIntersections.length
  || geometryClearance.depressedIntersections.length
  || geometryClearance.sweepIntersections.length
  || geometryClearance.neighborIntersections.length
  || geometryClearance.minimumShellClearance < 0.015
  || geometryClearance.neighborMinimumClearances.some(({ minimumClearance }) => minimumClearance < 0.02)
) {
  throw new Error(`Keyboard geometry regression: ${JSON.stringify(geometryClearance)}`);
}

// Verify that representative host keys animate the intended modeled key in
// every character row. This uses a separate sheet so the release workflow
// below keeps its established text and page numbering.
const keyboardContext = await browser.newContext({ viewport: { width: 960, height: 640 } });
await keyboardContext.addInitScript(deterministicRandom);
const keyboardPage = await keyboardContext.newPage();
const keyboardErrors = collectErrors(keyboardPage);
const rowRepresentatives = [
  { row: 0, key: '`', code: 'Backquote', character: '`' },
  { row: 0, key: '4', code: 'Digit4', character: '4' },
  { row: 1, key: 'r', code: 'KeyR', character: 'r' },
  { row: 2, key: 'f', code: 'KeyF', character: 'f' },
  { row: 3, key: 'v', code: 'KeyV', character: 'v' },
];
const representativeCodes = rowRepresentatives.map(({ code }) => code);
const keyCorrespondence = [];
let expectedKeyboardText = '';
let tabBackspaceState;
try {
  await waitForSimulator(keyboardPage);
  await keyboardPage.click('#enter-studio');
  await keyboardPage.waitForFunction(() => !window.__MERIDIAN__.model.busy);

  for (const representative of rowRepresentatives) {
    await keyboardPage.waitForFunction(
      (codes) => codes.every((code) => (window.__MERIDIAN__.model.keys.get(code)?.depression ?? 1) < 0.02),
      representativeCodes,
    );
    const peak = await pressAndCaptureKeyPeak(keyboardPage, {
      key: representative.key,
      code: representative.code,
      otherCodes: representativeCodes.filter((code) => code !== representative.code),
    });

    await keyboardPage.waitForFunction(
      (code) => !window.__MERIDIAN__.model.busy
        && (window.__MERIDIAN__.model.keys.get(code)?.depression ?? 1) < 0.02,
      representative.code,
      { timeout: 10000 },
    );
    expectedKeyboardText += representative.character;
    const settled = await keyboardPage.evaluate(() => ({
      text: window.__MERIDIAN__.document.toPlainText(),
      lastMark: window.__MERIDIAN__.document.marks.at(-1),
    }));
    const maximumOtherDepression = Math.max(...Object.values(peak.others));
    if (
      peak.target <= 0.18
      || maximumOtherDepression >= 0.12
      || peak.modeledName !== `Key_${representative.code}`
      || settled.text !== expectedKeyboardText
      || settled.lastMark?.character !== representative.character
    ) {
      throw new Error(`Keyboard row ${representative.row} mismatch: ${JSON.stringify({ representative, peak, settled })}`);
    }
    keyCorrespondence.push({ ...representative, peak: peak.target, maximumOtherDepression, modeledName: peak.modeledName });
  }

  const marksBeforeTab = await keyboardPage.evaluate(() => window.__MERIDIAN__.document.marks.length);
  const tabPeak = (await pressAndCaptureKeyPeak(keyboardPage, { key: 'Tab', code: 'Tab' })).target;
  await keyboardPage.waitForFunction(
    () => !window.__MERIDIAN__.model.busy && window.__MERIDIAN__.document.column === 8,
    null,
    { timeout: 10000 },
  );
  const afterTab = await keyboardPage.evaluate(() => ({
    column: window.__MERIDIAN__.document.column,
    marks: window.__MERIDIAN__.document.marks.length,
  }));

  const backspacePeak = (await pressAndCaptureKeyPeak(keyboardPage, { key: 'Backspace', code: 'Backspace' })).target;
  await keyboardPage.waitForFunction(
    () => !window.__MERIDIAN__.model.busy && window.__MERIDIAN__.document.column === 7,
    null,
    { timeout: 10000 },
  );
  const afterBackspace = await keyboardPage.evaluate(() => ({
    column: window.__MERIDIAN__.document.column,
    marks: window.__MERIDIAN__.document.marks.length,
  }));

  await keyboardPage.keyboard.type('x');
  await keyboardPage.waitForFunction(() => !window.__MERIDIAN__.model.busy, null, { timeout: 10000 });
  const afterRecoveryType = await keyboardPage.evaluate(() => ({
    column: window.__MERIDIAN__.document.column,
    text: window.__MERIDIAN__.document.toPlainText(),
    lastMark: window.__MERIDIAN__.document.marks.at(-1),
    tabDepression: window.__MERIDIAN__.model.keys.get('Tab')?.depression ?? 1,
    backspaceDepression: window.__MERIDIAN__.model.keys.get('Backspace')?.depression ?? 1,
  }));
  tabBackspaceState = { marksBeforeTab, tabPeak, backspacePeak, afterTab, afterBackspace, afterRecoveryType };
  if (
    tabPeak <= 0.18
    || backspacePeak <= 0.18
    || afterTab.column !== 8
    || afterTab.marks !== marksBeforeTab
    || afterBackspace.column !== 7
    || afterBackspace.marks !== marksBeforeTab
    || afterRecoveryType.column !== 8
    || afterRecoveryType.text !== `${expectedKeyboardText.padEnd(7, ' ')}x`
    || afterRecoveryType.lastMark?.column !== 7
    || afterRecoveryType.lastMark?.character !== 'x'
    || afterRecoveryType.tabDepression >= 0.02
    || afterRecoveryType.backspaceDepression >= 0.02
  ) {
    throw new Error(`Tab/backspace recovery mismatch: ${JSON.stringify(tabBackspaceState)}`);
  }
  if (keyboardErrors.length) throw new Error(`Keyboard correspondence console errors: ${keyboardErrors.join(' | ')}`);
} finally {
  await keyboardContext.close();
}

// Exercise both the initial media-query read and the live change listener that
// propagates reduced-motion preferences into the room simulation.
const reducedContext = await browser.newContext({
  viewport: { width: 960, height: 640 },
  reducedMotion: 'reduce',
});
await reducedContext.addInitScript(deterministicRandom);
const reducedPage = await reducedContext.newPage();
const reducedErrors = collectErrors(reducedPage);
let reducedMotionState;
try {
  await waitForSimulator(reducedPage);
  await reducedPage.waitForFunction(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
      && window.__MERIDIAN__.room.getState().reducedMotion,
  );
  const initialReduced = await reducedPage.evaluate(() => {
    const duration = getComputedStyle(document.querySelector('#intro-overlay')).transitionDuration.split(',')[0].trim();
    const transitionMilliseconds = duration.endsWith('ms') ? Number.parseFloat(duration) : Number.parseFloat(duration) * 1000;
    return {
      mediaMatches: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      roomReduced: window.__MERIDIAN__.room.getState().reducedMotion,
      snowCount: window.__MERIDIAN__.room.activeSnowCount,
      updateStride: window.__MERIDIAN__.room.updateStride,
      transitionMilliseconds,
    };
  });

  await reducedPage.emulateMedia({ reducedMotion: 'no-preference' });
  await reducedPage.waitForFunction(
    () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches
      && !window.__MERIDIAN__.room.getState().reducedMotion,
  );
  const normalMotion = await reducedPage.evaluate(() => ({
    mediaMatches: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    roomReduced: window.__MERIDIAN__.room.getState().reducedMotion,
    snowCount: window.__MERIDIAN__.room.activeSnowCount,
    updateStride: window.__MERIDIAN__.room.updateStride,
  }));

  await reducedPage.emulateMedia({ reducedMotion: 'reduce' });
  await reducedPage.waitForFunction(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
      && window.__MERIDIAN__.room.getState().reducedMotion,
  );
  const restoredReduced = await reducedPage.evaluate(() => ({
    mediaMatches: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    roomReduced: window.__MERIDIAN__.room.getState().reducedMotion,
    snowCount: window.__MERIDIAN__.room.activeSnowCount,
    uneaseSignal: window.__MERIDIAN__.room.getState().uneaseSignal,
  }));
  reducedMotionState = { initialReduced, normalMotion, restoredReduced };
  if (
    !initialReduced.mediaMatches
    || !initialReduced.roomReduced
    || initialReduced.transitionMilliseconds > 1
    || normalMotion.mediaMatches
    || normalMotion.roomReduced
    || normalMotion.snowCount <= initialReduced.snowCount
    || !restoredReduced.mediaMatches
    || !restoredReduced.roomReduced
    || restoredReduced.snowCount !== initialReduced.snowCount
    || restoredReduced.uneaseSignal !== 0
  ) {
    throw new Error(`Reduced-motion propagation mismatch: ${JSON.stringify(reducedMotionState)}`);
  }
  if (reducedErrors.length) throw new Error(`Reduced-motion console errors: ${reducedErrors.join(' | ')}`);
} finally {
  await reducedContext.close();
}

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

await page.evaluate(() => window.__MERIDIAN__.model.resetLatencyMetrics());
await page.keyboard.type('The quick brown fox jumps over 13 lazy dogs!', { delay: 12 });
await page.waitForFunction(() => !window.__MERIDIAN__.model.busy, null, { timeout: 30000 });
const first = await page.evaluate(() => window.__MERIDIAN__.document.toPlainText());
if (first !== 'The quick brown fox jumps over 13 lazy dogs!') throw new Error(`First line mismatch: ${JSON.stringify(first)}`);
const latency = await page.evaluate(() => window.__MERIDIAN__.model.getLatencySnapshot());
const paperUploads = await page.evaluate(() => window.__MERIDIAN__.model.paperRenderer.getUploadStats());
if (latency.startMs.p95 > 50 || latency.impactMs.p95 > 125 || latency.peakQueueDepth > 4) {
  throw new Error(`Typing latency regression: ${JSON.stringify(latency)}`);
}
if (!paperUploads.partialUploads || paperUploads.partialBytes >= paperUploads.fullTextureBytes * 0.2) {
  throw new Error(`Paper texture upload regression: ${JSON.stringify(paperUploads)}`);
}

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

await openDocumentTray(page);
const expectedExport = await page.evaluate(() => ({
  text: window.__MERIDIAN__.document.toPlainText(),
  sheetNumber: window.__MERIDIAN__.document.sheetNumber,
  pngDataUrl: window.__MERIDIAN__.model.paperRenderer.canvas.toDataURL('image/png'),
}));

const textDownloadPromise = page.waitForEvent('download');
await page.click('#download-text');
const textDownload = await textDownloadPromise;
const textDownloadPath = await textDownload.path();
if (!textDownloadPath) throw new Error('TXT download did not produce a readable file.');
const downloadedText = await readFile(textDownloadPath, 'utf8');

const pngDownloadPromise = page.waitForEvent('download');
await page.click('#download-paper');
const pngDownload = await pngDownloadPromise;
const pngDownloadPath = await pngDownload.path();
if (!pngDownloadPath) throw new Error('PNG download did not produce a readable file.');
const downloadedPng = await readFile(pngDownloadPath);
const expectedPng = Buffer.from(expectedExport.pngDataUrl.split(',')[1], 'base64');
const pngSignature = downloadedPng.subarray(0, 8).toString('hex');
const pngWidth = downloadedPng.readUInt32BE(16);
const pngHeight = downloadedPng.readUInt32BE(20);
const exportState = {
  textFilename: textDownload.suggestedFilename(),
  text: downloadedText,
  pngFilename: pngDownload.suggestedFilename(),
  pngBytes: downloadedPng.byteLength,
  pngSignature,
  pngWidth,
  pngHeight,
  pngMatchesCanvas: downloadedPng.equals(expectedPng),
};
const expectedStem = `meridian-sheet-${String(expectedExport.sheetNumber).padStart(2, '0')}`;
if (
  exportState.textFilename !== `${expectedStem}.txt`
  || exportState.text !== expectedExport.text
  || exportState.pngFilename !== `${expectedStem}.png`
  || exportState.pngSignature !== '89504e470d0a1a0a'
  || exportState.pngWidth !== 1280
  || exportState.pngHeight !== 1656
  || exportState.pngBytes < 10000
  || !exportState.pngMatchesCanvas
) {
  throw new Error(`Export mismatch: ${JSON.stringify(exportState)}`);
}

await page.waitForFunction(() => !window.__MERIDIAN__.model.busy, null, { timeout: 10000 });
await openDocumentTray(page);
await page.click('#release-sheet');
await page.waitForFunction(() => window.__MERIDIAN__.paperState.looseSheet && window.__MERIDIAN__.paperView.phase === 'inspecting', null, { timeout: 15000 });
await page.click('#keep-sheet');
await page.waitForFunction(() => window.__MERIDIAN__.paperState.manuscript.length === 1 && window.__MERIDIAN__.paperView.phase === 'idle', null, { timeout: 15000 });

// A kept page must restore the ribbon selector, modeled mechanism, and
// checkpoint metadata to the archived ink mode before overtyping resumes.
await page.click('#restore-manuscript');
await page.waitForFunction(
  () => window.__MERIDIAN__.paperState.looseSheet && window.__MERIDIAN__.paperView.phase === 'inspecting',
  null,
  { timeout: 15000 },
);
const restoredInkState = await page.evaluate(() => ({
  modelInk: window.__MERIDIAN__.model.inkMode,
  activeInk: document.querySelector('.ink-button.active')?.dataset.ink,
  archivedInk: window.__MERIDIAN__.paperState.looseSheet?.page.metadata?.inkMode,
}));
if (restoredInkState.modelInk !== 'red' || restoredInkState.activeInk !== 'red' || restoredInkState.archivedInk !== 'red') {
  throw new Error(`Restored ink selector mismatch: ${JSON.stringify(restoredInkState)}`);
}
await page.click('#reinsert-sheet');
await page.waitForFunction(
  () => window.__MERIDIAN__.paperState.insertedSheet?.sheetNumber === 1 && window.__MERIDIAN__.paperView.phase === 'idle',
  null,
  { timeout: 15000 },
);
await page.click('#release-sheet');
await page.waitForFunction(() => window.__MERIDIAN__.paperView.phase === 'inspecting', null, { timeout: 15000 });
await page.click('#keep-sheet');
await page.waitForFunction(() => window.__MERIDIAN__.paperState.manuscript.length === 1 && window.__MERIDIAN__.paperView.phase === 'idle', null, { timeout: 15000 });

await page.click('#load-sheet');
await page.waitForFunction(() => window.__MERIDIAN__.paperState.insertedSheet?.sheetNumber === 2 && window.__MERIDIAN__.paperView.phase === 'idle', null, { timeout: 15000 });
const newSheetState = await page.evaluate(() => ({
  sheetNumber: window.__MERIDIAN__.document.sheetNumber,
  marks: window.__MERIDIAN__.document.marks.length,
  focused: document.activeElement?.id,
  manuscript: window.__MERIDIAN__.paperState.manuscript.length,
}));
if (newSheetState.sheetNumber !== 2 || newSheetState.marks !== 0 || newSheetState.focused !== 'scene' || newSheetState.manuscript !== 1) {
  throw new Error(`New-sheet mismatch: ${JSON.stringify(newSheetState)}`);
}

await page.keyboard.type('recover me', { delay: 12 });
await page.waitForFunction(() => !window.__MERIDIAN__.model.busy);
await page.click('#release-sheet');
await page.waitForFunction(() => window.__MERIDIAN__.paperView.phase === 'inspecting', null, { timeout: 15000 });
const crumpleBox = await page.locator('#crumple-sheet').boundingBox();
await page.mouse.move(crumpleBox.x + crumpleBox.width / 2, crumpleBox.y + crumpleBox.height / 2);
await page.mouse.down();
await page.waitForTimeout(1020);
await page.mouse.up();
await page.waitForFunction(() => window.__MERIDIAN__.paperState.discards.length === 1 && window.__MERIDIAN__.paperView.phase === 'idle', null, { timeout: 20000 });
await page.click('#recover-sheet');
await page.waitForFunction(() => window.__MERIDIAN__.paperState.looseSheet && window.__MERIDIAN__.paperView.phase === 'inspecting', null, { timeout: 15000 });
await page.click('#reinsert-sheet');
await page.waitForFunction(() => window.__MERIDIAN__.paperState.insertedSheet?.sheetNumber === 2 && window.__MERIDIAN__.paperView.phase === 'idle', null, { timeout: 15000 });
const recoveredText = await page.evaluate(() => window.__MERIDIAN__.document.toPlainText());
if (recoveredText !== 'recover me') throw new Error(`Recovered paper mismatch: ${JSON.stringify(recoveredText)}`);

await page.selectOption('#weather-select', 'rain');
await page.waitForFunction(() => window.__MERIDIAN__.room.getState().weather === 'rain');
await page.selectOption('#weather-select', 'snow');
await page.waitForFunction(() => window.__MERIDIAN__.room.getState().weather === 'snow');
await page.waitForTimeout(700);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => Boolean(window.__MERIDIAN__));
const restored = await page.evaluate(() => ({
  text: window.__MERIDIAN__.document.toPlainText(),
  sheet: window.__MERIDIAN__.paperState.insertedSheet?.sheetNumber,
  manuscript: window.__MERIDIAN__.paperState.manuscript.length,
  weather: window.__MERIDIAN__.room.getState().weather,
}));
if (restored.text !== 'recover me' || restored.sheet !== 2 || restored.manuscript !== 1 || restored.weather !== 'snow') {
  throw new Error(`Persistence mismatch: ${JSON.stringify(restored)}`);
}
if (errors.length) throw new Error(`Console errors: ${errors.join(' | ')}`);

const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await mobileContext.addInitScript(deterministicRandom);
const mobilePage = await mobileContext.newPage();
const mobileErrors = collectErrors(mobilePage);
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

const reloadContext = await browser.newContext({ viewport: { width: 960, height: 640 } });
await reloadContext.addInitScript(deterministicRandom);
const reloadPage = await reloadContext.newPage();
const reloadErrors = collectErrors(reloadPage);
let paperReloadRecovery;
try {
  await waitForSimulator(reloadPage);
  await reloadPage.click('#enter-studio');
  await reloadPage.keyboard.type('reloadproof', { delay: 8 });
  await reloadPage.waitForFunction(() => !window.__MERIDIAN__.model.busy);
  await openDocumentTray(reloadPage);
  await reloadPage.click('#release-sheet');
  await reloadPage.waitForFunction(
    () => Boolean(window.__MERIDIAN__.paperState.looseSheet)
      && window.__MERIDIAN__.paperView.phase === 'extracting',
    null,
    { timeout: 5_000 },
  );
  const extractionInterrupted = await reloadPage.evaluate(() => ({
    phase: window.__MERIDIAN__.paperView.phase,
    inserted: Boolean(window.__MERIDIAN__.paperState.insertedSheet),
    loose: Boolean(window.__MERIDIAN__.paperState.looseSheet),
    text: window.__MERIDIAN__.document.toPlainText(),
  }));

  await reloadPage.reload({ waitUntil: 'networkidle' });
  await reloadPage.waitForFunction(() => Boolean(window.__MERIDIAN__));
  const extractionRecovered = await reloadPage.evaluate(() => ({
    phase: window.__MERIDIAN__.paperView.phase,
    inserted: Boolean(window.__MERIDIAN__.paperState.insertedSheet),
    loose: Boolean(window.__MERIDIAN__.paperState.looseSheet),
    activePage: Boolean(window.__MERIDIAN__.paperView.activePage),
    machinePaperVisible: window.__MERIDIAN__.model.paperMesh.visible,
    text: window.__MERIDIAN__.document.toPlainText(),
  }));
  if (
    extractionInterrupted.phase !== 'extracting'
    || extractionInterrupted.inserted
    || !extractionInterrupted.loose
    || extractionInterrupted.text !== 'reloadproof'
    || extractionRecovered.phase !== 'inspecting'
    || extractionRecovered.inserted
    || !extractionRecovered.loose
    || !extractionRecovered.activePage
    || extractionRecovered.machinePaperVisible
    || extractionRecovered.text !== 'reloadproof'
  ) {
    throw new Error(`Extraction reload recovery mismatch: ${JSON.stringify({ extractionInterrupted, extractionRecovered })}`);
  }

  await reloadPage.click('#enter-studio');
  await openDocumentTray(reloadPage);
  await reloadPage.click('#keep-sheet');
  await reloadPage.waitForFunction(
    () => window.__MERIDIAN__.paperState.manuscript.length === 1
      && window.__MERIDIAN__.paperView.phase === 'filing',
    null,
    { timeout: 5_000 },
  );
  const filingInterrupted = await reloadPage.evaluate(() => ({
    phase: window.__MERIDIAN__.paperView.phase,
    loose: Boolean(window.__MERIDIAN__.paperState.looseSheet),
    manuscript: window.__MERIDIAN__.paperState.manuscript.length,
  }));

  await reloadPage.reload({ waitUntil: 'networkidle' });
  await reloadPage.waitForFunction(() => Boolean(window.__MERIDIAN__));
  const filingRecovered = await reloadPage.evaluate(() => {
    const state = window.__MERIDIAN__.paperState;
    return {
      phase: window.__MERIDIAN__.paperView.phase,
      inserted: Boolean(state.insertedSheet),
      loose: Boolean(state.looseSheet),
      manuscript: state.manuscript.length,
      manuscriptCharacters: state.manuscript[0]?.page?.content?.marks
        ?.map(({ character }) => character)
        .join(''),
      manuscriptTopVisible: Boolean(window.__MERIDIAN__.paperView.manuscriptTopMesh?.visible),
      visibleStackLayers: window.__MERIDIAN__.paperView.stackLayers.count,
    };
  });
  if (
    filingInterrupted.phase !== 'filing'
    || filingInterrupted.loose
    || filingInterrupted.manuscript !== 1
    || filingRecovered.phase !== 'idle'
    || filingRecovered.inserted
    || filingRecovered.loose
    || filingRecovered.manuscript !== 1
    || filingRecovered.manuscriptCharacters !== 'reloadproof'
    || !filingRecovered.manuscriptTopVisible
    || filingRecovered.visibleStackLayers < 1
    || reloadErrors.length
  ) {
    throw new Error(`Filing reload recovery mismatch: ${JSON.stringify({ filingInterrupted, filingRecovered, reloadErrors })}`);
  }
  paperReloadRecovery = {
    extractionInterrupted,
    extractionRecovered,
    filingInterrupted,
    filingRecovered,
  };
} finally {
  await reloadContext.close();
}

const storageFailureContext = await browser.newContext({ viewport: { width: 960, height: 640 } });
await storageFailureContext.addInitScript(deterministicRandom);
const storageFailurePage = await storageFailureContext.newPage();
const storageFailureErrors = collectErrors(storageFailurePage);
let storageFailureState;
try {
  await waitForSimulator(storageFailurePage);
  await storageFailurePage.click('#enter-studio');
  await storageFailurePage.evaluate(() => {
    const originalSetItem = Storage.prototype.setItem;
    window.__MERIDIAN_RESTORE_STORAGE__ = () => { Storage.prototype.setItem = originalSetItem; };
    Storage.prototype.setItem = () => { throw new DOMException('Quota exhausted by test', 'QuotaExceededError'); };
  });
  await storageFailurePage.keyboard.type('z');
  await storageFailurePage.waitForFunction(
    () => document.getElementById('archive-warning')?.textContent.includes('LOCAL ARCHIVE IS FULL'),
    null,
    { timeout: 5000 },
  );
  storageFailureState = await storageFailurePage.evaluate(() => ({
    warning: document.getElementById('archive-warning')?.textContent,
    warningVisible: !document.getElementById('archive-warning')?.hidden,
    text: window.__MERIDIAN__.document.toPlainText(),
    inserted: Boolean(window.__MERIDIAN__.lifecycle.getOverview().insertedSheet),
  }));
  if (
    !storageFailureState.warningVisible
    || !storageFailureState.warning.includes('EXPORT THIS SHEET')
    || storageFailureState.text !== 'z'
    || !storageFailureState.inserted
    || storageFailureErrors.length
  ) {
    throw new Error(`Storage failure warning mismatch: ${JSON.stringify({ storageFailureState, storageFailureErrors })}`);
  }
} finally {
  await storageFailurePage.evaluate(() => window.__MERIDIAN_RESTORE_STORAGE__?.()).catch(() => {});
  await storageFailureContext.close();
}

const qualitySmoke = [];
for (const [label, quality, expectedQuality] of [
  ['default', null, 'medium'],
  ['high', 'high', 'high'],
]) {
  const context = await browser.newContext({ viewport: { width: 960, height: 640 } });
  await context.addInitScript(deterministicRandom);
  const qualityPage = await context.newPage();
  const qualityErrors = collectErrors(qualityPage);
  try {
    const qualityUrl = withQuality(targetUrl, quality);
    await qualityPage.goto(qualityUrl, { waitUntil: 'networkidle' });
    await qualityPage.waitForFunction(() => Boolean(window.__MERIDIAN__), null, { timeout: 60000 });
    await qualityPage.click('#enter-studio');
    await qualityPage.keyboard.type('q');
    await qualityPage.waitForFunction(() => !window.__MERIDIAN__.model.busy);
    const qualityState = await qualityPage.evaluate(() => ({
      text: window.__MERIDIAN__.document.toPlainText(),
      ...window.__MERIDIAN__.room.getState(),
      backdropVisible: window.__MERIDIAN__.room.backdropMesh.visible,
      detailedRoomVisible: window.__MERIDIAN__.room.environment.visible,
    }));
    const expectedBackdrop = expectedQuality !== 'high';
    if (
      qualityState.text !== 'q'
      || qualityState.quality !== expectedQuality
      || qualityState.effectiveQuality !== expectedQuality
      || qualityState.backdropVisible !== expectedBackdrop
      || qualityState.detailedRoomVisible === expectedBackdrop
      || qualityErrors.length
    ) {
      throw new Error(`${label} quality smoke mismatch: ${JSON.stringify({ qualityState, qualityErrors })}`);
    }
    qualitySmoke.push({ label, url: qualityUrl, ...qualityState });
  } finally {
    await context.close();
  }
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  averageFrameMs,
  approximateFps: Math.round(1000 / averageFrameMs),
  latency,
  paperUploads,
  shiftState,
  geometryClearance,
  keyCorrespondence,
  paperAudioState,
  tabBackspaceState,
  reducedMotionState,
  exportState,
  restoredInkState,
  state,
  newSheetState,
  mobileText,
  paperReloadRecovery,
  storageFailureState,
  qualitySmoke,
}, null, 2)}\n`);
} finally {
  await browser?.close().catch(() => {});
  await preview.close();
}
