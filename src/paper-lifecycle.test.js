import { describe, expect, it } from 'vitest';
import {
  PAPER_LIFECYCLE_SCHEMA_VERSION,
  PaperLifecycle,
  PaperLifecycleError,
  PaperPersistenceError,
  PaperLifecycleStore,
  createPaperLifecycleState,
  deserializePaperLifecycleState,
  serializePaperLifecycleState,
  validatePaperLifecycleState,
} from './paper-lifecycle.js';

class MemoryStorage {
  constructor(options = {}) {
    this.values = new Map();
    this.failWrites = new Set();
    this.quotaBytes = options.quotaBytes ?? Infinity;
    this.writeCounts = new Map();
    this.currentBytes = 0;
    this.peakBytes = 0;
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    if (this.failWrites.has(key)) throw new Error(`write failed for ${key}`);
    const previous = this.values.get(key);
    const encoder = new TextEncoder();
    const previousBytes = previous === undefined ? 0 : encoder.encode(`${key}${previous}`).byteLength;
    const nextBytes = this.currentBytes - previousBytes + encoder.encode(`${key}${value}`).byteLength;
    if (nextBytes > this.quotaBytes) throw new DOMException('storage quota exceeded', 'QuotaExceededError');
    this.values.set(key, value);
    this.currentBytes = nextBytes;
    this.peakBytes = Math.max(this.peakBytes, nextBytes);
    this.writeCounts.set(key, (this.writeCounts.get(key) ?? 0) + 1);
  }

  removeItem(key) {
    const previous = this.values.get(key);
    if (previous !== undefined) {
      this.currentBytes -= new TextEncoder().encode(`${key}${previous}`).byteLength;
    }
    this.values.delete(key);
  }

  usedBytes() {
    return this.currentBytes;
  }
}

function createDenseDocument(sheetNumber) {
  const marks = [];
  for (let line = 0; line < 46; line += 1) {
    for (let column = 0; column < 65; column += 1) {
      const index = line * 65 + column;
      marks.push({
        character: String.fromCharCode(97 + ((index + sheetNumber) % 26)),
        column,
        line,
        ink: index % 17 === 0 ? 'red' : 'black',
        force: 0.65 + (index % 11) * 0.02,
        seed: sheetNumber * 100000 + index,
        timestamp: 1700000000000 + sheetNumber * 10000 + index,
      });
    }
  }
  return {
    columns: 65,
    lines: 46,
    leftMargin: 0,
    rightMargin: 65,
    bellDistance: 5,
    lineSpacing: 1,
    sheetNumber,
    column: 65,
    line: 45,
    marks,
    bellRungForLine: true,
  };
}

function createHarness(options = {}) {
  let timestamp = 1000;
  const now = () => timestamp++;
  const lifecycle = new PaperLifecycle({
    state: createPaperLifecycleState({ updatedAt: now() }),
    now,
    idFactory: (sheetNumber) => `page-${sheetNumber}`,
    seedFactory: () => 8675309,
    blankSheetFactory: (sheetNumber) => ({ sheetNumber, marks: [] }),
    ...options,
  });
  return lifecycle;
}

