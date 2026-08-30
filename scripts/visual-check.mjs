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
    await page.waitForFunction(() => Boolean(window.__OCTOBERLINE_211__), null, { timeout: 60000 });
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

async function openEnvironmentPanel(page) {
  if (!(await page.locator('.environment-card').evaluate((element) => element.open))) {
    await page.click('.environment-summary');
  }
  await page.waitForFunction(() => document.querySelector('.environment-card')?.open);
}

async function settleKeyboardModel(page, maxSteps = 256) {
  const state = await page.evaluate((steps) => {
    const model = window.__OCTOBERLINE_211__.model;
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
    const model = window.__OCTOBERLINE_211__.model;
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
      const { paperView } = window.__OCTOBERLINE_211__;
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
  await page.evaluate(() => window.__OCTOBERLINE_211__.setView('paper', 0));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  await page.waitForFunction(
    () => Boolean(window.__OCTOBERLINE_211__.paperState.looseSheet)
      && window.__OCTOBERLINE_211__.paperView.phase === 'inspecting',
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
  await page.evaluate(() => window.__OCTOBERLINE_211__.setView('writer', 0));
  await page.waitForFunction(
    () => window.__OCTOBERLINE_211__.paperState.discards.length === 1
      && window.__OCTOBERLINE_211__.paperView.phase === 'idle',
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
  reducedMotion = null,
  run,
}) {
  if (requestedScenario && requestedScenario !== name) return;
  const context = await browser.newContext({
    viewport,
    isMobile,
    hasTouch,
    deviceScaleFactor: 1,
    ...(reducedMotion ? { reducedMotion } : {}),
  });
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
      await page.hover('#enter-studio');
      await page.waitForFunction(
        () => (window.__OCTOBERLINE_211__.model.keys.get('KeyO')?.depression ?? 0) > 0.04,
      );
      const state = await page.evaluate(() => ({
        overlayHidden: document.querySelector('#intro-overlay')?.getAttribute('aria-hidden') === 'true',
        buttonVisible: Boolean(document.querySelector('#enter-studio')?.getBoundingClientRect().height),
        secondaryVisible: Boolean(document.querySelector('#intro-guide')?.getBoundingClientRect().height),
        initialized: Boolean(window.__OCTOBERLINE_211__),
        brand: document.querySelector('.intro-carbon-brand')?.textContent.replace(/\s+/g, ' ').trim(),
        kicker: document.querySelector('.intro-index')?.textContent,
        title: document.querySelector('#intro-title')?.textContent.replace(/\s+/g, ' ').trim(),
        activeView: document.querySelector('.view-button.active')?.dataset.view,
        keyPreview: window.__OCTOBERLINE_211__.model.keys.get('KeyO')?.depression ?? 0,
        machineAudioStarted: Boolean(window.__OCTOBERLINE_211__.audio.context),
        roomAudioStarted: Boolean(window.__OCTOBERLINE_211__.atmosphereAudio.context),
        pecoIdentificationDwell: window.__OCTOBERLINE_211__.room.getState().pecoCrown.staticFrame,
        actionsBounds: (() => {
          const box = document.querySelector('.intro-actions')?.getBoundingClientRect();
          return box ? { left: box.left, top: box.top, right: box.right, bottom: box.bottom } : null;
        })(),
        viewport: { width: innerWidth, height: innerHeight },
      }));
      invariant(
        state.initialized
          && !state.overlayHidden
          && state.buttonVisible
          && state.secondaryVisible
          && state.brand === 'Octoberline 211'
          && state.kicker === 'PHILADELPHIA · EARLY EVENING'
          && state.title === 'A room for the next page.'
          && state.activeView === 'writer'
          && state.keyPreview > 0.04
          && !state.machineAudioStarted
          && !state.roomAudioStarted
          && state.pecoIdentificationDwell
          && state.actionsBounds?.left >= 0
          && state.actionsBounds?.top >= 0
          && state.actionsBounds?.right <= state.viewport.width
          && state.actionsBounds?.bottom <= state.viewport.height,
        `Intro state mismatch: ${JSON.stringify(state)}`,
      );
      return state;
    },
  });

  await captureScenario({
    name: 'intro-mobile',
    filename: '01-intro-mobile.png',
    enter: false,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    run: async (page) => {
      const state = await page.evaluate(() => {
        const copy = document.querySelector('.intro-content')?.getBoundingClientRect();
        const primary = document.querySelector('#enter-studio')?.getBoundingClientRect();
        const secondary = document.querySelector('#intro-guide')?.getBoundingClientRect();
        const brand = document.querySelector('.intro-carbon-brand')?.getBoundingClientRect();
        const api = window.__OCTOBERLINE_211__;
        const crown = api.room.root.getObjectByName('PECOTowerCrownLightsSimplifiedBroadFace');
        const crownCorners = [
          [-crown.userData.width / 2, -crown.userData.height / 2],
          [crown.userData.width / 2, -crown.userData.height / 2],
          [crown.userData.width / 2, crown.userData.height / 2],
          [-crown.userData.width / 2, crown.userData.height / 2],
        ].map(([x, y]) => crown.localToWorld(crown.position.clone().set(x, y, 0)).project(api.camera));
        const crownXs = crownCorners.map(({ x }) => (x + 1) * innerWidth * 0.5);
        const crownYs = crownCorners.map(({ y }) => (1 - y) * innerHeight * 0.5);
        return {
          title: document.querySelector('#intro-title')?.textContent.replace(/\s+/g, ' ').trim(),
          copy: copy ? { left: copy.left, top: copy.top, right: copy.right, bottom: copy.bottom } : null,
          primary: primary ? { left: primary.left, top: primary.top, right: primary.right, bottom: primary.bottom } : null,
          secondary: secondary ? { left: secondary.left, top: secondary.top, right: secondary.right, bottom: secondary.bottom } : null,
          brand: brand ? { left: brand.left, top: brand.top, right: brand.right, bottom: brand.bottom } : null,
          machineAudioStarted: Boolean(window.__OCTOBERLINE_211__.audio.context),
          roomAudioStarted: Boolean(window.__OCTOBERLINE_211__.atmosphereAudio.context),
          pecoIdentificationDwell: api.room.getState().pecoCrown.staticFrame,
          crownBounds: {
            left: Math.min(...crownXs),
            top: Math.min(...crownYs),
            right: Math.max(...crownXs),
            bottom: Math.max(...crownYs),
          },
          scrollWidth: document.documentElement.scrollWidth,
          viewport: { width: innerWidth, height: innerHeight },
        };
      });
      invariant(
        state.title === 'A room for the next page.'
          && state.copy?.left >= 0
          && state.copy?.top >= 0
          && state.copy?.right <= state.viewport.width
          && state.copy?.bottom <= state.viewport.height
          && state.brand?.left >= 0
          && state.brand?.right <= state.viewport.width
          && state.primary?.left === state.secondary?.left
          && state.primary?.right === state.secondary?.right
          && state.secondary?.top >= state.primary?.bottom
          && state.primary?.bottom - state.primary?.top >= 44
          && state.secondary?.bottom - state.secondary?.top >= 44
          && state.scrollWidth <= state.viewport.width
          && state.crownBounds?.left >= 12
          && state.crownBounds?.right <= state.viewport.width - 12
          && state.crownBounds?.top >= 12
          && state.crownBounds?.bottom <= state.viewport.height * 0.5
          && !state.machineAudioStarted
          && !state.roomAudioStarted
          && state.pecoIdentificationDwell,
        `Mobile intro state mismatch: ${JSON.stringify(state)}`,
      );
      return state;
    },
  });

  await captureScenario({
    name: 'intro-reduced',
    filename: '01-intro-reduced.png',
    enter: false,
    reducedMotion: 'reduce',
    run: async (page) => {
      await page.hover('#enter-studio');
      await page.waitForTimeout(120);
      const state = await page.evaluate(() => {
        const room = window.__OCTOBERLINE_211__.room;
        const before = room.elapsed;
        room.update(1, 99);
        const transition = getComputedStyle(document.querySelector('#intro-overlay')).transitionDuration.split(',')[0].trim();
        return {
          reducedMotion: room.getState().reducedMotion,
          roomStatic: room.elapsed === before,
          crownStatic: room.getState().pecoCrown.staticFrame,
          previewDepression: window.__OCTOBERLINE_211__.model.keys.get('KeyO')?.depression ?? 0,
          transition,
          backgroundMedia: document.querySelectorAll('#intro-overlay img, #intro-overlay video').length,
        };
      });
      invariant(
        state.reducedMotion
          && state.roomStatic
          && state.crownStatic
          && state.previewDepression === 0
          && state.transition === '0.16s'
          && state.backgroundMedia === 0,
        `Reduced-motion intro mismatch: ${JSON.stringify(state)}`,
      );
      return state;
    },
  });

  await captureScenario({
    name: 'writer-rest',
    filename: '02-writer-rest.png',
    run: async (page) => {
      await page.evaluate(() => window.__OCTOBERLINE_211__.setView('writer', 0));
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
      const state = await page.evaluate(() => {
        const crown = window.__OCTOBERLINE_211__.room.root.getObjectByName('PECOTowerCrownLightsSimplifiedBroadFace');
        let crownBounds = null;
        if (crown) {
          const width = crown.userData.width;
          const height = crown.userData.height;
          const corners = [
            [-width / 2, -height / 2], [width / 2, -height / 2],
            [width / 2, height / 2], [-width / 2, height / 2],
          ].map(([x, y]) => crown.localToWorld(crown.position.clone().set(x, y, 0)).project(window.__OCTOBERLINE_211__.camera));
          const xs = corners.map(({ x }) => (x + 1) * innerWidth * 0.5);
          const ys = corners.map(({ y }) => (1 - y) * innerHeight * 0.5);
          crownBounds = {
            left: Math.min(...xs),
            top: Math.min(...ys),
            right: Math.max(...xs),
            bottom: Math.max(...ys),
          };
        }
        return {
          introDismissed: document.querySelector('#intro-overlay')?.classList.contains('dismissed'),
          insertedSheet: window.__OCTOBERLINE_211__.paperState.insertedSheet?.sheetNumber,
          marks: window.__OCTOBERLINE_211__.document.marks.length,
          busy: window.__OCTOBERLINE_211__.model.busy,
          focused: document.activeElement?.id,
          pecoCrown: window.__OCTOBERLINE_211__.room.getState().pecoCrown,
          crownBounds,
          viewport: { width: innerWidth, height: innerHeight },
        };
      });
      invariant(
        state.introDismissed && state.insertedSheet === 1 && state.marks === 0 && !state.busy && state.focused === 'scene',
        `Writer-rest state mismatch: ${JSON.stringify(state)}`,
      );
      invariant(
        state.pecoCrown?.name === 'PECO Crown Lights'
          && state.pecoCrown.frame > 0
          && state.crownBounds?.left >= 0
          && state.crownBounds?.top >= 80
          && state.crownBounds.right <= state.viewport.width
          && state.crownBounds.bottom < state.viewport.height * 0.55,
        `PECO Crown Lights are outside the Writer composition: ${JSON.stringify(state)}`,
      );
      return state;
    },
  });

  await captureScenario({
    name: 'front-wide',
    filename: '02-front-wide.png',
    run: async (page) => {
      await page.click('[data-view="front"]');
      await page.evaluate(() => window.__OCTOBERLINE_211__.setView('front', 0));
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
      const state = await page.evaluate(() => ({
        activeView: document.querySelector('.view-button.active')?.dataset.view,
        cameraPosition: window.__OCTOBERLINE_211__.camera.position.toArray(),
        trayExpanded: document.querySelector('#document-toggle')?.getAttribute('aria-expanded'),
        environmentOpen: document.querySelector('.environment-card')?.open,
        weatherSummaryFontSize: Number.parseFloat(getComputedStyle(document.querySelector('#environment-summary')).fontSize),
      }));
      invariant(
        state.activeView === 'front'
          && Math.abs(state.cameraPosition[0]) < 0.01
          && state.cameraPosition[2] >= 15
          && state.trayExpanded === 'false'
          && !state.environmentOpen
          && state.weatherSummaryFontSize >= 12,
        `Front-wide state mismatch: ${JSON.stringify(state)}`,
      );
      return state;
    },
  });

  await captureScenario({
    name: 'peco-window',
    filename: '02-peco-window.png',
    run: async (page) => {
      if (await page.locator('#first-sheet-coach').isVisible()) await page.click('#coach-skip');
      await page.evaluate(() => {
        window.__OCTOBERLINE_211__.setView('writer', 0);
        window.__OCTOBERLINE_211__.setWeather('autumn-wind');
      });
      await page.waitForTimeout(550);
      if (await page.locator('#first-sheet-coach').isVisible()) await page.click('#coach-skip');
      await page.evaluate(() => window.__OCTOBERLINE_211__.room.update(0.075, 8.3));
      const state = await page.evaluate(() => {
        const room = window.__OCTOBERLINE_211__.room;
        const quality = room.getState().effectiveQuality;
        const crown = room.root.getObjectByName(
          quality === 'high'
            ? 'PECOTowerCrownLightsHighBroadFace'
            : 'PECOTowerCrownLightsSimplifiedBroadFace',
        );
        const width = crown.userData.width;
        const height = crown.userData.height;
        const corners = [
          [-width / 2, -height / 2], [width / 2, -height / 2],
          [width / 2, height / 2], [-width / 2, height / 2],
        ].map(([x, y]) => crown.localToWorld(crown.position.clone().set(x, y, 0)).project(window.__OCTOBERLINE_211__.camera));
        const xs = corners.map(({ x }) => (x + 1) * innerWidth * 0.5);
        const ys = corners.map(({ y }) => (1 - y) * innerHeight * 0.5);
        return {
          quality,
          crown: room.getState().pecoCrown,
          bounds: {
            left: Math.min(...xs),
            top: Math.min(...ys),
            right: Math.max(...xs),
            bottom: Math.max(...ys),
          },
          viewport: { width: innerWidth, height: innerHeight },
          tutorialHidden: document.querySelector('#first-sheet-coach')?.hidden,
        };
      });
      invariant(
        state.tutorialHidden
          && state.crown.frame > 0
          && !state.crown.staticFrame
          && state.bounds.left >= 0
          && state.bounds.top >= 80
          && state.bounds.right <= state.viewport.width
          && state.bounds.bottom < state.viewport.height * 0.55,
        `PECO landmark plate mismatch: ${JSON.stringify(state)}`,
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
        text: window.__OCTOBERLINE_211__.document.toPlainText(),
        line: window.__OCTOBERLINE_211__.document.line,
        marks: window.__OCTOBERLINE_211__.document.marks.length,
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
      await page.evaluate(() => window.__OCTOBERLINE_211__.setView('mechanism', 0));
      await page.waitForFunction(() => window.__OCTOBERLINE_211__.model.inspectionAmount > 0.95, null, { timeout: 10000 });
      const state = await page.evaluate(() => ({
        pressed: document.querySelector('#inspection-toggle')?.getAttribute('aria-pressed'),
        target: window.__OCTOBERLINE_211__.model.inspectionTarget,
        amount: window.__OCTOBERLINE_211__.model.inspectionAmount,
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
        const mesh = window.__OCTOBERLINE_211__.paperView.activePage?.mesh;
        let screenBounds = null;
        if (mesh) {
          mesh.geometry.computeBoundingBox();
          const box = mesh.geometry.boundingBox;
          const corners = [
            box.min.clone(),
            box.min.clone().set(box.max.x, box.min.y, box.min.z),
            box.max.clone(),
            box.max.clone().set(box.min.x, box.max.y, box.max.z),
          ].map((point) => mesh.localToWorld(point).project(window.__OCTOBERLINE_211__.camera));
          const xs = corners.map(({ x }) => (x + 1) * innerWidth * 0.5);
          const ys = corners.map(({ y }) => (1 - y) * innerHeight * 0.5);
          const center = mesh.getWorldPosition(mesh.position.clone()).project(window.__OCTOBERLINE_211__.camera);
          screenBounds = {
            left: Math.min(...xs),
            top: Math.min(...ys),
            right: Math.max(...xs),
            bottom: Math.max(...ys),
            centerX: (center.x + 1) * innerWidth * 0.5,
            centerY: (1 - center.y) * innerHeight * 0.5,
            meshPosition: mesh.position.toArray(),
            meshScale: mesh.scale.toArray(),
            cameraPosition: window.__OCTOBERLINE_211__.camera.position.toArray(),
          };
        }
        return {
          inserted: Boolean(window.__OCTOBERLINE_211__.paperState.insertedSheet),
          loose: Boolean(window.__OCTOBERLINE_211__.paperState.looseSheet),
          phase: window.__OCTOBERLINE_211__.paperView.phase,
          machinePaperVisible: window.__OCTOBERLINE_211__.model.paperMesh.visible,
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
      await page.evaluate(() => window.__OCTOBERLINE_211__.setView('writer', 0));
      await page.waitForFunction(
        () => window.__OCTOBERLINE_211__.paperState.manuscript.length === 1
          && window.__OCTOBERLINE_211__.paperView.phase === 'idle',
        null,
        { timeout: 20000 },
      );
      const state = await page.evaluate(() => ({
        inserted: Boolean(window.__OCTOBERLINE_211__.paperState.insertedSheet),
        loose: Boolean(window.__OCTOBERLINE_211__.paperState.looseSheet),
        manuscript: window.__OCTOBERLINE_211__.paperState.manuscript.length,
        visibleStackLayers: window.__OCTOBERLINE_211__.paperView.stackLayers.count,
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
        inserted: Boolean(window.__OCTOBERLINE_211__.paperState.insertedSheet),
        loose: Boolean(window.__OCTOBERLINE_211__.paperState.looseSheet),
        discards: window.__OCTOBERLINE_211__.paperState.discards.length,
        discardVisuals: window.__OCTOBERLINE_211__.paperView.discardVisuals.size,
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
      await openEnvironmentPanel(page);
      await page.selectOption('#weather-select', 'rain');
      await page.waitForFunction(
        () => window.__OCTOBERLINE_211__.room.getState().weather === 'rain'
          && window.__OCTOBERLINE_211__.room.rain.visible
          && window.__OCTOBERLINE_211__.room.rainMaterial.opacity > 0.2,
        null,
        { timeout: 10000 },
      );
      await page.waitForTimeout(700);
      const state = await page.evaluate(() => ({
        weather: window.__OCTOBERLINE_211__.room.getState().weather,
        rainVisible: window.__OCTOBERLINE_211__.room.rain.visible,
        rainOpacity: window.__OCTOBERLINE_211__.room.rainMaterial.opacity,
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
      await openEnvironmentPanel(page);
      await page.selectOption('#weather-select', 'snow');
      await page.waitForFunction(
        () => window.__OCTOBERLINE_211__.room.getState().weather === 'snow'
          && window.__OCTOBERLINE_211__.room.snow.visible
          && window.__OCTOBERLINE_211__.room.snowPointsMaterial.opacity > 0.3,
        null,
        { timeout: 10000 },
      );
      await page.waitForTimeout(700);
      const state = await page.evaluate(() => ({
        weather: window.__OCTOBERLINE_211__.room.getState().weather,
        snowVisible: window.__OCTOBERLINE_211__.room.snow.visible,
        snowOpacity: window.__OCTOBERLINE_211__.room.snowPointsMaterial.opacity,
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
        text: window.__OCTOBERLINE_211__.document.toPlainText(),
        inputVisible: document.querySelector('#mobile-input')?.getBoundingClientRect().height > 0,
        insertedSheet: window.__OCTOBERLINE_211__.paperState.insertedSheet?.sheetNumber,
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
