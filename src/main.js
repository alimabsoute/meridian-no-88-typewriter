import '@fontsource/bebas-neue/400.css';
import '@fontsource/special-elite/400.css';
import './styles.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TypewriterDocument } from './typewriter-document.js';
import { PaperRenderer } from './textures.js';
import { TypewriterAudio } from './audio-engine.js';
import { CODE_BY_CHARACTER, KEY_BY_CODE, TypewriterModel } from './typewriter-model.js';
import {
  PaperLifecycle,
  PaperLifecycleStore,
  createLocalStorageAdapter,
} from './paper-lifecycle.js';
import { PaperLifecycleView } from './paper-lifecycle-view.js';
import { PhiladelphiaWritingRoom } from './philadelphia-writing-room.js';
import { AtmosphereAudio } from './atmosphere-audio.js';

const STORAGE_KEY = 'meridian-typewriter-state-v1';
const PAPER_STORAGE_KEY = 'meridian.paper-lifecycle.release-1';
const requestedQuality = new URLSearchParams(window.location.search).get('quality');
const lowQuality = requestedQuality === 'low';

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
const initialInkMode = stored?.inkMode && ['black', 'red', 'stencil'].includes(stored.inkMode)
  ? stored.inkMode
  : 'black';

function recoverPlainTextDocument(text, options = {}) {
  const documentState = new TypewriterDocument({ sheetNumber: options.sheetNumber ?? 1 });
  for (const character of typeof text === 'string' ? text : '') {
    if (character === '\n') documentState.carriageReturn();
    else if (character === ' ') documentState.space();
    else documentState.type(character, { ink: initialInkMode });
  }
  if (Number.isSafeInteger(options.line)) documentState.line = Math.min(documentState.lines, Math.max(0, options.line));
  if (Number.isSafeInteger(options.column)) documentState.column = Math.min(documentState.columns, Math.max(0, options.column));
  return documentState;
}

let legacyPage;
try {
  legacyPage = stored?.document
    ? TypewriterDocument.deserialize(stored.document)
    : recoverPlainTextDocument(stored?.recoveryText, {
      sheetNumber: stored?.recoverySheetNumber,
      column: stored?.recoveryColumn,
      line: stored?.recoveryLine,
    });
} catch {
  legacyPage = new TypewriterDocument();
}

let lifecycle;
let lifecycleStore = null;
let lifecycleRecoveryWarning = '';
try {
  lifecycleStore = new PaperLifecycleStore({
    storage: createLocalStorageAdapter(localStorage),
    key: PAPER_STORAGE_KEY,
  });
  lifecycle = PaperLifecycle.open({ store: lifecycleStore });
} catch {
  lifecycle = new PaperLifecycle();
  lifecycleRecoveryWarning = 'Paper archive storage could not be recovered. This session remains available for export.';
}

let lifecycleState = lifecycle.snapshot();
const lifecycleIsFresh = lifecycleState.revision === 0
  && lifecycleState.nextSheetNumber === 1
  && !lifecycleState.insertedSheet
  && !lifecycleState.looseSheet
  && lifecycleState.manuscript.length === 0
  && lifecycleState.discards.length === 0;
if (lifecycleIsFresh) {
  try {
    lifecycle.loadFreshSheet(legacyPage.serialize(), { inkMode: initialInkMode, migratedFrom: 'v1' });
    lifecycleState = lifecycle.snapshot();
  } catch (error) {
    if (error?.code === 'revision-conflict' && lifecycleStore) {
      // Another tab completed first-run setup between load and insert. Follow
      // that durable revision instead of overwriting it or failing startup.
      lifecycle = PaperLifecycle.open({ store: lifecycleStore });
      lifecycleState = lifecycle.snapshot();
    } else {
      lifecycle = new PaperLifecycle();
      lifecycle.loadFreshSheet(legacyPage.serialize(), { inkMode: initialInkMode, migratedFrom: 'v1' });
      lifecycleState = lifecycle.snapshot();
      lifecycleRecoveryWarning = 'Paper archive storage is unavailable. Export this sheet before closing.';
    }
  }
}

function documentFromPaperRecord(record, fallbackSheetNumber = 1) {
  try {
    return record?.content
      ? TypewriterDocument.deserialize(record.content)
      : new TypewriterDocument({ sheetNumber: record?.sheetNumber ?? fallbackSheetNumber });
  } catch {
    return new TypewriterDocument({ sheetNumber: record?.sheetNumber ?? fallbackSheetNumber });
  }
}

const initialPaperRecord = lifecycleState.insertedSheet ?? lifecycleState.looseSheet?.page ?? null;
let page = documentFromPaperRecord(initialPaperRecord, lifecycleState.nextSheetNumber);

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
renderer.toneMappingExposure = 1.22;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x11191b);
scene.fog = new THREE.FogExp2(0x11191b, 0.012);

const camera = new THREE.PerspectiveCamera(37, window.innerWidth / window.innerHeight, 0.05, 80);
camera.position.set(8.45, 5.85, 11.4);

