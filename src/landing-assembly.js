import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { TypewriterDocument } from './typewriter-document.js';
import { CHARACTER_KEYS, TypewriterModel } from './typewriter-model.js';

const ASSEMBLY_SECONDS = 4.6;
const IDENTITY = new THREE.Quaternion();
const VIEW_DIRECTION = new THREE.Vector3(0.42, 0.34, 0.84).normalize();
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const smooth = (value) => {
  const t = clamp01(value);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

// These are presentation carriers around the existing authored model. No
// machine geometry, materials, key records, or mechanical code is duplicated.
export function createLandingAssemblyParts(model) {
  const machine = model.machine;
  machine.updateWorldMatrix(true, true);
  const originals = [];
  machine.traverse((object) => {
    if (object.isMesh || object.isLine) originals.push({ object, world: object.matrixWorld.clone() });
  });
  const originalChildren = [...machine.children];
  const used = new Set();
  const parts = [];
  const add = (name, objects, offset, rotation, delay, duration = 2.3) => {
    const nodes = objects.filter((object) => object && !used.has(object));
    if (!nodes.length) return null;
    const carrier = new THREE.Group();
    carrier.name = `LandingAssembly_${name}`;
    machine.add(carrier);
    const bounds = new THREE.Box3();
    for (const object of nodes) {
      used.add(object);
      bounds.union(new THREE.Box3().setFromObject(object));
      carrier.attach(object);
    }
    const pivot = bounds.isEmpty() ? new THREE.Vector3() : machine.worldToLocal(bounds.getCenter(new THREE.Vector3()));
    const part = {
      name,
      carrier,
      nodes,
      pivot,
      offset: new THREE.Vector3(...offset),
      rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
      delay,
      duration,
      instances: [],
      progress: 0,
    };
    parts.push(part);
    return part;
  };
  const named = (...names) => names.map((name) => machine.getObjectByName(name));
  const unclaimed = (objects) => objects.filter((object) => !used.has(object));

  add('casting', [
    ...named('CastBase', 'RearCastBase'),
    ...originalChildren.filter((object) => object.isMesh && object.material === model.materials.rubber && object.position.y < 0.12),
  ], [0, 0.28, 0.1], [0.035, 0, 0], 0, 1.8);
  add('front-rail', [
    ...named('OpenKeyboardFrontRail', 'Octoberline211Badge'),
    ...originalChildren.filter((object) => object.isMesh && object.position.z > 3.05 && !object.name.startsWith('Key')),
  ], [0, 0.15, 1.65], [-0.08, 0, 0], 0.15, 2.1);
  for (const [side, label] of [[-1, 'Left'], [1, 'Right']]) {
    add(`side-${label.toLowerCase()}`, [
      ...named(`RearCheek${label}`, `KeyboardSill${label}`),
      ...originalChildren.filter((object) => object.isMesh && Math.abs(object.position.x - side * 4.355) < 0.02),
    ], [side * 1.7, 0.3, 0.1], [0.03, side * 0.12, side * 0.06], 0.36 + (side > 0 ? 0.15 : 0));
  }
  add('rear-cover', named('RearMechanismCover'), [0, 1.05, -1.25], [0.13, 0, 0], 0.75, 2.4);
  add('ribbon-cover', named('RibbonCover'), [0, 2.2, -0.4], [-0.2, 0.045, 0], 1.65, 2.65);
  add('type-basket', [model.basketGroup], [0, 1.05, 0.9], [0.16, 0, 0], 0.42, 2.35);
  add('ribbon-spool-left', [model.spools[0]], [-0.75, 1.55, 0.1], [0.1, -0.3, -0.06], 0.78, 2.5);
  add('ribbon-spool-right', [model.spools[1]], [0.75, 1.55, 0.1], [0.1, 0.3, 0.06], 0.95, 2.5);
  add('ribbon-feed', [
    ...unclaimed([...model.ribbonSystem.children]),
    model.vibrator,
    ...originalChildren.filter((object) => object.isMesh && Math.abs(object.position.x) < 0.14 && object.position.y > 2.35),
  ], [0, 1.3, 0.25], [0.08, 0, 0], 1.18, 2.5);

  const carriageChildren = [...model.carriage.children];
  add('platen', [model.platenSpin], [0, 1.8, -1.05], [0.14, 0, -0.045], 1, 2.55);
  add('paper', [model.paperMesh], [0, 2.35, -0.6], [-0.09, 0.055, -0.025], 1.85, 2.75);
  add('return-mechanism', [model.returnLever, model.lineRatchet, model.linePawl], [-1.35, 0.8, 0], [0, -0.09, -0.16], 1.28, 2.4);
  add('carriage-frame', [
    ...unclaimed(carriageChildren),
    ...originalChildren.filter((object) => object.name === 'CarriageRail'),
  ], [0, 1.1, -1.3], [0.045, 0.025, 0], 0.7, 2.45);

  const specialRows = [['Backspace'], ['Tab'], ['CapsLock', 'MarginRelease'], ['ShiftLeft', 'ShiftRight']];
  CHARACTER_KEYS.forEach((row, rowIndex) => {
    const records = [...row.map(([code]) => model.keys.get(code)), ...specialRows[rowIndex].map((code) => model.keys.get(code))];
    const part = add(`key-row-${rowIndex + 1}`, records.flatMap((key) => [key.group, key.lever, key.link]),
      [rowIndex % 2 ? 0.12 : -0.12, 1.1 - rowIndex * 0.17, 1.55 + rowIndex * 0.17],
      [-0.09 - rowIndex * 0.012, 0, 0], 0.55 + rowIndex * 0.2, 2.5);
    // The five opaque keyboard batches stay batched. A row transform is
    // multiplied into each original instance matrix, exactly matching labels.
    for (const [code] of row) {
      const index = model.keyRenderIndexByCode.get(code);
      for (const { mesh } of model.keyRenderBatches) {
        const rest = new THREE.Matrix4();
        mesh.getMatrixAt(index, rest);
        part.instances.push({ mesh, index, rest });
      }
    }
  });
  add('space-bar', [model.keys.get('Space').group], [0, 0.4, 2.25], [-0.1, 0, 0], 1.25, 2.5);
  add('escapement', [model.escapement, model.drawband], [1.1, 0.75, -0.65], [0.08, 0.16, 0.05], 0.4, 2.2);
  const structuralGroups = new Set([model.carriage, model.ribbonSystem]);
  const keyboardBatches = new Set(model.keyRenderBatches.map(({ mesh }) => mesh));
  add('mechanical-details', unclaimed(originalChildren).filter((object) => !structuralGroups.has(object) && !keyboardBatches.has(object)),
    [0, 0.8, 0.6], [0.06, 0, 0], 0.6, 2.6);

  const instanceMatrix = new THREE.Matrix4();
  const turnedPivot = new THREE.Vector3();
  return {
    parts,
    originals,
    setTime(seconds) {
      const changedBatches = new Set();
      for (const part of parts) {
        part.progress = seconds >= ASSEMBLY_SECONDS ? 1 : smooth((seconds - part.delay) / part.duration);
        const amount = 1 - part.progress;
        part.carrier.quaternion.slerpQuaternions(IDENTITY, part.rotation, amount);
        turnedPivot.copy(part.pivot).applyQuaternion(part.carrier.quaternion);
        part.carrier.position.copy(part.pivot).sub(turnedPivot).addScaledVector(part.offset, amount);
        part.carrier.updateMatrix();
        for (const instance of part.instances) {
          instanceMatrix.multiplyMatrices(part.carrier.matrix, instance.rest);
          instance.mesh.setMatrixAt(instance.index, instanceMatrix);
          changedBatches.add(instance.mesh);
        }
      }
      for (const mesh of changedBatches) mesh.instanceMatrix.needsUpdate = true;
      machine.updateWorldMatrix(true, true);
    },
    getRestError() {
      machine.updateWorldMatrix(true, true);
      let maximum = 0;
      for (const { object, world } of originals) {
        for (let i = 0; i < 16; i++) maximum = Math.max(maximum, Math.abs(object.matrixWorld.elements[i] - world.elements[i]));
      }
      for (const part of parts) {
        for (const instance of part.instances) {
          instance.mesh.getMatrixAt(instance.index, instanceMatrix);
          for (let i = 0; i < 16; i++) maximum = Math.max(maximum, Math.abs(instanceMatrix.elements[i] - instance.rest.elements[i]));
        }
      }
      return maximum;
    },
  };
}

export function disposeLandingScene(scene, materials = {}) {
  const geometries = new Set();
  const materialSet = new Set(Object.values(materials));
  const textures = new Set();
  const instances = new Set();
  let shadowTargets = 0;
  // Traverse hidden studio pieces and interaction proxies too. Some geometry is
  // held in the model's cache; dispose its renderer allocation before the real
  // app is allowed to construct a new machine using that cached CPU geometry.
  scene?.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material) materialSet.add(material);
    }
    if (object.isInstancedMesh) instances.add(object);
    if (object.shadow) {
      if (object.shadow.map) shadowTargets += 1;
      if (object.shadow.mapPass) shadowTargets += 1;
      object.shadow.dispose();
    }
  });
  for (const material of materialSet) {
    for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
  }
  for (const mesh of instances) mesh.dispose();
  for (const geometry of geometries) geometry.dispose();
  for (const texture of textures) texture.dispose();
  for (const material of materialSet) material.dispose();
  scene?.clear();
  return { geometries: geometries.size, materials: materialSet.size, textures: textures.size, instanceBuffers: instances.size, shadowTargets };
}

