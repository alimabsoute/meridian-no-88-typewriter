import '@fontsource/bebas-neue/400.css';
import '@fontsource/special-elite/400.css';
import './styles.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TypewriterDocument } from './typewriter-document.js';
import { PaperRenderer } from './textures.js';
import { TypewriterAudio } from './audio-engine.js';
import { CODE_BY_CHARACTER, KEY_BY_CODE, TypewriterModel } from './typewriter-model.js';

const STORAGE_KEY = 'meridian-typewriter-state-v1';
const lowQuality = new URLSearchParams(window.location.search).get('quality') === 'low';

function getStoredState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

const stored = getStoredState();
let page;
try {
  page = stored?.document ? TypewriterDocument.deserialize(stored.document) : new TypewriterDocument();
} catch {
  page = new TypewriterDocument();
}

await document.fonts.ready;

const canvas = document.querySelector('#scene');
const webglContext = canvas.getContext('webgl2', { antialias: true, powerPreference: 'high-performance' });
if (!webglContext) {
  document.getElementById('app').innerHTML = `
    <section style="min-height:100%;display:grid;place-items:center;padding:32px;background:#090d0c;color:#e9dfc5;text-align:center">
      <div><h1 style="font:48px 'Bebas Neue',sans-serif;letter-spacing:.08em;margin:0 0 12px">WEBGL 2 REQUIRED</h1>
      <p style="max-width:520px;font:14px/1.7 'Special Elite',monospace;color:#bdb39b">This mechanical study needs hardware-accelerated WebGL 2. Open it in a current version of Chrome, Edge, Firefox, or Safari and enable graphics acceleration.</p></div>
    </section>`;
  throw new Error('WebGL 2 is unavailable.');
}
const renderer = new THREE.WebGLRenderer({ canvas, context: webglContext, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowQuality ? 1 : 1.75));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = !lowQuality;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0d0b);
scene.fog = new THREE.FogExp2(0x0a0d0b, 0.025);

const camera = new THREE.PerspectiveCamera(37, window.innerWidth / window.innerHeight, 0.05, 80);
camera.position.set(8.45, 5.85, 11.4);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 1.43, 0.55);
controls.enableDamping = true;
controls.dampingFactor = 0.065;
controls.minDistance = 5.2;
controls.maxDistance = 22;
controls.minPolarAngle = 0.22;
controls.maxPolarAngle = Math.PI * 0.49;
controls.maxTargetRadius = 4.4;
controls.enablePan = true;
controls.screenSpacePanning = true;
controls.update();

const hemisphere = new THREE.HemisphereLight(0x7893a0, 0x24150d, 1.05);
scene.add(hemisphere);

const warmKey = new THREE.SpotLight(0xffc486, 210, 30, Math.PI * 0.22, 0.46, 1.25);
warmKey.position.set(-5.0, 8.5, 5.7);
warmKey.target.position.set(0.4, 1.0, 0.3);
warmKey.castShadow = !lowQuality;
warmKey.shadow.mapSize.set(lowQuality ? 512 : 2048, lowQuality ? 512 : 2048);
warmKey.shadow.camera.near = 2;
warmKey.shadow.camera.far = 24;
warmKey.shadow.bias = -0.00016;
scene.add(warmKey, warmKey.target);

const coolRim = new THREE.SpotLight(0x9ec8ca, 105, 28, Math.PI * 0.25, 0.6, 1.1);
coolRim.position.set(7.5, 6.3, -7.2);
coolRim.target.position.set(0, 1.6, -0.2);
scene.add(coolRim, coolRim.target);

const paperLight = new THREE.PointLight(0xffe3b5, 24, 9, 1.5);
paperLight.position.set(0.2, 5.1, 2.8);
scene.add(paperLight);

const audio = new TypewriterAudio();
audio.setEnabled(stored?.soundEnabled !== false);
let paperRenderer = new PaperRenderer(page);

const refs = Object.fromEntries([
  'position-readout', 'ribbon-readout', 'sheet-readout', 'escapement-status', 'escapement-gauge',
  'ribbon-status', 'ribbon-gauge', 'status-lamp', 'transcript', 'document-summary', 'margin-warning',
  'toast', 'screen-reader-status', 'sound-toggle', 'inspection-toggle', 'document-toggle', 'document-content',
  'field-guide', 'intro-overlay',
].map((id) => [id, document.getElementById(id)]));