const controls = new OrbitControls(camera, canvas);
canvas.style.cursor = 'default';
controls.target.set(0, 1.43, 0.55);
controls.enableDamping = true;
controls.dampingFactor = 0.065;
controls.minDistance = 6.4;
controls.maxDistance = 13.5;
controls.minPolarAngle = 0.5;
controls.maxPolarAngle = 1.38;
controls.minAzimuthAngle = -1.02;
controls.maxAzimuthAngle = 1.02;
controls.maxTargetRadius = 4.5;
controls.enablePan = false;
controls.screenSpacePanning = false;
controls.enabled = false;
controls.update();

const hemisphere = new THREE.HemisphereLight(0x8fa9b4, 0x2f1c13, 1.18);
scene.add(hemisphere);

const warmKey = new THREE.SpotLight(0xffc486, 245, 30, Math.PI * 0.22, 0.46, 1.25);
warmKey.position.set(-5.0, 8.5, 5.7);
warmKey.target.position.set(0.4, 1.0, 0.3);
warmKey.castShadow = !lowQuality;
warmKey.shadow.mapSize.set(lowQuality ? 512 : 2048, lowQuality ? 512 : 2048);
warmKey.shadow.camera.near = 2;
warmKey.shadow.camera.far = 24;
warmKey.shadow.bias = -0.00016;
scene.add(warmKey, warmKey.target);

const coolRim = new THREE.SpotLight(0x9ec8ca, 132, 28, Math.PI * 0.25, 0.6, 1.1);
coolRim.position.set(7.5, 6.3, -7.2);
coolRim.target.position.set(0, 1.6, -0.2);
scene.add(coolRim, coolRim.target);

const paperLight = new THREE.PointLight(0xffe3b5, 32, 9, 1.5);
paperLight.position.set(0.2, 5.1, 2.8);
scene.add(paperLight);

const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const weatherMode = ['quiet', 'rain', 'snow', 'nor-easter', 'automatic'].includes(stored?.weatherMode)
  ? stored.weatherMode
  : 'snow';
const uneaseMode = ['off', 'subtle', 'unsettling'].includes(stored?.uneaseMode)
  ? stored.uneaseMode
  : 'subtle';
const room = new PhiladelphiaWritingRoom({
  scene,
  renderer,
  weather: weatherMode,
  unease: uneaseMode,
  quality: requestedQuality === 'high' ? 'high' : lowQuality ? 'low' : 'medium',
  eveningProgress: 0.24,
  brightness: 1.22,
  reducedMotion: reducedMotionQuery.matches,
  seed: 88,
});

const audio = new TypewriterAudio();
audio.setEnabled(stored?.soundEnabled !== false);
audio.setVolume(Number.isFinite(stored?.machineVolume) ? stored.machineVolume : 0.78);
audio.setPaperVolume(Number.isFinite(stored?.paperVolume) ? stored.paperVolume : 0.62);
const atmosphereAudio = new AtmosphereAudio({
  weather: weatherMode === 'automatic' ? 'quiet' : weatherMode,
  unease: uneaseMode,
  enabled: stored?.soundEnabled !== false,
  volumes: {
    room: Number.isFinite(stored?.roomVolume) ? stored.roomVolume : 0.46,
    weather: Number.isFinite(stored?.weatherVolume) ? stored.weatherVolume : 0.52,
    unease: Number.isFinite(stored?.uneaseVolume) ? stored.uneaseVolume : 0.24,
  },
  seed: 88,
});
let paperRenderer = new PaperRenderer(page);

const refs = Object.fromEntries([
  'position-readout', 'ribbon-readout', 'sheet-readout', 'escapement-status', 'escapement-gauge',
  'ribbon-status', 'ribbon-gauge', 'status-lamp', 'transcript', 'document-summary', 'margin-warning',
  'toast', 'screen-reader-status', 'sound-toggle', 'inspection-toggle', 'document-toggle', 'document-content',
  'field-guide', 'intro-overlay', 'weather-select', 'unease-select', 'machine-volume', 'paper-volume', 'room-volume',
  'weather-volume', 'unease-volume', 'release-sheet', 'paper-status', 'manuscript-count', 'discard-count',
  'keep-sheet', 'crumple-sheet', 'reinsert-sheet', 'load-sheet', 'recover-sheet', 'restore-manuscript',
  'empty-wastebasket', 'archive-warning',
].map((id) => [id, document.getElementById(id)]));

let toastTimer = 0;
let persistTimer = 0;
let paperCheckpointTimer = 0;
let keyboardCaptured = false;
let inkMode = initialInkMode;
let cameraMotion = null;
let statusFlash = 0;
let inspectionEnabled = false;
const backgroundLayers = [...document.querySelectorAll('.ui-layer:not(#intro-overlay)')];
for (const layer of backgroundLayers) layer.inert = true;

