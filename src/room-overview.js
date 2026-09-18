import * as THREE from 'three';

/** Preserve the room angle while keeping the entire TV inside the Front view.
 * Close inspection/Writer cameras deliberately retain their original framing. */
export function fitRoomOverview(preset, television, width, height, { topInset = 0, bottomInset = 0 } = {}) {
  const target = preset.target.clone();
  const position = preset.position.clone();
  const compactPortrait = width <= 900 && width / height < 1.25;
  const fov = compactPortrait ? 60 : width <= 900 ? 50 : preset.fov;
  if (compactPortrait) {
    // Center the useful portrait scene between the TV and the writing machine.
    const offset = new THREE.Vector3(-2.2, 2.6, -2.1).sub(target);
    target.add(offset); position.add(offset);
  }
  const offsetY = -(topInset - bottomInset) / 2;
  if (!television || width <= 0 || height <= 0) return { position, target, fov };
  const forward = target.clone().sub(position).normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward);
  const tangent = Math.tan(THREE.MathUtils.degToRad(fov / 2));
  const horizontal = tangent * width / height * (1 - 48 / width);
  const vertical = tangent * Math.max(0.05, (height - topInset - bottomInset) / height) * 0.98;
  let distance = position.distanceTo(target);
  television.updateWorldMatrix(true, false);
  const points = [];
  // Include the beveled frame, not only the illuminated picture.
  for (const x of [-2.76, 2.76]) for (const y of [-1.62, 1.62]) {
    points.push(new THREE.Vector3(x, y, 0.53).applyMatrix4(television.matrixWorld));
  }
  // A TV-only portrait fit can clip the keyboard on the opposite edge.
  for (const x of [-5, 5]) for (const y of [0.2, 5]) for (const z of [-2, 4]) points.push(new THREE.Vector3(x, y, z));
  for (const point of points) {
    const relative = point.sub(target);
    const depth = relative.dot(forward);
    distance = Math.max(distance, Math.abs(relative.dot(right)) / Math.max(0.01, horizontal) - depth,
      Math.abs(relative.dot(up)) / vertical - depth);
  }
  position.copy(target).addScaledVector(forward, -distance);
  return { position, target, fov, offsetY };
}
