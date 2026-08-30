import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PAPER_EXPORT_BASE_HEIGHT,
  PAPER_EXPORT_BASE_WIDTH,
  createBrowserPrintPayload,
  getPaperExportDimensions,
  normalizePaperExportOptions,
} from './paper-export.js';
import { PaperRenderer } from './textures.js';

class FakeGradient {
  constructor() {
    this.stops = [];
  }

  addColorStop(offset, color) {
    this.stops.push([offset, color]);
  }
}

class FakeCanvasContext {
  constructor(canvas) {
    this.canvas = canvas;
    this.textStyles = [];
  }

  createLinearGradient() { return new FakeGradient(); }

  clearRect() {}

  fillRect() {}

  strokeRect() {}

  beginPath() {}

  moveTo() {}

  lineTo() {}

  stroke() {}

  drawImage() {}

  save() {}

  restore() {}

  translate() {}

  rotate() {}

  fillText() { this.textStyles.push(this.fillStyle); }

  getImageData(x, y, width, height) {
    return { data: new Uint8ClampedArray(width * height * 4) };
  }
}

class FakeCanvas {
  constructor() {
    this.width = 300;
    this.height = 150;
    this.context = new FakeCanvasContext(this);
  }

  getContext() { return this.context; }

  toDataURL(mimeType, quality) {
    const suffix = quality === undefined ? '' : `;quality=${quality}`;
    return `data:${mimeType};base64,${this.width}x${this.height}${suffix}`;
  }
}

const previousDocument = globalThis.document;

beforeEach(() => {
  globalThis.document = {
    createElement(tagName) {
      if (tagName === 'canvas') return new FakeCanvas();
      return { click() {} };
    },
  };
});

afterEach(() => {
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
});

describe('paper export options', () => {
  it('keeps the established PNG settings as the exact defaults', () => {
    const options = normalizePaperExportOptions();
    expect(options).toEqual({
      resolutionScale: 1,
      appearance: 'original',
      mimeType: 'image/png',
      quality: 0.92,
    });
    expect(getPaperExportDimensions(options)).toEqual({
      width: PAPER_EXPORT_BASE_WIDTH,
      height: PAPER_EXPORT_BASE_HEIGHT,
      approximateDpi: 151,
    });
    expect(Object.isFrozen(options)).toBe(true);
  });

  it('describes 300-DPI-class and carbon-copy export variants explicitly', () => {
    const options = normalizePaperExportOptions({
      resolutionScale: 2,
      appearance: 'carbon-copy',
    });
    expect(getPaperExportDimensions(options)).toEqual({
      width: 2560,
      height: 3312,
      approximateDpi: 301,
    });
    expect(() => normalizePaperExportOptions({ resolutionScale: 5 })).toThrow(RangeError);
    expect(() => normalizePaperExportOptions({ appearance: 'fake-pdf' })).toThrow(RangeError);
  });

  it('creates an honest browser-print payload without representing it as a PDF', () => {
    const payload = createBrowserPrintPayload('data:image/png;base64,page', {
      title: 'Sheet 07',
      resolutionScale: 2,
      appearance: 'carbon-copy',
    });
    expect(payload).toMatchObject({
      format: 'octoberline211-browser-print-v1',
      title: 'Sheet 07',
      image: {
        width: 2560,
        height: 3312,
        mimeType: 'image/png',
        appearance: 'carbon-copy',
      },
      page: { size: 'Letter', orientation: 'portrait', widthInches: 8.5, heightInches: 11 },
    });
    expect(payload.format).not.toContain('pdf');
    expect(payload.cssText).toContain('@page { size: Letter portrait; margin: 0; }');
    expect(Object.isFrozen(payload.image)).toBe(true);
  });
});

describe('PaperRenderer export paths', () => {
  it('preserves the live canvas for default PNG and renders variants separately', () => {
    const renderer = new PaperRenderer({
      sheetNumber: 4,
      marks: [{
        character: 'A',
        column: 0,
        line: 0,
        ink: 'black',
        force: 0.72,
        seed: 14,
      }],
    });

    expect(renderer.renderExportCanvas()).toBe(renderer.canvas);
    expect(renderer.toDataURL()).toBe(renderer.canvas.toDataURL('image/png'));

    const carbon = renderer.renderExportCanvas({
      resolutionScale: 2,
      appearance: 'carbon-copy',
    });
    expect(carbon).not.toBe(renderer.canvas);
    expect(carbon).toMatchObject({ width: 2560, height: 3312 });
    expect(carbon.context.textStyles.some((style) => style.startsWith('rgba(35,43,61,'))).toBe(true);

    const printPayload = renderer.createBrowserPrintPayload({
      title: 'Carbon sheet',
      resolutionScale: 1,
      appearance: 'carbon-copy',
    });
    expect(printPayload).toMatchObject({
      format: 'octoberline211-browser-print-v1',
      title: 'Carbon sheet',
      image: { appearance: 'carbon-copy', width: 1280, height: 1656 },
    });
  });
});
