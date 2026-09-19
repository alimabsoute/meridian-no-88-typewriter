import assert from 'node:assert/strict';
import { PaperRenderer } from '../src/textures.js';

// Exercise real renderer drawing/upload/export paths with a recording canvas.
// These checks do not substitute for browser font rasterization or visual QA.
class RecordingContext {
  constructor(canvas) { this.canvas = canvas; this.text = []; this.stack = []; }
  createLinearGradient() { return { addColorStop() {} }; }
  clearRect() {}
  fillRect() {}
  beginPath() {}
  moveTo() {}
  lineTo() {}
  stroke() {}
  strokeText() {}
  drawImage() {}
  translate() {}
  rotate() {}
  save() { this.stack.push({ globalAlpha: this.globalAlpha, globalCompositeOperation: this.globalCompositeOperation }); }
  restore() { Object.assign(this, this.stack.pop()); }
  fillText(character, x, y) { this.text.push({ character, x, y, style: this.fillStyle, font: this.font }); }
  getImageData(x, y, width, height) { return { data: new Uint8ClampedArray(width * height * 4).fill(23) }; }
}
class RecordingCanvas {
  constructor() { this.context = new RecordingContext(this); }
  getContext() { return this.context; }
  toDataURL(mime) { return `data:${mime};base64,${this.width}x${this.height}`; }
}
const originalDocument = globalThis.document;
globalThis.document = { createElement: () => new RecordingCanvas() };
try {
  const sheet = { sheetNumber: 1, marks: [] };
  const renderer = new PaperRenderer(sheet);
  assert.deepEqual([renderer.displayWidth, renderer.displayHeight], [2560, 3312]);
  assert.equal(renderer.texture.generateMipmaps, true, 'small frontal glyphs need prefiltered minification');
  assert.equal(renderer.texture.userData.inkCoverage, true, 'ink alpha must be decoded independently of lighting');
  assert.deepEqual([renderer.canvas.width, renderer.canvas.height], [1280, 1656]);
  assert.equal(renderer.renderExportCanvas(), renderer.canvas, 'default export stays on original canvas');

  const black = { character: 'M', column: 8, line: 4, seed: 34, force: 0.25, ink: 'black' };
  renderer.texture.onUpdate(); // Simulate the initial full GPU upload completing.
  renderer.drawImpression(black);
  const impression = renderer.displayContext.text[0];
  assert.match(impression.font, /^52px /);
  const rgba = impression.style.match(/[\d.]+/g).map(Number);
  assert.deepEqual(rgba.slice(0, 3), [8, 8, 8], 'black must be neutral pigment');
  assert.ok(rgba[3] >= 0.95, 'even a light strike must not mix brown paper into the ink');
  const stats = renderer.getUploadStats();
  assert.equal(stats.fullUploads, 1);
  assert.equal(stats.partialUploads, 1);
  assert.ok(stats.partialBytes < 40000, 'one key must remain a small regional upload');
  assert.ok(stats.partialBytes < stats.fullTextureBytes / 500);
  const { x, y, width, height } = stats.lastRegion;
  assert.equal(renderer.texture.updateRanges.length, height);
  assert.equal(renderer.texture.updateRanges[0].start, (y * renderer.displayWidth + x) * 4);
  assert.equal(renderer.texture.updateRanges[0].count, width * 4);

  renderer.drawImpression({ ...black, seed: 35, column: 9, ink: 'red' });
  const red = renderer.displayContext.text[3].style.match(/[\d.]+/g).map(Number);
  assert.ok(red[0] > red[1] * 8 && red[0] > red[2] * 8, 'red stays saturated rather than brown');
  assert.ok(red[3] >= 0.95);
  const carbon = renderer.renderExportCanvas({ resolutionScale: 2, appearance: 'carbon-copy' });
  assert.deepEqual([carbon.width, carbon.height], [2560, 3312]);
  const limited = new PaperRenderer(sheet, { maxTextureSize: 2048 });
  assert.ok(limited.displayWidth <= 2048 && limited.displayHeight <= 2048);
  assert.ok(limited.displayScale > 1, 'limited GPUs still improve on the old 0.6 scale');
  const archived = new PaperRenderer(sheet, { displayScale: 1 });
  assert.equal(archived.textureData.byteLength * 4, renderer.textureData.byteLength, 'archive texture uses one quarter of active-sheet bytes');
  assert.deepEqual([archived.renderExportCanvas().width, archived.renderExportCanvas().height], [1280, 1656]);
  archived.texture.dispose();
  const lowPressureStyle = renderer.context.text[0].style;
  renderer.drawImpression({ ...black, force: 1 });
  assert.notEqual(renderer.context.text.at(-3).style, lowPressureStyle, 'pressure variation stays intact');
  const beforeStencil = renderer.context.text.length;
  renderer.drawImpression({ ...black, ink: 'stencil' });
  assert.equal(renderer.context.text.length - beforeStencil, 2, 'stencil relief remains a two-pass emboss');
  renderer.texture.dispose();
  limited.texture.dispose();
  console.log('Paper ink checks passed: neutral black, saturated red, pressure/stencil preservation, 2x glyphs, GPU cap, regional uploads, unchanged export dimensions. Browser sharpness remains a visual check.');
} finally {
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
}
