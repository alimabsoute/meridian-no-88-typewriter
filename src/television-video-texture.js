import * as THREE from 'three';

/** VideoTexture semantics with an owned, cancellable frame callback. Three
 * r178's VideoTexture retains its recursive callback after dispose(); an
 * endless multi-resolution playlist must release each old texture completely. */
export class TelevisionVideoTexture extends THREE.Texture {
  constructor(video, canUpload = () => true) {
    super(video);
    this.isVideoTexture = true;
    this.generateMipmaps = false;
    this.minFilter = this.magFilter = THREE.LinearFilter;
    this.canUpload = canUpload;
    this.released = false;
    this.frameCallback = null;
    this.hasFrameCallback = typeof video.requestVideoFrameCallback === 'function';
    const onFrame = () => {
      this.frameCallback = null;
      if (this.released) return;
      if (this.canUpload()) this.needsUpdate = true;
      this.frameCallback = video.requestVideoFrameCallback(onFrame);
    };
    if (this.hasFrameCallback) this.frameCallback = video.requestVideoFrameCallback(onFrame);
  }

  update() {
    if (!this.released && !this.hasFrameCallback && this.image.readyState >= 2 && this.canUpload()) this.needsUpdate = true;
  }

  clone() {
    return new TelevisionVideoTexture(this.image, this.canUpload).copy(this);
  }

  dispose() {
    if (this.released) return;
    this.released = true;
    if (this.frameCallback !== null) this.image.cancelVideoFrameCallback?.(this.frameCallback);
    this.frameCallback = null;
    super.dispose();
  }
}
