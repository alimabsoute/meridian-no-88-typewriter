import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_PREVIEW_URL,
  ensurePreviewServer,
  launchBrowser,
} from '../../scripts/browser-test-helpers.mjs';

const previewDir = path.dirname(fileURLToPath(import.meta.url));
const configuredTargetUrl = process.env.OCTOBERLINE_BOARD_PREVIEW_URL
  || new URL('coming-soon/writing-board/', DEFAULT_PREVIEW_URL).href;
const preview = await ensurePreviewServer({ targetUrl: configuredTargetUrl });
const targetUrl = preview.targetUrl;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function collectErrors(page) {
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

const browser = await launchBrowser();
const report = { targetUrl };

try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const page = await desktop.newPage();
  const errors = collectErrors(page);

  await page.goto(targetUrl, { waitUntil: 'networkidle' });
  invariant(await page.title() === 'Octoberline 211 — Public Writing Board Concept', 'Unexpected page title.');
  invariant(await page.locator('text=CONCEPT PREVIEW · NO PUBLISHING ACTIVE').first().isVisible(), 'Missing nonfunctional preview notice.');
  invariant(await page.locator('.writing-card').count() === 6, 'Expected six fictional sample cards.');
  invariant(await page.locator('.writing-card .card-meta b').allTextContents().then((labels) => labels.every((label) => label === 'SAMPLE')), 'A sample card is not labeled SAMPLE.');
  invariant(await page.locator('.trust-grid article').count() === 6, 'Expected six trust specification cards.');
  invariant(await page.locator('.rollout-line article').count() === 4, 'Expected four rollout stages.');

  await page.locator('[data-filter="poetry"]').click();
  invariant(await page.locator('.writing-card:visible').count() === 1, 'Poetry filter should show one sample.');
  invariant(await page.locator('[data-filter="poetry"]').getAttribute('aria-pressed') === 'true', 'Filter state is not exposed to assistive technology.');
  await page.locator('[data-filter="all"]').click();

  await page.locator('.flow-step[data-step="4"] button').click();
  invariant(await page.locator('#flow-detail-4').isVisible(), 'Final confirmation panel did not open.');
  invariant(await page.locator('#flow-detail-4 button').isDisabled(), 'Preview publish action must remain disabled.');
  await page.locator('.flow-step[data-step="1"] button').click();
  invariant(errors.length === 0, `Browser errors: ${errors.join(' | ')}`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);

  const desktopPath = path.join(previewDir, 'writing-board-desktop.png');
  await page.screenshot({ path: desktopPath, fullPage: true });
  report.desktop = path.basename(desktopPath);
  await desktop.close();

  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
  });
  const mobilePage = await mobile.newPage();
  const mobileErrors = collectErrors(mobilePage);
  await mobilePage.goto(targetUrl, { waitUntil: 'networkidle' });
  invariant(await mobilePage.locator('.hero-actions').isVisible(), 'Mobile actions are not visible.');
  const motion = await mobilePage.locator('.paper-sheet').evaluate((element) => getComputedStyle(element).animationName);
  invariant(motion === 'none', `Paper motion remains active in reduced-motion mode: ${motion}`);
  invariant(mobileErrors.length === 0, `Mobile browser errors: ${mobileErrors.join(' | ')}`);
  const mobilePath = path.join(previewDir, 'writing-board-mobile.png');
  await mobilePage.screenshot({ path: mobilePath, fullPage: true });
  report.mobile = path.basename(mobilePath);
  report.reducedMotion = 'static';
  await mobile.close();
} finally {
  await browser.close();
  await preview.close();
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