let toastTimer = 0;
let persistTimer = 0;
let keyboardCaptured = false;
let inkMode = stored?.inkMode && ['black', 'red', 'stencil'].includes(stored.inkMode) ? stored.inkMode : 'black';
let cameraMotion = null;
let statusFlash = 0;
const backgroundLayers = [...document.querySelectorAll('.ui-layer:not(#intro-overlay)')];
for (const layer of backgroundLayers) layer.inert = true;

function focusMachine() {
  if (!refs['intro-overlay'].classList.contains('dismissed') || refs['field-guide'].open) return;
  keyboardCaptured = true;
  canvas.tabIndex = 0;
  canvas.focus({ preventScroll: true });
}

function showToast(message, duration = 1600) {
  refs.toast.textContent = message;
  refs.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => refs.toast.classList.remove('show'), duration);
}

function announce(message) {
  refs['screen-reader-status'].textContent = '';
  requestAnimationFrame(() => { refs['screen-reader-status'].textContent = message; });
}

function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        document: page.serialize(),
        inkMode,
        soundEnabled: audio.enabled,
      }));
    } catch {
      // Storage is a convenience. The mechanical simulation stays functional without it.
    }
  }, 180);
}

function updateDocumentUi() {
  const text = page.toPlainText();
  refs.transcript.textContent = text || 'The page is waiting.';
  refs['document-summary'].textContent = page.marks.length
    ? `${page.marks.length} impression${page.marks.length === 1 ? '' : 's'} · line ${Math.min(page.line + 1, page.lines)}`
    : 'Blank sheet loaded';
  refs['sheet-readout'].textContent = `LETTER · ${String(page.sheetNumber).padStart(2, '0')}`;
}

function handleStatus(event) {
  statusFlash = 1;
  switch (event.type) {
    case 'bell':
      showToast('MARGIN BELL · FIVE SPACES REMAIN', 1400);
      announce('Margin bell. Five spaces remain.');
      break;
    case 'margin-reached':
    case 'margin-lock':
      refs['margin-warning'].classList.add('show');
      if (event.type === 'margin-lock') showToast('LINE LOCKED · PRESS ENTER TO RETURN', 1400);
      announce('Right margin reached. Press Enter to return the carriage.');
      break;
    case 'return-start':
      refs['margin-warning'].classList.remove('show');
      announce(`Carriage returning. Paper advancing to line ${event.line + 1}.`);
      break;
    case 'return-complete':
      showToast(`LINE ${String(event.line + 1).padStart(2, '0')} · CARRIAGE SET`, 850);
      break;
    case 'ribbon-reverse':
      showToast(`RIBBON REVERSED · ${event.direction > 0 ? 'WINDING RIGHT' : 'WINDING LEFT'}`, 1200);
      announce('Ribbon direction reversed.');
      break;
    case 'paper-end':
      showToast('END OF SHEET · LOAD NEW PAPER', 2200);
      announce('End of sheet. Load a new page.');
      break;
    case 'paper-loaded':
      showToast('PAPER CLAMPED · WRITING LINE SET', 1000);
      announce('Paper loaded and writing line set.');
      break;
    case 'margin-release':
      showToast('MARGIN RELEASED · TWO SECONDS', 1100);
      break;
    case 'backspace':
      if (!event.moved) showToast('CARRIAGE AT LEFT MARGIN', 900);
      break;
    case 'shift-lock':
      showToast(event.active ? 'SHIFT LOCK ENGAGED' : 'SHIFT LOCK RELEASED', 800);
      break;
    case 'inspection':
      showToast(event.active ? 'SHELL OPEN · MECHANISM EXPOSED' : 'SHELL CLOSED', 900);
      break;
    default:
      break;
  }
}

const model = new TypewriterModel({
  scene,
  documentState: page,
  paperRenderer,
  audio,
  onStatus: handleStatus,
  onChange: () => {
    updateDocumentUi();
    persist();
  },
});

model.setInkMode(inkMode);
updateDocumentUi();

const CAMERA_PRESETS = {
  writer: {
    position: new THREE.Vector3(8.45, 5.85, 11.4),
    target: new THREE.Vector3(0, 1.43, 0.55),
  },
  mechanism: {
    position: new THREE.Vector3(7.2, 4.3, 7.0),
    target: new THREE.Vector3(0.2, 1.25, 0.22),
  },
  ribbon: {
    position: new THREE.Vector3(4.7, 4.25, 4.2),
    target: new THREE.Vector3(0, 1.76, -0.42),
  },
  carriage: {
    position: new THREE.Vector3(-6.8, 5.0, 7.2),
    target: new THREE.Vector3(0, 2.55, -0.8),
  },
};

