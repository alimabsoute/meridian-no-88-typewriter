import assert from 'node:assert/strict';
import { createHmac, createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createUpdatesHandler } from '../api/updates-signup.js';

// Local fixtures only: no fetch calls, Google services, credentials, or visitors.
const NOW = Date.parse('2026-09-18T12:00:00.000Z');
const SECRET = 'local-test-secret-never-a-real-credential-1234567890';
const WEBHOOK = 'https://script.google.com/macros/s/fixture-deployment/exec';
const ENV = { OCTOBERLINE_UPDATES_WEBHOOK_URL: WEBHOOK, OCTOBERLINE_UPDATES_WEBHOOK_SECRET: SECRET };
const HOST = 'octoberline211.com';
const HEADERS = { host: HOST, origin: `https://${HOST}`, 'content-type': 'application/json; charset=utf-8' };
const BODY = { email: 'reader@example.invalid', consent: 'updates-v1', source: '/', website: '' };
const SHEET_HEADERS = ['Signed up (UTC)', 'Email', 'Source page', 'Consent', 'Status', 'Request ID'];
const scriptSource = await readFile(new URL('../integrations/google-sheets/Code.gs', import.meta.url), 'utf8');
const checks = [];

async function test(name, operation) {
  try { await operation(); checks.push({ name, passed: true }); }
  catch (error) { checks.push({ name, passed: false, error: error.message, stack: error.stack }); }
}

async function invokeApi({ method = 'POST', headers = HEADERS, body = BODY, chunks, environment = ENV, upstream } = {}) {
  const calls = [];
  const request = { method, headers, body };
  if (chunks) {
    delete request.body;
    request[Symbol.asyncIterator] = async function* () { for (const chunk of chunks) yield chunk; };
  }
  const response = { headers: {}, statusCode: 0, setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, end(text) { this.text = text; } };
  const handler = createUpdatesHandler({ environment, now: () => NOW, fetchImpl: async (...args) => {
    calls.push(args);
    return upstream ? upstream(...args) : { ok: true, json: async () => ({ ok: true }) };
  } });
  await handler(request, response);
  const data = JSON.parse(response.text);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
  return { status: response.statusCode, data, headers: response.headers, calls };
}

function receiver(options = {}) {
  const rows = (options.rows ?? []).map(row => [...row]);
  const state = { rows, opened: 0, lockAttempts: 0, releases: 0, writes: 0, flushes: 0, inserts: [], formats: [], finder: [], maxRows: options.maxRows ?? 1000 };
  const settings = { OCTOBERLINE_WEBHOOK_SECRET: SECRET, OCTOBERLINE_SHEET_ID: 'fixture-private-sheet', ...(options.properties ?? {}) };
  const sheet = {
    getRange(row, column, height, width) {
      return {
        getDisplayValues() { return [options.headers ?? SHEET_HEADERS]; },
        createTextFinder(email) {
          const call = { email, row, column, height, width };
          state.finder.push(call);
          return {
            matchEntireCell(value) { call.entire = value; return this; },
            matchCase(value) { call.caseSensitive = value; return this; },
            findNext() { return rows.find(entry => call.caseSensitive ? entry[1] === email : entry[1].toLowerCase() === email.toLowerCase()) ?? null; },
          };
        },
        setNumberFormat(format) { state.formats.push(format); return this; },
        setValues(values) {
          if (options.throwWrite) throw new Error('fixture write failure');
          assert.equal(column, 1); assert.equal(height, 1); assert.equal(width, 6);
          assert.equal(row, rows.length + 2); assert.equal(values.length, 1); assert.equal(values[0].length, 6);
          state.writes++; rows.push(Array.from(values[0])); return this;
        },
      };
    },
    getLastRow() { return rows.length + 1; },
    getMaxRows() { return state.maxRows; },
    insertRowsAfter(after, count) { state.inserts.push([after, count]); state.maxRows += count; },
  };
  class FixedDate extends Date { static now() { return NOW; } }
  const context = vm.createContext({
    Date: FixedDate,
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput(text) { return { text, setMimeType(mime) { this.mime = mime; return this; } }; } },
    PropertiesService: { getScriptProperties() { return { getProperty: name => settings[name] }; } },
    Utilities: { Charset: { UTF_8: 'UTF-8' }, computeHmacSha256Signature(payload, secret, charset) {
      assert.equal(charset, 'UTF-8');
      return Array.from(createHmac('sha256', secret).update(payload).digest(), byte => byte > 127 ? byte - 256 : byte);
    } },
    LockService: { getScriptLock() { return {
      tryLock(milliseconds) { assert.equal(milliseconds, 5000); state.lockAttempts++; if (options.throwLock) throw new Error('fixture lock failure'); return options.locked !== false; },
      releaseLock() { state.releases++; },
    }; } },
    SpreadsheetApp: {
      openById(id) {
        state.opened++; assert.equal(id, 'fixture-private-sheet');
        if (options.throwOpen) throw new Error('fixture open failure');
        return { getSheetByName(name) { assert.equal(name, 'Subscribers'); return options.missingSheet ? null : sheet; } };
      },
      flush() { state.flushes++; if (options.throwFlush) throw new Error('fixture flush failure'); },
    },
  });
  vm.runInContext(scriptSource, context, { timeout: 1000 });
  return { state,
    post(contents) { context.event = contents === undefined ? undefined : { postData: { contents } }; const result = vm.runInContext('doPost(event)', context, { timeout: 1000 }); assert.equal(result.mime, 'application/json'); return JSON.parse(result.text); },
    get() { return JSON.parse(vm.runInContext('doGet()', context, { timeout: 1000 }).text); },
    safe(value) { context.cellValue = value; return vm.runInContext('safeCell_(cellValue)', context, { timeout: 1000 }); },
  };
}