function focusMachine() {
  if (!refs['intro-overlay'].classList.contains('dismissed') || refs['field-guide'].open) return;
  if (!lifecycle.getOverview().insertedSheet || paperActionBusy) {
    keyboardCaptured = false;
    return;
  }
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

function archiveWarningMessage(error) {
  if (error?.code === 'revision-conflict') {
    return 'ARCHIVE CHANGED IN ANOTHER TAB · EXPORT THIS SHEET, THEN RELOAD';
  }
  if (error?.code === 'storage-capacity-exceeded') {
    return 'LOCAL ARCHIVE IS FULL · EXPORT THIS SHEET BEFORE CLOSING';
  }
  return 'LOCAL ARCHIVE IS NOT SAVING · EXPORT THIS SHEET BEFORE CLOSING';
}

function syncArchiveWarning() {
  refs['archive-warning'].hidden = !lifecycleRecoveryWarning;
  refs['archive-warning'].textContent = lifecycleRecoveryWarning;
}

function markArchiveWarning(error) {
  lifecycleRecoveryWarning = archiveWarningMessage(error);
  syncArchiveWarning();
  showToast(lifecycleRecoveryWarning, 2600);
  announce(lifecycleRecoveryWarning.toLowerCase());
}

function markEmergencyCopyWarning() {
  lifecycleRecoveryWarning = 'EMERGENCY TEXT COPY UNAVAILABLE · VERSIONED ARCHIVE REMAINS ACTIVE';
  syncArchiveWarning();
  showToast(lifecycleRecoveryWarning, 2200);
}

function clearArchiveWarning() {
  lifecycleRecoveryWarning = '';
  syncArchiveWarning();
}

function isArchivePersistenceFailure(error) {
  return error?.name === 'PaperPersistenceError'
    || ['revision-conflict', 'storage-capacity-exceeded'].includes(error?.code);
}

function checkpointInsertedSheet(immediate = false) {
  clearTimeout(paperCheckpointTimer);
  const writeCheckpoint = () => {
    if (!lifecycle.getOverview().insertedSheet) return;
    try {
      const transition = lifecycle.updateInsertedSheet(page.serialize(), {
        inkMode,
        lastColumn: page.column,
        lastLine: page.line,
      });
      lifecycleState = transition.state;
      if (transition.persistence?.durable) clearArchiveWarning();
      else markArchiveWarning({ code: 'storage-unavailable' });
    } catch (error) {
      markArchiveWarning(error);
    }
  };
  if (immediate) writeCheckpoint();
  else paperCheckpointTimer = setTimeout(writeCheckpoint, 420);
}

function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        // A compact emergency copy. The versioned paper archive preserves the
        // full impression data without serializing an entire manuscript here.
        recoveryText: page.toPlainText(),
        recoverySheetNumber: page.sheetNumber,
        recoveryColumn: page.column,
        recoveryLine: page.line,
        inkMode,
        soundEnabled: audio.enabled,
        machineVolume: audio.volume,
        paperVolume: audio.paperVolume,
        roomVolume: atmosphereAudio.volumes.room,
        weatherVolume: atmosphereAudio.volumes.weather,
        uneaseVolume: atmosphereAudio.volumes.unease,
        weatherMode: room.weatherPreset,
        uneaseMode: room.uneaseLevel,
      }));
    } catch {
      // The compact recovery copy is secondary to the versioned paper archive,
      // but a visible warning keeps any storage failure honest.
      markEmergencyCopyWarning();
    }
  }, 180);
  checkpointInsertedSheet();
}

