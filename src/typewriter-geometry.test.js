import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TypewriterDocument } from './typewriter-document.js';
import { CHARACTER_KEYS, TypewriterModel } from './typewriter-model.js';

const PRINTABLE_NEIGHBOR_PAIRS = CHARACTER_KEYS.flatMap((row) => (
  row.slice(1).map(([code], index) => [row[index][0], code])
));

const KEYBOARD_EDGE_NEIGHBOR_PAIRS = [
  ['Backquote', 'Tab'],
  ['KeyQ', 'Tab'],
  ['Equal', 'Backspace'],
  ['KeyA', 'CapsLock'],
  ['Quote', 'MarginRelease'],
  ['KeyZ', 'ShiftLeft'],
  ['Slash', 'ShiftRight'],
  ['ShiftLeft', 'Space'],
  ['ShiftRight', 'Space'],
];

function makeCanvasDocumentStub() {
  const gradient = { addColorStop() {} };
  const context = new Proxy({
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    getImageData: (_x, _y, width, height) => ({
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
    }),
    measureText: () => ({ width: 0 }),
  }, {
    get(target, property) {
      if (property in target) return target[property];
      return () => {};
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    },
  });
  return {
    createElement() {
      return { width: 0, height: 0, getContext: () => context };
    },
  };
}

