/** Procedural Web Audio sound design: no external samples or network requests. */
export class TypewriterAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.paperMaster = null;
    this.room = null;
    this.enabled = true;
    this.volume = 0.78;
    this.paperVolume = 0.62;
    this.noiseBuffer = null;
  }

  async start() {
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return false;
      try {
        this.context = new AudioContext({ latencyHint: 'interactive' });
      } catch {
        this.context = new AudioContext();
      }
      this.connectOutputs();
      this.noiseBuffer = this.makeNoiseBuffer(2);
    }
    if (this.context.state === 'suspended') await this.context.resume();
    return true;
  }

  connectOutputs() {
      this.master = this.context.createGain();
      this.paperMaster = this.context.createGain();
      this.master.gain.value = this.enabled ? 0.72 * this.volume : 0;
      this.paperMaster.gain.value = this.enabled ? 0.72 * this.paperVolume : 0;
      // Catch overlapping hard strikes without flattening their initial clack.
      this.mechanicalCompressor = this.context.createDynamicsCompressor();
      this.mechanicalCompressor.threshold.value = -8;
      this.mechanicalCompressor.knee.value = 6;
      this.mechanicalCompressor.ratio.value = 6;
      this.mechanicalCompressor.attack.value = 0.002;
      this.mechanicalCompressor.release.value = 0.07;
      this.master.connect(this.mechanicalCompressor).connect(this.context.destination);
      this.paperMaster.connect(this.context.destination);
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (this.master && this.context) {
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.setTargetAtTime(enabled ? 0.72 * this.volume : 0, this.context.currentTime, 0.025);
    }
    if (this.paperMaster && this.context) {
      this.paperMaster.gain.cancelScheduledValues(this.context.currentTime);
      this.paperMaster.gain.setTargetAtTime(enabled ? 0.72 * this.paperVolume : 0, this.context.currentTime, 0.025);
    }
  }

  setVolume(volume) {
    const value = Number(volume);
    if (Number.isFinite(value)) this.volume = Math.max(0, Math.min(1, value));
    if (this.master && this.context) {
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.setTargetAtTime(this.enabled ? 0.72 * this.volume : 0, this.context.currentTime, 0.025);
    }
    return this.volume;
  }

  setPaperVolume(volume) {
    const value = Number(volume);
    if (Number.isFinite(value)) this.paperVolume = Math.max(0, Math.min(1, value));
    if (this.paperMaster && this.context) {
      this.paperMaster.gain.cancelScheduledValues(this.context.currentTime);
      this.paperMaster.gain.setTargetAtTime(this.enabled ? 0.72 * this.paperVolume : 0, this.context.currentTime, 0.025);
    }
    return this.paperVolume;
  }

  makeNoiseBuffer(seconds) {
    const length = Math.floor(this.context.sampleRate * seconds);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    let previous = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      previous = previous * 0.36 + white * 0.64;
      data[i] = previous;
    }
    return buffer;
  }

  noise({ time = 0, duration = 0.04, gain = 0.16, frequency = 2200, q = 0.7, type = 'bandpass', destination = this.master } = {}) {
    if (!this.context || !this.enabled) return;
    const now = this.context.currentTime + time;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const envelope = this.context.createGain();
    source.buffer = this.noiseBuffer;
    source.playbackRate.value = 0.86 + Math.random() * 0.28;
    filter.type = type;
    filter.frequency.value = frequency * (0.95 + Math.random() * 0.1);
    filter.Q.value = q;
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), now + 0.002);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(envelope).connect(destination || this.master);
    source.start(now, Math.random() * 0.7, duration + 0.015);
    source.stop(now + duration + 0.02);
  }

  tone({ time = 0, duration = 0.08, gain = 0.08, frequency = 260, endFrequency, type = 'sine' } = {}) {
    if (!this.context || !this.enabled) return;
    const now = this.context.currentTime + time;
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, now + duration);
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), now + 0.002);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(envelope).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.01);
  }

  keyDown(force = 0.72) {
    force *= 3;
    const variation = 0.9 + Math.random() * 0.2;
    this.noise({ duration: 0.018, gain: 0.14 * force, frequency: 3100 * variation, q: 1.6 });
    this.tone({ duration: 0.028, gain: 0.045 * force, frequency: 620 * variation, endFrequency: 490 * variation, type: 'triangle' });
  }

  strike(force = 0.72) {
    force *= 3;
    const variation = 0.93 + Math.random() * 0.14;
    this.noise({ duration: 0.028, gain: 0.58 * force, frequency: 2650 * variation, q: 0.9 });
    this.noise({ time: 0.002, duration: 0.065, gain: 0.28 * force, frequency: 580 * variation, q: 1.1 });
    this.tone({ duration: 0.085, gain: 0.16 * force, frequency: 188 * variation, endFrequency: 135 * variation, type: 'triangle' });
    this.tone({ time: 0.004, duration: 0.043, gain: 0.045 * force, frequency: 970 * variation, type: 'sine' });
    // A quieter delayed return gives the typebar a physical double clack.
    this.noise({ time: 0.032, duration: 0.022, gain: 0.095 * force, frequency: 1750 * variation, q: 1.4 });
  }

  escapement() {
    this.noise({ duration: 0.018, gain: 0.10, frequency: 3900, q: 2.4 });
    this.tone({ duration: 0.024, gain: 0.03, frequency: 780, endFrequency: 590, type: 'square' });
  }

  space() {
    this.noise({ duration: 0.032, gain: 0.19, frequency: 1450, q: 1.2 });
    this.tone({ duration: 0.065, gain: 0.08, frequency: 150, endFrequency: 110, type: 'triangle' });
  }

  backspace() {
    this.noise({ duration: 0.03, gain: 0.10, frequency: 2500, q: 2.1 });
    this.tone({ duration: 0.06, gain: 0.035, frequency: 215, endFrequency: 155, type: 'sawtooth' });
  }

  shift(engaged = true) {
    this.noise({ duration: engaged ? 0.06 : 0.035, gain: 0.12, frequency: engaged ? 820 : 1250, q: 0.9 });
    this.tone({ duration: 0.085, gain: 0.055, frequency: engaged ? 105 : 135, endFrequency: 82, type: 'triangle' });
  }

  bell() {
    const base = 1180 * (0.98 + Math.random() * 0.03);
    this.tone({ duration: 1.25, gain: 0.11, frequency: base, type: 'sine' });
    this.tone({ time: 0.002, duration: 0.95, gain: 0.065, frequency: base * 1.49, type: 'sine' });
    this.tone({ time: 0.004, duration: 0.72, gain: 0.032, frequency: base * 2.04, type: 'sine' });
    this.noise({ duration: 0.014, gain: 0.055, frequency: 3800, q: 2.5 });
  }

  carriageReturn(distance = 0.5) {
    const duration = 0.42 + Math.max(0, Math.min(1, distance)) * 0.5;
    this.noise({ duration: 0.04, gain: 0.11, frequency: 1900, q: 1.2 });
    const clicks = Math.max(4, Math.round(duration * 17));
    for (let i = 0; i < clicks; i += 1) {
      const at = 0.06 + (i / clicks) * duration * 0.72;
      this.noise({ time: at, duration: 0.012, gain: 0.025 + Math.random() * 0.024, frequency: 2400 + Math.random() * 900, q: 2.7 });
    }
    this.noise({ time: 0.08, duration: duration * 0.72, gain: 0.035, frequency: 460, q: 0.6 });
    this.tone({ time: duration * 0.78, duration: 0.11, gain: 0.065, frequency: 145, endFrequency: 88, type: 'triangle' });
    this.noise({ time: duration * 0.79, duration: 0.08, gain: 0.11, frequency: 620, q: 0.8 });
  }

  tab(distance = 0.3) {
    const duration = 0.16 + distance * 0.34;
    this.noise({ duration, gain: 0.035, frequency: 670, q: 0.65 });
    this.tone({ time: duration, duration: 0.055, gain: 0.05, frequency: 180, endFrequency: 110, type: 'triangle' });
  }

  paper() {
    this.noise({
      duration: 0.22,
      gain: 0.05,
      frequency: 1150,
      q: 0.6,
      type: 'highpass',
      destination: this.paperMaster || this.master,
    });
  }

  ribbonReverse() {
    this.noise({ duration: 0.035, gain: 0.07, frequency: 2900, q: 2.5 });
    this.tone({ duration: 0.05, gain: 0.028, frequency: 330, endFrequency: 210, type: 'square' });
  }
}