function updateDocumentUi() {
  const lifecycleUiState = lifecycle.getOverview();
  const inserted = lifecycleUiState.insertedSheet;
  const loose = lifecycleUiState.looseSheet?.page ?? null;
  const activeRecord = inserted ?? loose;
  const text = page.toPlainText();
  refs.transcript.textContent = activeRecord ? (text || 'The page is waiting.') : 'No paper is currently in the machine.';
  if (inserted) {
    refs['document-summary'].textContent = page.marks.length
      ? `${page.marks.length} impression${page.marks.length === 1 ? '' : 's'} · line ${Math.min(page.line + 1, page.lines)}`
      : 'Blank sheet loaded';
    refs['paper-status'].textContent = `SHEET INSERTED · LINE ${String(page.line + 1).padStart(2, '0')}`;
  } else if (loose) {
    refs['document-summary'].textContent = `Released sheet ${String(loose.sheetNumber).padStart(2, '0')} awaiting its fate`;
    refs['paper-status'].textContent = 'LOOSE SHEET · DECIDE ITS FATE';
  } else {
    refs['document-summary'].textContent = lifecycleRecoveryWarning || 'No sheet loaded';
    refs['paper-status'].textContent = 'PAPER PATH EMPTY';
  }
  const shownSheet = activeRecord?.sheetNumber ?? lifecycleUiState.nextSheetNumber;
  refs['sheet-readout'].textContent = `LETTER · ${String(shownSheet).padStart(2, '0')}`;
  refs['manuscript-count'].textContent = String(lifecycleUiState.manuscriptCount);
  refs['discard-count'].textContent = String(lifecycleUiState.discardCount);

  refs['release-sheet'].hidden = !inserted;
  refs['release-sheet'].disabled = paperActionBusy;
  refs['keep-sheet'].hidden = !loose;
  refs['crumple-sheet'].hidden = !loose;
  refs['reinsert-sheet'].hidden = !loose;
  refs['load-sheet'].hidden = Boolean(inserted || loose);
  refs['recover-sheet'].hidden = Boolean(inserted || loose || lifecycleUiState.discardCount === 0);
  refs['restore-manuscript'].hidden = Boolean(inserted || loose || lifecycleUiState.manuscriptCount === 0);
  refs['empty-wastebasket'].hidden = lifecycleUiState.discardCount === 0;
  for (const control of [
    refs['keep-sheet'], refs['crumple-sheet'], refs['reinsert-sheet'], refs['load-sheet'],
    refs['recover-sheet'], refs['restore-manuscript'], refs['empty-wastebasket'],
  ]) control.disabled = paperActionBusy;
  document.getElementById('download-text').disabled = !activeRecord;
  document.getElementById('download-paper').disabled = !activeRecord;
  syncArchiveWarning();
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

let paperActionBusy = false;
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

function handlePaperRitualEvent(event) {
  switch (event.type) {
    case 'extraction-start':
      announce('The sheet is leaving the platen.');
      break;
    case 'inspection-ready':
      showToast('SHEET RELEASED · KEEP, CRUMPLE, OR REINSERT', 1700);
      announce('Sheet released and ready to inspect.');
      break;
    case 'manuscript-filed':
      showToast(`SHEET FILED · ${event.totalCount} IN MANUSCRIPT`, 1400);
      announce('Sheet placed in the manuscript tray.');
      break;
    case 'crumple-start':
      announce('Crumpling the loose draft.');
      break;
    case 'discard-landed':
      showToast('DRAFT DISCARDED · RECOVERABLE FROM THE BASKET', 1600);
      announce('Draft discarded. It remains recoverable.');
      break;
    case 'recover-complete':
      showToast('DISCARDED SHEET RECOVERED', 1200);
      announce('Discarded sheet recovered for inspection.');
      break;
    case 'fresh-sheet-start':
      announce('Feeding a fresh sheet into the platen.');
      break;
    case 'fresh-sheet-complete':
      showToast('FRESH PAPER ALIGNED · BEGIN TYPING', 1300);
      announce('Fresh paper aligned and ready.');
      break;
    case 'reinsert-complete':
      showToast('SHEET REINSERTED · OVERSTRIKES PRESERVED', 1300);
      announce('Sheet reinserted. Existing ink remains on the page.');
      break;
    default:
      break;
  }
}

const paperView = new PaperLifecycleView({
  parent: scene,
  getMachinePaperMesh: () => model.paperMesh,
  setMachinePaperVisible: (visible, mesh) => {
    if (mesh) mesh.visible = visible;
  },
  inspectionPosition: new THREE.Vector3(2.1, 4.7, 2.7),
  inspectionRotation: [-0.1, 0.34, 0.018],
  inspectionScale: new THREE.Vector3(0.34, 0.34, 0.34),
  manuscriptPosition: new THREE.Vector3(-6.6, 0.18, 1.8),
  manuscriptScale: 0.4,
  wastebasketPosition: new THREE.Vector3(5.75, 0.08, 1.15),
  wastebasketRadius: 0.55,
  wastebasketHeight: 1.05,
  wastebasketColor: 0x3f2d20,
  freshSheetPosition: new THREE.Vector3(6.25, 0.42, 1.25),
  onEvent: handlePaperRitualEvent,
});

function textureForLifecyclePage(record, temporaryTextures) {
  try {
    const archivedDocument = TypewriterDocument.deserialize(record.content);
    const archivedRenderer = new PaperRenderer(archivedDocument);
    temporaryTextures.push(archivedRenderer.texture);
    return archivedRenderer.texture;
  } catch {
    return null;
  }
}

function syncPaperSceneFromLifecycle() {
  const temporaryTextures = [];
  lifecycleState = lifecycle.snapshot();
  paperView.syncFromState(lifecycleState, {
    textureForPage: (record) => textureForLifecyclePage(record, temporaryTextures),
  });
  for (const texture of temporaryTextures) texture.dispose();
}

syncPaperSceneFromLifecycle();
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
  paper: {
    position: new THREE.Vector3(6.7, 6.45, 10.1),
    target: new THREE.Vector3(1.3, 3.35, 2.05),
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

function syncAtmosphereUi() {
  refs['weather-select'].value = room.weatherPreset === 'automatic' ? 'quiet' : room.weatherPreset;
  refs['unease-select'].value = room.uneaseLevel;
  refs['machine-volume'].value = String(audio.volume);
  refs['paper-volume'].value = String(audio.paperVolume);
  refs['room-volume'].value = String(atmosphereAudio.volumes.room);
  refs['weather-volume'].value = String(atmosphereAudio.volumes.weather);
  refs['unease-volume'].value = String(atmosphereAudio.volumes.unease);
  const mark = document.querySelector('.weather-mark');
  mark.textContent = ({ quiet: '◌', rain: '╱', snow: '❄', 'nor-easter': '※' })[room.weatherPreset] ?? '◌';
}

syncAtmosphereUi();

refs['weather-select'].addEventListener('change', () => {
  const mode = room.setWeatherPreset(refs['weather-select'].value, { immediate: true });
  atmosphereAudio.setWeather(mode);
  syncAtmosphereUi();
  showToast(`${mode === 'nor-easter' ? 'NOR’EASTER' : mode.toUpperCase()} AT THE WINDOW`, 1000);
  persist();
});

refs['unease-select'].addEventListener('change', () => {
  const level = room.setUnease(refs['unease-select'].value);
  atmosphereAudio.setUnease(level);
  syncAtmosphereUi();
  showToast(`UNEASE · ${level.toUpperCase()}`, 900);
  persist();
});

refs['machine-volume'].addEventListener('input', () => {
  audio.setVolume(Number(refs['machine-volume'].value));
  persist();
});

refs['paper-volume'].addEventListener('input', () => {
  audio.setPaperVolume(Number(refs['paper-volume'].value));
  persist();
});

for (const [id, channel] of [['room-volume', 'room'], ['weather-volume', 'weather'], ['unease-volume', 'unease']]) {
  refs[id].addEventListener('input', () => {
    atmosphereAudio.setVolumes({ [channel]: Number(refs[id].value) });
    persist();
  });
}

document.getElementById('enter-studio').addEventListener('click', () => {
  refs['intro-overlay'].classList.add('dismissed');
  refs['intro-overlay'].setAttribute('aria-hidden', 'true');
  for (const layer of backgroundLayers) layer.inert = false;
  focusMachine();
  audio.start().catch(() => {});
  atmosphereAudio.start().catch(() => {});
  const inserted = lifecycle.getOverview().insertedSheet;
  showToast(inserted ? 'KEYBOARD CONNECTED · BEGIN TYPING' : 'PAPER PATH EMPTY · LOAD A FRESH SHEET', 1500);
  announce(inserted ? 'Typewriter active. Begin typing. Press Escape to release the keyboard.' : 'Typewriter active, but no sheet is loaded. Open Document and load fresh paper.');
});

refs['sound-toggle'].addEventListener('click', async () => {
  if (!audio.context) await audio.start().catch(() => false);
  await atmosphereAudio.start().catch(() => false);
  audio.setEnabled(!audio.enabled);
  atmosphereAudio.setEnabled(audio.enabled);
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
  inspectionEnabled = enabled;
  refs['inspection-toggle'].setAttribute('aria-pressed', String(enabled));
  model.setInspection(enabled);
  controls.enabled = enabled;
  canvas.style.cursor = enabled ? 'grab' : 'default';
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

function beginPaperAction() {
  if (paperActionBusy) return false;
  if (model.busy) {
    showToast('LET THE MECHANISM COME TO REST FIRST', 1100);
    return false;
  }
  paperActionBusy = true;
  keyboardCaptured = false;
  model.setShiftHeld(false);
  updateDocumentUi();
  return true;
}

function finishPaperAction({ refocus = false } = {}) {
  paperActionBusy = false;
  updateDocumentUi();
  persist();
  if (refocus) focusMachine();
}

function installDocumentFromRecord(record, { animateLoad = false, visible = true } = {}) {
  page = documentFromPaperRecord(record, record.sheetNumber);
  paperRenderer = new PaperRenderer(page);
  model.setDocument(page, paperRenderer, { animateLoad });
  model.paperMesh.visible = visible;
  refs['margin-warning'].classList.remove('show');
  const restoredInkMode = record.metadata?.inkMode;
  if (['black', 'red', 'stencil'].includes(restoredInkMode)) inkMode = restoredInkMode;
  model.setInkMode(inkMode);
  syncInkUi();
}

refs['release-sheet'].addEventListener('click', async () => {
  if (!beginPaperAction()) return;
  try {
    checkpointInsertedSheet(true);
    const transition = lifecycle.extractInsertedSheet();
    lifecycleState = transition.state;
    if (transition.persistence?.durable) clearArchiveWarning();
    updateDocumentUi();
    setCameraView('paper', 0.55);
    audio.paper();
    await paperView.extract({
      pageId: transition.page.id,
      texture: paperRenderer.texture,
    });
  } catch (error) {
    if (isArchivePersistenceFailure(error)) markArchiveWarning(error);
    showToast('THE SHEET COULD NOT BE RELEASED · TRY AGAIN', 1500);
    syncPaperSceneFromLifecycle();
  } finally {
    finishPaperAction();
  }
});

refs['keep-sheet'].addEventListener('click', async () => {
  if (!beginPaperAction()) return;
  const loose = lifecycle.getOverview().looseSheet?.page;
  try {
    const transition = lifecycle.saveLooseSheetToManuscript({ title: `Sheet ${loose.sheetNumber}` });
    lifecycleState = transition.state;
    if (transition.persistence?.durable) clearArchiveWarning();
    await paperView.fileToManuscript({
      pageId: loose.id,
      totalCount: transition.state.manuscript.length,
    });
    setCameraView('writer', 0.55);
  } catch (error) {
    if (isArchivePersistenceFailure(error)) markArchiveWarning(error);
    showToast('THE SHEET COULD NOT BE FILED · IT REMAINS SAFE', 1500);
    if (paperView.phase === 'idle') syncPaperSceneFromLifecycle();
  } finally {
    finishPaperAction();
  }
});

async function discardLooseSheet() {
  if (!beginPaperAction()) return;
  const loose = lifecycle.getOverview().looseSheet?.page;
  try {
    const seed = Math.floor(Math.random() * 0x7fffffff);
    const transition = lifecycle.discardLooseSheet({ seed, compression: 1, landing: { location: 'basket' } });
    lifecycleState = transition.state;
    if (transition.persistence?.durable) clearArchiveWarning();
    await paperView.crumple({ seed });
    await paperView.throwToWastebasket({ pageId: loose.id, seed, landing: { location: 'basket' } });
    setCameraView('writer', 0.55);
  } catch (error) {
    if (isArchivePersistenceFailure(error)) markArchiveWarning(error);
    showToast('THE DRAFT COULD NOT BE DISCARDED · IT REMAINS RECOVERABLE', 1700);
    if (paperView.phase === 'idle') syncPaperSceneFromLifecycle();
  } finally {
    finishPaperAction();
  }
}

let crumpleHoldTimer = 0;
function cancelCrumpleHold() {
  clearTimeout(crumpleHoldTimer);
  crumpleHoldTimer = 0;
  refs['crumple-sheet'].classList.remove('holding');
}
function startCrumpleHold(event) {
  if (paperActionBusy || refs['crumple-sheet'].hidden) return;
  if (event.type === 'keydown' && event.repeat) return;
  if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  cancelCrumpleHold();
  refs['crumple-sheet'].classList.add('holding');
  crumpleHoldTimer = setTimeout(() => {
    crumpleHoldTimer = 0;
    refs['crumple-sheet'].classList.remove('holding');
    discardLooseSheet();
  }, 950);
}
refs['crumple-sheet'].addEventListener('pointerdown', startCrumpleHold);
refs['crumple-sheet'].addEventListener('pointerup', cancelCrumpleHold);
refs['crumple-sheet'].addEventListener('pointerleave', cancelCrumpleHold);
refs['crumple-sheet'].addEventListener('pointercancel', cancelCrumpleHold);
refs['crumple-sheet'].addEventListener('keydown', startCrumpleHold);
refs['crumple-sheet'].addEventListener('keyup', cancelCrumpleHold);

refs['reinsert-sheet'].addEventListener('click', async () => {
  if (!beginPaperAction()) return;
  const loose = lifecycle.getOverview().looseSheet?.page;
  try {
    const transition = lifecycle.reinsertLooseSheet();
    installDocumentFromRecord(transition.page, { animateLoad: false, visible: false });
    lifecycleState = transition.state;
    if (transition.persistence?.durable) clearArchiveWarning();
    await paperView.reinsert({ pageId: loose.id, sourceMesh: model.paperMesh });
    setCameraView('writer', 0.55);
  } catch (error) {
    if (isArchivePersistenceFailure(error)) markArchiveWarning(error);
    showToast('THE SHEET COULD NOT BE REINSERTED · IT REMAINS SAFE', 1500);
    if (paperView.phase === 'idle') syncPaperSceneFromLifecycle();
  } finally {
    finishPaperAction({ refocus: Boolean(lifecycle.getOverview().insertedSheet) });
  }
});

refs['load-sheet'].addEventListener('click', async () => {
  if (!beginPaperAction()) return;
  try {
    const nextSheetNumber = lifecycle.getOverview().nextSheetNumber;
    const freshDocument = new TypewriterDocument({ sheetNumber: nextSheetNumber });
    const transition = lifecycle.loadFreshSheet(freshDocument.serialize(), { inkMode });
    lifecycleState = transition.state;
    if (transition.persistence?.durable) clearArchiveWarning();
    installDocumentFromRecord(transition.page, { animateLoad: false, visible: false });
    audio.paper();
    await paperView.loadFreshSheet({ pageId: transition.page.id, texture: paperRenderer.texture, startScale: 0.5 });
    setCameraView('writer', 0.58);
  } catch (error) {
    if (isArchivePersistenceFailure(error)) markArchiveWarning(error);
    showToast('FRESH PAPER COULD NOT BE LOADED · TRY AGAIN', 1400);
    if (paperView.phase === 'idle') syncPaperSceneFromLifecycle();
  } finally {
    finishPaperAction({ refocus: Boolean(lifecycle.getOverview().insertedSheet) });
  }
});

async function recoverDiscardById(pageId) {
  if (lifecycle.getOverview().insertedSheet || lifecycle.getOverview().looseSheet) {
    showToast('FINISH HANDLING THE CURRENT SHEET FIRST', 1200);
    return;
  }
  if (!beginPaperAction()) return;
  const discarded = lifecycle.getOverview().discards.find((entry) => entry.page.id === pageId);
  if (!discarded) {
    finishPaperAction();
    showToast('THAT DISCARD IS NO LONGER IN THE BASKET', 1100);
    return;
  }
  try {
    const transition = lifecycle.recoverDiscardedSheet(discarded.page.id);
    lifecycleState = transition.state;
    if (transition.persistence?.durable) clearArchiveWarning();
    installDocumentFromRecord(transition.page, { animateLoad: false, visible: false });
    setCameraView('paper', 0.5);
    await paperView.recoverDiscard({
      pageId: transition.page.id,
      seed: transition.previousCrumple.seed,
      landing: transition.previousCrumple.landing,
      texture: paperRenderer.texture,
    });
  } catch (error) {
    if (isArchivePersistenceFailure(error)) markArchiveWarning(error);
    showToast('THAT DRAFT COULD NOT BE RECOVERED', 1300);
    if (paperView.phase === 'idle') syncPaperSceneFromLifecycle();
  } finally {
    finishPaperAction();
  }
}

refs['recover-sheet'].addEventListener('click', () => {
  const discarded = lifecycle.getOverview().discards.at(-1);
  if (discarded) recoverDiscardById(discarded.page.id);
});

refs['restore-manuscript'].addEventListener('click', () => {
  if (!beginPaperAction()) return;
  const manuscript = lifecycle.getOverview().manuscript.at(-1);
  try {
    const transition = lifecycle.restoreManuscriptSheet(manuscript.page.id);
    lifecycleState = transition.state;
    if (transition.persistence?.durable) clearArchiveWarning();
    installDocumentFromRecord(transition.page, { animateLoad: false, visible: false });
    syncPaperSceneFromLifecycle();
    setCameraView('paper', 0.5);
    showToast('MANUSCRIPT PAGE LIFTED FOR INSPECTION', 1200);
  } catch (error) {
    if (isArchivePersistenceFailure(error)) markArchiveWarning(error);
    showToast('THAT MANUSCRIPT PAGE COULD NOT BE RESTORED', 1400);
  } finally {
    finishPaperAction();
  }
});

refs['empty-wastebasket'].addEventListener('click', () => {
  if (paperActionBusy) return;
  const count = lifecycle.getOverview().discardCount;
  if (!count || !window.confirm(`Permanently empty ${count} discarded sheet${count === 1 ? '' : 's'}? This cannot be undone.`)) return;
  try {
    const transition = lifecycle.permanentlyEmptyWastebasket();
    if (transition.persistence?.durable) clearArchiveWarning();
    paperView.setDiscardEntries([]);
    updateDocumentUi();
    persist();
    showToast('WASTEBASKET EMPTIED · DISCARDS CANNOT BE RECOVERED', 1600);
  } catch (error) {
    if (isArchivePersistenceFailure(error)) markArchiveWarning(error);
    showToast('WASTEBASKET COULD NOT BE EMPTIED · DISCARDS REMAIN SAFE', 1600);
  }
});

function shouldIgnoreKeyboard(event) {
  if (!keyboardCaptured || refs['field-guide'].open) return true;
  if (!lifecycle.getOverview().insertedSheet || paperActionBusy) return true;
  if (event.ctrlKey || event.metaKey || event.altKey) return true;
  const target = event.target;
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target instanceof HTMLButtonElement
    || target instanceof HTMLAnchorElement;
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
    showToast(`“${event.key}” IS NOT AVAILABLE ON THIS MERIDIAN LAYOUT`, 1400);
  }
});

window.addEventListener('keyup', (event) => {
  if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') model.setShiftHeld(false, event.code);
});

window.addEventListener('blur', () => model.setShiftHeld(false));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    model.setShiftHeld(false);
    checkpointInsertedSheet(true);
  }
});

