import '@fontsource/bebas-neue/400.css';
import '@fontsource/special-elite/400.css';
import './styles.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TypewriterDocument } from './typewriter-document.js';
import { PaperRenderer } from './textures.js';
import { TypewriterAudio } from './audio-engine.js';
import { CODE_BY_CHARACTER, KEY_BY_CODE, TOUCH_PRESETS, TypewriterModel } from './typewriter-model.js';
import {
  PaperLifecycle,
  PaperLifecycleStore,
  createLocalStorageAdapter,
} from './paper-lifecycle.js';
import { PaperLifecycleView } from './paper-lifecycle-view.js';
import { PhiladelphiaWritingRoom } from './philadelphia-writing-room.js';
import { AtmosphereAudio } from './atmosphere-audio.js';
import { BRAND, formatSheetExportFilename } from './brand.js';

const STORAGE_KEY = BRAND.simulatorStorageKey;
const PAPER_STORAGE_KEY = BRAND.paperStorageKey;
const FIRST_SHEET_TUTORIAL_KEY = `${BRAND.storageNamespace}.first-sheet-tutorial.v1`;
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

const compactLandingCamera = window.innerWidth <= 900;
const camera = new THREE.PerspectiveCamera(compactLandingCamera ? 50 : 37, window.innerWidth / window.innerHeight, 0.05, 80);
camera.position.set(...(compactLandingCamera ? [13.65, 6.48, 12.94] : [8.45, 5.85, 11.4]));

const controls = new OrbitControls(camera, canvas);
canvas.style.cursor = 'default';
controls.target.set(...(compactLandingCamera ? [4.15, 1.43, 0.55] : [0, 1.43, 0.55]));
controls.enableDamping = true;
controls.dampingFactor = 0.065;
controls.minDistance = 6.4;
controls.maxDistance = 16.5;
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
const weatherMode = ['quiet', 'autumn-wind', 'rain', 'snow', 'nor-easter', 'automatic'].includes(stored?.weatherMode)
  ? stored.weatherMode
  : 'autumn-wind';
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
  'field-guide', 'intro-overlay', 'intro-guide', 'weather-select', 'unease-select', 'machine-volume', 'paper-volume', 'room-volume',
  'weather-volume', 'unease-volume', 'release-sheet', 'paper-status', 'manuscript-count', 'discard-count',
  'keep-sheet', 'crumple-sheet', 'reinsert-sheet', 'load-sheet', 'recover-sheet', 'restore-manuscript',
  'empty-wastebasket', 'archive-warning', 'environment-summary',
  'quiet-mode-toggle', 'input-state', 'input-status', 'mobile-view-select', 'mobile-mechanics-toggle',
  'mobile-mechanics-close', 'atmosphere-pause',
  'first-sheet-coach', 'coach-progress', 'coach-next', 'coach-skip', 'coach-dismiss', 'coach-open',
  'force-status', 'left-margin-control', 'right-margin-control', 'left-margin-value', 'right-margin-value',
  'tab-stop-summary', 'toggle-tab-stop', 'reset-tab-stops',
  'paper-desk-list', 'paper-desk-count', 'paper-desk-preview', 'paper-export-appearance',
  'paper-export-resolution', 'paper-export-format', 'export-selected-paper', 'print-selected-paper',
].map((id) => [id, document.getElementById(id)]));
const app = document.getElementById('app');
const documentTray = refs['document-toggle'].closest('.document-tray');
const environmentPanel = document.querySelector('.environment-card');
const audioMix = document.querySelector('.audio-mix');
const mechanismCard = document.querySelector('.mechanism-card');

let toastTimer = 0;
let persistTimer = 0;
let paperCheckpointTimer = 0;
let keyboardCaptured = false;
let inkMode = initialInkMode;
let cameraMotion = null;
let statusFlash = 0;
let inspectionEnabled = false;
let paperActionBusy = false;
let quietModeEnabled = stored?.quietModeEnabled === true;
let atmospherePaused = stored?.atmospherePaused === true;
let quietIdleTimer = 0;
let selectedPaperId = null;
const paperThumbnailCache = new Map();
let paperDeskRenderGeneration = 0;
const backgroundLayers = [...document.querySelectorAll('.ui-layer:not(#intro-overlay)')];
for (const layer of backgroundLayers) layer.inert = true;
const introWindowWash = document.querySelector('.intro-window-wash');

function varyIntroAtmosphereCycle() {
  if (!introWindowWash || reducedMotionQuery.matches) return;
  const duration = 18 + Math.random() * 4;
  introWindowWash.style.setProperty('--intro-cycle-duration', `${duration.toFixed(2)}s`);
}

varyIntroAtmosphereCycle();
introWindowWash?.addEventListener('animationiteration', varyIntroAtmosphereCycle);

function syncInputStatus() {
  const hasPaper = Boolean(lifecycle.getOverview().insertedSheet);
  const ready = keyboardCaptured && hasPaper && !paperActionBusy;
  refs['input-status'].textContent = ready ? 'READY TO TYPE' : hasPaper ? 'INPUT RELEASED' : 'PAPER REQUIRED';
  refs['input-state'].classList.toggle('ready', ready);
}

function setKeyboardCaptured(captured) {
  keyboardCaptured = Boolean(captured);
  if (!keyboardCaptured) {
    const mobileTypingField = document.getElementById('mobile-input');
    if (document.activeElement === mobileTypingField) mobileTypingField.blur();
  }
  syncInputStatus();
  return keyboardCaptured;
}

function inputSurfaceAvailable() {
  return refs['intro-overlay'].classList.contains('dismissed')
    && !refs['field-guide'].open
    && !documentTray.classList.contains('open')
    && !environmentPanel.open
    && !audioMix.open
    && !mechanismCard.classList.contains('mobile-open')
    && Boolean(lifecycle.getOverview().insertedSheet)
    && !paperActionBusy;
}

function canAcceptTyping() {
  return keyboardCaptured && inputSurfaceAvailable();
}

function applyQuietWritingState(active) {
  app.classList.toggle('quiet-writing-active', quietModeEnabled && active);
}

function scheduleQuietWriting() {
  clearTimeout(quietIdleTimer);
  if (!quietModeEnabled || !keyboardCaptured) return;
  quietIdleTimer = setTimeout(() => applyQuietWritingState(true), 1350);
}

