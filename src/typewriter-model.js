import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeSurfaceGrain } from './material-craft.js';
import { stepPaperResponse } from './paper-response.js';
import { paperPerimeterIndices } from './paper-flex.js';
import {
  makeBadgeTexture,
  makeCrinkleTexture,
  makeKeyLabelTexture,
  makeRectLabelTexture,
  makeScaleTexture,
  makeWoodTexture,
  makePaperFiberTexture,
} from './textures.js';

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const TMP_A = new THREE.Vector3();
const TMP_B = new THREE.Vector3();
const TMP_C = new THREE.Vector3();
const TMP_Q = new THREE.Quaternion();
const CYLINDER_GEOMETRY_CACHE = new Map();
const MAX_COMMAND_STARTS_PER_FRAME = 12;
const COMMAND_IMPACT_SECONDS = 0.055;
const COMMAND_RELEASE_SECONDS = 0.088;
const MECHANICAL_IMPACT_SLOT_SECONDS = 0.008;
const TYPEBAR_SECONDARY_REACH_LIMIT = 0.8;
const LATENCY_SAMPLE_LIMIT = 240;
const STANDARD_KEY_TRAVEL = 0.095;
const SPACE_KEY_TRAVEL = 0.11;
const KEY_PRESS_ROTATION = 0.038;
const MARGIN_STOP_RAIL_HALF_WIDTH = 2.86;
export const DEFAULT_TOUCH_PRESET = 'medium';
export const TOUCH_PRESETS = Object.freeze({
  light: Object.freeze({
    name: 'Light',
    force: 0.6,
    keyTravelScale: 0.94,
    timingScale: 0.9,
    soundScale: 0.84,
    impulseScale: 0.78,
  }),
  medium: Object.freeze({
    name: 'Medium',
    force: 0.72,
    keyTravelScale: 1,
    timingScale: 1,
    soundScale: 1,
    impulseScale: 1,
  }),
  heavy: Object.freeze({
    name: 'Heavy',
    force: 0.86,
    keyTravelScale: 1.08,
    timingScale: 1.12,
    soundScale: 1.12,
    impulseScale: 1.28,
  }),
});
const TOUCH_PRESET_NAMES = Object.freeze(Object.keys(TOUCH_PRESETS));
const CLEARANCE_INTERSECTION_EPSILON = 1e-5;
const CLEARANCE_SWEEP_STEPS = 10;
const NEIGHBOR_SWEEP_STEPS = 10;
const DEFAULT_NEIGHBOR_KEY_PAIRS = [
  ['Backquote', 'Digit1'],
  ['Backquote', 'Tab'],
  ['KeyQ', 'Tab'],
  ['Equal', 'Backspace'],
];

function wallClockMilliseconds() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function summarizeDurations(samples, field) {
  const values = samples
    .map((sample) => sample[field])
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!values.length) return { p50: 0, p95: 0, max: 0 };
  const at = (percentile) => values[Math.min(values.length - 1, Math.floor((values.length - 1) * percentile))];
  return {
    p50: at(0.5),
    p95: at(0.95),
    max: values[values.length - 1],
  };
}

export const CHARACTER_KEYS = [
  [
    ['Backquote', '`', '~'], ['Digit1', '1', '!'], ['Digit2', '2', '@'], ['Digit3', '3', '#'], ['Digit4', '4', '$'],
    ['Digit5', '5', '%'], ['Digit6', '6', '^'], ['Digit7', '7', '&'], ['Digit8', '8', '*'],
    ['Digit9', '9', '('], ['Digit0', '0', ')'], ['Minus', '-', '_'], ['Equal', '=', '+'],
  ],
  [
    ['KeyQ', 'q', 'Q'], ['KeyW', 'w', 'W'], ['KeyE', 'e', 'E'], ['KeyR', 'r', 'R'],
    ['KeyT', 't', 'T'], ['KeyY', 'y', 'Y'], ['KeyU', 'u', 'U'], ['KeyI', 'i', 'I'],
    ['KeyO', 'o', 'O'], ['KeyP', 'p', 'P'], ['BracketLeft', '[', '{'], ['BracketRight', ']', '}'],
    ['Backslash', '\\', '|'],
  ],
  [
    ['KeyA', 'a', 'A'], ['KeyS', 's', 'S'], ['KeyD', 'd', 'D'], ['KeyF', 'f', 'F'],
    ['KeyG', 'g', 'G'], ['KeyH', 'h', 'H'], ['KeyJ', 'j', 'J'], ['KeyK', 'k', 'K'],
    ['KeyL', 'l', 'L'], ['Semicolon', ';', ':'], ['Quote', "'", '"'],
  ],
  [
    ['KeyZ', 'z', 'Z'], ['KeyX', 'x', 'X'], ['KeyC', 'c', 'C'], ['KeyV', 'v', 'V'],
    ['KeyB', 'b', 'B'], ['KeyN', 'n', 'N'], ['KeyM', 'm', 'M'], ['Comma', ',', '<'],
    ['Period', '.', '>'], ['Slash', '/', '?'],
  ],
];

export const KEY_BY_CODE = new Map(CHARACTER_KEYS.flat().map(([code, lower, upper]) => [code, { code, lower, upper }]));
export const CODE_BY_CHARACTER = new Map();
for (const [code, { lower, upper }] of KEY_BY_CODE) {
  CODE_BY_CHARACTER.set(lower, code);
  CODE_BY_CHARACTER.set(upper, code);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function normalizeTouchPresetName(name) {
  if (typeof name !== 'string') throw new TypeError('Touch preset must be a string');
  const normalized = name.trim().toLowerCase();
  if (!TOUCH_PRESETS[normalized]) {
    throw new RangeError(`Touch preset must be one of: ${TOUCH_PRESET_NAMES.join(', ')}`);
  }
  return normalized;
}

function damp(current, target, smoothing, delta) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-smoothing * delta));
}

function easeOutCubic(value) {
  return 1 - (1 - value) ** 3;
}

function easeInOutCubic(value) {
  return value < 0.5 ? 4 * value ** 3 : 1 - ((-2 * value + 2) ** 3) / 2;
}

function strikeReach(phase) {
  if (phase < 0.42) return easeOutCubic(phase / 0.42);
  if (phase < 0.48) return 1 - (phase - 0.42) * 0.8;
  return Math.max(0, 0.952 * (1 - easeOutCubic((phase - 0.48) / 0.52)));
}

function makeRounded(width, height, depth, radius = 0.08, segments = 3) {
  const geometry = new RoundedBoxGeometry(width, height, depth, segments, radius);
  geometry.userData.clearanceShape = {
    type: 'rounded-box',
    halfExtents: [width / 2, height / 2, depth / 2],
    radius,
  };
  return geometry;
}

function signedDistanceToRoundedBox(point, shape) {
  const [halfX, halfY, halfZ] = shape.halfExtents;
  const radius = Math.max(0, Math.min(shape.radius, halfX, halfY, halfZ));
  const qx = Math.abs(point.x) - (halfX - radius);
  const qy = Math.abs(point.y) - (halfY - radius);
  const qz = Math.abs(point.z) - (halfZ - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
  return outside + Math.min(Math.max(qx, qy, qz), 0) - radius;
}

function minimumGeometryDistanceToRoundedBox(geometry, geometryToBox, shape) {
  const positions = geometry?.attributes?.position;
  if (!positions) return Number.POSITIVE_INFINITY;

  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const geometryBounds = geometry.boundingBox.clone().applyMatrix4(geometryToBox);
  const [halfX, halfY, halfZ] = shape.halfExtents;
  const gapX = Math.max(-halfX - geometryBounds.max.x, geometryBounds.min.x - halfX, 0);
  const gapY = Math.max(-halfY - geometryBounds.max.y, geometryBounds.min.y - halfY, 0);
  const gapZ = Math.max(-halfZ - geometryBounds.max.z, geometryBounds.min.z - halfZ, 0);
  const broadPhaseGap = Math.hypot(gapX, gapY, gapZ);
  if (broadPhaseGap > 0) return broadPhaseGap;

  const point = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let minimum = Number.POSITIVE_INFINITY;
  const inspectPoint = (candidate) => {
    candidate.applyMatrix4(geometryToBox);
    minimum = Math.min(minimum, signedDistanceToRoundedBox(candidate, shape));
  };

  for (let index = 0; index < positions.count; index += 1) {
    point.fromBufferAttribute(positions, index);
    inspectPoint(point);
  }

  // Triangle centroids catch a thin shell crossing a rendered face between
  // coarse vertices while remaining deterministic and renderer-independent.
  const indices = geometry.index;
  const triangleCount = indices ? indices.count / 3 : positions.count / 3;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const offset = triangle * 3;
    const indexA = indices ? indices.getX(offset) : offset;
    const indexB = indices ? indices.getX(offset + 1) : offset + 1;
    const indexC = indices ? indices.getX(offset + 2) : offset + 2;
    a.fromBufferAttribute(positions, indexA);
    b.fromBufferAttribute(positions, indexB);
    c.fromBufferAttribute(positions, indexC);
    point.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    inspectPoint(point);
  }
  return minimum;
}

function keyTopObjects(key) {
  return key.ring ? [key.ring, key.cap, key.labelDisc].filter(Boolean) : [key.base].filter(Boolean);
}

function hypotheticalKeyObjectMatrix(key, object, depressionAmount, travelScale = 1) {
  const travel = (key.action === 'space' ? SPACE_KEY_TRAVEL : STANDARD_KEY_TRAVEL) * travelScale;
  const groupPosition = new THREE.Vector3(
    key.group.position.x,
    key.baseY - depressionAmount * travel,
    key.group.position.z,
  );
  const groupRotation = new THREE.Euler(
    key.baseRotationX - depressionAmount * KEY_PRESS_ROTATION * travelScale,
    key.group.rotation.y,
    key.group.rotation.z,
    key.group.rotation.order,
  );
  const groupMatrix = new THREE.Matrix4().compose(
    groupPosition,
    new THREE.Quaternion().setFromEuler(groupRotation),
    key.group.scale,
  );
  object.updateMatrix();
  return groupMatrix.multiply(object.matrix);
}

function transformedGeometryBounds(geometry, matrix) {
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  return geometry.boundingBox.clone().applyMatrix4(matrix);
}

function signedDistanceBetweenBoxes(first, second) {
  const gapX = Math.max(first.min.x - second.max.x, second.min.x - first.max.x, 0);
  const gapY = Math.max(first.min.y - second.max.y, second.min.y - first.max.y, 0);
  const gapZ = Math.max(first.min.z - second.max.z, second.min.z - first.max.z, 0);
  if (gapX || gapY || gapZ) return Math.hypot(gapX, gapY, gapZ);

  const overlapX = Math.min(first.max.x, second.max.x) - Math.max(first.min.x, second.min.x);
  const overlapY = Math.min(first.max.y, second.max.y) - Math.max(first.min.y, second.min.y);
  const overlapZ = Math.min(first.max.z, second.max.z) - Math.max(first.min.z, second.min.z);
  return -Math.min(overlapX, overlapY, overlapZ);
}

function minimumKeyTopBoundsClearance(first, second, firstDepression, secondDepression) {
  let minimumClearance = Number.POSITIVE_INFINITY;
  let closest = null;
  for (const firstObject of keyTopObjects(first)) {
    const firstMatrix = hypotheticalKeyObjectMatrix(first, firstObject, firstDepression);
    const firstBounds = transformedGeometryBounds(firstObject.geometry, firstMatrix);
    for (const secondObject of keyTopObjects(second)) {
      const secondMatrix = hypotheticalKeyObjectMatrix(second, secondObject, secondDepression);
      const secondBounds = transformedGeometryBounds(secondObject.geometry, secondMatrix);
      const clearance = signedDistanceBetweenBoxes(firstBounds, secondBounds);
      if (clearance < minimumClearance) {
        minimumClearance = clearance;
        closest = {
          firstObject: firstObject.name || firstObject.type,
          secondObject: secondObject.name || secondObject.type,
        };
      }
    }
  }
  return { clearance: minimumClearance, closest };
}

function cylinderBetween(start, end, radius, material, radialSegments = 10) {
  const cacheKey = `${radius}:${radialSegments}`;
  let geometry = CYLINDER_GEOMETRY_CACHE.get(cacheKey);
  if (!geometry) {
    geometry = new THREE.CylinderGeometry(radius, radius, 1, radialSegments, 1, false);
    CYLINDER_GEOMETRY_CACHE.set(cacheKey, geometry);
  }
  const mesh = new THREE.Mesh(geometry, material);
  placeCylinder(mesh, start, end);
  return mesh;
}

function placeCylinder(mesh, start, end) {
  TMP_A.copy(end).sub(start);
  const length = Math.max(0.0001, TMP_A.length());
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  TMP_Q.setFromUnitVectors(Y_AXIS, TMP_A.normalize());
  mesh.quaternion.copy(TMP_Q);
  mesh.scale.set(1, length, 1);
}

function makeTube(points, radius, material, tubularSegments = 40) {
  const curve = new THREE.CatmullRomCurve3(points);
  const geometry = new THREE.TubeGeometry(curve, tubularSegments, radius, 8, false);
  return new THREE.Mesh(geometry, material);
}

