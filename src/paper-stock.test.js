import { afterEach, describe, expect, it, vi } from 'vitest';
import { PAPER_STOCKS, drawPaperStock, normalizePaperStock } from './paper-stock.js';
import { PaperRenderer, seededRandom } from './textures.js';
import {
  PaperLifecycle, PaperLifecycleStore,
  serializePaperLifecycleState, deserializePaperLifecycleState,
} from './paper-lifecycle.js';

function context() {
  return {
    gradients: [], strokes: 0, fills: [], text: [],
    createLinearGradient() {
      const stops = [];
      this.gradients.push(stops);
      return { addColorStop: (offset, color) => stops.push([offset, color]) };
    },
    fillRect(...rect) { this.fills.push(rect); },
    stroke() { this.strokes++; },
    beginPath() {}, moveTo() {}, lineTo() {}, clearRect() {},
    drawImage() {}, save() {}, restore() {}, translate() {}, rotate() {}, strokeText() {},
    fillText(...args) { this.text.push([this.fillStyle, ...args]); },
    getImageData(x, y, width, height) { return { data: new Uint8ClampedArray(width * height * 4) }; },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('stationery finishes', () => {
  it('normalizes stale or unsupported preferences safely', () => {
    for (const id of Object.keys(PAPER_STOCKS)) expect(normalizePaperStock(id)).toBe(id);
    for (const id of [null, undefined, '', 'prototype', 'toString', '__proto__']) {
      expect(normalizePaperStock(id)).toBe('bond');
    }
  });

  it('gives all four stocks distinct surfaces without changing opacity', () => {
    const surfaces = Object.keys(PAPER_STOCKS).map(id => {
      const ctx = context();
      drawPaperStock(ctx, 1320, 1710, id, seededRandom(10));
      expect(ctx.globalAlpha).toBeUndefined();
      expect(ctx.strokes).toBeGreaterThan(2000);
      return JSON.stringify([ctx.gradients, ctx.strokes, ctx.fills.length]);
    });
    expect(new Set(surfaces).size).toBe(4);
  });

  it('scales laid lines with export size to preserve the physical pattern', () => {
    const live = context();
    const exported = context();
    drawPaperStock(live, 1320, 1710, 'laid', seededRandom(10));
    drawPaperStock(exported, 2640, 3420, 'laid', seededRandom(10), 2);
    expect(exported.fills.length).toBe(live.fills.length);
    expect(exported.fills[5]).toEqual(live.fills[5].map(value => value * 2));
  });

  it('repaints the existing sheet and preserves impressions, texture identity and export stock', () => {
    vi.stubGlobal('document', {
      createElement() {
        const ctx = context();
        const canvas = { width: 0, height: 0, getContext: () => ctx };
        ctx.canvas = canvas;
        return canvas;
      },
    });
    const doc = { sheetNumber: 2, marks: [] };
    const renderer = new PaperRenderer(doc, { displayScale: 0.05 });
    const texture = renderer.texture;
    const redraw = vi.spyOn(renderer, 'drawImpression');
    const marks = [{ character: 'A', ink: 'black', column: 1, line: 1, force: 1, seed: 3 }];
    doc.marks = marks;
    expect(renderer.setPaperStock('cotton')).toBe(true);
    expect(redraw).toHaveBeenCalledWith(marks[0], false);
    expect(renderer.document).toBe(doc);
    expect(renderer.document.marks).toBe(marks);
    expect(renderer.texture).toBe(texture);
    expect(renderer.texture.userData.inkCoverage).toBe(true);
    expect(renderer.setPaperStock('cotton')).toBe(false);
    const ctx = context();
    renderer.drawExportPaperToContext(ctx, 2, 'original');
    expect(ctx.gradients[0].map(stop => stop[1])).toEqual(PAPER_STOCKS.cotton.colors);
    renderer.texture.dispose();
  });

  it('retains every page stock through typing, extraction, filing, storage reload and original export', () => {
    vi.stubGlobal('document', {
      createElement() {
        const ctx = context();
        const canvas = { width: 0, height: 0, getContext: () => ctx };
        ctx.canvas = canvas;
        return canvas;
      },
    });
    const values = new Map();
    const storage = {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: key => values.delete(key),
    };
    let timestamp = 100;
    const lifecycle = PaperLifecycle.open({
      store: new PaperLifecycleStore({ storage, key: 'stock-integration' }),
      now: () => ++timestamp,
      idFactory: number => `stock-page-${number}`,
    });
    const stocks = Object.keys(PAPER_STOCKS);
    stocks.forEach((stock, index) => {
      const sheetNumber = index + 1;
      lifecycle.loadFreshSheet({ sheetNumber, marks: [] }, { paperStock: stock });
      lifecycle.updateInsertedSheet({ sheetNumber, marks: [{
        character: 'A', ink: index % 2 ? 'red' : 'black',
        column: 1, line: 1, force: 1, seed: 5,
      }] });
      expect(lifecycle.state.insertedSheet.metadata.paperStock).toBe(stock);
      lifecycle.extractInsertedSheet();
      expect(lifecycle.state.looseSheet.page.metadata.paperStock).toBe(stock);
      lifecycle.saveLooseSheetToManuscript({ title: `Stock ${stock}` });
    });

    const restored = PaperLifecycle.open({
      store: new PaperLifecycleStore({ storage, key: 'stock-integration' }),
    });
    const serialized = deserializePaperLifecycleState(serializePaperLifecycleState(restored.state));
    expect(serialized.manuscript.map(entry => entry.page.metadata.paperStock)).toEqual(stocks);
    serialized.manuscript.forEach((entry, index) => {
      const renderer = new PaperRenderer(entry.page.content, {
        displayScale: 0.05, paperStock: entry.page.metadata.paperStock,
      });
      const exported = renderer.renderExportCanvas({ appearance: 'original' });
      expect(exported).toBe(renderer.canvas);
      expect(exported.getContext('2d').gradients[0].map(stop => stop[1]))
        .toEqual(PAPER_STOCKS[stocks[index]].colors);
      expect(entry.page.content.marks[0].character).toBe('A');
      expect(exported.getContext('2d').text[0][0])
        .toContain(index % 2 ? '170,8,18' : '8,8,8');
      renderer.texture.dispose();
    });
  });
});
