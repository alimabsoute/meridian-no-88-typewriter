import { createHmac, randomUUID } from 'node:crypto';

const MAX_BYTES = 2048;
const CONSENT = 'updates-v1';
const validEmail = (value) => typeof value === 'string' && value.length <= 254
  && /^[A-Z0-9.!#$%&'*+\-/=?^_`{|}~]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,63}$/i.test(value);

async function readBody(request) {
  if (Number(request.headers?.['content-length']) > MAX_BYTES) throw new Error('too-large');
  if (request.body !== undefined) {
    const raw = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
    if (Buffer.byteLength(raw) > MAX_BYTES) throw new Error('too-large');
    return JSON.parse(raw);
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > MAX_BYTES) throw new Error('too-large');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Dependency injection keeps tests local and prevents fixture email addresses
 * from being written into a real list. Credentials stay on the server. */
export function createUpdatesHandler({ environment = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  return async (request, response) => {
    const send = (status, body) => {
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.statusCode = status;
      response.end(JSON.stringify(body));
    };
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      return send(405, { ok: false, error: 'Please use the signup form.' });
    }
    const mediaType = String(request.headers?.['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase();
    if (mediaType !== 'application/json') {
      return send(415, { ok: false, error: 'Please use the signup form.' });
    }
    const origin = request.headers?.origin;
    const forwardedHost = request.headers?.['x-forwarded-host'] ?? request.headers?.host;
    if (origin) {
      let originHost;
      try { originHost = new URL(origin).host; } catch { return send(403, { ok: false, error: 'Please sign up on Octoberline.' }); }
      if (originHost !== forwardedHost) return send(403, { ok: false, error: 'Please sign up on Octoberline.' });
    }
    let body;
    try { body = await readBody(request); }
    catch (error) { return send(error.message === 'too-large' ? 413 : 400, { ok: false, error: 'Please enter a valid email address.' }); }
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const source = typeof body?.source === 'string' ? body.source : '/';
    if (!validEmail(email) || body?.consent !== CONSENT || body?.website
      || !/^\/[a-z0-9/_\-.]*$/i.test(source) || source.length > 160) {
      return send(400, { ok: false, error: 'Please enter a valid email address and try again.' });
    }
    const webhook = environment.OCTOBERLINE_UPDATES_WEBHOOK_URL;
    const secret = environment.OCTOBERLINE_UPDATES_WEBHOOK_SECRET;
    const format = environment.OCTOBERLINE_UPDATES_WEBHOOK_FORMAT || 'signed';
    if (!webhook || !['signed', 'pulse'].includes(format) || (format === 'signed' && (!secret || secret.length < 32))) {
      return send(503, { ok: false, error: 'Signups are not connected yet. Please try again later.' });
    }
    // The URL is server configuration, but reject accidental arbitrary targets
    // and development deployments before transmitting a visitor's email.
    let endpoint;
    try { endpoint = new URL(webhook); } catch { return send(503, { ok: false, error: 'Signups are temporarily unavailable.' }); }
    if (endpoint.protocol !== 'https:' || endpoint.hostname !== 'script.google.com'
      || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint.pathname) || endpoint.search || endpoint.hash) {
      return send(503, { ok: false, error: 'Signups are temporarily unavailable.' });
    }
    const payload = JSON.stringify({ email, source, consent: CONSENT, timestamp: now(), requestId: randomUUID() });
    // Pulse's existing private collector accepts three plain JSON fields. It
    // still needs an explicit saved-row response; redirects/HTML are not saves.
    const upstreamBody = format === 'pulse' ? {
      email: /^[=+\-@]/.test(email) ? `'${email}` : email,
      source: `Octoberline 211 ${source}`,
      userAgent: `Browser: ${String(request.headers?.['user-agent'] ?? '').slice(0, 240)}`,
    } : { payload, signature: createHmac('sha256', secret).update(payload).digest('hex') };
    try {
      const result = await fetchImpl(endpoint.href, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(upstreamBody), redirect: 'follow', signal: AbortSignal.timeout(10000),
      });
      if (!result.ok) throw new Error('upstream');
      const confirmation = await result.json();
      if (confirmation?.ok !== true) throw new Error('upstream');
      return send(200, { ok: true });
    } catch {
      // Never log a visitor's email, secret, request body, or upstream response.
      // An error never produces confetti or a false saved-email claim.
      return send(502, { ok: false, error: 'We couldn’t save your email. Please try again in a moment.' });
    }
  };
}

export default createUpdatesHandler();
