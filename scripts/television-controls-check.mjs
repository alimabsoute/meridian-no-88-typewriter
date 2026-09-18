import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createTelevisionControls } from '../src/television-controls.js';
import { fitRoomOverview } from '../src/room-overview.js';

// Real THREE matrices/projection, minimal DOM/event/measurement substitutes.
// This cannot certify rendered appearance, font metrics or browser hit testing.
class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.attributes = new Map();
    this.listeners = new Map(); this.selectors = new Map(); this.children = [];
    this.hidden = false; this.textContent = ''; this.value = '';
    this.offsetWidth = 174; this.offsetHeight = 98; this.styleWrites = 0;
    let transform = '';
    this.style = {};
    Object.defineProperty(this.style, 'transform', {
      get: () => transform,
      set: value => { transform = value; this.styleWrites++; },
    });
  }
  set innerHTML(html) {
    for (const match of html.matchAll(/<(button|input)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
      const child = new Element(match[1]);
      for (const attr of match[2].matchAll(/([\w-]+)="([^"]*)"/g)) child.setAttribute(attr[1], attr[2]);
      if (child.attributes.has('value')) child.value = child.attributes.get('value');
      this.selectors.set('#' + match[3], child);
    }
    const strong = html.match(/<strong>(.*?)<\/strong>/);
    if (strong) {
      const child = new Element('strong'); child.textContent = strong[1];
      this.selectors.get('#tv-remote-power')?.selectors.set('strong', child);
    }
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  querySelector(selector) { return this.selectors.get(selector) ?? null; }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter(value => value !== listener)); }
  getBoundingClientRect() { return { left: 0, top: 0 }; }
  dispatch(type, properties = {}) {
    const event = { type, target: this, stopped: false, ...properties, stopPropagation() { this.stopped = true; } };
    for (const listener of this.listeners.get(type) ?? []) listener.call(this, event);
    return event;
  }
  append(child) { this.children.push(child); child.parentElement = this; }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    this.parentElement = null;
  }
}

const observers = [];
class MeasuredObserver {
  constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
  observe(element) { this.element = element; }
  measure() { this.callback([{ contentRect: { width: this.element.offsetWidth, height: this.element.offsetHeight } }]); }
  disconnect() { this.disconnected = true; }
}

