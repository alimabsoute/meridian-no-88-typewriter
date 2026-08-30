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
// Real browser delivery at 500 WPM complements the deterministic 12 ms
// (1,000 WPM) mechanics-kernel stress in typewriter-model.test.js.
const BROWSER_BURST_DELAY_MS = 24;
const BROWSER_BURST_TEXT = 'The quick brown fox jumps over 13 lazy dogs!';
const BROWSER_IMPACT_CEILING_MS = 125;
const ISOLATED_RENDER_SIZE = Object.freeze({ width: 160, height: 120 });

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

async function pressAndCaptureKeyPeak(page, {
  key,
  code,
  otherCodes = [],
  threshold = 0.18,
  maxSteps = 96,
}) {
  await page.evaluate(() => {
    const model = window.__OCTOBERLINE_211__.model;
    if (window.__OCTOBERLINE_211_KEY_FREEZE__) throw new Error('A keyboard capture is already active');
    const keyboardBusy = model.activeStrikes.length > 0
      || model.commandQueue.length > 0
      || Boolean(model.returning)
      || Boolean(model.tabMotion)
      || Boolean(model.paperLoading);
    if (keyboardBusy) throw new Error('Keyboard capture started while mechanics were active');

    // This test measures host-key correspondence from a clean mechanical instant.
    // Scheduler ordering and burst latency are exercised independently below.
    model.nextMechanicalImpactAt = model.strikeTimelineSeconds;
    window.__OCTOBERLINE_211_KEY_FREEZE__ = {
      hadOwnUpdate: Object.prototype.hasOwnProperty.call(model, 'update'),
      originalUpdate: model.update,
    };
    model.update = () => {};
  });
  try {
    await page.keyboard.press(key);
    return await page.evaluate(({
      targetCode,
      comparisonCodes,
      targetThreshold,
      steps,
    }) => {
      const model = window.__OCTOBERLINE_211__.model;
      const update = window.__OCTOBERLINE_211_KEY_FREEZE__?.originalUpdate;
      if (typeof update !== 'function') throw new Error('Keyboard capture lost the model update function');
      const sample = {
        target: 0,
        others: Object.fromEntries(comparisonCodes.map((comparisonCode) => [comparisonCode, 0])),
        modeledName: model.keys.get(targetCode)?.group?.name,
        done: false,
      };
      for (let step = 0; step < steps; step += 1) {
        update.call(model, 1 / 120);
        sample.target = Math.max(sample.target, model.keys.get(targetCode)?.depression ?? 0);
        for (const comparisonCode of comparisonCodes) {
          sample.others[comparisonCode] = Math.max(
            sample.others[comparisonCode],
            model.keys.get(comparisonCode)?.depression ?? 0,
          );
        }
        if (sample.target > targetThreshold) {
          sample.done = true;
          break;
        }
      }
      if (!sample.done) {
        throw new Error(`Key ${targetCode} did not reach its modeled peak: ${JSON.stringify(sample)}`);
      }
      return sample;
    }, {
      targetCode: code,
      comparisonCodes: otherCodes,
      targetThreshold: threshold,
      steps: maxSteps,
    });
  } finally {
    await page.evaluate(() => {
      const model = window.__OCTOBERLINE_211__?.model;
      const capture = window.__OCTOBERLINE_211_KEY_FREEZE__;
      if (!model || !capture) return;
      if (capture.hadOwnUpdate) model.update = capture.originalUpdate;
      else delete model.update;
      delete window.__OCTOBERLINE_211_KEY_FREEZE__;
    }).catch(() => {});
  }
}

async function settleKeyboardModel(page, codes, maxSteps = 128) {
  const state = await page.evaluate(({ keyCodes, steps }) => {
    const model = window.__OCTOBERLINE_211__.model;
    for (let step = 0; step < steps; step += 1) {
      const resting = keyCodes.every(
        (code) => (model.keys.get(code)?.depression ?? 1) < 0.02,
      );
      const keyboardIdle = !model.returning
        && !model.tabMotion
        && model.activeStrikes.length === 0
        && model.commandQueue.length === 0;
      if (keyboardIdle && resting) return { settled: true, step };
      model.update(0.04);
    }
    return {
      settled: false,
      busy: model.busy,
      activeStrikes: model.activeStrikes.map((command) => ({
        type: command.type,
        code: command.code,
        phase: command.phase,
        duration: command.duration,
        elapsed: command.elapsed,
        mechanicalDelay: command.mechanicalDelay,
        mechanicalImpactAt: command.mechanicalImpactAt,
      })),
      queue: model.commandQueue.map((command) => ({ type: command.type, code: command.code })),
      returning: Boolean(model.returning),
      tabMotion: Boolean(model.tabMotion),
      paperLoading: Boolean(model.paperLoading),
      strikeTimelineSeconds: model.strikeTimelineSeconds,
      nextMechanicalImpactAt: model.nextMechanicalImpactAt,
      depressions: Object.fromEntries(
        keyCodes.map((code) => [code, model.keys.get(code)?.depression ?? null]),
      ),
    };
  }, { keyCodes: codes, steps: maxSteps });

  if (!state.settled) {
    throw new Error(`Keyboard model did not settle: ${JSON.stringify(state)}`);
  }
}

