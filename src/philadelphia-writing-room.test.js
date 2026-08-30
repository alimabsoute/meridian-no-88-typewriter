import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
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
    expect(room.simplifiedPecoCrown.visible).toBe(true);
    expect(room.highPecoCrown.visible).toBe(false);
    expect(scene.getObjectByName('PECOTowerCrownLightsSimplifiedBroadFace')).toBeTruthy();
    expect(room.eveningAmbient.visible).toBe(false);
    expect(room.backdrop.weather).toBe('rain');

    room.update(1 / 60, 30);
    room.configure({ weather: 'snow', unease: 'off', eveningProgress: 0.8 });
    expect(room.getState()).toMatchObject({ weather: 'snow', unease: 'off', eveningProgress: 0.8 });
    expect(room.backdrop.weather).toBe('snow');

    room.setQuality('high');
    expect(room.backdropMesh.visible).toBe(false);
    expect(room.environment.visible).toBe(true);
    expect(room.exterior.visible).toBe(false);
    expect(room.exteriorVista.visible).toBe(true);
    expect(room.highExteriorHybrid.visible).toBe(true);
    expect(room.simplifiedPecoCrown.visible).toBe(false);
    expect(room.highPecoCrown.visible).toBe(true);
    expect(room.hybridRearMasses.isInstancedMesh).toBe(true);
    expect(room.hybridRoofDetails.isInstancedMesh).toBe(true);
    expect(room.exteriorVistaTexture.image).toBe(room.backdrop.texture.image);
    expect(room.exteriorVistaTexture.repeat.x).toBeCloseTo(368 / 960);
    expect(room.exteriorVistaTexture.repeat.y).toBeCloseTo(408 / 640);
    expect(room.eveningAmbient.visible).toBe(true);

    room.dispose();
    expect(scene.getObjectByName('PhiladelphiaWritingRoom')).toBeUndefined();
    expect(room.disposed).toBe(true);
    expect(events).toEqual([]);
  }, 15_000);

  it('renders a restrained autumn leaf layer over the clear-dusk backdrop', () => {
    const scene = new THREE.Scene();
    const room = new PhiladelphiaWritingRoom({
      scene,
      quality: 'medium',
      weather: 'autumn-wind',
      unease: 'off',
      seed: 211,
    });

    expect(room.getState()).toMatchObject({
      weather: 'autumn-wind',
      weatherLevels: { rain: 0, snow: 0, wind: 0.38, cloud: 0.28, leaves: 1 },
    });
    expect(room.backdrop.weather).toBe('autumn-wind');
    expect(room.autumnLeaves.name).toBe('ExteriorAutumnLeaves');
    expect(room.autumnLeaves.visible).toBe(true);
    expect(room.autumnLeaves.count).toBe(5);

    const before = Array.from(room.autumnLeaves.instanceMatrix.array);
    const glassDrift = room.glassAtmosphereMaterial.uniforms.drift.value;
    room.update(1 / 30);
    expect(Array.from(room.autumnLeaves.instanceMatrix.array)).not.toEqual(before);
    expect(room.glassAtmosphereMaterial.uniforms.drift.value).toBeGreaterThan(glassDrift);
    expect(room.simplifiedWindowDepth.visible).toBe(true);
    expect(room.depthFrame.isInstancedMesh).toBe(true);
    room.dispose();
  }, 15_000);

  it('keeps precipitation, leaves, automatic weather, and ambient cues static with reduced motion', () => {
    const scene = new THREE.Scene();
    const room = new PhiladelphiaWritingRoom({
      scene,
      quality: 'high',
      weather: 'autumn-wind',
      unease: 'unsettling',
      reducedMotion: true,
      seed: 211,
    });

    const leafMatrices = Array.from(room.autumnLeaves.instanceMatrix.array);
    const glassDrift = room.glassAtmosphereMaterial.uniforms.drift.value;
    const initialState = room.getState();
    room.update(30, 300);

    expect(Array.from(room.autumnLeaves.instanceMatrix.array)).toEqual(leafMatrices);
    expect(room.getState().weatherLevels).toEqual(initialState.weatherLevels);
    expect(room.getState().uneaseSignal).toBe(0);
    expect(room.elapsed).toBe(0);
    expect(room.glassAtmosphereMaterial.uniforms.drift.value).toBe(glassDrift);

    room.setWeatherPreset('nor-easter');
    const rainPositions = Array.from(room.rainPositions);
    const snowPositions = Array.from(room.snowPositions);
    room.update(30, 300);
    expect(Array.from(room.rainPositions)).toEqual(rainPositions);
    expect(Array.from(room.snowPositions)).toEqual(snowPositions);

    room.setWeatherPreset('automatic');
    const frozenAutomatic = room.getState().weatherLevels;
    room.update(30, 330);
    expect(room.getState().weatherLevels).toEqual(frozenAutomatic);
    room.dispose();
  }, 15_000);

  it('scrolls a ribbed two-face PECO Crown Lights message behind the window depth layers', () => {
    const scene = new THREE.Scene();
    const room = new PhiladelphiaWritingRoom({
      scene,
      quality: 'medium',
      weather: 'quiet',
      unease: 'off',
      seed: 211,
    });

    const initial = room.getState().pecoCrown;
    const crownBox = room.backdrop.layout.peco.crown;
    const crownBytes = () => {
      const pixels = [];
      const { data, width, height } = room.backdrop.texture.image;
      for (let y = 0; y < crownBox.height; y += 1) {
        const start = (((height - 1 - crownBox.y - y) * width) + crownBox.x) * 4;
        pixels.push(...data.subarray(start, start + crownBox.width * 4));
      }
      return pixels;
    };
    const initialPixels = crownBytes();
    const backdropVersion = room.backdrop.texture.version;
    const backdropTextureDispose = vi.spyOn(room.backdrop.texture, 'dispose');
    const vistaTextureDispose = vi.spyOn(room.exteriorVistaTexture, 'dispose');
    const backdropMaterialDispose = vi.spyOn(room.backdrop.material, 'dispose');
    expect(initial).toMatchObject({
      name: 'PECO Crown Lights',
      scrollOffset: 0,
      staticFrame: true,
      broadColumns: 40,
      sideColumns: 19,
    });
    expect(room.backdrop.texture.userData.pecoCrown).toMatchObject({
      animatedInPlace: true,
      broadColumns: 40,
      sideColumns: 19,
    });
    expect(room.simplifiedPecoBroadFace.isObject3D).toBe(true);
    expect(room.simplifiedPecoBroadFace.isMesh).not.toBe(true);
    expect(room.simplifiedPecoBroadFace.position.z).toBe(room.backdropMesh.position.z);
    expect(room.simplifiedPecoBroadFace.position.z).toBeLessThan(-5.73);

    room.update(0.075, 1);
    expect(room.getState().pecoCrown).toMatchObject({ staticFrame: true, scrollOffset: 0 });
    expect(crownBytes()).toEqual(initialPixels);

    room.update(0.075, 8.2);
    const advanced = room.getState().pecoCrown;
    expect(advanced.staticFrame).toBe(false);
    expect(advanced.scrollOffset).toBeGreaterThan(0);
    expect(advanced.frame).toBeGreaterThan(initial.frame);
    expect(crownBytes()).not.toEqual(initialPixels);
    expect(room.backdrop.texture.version).toBeGreaterThan(backdropVersion);
    expect(room.backdrop.texture.updateRanges).toHaveLength(crownBox.height);
    expect(room.exteriorVistaTexture.updateRanges).toHaveLength(crownBox.height);

    room.setQuality('high');
    expect(room.getState().pecoCrown).toEqual(advanced);
    expect(room.simplifiedPecoCrown.visible).toBe(false);
    expect(room.highPecoCrown.visible).toBe(true);

    room.setReducedMotion(true);
    const staticCrown = room.getState().pecoCrown;
    expect(staticCrown.staticFrame).toBe(true);
    expect(staticCrown.scrollOffset).toBe(0);
    room.update(30, 300);
    expect(room.getState().pecoCrown).toEqual(staticCrown);
    room.setReducedMotion(false);
    room.update(0.075, 8.4);
    expect(room.getState().pecoCrown.staticFrame).toBe(false);
    expect(room.getState().pecoCrown.scrollOffset).toBeGreaterThan(advanced.scrollOffset);
    room.dispose();
    room.dispose();
    expect(backdropTextureDispose).toHaveBeenCalledTimes(1);
    expect(vistaTextureDispose).toHaveBeenCalledTimes(1);
    expect(backdropMaterialDispose).toHaveBeenCalledTimes(1);
  }, 15_000);
});
