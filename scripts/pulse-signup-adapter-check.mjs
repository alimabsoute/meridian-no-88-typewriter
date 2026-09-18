import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createUpdatesHandler } from '../api/updates-signup.js';

const environment = { OCTOBERLINE_UPDATES_WEBHOOK_URL: 'https://script.google.com/macros/s/fixture-only/exec', OCTOBERLINE_UPDATES_WEBHOOK_FORMAT: 'pulse' };
const checks = [];
async function run({ confirmation = { ok: true }, upstreamOk = true, upstreamError = false, overrides = {}, email = 'Writer@example.com', origin = 'https://octoberline211.com' } = {}) {
  let sent = null;
  const handler = createUpdatesHandler({ environment: { ...environment, ...overrides }, fetchImpl: async (url, options) => {
    sent = { url, ...options, body: JSON.parse(options.body) };
    if (upstreamError) throw new Error('fixture network failure');
    return { ok: upstreamOk, json: async () => { if (confirmation === 'html') throw new Error('not JSON'); return confirmation; } };
  } });
  const response = { headers: {}, setHeader(name, value) { this.headers[name] = value; }, end(body) { this.body = JSON.parse(body); } };
  await handler({ method: 'POST', headers: { 'content-type': 'application/json', origin, host: 'octoberline211.com', 'user-agent': 'Fixture Browser' }, body: { email, source: '/studio', consent: 'updates-v1', website: '' } }, response);
  return { response, sent };
}
async function check(name, fn) { await fn(); checks.push({ name, passed: true }); }
await check('existing collector receives its exact three-field contract with a distinct Octoberline source', async () => {
  const { response, sent } = await run(); assert.equal(response.statusCode, 200);
  assert.deepEqual(sent.body, { email: 'writer@example.com', source: 'Octoberline 211 /studio', userAgent: 'Browser: Fixture Browser' });
  assert.equal(sent.redirect, 'follow'); assert(sent.signal); assert.equal(response.headers['Cache-Control'], 'no-store');
});
for (const confirmation of [{}, { ok: false }, { success: true }, 'html']) await check('unconfirmed receiver output fails closed: ' + JSON.stringify(confirmation), async () => {
  const { response } = await run({ confirmation }); assert.equal(response.statusCode, 502); assert.equal(response.body.ok, false);
});
await check('upstream HTTP and network failures never produce success', async () => {
  assert.equal((await run({ upstreamOk: false })).response.statusCode, 502);
  assert.equal((await run({ upstreamError: true })).response.statusCode, 502);
});
await check('signed collector still requires its secret and never silently downgrades', async () => {
  const { response, sent } = await run({ overrides: { OCTOBERLINE_UPDATES_WEBHOOK_FORMAT: 'signed' } }); assert.equal(response.statusCode, 503); assert.equal(sent, null);
});
await check('unknown formats and arbitrary endpoints cannot receive emails', async () => {
  for (const overrides of [{ OCTOBERLINE_UPDATES_WEBHOOK_FORMAT: 'unknown' }, { OCTOBERLINE_UPDATES_WEBHOOK_URL: 'https://example.com/collect' }]) {
    const { response, sent } = await run({ overrides }); assert.equal(response.statusCode, 503); assert.equal(sent, null);
  }
});
await check('offsite origins and invalid addresses never reach the collector', async () => {
  assert.equal((await run({ origin: 'https://example.com' })).sent, null);
  assert.equal((await run({ email: 'invalid' })).sent, null);
});
await check('plain sheet fields cannot begin with a spreadsheet formula', async () => {
  const { sent } = await run({ email: '=writer@example.com' }); assert.equal(sent.body.email, "'=writer@example.com");
  assert(!/^[=+\-@]/.test(sent.body.source)); assert(!/^[=+\-@]/.test(sent.body.userAgent));
});
const report = { checkedAt: new Date().toISOString(), evidence: 'Local mocked HTTP contract only; no real collector was configured or written', checks, passed: true };
await mkdir('visual-checks', { recursive: true }); await writeFile('visual-checks/pulse-signup-adapter-native.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