function revealQuietInterface() {
  clearTimeout(quietIdleTimer);
  applyQuietWritingState(false);
}

function setQuietMode(enabled, { persistState = true } = {}) {
  quietModeEnabled = Boolean(enabled);
  refs['quiet-mode-toggle'].setAttribute('aria-pressed', String(quietModeEnabled));
  refs['quiet-mode-toggle'].textContent = quietModeEnabled ? 'QUIET ON' : 'QUIET MODE';
  revealQuietInterface();
  if (persistState) persist();
  return quietModeEnabled;
}

function focusMachine() {
  if (!inputSurfaceAvailable()) {
    setKeyboardCaptured(false);
    return;
  }
  setKeyboardCaptured(true);
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

const FIRST_SHEET_ACTIONS = ['type', 'shift', 'return', 'bell', 'release'];
let firstSheetStep = 0;

function firstSheetTutorialState() {
  try {
    return localStorage.getItem(FIRST_SHEET_TUTORIAL_KEY) || '';
  } catch {
    return '';
  }
}

function storeFirstSheetTutorialState(value) {
  try {
    localStorage.setItem(FIRST_SHEET_TUTORIAL_KEY, value);
  } catch {
    // The guide remains useful for the current session when storage is unavailable.
  }
}

function syncFirstSheetCoach() {
  const steps = [...refs['first-sheet-coach'].querySelectorAll('[data-coach-action]')];
  steps.forEach((step, index) => {
    const active = index === firstSheetStep;
    step.classList.toggle('active', active);
    if (active) step.setAttribute('aria-current', 'step');
    else step.removeAttribute('aria-current');
  });
  refs['coach-progress'].textContent = `${String(Math.min(firstSheetStep + 1, steps.length)).padStart(2, '0')} / ${String(steps.length).padStart(2, '0')}`;
  refs['coach-next'].textContent = firstSheetStep === steps.length - 1 ? 'FINISH' : firstSheetStep === 3 ? 'I HEAR IT' : 'NEXT';
}

function showFirstSheetCoach({ reset = false } = {}) {
  if (reset) {
    firstSheetStep = 0;
    storeFirstSheetTutorialState('');
  } else if (firstSheetTutorialState()) {
    return false;
  }
  refs['first-sheet-coach'].hidden = false;
  syncFirstSheetCoach();
  const activeStep = refs['first-sheet-coach'].querySelector('[aria-current="step"] span')?.textContent;
  announce(`First-sheet guide available. ${activeStep || 'Use Next or Skip Guide to continue.'}`);
  return true;
}

function finishFirstSheetCoach(state = 'complete') {
  refs['first-sheet-coach'].hidden = true;
  storeFirstSheetTutorialState(state);
}

function advanceFirstSheetCoach(action, { force = false } = {}) {
  if (refs['first-sheet-coach'].hidden) return false;
  if (!force && FIRST_SHEET_ACTIONS[firstSheetStep] !== action) return false;
  if (firstSheetStep >= FIRST_SHEET_ACTIONS.length - 1) {
    finishFirstSheetCoach('complete');
    showToast('FIRST SHEET GUIDE COMPLETE', 1200);
    announce('First sheet guide complete.');
    return true;
  }
  firstSheetStep += 1;
  syncFirstSheetCoach();
  const activeStep = refs['first-sheet-coach'].querySelector('[aria-current="step"] span')?.textContent;
  if (activeStep) announce(`First-sheet guide step ${firstSheetStep + 1}. ${activeStep}`);
  return true;
}

refs['coach-next'].addEventListener('click', () => {
  advanceFirstSheetCoach(FIRST_SHEET_ACTIONS[firstSheetStep], { force: true });
  focusMachine();
});
refs['coach-skip'].addEventListener('click', () => {
  finishFirstSheetCoach('dismissed');
  focusMachine();
});
refs['coach-dismiss'].addEventListener('click', () => {
  finishFirstSheetCoach('dismissed');
  focusMachine();
});
refs['coach-open'].addEventListener('click', () => {
  refs['field-guide'].close('coach');
  setTimeout(() => {
    showFirstSheetCoach({ reset: true });
    focusMachine();
  }, 40);
});

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
        quietModeEnabled,
        atmospherePaused,
        touchPreset: model.getTouchCalibration().preset,
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
  syncInputStatus();
}

function rendererForPaperSelection(selection) {
  const activeId = lifecycle.getOverview().insertedSheet?.id;
  if (selection.summary.id === activeId) return { renderer: paperRenderer, temporary: false };
  const selectedDocument = TypewriterDocument.deserialize(selection.page.content);
  return { renderer: new PaperRenderer(selectedDocument), temporary: true };
}

function paperThumbnail(summary) {
  const cacheKey = `${summary.markCount}:${summary.updatedAt}:${summary.location}:${summary.firstNonblankLine}`;
  const cached = paperThumbnailCache.get(summary.id);
  if (cached?.key === cacheKey) {
    paperThumbnailCache.delete(summary.id);
    paperThumbnailCache.set(summary.id, cached);
    return cached.url;
  }
  const thumbnail = document.createElement('canvas');
  thumbnail.width = 112;
  thumbnail.height = 145;
  const context = thumbnail.getContext('2d');
  context.fillStyle = summary.location === 'discarded' ? '#d7ccb2' : '#e9dfc7';
  context.fillRect(0, 0, thumbnail.width, thumbnail.height);
  context.strokeStyle = 'rgba(119, 54, 40, 0.26)';
  context.beginPath();
  context.moveTo(17, 0);
  context.lineTo(17, thumbnail.height);
  context.stroke();
  context.fillStyle = '#4d483e';
  context.font = '8px "Special Elite", monospace';
  context.fillText(`SHEET ${String(summary.sheetNumber).padStart(2, '0')}`, 24, 19);
  const words = (summary.firstNonblankLine || 'Blank sheet').split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = `${line} ${word}`.trim();
    if (context.measureText(candidate).width > 76 && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
    if (lines.length === 5) break;
  }
  if (line && lines.length < 5) lines.push(line);
  lines.forEach((textLine, index) => context.fillText(textLine, 24, 40 + index * 13));
  context.fillStyle = 'rgba(77, 72, 62, 0.34)';
  for (let index = lines.length; index < 6; index += 1) {
    context.fillRect(24, 40 + index * 13, 48 + (index % 3) * 9, 1);
  }
  const url = thumbnail.toDataURL('image/jpeg', 0.66);
  paperThumbnailCache.set(summary.id, { key: cacheKey, url });
  while (paperThumbnailCache.size > 32) {
    paperThumbnailCache.delete(paperThumbnailCache.keys().next().value);
  }
  return url;
}

