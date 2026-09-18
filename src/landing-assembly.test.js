import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TypewriterDocument } from './typewriter-document.js';
import { TypewriterModel } from './typewriter-model.js';
import { createLandingAnimationClock, createLandingAssemblyParts, disposeLandingScene, startLandingAssembly, waitForLandingPrograms } from './landing-assembly.js';

function canvasDocument() {
  const gradient = { addColorStop() {} };
  const context = new Proxy({
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    getImageData: (_x, _y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4), width, height }),
    measureText: () => ({ width: 0 }),
  }, {
    get(target, property) { return property in target ? target[property] : () => {}; },
    set(target, property, value) { target[property] = value; return true; },
  });
  return { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
}

describe('real model landing assembly', () => {
  let model;
  let assembly;
  let geometries;
  let materials;

  beforeAll(() => {
    const previous = globalThis.document;
    globalThis.document = canvasDocument();
    try {
      const documentState = new TypewriterDocument();
      documentState.column = 32;
      model = new TypewriterModel({
        scene: new THREE.Scene(), documentState,
        paperRenderer: { texture: new THREE.Texture() }, audio: {}, reducedMotion: true,
      });
    } finally {
      if (previous === undefined) delete globalThis.document;
      else globalThis.document = previous;
    }
    geometries = new Map();
    materials = new Map();
    model.machine.traverse((object) => {
      if (object.geometry) geometries.set(object, object.geometry);
      if (object.material) materials.set(object, object.material);
    });
    assembly = createLandingAssemblyParts(model);
  });

  afterAll(() => disposeLandingScene(model.scene, model.materials));

  it('animates 21 existing groups without cloning any authored geometry or materials', () => {
    expect(assembly.parts).toHaveLength(21);
    expect(new Set(assembly.parts.map((part) => part.name)).size).toBe(21);
    for (const [object, geometry] of geometries) expect(object.geometry).toBe(geometry);
    for (const [object, material] of materials) expect(object.material).toBe(material);
    for (const { object } of assembly.originals) {
      let carriers = 0;
      for (let parent = object.parent; parent; parent = parent.parent) {
        if (parent.name.startsWith('LandingAssembly_')) carriers += 1;
      }
      expect(carriers, object.name).toBeLessThanOrEqual(1);
    }
  });

  it('keeps every visible key instance exactly aligned with its original moving proxy and label group', () => {
    expect(assembly.parts.reduce((count, part) => count + part.instances.length, 0)).toBe(235);
    const matrix = new THREE.Matrix4();
    const world = new THREE.Matrix4();
    for (const time of [0, 1.3, 2.7, 4.6]) {
      assembly.setTime(time);
      for (const { mesh, proxies } of model.keyRenderBatches) {
        proxies.forEach((proxy, index) => {
          mesh.getMatrixAt(index, matrix);
          world.multiplyMatrices(mesh.matrixWorld, matrix);
          const difference = Math.max(...world.elements.map((value, component) => Math.abs(value - proxy.matrixWorld.elements[component])));
          expect(difference, `${mesh.name} at ${time}s, key ${index}`).toBeLessThan(5e-7);
          expect(proxy.visible).toBe(false);
        });
      }
    }
  });

  it('restores every original world transform and instance matrix, including the nested carriage and paper', () => {
    assembly.setTime(0);
    expect(assembly.getRestError()).toBeGreaterThan(1);
    assembly.setTime(4.6);
    expect(assembly.parts.every((part) => part.progress === 1)).toBe(true);
    expect(assembly.getRestError()).toBeLessThan(1e-12);
    assembly.setTime(0);
    assembly.setTime(4.6);
    expect(assembly.getRestError()).toBeLessThan(1e-12);
  });

  it('finishes the actual model entrance in the same visible time at smooth, stalled and one-frame-per-second cadences', () => {
    const smoothFrames = [...Array.from({ length: 276 }, (_, index) => index * 1000 / 60), 4600];
    for (const timestamps of [smoothFrames, [0, 1000, 2000, 3000, 4000, 4600], [0, 16, 33, 3100, 4600]]) {
      const clock = createLandingAnimationClock();
      for (const timestamp of timestamps) assembly.setTime(clock.advance(timestamp));
      expect(assembly.parts.every(part => part.progress === 1)).toBe(true);
      expect(assembly.getRestError()).toBeLessThan(1e-12);
    }
  });

  it('holds the separated model while a tab is hidden and resumes only its remaining visible duration', () => {
    const clock = createLandingAnimationClock();
    clock.advance(0);
    assembly.setTime(clock.advance(1000));
    const beforePause = assembly.getRestError();
    const progressBeforePause = assembly.parts.map(part => part.progress);
    clock.pause();
    // Returning after a minute in another tab must not finish the entrance.
    assembly.setTime(clock.advance(61000));
    expect(assembly.getRestError()).toBe(beforePause);
    expect(assembly.parts.map(part => part.progress)).toEqual(progressBeforePause);
    assembly.setTime(clock.advance(64600));
    expect(assembly.parts.every(part => part.progress === 1)).toBe(true);
    expect(assembly.getRestError()).toBeLessThan(1e-12);
    clock.reset();
    assembly.setTime(clock.advance(100000));
    expect(assembly.parts.every(part => part.progress === 0)).toBe(true);
    expect(assembly.getRestError()).toBeGreaterThan(1);
  });

  it('disposes all 13 instanced allocations and hidden studio geometry exactly once per resource', () => {
    const scene = new THREE.Scene();
    const material = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
    const geometry = new THREE.BoxGeometry();
    const visible = new THREE.InstancedMesh(geometry, material, 2);
    const hidden = new THREE.InstancedMesh(geometry, material, 3);
    hidden.visible = false;
    scene.add(visible, hidden);
    const calls = { instance: 0, geometry: 0, texture: 0, material: 0 };
    visible.addEventListener('dispose', () => calls.instance++);
    hidden.addEventListener('dispose', () => calls.instance++);
    geometry.addEventListener('dispose', () => calls.geometry++);
    material.addEventListener('dispose', () => calls.material++);
    material.map.addEventListener('dispose', () => calls.texture++);
    expect(disposeLandingScene(scene, { duplicate: material })).toEqual({ geometries: 1, materials: 1, textures: 1, instanceBuffers: 2, shadowTargets: 0 });
    expect(calls).toEqual({ instance: 2, geometry: 1, texture: 1, material: 1 });
    let actualBatches = 0;
    model.root.traverse((object) => { if (object.isInstancedMesh) actualBatches++; });
    expect(actualBatches).toBe(13);
  });
});