describe('PaperLifecycle', () => {
  it('files an extracted page and loads monotonically numbered fresh sheets', () => {
    const lifecycle = createHarness();

    lifecycle.loadFreshSheet();
    lifecycle.updateInsertedSheet({ sheetNumber: 1, marks: [{ character: 'A' }] });
    lifecycle.extractInsertedSheet();
    lifecycle.saveLooseSheetToManuscript({ title: 'First page' });
    const second = lifecycle.loadFreshSheet();

    expect(second.page).toMatchObject({ id: 'page-2', sheetNumber: 2 });
    expect(lifecycle.state.manuscript).toHaveLength(1);
    expect(lifecycle.state.manuscript[0]).toMatchObject({
      page: {
        id: 'page-1',
        sheetNumber: 1,
        content: { sheetNumber: 1, marks: [{ character: 'A' }] },
      },
      metadata: { title: 'First page' },
    });
    expect(lifecycle.state.nextSheetNumber).toBe(3);
  });

  it('requires the physical extraction sequence before filing or discarding', () => {
    const lifecycle = createHarness();
    lifecycle.loadFreshSheet();

    expect(() => lifecycle.saveLooseSheetToManuscript()).toThrowError(
      expect.objectContaining({ code: 'no-loose-sheet' }),
    );
    expect(() => lifecycle.discardLooseSheet()).toThrowError(
      expect.objectContaining({ code: 'no-loose-sheet' }),
    );
    expect(lifecycle.state.revision).toBe(1);
  });

  it('preserves content and identity through discard, recovery, and reinsertion', () => {
    const lifecycle = createHarness();
    lifecycle.loadFreshSheet({ marks: [{ character: 'Q', seed: 9 }] });
    lifecycle.extractInsertedSheet();
    lifecycle.discardLooseSheet({ seed: 42, landing: { location: 'floor', x: 0.25 } });

    expect(lifecycle.state.discards[0]).toMatchObject({
      page: { id: 'page-1', content: { marks: [{ character: 'Q', seed: 9 }] } },
      crumple: { seed: 42, landing: { location: 'floor', x: 0.25 } },
    });

    const recovery = lifecycle.recoverDiscardedSheet('page-1');
    expect(recovery.previousCrumple).toMatchObject({ seed: 42 });
    expect(lifecycle.state.looseSheet).toMatchObject({ source: 'wastebasket' });

    lifecycle.reinsertLooseSheet();
    expect(lifecycle.state.insertedSheet).toMatchObject({
      id: 'page-1',
      sheetNumber: 1,
      content: { marks: [{ character: 'Q', seed: 9 }] },
    });
    expect(lifecycle.state.discards).toEqual([]);
  });

  it('restores a filed manuscript sheet as a loose physical page', () => {
    const lifecycle = createHarness();
    lifecycle.loadFreshSheet({ marks: [{ character: 'M' }] });
    lifecycle.extractInsertedSheet();
    lifecycle.saveLooseSheetToManuscript({ chapter: 3 });

    const restored = lifecycle.restoreManuscriptSheet('page-1');

    expect(restored.previousMetadata).toEqual({ chapter: 3 });
    expect(lifecycle.state.manuscript).toEqual([]);
    expect(lifecycle.state.looseSheet).toMatchObject({
      source: 'manuscript',
      page: { id: 'page-1', content: { marks: [{ character: 'M' }] } },
    });
  });

  it('permanently empties all recoverable discards without reusing sheet numbers', () => {
    const lifecycle = createHarness();
    for (let index = 0; index < 2; index += 1) {
      lifecycle.loadFreshSheet({ marks: [{ character: String(index) }] });
      lifecycle.extractInsertedSheet();
      lifecycle.discardLooseSheet();
    }

    const result = lifecycle.permanentlyEmptyWastebasket();
    const fresh = lifecycle.loadFreshSheet();

    expect(result.removedCount).toBe(2);
    expect(lifecycle.state.discards).toEqual([]);
    expect(fresh.page.sheetNumber).toBe(3);
  });

  it('does not commit an in-memory transition when the durable journal cannot be written', () => {
    const storage = new MemoryStorage();
    const store = new PaperLifecycleStore({ storage, key: 'paper' });
    storage.failWrites.add('paper.journal');
    const lifecycle = createHarness({ store });

    expect(() => lifecycle.loadFreshSheet()).toThrowError(
      expect.objectContaining({ code: 'journal-write-failed' }),
    );
    expect(lifecycle.state).toMatchObject({ revision: 0, nextSheetNumber: 1, insertedSheet: null });
  });

  it('blocks a second sheet while an inserted or extracted sheet occupies the paper path', () => {
    const lifecycle = createHarness();
    lifecycle.loadFreshSheet();

    expect(() => lifecycle.loadFreshSheet()).toThrowError(
      expect.objectContaining({ code: 'paper-path-busy' }),
    );
    lifecycle.extractInsertedSheet();
    expect(() => lifecycle.loadFreshSheet()).toThrowError(
      expect.objectContaining({ code: 'paper-path-busy' }),
    );
  });

  it('provides a cached immutable overview without copying archived page contents', () => {
    const lifecycle = createHarness();
    lifecycle.loadFreshSheet({ marks: [{ character: 'A' }] });
    lifecycle.extractInsertedSheet();
    lifecycle.saveLooseSheetToManuscript({ chapter: 1 });

    const first = lifecycle.getOverview();
    const second = lifecycle.getOverview();

    expect(second).toBe(first);
    expect(first).toMatchObject({ manuscriptCount: 1, discardCount: 0, nextSheetNumber: 2 });
    expect(first.manuscript[0].page).not.toHaveProperty('content');
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.manuscript)).toBe(true);
    const full = lifecycle.snapshot();
    expect(full.manuscript[0].page.content).toEqual({ marks: [{ character: 'A' }] });
  });
});