function makePreviewPaper() {
  const canvas = document.createElement('canvas');
  canvas.width = 576;
  canvas.height = 768;
  const context = canvas.getContext('2d');
  context.fillStyle = '#e8dec4';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const wash = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  wash.addColorStop(0, 'rgba(255,250,227,.24)');
  wash.addColorStop(1, 'rgba(147,110,64,.06)');
  context.fillStyle = wash;
  context.fillRect(0, 0, canvas.width, canvas.height);
  let seed = 211;
  for (let i = 0; i < 1500; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const x = seed % canvas.width;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const y = seed % canvas.height;
    context.fillStyle = i % 3 ? 'rgba(89,64,35,.025)' : 'rgba(255,252,236,.13)';
    context.fillRect(x, y, 1, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { texture };
}

function fitDistance(bounds, target, aspect, fov) {
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), VIEW_DIRECTION).normalize();
  const up = new THREE.Vector3().crossVectors(VIEW_DIRECTION, right).normalize();
  const tan = Math.tan(THREE.MathUtils.degToRad(fov / 2));
  const point = new THREE.Vector3();
  let distance = 0;
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        point.set(x, y, z).sub(target);
        const depth = point.dot(VIEW_DIRECTION);
        distance = Math.max(distance, Math.abs(point.dot(right)) / (tan * aspect) + depth, Math.abs(point.dot(up)) / tan + depth);
      }
    }
  }
  return distance * 1.04;
}

