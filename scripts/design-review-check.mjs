import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './browser-test-helpers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targetUrl = process.env.OCTOBERLINE_DESIGN_REVIEW_URL
  || 'http://127.0.0.1:4178/design-review/';

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
  invariant(await page.title() === 'Octoberline 211 — Identity & Homepage Review', 'Unexpected review-page title.');
  invariant(await page.locator('.identity-option').count() === 3, 'Expected three logo choices.');
  invariant(await page.locator('.identity-option[aria-checked="true"]').getAttribute('data-logo') === 'carbon', 'Approved Carbon Mark should be selected initially.');
  await page.locator('[data-logo="plate"]').click();
  invariant(await page.locator('.home-brand').getAttribute('data-selected-logo') === 'plate', 'Homepage logo preview did not update.');
  await page.locator('[data-logo="carbon"]').click();
  invariant(await page.locator('.home-brand').getAttribute('data-selected-logo') === 'carbon', 'Homepage logo preview did not return to the approved Carbon Mark.');
  invariant(await page.locator('.home-primary').isVisible(), 'Primary homepage action is not visible.');
  invariant(await page.locator('.home-secondary').isVisible(), 'Secondary homepage action is not visible.');
  invariant(errors.length === 0, `Browser errors: ${errors.join(' | ')}`);
  await page.screenshot({ path: path.join(root, 'design-review', 'octoberline-review-desktop.png'), fullPage: true });
  await page.locator('.homepage-section').screenshot({
    path: path.join(root, 'design-review', 'octoberline-homepage-review.png'),
  });
  await page.locator('.homepage-frame').screenshot({
    path: path.join(root, 'design-review', 'octoberline-homepage-frame.png'),
  });
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
  invariant(await mobilePage.locator('.home-primary').isVisible(), 'Mobile primary action is not visible.');
  const animationName = await mobilePage.locator('.leaf-one').evaluate((element) => getComputedStyle(element).animationName);
  invariant(animationName === 'none', `Reduced-motion leaf animation is still active: ${animationName}`);
  await mobilePage.screenshot({ path: path.join(root, 'design-review', 'octoberline-review-mobile.png'), fullPage: true });
  await mobile.close();

  report = {
    targetUrl,
    logoOptions: 3,
    desktop: 'octoberline-review-desktop.png',
    homepage: 'octoberline-homepage-review.png',
    homepageFrame: 'octoberline-homepage-frame.png',
    mobile: 'octoberline-review-mobile.png',
    reducedMotion: 'static',
  };
} finally {
  await browser.close();
}

process.stdout.write(JSON.stringify(report, null, 2));
process.exit(0);
