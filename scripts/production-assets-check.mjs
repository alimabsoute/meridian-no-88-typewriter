import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const targetUrl = process.env.TARGET_URL || 'https://octoberline211.com/';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const paths = ['index.html', 'media/philly-tv.mp4', 'media/philly-tv-poster.jpg', 'media/philly-wall-art.png'];
const report = { targetUrl, sourceSha: process.env.GITHUB_SHA || null, checkedAt: new Date().toISOString(), assets: [] };
await mkdir('visual-checks/production', { recursive: true });
try {
  for (const path of paths) {
    const url = new URL(path === 'index.html' ? './' : path, targetUrl);
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200, `${path} must be available`);
    const live = Buffer.from(await response.arrayBuffer());
    const local = await readFile(`dist/${path}`);
    const sha256 = digest(live);
    assert.equal(sha256, digest(local), `Production must match this release: ${path}`);
    report.assets.push({ path, bytes: live.length, sha256, status: response.status });
  }
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = error.message;
  throw error;
} finally {
  await writeFile('visual-checks/production/asset-parity.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
