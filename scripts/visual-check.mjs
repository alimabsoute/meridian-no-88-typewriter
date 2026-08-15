import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_PREVIEW_URL,
  ensurePreviewServer,
  launchBrowser,
  withQuality,
} from './browser-test-helpers.mjs';

const configuredTargetUrl = process.env.TARGET_URL || withQuality(DEFAULT_PREVIEW_URL, 'low');
const preview = await ensurePreviewServer({ targetUrl: configuredTargetUrl });
const targetUrl = preview.targetUrl;
const shotDir = path.resolve('visual-checks');
const desktopViewport = { width: 1280, height: 800 };
const screenshots = [];
const assertions = {};
const scenarioArgument = process.argv.find((value) => value.startsWith('--scenario='));
const requestedScenario = scenarioArgument?.slice('--scenario='.length) || null;

await mkdir(shotDir, { recursive: true });

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function assertBrowserClean(label, errors) {
  if (errors.length) {
    throw new Error(`${label} browser errors:\n${errors.join('\n')}`);
  }
}

async function waitForSimulator(page, { enter = true } = {}) {
  await page.goto(targetUrl, { waitUntil: 'networkidle' });
  try {
    await page.waitForFunction(() => Boolean(window.__MERIDIAN__), null, { timeout: 60000 });
  } catch (error) {
    throw new Error(`Simulator did not initialize: ${error.message}`);
  }
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(900);

  if (enter) {
    await page.click('#enter-studio');
    await page.waitForFunction(() => document.querySelector('#intro-overlay')?.classList.contains('dismissed'));
    await page.waitForTimeout(900);
  }
}

async function openDocumentTray(page) {
  const expanded = await page.locator('#document-toggle').getAttribute('aria-expanded');
  if (expanded !== 'true') await page.click('#document-toggle');
  await page.waitForFunction(() => document.querySelector('#document-toggle')?.getAttribute('aria-expanded') === 'true');
}

async function settleKeyboardModel(page, maxSteps = 256) {
  const state = await page.evaluate((steps) => {
    const model = window.__MERIDIAN__.model;
    for (let step = 0; step < steps; step += 1) {
      if (!model.busy) return { settled: true, step };
      model.update(0.04);
    }
    return {
      settled: !model.busy,
      busy: model.busy,
      queueDepth: model.commandQueue.length,
      activeStrikes: model.activeStrikes.length,
      returning: Boolean(model.returning),
      tabMotion: Boolean(model.tabMotion),
      paperLoading: Boolean(model.paperLoading),
    };
  }, maxSteps);
  invariant(state.settled, `Visual keyboard model did not settle: ${JSON.stringify(state)}`);
}

async function settleInspection(page, maxSteps = 64) {
  const state = await page.evaluate((steps) => {
    const model = window.__MERIDIAN__.model;
    for (let step = 0; step < steps; step += 1) {
      if (model.inspectionAmount > 0.95) {
        return { settled: true, step, amount: model.inspectionAmount };
      }
      model.update(0.04);
    }
    return { settled: model.inspectionAmount > 0.95, amount: model.inspectionAmount };
  }, maxSteps);
  invariant(state.settled, `Visual inspection did not settle: ${JSON.stringify(state)}`);
}

async function advancePaperMotions(page, { rounds = 4, stepsPerRound = 24 } = {}) {
  let state;
  for (let round = 0; round < rounds; round += 1) {
    state = await page.evaluate((steps) => {
      const { paperView } = window.__MERIDIAN__;
      for (let step = 0; step < steps; step += 1) paperView.update(0.05);
      return {
        phase: paperView.phase,
        activeMotion: Boolean(paperView.motion),
      };
    }, stepsPerRound);
    // Let async click handlers continue between chained paper motions.
    await page.waitForTimeout(0);
  }
  return state;
}

async function typeAndSettle(page, lines) {
  for (let index = 0; index < lines.length; index += 1) {
    if (index) await page.keyboard.press('Enter');
    await page.keyboard.type(lines[index], { delay: 10 });
  }
  await settleKeyboardModel(page);
}

async function releaseCurrentSheet(page) {
  await openDocumentTray(page);
  await page.click('#release-sheet');
  await advancePaperMotions(page);
  await page.evaluate(() => window.__MERIDIAN__.setView('paper', 0));
  await page.waitForFunction(
    () => Boolean(window.__MERIDIAN__.paperState.looseSheet)
      && window.__MERIDIAN__.paperView.phase === 'inspecting',
    null,
    { timeout: 20000 },
  );
}