describe('landing assembly cancellation', () => {
  it('waits for parallel shader completion without querying disposed program handles after entry', async () => {
    let cancelled = false;
    const getProgramParameter = vi.fn(() => false);
    const renderer = {
      extensions: { get: () => ({ COMPLETION_STATUS_KHR: 0x91b1 }) },
      info: { programs: [{ program: 'native-handle' }] },
      getContext: () => ({ getProgramParameter }),
    };
    const afterPaint = vi.fn(async () => { cancelled = true; return false; });
    expect(await waitForLandingPrograms(renderer, afterPaint, () => cancelled)).toBe(false);
    expect(getProgramParameter).toHaveBeenCalledExactlyOnceWith('native-handle', 0x91b1);
    expect(afterPaint).toHaveBeenCalledOnce();
  });

  it('lets the shell paint while parallel shaders link, then proceeds only when all are ready', async () => {
    let ready = false;
    const renderer = {
      extensions: { get: () => ({ COMPLETION_STATUS_KHR: 0x91b1 }) },
      info: { programs: [{ program: 'a' }, { program: 'b' }] },
      getContext: () => ({ getProgramParameter: () => ready }),
    };
    const afterPaint = vi.fn(async () => { ready = true; return true; });
    expect(await waitForLandingPrograms(renderer, afterPaint, () => false)).toBe(true);
    expect(afterPaint).toHaveBeenCalledOnce();
  });

  it('keeps a cancellable paint boundary on devices without parallel shader support', async () => {
    const renderer = { extensions: { get: () => null }, getContext: vi.fn() };
    const afterPaint = vi.fn(async () => true);
    expect(await waitForLandingPrograms(renderer, afterPaint, () => false)).toBe(true);
    expect(afterPaint).toHaveBeenCalledOnce();
    expect(renderer.getContext).not.toHaveBeenCalled();
    expect(await waitForLandingPrograms(renderer, afterPaint, () => true)).toBe(false);
    expect(afterPaint).toHaveBeenCalledOnce();
  });

  it('settles without creating a renderer when entry has already begun', async () => {
    const preview = startLandingAssembly({ container: null, landing: { started: true } });
    expect(await preview.ready).toMatchObject({ disposed: true, phase: 'disposed', frameCount: 0, renderer: null });
    expect(preview.replay()).toBe(false);
  });

  it('synchronously cancels a scheduled preview and settles ready before any asynchronous stage can run', async () => {
    const container = { dataset: {}, classList: { remove: vi.fn() } };
    const preview = startLandingAssembly({ container, landing: { started: false } });
    preview.dispose();
    preview.dispose();
    expect(await preview.ready).toMatchObject({ phase: 'disposed', disposed: true, activeFrame: false, frameCount: 0, renderer: null });
    expect(container.dataset.assemblyState).toBe('disposed');
    expect(preview.replay()).toBe(false);
  });
});
