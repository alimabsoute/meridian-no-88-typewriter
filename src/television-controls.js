import * as THREE from 'three';

/** Screen-space controls anchored to the actual television in the 3D room. */
export function createTelevisionControls({ parent, decor, camera, onPower, onMute, onVolume, onFocus }) {
  const panel = document.createElement('aside');
  panel.className = 'television-remote ui-layer';
  panel.setAttribute('aria-label', 'Controls beside the television');
  panel.hidden = true;
  panel.innerHTML = `<button type="button" id="tv-remote-power" role="switch" aria-label="Television power" aria-checked="true"><span class="tv-power-dot"></span><strong>TV ON</strong><span aria-hidden="true">⏻</span></button>
    <div class="tv-remote-audio"><button type="button" id="tv-remote-mute" aria-label="Mute television" aria-pressed="true">Sound off</button><label class="sr-only" for="tv-remote-volume">Television volume</label><input id="tv-remote-volume" type="range" min="0" max="1" step="0.01" value="0.28"></div>`;
  parent.append(panel);
  const power = panel.querySelector('#tv-remote-power');
  const mute = panel.querySelector('#tv-remote-mute');
  const volume = panel.querySelector('#tv-remote-volume');
  power.addEventListener('click', onPower);
  mute.addEventListener('click', onMute);
  volume.addEventListener('input', () => onVolume(Number(volume.value)));
  panel.addEventListener('pointerdown', (event) => event.stopPropagation());
  panel.addEventListener('focusin', onFocus);
  const corners = [[-2.7, -1.56], [-2.7, 1.56], [2.7, -1.56], [2.7, 1.56]].map(([x, y]) => new THREE.Vector3(x, y, 0.52));
  const projected = corners.map(() => new THREE.Vector3());
  let lastPosition = '';
  let width = 174;
  let height = 98;
  let pictureBounds = null;
  let hovered = false;
  const setHovered = (value) => {
    if (hovered === value) return;
    hovered = value;
    panel.setAttribute('data-tv-hover', String(value));
  };
  const pointerMove = (event) => {
    if (!pictureBounds || panel.hidden) { setHovered(false); return; }
    const { left, right, top, bottom } = pictureBounds;
    const origin = parent.getBoundingClientRect();
    const x = event.clientX - origin.left, y = event.clientY - origin.top;
    setHovered(x >= left - 18 && x <= right + 18 && y >= top - 18 && y <= bottom + 18);
  };
  const pointerLeave = () => setHovered(false);
  parent.addEventListener('pointermove', pointerMove, { passive: true });
  parent.addEventListener('pointerleave', pointerLeave);
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(([entry]) => {
    if (entry.contentRect.width > 0) { width = panel.offsetWidth; height = panel.offsetHeight; }
  }) : null;
  observer?.observe(panel);

  function sync() {
    power.setAttribute('aria-checked', String(decor.tvEnabled));
    power.querySelector('strong').textContent = decor.tvEnabled ? 'TV ON' : 'TV OFF';
    mute.setAttribute('aria-pressed', String(decor.muted));
    mute.textContent = decor.muted ? 'Sound off' : 'Sound on';
    volume.value = String(decor.volume);
  }

  function update() {
    if (decor.disposed || !decor.visible) { panel.hidden = true; pictureBounds = null; setHovered(false); return; }
    camera.updateMatrixWorld();
    decor.television.updateWorldMatrix(true, false);
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    let inDepth = false;
    const vw = parent.clientWidth, vh = parent.clientHeight;
    for (let i = 0; i < corners.length; i++) {
      const point = projected[i].copy(corners[i]).applyMatrix4(decor.television.matrixWorld).project(camera);
      inDepth ||= point.z >= -1 && point.z <= 1;
      const x = (point.x + 1) * vw / 2, y = (1 - point.y) * vh / 2;
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    const visible = inDepth && right > 24 && left < vw - 24 && bottom > 100 && top < vh - 70;
    panel.hidden = !visible;
    pictureBounds = visible ? { left, right, top, bottom } : null;
    if (!visible) return;
    const header = parent.querySelector('.masthead')?.getBoundingClientRect().bottom ?? 90;
    const footer = parent.querySelector('.workbench-toolbar')?.getBoundingClientRect().top ?? vh - 76;
    const minY = header + 12;
    const maxY = footer - height - 12;
    // In a short landscape viewport the Room panel remains the accessible
    // fallback; never cover the header or workbench with an impossible fit.
    if (maxY < minY || vw < width + 24) { panel.hidden = true; return; }
    let x = right + 12;
    let y = Math.max(minY, Math.min(maxY, (top + bottom - height) / 2));
    if (x + width > vw - 12) {
      x = left - width - 12;
      if (x < 12) {
        // A portrait screen may not have room beside the picture. Put the
        // controls below (or above) it instead of covering the broadcast.
        x = Math.max(12, Math.min(vw - width - 12, (left + right - width) / 2));
        if (bottom + 12 <= maxY && bottom + 12 >= minY) y = bottom + 12;
        else if (top - height - 12 >= minY && top - height - 12 <= maxY) y = top - height - 12;
        else { panel.hidden = true; return; }
      }
    }
    const position = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    if (position !== lastPosition) { panel.style.transform = position; lastPosition = position; }
  }

  sync();
  return { panel, sync, update, dispose: () => {
    observer?.disconnect();
    parent.removeEventListener('pointermove', pointerMove);
    parent.removeEventListener('pointerleave', pointerLeave);
    panel.remove();
  } };
}
