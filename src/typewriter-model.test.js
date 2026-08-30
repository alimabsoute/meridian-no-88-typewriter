import { describe, expect, it, vi } from 'vitest';
import { TypewriterDocument } from './typewriter-document.js';
import {
  CHARACTER_KEYS,
  CODE_BY_CHARACTER,
  DEFAULT_TOUCH_PRESET,
  KEY_BY_CODE,
  TOUCH_PRESETS,
  TypewriterModel,
} from './typewriter-model.js';

const US_QWERTY_PRINTABLE_KEYS = [
  [
    ['Backquote', '`', '~'], ['Digit1', '1', '!'], ['Digit2', '2', '@'], ['Digit3', '3', '#'],
    ['Digit4', '4', '$'], ['Digit5', '5', '%'], ['Digit6', '6', '^'], ['Digit7', '7', '&'],
    ['Digit8', '8', '*'], ['Digit9', '9', '('], ['Digit0', '0', ')'], ['Minus', '-', '_'],
    ['Equal', '=', '+'],
  ],
  [
    ['KeyQ', 'q', 'Q'], ['KeyW', 'w', 'W'], ['KeyE', 'e', 'E'], ['KeyR', 'r', 'R'],
    ['KeyT', 't', 'T'], ['KeyY', 'y', 'Y'], ['KeyU', 'u', 'U'], ['KeyI', 'i', 'I'],
    ['KeyO', 'o', 'O'], ['KeyP', 'p', 'P'], ['BracketLeft', '[', '{'], ['BracketRight', ']', '}'],
    ['Backslash', '\\', '|'],
  ],
  [
    ['KeyA', 'a', 'A'], ['KeyS', 's', 'S'], ['KeyD', 'd', 'D'], ['KeyF', 'f', 'F'],
    ['KeyG', 'g', 'G'], ['KeyH', 'h', 'H'], ['KeyJ', 'j', 'J'], ['KeyK', 'k', 'K'],
    ['KeyL', 'l', 'L'], ['Semicolon', ';', ':'], ['Quote', "'", '"'],
  ],
  [
    ['KeyZ', 'z', 'Z'], ['KeyX', 'x', 'X'], ['KeyC', 'c', 'C'], ['KeyV', 'v', 'V'],
    ['KeyB', 'b', 'B'], ['KeyN', 'n', 'N'], ['KeyM', 'm', 'M'], ['Comma', ',', '<'],
    ['Period', '.', '>'], ['Slash', '/', '?'],
  ],
];

function makeKernel() {
  const model = Object.create(TypewriterModel.prototype);
  let clock = 0;
  const key = (code) => ({
    code,
    phase: -1,
    duration: 0,
    depression: 0,
    baseY: 0,
    baseRotationX: 0,
    group: { position: { y: 0 }, rotation: { x: 0 } },
  });
  Object.assign(model, {
    commandSequence: 0,
    commandClock: () => clock,
    commandBurstLimit: 12,
    commandQueue: [],
    activeStrikes: [],
    strikeTimelineSeconds: 0,
    nextMechanicalImpactAt: 0,
    activeKeys: new Set(),
    latencySamples: [],
    latencyPeakQueueDepth: 0,
    keys: new Map([
      ['KeyA', key('KeyA')],
      ['KeyB', key('KeyB')],
      ['Space', key('Space')],
      ['Backspace', key('Backspace')],
    ]),
    typebars: new Map([
      ['KeyA', { code: 'KeyA', amount: 0 }],
      ['KeyB', { code: 'KeyB', amount: 0 }],
    ]),
    document: new TypewriterDocument({ columns: 100 }),
    paperRenderer: { drawImpression: vi.fn() },
    audio: {
      keyDown: vi.fn(),
      space: vi.fn(),
      backspace: vi.fn(),
      strike: vi.fn(),
      escapement: vi.fn(),
      bell: vi.fn(),
      tab: vi.fn(),
      ribbonReverse: vi.fn(),
    },
    onStatus: vi.fn(),
    onChange: vi.fn(),
    positionTypebar: vi.fn(),
    paperLoading: null,
    returning: null,
    tabMotion: null,
    marginReleased: false,
    inkMode: 'black',
    touchPreset: DEFAULT_TOUCH_PRESET,
    touchForce: 0.72,
    ribbonPosition: 0.12,
    ribbonDirection: 1,
    ribbonTurns: 0,
    machineImpulse: 0,
    escapementAmount: 0,
    bellAmount: 0,
    dimensions: { startCarriageX: 2.31, characterPitch: 0.071 },
    carriageTarget: 2.31,
    escapeWheel: { rotation: { z: 0 } },
    drawbandDrum: { rotation: { z: 0 } },
  });
  return {
    model,
    setClock(value) { clock = value; },
  };
}