function setCameraView(name, duration = 0.9) {
  const preset = CAMERA_PRESETS[name];
  if (!preset) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  cameraMotion = {
    fromPosition: camera.position.clone(),
    fromTarget: controls.target.clone(),
    toPosition: preset.position.clone(),
    toTarget: preset.target.clone(),
    elapsed: 0,
    duration: reduced ? 0.01 : duration,
  };
  document.querySelectorAll('.view-button').forEach((button) => button.classList.toggle('active', button.dataset.view === name));
}

function updateCameraMotion(delta) {
  if (!cameraMotion) return;
  cameraMotion.elapsed += delta;
  const raw = Math.min(1, cameraMotion.elapsed / cameraMotion.duration);
  const eased = raw < 0.5 ? 4 * raw ** 3 : 1 - ((-2 * raw + 2) ** 3) / 2;
  camera.position.lerpVectors(cameraMotion.fromPosition, cameraMotion.toPosition, eased);
  controls.target.lerpVectors(cameraMotion.fromTarget, cameraMotion.toTarget, eased);
  if (raw >= 1) cameraMotion = null;
}

function syncInkUi() {
  document.querySelectorAll('.ink-button').forEach((button) => {
    const active = button.dataset.ink === inkMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  refs['ribbon-readout'].textContent = `${inkMode.toUpperCase()} · ${model.ribbonDirection > 0 ? '→' : '←'}`;
}

function selectInk(mode) {
  inkMode = mode;
  model.setInkMode(mode);
  syncInkUi();
  showToast(mode === 'stencil' ? 'STENCIL · RIBBON LIFT DISENGAGED' : `${mode.toUpperCase()} RIBBON SELECTED`, 900);
  persist();
}

syncInkUi();
refs['sound-toggle'].setAttribute('aria-pressed', String(audio.enabled));

document.getElementById('enter-studio').addEventListener('click', () => {
  refs['intro-overlay'].classList.add('dismissed');
  refs['intro-overlay'].setAttribute('aria-hidden', 'true');
  for (const layer of backgroundLayers) layer.inert = false;
  focusMachine();
  audio.start().catch(() => {});
  showToast('KEYBOARD CONNECTED · BEGIN TYPING', 1500);
  announce('Typewriter active. Begin typing. Press Escape to release the keyboard.');
});

refs['sound-toggle'].addEventListener('click', async () => {
  if (!audio.context) await audio.start().catch(() => false);
  audio.setEnabled(!audio.enabled);
  refs['sound-toggle'].setAttribute('aria-pressed', String(audio.enabled));
  showToast(audio.enabled ? 'MECHANICAL SOUND ON' : 'MECHANICAL SOUND MUTED', 800);
  persist();
  focusMachine();
});

document.getElementById('guide-open').addEventListener('click', () => {
  keyboardCaptured = false;
  refs['field-guide'].showModal();
});

refs['field-guide'].addEventListener('close', () => {
  focusMachine();
});

document.querySelectorAll('.guide-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.guide-tab').forEach((item) => item.classList.toggle('active', item === tab));
    document.querySelectorAll('.guide-page').forEach((pageElement) => pageElement.classList.toggle('active', pageElement.dataset.page === tab.dataset.tab));
  });
});

document.querySelectorAll('.view-button').forEach((button) => button.addEventListener('click', () => {
  setCameraView(button.dataset.view);
  focusMachine();
}));
document.getElementById('home-view').addEventListener('click', () => {
  setCameraView('writer');
  focusMachine();
});

refs['inspection-toggle'].addEventListener('click', () => {
  const enabled = refs['inspection-toggle'].getAttribute('aria-pressed') !== 'true';
  refs['inspection-toggle'].setAttribute('aria-pressed', String(enabled));
  model.setInspection(enabled);
  if (enabled) setCameraView('mechanism', 0.75);
  focusMachine();
});

document.querySelectorAll('.ink-button').forEach((button) => button.addEventListener('click', () => {
  selectInk(button.dataset.ink);
  focusMachine();
}));

refs['document-toggle'].addEventListener('click', () => {
  const tray = refs['document-toggle'].closest('.document-tray');
  const open = !tray.classList.contains('open');
  tray.classList.toggle('open', open);
  refs['document-toggle'].setAttribute('aria-expanded', String(open));
  refs['document-content'].inert = !open;
  refs['document-content'].setAttribute('aria-hidden', String(!open));
  focusMachine();
});

function downloadText() {
  const text = page.toPlainText();
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `meridian-sheet-${String(page.sheetNumber).padStart(2, '0')}.txt`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('TRANSCRIPT SAVED', 900);
}

