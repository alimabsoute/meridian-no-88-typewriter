export const WEATHER_PRESETS = Object.freeze(['quiet', 'rain', 'snow', 'nor-easter', 'automatic']);
export const UNEASE_LEVELS = Object.freeze(['off', 'subtle', 'unsettling']);
export const QUALITY_MODES = Object.freeze(['auto', 'low', 'medium', 'high']);

export const QUALITY_PROFILES = Object.freeze({
  low: Object.freeze({
    rainStreaks: 160,
    snowFlakes: 120,
    glassDroplets: 10,
    updateStride: 2,
  }),
  medium: Object.freeze({
    rainStreaks: 360,
    snowFlakes: 280,
    glassDroplets: 22,
    updateStride: 1,
  }),
  high: Object.freeze({
    rainStreaks: 640,
    snowFlakes: 480,
    glassDroplets: 38,
    updateStride: 1,
  }),
});

export function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function normalize(value, allowed, fallback) {
  const normalized = String(value ?? '').toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

export function normalizeWeatherPreset(value) {
  const raw = String(value ?? '').toLowerCase().replace('’', "'");
  if (["nor'easter", 'noreaster', 'nor_easter'].includes(raw)) return 'nor-easter';
  return normalize(raw, WEATHER_PRESETS, 'quiet');
}

export function normalizeUneaseLevel(value) {
  return normalize(value, UNEASE_LEVELS, 'off');
}

export function normalizeQualityMode(value) {
  return normalize(value, QUALITY_MODES, 'auto');
}

function smoothstep(value) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function mix(start, end, amount) {
  return start + (end - start) * amount;
}

function mixColor(start, end, amount) {
  return start.map((channel, index) => mix(channel, end[index], amount));
}

function mixWeather(start, end, amount) {
  const t = smoothstep(amount);
  return {
    rain: mix(start.rain, end.rain, t),
    snow: mix(start.snow, end.snow, t),
    wind: mix(start.wind, end.wind, t),
    cloud: mix(start.cloud, end.cloud, t),
  };
}

const WEATHER_TARGETS = Object.freeze({
  quiet: Object.freeze({ rain: 0, snow: 0, wind: 0.08, cloud: 0.18 }),
  rain: Object.freeze({ rain: 1, snow: 0, wind: 0.42, cloud: 0.78 }),
  snow: Object.freeze({ rain: 0, snow: 1, wind: 0.22, cloud: 0.62 }),
  'nor-easter': Object.freeze({ rain: 0.72, snow: 0.42, wind: 0.96, cloud: 1 }),
});

/**
 * Returns deterministic precipitation levels. Automatic weather uses a slow,
 * repeating six-minute cycle with eased transitions and no abrupt loop seam.
 */
export function resolveWeatherTargets(preset, elapsedSeconds = 0, seed = 88) {
  const weather = normalizeWeatherPreset(preset);
  if (weather !== 'automatic') return { ...WEATHER_TARGETS[weather] };

  const cycleLength = 360;
  const seedOffset = Math.abs(Math.trunc(seed)) % cycleLength;
  const phase = ((elapsedSeconds + seedOffset) % cycleLength + cycleLength) % cycleLength;
  const quiet = WEATHER_TARGETS.quiet;
  const rain = WEATHER_TARGETS.rain;
  const snow = WEATHER_TARGETS.snow;

  if (phase < 50) return { ...quiet };
  if (phase < 75) return mixWeather(quiet, rain, (phase - 50) / 25);
  if (phase < 145) return { ...rain };
  if (phase < 170) return mixWeather(rain, quiet, (phase - 145) / 25);
  if (phase < 220) return { ...quiet };
  if (phase < 250) return mixWeather(quiet, snow, (phase - 220) / 30);
  if (phase < 325) return { ...snow };
  return mixWeather(snow, quiet, (phase - 325) / 35);
}

/**
 * Early evening is intentionally not night-black. Even at progress 1 the room
 * retains legible blue-hour fill and warm reflected desk light.
 */
export function computeEveningPalette(progress = 0.38, brightness = 1) {
  const t = smoothstep(progress);
  const safeBrightness = Math.max(0.45, Math.min(1.5, Number.isFinite(brightness) ? brightness : 1));
  return {
    skyTop: mixColor([0.32, 0.43, 0.56], [0.065, 0.105, 0.17], t),
    skyHorizon: mixColor([0.88, 0.58, 0.38], [0.25, 0.31, 0.43], t),
    windowFill: mixColor([0.66, 0.78, 0.9], [0.42, 0.58, 0.78], t),
    warmBounce: mixColor([1, 0.72, 0.43], [1, 0.64, 0.34], t),
    windowIntensity: mix(1.42, 0.78, t) * safeBrightness,
    warmIntensity: mix(7.5, 13.5, t) * safeBrightness,
    houseWindowIntensity: mix(0.34, 1.16, t) * safeBrightness,
    ambientIntensity: mix(0.42, 0.24, t) * safeBrightness,
  };
}

function hash01(value) {
  let hash = Math.imul(value ^ 0x9e3779b9, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  return ((hash ^ (hash >>> 16)) >>> 0) / 0xffffffff;
}

/**
 * A slow pulse used for restrained atmosphere cues. It never flashes: each
 * pulse eases in and out over several seconds and is zero for most of a cycle.
 */
export function computeUneaseSignal(elapsedSeconds = 0, level = 'off', seed = 88) {
  const normalized = normalizeUneaseLevel(level);
  if (normalized === 'off') return 0;

  const interval = normalized === 'subtle' ? 79 : 47;
  const shifted = Math.max(0, elapsedSeconds) + (Math.abs(Math.trunc(seed)) % interval);
  const bucket = Math.floor(shifted / interval);
  const local = shifted - bucket * interval;
  const start = interval * (0.68 + hash01(bucket + seed) * 0.13);
  const duration = normalized === 'subtle' ? 7.5 : 10;
  if (local < start || local > start + duration) return 0;
  const phase = (local - start) / duration;
  const envelope = Math.sin(Math.PI * phase) ** 2;
  const variation = 0.76 + hash01(bucket * 7 + seed) * 0.24;
  return clamp01(envelope * variation);
}

export function chooseInitialQuality({
  pixelRatio = 1,
  width = 1280,
  height = 720,
  maxTextureSize = 8192,
} = {}) {
  if (maxTextureSize < 4096 || width * height * pixelRatio ** 2 > 5_500_000) return 'low';
  if (pixelRatio > 1.5 || width * height > 2_100_000 || maxTextureSize < 8192) return 'medium';
  return 'high';
}

/**
 * Conservative performance governor. It requires repeated slow windows to
 * downshift and substantially more fast windows to restore detail.
 */
export class AdaptiveQualityGovernor {
  constructor(initialQuality = 'high') {
    this.quality = QUALITY_PROFILES[initialQuality] ? initialQuality : 'high';
    this.elapsed = 0;
    this.frames = 0;
    this.slowWindows = 0;
    this.fastWindows = 0;
  }

  update(frameSeconds) {
    if (!Number.isFinite(frameSeconds) || frameSeconds <= 0 || frameSeconds > 0.1) return null;
    this.elapsed += frameSeconds;
    this.frames += 1;
    if (this.elapsed < 2.5) return null;

    const fps = this.frames / this.elapsed;
    this.elapsed = 0;
    this.frames = 0;

    if (fps < 42) {
      this.slowWindows += 1;
      this.fastWindows = 0;
    } else if (fps > 56) {
      this.fastWindows += 1;
      this.slowWindows = 0;
    } else {
      this.slowWindows = 0;
      this.fastWindows = 0;
    }

    if (this.slowWindows >= 2) {
      this.slowWindows = 0;
      const next = this.quality === 'high' ? 'medium' : this.quality === 'medium' ? 'low' : 'low';
      if (next !== this.quality) {
        this.quality = next;
        return next;
      }
    }

    if (this.fastWindows >= 6) {
      this.fastWindows = 0;
      const next = this.quality === 'low' ? 'medium' : this.quality === 'medium' ? 'high' : 'high';
      if (next !== this.quality) {
        this.quality = next;
        return next;
      }
    }
    return null;
  }
}