reducedMotionQuery.addEventListener?.('change', (event) => room.setReducedMotion(event.matches));

const mobileInput = document.getElementById('mobile-input');

function queueMobileText(text) {
  if (!lifecycle.getOverview().insertedSheet || paperActionBusy) {
    showToast('LOAD PAPER BEFORE TYPING', 900);
    return;
  }
  for (const character of text) {
    if (character === '\n') model.queueReturn();
    else if (character === ' ') model.queueSpace();
    else {
      const code = CODE_BY_CHARACTER.get(character);
      if (code) model.queueCharacter(character, code);
      else showToast(`“${character}” IS NOT AVAILABLE ON THIS MERIDIAN LAYOUT`, 1200);
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
  const targets = [...model.clickTargets, ...paperView.getRaycastTargets()];
  return raycaster.intersectObjects(targets, false)[0]?.object ?? null;
}

canvas.addEventListener('pointerdown', (event) => {
  if (!refs['intro-overlay'].classList.contains('dismissed')) return;
  if (!keyboardCaptured) {
    keyboardCaptured = true;
    showToast('KEYBOARD RECONNECTED', 700);
  }
  canvas.focus({ preventScroll: true });
  if (!audio.context) audio.start().catch(() => {});
  if (!atmosphereAudio.context) atmosphereAudio.start().catch(() => {});
  const hit = firstInteractiveHit(event);
  if (!hit) return;
  const paperTarget = paperView.resolveRaycastTarget(hit);
  if (paperTarget?.action === 'recover-page') {
    recoverDiscardById(paperTarget.pageId);
    event.preventDefault();
  } else if (paperTarget?.action === 'browse-manuscript') {
    const tray = refs['document-toggle'].closest('.document-tray');
    if (!tray.classList.contains('open')) refs['document-toggle'].click();
    const count = lifecycle.getOverview().manuscriptCount;
    showToast(`${count} SHEET${count === 1 ? '' : 'S'} IN MANUSCRIPT`, 1000);
    event.preventDefault();
  } else if (paperTarget?.action === 'browse-discards') {
    const tray = refs['document-toggle'].closest('.document-tray');
    if (!tray.classList.contains('open')) refs['document-toggle'].click();
    const count = lifecycle.getOverview().discardCount;
    showToast(`${count} RECOVERABLE DISCARD${count === 1 ? '' : 'S'}`, 1000);
    event.preventDefault();
  } else if (paperTarget?.action === 'inspect-page') {
    setCameraView('paper', 0.45);
    event.preventDefault();
  } else if (hit.userData.keyRecord) {
    if (!lifecycle.getOverview().insertedSheet || paperActionBusy) {
      showToast('LOAD PAPER BEFORE TYPING', 900);
      return;
    }
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
    canvas.style.cursor = firstInteractiveHit(event) ? 'pointer' : inspectionEnabled ? 'grab' : 'default';
  });
});

canvas.addEventListener('mouseleave', () => { canvas.style.cursor = inspectionEnabled ? 'grab' : 'default'; });
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
  const hasInsertedPaper = Boolean(lifecycle.getOverview().insertedSheet);
  refs['position-readout'].textContent = hasInsertedPaper
    ? `${String(Math.min(page.line + 1, 99)).padStart(2, '0')} · ${String(page.column + 1).padStart(2, '0')}`
    : '— · —';
  refs['ribbon-readout'].textContent = `${inkMode.toUpperCase()} · ${model.ribbonDirection > 0 ? '→' : '←'}`;
  refs['ribbon-status'].textContent = `${Math.round(model.ribbonPosition * 100)}%`;
  refs['ribbon-gauge'].style.width = `${Math.round(model.ribbonPosition * 100)}%`;
  const escapeActivity = Math.max(model.escapementAmount, model.universalAmount);
  refs['escapement-gauge'].style.width = `${18 + escapeActivity * 82}%`;
  refs['escapement-status'].textContent = model.returning ? 'RETURN RELEASE' : model.tabMotion ? 'TAB RELEASE' : escapeActivity > 0.12 ? 'DOG EXCHANGE' : 'DOG ENGAGED';
  statusFlash *= 0.5;
  refs['status-lamp'].classList.toggle('striking', statusFlash > 0.12 || model.activeStrikes.length > 0);
  refs['margin-warning'].classList.toggle('show', hasInsertedPaper && page.atMargin && !model.marginReleased);
}

