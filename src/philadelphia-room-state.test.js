import { describe, expect, it } from 'vitest';
import {
  AdaptiveQualityGovernor,
  chooseInitialQuality,
  computeEveningPalette,
  computeUneaseSignal,
  normalizeQualityMode,
  normalizeUneaseLevel,
  normalizeWeatherPreset,
  resolveWeatherTargets,
} from './philadelphia-room-state.js';

describe('Philadelphia room atmosphere state', () => {
  it('normalizes external configuration to safe presets', () => {
    expect(normalizeWeatherPreset('RAIN')).toBe('rain');
    expect(normalizeWeatherPreset("Nor'easter")).toBe('nor-easter');
    expect(normalizeWeatherPreset('noreaster')).toBe('nor-easter');
    expect(normalizeWeatherPreset('hail')).toBe('quiet');
    expect(normalizeUneaseLevel('Unsettling')).toBe('unsettling');
    expect(normalizeUneaseLevel('extreme')).toBe('off');
    expect(normalizeQualityMode('HIGH')).toBe('high');
    expect(normalizeQualityMode('cinematic')).toBe('auto');
  });

  it('models a nor-easter as windy mixed precipitation', () => {
    expect(resolveWeatherTargets('nor-easter')).toMatchObject({
      rain: 0.72,
      snow: 0.42,
      wind: 0.96,
      cloud: 1,
    });
  });

  it('keeps automatic weather deterministic and eases between conditions', () => {
    expect(resolveWeatherTargets('automatic', 0, 360)).toMatchObject({ rain: 0, snow: 0 });
    expect(resolveWeatherTargets('automatic', 100, 360)).toMatchObject({ rain: 1, snow: 0 });
    expect(resolveWeatherTargets('automatic', 280, 360)).toMatchObject({ rain: 0, snow: 1 });
    const transition = resolveWeatherTargets('automatic', 62.5, 360);
    expect(transition.rain).toBeGreaterThan(0);
    expect(transition.rain).toBeLessThan(1);
  });

  it('preserves readable light through blue hour', () => {
    const early = computeEveningPalette(0, 1);
    const late = computeEveningPalette(1, 1);
    expect(late.windowIntensity).toBeGreaterThan(0.7);
    expect(late.warmIntensity).toBeGreaterThan(early.warmIntensity);
    expect(late.skyTop[2]).toBeGreaterThan(late.skyTop[0]);
  });

  it('never introduces unease when it is disabled', () => {
    for (let second = 0; second < 500; second += 1) {
      expect(computeUneaseSignal(second, 'off', 88)).toBe(0);
    }
    const hasSubtlePulse = Array.from({ length: 200 }, (_, second) => (
      computeUneaseSignal(second, 'subtle', 88)
    )).some((signal) => signal > 0.1);
    expect(hasSubtlePulse).toBe(true);
  });

  it('selects a conservative initial quality for expensive viewports', () => {
    expect(chooseInitialQuality({ width: 1280, height: 720, pixelRatio: 1 })).toBe('high');
    expect(chooseInitialQuality({ width: 3840, height: 2160, pixelRatio: 2 })).toBe('low');
  });

  it('requires sustained slow frames before reducing quality', () => {
    const governor = new AdaptiveQualityGovernor('high');
    let changed = null;
    for (let frame = 0; frame < 180 && !changed; frame += 1) {
      changed = governor.update(1 / 30);
    }
    expect(changed).toBe('medium');
  });
});
