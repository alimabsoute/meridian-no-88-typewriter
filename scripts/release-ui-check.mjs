import { enterStudio } from './browser-test-helpers.mjs';
async function openWorkbench(page, name) {
  if (await page.locator('#app').getAttribute('data-workbench-panel') !== name) {
    await page.click(`[data-workbench="${name}"]`);
  }
}
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import {
  DEFAULT_PREVIEW_URL,
  ensurePreviewServer,
  launchBrowser,
  withQuality,
} from './browser-test-helpers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configuredTargetUrl = process.env.OCTOBERLINE_RELEASE_UI_URL
  || withQuality(DEFAULT_PREVIEW_URL, 'low');
const preview = await ensurePreviewServer({ targetUrl: configuredTargetUrl });
const targetUrl = preview.targetUrl;
await mkdir(path.join(root, 'visual-checks'), { recursive: true });

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function collectErrors(page) {
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`page: ${error.stack || error.message}`));
  return errors;
}

async function loadSimulator(page) {
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      // about:blank can deny storage before navigation.
    }
  });
  await page.goto(targetUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__OCTOBERLINE_LANDING__));
}

async function enterSimulator(page) {
  await enterStudio(page);
  await page.waitForFunction(() => document.querySelector('#intro-overlay')?.classList.contains('dismissed'));
}

async function prepare(page) {
  await loadSimulator(page);
  await enterSimulator(page);
}

const browser = await launchBrowser();
const report = {};