async function advancePaperMotions(page, { rounds = 4, stepsPerRound = 24 } = {}) {
  let state;
  for (let round = 0; round < rounds; round += 1) {
    state = await page.evaluate((steps) => {
      const { paperView } = window.__OCTOBERLINE_211__;
      for (let step = 0; step < steps; step += 1) paperView.update(0.05);
      return { phase: paperView.phase, activeMotion: Boolean(paperView.motion) };
    }, stepsPerRound);
    // Paper actions chain through async UI handlers; allow each continuation to
    // enqueue its next motion between deterministic simulation batches.
    await page.waitForTimeout(0);
  }
  return state;
}

async function waitForSimulator(page) {
  await page.goto(targetUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__OCTOBERLINE_211__), null, { timeout: 60000 });
}

async function openDocumentTray(page) {
  if (await page.locator('#document-toggle').getAttribute('aria-expanded') !== 'true') {
    await page.click('#document-toggle');
  }
  await page.waitForFunction(() => document.querySelector('#document-toggle')?.getAttribute('aria-expanded') === 'true');
}

async function openEnvironmentPanel(page) {
  if (!(await page.locator('.environment-card').evaluate((element) => element.open))) {
    await page.click('.environment-summary');
  }
  await page.waitForFunction(() => document.querySelector('.environment-card')?.open);
}

let browser;
try {
browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
await page.addInitScript(deterministicRandom);
const errors = collectErrors(page);
await page.goto(targetUrl, { waitUntil: 'networkidle' });
try {
  await page.waitForFunction(() => Boolean(window.__OCTOBERLINE_211__), null, { timeout: 60000 });
} catch (error) {
  throw new Error(`Simulator did not initialize: ${errors.join(' | ') || error.message}`);
}
await page.click('#enter-studio');

const paperAudioState = await page.evaluate(() => {
  const control = document.getElementById('paper-volume');
  const machineBefore = window.__OCTOBERLINE_211__.audio.volume;
  control.value = '0.17';
  control.dispatchEvent(new Event('input', { bubbles: true }));
  return {
    controlValue: Number(control.value),
    paperVolume: window.__OCTOBERLINE_211__.audio.paperVolume,
    machineBefore,
    machineAfter: window.__OCTOBERLINE_211__.audio.volume,
  };
});
if (
  Math.abs(paperAudioState.controlValue - 0.17) > 0.001
  || Math.abs(paperAudioState.paperVolume - 0.17) > 0.001
  || paperAudioState.machineAfter !== paperAudioState.machineBefore
) {
  throw new Error(`Paper audio channel mismatch: ${JSON.stringify(paperAudioState)}`);
}

await openEnvironmentPanel(page);
const controlReadability = await page.evaluate(() => {
  const weather = document.querySelector('#weather-select');
  const viewLabel = document.querySelector('[data-view="front"] b');
  return {
    weatherFontSize: Number.parseFloat(getComputedStyle(weather).fontSize),
    weatherHeight: weather.getBoundingClientRect().height,
    viewFontSize: Number.parseFloat(getComputedStyle(viewLabel).fontSize),
  };
});
await page.click('#guide-open');
await page.waitForFunction(() => document.querySelector('#field-guide')?.open);
const readabilityState = await page.evaluate((controls) => ({
  ...controls,
  guideBodyFontSize: Number.parseFloat(getComputedStyle(document.querySelector('.manual-grid p')).fontSize),
  environmentClosedUnderGuide: !document.querySelector('.environment-card')?.open,
}), controlReadability);
await page.mouse.click(5, 5);
await page.waitForFunction(() => !document.querySelector('#field-guide')?.open);
await page.waitForFunction(() => document.activeElement?.id === 'scene');

await openDocumentTray(page);
await page.keyboard.press('Escape');
await page.waitForFunction(() => document.querySelector('#document-toggle')?.getAttribute('aria-expanded') === 'false');

await openEnvironmentPanel(page);
await page.click('.audio-mix summary');
await page.waitForFunction(() => document.querySelector('.audio-mix')?.open);
await page.click('[data-view="front"]');
await page.waitForFunction(() => !document.querySelector('.audio-mix')?.open);

await page.click('#inspection-toggle');
await page.waitForFunction(() => window.__OCTOBERLINE_211__.model.inspectionTarget === 1);
await openDocumentTray(page);
await page.click('[data-view="front"]');
await page.waitForFunction(() => document.querySelector('#document-toggle')?.getAttribute('aria-expanded') === 'false');
await page.waitForFunction(() => window.__OCTOBERLINE_211__.model.inspectionTarget === 0);
await page.evaluate(() => window.__OCTOBERLINE_211__.setView('front', 0));
await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
const modalUiState = await page.evaluate((readability) => ({
  readability,
  guideOpen: document.querySelector('#field-guide')?.open,
  trayExpanded: document.querySelector('#document-toggle')?.getAttribute('aria-expanded'),
  environmentOpen: document.querySelector('.environment-card')?.open,
  audioMixOpen: document.querySelector('.audio-mix')?.open,
  activeView: document.querySelector('.view-button.active')?.dataset.view,
  activeViewPressed: document.querySelector('[data-view="front"]')?.getAttribute('aria-pressed'),
  cameraPosition: window.__OCTOBERLINE_211__.camera.position.toArray(),
  inspectionPressed: document.querySelector('#inspection-toggle')?.getAttribute('aria-pressed'),
  inspectionTarget: window.__OCTOBERLINE_211__.model.inspectionTarget,
  keyboardCaptured: window.__OCTOBERLINE_211__.keyboardCaptured,
  introInert: document.querySelector('#intro-overlay')?.inert,
  focused: document.activeElement?.id,
}), readabilityState);
if (
  modalUiState.guideOpen
  || modalUiState.trayExpanded !== 'false'
  || modalUiState.environmentOpen
  || modalUiState.audioMixOpen
  || modalUiState.activeView !== 'front'
  || modalUiState.activeViewPressed !== 'true'
  || Math.abs(modalUiState.cameraPosition[0]) > 0.01
  || modalUiState.cameraPosition[2] < 15
  || modalUiState.inspectionPressed !== 'false'
  || modalUiState.inspectionTarget !== 0
  || !modalUiState.keyboardCaptured
  || !modalUiState.introInert
  || modalUiState.focused !== 'scene'
  || modalUiState.readability.weatherFontSize < 12
  || modalUiState.readability.weatherHeight < 38
  || modalUiState.readability.viewFontSize < 10
  || modalUiState.readability.guideBodyFontSize < 14
  || !modalUiState.readability.environmentClosedUnderGuide
) {
  throw new Error(`Modal, camera, or readability regression: ${JSON.stringify(modalUiState)}`);
}
await page.evaluate(() => window.__OCTOBERLINE_211__.setView('writer', 0));
await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));

