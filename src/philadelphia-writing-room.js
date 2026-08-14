import * as THREE from 'three';
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
  centerX: 4.4,
  centerY: 5.25,
  width: 5.2,
  height: 6.15,
  wallZ: -6.08,
  frameZ: -5.86,
  skyZ: -7.08,
});

const MAX_RAIN_STREAKS = QUALITY_PROFILES.high.rainStreaks;
const MAX_SNOW_FLAKES = QUALITY_PROFILES.high.snowFlakes;
const MAX_GLASS_DROPLETS = QUALITY_PROFILES.high.glassDroplets;

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
    this._buildLighting();

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
      color: 0xc4b598,
      roughness: 0.82,
      metalness: 0,
    }));
    this.radiatorMaterial = this._material(new THREE.MeshStandardMaterial({
      color: 0x625d54,
      roughness: 0.55,
      metalness: 0.62,
    }));
    this.brickMaterials = [0xa26145, 0x834936, 0x6e4336].map((color) => this._material(new THREE.MeshStandardMaterial({
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
    this.houseWindowMaterial = this._material(new THREE.MeshStandardMaterial({
      color: 0x927a5a,
      emissive: 0xffad62,
      emissiveIntensity: 0.5,
      roughness: 0.52,
    }));
    this.specialHouseWindowMaterial = this._material(this.houseWindowMaterial.clone());
    this.specialHouseWindowMaterial.color.set(0x746c5c);
    this.glassMaterial = this._material(new THREE.MeshPhysicalMaterial({
      color: 0xb8c9d3,
      roughness: 0.16,
      transmission: 0.16,
      transparent: true,
      opacity: 0.24,
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
        void main() {
          float lift = smoothstep(0.02, 0.88, vUv.y);
          vec3 color = mix(horizonColor, topColor, lift);
          float veil = cloud * (0.035 + 0.04 * sin(vUv.y * 17.0));
          gl_FragColor = vec4(mix(color, vec3(0.34, 0.39, 0.43), veil), 1.0);
        }
      `,
      depthWrite: false,
    }));
    const sky = this._mesh(
      new THREE.PlaneGeometry(WINDOW.width - 0.16, WINDOW.height - 0.16),
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
        this.silhouetteMaterial,
        { position: [x, y, WINDOW.skyZ + 0.03] },
      );
      block.receiveShadow = false;
      this.exterior.add(block);
    }

    const facades = [
      { x: 2.44, width: 1.34, height: 2.56, z: -6.84, material: this.brickMaterials[1] },
      { x: 3.83, width: 1.48, height: 3.06, z: -6.77, material: this.brickMaterials[0] },
      { x: 5.32, width: 1.46, height: 2.72, z: -6.72, material: this.brickMaterials[2] },
      { x: 6.56, width: 1.03, height: 2.92, z: -6.79, material: this.brickMaterials[0] },
    ];
    this.facades = [];
    this.snowCaps = [];
    let windowIndex = 0;
    for (let index = 0; index < facades.length; index += 1) {
      const facade = facades[index];
      const y = 2.15 + facade.height / 2;
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
        { position: [facade.x, 2.19 + facade.height, facade.z + 0.02] },
      );
      this.exterior.add(roof);

      const snowCapMaterial = this._material(this.snowMaterial.clone());
      snowCapMaterial.opacity = 0;
      this.snowCapMaterials.push(snowCapMaterial);
      const snowCap = this._mesh(
        new THREE.BoxGeometry(facade.width + 0.06, 0.035, 0.25),
        snowCapMaterial,
        { position: [facade.x, 2.27 + facade.height, facade.z + 0.035] },
      );
      this.exterior.add(snowCap);
      this.snowCaps.push(snowCap);

      const chimney = this._mesh(
        new THREE.BoxGeometry(0.18, 0.6 + (index % 2) * 0.14, 0.2),
        facade.material,
        { position: [facade.x - facade.width * 0.28, 2.48 + facade.height, facade.z - 0.01] },
      );
      this.exterior.add(chimney);

      const rows = facade.height > 2.9 ? 2 : 1;
      for (let row = 0; row < rows; row += 1) {
        for (const direction of [-1, 1]) {
          const material = windowIndex === 4 ? this.specialHouseWindowMaterial : this.houseWindowMaterial;
          const pane = this._mesh(
            new THREE.PlaneGeometry(Math.min(0.3, facade.width * 0.22), 0.44),
            material,
            {
              position: [
                facade.x + direction * facade.width * 0.24,
                2.72 + row * 0.86,
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
    const branches = new THREE.LineSegments(branchGeometry, this.wireMaterial);
    branches.name = 'BareRowhouseTree';
    this.exterior.add(branches);

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
  }

  _buildWindow() {
    const frame = new THREE.Group();
    frame.name = 'PaintedWoodSashWindow';
    const halfWidth = WINDOW.width / 2;
    const halfHeight = WINDOW.height / 2;
    const rail = 0.27;

    const frameParts = [
      [WINDOW.centerX - halfWidth, WINDOW.centerY, rail, WINDOW.height + rail],
      [WINDOW.centerX + halfWidth, WINDOW.centerY, rail, WINDOW.height + rail],
      [WINDOW.centerX, WINDOW.centerY - halfHeight, WINDOW.width + rail, rail],
      [WINDOW.centerX, WINDOW.centerY + halfHeight, WINDOW.width + rail, rail],
    ];
    for (const [x, y, width, height] of frameParts) {
      frame.add(this._mesh(
        new THREE.BoxGeometry(width, height, 0.28),
        this.windowWoodMaterial,
        { position: [x, y, WINDOW.frameZ] },
      ));
    }

    const sashParts = [
      [WINDOW.centerX, WINDOW.centerY, WINDOW.width - 0.18, 0.24],
      [WINDOW.centerX - WINDOW.width / 6, WINDOW.centerY + WINDOW.height / 4, 0.085, WINDOW.height / 2 - 0.25],
      [WINDOW.centerX + WINDOW.width / 6, WINDOW.centerY + WINDOW.height / 4, 0.085, WINDOW.height / 2 - 0.25],
      [WINDOW.centerX - WINDOW.width / 6, WINDOW.centerY - WINDOW.height / 4 + 0.12, 0.085, WINDOW.height / 2 - 0.42],
      [WINDOW.centerX + WINDOW.width / 6, WINDOW.centerY - WINDOW.height / 4 + 0.12, 0.085, WINDOW.height / 2 - 0.42],
      [WINDOW.centerX, WINDOW.centerY + WINDOW.height / 4, WINDOW.width - 0.35, 0.07],
      [WINDOW.centerX, WINDOW.centerY - WINDOW.height / 4 + 0.12, WINDOW.width - 0.35, 0.07],
    ];
    for (const [x, y, width, height] of sashParts) {
      frame.add(this._mesh(
        new THREE.BoxGeometry(width, height, 0.11),
        this.windowPaintMaterial,
        { position: [x, y, WINDOW.frameZ + 0.15] },
      ));
    }

    const glass = this._mesh(
      new THREE.PlaneGeometry(WINDOW.width - 0.34, WINDOW.height - 0.34),
      this.glassMaterial,
      { position: [WINDOW.centerX, WINDOW.centerY, WINDOW.frameZ + 0.09] },
    );
    glass.name = 'ImperfectWindowGlass';
    glass.receiveShadow = false;
    frame.add(glass);

    const sill = this._mesh(
      new THREE.BoxGeometry(WINDOW.width + 0.62, 0.22, 0.72),
      this.windowPaintMaterial,
      { position: [WINDOW.centerX, WINDOW.centerY - halfHeight - 0.11, WINDOW.frameZ + 0.26] },
    );
    sill.name = 'DeepWindowSill';
    frame.add(sill);

    this.sillSnowMaterial = this._material(this.snowMaterial.clone());
    this.sillSnowMaterial.opacity = 0;
    const sillSnow = this._mesh(
      new THREE.BoxGeometry(WINDOW.width - 0.12, 0.055, 0.28),
      this.sillSnowMaterial,
      { position: [WINDOW.centerX, WINDOW.centerY - halfHeight + 0.03, WINDOW.frameZ - 0.16] },
    );
    sillSnow.name = 'SillSnowAccumulation';
    frame.add(sillSnow);

    const frostStrips = [
      [WINDOW.centerX - halfWidth + 0.28, WINDOW.centerY, 0.18, WINDOW.height - 0.42],
      [WINDOW.centerX + halfWidth - 0.28, WINDOW.centerY, 0.18, WINDOW.height - 0.42],
      [WINDOW.centerX, WINDOW.centerY + halfHeight - 0.28, WINDOW.width - 0.45, 0.16],
    ];
    for (const [x, y, width, height] of frostStrips) {
      frame.add(this._mesh(
        new THREE.PlaneGeometry(width, height),
        this.frostMaterial,
        { position: [x, y, WINDOW.frameZ + 0.17] },
      ));
    }

    this.environment.add(frame);
  }

  _buildWeather() {
    this.rainPositions = new Float32Array(MAX_RAIN_STREAKS * 6);
    this.rainData = Array.from({ length: MAX_RAIN_STREAKS }, () => ({
      x: WINDOW.centerX + (this.rng() - 0.5) * (WINDOW.width - 0.42),
      y: WINDOW.centerY + (this.rng() - 0.5) * (WINDOW.height - 0.3),
      z: -6.78 + this.rng() * 0.62,
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
    this.weatherGroup.add(this.rain);

    this.snowPositions = new Float32Array(MAX_SNOW_FLAKES * 3);
    this.snowData = Array.from({ length: MAX_SNOW_FLAKES }, (_, index) => {
      const x = WINDOW.centerX + (this.rng() - 0.5) * (WINDOW.width - 0.32);
      const y = WINDOW.centerY + (this.rng() - 0.5) * (WINDOW.height - 0.24);
      const z = -6.82 + this.rng() * 0.72;
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
    this.weatherGroup.add(this.snow);

    this.dropletMaterial = this._material(new THREE.MeshPhysicalMaterial({
      color: 0xc4d3db,
      roughness: 0.09,
      transmission: 0.12,
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
    const dropletCount = Math.max(6, Math.round(profile.glassDroplets * motionScale));
    this.rainGeometry.setDrawRange(0, rainCount * 2);
    this.snowGeometry.setDrawRange(0, snowCount);
    this.droplets.count = dropletCount;
    this.activeRainCount = rainCount;
    this.activeSnowCount = snowCount;
    this.updateStride = this.reducedMotion ? Math.max(2, profile.updateStride) : profile.updateStride;

    // The animated typewriter owns hundreds of moving pieces. Low and medium
    // room tiers therefore keep the complete Philadelphia composition in one
    // unlit draw call while retaining live rain/snow in front of the glass.
    const simplifiedRoom = next !== 'high';
    if (this.backdropMesh) this.backdropMesh.visible = simplifiedRoom;
    this.environment.visible = !simplifiedRoom;
    this.exterior.visible = !simplifiedRoom;
    this.weatherGroup.position.z = simplifiedRoom ? 0.95 : 0;
    if (this.eveningAmbient) this.eveningAmbient.visible = !simplifiedRoom;
    if (this.windowFill) this.windowFill.visible = !simplifiedRoom;
    if (this.warmBounce) this.warmBounce.visible = !simplifiedRoom;
  }

  _applyAtmosphere() {
    const palette = computeEveningPalette(this.eveningProgress, this.brightness);
    setColor(this.skyMaterial.uniforms.topColor.value, palette.skyTop);
    setColor(this.skyMaterial.uniforms.horizonColor.value, palette.skyHorizon);
    setColor(this.windowFill.color, palette.windowFill);
    setColor(this.warmBounce.color, palette.warmBounce);

    const uneaseStrength = this.uneaseLevel === 'unsettling' ? 0.18 : this.uneaseLevel === 'subtle' ? 0.075 : 0;
    const lightDip = 1 - this.uneaseSignal * uneaseStrength;
    this.windowFill.intensity = palette.windowIntensity * lightDip;
    this.warmBounce.intensity = palette.warmIntensity * (1 - this.uneaseSignal * uneaseStrength * 0.35);
    this.eveningAmbient.intensity = palette.ambientIntensity * lightDip;
    this.houseWindowMaterial.emissiveIntensity = palette.houseWindowIntensity;
    this.specialHouseWindowMaterial.emissiveIntensity = palette.houseWindowIntensity * (1 - this.uneaseSignal * 0.92);

    this.skyMaterial.uniforms.cloud.value = this.weatherState.cloud;
    this.rainMaterial.opacity = this.weatherState.rain * 0.62;
    this.snowPointsMaterial.opacity = this.weatherState.snow * 0.9;
    this.dropletMaterial.opacity = this.weatherState.rain * 0.3;
    this.hazeMaterial.opacity = 0.018 + this.weatherState.cloud * 0.095;
    this.sillSnowMaterial.opacity = this.weatherState.snow * 0.86;
    for (const material of this.snowCapMaterials) material.opacity = this.weatherState.snow * 0.78;

    this.rain.visible = this.weatherState.rain > 0.008;
    this.snow.visible = this.weatherState.snow > 0.008;
    this.droplets.visible = this.weatherState.rain > 0.025;
    this.backdrop?.update({
      weather: this._backdropWeather(),
      brightness: this.brightness * lightDip,
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

  update(deltaSeconds, elapsedSeconds = null) {
    if (this.disposed) return;
    const rawDelta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    const delta = Math.min(rawDelta, 0.075);
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
    for (const key of ['rain', 'snow', 'wind', 'cloud']) {
      this.weatherState[key] = THREE.MathUtils.lerp(this.weatherState[key], targetWeather[key], weatherEase);
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
    this.particleAccumulator += delta;
    if (this.frame % this.updateStride === 0) {
      const particleDelta = this.particleAccumulator;
      this.particleAccumulator = 0;
      if (this.rain.visible) this._updateRain(particleDelta);
      if (this.snow.visible) this._updateSnow(particleDelta);
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
    if (immediate) this.weatherState = resolveWeatherTargets(this.weatherPreset, this.elapsed, this.seed);
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
    if (this.reducedMotion) this.uneaseSignal = 0;
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
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
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
