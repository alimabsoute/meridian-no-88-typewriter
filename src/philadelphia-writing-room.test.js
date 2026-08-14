import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PhiladelphiaWritingRoom } from './philadelphia-writing-room.js';

describe('PhiladelphiaWritingRoom', () => {
  it('mounts as a stationary, configurable and disposable scene module', () => {
    const scene = new THREE.Scene();
    const events = [];
    const room = new PhiladelphiaWritingRoom({
      scene,
      quality: 'low',
      weather: 'rain',
      unease: 'subtle',
      onAtmosphereEvent: (event) => events.push(event),
    });

    expect(scene.getObjectByName('PhiladelphiaWritingRoom')).toBe(room.root);
    expect(scene.getObjectByName('PaintedWoodSashWindow')).toBeTruthy();
    expect(scene.getObjectByName('RearRowhouseBrick')).toBeTruthy();
    expect(room.getState()).toMatchObject({
      stationary: true,
      weather: 'rain',
      unease: 'subtle',
      effectiveQuality: 'low',
    });
    expect(room.backdropMesh.visible).toBe(true);
    expect(room.environment.visible).toBe(false);
    expect(room.exterior.visible).toBe(false);
    expect(room.eveningAmbient.visible).toBe(false);
    expect(room.backdrop.weather).toBe('rain');

    room.update(1 / 60, 30);
    room.configure({ weather: 'snow', unease: 'off', eveningProgress: 0.8 });
    expect(room.getState()).toMatchObject({ weather: 'snow', unease: 'off', eveningProgress: 0.8 });
    expect(room.backdrop.weather).toBe('snow');

    room.setQuality('high');
    expect(room.backdropMesh.visible).toBe(false);
    expect(room.environment.visible).toBe(true);
    expect(room.exterior.visible).toBe(true);
    expect(room.eveningAmbient.visible).toBe(true);

    room.dispose();
    expect(scene.getObjectByName('PhiladelphiaWritingRoom')).toBeUndefined();
    expect(room.disposed).toBe(true);
    expect(events).toEqual([]);
  });
});
