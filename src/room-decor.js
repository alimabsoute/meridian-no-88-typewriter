import * as THREE from 'three';

export const ROOM_DECOR_MEDIA = Object.freeze({
  film: './media/philly-tv.mp4',
  poster: './media/philly-tv-poster.jpg',
  art: './media/philly-wall-art.png',
});

function roundedRectangle(width, height, radius) {
  const x = -width / 2;
  const y = -height / 2;
  const shape = new THREE.Shape();
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius);
  shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  return shape;
}

function frameRing(outer, opening) {
  const shape = roundedRectangle(outer, outer, 0.024);
  const hole = new THREE.Path();
  const half = opening / 2;
  hole.moveTo(-half, -half);
  hole.lineTo(-half, half);
  hole.lineTo(half, half);
  hole.lineTo(half, -half);
  hole.closePath();
  shape.holes.push(hole);
  return new THREE.ExtrudeGeometry(shape, {
    depth: 0.074,
    bevelEnabled: true,
    bevelSize: 0.012,
    bevelThickness: 0.017,
    bevelSegments: 3,
    curveSegments: 8,
    steps: 1,
  });
}

/**
 * Quiet wall dressing, deliberately outside the room's static mesh batches.
 * No network or media element is created until the writing room is mounted.
 */
export class PhiladelphiaRoomDecor {
  constructor({
    parent,
    reducedMotion = false,
    tvPlaying = true,
    paused = false,
    documentRef = typeof document === 'undefined' ? null : document,
    textureLoader = null,
  } = {}) {
    if (!parent?.isObject3D) throw new TypeError('Room decor requires a Three.js parent.');
    this.document = documentRef;
    // Browsers give file:// documents opaque origins. Local media may decode
    // but then taint WebGL uploads, so direct-file core use gets a deterministic
    // static fallback. Serving the same folder over HTTP enables the decor.
    this.localFileMode = documentRef?.location?.protocol === 'file:';
    this.loader = textureLoader ?? (documentRef ? new THREE.TextureLoader() : null);
    this.disposed = false;
    this.paused = Boolean(paused);
    this.visible = true;
    this.reducedMotion = Boolean(reducedMotion);
    this.tvEnabled = Boolean(tvPlaying);
    this.mediaStatus = this.tvEnabled ? 'poster' : 'off';
    this.mediaError = false;
    this.artLoaded = false;
    this.playRequest = 0;
    this.playbackRequested = false;
    this.geometries = new Set();
    this.materials = new Set();
    this.textures = new Set();
    this.listeners = [];
    this.root = new THREE.Group();
    this.root.name = 'PhiladelphiaRoomDecor';
    parent.add(this.root);
    this._buildTelevision();
    this._buildArt();
    this._loadArt();
    this._loadPoster();
    this._createVideo();
    this.onVisibilityChange = () => this._syncPlayback();
    this.document?.addEventListener('visibilitychange', this.onVisibilityChange);
    this._syncPlayback();
  }

  _material(material) {
    this.materials.add(material);
    return material;
  }

