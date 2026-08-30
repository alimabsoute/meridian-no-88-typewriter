import { describe, expect, it } from 'vitest';
import { TypewriterDocument } from './typewriter-document.js';

describe('TypewriterDocument', () => {
  it('records characters and advances one escapement pitch', () => {
    const page = new TypewriterDocument();
    const result = page.type('A', { ink: 'red', force: 0.8, seed: 42 });
    expect(result.accepted).toBe(true);
    expect(page.column).toBe(1);
    expect(page.marks[0]).toMatchObject({ character: 'A', column: 0, line: 0, ink: 'red', seed: 42 });
  });

  it('spaces without making an ink mark', () => {
    const page = new TypewriterDocument();
    page.space();
    expect(page.column).toBe(1);
    expect(page.marks).toHaveLength(0);
  });

  it('backspaces without erasing and permits an overstrike', () => {
    const page = new TypewriterDocument();
    page.type('A', { seed: 1 });
    page.backspace();
    page.type('B', { seed: 2 });
    expect(page.marks).toHaveLength(2);
    expect(page.marks.map(({ column }) => column)).toEqual([0, 0]);
    expect(page.toPlainText()).toBe('B');
  });

  it('rings once five spaces before the right margin and locks at the stop', () => {
    const page = new TypewriterDocument({ columns: 12, rightMargin: 10, bellDistance: 5 });
    const events = Array.from({ length: 10 }, () => page.space());
    expect(events.filter(({ bell }) => bell)).toHaveLength(1);
    expect(events[4].bell).toBe(true);
    expect(page.space()).toMatchObject({ accepted: false, reason: 'margin' });
  });

  it('returns the carriage and advances by selected line spacing', () => {
    const page = new TypewriterDocument({ lineSpacing: 2 });
    page.type('A', { seed: 1 });
    const result = page.carriageReturn();
    expect(result).toMatchObject({ previousColumn: 1, column: 0, line: 2 });
  });

  it('tabs to the next mechanical stop', () => {
    const page = new TypewriterDocument();
    page.type('A', { seed: 1 });
    page.tab();
    expect(page.column).toBe(8);
  });

  it('retains the legacy fixed-width tab call', () => {
    const page = new TypewriterDocument({ tabStops: [5, 13] });
    page.type('A', { seed: 1 });
    expect(page.tab(8)).toMatchObject({ accepted: true, column: 8, tabStop: 8 });
  });

  it('moves through explicit tab stops and stops at the right margin', () => {
    const page = new TypewriterDocument({ columns: 40, rightMargin: 30, tabStops: [4, 11, 19, 37] });
    expect(page.tab()).toMatchObject({ column: 4, tabStop: 4 });
    expect(page.tab()).toMatchObject({ column: 11, tabStop: 11 });
    expect(page.tab()).toMatchObject({ column: 19, tabStop: 19 });
    expect(page.tab()).toMatchObject({ column: 30, tabStop: null, marginReached: true });
  });

  it('adds, removes, clears, sorts, and resets tab stops safely', () => {
    const page = new TypewriterDocument({ columns: 32, tabStops: [18, 6, 6] });
    expect(page.tabStops).toEqual([6, 18]);
    expect(page.setTabStop(12)).toEqual([6, 12, 18]);
    expect(page.setTabStop(6, false)).toEqual([12, 18]);
    expect(page.clearTabStops()).toEqual([]);
    expect(page.resetTabStops()).toEqual([8, 16, 24]);
  });

  it('rejects invalid tab-stop settings without corrupting the current stops', () => {
    const page = new TypewriterDocument({ columns: 20, tabStops: [5, 10] });
    expect(() => page.setTabStops([4, -1])).toThrow(RangeError);
    expect(() => page.setTabStops([4, 7.5])).toThrow(TypeError);
    expect(() => page.setTabStops('4,8')).toThrow(TypeError);
    expect(() => page.setTabStop(21)).toThrow(RangeError);
    expect(page.tabStops).toEqual([5, 10]);
  });

  it('adjusts both margins atomically and keeps the carriage within them', () => {
    const page = new TypewriterDocument({ columns: 40 });
    for (let index = 0; index < 12; index += 1) page.space();

    expect(page.setMargins(15, 32)).toMatchObject({
      leftMargin: 15,
      rightMargin: 32,
      column: 15,
      columnAdjusted: true,
    });
    expect(page.carriageReturn()).toMatchObject({ column: 15 });
    expect(page.setRightMargin(20)).toMatchObject({ leftMargin: 15, rightMargin: 20 });
    expect(page.setLeftMargin(14)).toMatchObject({ leftMargin: 14, rightMargin: 20 });
  });

  it.each([
    [-1, 20],
    [0.5, 20],
    [10, 10],
    [11, 10],
    [0, 21],
  ])('rejects invalid margins (%s, %s) without a partial update', (leftMargin, rightMargin) => {
    const page = new TypewriterDocument({ columns: 20, leftMargin: 2, rightMargin: 18 });
    expect(() => page.setMargins(leftMargin, rightMargin)).toThrow();
    expect(page.getMargins()).toEqual({ leftMargin: 2, rightMargin: 18 });
  });

  it('round-trips serialized document state', () => {
    const page = new TypewriterDocument({
      sheetNumber: 4,
      leftMargin: 3,
      rightMargin: 52,
      tabStops: [7, 14, 29, 41],
    });
    page.type('Q', { seed: 99 });
    const restored = TypewriterDocument.deserialize(page.serialize());
    expect(restored.serialize()).toEqual(page.serialize());
  });

  it('restores legacy payloads without tab stops using the original eight-column layout', () => {
    const legacy = {
      columns: 25,
      lines: 10,
      leftMargin: 0,
      rightMargin: 25,
      column: 1,
      line: 0,
      marks: [],
    };
    const restored = TypewriterDocument.deserialize(legacy);
    expect(restored.tabStops).toEqual([8, 16, 24]);
    expect(restored.tab()).toMatchObject({ column: 8, tabStop: 8 });
  });
});