describe('TypewriterModel no-lag command kernel', () => {
  it('defines every printable US-QWERTY code and both of its characters exactly once', () => {
    expect(CHARACTER_KEYS).toEqual(US_QWERTY_PRINTABLE_KEYS);

    const entries = US_QWERTY_PRINTABLE_KEYS.flat();
    expect(entries).toHaveLength(47);
    expect(new Set(entries.map(([code]) => code)).size).toBe(entries.length);
    expect(KEY_BY_CODE.size).toBe(entries.length);
    expect(CODE_BY_CHARACTER.size).toBe(entries.length * 2);

    for (const [code, lower, upper] of entries) {
      expect(KEY_BY_CODE.get(code)).toEqual({ code, lower, upper });
      expect(CODE_BY_CHARACTER.get(lower)).toBe(code);
      expect(CODE_BY_CHARACTER.get(upper)).toBe(code);
    }
  });

  it('starts key motion and touch audio synchronously with input', () => {
    const { model } = makeKernel();

    expect(model.queueCharacter('a', 'KeyA')).toBe(true);

    expect(model.keys.get('KeyA').phase).toBe(0);
    expect(model.audio.keyDown).toHaveBeenCalledOnce();
    expect(model.commandQueue).toHaveLength(1);
    expect(model.getLatencySnapshot().peakQueueDepth).toBe(1);
  });

  it('preserves Medium as the default touch calibration', () => {
    const { model } = makeKernel();
    model.queueCharacter('a', 'KeyA');
    const command = model.commandQueue[0];

    expect(DEFAULT_TOUCH_PRESET).toBe('medium');
    expect(TOUCH_PRESETS.medium).toMatchObject({
      force: 0.72,
      keyTravelScale: 1,
      timingScale: 1,
      soundScale: 1,
      impulseScale: 1,
    });
    expect(command).toMatchObject({
      force: 0.72,
      soundForce: 0.72,
      keyTravelScale: 1,
      duration: 0.135,
      impactSeconds: 0.055,
      releaseSeconds: 0.088,
      touchPreset: 'medium',
    });
    expect(model.keys.get('KeyA')).toMatchObject({ duration: 0.12, travelScale: 1 });
  });

  it('applies Light and Heavy resistance to travel, timing, ink, sound, and impulse', () => {
    const { model } = makeKernel();
    expect(model.setTouchPreset('Light')).toMatchObject({ preset: 'light', name: 'Light', force: 0.6 });
    model.queueCharacter('a', 'KeyA');
    const light = model.commandQueue[0];
    expect(light.force).toBe(0.6);
    expect(light.soundForce).toBeCloseTo(0.504);
    expect(light.duration).toBeCloseTo(0.1215);
    expect(light.impactSeconds).toBeCloseTo(0.0495);
    expect(light.keyTravelScale).toBe(0.94);

    model.commandQueue.length = 0;
    expect(model.setTouchPreset('HEAVY')).toMatchObject({ preset: 'heavy', name: 'Heavy', force: 0.86 });
    model.queueCharacter('b', 'KeyB');
    const heavy = model.commandQueue[0];
    expect(heavy.force).toBe(0.86);
    expect(heavy.soundForce).toBeCloseTo(0.9632);
    expect(heavy.duration).toBeCloseTo(0.1512);
    expect(heavy.impactSeconds).toBeCloseTo(0.0616);
    expect(heavy.keyTravelScale).toBe(1.08);

    model.startQueuedCommands();
    model.updateStrikes(0.064);
    expect(model.document.marks[0].force).toBe(0.86);
    expect(model.audio.strike).toHaveBeenCalledWith(heavy.soundForce);
    expect(model.machineImpulse).toBeCloseTo(0.009 * 0.86 * 1.28);
  });

  it('rejects an unknown touch preset without changing the active calibration', () => {
    const { model } = makeKernel();
    model.setTouchPreset('heavy');
    expect(() => model.setTouchPreset('impossible')).toThrow(RangeError);
    expect(model.getTouchCalibration()).toMatchObject({ preset: 'heavy', force: 0.86 });
  });

  it('cycles the modeled touch control in both directions', () => {
    const { model } = makeKernel();
    expect(model.cycleTouchPreset()).toMatchObject({ preset: 'heavy' });
    expect(model.cycleTouchPreset()).toMatchObject({ preset: 'light' });
    expect(model.cycleTouchPreset(-1)).toMatchObject({ preset: 'heavy' });
    expect(model.getTouchControlInteractionSnapshot()).toMatchObject({
      action: 'touch-cycle',
      preset: 'heavy',
      presets: ['light', 'medium', 'heavy'],
    });
  });

  it('exposes margin and tab settings for UI persistence and mechanical controls', () => {
    const { model } = makeKernel();
    expect(model.setMargins(6, 82)).toMatchObject({ leftMargin: 6, rightMargin: 82 });
    expect(model.setTabStops([12, 25, 50])).toEqual([12, 25, 50]);
    model.setTouchPreset('light');

    expect(model.getMechanicalSettings()).toEqual({
      leftMargin: 6,
      rightMargin: 82,
      tabStops: [12, 25, 50],
      touchPreset: 'light',
    });
    expect(model.getMarginStopInteractionSnapshot()).toMatchObject({
      left: { side: 'left', column: 6, minimumColumn: 0, maximumColumn: 81 },
      right: { side: 'right', column: 82, minimumColumn: 7, maximumColumn: 100 },
    });
    expect(model.onChange).toHaveBeenCalledWith(expect.objectContaining({ type: 'margins' }));
    expect(model.onChange).toHaveBeenCalledWith({ type: 'tab-stops', tabStops: [12, 25, 50] });
  });

  it('maps dragged margin stops to safe columns without allowing them to cross', () => {
    const { model } = makeKernel();
    model.setMargins(10, 20, { emit: false });
    expect(model.setMarginStopFromLocalX('left', 100, { emit: false })).toMatchObject({
      leftMargin: 19,
      rightMargin: 20,
    });
    expect(model.setMarginStopFromLocalX('right', -100, { emit: false })).toMatchObject({
      leftMargin: 19,
      rightMargin: 20,
    });
  });

  it('uses configured document tab stops in the model tab motion', () => {
    const { model } = makeKernel();
    model.document.setTabStops([3, 17, 44]);
    model.document.column = 4;
    model.carriagePosition = model.dimensions.startCarriageX
      - model.document.column * model.dimensions.characterPitch;

    model.startTab();

    expect(model.document.column).toBe(17);
    expect(model.tabMotion.result).toMatchObject({ tabStop: 17, column: 17 });
    expect(model.audio.tab).toHaveBeenCalledOnce();
  });

  it('drains a burst in bounded frame batches instead of serial cooldowns', () => {
    const { model } = makeKernel();
    for (let index = 0; index < 20; index += 1) model.queueCharacter('a', 'KeyA');

    expect(model.startQueuedCommands()).toBe(12);
    expect(model.commandQueue).toHaveLength(8);
    expect(model.startQueuedCommands()).toBe(8);
    expect(model.commandQueue).toHaveLength(0);
    expect(model.activeStrikes).toHaveLength(20);
  });

  it('keeps Heavy-touch strikes overlapping on the same bounded scheduler', () => {
    const { model } = makeKernel();
    model.setTouchPreset('heavy', { emit: false });
    for (let index = 0; index < 20; index += 1) model.queueCharacter('a', 'KeyA');

    expect(model.startQueuedCommands()).toBe(12);
    expect(model.activeStrikes[0].mechanicalImpactAt).toBeCloseTo(0.0616);
    expect(model.activeStrikes[1].mechanicalImpactAt - model.activeStrikes[0].mechanicalImpactAt).toBeCloseTo(0.008);
    expect(model.commandQueue).toHaveLength(8);
    expect(model.startQueuedCommands()).toBe(8);
    expect(model.activeStrikes).toHaveLength(20);
  });

  it('keeps its timeline and active commands monotonic across invalid frame deltas', () => {
    const { model } = makeKernel();
    model.updateKeys = vi.fn();
    model.updateReturn = vi.fn();
    model.updateTab = vi.fn();
    model.updatePaperLoading = vi.fn();
    model.updateMechanisms = vi.fn();

    model.queueCharacter('a', 'KeyA');
    model.startQueuedCommands();
    model.update(-8.5);
    model.update(Number.NaN);
    expect(model.strikeTimelineSeconds).toBe(0);
    expect(model.lastDelta).toBe(0);
    expect(model.activeStrikes[0].elapsed).toBe(0);

    for (let step = 0; step < 4; step += 1) model.update(0.04);
    expect(model.document.toPlainText()).toBe('a');
    expect(model.activeStrikes).toHaveLength(0);
  });

  it('ignores stale idle reservations while retaining overlapping impact slots', () => {
    const { model } = makeKernel();

    model.nextMechanicalImpactAt = 8.5;
    model.queueCharacter('a', 'KeyA');
    model.queueCharacter('b', 'KeyB');
    model.startQueuedCommands();

    expect(model.activeStrikes).toHaveLength(2);
    expect(model.activeStrikes[0].mechanicalDelay).toBe(0);
    expect(model.activeStrikes[0].mechanicalImpactAt).toBeCloseTo(0.055);
    expect(model.activeStrikes[1].mechanicalDelay).toBeCloseTo(0.008);
    expect(model.activeStrikes[1].mechanicalImpactAt).toBeCloseTo(0.063);
  });

  it('preserves character and space impact order while actions overlap', () => {
    const { model, setClock } = makeKernel();
    model.queueCharacter('a', 'KeyA');
    model.queueSpace();
    model.queueCharacter('b', 'KeyB');
    model.startQueuedCommands();

    setClock(80);
    model.updateStrikes(0.08);

    expect(model.document.toPlainText()).toBe('a b');
    expect(model.paperRenderer.drawImpression.mock.calls.map(([mark]) => mark.character)).toEqual(['a', 'b']);
  });

  it('gives only one typebar final reach while a 12ms burst stays ordered and responsive', () => {
    const { model, setClock } = makeKernel();
    const text = 'abababababababababab';
    let inputIndex = 0;
    let time = 0;
    let maximumTypebarsAtPrintPoint = 0;
    model.resetLatencyMetrics();

    while (time < 1000) {
      setClock(time);
      while (inputIndex < text.length && inputIndex * 12 <= time) {
        const character = text[inputIndex];
        model.queueCharacter(character, character === 'a' ? 'KeyA' : 'KeyB');
        inputIndex += 1;
      }
      model.startQueuedCommands();
      model.updateStrikes(0.004);
      maximumTypebarsAtPrintPoint = Math.max(
        maximumTypebarsAtPrintPoint,
        [...model.typebars.values()].filter((typebar) => typebar.amount > 0.82).length,
      );
      if (inputIndex === text.length && !model.activeStrikes.length && !model.commandQueue.length) break;
      time += 4;
    }

    expect(model.document.toPlainText()).toBe(text);
    expect(maximumTypebarsAtPrintPoint).toBeLessThanOrEqual(1);
    expect(model.audio.strike).toHaveBeenCalledTimes(text.length);
    expect(model.getLatencySnapshot().impactMs.p95).toBeLessThanOrEqual(125);
  });

  it('reports queue, impact, release, and completion latency', () => {
    const { model, setClock } = makeKernel();
    model.resetLatencyMetrics();
    model.queueCharacter('a', 'KeyA');
    setClock(8);
    model.startQueuedCommands();
    setClock(68);
    model.updateStrikes(0.06);
    setClock(108);
    model.updateStrikes(0.04);
    setClock(148);
    model.updateStrikes(0.04);

    const snapshot = model.getLatencySnapshot();
    expect(snapshot.sampleCount).toBe(1);
    expect(snapshot.startMs.max).toBe(8);
    expect(snapshot.impactMs.max).toBe(68);
    expect(snapshot.releaseMs.max).toBe(108);
    expect(snapshot.completeMs.max).toBe(148);
  });

  it('keeps transient state bounded through 15-, 60-, and 120-minute virtual sessions', () => {
    const { model, setClock } = makeKernel();
    const charactersPerMinute = 300; // Conventional 60 WPM at five characters per word.
    const totalActions = charactersPerMinute * 120;
    const milestones = new Map([
      [charactersPerMinute * 15, '15m'],
      [charactersPerMinute * 60, '60m'],
      [charactersPerMinute * 120, '120m'],
    ]);
    const snapshots = {};

    model.document = new TypewriterDocument({ columns: totalActions + 100, rightMargin: totalActions + 100 });
    model.paperRenderer.drawImpression = () => {};
    model.positionTypebar = () => {};
    model.onStatus = () => {};
    model.onChange = () => {};
    for (const name of Object.keys(model.audio)) model.audio[name] = () => {};

    for (let index = 0; index < totalActions; index += 1) {
      const inputTime = index * 200;
      setClock(inputTime);
      if (index % 5 === 4) model.queueSpace();
      else model.queueCharacter(index % 2 ? 'b' : 'a', index % 2 ? 'KeyB' : 'KeyA');
      model.startQueuedCommands();
      for (let stage = 1; stage <= 4; stage += 1) {
        setClock(inputTime + stage * 40);
        model.updateStrikes(0.04);
      }

      const label = milestones.get(index + 1);
      if (label) {
        snapshots[label] = {
          column: model.document.column,
          marks: model.document.marks.length,
          queue: model.commandQueue.length,
          activeStrikes: model.activeStrikes.length,
          latencySamples: model.latencySamples.length,
        };
      }
    }

    expect(snapshots).toEqual({
      '15m': { column: 4500, marks: 3600, queue: 0, activeStrikes: 0, latencySamples: 240 },
      '60m': { column: 18000, marks: 14400, queue: 0, activeStrikes: 0, latencySamples: 240 },
      '120m': { column: 36000, marks: 28800, queue: 0, activeStrikes: 0, latencySamples: 240 },
    });
    expect(model.activeKeys.size).toBeLessThanOrEqual(3);
    expect(model.getLatencySnapshot().peakQueueDepth).toBe(1);
  }, 15_000);
});
