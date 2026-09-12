import * as THREE from 'three';
import { createLivingPhiladelphia } from './living-philadelphia.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  AdaptiveQualityGovernor,
  QUALITY_PROFILES,
  chooseInitialQuality,
  clamp01,
  computeEveningPalette,
  computeUneaseSignal,
  normalizeQualityMode,
  normalizeUneaseLevel,
  normalizeWeatherPreset,
  resolveWeatherTargets,
} from './philadelphia-room-state.js';
import {
  PHILADELPHIA_BACKDROP_PLANE,
  createPhiladelphiaRoomBackdrop,
} from './philadelphia-room-backdrop.js';

const WINDOW = Object.freeze({
  centerX: 2.2,
  centerY: 4.9,
  width: 16,
  height: 8.5,
  wallZ: -6.08,
  frameZ: -5.86,
  skyZ: -8.86,
});

const MAX_RAIN_STREAKS = QUALITY_PROFILES.high.rainStreaks;
const MAX_SNOW_FLAKES = QUALITY_PROFILES.high.snowFlakes;
const MAX_AUTUMN_LEAVES = QUALITY_PROFILES.high.autumnLeaves;
const MAX_GLASS_DROPLETS = QUALITY_PROFILES.high.glassDroplets;

const PECO_CROWN = Object.freeze({
  broadColumns: 40,
  sideColumns: 19,
  charactersPerSecond: 2.27,
  updateInterval: 1 / 15,
  introDwellSeconds: 8,
  sequence: 'PECO     PHILADELPHIA WRITES TONIGHT     OCTOBERLINE 211         ',
});

// Five-by-seven letterforms keep the Crown Lights procedural and preserve the
// unmistakable column-cut character of the real display at a very small size.
const PECO_GLYPHS = Object.freeze({
  ' ': Object.freeze([0, 0, 0, 0, 0, 0, 0]),
  '1': Object.freeze([0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110]),
  '2': Object.freeze([0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111]),
  A: Object.freeze([0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001]),
  B: Object.freeze([0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110]),
  C: Object.freeze([0b01111, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b01111]),
  D: Object.freeze([0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110]),
  E: Object.freeze([0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111]),
  G: Object.freeze([0b01111, 0b10000, 0b10000, 0b10111, 0b10001, 0b10001, 0b01110]),
  H: Object.freeze([0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001]),
  I: Object.freeze([0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b11111]),
  L: Object.freeze([0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111]),
  N: Object.freeze([0b10001, 0b11001, 0b10101, 0b10101, 0b10011, 0b10001, 0b10001]),
  O: Object.freeze([0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110]),
  P: Object.freeze([0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000]),
  R: Object.freeze([0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001]),
  S: Object.freeze([0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110]),
  T: Object.freeze([0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100]),
  W: Object.freeze([0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b10101, 0b01010]),
});