try {
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await desktop.newPage();
  const errors = collectErrors(page);
  await loadSimulator(page);

  await page.focus('#enter-studio');
  const landing = await page.evaluate(() => {
    const primary = document.querySelector('#enter-studio');
    const secondary = document.querySelector('#intro-guide');
    return {
      brand: document.querySelector('.landing-brand')?.textContent.replace(/\s+/g, ' ').trim(),
      title: document.querySelector('#intro-title')?.textContent.trim(),
      description: document.querySelector('#intro-description')?.textContent.trim(),
      focused: document.activeElement?.id,
      primaryHeight: primary.getBoundingClientRect().height,
      secondaryHeight: secondary.getBoundingClientRect().height,
      primaryFont: parseFloat(getComputedStyle(primary).fontSize),
      secondaryFont: parseFloat(getComputedStyle(secondary).fontSize),
      enginePresent: Boolean(window.__OCTOBERLINE_211__),
      status: window.__OCTOBERLINE_LANDING__.status,
      started: window.__OCTOBERLINE_LANDING__.started,
    };
  });
  invariant(landing.brand === 'Octoberline 211' && landing.title && landing.description
    && landing.focused === 'enter-studio' && landing.primaryHeight >= 44 && landing.secondaryHeight >= 44
    && landing.primaryFont >= 20 && landing.secondaryFont >= 18
    && !landing.enginePresent && landing.status === 'idle' && !landing.started,
    `Lightweight landing mismatch: ${JSON.stringify(landing)}`);
  await page.keyboard.press('Tab');
  const tabForward = await page.evaluate(() => document.activeElement?.id);
  await page.keyboard.press('Shift+Tab');
  const tabBackward = await page.evaluate(() => document.activeElement?.id);
  invariant(tabForward === 'intro-guide' && tabBackward === 'enter-studio', `Landing tab order mismatch: ${JSON.stringify({ tabForward, tabBackward })}`);
  await page.hover('#enter-studio');
  const keyPreview = await page.evaluate(() => ({ enginePresent: Boolean(window.__OCTOBERLINE_211__), started: window.__OCTOBERLINE_LANDING__.started }));
  invariant(!keyPreview.enginePresent && !keyPreview.started, 'Hover/focus must not start the 3D room.');
  await page.focus('#intro-guide');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#landing-guide')?.open);
  const preEntryGuide = await page.evaluate(() => ({
    guideOpen: document.querySelector('#landing-guide').open,
    content: document.querySelector('#landing-guide').textContent,
    enginePresent: Boolean(window.__OCTOBERLINE_211__),
    started: window.__OCTOBERLINE_LANDING__.started,
  }));
  invariant(preEntryGuide.guideOpen && preEntryGuide.content.includes('keyboard') && !preEntryGuide.enginePresent && !preEntryGuide.started,
    `Lightweight guide mismatch: ${JSON.stringify(preEntryGuide)}`);
  await page.keyboard.press('Escape');
  const guideReturn = await page.evaluate(() => ({ focused: document.activeElement?.id, open: document.querySelector('#landing-guide').open }));
  invariant(!guideReturn.open && guideReturn.focused === 'intro-guide', `Guide did not restore focus: ${JSON.stringify(guideReturn)}`);
  await enterSimulator(page);
  await page.waitForFunction(() => {
    const api = window.__OCTOBERLINE_211__;
    return Math.abs(api.camera.position.x - 1.2) < 0.02
      && Math.abs(api.camera.position.y - 5.7) < 0.02
      && Math.abs(api.camera.position.z - 16.8) < 0.02
      && Math.abs(api.camera.fov - 43) < 0.02;
  });
  const entry = await page.evaluate(() => ({
    position: window.__OCTOBERLINE_211__.camera.position.toArray(),
    target: window.__OCTOBERLINE_211__.controls.target.toArray(),
    fov: window.__OCTOBERLINE_211__.camera.fov,
    activeView: document.querySelector('.view-button.active')?.dataset.view,
    mobileView: document.querySelector('#mobile-view-select')?.value,
    overlayHidden: document.querySelector('#intro-overlay')?.getAttribute('aria-hidden'),
    overlayInert: document.querySelector('#intro-overlay')?.inert,
    landingActive: document.querySelector('#app')?.classList.contains('landing-active'),
    keyboardCaptured: window.__OCTOBERLINE_211__.keyboardCaptured,
    focused: document.activeElement?.id,
    machineAudioStarted: Boolean(window.__OCTOBERLINE_211__.audio.context),
    roomAudioStarted: Boolean(window.__OCTOBERLINE_211__.atmosphereAudio.context),
  }));
  invariant(
    Math.abs(entry.position[0] - 1.2) < 0.02
      && Math.abs(entry.position[1] - 5.7) < 0.02
      && Math.abs(entry.position[2] - 16.8) < 0.02
      && Math.abs(entry.target[0] - 1.65) < 0.02
      && Math.abs(entry.target[1] - 3.45) < 0.02
      && Math.abs(entry.target[2] + 2.1) < 0.02
      && Math.abs(entry.fov - 43) < 0.02
      && entry.activeView === 'front'
      && entry.mobileView === 'front'
      && entry.overlayHidden === 'true'
      && entry.overlayInert
      && !entry.landingActive
      && entry.keyboardCaptured
      && entry.focused === 'scene'
      && entry.machineAudioStarted
      && entry.roomAudioStarted,
    `Landing entry handoff mismatch: ${JSON.stringify(entry)}`,
  );
  await page.waitForFunction(() => !document.querySelector('#first-sheet-coach')?.hidden, null, { timeout: 4_000 });

  const initial = await page.evaluate(() => ({
    name: document.querySelector('.brand-name span')?.textContent,
    number: document.querySelector('.brand-name i')?.textContent,
    numberColor: getComputedStyle(document.querySelector('.brand-name i')).color,
    coachVisible: !document.querySelector('#first-sheet-coach')?.hidden,
    coachPointerEvents: getComputedStyle(document.querySelector('#first-sheet-coach')).pointerEvents,
    inputStatus: document.querySelector('#input-status')?.textContent,
    keyboardCaptured: window.__OCTOBERLINE_211__.keyboardCaptured,
    weather: window.__OCTOBERLINE_211__.room.getState().weather,
  }));
  invariant(initial.name === 'Octoberline' && initial.number === '211', `Carbon Mark text mismatch: ${JSON.stringify(initial)}`);
  invariant(initial.numberColor === 'rgb(169, 90, 45)', `Carbon Mark accent mismatch: ${initial.numberColor}`);
  invariant(initial.coachVisible && initial.coachPointerEvents === 'none', `First-sheet coach should be visible and nonmodal: ${JSON.stringify(initial)}`);
  invariant(initial.inputStatus === 'READY TO TYPE' && initial.keyboardCaptured, `Initial input state mismatch: ${JSON.stringify(initial)}`);
  invariant(initial.weather === 'autumn-wind', `Fresh sessions should open in Autumn Wind: ${initial.weather}`);

  // The guide's explicit Next path must return focus to the writing surface so
  // the very next physical key is accepted without a mystery click.
  await page.click('#coach-next');
  invariant(await page.evaluate(() => document.activeElement?.id === 'scene'), 'Coach Next did not refocus the typewriter canvas.');
  await page.keyboard.down('Shift');
  await page.waitForFunction(() => document.querySelector('#coach-progress')?.textContent === '03 / 05');
  await page.keyboard.press('KeyB');
  await page.keyboard.up('Shift');
  await page.waitForFunction(() => window.__OCTOBERLINE_211__.document.marks.length === 1);

  await page.click('[data-workbench=paper]');
  const coachTrayCollision = await page.evaluate(() => ({
    trayOpen: document.querySelector('.document-tray')?.classList.contains('open'),
    coachVisibility: getComputedStyle(document.querySelector('#first-sheet-coach')).visibility,
    coachPointerEvents: getComputedStyle(document.querySelector('#first-sheet-coach')).pointerEvents,
  }));
  invariant(
    coachTrayCollision.trayOpen && coachTrayCollision.coachVisibility === 'hidden' && coachTrayCollision.coachPointerEvents === 'none',
    `Coach must yield to the document tray: ${JSON.stringify(coachTrayCollision)}`,
  );
  await page.click('[data-workbench=paper]');

  // The coach may overlap the central scene but must never block mechanical controls.
  await openWorkbench(page, 'machine');
  await page.click('#inspection-toggle');
  await page.waitForFunction(() => window.__OCTOBERLINE_211__.model.inspectionTarget === 1);
  await openWorkbench(page, 'machine');
  await page.click('#inspection-toggle');
  await page.waitForFunction(() => window.__OCTOBERLINE_211__.model.inspectionTarget === 0);

  // A physical margin-stop drag owns the pointer until it completes, then
  // restores inspection orbit controls even if pointer capture is lost.
  await openWorkbench(page, 'machine');
  await page.click('#inspection-toggle');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__OCTOBERLINE_211__.setView('carriage', 0.01));
  await page.waitForFunction(() => {
    const p = window.__OCTOBERLINE_211__.camera.position;
    return Math.abs(p.x + 6.8) < 0.02 && Math.abs(p.y - 5) < 0.02 && Math.abs(p.z - 7.2) < 0.02;
  });
  const leftStop = await page.evaluate(() => {
    const api = window.__OCTOBERLINE_211__;
    const point = api.model.marginStops.left.getWorldPosition(api.model.marginStops.left.position.clone());
    point.project(api.camera);
    const rect = document.querySelector('#scene').getBoundingClientRect();
    return {
      x: rect.left + ((point.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - point.y) / 2) * rect.height,
      before: api.model.getMechanicalSettings().leftMargin,
    };
  });
  await page.mouse.move(leftStop.x, leftStop.y);
  await page.mouse.down();
  const marginDragStarted = await page.evaluate(() => ({
    active: window.__OCTOBERLINE_211__.marginDragActive,
    controlsEnabled: window.__OCTOBERLINE_211__.controls.enabled,
  }));
  if (!marginDragStarted.active) await page.screenshot({ path: path.join(root, 'visual-checks', 'margin-drag-failure.png') });
  invariant(marginDragStarted.active && !marginDragStarted.controlsEnabled, `Margin drag did not suspend orbit controls: ${JSON.stringify(marginDragStarted)}`);
  await page.mouse.move(leftStop.x + 52, leftStop.y, { steps: 3 });
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const marginDragFinished = await page.evaluate(() => ({
    active: window.__OCTOBERLINE_211__.marginDragActive,
    controlsEnabled: window.__OCTOBERLINE_211__.controls.enabled,
    leftMargin: window.__OCTOBERLINE_211__.model.getMechanicalSettings().leftMargin,
  }));
  await page.mouse.up();
  invariant(!marginDragFinished.active && marginDragFinished.controlsEnabled, `Margin drag cleanup failed: ${JSON.stringify(marginDragFinished)}`);
  invariant(marginDragFinished.leftMargin !== leftStop.before, `Physical margin stop did not move: ${JSON.stringify({ leftStop, marginDragFinished })}`);
  await openWorkbench(page, 'machine');
  await page.click('#inspection-toggle');

  await openWorkbench(page, 'machine');
  await page.click('[data-touch-preset="heavy"]');
  const heavyTouch = await page.evaluate(() => window.__OCTOBERLINE_211__.model.getMechanicalSettings());
  invariant(heavyTouch.touchPreset === 'heavy', `Heavy touch did not reach the model: ${JSON.stringify(heavyTouch)}`);

  await page.evaluate(() => {
    const input = document.querySelector('#left-margin-control');
    input.value = '4';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const margins = await page.evaluate(() => window.__OCTOBERLINE_211__.model.getMechanicalSettings());
  invariant(margins.leftMargin === 4, `Margin control did not reach the model: ${JSON.stringify(margins)}`);

  await page.click('#quiet-mode-toggle');
  await page.waitForTimeout(1_550);
  invariant(!await page.locator('#app').evaluate((element) => element.classList.contains('quiet-writing-active')), 'Quiet mode faded before accepted typing.');
  const quietStartMarks = await page.evaluate(() => window.__OCTOBERLINE_211__.document.marks.length);
  await page.keyboard.press('KeyA');
  await page.waitForFunction((count) => window.__OCTOBERLINE_211__.document.marks.length === count + 1, quietStartMarks);
  await page.waitForFunction(() => document.querySelector('#app')?.classList.contains('quiet-writing-active'), null, { timeout: 4_000 });
  await page.mouse.move(640, 400);
  await page.waitForTimeout(1_550);
  invariant(!await page.locator('#app').evaluate((element) => element.classList.contains('quiet-writing-active')), 'Quiet mode re-faded after pointer reveal without new typing.');
  const quietResumeMarks = await page.evaluate(() => window.__OCTOBERLINE_211__.document.marks.length);
  await page.keyboard.press('KeyC');
  await page.waitForFunction((count) => window.__OCTOBERLINE_211__.document.marks.length === count + 1, quietResumeMarks);
  await page.waitForFunction(() => document.querySelector('#app')?.classList.contains('quiet-writing-active'), null, { timeout: 4_000 });
  await page.keyboard.press('Escape');
  const quiet = await page.evaluate(() => ({
    enabled: window.__OCTOBERLINE_211__.quietModeEnabled,
    faded: document.querySelector('#app')?.classList.contains('quiet-writing-active'),
    captured: window.__OCTOBERLINE_211__.keyboardCaptured,
    inputStatus: document.querySelector('#input-status')?.textContent,
  }));
  invariant(quiet.enabled && !quiet.faded && !quiet.captured && quiet.inputStatus === 'INPUT RELEASED', `Quiet-mode recovery mismatch: ${JSON.stringify(quiet)}`);

  await openWorkbench(page, 'room');
  await page.click('#atmosphere-pause');
  const paused = await page.evaluate(async () => {
    const before = window.__OCTOBERLINE_211__.room.elapsed;
    const crownBefore = { ...window.__OCTOBERLINE_211__.room.getState().pecoCrown };
    await new Promise((resolve) => setTimeout(resolve, 220));
    return {
      paused: window.__OCTOBERLINE_211__.atmospherePaused,
      before,
      after: window.__OCTOBERLINE_211__.room.elapsed,
      crownBefore,
      crownAfter: window.__OCTOBERLINE_211__.room.getState().pecoCrown,
      label: document.querySelector('#atmosphere-pause b')?.textContent,
    };
  });
  invariant(paused.paused && paused.label === 'PAUSED' && Math.abs(paused.after - paused.before) < 0.001, `Atmosphere pause mismatch: ${JSON.stringify(paused)}`);
  invariant(
    paused.crownAfter.frame === paused.crownBefore.frame
      && paused.crownAfter.scrollOffset === paused.crownBefore.scrollOffset,
    `PECO Crown Lights moved while atmosphere was paused: ${JSON.stringify(paused)}`,
  );
  await page.click('#atmosphere-pause');
  await page.waitForFunction(
    (frame) => window.__OCTOBERLINE_211__.room.getState().pecoCrown.frame > frame,
    paused.crownAfter.frame,
  );
  await page.keyboard.press('Escape');

  await page.click('#guide-open');
  await page.click('#guide-tab-future');
  const future = await page.evaluate(() => ({
    selected: document.querySelector('#guide-tab-future')?.getAttribute('aria-selected'),
    visible: !document.querySelector('#guide-page-future')?.hidden,
    links: [...document.querySelectorAll('#guide-page-future a')].map((link) => link.getAttribute('href')),
    disclosure: document.querySelector('.future-disclosure')?.textContent,
  }));
  invariant(future.selected === 'true' && future.visible, `Coming-soon tab state mismatch: ${JSON.stringify(future)}`);
  invariant(future.links.length === 2 && future.links.every((href) => href.startsWith('./coming-soon/')), `Coming-soon routes mismatch: ${JSON.stringify(future.links)}`);
  invariant(future.disclosure.includes('No account'), 'Coming-soon inactive-service disclosure is missing.');
  await page.keyboard.press('ArrowLeft');
  invariant(await page.locator('#guide-tab-research').getAttribute('aria-selected') === 'true', 'Arrow-key tab navigation did not select Research.');
  await page.keyboard.press('Escape');

  await page.click('[data-workbench=paper]');
  await page.waitForFunction(() => document.querySelector('#document-toggle')?.getAttribute('aria-expanded') === 'true');
  await openWorkbench(page, 'export');
  const paperDesk = await page.evaluate(() => ({
    cards: document.querySelectorAll('#paper-desk-list .paper-card').length,
    selected: document.querySelector('#paper-desk-list .paper-card[aria-pressed="true"]')?.dataset.pageId,
    bogusListboxRoles: document.querySelectorAll('#paper-desk-list [role="option"], #paper-desk-list[role="listbox"]').length,
    locationLabels: [...document.querySelectorAll('#paper-desk-list .paper-card-thumb')].map((item) => item.dataset.location),
    appearance: document.querySelector('#paper-export-appearance')?.value,
    resolution: document.querySelector('#paper-export-resolution')?.value,
    printLabel: document.querySelector('#print-selected-paper')?.textContent,
  }));
  invariant(paperDesk.cards >= 1 && paperDesk.selected && paperDesk.bogusListboxRoles === 0, `Paper desk selection semantics mismatch: ${JSON.stringify(paperDesk)}`);
  invariant(paperDesk.locationLabels.every(Boolean), `Paper location labels are missing: ${JSON.stringify(paperDesk.locationLabels)}`);
  invariant(paperDesk.appearance === 'original' && paperDesk.resolution === '2', `Paper export defaults mismatch: ${JSON.stringify(paperDesk)}`);
  invariant(paperDesk.printLabel.includes('SAVE PDF'), 'Native print/PDF action is not labeled clearly.');

  const exportCases = [
    { appearance: 'original', format: 'png' },
    { appearance: 'original', format: 'jpeg' },
    { appearance: 'original', format: 'webp' },
    { appearance: 'carbon-copy', format: 'png' },
  ];
  const exportFilenames = [];
  await page.selectOption('#paper-export-resolution', '1');
  for (const exportCase of exportCases) {
    await page.selectOption('#paper-export-appearance', exportCase.appearance);
    await page.selectOption('#paper-export-format', exportCase.format);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#export-selected-paper'),
    ]);
    exportFilenames.push(download.suggestedFilename());
  }
  invariant(
    exportFilenames.some((name) => name.endsWith('.png'))
      && exportFilenames.some((name) => name.endsWith('.jpeg'))
      && exportFilenames.some((name) => name.endsWith('.webp')),
    `Paper formats did not download correctly: ${JSON.stringify(exportFilenames)}`,
  );

  const popupPromise = page.waitForEvent('popup');
  await page.click('#print-selected-paper');
  const printPage = await popupPromise;
  await printPage.waitForSelector('img[alt^="Typewritten sheet"]', { timeout: 15_000 });
  await printPage.close();
  await page.evaluate(() => { window.open = () => null; });
  await page.click('#print-selected-paper');
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('ALLOW POP-UPS'));

  // Forty archived sheets must remain a lightweight summary/card operation.
  const archiveBuild = await page.evaluate(() => {
    const api = window.__OCTOBERLINE_211__;
    const started = performance.now();
    for (let index = 0; index < 40; index += 1) {
      const overview = api.lifecycle.getOverview();
      if (overview.insertedSheet) api.lifecycle.extractInsertedSheet();
      if (api.lifecycle.getOverview().looseSheet) api.lifecycle.saveLooseSheetToManuscript({ source: 'release-ui-check' });
      const content = JSON.parse(JSON.stringify(api.document.serialize()));
      content.marks = [{ line: 0, column: 0, character: String.fromCharCode(65 + (index % 26)), ink: 'black', pressure: 0.82 }];
      api.lifecycle.loadFreshSheet(content, { inkMode: 'black' });
    }
    return performance.now() - started;
  });
  await page.keyboard.press('Escape');
  // Measure browser response from the actual click, excluding automation transport.
  await page.evaluate(() => {
    document.querySelector('[data-workbench="export"]').addEventListener('click', () => {
      const started = performance.now();
      const observer = new MutationObserver(() => {
        if (document.querySelectorAll('#paper-desk-list .paper-card').length >= 40) {
          window.__paperDeskRenderMs = performance.now() - started;
          observer.disconnect();
        }
      });
      observer.observe(document.querySelector('#paper-desk-list'), { childList: true });
    }, { capture: true, once: true });
  });
  await openWorkbench(page, 'export');
  await page.waitForFunction(() => Number.isFinite(window.__paperDeskRenderMs));
  const paperDeskScale = await page.evaluate(() => ({
    renderMs: window.__paperDeskRenderMs,
    cards: document.querySelectorAll('#paper-desk-list .paper-card').length,
    cacheSize: window.__OCTOBERLINE_211__.paperThumbnailCacheSize,
  }));
  invariant(paperDeskScale.cacheSize <= 32 && paperDeskScale.renderMs < 1_500, `Paper desk does not scale safely: ${JSON.stringify({ archiveBuild, paperDeskScale })}`);
  await page.waitForFunction(
    () => [...document.querySelectorAll('#paper-desk-list .paper-card-thumb')]
      .every((thumbnail) => thumbnail.style.backgroundImage),
    null,
    { timeout: 15_000 },
  );
  const paperDeskSettled = await page.evaluate(() => ({
    paintedCards: [...document.querySelectorAll('#paper-desk-list .paper-card-thumb')]
      .filter((thumbnail) => thumbnail.style.backgroundImage).length,
    cacheSize: window.__OCTOBERLINE_211__.paperThumbnailCacheSize,
  }));
  invariant(
    paperDeskSettled.paintedCards === paperDeskScale.cards && paperDeskSettled.cacheSize <= 32,
    `Paper desk thumbnails did not settle safely: ${JSON.stringify(paperDeskSettled)}`,
  );

  invariant(errors.length === 0, `Desktop browser errors: ${errors.join(' | ')}`);
  const desktopShot = path.join(root, 'visual-checks', '12-release-ui.png');
  await page.screenshot({ path: desktopShot, animations: 'disabled' });
  report.desktop = {
    landing,
    keyPreview,
    preEntryGuide,
    guideReturn,
    entry,
    initial,
    coachTrayCollision,
    marginDragFinished,
    heavyTouch: heavyTouch.touchPreset,
    margins,
    quiet,
    paused,
    future,
    paperDesk,
    exportFilenames,
    archiveBuild,
    paperDeskScale,
    paperDeskSettled,
    screenshot: desktopShot,
  };
  await desktop.close();

  const corrupt = await browser.newContext({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 });
  await corrupt.addInitScript(() => {
    localStorage.setItem('octoberline-211-typewriter-state-v1', JSON.stringify({ touchPreset: 'future-unknown-preset' }));
  });
  const corruptPage = await corrupt.newPage();
  const corruptErrors = collectErrors(corruptPage);
  await corruptPage.goto(targetUrl, { waitUntil: 'networkidle' });
  await enterStudio(corruptPage);
  const corruptPreset = await corruptPage.evaluate(() => window.__OCTOBERLINE_211__.model.getMechanicalSettings().touchPreset);
  invariant(corruptPreset === 'medium' && corruptErrors.length === 0, `Corrupt touch preset did not migrate safely: ${JSON.stringify({ corruptPreset, corruptErrors })}`);
  report.corruptPresetFallback = corruptPreset;
  await corrupt.close();

  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
  });
  const mobilePage = await mobile.newPage();
  const mobileErrors = collectErrors(mobilePage);
  await prepare(mobilePage);
  const mobileState = await mobilePage.evaluate(() => {
    const room = window.__OCTOBERLINE_211__.room;
    const before = room.elapsed;
    room.update(1, 123);
    return {
      selectDisplay: getComputedStyle(document.querySelector('.mobile-view-menu')).display,
      viewButtonDisplay: getComputedStyle(document.querySelector('.view-button')).display,
      mobileInputDisplay: getComputedStyle(document.querySelector('.mobile-keyboard')).display,
      reducedMotion: room.getState().reducedMotion,
      elapsedStatic: room.elapsed === before,
    };
  });
  invariant(mobileState.selectDisplay === 'none' && mobileState.viewButtonDisplay !== 'none', `Mobile camera UI mismatch: ${JSON.stringify(mobileState)}`);
  invariant(mobileState.mobileInputDisplay !== 'none', `Mobile typing input is hidden: ${JSON.stringify(mobileState)}`);
  invariant(mobileState.reducedMotion && mobileState.elapsedStatic, `Reduced-motion room is not static: ${JSON.stringify(mobileState)}`);

  await openWorkbench(mobilePage, 'machine');
  const mobileMechanics = await mobilePage.evaluate(() => ({
    expanded: document.querySelector('#mobile-mechanics-toggle')?.getAttribute('aria-expanded'),
    display: getComputedStyle(document.querySelector('.mechanism-card')).display,
    closeDisplay: getComputedStyle(document.querySelector('.mechanism-card .workbench-close')).display,
    keyboardCaptured: window.__OCTOBERLINE_211__.keyboardCaptured,
  }));
  invariant(
    mobileMechanics.expanded === 'true' && mobileMechanics.display !== 'none'
      && mobileMechanics.closeDisplay !== 'none' && !mobileMechanics.keyboardCaptured,
    `Mobile mechanics panel is not accessible: ${JSON.stringify(mobileMechanics)}`,
  );
  await mobilePage.click('[data-touch-preset="heavy"]');
  invariant(await mobilePage.evaluate(() => window.__OCTOBERLINE_211__.model.getMechanicalSettings().touchPreset) === 'heavy', 'Mobile touch calibration did not reach the model.');
  await mobilePage.click('.mechanism-card .workbench-close');

  const guardedMarks = await mobilePage.evaluate(() => window.__OCTOBERLINE_211__.document.marks.length);
  await openWorkbench(mobilePage, 'room');
  const environmentGuard = await mobilePage.evaluate(() => {
    const input = document.querySelector('#mobile-input');
    const event = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: 'x' });
    const dispatched = input.dispatchEvent(event);
    return { dispatched, prevented: event.defaultPrevented, marks: window.__OCTOBERLINE_211__.document.marks.length };
  });
  invariant(environmentGuard.prevented && environmentGuard.marks === guardedMarks, `Mobile input escaped the environment panel guard: ${JSON.stringify(environmentGuard)}`);
  await mobilePage.keyboard.press('Escape');
  await mobilePage.click('#guide-open');
  const modalGuard = await mobilePage.evaluate(() => {
    const input = document.querySelector('#mobile-input');
    const event = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: 'y' });
    input.dispatchEvent(event);
    return { prevented: event.defaultPrevented, marks: window.__OCTOBERLINE_211__.document.marks.length };
  });
  invariant(modalGuard.prevented && modalGuard.marks === guardedMarks, `Mobile input escaped the modal guard: ${JSON.stringify(modalGuard)}`);
  await mobilePage.keyboard.press('Escape');
  const noPaperGuard = await mobilePage.evaluate(() => {
    const api = window.__OCTOBERLINE_211__;
    api.lifecycle.extractInsertedSheet();
    const before = api.document.marks.length;
    const input = document.querySelector('#mobile-input');
    const event = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: 'z' });
    input.dispatchEvent(event);
    return { prevented: event.defaultPrevented, before, after: api.document.marks.length };
  });
  invariant(noPaperGuard.prevented && noPaperGuard.after === noPaperGuard.before, `Mobile input escaped the no-paper guard: ${JSON.stringify(noPaperGuard)}`);
  invariant(mobileErrors.length === 0, `Mobile browser errors: ${mobileErrors.join(' | ')}`);
  const mobileShot = path.join(root, 'visual-checks', '13-release-ui-mobile.png');
  await mobilePage.screenshot({ path: mobileShot, animations: 'disabled' });
  report.mobile = { ...mobileState, mobileMechanics, environmentGuard, modalGuard, noPaperGuard, screenshot: mobileShot };
  await mobile.close();
} finally {
  await browser.close();
  await preview.close();
}

process.stdout.write(`${JSON.stringify({ targetUrl, ...report }, null, 2)}\n`);
