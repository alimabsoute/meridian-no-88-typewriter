import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  createPhiladelphiaRoomBackdrop,
  PHILADELPHIA_BACKDROP_PALETTE,
  PHILADELPHIA_BACKDROP_PLANE,
} from './philadelphia-room-backdrop.js';

function pixels(asset) {
  return asset.texture.image.data;
}

function sampleTopLeft(asset, point) {
  const x = Math.max(0, Math.min(asset.width - 1, Math.round(point.x)));
  const y = Math.max(0, Math.min(asset.height - 1, Math.round(point.y)));
  const index = (((asset.height - 1 - y) * asset.width) + x) * 4;
  return Array.from(pixels(asset).slice(index, index + 4));
}

function colorDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function pixelHash(asset) {
  let hash = 2166136261;
  const data = pixels(asset);
  for (let index = 0; index < data.length; index += 1) {
    hash ^= data[index];
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

describe('createPhiladelphiaRoomBackdrop', () => {
  it('returns one 960x640 sRGB texture and an unlit material by default', () => {
    const asset = createPhiladelphiaRoomBackdrop();

    expect(asset.width).toBe(960);
    expect(asset.height).toBe(640);
    expect(asset.aspect).toBe(1.5);
    expect(asset.weather).toBe('snow');
    expect(asset.texture).toBeInstanceOf(THREE.DataTexture);
    expect(asset.texture.image.data).toBeInstanceOf(Uint8Array);
    expect(asset.texture.image.data).toHaveLength(960 * 640 * 4);
    expect(asset.texture.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(asset.texture.generateMipmaps).toBe(false);
    expect(asset.texture.flipY).toBe(false);
    expect(asset.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(asset.material.map).toBe(asset.texture);
    expect(asset.material.toneMapped).toBe(false);
    expect(asset.material.fog).toBe(false);
    expect(asset.texture.userData.kind).toBe('stationary-philadelphia-room-backdrop');
    expect(PHILADELPHIA_BACKDROP_PLANE).toEqual({
      width: 15,
      height: 10,
      position: [1.258, 4.5, -5.98],
      rotation: [0, 0, 0],
    });

    asset.dispose();
  });

  it('is byte-for-byte deterministic for a seed and changes procedural detail across seeds', () => {
    const first = createPhiladelphiaRoomBackdrop({ width: 320, height: 240, seed: 1910, weather: 'rain' });
    const replay = createPhiladelphiaRoomBackdrop({ width: 320, height: 240, seed: 1910, weather: 'rain' });
    const alternate = createPhiladelphiaRoomBackdrop({ width: 320, height: 240, seed: 1911, weather: 'rain' });

    expect(pixelHash(first)).toBe(pixelHash(replay));
    expect(pixelHash(first)).not.toBe(pixelHash(alternate));

    first.dispose();
    replay.dispose();
    alternate.dispose();
  });

  it('keeps the wall, blue-hour exterior, brick, lit windows, sash, and radiator visually distinct', () => {
    const asset = createPhiladelphiaRoomBackdrop({ seed: 88, weather: 'quiet' });
    const { anchors } = asset.layout;
    const wall = sampleTopLeft(asset, anchors.wall);
    const sky = sampleTopLeft(asset, anchors.sky);
    const brick = sampleTopLeft(asset, anchors.brick);
    const litWindow = sampleTopLeft(asset, anchors.litWindow);
    const sash = sampleTopLeft(asset, anchors.sash);
    const radiator = sampleTopLeft(asset, anchors.radiator);

    expect(sky[2]).toBeGreaterThan(sky[0]);
    expect(brick[0]).toBeGreaterThan(brick[2]);
    expect(litWindow[0]).toBeGreaterThan(litWindow[2] * 1.5);
    expect(litWindow[1]).toBeGreaterThan(brick[1]);
    expect(colorDistance(wall, sky)).toBeGreaterThan(35);
    expect(colorDistance(sash, sky)).toBeGreaterThan(45);
    expect(colorDistance(radiator, wall)).toBeGreaterThan(12);
    expect([wall, sky, brick, litWindow, sash, radiator].every((sample) => sample[3] === 255)).toBe(true);

    asset.dispose();
  });

  it('supports static rain, snow, and nor-easter variants without changing the API', () => {
    const quiet = createPhiladelphiaRoomBackdrop({ width: 320, height: 240, seed: 42, weather: 'quiet' });
    const snow = createPhiladelphiaRoomBackdrop({ width: 320, height: 240, seed: 42, weather: 'snow' });
    const storm = createPhiladelphiaRoomBackdrop({ width: 320, height: 240, seed: 42, weather: "nor'easter" });

    expect(pixelHash(quiet)).not.toBe(pixelHash(snow));
    expect(pixelHash(snow)).not.toBe(pixelHash(storm));
    expect(storm.weather).toBe('nor-easter');

    quiet.dispose();
    snow.dispose();
    storm.dispose();
  });

  it('accepts palette overrides without mutating defaults or caller arrays', () => {
    const customWall = [28, 71, 68];
    const standard = createPhiladelphiaRoomBackdrop({ width: 320, height: 240, weather: 'quiet' });
    const custom = createPhiladelphiaRoomBackdrop({
      width: 320,
      height: 240,
      weather: 'quiet',
      palette: { wallTop: customWall, windowLight: '#ffd27f' },
    });

    customWall[0] = 255;
    expect(custom.palette.wallTop).toEqual([28, 71, 68]);
    expect(custom.palette.windowLight).toEqual([255, 210, 127]);
    expect(PHILADELPHIA_BACKDROP_PALETTE.wallTop).toEqual([119, 112, 92]);
    expect(sampleTopLeft(custom, custom.layout.anchors.wall)).not.toEqual(
      sampleTopLeft(standard, standard.layout.anchors.wall),
    );

    standard.dispose();
    custom.dispose();
  });

  it('updates weather in place and adjusts brightness without rerasterizing', () => {
    const asset = createPhiladelphiaRoomBackdrop({ width: 320, height: 240, weather: 'quiet' });
    const texture = asset.texture;
    const bytes = asset.texture.image.data;
    const quietHash = pixelHash(asset);

    expect(asset.update({ brightness: 0.72 })).toEqual({ textureChanged: false, materialChanged: true });
    expect(pixelHash(asset)).toBe(quietHash);
    expect(asset.brightness).toBe(0.72);

    expect(asset.update({ weather: 'rain' })).toEqual({ textureChanged: true, materialChanged: false });
    expect(asset.texture).toBe(texture);
    expect(asset.texture.image.data).toBe(bytes);
    expect(pixelHash(asset)).not.toBe(quietHash);
    expect(asset.weather).toBe('rain');

    asset.dispose();
    expect(() => asset.update({ weather: 'snow' })).toThrow(/disposed/i);
  });

  it('validates texture dimensions and disposes its two owned resources once', () => {
    expect(() => createPhiladelphiaRoomBackdrop({ width: 159 })).toThrow(RangeError);
    expect(() => createPhiladelphiaRoomBackdrop({ height: 4097 })).toThrow(RangeError);

    const asset = createPhiladelphiaRoomBackdrop({ width: 160, height: 160 });
    const materialDispose = vi.spyOn(asset.material, 'dispose');
    const textureDispose = vi.spyOn(asset.texture, 'dispose');

    asset.dispose();
    asset.dispose();

    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(textureDispose).toHaveBeenCalledTimes(1);
  });
});
