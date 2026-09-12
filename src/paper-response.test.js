import { describe, expect, it } from 'vitest';
import { stepPaperResponse } from './paper-response.js';

describe('loaded paper response', () => {
  it('responds to carriage movement and settles without perpetual flutter', () => {
    let state = stepPaperResponse({ position: 0, velocity: 0 }, { delta: 1 / 60, carriageDelta: 0.8 });
    expect(state.position).toBeGreaterThan(0);
    for (let i = 0; i < 480; i++) state = stepPaperResponse(state, { delta: 1 / 60 });
    expect(Math.abs(state.position)).toBeLessThan(0.00001);
    expect(Math.abs(state.velocity)).toBeLessThan(0.00001);
  });
  it('stays bounded through rapid feeds and a suspended frame', () => {
    let state = { position: 0, velocity: 0 };
    for (let i = 0; i < 600; i++) {
      state = stepPaperResponse(state, { delta: i % 30 ? 1 / 30 : 60, carriageDelta: 9, feedDelta: 2, impact: 1 });
      expect(Math.abs(state.position)).toBeLessThanOrEqual(0.035);
      expect(Number.isFinite(state.velocity)).toBe(true);
    }
  });
  it('removes decorative movement immediately for reduced motion', () => {
    expect(stepPaperResponse({ position: 0.03, velocity: 0.2 }, { delta: 1 / 60, reducedMotion: true })).toEqual({ position: 0, velocity: 0 });
  });
  it('keeps the impact response comparable on different refresh rates', () => {
    const peaks = [30, 60, 120].map(fps => {
      let state = { position: 0, velocity: 0 }, peak = 0;
      for (let i = 0; i < fps; i++) {
        state = stepPaperResponse(state, { delta: 1 / fps, impact: 0.1 * Math.exp(-20 * (i + 0.5) / fps) });
        peak = Math.max(peak, Math.abs(state.position));
      }
      return peak;
    });
    expect(Math.max(...peaks) / Math.min(...peaks)).toBeLessThan(1.2);
  });
});