function schedulePaperThumbnails(tasks, generation) {
  if (!tasks.length) return;
  const schedule = typeof window.requestIdleCallback === 'function'
    ? (callback) => window.requestIdleCallback(callback, { timeout: 80 })
    : (callback) => setTimeout(() => callback({ didTimeout: true, timeRemaining: () => 0 }), 0);
  const renderBatch = (deadline) => {
    if (generation !== paperDeskRenderGeneration) return;
    let completed = 0;
    while (
      tasks.length
      && completed < 4
      && (deadline.didTimeout || deadline.timeRemaining() > 3)
    ) {
      const { summary, thumb } = tasks.shift();
      if (thumb.isConnected) thumb.style.backgroundImage = `url(${paperThumbnail(summary)})`;
      completed += 1;
    }
    if (tasks.length && generation === paperDeskRenderGeneration) schedule(renderBatch);
  };
  schedule(renderBatch);
}

function selectedPaperRecord() {
  if (!selectedPaperId) return null;
  try {
    return lifecycle.selectSheet(selectedPaperId);
  } catch {
    selectedPaperId = null;
    return null;
  }
}

function syncPaperDeskSelection() {
  const selection = selectedPaperRecord();
  refs['paper-desk-list'].querySelectorAll('.paper-card').forEach((card) => {
    card.setAttribute('aria-pressed', String(card.dataset.pageId === selectedPaperId));
  });
  if (!selection) {
    refs['paper-desk-preview'].textContent = 'Select a sheet to preview or export it.';
    refs['export-selected-paper'].disabled = true;
    refs['print-selected-paper'].disabled = true;
    return;
  }
  const { summary } = selection;
  const preview = summary.firstNonblankLine || 'Blank sheet';
  refs['paper-desk-preview'].textContent = `SHEET ${String(summary.sheetNumber).padStart(2, '0')} · ${summary.location.toUpperCase()} · ${summary.markCount} IMPRESSION${summary.markCount === 1 ? '' : 'S'} · ${preview}`;
  refs['export-selected-paper'].disabled = false;
  refs['print-selected-paper'].disabled = false;
}

function syncPaperDeskUi() {
  const generation = ++paperDeskRenderGeneration;
  const sheets = lifecycle.listSheets({ order: 'newest', maxPreviewLength: 46 });
  const availableIds = new Set(sheets.map((sheet) => sheet.id));
  if (!selectedPaperId || !availableIds.has(selectedPaperId)) {
    selectedPaperId = lifecycle.getOverview().insertedSheet?.id ?? sheets[0]?.id ?? null;
  }
  refs['paper-desk-count'].textContent = `${String(sheets.length).padStart(2, '0')} SHEET${sheets.length === 1 ? '' : 'S'}`;
  const fragment = document.createDocumentFragment();
  const thumbnailTasks = [];
  for (const summary of sheets) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'paper-card';
    card.dataset.pageId = summary.id;
    card.dataset.location = summary.location;
    card.setAttribute('aria-pressed', String(summary.id === selectedPaperId));
    card.setAttribute('aria-describedby', 'paper-desk-preview');
    card.setAttribute('aria-label', `Sheet ${summary.sheetNumber}, ${summary.location}, ${summary.markCount} impressions`);
    const thumb = document.createElement('span');
    thumb.className = 'paper-card-thumb';
    thumb.dataset.location = summary.location.toUpperCase();
    thumb.setAttribute('aria-hidden', 'true');
    if (summary.id === selectedPaperId) thumb.style.backgroundImage = `url(${paperThumbnail(summary)})`;
    else thumbnailTasks.push({ summary, thumb });
    const copy = document.createElement('span');
    copy.className = 'paper-card-copy';
    const title = document.createElement('b');
    title.textContent = `SHEET ${String(summary.sheetNumber).padStart(2, '0')}`;
    const excerpt = document.createElement('small');
    excerpt.textContent = summary.firstNonblankLine || 'Blank sheet';
    copy.append(title, excerpt);
    card.append(thumb, copy);
    card.addEventListener('click', () => {
      selectedPaperId = summary.id;
      syncPaperDeskSelection();
    });
    fragment.append(card);
  }
  refs['paper-desk-list'].replaceChildren(fragment);
  syncPaperDeskSelection();
  schedulePaperThumbnails(thumbnailTasks, generation);
}

function selectedPaperExportOptions({ print = false } = {}) {
  const format = refs['paper-export-format'].value;
  return {
    appearance: refs['paper-export-appearance'].value,
    resolutionScale: Number(refs['paper-export-resolution'].value),
    mimeType: print ? 'image/png' : `image/${format}`,
    quality: 0.92,
  };
}

function withSelectedPaperRenderer(callback) {
  const selection = selectedPaperRecord();
  if (!selection) return false;
  const { renderer, temporary } = rendererForPaperSelection(selection);
  try {
    callback(renderer, selection);
  } finally {
    if (temporary) renderer.texture.dispose();
  }
  return true;
}

refs['export-selected-paper'].addEventListener('click', () => {
  const exported = withSelectedPaperRenderer((renderer, selection) => {
    const options = selectedPaperExportOptions();
    const extension = refs['paper-export-format'].value;
    renderer.download(formatSheetExportFilename(selection.summary.sheetNumber, extension), options);
    showToast(`${options.appearance === 'carbon-copy' ? 'CARBON COPY' : 'PAPER'} EXPORTED · ${options.resolutionScale}×`, 1200);
  });
  if (!exported) showToast('SELECT A SHEET TO EXPORT', 900);
});

