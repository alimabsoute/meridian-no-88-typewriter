import * as THREE from 'three';

// Small, repeatable physical surface maps; no external assets or startup fetches.
export function makeSurfaceGrain(kind = 'metal') {
  const size = 128;
  const pixels = new Uint8Array(size * size * 4);
  let seed = 211;
  const noise = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const rows = Array.from({ length: size }, () => noise());
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const weave = ((x % 4 < 2) !== (y % 4 < 2)) ? 13 : -13;
      const value = kind === 'ribbon'
        ? 160 + weave + noise() * 12
        : 155 + rows[y] * 34 + noise() * 7;
      const index = (y * size + x) * 4;
      pixels[index] = pixels[index + 1] = pixels[index + 2] = value;
      pixels[index + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(kind === 'ribbon' ? 10 : 3, kind === 'ribbon' ? 2 : 5);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}