function signed(entry = {}, envelope = {}) {
  const payload = JSON.stringify({ email: BODY.email, source: '/', consent: 'updates-v1', timestamp: NOW, requestId: '11111111-1111-4111-8111-111111111111', ...entry });
  return JSON.stringify({ payload, signature: createHmac('sha256', SECRET).update(payload).digest('hex'), ...envelope });
}

await test('API normalizes email and sends an exact HMAC-signed envelope', async () => {
  const result = await invokeApi({ body: { ...BODY, email: '  Reader+Tag@Example.Invalid  ', source: '/journal/' } });
  assert.equal(result.status, 200); assert.deepEqual(result.data, { ok: true }); assert.equal(result.calls.length, 1);
  const [url, options] = result.calls[0]; assert.equal(url, WEBHOOK); assert.equal(options.method, 'POST');
  assert.deepEqual(options.headers, { 'Content-Type': 'application/json' }); assert.equal(options.redirect, 'follow'); assert.ok(options.signal instanceof AbortSignal);
  const envelope = JSON.parse(options.body); assert.deepEqual(Object.keys(envelope), ['payload', 'signature']);
  assert.equal(envelope.signature, createHmac('sha256', SECRET).update(envelope.payload).digest('hex'));
  const entry = JSON.parse(envelope.payload); assert.equal(entry.email, 'reader+tag@example.invalid'); assert.equal(entry.source, '/journal/');
  assert.equal(entry.consent, 'updates-v1'); assert.equal(entry.timestamp, NOW); assert.match(entry.requestId, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
});

for (const method of ['GET', 'PUT', 'OPTIONS']) await test(`API rejects ${method} without upstream traffic`, async () => {
  const result = await invokeApi({ method }); assert.equal(result.status, 405); assert.equal(result.headers.allow, 'POST'); assert.equal(result.calls.length, 0); assert.equal(result.data.ok, false);
});
for (const media of ['text/plain', 'application/x-www-form-urlencoded', 'application/jsonp', 'application/json-invalid', '']) await test(`API rejects non-JSON media type ${media || '(missing)'}`, async () => {
  const result = await invokeApi({ headers: { ...HEADERS, 'content-type': media } }); assert.equal(result.status, 415); assert.equal(result.calls.length, 0);
});
for (const origin of ['https://evil.invalid', 'https://octoberline211.com.evil.invalid', 'https://octoberline211.com:444', 'null', 'not an origin']) await test(`API rejects foreign or malformed origin ${origin}`, async () => {
  const result = await invokeApi({ headers: { ...HEADERS, origin } }); assert.equal(result.status, 403); assert.equal(result.calls.length, 0);
});
await test('API honors the trusted forwarded host used by deployment proxies', async () => {
  const result = await invokeApi({ headers: { ...HEADERS, host: 'internal.invalid', 'x-forwarded-host': HOST } }); assert.equal(result.status, 200);
});
for (const [name, body] of [
  ['missing consent', { email: BODY.email }], ['wrong consent', { ...BODY, consent: 'yes' }],
  ['honeypot', { ...BODY, website: 'spam' }], ['missing email', { ...BODY, email: '' }],
  ['invalid email', { ...BODY, email: 'not-an-address' }], ['email whitespace', { ...BODY, email: 'reader other@example.invalid' }],
  ['oversized email', { ...BODY, email: 'a'.repeat(245) + '@example.invalid' }], ['non-string email', { ...BODY, email: ['reader@example.invalid'] }],
  ['external source', { ...BODY, source: 'https://evil.invalid/' }], ['source query', { ...BODY, source: '/?token=sample' }],
  ['oversized source', { ...BODY, source: '/' + 'a'.repeat(160) }], ['null body', null], ['malformed JSON', '{'],
]) await test(`API rejects ${name}`, async () => { const result = await invokeApi({ body }); assert.equal(result.status, 400); assert.equal(result.calls.length, 0); assert.equal(result.data.ok, false); });

await test('API rejects declared oversized content before parsing', async () => { const result = await invokeApi({ headers: { ...HEADERS, 'content-length': '2049' } }); assert.equal(result.status, 413); assert.equal(result.calls.length, 0); });
await test('API accepts exactly 2048 bytes and rejects 2049 bytes', async () => {
  const base = JSON.stringify({ ...BODY, padding: '' }); const exact = base.replace('"padding":""', '"padding":"' + 'x'.repeat(2048 - Buffer.byteLength(base)) + '"'); assert.equal(Buffer.byteLength(exact), 2048);
  const accepted = await invokeApi({ body: exact }); assert.equal(accepted.status, 200);
  const rejected = await invokeApi({ body: exact + ' ' }); assert.equal(rejected.status, 413); assert.equal(rejected.calls.length, 0);
});
await test('API streamed bodies count UTF-8 bytes and reject oversize', async () => {
  const accepted = await invokeApi({ chunks: [Buffer.from('{"email":'), Buffer.from(JSON.stringify(BODY.email) + ',"consent":"updates-v1","source":"/"}')] }); assert.equal(accepted.status, 200);
  const rejected = await invokeApi({ chunks: [Buffer.from(JSON.stringify({ ...BODY, padding: 'é'.repeat(1024) }))] }); assert.equal(rejected.status, 413); assert.equal(rejected.calls.length, 0);
});
await test('API empty streamed body returns a clean validation failure', async () => { const result = await invokeApi({ chunks: [] }); assert.equal(result.status, 400); assert.equal(result.calls.length, 0); });
for (const [name, environment] of [
  ['missing config', {}], ['missing secret', { OCTOBERLINE_UPDATES_WEBHOOK_URL: WEBHOOK }],
  ['short secret', { ...ENV, OCTOBERLINE_UPDATES_WEBHOOK_SECRET: 'short' }],
  ...['http://script.google.com/macros/s/fixture/exec', 'https://evil.invalid/macros/s/fixture/exec', 'https://script.google.com/macros/s/fixture/dev', WEBHOOK + '?x=1', WEBHOOK + '#fragment', 'invalid'].map(url => ['invalid webhook ' + url, { ...ENV, OCTOBERLINE_UPDATES_WEBHOOK_URL: url }]),
]) await test(`API returns 503 for ${name}`, async () => { const result = await invokeApi({ environment }); assert.equal(result.status, 503); assert.equal(result.calls.length, 0); assert.equal(result.data.ok, false); });

for (const [name, upstream] of [
  ['network failure', async () => { throw new Error('fixture network rejection'); }],
  ['timeout', async () => { throw new DOMException('fixture timeout', 'TimeoutError'); }],
  ['HTTP error', async () => ({ ok: false, json: async () => { throw new Error('must not parse failed HTTP response'); } })],
  ['malformed response', async () => ({ ok: true, json: async () => { throw new SyntaxError('fixture invalid JSON'); } })],
  ...[null, {}, { ok: false }, { ok: 'true' }, { success: true }].map(value => ['unconfirmed response ' + JSON.stringify(value), async () => ({ ok: true, json: async () => value })]),
]) await test(`API never succeeds after ${name}`, async () => { const result = await invokeApi({ upstream }); assert.equal(result.status, 502); assert.equal(result.data.ok, false); assert.equal(result.calls.length, 1); });

await test('API-to-Apps-Script integration appends exactly one confirmed six-cell row', async () => {
  const target = receiver(); let entry;
  const result = await invokeApi({ body: { ...BODY, email: ' Reader@Example.Invalid ', source: '/updates/' }, upstream: async (url, options) => {
    entry = JSON.parse(JSON.parse(options.body).payload); return { ok: true, json: async () => target.post(options.body) };
  } });
  assert.equal(result.status, 200); assert.equal(target.state.writes, 1); assert.equal(target.state.flushes, 1); assert.equal(target.state.releases, 1);
  assert.deepEqual(target.state.rows, [[new Date(NOW).toISOString(), 'reader@example.invalid', '/updates/', 'updates-v1', 'Subscribed', entry.requestId]]);
  assert.deepEqual(target.state.formats, ['@']);
});
await test('Apps Script rejects unsigned, tampered, and malformed envelopes before touching the sheet', async () => {
  for (const contents of [undefined, '', '{', '{}', signed({}, { signature: '0'.repeat(64) }), signed({}, { signature: 'a'.repeat(63) }), signed({}, { payload: '{}' }), 'x'.repeat(4097)]) {
    const target = receiver(); assert.equal(target.post(contents).ok, false); assert.equal(target.state.opened, 0); assert.equal(target.state.lockAttempts, 0); assert.equal(target.state.writes, 0);
  }
});
await test('Apps Script rejects signed invalid fields and stale/future requests', async () => {
  for (const entry of [{ email: 'bad' }, { email: 4 }, { consent: 'other' }, { timestamp: NOW - 300001 }, { timestamp: NOW + 300001 }, { timestamp: 'now' }, { source: 'https://evil.invalid/' }, { source: '/' + 'a'.repeat(160) }, { requestId: 'invalid' }]) {
    const target = receiver(); assert.equal(target.post(signed(entry)).ok, false); assert.equal(target.state.opened, 0); assert.equal(target.state.writes, 0);
  }
});
await test('Apps Script missing properties and GET never expose or append subscriber data', async () => {
  for (const properties of [{ OCTOBERLINE_WEBHOOK_SECRET: '' }, { OCTOBERLINE_WEBHOOK_SECRET: 'short' }, { OCTOBERLINE_SHEET_ID: '' }]) {
    const target = receiver({ properties }); assert.equal(target.post(signed()).ok, false); assert.equal(target.state.opened, 0); assert.equal(target.get().ok, false);
  }
});
await test('Apps Script deduplicates email case-insensitively inside the lock', async () => {
  const target = receiver({ rows: [[new Date(NOW).toISOString(), 'READER@EXAMPLE.INVALID', '/', 'updates-v1', 'Subscribed', 'prior-request']] });
  assert.equal(target.post(signed()).ok, true); assert.equal(target.state.rows.length, 1); assert.equal(target.state.writes, 0); assert.equal(target.state.releases, 1);
  assert.equal(target.state.finder[0].entire, true); assert.equal(target.state.finder[0].caseSensitive, false); assert.equal(target.state.finder[0].column, 2);
});
await test('Apps Script formula prefixes are escaped and every written cell is plain text', async () => {
  const target = receiver(); assert.equal(target.post(signed({ email: '=2+2@example.invalid' })).ok, true);
  assert.equal(target.state.rows[0][1], "'=2+2@example.invalid"); assert.deepEqual(target.state.formats, ['@']);
  for (const prefix of ['=', '+', '-', '@', '\t', '\r']) assert.equal(target.safe(prefix + 'formula'), "'" + prefix + 'formula');
  assert.equal(target.safe('ordinary text'), 'ordinary text');
});
await test('Apps Script grows a full sheet before one append', async () => {
  const target = receiver({ maxRows: 1 }); assert.equal(target.post(signed()).ok, true); assert.deepEqual(target.state.inserts, [[1, 100]]); assert.equal(target.state.writes, 1); assert.equal(target.state.releases, 1);
});
for (const [name, options, releases, writes] of [
  ['lock contention', { locked: false }, 0, 0], ['lock exception', { throwLock: true }, 0, 0],
  ['open failure', { throwOpen: true }, 1, 0], ['missing sheet', { missingSheet: true }, 1, 0],
  ['wrong headers', { headers: ['unexpected'] }, 1, 0], ['append failure', { throwWrite: true }, 1, 0], ['flush failure', { throwFlush: true }, 1, 1],
]) await test(`Apps Script fails closed and releases any held lock after ${name}`, async () => {
  const target = receiver(options); assert.equal(target.post(signed()).ok, false); assert.equal(target.state.releases, releases); assert.equal(target.state.writes, writes);
});

const sourceFiles = ['api/updates-signup.js', 'integrations/google-sheets/Code.gs'];
const sourceSha256 = Object.fromEntries(await Promise.all(sourceFiles.map(async path => [path, createHash('sha256').update(await readFile(new URL('../' + path, import.meta.url))).digest('hex')])));
const result = { recordedAt: new Date().toISOString(), method: 'Node-native assertions; injected local HTTP stubs and VM-hosted Apps Script service mocks', passCount: checks.filter(check => check.passed).length, failCount: checks.filter(check => !check.passed).length, passed: checks.every(check => check.passed), sourceSha256, limitations: ['No Google resources were created, contacted, connected or changed.', 'Does not verify deployed credentials, Google authorization, actual Sheets cell semantics, production host headers or live network behavior.'], checks };
await mkdir(new URL('../visual-checks/', import.meta.url), { recursive: true });
await writeFile(new URL('../visual-checks/updates-signup-native.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ passed: result.passed, passCount: result.passCount, failCount: result.failCount, failures: checks.filter(check => !check.passed).map(({ name, error }) => ({ name, error })) }));
if (!result.passed) process.exitCode = 1;