  _texture(texture) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    this.textures.add(texture);
    return texture;
  }

  _mesh(geometry, material, parent, name, x, y, z) {
    this.geometries.add(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  _buildTelevision() {
    const group = new THREE.Group();
    group.name = 'PhiladelphiaWallTelevision';
    group.position.set(-8.7, 5.15, -5.96);
    this.root.add(group);

    const mount = this._material(new THREE.MeshStandardMaterial({ color: 0x191a18, roughness: 0.86 }));
    const bezel = this._material(new THREE.MeshStandardMaterial({ color: 0x252a28, metalness: 0.72, roughness: 0.36 }));
    const edge = this._material(new THREE.MeshStandardMaterial({ color: 0x080c0d, metalness: 0.25, roughness: 0.43 }));
    // A recessed mount, thin chamfered edge and inset face read as a real flat
    // panel. Their shallow spacing leaves a contact shadow on the plaster.
    this._mesh(new THREE.BoxGeometry(2.8, 1.5, 0.08), mount, group, 'TelevisionWallMount', 0, 0, 0);
    this._mesh(new THREE.ExtrudeGeometry(roundedRectangle(4.48, 2.58, 0.064), {
      depth: 0.074, bevelEnabled: true, bevelSize: 0.018,
      bevelThickness: 0.018, bevelSegments: 3, curveSegments: 10, steps: 1,
    }), bezel, group, 'TelevisionChamferedFrame', 0, 0, 0.065);
    this._mesh(new THREE.PlaneGeometry(4.42, 2.52), edge, group, 'TelevisionInnerBezel', 0, 0, 0.164);

    const fallback = this._texture(new THREE.DataTexture(new Uint8Array([
      28, 35, 38, 255, 32, 42, 48, 255,
      20, 26, 30, 255, 23, 29, 34, 255,
    ]), 2, 2, THREE.RGBAFormat));
    fallback.needsUpdate = true;
    this.fallbackTexture = fallback;
    this.screenMaterial = this._material(new THREE.MeshBasicMaterial({
      map: fallback, color: 0xb3b7b3, toneMapped: false,
    }));
    this.screen = this._mesh(new THREE.PlaneGeometry(4.28, 4.28 * 9 / 16), this.screenMaterial,
      group, 'PhiladelphiaArchiveTelevisionScreen', 0, 0.008, 0.17);
    this.screen.receiveShadow = false;

    this.ledMaterial = this._material(new THREE.MeshBasicMaterial({ color: 0xbaa67c, toneMapped: false }));
    this._mesh(new THREE.SphereGeometry(0.010, 8, 6), this.ledMaterial, group, 'TelevisionStandbyLight', 1.97, -1.25, 0.17);
    this.television = group;
    this._syncScreen();
  }

  _buildArt() {
    const wood = this._material(new THREE.MeshStandardMaterial({ color: 0x3f2b1b, roughness: 0.5, metalness: 0.06 }));
    const brass = this._material(new THREE.MeshStandardMaterial({ color: 0x9c7b49, roughness: 0.42, metalness: 0.65 }));
    const mat = this._material(new THREE.MeshStandardMaterial({ color: 0xd3c7ac, roughness: 1 }));
    const backing = this._material(new THREE.MeshStandardMaterial({ color: 0x2c2219, roughness: 1 }));
    this.artMaterials = [];
    for (const [index, title] of ['Rocky — Philadelphia Museum of Art', 'Boathouse Row — Blue Hour'].entries()) {
      const frame = new THREE.Group();
      frame.name = index === 0 ? 'RockyStatuePainting' : 'BoathouseRowPainting';
      frame.userData.title = title;
      frame.position.set(11.48 + index * 2.17, 5.12, -5.95);
      this.root.add(frame);
      this._mesh(new THREE.BoxGeometry(1.91, 1.91, 0.045), backing, frame, `${frame.name}Backing`, 0, 0, 0.025);
      this._mesh(frameRing(2.01, 1.83), wood, frame, `${frame.name}WalnutFrame`, 0, 0, 0.046);
      this._mesh(new THREE.PlaneGeometry(1.86, 1.86), mat, frame, `${frame.name}LinenMat`, 0, 0, 0.086);
      this._mesh(frameRing(1.665, 1.62), brass, frame, `${frame.name}BrassSlip`, 0, 0, 0.051);
      const painted = this._material(new THREE.MeshStandardMaterial({ color: 0xd4c8b0, roughness: 1, emissive: 0x1a1611, emissiveIntensity: 0.12 }));
      this.artMaterials.push(painted);
      this._mesh(new THREE.PlaneGeometry(1.623, 1.623), painted, frame, `${frame.name}Canvas`, 0, 0, 0.115);
    }
  }

  _loadArt() {
    if (!this.loader || this.localFileMode) return;
    this.loader.load(ROOM_DECOR_MEDIA.art, (texture) => {
      if (this.disposed) { texture.dispose(); return; }
      this._texture(texture);
      for (const [index, material] of this.artMaterials.entries()) {
        const panel = this._texture(texture.clone());
        // One atlas, two original paintings. Leave its center seam outside both
        // canvases and retain the generated art's square aspect ratio.
        panel.repeat.set(0.498, 0.996);
        panel.offset.set(index * 0.5 + 0.001, 0.002);
        panel.needsUpdate = true;
        material.map = panel;
        material.color.set(0xffffff);
        material.needsUpdate = true;
      }
      this.artLoaded = true;
    }, undefined, () => {
      // If an optional media asset is unavailable, leave the linen and real
      // frames intact instead of a broken texture.
    });
  }

  _loadPoster() {
    if (!this.loader || this.localFileMode) return;
    this.loader.load(ROOM_DECOR_MEDIA.poster, (texture) => {
      if (this.disposed) { texture.dispose(); return; }
      this.posterTexture = this._texture(texture);
      this._syncScreen();
    }, undefined, () => {});
  }

  _createVideo() {
    if (!this.document || this.localFileMode) return;
    const video = this.document.createElement('video');
    // CORS rejection must happen at media loading, before an unsafe video can
    // reach a WebGL texture upload. The packaged HTTP assets are same-origin.
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.disablePictureInPicture = true;
    video.setAttribute('aria-hidden', 'true');
    video.setAttribute('playsinline', '');
    this.video = video;
    const on = (type, listener) => {
      video.addEventListener(type, listener);
      this.listeners.push([type, listener]);
    };
    on('loadeddata', () => this._showVideoFrame());
    on('playing', () => {
      if (!this._shouldPlay()) { video.pause(); return; }
      this.mediaStatus = 'playing';
      this._showVideoFrame();
    });
    on('error', () => {
      if (this.disposed) return;
      this.mediaError = true;
      this.playbackRequested = false;
      this.playRequest += 1;
      this.mediaStatus = this.tvEnabled ? 'unavailable' : 'off';
      video.pause();
      this._syncScreen();
    });
  }

  _showVideoFrame() {
    if (this.disposed || !this.tvEnabled || this.mediaError || !this.video || this.video.readyState < 2) return;
    if (!this.videoTexture) {
      this.videoTexture = this._texture(new THREE.VideoTexture(this.video));
      const update = this.videoTexture.update.bind(this.videoTexture);
      // Three's fallback for browsers without video-frame callbacks otherwise
      // uploads the same frame every render even when the media is paused.
      this.videoTexture.update = () => {
        if (this._shouldPlay() && !this.video.paused) update();
      };
      this.videoTexture.needsUpdate = true;
    }
    this._syncScreen();
  }

  _syncScreen() {
    if (this.disposed) return;
    // Power OFF is visually different from a room-motion pause: the glass and
    // indicator go dark, while a pause retains the current still or film frame.
    const powered = this.tvEnabled && !this.localFileMode;
    const map = !powered ? null
      : this.videoTexture && !this.mediaError && this.mediaStatus !== 'blocked'
        ? this.videoTexture : this.posterTexture ?? this.fallbackTexture;
    if (this.screenMaterial.map !== map) {
      this.screenMaterial.map = map;
      this.screenMaterial.needsUpdate = true;
    }
    this.screenMaterial.color.set(powered ? 0xb3b7b3 : 0x080d10);
    this.ledMaterial.color.set(powered ? 0xbaa67c : 0x20251e);
  }

  _shouldPlay() {
    return !this.disposed && !this.localFileMode && this.tvEnabled && !this.paused && this.visible
      && !this.reducedMotion && !this.document?.hidden && !this.mediaError;
  }

  _syncPlayback() {
    if (this.disposed) return;
    this._syncScreen();
    if (this.localFileMode) {
      this.mediaStatus = this.tvEnabled ? 'local-file' : 'off';
      return;
    }
    if (!this.video) return;
    if (!this._shouldPlay()) {
      if (this.playbackRequested || !this.video.paused) {
        this.playRequest += 1;
        this.video.pause();
      }
      this.playbackRequested = false;
      if (!this.tvEnabled) this.mediaStatus = 'off';
      else if (!this.mediaError) this.mediaStatus = this.videoTexture ? 'paused' : 'poster';
      return;
    }
    // Ordinary room UI synchronization must neither start another play promise
    // nor replace a settled status with "loading". A real OFF/ON or pause/resume
    // transition clears this flag and can deliberately retry blocked playback.
    if (this.playbackRequested) return;
    this.playbackRequested = true;
    const request = ++this.playRequest;
    if (!this.video.getAttribute('src')) this.video.src = ROOM_DECOR_MEDIA.film;
    this.mediaStatus = 'loading';
    Promise.resolve(this.video.play()).then(() => {
      if (this.disposed || request !== this.playRequest) return;
      if (!this._shouldPlay()) { this.video.pause(); return; }
      this.mediaStatus = 'playing';
      this._syncScreen();
    }).catch(() => {
      if (this.disposed || request !== this.playRequest || !this._shouldPlay()) return;
      this.mediaStatus = 'blocked';
      this._syncScreen();
    });
  }

  setPaused(paused) {
    const next = Boolean(paused);
    if (this.disposed || this.paused === next) return this.paused;
    this.paused = next;
    this._syncPlayback();
    return this.paused;
  }

  setTVPlaying(enabled) {
    if (this.disposed) return false;
    const next = Boolean(enabled);
    if (this.tvEnabled === next) return this.tvEnabled;
    this.tvEnabled = next;
    if (this.tvEnabled && this.mediaError) {
      this.mediaError = false;
      this.video?.load();
    }
    this._syncPlayback();
    return this.tvEnabled;
  }

  setReducedMotion(enabled) {
    const next = Boolean(enabled);
    if (this.disposed || this.reducedMotion === next) return;
    this.reducedMotion = next;
    this._syncPlayback();
  }

  setVisible(visible) {
    const next = Boolean(visible);
    if (this.disposed || this.visible === next) return;
    this.visible = next;
    this.root.visible = this.visible;
    this._syncPlayback();
  }

  getState() {
    return {
      tvEnabled: this.tvEnabled,
      mediaStatus: this.mediaStatus,
      localFileMode: this.localFileMode,
      paused: this.localFileMode || !this.tvEnabled || this.paused || this.reducedMotion || !this.visible || Boolean(this.document?.hidden),
      muted: true,
      looping: true,
      currentTime: Number(this.video?.currentTime) || 0,
      duration: Number.isFinite(this.video?.duration) ? this.video.duration : 0,
      artLoaded: this.artLoaded,
      paintings: ['Rocky — Philadelphia Museum of Art', 'Boathouse Row — Blue Hour'],
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.playRequest += 1;
    this.document?.removeEventListener('visibilitychange', this.onVisibilityChange);
    if (this.video) {
      for (const [type, listener] of this.listeners) this.video.removeEventListener(type, listener);
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.load();
    }
    this.listeners.length = 0;
    this.root.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
    this.geometries.clear();
    this.materials.clear();
    this.textures.clear();
  }
}