function animate(now) {
  requestAnimationFrame(animate);
  const delta = Math.max(0, Math.min(0.05, (now - lastTime) / 1000));
  lastTime = now;
  model.update(delta);
  paperView.update(delta);
  room.update(delta);
  atmosphereAudio.update(delta, room.getState());
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

window.addEventListener('pagehide', () => checkpointInsertedSheet(true));

if (renderer.compileAsync) {
  renderer.compileAsync(scene, camera).catch(() => {});
}

window.__MERIDIAN__ = {
  model,
  audio,
  camera,
  get document() { return page; },
  lifecycle,
  paperView,
  room,
  atmosphereAudio,
  get paperState() { return lifecycle.snapshot(); },
  type(text) {
    if (!lifecycle.getOverview().insertedSheet || paperActionBusy) return false;
    for (const character of text) {
      if (character === '\n') model.queueReturn();
      else if (character === ' ') model.queueSpace();
      else {
        const code = CODE_BY_CHARACTER.get(character);
        if (code) model.queueCharacter(character, code);
      }
    }
    return true;
  },
  setView: setCameraView,
  setWeather(mode) {
    const result = room.setWeatherPreset(mode, { immediate: true });
    atmosphereAudio.setWeather(result);
    refs['weather-select'].value = result;
    return result;
  },
  setUnease(level) {
    const result = room.setUnease(level);
    atmosphereAudio.setUnease(result);
    refs['unease-select'].value = result;
    return result;
  },
};
