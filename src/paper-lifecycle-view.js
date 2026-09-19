import * as THREE from 'three';
import { flexPaperGeometry, paperPerimeterIndices } from './paper-flex.js';
import { makePaperFiberTexture } from './textures.js';
import { createPaperMaterial } from './paper-material.js';

const EPSILON = 1e-6;

export class PaperLifecycleViewError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'PaperLifecycleViewError';
    this.code = code;
  }
}

export function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

export function easeInOutCubic(value) {
  const t = clamp01(value);
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

export function deterministicUnit(seed, index = 0, channel = 0) {
  let value = (seed | 0)
    ^ Math.imul(index + 1, 0x9e3779b1)
    ^ Math.imul(channel + 17, 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff;
}

/**
 * Deterministic staged paper deformation. Early travel produces broad buckles,
 * the middle adds crossing creases, and the final stage compresses the page
 * into an irregular wad. It intentionally avoids unstable cloth simulation.
 */
export function computeCrumpledPoint({
  x,
  y,
  z = 0,
  index = 0,
  progress,
  seed,
  width,
  height,
}) {
  const amount = easeInOutCubic(progress);
  if (amount <= EPSILON) return { x, y, z };

  const nx = x / Math.max(width * 0.5, EPSILON);
  const ny = y / Math.max(height * 0.5, EPSILON);
  const phaseA = deterministicUnit(seed, 0, 0) * Math.PI * 2;
  const phaseB = deterministicUnit(seed, 0, 1) * Math.PI * 2;
  // Spatially coherent folds avoid the spiky per-vertex noise of a shattered mesh.
  const noiseA = Math.sin(nx * 3.2 + ny * 1.4 + phaseA);
  const noiseB = Math.cos(ny * 3.8 - nx * 1.1 + phaseB);
  const noiseC = Math.sin(nx * 5.1 - ny * 4.4 + phaseA + phaseB);
  const buckle = clamp01(amount / 0.34);
  const folding = clamp01((amount - 0.16) / 0.54);
  const compression = easeInOutCubic(clamp01((amount - 0.52) / 0.48));
  const minimumDimension = Math.min(width, height);

  const broadWave = (
    Math.sin(nx * Math.PI * 2.1 + noiseA * 1.4)
    + Math.cos(ny * Math.PI * 2.7 + noiseB * 1.2)
  ) * minimumDimension * 0.035 * buckle;
  const diagonalCrease = Math.sin((nx * 1.35 + ny * 0.9 + noiseC * 0.18) * Math.PI * 4.2);
  const crossingCrease = Math.sin((nx * 0.72 - ny * 1.48 + noiseA * 0.15) * Math.PI * 3.6);
  const creaseDepth = (diagonalCrease + crossingCrease * 0.72)
    * minimumDimension * 0.047 * folding;

  const foldedX = x * (1 - folding * 0.3)
    + Math.sin(ny * Math.PI * 2.4 + noiseA) * minimumDimension * 0.04 * folding;
  const foldedY = y * (1 - folding * 0.34)
    + Math.sin(nx * Math.PI * 2.1 + noiseB) * minimumDimension * 0.04 * folding;
  const foldedZ = z + broadWave + creaseDepth + noiseC * minimumDimension * 0.018 * folding;

  const azimuth = (nx * 1.7 + noiseA * 0.48) * Math.PI;
  const polar = clamp01((ny + 1) * 0.5 + noiseB * 0.09) * Math.PI;
  const radius = minimumDimension * (0.075 + (0.5 + 0.5 * Math.sin(nx * 6.2 + ny * 4.1 + phaseB)) * 0.038);
  const wadX = Math.cos(azimuth) * Math.sin(polar) * radius;
  const wadY = Math.cos(polar) * radius * 0.92;
  const wadZ = Math.sin(azimuth) * Math.sin(polar) * radius + noiseC * radius * 0.32;

  return {
    x: THREE.MathUtils.lerp(foldedX, wadX, compression),
    y: THREE.MathUtils.lerp(foldedY, wadY, compression),
    z: THREE.MathUtils.lerp(foldedZ, wadZ, compression),
  };
}

export function sampleThrowArc(from, to, progress, options = {}) {
  const t = clamp01(progress);
  const seed = options.seed ?? 1;
  const height = options.height ?? 2;
  const wobble = options.wobble ?? 0.14;
  const envelope = Math.sin(Math.PI * t);
  const side = deterministicUnit(seed, 0, 8) * 2 - 1;
  const depth = deterministicUnit(seed, 0, 9) * 2 - 1;
  return {
    x: THREE.MathUtils.lerp(from.x, to.x, t) + envelope * wobble * side,
    y: THREE.MathUtils.lerp(from.y, to.y, t) + 4 * height * t * (1 - t),
    z: THREE.MathUtils.lerp(from.z, to.z, t) + envelope * wobble * depth,
  };
}

function asVector3(value, fallback) {
  if (value?.isVector3) return value.clone();
  if (Array.isArray(value)) return new THREE.Vector3(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0);
  if (value && typeof value === 'object') return new THREE.Vector3(value.x ?? 0, value.y ?? 0, value.z ?? 0);
  return fallback.clone();
}

function asQuaternion(value, fallbackEuler) {
  if (value?.isQuaternion) return value.clone();
  if (value?.isEuler) return new THREE.Quaternion().setFromEuler(value);
  const angles = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? [value.x ?? 0, value.y ?? 0, value.z ?? 0]
      : fallbackEuler;
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(angles[0], angles[1], angles[2], 'XYZ'));
}

function textureFromMesh(mesh) {
  if (!mesh?.material) return null;
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return materials.find((material) => material?.map)?.map ?? null;
}

function cloneTexture(source) {
  if (!source?.isTexture) return null;
  const cloned = source.clone();
  cloned.needsUpdate = true;
  return cloned;
}

function setTarget(object, target) {
  object.userData.paperLifecycleTarget = target;
  return object;
}

function sampleSourcePosition(sourceGeometry, u, v, target) {
  const positions = sourceGeometry?.attributes?.position;
  const uvs = sourceGeometry?.attributes?.uv;
  if (!positions) return target.set(0, 0, 0);

  const widthSegments = sourceGeometry.parameters?.widthSegments;
  const heightSegments = sourceGeometry.parameters?.heightSegments;
  if (Number.isSafeInteger(widthSegments) && Number.isSafeInteger(heightSegments)) {
    const xIndex = Math.round(clamp01(u) * widthSegments);
    const yIndex = Math.round((1 - clamp01(v)) * heightSegments);
    return target.fromBufferAttribute(positions, yIndex * (widthSegments + 1) + xIndex);
  }

  if (!uvs) return target.fromBufferAttribute(positions, 0);
  let nearest = 0;
  let nearestDistance = Infinity;
  for (let index = 0; index < uvs.count; index += 1) {
    const dx = uvs.getX(index) - u;
    const dy = uvs.getY(index) - v;
    const distance = dx * dx + dy * dy;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = index;
    }
  }
  return target.fromBufferAttribute(positions, nearest);
}

