import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PaperLifecycleView } from './paper-lifecycle-view.js';

function fixture(options = {}) {
  const paperweight = new THREE.Group();
  const statue = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.4), new THREE.MeshBasicMaterial());
  statue.position.y = 0.5;
  paperweight.add(statue);
  paperweight.scale.setScalar(0.6);
  const view = new PaperLifecycleView({
    parent: new THREE.Scene(), paperweight, segmentsX: 2, segmentsY: 2, ...options,
  });
  return { view, paperweight };
}

function advance(view, seconds) {
  const frames = Math.ceil(seconds / 0.01);
  for (let i = 0; i < frames; i += 1) view.update(seconds / frames);
}

function loosePage(view, count = 0) {
  view.syncFromState({
    insertedSheet: null, looseSheet: { page: { id: 'kept-page' } }, discards: [],
    manuscript: Array.from({ length: count }, (_, i) => ({ page: { id: `saved-${i}` } })),
  });
}

function expectResting(view, paperweight, count) {
  const top = view.manuscriptTopPose(count).position;
  expect(paperweight.position.x).toBeCloseTo(top.x, 8);
  expect(paperweight.position.y).toBeCloseTo(top.y, 8);
  expect(paperweight.position.z).toBeCloseTo(top.z + 0.35, 8);
}

describe('LOVE manuscript paperweight', () => {
  it('rests on the empty filing tray without changing the supplied statue scale', () => {
    const { view, paperweight } = fixture();
    expect(paperweight.parent).toBe(view.root);
    expectResting(view, paperweight, 0);
    expect(paperweight.scale.toArray()).toEqual([0.6, 0.6, 0.6]);
    view.dispose();
  });

  it('lifts before the page moves, holds while it arrives, then lowers onto the saved page', async () => {
    const { view, paperweight } = fixture();
    loosePage(view, 2);
    const page = view.activePage.mesh;
    const start = page.position.clone();
    const restingY = paperweight.position.y;
    const filing = view.fileToManuscript({ pageId: 'kept-page' });
    const duration = view.motion.duration;
    advance(view, duration * 0.1);
    expect(paperweight.position.y).toBeGreaterThan(restingY + 0.2);
    expect(page.position.distanceTo(start)).toBeLessThan(1e-8);
    advance(view, duration * 0.67);
    const landing = view.manuscriptTopPose(3).position;
    expect(page.position.distanceTo(landing)).toBeLessThan(1e-8);
    expect(paperweight.position.y).toBeGreaterThan(landing.y + 0.9);
    expect(view.manuscriptCount).toBe(2);
    advance(view, duration * 0.24);
    await filing;
    expectResting(view, paperweight, 3);
    expect(view.manuscriptCount).toBe(3);
    expect(view.manuscriptTopMesh).toBe(page);
    expect(view.phase).toBe('idle');
    view.dispose();
  });

  it('follows restored stack height, including its visible layer cap and an emptied tray', () => {
    const { view, paperweight } = fixture({ maxStackLayers: 4 });
    const emptyY = paperweight.position.y;
    view.setManuscriptEntries(Array.from({ length: 3 }, (_, i) => ({ page: { id: `p${i}` } })));
    expectResting(view, paperweight, 3);
    expect(paperweight.position.y).toBeGreaterThan(emptyY);
    view.setManuscriptEntries(Array.from({ length: 100 }, (_, i) => ({ page: { id: `p${i}` } })));
    expectResting(view, paperweight, 4);
    expect(paperweight.position.y).toBeLessThan(emptyY + 0.1);
    view.setManuscriptEntries([]);
    expectResting(view, paperweight, 0);
    view.dispose();
  });

  it('completes the whole filing ritual in one frame for reduced motion', async () => {
    const { view, paperweight } = fixture({ reducedMotion: true });
    loosePage(view);
    const filing = view.fileToManuscript({ pageId: 'kept-page' });
    view.update(1 / 60);
    await filing;
    expect(view.motion).toBeNull();
    expect(view.phase).toBe('idle');
    expectResting(view, paperweight, 1);
    view.dispose();
  });

  it('returns the weight to the tray after a failed filing motion and allows state restoration', async () => {
    const { view, paperweight } = fixture();
    loosePage(view, 2);
    const filing = view.fileToManuscript({ pageId: 'kept-page' });
    const rejected = expect(filing).rejects.toMatchObject({ code: 'motion-failed' });
    advance(view, 0.4);
    view.motion.onUpdate = () => { throw new Error('simulated rendering failure'); };
    view.update(1 / 60);
    await rejected;
    expect(view.motion).toBeNull();
    expect(view.phase).toBe('idle');
    expectResting(view, paperweight, 0);
    loosePage(view, 2);
    expectResting(view, paperweight, 2);
    expect(view.phase).toBe('inspecting');
    view.dispose();
  });
});
