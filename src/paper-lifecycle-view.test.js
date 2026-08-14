import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  PaperLifecycleView,
  computeCrumpledPoint,
  deterministicUnit,
  sampleThrowArc,
} from './paper-lifecycle-view.js';

function finish(view, seconds = 3) {
  for (let elapsed = 0; elapsed < seconds; elapsed += 1 / 60) view.update(1 / 60);
}

describe('paper lifecycle motion helpers', () => {
  it('produces deterministic seeded values', () => {
    expect(deterministicUnit(42, 7, 2)).toBe(deterministicUnit(42, 7, 2));
    expect(deterministicUnit(42, 7, 2)).not.toBe(deterministicUnit(43, 7, 2));
  });

  it('keeps an untouched page exact and compresses a completed crumple', () => {
    const source = { x: 2.4, y: 3.2, z: 0 };
    expect(computeCrumpledPoint({
      ...source,
      index: 12,
      progress: 0,
      seed: 19,
      width: 5.8,
      height: 7.5,
    })).toEqual(source);

    const crumpled = computeCrumpledPoint({
      ...source,
      index: 12,
      progress: 1,
      seed: 19,
      width: 5.8,
      height: 7.5,
    });
    expect(Math.hypot(crumpled.x, crumpled.y, crumpled.z)).toBeLessThan(0.9);
  });

  it('uses exact endpoints and a raised midpoint for a throw', () => {
    const from = { x: -2, y: 1, z: 3 };
    const to = { x: 4, y: 0.5, z: -1 };
    expect(sampleThrowArc(from, to, 0, { seed: 1 })).toEqual(from);
    expect(sampleThrowArc(from, to, 1, { seed: 1 })).toEqual(to);
    expect(sampleThrowArc(from, to, 0.5, { seed: 1, height: 2 }).y).toBeGreaterThan(2);
  });
});

