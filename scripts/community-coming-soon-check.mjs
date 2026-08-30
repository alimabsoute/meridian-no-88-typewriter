import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_PREVIEW_URL,
  ensurePreviewServer,
  launchBrowser,
} from './browser-test-helpers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configuredTargetUrl = process.env.OCTOBERLINE_COMMUNITY_PREVIEW_URL
  || new URL('coming-soon/community/', DEFAULT_PREVIEW_URL).href;
const preview = await ensurePreviewServer({ targetUrl: configuredTargetUrl });
const targetUrl = preview.targetUrl;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

const browser = await launchBrowser();
let report;

try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const page = await desktop.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto(targetUrl, { waitUntil: 'networkidle' });
  invariant(await page.title() === 'Community Machine Profiles — Octoberline 211', 'Unexpected community preview title.');
  invariant(await page.locator('.machine-card').count() === 3, 'Expected three sample machine cards.');
  invariant(await page.locator('.sample-tab').count() === 3, 'Every machine card must be marked SAMPLE.');
  invariant((await page.locator('body').innerText()).includes('No accounts, submissions, uploads, or public profiles are active.'), 'Missing inactive-feature disclosure.');

  await page.locator('[data-filter="standard"]').click();
  invariant(await page.locator('.machine-card:visible').count() === 1, 'Standard filter did not produce one sample record.');
  invariant((await page.locator('#registry-count').innerText()).startsWith('1 fictional'), 'Filter status did not update.');
  await page.locator('[data-filter="all"]').click();

  await page.locator('[data-profile="olympia"]').click();
  invariant(await page.locator('#profile-dialog').isVisible(), 'Sample profile dialog did not open.');
  invariant((await page.locator('#profile-title').innerText()) === 'Olympia SM3', 'Sample profile content did not populate.');
  await page.keyboard.press('Escape');
  invariant(!(await page.locator('#profile-dialog').isVisible()), 'Escape did not close profile dialog.');
  invariant(errors.length === 0, `Browser errors: ${errors.join(' | ')}`);
  await page.screenshot({ path: path.join(root, 'coming-soon', 'community', 'community-preview-desktop.png'), fullPage: true });
  await desktop.close();

  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
  });
  const mobilePage = await mobile.newPage();
  await mobilePage.goto(targetUrl, { waitUntil: 'networkidle' });
  invariant(await mobilePage.locator('.button-primary').first().isVisible(), 'Mobile primary action is not visible.');
  const motion = await mobilePage.locator('.hero-specimen img').evaluate((element) => getComputedStyle(element).animationDuration);
  invariant(['0.00001s', '1e-05s', '0s'].includes(motion), `Reduced-motion override is inactive: ${motion}`);
  await mobilePage.screenshot({ path: path.join(root, 'coming-soon', 'community', 'community-preview-mobile.png'), fullPage: true });
  await mobile.close();

  report = {
    targetUrl,
    sampleRecords: 3,
    filtering: 'passed',
    sampleDialog: 'passed',
    inactiveServiceDisclosure: 'present',
    reducedMotion: 'static',
    screenshots: ['community-preview-desktop.png', 'community-preview-mobile.png'],
  };
} finally {
  await browser.close();
  await preview.close();
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