function disposeObject(object) {
  object.traverse((child) => {
    child.geometry?.dispose?.();
    const materials = Array.isArray(child.material) ? child.material : child.material ? [child.material] : [];
    for (const material of materials) {
      if (material.userData?.ownsMap) material.map?.dispose?.();
      if (material.userData?.ownsBumpMap) material.bumpMap?.dispose?.();
      material.dispose?.();
    }
  });
}

function applyPositions(geometry, basePositions, progress, seed, width, height) {
  const attribute = geometry.attributes.position;
  for (let index = 0; index < attribute.count; index += 1) {
    const source = index * 3;
    const point = computeCrumpledPoint({
      x: basePositions[source],
      y: basePositions[source + 1],
      z: basePositions[source + 2],
      index,
      progress,
      seed,
      width,
      height,
    });
    attribute.setXYZ(index, point.x, point.y, point.z);
  }
  attribute.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
}

function interpolatePositions(geometry, from, to, progress) {
  const attribute = geometry.attributes.position;
  for (let index = 0; index < attribute.array.length; index += 1) {
    attribute.array[index] = THREE.MathUtils.lerp(from[index], to[index], progress);
  }
  attribute.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
}

function sampleGeometryPositions(sourceGeometry, targetGeometry) {
  const sampledPositions = targetGeometry.attributes.position.array.slice();
  const uvs = targetGeometry.attributes.uv;
  const sampled = new THREE.Vector3();
  for (let index = 0; index < uvs.count; index += 1) {
    sampleSourcePosition(sourceGeometry, uvs.getX(index), uvs.getY(index), sampled);
    const offset = index * 3;
    sampledPositions[offset] = sampled.x;
    sampledPositions[offset + 1] = sampled.y;
    sampledPositions[offset + 2] = sampled.z;
  }
  return sampledPositions;
}

export class PaperLifecycleView {
  constructor(options = {}) {
    if (!options.parent?.isObject3D) {
      throw new PaperLifecycleViewError('missing-parent', 'PaperLifecycleView requires a Three.js parent object');
    }

    this.parent = options.parent;
    this.reducedMotion = options.reducedMotion ?? globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.root = new THREE.Group();
    this.root.name = 'PaperLifecycleView';
    this.parent.add(this.root);
    this.paperWidth = options.paperWidth ?? 5.8;
    this.paperHeight = options.paperHeight ?? 7.505;
    this.segmentsX = options.segmentsX ?? 18;
    this.segmentsY = options.segmentsY ?? 24;
    this.maxStackLayers = Math.max(1, Math.floor(options.maxStackLayers ?? 22));
    this.maxVisibleDiscards = Math.max(1, Math.floor(options.maxVisibleDiscards ?? 14));
    this.onEvent = options.onEvent ?? (() => {});
    this.getMachinePaperMesh = options.getMachinePaperMesh ?? (() => null);
    this.setMachinePaperVisible = options.setMachinePaperVisible ?? null;
    this.disposed = false;
    this.phase = 'idle';
    this.motion = null;
    this.activePage = null;
    this.loadingMesh = null;
    this.sourcePaperMesh = null;
    this.manuscriptCount = 0;
    this.manuscriptTopMesh = null;
    this.discardVisuals = new Map();

    this.inspectionPosition = asVector3(options.inspectionPosition, new THREE.Vector3(0, 4.25, 2.7));
    this.inspectionQuaternion = asQuaternion(options.inspectionRotation, [-0.08, 0, 0]);
    this.inspectionScale = asVector3(options.inspectionScale, new THREE.Vector3(0.72, 0.72, 0.72));
    this.freshSheetPosition = asVector3(options.freshSheetPosition, new THREE.Vector3(5.35, 0.42, 1.2));
    this.freshSheetQuaternion = asQuaternion(options.freshSheetRotation, [-Math.PI / 2, 0, -0.03]);
    this.freshFeedPosition = asVector3(options.freshFeedPosition, new THREE.Vector3(0, 3.38, -0.76));
    this.freshFeedQuaternion = asQuaternion(options.freshFeedRotation, [0, 0, 0]);
    this.manuscriptPosition = asVector3(options.manuscriptPosition, new THREE.Vector3(-5.15, 0.2, 0.8));
    this.manuscriptScale = options.manuscriptScale ?? 0.72;
    this.wastebasketPosition = asVector3(options.wastebasketPosition, new THREE.Vector3(5.2, 0.02, 1.0));
    this.wastebasketRadius = options.wastebasketRadius ?? 1.0;
    this.wastebasketHeight = options.wastebasketHeight ?? 1.7;

    this.buildManuscriptTray(options);
    this.buildWastebasket(options);
  }