describe('paper lifecycle serialization', () => {
  it('round-trips a versioned record with an integrity checksum', () => {
    const lifecycle = createHarness();
    lifecycle.loadFreshSheet({ sheetNumber: 1, marks: [] });

    const serialized = serializePaperLifecycleState(lifecycle.state);
    expect(JSON.parse(serialized)).toMatchObject({
      format: 'meridian-paper-lifecycle',
      storageVersion: 1,
      state: { schemaVersion: PAPER_LIFECYCLE_SCHEMA_VERSION },
    });
    expect(deserializePaperLifecycleState(serialized)).toEqual(lifecycle.state);
  });

  it('migrates legacy unversioned state and rejects future schemas', () => {
    const migrated = validatePaperLifecycleState({
      revision: 2,
      updatedAt: 10,
      nextSheetNumber: 1,
      activeSheet: {
        id: 'legacy-page',
        sheetNumber: 4,
        createdAt: 1,
        updatedAt: 2,
        content: { marks: [] },
        metadata: {},
      },
      manuscriptPages: [],
      discardedPages: [],
    });

    expect(migrated).toMatchObject({
      schemaVersion: PAPER_LIFECYCLE_SCHEMA_VERSION,
      nextSheetNumber: 5,
      insertedSheet: { id: 'legacy-page', sheetNumber: 4 },
    });
    expect(() => validatePaperLifecycleState({ schemaVersion: 99 })).toThrowError(
      expect.objectContaining({ code: 'unsupported-version' }),
    );
  });

  it('detects mutations to a persisted record', () => {
    const serialized = serializePaperLifecycleState(createPaperLifecycleState({ updatedAt: 10 }));
    const tampered = JSON.parse(serialized);
    tampered.state.nextSheetNumber = 7;

    expect(() => deserializePaperLifecycleState(JSON.stringify(tampered))).toThrowError(
      expect.objectContaining({ code: 'checksum-mismatch' }),
    );
  });
});