const shiftPeak = await pressAndCaptureKeyPeak(page, {
  key: 'ShiftRight',
  code: 'ShiftRight',
  otherCodes: ['ShiftLeft'],
  threshold: 0.35,
});
const shiftState = { left: shiftPeak.others.ShiftLeft, right: shiftPeak.target };
await settleKeyboardModel(page, ['ShiftLeft', 'ShiftRight']);
if (shiftState.right <= 0.35 || shiftState.left >= 0.2) throw new Error(`Shift-side mismatch: ${JSON.stringify(shiftState)}`);

const geometryClearance = await page.evaluate(() => {
  const shell = window.__OCTOBERLINE_211__.model.getKeyShellClearanceSnapshot();
  const neighbors = window.__OCTOBERLINE_211__.model.getKeyNeighborClearanceSnapshot();
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
  await keyboardPage.waitForFunction(() => !window.__OCTOBERLINE_211__.model.busy);

  for (const representative of rowRepresentatives) {
    await keyboardPage.waitForFunction(
      (codes) => codes.every((code) => (window.__OCTOBERLINE_211__.model.keys.get(code)?.depression ?? 1) < 0.02),
      representativeCodes,
    );
    const peak = await pressAndCaptureKeyPeak(keyboardPage, {
      key: representative.key,
      code: representative.code,
      otherCodes: representativeCodes.filter((code) => code !== representative.code),
    });

    await settleKeyboardModel(keyboardPage, representativeCodes);
    expectedKeyboardText += representative.character;
    const settled = await keyboardPage.evaluate(() => ({
      text: window.__OCTOBERLINE_211__.document.toPlainText(),
      lastMark: window.__OCTOBERLINE_211__.document.marks.at(-1),
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

  const marksBeforeTab = await keyboardPage.evaluate(() => window.__OCTOBERLINE_211__.document.marks.length);
  const tabPeak = (await pressAndCaptureKeyPeak(keyboardPage, { key: 'Tab', code: 'Tab' })).target;
  await settleKeyboardModel(keyboardPage, ['Tab']);
  const afterTab = await keyboardPage.evaluate(() => ({
    column: window.__OCTOBERLINE_211__.document.column,
    marks: window.__OCTOBERLINE_211__.document.marks.length,
  }));

  const backspacePeak = (await pressAndCaptureKeyPeak(keyboardPage, { key: 'Backspace', code: 'Backspace' })).target;
  await settleKeyboardModel(keyboardPage, ['Backspace']);
  const afterBackspace = await keyboardPage.evaluate(() => ({
    column: window.__OCTOBERLINE_211__.document.column,
    marks: window.__OCTOBERLINE_211__.document.marks.length,
  }));

  const recoveryPeak = (await pressAndCaptureKeyPeak(keyboardPage, {
    key: 'x',
    code: 'KeyX',
  })).target;
  await settleKeyboardModel(keyboardPage, ['KeyX']);
  const afterRecoveryType = await keyboardPage.evaluate(() => ({
    column: window.__OCTOBERLINE_211__.document.column,
    text: window.__OCTOBERLINE_211__.document.toPlainText(),
    lastMark: window.__OCTOBERLINE_211__.document.marks.at(-1),
    tabDepression: window.__OCTOBERLINE_211__.model.keys.get('Tab')?.depression ?? 1,
    backspaceDepression: window.__OCTOBERLINE_211__.model.keys.get('Backspace')?.depression ?? 1,
  }));
  tabBackspaceState = {
    marksBeforeTab,
    tabPeak,
    backspacePeak,
    recoveryPeak,
    afterTab,
    afterBackspace,
    afterRecoveryType,
  };
  if (
    tabPeak <= 0.18
    || backspacePeak <= 0.18
    || recoveryPeak <= 0.18
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
      && window.__OCTOBERLINE_211__.room.getState().reducedMotion,
  );
  await reducedPage.hover('#enter-studio');
  await reducedPage.waitForTimeout(120);
  const initialReduced = await reducedPage.evaluate(() => {
    const duration = getComputedStyle(document.querySelector('#intro-overlay')).transitionDuration.split(',')[0].trim();
    const transitionMilliseconds = duration.endsWith('ms') ? Number.parseFloat(duration) : Number.parseFloat(duration) * 1000;
    return {
      mediaMatches: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      roomReduced: window.__OCTOBERLINE_211__.room.getState().reducedMotion,
      snowCount: window.__OCTOBERLINE_211__.room.activeSnowCount,
      updateStride: window.__OCTOBERLINE_211__.room.updateStride,
      transitionMilliseconds,
      previewDepression: window.__OCTOBERLINE_211__.model.keys.get('KeyO')?.depression ?? 0,
    };
  });

  await reducedPage.click('#enter-studio');
  await reducedPage.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  const reducedEntry = await reducedPage.evaluate(() => ({
    position: window.__OCTOBERLINE_211__.camera.position.toArray(),
    target: window.__OCTOBERLINE_211__.controls.target.toArray(),
    fov: window.__OCTOBERLINE_211__.camera.fov,
    activeView: document.querySelector('.view-button.active')?.dataset.view,
    overlayHidden: document.querySelector('#intro-overlay')?.getAttribute('aria-hidden'),
  }));

  await reducedPage.emulateMedia({ reducedMotion: 'no-preference' });
  await reducedPage.waitForFunction(
    () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches
      && !window.__OCTOBERLINE_211__.room.getState().reducedMotion,
  );
  const normalMotion = await reducedPage.evaluate(() => ({
    mediaMatches: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    roomReduced: window.__OCTOBERLINE_211__.room.getState().reducedMotion,
    snowCount: window.__OCTOBERLINE_211__.room.activeSnowCount,
    updateStride: window.__OCTOBERLINE_211__.room.updateStride,
  }));

  await reducedPage.emulateMedia({ reducedMotion: 'reduce' });
  await reducedPage.waitForFunction(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
      && window.__OCTOBERLINE_211__.room.getState().reducedMotion,
  );
  const restoredReduced = await reducedPage.evaluate(() => ({
    mediaMatches: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    roomReduced: window.__OCTOBERLINE_211__.room.getState().reducedMotion,
    snowCount: window.__OCTOBERLINE_211__.room.activeSnowCount,
    uneaseSignal: window.__OCTOBERLINE_211__.room.getState().uneaseSignal,
  }));
  reducedMotionState = { initialReduced, reducedEntry, normalMotion, restoredReduced };
  if (
    !initialReduced.mediaMatches
    || !initialReduced.roomReduced
    || initialReduced.transitionMilliseconds > 180
    || initialReduced.previewDepression !== 0
    || Math.abs(reducedEntry.position[0]) > 0.02
    || Math.abs(reducedEntry.position[1] - 5.45) > 0.02
    || Math.abs(reducedEntry.position[2] - 15.1) > 0.02
    || Math.abs(reducedEntry.target[0]) > 0.02
    || Math.abs(reducedEntry.target[1] - 1.35) > 0.02
    || Math.abs(reducedEntry.target[2] - 0.55) > 0.02
    || Math.abs(reducedEntry.fov - 37) > 0.02
    || reducedEntry.activeView !== 'front'
    || reducedEntry.overlayHidden !== 'true'
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

await page.bringToFront();
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

// GitHub's headless SwiftShader can spend seconds rasterizing this 600-object
// scene. Isolate the real-time mechanics gate from GPU throughput; rendered
// room/machine behavior is exercised by the performance and visual suites.
const fullSceneViewport = page.viewportSize();
if (!fullSceneViewport) throw new Error('The mechanics latency page has no viewport');
await page.setViewportSize(ISOLATED_RENDER_SIZE);
const sceneWasVisible = await page.evaluate(() => {
  const { model } = window.__OCTOBERLINE_211__;
  const visible = model.scene.visible;
  model.scene.visible = false;
  return visible;
});
let latency;
let paperUploadBaseline;
let paperUploads;
let paperUploadDelta;
let burstFrameCadence;
let wallClockMechanicsGate;
try {
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  await page.evaluate(() => {
    const sample = {
      intervals: [],
      lastFrameAt: null,
      running: true,
    };
    window.__OCTOBERLINE_211_BURST_CADENCE__ = sample;
    const recordFrame = (now) => {
      if (!sample.running) return;
      if (sample.lastFrameAt !== null) sample.intervals.push(now - sample.lastFrameAt);
      sample.lastFrameAt = now;
      requestAnimationFrame(recordFrame);
    };
    requestAnimationFrame(recordFrame);
  });
  paperUploadBaseline = await page.evaluate(
    () => window.__OCTOBERLINE_211__.model.paperRenderer.getUploadStats(),
  );
  await page.evaluate(() => window.__OCTOBERLINE_211__.model.resetLatencyMetrics());
  await page.keyboard.type(BROWSER_BURST_TEXT, {
    delay: BROWSER_BURST_DELAY_MS,
  });
  await page.waitForFunction(() => !window.__OCTOBERLINE_211__.model.busy, null, { timeout: 30000 });
  const first = await page.evaluate(() => window.__OCTOBERLINE_211__.document.toPlainText());
  if (first !== BROWSER_BURST_TEXT) {
    throw new Error(`First line mismatch: ${JSON.stringify(first)}`);
  }
  latency = await page.evaluate(() => window.__OCTOBERLINE_211__.model.getLatencySnapshot());
  paperUploads = await page.evaluate(() => window.__OCTOBERLINE_211__.model.paperRenderer.getUploadStats());
  paperUploadDelta = {
    fullUploads: paperUploads.fullUploads - paperUploadBaseline.fullUploads,
    partialUploads: paperUploads.partialUploads - paperUploadBaseline.partialUploads,
    fullBytes: paperUploads.fullBytes - paperUploadBaseline.fullBytes,
    partialBytes: paperUploads.partialBytes - paperUploadBaseline.partialBytes,
    fullTextureBytes: paperUploads.fullTextureBytes,
  };
  burstFrameCadence = await page.evaluate(() => {
    const sample = window.__OCTOBERLINE_211_BURST_CADENCE__;
    if (!sample) throw new Error('Burst cadence sample is missing');
    sample.running = false;
    const sorted = [...sample.intervals].sort((a, b) => a - b);
    const averageMs = sorted.length
      ? sorted.reduce((total, value) => total + value, 0) / sorted.length
      : null;
    const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
    const result = {
      sampleCount: sorted.length,
      averageMs,
      p95Ms: sorted.length ? sorted[p95Index] : null,
      maxMs: sorted.length ? sorted.at(-1) : null,
    };
    delete window.__OCTOBERLINE_211_BURST_CADENCE__;
    return result;
  });
  const cadenceQualified = burstFrameCadence.sampleCount >= 20
    && burstFrameCadence.p95Ms <= 50
    && burstFrameCadence.maxMs <= 100;
  wallClockMechanicsGate = {
    enforced: cadenceQualified,
    minimumFrameSamples: 20,
    frameP95CeilingMs: 50,
    frameMaxCeilingMs: 100,
    startCeilingMs: 50,
    impactCeilingMs: BROWSER_IMPACT_CEILING_MS,
    queuePolicy: 'diagnostic-only',
    reason: cadenceQualified ? 'cadence-qualified' : 'skipped-render-cadence',
  };
  if (
    latency.sampleCount !== BROWSER_BURST_TEXT.length
    || latency.currentQueueDepth !== 0
    || latency.feedbackMs.p95 > 16
    || latency.feedbackMs.max > 50
    || (
      wallClockMechanicsGate.enforced
      && (
        latency.startMs.p95 > wallClockMechanicsGate.startCeilingMs
        || latency.impactMs.p95 > wallClockMechanicsGate.impactCeilingMs
      )
    )
  ) {
    throw new Error(`Typing latency regression: ${JSON.stringify({
      averageFrameMs,
      browserBurstDelayMs: BROWSER_BURST_DELAY_MS,
      burstFrameCadence,
      wallClockMechanicsGate,
      latency,
    })}`);
  }
  if (
    paperUploadDelta.partialUploads !== 36
    || paperUploadDelta.partialBytes >= paperUploadDelta.fullTextureBytes * 0.2
  ) {
    throw new Error(`Paper texture upload regression: ${JSON.stringify({
      paperUploadBaseline,
      paperUploads,
      paperUploadDelta,
    })}`);
  }
} finally {
  await page.evaluate(() => {
    const sample = window.__OCTOBERLINE_211_BURST_CADENCE__;
    if (sample) sample.running = false;
    delete window.__OCTOBERLINE_211_BURST_CADENCE__;
  });
  await page.setViewportSize(fullSceneViewport);
  await page.evaluate((visible) => {
    window.__OCTOBERLINE_211__.model.scene.visible = visible;
  }, sceneWasVisible);
}

await page.keyboard.press('Enter');
await settleKeyboardModel(page, []);
await page.click('[data-ink="red"]');
await page.waitForFunction(() => document.activeElement?.id === 'scene');
await page.keyboard.type('Red ribbon test?', { delay: 12 });
await settleKeyboardModel(page, []);
await page.keyboard.press('Backspace');
await settleKeyboardModel(page, []);
await page.keyboard.type('!');
await settleKeyboardModel(page, []);
const state = await page.evaluate(() => ({
  text: window.__OCTOBERLINE_211__.document.toPlainText(),
  column: window.__OCTOBERLINE_211__.document.column,
  line: window.__OCTOBERLINE_211__.document.line,
  marks: window.__OCTOBERLINE_211__.document.marks.length,
  redMarks: window.__OCTOBERLINE_211__.document.marks.filter((mark) => mark.ink === 'red').length,
  marginBellDistance: window.__OCTOBERLINE_211__.document.bellDistance,
}));
if (
  !state.text.includes('Red ribbon test!')
  || state.redMarks !== 15
  || state.line !== 1
  || state.column !== 16
) {
  throw new Error(`Final state mismatch: ${JSON.stringify(state)}`);
}

await openDocumentTray(page);
const expectedExport = await page.evaluate(() => ({
  text: window.__OCTOBERLINE_211__.document.toPlainText(),
  sheetNumber: window.__OCTOBERLINE_211__.document.sheetNumber,
  pngDataUrl: window.__OCTOBERLINE_211__.model.paperRenderer.canvas.toDataURL('image/png'),
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
const expectedStem = `octoberline-211-sheet-${String(expectedExport.sheetNumber).padStart(2, '0')}`;
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

await settleKeyboardModel(page, []);
await openDocumentTray(page);
await page.click('#release-sheet');
await advancePaperMotions(page);
await page.waitForFunction(() => window.__OCTOBERLINE_211__.paperState.looseSheet && window.__OCTOBERLINE_211__.paperView.phase === 'inspecting', null, { timeout: 15000 });
await page.click('#keep-sheet');
await advancePaperMotions(page);
await page.waitForFunction(() => window.__OCTOBERLINE_211__.paperState.manuscript.length === 1 && window.__OCTOBERLINE_211__.paperView.phase === 'idle', null, { timeout: 15000 });

// A kept page must restore the ribbon selector, modeled mechanism, and
// checkpoint metadata to the archived ink mode before overtyping resumes.
await page.click('#restore-manuscript');
await advancePaperMotions(page);
await page.waitForFunction(
  () => window.__OCTOBERLINE_211__.paperState.looseSheet && window.__OCTOBERLINE_211__.paperView.phase === 'inspecting',
  null,
  { timeout: 15000 },
);
const restoredInkState = await page.evaluate(() => ({
  modelInk: window.__OCTOBERLINE_211__.model.inkMode,
  activeInk: document.querySelector('.ink-button.active')?.dataset.ink,
  archivedInk: window.__OCTOBERLINE_211__.paperState.looseSheet?.page.metadata?.inkMode,
}));
if (restoredInkState.modelInk !== 'red' || restoredInkState.activeInk !== 'red' || restoredInkState.archivedInk !== 'red') {
  throw new Error(`Restored ink selector mismatch: ${JSON.stringify(restoredInkState)}`);
}
await page.click('#reinsert-sheet');
await advancePaperMotions(page);
await page.waitForFunction(
  () => window.__OCTOBERLINE_211__.paperState.insertedSheet?.sheetNumber === 1 && window.__OCTOBERLINE_211__.paperView.phase === 'idle',
  null,
  { timeout: 15000 },
);
await openDocumentTray(page);
await page.click('#release-sheet');
await advancePaperMotions(page);
await page.waitForFunction(() => window.__OCTOBERLINE_211__.paperView.phase === 'inspecting', null, { timeout: 15000 });
await page.click('#keep-sheet');
await advancePaperMotions(page);
await page.waitForFunction(() => window.__OCTOBERLINE_211__.paperState.manuscript.length === 1 && window.__OCTOBERLINE_211__.paperView.phase === 'idle', null, { timeout: 15000 });

await page.click('#load-sheet');
await advancePaperMotions(page);
await page.waitForFunction(() => window.__OCTOBERLINE_211__.paperState.insertedSheet?.sheetNumber === 2 && window.__OCTOBERLINE_211__.paperView.phase === 'idle', null, { timeout: 15000 });
const newSheetState = await page.evaluate(() => ({
  sheetNumber: window.__OCTOBERLINE_211__.document.sheetNumber,
  marks: window.__OCTOBERLINE_211__.document.marks.length,
  focused: document.activeElement?.id,
  manuscript: window.__OCTOBERLINE_211__.paperState.manuscript.length,
}));
if (newSheetState.sheetNumber !== 2 || newSheetState.marks !== 0 || newSheetState.focused !== 'scene' || newSheetState.manuscript !== 1) {
  throw new Error(`New-sheet mismatch: ${JSON.stringify(newSheetState)}`);
}

await page.keyboard.type('recover me', { delay: 12 });
await settleKeyboardModel(page, []);
await openDocumentTray(page);
await page.click('#release-sheet');
await advancePaperMotions(page);
await page.waitForFunction(() => window.__OCTOBERLINE_211__.paperView.phase === 'inspecting', null, { timeout: 15000 });
const crumpleBox = await page.locator('#crumple-sheet').boundingBox();
await page.mouse.move(crumpleBox.x + crumpleBox.width / 2, crumpleBox.y + crumpleBox.height / 2);
await page.mouse.down();
// The UI threshold is 950 ms; leave enough scheduling headroom for a heavily
// software-rendered browser so pointerup cannot cancel the timer just before it fires.
await page.waitForTimeout(1400);
await page.mouse.up();
await advancePaperMotions(page);
await page.waitForFunction(() => window.__OCTOBERLINE_211__.paperState.discards.length === 1 && window.__OCTOBERLINE_211__.paperView.phase === 'idle', null, { timeout: 20000 });
await page.click('#recover-sheet');
await advancePaperMotions(page);
await page.waitForFunction(() => window.__OCTOBERLINE_211__.paperState.looseSheet && window.__OCTOBERLINE_211__.paperView.phase === 'inspecting', null, { timeout: 15000 });
await page.click('#reinsert-sheet');
await advancePaperMotions(page);
await page.waitForFunction(() => window.__OCTOBERLINE_211__.paperState.insertedSheet?.sheetNumber === 2 && window.__OCTOBERLINE_211__.paperView.phase === 'idle', null, { timeout: 15000 });
const recoveredText = await page.evaluate(() => window.__OCTOBERLINE_211__.document.toPlainText());
if (recoveredText !== 'recover me') throw new Error(`Recovered paper mismatch: ${JSON.stringify(recoveredText)}`);

await openEnvironmentPanel(page);
await page.selectOption('#weather-select', 'rain');
await page.waitForFunction(() => window.__OCTOBERLINE_211__.room.getState().weather === 'rain');
await page.selectOption('#weather-select', 'snow');
await page.waitForFunction(() => window.__OCTOBERLINE_211__.room.getState().weather === 'snow');
await page.waitForTimeout(700);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => Boolean(window.__OCTOBERLINE_211__), null, { timeout: 60_000 });
const restored = await page.evaluate(() => ({
  text: window.__OCTOBERLINE_211__.document.toPlainText(),
  sheet: window.__OCTOBERLINE_211__.paperState.insertedSheet?.sheetNumber,
  manuscript: window.__OCTOBERLINE_211__.paperState.manuscript.length,
  weather: window.__OCTOBERLINE_211__.room.getState().weather,
}));
if (restored.text !== 'recover me' || restored.sheet !== 2 || restored.manuscript !== 1 || restored.weather !== 'snow') {
  throw new Error(`Persistence mismatch: ${JSON.stringify(restored)}`);
}
if (errors.length) throw new Error(`Console errors: ${errors.join(' | ')}`);
await page.context().close();

const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await mobileContext.addInitScript(deterministicRandom);
const mobilePage = await mobileContext.newPage();
const mobileErrors = collectErrors(mobilePage);
await waitForSimulator(mobilePage);
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
await mobilePage.waitForFunction(() => window.__OCTOBERLINE_211__.document.marks.length === 2, null, { timeout: 10000 });
const mobileText = await mobilePage.evaluate(() => window.__OCTOBERLINE_211__.document.toPlainText());
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
  await settleKeyboardModel(reloadPage, []);
  await openDocumentTray(reloadPage);
  await reloadPage.click('#release-sheet');
  await reloadPage.waitForFunction(
    () => Boolean(window.__OCTOBERLINE_211__.paperState.looseSheet)
      && window.__OCTOBERLINE_211__.paperView.phase === 'extracting',
    null,
    { timeout: 5_000 },
  );
  const extractionInterrupted = await reloadPage.evaluate(() => ({
    phase: window.__OCTOBERLINE_211__.paperView.phase,
    inserted: Boolean(window.__OCTOBERLINE_211__.paperState.insertedSheet),
    loose: Boolean(window.__OCTOBERLINE_211__.paperState.looseSheet),
    text: window.__OCTOBERLINE_211__.document.toPlainText(),
  }));

  await reloadPage.reload({ waitUntil: 'networkidle' });
  await reloadPage.waitForFunction(() => Boolean(window.__OCTOBERLINE_211__), null, { timeout: 60_000 });
  const extractionRecovered = await reloadPage.evaluate(() => ({
    phase: window.__OCTOBERLINE_211__.paperView.phase,
    inserted: Boolean(window.__OCTOBERLINE_211__.paperState.insertedSheet),
    loose: Boolean(window.__OCTOBERLINE_211__.paperState.looseSheet),
    activePage: Boolean(window.__OCTOBERLINE_211__.paperView.activePage),
    machinePaperVisible: window.__OCTOBERLINE_211__.model.paperMesh.visible,
    text: window.__OCTOBERLINE_211__.document.toPlainText(),
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
    () => window.__OCTOBERLINE_211__.paperState.manuscript.length === 1
      && window.__OCTOBERLINE_211__.paperView.phase === 'filing',
    null,
    { timeout: 5_000 },
  );
  const filingInterrupted = await reloadPage.evaluate(() => ({
    phase: window.__OCTOBERLINE_211__.paperView.phase,
    loose: Boolean(window.__OCTOBERLINE_211__.paperState.looseSheet),
    manuscript: window.__OCTOBERLINE_211__.paperState.manuscript.length,
  }));

  await reloadPage.reload({ waitUntil: 'networkidle' });
  await reloadPage.waitForFunction(() => Boolean(window.__OCTOBERLINE_211__), null, { timeout: 60_000 });
  const filingRecovered = await reloadPage.evaluate(() => {
    const state = window.__OCTOBERLINE_211__.paperState;
    return {
      phase: window.__OCTOBERLINE_211__.paperView.phase,
      inserted: Boolean(state.insertedSheet),
      loose: Boolean(state.looseSheet),
      manuscript: state.manuscript.length,
      manuscriptCharacters: state.manuscript[0]?.page?.content?.marks
        ?.map(({ character }) => character)
        .join(''),
      manuscriptTopVisible: Boolean(window.__OCTOBERLINE_211__.paperView.manuscriptTopMesh?.visible),
      visibleStackLayers: window.__OCTOBERLINE_211__.paperView.stackLayers.count,
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
    window.__OCTOBERLINE_211_RESTORE_STORAGE__ = () => { Storage.prototype.setItem = originalSetItem; };
    Storage.prototype.setItem = () => { throw new DOMException('Quota exhausted by test', 'QuotaExceededError'); };
  });
  await storageFailurePage.keyboard.type('z');
  await settleKeyboardModel(storageFailurePage, []);
  await storageFailurePage.waitForFunction(
    () => document.getElementById('archive-warning')?.textContent.includes('LOCAL ARCHIVE IS FULL'),
    null,
    { timeout: 5000 },
  );
  storageFailureState = await storageFailurePage.evaluate(() => ({
    warning: document.getElementById('archive-warning')?.textContent,
    warningVisible: !document.getElementById('archive-warning')?.hidden,
    text: window.__OCTOBERLINE_211__.document.toPlainText(),
    inserted: Boolean(window.__OCTOBERLINE_211__.lifecycle.getOverview().insertedSheet),
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
  await storageFailurePage.evaluate(() => window.__OCTOBERLINE_211_RESTORE_STORAGE__?.()).catch(() => {});
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
    await qualityPage.waitForFunction(() => Boolean(window.__OCTOBERLINE_211__), null, { timeout: 60000 });
    await qualityPage.click('#enter-studio');
    await qualityPage.keyboard.type('q');
    await settleKeyboardModel(qualityPage, []);
    const qualityState = await qualityPage.evaluate(() => ({
      text: window.__OCTOBERLINE_211__.document.toPlainText(),
      ...window.__OCTOBERLINE_211__.room.getState(),
      backdropVisible: window.__OCTOBERLINE_211__.room.backdropMesh.visible,
      detailedRoomVisible: window.__OCTOBERLINE_211__.room.environment.visible,
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
  burstFrameCadence,
  wallClockMechanicsGate,
  paperUploads,
  paperUploadDelta,
  shiftState,
  geometryClearance,
  keyCorrespondence,
  paperAudioState,
  modalUiState,
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