  emit(type, detail = {}) {
    this.onEvent({ type, phase: this.phase, ...detail });
  }

  assertAvailable(allowedPhases) {
    if (this.disposed) throw new PaperLifecycleViewError('disposed', 'PaperLifecycleView has been disposed');
    if (!allowedPhases.includes(this.phase) || this.motion) {
      throw new PaperLifecycleViewError('busy', `Paper ritual is ${this.phase}; this action is not available`);
    }
  }

  buildManuscriptTray(options) {
    this.manuscriptGroup = new THREE.Group();
    this.manuscriptGroup.name = 'ManuscriptTray';
    this.manuscriptGroup.position.copy(this.manuscriptPosition);
    this.manuscriptGroup.scale.setScalar(this.manuscriptScale);
    this.root.add(this.manuscriptGroup);

    const wood = new THREE.MeshStandardMaterial({
      color: options.trayColor ?? 0x4b2a18,
      roughness: 0.72,
      metalness: 0.02,
    });
    const paperEdge = new THREE.MeshStandardMaterial({
      color: options.paperEdgeColor ?? 0xd8ccb3,
      roughness: 0.96,
      metalness: 0,
    });
    const base = setTarget(
      new THREE.Mesh(new THREE.BoxGeometry(this.paperWidth + 0.5, 0.12, this.paperHeight + 0.55), wood),
      { kind: 'manuscript-tray', action: 'browse-manuscript' },
    );
    base.position.y = 0.02;
    base.receiveShadow = true;
    this.manuscriptGroup.add(base);
    this.trayTarget = base;

    const railGeometry = new THREE.BoxGeometry(0.15, 0.34, this.paperHeight + 0.55);
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(railGeometry, wood);
      rail.position.set(side * (this.paperWidth * 0.5 + 0.2), 0.2, 0);
      this.manuscriptGroup.add(rail);
    }
    const rearRail = new THREE.Mesh(new THREE.BoxGeometry(this.paperWidth + 0.5, 0.34, 0.15), wood);
    rearRail.position.set(0, 0.2, -this.paperHeight * 0.5 - 0.2);
    this.manuscriptGroup.add(rearRail);