refs['print-selected-paper'].addEventListener('click', () => {
  const selection = selectedPaperRecord();
  if (!selection) {
    showToast('SELECT A SHEET TO PRINT', 900);
    return;
  }
  // Open synchronously while this click still carries popup permission. The
  // comparatively expensive paper render happens only after the print view is
  // safely available, and is capped at 2× for predictable memory use.
  const printWindow = window.open('', '_blank', 'popup,width=920,height=1100');
  if (!printWindow) {
    showToast('ALLOW POP-UPS TO OPEN THE PRINT VIEW', 1500);
    return;
  }
  printWindow.opener = null;
  printWindow.document.title = `${BRAND.displayName} — Preparing sheet`;
  const preparing = printWindow.document.createElement('p');
  preparing.textContent = 'Preparing the paper for Print / Save PDF…';
  preparing.style.cssText = 'font:16px Georgia,serif;padding:32px;color:#29251f';
  printWindow.document.body.replaceChildren(preparing);
  showToast('PREPARING PRINT VIEW · UP TO 2×', 1200);

  setTimeout(() => {
    const { renderer, temporary } = rendererForPaperSelection(selection);
    try {
      const printOptions = selectedPaperExportOptions({ print: true });
      const payload = renderer.createBrowserPrintPayload({
        ...printOptions,
        resolutionScale: Math.min(2, printOptions.resolutionScale),
        title: `${BRAND.displayName} — Sheet ${String(selection.summary.sheetNumber).padStart(2, '0')}`,
      });
      printWindow.document.title = payload.title;
      const style = printWindow.document.createElement('style');
      style.textContent = payload.cssText;
      const image = printWindow.document.createElement('img');
      image.alt = `Typewritten sheet ${selection.summary.sheetNumber}`;
      image.src = payload.imageDataUrl;
      image.addEventListener('load', () => {
        printWindow.focus();
        printWindow.print();
      }, { once: true });
      printWindow.document.head.replaceChildren(style);
      printWindow.document.body.replaceChildren(image);
    } catch {
      printWindow.document.body.textContent = 'The print view could not be prepared. Close this window and export the sheet as an image instead.';
      showToast('PRINT VIEW FAILED · IMAGE EXPORT IS STILL AVAILABLE', 1700);
    } finally {
      if (temporary) renderer.texture.dispose();
    }
  }, 0);
});

function handleStatus(event) {
  statusFlash = 1;
  switch (event.type) {
    case 'bell':
      showToast('MARGIN BELL · FIVE SPACES REMAIN', 1400);
      announce('Margin bell. Five spaces remain.');
      advanceFirstSheetCoach('bell');
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
      advanceFirstSheetCoach('return');
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
    syncMechanicalSettingsUi();
    persist();
  },
});

model.setInkMode(inkMode);
const storedTouchPreset = typeof stored?.touchPreset === 'string'
  && Object.prototype.hasOwnProperty.call(TOUCH_PRESETS, stored.touchPreset)
  ? stored.touchPreset
  : 'medium';
model.setTouchPreset(storedTouchPreset, { emit: false });

function syncMechanicalSettingsUi() {
  const settings = model.getMechanicalSettings();
  refs['force-status'].textContent = settings.touchPreset.toUpperCase();
  document.querySelectorAll('[data-touch-preset]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.touchPreset === settings.touchPreset));
  });
  refs['left-margin-control'].value = String(settings.leftMargin);
  refs['left-margin-control'].max = String(Math.max(0, settings.rightMargin - 1));
  refs['right-margin-control'].value = String(settings.rightMargin);
  refs['right-margin-control'].min = String(Math.min(page.columns, settings.leftMargin + 1));
  refs['left-margin-value'].textContent = String(settings.leftMargin).padStart(2, '0');
  refs['right-margin-value'].textContent = String(settings.rightMargin).padStart(2, '0');
  refs['tab-stop-summary'].textContent = settings.tabStops.length
    ? `TABS · ${settings.tabStops.map((stop) => String(stop).padStart(2, '0')).join(' / ')}`
    : 'TABS · NONE SET';
}

function selectTouchPreset(preset) {
  const calibration = model.setTouchPreset(preset);
  syncMechanicalSettingsUi();
  showToast(`TOUCH · ${calibration.name.toUpperCase()}`, 900);
  persist();
  return calibration;
}

document.querySelectorAll('[data-touch-preset]').forEach((button) => {
  button.addEventListener('click', () => {
    selectTouchPreset(button.dataset.touchPreset);
    focusMachine();
  });
});

for (const [id, side] of [['left-margin-control', 'left'], ['right-margin-control', 'right']]) {
  refs[id].addEventListener('input', () => {
    model.setMarginStop(side, Number(refs[id].value));
    syncMechanicalSettingsUi();
  });
  refs[id].addEventListener('change', () => {
    showToast(`${side.toUpperCase()} MARGIN · ${refs[id].value}`, 850);
    focusMachine();
  });
}

refs['toggle-tab-stop'].addEventListener('click', () => {
  const column = Math.max(1, Math.min(page.columns, page.column));
  const enabled = !page.tabStops.includes(column);
  model.setTabStop(column, enabled);
  syncMechanicalSettingsUi();
  showToast(`TAB ${enabled ? 'SET' : 'CLEARED'} · COLUMN ${String(column).padStart(2, '0')}`, 1000);
  focusMachine();
});

refs['reset-tab-stops'].addEventListener('click', () => {
  const stops = [];
  for (let column = 8; column < page.columns; column += 8) stops.push(column);
  model.setTabStops(stops);
  syncMechanicalSettingsUi();
  showToast('8-COLUMN TAB STOPS RESTORED', 900);
  focusMachine();
});

syncMechanicalSettingsUi();

