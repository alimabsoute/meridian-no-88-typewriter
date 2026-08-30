/**
 * Procedural, continuously reusable room and weather audio for Octoberline 211.
 *
 * The constructor is deliberately silent. Call start() from a pointer or keyboard
 * gesture; browsers will then permit the AudioContext to resume. All sound sources
 * are created once and subsequent frame updates only adjust AudioParams.
 */

export const ATMOSPHERE_WEATHER_MODES = Object.freeze([
  'quiet',
  'autumn-wind',
  'rain',
  'snow',
  'nor-easter',
]);

export const ATMOSPHERE_UNEASE_LEVELS = Object.freeze([
  'off',
  'subtle',
  'unsettling',
]);

export const DEFAULT_ATMOSPHERE_VOLUMES = Object.freeze({
  room: 0.46,
  weather: 0.52,
  unease: 0.28,
});

const MASTER_LEVEL = 0.78;
const CONTROL_INTERVAL = 1 / 12;
const SILENCE = 0.00001;

const WEATHER_PROFILES = Object.freeze({
  quiet: Object.freeze({
    rain: 0,
    snow: 0,
    wind: 0.08,
    rainGain: 0,
    snowGain: 0,
    windGain: 0.006,
    rainFrequency: 2200,
    windFrequency: 230,
  }),
  'autumn-wind': Object.freeze({
    rain: 0,
    snow: 0,
    wind: 0.38,
    rainGain: 0,
    snowGain: 0,
    windGain: 0.015,
    rainFrequency: 1900,
    windFrequency: 305,
  }),
  rain: Object.freeze({
    rain: 1,
    snow: 0,
    wind: 0.42,
    rainGain: 0.073,
    snowGain: 0,
    windGain: 0.017,
    rainFrequency: 2850,
    windFrequency: 330,
  }),
  snow: Object.freeze({
    rain: 0,
    snow: 1,
    wind: 0.22,
    rainGain: 0,
    snowGain: 0.012,
    windGain: 0.012,
    rainFrequency: 1700,
    windFrequency: 275,
  }),
  'nor-easter': Object.freeze({
    rain: 0.72,
    snow: 0.42,
    wind: 0.96,
    rainGain: 0.096,
    snowGain: 0.018,
    windGain: 0.058,
    rainFrequency: 2380,
    windFrequency: 410,
  }),
});

function clamp01(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

function weatherToken(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[ _]+/g, '-');
}

function normalizeWeather(value) {
  const raw = weatherToken(value);
  if (["nor'easter", 'noreaster'].includes(raw)) return 'nor-easter';
  return ATMOSPHERE_WEATHER_MODES.includes(raw) ? raw : 'quiet';
}

function isKnownWeather(value) {
  const raw = weatherToken(value);
  return ATMOSPHERE_WEATHER_MODES.includes(raw) || ["nor'easter", 'noreaster'].includes(raw);
}

function normalizeUnease(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return ATMOSPHERE_UNEASE_LEVELS.includes(normalized) ? normalized : 'off';
}

function resolveAudioContextClass() {
  const browserScope = typeof window !== 'undefined' ? window : globalThis;
  return browserScope?.AudioContext || browserScope?.webkitAudioContext || null;
}