async function holdToCrumple(page) {
  const button = page.locator('#crumple-sheet');
  const box = await button.boundingBox();
  invariant(box, 'Crumple control has no visible bounds.');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1050);
  await page.mouse.up();
  await advancePaperMotions(page);
  await page.evaluate(() => window.__MERIDIAN__.setView('writer', 0));
  await page.waitForFunction(
    () => window.__MERIDIAN__.paperState.discards.length === 1
      && window.__MERIDIAN__.paperView.phase === 'idle',
    null,
    { timeout: 25000 },
  );
}

async function captureScenario({
  name,
  filename,
  enter = true,
  viewport = desktopViewport,
  isMobile = false,
  hasTouch = false,
  run,
}) {
  if (requestedScenario && requestedScenario !== name) return;
  const context = await browser.newContext({ viewport, isMobile, hasTouch, deviceScaleFactor: 1 });
  await context.addInitScript(() => {
    // Each plate begins from a known document, room, and random seed.
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      // Storage is not available in the initial about:blank document.
    }
    let seed = 0x4d455249;
    Math.random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
  });

  const page = await context.newPage();
  page.setDefaultTimeout(90000);
  const browserErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => browserErrors.push(`page: ${error.stack || error.message}`));

  try {
    await waitForSimulator(page, { enter });
    const scenarioAssertions = await run(page);
    // State setup may be deterministically stepped on software-rendered CI.
    // Require a real animation frame so every plate captures an actual render.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    await page.waitForTimeout(100);
    assertBrowserClean(name, browserErrors);
    const outputPath = path.join(shotDir, filename);
    await page.screenshot({ path: outputPath, animations: 'disabled' });
    assertBrowserClean(name, browserErrors);
    screenshots.push(outputPath);
    assertions[name] = scenarioAssertions;
  } finally {
    await context.close();
  }
}