document.getElementById('download-text').addEventListener('click', () => {
  downloadText();
  focusMachine();
});
document.getElementById('download-paper').addEventListener('click', () => {
  paperRenderer.download(`meridian-sheet-${String(page.sheetNumber).padStart(2, '0')}.png`);
  showToast('HIGH-RESOLUTION PAPER SAVED', 1000);
  focusMachine();
});

document.getElementById('new-sheet').addEventListener('click', () => {
  if (page.marks.length && !window.confirm('Remove this typed sheet and load a fresh page? Save it first if you want to keep it.')) {
    focusMachine();
    return;
  }
  const nextNumber = page.sheetNumber + 1;
  page = new TypewriterDocument({ sheetNumber: nextNumber });
  paperRenderer = new PaperRenderer(page);
  model.setDocument(page, paperRenderer);
  refs['margin-warning'].classList.remove('show');
  updateDocumentUi();
  audio.paper();
  showToast(`FRESH SHEET ${String(nextNumber).padStart(2, '0')} LOADED`, 1200);
  announce('Fresh sheet loaded.');
  persist();
  focusMachine();
});

function shouldIgnoreKeyboard(event) {
  if (!keyboardCaptured || refs['field-guide'].open) return true;
  if (event.ctrlKey || event.metaKey || event.altKey) return true;
  const target = event.target;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement;
}

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    keyboardCaptured = false;
    model.setShiftHeld(false);
    showToast('KEYBOARD RELEASED · CLICK THE MACHINE TO RECONNECT', 1600);
    announce('Typewriter keyboard released. Click the machine to reconnect.');
    return;
  }
  if (shouldIgnoreKeyboard(event) || event.repeat) return;

  if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
    model.setShiftHeld(true, event.code);
    return;
  }
  if (event.code === 'CapsLock') {
    event.preventDefault();
    model.toggleShiftLock();
    return;
  }
  if (event.code === 'Space') {
    event.preventDefault();
    model.queueSpace();
    return;
  }
  if (event.code === 'Enter' || event.code === 'NumpadEnter') {
    event.preventDefault();
    model.queueReturn();
    return;
  }
  if (event.code === 'Backspace') {
    event.preventDefault();
    model.queueBackspace();
    return;
  }
  if (event.code === 'Tab') {
    event.preventDefault();
    model.queueTab();
    return;
  }
  if (event.code === 'Delete') {
    event.preventDefault();
    showToast('A MANUAL TYPEWRITER CANNOT ERASE · USE BACKSPACE TO OVERSTRIKE', 1800);
    return;
  }
  if (event.code === 'F6') {
    event.preventDefault();
    model.triggerMarginRelease();
    return;
  }
  if (event.key.length === 1 && KEY_BY_CODE.has(event.code)) {
    event.preventDefault();
    const expectedCode = CODE_BY_CHARACTER.get(event.key);
    const character = expectedCode ? event.key : (event.shiftKey ? KEY_BY_CODE.get(event.code).upper : KEY_BY_CODE.get(event.code).lower);
    model.queueCharacter(character, expectedCode || event.code);
  } else if (event.key.length === 1) {
    showToast(`“${event.key}” IS NOT AVAILABLE ON THIS 88-CHARACTER KEYBOARD`, 1400);
  }
});

window.addEventListener('keyup', (event) => {
  if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') model.setShiftHeld(false, event.code);
});

window.addEventListener('blur', () => model.setShiftHeld(false));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) model.setShiftHeld(false);
});

const mobileInput = document.getElementById('mobile-input');

function queueMobileText(text) {
  for (const character of text) {
    if (character === '\n') model.queueReturn();
    else if (character === ' ') model.queueSpace();
    else {
      const code = CODE_BY_CHARACTER.get(character);
      if (code) model.queueCharacter(character, code);
      else showToast(`“${character}” IS NOT AVAILABLE ON THIS 88-CHARACTER KEYBOARD`, 1200);
    }
  }
}

mobileInput.addEventListener('focus', () => {
  keyboardCaptured = true;
  if (!audio.context) audio.start().catch(() => {});
});

mobileInput.addEventListener('beforeinput', (event) => {
  if (!event.cancelable) return;
  if (event.inputType === 'deleteContentBackward') {
    event.preventDefault();
    model.queueBackspace();
  } else if (event.inputType === 'insertLineBreak' || event.inputType === 'insertParagraph') {
    event.preventDefault();
    model.queueReturn();
  } else if (event.data) {
    event.preventDefault();
    queueMobileText(event.data);
  }
});

mobileInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    model.queueReturn();
  } else if (event.key === 'Backspace') {
    event.preventDefault();
    model.queueBackspace();
  }
});

