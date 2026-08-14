import { describe, expect, it } from 'vitest';
import {
  ATMOSPHERE_UNEASE_LEVELS,
  ATMOSPHERE_WEATHER_MODES,
  AtmosphereAudio,
} from './atmosphere-audio.js';

class FakeAudioParam {
  constructor(value = 0) {
    this.value = value;
    this.events = [];
  }

  cancelScheduledValues(time) {
    this.events.push({ type: 'cancel', time });
  }

  setValueAtTime(value, time) {
    this.value = value;
    this.events.push({ type: 'set', value, time });
  }

  setTargetAtTime(value, time, timeConstant) {
    this.value = value;
    this.events.push({ type: 'target', value, time, timeConstant });
  }

  exponentialRampToValueAtTime(value, time) {
    this.value = value;
    this.events.push({ type: 'exponential', value, time });
  }
}

class FakeNode {
  constructor(context, kind) {
    this.context = context;
    this.kind = kind;
    this.connections = [];
    this.disconnected = false;
  }

  connect(node) {
    this.connections.push(node);
    return node;
  }

  disconnect() {
    this.disconnected = true;
    this.connections.length = 0;
  }
}

class FakeGainNode extends FakeNode {
  constructor(context) {
    super(context, 'gain');
    this.gain = new FakeAudioParam(1);
  }
}

class FakeFilterNode extends FakeNode {
  constructor(context) {
    super(context, 'filter');
    this.type = 'lowpass';
    this.frequency = new FakeAudioParam(350);
    this.Q = new FakeAudioParam(1);
  }
}

class FakeSourceNode extends FakeNode {
  constructor(context, kind) {
    super(context, kind);
    this.playbackRate = new FakeAudioParam(1);
    this.frequency = new FakeAudioParam(440);
    this.started = [];
    this.stopCount = 0;
    this.loop = false;
    this.buffer = null;
    this.type = 'sine';
  }

  start(...args) {
    this.started.push(args);
  }

  stop() {
    this.stopCount += 1;
  }
}

class FakeAudioContext {
  constructor({ resumeThrows = false } = {}) {
    this.sampleRate = 8000;
    this.currentTime = 0;
    this.state = 'suspended';
    this.resumeThrows = resumeThrows;
    this.resumeCount = 0;
    this.closeCount = 0;
    this.destination = new FakeNode(this, 'destination');
    this.nodes = [];
    this.oscillators = [];
    this.counts = { gain: 0, filter: 0, bufferSource: 0, oscillator: 0, buffer: 0 };
  }

  createGain() {
    this.counts.gain += 1;
    const node = new FakeGainNode(this);
    this.nodes.push(node);
    return node;
  }

  createBiquadFilter() {
    this.counts.filter += 1;
    const node = new FakeFilterNode(this);
    this.nodes.push(node);
    return node;
  }

  createBufferSource() {
    this.counts.bufferSource += 1;
    const node = new FakeSourceNode(this, 'buffer-source');
    this.nodes.push(node);
    return node;
  }

  createOscillator() {
    this.counts.oscillator += 1;
    const node = new FakeSourceNode(this, 'oscillator');
    this.nodes.push(node);
    this.oscillators.push(node);
    return node;
  }

  createBuffer(channels, length, sampleRate) {
    this.counts.buffer += 1;
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return {
      duration: length / sampleRate,
      getChannelData: (channel) => data[channel],
    };
  }

  async resume() {
    this.resumeCount += 1;
    if (this.resumeThrows) throw new Error('gesture required');
    this.state = 'running';
  }

  async close() {
    this.closeCount += 1;
    this.state = 'closed';
  }
}

function createHarness(options = {}) {
  let factoryCalls = 0;
  const contexts = [];
  const audio = new AtmosphereAudio({
    seed: options.seed ?? 88,
    contextFactory: () => {
      factoryCalls += 1;
      const context = new FakeAudioContext(options.contextOptions);
      contexts.push(context);
      return context;
    },
  });
  return {
    audio,
    contexts,
    factoryCalls: () => factoryCalls,
  };
}