const originalDocument = globalThis.document;
const originalObserver = globalThis.ResizeObserver;
globalThis.document = { createElement: tag => new Element(tag) };
globalThis.ResizeObserver = MeasuredObserver;
const report = { checkedAt: new Date().toISOString(), evidence: 'Real THREE camera math with mocked DOM measurements and events; no browser/visual pass', scenarios: [] };
const fixtures = [];
function fixture({ width = 1600, height = 1000, rail = 90 } = {}) {
  const parent = new Element(); parent.clientWidth = width; parent.clientHeight = height;
  const headerBottom = rail + 64;
  const footerTop = height - (width <= 760 ? 10 : 18) - 56;
  parent.selectors.set('.masthead', { getBoundingClientRect: () => ({ bottom: headerBottom }) });
  parent.selectors.set('.workbench-toolbar', { getBoundingClientRect: () => ({ top: footerTop }) });
  const camera = new THREE.PerspectiveCamera(43, width / height, 0.1, 200);
  const target = new THREE.Vector3(1.65, 3.45, -2.1);
  camera.position.set(1.2, 5.7, 16.8); camera.lookAt(target); camera.updateMatrixWorld(true);
  const television = new THREE.Group(); television.position.set(-8.8, 5.22, -5.96);
  const decor = { television, visible: true, disposed: false, tvEnabled: true, muted: true, volume: 0.28 };
  const calls = { power: 0, mute: 0, volume: [], focus: 0 };
  let controls;
  controls = createTelevisionControls({ parent, decor, camera,
    onPower: () => { calls.power++; decor.tvEnabled = !decor.tvEnabled; controls?.sync(); },
    onMute: () => { calls.mute++; decor.muted = !decor.muted; controls?.sync(); },
    onVolume: value => { calls.volume.push(value); decor.volume = value; controls?.sync(); },
    onFocus: () => { calls.focus++; },
  });
  const observer = observers.at(-1); observer.measure();
  const result = { parent, camera, target, television, decor, controls, calls, observer, width, height, headerBottom, footerTop };
  fixtures.push(result); return result;
}
function position(f) {
  const values = f.controls.panel.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
  assert(values, 'Visible remote must have a screen-space position');
  return { x: Number(values[1]), y: Number(values[2]), width: f.controls.panel.offsetWidth, height: f.controls.panel.offsetHeight };
}
function screenBounds(f) {
  // Reference geometry is the actual 5.4 x 3.12 TV frame, not the control's
  // internal projected vectors or generated CSS transform.
  const geometry = new THREE.PlaneGeometry(5.4, 3.12);
  f.camera.updateMatrixWorld(true); f.television.updateWorldMatrix(true, false);
  const vertices = geometry.getAttribute('position');
  const points = [];
  for (let i = 0; i < vertices.count; i++) {
    const vertex = new THREE.Vector3().fromBufferAttribute(vertices, i); vertex.z = 0.52;
    f.television.localToWorld(vertex); vertex.project(f.camera);
    points.push({ x: (vertex.x + 1) * f.width / 2, y: (1 - vertex.y) * f.height / 2, depth: vertex.z });
  }
  geometry.dispose();
  return { left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)),
    top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y)) };
}
function bounded(f) {
  const p = position(f);
  assert(p.x >= 11.5 && p.x + p.width <= f.width - 11.5, 'Remote must fit within horizontal gutters');
  assert(p.y >= f.headerBottom + 11.5, 'Remote must clear signup rail and masthead');
  assert(p.y + p.height <= f.footerTop - 11.5, 'Remote must clear the workbench toolbar');
  return p;
}
function clearOfPicture(remote, projected) {
  // A visible remote needs the same 12px separation from the TV that it gets
  // from the viewport chrome. Allow half a pixel for CSS integer rounding.
  return remote.x >= projected.right + 11.5 || remote.x + remote.width <= projected.left - 11.5
    || remote.y >= projected.bottom + 11.5 || remote.y + remote.height <= projected.top - 11.5;
}
async function check(name, test) {
  try { report.scenarios.push({ name, passed: true, ...await test() }); }
  catch (error) { report.scenarios.push({ name, passed: false, error: error.message }); }
}
try {
  await check('actual camera controller survives OrbitControls and restores the Writer limit without snapping', () => {
    const f = fixture({ width: 390, height: 844, rail: 138 });
    const doc = { addEventListener() {}, removeEventListener() {} };
    const element = { style: {}, ownerDocument: doc, addEventListener() {}, removeEventListener() {}, getRootNode: () => doc };
    const orbit = new OrbitControls(f.camera, element); orbit.target.copy(f.target); orbit.maxDistance = 22;
    const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
    const code = source.slice(source.indexOf('function setCameraView('), source.indexOf('function setDocumentTrayOpen('));
    const context = { THREE, fitRoomOverview, room: { decor: f.decor }, camera: f.camera, controls: orbit,
      window: { innerWidth: 390, innerHeight: 844, matchMedia: () => ({ matches: false }) },
      document: { querySelectorAll: () => [] }, refs: { 'mobile-view-select': {} }, currentCameraView: 'front', cameraMotion: null,
      CAMERA_PRESETS: {
        front: { position: new THREE.Vector3(1.2, 5.7, 16.8), target: f.target.clone(), fov: 43 },
        writer: { position: new THREE.Vector3(4.2, 5.8, 13.2), target: new THREE.Vector3(.7, 2.6, -.1), fov: 37 },
      } };
    runInNewContext(code + '\nsetCameraView("front", .001); updateCameraMotion(1); controls.update();', context);
    const bounds = screenBounds(f); assert(bounds.left >= 24, 'OrbitControls must not clamp the fitted camera back inside the TV');
    assert(f.camera.far > f.camera.position.distanceTo(orbit.target) + 60, 'Distant skyline must remain inside the far plane');
    const distance = f.camera.position.distanceTo(orbit.target);
    runInNewContext('setCameraView("writer", 1); updateCameraMotion(.05); controls.update();', context);
    assert(f.camera.position.distanceTo(orbit.target) > distance - 1, 'Writer transition must ease instead of snapping to 22 units');
    runInNewContext('updateCameraMotion(1); controls.update();', context);
    assert.equal(orbit.maxDistance, 22); assert(f.camera.position.distanceTo(orbit.target) < 22);
    orbit.dispose(); return { bounds, noSnap: true, restoredLimit: 22 };
  });
  await check('responsive Front overview contains the entire TV frame at desktop and portrait sizes', () => {
    const results = [];
    for (const [width, height] of [[1920, 1080], [1600, 1000], [1280, 800], [1024, 768], [768, 1024], [390, 844], [360, 740], [844, 390]]) {
      const f = fixture({ width, height, rail: width <= 760 ? 138 : 90 });
      const original = { position: f.camera.position.clone(), target: f.target.clone(), fov: 43 };
      const view = fitRoomOverview(original, f.television, width, height, { topInset: f.headerBottom + 12, bottomInset: height - f.footerTop + 12 });
      f.camera.position.copy(view.position); f.camera.fov = view.fov; f.camera.lookAt(view.target); f.camera.setViewOffset(width, height, 0, view.offsetY, width, height);
      const bounds = screenBounds(f);
      assert(bounds.left >= 24 && bounds.right <= width - 24, 'Whole TV must fit with horizontal gutters: ' + JSON.stringify({ width, bounds }));
      assert(bounds.top >= f.headerBottom + 12 && bounds.bottom <= f.footerTop - 12, 'TV must clear the header and toolbar');
      for (const x of [-5, 5]) for (const y of [.2, 5]) for (const z of [-2, 4]) {
        const machine = new THREE.Vector3(x, y, z).project(f.camera);
        assert((machine.x + 1) * width / 2 >= 23.9 && (machine.x + 1) * width / 2 <= width - 23.9, 'Machine must also fit horizontally');
      }
      if (width < 450) assert(view.position.distanceTo(view.target) < 45, 'Portrait overview must not shrink the whole machine to fit the TV');
      assert.deepEqual(original.position.toArray(), [1.2, 5.7, 16.8], 'Shared camera preset must not be mutated');
      f.controls.update(); assert.equal(f.controls.panel.hidden, false, 'TV controls must remain reachable in the fitted overview');
      bounded(f);
      results.push({ viewport: [width, height], bounds, distance: view.position.distanceTo(view.target) });
    }
    return { results };
  });
  await check('hovering the television reveals controls and leaving clears the reveal', () => {
    const f = fixture(); f.controls.update(); const bounds = screenBounds(f);
    f.parent.dispatch('pointermove', { clientX: (bounds.left + bounds.right) / 2, clientY: (bounds.top + bounds.bottom) / 2 });
    assert.equal(f.controls.panel.getAttribute('data-tv-hover'), 'true');
    f.parent.dispatch('pointerleave'); assert.equal(f.controls.panel.getAttribute('data-tv-hover'), 'false');
    f.parent.dispatch('pointermove', { clientX: 1590, clientY: 950 });
    assert.equal(f.controls.panel.getAttribute('data-tv-hover'), 'false');
    f.controls.dispose();
    assert.equal(f.parent.listeners.get('pointermove').length, 0); assert.equal(f.parent.listeners.get('pointerleave').length, 0);
    return { hover: true, pointerCleanup: true };
  });
  await check('desktop Front camera places remote right of television', () => {
    const f = fixture(); f.controls.update(); assert.equal(f.controls.panel.hidden, false);
    const projected = screenBounds(f), remote = bounded(f);
    assert(Math.abs(remote.x - projected.right - 12) <= 0.5);
    const writes = f.controls.panel.styleWrites; f.controls.update();
    assert.equal(f.controls.panel.styleWrites, writes, 'Unchanged projection should not rewrite its transform');
    return { viewport: [f.width, f.height], rail: 90, projected, remote };
  });
  await check('remote follows camera motion using world transforms', () => {
    const f = fixture(); f.controls.update(); const before = position(f);
    f.camera.position.x += 0.8; f.camera.position.y += 0.25; f.camera.lookAt(f.target);
    f.controls.update(); const after = bounded(f);
    assert.notDeepEqual(after, before); return { before, after, projected: screenBounds(f) };
  });
  await check('right edge flips left and wide projected screen uses clear vertical space', () => {
    const f = fixture(); f.television.position.x = 11; f.controls.update();
    assert.equal(f.controls.panel.hidden, false);
    const projected = screenBounds(f), flipped = bounded(f);
    assert(flipped.x + flipped.width <= projected.left - 11.5);
    f.television.position.x = 0; f.television.scale.x = 8; f.controls.update();
    assert.equal(f.controls.panel.hidden, false);
    const wideRemote = bounded(f), wideProjected = screenBounds(f);
    assert(clearOfPicture(wideRemote, wideProjected), 'Wide television must not be obscured by its remote');
    return { projected, flipped, wideProjected, wideRemote };
  });
  await check('90px signup rail and footer constrain upper/lower anchors', () => {
    const f = fixture(); f.television.position.y = 10; f.controls.update();
    assert.equal(f.controls.panel.hidden, false); const upper = bounded(f);
    assert.equal(upper.y, f.headerBottom + 12);
    f.television.position.y = -4.5; f.controls.update();
    assert.equal(f.controls.panel.hidden, false); const lower = bounded(f);
    assert.equal(lower.y, f.footerTop - lower.height - 12);
    return { headerBottom: f.headerBottom, footerTop: f.footerTop, upper, lower };
  });
  await check('offscreen, behind-camera, invisible and disposed televisions hide controls', () => {
    const f = fixture(); f.television.position.x = 100; f.controls.update(); assert(f.controls.panel.hidden);
    f.television.position.x = -9.4; f.camera.lookAt(1.2, 5.7, 50); f.controls.update(); assert(f.controls.panel.hidden);
    f.camera.lookAt(f.target); f.decor.visible = false; f.controls.update(); assert(f.controls.panel.hidden);
    f.decor.visible = true; f.decor.disposed = true; f.controls.update(); assert(f.controls.panel.hidden);
    return {};
  });
  await check('390x844 Front camera correctly hides the offscreen television remote', () => {
    const f = fixture({ width: 390, height: 844 }); f.controls.update();
    const projected = screenBounds(f); assert(projected.right < 0); assert(f.controls.panel.hidden);
    return { viewport: [390, 844], projected, hidden: f.controls.panel.hidden };
  });
  await check('390x844 TV-centered camera places remote below picture with 90px and 138px rails', () => {
    const results = [];
    for (const rail of [90, 138]) {
      const f = fixture({ width: 390, height: 844, rail }); f.camera.lookAt(-9.4, 5.22, -5.44);
      f.controls.update(); assert.equal(f.controls.panel.hidden, false);
      const remote = bounded(f), projected = screenBounds(f);
      assert(clearOfPicture(remote, projected), 'Portrait remote must leave the broadcast unobstructed');
      assert(remote.y >= projected.bottom + 11.5, 'Portrait remote should use the available space below the TV');
      results.push({ rail, projected, remote, overlapsProjectedTV: false });
    }
    return { results };
  });
  await check('portrait remote uses space above a low TV and hides when neither side fits', () => {
    const f = fixture({ width: 390, height: 844 }); f.camera.lookAt(-9.4, 5.22, -5.44);
    f.television.position.y -= 5; f.controls.update();
    assert.equal(f.controls.panel.hidden, false);
    const remote = bounded(f), projected = screenBounds(f);
    assert(remote.y + remote.height <= projected.top - 11.5, 'Low television should leave controls above the picture');
    assert(clearOfPicture(remote, projected));
    f.television.position.y += 5; f.television.scale.y = 5; f.controls.update();
    assert(f.controls.panel.hidden, 'Oversized portrait television must not force controls over the picture or chrome');
    return { above: { remote, projected }, noClearSpace: { projected: screenBounds(f), hidden: true } };
  });
  await check('power, mute, volume, focus and pointer isolation operate and synchronize', () => {
    const f = fixture(); f.controls.update(); const panel = f.controls.panel;
    const power = panel.querySelector('#tv-remote-power'), mute = panel.querySelector('#tv-remote-mute'), volume = panel.querySelector('#tv-remote-volume');
    assert.equal(power.getAttribute('aria-checked'), 'true'); assert.equal(mute.getAttribute('aria-pressed'), 'true');
    power.dispatch('click'); assert.equal(power.getAttribute('aria-checked'), 'false'); assert.equal(power.querySelector('strong').textContent, 'TV OFF');
    f.controls.update(); assert.equal(panel.hidden, false, 'Power-off remote must remain available to turn the TV back on');
    mute.dispatch('click'); assert.equal(mute.getAttribute('aria-pressed'), 'false'); assert.equal(mute.textContent, 'Sound on');
    volume.value = '0.64'; volume.dispatch('input'); assert.deepEqual(f.calls.volume, [0.64]);
    panel.dispatch('focusin'); assert.equal(f.calls.focus, 1); assert(panel.dispatch('pointerdown').stopped);
    f.decor.volume = 0.91; f.decor.muted = true; f.controls.sync();
    assert.equal(volume.value, '0.91'); assert.equal(mute.getAttribute('aria-pressed'), 'true');
    f.controls.dispose(); assert(f.observer.disconnected); assert.equal(f.parent.children.length, 0);
    return { calls: f.calls, disconnected: f.observer.disconnected };
  });
  await check('short viewport hides remote when header/footer leave insufficient room', () => {
    const f = fixture({ width: 390, height: 300 }); f.camera.lookAt(-9.4, 5.22, -5.44); f.controls.update();
    const observed = f.controls.panel.hidden ? null : position(f);
    assert(f.controls.panel.hidden, 'Remote overlaps toolbar: ' + JSON.stringify({ headerBottom: f.headerBottom, footerTop: f.footerTop, remote: observed }));
    return { viewport: [390, 300], headerBottom: f.headerBottom, footerTop: f.footerTop, hidden: true };
  });
} finally {
  for (const f of fixtures) f.controls.dispose();
  if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
  if (originalObserver === undefined) delete globalThis.ResizeObserver; else globalThis.ResizeObserver = originalObserver;
}
report.passed = report.scenarios.every(scenario => scenario.passed);
await mkdir('visual-checks/television-controls', { recursive: true });
await writeFile('visual-checks/television-controls/native-results.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
