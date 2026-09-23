import * as THREE from 'three';

const preset = (position, target, fov = 37, minDistance = 6.4) => ({
  position: new THREE.Vector3(...position), target: new THREE.Vector3(...target), fov, minDistance,
});

// Keep the room composition separate from the optical close-up of the machine.
// Dolly moves the camera toward real geometry; no supersampling or extra pass.
export const CAMERA_PRESETS = {
  writer: preset([4.2, 5.8, 13.2], [0.7, 2.6, -0.1]),
  front: preset([0, 6.6, 13.8], [0, 2.15, -0.15], 37, 5.0),
  room: preset([1.2, 5.7, 16.8], [1.65, 3.45, -2.1], 43),
  television: preset([-10.4, 5.05, 4.6], [-10.4, 5.05, -5.22], 40, 3.2),
  library: preset([14.6, 4.8, 9], [14.6, 4.0, -4.7], 40, 3.2),
  mechanism: preset([7.2, 4.3, 7], [0.2, 1.25, 0.22]),
  ribbon: preset([4.7, 4.25, 4.2], [0, 1.76, -0.42]),
  carriage: preset([-6.8, 5, 7.2], [0, 2.55, -0.8]),
  filing: preset([-7.8, 7.5, 12.5], [-3.1, 1.65, 1.8], 43, 5),
  paper: preset([6.7, 6.45, 10.1], [1.3, 3.35, 2.05]),
};

export function configureRoomNavigation(controls, view, inspecting = false) {
  controls.enabled = true;
  controls.enableZoom = true;
  controls.enableRotate = inspecting;
  controls.maxPolarAngle = view === 'television' ? Math.PI / 2 : 1.49;
  // Two-finger/right-button panning lets the reader move from book spines to
  // the painting without adding another angle or disturbing machine controls.
  controls.enablePan = view === 'library' || view === 'television';
  controls.screenSpacePanning = controls.enablePan;
  controls.minDistance = CAMERA_PRESETS[view]?.minDistance ?? 6.4;
  controls.maxTargetRadius = controls.enablePan ? 2.4 : 4.5;
}

export function fitRoomDetail(preset, view, width, height, topInset = 0, bottomInset = 0) {
  if (!['television', 'library', 'filing'].includes(view)) return null;
  const [spanX, spanY] = view === 'filing' ? [11, 6] : view === 'television' ? [8.4, 5.0] : [8.0, 9.0];
  const tangent = Math.tan(THREE.MathUtils.degToRad(preset.fov / 2));
  const usableHeight = Math.max(0.2, (height - topInset - bottomInset) / height);
  const distance = Math.max(preset.position.distanceTo(preset.target),
    spanX / (2 * tangent * Math.max(0.15, width / height) * 0.88),
    spanY / (2 * tangent * usableHeight * 0.92));
  return {
    position: preset.position.clone().sub(preset.target).normalize().multiplyScalar(distance).add(preset.target),
    target: preset.target.clone(), fov: preset.fov, offsetY: -(topInset - bottomInset) / 2,
  };
}