describe('PaperLifecycleStore crash recovery', () => {
  it('recovers page contents from a newer journal when both committed manifests stay old', () => {
    const storage = new MemoryStorage();
    let timestamp = 50;
    const store = new PaperLifecycleStore({ storage, key: 'paper' });
    const lifecycle = PaperLifecycle.open({
      store,
      now: () => timestamp++,
      idFactory: () => 'journal-page',
    });
    lifecycle.loadFreshSheet({ marks: [{ character: 'A' }] });
    storage.failWrites.add('paper');
    storage.failWrites.add('paper.backup');

    const update = lifecycle.updateInsertedSheet({ marks: [{ character: 'A' }, { character: 'B' }] });

    expect(update.persistence).toMatchObject({ durable: true, journaled: true, pagesWritten: 1 });
    storage.failWrites.clear();
    const recovered = PaperLifecycle.open({
      store: new PaperLifecycleStore({ storage, key: 'paper' }),
      now: () => timestamp++,
    });
    expect(recovered.state).toMatchObject({
      revision: 2,
      insertedSheet: {
        id: 'journal-page',
        content: { marks: [{ character: 'A' }, { character: 'B' }] },
      },
    });
    expect(storage.getItem('paper.journal')).toBeNull();
  });

  it('recovers a newer verified journal after a primary write failure', () => {
    const storage = new MemoryStorage();
    const store = new PaperLifecycleStore({ storage, key: 'paper' });
    const first = createPaperLifecycleState({ updatedAt: 1 });
    store.save(first);

    const next = { ...first, revision: 1, updatedAt: 2 };
    storage.failWrites.add('paper');
    const result = store.save(next);

    expect(result).toMatchObject({ durable: true, journaled: true, revision: 1 });
    storage.failWrites.delete('paper');
    const recovered = new PaperLifecycleStore({ storage, key: 'paper' }).load();
    expect(recovered).toMatchObject({ revision: 1, updatedAt: 2 });
    expect(new PaperLifecycleStore({ storage, key: 'paper' }).load()).toMatchObject({ revision: 1 });
  });

  it('falls back to the current backup when the primary record is corrupt', () => {
    const storage = new MemoryStorage();
    const store = new PaperLifecycleStore({ storage, key: 'paper' });
    const state = { ...createPaperLifecycleState({ updatedAt: 1 }), revision: 4 };
    store.save(state);
    storage.setItem('paper', '{bad json');

    const recovered = store.load();

    expect(recovered).toMatchObject({ revision: 4, updatedAt: 1 });
    expect(new PaperLifecycleStore({ storage, key: 'paper' }).load()).toMatchObject({ revision: 4 });
  });

  it('prefers and propagates a journal when equal revisions contain different data', () => {
    const storage = new MemoryStorage();
    const store = new PaperLifecycleStore({ storage, key: 'paper' });
    const primary = { ...createPaperLifecycleState({ updatedAt: 1 }), revision: 2 };
    const journal = { ...primary, updatedAt: 2, nextSheetNumber: 3 };
    storage.setItem('paper', serializePaperLifecycleState(primary));
    storage.setItem('paper.backup', serializePaperLifecycleState(primary));
    storage.setItem('paper.journal', serializePaperLifecycleState(journal));

    const recovered = store.load();

    expect(recovered).toMatchObject({ revision: 2, updatedAt: 2, nextSheetNumber: 3 });
    expect(new PaperLifecycleStore({ storage, key: 'paper' }).load()).toMatchObject({
      revision: 2,
      updatedAt: 2,
      nextSheetNumber: 3,
    });
  });

  it('keeps a permanently emptied basket empty after reopening storage', () => {
    const storage = new MemoryStorage();
    const store = new PaperLifecycleStore({ storage, key: 'paper' });
    let timestamp = 100;
    const options = {
      store,
      now: () => timestamp++,
      idFactory: (sheetNumber) => `page-${sheetNumber}`,
    };
    const lifecycle = PaperLifecycle.open(options);
    lifecycle.loadFreshSheet({ marks: [{ character: 'X' }] });
    lifecycle.extractInsertedSheet();
    lifecycle.discardLooseSheet({ seed: 1 });
    lifecycle.permanentlyEmptyWastebasket();

    const reopened = PaperLifecycle.open(options);

    expect(reopened.state.discards).toEqual([]);
    expect(reopened.state.nextSheetNumber).toBe(2);
  });

  it('persists 25 dense pages within a five-mebibyte quota using page-addressed records', () => {
    const quotaBytes = 5 * 1024 * 1024;
    const storage = new MemoryStorage({ quotaBytes });
    const store = new PaperLifecycleStore({ storage, key: 'paper' });
    let timestamp = 1000;
    const lifecycle = PaperLifecycle.open({
      store,
      now: () => timestamp++,
      idFactory: (sheetNumber) => `dense-page-${sheetNumber}`,
    });

    let lastPersistence;
    for (let sheetNumber = 1; sheetNumber <= 25; sheetNumber += 1) {
      lastPersistence = lifecycle.loadFreshSheet(createDenseDocument(sheetNumber)).persistence;
      lifecycle.extractInsertedSheet();
      lifecycle.saveLooseSheetToManuscript({ chapter: sheetNumber });
    }

    const usedBytes = storage.usedBytes();
    expect(usedBytes).toBeLessThan(4 * 1024 * 1024);
    expect(storage.peakBytes).toBeLessThan(quotaBytes);
    expect(lastPersistence).toMatchObject({
      storageFormat: 'page-addressed-v2',
      pagesWritten: 1,
    });
    expect(lastPersistence.manifestBytes).toBeLessThan(20_000);
    expect([...storage.values.keys()].filter((key) => key.includes('.page.'))).toHaveLength(25);

    const reopened = PaperLifecycle.open({
      store: new PaperLifecycleStore({ storage, key: 'paper' }),
      now: () => timestamp++,
    });
    expect(reopened.state.manuscript).toHaveLength(25);
    expect(reopened.state.manuscript[24].page.content.marks).toHaveLength(65 * 46);
    expect(reopened.state.manuscript[24].page.content.marks[0]).toMatchObject({
      character: 'z',
      ink: 'red',
      seed: 2500000,
    });
  }, 30_000);

  it('rejects a stale second-tab commit without overwriting the winning revision', () => {
    const storage = new MemoryStorage();
    let timestamp = 2000;
    const first = PaperLifecycle.open({
      store: new PaperLifecycleStore({ storage, key: 'paper' }),
      now: () => timestamp++,
      idFactory: () => 'first-tab-page',
    });
    const second = PaperLifecycle.open({
      store: new PaperLifecycleStore({ storage, key: 'paper' }),
      now: () => timestamp++,
      idFactory: () => 'second-tab-page',
    });

    first.loadFreshSheet({ marks: [{ character: 'A' }] });
    expect(() => second.loadFreshSheet({ marks: [{ character: 'B' }] })).toThrowError(
      expect.objectContaining({
        name: 'PaperPersistenceError',
        code: 'revision-conflict',
      }),
    );
    expect(second.state).toMatchObject({ revision: 0, insertedSheet: null });

    const reopened = PaperLifecycle.open({
      store: new PaperLifecycleStore({ storage, key: 'paper' }),
      now: () => timestamp++,
    });
    expect(reopened.state.insertedSheet).toMatchObject({
      id: 'first-tab-page',
      content: { marks: [{ character: 'A' }] },
    });
  });

  it('reports storage capacity errors without committing the in-memory transition', () => {
    const storage = new MemoryStorage({ quotaBytes: 900 });
    const lifecycle = PaperLifecycle.open({
      store: new PaperLifecycleStore({ storage, key: 'paper' }),
      now: () => 10,
      idFactory: () => 'too-large',
    });

    let error;
    try {
      lifecycle.loadFreshSheet(createDenseDocument(1));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(PaperPersistenceError);
    expect(error).toMatchObject({ code: 'storage-capacity-exceeded' });
    expect(lifecycle.state).toMatchObject({ revision: 0, insertedSheet: null, nextSheetNumber: 1 });
  });
});

describe('state invariants', () => {
  it('rejects duplicate physical page identities across locations', () => {
    const page = {
      id: 'same-page',
      sheetNumber: 1,
      createdAt: 1,
      updatedAt: 1,
      content: null,
      metadata: {},
    };
    const invalid = {
      ...createPaperLifecycleState({ updatedAt: 1, nextSheetNumber: 2 }),
      insertedSheet: page,
      manuscript: [{ page, filedAt: 1, metadata: {} }],
    };

    expect(() => validatePaperLifecycleState(invalid)).toThrowError(PaperLifecycleError);
  });
});
