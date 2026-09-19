import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TypewriterDocument } from '../src/typewriter-document.js';
import { CHARACTER_KEYS, TOUCH_PRESETS, TypewriterModel } from '../src/typewriter-model.js';

// Native geometry/raycast checks using real THREE math and a no-op canvas.
// Does not claim browser font, lighting, or visual legibility verification.
const originalDocument = globalThis.document;
const gradient = { addColorStop() {} };
const context = new Proxy({
  createLinearGradient: () => gradient,
  createRadialGradient: () => gradient,
  getImageData: (_x, _y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4), width, height }),
  measureText: () => ({ width: 0 }),
}, { get: (target, property) => property in target ? target[property] : () => {}, set: (target, property, value) => { target[property] = value; return true; } });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
let model;
try {
  model = new TypewriterModel({ scene: new THREE.Scene(), documentState: new TypewriterDocument({ columns: 80 }), paperRenderer: { texture: new THREE.Texture(), drawImpression() {} }, audio: { shift() {} } });
} finally {
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
}
try {
  for (const key of model.keys.values()) {
    assert.equal(key.group.rotation.x, key.baseRotationX, `${key.code} rest tilt`);
    assert.equal(key.baseRotationX, 0.24, `${key.code} forward-readable face`);
  }
  const pairs = [
    ...CHARACTER_KEYS.flatMap(row => row.slice(1).map(([code], index) => [row[index][0], code])),
    ['Backquote', 'Tab'], ['KeyQ', 'Tab'], ['Equal', 'Backspace'], ['KeyA', 'CapsLock'],
    ['Quote', 'MarginRelease'], ['KeyZ', 'ShiftLeft'], ['Slash', 'ShiftRight'], ['ShiftLeft', 'Space'], ['ShiftRight', 'Space'],
  ];
  const neighbors = model.getKeyNeighborClearanceSnapshot(pairs);
  assert.deepEqual(neighbors.intersections, [], 'neighbor shells must remain clear across full key travel');
  const neighborMinimum = Math.min(...neighbors.pairs.map(pair => pair.minimumClearance));
  assert.ok(neighborMinimum > 0.015, `neighbor minimum ${neighborMinimum}`);
  const shells = model.getKeyShellClearanceSnapshot({ travelScale: TOUCH_PRESETS.heavy.keyTravelScale });
  for (const phase of ['rest', 'depressed', 'sweep']) assert.deepEqual(shells[phase].intersections, [], `${phase} shell clearance`);
  assert.ok(shells.sweep.minimumClearance > 0.015);

  const local = new THREE.Matrix4();
  const world = new THREE.Matrix4();
  function checkInstances() {
    model.scene.updateMatrixWorld(true);
    for (const { mesh, proxies } of model.keyRenderBatches) for (const [index, proxy] of proxies.entries()) {
      mesh.getMatrixAt(index, local);
      world.multiplyMatrices(mesh.matrixWorld, local);
      world.elements.forEach((value, component) => assert.ok(Math.abs(value - proxy.matrixWorld.elements[component]) < 0.00001, 'instance/proxy transform alignment'));
    }
  }
  function checkHit(code) {
    const key = model.keys.get(code);
    model.scene.updateMatrixWorld(true);
    const center = key.cap.getWorldPosition(new THREE.Vector3());
    const ray = new THREE.Raycaster(center.clone().add(new THREE.Vector3(0, 2, 0)), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObjects(model.clickTargets, false)[0];
    assert.equal(hit?.object.userData.keyRecord, key, `${code} proxy raycast`);
  }
  model.updateKeyRenderBatches();
  checkInstances();
  for (const code of ['KeyA', 'KeyQ', 'KeyZ', 'Digit1']) checkHit(code);
  model.root.position.set(0.3, 0.2, -0.1);
  model.root.rotation.y = 0.18;
  model.animateKey('KeyA', 0.2);
  model.setShiftHeld(true, 'ShiftRight');
  model.toggleShiftLock();
  model.setInspection(true);
  model.update(0.04);
  model.update(0.04);
  assert.ok(model.keys.get('KeyA').depression > 0.1);
  checkInstances();
  checkHit('KeyA');
  model.setShiftHeld(false);
  model.toggleShiftLock();
  model.setInspection(false);
  model.root.position.set(0, 0, 0);
  model.root.rotation.y = 0;
  for (let step = 0; step < 80; step++) model.update(0.04);
  checkInstances();
  for (const key of model.keys.values()) assert.ok(Math.abs(key.group.rotation.x - key.baseRotationX) < 0.00001);
  const versions = model.keyRenderBatches.map(({ mesh }) => mesh.instanceMatrix.version);
  model.update(0.04);
  assert.deepEqual(model.keyRenderBatches.map(({ mesh }) => mesh.instanceMatrix.version), versions, 'idle remains free of instance uploads');
  assert.equal(model.materials.paper.roughness, 1);
  assert.equal(model.materials.paper.envMapIntensity, 0);
  assert.equal(model.materials.paper.specularIntensity, 0, 'paper ink must not pick up a warm specular veil');
  for (const key of model.keys.values()) {
    const labels = key.labelDisc ? [key.labelDisc] : key.group.children.filter(child => child.material?.map);
    for (const label of labels) {
      assert.equal(label.material.isMeshBasicMaterial, true, `${key.code} legend stays free of lighting glare`);
      assert.equal(label.material.toneMapped, false, `${key.code} legend stays free of exposure washout`);
    }
  }
  assert.ok(model.materials.paper.bumpScale <= 0.004);
  console.log(JSON.stringify({ passed: true, keyCount: model.keys.size, neighborPairs: pairs.length, neighborMinimum, shellMinimum: shells.sweep.minimumClearance, instancedBatches: model.keyRenderBatches.length, raycasts: 5, limitation: 'Native geometry only; visual clarity requires browser inspection.' }, null, 2));
} finally {
  model.disposeKeyRenderBatches();
  model.root.traverse(object => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) object.material.forEach(material => material.dispose?.());
    else object.material?.dispose?.();
  });
}
