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
    page.tab(8);
    expect(page.column).toBe(8);
  });

  it('round-trips serialized document state', () => {
    const page = new TypewriterDocument({ sheetNumber: 4 });
    page.type('Q', { seed: 99 });
    const restored = TypewriterDocument.deserialize(page.serialize());
    expect(restored.serialize()).toEqual(page.serialize());
  });
});