describe('AtmosphereAudio', () => {
  it('stays silent and allocation-free until a gesture starts it', async () => {
    const harness = createHarness();
    expect(harness.factoryCalls()).toBe(0);
    expect(harness.audio.getState()).toMatchObject({ started: false, running: false });

    harness.audio.setEnabled(true);
    harness.audio.update(1 / 60);
    expect(harness.factoryCalls()).toBe(0);

    await expect(harness.audio.start()).resolves.toBe(true);
    const context = harness.contexts[0];
    expect(harness.factoryCalls()).toBe(1);
    expect(context.resumeCount).toBe(1);
    expect(context.counts).toMatchObject({ buffer: 1, bufferSource: 5, oscillator: 3 });
    expect(harness.audio.getState()).toMatchObject({ started: true, running: true });

    await expect(harness.audio.resume()).resolves.toBe(true);
    expect(harness.factoryCalls()).toBe(1);
    expect(context.counts).toMatchObject({ buffer: 1, bufferSource: 5, oscillator: 3 });
  });

  it('keeps room, weather, and unease volumes independently controllable', async () => {
    const { audio } = createHarness();
    expect(audio.setVolumes({ room: 4, weather: -2, unease: 0.31 })).toEqual({
      room: 1,
      weather: 0,
      unease: 0.31,
    });
    await audio.start();

    expect(audio.graph.roomChannel.gain.value).toBe(1);
    expect(audio.graph.weatherChannel.gain.value).toBe(0);
    expect(audio.graph.uneaseChannel.gain.value).toBe(0.31);
    expect(audio.setEnabled(false)).toBe(false);
    expect(audio.graph.master.gain.value).toBe(0);
    expect(audio.setEnabled(true)).toBe(true);
    expect(audio.graph.master.gain.value).toBeGreaterThan(0);
  });

  it('supports every release weather and unease preset with safe normalization', () => {
    const { audio } = createHarness();
    for (const weather of ATMOSPHERE_WEATHER_MODES) expect(audio.setWeather(weather)).toBe(weather);
    expect(audio.setWeather("Nor'easter")).toBe('nor-easter');
    expect(audio.setWeather('NOREASTER')).toBe('nor-easter');
    expect(audio.setWeather('hail')).toBe('quiet');

    for (const unease of ATMOSPHERE_UNEASE_LEVELS) expect(audio.setUnease(unease)).toBe(unease);
    expect(audio.setUnease('ominous')).toBe('off');
  });

  it('tracks the optional visual room state without abrupt or unsafe values', async () => {
    const { audio } = createHarness();
    await audio.start();
    const state = audio.update(0.1, {
      weather: 'nor-easter',
      weatherLevels: { rain: 0.43, snow: 0.2, wind: 0.84 },
      unease: 'unsettling',
      uneaseSignal: 0.61,
    });

    expect(state).toMatchObject({
      weather: 'nor-easter',
      unease: 'unsettling',
      weatherLevels: { rain: 0.43, snow: 0.2, wind: 0.84 },
      uneaseSignal: 0.61,
    });
    expect(audio.graph.uneaseTone.gain.value).toBeGreaterThan(0);
    expect(audio.graph.windTexture.gain.value).toBeGreaterThan(audio.graph.snowTexture.gain.value);
  });

  it('reuses one graph through long-running frame and weather updates', async () => {
    const { audio, contexts } = createHarness({ seed: 314 });
    await audio.start();
    const context = contexts[0];
    const initialCounts = { ...context.counts };

    for (let frame = 0; frame < 2400; frame += 1) {
      context.currentTime += 1 / 60;
      const phase = frame % 480;
      const weather = phase < 120 ? 'quiet' : phase < 240 ? 'rain' : phase < 360 ? 'snow' : 'nor-easter';
      audio.update(1 / 60, {
        weather,
        unease: frame % 720 < 360 ? 'subtle' : 'unsettling',
      });
    }

    expect(context.counts).toEqual(initialCounts);
    expect(context.nodes.every((node) => node.disconnected === false)).toBe(true);
  });

  it('produces the same restrained window cues for the same seed', async () => {
    const first = createHarness({ seed: 90210 });
    const second = createHarness({ seed: 90210 });
    await Promise.all([first.audio.start(), second.audio.start()]);
    first.audio.setWeather('rain');
    second.audio.setWeather('rain');

    for (let step = 0; step < 40; step += 1) {
      first.contexts[0].currentTime += 0.5;
      second.contexts[0].currentTime += 0.5;
      first.audio.update(0.5);
      second.audio.update(0.5);
    }

    const frequencies = (harness) => harness.contexts[0].oscillators[0].frequency.events
      .filter((event) => event.type === 'set')
      .map((event) => event.value);
    expect(frequencies(first).length).toBeGreaterThan(1);
    expect(frequencies(first)).toEqual(frequencies(second));
    expect(Math.max(...frequencies(first))).toBeLessThan(1200);
  });

  it('degrades safely without Web Audio and disposes a live graph once', async () => {
    const unavailable = new AtmosphereAudio({ AudioContextClass: null });
    expect(unavailable.getState().supported).toBe(false);
    await expect(unavailable.start()).resolves.toBe(false);
    expect(() => {
      unavailable.setWeather('rain');
      unavailable.setUnease('subtle');
      unavailable.setVolumes({ weather: 1 });
      unavailable.update(0.1);
    }).not.toThrow();
    await unavailable.dispose();

    const { audio, contexts } = createHarness();
    await audio.start();
    const context = contexts[0];
    await audio.dispose();
    await audio.dispose();
    expect(context.closeCount).toBe(1);
    expect(context.nodes.every((node) => node.disconnected)).toBe(true);
    expect(context.nodes.filter((node) => ['buffer-source', 'oscillator'].includes(node.kind))
      .every((node) => node.stopCount === 1)).toBe(true);
    expect(audio.getState()).toMatchObject({ disposed: true, started: false, running: false });
    await expect(audio.start()).resolves.toBe(false);
  });

  it('can retry resume after an autoplay policy block without rebuilding', async () => {
    const { audio, contexts } = createHarness({ contextOptions: { resumeThrows: true } });
    await expect(audio.start()).resolves.toBe(false);
    const context = contexts[0];
    expect(audio.getState()).toMatchObject({ started: true, running: false, error: 'resume-blocked' });
    context.resumeThrows = false;
    await expect(audio.resume()).resolves.toBe(true);
    expect(context.resumeCount).toBe(2);
    expect(context.counts.buffer).toBe(1);
    expect(audio.getState().error).toBe(null);
  });
});
