import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function fixture() {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, {
      dataset: {}, attributes: {}, textContent: '', disabled: false,
      classList: { add: vi.fn(), remove: vi.fn() },
      setAttribute(name, value) { this.attributes[name] = value; },
      removeAttribute(name) { delete this.attributes[name]; },
      close: vi.fn(), querySelector() { return get(`${id}-label`); },
    });
    return elements.get(id);
  };
  const window = { addEventListener: vi.fn() };
  runInNewContext(readFileSync(new URL('./landing-bootstrap.js', import.meta.url), 'utf8'), {
    window, document: { getElementById: get, addEventListener: vi.fn() },
    requestAnimationFrame: cb => cb(), setTimeout: cb => cb(), location: { reload: vi.fn() },
  });
  return { landing: window.__OCTOBERLINE_LANDING__, get, window };
}

describe('landing loading feedback', () => {
  it('shows activity without inventing a percentage, then completes on readiness', () => {
    const { landing, get } = fixture();
    landing.progress('Preparing the scene');
    expect(get('intro-loading').dataset.state).toBe('loading');
    expect(get('intro-loading-bar').attributes['aria-valuenow']).toBeUndefined();
    landing.previewReady();
    expect(get('intro-loading-bar').attributes['aria-valuenow']).toBe('100');
    expect(get('intro-load-status').textContent).toContain('Preview ready');
  });
  it('restarts activity on early entry and ignores late preview completion', () => {
    const { landing, get } = fixture();
    landing.previewReady();
    landing.start();
    landing.previewReady();
    landing.previewUnavailable();
    expect(get('intro-loading').dataset.state).toBe('loading');
    expect(get('intro-load-status').textContent).toBe('Opening your writing room…');
    expect(get('intro-loading-bar').attributes['aria-valuenow']).toBeUndefined();
    landing.finish();
    expect(get('intro-loading').dataset.state).toBe('ready');
  });
  it('stops the bar and makes retry available on failure', () => {
    const { landing, get } = fixture();
    landing.start();
    landing.fail('Could not open');
    expect(get('intro-loading-bar').hidden).toBe(true);
    expect(get('enter-studio').disabled).toBe(false);
    expect(get('intro-load-status').attributes.role).toBe('alert');
  });
  it('keeps entry available if only the decorative preview fails', () => {
    const { landing, get } = fixture();
    landing.previewUnavailable();
    expect(get('intro-loading-bar').hidden).toBe(true);
    expect(landing.status).toBe('idle');
    landing.start();
    expect(get('intro-loading-bar').hidden).toBe(false);
    expect(landing.status).toBe('loading');
  });
  it('does not leave an endless loader when startup fails before the first click', () => {
    const { landing, get, window } = fixture();
    window.addEventListener.mock.calls.find(([name]) => name === 'unhandledrejection')[1]({ type: 'unhandledrejection' });
    expect(landing.status).toBe('error');
    expect(get('intro-loading-bar').hidden).toBe(true);
    expect(get('enter-studio').disabled).toBe(false);
  });
});