/** Optional, isolated decorative preview. The immediately usable HTML shell
 * never waits on it. dispose() is synchronous, idempotent, and also settles
 * ready while a driver is still completing asynchronous shader compilation. */
export function startLandingAssembly({ container, landing }) {
  let phase = 'preparing';
  let disposed = false;
  let renderer = null;
  let scene = null;
  let camera = null;
  let model = null;
  let assembly = null;
  let reflection = null;
  let paper = null;
  let canvas = null;
  let frame = 0;
  let idle = 0;
  let timer = 0;
  let elapsed = 0;
  let lastTime = null;
  let lastRender = -Infinity;
  let frameCount = 0;
  let firstRenderAt = null;
  const renderTimeline = [];
  let readyResolved = false;
  let resizeObserver = null;
  let error = null;
  let released = null;
  let restBounds = null;
  let openBounds = null;
  let warmKey = null;
  let finalDistance = 18;
  let openDistance = 21;
  const target = new THREE.Vector3(0, 2.25, 0.3);
  const cameraDirection = new THREE.Vector3();
  const motionQuery = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  let reducedMotion = motionQuery?.matches ?? false;
  const pendingPaints = new Map();
  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });

  const setPhase = (value) => {
    phase = value;
    if (container) container.dataset.assemblyState = value;
  };
  const rendererState = () => renderer ? {
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    pixelRatio: renderer.getPixelRatio(),
    contextLost: renderer.getContext().isContextLost(),
  } : null;
  let lastRendererState = null;
  let lastAssemblyState = null;
  const assemblyState = () => assembly ? {
    groupCount: assembly.parts.length,
    groups: assembly.parts.map(({ name, nodes, instances, progress }) => ({ name, nodes: nodes.length, instances: instances.length, progress })),
    keyInstanceCount: assembly.parts.reduce((count, part) => count + part.instances.length, 0),
    meshCount: assembly.originals.length,
    restTransformError: assembly.getRestError(),
  } : lastAssemblyState ?? { groupCount: 0, groups: [], keyInstanceCount: 0, meshCount: 0, restTransformError: null };
  const getState = () => ({
    phase,
    disposed,
    reducedMotion,
    progress: clamp01(elapsed / ASSEMBLY_SECONDS),
    ...assemblyState(),
    frameCount,
    firstRenderAt,
    // Bounded measurements of real renderer submissions, not an unrelated RAF
    // probe. Phase codes: 1 assembling, 2 settled, 3 reduced-motion static.
    renderTimeline: renderTimeline.map((sample) => [...sample]),
    activeFrame: frame !== 0,
    hidden: globalThis.document?.hidden ?? false,
    renderer: rendererState() ?? lastRendererState,
    released,
    error,
  });
  const settleReady = () => {
    if (!readyResolved) {
      readyResolved = true;
      resolveReady(getState());
    }
  };
  const cancelled = () => disposed || landing?.started;
  const afterPaint = () => new Promise((resolve) => {
    if (cancelled()) return resolve(false);
    const handle = requestAnimationFrame(() => {
      pendingPaints.delete(handle);
      resolve(!cancelled());
    });
    pendingPaints.set(handle, resolve);
  });
  const stopFrame = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    lastTime = null;
  };
  const updateCamera = () => {
    if (!camera) return;
    const settling = smooth(elapsed / ASSEMBLY_SECONDS);
    const distance = reducedMotion ? finalDistance : THREE.MathUtils.lerp(openDistance, finalDistance, settling);
    const orbit = reducedMotion ? 0 : Math.sin(Math.max(0, elapsed - ASSEMBLY_SECONDS) * 0.12) * 0.027;
    cameraDirection.copy(VIEW_DIRECTION).applyAxisAngle(new THREE.Vector3(0, 1, 0), orbit);
    camera.position.copy(target).addScaledVector(cameraDirection, distance);
    camera.lookAt(target);
  };
  const render = () => {
    if (disposed || !renderer || !scene || !camera) return;
    updateCamera();
    if (warmKey) warmKey.intensity = 220 + (reducedMotion ? 0 : Math.sin(elapsed * 0.4) * 5);
    const before = performance.now();
    renderer.render(scene, camera);
    firstRenderAt ??= before;
    frameCount += 1;
    renderTimeline.push([before, performance.now() - before, frameCount, phase === 'assembling' ? 1 : phase === 'static' ? 3 : 2, clamp01(elapsed / ASSEMBLY_SECONDS)]);
    if (renderTimeline.length > 600) renderTimeline.shift();
  };
  const tick = (time) => {
    frame = 0;
    if (cancelled()) return dispose();
    if (document.hidden || reducedMotion) return;
    try {
      if (lastTime !== null) elapsed += Math.min(0.1, Math.max(0, (time - lastTime) / 1000));
      lastTime = time;
      if (phase === 'assembling') {
        assembly.setTime(elapsed);
        if (elapsed >= ASSEMBLY_SECONDS) {
          assembly.setTime(ASSEMBLY_SECONDS);
          setPhase('complete');
          renderer.shadowMap.autoUpdate = false;
        }
      }
      // The coalescence is full cadence; the settled still life drifts at a quiet
      // 30 fps and does not keep rebuilding the keyboard instance buffers.
      if (phase === 'assembling' || time - lastRender >= 31) {
        render();
        lastRender = time;
      }
      frame = requestAnimationFrame(tick);
    } catch (caught) {
      fail(caught);
    }
  };
  const scheduleFrame = () => {
    if (!disposed && !reducedMotion && !document.hidden && !frame && assembly) frame = requestAnimationFrame(tick);
  };
  const resize = () => {
    if (disposed || !renderer || !camera || !container) return;
    const bounds = container.getBoundingClientRect();
    const width = Math.max(1, bounds.width);
    const height = Math.max(1, bounds.height);
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, width < 600 ? 1.3 : 1.5));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (restBounds && openBounds) {
      finalDistance = fitDistance(restBounds, target, camera.aspect, camera.fov);
      openDistance = Math.max(finalDistance, fitDistance(openBounds, target, camera.aspect, camera.fov));
    }
    if (phase === 'complete' || phase === 'static' || phase === 'assembling') {
      try { render(); } catch (caught) { fail(caught); }
    }
  };
  const onVisibility = () => {
    stopFrame();
    if (!document.hidden) scheduleFrame();
  };
  const onMotion = (event) => {
    reducedMotion = event.matches;
    if (!assembly || disposed) return;
    stopFrame();
    elapsed = Math.max(elapsed, ASSEMBLY_SECONDS);
    assembly.setTime(ASSEMBLY_SECONDS);
    setPhase(reducedMotion ? 'static' : 'complete');
    try {
      renderer.shadowMap.autoUpdate = true;
      render();
      renderer.shadowMap.autoUpdate = false;
      scheduleFrame();
    } catch (caught) {
      fail(caught);
    }
  };
  const onContextLost = (event) => {
    event.preventDefault();
    fail(new Error('Preview graphics context lost'));
  };
  const cleanup = () => {
    stopFrame();
    if (idle) globalThis.cancelIdleCallback?.(idle);
    if (timer) clearTimeout(timer);
    idle = timer = 0;
    for (const [handle, resolve] of pendingPaints) {
      cancelAnimationFrame(handle);
      resolve(false);
    }
    pendingPaints.clear();
    resizeObserver?.disconnect();
    globalThis.document?.removeEventListener('visibilitychange', onVisibility);
    globalThis.removeEventListener?.('resize', resize);
    motionQuery?.removeEventListener?.('change', onMotion);
    canvas?.removeEventListener('webglcontextlost', onContextLost);
    lastRendererState = rendererState();
    lastAssemblyState = assemblyState();
    if (scene) scene.environment = null;
    reflection?.dispose();
    reflection = null;
    released = disposeLandingScene(scene, model?.materials);
    if (!model) paper?.texture.dispose();
    assembly = null;
    scene = null;
    model = null;
    paper = null;
    if (renderer) {
      renderer.renderLists.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer = null;
    }
    canvas?.remove();
    container?.classList.remove('assembly-visible');
  };
  function fail(caught) {
    if (disposed || phase === 'unavailable') return;
    error = caught instanceof Error ? caught.message : String(caught);
    setPhase('unavailable');
    cleanup();
    settleReady();
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    setPhase('disposed');
    cleanup();
    settleReady();
  }
  const replay = () => {
    if (disposed || !assembly || !renderer || cancelled()) return false;
    stopFrame();
    elapsed = reducedMotion ? ASSEMBLY_SECONDS : 0;
    assembly.setTime(elapsed);
    setPhase(reducedMotion ? 'static' : 'assembling');
    renderer.shadowMap.autoUpdate = true;
    try {
      render();
      if (reducedMotion) renderer.shadowMap.autoUpdate = false;
      lastRender = -Infinity;
      scheduleFrame();
      return true;
    } catch (caught) {
      fail(caught);
      return false;
    }
  };

  async function initialize() {
    try {
      if (!await afterPaint() || !await afterPaint()) return dispose();
      if (cancelled()) return dispose();
      canvas = document.createElement('canvas');
      canvas.className = 'landing-assembly-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      canvas.addEventListener('webglcontextlost', onContextLost);
      canvas.style.cssText = 'display:block;width:100%;height:100%;pointer-events:none';
      container.append(canvas);
      const context = canvas.getContext('webgl2', { alpha: true, antialias: true, powerPreference: 'default' });
      if (!context) throw new Error('WebGL 2 preview unavailable');
      renderer = new THREE.WebGLRenderer({ canvas, context, alpha: true, antialias: true });
      renderer.setClearColor(0x151913, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.25;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(36, 1, 0.1, 70);
      resize();
      if (!await afterPaint()) return dispose();

      paper = makePreviewPaper();
      const documentState = new TypewriterDocument();
      documentState.column = 32;
      documentState.line = 13;
      model = new TypewriterModel({ scene, documentState, paperRenderer: paper, audio: {}, reducedMotion: true });
      // Keep the real walnut desk and leather blotter, but let the light itself
      // remain off-camera. Hidden studio resources are still released below.
      model.root.getObjectByName('DeskLamp').visible = false;
      model.root.children.at(-1).visible = false;
      model.root.updateWorldMatrix(true, true);
      assembly = createLandingAssemblyParts(model);
      assembly.setTime(ASSEMBLY_SECONDS);
      restBounds = new THREE.Box3().setFromObject(model.machine);
      restBounds.min.y = 0;
      target.set(0, 2.2, 0.25);
      assembly.setTime(0);
      openBounds = new THREE.Box3().setFromObject(model.machine);
      openBounds.min.y = 0;
      resize();
      if (!await afterPaint()) return dispose();

      const room = new RoomEnvironment();
      const generator = new THREE.PMREMGenerator(renderer);
      try {
        reflection = generator.fromScene(room, 0.06);
        scene.environment = reflection.texture;
        scene.environmentIntensity = 0.3;
      } finally {
        room.dispose();
        generator.dispose();
      }
      const hemisphere = new THREE.HemisphereLight(0xaaaeb0, 0x322218, 1.05);
      warmKey = new THREE.SpotLight(0xffca91, 220, 32, Math.PI * 0.24, 0.62, 1.2);
      warmKey.position.set(-5.5, 9, 7);
      warmKey.target.position.set(0, 1.4, 0.4);
      warmKey.castShadow = true;
      warmKey.shadow.mapSize.set(1024, 1024);
      warmKey.shadow.camera.near = 2;
      warmKey.shadow.camera.far = 27;
      warmKey.shadow.bias = -0.00025;
      warmKey.shadow.normalBias = 0.01;
      const rim = new THREE.SpotLight(0xa2c6c4, 135, 30, Math.PI * 0.25, 0.65, 1.1);
      rim.position.set(6, 6.5, -7);
      rim.target.position.set(0, 1.8, 0);
      const fill = new THREE.PointLight(0xffe1af, 18, 13, 1.4);
      fill.position.set(0.5, 5.4, 4);
      scene.add(hemisphere, warmKey, warmKey.target, rim, rim.target, fill);
      elapsed = reducedMotion ? ASSEMBLY_SECONDS : 0;
      assembly.setTime(elapsed);
      updateCamera();
      if (!await afterPaint()) return dispose();
      // Three's compileAsync owns an uncancellable timeout poll which can read
      // disposed material properties if entry interrupts shader preparation.
      // Compile the small preview synchronously, then yield a cancellable paint
      // before its first render. The already-painted CTA remains independent.
      renderer.compile(scene, camera);
      if (!await afterPaint()) return dispose();
      if (cancelled()) return dispose();
      reducedMotion = motionQuery?.matches ?? false;
      elapsed = reducedMotion ? ASSEMBLY_SECONDS : 0;
      assembly.setTime(elapsed);
      setPhase(reducedMotion ? 'static' : 'assembling');
      render();
      if (reducedMotion) renderer.shadowMap.autoUpdate = false;
      container.classList.add('assembly-visible');
      resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
      resizeObserver?.observe(container);
      document.addEventListener('visibilitychange', onVisibility);
      globalThis.addEventListener?.('resize', resize);
      motionQuery?.addEventListener?.('change', onMotion);
      settleReady();
      scheduleFrame();
    } catch (caught) {
      fail(caught);
    }
  }

  if (!container || landing?.started) {
    disposed = true;
    setPhase('disposed');
    settleReady();
  } else {
    setPhase('preparing');
    // Starting immediately still waits two animation frames inside initialize;
    // idle scheduling avoids competing with the first readable shell paint.
    if (globalThis.requestIdleCallback) idle = requestIdleCallback(() => { idle = 0; void initialize(); }, { timeout: 300 });
    else timer = setTimeout(() => { timer = 0; void initialize(); }, 0);
    landing?.entry?.then(dispose, dispose);
  }
  return { ready, dispose, replay, getState };
}