function makeGeometryModel() {
  const previousDocument = globalThis.document;
  globalThis.document = makeCanvasDocumentStub();
  try {
    return new TypewriterModel({
      scene: new THREE.Scene(),
      documentState: new TypewriterDocument({ columns: 80 }),
      paperRenderer: { texture: new THREE.Texture(), drawImpression: vi.fn() },
      audio: {},
    });
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
}

describe('Meridian keyboard geometry clearance', () => {
  let model;

  beforeAll(() => {
    model = makeGeometryModel();
  });

  afterAll(() => {
    model.root.traverse((object) => {
      object.geometry?.dispose?.();
      if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose?.());
      else object.material?.dispose?.();
    });
  });

  it('models every printable US-QWERTY key and its dedicated typebar', () => {
    const printableEntries = CHARACTER_KEYS.flat();
    expect(printableEntries).toHaveLength(47);

    for (const [code, lower, upper] of printableEntries) {
      const key = model.keys.get(code);
      const typebar = model.typebars.get(code);
      expect(key, `${code} key`).toBeDefined();
      expect(typebar, `${code} typebar`).toBeDefined();
      expect(key.action).toBe('character');
      expect(key.lower).toBe(lower);
      expect(key.upper).toBe(upper);
      expect(key.typebar).toBe(typebar);
      expect(key.group.userData.keyRecord).toBe(key);
      expect(key.cap.userData.keyRecord).toBe(key);
      expect(key.ring.userData.keyRecord).toBe(key);
      expect(key.labelDisc.userData.keyRecord).toBe(key);
      expect(model.clickTargets).toEqual(expect.arrayContaining([key.cap, key.ring, key.labelDisc]));
      expect(typebar.lower).toBe(lower);
      expect(typebar.upper).toBe(upper);
    }
  });

  it('places Backquote at the far-left number-row position without shifting the restored layout', () => {
    const backquote = model.keys.get('Backquote');
    const digit1 = model.keys.get('Digit1');
    const equal = model.keys.get('Equal');
    const backspace = model.keys.get('Backspace');

    expect(backquote.group.position.x).toBeLessThan(digit1.group.position.x);
    expect(backquote.group.position.z).toBeCloseTo(digit1.group.position.z, 8);
    expect(backquote.group.position.y).toBeCloseTo(digit1.group.position.y, 8);
    expect(digit1.group.position.x - backquote.group.position.x).toBeCloseTo(0.58, 8);
    expect(digit1.group.position.x).toBeCloseTo(-3.19, 8);
    expect(equal.group.position.x).toBeCloseTo(3.19, 8);
    expect(equal.group.position.x).toBeLessThan(backspace.group.position.x);
  });

  it('keeps every rendered key top clear of every shell through full travel', () => {
    const snapshot = model.getKeyShellClearanceSnapshot();

    expect(snapshot.unsupportedShells).toEqual([]);
    expect(snapshot.rest.intersections).toEqual([]);
    expect(snapshot.depressed.intersections).toEqual([]);
    expect(snapshot.sweep.sampleCount).toBe(11);
    expect(snapshot.sweep.intersections).toEqual([]);
    expect(snapshot.sweep.minimumClearance).toBeGreaterThan(0.015);
  });

  it('uses rest transforms instead of reporting animation-state false positives', () => {
    const key = model.keys.get('KeyA');
    const originalY = key.group.position.y;
    const originalRotationX = key.group.rotation.x;
    const originalCoverPosition = model.topCover.position.clone();
    const originalCoverRotationX = model.topCover.rotation.x;

    key.group.position.y = key.baseY - 0.095;
    key.group.rotation.x = key.baseRotationX - 0.038;
    model.topCover.position.set(0, 0.8, 2.5);
    model.topCover.rotation.x = -1.1;
    const snapshot = model.getKeyShellClearanceSnapshot({ sweepSteps: 1 });

    key.group.position.y = originalY;
    key.group.rotation.x = originalRotationX;
    model.topCover.position.copy(originalCoverPosition);
    model.topCover.rotation.x = originalCoverRotationX;

    expect(snapshot.rest.intersections).toEqual([]);
    expect(snapshot.depressed.intersections).toEqual([]);
  });

  it('detects the former solid front-skirt regression deterministically', () => {
    const geometry = new RoundedBoxGeometry(8.45, 1.08, 1.26, 4, 0.19);
    geometry.userData.clearanceShape = {
      type: 'rounded-box',
      halfExtents: [8.45 / 2, 1.08 / 2, 1.26 / 2],
      radius: 0.19,
    };
    const fixture = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    fixture.name = 'RegressionFrontSkirt';
    fixture.position.set(0, 0.82, 2.66);
    fixture.rotation.x = -0.12;
    fixture.updateMatrix();
    fixture.userData.clearanceRestMatrix = fixture.matrix.clone();
    model.shellMeshes.push(fixture);

    const snapshot = model.getKeyShellClearanceSnapshot({ sweepSteps: 1 });
    model.shellMeshes.pop();
    fixture.geometry.dispose();
    fixture.material.dispose();

    expect(snapshot.rest.intersections.some(({ key, shell }) => key === 'KeyA' && shell === 'RegressionFrontSkirt')).toBe(true);
    expect(snapshot.depressed.intersections.some(({ key, shell }) => key === 'KeyZ' && shell === 'RegressionFrontSkirt')).toBe(true);
    expect(snapshot.sweep.minimumClearance).toBeLessThan(-0.1);
  });

  it('preserves swept clearance for every printable and keyboard-edge neighbor', () => {
    const pairs = [...PRINTABLE_NEIGHBOR_PAIRS, ...KEYBOARD_EDGE_NEIGHBOR_PAIRS];
    const snapshot = model.getKeyNeighborClearanceSnapshot(pairs);
    const backquoteDigit1 = snapshot.pairs.find(({ keys }) => keys[0] === 'Backquote' && keys[1] === 'Digit1');
    const backquoteTab = snapshot.pairs.find(({ keys }) => keys[0] === 'Backquote' && keys[1] === 'Tab');
    const qTab = snapshot.pairs.find(({ keys }) => keys[0] === 'KeyQ');
    const equalBackspace = snapshot.pairs.find(({ keys }) => keys[0] === 'Equal');

    expect(snapshot.sampleCountPerPair).toBe(121);
    expect(snapshot.pairs).toHaveLength(pairs.length);
    expect(snapshot.pairs.every(({ error }) => !error)).toBe(true);
    expect(snapshot.intersections).toEqual([]);
    expect(Math.min(...snapshot.pairs.map(({ minimumClearance }) => minimumClearance))).toBeGreaterThan(0.015);
    expect(backquoteDigit1.minimumClearance).toBeGreaterThan(0.02);
    expect(backquoteTab.minimumClearance).toBeGreaterThan(0.02);
    expect(qTab.minimumClearance).toBeGreaterThan(0.02);
    expect(equalBackspace.minimumClearance).toBeGreaterThan(0.02);
  });

  it('detects a printable-neighbor overlap through the full travel sweep', () => {
    const backquote = model.keys.get('Backquote');
    const digit1 = model.keys.get('Digit1');
    const originalDigit1X = digit1.group.position.x;
    digit1.group.position.x = backquote.group.position.x + 0.4;

    const snapshot = model.getKeyNeighborClearanceSnapshot([['Backquote', 'Digit1']]);
    digit1.group.position.x = originalDigit1X;

    expect(snapshot.intersections).toHaveLength(1);
    expect(snapshot.intersections[0].keys).toEqual(['Backquote', 'Digit1']);
    expect(snapshot.intersections[0].minimumClearance).toBeLessThan(0);
  });

  it('detects the former Q/Tab and Equal/Backspace overlaps', () => {
    const tab = model.keys.get('Tab');
    const backspace = model.keys.get('Backspace');
    const originalTabX = tab.group.position.x;
    const originalBackspaceX = backspace.group.position.x;
    tab.group.position.x = -4.0;
    backspace.group.position.x = 3.83;

    const snapshot = model.getKeyNeighborClearanceSnapshot();
    tab.group.position.x = originalTabX;
    backspace.group.position.x = originalBackspaceX;

    expect(snapshot.intersections.map(({ keys }) => keys)).toEqual([
      ['KeyQ', 'Tab'],
      ['Equal', 'Backspace'],
    ]);
    expect(snapshot.intersections.every(({ minimumClearance }) => minimumClearance < 0)).toBe(true);
  });
});