function createRng(seed) {
  let state = Math.abs(Math.trunc(seed)) || 1;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function setColor(color, channels) {
  color.setRGB(channels[0], channels[1], channels[2]);
}

function makeDataTexture(width, height, fill) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const pixel = fill(x, y, width, height);
      data[offset] = pixel[0];
      data[offset + 1] = pixel[1];
      data[offset + 2] = pixel[2];
      data[offset + 3] = pixel[3] ?? 255;
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function pecoGlyphPixel(text, pixelX, pixelY, {
  glyphScaleX,
  glyphScaleY,
  wrap = true,
} = {}) {
  const glyphAdvance = 6 * glyphScaleX;
  const textWidth = text.length * glyphAdvance;
  let x = pixelX;
  if (wrap) x = positiveModulo(x, textWidth);
  if (x < 0 || x >= textWidth) return false;

  const characterIndex = Math.floor(x / glyphAdvance);
  const characterX = x - characterIndex * glyphAdvance;
  const column = Math.floor(characterX / glyphScaleX);
  const row = Math.floor(pixelY / glyphScaleY);
  if (column < 0 || column >= 5 || row < 0 || row >= 7) return false;
  const glyph = PECO_GLYPHS[text[characterIndex]] ?? PECO_GLYPHS[' '];
  return (glyph[row] & (1 << (4 - column))) !== 0;
}

function textureDataIndex(texture, x, y) {
  return (((texture.image.height - 1 - y) * texture.image.width) + x) * 4;
}

function captureTextureRegion(texture, box) {
  const snapshot = new Uint8Array(box.width * box.height * 4);
  for (let y = 0; y < box.height; y += 1) {
    const source = textureDataIndex(texture, box.x, box.y + y);
    const target = y * box.width * 4;
    snapshot.set(texture.image.data.subarray(source, source + box.width * 4), target);
  }
  return snapshot;
}

function restoreTextureRegion(texture, box, snapshot) {
  for (let y = 0; y < box.height; y += 1) {
    const source = y * box.width * 4;
    const target = textureDataIndex(texture, box.x, box.y + y);
    texture.image.data.set(snapshot.subarray(source, source + box.width * 4), target);
  }
}

function paintPecoCrownFace(texture, box, {
  columns,
  elapsed = 0,
  faceOffset = 0,
  intensity = 1,
  staticFrame = false,
  staticText = 'PECO',
} = {}) {
  const { data } = texture.image;
  const glyphScaleY = Math.max(1, Math.floor(box.height / 7));
  const glyphScaleX = Math.max(1, Math.round(glyphScaleY * 0.5));
  const glyphAdvance = 6 * glyphScaleX;
  const glyphHeight = 7 * glyphScaleY;
  const glyphTop = Math.floor((box.height - glyphHeight) / 2);
  const staticWidth = staticText.length * glyphAdvance;
  const staticLeft = Math.floor((box.width - staticWidth) / 2);
  const effectiveColumns = Math.max(1, Math.min(columns, Math.floor(box.width / 2)));
  const ribSpan = box.width / effectiveColumns;
  const scrollOffset = Math.floor(elapsed * PECO_CROWN.charactersPerSecond * glyphAdvance);
  const brightness = Math.max(0.55, Math.min(1.18, intensity));

  for (let y = 0; y < box.height; y += 1) {
    const glyphY = y - glyphTop;
    for (let x = 0; x < box.width; x += 1) {
      const sourceX = staticFrame
        ? x - staticLeft
        : x + scrollOffset + faceOffset;
      const lit = staticFrame
        ? pecoGlyphPixel(staticText, sourceX, glyphY, { glyphScaleX, glyphScaleY, wrap: false })
        : pecoGlyphPixel(PECO_CROWN.sequence, sourceX, glyphY, { glyphScaleX, glyphScaleY });
      const rib = positiveModulo(x + 0.5, ribSpan) < Math.min(0.44, ribSpan * 0.24);
      if (!lit || rib) continue;
      const scan = y % Math.max(2, glyphScaleY) === 0 ? 0.84 : 1;
      const index = textureDataIndex(texture, box.x + x, box.y + y);
      data[index] = Math.min(255, Math.round(242 * brightness * scan));
      data[index + 1] = Math.min(255, Math.round(236 * brightness * scan));
      data[index + 2] = Math.min(255, Math.round(207 * brightness * scan));
      data[index + 3] = 255;
    }
  }
  return { glyphAdvance, scrollOffset };
}

function markTextureRegionForUpload(texture, box, { fullTextureUpload = false } = {}) {
  texture.clearUpdateRanges();
  if (!fullTextureUpload) {
    for (let y = 0; y < box.height; y += 1) {
      texture.addUpdateRange(textureDataIndex(texture, box.x, box.y + y), box.width * 4);
    }
  }
  texture.needsUpdate = true;
}

function mapTextureBoxToPlane(box, {
  sourceWidth,
  sourceHeight,
  planeWidth,
  planeHeight,
  centerX,
  centerY,
  crop = null,
}) {
  const source = crop ?? { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
  const normalizedX = (box.x + box.width / 2 - source.x) / source.width;
  const normalizedY = (box.y + box.height / 2 - source.y) / source.height;
  return {
    x: centerX - planeWidth / 2 + normalizedX * planeWidth,
    y: centerY + planeHeight / 2 - normalizedY * planeHeight,
    width: box.width / source.width * planeWidth,
    height: box.height / source.height * planeHeight,
  };
}

function makePlasterTexture(seed) {
  const rng = createRng(seed);
  const values = Array.from({ length: 64 * 64 }, () => rng());
  const texture = makeDataTexture(64, 64, (x, y) => {
    const noise = values[y * 64 + x];
    const broad = Math.sin(x * 0.19) * 2 + Math.cos(y * 0.13) * 2;
    const value = Math.round(174 + (noise - 0.5) * 13 + broad);
    return [value, value - 8, value - 17, 255];
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(5, 3);
  return texture;
}

function makeBrickTexture(seed) {
  const rng = createRng(seed);
  const brickNoise = Array.from({ length: 10 * 10 }, () => rng());
  const texture = makeDataTexture(128, 128, (x, y) => {
    const course = Math.floor(y / 16);
    const rowY = y % 16;
    const shiftedX = x + (course % 2) * 16;
    const brick = Math.floor(shiftedX / 32);
    const rowX = shiftedX % 32;
    if (rowY < 2 || rowX < 2) return [92, 80, 71, 255];
    const variation = brickNoise[(course % 10) * 10 + (brick % 10)] - 0.5;
    const grain = Math.sin(x * 1.7 + y * 0.3) * 3;
    return [
      Math.round(135 + variation * 28 + grain),
      Math.round(69 + variation * 17 + grain * 0.45),
      Math.round(48 + variation * 12),
      255,
    ];
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2.5, 3.5);
  return texture;
}

function makeFlakeTexture() {
  const texture = makeDataTexture(32, 32, (x, y, width, height) => {
    const dx = (x + 0.5) / width - 0.5;
    const dy = (y + 0.5) / height - 0.5;
    const distance = Math.sqrt(dx * dx + dy * dy) * 2;
    const alpha = Math.round(255 * Math.max(0, 1 - distance) ** 1.65);
    return [244, 248, 249, alpha];
  });
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

function setTransform(object, {
  position,
  rotation,
  scale,
} = {}) {
  if (position) object.position.set(position[0], position[1], position[2]);
  if (rotation) object.rotation.set(rotation[0], rotation[1], rotation[2]);
  if (scale) object.scale.set(scale[0], scale[1], scale[2]);
  return object;
}

/**
 * A fixed-view Philadelphia rowhouse writing room. This module owns no camera,
 * controls, navigation, DOM, storage, or audio. It can therefore be mounted
 * behind the typewriter without entering the latency-critical typing path.
 */
export class PhiladelphiaWritingRoom {
  constructor({
    scene,
    renderer = null,
    weather = 'quiet',
    unease = 'subtle',
    quality = 'auto',
    eveningProgress = 0.38,
    brightness = 1,
    reducedMotion = false,
    seed = 88,
    position = null,
    onAtmosphereEvent = null,
  } = {}) {
    if (!scene?.isScene && !scene?.isGroup) {
      throw new TypeError('PhiladelphiaWritingRoom requires a Three.js Scene or Group.');
    }

    this.scene = scene;
    this.renderer = renderer;
    this.seed = Math.abs(Math.trunc(seed)) || 88;
    this.rng = createRng(this.seed);
    this.onAtmosphereEvent = typeof onAtmosphereEvent === 'function' ? onAtmosphereEvent : null;
    this.disposed = false;
    this.elapsed = 0;
    this.frame = 0;
    this.particleAccumulator = 0;
    this.weatherPreset = normalizeWeatherPreset(weather);
    this.uneaseLevel = normalizeUneaseLevel(unease);
    this.qualityMode = normalizeQualityMode(quality);
    this.eveningProgress = clamp01(eveningProgress);
    this.brightness = Math.max(0.45, Math.min(1.5, Number(brightness) || 1));
    this.reducedMotion = Boolean(reducedMotion);
    this.weatherState = resolveWeatherTargets(this.weatherPreset, 0, this.seed);
    this.uneaseSignal = 0;
    this.previousUneaseSignal = 0;
    this.cloudLightSignal = 0;

    this.geometries = new Set();
    this.materials = new Set();
    this.textures = new Set();
    this.snowCapMaterials = [];

    this.root = new THREE.Group();
    this.root.name = 'PhiladelphiaWritingRoom';
    this.root.userData.stationaryEnvironment = true;
    if (position?.isVector3) this.root.position.copy(position);
    else if (position) this.root.position.set(position.x ?? 0, position.y ?? 0, position.z ?? 0);
    this.scene.add(this.root);

    this.environment = new THREE.Group();
    this.environment.name = 'RowhouseEnvironment';
    this.root.add(this.environment);

    this.exterior = new THREE.Group();
    this.exterior.name = 'SashWindowExterior';
    this.root.add(this.exterior);

    this.weatherGroup = new THREE.Group();
    this.weatherGroup.name = 'WindowWeather';
    this.root.add(this.weatherGroup);

    this._buildMaterials();
    this._buildRoomShell();
    this._buildExterior();
    this._buildWindow();
    this._buildWeather();
    this._batchStaticMeshes(this.environment, 'Room');
    this._batchStaticMeshes(this.exterior, 'Exterior');
    this._buildPerformanceBackdrop();
    this._buildWindowDepthOverlay();
    this._buildLighting();
    this.livingCity = createLivingPhiladelphia(this);
    this._bindRealPecoDisplay();

    this.effectiveQuality = this.qualityMode === 'auto' ? this._chooseInitialQuality() : this.qualityMode;
    this.qualityGovernor = new AdaptiveQualityGovernor(this.effectiveQuality);
    this._applyQuality(this.effectiveQuality);
    this._applyAtmosphere();
  }

  _geometry(geometry) {
    this.geometries.add(geometry);
    return geometry;
  }

  _material(material) {
    this.materials.add(material);
    return material;
  }

  _texture(texture) {
    this.textures.add(texture);
    return texture;
  }

  _mesh(geometry, material, transform = {}) {
    const mesh = setTransform(new THREE.Mesh(this._geometry(geometry), material), transform);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    return mesh;
  }

  /**
   * Consolidate fixed opaque set dressing by material. The writing machine has
   * hundreds of individually animated pieces, so keeping the room to a small
   * draw-call budget is more valuable than keeping every static brick or sash
   * rail as a separate mesh.
   */
  _batchStaticMeshes(container, label) {
    container.updateWorldMatrix(true, true);
    const inverseContainer = container.matrixWorld.clone().invert();
    const batches = new Map();
    const preservedNames = new Set();

    container.traverse((object) => {
      if (!object.isMesh || object.isInstancedMesh || object.isSkinnedMesh) return;
      if (!object.geometry || Array.isArray(object.material) || object.material?.transparent) return;
      const attributes = Object.entries(object.geometry.attributes)
        .map(([name, attribute]) => `${name}:${attribute.itemSize}:${attribute.normalized}:${attribute.array.constructor.name}`)
        .sort()
        .join(',');
      const key = `${object.material.uuid}|${object.geometry.index ? 'indexed' : 'plain'}|${attributes}`;
      if (!batches.has(key)) batches.set(key, []);
      batches.get(key).push(object);
      if (object.name) preservedNames.add(object.name);
    });

    let batchIndex = 0;
    for (const meshes of batches.values()) {
      if (meshes.length < 2) continue;
      const transformed = meshes.map((mesh) => {
        const geometry = mesh.geometry.clone();
        geometry.applyMatrix4(inverseContainer.clone().multiply(mesh.matrixWorld));
        return geometry;
      });
      const geometry = mergeGeometries(transformed, false);
      for (const clone of transformed) clone.dispose();
      if (!geometry) continue;
      this.geometries.add(geometry);
      const merged = new THREE.Mesh(geometry, meshes[0].material);
      merged.name = `${label}StaticBatch${batchIndex += 1}`;
      merged.castShadow = meshes.some((mesh) => mesh.castShadow);
      merged.receiveShadow = meshes.some((mesh) => mesh.receiveShadow);
      container.add(merged);
      for (const mesh of meshes) mesh.removeFromParent();
    }

    // Preserve semantic lookup names used by diagnostics and accessibility
    // without restoring any renderable draw calls.
    for (const name of preservedNames) {
      if (this.root.getObjectByName(name)) continue;
      const marker = new THREE.Object3D();
      marker.name = name;
      marker.userData.semanticMarker = true;
      container.add(marker);
    }
  }

  _buildMaterials() {
    const plasterTexture = this._texture(makePlasterTexture(this.seed + 3));
    const brickTexture = this._texture(makeBrickTexture(this.seed + 11));
    this.flakeTexture = this._texture(makeFlakeTexture());

    this.plasterMaterial = this._material(new THREE.MeshStandardMaterial({
      color: 0x9a846b,
      map: plasterTexture,
      roughness: 0.97,
      metalness: 0,
    }));
    this.baseboardMaterial = this._material(new THREE.MeshStandardMaterial({
      color: 0x36251a,
      roughness: 0.68,
      metalness: 0.02,
    }));
    this.windowWoodMaterial = this._material(new THREE.MeshStandardMaterial({
      color: 0x76533a,
      roughness: 0.72,
      metalness: 0.01,
    }));
    this.windowPaintMaterial = this._material(new THREE.MeshStandardMaterial({
      color: 0xa7977d,
      roughness: 0.82,
      metalness: 0,
    }));
    this.radiatorMaterial = this._material(new THREE.MeshStandardMaterial({
      color: 0x625d54,
      roughness: 0.55,
      metalness: 0.62,
    }));
    this.brickMaterials = [0x754b3e, 0x65453d, 0x58413b].map((color) => this._material(new THREE.MeshStandardMaterial({
      color,
      map: brickTexture,
      roughness: 0.96,
      metalness: 0,
    })));
    this.roofMaterial = this._material(new THREE.MeshStandardMaterial({
      color: 0x252728,
      roughness: 0.88,
      metalness: 0.05,
    }));
    this.silhouetteMaterial = this._material(new THREE.MeshBasicMaterial({ color: 0x202a32 }));
    this.distantSilhouetteMaterial = this._material(new THREE.MeshBasicMaterial({ color: 0x3b4853 }));
    this.distanceHazeMaterial = this._material(new THREE.MeshBasicMaterial({
      color: 0x8293a1,
      transparent: true,
      opacity: 0.075,
      depthWrite: false,
    }));
    this.houseWindowMaterial = this._material(new THREE.MeshStandardMaterial({
      color: 0x20262b,
      emissive: 0x263947,
      emissiveIntensity: 0.12,
      roughness: 0.52,
    }));
    this.specialHouseWindowMaterial = this._material(this.houseWindowMaterial.clone());
    this.specialHouseWindowMaterial.color.set(0x7b5d3f);
    this.specialHouseWindowMaterial.emissive.set(0xffad62);
    this.specialHouseWindowMaterial.emissiveIntensity = 0.5;
    this.glassMaterial = this._material(new THREE.MeshPhysicalMaterial({
      color: 0xaebfc9,
      roughness: 0.16,
      transmission: 0,
      clearcoat: 0.75,
      clearcoatRoughness: 0.12,
      transparent: true,
      opacity: 0.15,
      depthWrite: false,
      side: THREE.DoubleSide,
    }));
    this.frostMaterial = this._material(new THREE.MeshStandardMaterial({
      color: 0xe0e5df,
      roughness: 1,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    }));
    this.snowMaterial = this._material(new THREE.MeshStandardMaterial({
      color: 0xe5e9e6,
      roughness: 0.92,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }));
    this.autumnLeafMaterial = this._material(new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    }));
    this.wireMaterial = this._material(new THREE.LineBasicMaterial({
      color: 0x24282a,
      transparent: true,
      opacity: 0.82,
    }));
    this.hazeMaterial = this._material(new THREE.MeshBasicMaterial({
      color: 0x8c9dab,
      transparent: true,
      opacity: 0.03,
      depthWrite: false,
    }));
  }

  _buildRoomShell() {
    const halfWidth = WINDOW.width / 2;
    const halfHeight = WINDOW.height / 2;
    const minX = WINDOW.centerX - halfWidth;
    const maxX = WINDOW.centerX + halfWidth;
    const minY = WINDOW.centerY - halfHeight;
    const maxY = WINDOW.centerY + halfHeight;
    const wallLeft = -15;
    const wallRight = 15;
    const wallTop = 12.5;

    const panels = [
      { width: minX - wallLeft, height: wallTop, x: (wallLeft + minX) / 2, y: wallTop / 2 },
      { width: wallRight - maxX, height: wallTop, x: (maxX + wallRight) / 2, y: wallTop / 2 },
      { width: WINDOW.width, height: minY, x: WINDOW.centerX, y: minY / 2 },
      { width: WINDOW.width, height: wallTop - maxY, x: WINDOW.centerX, y: (maxY + wallTop) / 2 },
    ];

    for (const panel of panels) {
      const mesh = this._mesh(
        new THREE.BoxGeometry(panel.width, panel.height, 0.16),
        this.plasterMaterial,
        { position: [panel.x, panel.y, WINDOW.wallZ] },
      );
      mesh.name = 'AgedPlasterWall';
      this.environment.add(mesh);
    }

    const baseboard = this._mesh(
      new THREE.BoxGeometry(30, 0.34, 0.2),
      this.baseboardMaterial,
      { position: [0, 0.21, WINDOW.wallZ + 0.14] },
    );
    baseboard.name = 'WalnutBaseboard';
    this.environment.add(baseboard);

    const pictureRail = this._mesh(
      new THREE.BoxGeometry(30, 0.1, 0.14),
      this.windowWoodMaterial,
      { position: [0, 9.34, WINDOW.wallZ + 0.12] },
    );
    pictureRail.name = 'RowhousePictureRail';
    this.environment.add(pictureRail);

    const radiator = new THREE.Group();
    radiator.name = 'CastIronRadiator';
    const columnGeometry = this._geometry(new THREE.CapsuleGeometry(0.13, 1.05, 5, 10));
    const columns = new THREE.InstancedMesh(columnGeometry, this.radiatorMaterial, 13);
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < 13; i += 1) {
      matrix.makeTranslation(WINDOW.centerX - 1.75 + i * 0.29, 1.07, WINDOW.wallZ + 0.3);
      columns.setMatrixAt(i, matrix);
    }
    columns.instanceMatrix.needsUpdate = true;
    columns.receiveShadow = true;
    radiator.add(columns);
    const pipe = this._mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 1.25, 14),
      this.radiatorMaterial,
      { position: [WINDOW.centerX + 2.06, 0.7, WINDOW.wallZ + 0.28] },
    );
    radiator.add(pipe);
    this.environment.add(radiator);
  }

  _buildExterior() {
    this.skyMaterial = this._material(new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color() },
        horizonColor: { value: new THREE.Color() },
        cloud: { value: 0.18 },
        cloudDrift: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform float cloud;
        uniform float cloudDrift;
        void main() {
          float lift = smoothstep(0.02, 0.88, vUv.y);
          vec3 color = mix(horizonColor, topColor, lift);
          float cloudA = sin((vUv.x + cloudDrift) * 8.2 + vUv.y * 3.4);
          float cloudB = sin((vUv.x - cloudDrift * 0.63) * 15.7 - vUv.y * 5.1);
          float cloudC = sin((vUv.x + cloudDrift * 0.31) * 29.0 + vUv.y * 9.0);
          float veil = cloud * smoothstep(0.18, 1.55, cloudA * 0.68 + cloudB * 0.24 + cloudC * 0.08 + 0.55);
          vec3 cloudColor = mix(vec3(0.34, 0.39, 0.43), horizonColor, 0.14);
          gl_FragColor = vec4(mix(color, cloudColor, veil * 0.22), 1.0);
        }
      `,
      depthWrite: false,
    }));
    const sky = this._mesh(
      new THREE.PlaneGeometry(WINDOW.width + 1.8, WINDOW.height + 1.8),
      this.skyMaterial,
      { position: [WINDOW.centerX, WINDOW.centerY, WINDOW.skyZ] },
    );
    sky.name = 'EarlyEveningSky';
    sky.receiveShadow = false;
    this.exterior.add(sky);

    const distantBlocks = [
      [2.25, 3.15, 0.92, 1.36], [3.06, 3.4, 0.84, 1.82], [3.82, 3.18, 0.74, 1.38],
      [4.57, 3.37, 0.78, 1.76], [5.38, 3.1, 0.92, 1.24], [6.22, 3.32, 0.82, 1.68],
    ];
    for (const [x, y, width, height] of distantBlocks) {
      const block = this._mesh(
        new THREE.PlaneGeometry(width, height),
        this.distantSilhouetteMaterial,
        { position: [x, y, WINDOW.skyZ + 0.18] },
      );
      block.receiveShadow = false;
      this.exterior.add(block);
    }

    const facades = [
      { x: 2.44, width: 1.18, height: 2.34, z: -7.84, material: this.brickMaterials[1] },
      { x: 3.73, width: 1.3, height: 2.64, z: -7.57, material: this.brickMaterials[0] },
      { x: 5.12, width: 1.28, height: 2.42, z: -7.36, material: this.brickMaterials[2] },
      { x: 6.34, width: 0.94, height: 2.54, z: -7.66, material: this.brickMaterials[0] },
    ];
    this.facades = [];
    this.snowCaps = [];
    let windowIndex = 0;
    for (let index = 0; index < facades.length; index += 1) {
      const facade = facades[index];
      const baseY = 1.08;
      const y = baseY + facade.height / 2;
      const building = this._mesh(
        new THREE.BoxGeometry(facade.width, facade.height, 0.12),
        facade.material,
        { position: [facade.x, y, facade.z] },
      );
      building.name = 'RearRowhouseBrick';
      this.exterior.add(building);
      this.facades.push(building);

      const roof = this._mesh(
        new THREE.BoxGeometry(facade.width + 0.08, 0.12, 0.24),
        this.roofMaterial,
        { position: [facade.x, baseY + 0.04 + facade.height, facade.z + 0.02] },
      );
      this.exterior.add(roof);

      const snowCapMaterial = this._material(this.snowMaterial.clone());
      snowCapMaterial.opacity = 0;
      this.snowCapMaterials.push(snowCapMaterial);
      const snowCap = this._mesh(
        new THREE.BoxGeometry(facade.width + 0.06, 0.035, 0.25),
        snowCapMaterial,
        { position: [facade.x, baseY + 0.12 + facade.height, facade.z + 0.035] },
      );
      this.exterior.add(snowCap);
      this.snowCaps.push(snowCap);

      const chimney = this._mesh(
        new THREE.BoxGeometry(0.18, 0.6 + (index % 2) * 0.14, 0.2),
        facade.material,
        { position: [facade.x - facade.width * 0.28, baseY + 0.33 + facade.height, facade.z - 0.01] },
      );
      this.exterior.add(chimney);

      const additionHeight = 0.72 + (index % 3) * 0.16;
      const rearAddition = this._mesh(
        new THREE.BoxGeometry(facade.width * 0.72, additionHeight, 0.32),
        facade.material,
        {
          position: [
            facade.x + facade.width * 0.08,
            baseY + 0.01 + additionHeight / 2,
            facade.z + 0.28,
          ],
        },
      );
      rearAddition.name = 'PhiladelphiaRearAddition';
      this.exterior.add(rearAddition);

      const additionRoof = this._mesh(
        new THREE.BoxGeometry(facade.width * 0.76, 0.055, 0.4),
        this.roofMaterial,
        {
          position: [
            facade.x + facade.width * 0.08,
            baseY + 0.05 + additionHeight,
            facade.z + 0.3,
          ],
        },
      );
      this.exterior.add(additionRoof);

      const rows = facade.height > 2.5 ? 2 : 1;
      for (let row = 0; row < rows; row += 1) {
        for (const direction of [-1, 1]) {
          const material = windowIndex === 4 ? this.specialHouseWindowMaterial : this.houseWindowMaterial;
          const pane = this._mesh(
            new THREE.PlaneGeometry(Math.min(0.3, facade.width * 0.22), 0.44),
            material,
            {
              position: [
                facade.x + direction * facade.width * 0.24,
                baseY + 0.57 + row * 0.76,
                facade.z + 0.067,
              ],
            },
          );
          pane.name = windowIndex === 4 ? 'DistantUneaseWindow' : 'DistantHouseWindow';
          pane.receiveShadow = false;
          this.exterior.add(pane);
          windowIndex += 1;
        }
      }
    }

    const branchPoints = [
      [1.92, 2.6, -6.46], [2.36, 4.0, -6.45],
      [2.36, 4.0, -6.45], [1.98, 5.08, -6.44],
      [2.34, 3.9, -6.45], [2.88, 5.55, -6.43],
      [2.66, 4.82, -6.44], [3.24, 5.58, -6.42],
      [2.56, 4.46, -6.44], [2.1, 5.3, -6.42],
    ];
    const branchGeometry = this._geometry(new THREE.BufferGeometry().setFromPoints(
      branchPoints.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    ));
    this.exteriorBranches = new THREE.LineSegments(branchGeometry, this.wireMaterial);
    this.exteriorBranches.name = 'BareRowhouseTree';
    this.exterior.add(this.exteriorBranches);

    const fireEscapeGeometry = this._geometry(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(5.56, 1.58, -7.08), new THREE.Vector3(6.62, 1.58, -7.08),
      new THREE.Vector3(5.62, 2.12, -7.08), new THREE.Vector3(6.56, 2.12, -7.08),
      new THREE.Vector3(5.66, 2.68, -7.08), new THREE.Vector3(6.52, 2.68, -7.08),
      new THREE.Vector3(5.62, 1.56, -7.08), new THREE.Vector3(5.68, 2.74, -7.08),
      new THREE.Vector3(6.56, 1.56, -7.08), new THREE.Vector3(6.5, 2.74, -7.08),
      new THREE.Vector3(5.66, 2.12, -7.08), new THREE.Vector3(6.48, 1.58, -7.08),
    ]));
    const fireEscape = new THREE.LineSegments(fireEscapeGeometry, this.wireMaterial);
    fireEscape.name = 'RearFireEscape';
    this.exterior.add(fireEscape);

    for (let i = 0; i < 3; i += 1) {
      const points = [];
      for (let step = 0; step <= 24; step += 1) {
        const t = step / 24;
        points.push(new THREE.Vector3(
          WINDOW.centerX - WINDOW.width * 0.48 + t * WINDOW.width * 0.96,
          6.15 + i * 0.38 - Math.sin(t * Math.PI) * (0.14 + i * 0.025),
          -6.31 + i * 0.025,
        ));
      }
      const wire = new THREE.Line(this._geometry(new THREE.BufferGeometry().setFromPoints(points)), this.wireMaterial);
      wire.name = 'PhiladelphiaUtilityWire';
      this.exterior.add(wire);
    }

    const distanceHaze = this._mesh(
      new THREE.PlaneGeometry(WINDOW.width + 0.1, WINDOW.height * 0.62),
      this.distanceHazeMaterial,
      { position: [WINDOW.centerX, WINDOW.centerY + 0.62, -8.26] },
    );
    distanceHaze.name = 'ExteriorAtmosphericPerspective';
    distanceHaze.renderOrder = -2;
    this.exterior.add(distanceHaze);
  }

  _buildWindow() {
    const frame = new THREE.Group();
    frame.name = 'PhiladelphiaBayWindow';
    const bottom = WINDOW.centerY - WINDOW.height / 2;
    // The large central pane projects outward; side panes turn back to the wall.
    const panes = [[-4.15, -6.62, 3.472, 0.317], [2.2, -7.16, 9.4, 0], [8.55, -6.62, 3.472, -0.317]];
    for (const [x, z, width, angle] of panes) {
      const wing = new THREE.Group(); wing.position.set(x, WINDOW.centerY, z); wing.rotation.y = angle;
      for (const side of [-1, 1]) {
        wing.add(this._mesh(new THREE.BoxGeometry(0.15, WINDOW.height, 0.24), this.windowWoodMaterial,
          { position: [side * width / 2, 0, 0] }));
        wing.add(this._mesh(new THREE.BoxGeometry(width + 0.15, 0.2, 0.28), this.windowWoodMaterial,
          { position: [0, side * WINDOW.height / 2, 0] }));
      }
      const pane = this._mesh(new THREE.PlaneGeometry(width-0.16, WINDOW.height-0.18), this.glassMaterial);
      pane.name = 'BayWindowGlass'; wing.add(pane); frame.add(wing);
    }
    frame.add(this._mesh(new THREE.BoxGeometry(WINDOW.width + 0.35, 0.24, 1.68),this.windowWoodMaterial,
      {position:[WINDOW.centerX,bottom-0.12,-6.38]}));
    frame.add(this._mesh(new THREE.BoxGeometry(WINDOW.width + 0.55, 0.12, 0.36),this.windowPaintMaterial,
      {position:[WINDOW.centerX,bottom-0.22,-5.59]}));
    this.sillSnowMaterial = this._material(this.snowMaterial.clone()); this.sillSnowMaterial.opacity = 0;
    frame.add(this._mesh(new THREE.BoxGeometry(9.2,0.035,0.21),this.sillSnowMaterial,
      {position:[WINDOW.centerX,bottom+0.035,-7.26]}));
    this.environment.add(frame);
  }

  _bindRealPecoDisplay() {
    for (const [mesh, box] of [[this.livingCity.crownFront,this.pecoCrownBroadFaceBox],
      [this.livingCity.crownSide,this.pecoCrownSideFaceBox]]) {
      const texture = this._texture(this.backdrop.texture.clone());
      texture.repeat.set(box.width / this.backdrop.width, box.height / this.backdrop.height);
      texture.offset.set(box.x / this.backdrop.width, (this.backdrop.height-box.y-box.height) / this.backdrop.height);
      texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.NearestFilter;
      texture.needsUpdate = true; mesh.material.map = texture; mesh.material.needsUpdate = true;
    }
  }

  _buildWeather() {
    this.precipitationGroup = new THREE.Group();
    this.precipitationGroup.name = 'MultiDepthPrecipitation';
    this.weatherGroup.add(this.precipitationGroup);

    this.rainPositions = new Float32Array(MAX_RAIN_STREAKS * 6);
    this.rainData = Array.from({ length: MAX_RAIN_STREAKS }, () => ({
      x: WINDOW.centerX + (this.rng() - 0.5) * (WINDOW.width - 0.42),
      y: WINDOW.centerY + (this.rng() - 0.5) * (WINDOW.height - 0.3),
      z: -7.16 + this.rng() * 0.96,
      speed: 3.7 + this.rng() * 4.5,
      length: 0.07 + this.rng() * 0.2,
      drift: -0.08 - this.rng() * 0.17,
    }));
    this.rainGeometry = this._geometry(new THREE.BufferGeometry());
    const rainAttribute = new THREE.BufferAttribute(this.rainPositions, 3);
    rainAttribute.setUsage(THREE.DynamicDrawUsage);
    this.rainGeometry.setAttribute('position', rainAttribute);
    this.rainMaterial = this._material(new THREE.LineBasicMaterial({
      color: 0xaabcc8,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }));
    this.rain = new THREE.LineSegments(this.rainGeometry, this.rainMaterial);
    this.rain.name = 'ExteriorRain';
    this.rain.frustumCulled = false;
    this.precipitationGroup.add(this.rain);

    this.snowPositions = new Float32Array(MAX_SNOW_FLAKES * 3);
    this.snowData = Array.from({ length: MAX_SNOW_FLAKES }, (_, index) => {
      const x = WINDOW.centerX + (this.rng() - 0.5) * (WINDOW.width - 0.32);
      const y = WINDOW.centerY + (this.rng() - 0.5) * (WINDOW.height - 0.24);
      const z = -7.18 + this.rng() * 1;
      this.snowPositions[index * 3] = x;
      this.snowPositions[index * 3 + 1] = y;
      this.snowPositions[index * 3 + 2] = z;
      return {
        speed: 0.34 + this.rng() * 0.65,
        phase: this.rng() * Math.PI * 2,
        sway: 0.07 + this.rng() * 0.16,
      };
    });
    this.snowGeometry = this._geometry(new THREE.BufferGeometry());
    const snowAttribute = new THREE.BufferAttribute(this.snowPositions, 3);
    snowAttribute.setUsage(THREE.DynamicDrawUsage);
    this.snowGeometry.setAttribute('position', snowAttribute);
    this.snowGeometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(WINDOW.centerX, WINDOW.centerY, -6.45),
      5,
    );
    this.snowPointsMaterial = this._material(new THREE.PointsMaterial({
      color: 0xf1f3ef,
      map: this.flakeTexture,
      alphaMap: this.flakeTexture,
      size: 0.075,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }));
    this.snow = new THREE.Points(this.snowGeometry, this.snowPointsMaterial);
    this.snow.name = 'ExteriorSnow';
    this.precipitationGroup.add(this.snow);

    // A handful of small instanced leaves is enough to read as a passing autumn
    // gust without turning the writing room into a continuous particle effect.
    const leafGeometry = this._geometry(new THREE.CircleGeometry(0.085, 6));
    this.autumnLeaves = new THREE.InstancedMesh(
      leafGeometry,
      this.autumnLeafMaterial,
      MAX_AUTUMN_LEAVES,
    );
    this.autumnLeaves.name = 'ExteriorAutumnLeaves';
    this.autumnLeaves.frustumCulled = false;
    this.autumnLeafData = Array.from({ length: MAX_AUTUMN_LEAVES }, (_, index) => ({
      x: WINDOW.centerX + (this.rng() - 0.5) * (WINDOW.width - 0.44),
      y: WINDOW.centerY + (this.rng() - 0.5) * (WINDOW.height - 0.5),
      z: -7.12 + this.rng() * 0.9,
      speed: 0.42 + this.rng() * 0.62,
      fall: 0.075 + this.rng() * 0.14,
      phase: this.rng() * Math.PI * 2,
      sway: 0.045 + this.rng() * 0.08,
      spin: (0.65 + this.rng() * 1.25) * (index % 2 === 0 ? 1 : -1),
      scale: 0.72 + this.rng() * 0.62,
    }));
    const leafColors = [0xb46a2b, 0xc18a38, 0x8f4827, 0xd0a04a];
    for (let index = 0; index < MAX_AUTUMN_LEAVES; index += 1) {
      this._writeAutumnLeafMatrix(index);
      this.autumnLeaves.setColorAt(index, new THREE.Color(leafColors[index % leafColors.length]));
    }
    this.autumnLeaves.instanceMatrix.needsUpdate = true;
    if (this.autumnLeaves.instanceColor) this.autumnLeaves.instanceColor.needsUpdate = true;
    this.precipitationGroup.add(this.autumnLeaves);

    this.dropletMaterial = this._material(new THREE.MeshPhysicalMaterial({
      color: 0xc4d3db,
      roughness: 0.09,
      transmission: 0,
      clearcoat: 0.75,
      clearcoatRoughness: 0.12,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }));
    const dropletGeometry = this._geometry(new THREE.SphereGeometry(0.04, 8, 6));
    this.droplets = new THREE.InstancedMesh(dropletGeometry, this.dropletMaterial, MAX_GLASS_DROPLETS);
    this.droplets.name = 'GlassRainDroplets';
    const dummy = new THREE.Object3D();
    for (let i = 0; i < MAX_GLASS_DROPLETS; i += 1) {
      dummy.position.set(
        WINDOW.centerX + (this.rng() - 0.5) * (WINDOW.width - 0.58),
        WINDOW.centerY + (this.rng() - 0.5) * (WINDOW.height - 0.58),
        WINDOW.frameZ + 0.185,
      );
      dummy.scale.set(0.38 + this.rng() * 0.5, 1.4 + this.rng() * 2.8, 0.16);
      dummy.updateMatrix();
      this.droplets.setMatrixAt(i, dummy.matrix);
    }
    this.droplets.instanceMatrix.needsUpdate = true;
    this.weatherGroup.add(this.droplets);

    const haze = this._mesh(
      new THREE.PlaneGeometry(WINDOW.width - 0.34, WINDOW.height - 0.34),
      this.hazeMaterial,
      { position: [WINDOW.centerX, WINDOW.centerY, -6.04] },
    );
    haze.name = 'WeatherVeil';
    haze.receiveShadow = false;
    this.weatherGroup.add(haze);

    this._updateRain(0);
  }

  _buildLighting() {
    this.eveningAmbient = new THREE.HemisphereLight(0x94a9bb, 0x3b2a20, 0.32);
    this.eveningAmbient.name = 'EarlyEveningAmbient';
    this.root.add(this.eveningAmbient);

    this.windowFill = new THREE.DirectionalLight(0x93b1cf, 1.05);
    this.windowFill.name = 'SashWindowFill';
    this.windowFill.position.set(WINDOW.centerX, WINDOW.centerY + 0.6, WINDOW.frameZ + 0.6);
    this.windowFill.target.position.set(0.2, 1.25, 1.5);
    this.root.add(this.windowFill, this.windowFill.target);

    this.warmBounce = new THREE.PointLight(0xffb66c, 10, 14, 1.7);
    this.warmBounce.name = 'DeskLampRoomBounce';
    this.warmBounce.position.set(-4.8, 4.4, -2.8);
    this.root.add(this.warmBounce);
  }

  _buildPerformanceBackdrop() {
    const textureWidth = this.qualityMode === 'low' ? 480 : 960;
    const textureHeight = this.qualityMode === 'low' ? 320 : 640;
    this.backdrop = createPhiladelphiaRoomBackdrop({
      width: textureWidth,
      height: textureHeight,
      seed: this.seed,
      weather: this._backdropWeather(),
    });
    const geometry = this._geometry(new THREE.PlaneGeometry(
      PHILADELPHIA_BACKDROP_PLANE.width,
      PHILADELPHIA_BACKDROP_PLANE.height,
    ));
    this.backdropMesh = new THREE.Mesh(geometry, this.backdrop.material);
    this.backdropMesh.name = 'PhiladelphiaPerformanceBackdrop';
    this.backdropMesh.position.fromArray(PHILADELPHIA_BACKDROP_PLANE.position);
    this.backdropMesh.rotation.fromArray(PHILADELPHIA_BACKDROP_PLANE.rotation);
    this.backdropMesh.castShadow = false;
    this.backdropMesh.receiveShadow = false;
    this.backdropMesh.renderOrder = -10;
    this.root.add(this.backdropMesh);
  }

  _buildWindowDepthOverlay() {
    this.windowDepthOverlay = new THREE.Group();
    this.windowDepthOverlay.name = 'WindowDepthOverlay';
    this.root.add(this.windowDepthOverlay);

    // The medium/low room keeps its one-texture painting, then restores real
    // depth with a single instanced sash and one foreground branch silhouette.
    this.simplifiedWindowDepth = new THREE.Group();
    this.simplifiedWindowDepth.name = 'SimplifiedWindowParallax';
    this.windowDepthOverlay.add(this.simplifiedWindowDepth);

    const depthFrameMaterial = this._material(new THREE.MeshBasicMaterial({
      color: 0x7f725c,
      toneMapped: false,
    }));
    const unitBox = this._geometry(new THREE.BoxGeometry(1, 1, 1));
    this.depthFrame = new THREE.InstancedMesh(unitBox, depthFrameMaterial, 7);
    this.depthFrame.name = 'DimensionalSashOverlay';
    const halfWidth = WINDOW.width / 2;
    const halfHeight = WINDOW.height / 2;
    const frameParts = [
      [WINDOW.centerX - halfWidth, WINDOW.centerY, -5.73, 0.2, WINDOW.height + 0.2, 0.18],
      [WINDOW.centerX + halfWidth, WINDOW.centerY, -5.73, 0.2, WINDOW.height + 0.2, 0.18],
      [WINDOW.centerX, WINDOW.centerY - halfHeight, -5.73, WINDOW.width + 0.2, 0.2, 0.18],
      [WINDOW.centerX, WINDOW.centerY + halfHeight, -5.73, WINDOW.width + 0.2, 0.2, 0.18],
      [WINDOW.centerX, WINDOW.centerY, -5.69, 0.14, WINDOW.height - 0.2, 0.13],
      [WINDOW.centerX, WINDOW.centerY, -5.68, WINDOW.width - 0.22, 0.16, 0.14],
      [WINDOW.centerX, WINDOW.centerY - halfHeight - 0.14, -5.57, WINDOW.width + 0.58, 0.22, 0.48],
    ];
    const dummy = new THREE.Object3D();
    for (let index = 0; index < frameParts.length; index += 1) {
      const [x, y, z, width, height, depth] = frameParts[index];
      dummy.position.set(x, y, z);
      dummy.scale.set(width, height, depth);
      dummy.updateMatrix();
      this.depthFrame.setMatrixAt(index, dummy.matrix);
    }
    this.depthFrame.instanceMatrix.needsUpdate = true;
    this.simplifiedWindowDepth.add(this.depthFrame);

    const branchGeometry = this._geometry(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(1.86, 2.66, -5.83), new THREE.Vector3(2.4, 4.04, -5.82),
      new THREE.Vector3(2.4, 4.04, -5.82), new THREE.Vector3(2.04, 5.16, -5.81),
      new THREE.Vector3(2.36, 3.94, -5.82), new THREE.Vector3(2.96, 5.64, -5.79),
      new THREE.Vector3(2.72, 4.86, -5.8), new THREE.Vector3(3.32, 5.7, -5.77),
      new THREE.Vector3(2.62, 4.46, -5.8), new THREE.Vector3(2.14, 5.36, -5.78),
    ]));
    const depthBranchMaterial = this._material(new THREE.LineBasicMaterial({
      color: 0x1e2426,
      transparent: true,
      opacity: 0.76,
    }));
    this.depthBranches = new THREE.LineSegments(branchGeometry, depthBranchMaterial);
    this.depthBranches.name = 'ForegroundBranchParallax';
    this.windowDepthOverlay.add(this.depthBranches);

    // High quality uses the authored vista as its far-distance layer, cropped
    // from the same deterministic texture as medium. Selective real geometry
    // then supplies near parallax without covering the richer skyline.
    const aperture = this.backdrop.layout.aperture;
    this.exteriorVistaTexture = this._texture(this.backdrop.texture.clone());
    this.exteriorVistaTexture.name = 'PhiladelphiaExteriorVistaTexture';
    this.exteriorVistaTexture.repeat.set(
      aperture.width / this.backdrop.width,
      aperture.height / this.backdrop.height,
    );
    this.exteriorVistaTexture.offset.set(
      aperture.x / this.backdrop.width,
      (this.backdrop.height - aperture.y - aperture.height) / this.backdrop.height,
    );
    this.exteriorVistaTexture.needsUpdate = true;
    this.exteriorVistaMaterial = this._material(new THREE.MeshBasicMaterial({
      map: this.exteriorVistaTexture,
      color: 0xeeeeea,
      toneMapped: false,
      depthWrite: true,
    }));
    this.exteriorVista = new THREE.Mesh(
      this._geometry(new THREE.PlaneGeometry(WINDOW.width + 0.42, WINDOW.height + 0.5)),
      this.exteriorVistaMaterial,
    );
    this.exteriorVista.name = 'LayeredPhiladelphiaExteriorVista';
    this.exteriorVista.position.set(WINDOW.centerX, WINDOW.centerY, -7.1);
    this.exteriorVista.renderOrder = -8;
    this.windowDepthOverlay.add(this.exteriorVista);

    this._initializePecoCrownLights();

    this.highExteriorHybrid = new THREE.Group();
    this.highExteriorHybrid.name = 'HighQualityExteriorDepth';
    this.windowDepthOverlay.add(this.highExteriorHybrid);

    const hybridFacadeMaterial = this._material(new THREE.MeshStandardMaterial({
      color: 0x493c37,
      roughness: 0.94,
      metalness: 0,
    }));
    const rearMasses = [
      [2.32, 2.32, -6.72, 0.92, 0.62, 0.34],
      [3.48, 2.18, -6.48, 1.02, 0.46, 0.42],
      [4.78, 2.28, -6.66, 1.08, 0.56, 0.36],
      [6.08, 2.16, -6.42, 0.88, 0.42, 0.4],
    ];
    this.hybridRearMasses = new THREE.InstancedMesh(unitBox, hybridFacadeMaterial, rearMasses.length);
    this.hybridRearMasses.name = 'DimensionalRearAdditions';
    for (let index = 0; index < rearMasses.length; index += 1) {
      const [x, y, z, width, height, depth] = rearMasses[index];
      dummy.position.set(x, y, z);
      dummy.scale.set(width, height, depth);
      dummy.updateMatrix();
      this.hybridRearMasses.setMatrixAt(index, dummy.matrix);
    }
    this.hybridRearMasses.instanceMatrix.needsUpdate = true;
    this.highExteriorHybrid.add(this.hybridRearMasses);

    const hybridRoofMaterial = this._material(new THREE.MeshStandardMaterial({
      color: 0x24282a,
      roughness: 0.88,
      metalness: 0.04,
    }));
    const roofDetails = [
      [2.32, 2.66, -6.68, 1.02, 0.09, 0.42],
      [3.48, 2.44, -6.43, 1.14, 0.08, 0.48],
      [4.78, 2.59, -6.62, 1.18, 0.09, 0.44],
      [6.08, 2.4, -6.37, 0.98, 0.08, 0.48],
      [2.02, 3.03, -6.76, 0.14, 0.64, 0.18],
      [4.48, 3.02, -6.7, 0.13, 0.76, 0.17],
      [5.88, 2.84, -6.46, 0.12, 0.58, 0.16],
    ];
    this.hybridRoofDetails = new THREE.InstancedMesh(unitBox, hybridRoofMaterial, roofDetails.length);
    this.hybridRoofDetails.name = 'ParapetsCornicesAndChimneys';
    for (let index = 0; index < roofDetails.length; index += 1) {
      const [x, y, z, width, height, depth] = roofDetails[index];
      dummy.position.set(x, y, z);
      dummy.scale.set(width, height, depth);
      dummy.updateMatrix();
      this.hybridRoofDetails.setMatrixAt(index, dummy.matrix);
    }
    this.hybridRoofDetails.instanceMatrix.needsUpdate = true;
    this.highExteriorHybrid.add(this.hybridRoofDetails);

    const hybridEscapeGeometry = this._geometry(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(5.12, 2.12, -6.18), new THREE.Vector3(5.92, 2.12, -6.18),
      new THREE.Vector3(5.18, 2.56, -6.18), new THREE.Vector3(5.86, 2.56, -6.18),
      new THREE.Vector3(5.18, 2.1, -6.18), new THREE.Vector3(5.2, 2.62, -6.18),
      new THREE.Vector3(5.86, 2.1, -6.18), new THREE.Vector3(5.84, 2.62, -6.18),
      new THREE.Vector3(5.2, 2.56, -6.18), new THREE.Vector3(5.78, 2.12, -6.18),
    ]));
    this.hybridFireEscape = new THREE.LineSegments(hybridEscapeGeometry, depthBranchMaterial);
    this.hybridFireEscape.name = 'HybridRearFireEscape';
    this.highExteriorHybrid.add(this.hybridFireEscape);

    // One shader layer carries both cool cloud shadow and warm interior glass
    // reflection, retaining the medium-quality draw-call budget.
    this.glassAtmosphereMaterial = this._material(new THREE.ShaderMaterial({
      uniforms: {
        cloud: { value: this.weatherState.cloud },
        drift: { value: 0 },
        warmStrength: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform float cloud;
        uniform float drift;
        uniform float warmStrength;
        void main() {
          float cloudA = sin((vUv.x + drift) * 8.0 + vUv.y * 3.2);
          float cloudB = sin((vUv.x - drift * 0.57) * 17.0 - vUv.y * 4.8);
          float cloudMask = smoothstep(0.42, 1.18, cloudA * 0.72 + cloudB * 0.28 + 0.44);
          float bandA = 1.0 - smoothstep(0.028, 0.075, abs(vUv.x - (0.04 + vUv.y * 0.31)));
          float bandB = 1.0 - smoothstep(0.025, 0.065, abs(vUv.x - (0.69 + vUv.y * 0.18)));
          float edge = (1.0 - smoothstep(0.0, 0.035, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y))));
          float coolAlpha = cloudMask * cloud * 0.052;
          float warmAlpha = (bandA * 0.05 + bandB * 0.028) * warmStrength;
          float alpha = coolAlpha + warmAlpha + edge * 0.018;
          vec3 cool = vec3(0.34, 0.46, 0.57);
          vec3 warm = vec3(0.91, 0.73, 0.49);
          vec3 color = mix(cool, warm, clamp(warmAlpha * 15.0, 0.0, 1.0));
          gl_FragColor = vec4(color, alpha);
        }
      `,
    }));
    this.glassAtmosphere = new THREE.Mesh(
      this._geometry(new THREE.PlaneGeometry(WINDOW.width - 0.34, WINDOW.height - 0.34)),
      this.glassAtmosphereMaterial,
    );
    this.glassAtmosphere.name = 'MovingCloudAndGlassReflection';
    this.glassAtmosphere.position.set(WINDOW.centerX, WINDOW.centerY, -5.51);
    this.glassAtmosphere.renderOrder = 4;
    this.windowDepthOverlay.add(this.glassAtmosphere);
  }

  _initializePecoCrownLights() {
    const sx = this.backdrop.width / 960;
    const sy = this.backdrop.height / 640;
    const scaleBox = (x, y, width, height) => ({
      x: Math.round(x * sx),
      y: Math.round(y * sy),
      width: Math.round(width * sx),
      height: Math.round(height * sy),
    });
    const landmark = this.backdrop.layout.peco ?? {};
    const crown = landmark.crown ?? scaleBox(596, 318, 88, 32);
    const crownBroadFace = landmark.crownBroadFace ?? {
      x: crown.x,
      y: crown.y,
      width: Math.round(crown.width * 0.79),
      height: Math.round(crown.height * 0.91),
    };
    const crownSideFace = landmark.crownSideFace ?? {
      x: crownBroadFace.x + crownBroadFace.width,
      y: crown.y + Math.round(crown.height * 0.16),
      width: Math.max(1, crown.x + crown.width - crownBroadFace.x - crownBroadFace.width),
      height: Math.max(1, Math.round(crown.height * 0.84)),
    };
    this.pecoCrownRegion = crown;
    this.pecoCrownBroadFaceBox = crownBroadFace;
    this.pecoCrownSideFaceBox = crownSideFace;
    this.pecoCrownBase = captureTextureRegion(this.backdrop.texture, crown);
    this.backdrop.texture.userData.pecoCrown = {
      animatedInPlace: true,
      broadColumns: PECO_CROWN.broadColumns,
      sideColumns: PECO_CROWN.sideColumns,
      region: { ...crown },
    };

    const performancePlane = {
      sourceWidth: this.backdrop.width,
      sourceHeight: this.backdrop.height,
      planeWidth: PHILADELPHIA_BACKDROP_PLANE.width,
      planeHeight: PHILADELPHIA_BACKDROP_PLANE.height,
      centerX: PHILADELPHIA_BACKDROP_PLANE.position[0],
      centerY: PHILADELPHIA_BACKDROP_PLANE.position[1],
    };
    const vistaPlane = {
      sourceWidth: this.backdrop.width,
      sourceHeight: this.backdrop.height,
      planeWidth: WINDOW.width + 0.42,
      planeHeight: WINDOW.height + 0.5,
      centerX: WINDOW.centerX,
      centerY: WINDOW.centerY,
      crop: this.backdrop.layout.aperture,
    };

    const addCrownAnchor = (group, box, plane, name, z) => {
      const mapped = mapTextureBoxToPlane(box, plane);
      const anchor = new THREE.Object3D();
      anchor.name = name;
      anchor.position.set(mapped.x, mapped.y, z);
      anchor.userData.width = mapped.width;
      anchor.userData.height = mapped.height;
      anchor.userData.textureBox = { ...box };
      group.add(anchor);
      return anchor;
    };

    this.simplifiedPecoCrown = new THREE.Group();
    this.simplifiedPecoCrown.name = 'PECOTowerCrownLightsSimplified';
    this.windowDepthOverlay.add(this.simplifiedPecoCrown);
    this.simplifiedPecoBroadFace = addCrownAnchor(
      this.simplifiedPecoCrown,
      crownBroadFace,
      performancePlane,
      'PECOTowerCrownLightsSimplifiedBroadFace',
      PHILADELPHIA_BACKDROP_PLANE.position[2],
    );
    this.simplifiedPecoSideFace = addCrownAnchor(
      this.simplifiedPecoCrown,
      crownSideFace,
      performancePlane,
      'PECOTowerCrownLightsSimplifiedSideFace',
      PHILADELPHIA_BACKDROP_PLANE.position[2],
    );

    this.highPecoCrown = new THREE.Group();
    this.highPecoCrown.name = 'PECOTowerCrownLightsHigh';
    this.windowDepthOverlay.add(this.highPecoCrown);
    this.highPecoBroadFace = addCrownAnchor(
      this.highPecoCrown,
      crownBroadFace,
      vistaPlane,
      'PECOTowerCrownLightsHighBroadFace',
      this.exteriorVista.position.z,
    );
    this.highPecoSideFace = addCrownAnchor(
      this.highPecoCrown,
      crownSideFace,
      vistaPlane,
      'PECOTowerCrownLightsHighSideFace',
      this.exteriorVista.position.z,
    );

    this.pecoCrownState = {
      frame: 0,
      lastTick: -1,
      scrollOffset: 0,
      staticFrame: this.reducedMotion,
    };
    this._renderPecoCrown(this.elapsed, { force: true, fullTextureUpload: true });
  }

  _renderPecoCrown(elapsed, { force = false, fullTextureUpload = false } = {}) {
    if (!this.pecoCrownState || !this.pecoCrownRegion || !this.backdrop?.texture) return false;
    const introDwell = !this.reducedMotion && elapsed < PECO_CROWN.introDwellSeconds;
    const staticFrame = this.reducedMotion || introDwell;
    const displayElapsed = Math.max(0, elapsed - PECO_CROWN.introDwellSeconds);
    const tick = staticFrame ? 0 : Math.floor(displayElapsed / PECO_CROWN.updateInterval);
    if (!force && tick === this.pecoCrownState.lastTick && staticFrame === this.pecoCrownState.staticFrame) {
      return false;
    }

    if (fullTextureUpload) {
      this.pecoCrownBase = captureTextureRegion(this.backdrop.texture, this.pecoCrownRegion);
    }
    restoreTextureRegion(this.backdrop.texture, this.pecoCrownRegion, this.pecoCrownBase);
    const crownBrightness = Math.max(
      0.68,
      Math.min(1.04, 0.72 + this.eveningProgress * 0.22 + this.weatherState.rain * 0.05),
    ) * Math.min(1.08, this.brightness);
    const broadResult = paintPecoCrownFace(this.backdrop.texture, this.pecoCrownBroadFaceBox, {
      columns: PECO_CROWN.broadColumns,
      elapsed: displayElapsed,
      intensity: crownBrightness,
      staticFrame,
      staticText: 'PECO',
    });
    paintPecoCrownFace(this.backdrop.texture, this.pecoCrownSideFaceBox, {
      columns: PECO_CROWN.sideColumns,
      elapsed: displayElapsed,
      faceOffset: this.pecoCrownBroadFaceBox.width,
      intensity: crownBrightness * 0.82,
      staticFrame,
      staticText: ' ',
    });
    for (const texture of [this.backdrop.texture, this.exteriorVistaTexture]) {
      if (texture) markTextureRegionForUpload(texture, this.pecoCrownRegion, { fullTextureUpload });
    }
    if (this.livingCity) {
      this.livingCity.crownFront.material.map.needsUpdate = true;
      this.livingCity.crownSide.material.map.needsUpdate = true;
    }
    this.pecoCrownState.frame += 1;
    this.pecoCrownState.lastTick = tick;
    this.pecoCrownState.scrollOffset = staticFrame ? 0 : broadResult.scrollOffset;
    this.pecoCrownState.staticFrame = staticFrame;
    return true;
  }

  _backdropWeather() {
    if (this.weatherPreset !== 'automatic') return this.weatherPreset;
    if (this.weatherState.snow > 0.28) return 'snow';
    if (this.weatherState.rain > 0.28) return 'rain';
    return 'quiet';
  }

  _chooseInitialQuality() {
    if (!this.renderer) return 'medium';
    const size = new THREE.Vector2(1280, 720);
    if (typeof this.renderer.getSize === 'function') this.renderer.getSize(size);
    return chooseInitialQuality({
      pixelRatio: typeof this.renderer.getPixelRatio === 'function' ? this.renderer.getPixelRatio() : 1,
      width: size.x,
      height: size.y,
      maxTextureSize: this.renderer.capabilities?.maxTextureSize ?? 8192,
    });
  }

  _applyQuality(quality) {
    const next = QUALITY_PROFILES[quality] ? quality : 'medium';
    this.effectiveQuality = next;
    if (this.qualityGovernor) this.qualityGovernor.quality = next;
    const profile = QUALITY_PROFILES[next];
    const motionScale = this.reducedMotion ? 0.42 : 1;
    const rainCount = Math.max(24, Math.round(profile.rainStreaks * motionScale));
    const snowCount = Math.max(20, Math.round(profile.snowFlakes * motionScale));
    const leafCount = profile.autumnLeaves;
    const dropletCount = Math.max(6, Math.round(profile.glassDroplets * motionScale));
    this.rainGeometry.setDrawRange(0, rainCount * 2);
    this.snowGeometry.setDrawRange(0, snowCount);
    this.autumnLeaves.count = leafCount;
    this.droplets.count = dropletCount;
    this.activeRainCount = rainCount;
    this.activeSnowCount = snowCount;
    this.activeAutumnLeafCount = leafCount;
    this.updateStride = this.reducedMotion ? Math.max(2, profile.updateStride) : profile.updateStride;

    // Preserve architectural depth at every tier. Particle density remains adaptive.
    if (this.backdropMesh) this.backdropMesh.visible = false;
    if (this.windowDepthOverlay) this.windowDepthOverlay.visible = false;
    for (const layer of [this.simplifiedWindowDepth,this.simplifiedPecoCrown,this.exteriorVista,this.highExteriorHybrid,this.highPecoCrown]) {
      if (layer) layer.visible = false;
    }
    this.environment.visible = true;
    this.exterior.visible = false;
    if (!this.realSky) {
      this.realSky = new THREE.Mesh(this._geometry(new THREE.PlaneGeometry(120,65)),this.skyMaterial);
      this.realSky.position.set(4,15,-45); this.realSky.name = 'DimensionalCitySky'; this.root.add(this.realSky);
    }
    this.weatherGroup.position.z = -1.4;
    this.precipitationGroup.position.z = 0;
    if (this.eveningAmbient) this.eveningAmbient.visible = true;
    if (this.windowFill) this.windowFill.visible = true;
    if (this.warmBounce) this.warmBounce.visible = true;
  }

  _applyAtmosphere() {
    const palette = computeEveningPalette(this.eveningProgress, this.brightness);
    setColor(this.skyMaterial.uniforms.topColor.value, palette.skyTop);
    setColor(this.skyMaterial.uniforms.horizonColor.value, palette.skyHorizon);
    setColor(this.windowFill.color, palette.windowFill);
    setColor(this.warmBounce.color, palette.warmBounce);

    const uneaseStrength = this.uneaseLevel === 'unsettling' ? 0.18 : this.uneaseLevel === 'subtle' ? 0.075 : 0;
    const lightDip = 1 - this.uneaseSignal * uneaseStrength;
    const passingCloudDip = 1 - this.weatherState.cloud * this.cloudLightSignal * 0.065;
    this.windowFill.intensity = palette.windowIntensity * lightDip * passingCloudDip;
    this.warmBounce.intensity = palette.warmIntensity * (1 - this.uneaseSignal * uneaseStrength * 0.35);
    this.eveningAmbient.intensity = palette.ambientIntensity * lightDip * (0.985 + passingCloudDip * 0.015);
    this.houseWindowMaterial.emissiveIntensity = palette.houseWindowIntensity * 0.16;
    this.specialHouseWindowMaterial.emissiveIntensity = palette.houseWindowIntensity * (1 - this.uneaseSignal * 0.92);

    this.skyMaterial.uniforms.cloud.value = this.weatherState.cloud;
    this.glassAtmosphereMaterial.uniforms.cloud.value = this.weatherState.cloud;
    this.glassAtmosphereMaterial.uniforms.warmStrength.value = Math.max(0.68, 1 - this.weatherState.cloud * 0.2);
    this.rainMaterial.opacity = this.weatherState.rain * 0.62;
    this.snowPointsMaterial.opacity = this.weatherState.snow * 0.9;
    this.autumnLeafMaterial.opacity = this.weatherState.leaves * 0.82;
    this.dropletMaterial.opacity = this.weatherState.rain * 0.3;
    this.hazeMaterial.opacity = 0.018 + this.weatherState.cloud * 0.095;
    this.sillSnowMaterial.opacity = this.weatherState.snow * 0.86;
    for (const material of this.snowCapMaterials) material.opacity = this.weatherState.snow * 0.78;

    this.livingCity?.applyWeather(this.weatherState);
    this.rain.visible = this.weatherState.rain > 0.008;
    this.snow.visible = this.weatherState.snow > 0.008;
    this.autumnLeaves.visible = false; // Ground-aware leaves belong to livingCity.
    this.droplets.visible = this.weatherState.rain > 0.025;
    const vistaBrightness = Math.max(0.72, Math.min(1, this.brightness * lightDip * 0.82));
    this.exteriorVistaMaterial.color.setRGB(vistaBrightness, vistaBrightness, vistaBrightness);
    const backdropUpdate = this.backdrop?.update({
      weather: this._backdropWeather(),
      brightness: this.brightness * lightDip,
    });
    if (backdropUpdate?.textureChanged && this.exteriorVistaTexture) {
      this.exteriorVistaTexture.needsUpdate = true;
    }
    this._renderPecoCrown(this.elapsed, {
      force: backdropUpdate?.textureChanged === true,
      fullTextureUpload: backdropUpdate?.textureChanged === true,
    });
  }

  _updateRain(delta) {
    const minX = WINDOW.centerX - WINDOW.width / 2 + 0.23;
    const maxX = WINDOW.centerX + WINDOW.width / 2 - 0.23;
    const minY = WINDOW.centerY - WINDOW.height / 2 + 0.22;
    const maxY = WINDOW.centerY + WINDOW.height / 2 - 0.15;
    const wind = this.weatherState.wind;
    for (let i = 0; i < this.activeRainCount; i += 1) {
      const drop = this.rainData[i];
      drop.y -= drop.speed * delta;
      drop.x += drop.drift * wind * delta;
      if (drop.y < minY || drop.x < minX) {
        drop.y = maxY + this.rng() * 0.35;
        drop.x = minX + this.rng() * (maxX - minX);
      }
      const offset = i * 6;
      this.rainPositions[offset] = drop.x;
      this.rainPositions[offset + 1] = drop.y;
      this.rainPositions[offset + 2] = drop.z;
      this.rainPositions[offset + 3] = drop.x + drop.drift * 0.17;
      this.rainPositions[offset + 4] = drop.y - drop.length;
      this.rainPositions[offset + 5] = drop.z;
    }
    this.rainGeometry.attributes.position.needsUpdate = true;
  }

  _updateSnow(delta) {
    const minX = WINDOW.centerX - WINDOW.width / 2 + 0.2;
    const maxX = WINDOW.centerX + WINDOW.width / 2 - 0.2;
    const minY = WINDOW.centerY - WINDOW.height / 2 + 0.18;
    const maxY = WINDOW.centerY + WINDOW.height / 2 - 0.12;
    const wind = this.weatherState.wind;
    const motionScale = this.reducedMotion ? 0.38 : 1;
    for (let i = 0; i < this.activeSnowCount; i += 1) {
      const data = this.snowData[i];
      const offset = i * 3;
      let x = this.snowPositions[offset];
      let y = this.snowPositions[offset + 1];
      y -= data.speed * delta * motionScale;
      x += (wind * 0.08 + Math.sin(this.elapsed * 0.72 + data.phase) * data.sway) * delta * motionScale;
      if (y < minY || x > maxX) {
        x = minX + this.rng() * (maxX - minX);
        y = maxY + this.rng() * 0.24;
      }
      this.snowPositions[offset] = x;
      this.snowPositions[offset + 1] = y;
    }
    this.snowGeometry.attributes.position.needsUpdate = true;
  }

  _writeAutumnLeafMatrix(index) {
    const data = this.autumnLeafData[index];
    if (!data) return;
    if (!this.autumnLeafDummy) this.autumnLeafDummy = new THREE.Object3D();
    this.autumnLeafDummy.position.set(data.x, data.y, data.z);
    this.autumnLeafDummy.rotation.set(
      Math.sin(data.phase * 0.73) * 0.48,
      Math.cos(data.phase * 0.51) * 0.34,
      data.phase,
    );
    this.autumnLeafDummy.scale.set(data.scale * 1.45, data.scale * 0.62, data.scale);
    this.autumnLeafDummy.updateMatrix();
    this.autumnLeaves.setMatrixAt(index, this.autumnLeafDummy.matrix);
  }

  _updateAutumnLeaves(delta) {
    const minX = WINDOW.centerX - WINDOW.width / 2 + 0.18;
    const maxX = WINDOW.centerX + WINDOW.width / 2 - 0.18;
    const minY = WINDOW.centerY - WINDOW.height / 2 + 0.16;
    const maxY = WINDOW.centerY + WINDOW.height / 2 - 0.14;
    const wind = this.weatherState.wind;
    for (let index = 0; index < this.activeAutumnLeafCount; index += 1) {
      const data = this.autumnLeafData[index];
      data.phase += data.spin * delta;
      data.x += data.speed * (0.18 + wind * 0.82) * delta;
      data.y += (Math.sin(this.elapsed * 1.15 + data.phase) * data.sway - data.fall) * delta;
      if (data.x > maxX || data.y < minY) {
        data.x = minX - this.rng() * 0.42;
        data.y = minY + this.rng() * (maxY - minY);
        data.z = -7.12 + this.rng() * 0.9;
      }
      this._writeAutumnLeafMatrix(index);
    }
    this.autumnLeaves.instanceMatrix.needsUpdate = true;
  }

  update(deltaSeconds, elapsedSeconds = null) {
    if (this.disposed) return;
    const rawDelta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    const delta = Math.min(rawDelta, 0.075);
    // Reduced motion is a static composition, not merely a slower animation.
    // Explicit configuration methods still update the chosen weather/light.
    if (this.reducedMotion) return;
    this.elapsed = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : this.elapsed + delta;
    this.frame += 1;

    if (this.qualityMode === 'auto') {
      const adaptiveQuality = this.qualityGovernor.update(rawDelta);
      if (adaptiveQuality) {
        this._applyQuality(adaptiveQuality);
        this.onAtmosphereEvent?.({ type: 'quality-change', quality: adaptiveQuality });
      }
    }

    const targetWeather = resolveWeatherTargets(this.weatherPreset, this.elapsed, this.seed);
    const weatherEase = 1 - Math.exp(-delta * 0.55);
    for (const key of ['rain', 'snow', 'wind', 'cloud', 'leaves']) {
      this.weatherState[key] = THREE.MathUtils.lerp(this.weatherState[key], targetWeather[key], weatherEase);
    }

    const cloudPhase = this.elapsed * 0.052 + this.seed * 0.031;
    this.cloudLightSignal = clamp01(
      0.46
      + Math.sin(cloudPhase) * 0.28
      + Math.sin(cloudPhase * 0.43 + 1.7) * 0.16,
    );
    const cloudDrift = this.elapsed * 0.0065 + this.seed * 0.001;
    this.skyMaterial.uniforms.cloudDrift.value = cloudDrift;
    this.glassAtmosphereMaterial.uniforms.drift.value = cloudDrift;
    const branchSway = Math.sin(this.elapsed * 0.31 + this.seed) * this.weatherState.wind * 0.024;
    if (this.exteriorBranches) {
      this.exteriorBranches.position.x = branchSway;
      this.exteriorBranches.position.y = Math.cos(this.elapsed * 0.23 + this.seed) * this.weatherState.wind * 0.007;
    }
    if (this.depthBranches) {
      this.depthBranches.position.x = branchSway * 1.24;
      this.depthBranches.position.y = Math.cos(this.elapsed * 0.23 + this.seed) * this.weatherState.wind * 0.009;
    }

    this.previousUneaseSignal = this.uneaseSignal;
    this.uneaseSignal = this.reducedMotion ? 0 : computeUneaseSignal(this.elapsed, this.uneaseLevel, this.seed);
    if (this.previousUneaseSignal <= 0.08 && this.uneaseSignal > 0.08) {
      this.onAtmosphereEvent?.({
        type: 'unease-begin',
        level: this.uneaseLevel,
        strength: this.uneaseSignal,
      });
    }

    this._applyAtmosphere();
    this.livingCity?.update(this.elapsed, delta, this.weatherState);
    this.particleAccumulator += delta;
    if (this.frame % this.updateStride === 0) {
      const particleDelta = this.particleAccumulator;
      this.particleAccumulator = 0;
      if (this.rain.visible) this._updateRain(particleDelta);
      if (this.snow.visible) this._updateSnow(particleDelta);
      if (this.autumnLeaves.visible) this._updateAutumnLeaves(particleDelta);
    }
  }

  configure({
    weather,
    unease,
    quality,
    eveningProgress,
    brightness,
    reducedMotion,
  } = {}) {
    if (weather !== undefined) this.setWeatherPreset(weather);
    if (unease !== undefined) this.setUnease(unease);
    if (quality !== undefined) this.setQuality(quality);
    if (eveningProgress !== undefined || brightness !== undefined) {
      this.setLighting({ eveningProgress, brightness });
    }
    if (reducedMotion !== undefined) this.setReducedMotion(reducedMotion);
    return this;
  }

  setWeatherPreset(preset, { immediate = false } = {}) {
    this.weatherPreset = normalizeWeatherPreset(preset);
    if (immediate || this.reducedMotion) {
      this.weatherState = resolveWeatherTargets(this.weatherPreset, this.elapsed, this.seed);
    }
    this._applyAtmosphere();
    return this.weatherPreset;
  }

  setUnease(level) {
    this.uneaseLevel = normalizeUneaseLevel(level);
    if (this.uneaseLevel === 'off') this.uneaseSignal = 0;
    this._applyAtmosphere();
    return this.uneaseLevel;
  }

  setQuality(mode) {
    this.qualityMode = normalizeQualityMode(mode);
    const effective = this.qualityMode === 'auto' ? this._chooseInitialQuality() : this.qualityMode;
    this.qualityGovernor = new AdaptiveQualityGovernor(effective);
    this._applyQuality(effective);
    return this.effectiveQuality;
  }

  setLighting({ eveningProgress, brightness } = {}) {
    if (eveningProgress !== undefined) this.eveningProgress = clamp01(eveningProgress);
    if (brightness !== undefined) {
      const value = Number(brightness);
      if (Number.isFinite(value)) this.brightness = Math.max(0.45, Math.min(1.5, value));
    }
    this._applyAtmosphere();
    return { eveningProgress: this.eveningProgress, brightness: this.brightness };
  }

  setReducedMotion(enabled) {
    this.reducedMotion = Boolean(enabled);
    if (this.reducedMotion) {
      this.uneaseSignal = 0;
      this.previousUneaseSignal = 0;
      this.weatherState = resolveWeatherTargets(this.weatherPreset, this.elapsed, this.seed);
      this.particleAccumulator = 0;
    }
    this._applyQuality(this.effectiveQuality);
    this._applyAtmosphere();
    return this.reducedMotion;
  }

  setVisible(visible) {
    this.root.visible = Boolean(visible);
    return this.root.visible;
  }

  getState() {
    return {
      weather: this.weatherPreset,
      weatherLevels: { ...this.weatherState },
      unease: this.uneaseLevel,
      uneaseSignal: this.uneaseSignal,
      quality: this.qualityMode,
      effectiveQuality: this.effectiveQuality,
      eveningProgress: this.eveningProgress,
      brightness: this.brightness,
      reducedMotion: this.reducedMotion,
      stationary: true,
      pecoCrown: {
        name: 'PECO Crown Lights',
        message: 'PHILADELPHIA WRITES TONIGHT / OCTOBERLINE 211',
        scrollOffset: this.pecoCrownState?.scrollOffset ?? 0,
        frame: this.pecoCrownState?.frame ?? 0,
        staticFrame: this.pecoCrownState?.staticFrame ?? this.reducedMotion,
        broadColumns: PECO_CROWN.broadColumns,
        sideColumns: PECO_CROWN.sideColumns,
      },
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    // Instance attributes have their own WebGL buffers; geometry disposal does
    // not release them. Dispatch each mesh's disposal before dropping the room.
    this.root.traverse((object) => {
      if (object.isInstancedMesh) object.dispose();
    });
    this.root.removeFromParent();
    this.backdrop?.dispose();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
    this.geometries.clear();
    this.materials.clear();
    this.textures.clear();
    this.onAtmosphereEvent = null;
  }
}

export function createPhiladelphiaWritingRoom(options) {
  return new PhiladelphiaWritingRoom(options);
}

export {
  QUALITY_PROFILES,
  WEATHER_PRESETS,
  UNEASE_LEVELS,
  QUALITY_MODES,
} from './philadelphia-room-state.js';