    this.stackLayers = new THREE.InstancedMesh(
      new THREE.BoxGeometry(this.paperWidth, 0.018, this.paperHeight),
      paperEdge,
      this.maxStackLayers,
    );
    this.stackLayers.name = 'VisibleManuscriptStack';
    this.stackLayers.count = 0;
    this.stackLayers.castShadow = true;
    this.stackLayers.receiveShadow = true;
    this.manuscriptGroup.add(this.stackLayers);
  }

  buildWastebasket(options) {
    this.wastebasketGroup = new THREE.Group();
    this.wastebasketGroup.name = 'Wastebasket';
    this.wastebasketGroup.position.copy(this.wastebasketPosition);
    this.root.add(this.wastebasketGroup);

    const wicker = new THREE.MeshStandardMaterial({
      color: options.wastebasketColor ?? 0x7a4b27,
      roughness: 0.84,
      metalness: 0,
      wireframe: true,
    });
    const basket = setTarget(
      new THREE.Mesh(
        new THREE.CylinderGeometry(
          this.wastebasketRadius,
          this.wastebasketRadius * 0.72,
          this.wastebasketHeight,
          14,
          4,
          true,
        ),
        wicker,
      ),
      { kind: 'wastebasket', action: 'browse-discards' },
    );
    basket.position.y = this.wastebasketHeight * 0.5;
    basket.castShadow = true;
    this.wastebasketGroup.add(basket);
    this.wastebasketTarget = basket;

    const rimMaterial = new THREE.MeshStandardMaterial({ color: 0x6a3e20, roughness: 0.76 });
    const rim = setTarget(
      new THREE.Mesh(new THREE.TorusGeometry(this.wastebasketRadius, 0.055, 8, 28), rimMaterial),
      { kind: 'wastebasket', action: 'browse-discards' },
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = this.wastebasketHeight;
    this.wastebasketGroup.add(rim);
  }

  makePageMesh({ texture = null, sourceMesh = null } = {}) {
    const geometry = new THREE.PlaneGeometry(
      this.paperWidth,
      this.paperHeight,
      this.segmentsX,
      this.segmentsY,
    );
    const flatPositions = geometry.attributes.position.array.slice();
    let sourcePositions = flatPositions.slice();
    if (sourceMesh?.geometry) {
      sourcePositions = sampleGeometryPositions(sourceMesh.geometry, geometry);
      geometry.attributes.position.array.set(sourcePositions);
      geometry.attributes.position.needsUpdate = true;
      geometry.computeVertexNormals();
    }

    const ownedTexture = cloneTexture(texture ?? textureFromMesh(sourceMesh));
    const material = createPaperMaterial({
      color: 0xfff4dc,
      map: ownedTexture,
      emissive: 0xffffff,
      emissiveMap: ownedTexture,
      emissiveIntensity: 0.09,
      bumpMap: makePaperFiberTexture(),
      bumpScale: 0.009,
      roughness: 0.93,
      metalness: 0,
      side: THREE.DoubleSide,
      transparent: true,
    });
    material.userData.ownsMap = Boolean(ownedTexture);
    material.userData.ownsBumpMap = true;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'LifecyclePaper';
    // A narrow perimeter ribbon follows the deformed sheet, giving the edge
    // physical thickness without duplicating its document texture.
    const perimeter = paperPerimeterIndices(this.segmentsX, this.segmentsY);
    const edgeGeometry = new THREE.BufferGeometry();
    const edgePositions = new THREE.Float32BufferAttribute(perimeter.length * 6, 3);
    edgeGeometry.setAttribute('position', edgePositions);
    const indices = [];
    for (let i = 0; i < perimeter.length; i += 1) {
      const a = i * 2;
      const b = ((i + 1) % perimeter.length) * 2;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
    edgeGeometry.setIndex(indices);
    const edge = new THREE.Mesh(edgeGeometry, new THREE.MeshStandardMaterial({
      color: 0xd8ccb3, roughness: 0.98, side: THREE.DoubleSide, transparent: true,
    }));
    edge.name = 'PaperThinEdge';
    edge.frustumCulled = false;
    let edgeVersion = -1;
    edge.onBeforeRender = () => {
      edge.material.opacity = material.opacity;
      const position = geometry.attributes.position;
      if (edgeVersion === position.version) return;
      edgeVersion = position.version;
      const normal = geometry.attributes.normal;
      perimeter.forEach((vertex, index) => {
        for (let side = 0; side < 2; side += 1) {
          const thickness = side === 0 ? 0.0025 : -0.0025;
          edgePositions.setXYZ(index * 2 + side,
            position.getX(vertex) + normal.getX(vertex) * thickness,
            position.getY(vertex) + normal.getY(vertex) * thickness,
            position.getZ(vertex) + normal.getZ(vertex) * thickness);
        }
      });
      edgePositions.needsUpdate = true;
      edgeGeometry.computeVertexNormals();
    };
    mesh.add(edge);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.flatPositions = flatPositions;
    mesh.userData.sourcePositions = sourcePositions;
    const relaxedGeometry = geometry.clone();
    flexPaperGeometry(relaxedGeometry, flatPositions, this.paperWidth, this.paperHeight);
    mesh.userData.relaxedPositions = relaxedGeometry.attributes.position.array.slice();
    relaxedGeometry.dispose();
    return mesh;
  }

  copyWorldPoseToRoot(source, target) {
    source.updateWorldMatrix(true, false);
    this.root.updateWorldMatrix(true, false);
    const localMatrix = new THREE.Matrix4()
      .copy(this.root.matrixWorld)
      .invert()
      .multiply(source.matrixWorld);
    localMatrix.decompose(target.position, target.quaternion, target.scale);
  }

  setSourceVisible(visible, mesh = this.sourcePaperMesh ?? this.getMachinePaperMesh()) {
    if (this.setMachinePaperVisible) this.setMachinePaperVisible(visible, mesh);
    else if (mesh) mesh.visible = visible;
  }

  beginMotion(kind, duration, onUpdate, onComplete) {
    return new Promise((resolve, reject) => {
      this.motion = {
        kind,
        duration: this.reducedMotion ? 0.01 : Math.max(0.01, duration),
        elapsed: 0,
        onUpdate,
        onComplete,
        resolve,
        reject,
      };
    });
  }

  extract(options = {}) {
    this.assertAvailable(['idle']);
    const sourceMesh = options.sourceMesh ?? this.getMachinePaperMesh();
    if (!sourceMesh?.isMesh) {
      throw new PaperLifecycleViewError('missing-source-paper', 'Extraction requires the machine paper mesh');
    }
    if (typeof options.pageId !== 'string' || !options.pageId) {
      throw new PaperLifecycleViewError('missing-page-id', 'Extraction requires a page id');
    }

    const mesh = this.makePageMesh({ texture: options.texture, sourceMesh });
    this.copyWorldPoseToRoot(sourceMesh, mesh);
    setTarget(mesh, { kind: 'loose-page', action: 'inspect-page', pageId: options.pageId });
    this.root.add(mesh);
    this.sourcePaperMesh = sourceMesh;
    this.setSourceVisible(false, sourceMesh);
    this.activePage = { pageId: options.pageId, mesh, crumpleProgress: 0, seed: null };
    this.phase = 'extracting';
    this.emit('extraction-start', { pageId: options.pageId });

    const startPosition = mesh.position.clone();
    const startQuaternion = mesh.quaternion.clone();
    const startScale = mesh.scale.clone();
    const sourcePositions = mesh.userData.sourcePositions;
    const flatPositions = mesh.userData.relaxedPositions;
    const handlingPositions = new Float32Array(flatPositions.length);
    return this.beginMotion('extract', options.duration ?? 0.72, (linear) => {
      const eased = easeInOutCubic(linear);
      mesh.position.lerpVectors(startPosition, this.inspectionPosition, eased);
      mesh.quaternion.slerpQuaternions(startQuaternion, this.inspectionQuaternion, eased);
      mesh.scale.lerpVectors(startScale, this.inspectionScale, eased);
      for (let i = 0; i < handlingPositions.length; i += 1) handlingPositions[i] = THREE.MathUtils.lerp(sourcePositions[i], flatPositions[i], eased);
      flexPaperGeometry(mesh.geometry, handlingPositions, this.paperWidth, this.paperHeight, { curl: 0, impulse: 0.5, progress: linear, reducedMotion: this.reducedMotion });
    }, () => {
      this.phase = 'inspecting';
      this.emit('inspection-ready', { pageId: options.pageId });
      return { pageId: options.pageId, mesh };
    });
  }

  crumple(options = {}) {
    this.assertAvailable(['inspecting']);
    const active = this.activePage;
    const seed = options.seed ?? 1;
    if (!Number.isSafeInteger(seed) || seed < 0) {
      throw new PaperLifecycleViewError('invalid-seed', 'Crumple seed must be a non-negative integer');
    }
    active.seed = seed;
    const startQuaternion = active.mesh.quaternion.clone();
    const targetQuaternion = startQuaternion.clone().multiply(
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, 1),
        (deterministicUnit(seed, 0, 11) * 2 - 1) * 0.16,
      ),
    );
    this.phase = 'crumpling';
    this.emit('crumple-start', { pageId: active.pageId, seed });
    return this.beginMotion('crumple', options.duration ?? 0.82, (linear) => {
      const progress = easeInOutCubic(linear);
      active.crumpleProgress = progress;
      applyPositions(
        active.mesh.geometry,
        active.mesh.userData.relaxedPositions,
        progress,
        seed,
        this.paperWidth,
        this.paperHeight,
      );
      active.mesh.quaternion.slerpQuaternions(startQuaternion, targetQuaternion, progress);
    }, () => {
      active.crumpleProgress = 1;
      this.phase = 'crumpled';
      this.emit('crumple-complete', { pageId: active.pageId, seed });
      return { pageId: active.pageId, seed };
    });
  }

  discardLanding(seed, index, landing) {
    if (landing?.position) return asVector3(landing.position, this.wastebasketPosition);
    const side = deterministicUnit(seed, index, 20) * 2 - 1;
    const depth = deterministicUnit(seed, index, 21) * 2 - 1;
    if (landing?.location === 'floor') {
      return this.wastebasketPosition.clone().add(new THREE.Vector3(
        side * this.wastebasketRadius * 1.8,
        0.12,
        depth * this.wastebasketRadius * 1.8,
      ));
    }
    return this.wastebasketPosition.clone().add(new THREE.Vector3(
      side * this.wastebasketRadius * 0.38,
      this.wastebasketHeight * (0.68 + deterministicUnit(seed, index, 22) * 0.14),
      depth * this.wastebasketRadius * 0.38,
    ));
  }

  enforceDiscardVisualLimit() {
    while (this.discardVisuals.size >= this.maxVisibleDiscards) {
      const [oldestId, oldestMesh] = this.discardVisuals.entries().next().value;
      this.discardVisuals.delete(oldestId);
      this.root.remove(oldestMesh);
      disposeObject(oldestMesh);
    }
  }

  throwToWastebasket(options = {}) {
    this.assertAvailable(['crumpled']);
    const active = this.activePage;
    if (options.pageId && options.pageId !== active.pageId) {
      throw new PaperLifecycleViewError('page-mismatch', 'The active crumpled page does not match the discarded page');
    }
    const seed = options.seed ?? active.seed ?? 1;
    const target = this.discardLanding(seed, this.discardVisuals.size, options.landing);
    const start = active.mesh.position.clone();
    const startQuaternion = active.mesh.quaternion.clone();
    const spinAxis = new THREE.Vector3(
      deterministicUnit(seed, 0, 30) - 0.5,
      deterministicUnit(seed, 0, 31) + 0.25,
      deterministicUnit(seed, 0, 32) - 0.5,
    ).normalize();
    const spinAngle = Math.PI * (3.5 + deterministicUnit(seed, 0, 33) * 2);
    this.phase = 'throwing';
    this.emit('throw-start', { pageId: active.pageId, seed, landing: options.landing ?? null });

    return this.beginMotion('throw', options.duration ?? 0.78, (linear) => {
      const point = sampleThrowArc(start, target, easeInOutCubic(linear), {
        seed,
        height: options.arcHeight ?? 1.85,
        wobble: options.wobble ?? 0.16,
      });
      active.mesh.position.set(point.x, point.y, point.z);
      active.mesh.quaternion.copy(startQuaternion).multiply(
        new THREE.Quaternion().setFromAxisAngle(spinAxis, spinAngle * linear),
      );
    }, () => {
      this.enforceDiscardVisualLimit();
      setTarget(active.mesh, {
        kind: 'discarded-page',
        action: 'recover-page',
        pageId: active.pageId,
      });
      this.discardVisuals.set(active.pageId, active.mesh);
      this.activePage = null;
      this.phase = 'idle';
      this.emit('discard-landed', { pageId: active.pageId, seed, landing: options.landing ?? null });
      return { pageId: active.pageId, mesh: active.mesh };
    });
  }

  updateStackLayers(count) {
    this.manuscriptCount = Math.max(0, count);
    const visible = Math.min(this.maxStackLayers, this.manuscriptCount);
    this.stackLayers.count = visible;
    const transform = new THREE.Object3D();
    for (let index = 0; index < visible; index += 1) {
      const representedIndex = Math.max(0, this.manuscriptCount - visible + index);
      const jitter = deterministicUnit(this.manuscriptCount, representedIndex, 50) - 0.5;
      transform.position.set(jitter * 0.045, 0.1 + index * 0.021, -jitter * 0.035);
      transform.rotation.set(0, jitter * 0.012, 0);
      transform.scale.set(1, 1, 1);
      transform.updateMatrix();
      this.stackLayers.setMatrixAt(index, transform.matrix);
    }
    this.stackLayers.instanceMatrix.needsUpdate = true;
  }

  manuscriptTopPose(count = this.manuscriptCount) {
    this.manuscriptGroup.updateWorldMatrix(true, false);
    this.root.updateWorldMatrix(true, false);
    const visible = Math.min(this.maxStackLayers, Math.max(0, count));
    const worldPosition = this.manuscriptGroup.localToWorld(
      new THREE.Vector3(0, 0.12 + visible * 0.021, 0),
    );
    const localPosition = this.root.worldToLocal(worldPosition);
    const groupWorldQuaternion = this.manuscriptGroup.getWorldQuaternion(new THREE.Quaternion());
    const rootWorldQuaternion = this.root.getWorldQuaternion(new THREE.Quaternion());
    const localQuaternion = rootWorldQuaternion.invert()
      .multiply(groupWorldQuaternion)
      .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)));
    return {
      position: localPosition,
      quaternion: localQuaternion,
      scale: new THREE.Vector3().setScalar(this.manuscriptScale),
    };
  }

  replaceManuscriptTop(mesh, pageId) {
    if (this.manuscriptTopMesh && this.manuscriptTopMesh !== mesh) {
      this.root.remove(this.manuscriptTopMesh);
      disposeObject(this.manuscriptTopMesh);
    }
    this.manuscriptTopMesh = mesh;
    if (!mesh) return;
    setTarget(mesh, { kind: 'manuscript-page', action: 'browse-manuscript', pageId });
  }

  fileToManuscript(options = {}) {
    this.assertAvailable(['inspecting']);
    const active = this.activePage;
    if (options.pageId && options.pageId !== active.pageId) {
      throw new PaperLifecycleViewError('page-mismatch', 'The active page does not match the filed page');
    }
    const finalCount = options.totalCount ?? this.manuscriptCount + 1;
    const target = this.manuscriptTopPose(finalCount);
    const filingPositions = active.mesh.geometry.attributes.position.array.slice();
    const startPosition = active.mesh.position.clone();
    const startQuaternion = active.mesh.quaternion.clone();
    const startScale = active.mesh.scale.clone();
    this.phase = 'filing';
    this.emit('file-start', { pageId: active.pageId, totalCount: finalCount });

    return this.beginMotion('file', options.duration ?? 0.72, (linear) => {
      const eased = easeInOutCubic(clamp01(linear / 0.87));
      const point = sampleThrowArc(startPosition, target.position, eased, {
        seed: options.seed ?? active.pageId.length,
        height: options.arcHeight ?? 0.38,
        wobble: 0.025,
      });
      active.mesh.position.set(point.x, point.y, point.z);
      active.mesh.quaternion.slerpQuaternions(startQuaternion, target.quaternion, eased);
      active.mesh.scale.lerpVectors(startScale, target.scale, eased);
      const settle = clamp01((linear - 0.78) / 0.22);
      interpolatePositions(active.mesh.geometry, filingPositions, active.mesh.userData.flatPositions, eased);
      const base = active.mesh.geometry.attributes.position.array.slice();
      flexPaperGeometry(active.mesh.geometry, base, this.paperWidth, this.paperHeight, { curl: 0, impulse: 0.65 * (1 - settle), progress: linear, reducedMotion: this.reducedMotion });
    }, () => {
      this.updateStackLayers(finalCount);
      this.replaceManuscriptTop(active.mesh, active.pageId);
      this.activePage = null;
      this.phase = 'idle';
      this.emit('manuscript-filed', { pageId: active.pageId, totalCount: finalCount });
      return { pageId: active.pageId, totalCount: finalCount, mesh: active.mesh };
    });
  }

  recoverDiscard(options = {}) {
    this.assertAvailable(['idle']);
    if (typeof options.pageId !== 'string' || !options.pageId) {
      throw new PaperLifecycleViewError('missing-page-id', 'Recovery requires a page id');
    }
    const seed = options.seed ?? 1;
    let mesh = this.discardVisuals.get(options.pageId);
    if (mesh) this.discardVisuals.delete(options.pageId);
    else {
      mesh = this.makePageMesh({ texture: options.texture });
      applyPositions(
        mesh.geometry,
        mesh.userData.flatPositions,
        1,
        seed,
        this.paperWidth,
        this.paperHeight,
      );
      mesh.position.copy(this.discardLanding(seed, this.discardVisuals.size, options.landing));
      this.root.add(mesh);
    }

    setTarget(mesh, { kind: 'loose-page', action: 'inspect-page', pageId: options.pageId });
    this.activePage = { pageId: options.pageId, mesh, crumpleProgress: 1, seed };
    const startPosition = mesh.position.clone();
    const startQuaternion = mesh.quaternion.clone();
    const startScale = mesh.scale.clone();
    this.phase = 'recovering';
    this.emit('recover-start', { pageId: options.pageId });
    return this.beginMotion('recover', options.duration ?? 0.88, (linear) => {
      const eased = easeInOutCubic(linear);
      const point = sampleThrowArc(startPosition, this.inspectionPosition, eased, {
        seed,
        height: options.arcHeight ?? 0.62,
        wobble: 0.05,
      });
      mesh.position.set(point.x, point.y, point.z);
      mesh.quaternion.slerpQuaternions(startQuaternion, this.inspectionQuaternion, eased);
      mesh.scale.lerpVectors(startScale, this.inspectionScale, eased);
      applyPositions(
        mesh.geometry,
        mesh.userData.relaxedPositions,
        1 - eased,
        seed,
        this.paperWidth,
        this.paperHeight,
      );
    }, () => {
      this.activePage.crumpleProgress = 0;
      this.phase = 'inspecting';
      this.emit('recover-complete', { pageId: options.pageId });
      return { pageId: options.pageId, mesh };
    });
  }

  /**
   * Visually returns a durable loose->inserted state transition to the platen.
   * The caller must commit PaperLifecycle.reinsertLooseSheet() before invoking
   * this method. At reinsert-attach, main may swap the machine document and
   * renderer; the source sheet is revealed only after that callback returns.
   */
  reinsert(options = {}) {
    this.assertAvailable(['inspecting']);
    const active = this.activePage;
    if (typeof options.pageId !== 'string' || !options.pageId) {
      throw new PaperLifecycleViewError('missing-page-id', 'Reinsertion requires a page id');
    }
    if (options.pageId !== active.pageId) {
      throw new PaperLifecycleViewError('page-mismatch', 'The active loose page does not match the reinserted page');
    }
    let sourceMesh = options.sourceMesh ?? this.getMachinePaperMesh();
    if (!sourceMesh?.isMesh) {
      throw new PaperLifecycleViewError('missing-source-paper', 'Reinsertion requires the machine paper mesh');
    }

    const mesh = active.mesh;
    const startPosition = mesh.position.clone();
    const startQuaternion = mesh.quaternion.clone();
    const startScale = mesh.scale.clone();
    const startPositions = mesh.geometry.attributes.position.array.slice();
    const targetObject = new THREE.Object3D();
    this.copyWorldPoseToRoot(sourceMesh, targetObject);
    let targetPosition = targetObject.position.clone();
    let targetQuaternion = targetObject.quaternion.clone();
    let targetScale = targetObject.scale.clone();
    let targetPositions = sampleGeometryPositions(sourceMesh.geometry, mesh.geometry);
    const attachAt = clamp01(options.attachAt ?? 0.74);
    let attached = false;
    let handoffTexture = null;
    let textureTaken = false;

    this.phase = 'reinserting';
    this.emit('reinsert-start', { pageId: active.pageId });
    return this.beginMotion('reinsert', options.duration ?? 0.82, (linear) => {
      const eased = easeInOutCubic(linear);
      mesh.position.lerpVectors(startPosition, targetPosition, eased);
      mesh.quaternion.slerpQuaternions(startQuaternion, targetQuaternion, eased);
      mesh.scale.lerpVectors(startScale, targetScale, eased);
      interpolatePositions(mesh.geometry, startPositions, targetPositions, eased);

      if (!attached && linear >= attachAt) {
        attached = true;
        handoffTexture = cloneTexture(mesh.material.map);
        this.emit('reinsert-attach', {
          pageId: active.pageId,
          sourceMesh,
          texture: handoffTexture,
          takeTexture: () => {
            textureTaken = true;
            return handoffTexture;
          },
        });

        // The attach callback may update the model document, deform the source
        // paper, or replace the source mesh. Sample that final state before the
        // visual clone disappears so the handoff remains spatially continuous.
        sourceMesh = this.getMachinePaperMesh() ?? sourceMesh;
        this.copyWorldPoseToRoot(sourceMesh, targetObject);
        targetPosition = targetObject.position.clone();
        targetQuaternion = targetObject.quaternion.clone();
        targetScale = targetObject.scale.clone();
        targetPositions = sampleGeometryPositions(sourceMesh.geometry, mesh.geometry);
        this.sourcePaperMesh = sourceMesh;
        this.setSourceVisible(true, sourceMesh);
      }

      if (attached) {
        mesh.material.opacity = 1 - clamp01((linear - attachAt) / Math.max(1 - attachAt, EPSILON));
      }
    }, () => {
      if (!attached) {
        handoffTexture = cloneTexture(mesh.material.map);
        this.emit('reinsert-attach', {
          pageId: active.pageId,
          sourceMesh,
          texture: handoffTexture,
          takeTexture: () => {
            textureTaken = true;
            return handoffTexture;
          },
        });
        sourceMesh = this.getMachinePaperMesh() ?? sourceMesh;
        this.sourcePaperMesh = sourceMesh;
        this.setSourceVisible(true, sourceMesh);
      }
      if (handoffTexture && !textureTaken) handoffTexture.dispose();
      this.root.remove(mesh);
      disposeObject(mesh);
      this.activePage = null;
      this.phase = 'idle';
      this.emit('reinsert-complete', { pageId: options.pageId });
      return { pageId: options.pageId, sourceMesh };
    });
  }

  loadFreshSheet(options = {}) {
    this.assertAvailable(['idle']);
    if (typeof options.pageId !== 'string' || !options.pageId) {
      throw new PaperLifecycleViewError('missing-page-id', 'Fresh-sheet loading requires a page id');
    }
    const mesh = this.makePageMesh({ texture: options.texture });
    mesh.position.copy(this.freshSheetPosition);
    mesh.quaternion.copy(this.freshSheetQuaternion);
    mesh.scale.setScalar(options.startScale ?? 0.72);
    this.root.add(mesh);
    this.loadingMesh = mesh;
    this.phase = 'loading';
    this.emit('fresh-sheet-start', { pageId: options.pageId });
    const startPosition = mesh.position.clone();
    const startQuaternion = mesh.quaternion.clone();
    const startScale = mesh.scale.clone();
    const endScale = new THREE.Vector3(1, 1, 1);
    const attachAt = clamp01(options.attachAt ?? 0.72);
    let attached = false;

    return this.beginMotion('fresh-sheet', options.duration ?? 0.9, (linear) => {
      const eased = easeInOutCubic(linear);
      mesh.position.lerpVectors(startPosition, this.freshFeedPosition, eased);
      mesh.quaternion.slerpQuaternions(startQuaternion, this.freshFeedQuaternion, eased);
      mesh.scale.lerpVectors(startScale, endScale, eased);
      flexPaperGeometry(mesh.geometry, mesh.userData.flatPositions, this.paperWidth, this.paperHeight, { curl: Math.sin(linear * Math.PI) * 0.7, impulse: 0.55, progress: linear, reducedMotion: this.reducedMotion });
      if (!attached && linear >= attachAt) {
        attached = true;
        this.emit('fresh-sheet-attach', { pageId: options.pageId });
        this.setSourceVisible(true);
      }
      if (attached) {
        mesh.material.opacity = 1 - clamp01((linear - attachAt) / Math.max(1 - attachAt, EPSILON));
      }
    }, () => {
      if (!attached) {
        this.emit('fresh-sheet-attach', { pageId: options.pageId });
        this.setSourceVisible(true);
      }
      this.root.remove(mesh);
      disposeObject(mesh);
      this.loadingMesh = null;
      this.sourcePaperMesh = this.getMachinePaperMesh() ?? this.sourcePaperMesh;
      this.phase = 'idle';
      this.emit('fresh-sheet-complete', { pageId: options.pageId });
      return { pageId: options.pageId };
    });
  }

  clearDynamicVisuals() {
    if (this.activePage?.mesh) {
      this.root.remove(this.activePage.mesh);
      disposeObject(this.activePage.mesh);
    }
    this.activePage = null;
    if (this.loadingMesh) {
      this.root.remove(this.loadingMesh);
      disposeObject(this.loadingMesh);
    }
    this.loadingMesh = null;
    this.replaceManuscriptTop(null);
    for (const mesh of this.discardVisuals.values()) {
      this.root.remove(mesh);
      disposeObject(mesh);
    }
    this.discardVisuals.clear();
  }

  abortFailedMotion(error, motionKind, failedPhase) {
    this.clearDynamicVisuals();
    this.updateStackLayers(0);
    this.setSourceVisible(true);
    this.sourcePaperMesh = null;
    this.phase = 'idle';
    const failure = error instanceof PaperLifecycleViewError
      ? error
      : new PaperLifecycleViewError(
        'motion-failed',
        `Paper motion ${motionKind} failed during ${failedPhase}`,
        error,
      );
    try {
      this.onEvent({
        type: 'motion-aborted',
        phase: this.phase,
        motion: motionKind,
        failedPhase,
        errorCode: failure.code,
      });
    } catch {
      // A status callback must never prevent the view from becoming syncable.
    }
    return failure;
  }

  setManuscriptEntries(entries = [], textureForPage = () => null) {
    this.replaceManuscriptTop(null);
    this.updateStackLayers(entries.length);
    const topEntry = entries.at(-1);
    if (!topEntry?.page) return;
    const mesh = this.makePageMesh({ texture: textureForPage(topEntry.page, 1) });
    const pose = this.manuscriptTopPose(entries.length);
    mesh.position.copy(pose.position);
    mesh.quaternion.copy(pose.quaternion);
    mesh.scale.copy(pose.scale);
    this.root.add(mesh);
    this.replaceManuscriptTop(mesh, topEntry.page.id);
  }

  setDiscardEntries(entries = [], textureForPage = () => null) {
    for (const mesh of this.discardVisuals.values()) {
      this.root.remove(mesh);
      disposeObject(mesh);
    }
    this.discardVisuals.clear();
    const visible = entries.slice(-this.maxVisibleDiscards);
    visible.forEach((entry, index) => {
      const seed = entry.crumple?.seed ?? 1;
      const mesh = this.makePageMesh({ texture: textureForPage(entry.page, 1) });
      applyPositions(
        mesh.geometry,
        mesh.userData.flatPositions,
        1,
        seed,
        this.paperWidth,
        this.paperHeight,
      );
      mesh.position.copy(this.discardLanding(seed, index, entry.crumple?.landing));
      mesh.rotation.set(
        deterministicUnit(seed, index, 60) * Math.PI,
        deterministicUnit(seed, index, 61) * Math.PI,
        deterministicUnit(seed, index, 62) * Math.PI,
      );
      setTarget(mesh, { kind: 'discarded-page', action: 'recover-page', pageId: entry.page.id });
      this.root.add(mesh);
      this.discardVisuals.set(entry.page.id, mesh);
    });
  }

  syncFromState(state, options = {}) {
    this.assertAvailable(['idle']);
    const textureForPage = options.textureForPage ?? (() => null);
    this.clearDynamicVisuals();
    this.setManuscriptEntries(state.manuscript ?? [], textureForPage);
    this.setDiscardEntries(state.discards ?? [], textureForPage);

    if (state.looseSheet?.page) {
      const page = state.looseSheet.page;
      const mesh = this.makePageMesh({ texture: textureForPage(page) });
      mesh.position.copy(this.inspectionPosition);
      mesh.quaternion.copy(this.inspectionQuaternion);
      mesh.scale.copy(this.inspectionScale);
      setTarget(mesh, { kind: 'loose-page', action: 'inspect-page', pageId: page.id });
      this.root.add(mesh);
      flexPaperGeometry(mesh.geometry, mesh.userData.flatPositions, this.paperWidth, this.paperHeight);
      this.activePage = { pageId: page.id, mesh, crumpleProgress: 0, seed: null };
      this.phase = 'inspecting';
    }
    this.setSourceVisible(Boolean(state.insertedSheet));
    this.emit('state-synced', {
      manuscriptCount: state.manuscript?.length ?? 0,
      discardCount: state.discards?.length ?? 0,
      loosePageId: state.looseSheet?.page?.id ?? null,
    });
  }

  update(deltaSeconds) {
    if (this.disposed || !this.motion) return;
    const motion = this.motion;
    motion.elapsed += Math.min(0.05, Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0));
    const progress = clamp01(motion.elapsed / motion.duration);
    try {
      motion.onUpdate(progress);
      if (progress >= 1) {
        this.motion = null;
        motion.resolve(motion.onComplete());
      }
    } catch (error) {
      this.motion = null;
      motion.reject(this.abortFailedMotion(error, motion.kind, this.phase));
    }
  }

  getRaycastTargets() {
    return [
      this.trayTarget,
      this.wastebasketTarget,
      this.activePage?.mesh,
      this.manuscriptTopMesh,
      ...this.discardVisuals.values(),
    ].filter(Boolean);
  }

  resolveRaycastTarget(intersectionOrObject) {
    let object = intersectionOrObject?.object ?? intersectionOrObject;
    while (object && object !== this.root.parent) {
      if (object.userData?.paperLifecycleTarget) return object.userData.paperLifecycleTarget;
      object = object.parent;
    }
    return null;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.motion) {
      this.motion.reject(new PaperLifecycleViewError('disposed', 'Paper ritual was cancelled during disposal'));
      this.motion = null;
    }
    this.setSourceVisible(true);
    this.parent.remove(this.root);
    disposeObject(this.root);
    this.root.clear();
    this.activePage = null;
    this.loadingMesh = null;
    this.manuscriptTopMesh = null;
    this.discardVisuals.clear();
    this.phase = 'disposed';
  }
}