function handlePaperRitualEvent(event) {
  switch (event.type) {
    case 'extraction-start':
      announce('The sheet is leaving the platen.');
      advanceFirstSheetCoach('release');
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
    fov: 37,
  },
  front: {
    position: new THREE.Vector3(0, 5.45, 15.1),
    target: new THREE.Vector3(0, 1.35, 0.55),
    fov: 37,
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
    fromFov: camera.fov,
    toPosition: preset.position.clone(),
    toTarget: preset.target.clone(),
    toFov: preset.fov ?? 37,
    elapsed: 0,
    duration: reduced ? 0.01 : duration,
  };
  document.querySelectorAll('.view-button').forEach((button) => {
    const active = button.dataset.view === name;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  refs['mobile-view-select'].value = name;
}

function updateCameraMotion(delta) {
  if (!cameraMotion) return;
  cameraMotion.elapsed += delta;
  const raw = Math.min(1, cameraMotion.elapsed / cameraMotion.duration);
  const eased = raw < 0.5 ? 4 * raw ** 3 : 1 - ((-2 * raw + 2) ** 3) / 2;
  camera.position.lerpVectors(cameraMotion.fromPosition, cameraMotion.toPosition, eased);
  controls.target.lerpVectors(cameraMotion.fromTarget, cameraMotion.toTarget, eased);
  camera.fov = THREE.MathUtils.lerp(cameraMotion.fromFov, cameraMotion.toFov, eased);
  camera.updateProjectionMatrix();
  if (raw >= 1) cameraMotion = null;
}

function setDocumentTrayOpen(open, { refocus = false } = {}) {
  if (open) {
    setEnvironmentPanelOpen(false);
    setMobileMechanicsOpen(false);
  }
  documentTray.classList.toggle('open', open);
  refs['document-toggle'].setAttribute('aria-expanded', String(open));
  refs['document-content'].inert = !open;
  refs['document-content'].setAttribute('aria-hidden', String(!open));
  if (open) {
    setKeyboardCaptured(false);
    model.setShiftHeld(false);
    syncPaperDeskUi();
  } else if (refocus) {
    focusMachine();
  }
  return open;
}

function setEnvironmentPanelOpen(open, { refocus = false } = {}) {
  if (open) {
    setDocumentTrayOpen(false);
    setMobileMechanicsOpen(false);
  }
  environmentPanel.open = open;
  if (open) {
    setKeyboardCaptured(false);
    model.setShiftHeld(false);
  } else {
    audioMix.open = false;
    if (refocus) focusMachine();
  }
  return open;
}

function setMobileMechanicsOpen(open, { refocus = false } = {}) {
  const expanded = Boolean(open);
  if (expanded) {
    setDocumentTrayOpen(false);
    setEnvironmentPanelOpen(false);
    audioMix.open = false;
    setKeyboardCaptured(false);
    model.setShiftHeld(false);
  }
  mechanismCard.classList.toggle('mobile-open', expanded);
  refs['mobile-mechanics-toggle'].setAttribute('aria-expanded', String(expanded));
  if (!expanded && refocus) focusMachine();
  return expanded;
}

function dismissTransientPanels({ refocus = false } = {}) {
  let dismissed = false;
  if (documentTray.classList.contains('open')) {
    setDocumentTrayOpen(false);
    dismissed = true;
  }
  if (environmentPanel.open) {
    setEnvironmentPanelOpen(false);
    dismissed = true;
  }
  if (audioMix.open) {
    audioMix.open = false;
    dismissed = true;
  }
  if (mechanismCard.classList.contains('mobile-open')) {
    setMobileMechanicsOpen(false);
    dismissed = true;
  }
  if (dismissed && refocus) focusMachine();
  return dismissed;
}

function setInspectionEnabled(enabled, { moveCamera = true } = {}) {
  inspectionEnabled = enabled;
  refs['inspection-toggle'].setAttribute('aria-pressed', String(enabled));
  model.setInspection(enabled);
  controls.enabled = enabled;
  canvas.style.cursor = enabled ? 'grab' : 'default';
  if (enabled && moveCamera) setCameraView('mechanism', 0.75);
  return enabled;
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
  const weatherName = ({
    quiet: 'CLEAR DUSK',
    'autumn-wind': 'AUTUMN WIND',
    rain: 'STEADY RAIN',
    snow: 'FIRST SNOW',
    'nor-easter': 'NOR’EASTER',
  })[room.weatherPreset] ?? 'CLEAR DUSK';
  refs['environment-summary'].textContent = `${weatherName} / ${room.uneaseLevel.toUpperCase()}`;
  const mark = document.querySelector('.weather-mark');
  mark.textContent = ({ quiet: '◌', 'autumn-wind': '⌁', rain: '╱', snow: '❄', 'nor-easter': '※' })[room.weatherPreset] ?? '◌';
  refs['atmosphere-pause'].setAttribute('aria-pressed', String(atmospherePaused));
  refs['atmosphere-pause'].querySelector('b').textContent = atmospherePaused ? 'PAUSED' : 'RUNNING';
  app.classList.toggle('atmosphere-paused', atmospherePaused);
}

syncAtmosphereUi();
setQuietMode(quietModeEnabled, { persistState: false });
syncInputStatus();

refs['weather-select'].addEventListener('change', () => {
  const mode = room.setWeatherPreset(refs['weather-select'].value, { immediate: true });
  atmosphereAudio.setWeather(mode);
  syncAtmosphereUi();
  const weatherLabel = ({ quiet: 'CLEAR DUSK', 'autumn-wind': 'AUTUMN WIND', rain: 'STEADY RAIN', snow: 'FIRST SNOW', 'nor-easter': 'NOR’EASTER' })[mode] ?? mode.toUpperCase();
  showToast(`${weatherLabel} AT THE WINDOW`, 1000);
  persist();
});

refs['unease-select'].addEventListener('change', () => {
  const level = room.setUnease(refs['unease-select'].value);
  atmosphereAudio.setUnease(level);
  syncAtmosphereUi();
  showToast(`UNEASE · ${level.toUpperCase()}`, 900);
  persist();
});

refs['atmosphere-pause'].addEventListener('click', () => {
  atmospherePaused = !atmospherePaused;
  syncAtmosphereUi();
  showToast(atmospherePaused ? 'ATMOSPHERE MOTION PAUSED' : 'ATMOSPHERE MOTION RESUMED', 1000);
  announce(atmospherePaused ? 'Atmosphere motion paused. Typewriter mechanics remain active.' : 'Atmosphere motion resumed.');
  persist();
  focusMachine();
});

refs['quiet-mode-toggle'].addEventListener('click', () => {
  const enabled = setQuietMode(!quietModeEnabled);
  showToast(enabled ? 'QUIET WRITING MODE ON' : 'QUIET WRITING MODE OFF', 900);
  announce(enabled ? 'Quiet writing mode enabled. Controls will fade while typing and return with pointer movement.' : 'Quiet writing mode disabled.');
  focusMachine();
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

const enterStudioButton = document.getElementById('enter-studio');

function previewEntryKey() {
  if (reducedMotionQuery.matches || refs['intro-overlay'].classList.contains('dismissed')) return;
  model.animateKey('KeyO', 0.32, 0.62);
}

enterStudioButton.addEventListener('pointerenter', previewEntryKey);
enterStudioButton.addEventListener('focus', previewEntryKey);

enterStudioButton.addEventListener('click', () => {
  if (refs['intro-overlay'].classList.contains('dismissed')) return;
  enterStudioButton.disabled = true;
  refs['intro-guide'].disabled = true;
  enterStudioButton.setAttribute('aria-busy', 'true');
  refs['intro-overlay'].classList.add('entering');
  if (inspectionEnabled) setInspectionEnabled(false, { moveCamera: false });
  setCameraView('front', 1.25);
  refs['intro-overlay'].classList.add('dismissed');
  refs['intro-overlay'].setAttribute('aria-hidden', 'true');
  refs['intro-overlay'].inert = true;
  app.classList.remove('landing-active');
  for (const layer of backgroundLayers) layer.inert = false;
  focusMachine();
  audio.start().catch(() => {});
  atmosphereAudio.start().catch(() => {});
  const inserted = lifecycle.getOverview().insertedSheet;
  showToast(inserted ? 'KEYBOARD CONNECTED · BEGIN TYPING' : 'PAPER PATH EMPTY · LOAD A FRESH SHEET', 1500);
  announce(inserted ? 'Typewriter active. Begin typing. Press Escape to release the keyboard.' : 'Typewriter active, but no sheet is loaded. Open Document and load fresh paper.');
  if (inserted && !firstSheetTutorialState()) setTimeout(() => showFirstSheetCoach(), reducedMotionQuery.matches ? 250 : 1500);
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

function openFieldGuide(tabName = 'operation', { returnTo = 'machine' } = {}) {
  dismissTransientPanels();
  setKeyboardCaptured(false);
  model.setShiftHeld(false);
  refs['field-guide'].inert = false;
  refs['field-guide'].dataset.returnTo = returnTo;
  document.querySelector(`.guide-tab[data-tab="${tabName}"]`)?.click();
  refs['field-guide'].showModal();
  if (returnTo === 'intro') {
    refs['intro-overlay'].setAttribute('aria-hidden', 'true');
    refs['intro-overlay'].inert = true;
  }
}

document.getElementById('guide-open').addEventListener('click', () => openFieldGuide('operation'));
refs['intro-guide'].addEventListener('click', () => openFieldGuide('mechanics', { returnTo: 'intro' }));

refs['field-guide'].addEventListener('close', () => {
  if (refs['field-guide'].dataset.returnTo === 'intro' && !refs['intro-overlay'].classList.contains('dismissed')) {
    refs['field-guide'].inert = true;
    refs['intro-overlay'].setAttribute('aria-hidden', 'false');
    refs['intro-overlay'].inert = false;
    refs['intro-guide'].focus({ preventScroll: true });
    return;
  }
  focusMachine();
});

refs['field-guide'].addEventListener('click', (event) => {
  if (event.target === refs['field-guide']) refs['field-guide'].close('backdrop');
});

const guideTabs = [...document.querySelectorAll('.guide-tab')];
guideTabs.forEach((tab, tabIndex) => {
  tab.addEventListener('click', () => {
    guideTabs.forEach((item) => {
      const active = item === tab;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', String(active));
      item.tabIndex = active ? 0 : -1;
    });
    document.querySelectorAll('.guide-page').forEach((pageElement) => {
      const active = pageElement.dataset.page === tab.dataset.tab;
      pageElement.classList.toggle('active', active);
      pageElement.hidden = !active;
    });
  });
  tab.addEventListener('keydown', (event) => {
    let nextIndex = null;
    if (event.key === 'ArrowRight') nextIndex = (tabIndex + 1) % guideTabs.length;
    if (event.key === 'ArrowLeft') nextIndex = (tabIndex - 1 + guideTabs.length) % guideTabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = guideTabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    guideTabs[nextIndex].click();
    guideTabs[nextIndex].focus();
  });
});

document.querySelectorAll('.view-button').forEach((button) => button.addEventListener('click', () => {
  dismissTransientPanels();
  const view = button.dataset.view;
  if ((view === 'writer' || view === 'front') && inspectionEnabled) {
    setInspectionEnabled(false, { moveCamera: false });
  }
  setCameraView(view);
  focusMachine();
}));
refs['mobile-view-select'].addEventListener('change', () => {
  dismissTransientPanels();
  const view = refs['mobile-view-select'].value;
  if ((view === 'writer' || view === 'front') && inspectionEnabled) {
    setInspectionEnabled(false, { moveCamera: false });
  }
  setCameraView(view);
  focusMachine();
});
refs['mobile-mechanics-toggle'].addEventListener('click', () => {
  const open = !mechanismCard.classList.contains('mobile-open');
  if (open) dismissTransientPanels();
  setMobileMechanicsOpen(open, { refocus: !open });
});
refs['mobile-mechanics-close'].addEventListener('click', () => {
  setMobileMechanicsOpen(false, { refocus: true });
});
document.getElementById('home-view').addEventListener('click', () => {
  dismissTransientPanels();
  if (inspectionEnabled) setInspectionEnabled(false, { moveCamera: false });
  setCameraView('writer');
  focusMachine();
});

refs['inspection-toggle'].addEventListener('click', () => {
  const enabled = refs['inspection-toggle'].getAttribute('aria-pressed') !== 'true';
  setInspectionEnabled(enabled);
  focusMachine();
});

document.querySelectorAll('.ink-button').forEach((button) => button.addEventListener('click', () => {
  selectInk(button.dataset.ink);
  focusMachine();
}));

refs['document-toggle'].addEventListener('click', () => {
  const open = !documentTray.classList.contains('open');
  setDocumentTrayOpen(open, { refocus: !open });
});

environmentPanel.addEventListener('toggle', () => {
  if (environmentPanel.open) {
    setDocumentTrayOpen(false);
    setKeyboardCaptured(false);
    model.setShiftHeld(false);
  } else {
    audioMix.open = false;
  }
});

audioMix.addEventListener('toggle', () => {
  if (!audioMix.open) return;
  setDocumentTrayOpen(false);
  setKeyboardCaptured(false);
  model.setShiftHeld(false);
});

document.addEventListener('pointerdown', (event) => {
  if (!refs['intro-overlay'].classList.contains('dismissed') || refs['field-guide'].open) return;
  if (environmentPanel.open && !environmentPanel.contains(event.target)) {
    setEnvironmentPanelOpen(false);
  }
  if (documentTray.classList.contains('open') && !documentTray.contains(event.target)) {
    setDocumentTrayOpen(false);
  }
  if (
    mechanismCard.classList.contains('mobile-open')
    && !mechanismCard.contains(event.target)
    && !refs['mobile-mechanics-toggle'].contains(event.target)
  ) {
    setMobileMechanicsOpen(false);
  }
});

function downloadText() {
  const text = page.toPlainText();
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = formatSheetExportFilename(page.sheetNumber, 'txt');
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('TRANSCRIPT SAVED', 900);
}

document.getElementById('download-text').addEventListener('click', () => {
  downloadText();
  focusMachine();
});
document.getElementById('download-paper').addEventListener('click', () => {
  paperRenderer.download(formatSheetExportFilename(page.sheetNumber, 'png'));
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
  setKeyboardCaptured(false);
  model.setShiftHeld(false);
  if (inspectionEnabled) setInspectionEnabled(false, { moveCamera: false });
  updateDocumentUi();
  return true;
}

function finishPaperAction({ refocus = false } = {}) {
  paperActionBusy = false;
  updateDocumentUi();
  if (documentTray.classList.contains('open')) syncPaperDeskUi();
  persist();
  if (refocus) setDocumentTrayOpen(false, { refocus: true });
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
  syncMechanicalSettingsUi();
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
  if (!canAcceptTyping()) return true;
  if (event.ctrlKey || event.metaKey || event.altKey) return true;
  const target = event.target;
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.tagName === 'SUMMARY')
    || target instanceof HTMLButtonElement
    || target instanceof HTMLAnchorElement;
}

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    revealQuietInterface();
    if (!refs['intro-overlay'].classList.contains('dismissed')) return;
    if (refs['field-guide'].open) return;
    if (dismissTransientPanels({ refocus: true })) {
      event.preventDefault();
      return;
    }
    if (
      event.target instanceof HTMLInputElement
      || event.target instanceof HTMLTextAreaElement
      || event.target instanceof HTMLSelectElement
      || (event.target instanceof HTMLElement && event.target.tagName === 'SUMMARY')
    ) return;
    setKeyboardCaptured(false);
    model.setShiftHeld(false);
    showToast('KEYBOARD RELEASED · CLICK THE MACHINE TO RECONNECT', 1600);
    announce('Typewriter keyboard released. Click the machine to reconnect.');
    return;
  }
  if (shouldIgnoreKeyboard(event) || event.repeat) return;

  if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
    model.setShiftHeld(true, event.code);
    advanceFirstSheetCoach('shift');
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
    scheduleQuietWriting();
    return;
  }
  if (event.code === 'Enter' || event.code === 'NumpadEnter') {
    event.preventDefault();
    model.queueReturn();
    scheduleQuietWriting();
    return;
  }
  if (event.code === 'Backspace') {
    event.preventDefault();
    model.queueBackspace();
    scheduleQuietWriting();
    return;
  }
  if (event.code === 'Tab') {
    event.preventDefault();
    model.queueTab();
    scheduleQuietWriting();
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
    advanceFirstSheetCoach('type');
    scheduleQuietWriting();
  } else if (event.key.length === 1) {
    showToast(`“${event.key}” IS NOT AVAILABLE ON THE OCTOBERLINE 211 LAYOUT`, 1400);
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
  if (!canAcceptTyping()) {
    showToast(lifecycle.getOverview().insertedSheet ? 'INPUT RELEASED · TAP THE TYPE FIELD TO RECONNECT' : 'LOAD PAPER BEFORE TYPING', 1100);
    return false;
  }
  for (const character of text) {
    if (character === '\n') model.queueReturn();
    else if (character === ' ') model.queueSpace();
    else {
      const code = CODE_BY_CHARACTER.get(character);
      if (code) model.queueCharacter(character, code);
      else showToast(`“${character}” IS NOT AVAILABLE ON THE OCTOBERLINE 211 LAYOUT`, 1200);
    }
  }
  if (text.length) {
    advanceFirstSheetCoach('type');
    scheduleQuietWriting();
  }
  return true;
}

mobileInput.addEventListener('focus', () => {
  if (!inputSurfaceAvailable()) {
    setKeyboardCaptured(false);
    showToast(lifecycle.getOverview().insertedSheet ? 'CLOSE THE OPEN PANEL BEFORE TYPING' : 'LOAD PAPER BEFORE TYPING', 1100);
    return;
  }
  setKeyboardCaptured(true);
  if (!audio.context) audio.start().catch(() => {});
});

mobileInput.addEventListener('beforeinput', (event) => {
  if (!event.cancelable) return;
  if (!canAcceptTyping()) {
    event.preventDefault();
    mobileInput.value = '';
    return;
  }
  if (event.inputType === 'deleteContentBackward') {
    event.preventDefault();
    model.queueBackspace();
    scheduleQuietWriting();
  } else if (event.inputType === 'insertLineBreak' || event.inputType === 'insertParagraph') {
    event.preventDefault();
    model.queueReturn();
    scheduleQuietWriting();
  } else if (event.data) {
    event.preventDefault();
    queueMobileText(event.data);
  }
});

mobileInput.addEventListener('keydown', (event) => {
  if (!canAcceptTyping()) {
    if (event.key === 'Enter' || event.key === 'Backspace' || event.key.length === 1) event.preventDefault();
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    model.queueReturn();
    scheduleQuietWriting();
  } else if (event.key === 'Backspace') {
    event.preventDefault();
    model.queueBackspace();
    scheduleQuietWriting();
  }
});

mobileInput.addEventListener('input', () => {
  if (mobileInput.value && canAcceptTyping()) queueMobileText(mobileInput.value);
  mobileInput.value = '';
});

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const marginDragPoint = new THREE.Vector3();
const marginDragNormal = new THREE.Vector3();
const marginDragQuaternion = new THREE.Quaternion();
let marginDrag = null;

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

function beginMarginDrag(hit, event) {
  const side = hit.userData.marginSide;
  if (!side || !model.marginStops?.[side]) return false;
  const worldPoint = model.marginStops[side].getWorldPosition(new THREE.Vector3());
  model.carriage.getWorldQuaternion(marginDragQuaternion);
  marginDragNormal.set(0, 1, 0).applyQuaternion(marginDragQuaternion).normalize();
  marginDrag = {
    side,
    plane: new THREE.Plane().setFromNormalAndCoplanarPoint(marginDragNormal, worldPoint),
    pointerId: event.pointerId,
    controlsEnabled: controls.enabled,
  };
  controls.enabled = false;
  canvas.setPointerCapture?.(event.pointerId);
  canvas.style.cursor = 'ew-resize';
  announce(`${side} margin stop selected. Drag horizontally to reposition it.`);
  return true;
}

function updateMarginDrag(event) {
  if (!marginDrag) return false;
  updatePointer(event);
  if (!raycaster.ray.intersectPlane(marginDrag.plane, marginDragPoint)) return false;
  const carriagePoint = model.carriage.worldToLocal(marginDragPoint.clone());
  model.setMarginStopFromLocalX(marginDrag.side, carriagePoint.x);
  syncMechanicalSettingsUi();
  return true;
}

function finishMarginDrag(event) {
  if (!marginDrag || (event.pointerId !== undefined && event.pointerId !== marginDrag.pointerId)) return false;
  const completedDrag = marginDrag;
  const side = completedDrag.side;
  marginDrag = null;
  controls.enabled = completedDrag.controlsEnabled;
  if (canvas.hasPointerCapture?.(completedDrag.pointerId)) {
    canvas.releasePointerCapture(completedDrag.pointerId);
  }
  canvas.style.cursor = inspectionEnabled ? 'grab' : 'default';
  const column = model.getMechanicalSettings()[`${side}Margin`];
  showToast(`${side.toUpperCase()} MARGIN · ${String(column).padStart(2, '0')}`, 900);
  announce(`${side} margin set to column ${column}.`);
  return true;
}

canvas.addEventListener('pointerdown', (event) => {
  if (!refs['intro-overlay'].classList.contains('dismissed')) return;
  if (dismissTransientPanels({ refocus: true })) {
    event.preventDefault();
    return;
  }
  if (!keyboardCaptured) {
    setKeyboardCaptured(true);
    showToast('KEYBOARD RECONNECTED', 700);
  }
  canvas.focus({ preventScroll: true });
  if (!audio.context) audio.start().catch(() => {});
  if (!atmosphereAudio.context) atmosphereAudio.start().catch(() => {});
  const hit = firstInteractiveHit(event);
  if (!hit) return;
  const paperTarget = paperView.resolveRaycastTarget(hit);
  if (hit.userData.specialAction === 'margin-stop') {
    if (beginMarginDrag(hit, event)) event.preventDefault();
  } else if (paperTarget?.action === 'recover-page') {
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
    advanceFirstSheetCoach('type');
    scheduleQuietWriting();
    event.preventDefault();
  } else if (hit.userData.specialAction === 'return') {
    model.queueReturn();
    scheduleQuietWriting();
    event.preventDefault();
  } else if (hit.userData.specialAction === 'ink-cycle') {
    const sequence = ['black', 'red', 'stencil'];
    selectInk(sequence[(sequence.indexOf(inkMode) + 1) % sequence.length]);
    event.preventDefault();
  } else if (hit.userData.specialAction === 'ribbon-reverse') {
    model.reverseRibbonManually();
    event.preventDefault();
  } else if (hit.userData.specialAction === 'touch-cycle') {
    const calibration = model.cycleTouchPreset();
    syncMechanicalSettingsUi();
    showToast(`TOUCH · ${calibration.name.toUpperCase()}`, 900);
    persist();
    event.preventDefault();
  }
});

let hoverFrame = 0;
canvas.addEventListener('pointermove', (event) => {
  if (marginDrag) {
    updateMarginDrag(event);
    event.preventDefault();
    return;
  }
  if (app.classList.contains('quiet-writing-active')) revealQuietInterface();
  cancelAnimationFrame(hoverFrame);
  hoverFrame = requestAnimationFrame(() => {
    canvas.style.cursor = firstInteractiveHit(event) ? 'pointer' : inspectionEnabled ? 'grab' : 'default';
  });
});
canvas.addEventListener('pointerup', finishMarginDrag);
canvas.addEventListener('pointercancel', finishMarginDrag);
canvas.addEventListener('lostpointercapture', finishMarginDrag);

window.addEventListener('blur', (event) => {
  finishMarginDrag(event);
});

window.addEventListener('pointermove', () => {
  if (app.classList.contains('quiet-writing-active')) revealQuietInterface();
}, { passive: true });

window.addEventListener('pointerdown', () => {
  if (app.classList.contains('quiet-writing-active')) revealQuietInterface();
}, { passive: true });

window.addEventListener('focusin', () => {
  if (app.classList.contains('quiet-writing-active')) revealQuietInterface();
});

canvas.addEventListener('mouseleave', () => { canvas.style.cursor = inspectionEnabled ? 'grab' : 'default'; });
canvas.addEventListener('contextmenu', (event) => event.preventDefault());

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (!refs['intro-overlay'].classList.contains('dismissed') && !cameraMotion) {
    const compact = width <= 900;
    camera.position.set(...(compact ? [13.65, 6.48, 12.94] : [8.45, 5.85, 11.4]));
    controls.target.set(...(compact ? [4.15, 1.43, 0.55] : [0, 1.43, 0.55]));
    camera.fov = compact ? 50 : 37;
  }
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
  if (!atmospherePaused) {
    room.update(delta);
    atmosphereAudio.update(delta, room.getState());
  }
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

window[BRAND.browserNamespace] = {
  model,
  audio,
  camera,
  controls,
  get keyboardCaptured() { return keyboardCaptured; },
  get marginDragActive() { return Boolean(marginDrag); },
  get paperThumbnailCacheSize() { return paperThumbnailCache.size; },
  get document() { return page; },
  lifecycle,
  paperView,
  room,
  atmosphereAudio,
  get quietModeEnabled() { return quietModeEnabled; },
  get atmospherePaused() { return atmospherePaused; },
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
  setQuietMode(enabled) {
    return setQuietMode(enabled);
  },
  setAtmospherePaused(paused) {
    atmospherePaused = Boolean(paused);
    syncAtmosphereUi();
    persist();
    return atmospherePaused;
  },
};
