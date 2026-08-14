import { describe, expect, it, vi } from 'vitest';
import { TypewriterDocument } from './typewriter-document.js';
import {
  CHARACTER_KEYS,
  CODE_BY_CHARACTER,
  KEY_BY_CODE,
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
  const key = (code) => ({ code, phase: -1, duration: 0, depression: 0 });
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

  it('drains a burst in bounded frame batches instead of serial cooldowns', () => {
    const { model } = makeKernel();
    for (let index = 0; index < 20; index += 1) model.queueCharacter('a', 'KeyA');

    expect(model.startQueuedCommands()).toBe(12);
    expect(model.commandQueue).toHaveLength(8);
    expect(model.startQueuedCommands()).toBe(8);
    expect(model.commandQueue).toHaveLength(0);
    expect(model.activeStrikes).toHaveLength(20);
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
  });
});
