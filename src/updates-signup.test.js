import { describe, expect, it, vi } from 'vitest';
import { mountUpdatesSignup, requestUpdatesSignup, validateUpdatesEmail } from './updates-signup.js';

const response = (ok, body) => ({ ok, json: async () => body });

describe('updates signup request', () => {
  it('validates email before any request and trims deliberate submissions', async () => {
    const fetchImpl = vi.fn(async () => response(true, { ok: true }));
    expect(validateUpdatesEmail('reader+notes@example.org')).toBe(true);
    expect(validateUpdatesEmail('reader@example')).toBe(false);
    await expect(requestUpdatesSignup({ email: 'not an email', fetchImpl })).rejects.toThrow('valid email');
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(requestUpdatesSignup({ email: '  reader@example.org  ', source: '/coming-soon/community/', fetchImpl })).resolves.toEqual({ ok: true });
    const [url, request] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/updates-signup');
    expect(request.method).toBe('POST');
    expect(JSON.parse(request.body)).toEqual({ email: 'reader@example.org', source: '/coming-soon/community/', website: '', consent: 'updates-v1' });
    expect(request.redirect).toBe('error');
  });

  it('requires both HTTP success and an explicit confirmed acknowledgement', async () => {
    for (const [httpOk, body] of [[true, {}], [true, { ok: false }], [false, { ok: true }]]) {
      await expect(requestUpdatesSignup({ email: 'reader@example.org', fetchImpl: async () => response(httpOk, body) })).rejects.toThrow();
    }
  });

  it('surfaces a real server failure without inventing a saved subscription', async () => {
    await expect(requestUpdatesSignup({ email: 'reader@example.org', fetchImpl: async () => response(false, { ok: false, error: 'Signups are temporarily unavailable.' }) })).rejects.toThrow('Signups are temporarily unavailable.');
  });

  it('does not treat HTML or an empty proxy response as success', async () => {
    await expect(requestUpdatesSignup({ email: 'reader@example.org', fetchImpl: async () => ({ ok: true, json: async () => { throw new SyntaxError('HTML'); } }) })).rejects.toThrow('couldn’t confirm');
  });

  it('reports an interrupted connection and aborts a slow save', async () => {
    await expect(requestUpdatesSignup({ email: 'reader@example.org', fetchImpl: async () => { throw new TypeError('Failed to fetch'); } })).rejects.toThrow('Check your connection');
    const fetchImpl = vi.fn((url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))));
    await expect(requestUpdatesSignup({ email: 'reader@example.org', fetchImpl, timeoutMs: 5 })).rejects.toThrow('took too long');
    expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
  });
});

function uiFixture(fetchImpl, { protocol = 'https:', reducedMotion = true } = {}) {
  function element() {
    return {
      dataset: {}, value: '', disabled: false, textContent: '', events: {}, attributes: {}, children: [],
      style: { setProperty: vi.fn() }, classList: { add: vi.fn() },
      addEventListener(type, handler) { this.events[type] = handler; },
      setAttribute(name, value) { this.attributes[name] = value; },
      removeAttribute(name) { delete this.attributes[name]; },
      focus: vi.fn(), getBoundingClientRect: () => ({ height: 90 }),
      replaceChildren() { this.children = []; }, append(item) { this.children.push(item); },
    };
  }
  const ids = Object.fromEntries(['app', 'updates-rail', 'updates-form', 'updates-email', 'updates-website', 'updates-submit', 'updates-status', 'updates-receipt'].map(id => [id, element()]));
  const label = element(); const confetti = element(); const done = element(); const close = element();
  ids['updates-submit'].querySelector = () => label;
  ids['updates-form'].reportValidity = () => true;
  ids['updates-form'].reset = () => { ids['updates-email'].value = ''; };
  ids['updates-receipt'].querySelector = selector => selector === '.updates-confetti' ? confetti : done;
  ids['updates-receipt'].querySelectorAll = () => [done, close];
  ids['updates-receipt'].showModal = vi.fn(); ids['updates-receipt'].close = vi.fn();
  const documentRef = { getElementById: id => ids[id], body: element(), documentElement: element(), activeElement: ids['updates-email'], createElement: element };
  const windowRef = { location: { protocol, pathname: '/studio' }, fetch: fetchImpl, addEventListener: vi.fn(), matchMedia: () => ({ matches: reducedMotion }) };
  mountUpdatesSignup(documentRef, windowRef);
  return { ids, label, confetti, done, close, submit: () => ids['updates-form'].events.submit({ preventDefault() {} }) };
}

describe('updates signup presentation', () => {
  it('blocks duplicate submissions and waits for a confirmed save before celebrating', async () => {
    let finish;
    const fetchImpl = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const ui = uiFixture(fetchImpl);
    ui.ids['updates-email'].value = 'reader@example.org';
    const first = ui.submit();
    await ui.submit();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(ui.ids['updates-submit'].disabled).toBe(true);
    expect(ui.ids['updates-receipt'].showModal).not.toHaveBeenCalled();
    finish(response(true, { ok: true }));
    await first;
    expect(ui.ids['updates-receipt'].showModal).toHaveBeenCalledTimes(1);
    expect(ui.ids['updates-status'].textContent).toContain('on the list');
    expect(ui.ids['updates-submit'].disabled).toBe(false);
    expect(ui.confetti.children).toHaveLength(0);
    expect(ui.ids['updates-email'].value).toBe('');
  });

  it('keeps the email for retry and never opens a success popup on server failure', async () => {
    const ui = uiFixture(async () => response(false, { ok: false, error: 'Signups are temporarily unavailable.' }));
    ui.ids['updates-email'].value = 'reader@example.org';
    await ui.submit();
    expect(ui.ids['updates-email'].value).toBe('reader@example.org');
    expect(ui.ids['updates-receipt'].showModal).not.toHaveBeenCalled();
    expect(ui.ids['updates-status'].dataset.error).toBe('true');
    expect(ui.ids['updates-submit'].disabled).toBe(false);
  });

  it('keeps standalone file mode offline and isolates signup keystrokes from the machine', () => {
    const fetchImpl = vi.fn();
    const ui = uiFixture(fetchImpl, { protocol: 'file:' });
    expect(ui.ids['updates-submit'].disabled).toBe(true);
    expect(ui.ids['updates-status'].textContent).toContain('octoberline211.com');
    expect(fetchImpl).not.toHaveBeenCalled();
    const event = { stopPropagation: vi.fn() };
    ui.ids['updates-rail'].events.keydown(event);
    expect(event.stopPropagation).toHaveBeenCalledOnce();
  });
});
