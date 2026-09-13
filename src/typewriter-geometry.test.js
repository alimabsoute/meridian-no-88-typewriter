import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TypewriterDocument } from './typewriter-document.js';
import { CHARACTER_KEYS, TOUCH_PRESETS, TypewriterModel } from './typewriter-model.js';

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

describe('Octoberline 211 keyboard geometry clearance', () => {
  let model;

  beforeAll(() => {
    model = makeGeometryModel();
  });

  afterAll(() => {
    model.disposeKeyRenderBatches();
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
  }, 15_000);

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
  }, 15_000);

  it('keeps Heavy-touch key travel clear of the machine shell', () => {
    const snapshot = model.getKeyShellClearanceSnapshot({
      travelScale: TOUCH_PRESETS.heavy.keyTravelScale,
    });

    expect(snapshot.rest.intersections).toEqual([]);
    expect(snapshot.depressed.intersections).toEqual([]);
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

  it('renders repeated key parts in five batches without changing their geometry or material', () => {
    expect(model.keyRenderBatches).toHaveLength(5);
    let proxyCount = 0;
    for (const { mesh, proxies } of model.keyRenderBatches) {
      expect(mesh.count).toBe(47);
      expect(mesh.frustumCulled).toBe(false);
      expect(mesh.castShadow).toBe(false);
      for (const proxy of proxies) {
        expect(proxy.visible).toBe(false);
        expect(mesh.geometry).toBe(proxy.geometry);
        expect(mesh.material).toBe(proxy.material);
        proxyCount += 1;
      }
    }
    expect(proxyCount - model.keyRenderBatches.length).toBe(230);
    for (const key of model.keys.values()) {
      if (key.action === 'character') expect(key.labelDisc.visible).toBe(true);
      else expect(key.base.visible).toBe(true);
    }
  });

  it('keeps batched key matrices aligned at rest, during key travel, and under shifted inspection', () => {
    const local = new THREE.Matrix4();
    const world = new THREE.Matrix4();
    const checkMatrices = () => {
      model.scene.updateMatrixWorld(true);
      for (const { mesh, proxies } of model.keyRenderBatches) {
        proxies.forEach((proxy, index) => {
          mesh.getMatrixAt(index, local);
          world.multiplyMatrices(mesh.matrixWorld, local);
          world.elements.forEach((value, component) => {
            expect(value).toBeCloseTo(proxy.matrixWorld.elements[component], 5);
          });
        });
      }
    };
    model.updateKeyRenderBatches();
    checkMatrices();
    model.audio.shift = vi.fn();
    model.root.position.set(.3, .2, -.1);
    model.root.rotation.y = .18;
    model.animateKey('KeyA', .2);
    model.setShiftHeld(true, 'ShiftRight');
    model.toggleShiftLock();
    model.setInspection(true);
    model.update(.04);
    model.update(.04);
    expect(model.keys.get('KeyA').depression).toBeGreaterThan(.1);
    expect(model.shiftAmount).toBeGreaterThan(0);
    expect(model.inspectionAmount).toBeGreaterThan(0);
    checkMatrices();
    model.setShiftHeld(false);
    model.toggleShiftLock();
    model.setInspection(false);
    model.root.position.set(0, 0, 0);
    model.root.rotation.y = 0;
    for (let step = 0; step < 80; step += 1) model.update(.04);
    checkMatrices();
    const versions = model.keyRenderBatches.map(({ mesh }) => mesh.instanceMatrix.version);
    model.updateKeyRenderBatches();
    expect(model.keyRenderBatches.map(({ mesh }) => mesh.instanceMatrix.version)).toEqual(versions);
  });

  it('retains hidden key proxies for pointer hits and disposes only owned instance buffers', () => {
    const key = model.keys.get('KeyA');
    model.scene.updateMatrixWorld(true);
    const center = key.cap.getWorldPosition(new THREE.Vector3());
    const ray = new THREE.Raycaster(center.clone().add(new THREE.Vector3(0, 2, 0)), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObjects(model.clickTargets, false)[0];
    expect(hit?.object.userData.keyRecord).toBe(key);
    expect(key.cap.visible).toBe(false);
    const batches = model.keyRenderBatches;
    const disposeSpies = batches.map(({ mesh }) => vi.spyOn(mesh, 'dispose'));
    const geometryDispose = vi.spyOn(batches[0].mesh.geometry, 'dispose');
    const materialDispose = vi.spyOn(batches[0].mesh.material, 'dispose');
    model.disposeKeyRenderBatches();
    model.disposeKeyRenderBatches();
    expect(disposeSpies.every((spy) => spy.mock.calls.length === 1)).toBe(true);
    expect(geometryDispose).not.toHaveBeenCalled();
    expect(materialDispose).not.toHaveBeenCalled();
    expect(key.cap.visible).toBe(true);
    model.buildKeyRenderBatches();
  });

  it('does no key batch matrix work while idle and updates only the moving key slot', () => {
    for (let step = 0; step < 80; step += 1) model.update(.04);
    const spies = model.keyRenderBatches.flatMap(({ proxies }) => proxies.map((proxy) => vi.spyOn(proxy, 'updateMatrix')));
    const groupSpies = model.keyRenderKeys.map((key) => vi.spyOn(key.group, 'updateMatrix'));
    try {
      model.update(.04);
      expect(spies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
      expect(groupSpies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
      model.animateKey('KeyO', .2);
      model.update(.04);
      expect(spies.reduce((total, spy) => total + spy.mock.calls.length, 0)).toBe(5);
      expect(groupSpies.reduce((total, spy) => total + spy.mock.calls.length, 0)).toBe(1);
      for (const spy of [...spies, ...groupSpies]) spy.mockClear();
      model.updateKeyRenderBatches();
      expect(spies.every((spy) => spy.mock.calls.length === 1)).toBe(true);
      expect(groupSpies.every((spy) => spy.mock.calls.length === 1)).toBe(true);
    } finally {
      for (const spy of [...spies, ...groupSpies]) spy.mockRestore();
      for (let step = 0; step < 80; step += 1) model.update(.04);
    }
  });
});
