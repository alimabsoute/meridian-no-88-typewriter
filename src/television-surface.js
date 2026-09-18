import { Vector3 } from 'three';

const VIDEO_WIDTH = 960;
const VIDEO_HEIGHT = 540;

/** Map a source rectangle to TL, TR, BR, BL destination corners. CSS uses
 * column-major matrices and divides transformed x/y by the fourth component. */
export function quadToCssMatrix3d(quad, width = VIDEO_WIDTH, height = VIDEO_HEIGHT) {
  if (!(width > 0 && height > 0) || quad?.length !== 4
    || quad.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null;
  let orientation = 0;
  for (let i = 0; i < 4; i += 1) {
    const a = quad[i], b = quad[(i + 1) % 4], c = quad[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-8 || (orientation && Math.sign(cross) !== orientation)) return null;
    orientation = Math.sign(cross);
  }
  const [p0, p1, p2, p3] = quad;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy3 = p0.y - p1.y + p2.y - p3.y;
  let g = 0, h = 0;
  if (Math.abs(dx3) + Math.abs(dy3) > 1e-8) {
    const denominator = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(denominator) < 1e-10) return null;
    g = (dx3 * dy2 - dx2 * dy3) / denominator;
    h = (dx1 * dy3 - dx3 * dy1) / denominator;
  }
  // A denominator crossing zero would project part of the element to infinity.
  if (Math.min(1, 1 + g, 1 + h, 1 + g + h) <= 1e-8) return null;
  const values = [
    (p1.x - p0.x + g * p1.x) / width,
    (p1.y - p0.y + g * p1.y) / width, 0, g / width,
    (p3.x - p0.x + h * p3.x) / height,
    (p3.y - p0.y + h * p3.y) / height, 0, h / height,
    0, 0, 1, 0, p0.x, p0.y, 0, 1,
  ];
  return values.every(Number.isFinite) ? `matrix3d(${values.join(',')})` : null;
}

/** The existing decoder is the surface: this creates no player, source,
 * texture, animation loop, media listener, or playback-policy owner. */
export function createTelevisionSurface({ parent, decor, camera }) {
  if (!parent?.appendChild || !decor?.video || !decor?.screen || !camera?.isCamera) {
    throw new TypeError('Television surface requires a DOM parent, room decor video/screen, and camera.');
  }
  const video = decor.video;
  const screen = decor.screen;
  const canvas = parent.querySelector?.('#scene') ?? parent.querySelector?.('canvas');
  const geometry = screen.geometry?.parameters;
  const halfWidth = (geometry?.width ?? 5.18) / 2;
  const halfHeight = (geometry?.height ?? 5.18 * 9 / 16) / 2;
  const local = [
    new Vector3(-halfWidth, halfHeight, 0), new Vector3(halfWidth, halfHeight, 0),
    new Vector3(halfWidth, -halfHeight, 0), new Vector3(-halfWidth, -halfHeight, 0),
  ];
  const world = local.map(() => new Vector3());
  const quad = local.map(() => ({ x: 0, y: 0 }));
  const normal = new Vector3(), up = new Vector3(), cameraPosition = new Vector3();
  const eyeDirection = new Vector3(), projected = new Vector3();
  let disposed = false, visible = false, lastTransform = '';
  video.classList.add('television-video-surface');
  video.removeAttribute('crossorigin');
  video.setAttribute('aria-hidden', 'true');
  Object.assign(video.style, {
    position: 'absolute', top: '0px', left: '0px', width: `${VIDEO_WIDTH}px`,
    height: `${VIDEO_HEIGHT}px`, transformOrigin: '0 0', objectFit: 'contain',
    background: '#000', pointerEvents: 'none', visibility: 'hidden',
  });
  parent.appendChild(video);

  function show(next) {
    if (next !== visible) {
      visible = next;
      video.style.visibility = next ? 'visible' : 'hidden';
    }
    return next;
  }

  function update() {
    if (disposed) return false;
    if (decor.disposed || !decor.tvEnabled || decor.visible === false || decor.mediaError
      || video.error || video.readyState < 2) return show(false);
    for (let ancestor = screen; ancestor; ancestor = ancestor.parent) {
      if (ancestor.visible === false) return show(false);
    }
    // Paused/reduced-motion frames intentionally remain visible while powered.
    camera.updateWorldMatrix(true, false);
    screen.updateWorldMatrix(true, false);
    cameraPosition.setFromMatrixPosition(camera.matrixWorld);
    local.forEach((point, index) => world[index].copy(point).applyMatrix4(screen.matrixWorld));
    normal.copy(world[1]).sub(world[0]);
    up.copy(world[0]).sub(world[3]);
    normal.cross(up);
    eyeDirection.copy(cameraPosition).sub(world[0]);
    if (normal.dot(eyeDirection) <= 1e-10) return show(false);

    const parentRect = parent.getBoundingClientRect();
    const viewport = canvas?.getBoundingClientRect() ?? parentRect;
    if (!(viewport.width > 0 && viewport.height > 0)) return show(false);
    const offsetX = viewport.left - parentRect.left - (parent.clientLeft || 0) + (parent.scrollLeft || 0);
    const offsetY = viewport.top - parentRect.top - (parent.clientTop || 0) + (parent.scrollTop || 0);
    for (let index = 0; index < 4; index += 1) {
      projected.copy(world[index]).applyMatrix4(camera.matrixWorldInverse);
      if (projected.z >= -camera.near) return show(false);
      projected.applyMatrix4(camera.projectionMatrix);
      if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y) || projected.z > 1) return show(false);
      // Sub-pixel quantization avoids identical-looking transform rewrites.
      quad[index].x = Math.round((offsetX + (projected.x + 1) * viewport.width / 2) * 1000) / 1000;
      quad[index].y = Math.round((offsetY + (1 - projected.y) * viewport.height / 2) * 1000) / 1000;
    }
    if (quad.every(p => p.x < offsetX) || quad.every(p => p.x > offsetX + viewport.width)
      || quad.every(p => p.y < offsetY) || quad.every(p => p.y > offsetY + viewport.height)) return show(false);
    const transform = quadToCssMatrix3d(quad);
    if (!transform) return show(false);
    if (transform !== lastTransform) {
      video.style.transform = transform;
      lastTransform = transform;
    }
    return show(true);
  }

  function dispose() {
    if (disposed) return;
    show(false);
    disposed = true;
    video.remove();
  }
  return { update, dispose };
}