let browser;
try {
  browser = await launchBrowser();
  await captureScenario({
    name: 'intro',
    filename: '01-intro.png',
    enter: false,
    run: async (page) => {
      const state = await page.evaluate(() => ({
        overlayHidden: document.querySelector('#intro-overlay')?.getAttribute('aria-hidden') === 'true',
        buttonVisible: Boolean(document.querySelector('#enter-studio')?.getBoundingClientRect().height),
        initialized: Boolean(window.__MERIDIAN__),
      }));
      invariant(state.initialized && !state.overlayHidden && state.buttonVisible, `Intro state mismatch: ${JSON.stringify(state)}`);
      return state;
    },
  });

  await captureScenario({
    name: 'writer-rest',
    filename: '02-writer-rest.png',
    run: async (page) => {
      const state = await page.evaluate(() => ({
        introDismissed: document.querySelector('#intro-overlay')?.classList.contains('dismissed'),
        insertedSheet: window.__MERIDIAN__.paperState.insertedSheet?.sheetNumber,
        marks: window.__MERIDIAN__.document.marks.length,
        busy: window.__MERIDIAN__.model.busy,
        focused: document.activeElement?.id,
      }));
      invariant(
        state.introDismissed && state.insertedSheet === 1 && state.marks === 0 && !state.busy && state.focused === 'scene',
        `Writer-rest state mismatch: ${JSON.stringify(state)}`,
      );
      return state;
    },
  });

  await captureScenario({
    name: 'typed-paper',
    filename: '03-typed-paper.png',
    run: async (page) => {
      const expected = 'Philadelphia, early evening.\nSnow settles beyond the glass.';
      await typeAndSettle(page, ['Philadelphia, early evening.', 'Snow settles beyond the glass.']);
      const state = await page.evaluate(() => ({
        text: window.__MERIDIAN__.document.toPlainText(),
        line: window.__MERIDIAN__.document.line,
        marks: window.__MERIDIAN__.document.marks.length,
      }));
      invariant(state.text === expected && state.line === 1 && state.marks > 40, `Typed-paper state mismatch: ${JSON.stringify(state)}`);
      return state;
    },
  });

  await captureScenario({
    name: 'inspection',
    filename: '04-inspection.png',
    run: async (page) => {
      await page.click('#inspection-toggle');
      await settleInspection(page);
      await page.evaluate(() => window.__MERIDIAN__.setView('mechanism', 0));
      await page.waitForFunction(() => window.__MERIDIAN__.model.inspectionAmount > 0.95, null, { timeout: 10000 });
      const state = await page.evaluate(() => ({
        pressed: document.querySelector('#inspection-toggle')?.getAttribute('aria-pressed'),
        target: window.__MERIDIAN__.model.inspectionTarget,
        amount: window.__MERIDIAN__.model.inspectionAmount,
        cursor: document.querySelector('#scene')?.style.cursor,
      }));
      invariant(state.pressed === 'true' && state.target === 1 && state.amount > 0.95 && state.cursor === 'grab', `Inspection state mismatch: ${JSON.stringify(state)}`);
      return state;
    },
  });

  await captureScenario({
    name: 'released-loose-paper',
    filename: '05-released-loose-paper.png',
    run: async (page) => {
      await typeAndSettle(page, ['A loose page waits for a decision.']);
      await releaseCurrentSheet(page);
      const state = await page.evaluate(() => {
        const mesh = window.__MERIDIAN__.paperView.activePage?.mesh;
        let screenBounds = null;
        if (mesh) {
          mesh.geometry.computeBoundingBox();
          const box = mesh.geometry.boundingBox;
          const corners = [
            box.min.clone(),
            box.min.clone().set(box.max.x, box.min.y, box.min.z),
            box.max.clone(),
            box.max.clone().set(box.min.x, box.max.y, box.max.z),
          ].map((point) => mesh.localToWorld(point).project(window.__MERIDIAN__.camera));
          const xs = corners.map(({ x }) => (x + 1) * innerWidth * 0.5);
          const ys = corners.map(({ y }) => (1 - y) * innerHeight * 0.5);
          const center = mesh.getWorldPosition(mesh.position.clone()).project(window.__MERIDIAN__.camera);
          screenBounds = {
            left: Math.min(...xs),
            top: Math.min(...ys),
            right: Math.max(...xs),
            bottom: Math.max(...ys),
            centerX: (center.x + 1) * innerWidth * 0.5,
            centerY: (1 - center.y) * innerHeight * 0.5,
            meshPosition: mesh.position.toArray(),
            meshScale: mesh.scale.toArray(),
            cameraPosition: window.__MERIDIAN__.camera.position.toArray(),
          };
        }
        return {
          inserted: Boolean(window.__MERIDIAN__.paperState.insertedSheet),
          loose: Boolean(window.__MERIDIAN__.paperState.looseSheet),
          phase: window.__MERIDIAN__.paperView.phase,
          machinePaperVisible: window.__MERIDIAN__.model.paperMesh.visible,
          paperStatus: document.querySelector('#paper-status')?.textContent,
          keepVisible: !document.querySelector('#keep-sheet')?.hidden,
          crumpleVisible: !document.querySelector('#crumple-sheet')?.hidden,
          screenBounds,
        };
      });
      invariant(
        !state.inserted && state.loose && state.phase === 'inspecting' && !state.machinePaperVisible
          && state.paperStatus?.includes('LOOSE SHEET') && state.keepVisible && state.crumpleVisible
          && state.screenBounds?.left > 300 && state.screenBounds.top >= 80
          && state.screenBounds.right < 1100 && state.screenBounds.bottom <= 460,
        `Released-sheet state mismatch: ${JSON.stringify(state)}`,
      );
      return state;
    },
  });

  await captureScenario({
    name: 'filed-manuscript',
    filename: '06-filed-manuscript.png',
    run: async (page) => {
      await typeAndSettle(page, ['Filed beside the machine.']);
      await releaseCurrentSheet(page);
      await page.click('#keep-sheet');
      await advancePaperMotions(page);
      await page.evaluate(() => window.__MERIDIAN__.setView('writer', 0));
      await page.waitForFunction(
        () => window.__MERIDIAN__.paperState.manuscript.length === 1
          && window.__MERIDIAN__.paperView.phase === 'idle',
        null,
        { timeout: 20000 },
      );
      const state = await page.evaluate(() => ({
        inserted: Boolean(window.__MERIDIAN__.paperState.insertedSheet),
        loose: Boolean(window.__MERIDIAN__.paperState.looseSheet),
        manuscript: window.__MERIDIAN__.paperState.manuscript.length,
        visibleStackLayers: window.__MERIDIAN__.paperView.stackLayers.count,
        paperStatus: document.querySelector('#paper-status')?.textContent,
        loadVisible: !document.querySelector('#load-sheet')?.hidden,
      }));
      invariant(
        !state.inserted && !state.loose && state.manuscript === 1 && state.visibleStackLayers === 1
          && state.paperStatus === 'PAPER PATH EMPTY' && state.loadVisible,
        `Filed-manuscript state mismatch: ${JSON.stringify(state)}`,
      );
      await page.click('#document-toggle');
      await page.waitForFunction(() => document.querySelector('#document-toggle')?.getAttribute('aria-expanded') === 'false');
      await page.waitForTimeout(450);
      return state;
    },
  });

  await captureScenario({
    name: 'discarded-crumpled-page',
    filename: '07-discarded-crumpled-page.png',
    run: async (page) => {
      await typeAndSettle(page, ['This draft belongs in the basket.']);
      await releaseCurrentSheet(page);
      await holdToCrumple(page);
      const state = await page.evaluate(() => ({
        inserted: Boolean(window.__MERIDIAN__.paperState.insertedSheet),
        loose: Boolean(window.__MERIDIAN__.paperState.looseSheet),
        discards: window.__MERIDIAN__.paperState.discards.length,
        discardVisuals: window.__MERIDIAN__.paperView.discardVisuals.size,
        discardCountText: document.querySelector('#discard-count')?.textContent,
        recoverVisible: !document.querySelector('#recover-sheet')?.hidden,
      }));
      invariant(
        !state.inserted && !state.loose && state.discards === 1 && state.discardVisuals === 1
          && state.discardCountText === '1' && state.recoverVisible,
        `Discarded-page state mismatch: ${JSON.stringify(state)}`,
      );
      await page.click('#document-toggle');
      await page.waitForFunction(() => document.querySelector('#document-toggle')?.getAttribute('aria-expanded') === 'false');
      await page.waitForTimeout(450);
      return state;
    },
  });

  await captureScenario({
    name: 'rain',
    filename: '08-rain.png',
    run: async (page) => {
      await page.selectOption('#weather-select', 'rain');
      await page.waitForFunction(
        () => window.__MERIDIAN__.room.getState().weather === 'rain'
          && window.__MERIDIAN__.room.rain.visible
          && window.__MERIDIAN__.room.rainMaterial.opacity > 0.2,
        null,
        { timeout: 10000 },
      );
      await page.waitForTimeout(700);
      const state = await page.evaluate(() => ({
        weather: window.__MERIDIAN__.room.getState().weather,
        rainVisible: window.__MERIDIAN__.room.rain.visible,
        rainOpacity: window.__MERIDIAN__.room.rainMaterial.opacity,
        selected: document.querySelector('#weather-select')?.value,
      }));
      invariant(state.weather === 'rain' && state.rainVisible && state.rainOpacity > 0.2 && state.selected === 'rain', `Rain state mismatch: ${JSON.stringify(state)}`);
      return state;
    },
  });

  await captureScenario({
    name: 'snow',
    filename: '09-snow.png',
    run: async (page) => {
      await page.selectOption('#weather-select', 'snow');
      await page.waitForFunction(
        () => window.__MERIDIAN__.room.getState().weather === 'snow'
          && window.__MERIDIAN__.room.snow.visible
          && window.__MERIDIAN__.room.snowPointsMaterial.opacity > 0.3,
        null,
        { timeout: 10000 },
      );
      await page.waitForTimeout(700);
      const state = await page.evaluate(() => ({
        weather: window.__MERIDIAN__.room.getState().weather,
        snowVisible: window.__MERIDIAN__.room.snow.visible,
        snowOpacity: window.__MERIDIAN__.room.snowPointsMaterial.opacity,
        selected: document.querySelector('#weather-select')?.value,
      }));
      invariant(state.weather === 'snow' && state.snowVisible && state.snowOpacity > 0.3 && state.selected === 'snow', `Snow state mismatch: ${JSON.stringify(state)}`);
      return state;
    },
  });

  await captureScenario({
    name: 'field-guide',
    filename: '10-field-guide.png',
    run: async (page) => {
      await page.click('#guide-open');
      await page.click('[data-tab="mechanics"]');
      const state = await page.evaluate(() => ({
        open: document.querySelector('#field-guide')?.open,
        activeTab: document.querySelector('.guide-tab.active')?.dataset.tab,
        activePage: document.querySelector('.guide-page.active')?.dataset.page,
      }));
      invariant(state.open && state.activeTab === 'mechanics' && state.activePage === 'mechanics', `Field-guide state mismatch: ${JSON.stringify(state)}`);
      return state;
    },
  });

  await captureScenario({
    name: 'mobile',
    filename: '11-mobile.png',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    run: async (page) => {
      await page.waitForFunction(() => {
        const element = document.querySelector('#mobile-input');
        return element && getComputedStyle(element).display !== 'none' && element.getBoundingClientRect().height > 0;
      });
      await page.focus('#mobile-input');
      await page.evaluate(() => {
        document.querySelector('#mobile-input').dispatchEvent(new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: 'Hi',
        }));
      });
      await settleKeyboardModel(page);
      const state = await page.evaluate(() => ({
        text: window.__MERIDIAN__.document.toPlainText(),
        inputVisible: document.querySelector('#mobile-input')?.getBoundingClientRect().height > 0,
        insertedSheet: window.__MERIDIAN__.paperState.insertedSheet?.sheetNumber,
      }));
      invariant(state.text === 'Hi' && state.inputVisible && state.insertedSheet === 1, `Mobile state mismatch: ${JSON.stringify(state)}`);
      return state;
    },
  });

  process.stdout.write(`${JSON.stringify({
    ok: true,
    targetUrl,
    requestedScenario,
    screenshotDirectory: shotDir,
    screenshots,
    assertions,
  }, null, 2)}\n`);
} finally {
  await browser?.close().catch(() => {});
  await preview.close();
}