function shadow(mesh, cast = true, receive = true) {
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  return mesh;
}

function makeSpring(start, end, radius, coils, material) {
  const points = [];
  const direction = end.clone().sub(start);
  const length = direction.length();
  const axis = direction.clone().normalize();
  const basisA = Math.abs(axis.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  basisA.cross(axis).normalize();
  const basisB = axis.clone().cross(basisA).normalize();
  for (let i = 0; i <= coils * 12; i += 1) {
    const t = i / (coils * 12);
    const envelope = Math.sin(Math.PI * Math.min(1, t * 7)) * Math.sin(Math.PI * Math.min(1, (1 - t) * 7));
    const angle = t * coils * Math.PI * 2;
    const point = start.clone().addScaledVector(axis, length * t);
    point.addScaledVector(basisA, Math.cos(angle) * radius * envelope);
    point.addScaledVector(basisB, Math.sin(angle) * radius * envelope);
    points.push(point);
  }
  return makeTube(points, 0.013, material, coils * 12);
}

function makeBichromeRibbon(points, halfWidth, blackMaterial, redMaterial) {
  const positions = new Float32Array(points.length * 3 * 3);
  const indices = [];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  for (let segment = 0; segment < points.length - 1; segment += 1) {
    const a = segment * 3;
    const b = (segment + 1) * 3;
    const blackStart = indices.length;
    indices.push(a, b, a + 1, b, b + 1, a + 1);
    geometry.addGroup(blackStart, 6, 0);
    const redStart = indices.length;
    indices.push(a + 1, b + 1, a + 2, b + 1, b + 2, a + 2);
    geometry.addGroup(redStart, 6, 1);
  }
  geometry.setIndex(indices);
  const mesh = new THREE.Mesh(geometry, [blackMaterial, redMaterial]);
  mesh.userData.ribbonPoints = points.map((point) => point.clone());
  mesh.userData.ribbonHalfWidth = halfWidth;
  updateBichromeRibbon(mesh, points);
  return mesh;
}

function updateBichromeRibbon(mesh, points) {
  const position = mesh.geometry.attributes.position;
  const halfWidth = mesh.userData.ribbonHalfWidth;
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    position.setXYZ(i * 3, point.x, point.y + halfWidth, point.z);
    position.setXYZ(i * 3 + 1, point.x, point.y, point.z);
    position.setXYZ(i * 3 + 2, point.x, point.y - halfWidth, point.z);
  }
  position.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingSphere();
}

export class TypewriterModel {
  constructor({ scene, documentState, paperRenderer, audio, onChange, onStatus, reducedMotion = false }) {
    this.scene = scene;
    this.document = documentState;
    this.paperRenderer = paperRenderer;
    this.reducedMotion = reducedMotion;
    this.surfaceTime = 0;
    this.paperResponse = { position: 0, velocity: 0 };
    this.audio = audio;
    this.onChange = onChange ?? (() => {});
    this.onStatus = onStatus ?? (() => {});

    this.root = new THREE.Group();
    this.root.name = 'Octoberline211';
    this.scene.add(this.root);
    this.machine = new THREE.Group();
    this.machine.name = 'Machine';
    this.root.add(this.machine);

    this.keys = new Map();
    this.activeKeys = new Set();
    this.clickTargets = [];
    this.typebars = new Map();
    this.activeStrikes = [];
    this.commandQueue = [];
    this.commandSequence = 0;
    this.commandBurstLimit = MAX_COMMAND_STARTS_PER_FRAME;
    this.commandClock = wallClockMilliseconds;
    this.strikeTimelineSeconds = 0;
    this.nextMechanicalImpactAt = 0;
    this.latencySamples = [];
    this.latencyPeakQueueDepth = 0;
    this.specialAnimations = [];
    this.shellMeshes = [];
    this.inspectionTarget = 0;
    this.inspectionAmount = 0;
    this.inkMode = 'black';
    this.ribbonPosition = 0.12;
    this.ribbonDirection = 1;
    this.ribbonTurns = 0;
    this.shiftHeld = false;
    this.shiftHeldCodes = new Set();
    this.shiftLocked = false;
    this.shiftAmount = 0;
    this.marginReleased = false;
    this.marginReleaseTimer = 0;
    this.touchPreset = DEFAULT_TOUCH_PRESET;
    this.touchForce = TOUCH_PRESETS[DEFAULT_TOUCH_PRESET].force;
    this.machineImpulse = 0;
    this.returning = null;
    this.tabMotion = null;
    this.paperLoading = null;
    this.carriagePosition = 0;
    this.carriageTarget = 0;
    this.platenRotation = 0;
    this.paperY = 0;
    this.universalAmount = 0;
    this.escapementAmount = 0;
    this.escapementCycle = 0;
    this.bellAmount = 0;
    this.lastDelta = 1 / 60;

    this.dimensions = {
      startCarriageX: 2.31,
      characterPitch: 4.62 / 65,
      paperBaseY: 0,
      paperLinePitch: 0.1138,
    };

    this.carriagePosition = this.dimensions.startCarriageX - this.document.column * this.dimensions.characterPitch;
    this.carriageTarget = this.carriagePosition;
    this.paperY = this.dimensions.paperBaseY + this.document.line * this.dimensions.paperLinePitch;

    this.makeMaterials();
    this.buildStudio();
    this.buildMachine();
    this.applyDocumentState(true);
  }

  makeMaterials() {
    const crinkle = makeCrinkleTexture();
    const brushed = makeSurfaceGrain('metal');
    const fabric = makeSurfaceGrain('ribbon');
    this.materials = {
      enamel: new THREE.MeshPhysicalMaterial({
        color: 0x090d0c,
        roughness: 0.3,
        metalness: 0.38,
        clearcoat: 0.65,
        clearcoatRoughness: 0.19,
        bumpMap: crinkle,
        bumpScale: 0.006,
      }),
      enamelEdge: new THREE.MeshStandardMaterial({ color: 0x171b18, roughness: 0.34, metalness: 0.7 }),
      steel: new THREE.MeshStandardMaterial({ color: 0x88918e, roughness: 0.42, roughnessMap: brushed, bumpMap: brushed, bumpScale: 0.0012, metalness: 0.92 }),
      darkSteel: new THREE.MeshStandardMaterial({ color: 0x252b29, roughness: 0.32, metalness: 0.9 }),
      chrome: new THREE.MeshPhysicalMaterial({ color: 0xc9d1ce, roughness: 0.22, roughnessMap: brushed, metalness: 1, clearcoat: 0.28 }),
      brass: new THREE.MeshStandardMaterial({ color: 0xb28a4f, roughness: 0.35, roughnessMap: brushed, metalness: 0.88 }),
      agedBrass: new THREE.MeshStandardMaterial({ color: 0x85633b, roughness: 0.51, bumpMap: crinkle, bumpScale: 0.003, metalness: 0.75 }),
      rubber: new THREE.MeshStandardMaterial({ color: 0x101211, roughness: 0.83, metalness: 0.02 }),
      felt: new THREE.MeshStandardMaterial({ color: 0x261c16, roughness: 1 }),
      ivory: new THREE.MeshPhysicalMaterial({ color: 0xded3b8, roughness: 0.25, clearcoat: 0.55, clearcoatRoughness: 0.18 }),
      glass: new THREE.MeshPhysicalMaterial({ color: 0xdde1d5, roughness: 0.08, transmission: 0.16, thickness: 0.06, clearcoat: 1 }),
      paper: new THREE.MeshStandardMaterial({ map: this.paperRenderer.texture, bumpMap: makePaperFiberTexture(), bumpScale: 0.008, roughness: 0.92, metalness: 0, side: THREE.DoubleSide }),
      paperEdge: new THREE.MeshStandardMaterial({ color: 0xd8ccb3, roughness: 0.96, side: THREE.DoubleSide }),
      ribbonBlack: new THREE.MeshStandardMaterial({ color: 0x141715, bumpMap: fabric, bumpScale: 0.002, roughness: 0.88, metalness: 0.02, side: THREE.DoubleSide }),
      ribbonRed: new THREE.MeshStandardMaterial({ color: 0x782019, bumpMap: fabric, bumpScale: 0.002, roughness: 0.87, metalness: 0.02, side: THREE.DoubleSide }),
      wood: new THREE.MeshStandardMaterial({ map: makeWoodTexture(), color: 0x8a5a38, roughness: 0.5, metalness: 0 }),
      leather: new THREE.MeshStandardMaterial({ color: 0x211812, roughness: 0.73, metalness: 0.02 }),
      wall: new THREE.MeshStandardMaterial({ color: 0x161a16, roughness: 1, metalness: 0 }),
      redIndicator: new THREE.MeshStandardMaterial({ color: 0x8f251c, roughness: 0.38, metalness: 0.45 }),
    };
  }

