import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { paperFlexOffset, flexPaperGeometry } from './paper-flex.js';
import { computeCrumpledPoint, PaperLifecycleView } from './paper-lifecycle-view.js';
import { makePaperFiberTexture } from './textures.js';

describe('physical paper constraints', () => {
  it('holds its gripped upper edge while the free lower edge curls', () => {
    expect(paperFlexOffset(1, 4, 6, 8, { impulse: 2, progress: 0.4 })).toBe(0);
    expect(paperFlexOffset(1, -4, 6, 8)).toBeGreaterThan(0);
    expect(paperFlexOffset(1, -4, 6, 8, { impulse: 2, progress: 0.4, reducedMotion: true }))
      .toBe(paperFlexOffset(1, -4, 6, 8));
  });

  it('deforms geometry without changing impression UVs or accumulating drift', () => {
    const geometry = new THREE.PlaneGeometry(6, 8, 8, 12);
    const base = geometry.attributes.position.array.slice();
    const uv = geometry.attributes.uv.array.slice();
    flexPaperGeometry(geometry, base, 6, 8);
    const first = geometry.attributes.position.array.slice();
    flexPaperGeometry(geometry, base, 6, 8);
    expect(geometry.attributes.position.array).toEqual(first);
    expect(geometry.attributes.uv.array).toEqual(uv);
    expect(geometry.attributes.position.array.every(Number.isFinite)).toBe(true);
    geometry.dispose();
  });

  it('makes coherent folds independent of vertex numbering and distinct per seed', () => {
    const point = { x: 1, y: 2, width: 6, height: 8, progress: 0.7, seed: 123 };
    expect(computeCrumpledPoint({ ...point, index: 1 })).toEqual(computeCrumpledPoint({ ...point, index: 987 }));
    expect(computeCrumpledPoint(point)).not.toEqual(computeCrumpledPoint({ ...point, seed: 456 }));
  });

  it('completes reduced motion with lifecycle attachment events intact', async () => {
    const scene = new THREE.Scene();
    const source = new THREE.Mesh(new THREE.PlaneGeometry(6, 8));
    scene.add(source);
    const events = [];
    const view = new PaperLifecycleView({ parent: scene, reducedMotion: true, getMachinePaperMesh: () => source, onEvent: event => events.push(event.type) });
    const loading = view.loadFreshSheet({ pageId: 'fresh' });
    view.update(1 / 60);
    await loading;
    expect(events).toEqual(['fresh-sheet-start', 'fresh-sheet-attach', 'fresh-sheet-complete']);
    expect(view.phase).toBe('idle');
    view.dispose();
  });

  it('keeps the thin perimeter attached to the deformed sheet', async () => {
    const scene = new THREE.Scene();
    const source = new THREE.Mesh(new THREE.PlaneGeometry(6, 8));
    scene.add(source);
    const view = new PaperLifecycleView({ parent: scene, reducedMotion: true, getMachinePaperMesh: () => source });
    const extracting = view.extract({ pageId: 'edge-test' });
    view.update(1 / 60);
    const { mesh } = await extracting;
    const edge = mesh.getObjectByName('PaperThinEdge');
    edge.onBeforeRender();
    const positions = edge.geometry.attributes.position;
    expect(positions.array.every(Number.isFinite)).toBe(true);
    expect(Math.hypot(positions.getX(0) - positions.getX(1), positions.getY(0) - positions.getY(1), positions.getZ(0) - positions.getZ(1)))
      .toBeCloseTo(0.005, 4);
    view.dispose();
  });

  it('produces deterministic compact opaque fiber relief', () => {
    const first = makePaperFiberTexture();
    const second = makePaperFiberTexture();
    expect(first.image.data).toEqual(second.image.data);
    expect(first.image.data.length).toBe(128 * 128 * 4);
    expect(first.image.data.filter((_, i) => i % 4 === 3).every(value => value === 255)).toBe(true);
    first.dispose(); second.dispose();
  });
});