mobileInput.addEventListener('input', () => {
  if (mobileInput.value) queueMobileText(mobileInput.value);
  mobileInput.value = '';
});

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function updatePointer(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
}

function firstInteractiveHit(event) {
  updatePointer(event);
  return raycaster.intersectObjects(model.clickTargets, false)[0]?.object ?? null;
}

canvas.addEventListener('pointerdown', (event) => {
  if (!refs['intro-overlay'].classList.contains('dismissed')) return;
  if (!keyboardCaptured) {
    keyboardCaptured = true;
    showToast('KEYBOARD RECONNECTED', 700);
  }
  canvas.focus({ preventScroll: true });
  if (!audio.context) audio.start().catch(() => {});
  const hit = firstInteractiveHit(event);
  if (!hit) return;
  if (hit.userData.keyRecord) {
    model.commandFromPointer(hit.userData.keyRecord);
    event.preventDefault();
  } else if (hit.userData.specialAction === 'return') {
    model.queueReturn();
    event.preventDefault();
  } else if (hit.userData.specialAction === 'ink-cycle') {
    const sequence = ['black', 'red', 'stencil'];
    selectInk(sequence[(sequence.indexOf(inkMode) + 1) % sequence.length]);
    event.preventDefault();
  } else if (hit.userData.specialAction === 'ribbon-reverse') {
    model.reverseRibbonManually();
    event.preventDefault();
  }
});

let hoverFrame = 0;
canvas.addEventListener('pointermove', (event) => {
  cancelAnimationFrame(hoverFrame);
  hoverFrame = requestAnimationFrame(() => {
    canvas.style.cursor = firstInteractiveHit(event) ? 'pointer' : 'grab';
  });
});

canvas.addEventListener('mouseleave', () => { canvas.style.cursor = 'grab'; });
canvas.addEventListener('contextmenu', (event) => event.preventDefault());

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowQuality ? 1 : width < 760 ? 1.35 : 1.75));
}

window.addEventListener('resize', resize);

let lastTime = performance.now();
let uiAccumulator = 0;
let frameAccumulator = 0;
let frameCount = 0;

function updateLiveUi(delta) {
  uiAccumulator += delta;
  if (uiAccumulator < 0.08) return;
  uiAccumulator = 0;
  refs['position-readout'].textContent = `${String(Math.min(page.line + 1, 99)).padStart(2, '0')} · ${String(page.column + 1).padStart(2, '0')}`;
  refs['ribbon-readout'].textContent = `${inkMode.toUpperCase()} · ${model.ribbonDirection > 0 ? '→' : '←'}`;
  refs['ribbon-status'].textContent = `${Math.round(model.ribbonPosition * 100)}%`;
  refs['ribbon-gauge'].style.width = `${Math.round(model.ribbonPosition * 100)}%`;
  const escapeActivity = Math.max(model.escapementAmount, model.universalAmount);
  refs['escapement-gauge'].style.width = `${18 + escapeActivity * 82}%`;
  refs['escapement-status'].textContent = model.returning ? 'RETURN RELEASE' : model.tabMotion ? 'TAB RELEASE' : escapeActivity > 0.12 ? 'DOG EXCHANGE' : 'DOG ENGAGED';
  statusFlash *= 0.5;
  refs['status-lamp'].classList.toggle('striking', statusFlash > 0.12 || model.activeStrikes.length > 0);
  refs['margin-warning'].classList.toggle('show', page.atMargin && !model.marginReleased);
}

function animate(now) {
  requestAnimationFrame(animate);
  const delta = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  model.update(delta);
  updateCameraMotion(delta);
  controls.update();
  updateLiveUi(delta);
  renderer.render(scene, camera);

  frameAccumulator += delta;
  frameCount += 1;
  if (frameCount >= 180) {
    const average = frameAccumulator / frameCount;
    if (!lowQuality && average > 0.024 && renderer.getPixelRatio() > 1.26) renderer.setPixelRatio(1.25);
    frameAccumulator = 0;
    frameCount = 0;
  }
}

requestAnimationFrame(animate);

if (renderer.compileAsync) {
  renderer.compileAsync(scene, camera).catch(() => {});
}

window.__MERIDIAN__ = {
  model,
  get document() { return page; },
  type(text) {
    for (const character of text) {
      if (character === '\n') model.queueReturn();
      else if (character === ' ') model.queueSpace();
      else {
        const code = CODE_BY_CHARACTER.get(character);
        if (code) model.queueCharacter(character, code);
      }
    }
  },
  setView: setCameraView,
};