function deterministicUnit(seed, index) {
  let value = (Math.trunc(seed) ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0xffffffff;
}

function setParam(param, value, context, timeConstant = 0.08) {
  if (!param) return;
  const now = Number.isFinite(context?.currentTime) ? context.currentTime : 0;
  if (typeof param.setTargetAtTime === 'function') {
    param.setTargetAtTime(value, now, Math.max(0.001, timeConstant));
  } else {
    param.value = value;
  }
}

function setParamNow(param, value, context) {
  if (!param) return;
  const now = Number.isFinite(context?.currentTime) ? context.currentTime : 0;
  if (typeof param.cancelScheduledValues === 'function') param.cancelScheduledValues(now);
  if (typeof param.setValueAtTime === 'function') param.setValueAtTime(value, now);
  else param.value = value;
}

function safeDisconnect(node) {
  try {
    node?.disconnect?.();
  } catch {
    // Some browser implementations throw when an already-disconnected node is reused.
  }
}

function safeStop(node) {
  try {
    node?.stop?.();
  } catch {
    // AudioScheduledSourceNode.stop() is intentionally one-shot.
  }
}

function weatherLevelsFromState(value, fallback) {
  if (!value || typeof value !== 'object') return { ...fallback };
  return {
    rain: clamp01(value.rain, fallback.rain),
    snow: clamp01(value.snow, fallback.snow),
    wind: clamp01(value.wind, fallback.wind),
  };
}

/** A slow, deterministic envelope. It cannot produce abrupt stingers. */
function uneaseEnvelope(elapsed, level, seed) {
  if (level === 'off') return 0;
  const interval = level === 'subtle' ? 79 : 47;
  const shifted = Math.max(0, elapsed) + (Math.abs(Math.trunc(seed)) % interval);
  const bucket = Math.floor(shifted / interval);
  const local = shifted - bucket * interval;
  const start = interval * (0.68 + deterministicUnit(seed, bucket) * 0.13);
  const duration = level === 'subtle' ? 7.5 : 10;
  if (local < start || local > start + duration) return 0;
  const phase = (local - start) / duration;
  return Math.sin(Math.PI * phase) ** 2 * (0.76 + deterministicUnit(seed, bucket + 91) * 0.24);
}

export class AtmosphereAudio {
  constructor(options = {}) {
    this.contextFactory = typeof options.contextFactory === 'function'
      ? options.contextFactory
      : null;
    this.AudioContextClass = Object.prototype.hasOwnProperty.call(options, 'AudioContextClass')
      ? options.AudioContextClass
      : resolveAudioContextClass();
    this.seed = Number.isFinite(options.seed) ? Math.trunc(options.seed) : 88;

    this.enabled = options.enabled !== false;
    this.weather = normalizeWeather(options.weather ?? 'quiet');
    this.unease = normalizeUnease(options.unease ?? 'off');
    this.volumes = {
      room: clamp01(options.volumes?.room, DEFAULT_ATMOSPHERE_VOLUMES.room),
      weather: clamp01(options.volumes?.weather, DEFAULT_ATMOSPHERE_VOLUMES.weather),
      unease: clamp01(options.volumes?.unease, DEFAULT_ATMOSPHERE_VOLUMES.unease),
    };

    this.context = null;
    this.graph = null;
    this.nodes = [];
    this.sources = [];
    this.elapsed = 0;
    this.controlAccumulator = CONTROL_INTERVAL;
    this.cueCountdown = 4.25 + deterministicUnit(this.seed, 0) * 2.5;
    this.cueIndex = 1;
    this.weatherLevels = { ...WEATHER_PROFILES[this.weather] };
    this.uneaseSignal = 0;
    this.graphReady = false;
    this.disposed = false;
    this.supported = Boolean(this.contextFactory || this.AudioContextClass);
    this.lastError = null;
  }

  /**
   * Lazily creates and resumes the graph. Invoke in a user-gesture handler.
   * Returns false instead of throwing when Web Audio is unavailable or blocked.
   */
  async start() {
    if (this.disposed || !this.supported) return false;

    if (!this.context) {
      try {
        this.context = this._createContext();
        if (!this.context) {
          this.supported = false;
          return false;
        }
        this._buildGraph();
      } catch {
        await this._abandonContext('initialization-failed');
        return false;
      }
    }

    try {
      if (this.context.state === 'suspended' && typeof this.context.resume === 'function') {
        await this.context.resume();
      }
      this.lastError = null;
      return this.context.state !== 'suspended' && this.context.state !== 'closed';
    } catch {
      this.lastError = 'resume-blocked';
      return false;
    }
  }

  /** Alias intended for a later gesture after a browser has suspended audio. */
  resume() {
    return this.start();
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (this.graphReady) {
      setParam(
        this.graph.master.gain,
        this.enabled ? MASTER_LEVEL : 0,
        this.context,
        0.035,
      );
    }
    return this.enabled;
  }

  setVolumes(volumes = {}) {
    for (const channel of ['room', 'weather', 'unease']) {
      if (volumes[channel] !== undefined) {
        this.volumes[channel] = clamp01(volumes[channel], this.volumes[channel]);
      }
    }
    this._applyChannelLevels();
    return { ...this.volumes };
  }

  setWeather(mode) {
    this.weather = normalizeWeather(mode);
    this.weatherLevels = { ...WEATHER_PROFILES[this.weather] };
    this.controlAccumulator = CONTROL_INTERVAL;
    this._applyAtmosphere();
    return this.weather;
  }

  setUnease(level) {
    this.unease = normalizeUnease(level);
    if (this.unease === 'off') this.uneaseSignal = 0;
    this.controlAccumulator = CONTROL_INTERVAL;
    this._applyAtmosphere();
    return this.unease;
  }

  /**
   * Advances restrained modulation. roomState may be PhiladelphiaWritingRoom#getState().
   * The routine is safe to call before start() and performs no node allocation.
   */
  update(delta, roomState = null) {
    if (this.disposed) return this.getState();
    const safeDelta = Number.isFinite(delta) ? Math.max(0, Math.min(0.5, delta)) : 0;
    this.elapsed += safeDelta;

    if (roomState && typeof roomState === 'object') {
      const roomWeather = roomState.weather ?? roomState.weatherPreset;
      const normalizedRoomWeather = normalizeWeather(roomWeather);
      if (isKnownWeather(roomWeather)) {
        this.weather = normalizedRoomWeather;
      }

      const roomUnease = roomState.unease ?? roomState.uneaseLevel;
      if (ATMOSPHERE_UNEASE_LEVELS.includes(String(roomUnease ?? '').toLowerCase())) {
        this.unease = normalizeUnease(roomUnease);
      }
    }

    const profile = WEATHER_PROFILES[this.weather];
    this.weatherLevels = weatherLevelsFromState(roomState?.weatherLevels, profile);
    this.uneaseSignal = Number.isFinite(roomState?.uneaseSignal)
      ? clamp01(roomState.uneaseSignal)
      : uneaseEnvelope(this.elapsed, this.unease, this.seed);

    this.controlAccumulator += safeDelta;
    this.cueCountdown -= safeDelta;
    if (this.controlAccumulator >= CONTROL_INTERVAL) {
      this.controlAccumulator %= CONTROL_INTERVAL;
      this._applyAtmosphere();
    }

    const wetness = this.weatherLevels.rain * (0.72 + this.weatherLevels.wind * 0.28);
    if (wetness > 0.16 && this.cueCountdown <= 0) this._scheduleWindowDrop(wetness);
    return this.getState();
  }

  getState() {
    return {
      supported: this.supported,
      started: this.graphReady,
      running: Boolean(this.context && this.context.state === 'running'),
      enabled: this.enabled,
      weather: this.weather,
      unease: this.unease,
      volumes: { ...this.volumes },
      weatherLevels: {
        rain: this.weatherLevels.rain,
        snow: this.weatherLevels.snow,
        wind: this.weatherLevels.wind,
      },
      uneaseSignal: this.uneaseSignal,
      disposed: this.disposed,
      error: this.lastError,
    };
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.graphReady = false;
    for (const source of this.sources) safeStop(source);
    for (const node of [...this.nodes].reverse()) safeDisconnect(node);
    this.sources.length = 0;
    this.nodes.length = 0;

    const context = this.context;
    this.context = null;
    this.graph = null;
    if (context && context.state !== 'closed' && typeof context.close === 'function') {
      try {
        await context.close();
      } catch {
        // Closing audio is best effort, especially during page teardown.
      }
    }
  }

  _createContext() {
    if (this.contextFactory) return this.contextFactory();
    if (!this.AudioContextClass) return null;
    try {
      return new this.AudioContextClass({ latencyHint: 'playback' });
    } catch {
      return new this.AudioContextClass();
    }
  }

  _track(node, { source = false } = {}) {
    this.nodes.push(node);
    if (source) this.sources.push(node);
    return node;
  }

  _gain(initial = 0) {
    const node = this._track(this.context.createGain());
    node.gain.value = initial;
    return node;
  }

  _filter(type, frequency, q = 0.5) {
    const node = this._track(this.context.createBiquadFilter());
    node.type = type;
    node.frequency.value = frequency;
    node.Q.value = q;
    return node;
  }

  _noiseSource(buffer, playbackRate, offset) {
    const source = this._track(this.context.createBufferSource(), { source: true });
    source.buffer = buffer;
    source.loop = true;
    source.playbackRate.value = playbackRate;
    const duration = Number(buffer.duration) || 2;
    source.start(this.context.currentTime, offset % duration);
    return source;
  }

  _oscillator(type, frequency) {
    const oscillator = this._track(this.context.createOscillator(), { source: true });
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    oscillator.start(this.context.currentTime);
    return oscillator;
  }

  _buildNoiseBuffer(seconds = 4) {
    const length = Math.max(1, Math.floor(this.context.sampleRate * seconds));
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const channel = buffer.getChannelData(0);
    let previous = 0;
    for (let index = 0; index < length; index += 1) {
      const white = deterministicUnit(this.seed + 317, index) * 2 - 1;
      previous = previous * 0.28 + white * 0.72;
      channel[index] = Math.max(-1, Math.min(1, previous));
    }
    // Blend the tail into the head so a looping rain bed cannot reveal its seam.
    const blendLength = Math.min(Math.floor(this.context.sampleRate * 0.002), Math.floor(length / 4));
    const loopValue = channel[0];
    for (let index = 0; index < blendLength; index += 1) {
      const progress = (index + 1) / blendLength;
      const amount = progress * progress * (3 - 2 * progress);
      const tailIndex = length - blendLength + index;
      channel[tailIndex] = channel[tailIndex] * (1 - amount) + loopValue * amount;
    }
    return buffer;
  }

  _buildGraph() {
    const master = this._gain(this.enabled ? MASTER_LEVEL : 0);
    const roomChannel = this._gain(this.volumes.room);
    const weatherChannel = this._gain(this.volumes.weather);
    const uneaseChannel = this._gain(this.volumes.unease);
    roomChannel.connect(master);
    weatherChannel.connect(master);
    uneaseChannel.connect(master);
    master.connect(this.context.destination);

    const noiseBuffer = this._buildNoiseBuffer();

    const roomSource = this._noiseSource(noiseBuffer, 0.19, 0.17);
    const roomFilter = this._filter('lowpass', 305, 0.36);
    const roomTexture = this._gain(0.024);
    roomSource.connect(roomFilter).connect(roomTexture).connect(roomChannel);

    const rainSource = this._noiseSource(noiseBuffer, 0.91, 0.53);
    const rainFilter = this._filter('highpass', 2300, 0.34);
    const rainTexture = this._gain(0);
    rainSource.connect(rainFilter).connect(rainTexture).connect(weatherChannel);

    const windSource = this._noiseSource(noiseBuffer, 0.16, 0.89);
    const windFilter = this._filter('lowpass', 260, 0.7);
    const windTexture = this._gain(0.006);
    windSource.connect(windFilter).connect(windTexture).connect(weatherChannel);

    const snowSource = this._noiseSource(noiseBuffer, 0.43, 1.31);
    const snowFilter = this._filter('bandpass', 780, 0.42);
    const snowTexture = this._gain(0);
    snowSource.connect(snowFilter).connect(snowTexture).connect(weatherChannel);

    const weatherCue = this._oscillator('sine', 880);
    const weatherCueGain = this._gain(SILENCE);
    weatherCue.connect(weatherCueGain).connect(weatherChannel);

    const uneaseA = this._oscillator('sine', 47.2);
    const uneaseB = this._oscillator('sine', 47.93);
    const uneaseFilter = this._filter('lowpass', 118, 0.48);
    const uneaseTone = this._gain(0);
    uneaseA.connect(uneaseFilter);
    uneaseB.connect(uneaseFilter);
    uneaseFilter.connect(uneaseTone).connect(uneaseChannel);

    const uneaseAirSource = this._noiseSource(noiseBuffer, 0.11, 1.67);
    const uneaseAirFilter = this._filter('lowpass', 145, 0.55);
    const uneaseAir = this._gain(0);
    uneaseAirSource.connect(uneaseAirFilter).connect(uneaseAir).connect(uneaseChannel);

    this.graph = {
      master,
      roomChannel,
      weatherChannel,
      uneaseChannel,
      roomFilter,
      roomTexture,
      rainSource,
      rainFilter,
      rainTexture,
      windSource,
      windFilter,
      windTexture,
      snowSource,
      snowFilter,
      snowTexture,
      weatherCue,
      weatherCueGain,
      uneaseA,
      uneaseB,
      uneaseFilter,
      uneaseTone,
      uneaseAir,
    };
    this.graphReady = true;
    this._applyChannelLevels();
    this._applyAtmosphere();
  }

  _applyChannelLevels() {
    if (!this.graphReady) return;
    setParam(this.graph.roomChannel.gain, this.volumes.room, this.context, 0.055);
    setParam(this.graph.weatherChannel.gain, this.volumes.weather, this.context, 0.055);
    setParam(this.graph.uneaseChannel.gain, this.volumes.unease, this.context, 0.055);
  }

  _applyAtmosphere() {
    if (!this.graphReady) return;
    const profile = WEATHER_PROFILES[this.weather];
    const { rain, snow, wind } = this.weatherLevels;

    const rainGain = profile.rainGain > 0
      ? profile.rainGain * (0.15 + rain * 0.85)
      : rain * 0.073;
    const snowGain = Math.max(profile.snowGain, snow * 0.012);
    const windGain = 0.004 + wind * 0.056;
    setParam(this.graph.rainTexture.gain, rainGain, this.context, 0.32);
    setParam(this.graph.snowTexture.gain, snowGain, this.context, 0.5);
    setParam(this.graph.windTexture.gain, windGain, this.context, 0.58);
    setParam(
      this.graph.rainFilter.frequency,
      profile.rainFrequency * (0.92 + rain * 0.08),
      this.context,
      0.45,
    );
    setParam(
      this.graph.windFilter.frequency,
      profile.windFrequency * (0.88 + wind * 0.18),
      this.context,
      0.62,
    );
    setParam(this.graph.rainSource.playbackRate, 0.82 + rain * 0.18, this.context, 0.5);
    setParam(this.graph.windSource.playbackRate, 0.13 + wind * 0.08, this.context, 0.7);

    const uneaseBase = this.unease === 'unsettling'
      ? 0.014
      : this.unease === 'subtle'
        ? 0.0072
        : 0;
    const pulse = this.unease === 'off' ? 0 : this.uneaseSignal;
    setParam(this.graph.uneaseTone.gain, uneaseBase * (0.62 + pulse * 0.38), this.context, 0.72);
    setParam(this.graph.uneaseAir.gain, uneaseBase * (0.24 + pulse * 0.3), this.context, 0.85);

    const drift = Math.sin(this.elapsed * 0.071 + this.seed) * 0.12;
    setParam(this.graph.uneaseA.frequency, 47.2 + drift, this.context, 0.9);
    setParam(this.graph.uneaseB.frequency, 47.93 - drift * 0.65, this.context, 0.9);
    setParam(this.graph.roomFilter.frequency, 305 - wind * 28 - pulse * 12, this.context, 0.85);
  }

  _scheduleWindowDrop(wetness) {
    const variation = deterministicUnit(this.seed + 701, this.cueIndex);
    const intervalVariation = deterministicUnit(this.seed + 1701, this.cueIndex);
    this.cueIndex += 1;
    this.cueCountdown = 3.4 + intervalVariation * 4.7 - wetness * 1.15;
    if (!this.graphReady || !this.enabled) return;

    const now = this.context.currentTime;
    const frequency = 720 + variation * 430;
    const peak = 0.0013 + wetness * 0.0018;
    const frequencyParam = this.graph.weatherCue.frequency;
    const gainParam = this.graph.weatherCueGain.gain;
    setParamNow(frequencyParam, frequency, this.context);
    if (typeof gainParam.cancelScheduledValues === 'function') gainParam.cancelScheduledValues(now);
    if (typeof gainParam.setValueAtTime === 'function') {
      gainParam.setValueAtTime(SILENCE, now);
      if (typeof gainParam.exponentialRampToValueAtTime === 'function') {
        gainParam.exponentialRampToValueAtTime(peak, now + 0.018);
        gainParam.exponentialRampToValueAtTime(SILENCE, now + 0.19);
      } else {
        gainParam.setValueAtTime(peak, now + 0.018);
        gainParam.setValueAtTime(SILENCE, now + 0.19);
      }
    } else {
      gainParam.value = SILENCE;
    }
  }

  async _abandonContext(reason) {
    this.lastError = reason;
    for (const source of this.sources) safeStop(source);
    for (const node of [...this.nodes].reverse()) safeDisconnect(node);
    this.sources.length = 0;
    this.nodes.length = 0;
    const context = this.context;
    this.context = null;
    this.graph = null;
    this.graphReady = false;
    if (context && context.state !== 'closed' && typeof context.close === 'function') {
      try {
        await context.close();
      } catch {
        // Initialization already failed; cleanup must not obscure the safe fallback.
      }
    }
  }
}