describe('PaperLifecycleView', () => {
  it('extracts, crumples, throws, and exposes a recoverable raycast target', async () => {
    const scene = new THREE.Scene();
    const source = new THREE.Mesh(new THREE.PlaneGeometry(5.8, 7.505, 8, 10));
    scene.add(source);
    const events = [];
    const view = new PaperLifecycleView({
      parent: scene,
      getMachinePaperMesh: () => source,
      onEvent: (event) => events.push(event.type),
    });

    const extraction = view.extract({ pageId: 'page-1', duration: 0.1 });
    finish(view, 0.2);
    await extraction;
    expect(view.phase).toBe('inspecting');
    expect(source.visible).toBe(false);

    const crumple = view.crumple({ seed: 77, duration: 0.1 });
    finish(view, 0.2);
    await crumple;
    const throwing = view.throwToWastebasket({ pageId: 'page-1', seed: 77, duration: 0.1 });
    finish(view, 0.2);
    await throwing;

    expect(view.phase).toBe('idle');
    expect(view.discardVisuals.has('page-1')).toBe(true);
    const target = view.resolveRaycastTarget(view.discardVisuals.get('page-1'));
    expect(target).toEqual({ kind: 'discarded-page', action: 'recover-page', pageId: 'page-1' });
    expect(events).toEqual(expect.arrayContaining([
      'extraction-start',
      'inspection-ready',
      'crumple-complete',
      'discard-landed',
    ]));
    view.dispose();
  });

  it('files a page into a visible manuscript stack', async () => {
    const scene = new THREE.Scene();
    const source = new THREE.Mesh(new THREE.PlaneGeometry(5.8, 7.505, 8, 10));
    scene.add(source);
    const view = new PaperLifecycleView({ parent: scene, getMachinePaperMesh: () => source });

    const extraction = view.extract({ pageId: 'page-1', duration: 0.1 });
    finish(view, 0.2);
    await extraction;
    const filing = view.fileToManuscript({ pageId: 'page-1', totalCount: 6, duration: 0.1 });
    finish(view, 0.2);
    await filing;

    expect(view.phase).toBe('idle');
    expect(view.manuscriptCount).toBe(6);
    expect(view.stackLayers.count).toBe(6);
    expect(view.resolveRaycastTarget(view.manuscriptTopMesh)).toMatchObject({
      kind: 'manuscript-page',
      pageId: 'page-1',
    });
    view.dispose();
  });

  it('emits a fresh-sheet attachment point before completing the feed', async () => {
    const scene = new THREE.Scene();
    const source = new THREE.Mesh(new THREE.PlaneGeometry(5.8, 7.505));
    source.visible = false;
    scene.add(source);
    const events = [];
    const view = new PaperLifecycleView({
      parent: scene,
      getMachinePaperMesh: () => source,
      onEvent: (event) => events.push(event.type),
    });

    const loading = view.loadFreshSheet({ pageId: 'page-2', duration: 0.1, attachAt: 0.5 });
    finish(view, 0.2);
    await loading;

    expect(events).toEqual(['fresh-sheet-start', 'fresh-sheet-attach', 'fresh-sheet-complete']);
    expect(source.visible).toBe(true);
    expect(view.phase).toBe('idle');
    view.dispose();
  });

  it('reinserts a recovered loose sheet with a late source and texture handoff', async () => {
    const scene = new THREE.Scene();
    const sourceTexture = new THREE.DataTexture(new Uint8Array([245, 238, 220, 255]), 1, 1);
    sourceTexture.needsUpdate = true;
    const source = new THREE.Mesh(
      new THREE.PlaneGeometry(5.8, 7.505, 8, 10),
      new THREE.MeshBasicMaterial({ map: sourceTexture }),
    );
    source.visible = false;
    scene.add(source);
    const events = [];
    let transferredTexture = null;
    const view = new PaperLifecycleView({
      parent: scene,
      getMachinePaperMesh: () => source,
      onEvent: (event) => {
        events.push(event.type);
        if (event.type === 'reinsert-attach') transferredTexture = event.takeTexture();
      },
    });
    view.syncFromState({
      insertedSheet: null,
      looseSheet: { page: { id: 'recovered-page' } },
      manuscript: [],
      discards: [],
    }, { textureForPage: () => sourceTexture });

    const reinsertion = view.reinsert({ pageId: 'recovered-page', duration: 0.1, attachAt: 0.6 });
    finish(view, 0.2);
    const result = await reinsertion;

    expect(events.slice(-3)).toEqual(['reinsert-start', 'reinsert-attach', 'reinsert-complete']);
    expect(transferredTexture?.isTexture).toBe(true);
    expect(transferredTexture).not.toBe(sourceTexture);
    expect(result.sourceMesh).toBe(source);
    expect(source.visible).toBe(true);
    expect(view.activePage).toBeNull();
    expect(view.phase).toBe('idle');
    transferredTexture.dispose();
    view.dispose();
    source.geometry.dispose();
    source.material.dispose();
    sourceTexture.dispose();
  });

  it('rejects reinsertion when the durable page identity does not match', () => {
    const scene = new THREE.Scene();
    const source = new THREE.Mesh(new THREE.PlaneGeometry(5.8, 7.505));
    scene.add(source);
    const view = new PaperLifecycleView({ parent: scene, getMachinePaperMesh: () => source });
    view.syncFromState({
      insertedSheet: null,
      looseSheet: { page: { id: 'expected-page' } },
      manuscript: [],
      discards: [],
    });

    expect(() => view.reinsert({ pageId: 'other-page' })).toThrowError(
      expect.objectContaining({ code: 'page-mismatch' }),
    );
    expect(view.phase).toBe('inspecting');
    expect(view.activePage.pageId).toBe('expected-page');
    view.dispose();
  });

  it('rebuilds persistent manuscript, wastebasket, and loose-page visuals', () => {
    const scene = new THREE.Scene();
    const source = new THREE.Mesh(new THREE.PlaneGeometry(5.8, 7.505));
    scene.add(source);
    const view = new PaperLifecycleView({ parent: scene, getMachinePaperMesh: () => source });
    view.syncFromState({
      insertedSheet: null,
      looseSheet: { page: { id: 'loose' } },
      manuscript: [{ page: { id: 'saved' } }],
      discards: [{ page: { id: 'discarded' }, crumple: { seed: 8, landing: null } }],
    });

    expect(view.phase).toBe('inspecting');
    expect(view.activePage.pageId).toBe('loose');
    expect(view.manuscriptCount).toBe(1);
    expect(view.discardVisuals.has('discarded')).toBe(true);
    expect(source.visible).toBe(false);
    view.dispose();
  });

  it('aborts a failed motion into a clean idle view that can be synced again', async () => {
    const scene = new THREE.Scene();
    const source = new THREE.Mesh(new THREE.PlaneGeometry(5.8, 7.505, 8, 10));
    scene.add(source);
    const events = [];
    const view = new PaperLifecycleView({
      parent: scene,
      getMachinePaperMesh: () => source,
      onEvent: (event) => events.push(event),
    });

    const extraction = view.extract({ pageId: 'durable-loose-page', duration: 1 });
    const rejection = extraction.catch((error) => error);
    view.motion.onUpdate = () => { throw new Error('simulated geometry failure'); };
    view.update(1 / 60);
    const error = await rejection;

    expect(error).toMatchObject({
      name: 'PaperLifecycleViewError',
      code: 'motion-failed',
    });
    expect(error.cause?.message).toBe('simulated geometry failure');
    expect(view.phase).toBe('idle');
    expect(view.motion).toBeNull();
    expect(view.activePage).toBeNull();
    expect(source.visible).toBe(true);
    expect(events.at(-1)).toMatchObject({
      type: 'motion-aborted',
      motion: 'extract',
      failedPhase: 'extracting',
    });

    expect(() => view.syncFromState({
      insertedSheet: null,
      looseSheet: { page: { id: 'durable-loose-page' } },
      manuscript: [],
      discards: [],
    })).not.toThrow();
    expect(view.phase).toBe('inspecting');
    expect(view.activePage.pageId).toBe('durable-loose-page');
    expect(source.visible).toBe(false);
    view.dispose();
  });
});
