import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CAMERA_PRESETS, configureRoomNavigation, fitRoomDetail } from './room-camera.js';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

describe('room camera navigation', () => {
  it('zooms toward the head-on machine without opening its shell', () => {
    const controls = {};
    configureRoomNavigation(controls, 'front', false);
    expect(controls.enabled).toBe(true);
    expect(controls.enableZoom).toBe(true);
    expect(controls.enableRotate).toBe(false);
    expect(controls.enablePan).toBe(false);
    expect(controls.minDistance).toBe(5);
    const front = CAMERA_PRESETS.front;
    expect(front.position.x).toBe(front.target.x);
    expect(front.position.y).toBeGreaterThan(front.target.y + 4);
    expect(front.fov).toBeLessThan(CAMERA_PRESETS.room.fov);
  });
  it.each(['library', 'television'])('allows close inspection and bounded panning for %s', view => {
    const controls = {};
    configureRoomNavigation(controls, view);
    expect(controls.enablePan).toBe(true);
    expect(controls.minDistance).toBeLessThan(4);
    expect(controls.maxTargetRadius).toBe(2.4);
    const { position, target } = CAMERA_PRESETS[view];
    const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.05, 80);
    camera.position.copy(position); camera.lookAt(target); camera.updateMatrixWorld();
    const center = target.clone().project(camera);
    expect(Math.abs(center.x)).toBeLessThan(1e-6);
    expect(Math.abs(center.y)).toBeLessThan(1e-6);
  });
  it('restores safe machine controls after leaving decor', () => {
    const controls = {};
    configureRoomNavigation(controls, 'library');
    configureRoomNavigation(controls, 'writer');
    expect(controls.enablePan).toBe(false);
    expect(controls.minDistance).toBe(6.4);
    configureRoomNavigation(controls, 'mechanism', true);
    expect(controls.enableRotate).toBe(true);
  });
  it('backs up detail views on portrait screens rather than clipping their sides', () => {
    for (const view of ['television', 'library']) {
      const p = CAMERA_PRESETS[view];
      const fitted = fitRoomDetail(p, view, 390, 844, 160, 90);
      expect(fitted.position.distanceTo(fitted.target)).toBeGreaterThan(p.position.distanceTo(p.target));
      expect(fitted.target.equals(p.target)).toBe(true);
    }
  });
  it('keeps pinch and moving touch gestures from striking keys but preserves a tap', () => {
    const source = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
    const start = source.indexOf('const pendingMachineTouches =');
    const end = source.indexOf('let hoverFrame =', start);
    const listeners = new Map(); const strikes = [];
    runInNewContext(source.slice(start, end), {
      canvas: { addEventListener: (name, fn) => listeners.set(name, fn) },
      handleMachinePointerDown: e => strikes.push(e.pointerId),
      firstInteractiveHit: () => null, marginDrag: null,
    });
    const send = (name, id, x = 10) => listeners.get(name)({ pointerId: id, pointerType: 'touch', clientX: x, clientY: 10 });
    send('pointerdown', 1); send('pointerdown', 2); send('pointerup', 1); send('pointerup', 2);
    expect(strikes).toEqual([]);
    send('pointerdown', 3); send('pointermove', 3, 50); send('pointerup', 3, 50);
    expect(strikes).toEqual([]);
    send('pointerdown', 4); send('pointerup', 4);
    expect(strikes).toEqual([4]);
  });
});