  buildStudio() {
    const desk = shadow(new THREE.Mesh(makeRounded(18, 0.62, 13, 0.18, 4), this.materials.wood), false, true);
    desk.name = 'WalnutDesk';
    desk.position.set(0, -0.22, 0.35);
    this.root.add(desk);

    const blotter = shadow(new THREE.Mesh(makeRounded(11.2, 0.055, 8.2, 0.12, 3), this.materials.leather), false, true);
    blotter.position.set(0, 0.115, 0.5);
    this.root.add(blotter);

    const lamp = new THREE.Group();
    lamp.name = 'DeskLamp';
    const base = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.73, 0.88, 0.18, 48), this.materials.agedBrass));
    base.position.y = 0.25;
    lamp.add(base);
    const arm1 = cylinderBetween(new THREE.Vector3(0, 0.31, 0), new THREE.Vector3(0.32, 2.42, -0.2), 0.065, this.materials.brass, 16);
    lamp.add(shadow(arm1));
    const arm2 = cylinderBetween(new THREE.Vector3(0.32, 2.42, -0.2), new THREE.Vector3(1.05, 3.28, 0.3), 0.055, this.materials.brass, 16);
    lamp.add(shadow(arm2));
    const joint = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 12), this.materials.brass));
    joint.position.set(0.32, 2.42, -0.2);
    lamp.add(joint);
    const shade = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.83, 0.72, 48, 1, true), this.materials.enamelEdge));
    shade.position.set(1.12, 3.13, 0.38);
    shade.rotation.z = -0.67;
    lamp.add(shade);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.62, 36), new THREE.MeshBasicMaterial({ color: 0xffd39a, side: THREE.DoubleSide }));
    glow.position.set(1.32, 2.91, 0.5);
    glow.rotation.set(-0.03, 0.1, -0.67);
    lamp.add(glow);
    lamp.position.set(-6.1, 0, -2.2);
    this.root.add(lamp);

    const pencil = cylinderBetween(new THREE.Vector3(-5.4, 0.19, 2.9), new THREE.Vector3(-3.1, 0.19, 3.25), 0.038, this.materials.redIndicator, 12);
    this.root.add(shadow(pencil, false, true));
  }

  buildMachine() {
    this.buildBody();
    this.buildTypeBasket();
    this.buildRibbonSystem();
    this.buildCarriage();
    this.buildEscapement();
    this.buildKeyboard();
    this.buildBellAndDetails();
    this.machine.traverse((object) => {
      if (object.isMesh) {
        object.castShadow = false;
        object.receiveShadow = false;
      }
    });
    for (const mesh of this.shellMeshes) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
    this.paperMesh.castShadow = true;
    this.paperMesh.receiveShadow = true;
  }

  addShell(mesh) {
    mesh.material = mesh.material.clone();
    mesh.material.transparent = true;
    mesh.material.userData.baseOpacity = mesh.material.opacity;
    mesh.updateMatrix();
    mesh.userData.clearanceRestMatrix = mesh.matrix.clone();
    this.shellMeshes.push(mesh);
    this.machine.add(mesh);
    return mesh;
  }

  buildBody() {
    // The keyboard sits in an open cast-metal bay. Earlier builds used one tall
    // solid skirt here, which physically swallowed three key rows. These shell
    // dimensions are clearance-checked against every key at rest and at full
    // 0.095-unit travel, including the wider special keys and space bar.
    const basePan = new THREE.Mesh(makeRounded(8.9, 0.16, 6.1, 0.07, 5), this.materials.enamel);
    basePan.name = 'CastBase';
    basePan.position.set(0, 0.21, 0.35);
    this.addShell(basePan);

    const rearBase = new THREE.Mesh(makeRounded(8.9, 0.46, 3.0, 0.2, 5), this.materials.enamel);
    rearBase.name = 'RearCastBase';
    rearBase.position.set(0, 0.36, -1.2);
    this.addShell(rearBase);

    const frontRail = new THREE.Mesh(makeRounded(8.45, 0.24, 0.3, 0.08, 4), this.materials.enamel);
    frontRail.name = 'OpenKeyboardFrontRail';
    frontRail.position.set(0, 0.43, 3.25);
    this.addShell(frontRail);

    const rearHousing = new THREE.Mesh(makeRounded(8.22, 1.72, 2.34, 0.24, 5), this.materials.enamel);
    rearHousing.name = 'RearMechanismCover';
    rearHousing.position.set(0, 1.25, -0.62);
    rearHousing.rotation.x = 0.05;
    this.addShell(rearHousing);

    const topCover = new THREE.Mesh(makeRounded(7.08, 0.22, 1.72, 0.16, 4), this.materials.enamel);
    topCover.name = 'RibbonCover';
    topCover.position.set(0, 2.03, -0.4);
    topCover.rotation.x = -0.035;
    this.topCover = this.addShell(topCover);

    for (const side of [-1, 1]) {
      const cheek = new THREE.Mesh(makeRounded(0.48, 1.08, 1.9, 0.16, 4), this.materials.enamel);
      cheek.name = side < 0 ? 'RearCheekLeft' : 'RearCheekRight';
      cheek.position.set(side * 4.1, 1.03, -0.27);
      cheek.rotation.z = side * 0.025;
      this.addShell(cheek);

      const sideSill = new THREE.Mesh(makeRounded(0.48, 0.28, 2.7, 0.1, 4), this.materials.enamel);
      sideSill.name = side < 0 ? 'KeyboardSillLeft' : 'KeyboardSillRight';
      sideSill.position.set(side * 4.1, 0.41, 2.04);
      this.addShell(sideSill);

      const trim = new THREE.Mesh(makeRounded(0.085, 0.12, 1.76, 0.035, 2), this.materials.chrome);
      trim.position.set(side * 4.35, 0.74, -0.2);
      this.machine.add(trim);

      for (let z = -0.62; z <= 0.58; z += 0.4) {
        const vent = new THREE.Mesh(makeRounded(0.04, 0.05, 0.23, 0.02, 2), this.materials.darkSteel);
        vent.position.set(side * 4.36, 1.14, z);
        this.machine.add(vent);
      }
    }

    const badge = new THREE.Mesh(
      new THREE.PlaneGeometry(2.65, 0.2),
      new THREE.MeshBasicMaterial({ map: makeBadgeTexture(), transparent: true, toneMapped: false }),
    );
    badge.name = 'Octoberline211Badge';
    badge.position.set(0, 0.43, 3.405);
    this.machine.add(badge);

    const serialPlate = new THREE.Mesh(makeRounded(1.1, 0.025, 0.34, 0.03, 2), this.materials.agedBrass);
    serialPlate.position.set(2.75, 0.145, 3.1);
    this.machine.add(serialPlate);

    for (const x of [-3.65, 3.65]) {
      for (const z of [-2.1, 2.75]) {
        const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.18, 24), this.materials.rubber);
        foot.position.set(x, 0.02, z);
        this.machine.add(foot);
      }
    }

    for (const x of [-3.82, 3.82]) {
      const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.035, 20), this.materials.chrome);
      screw.position.set(x, 0.43, 3.41);
      screw.rotation.x = Math.PI / 2;
      this.machine.add(screw);
      const slot = new THREE.Mesh(new THREE.BoxGeometry(0.078, 0.012, 0.015), this.materials.darkSteel);
      slot.position.set(x, 0.43, 3.432);
      this.machine.add(slot);
    }
  }

  buildTypeBasket() {
    this.basketGroup = new THREE.Group();
    this.basketGroup.name = 'ShiftBasket';
    this.machine.add(this.basketGroup);

    const segmentPoints = [];
    for (let i = 0; i <= 34; i += 1) {
      const t = i / 34;
      const x = THREE.MathUtils.lerp(-3.35, 3.35, t);
      const z = -0.18 + 0.48 * (1 - (x / 3.35) ** 2);
      segmentPoints.push(new THREE.Vector3(x, 1.19, z));
    }
    const segment = makeTube(segmentPoints, 0.15, this.materials.darkSteel, 74);
    segment.name = 'SlottedSegment';
    this.basketGroup.add(segment);

    const combPoints = segmentPoints.map((point) => point.clone().add(new THREE.Vector3(0, -0.16, 0.33)));
    const comb = makeTube(combPoints, 0.055, this.materials.steel, 74);
    comb.name = 'TypebarComb';
    this.basketGroup.add(comb);

    const allKeys = CHARACTER_KEYS.flat();
    const pivotPins = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.065, 0.065, 0.14, 16),
      this.materials.brass,
      allKeys.length,
    );
    pivotPins.name = 'TypebarPivotPins';
    const pinMatrix = new THREE.Matrix4();
    const pinQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));
    const pinScale = new THREE.Vector3(1, 1, 1);
    allKeys.forEach(([code, lower, upper], index) => {
      const t = index / (allKeys.length - 1);
      const angle = THREE.MathUtils.lerp(-1.24, 1.24, t);
      const pivot = new THREE.Vector3(Math.sin(angle) * 3.23, 1.2, -0.12 + Math.cos(angle) * 0.38);
      const restCandidate = new THREE.Vector3(Math.sin(angle) * 1.08, 1.04 + Math.abs(Math.sin(angle)) * 0.08, 0.92 + Math.cos(angle) * 0.12);
      const strike = new THREE.Vector3(0, 2.515, -0.76);
      const length = pivot.distanceTo(strike);
      const restDirection = restCandidate.clone().sub(pivot).normalize();
      const strikeDirection = strike.clone().sub(pivot).normalize();
      const shiftedStrikeDirection = strike.clone().add(new THREE.Vector3(0, 0.105, 0)).sub(pivot).normalize();
      const restQuaternion = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, restDirection);
      const strikeQuaternion = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, strikeDirection);
      const shiftedStrikeQuaternion = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, shiftedStrikeDirection);

      const barGroup = new THREE.Group();
      barGroup.position.copy(pivot);
      barGroup.quaternion.copy(restQuaternion);
      barGroup.name = `TypebarHinge_${code}`;
      const barGeometry = new THREE.CylinderGeometry(0.028, 0.028, length - 0.08, 8).toNonIndexed();
      barGeometry.translate(0, (length - 0.08) / 2, 0);
      const rawSlugGeometry = makeRounded(0.19, 0.13, 0.105, 0.018, 2);
      const slugGeometry = rawSlugGeometry.index ? rawSlugGeometry.toNonIndexed() : rawSlugGeometry;
      slugGeometry.rotateX(-0.23);
      slugGeometry.translate(0, length, 0);
      const typebarGeometry = mergeGeometries([barGeometry, slugGeometry], false);
      const bar = new THREE.Mesh(typebarGeometry, this.materials.steel);
      bar.name = `Typebar_${code}`;
      barGroup.add(bar);
      this.basketGroup.add(barGroup);

      pinMatrix.compose(pivot, pinQuaternion, pinScale);
      pivotPins.setMatrixAt(index, pinMatrix);

      this.typebars.set(code, {
        code, lower, upper, group: barGroup, bar, pivot, strike, length,
        restQuaternion, strikeQuaternion, shiftedStrikeQuaternion, amount: 0,
      });
    });
    pivotPins.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    pivotPins.instanceMatrix.needsUpdate = true;
    this.basketGroup.add(pivotPins);

    const guideLeft = new THREE.Mesh(makeRounded(0.08, 0.49, 0.12, 0.015, 2), this.materials.steel);
    guideLeft.position.set(-0.13, 2.41, -0.72);
    guideLeft.rotation.z = -0.12;
    this.machine.add(guideLeft);
    const guideRight = guideLeft.clone();
    guideRight.position.x = 0.13;
    guideRight.rotation.z = 0.12;
    this.machine.add(guideRight);

    this.universalBar = cylinderBetween(new THREE.Vector3(-3.4, 0.82, 0.53), new THREE.Vector3(3.4, 0.82, 0.53), 0.055, this.materials.agedBrass, 12);
    this.universalBar.name = 'UniversalBar';
    this.machine.add(this.universalBar);

    const shiftShaft = cylinderBetween(new THREE.Vector3(-3.7, 0.65, -0.05), new THREE.Vector3(3.7, 0.65, -0.05), 0.07, this.materials.darkSteel, 14);
    this.machine.add(shiftShaft);
    this.shiftLinks = [];
    for (const side of [-1, 1]) {
      const start = new THREE.Vector3(side * 3.2, 0.65, -0.03);
      const end = new THREE.Vector3(side * 3.0, 1.14, 0.08);
      const link = cylinderBetween(start, end, 0.035, this.materials.brass, 9);
      this.machine.add(link);
      this.shiftLinks.push({ link, start, end });
      const spring = makeSpring(
        new THREE.Vector3(side * 3.36, 0.54, 0.02),
        new THREE.Vector3(side * 3.18, 1.17, 0.08),
        0.052,
        9,
        this.materials.steel,
      );
      this.machine.add(spring);
    }
  }

  buildRibbonSystem() {
    this.ribbonSystem = new THREE.Group();
    this.ribbonSystem.name = 'RibbonSystem';
    this.machine.add(this.ribbonSystem);

    this.spools = [];
    for (const side of [-1, 1]) {
      const spool = new THREE.Group();
      spool.name = side < 0 ? 'RibbonSpoolLeft' : 'RibbonSpoolRight';
      spool.position.set(side * 2.42, 1.73, -0.42);
      const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.065, 48), this.materials.darkSteel);
      lower.position.y = -0.07;
      spool.add(lower);
      const upper = lower.clone();
      upper.position.y = 0.11;
      spool.add(upper);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.27, 28), this.materials.brass);
      hub.position.y = 0.02;
      spool.add(hub);
      const spokes = new THREE.InstancedMesh(
        makeRounded(0.075, 0.025, 0.51, 0.02, 2),
        this.materials.steel,
        6,
      );
      spokes.name = 'RibbonSpoolSpokes';
      const spokeMatrix = new THREE.Matrix4();
      const spokeQuaternion = new THREE.Quaternion();
      const spokeScale = new THREE.Vector3(1, 1, 1);
      for (let i = 0; i < 6; i += 1) {
        spokeQuaternion.setFromEuler(new THREE.Euler(0, (i / 6) * Math.PI * 2, 0));
        spokeMatrix.compose(new THREE.Vector3(0, 0.15, 0), spokeQuaternion, spokeScale);
        spokes.setMatrixAt(i, spokeMatrix);
      }
      spokes.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      spokes.instanceMatrix.needsUpdate = true;
      spool.add(spokes);
      const pack = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.145, 48), this.materials.ribbonBlack);
      pack.position.y = 0.02;
      spool.add(pack);
      spool.userData.pack = pack;
      spool.traverse((part) => {
        if (part.isMesh) {
          part.userData.specialAction = 'ribbon-reverse';
          this.clickTargets.push(part);
        }
      });
      this.ribbonSystem.add(spool);
      this.spools.push(spool);
    }

    this.vibrator = new THREE.Group();
    this.vibrator.name = 'RibbonVibrator';
    for (const side of [-1, 1]) {
      const fork = new THREE.Mesh(makeRounded(0.07, 0.39, 0.07, 0.015, 2), this.materials.chrome);
      fork.position.set(side * 0.67, 0, 0.02);
      this.vibrator.add(fork);
      const eye = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.018, 8, 20), this.materials.chrome);
      eye.position.set(side * 0.67, 0.11, 0.04);
      this.vibrator.add(eye);
    }
    this.vibrator.position.set(0, 2.23, -0.7);
    this.machine.add(this.vibrator);

    this.ribbonPath = [
      new THREE.Vector3(-2.42, 1.78, -0.31),
      new THREE.Vector3(-1.62, 1.72, -0.24),
      new THREE.Vector3(-0.67, 2.23, -0.69),
      new THREE.Vector3(0.67, 2.23, -0.69),
      new THREE.Vector3(1.62, 1.72, -0.24),
      new THREE.Vector3(2.42, 1.78, -0.31),
    ];
    this.ribbonStrip = makeBichromeRibbon(this.ribbonPath, 0.082, this.materials.ribbonBlack, this.materials.ribbonRed);
    this.ribbonStrip.name = 'ContinuousBichromeRibbon';
    this.ribbonSystem.add(this.ribbonStrip);

    const feedShaft = cylinderBetween(new THREE.Vector3(-2.9, 1.18, -0.62), new THREE.Vector3(2.9, 1.18, -0.62), 0.045, this.materials.steel, 12);
    this.ribbonSystem.add(feedShaft);
    for (const side of [-1, 1]) {
      const ratchet = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.09, 16), this.materials.brass);
      ratchet.position.set(side * 2.42, 1.2, -0.62);
      this.ribbonSystem.add(ratchet);
      const feedLink = cylinderBetween(new THREE.Vector3(side * 2.42, 1.2, -0.62), new THREE.Vector3(side * 2.2, 1.68, -0.42), 0.026, this.materials.steel, 8);
      this.ribbonSystem.add(feedLink);
    }
  }

  buildCarriage() {
    for (const y of [1.76, 1.9]) {
      const rail = cylinderBetween(new THREE.Vector3(-5.0, y, -1.36), new THREE.Vector3(5.0, y, -1.36), 0.065, this.materials.chrome, 18);
      rail.name = 'CarriageRail';
      this.machine.add(rail);
    }

    this.carriage = new THREE.Group();
    this.carriage.name = 'Carriage';
    this.machine.add(this.carriage);

    const frame = new THREE.Mesh(makeRounded(8.25, 0.38, 0.72, 0.08, 3), this.materials.darkSteel);
    frame.position.set(0, 1.94, -1.2);
    this.carriage.add(frame);

    this.platenSpin = new THREE.Group();
    this.platenSpin.position.set(0, 2.53, -1.12);
    this.carriage.add(this.platenSpin);
    const platen = new THREE.Mesh(new THREE.CylinderGeometry(0.39, 0.39, 7.45, 64, 1), this.materials.rubber);
    platen.rotation.z = Math.PI / 2;
    platen.name = 'RubberPlaten';
    this.platenSpin.add(platen);
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 8.35, 24), this.materials.chrome);
    axle.rotation.z = Math.PI / 2;
    this.platenSpin.add(axle);

    const knobGrips = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.035, 0.06, 0.2),
      this.materials.darkSteel,
      24,
    );
    knobGrips.name = 'PlatenKnobGrips';
    const gripMatrix = new THREE.Matrix4();
    const gripQuaternion = new THREE.Quaternion();
    const gripScale = new THREE.Vector3(1, 1, 1);
    let gripInstance = 0;
    for (const side of [-1, 1]) {
      const endPlate = new THREE.Mesh(makeRounded(0.36, 1.18, 1.02, 0.08, 3), this.materials.enamelEdge);
      endPlate.position.set(side * 3.96, 2.29, -1.12);
      this.carriage.add(endPlate);
      const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.34, 0.52, 32), this.materials.rubber);
      knob.position.set(side * 4.35, 0, 0);
      knob.rotation.z = Math.PI / 2;
      knob.name = side < 0 ? 'LeftPlatenKnob' : 'RightPlatenKnob';
      this.platenSpin.add(knob);
      for (let i = 0; i < 12; i += 1) {
        const angle = (i / 12) * Math.PI * 2;
        gripQuaternion.setFromEuler(new THREE.Euler(angle, 0, 0));
        gripMatrix.compose(
          new THREE.Vector3(side * 4.62, Math.sin(angle) * 0.23, Math.cos(angle) * 0.23),
          gripQuaternion,
          gripScale,
        );
        knobGrips.setMatrixAt(gripInstance, gripMatrix);
        gripInstance += 1;
      }
    }
    knobGrips.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    knobGrips.instanceMatrix.needsUpdate = true;
    this.platenSpin.add(knobGrips);

    const paperGeometry = new THREE.PlaneGeometry(5.8, 7.505, 34, 94);
    this.paperRestPositions = paperGeometry.attributes.position.array.slice();
    this.paperMesh = new THREE.Mesh(paperGeometry, this.materials.paper);
    this.paperMesh.name = 'TypedPaper';
    this.paperMesh.position.set(0, 0, 0);
    this.carriage.add(this.paperMesh);
    this.paperEdgeIndices = paperPerimeterIndices(34, 94);
    const paperEdgeGeometry = new THREE.BufferGeometry();
    paperEdgeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(this.paperEdgeIndices.length * 3), 3));
    this.paperOutline = new THREE.LineLoop(paperEdgeGeometry, new THREE.LineBasicMaterial({ color: 0xbaab8a, transparent: true, opacity: 0.38 }));
    this.paperOutline.name = 'FinePaperEdge';
    this.paperMesh.add(this.paperOutline);
    this.lastDeformedPaperY = Number.POSITIVE_INFINITY;

    const bail = new THREE.Group();
    bail.name = 'PaperBail';
    const bailBar = cylinderBetween(new THREE.Vector3(-3.55, 2.94, -0.68), new THREE.Vector3(3.55, 2.94, -0.68), 0.038, this.materials.chrome, 12);
    bail.add(bailBar);
    this.bailRollers = [];
    for (const x of [-2.35, -0.8, 0.8, 2.35]) {
      const rollerGroup = new THREE.Group();
      rollerGroup.position.set(x, 2.94, -0.68);
      const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.34, 24), this.materials.rubber);
      roller.rotation.z = Math.PI / 2;
      rollerGroup.add(roller);
      bail.add(rollerGroup);
      this.bailRollers.push(rollerGroup);
    }
    for (const side of [-1, 1]) {
      const arm = cylinderBetween(new THREE.Vector3(side * 3.58, 2.94, -0.68), new THREE.Vector3(side * 3.72, 2.5, -1.1), 0.035, this.materials.chrome, 10);
      bail.add(arm);
    }
    this.carriage.add(bail);

    this.feedRollers = [];
    for (const x of [-2.45, -0.82, 0.82, 2.45]) {
      const rollerGroup = new THREE.Group();
      rollerGroup.position.set(x, 2.18, -1.03);
      const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.42, 24), this.materials.rubber);
      roller.rotation.z = Math.PI / 2;
      rollerGroup.add(roller);
      this.carriage.add(rollerGroup);
      this.feedRollers.push(rollerGroup);
    }

    for (const x of [-1.7, 1.7]) {
      const support = new THREE.Mesh(makeRounded(0.08, 2.05, 0.07, 0.02, 2), this.materials.chrome);
      support.position.set(x, 3.88, -1.37);
      support.rotation.z = x < 0 ? -0.07 : 0.07;
      this.carriage.add(support);
      const finial = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 10), this.materials.chrome);
      finial.position.set(x + Math.sign(x) * 0.07, 4.9, -1.37);
      this.carriage.add(finial);
    }

    const scale = new THREE.Mesh(
      new THREE.PlaneGeometry(7.25, 0.34),
      new THREE.MeshStandardMaterial({ map: makeScaleTexture(), roughness: 0.56, metalness: 0.08 }),
    );
    scale.position.set(0, 2.04, -0.6);
    scale.rotation.x = -0.08;
    this.carriage.add(scale);

    this.marginStops = {};
    for (const [side, direction] of [['left', -1], ['right', 1]]) {
      const stop = new THREE.Group();
      stop.name = `${side === 'left' ? 'Left' : 'Right'}MarginStop`;
      stop.userData.marginSide = side;
      const block = new THREE.Mesh(makeRounded(0.22, 0.24, 0.25, 0.035, 2), this.materials.redIndicator);
      block.userData.specialAction = 'margin-stop';
      block.userData.marginSide = side;
      stop.add(block);
      const tab = new THREE.Mesh(makeRounded(0.08, 0.25, 0.08, 0.02, 2), this.materials.chrome);
      tab.position.y = 0.2;
      tab.userData.specialAction = 'margin-stop';
      tab.userData.marginSide = side;
      stop.add(tab);
      stop.position.set(direction * MARGIN_STOP_RAIL_HALF_WIDTH, 2.25, -0.77);
      this.carriage.add(stop);
      this.clickTargets.push(block, tab);
      this.marginStops[side] = stop;
    }
    this.syncMarginStopControls();

    this.returnLever = new THREE.Group();
    this.returnLever.name = 'CarriageReturnLever';
    this.returnLever.position.set(-4.12, 2.54, -1.09);
    const returnRod = cylinderBetween(new THREE.Vector3(0, 0, 0), new THREE.Vector3(-0.92, 0.24, 0.86), 0.06, this.materials.chrome, 16);
    this.returnLever.add(returnRod);
    const handle = new THREE.Mesh(makeRounded(0.65, 0.18, 0.28, 0.07, 3), this.materials.rubber);
    handle.position.set(-1.05, 0.27, 0.99);
    handle.rotation.y = -0.25;
    handle.userData.specialAction = 'return';
    this.returnLever.add(handle);
    this.clickTargets.push(handle);
    this.carriage.add(this.returnLever);

    this.lineRatchet = new THREE.Group();
    this.lineRatchet.name = 'LineSpaceRatchet';
    this.lineRatchet.position.set(-3.78, 2.53, -1.12);
    const ratchetCore = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.16, 28), this.materials.agedBrass);
    ratchetCore.rotation.z = Math.PI / 2;
    this.lineRatchet.add(ratchetCore);
    const lineTeeth = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.16, 0.09, 0.13),
      this.materials.brass,
      18,
    );
    lineTeeth.name = 'LineSpaceRatchetTeeth';
    const lineToothMatrix = new THREE.Matrix4();
    const lineToothQuaternion = new THREE.Quaternion();
    for (let i = 0; i < 18; i += 1) {
      const angle = (i / 18) * Math.PI * 2;
      lineToothQuaternion.setFromEuler(new THREE.Euler(angle, 0, 0));
      lineToothMatrix.compose(
        new THREE.Vector3(0, Math.cos(angle) * 0.34, Math.sin(angle) * 0.34),
        lineToothQuaternion,
        gripScale,
      );
      lineTeeth.setMatrixAt(i, lineToothMatrix);
    }
    lineTeeth.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    lineTeeth.instanceMatrix.needsUpdate = true;
    this.lineRatchet.add(lineTeeth);
    this.carriage.add(this.lineRatchet);

    this.linePawl = new THREE.Group();
    this.linePawl.name = 'LineSpacePawl';
    this.linePawl.position.set(-3.9, 2.84, -0.84);
    const pawlArm = new THREE.Mesh(makeRounded(0.13, 0.52, 0.1, 0.025, 2), this.materials.steel);
    pawlArm.position.y = -0.2;
    pawlArm.rotation.z = -0.22;
    this.linePawl.add(pawlArm);
    const detent = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.12, 18), this.materials.darkSteel);
    detent.position.set(0, -0.47, 0.04);
    detent.rotation.z = Math.PI / 2;
    this.linePawl.add(detent);
    this.carriage.add(this.linePawl);

    const rack = new THREE.Group();
    rack.name = 'EscapementRack';
    const rackTeeth = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.045, 0.12, 0.12),
      this.materials.steel,
      72,
    );
    rackTeeth.name = 'EscapementRackTeeth';
    const rackMatrix = new THREE.Matrix4();
    const rackQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.38));
    for (let i = 0; i < 72; i += 1) {
      rackMatrix.compose(new THREE.Vector3(-3.55 + i * 0.1, 0, 0), rackQuaternion, gripScale);
      rackTeeth.setMatrixAt(i, rackMatrix);
    }
    rackTeeth.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    rackTeeth.instanceMatrix.needsUpdate = true;
    rack.add(rackTeeth);
    rack.position.set(0, 1.72, -0.81);
    this.carriage.add(rack);
  }

  buildEscapement() {
    this.escapement = new THREE.Group();
    this.escapement.name = 'Escapement';
    this.escapement.position.set(0.18, 1.55, -0.77);
    this.machine.add(this.escapement);

    this.escapeWheel = new THREE.Group();
    const wheelCore = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.13, 24), this.materials.agedBrass);
    wheelCore.rotation.x = Math.PI / 2;
    this.escapeWheel.add(wheelCore);
    const escapeTeeth = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.045, 0.1, 0.12),
      this.materials.brass,
      24,
    );
    escapeTeeth.name = 'EscapementWheelTeeth';
    const escapeMatrix = new THREE.Matrix4();
    const escapeQuaternion = new THREE.Quaternion();
    const escapeScale = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < 24; i += 1) {
      const angle = (i / 24) * Math.PI * 2;
      escapeQuaternion.setFromEuler(new THREE.Euler(0, 0, angle));
      escapeMatrix.compose(
        new THREE.Vector3(Math.cos(angle) * 0.34, Math.sin(angle) * 0.34, 0),
        escapeQuaternion,
        escapeScale,
      );
      escapeTeeth.setMatrixAt(i, escapeMatrix);
    }
    escapeTeeth.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    escapeTeeth.instanceMatrix.needsUpdate = true;
    this.escapeWheel.add(escapeTeeth);
    this.escapement.add(this.escapeWheel);

    this.fixedDog = new THREE.Mesh(makeRounded(0.09, 0.39, 0.13, 0.02, 2), this.materials.steel);
    this.fixedDog.position.set(-0.28, 0.19, 0.03);
    this.fixedDog.rotation.z = -0.34;
    this.escapement.add(this.fixedDog);
    this.looseDog = this.fixedDog.clone();
    this.looseDog.position.set(0.28, 0.19, 0.03);
    this.looseDog.rotation.z = 0.34;
    this.escapement.add(this.looseDog);

    const pinion = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.24, 14), this.materials.steel);
    pinion.rotation.x = Math.PI / 2;
    pinion.position.z = -0.12;
    this.escapement.add(pinion);

    this.drawbandDrum = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.24, 36), this.materials.darkSteel);
    this.drawbandDrum.rotation.x = Math.PI / 2;
    this.drawbandDrum.position.set(2.65, 0.05, -0.02);
    this.escapement.add(this.drawbandDrum);
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.035, 10, 42), this.materials.brass);
    coil.position.copy(this.drawbandDrum.position);
    this.escapement.add(coil);
    this.drawbandStart = new THREE.Vector3(2.48, 1.61, -0.79);
    this.drawbandEnd = new THREE.Vector3(this.carriagePosition - 3.6, 1.75, -0.9);
    this.drawband = cylinderBetween(this.drawbandStart, this.drawbandEnd, 0.012, this.materials.steel, 6);
    this.drawband.name = 'MainspringDrawband';
    this.machine.add(this.drawband);
  }

  buildKeyboard() {
    const rowZ = [1.2, 1.84, 2.47, 3.08];
    const rowY = [1.14, 1.02, 0.9, 0.78];
    const spacing = 0.58;
    // Add the complete US-QWERTY number row without pushing Equal into the
    // Backspace key. A half-pitch left offset keeps Digit1 through Equal at
    // their established restored positions and places Backquote at far left.
    const rowXOffset = [-spacing / 2, 0, 0, 0];
    this.roundKeyGeometry = {
      stem: new THREE.CylinderGeometry(0.055, 0.06, 0.35, 12),
      ring: new THREE.TorusGeometry(0.237, 0.028, 10, 32),
      cap: new THREE.CylinderGeometry(0.215, 0.225, 0.052, 32),
      label: new THREE.CircleGeometry(0.198, 32),
    };
    // The inset is gently dished beneath its rolled metal rim.
    this.roundKeyGeometry.label.attributes.position.setZ(0, -0.008);
    this.roundKeyGeometry.label.computeVertexNormals();

    CHARACTER_KEYS.forEach((row, rowIndex) => {
      row.forEach(([code, lower, upper], keyIndex) => {
        const x = (keyIndex - (row.length - 1) / 2) * spacing + rowXOffset[rowIndex];
        const z = rowZ[rowIndex];
        const y = rowY[rowIndex];
        const primary = /^[a-z]$/i.test(lower) ? upper : lower;
        const secondary = /^[a-z]$/i.test(lower) ? '' : upper;
        this.makeRoundKey({ code, lower, upper, primary, secondary, x, y, z });
      });
    });

    this.makeSpecialKey({ code: 'Tab', label: 'TAB', x: -4.08, y: 1.02, z: 1.84, width: 0.6, action: 'tab' });
    this.makeSpecialKey({ code: 'Backspace', label: 'BACK', x: 3.91, y: 1.14, z: 1.2, width: 0.82, action: 'backspace' });
    this.makeSpecialKey({ code: 'CapsLock', label: 'LOCK', x: -3.62, y: 0.9, z: 2.47, width: 0.82, action: 'caps' });
    this.makeSpecialKey({ code: 'ShiftLeft', label: 'SHIFT', x: -3.63, y: 0.76, z: 3.08, width: 1.05, action: 'shift' });
    this.makeSpecialKey({ code: 'ShiftRight', label: 'SHIFT', x: 3.63, y: 0.76, z: 3.08, width: 1.05, action: 'shift' });
    this.makeSpecialKey({ code: 'MarginRelease', label: 'M.R.', x: 3.64, y: 0.9, z: 2.47, width: 0.72, action: 'margin' });
    this.makeSpecialKey({ code: 'Space', label: '', x: 0, y: 0.58, z: 3.72, width: 4.2, depth: 0.48, action: 'space' });
  }

  makeRoundKey({ code, lower, upper, primary, secondary, x, y, z }) {
    const group = new THREE.Group();
    group.name = `Key_${code}`;
    group.position.set(x, y, z);
    group.rotation.x = -0.09;
    const stem = new THREE.Mesh(this.roundKeyGeometry.stem, this.materials.darkSteel);
    stem.position.y = -0.19;
    group.add(stem);
    const ring = new THREE.Mesh(this.roundKeyGeometry.ring, this.materials.chrome);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.045;
    group.add(ring);
    const labelMaterial = new THREE.MeshPhysicalMaterial({ map: makeKeyLabelTexture(primary, secondary), roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.3 });
    const cap = new THREE.Mesh(this.roundKeyGeometry.cap, this.materials.agedBrass);
    cap.position.y = 0.025;
    group.add(cap);
    const labelDisc = new THREE.Mesh(this.roundKeyGeometry.label, labelMaterial);
    labelDisc.rotation.x = -Math.PI / 2;
    labelDisc.position.y = 0.063;
    group.add(labelDisc);
    this.machine.add(group);

    const leverStart = new THREE.Vector3(x, y - 0.28, z - 0.03);
    const typebar = this.typebars.get(code);
    const leverEnd = new THREE.Vector3(typebar.pivot.x * 0.9, 0.7, 0.45);
    const lever = cylinderBetween(leverStart, leverEnd, 0.023, this.materials.darkSteel, 7);
    lever.name = `KeyLink_${code}`;
    this.machine.add(lever);
    const linkEndBase = typebar.pivot.clone().add(new THREE.Vector3(0, -0.08, 0.02));
    const link = cylinderBetween(leverEnd, linkEndBase, 0.017, this.materials.steel, 6);
    this.machine.add(link);

    const record = {
      code, lower, upper, group, cap, ring, labelDisc, lever, link, leverStart, leverEnd, linkEndBase, typebar,
      baseY: y, baseRotationX: -0.09, depression: 0, phase: -1,
      action: 'character',
    };
    group.userData.keyRecord = record;
    cap.userData.keyRecord = record;
    labelDisc.userData.keyRecord = record;
    ring.userData.keyRecord = record;
    this.keys.set(code, record);
    this.clickTargets.push(cap, labelDisc, ring);
  }

  makeSpecialKey({ code, label, x, y, z, width, depth = 0.44, action }) {
    const group = new THREE.Group();
    group.name = `Key_${code}`;
    group.position.set(x, y, z);
    group.rotation.x = -0.09;
    const base = new THREE.Mesh(makeRounded(width, 0.12, depth, 0.055, 3), this.materials.darkSteel);
    group.add(base);
    if (label) {
      const top = new THREE.Mesh(
        new THREE.PlaneGeometry(width * 0.77, depth * 0.57),
        new THREE.MeshPhysicalMaterial({ map: makeRectLabelTexture(label), roughness: 0.19, clearcoat: 0.82 }),
      );
      top.rotation.x = -Math.PI / 2;
      top.position.y = 0.066;
      group.add(top);
    } else {
      const inset = new THREE.Mesh(makeRounded(width - 0.18, 0.025, depth - 0.15, 0.04, 3), this.materials.enamelEdge);
      inset.position.y = 0.073;
      group.add(inset);
    }
    const leftStem = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.32, 12), this.materials.darkSteel);
    leftStem.position.set(-Math.max(0, width / 2 - 0.2), -0.2, 0);
    group.add(leftStem);
    if (width > 1.2) {
      const rightStem = leftStem.clone();
      rightStem.position.x *= -1;
      group.add(rightStem);
    }
    this.machine.add(group);

    const record = { code, group, base, baseY: y, baseRotationX: -0.09, depression: 0, phase: -1, action, lower: '', upper: '' };
    group.userData.keyRecord = record;
    base.userData.keyRecord = record;
    this.keys.set(code, record);
    this.clickTargets.push(base);
  }

  buildBellAndDetails() {
    this.bell = new THREE.Group();
    this.bell.name = 'MarginBell';
    this.bell.position.set(3.24, 1.6, -0.58);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.31, 0.34, 32, 1, true), this.materials.brass);
    cup.rotation.x = Math.PI / 2;
    this.bell.add(cup);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.028, 8, 32), this.materials.brass);
    this.bell.add(rim);
    const bellMount = cylinderBetween(new THREE.Vector3(0, 0, -0.2), new THREE.Vector3(0, 0, 0.24), 0.055, this.materials.darkSteel, 12);
    this.bell.add(bellMount);
    this.bellHammer = new THREE.Group();
    const hammerRod = cylinderBetween(new THREE.Vector3(0.35, -0.22, 0), new THREE.Vector3(0.18, 0.02, 0), 0.025, this.materials.steel, 8);
    this.bellHammer.add(hammerRod);
    const hammer = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 10), this.materials.felt);
    hammer.position.set(0.35, -0.22, 0);
    this.bellHammer.add(hammer);
    this.bell.add(this.bellHammer);
    this.machine.add(this.bell);

    const guideCount = Math.floor((3.65 * 2) / 0.48) + 1;
    const keyGuides = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.018, 0.18, 0.34),
      this.materials.darkSteel,
      guideCount,
    );
    keyGuides.name = 'KeyLeverGuideComb';
    const guideMatrix = new THREE.Matrix4();
    for (let i = 0; i < guideCount; i += 1) {
      guideMatrix.makeTranslation(-3.65 + i * 0.48, 0.78, 0.74);
      keyGuides.setMatrixAt(i, guideMatrix);
    }
    keyGuides.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    keyGuides.instanceMatrix.needsUpdate = true;
    this.machine.add(keyGuides);

    this.touchControl = new THREE.Group();
    this.touchControl.name = 'TouchControl';
    this.touchControl.position.set(-3.72, 1.05, 0.2);
    const touchDial = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.17, 28), this.materials.brass);
    touchDial.rotation.z = Math.PI / 2;
    touchDial.userData.specialAction = 'touch-cycle';
    this.touchControl.add(touchDial);
    const touchIndicator = new THREE.Mesh(makeRounded(0.025, 0.14, 0.035, 0.008, 2), this.materials.darkSteel);
    touchIndicator.position.set(-0.095, 0.11, 0);
    touchIndicator.userData.specialAction = 'touch-cycle';
    this.touchControl.add(touchIndicator);
    this.machine.add(this.touchControl);
    this.clickTargets.push(touchDial, touchIndicator);
    this.syncTouchControl();

    const selectorTrack = new THREE.Mesh(makeRounded(0.18, 0.72, 0.08, 0.03, 2), this.materials.agedBrass);
    selectorTrack.position.set(3.62, 1.38, 0.05);
    this.machine.add(selectorTrack);
    this.colorSelector = new THREE.Mesh(new THREE.SphereGeometry(0.11, 18, 12), this.materials.redIndicator);
    this.colorSelector.position.set(3.62, 1.58, 0.1);
    this.colorSelector.userData.specialAction = 'ink-cycle';
    this.machine.add(this.colorSelector);
    this.clickTargets.push(this.colorSelector);

    for (const side of [-1, 1]) {
      const bumper = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.12, 16), this.materials.felt);
      bumper.position.set(side * 4.3, 1.85, -1.25);
      bumper.rotation.z = Math.PI / 2;
      this.machine.add(bumper);
    }
  }

  getTouchCalibration() {
    const presetName = TOUCH_PRESETS[this.touchPreset] ? this.touchPreset : DEFAULT_TOUCH_PRESET;
    return { preset: presetName, ...TOUCH_PRESETS[presetName] };
  }

  setTouchPreset(name, { emit = true } = {}) {
    const presetName = normalizeTouchPresetName(name);
    const preset = TOUCH_PRESETS[presetName];
    this.touchPreset = presetName;
    this.touchForce = preset.force;
    this.syncTouchControl();
    const calibration = this.getTouchCalibration();
    if (emit) {
      this.onChange({ type: 'touch-preset', ...calibration });
      this.onStatus({ type: 'touch-preset', ...calibration });
    }
    return calibration;
  }

  cycleTouchPreset(direction = 1) {
    const step = Number.isFinite(direction) && direction < 0 ? -1 : 1;
    const current = Math.max(0, TOUCH_PRESET_NAMES.indexOf(this.touchPreset));
    const next = (current + step + TOUCH_PRESET_NAMES.length) % TOUCH_PRESET_NAMES.length;
    return this.setTouchPreset(TOUCH_PRESET_NAMES[next]);
  }

  syncTouchControl() {
    if (!this.touchControl) return;
    const positions = { light: -0.34, medium: 0, heavy: 0.34 };
    this.touchControl.rotation.x = positions[this.touchPreset] ?? positions[DEFAULT_TOUCH_PRESET];
    this.touchControl.userData.touchPreset = this.touchPreset ?? DEFAULT_TOUCH_PRESET;
  }

  getTouchControlInteractionSnapshot() {
    return {
      action: 'touch-cycle',
      ...this.getTouchCalibration(),
      presets: [...TOUCH_PRESET_NAMES],
    };
  }

  marginColumnToLocalX(column) {
    const ratio = clamp01(column / this.document.columns);
    return THREE.MathUtils.lerp(-MARGIN_STOP_RAIL_HALF_WIDTH, MARGIN_STOP_RAIL_HALF_WIDTH, ratio);
  }

  marginLocalXToColumn(localX) {
    if (!Number.isFinite(localX)) throw new TypeError('Margin stop position must be finite');
    const ratio = clamp01(
      (localX + MARGIN_STOP_RAIL_HALF_WIDTH) / (MARGIN_STOP_RAIL_HALF_WIDTH * 2),
    );
    return Math.round(ratio * this.document.columns);
  }

  syncMarginStopControls() {
    if (!this.marginStops) return;
    if (this.marginStops.left) {
      this.marginStops.left.position.x = this.marginColumnToLocalX(this.document.leftMargin);
      this.marginStops.left.userData.column = this.document.leftMargin;
    }
    if (this.marginStops.right) {
      this.marginStops.right.position.x = this.marginColumnToLocalX(this.document.rightMargin);
      this.marginStops.right.userData.column = this.document.rightMargin;
    }
  }

  getMarginStopInteractionSnapshot() {
    return {
      left: {
        side: 'left',
        column: this.document.leftMargin,
        localX: this.marginColumnToLocalX(this.document.leftMargin),
        minimumColumn: 0,
        maximumColumn: this.document.rightMargin - 1,
      },
      right: {
        side: 'right',
        column: this.document.rightMargin,
        localX: this.marginColumnToLocalX(this.document.rightMargin),
        minimumColumn: this.document.leftMargin + 1,
        maximumColumn: this.document.columns,
      },
    };
  }

  setMargins(leftMargin, rightMargin, { immediate = true, emit = true } = {}) {
    const result = this.document.setMargins(leftMargin, rightMargin);
    this.syncMarginStopControls();
    this.applyDocumentState(immediate);
    if (emit) {
      this.onChange({ type: 'margins', ...result });
      this.onStatus({ type: 'margins', leftMargin, rightMargin });
    }
    return result;
  }

  setMarginStop(side, column, options = {}) {
    if (side === 'left') return this.setMargins(column, this.document.rightMargin, options);
    if (side === 'right') return this.setMargins(this.document.leftMargin, column, options);
    throw new RangeError('Margin stop side must be left or right');
  }

  setMarginStopFromLocalX(side, localX, options = {}) {
    const requested = this.marginLocalXToColumn(localX);
    const limits = this.getMarginStopInteractionSnapshot()[side];
    if (!limits) throw new RangeError('Margin stop side must be left or right');
    const column = Math.max(limits.minimumColumn, Math.min(limits.maximumColumn, requested));
    return this.setMarginStop(side, column, options);
  }

  setTabStops(stops, { emit = true } = {}) {
    const tabStops = this.document.setTabStops(stops);
    if (emit) {
      this.onChange({ type: 'tab-stops', tabStops });
      this.onStatus({ type: 'tab-stops', tabStops });
    }
    return tabStops;
  }

  setTabStop(column, enabled = true, { emit = true } = {}) {
    const tabStops = this.document.setTabStop(column, enabled);
    if (emit) {
      this.onChange({ type: 'tab-stops', tabStops });
      this.onStatus({ type: 'tab-stops', tabStops });
    }
    return tabStops;
  }

  getMechanicalSettings() {
    return {
      leftMargin: this.document.leftMargin,
      rightMargin: this.document.rightMargin,
      tabStops: this.document.tabStops,
      touchPreset: this.touchPreset ?? DEFAULT_TOUCH_PRESET,
    };
  }

  createCommand(properties) {
    return {
      ...properties,
      sequence: this.commandSequence += 1,
      queuedAt: this.commandClock(),
    };
  }

  enqueueCommand(command, immediateFeedback) {
    immediateFeedback?.();
    command.feedbackAt = this.commandClock();
    this.commandQueue.push(command);
    this.latencyPeakQueueDepth = Math.max(this.latencyPeakQueueDepth, this.commandQueue.length);
    return command;
  }

  queueCharacter(character, code, force = this.touchForce) {
    if (!KEY_BY_CODE.has(code)) return false;
    const calibration = this.getTouchCalibration();
    const impressionForce = Number.isFinite(force) ? clamp01(force) : calibration.force;
    const command = this.createCommand({
      type: 'character',
      character,
      code,
      force: impressionForce,
      soundForce: clamp01(impressionForce * calibration.soundScale),
      impulseScale: calibration.impulseScale,
      keyTravelScale: calibration.keyTravelScale,
      duration: 0.135 * calibration.timingScale,
      impactSeconds: COMMAND_IMPACT_SECONDS * calibration.timingScale,
      releaseSeconds: COMMAND_RELEASE_SECONDS * calibration.timingScale,
      touchPreset: calibration.preset,
    });
    this.enqueueCommand(command, () => {
      this.animateKey(code, 0.12 * calibration.timingScale, calibration.keyTravelScale);
      this.audio.keyDown(command.soundForce);
    });
    return true;
  }

  queueSpace() {
    const command = this.createCommand({ type: 'space', code: 'Space', force: 0.7, duration: 0.115 });
    this.enqueueCommand(command, () => {
      this.animateKey('Space', 0.105);
      this.audio.space();
    });
  }

  queueBackspace() {
    const command = this.createCommand({ type: 'backspace', code: 'Backspace', duration: 0.115 });
    this.enqueueCommand(command, () => {
      this.animateKey('Backspace', 0.105);
      this.audio.backspace();
    });
  }

  queueReturn() {
    this.enqueueCommand(this.createCommand({ type: 'return', code: 'Enter' }));
  }

  queueTab() {
    this.enqueueCommand(this.createCommand({ type: 'tab', code: 'Tab' }));
  }

  resetLatencyMetrics() {
    this.latencySamples.length = 0;
    this.latencyPeakQueueDepth = this.commandQueue.length;
  }

  getLatencySnapshot() {
    const samples = this.latencySamples.slice();
    return {
      sampleCount: samples.length,
      currentQueueDepth: this.commandQueue.length,
      peakQueueDepth: this.latencyPeakQueueDepth,
      feedbackMs: summarizeDurations(samples, 'feedbackMs'),
      startMs: summarizeDurations(samples, 'startMs'),
      impactMs: summarizeDurations(samples, 'impactMs'),
      releaseMs: summarizeDurations(samples, 'releaseMs'),
      completeMs: summarizeDurations(samples, 'completeMs'),
    };
  }

  recordLatencySample(command) {
    if (!Number.isFinite(command.queuedAt) || !Number.isFinite(command.completedAt)) return;
    this.latencySamples.push({
      type: command.type,
      sequence: command.sequence,
      feedbackMs: command.feedbackAt - command.queuedAt,
      startMs: command.startedAt - command.queuedAt,
      impactMs: command.impactedAt - command.queuedAt,
      releaseMs: command.releasedAt - command.queuedAt,
      completeMs: command.completedAt - command.queuedAt,
    });
    if (this.latencySamples.length > LATENCY_SAMPLE_LIMIT) {
      this.latencySamples.splice(0, this.latencySamples.length - LATENCY_SAMPLE_LIMIT);
    }
  }

  triggerMarginRelease() {
    this.marginReleased = true;
    this.marginReleaseTimer = 2.4;
    this.animateKey('MarginRelease', 0.14);
    this.onStatus({ type: 'margin-release' });
  }

  setShiftHeld(held, code = null) {
    const previous = this.shiftHeld;
    if (held) this.shiftHeldCodes.add(code || 'ShiftLeft');
    else if (code) this.shiftHeldCodes.delete(code);
    else this.shiftHeldCodes.clear();
    this.shiftHeld = this.shiftHeldCodes.size > 0;
    if (held && code) this.animateKey(code, 0.15);
    if (previous !== this.shiftHeld) {
      if (!this.shiftHeld && this.shiftLocked) return;
      this.audio.shift(this.shiftHeld || this.shiftLocked);
      this.onStatus({ type: 'shift', active: this.shiftHeld || this.shiftLocked });
    }
  }

  toggleShiftLock() {
    this.shiftLocked = !this.shiftLocked;
    this.animateKey('CapsLock', 0.18);
    this.audio.shift(this.shiftLocked);
    this.onStatus({ type: 'shift-lock', active: this.shiftLocked });
  }

  setInkMode(mode) {
    if (!['black', 'red', 'stencil'].includes(mode)) return;
    this.inkMode = mode;
    const targets = { black: 1.58, red: 1.37, stencil: 1.18 };
    this.colorSelector.position.y = targets[mode];
    this.onChange({ type: 'ink', mode });
  }

  setInspection(enabled) {
    this.inspectionTarget = enabled ? 1 : 0;
    this.onStatus({ type: 'inspection', active: enabled });
  }

  setDocument(documentState, paperRenderer, { animateLoad = true } = {}) {
    const previousTexture = this.materials.paper.map;
    this.document = documentState;
    this.paperRenderer = paperRenderer;
    this.materials.paper.map = paperRenderer.texture;
    this.materials.paper.needsUpdate = true;
    if (previousTexture && previousTexture !== paperRenderer.texture) previousTexture.dispose();
    this.syncMarginStopControls();
    this.applyDocumentState(true);
    if (!animateLoad) {
      this.paperLoading = null;
      this.deformPaper(true);
      return;
    }
    const targetPaperY = this.paperY;
    const targetPlaten = this.platenRotation;
    this.paperY = targetPaperY - 1.05;
    this.platenRotation = targetPlaten - 0.9;
    this.paperLoading = {
      phase: 0,
      duration: 1.15,
      startPaperY: this.paperY,
      targetPaperY,
      startPlaten: this.platenRotation,
      targetPlaten,
    };
    this.deformPaper(true);
  }

  deformPaper(force = false) {
    if (!this.paperMesh || !this.paperRestPositions) return;
    const flex = this.paperResponse?.position ?? 0;
    if (!force && Math.abs(this.paperY - this.lastDeformedPaperY) < 0.00015
      && Math.abs(flex - (this.lastPaperFlex ?? 0)) < 0.00005) return;
    this.lastPaperFlex = flex;
    this.lastDeformedPaperY = this.paperY;
    const geometry = this.paperMesh.geometry;
    const positions = geometry.attributes.position;
    const pageHeight = 7.505;
    const pageHalfWidth = 2.9;
    const typingDistanceFromBottom = pageHeight * (1 - 182 / 1656);
    const platenRadius = 0.407;
    const platenCenterZ = -1.12;
    const printLineY = 2.515;
    const wrapLength = Math.PI * platenRadius;

    for (let i = 0; i < positions.count; i += 1) {
      const sourceIndex = i * 3;
      const x = this.paperRestPositions[sourceIndex];
      const sourceY = this.paperRestPositions[sourceIndex + 1];
      const distanceFromBottom = sourceY + pageHeight / 2;
      const pathDistance = distanceFromBottom - typingDistanceFromBottom + this.paperY;
      const edge = Math.abs(x) / pageHalfWidth;
      const edgeCurl = edge ** 7 * 0.034;
      let y;
      let z;
      if (pathDistance >= 0) {
        y = printLineY + pathDistance;
        z = platenCenterZ + platenRadius - pathDistance * 0.028 + edgeCurl;
        const free = Math.min(1, Math.max(0, (pathDistance - 0.35) / 1.3));
        z += free * free * (0.045 * edge ** 3 + flex * (0.7 + Math.sin(x * 1.4) * 0.3));
      } else if (pathDistance >= -wrapLength) {
        const angle = pathDistance / platenRadius;
        y = printLineY + Math.sin(angle) * platenRadius;
        z = platenCenterZ + Math.cos(angle) * platenRadius + edgeCurl * 0.25;
      } else {
        y = printLineY + (pathDistance + wrapLength);
        z = platenCenterZ - platenRadius + edgeCurl;
      }
      positions.setXYZ(i, x, y, z);
    }
    positions.needsUpdate = true;
    if (this.paperOutline) {
      const edgePositions = this.paperOutline.geometry.attributes.position;
      this.paperEdgeIndices.forEach((source, index) => {
        edgePositions.setXYZ(index, positions.getX(source), positions.getY(source), positions.getZ(source) + 0.001);
      });
      edgePositions.needsUpdate = true;
      this.paperOutline.geometry.computeBoundingSphere();
    }
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
  }

  applyDocumentState(immediate = false) {
    this.carriageTarget = this.dimensions.startCarriageX - this.document.column * this.dimensions.characterPitch;
    const paperTarget = this.dimensions.paperBaseY + this.document.line * this.dimensions.paperLinePitch;
    if (immediate) {
      this.carriagePosition = this.carriageTarget;
      this.paperY = paperTarget;
      if (this.carriage) this.carriage.position.x = this.carriagePosition;
      if (this.paperMesh) this.deformPaper(true);
    }
  }

  animateKey(code, duration = 0.15, travelScale = 1) {
    const key = this.keys.get(code);
    if (!key) return;
    key.phase = 0;
    key.duration = duration;
    key.travelScale = travelScale;
    this.activeKeys.add(key);
  }

  startCommand(command) {
    if (this.paperLoading) return false;
    if (command.type === 'return') {
      if (this.activeStrikes.length || this.returning || this.tabMotion) return false;
      this.startReturn();
      return true;
    }
    if (command.type === 'tab') {
      if (this.activeStrikes.length || this.returning || this.tabMotion) return false;
      this.startTab();
      return true;
    }
    if (this.returning || this.tabMotion) return false;

    command.phase = 0;
    command.elapsed = 0;
    command.impacted = false;
    command.released = false;
    command.startedAt = this.commandClock();
    const timeline = this.strikeTimelineSeconds ?? 0;
    const impactSeconds = command.impactSeconds ?? COMMAND_IMPACT_SECONDS;
    const releaseSeconds = command.releaseSeconds ?? COMMAND_RELEASE_SECONDS;
    const earliestImpact = timeline + impactSeconds;
    // A reservation is meaningful only while another strike is active. Never
    // let an idle machine inherit stale scheduler history from an earlier run.
    const reservedImpact = this.activeStrikes.length
      ? (this.nextMechanicalImpactAt ?? earliestImpact)
      : earliestImpact;
    command.mechanicalImpactAt = Math.max(earliestImpact, reservedImpact);
    command.mechanicalDelay = command.mechanicalImpactAt - earliestImpact;
    command.mechanicalReleaseAt = command.mechanicalImpactAt + (releaseSeconds - impactSeconds);
    this.nextMechanicalImpactAt = command.mechanicalImpactAt + MECHANICAL_IMPACT_SLOT_SECONDS;
    command.blocked = this.document.atMargin && !this.marginReleased && command.type !== 'backspace';
    if (command.type === 'character') {
      command.typebar = this.typebars.get(command.code);
    }
    this.activeStrikes.push(command);
    return true;
  }

  startQueuedCommands() {
    let started = 0;
    while (this.commandQueue.length && started < this.commandBurstLimit) {
      const command = this.commandQueue.shift();
      if (!this.startCommand(command)) {
        this.commandQueue.unshift(command);
        break;
      }
      started += 1;
      if (command.type === 'return' || command.type === 'tab') break;
    }
    return started;
  }

  impactCommand(command) {
    command.impacted = true;
    command.impactedAt = this.commandClock();
    if (command.blocked) {
      this.onStatus({ type: 'margin-lock' });
      return;
    }

    if (command.type === 'character') {
      const result = this.document.type(command.character, {
        ink: this.inkMode,
        force: command.force,
        seed: Math.floor(Math.random() * 0x7fffffff),
      }, this.marginReleased);
      if (!result.accepted) {
        this.onStatus({ type: result.reason });
        return;
      }
      this.paperRenderer.drawImpression(result.impression);
      this.advanceRibbon();
      this.audio.strike(command.soundForce ?? command.force);
      this.machineImpulse += 0.009 * command.force * (command.impulseScale ?? 1);
      this.onStatus({ type: 'impression', character: command.character, ink: this.inkMode });
      command.advanceResult = result;
    } else if (command.type === 'space') {
      const result = this.document.space(this.marginReleased);
      if (result.accepted) command.advanceResult = result;
      else this.onStatus({ type: result.reason });
    } else if (command.type === 'backspace') {
      const result = this.document.backspace();
      this.carriageTarget = this.dimensions.startCarriageX - this.document.column * this.dimensions.characterPitch;
      this.escapeWheel.rotation.z += result.moved ? Math.PI / 12 : 0;
      this.drawbandDrum.rotation.z -= result.moved ? 0.12 : 0;
      this.onStatus({ type: 'backspace', moved: result.moved });
      this.onChange({ type: 'backspace', result });
    }
  }

  releaseCommand(command) {
    if (command.released || command.blocked || !command.impacted) return;
    command.released = true;
    command.releasedAt = this.commandClock();
    if ((command.type === 'character' || command.type === 'space') && command.advanceResult) {
      this.audio.escapement();
      this.afterAdvance(command.advanceResult);
    }
  }

  afterAdvance(result) {
    this.carriageTarget = this.dimensions.startCarriageX - this.document.column * this.dimensions.characterPitch;
    this.escapeWheel.rotation.z -= Math.PI / 12;
    this.drawbandDrum.rotation.z += 0.12;
    this.escapementAmount = 1;
    if (result.bell) {
      this.audio.bell();
      this.bellAmount = 1;
      this.onStatus({ type: 'bell' });
    }
    if (result.marginReached) this.onStatus({ type: 'margin-reached' });
    this.onChange({ type: 'advance', result });
  }

  advanceRibbon() {
    const previous = this.ribbonPosition;
    this.ribbonPosition += this.ribbonDirection * 0.0042;
    if (this.ribbonPosition >= 0.975 || this.ribbonPosition <= 0.025) {
      this.ribbonPosition = THREE.MathUtils.clamp(this.ribbonPosition, 0.025, 0.975);
      this.ribbonDirection *= -1;
      this.audio.ribbonReverse();
      this.onStatus({ type: 'ribbon-reverse', direction: this.ribbonDirection });
    }
    const delta = Math.abs(this.ribbonPosition - previous);
    this.ribbonTurns += delta * 18 * this.ribbonDirection;
  }

  reverseRibbonManually() {
    this.ribbonDirection *= -1;
    this.audio.ribbonReverse();
    this.onStatus({ type: 'ribbon-reverse', direction: this.ribbonDirection, manual: true });
    this.onChange({ type: 'ribbon-direction', direction: this.ribbonDirection });
  }

  startReturn() {
    const startX = this.carriagePosition;
    const result = this.document.carriageReturn();
    const endX = this.dimensions.startCarriageX - this.document.column * this.dimensions.characterPitch;
    const distanceRatio = clamp01(result.previousColumn / this.document.rightMargin);
    const duration = 0.5 + distanceRatio * 0.55;
    this.returning = {
      phase: 0,
      duration,
      startX,
      endX,
      startPaperY: this.paperY,
      endPaperY: this.dimensions.paperBaseY + this.document.line * this.dimensions.paperLinePitch,
      startPlaten: this.platenRotation,
      endPlaten: this.platenRotation - this.document.lineSpacing * 0.255,
    };
    this.audio.carriageReturn(distanceRatio);
    this.onStatus({ type: 'return-start', line: this.document.line });
    this.onChange({ type: 'return', result });
  }

  startTab() {
    const startX = this.carriagePosition;
    const result = this.document.tab(null, this.marginReleased);
    if (!result.accepted) {
      this.onStatus({ type: result.reason });
      return;
    }
    const endX = this.dimensions.startCarriageX - this.document.column * this.dimensions.characterPitch;
    const distance = Math.abs(endX - startX);
    this.tabMotion = { phase: 0, duration: 0.18 + distance * 0.09, startX, endX, result };
    this.animateKey('Tab', 0.16);
    this.audio.tab(distance / 4.6);
    if (result.bell) {
      this.audio.bell();
      this.bellAmount = 1;
    }
    this.onChange({ type: 'tab', result });
    this.onStatus({ type: 'tab', column: this.document.column });
  }

  update(delta) {
    const finiteDelta = Number.isFinite(delta) ? delta : 0;
    const dt = Math.max(0, Math.min(0.04, finiteDelta));
    this.lastDelta = dt;
    this.surfaceTime = (this.surfaceTime ?? 0) + dt;
    if (this.marginReleaseTimer > 0) {
      this.marginReleaseTimer -= dt;
      if (this.marginReleaseTimer <= 0) this.marginReleased = false;
    }

    this.startQueuedCommands();

    this.updateKeys(dt);
    this.updateStrikes(dt);
    this.updateReturn(dt);
    this.updateTab(dt);
    this.updatePaperLoading(dt);
    this.updateMechanisms(dt);
  }

  updateKeys(dt) {
    for (const key of this.activeKeys) {
      let amount = 0;
      if (key.phase >= 0) {
        key.phase += dt / (key.duration || 0.15);
        amount = Math.sin(Math.PI * clamp01(key.phase));
        if (key.phase >= 1) key.phase = -1;
      }
      if ((key.code === 'ShiftLeft' || key.code === 'ShiftRight') && this.shiftHeldCodes.has(key.code)) amount = Math.max(amount, 0.72);
      if (key.code === 'CapsLock' && this.shiftLocked) amount = Math.max(amount, 0.54);
      key.depression = damp(key.depression, amount, 30, dt);
      const travelScale = key.travelScale ?? 1;
      key.group.position.y = key.baseY
        - key.depression * (key.action === 'space' ? SPACE_KEY_TRAVEL : STANDARD_KEY_TRAVEL) * travelScale;
      key.group.rotation.x = key.baseRotationX - key.depression * KEY_PRESS_ROTATION * travelScale;
      if (key.lever) {
        TMP_A.copy(key.leverStart);
        TMP_A.y -= key.depression * 0.095;
        placeCylinder(key.lever, TMP_A, key.leverEnd);
        TMP_B.copy(key.leverEnd);
        TMP_B.y += key.depression * 0.08;
        TMP_B.z -= key.depression * 0.1;
        TMP_C.copy(key.linkEndBase);
        TMP_C.y += (key.typebar?.amount ?? 0) * 0.045;
        TMP_C.z -= (key.typebar?.amount ?? 0) * 0.12;
        placeCylinder(key.link, TMP_B, TMP_C);
      }
      const held = (key.code === 'ShiftLeft' || key.code === 'ShiftRight') && this.shiftHeldCodes.has(key.code);
      const locked = key.code === 'CapsLock' && this.shiftLocked;
      if (key.phase < 0 && !held && !locked && key.depression < 0.002) {
        key.depression = 0;
        key.group.position.y = key.baseY;
        this.activeKeys.delete(key);
      }
    }
  }

  updateStrikes(dt) {
    this.strikeTimelineSeconds = (this.strikeTimelineSeconds ?? 0) + dt;
    const timeline = this.strikeTimelineSeconds;
    let maximumReach = 0;
    let escapementCycle = 0;
    const completed = [];
    const typebarReach = new Map();
    const states = this.activeStrikes.map((command) => {
      command.elapsed += dt;
      const motionElapsed = Math.max(0, command.elapsed - (command.mechanicalDelay ?? 0));
      command.phase = motionElapsed / command.duration;
      const phase = clamp01(command.phase);
      const rawReach = command.blocked ? 0 : strikeReach(phase);
      return { command, motionElapsed, phase, rawReach };
    });

    let finalReachOwner = null;
    let ownerDistance = Number.POSITIVE_INFINITY;
    for (const state of states) {
      if (!state.command.typebar || state.rawReach <= 0.82) continue;
      const distance = Math.abs(timeline - state.command.mechanicalImpactAt);
      if (distance < ownerDistance || (distance === ownerDistance && (!finalReachOwner || state.command.sequence < finalReachOwner.command.sequence))) {
        finalReachOwner = state;
        ownerDistance = distance;
      }
    }

    for (const state of states) {
      const { command, phase, rawReach } = state;
      const reach = command.typebar && rawReach > 0.82 && state !== finalReachOwner
        ? TYPEBAR_SECONDARY_REACH_LIMIT
        : rawReach;
      maximumReach = Math.max(maximumReach, reach);
      if (!command.blocked && (command.type === 'character' || command.type === 'space')) {
        escapementCycle = Math.max(escapementCycle, phase);
      }
      if (command.typebar) {
        typebarReach.set(command.typebar, Math.max(typebarReach.get(command.typebar) ?? 0, reach));
      }
      if (!command.impacted && timeline >= command.mechanicalImpactAt) this.impactCommand(command);
      if (!command.released && timeline >= command.mechanicalReleaseAt) this.releaseCommand(command);
      if (phase >= 1) {
        this.releaseCommand(command);
        command.completedAt = this.commandClock();
        this.recordLatencySample(command);
        completed.push(command);
      }
    }
    for (const [typebar, reach] of typebarReach) {
      typebar.amount = reach;
      this.positionTypebar(typebar, reach);
    }
    if (completed.length) {
      const finished = new Set(completed);
      this.activeStrikes = this.activeStrikes.filter((command) => !finished.has(command));
    }
    this.universalAmount = damp(this.universalAmount, maximumReach, 34, dt);
    this.escapementCycle = escapementCycle;
  }

  positionTypebar(typebar, amount) {
    TMP_Q.copy(typebar.strikeQuaternion).slerp(typebar.shiftedStrikeQuaternion, this.shiftAmount);
    typebar.group.quaternion.copy(typebar.restQuaternion).slerp(TMP_Q, amount);
  }

  updateReturn(dt) {
    if (!this.returning) return;
    const motion = this.returning;
    motion.phase += dt / motion.duration;
    const phase = clamp01(motion.phase);
    const feedPhase = easeInOutCubic(clamp01(phase / 0.42));
    const returnPhase = easeInOutCubic(clamp01((phase - 0.06) / 0.88));
    this.carriagePosition = THREE.MathUtils.lerp(motion.startX, motion.endX, returnPhase);
    this.paperY = THREE.MathUtils.lerp(motion.startPaperY, motion.endPaperY, feedPhase);
    this.platenRotation = THREE.MathUtils.lerp(motion.startPlaten, motion.endPlaten, feedPhase);
    this.returnLever.rotation.z = -Math.sin(Math.PI * phase) * 0.52;
    if (phase >= 1) {
      this.carriageTarget = motion.endX;
      this.returning = null;
      this.returnLever.rotation.z = 0;
      this.onStatus({ type: 'return-complete', line: this.document.line });
    }
  }

  updateTab(dt) {
    if (!this.tabMotion) return;
    const motion = this.tabMotion;
    motion.phase += dt / motion.duration;
    const phase = clamp01(motion.phase);
    this.carriagePosition = THREE.MathUtils.lerp(motion.startX, motion.endX, easeInOutCubic(phase));
    this.escapeWheel.rotation.z -= dt * 22;
    if (phase >= 1) {
      this.carriageTarget = motion.endX;
      this.tabMotion = null;
      if (motion.result.marginReached) this.onStatus({ type: 'margin-reached' });
    }
  }

  updatePaperLoading(dt) {
    if (!this.paperLoading) return;
    const motion = this.paperLoading;
    motion.phase += dt / motion.duration;
    const phase = easeInOutCubic(clamp01(motion.phase));
    this.paperY = THREE.MathUtils.lerp(motion.startPaperY, motion.targetPaperY, phase);
    this.platenRotation = THREE.MathUtils.lerp(motion.startPlaten, motion.targetPlaten, phase);
    if (motion.phase >= 1) {
      this.paperY = motion.targetPaperY;
      this.platenRotation = motion.targetPlaten;
      this.paperLoading = null;
      this.onStatus({ type: 'paper-loaded' });
    }
  }

  updateMechanisms(dt) {
    const shifted = this.shiftHeld || this.shiftLocked;
    this.shiftAmount = damp(this.shiftAmount, shifted ? 1 : 0, shifted ? 19 : 24, dt);
    this.basketGroup.position.y = -this.shiftAmount * 0.105;
    for (const shiftLink of this.shiftLinks) {
      TMP_A.copy(shiftLink.end);
      TMP_A.y -= this.shiftAmount * 0.105;
      placeCylinder(shiftLink.link, shiftLink.start, TMP_A);
    }

    const ribbonLift = this.inkMode === 'stencil' ? 0 : this.universalAmount * (this.inkMode === 'red' ? 0.35 : 0.24);
    this.vibrator.position.y = 2.23 + ribbonLift;
    this.universalBar.position.y = 0.82 - this.universalAmount * 0.075;
    const flutter = this.reducedMotion ? 0 : Math.sin((this.surfaceTime ?? 0) * 46) * this.universalAmount * 0.007;
    this.ribbonPath[1].y = 1.72 + ribbonLift * 0.16 + flutter;
    this.ribbonPath[2].y = 2.23 + ribbonLift;
    this.ribbonPath[3].y = 2.23 + ribbonLift;
    this.ribbonPath[4].y = 1.72 + ribbonLift * 0.16 - flutter;
    updateBichromeRibbon(this.ribbonStrip, this.ribbonPath);

    const shellOpacity = THREE.MathUtils.lerp(1, 0.12, this.inspectionAmount);
    this.inspectionAmount = damp(this.inspectionAmount, this.inspectionTarget, 7, dt);
    for (const mesh of this.shellMeshes) {
      mesh.material.opacity = shellOpacity;
      mesh.material.depthWrite = this.inspectionAmount < 0.55;
    }
    if (this.topCover) {
      const restAngle = 0.035;
      const hingeAngle = restAngle + this.inspectionAmount * 0.68;
      const hingeRadius = 0.86;
      this.topCover.rotation.x = -hingeAngle;
      this.topCover.position.y = 2.03 + (Math.sin(hingeAngle) - Math.sin(restAngle)) * hingeRadius;
      this.topCover.position.z = -0.4 + (Math.cos(hingeAngle) - Math.cos(restAngle)) * hingeRadius;
    }

    if (!this.returning && !this.tabMotion) {
      this.carriagePosition = damp(this.carriagePosition, this.carriageTarget, 31, dt);
    }
    this.carriage.position.x = this.carriagePosition;
    this.paperResponse = stepPaperResponse(this.paperResponse ?? {}, {
      delta: dt,
      carriageDelta: this.carriagePosition - (this.previousSurfaceCarriage ?? this.carriagePosition),
      feedDelta: this.paperY - (this.previousSurfaceFeed ?? this.paperY),
      impact: this.machineImpulse,
      reducedMotion: this.reducedMotion,
    });
    this.previousSurfaceCarriage = this.carriagePosition;
    this.previousSurfaceFeed = this.paperY;
    this.drawbandEnd.x = this.carriagePosition - 3.6;
    placeCylinder(this.drawband, this.drawbandStart, this.drawbandEnd);
    this.drawbandDrum.rotation.z = (this.dimensions.startCarriageX - this.carriagePosition) * 1.55;
    this.deformPaper();
    this.platenSpin.rotation.x = this.platenRotation;
    this.lineRatchet.rotation.x = this.platenRotation;
    for (const roller of this.bailRollers) roller.rotation.x = -this.paperY / 0.12;
    for (const roller of this.feedRollers) roller.rotation.x = -this.paperY / 0.12;
    const lineFeedPhase = this.returning ? clamp01(this.returning.phase / 0.42) : 0;
    this.linePawl.rotation.x = -Math.sin(lineFeedPhase * Math.PI) * 0.46;

    this.escapementAmount = damp(this.escapementAmount, 0, 22, dt);
    const cycle = this.escapementCycle;
    const fixedExchange = cycle <= 0
      ? 0
      : cycle < 0.3 ? easeOutCubic(cycle / 0.3)
        : cycle < 0.62 ? 1
          : cycle < 0.79 ? 1 - (cycle - 0.62) / 0.17 : 0;
    const looseExchange = cycle < 0.36
      ? 0
      : cycle < 0.56 ? (cycle - 0.36) / 0.2
        : cycle < 0.72 ? 1
          : cycle < 0.9 ? 1 - (cycle - 0.72) / 0.18 : 0;
    this.fixedDog.rotation.z = -0.34 + Math.max(fixedExchange, this.escapementAmount * 0.18) * 0.3;
    this.looseDog.rotation.z = 0.34 - Math.max(looseExchange, this.escapementAmount * 0.14) * 0.23;

    const leftRadius = 0.25 + (1 - this.ribbonPosition) * 0.28;
    const rightRadius = 0.25 + this.ribbonPosition * 0.28;
    this.spools[0].rotation.y = this.ribbonTurns;
    this.spools[1].rotation.y = -this.ribbonTurns;
    this.spools[0].userData.pack.scale.set(leftRadius / 0.48, 1, leftRadius / 0.48);
    this.spools[1].userData.pack.scale.set(rightRadius / 0.48, 1, rightRadius / 0.48);

    this.bellAmount = damp(this.bellAmount, 0, 15, dt);
    this.bellHammer.rotation.z = Math.sin(this.bellAmount * Math.PI * 5) * this.bellAmount * 0.58;

    this.machineImpulse = damp(this.machineImpulse, 0, 20, dt);
    this.machine.position.y = this.reducedMotion ? 0 : Math.sin((this.surfaceTime ?? 0) * 45) * this.machineImpulse;
  }

  commandFromPointer(keyRecord) {
    if (!keyRecord) return false;
    switch (keyRecord.action) {
      case 'character': {
        const shifted = this.shiftHeld || this.shiftLocked;
        this.queueCharacter(shifted ? keyRecord.upper : keyRecord.lower, keyRecord.code);
        return true;
      }
      case 'space': this.queueSpace(); return true;
      case 'backspace': this.queueBackspace(); return true;
      case 'tab': this.queueTab(); return true;
      case 'caps': this.toggleShiftLock(); return true;
      case 'shift': this.setShiftHeld(!this.shiftHeldCodes.has(keyRecord.code), keyRecord.code); return true;
      case 'margin': this.triggerMarginRelease(); return true;
      default: return false;
    }
  }

  getKeyShellClearanceSnapshot({ sweepSteps = CLEARANCE_SWEEP_STEPS, travelScale = 1 } = {}) {
    if (!Number.isFinite(travelScale) || travelScale <= 0) {
      throw new RangeError('Key travel scale must be a positive finite number');
    }
    const unsupportedShells = [];
    const shells = this.shellMeshes
      .map((mesh) => {
        const shape = mesh.geometry?.userData?.clearanceShape;
        if (!shape || shape.type !== 'rounded-box') {
          unsupportedShells.push(mesh.name || 'UnnamedShell');
          return null;
        }
        mesh.updateMatrix();
        const restMatrix = mesh.userData.clearanceRestMatrix ?? mesh.matrix;
        return {
          name: mesh.name || 'UnnamedShell',
          shape,
          inverseRestMatrix: restMatrix.clone().invert(),
        };
      })
      .filter(Boolean);

    const inspect = (depressionAmount) => {
      const intersections = [];
      let minimumClearance = Number.POSITIVE_INFINITY;
      let closest = null;
      for (const key of this.keys.values()) {
        for (const shell of shells) {
          let pairClearance = Number.POSITIVE_INFINITY;
          for (const object of keyTopObjects(key)) {
            const objectToMachine = hypotheticalKeyObjectMatrix(key, object, depressionAmount, travelScale);
            const objectToShell = shell.inverseRestMatrix.clone().multiply(objectToMachine);
            pairClearance = Math.min(
              pairClearance,
              minimumGeometryDistanceToRoundedBox(object.geometry, objectToShell, shell.shape),
            );
          }
          if (pairClearance < minimumClearance) {
            minimumClearance = pairClearance;
            closest = { key: key.code, shell: shell.name, clearance: pairClearance };
          }
          if (pairClearance < -CLEARANCE_INTERSECTION_EPSILON) {
            intersections.push({ key: key.code, shell: shell.name, clearance: pairClearance });
          }
        }
      }
      return {
        intersections,
        minimumClearance,
        // Compatibility alias for early diagnostics. Intersections use shell-
        // local signed distances; definitely separated pairs use a conservative
        // bounding-box lower bound, so this cannot overstate safe clearance.
        minimumAxisGap: Math.max(0, minimumClearance),
        closest,
      };
    };

    const sweepIntersections = new Map();
    let sweepMinimumClearance = Number.POSITIVE_INFINITY;
    let sweepClosest = null;
    const boundedSweepSteps = Math.max(1, Math.floor(sweepSteps));
    let rest = null;
    let depressed = null;
    for (let step = 0; step <= boundedSweepSteps; step += 1) {
      const depressionAmount = step / boundedSweepSteps;
      const sample = inspect(depressionAmount);
      if (step === 0) rest = sample;
      if (step === boundedSweepSteps) depressed = sample;
      if (sample.minimumClearance < sweepMinimumClearance) {
        sweepMinimumClearance = sample.minimumClearance;
        sweepClosest = { ...sample.closest, depressionAmount };
      }
      for (const intersection of sample.intersections) {
        const id = `${intersection.key}:${intersection.shell}`;
        const previous = sweepIntersections.get(id);
        if (!previous || intersection.clearance < previous.clearance) {
          sweepIntersections.set(id, { ...intersection, depressionAmount });
        }
      }
    }

    return {
      unsupportedShells,
      rest,
      depressed,
      sweep: {
        sampleCount: boundedSweepSteps + 1,
        intersections: [...sweepIntersections.values()],
        minimumClearance: sweepMinimumClearance,
        closest: sweepClosest,
      },
    };
  }

  getKeyNeighborClearanceSnapshot(pairs = DEFAULT_NEIGHBOR_KEY_PAIRS) {
    const reports = [];
    for (const [firstCode, secondCode] of pairs) {
      const first = this.keys.get(firstCode);
      const second = this.keys.get(secondCode);
      if (!first || !second) {
        reports.push({ keys: [firstCode, secondCode], error: 'missing-key' });
        continue;
      }

      const target = second.base?.geometry?.userData?.clearanceShape ? second
        : first.base?.geometry?.userData?.clearanceShape ? first : null;
      const source = target === second ? first : second;
      const targetObject = target?.base;
      if (!keyTopObjects(first).length || !keyTopObjects(second).length) {
        reports.push({ keys: [firstCode, secondCode], error: 'missing-key-top' });
        continue;
      }

      const shape = targetObject?.geometry?.userData?.clearanceShape;
      let minimumClearance = Number.POSITIVE_INFINITY;
      let closest = null;
      for (let firstStep = 0; firstStep <= NEIGHBOR_SWEEP_STEPS; firstStep += 1) {
        for (let secondStep = 0; secondStep <= NEIGHBOR_SWEEP_STEPS; secondStep += 1) {
          const firstDepression = firstStep / NEIGHBOR_SWEEP_STEPS;
          const secondDepression = secondStep / NEIGHBOR_SWEEP_STEPS;
          if (target && targetObject && shape) {
            const sourceDepression = source === first ? firstDepression : secondDepression;
            const targetDepression = target === first ? firstDepression : secondDepression;
            const targetToMachine = hypotheticalKeyObjectMatrix(target, targetObject, targetDepression);
            const machineToTarget = targetToMachine.clone().invert();
            for (const object of keyTopObjects(source)) {
              const objectToTarget = machineToTarget.clone().multiply(
                hypotheticalKeyObjectMatrix(source, object, sourceDepression),
              );
              const clearance = minimumGeometryDistanceToRoundedBox(object.geometry, objectToTarget, shape);
              if (clearance < minimumClearance) {
                minimumClearance = clearance;
                closest = { firstDepression, secondDepression };
              }
            }
          } else {
            const sample = minimumKeyTopBoundsClearance(
              first,
              second,
              firstDepression,
              secondDepression,
            );
            if (sample.clearance < minimumClearance) {
              minimumClearance = sample.clearance;
              closest = { firstDepression, secondDepression, ...sample.closest };
            }
          }
        }
      }
      reports.push({
        keys: [firstCode, secondCode],
        minimumClearance,
        collision: minimumClearance < -CLEARANCE_INTERSECTION_EPSILON,
        closest,
      });
    }
    return {
      sampleCountPerPair: (NEIGHBOR_SWEEP_STEPS + 1) ** 2,
      pairs: reports,
      intersections: reports.filter((report) => report.collision),
    };
  }

  get busy() {
    return Boolean(this.returning || this.tabMotion || this.paperLoading || this.activeStrikes.length || this.commandQueue.length);
  }
}
