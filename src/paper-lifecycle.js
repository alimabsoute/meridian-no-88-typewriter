export const PAPER_LIFECYCLE_SCHEMA_VERSION = 1;
export const PAPER_LIFECYCLE_STORAGE_VERSION = 1;
export const DEFAULT_PAPER_LIFECYCLE_KEY = 'octoberline211.paper-lifecycle';
export const PAPER_SHEET_LOCATIONS = Object.freeze(['loaded', 'loose', 'filed', 'discarded']);

const STORAGE_FORMAT = 'octoberline211-paper-lifecycle';
const MANIFEST_STORAGE_FORMAT = 'octoberline211-paper-lifecycle-manifest';
const MANIFEST_STORAGE_VERSION = 2;
const PAGE_STORAGE_FORMAT = 'octoberline211-paper-lifecycle-page';
const PAGE_STORAGE_VERSION = 1;
const LEGACY_STORAGE_FORMAT = 'meridian-paper-lifecycle';
const LEGACY_MANIFEST_STORAGE_FORMAT = 'meridian-paper-lifecycle-manifest';
const LEGACY_PAGE_STORAGE_FORMAT = 'meridian-paper-lifecycle-page';
const LEGACY_STORAGE_KEYS = Object.freeze(new Map([
  ['octoberline211.paper-lifecycle', ['meridian.paper-lifecycle']],
  ['octoberline211.paper-lifecycle.release-1', ['meridian.paper-lifecycle.release-1']],
]));

const TYPEWRITER_DOCUMENT_FIELDS = [
  'columns',
  'lines',
  'leftMargin',
  'rightMargin',
  'bellDistance',
  'lineSpacing',
  'sheetNumber',
  'column',
  'line',
  'bellRungForLine',
];
const TYPEWRITER_MARK_FIELDS = ['character', 'column', 'line', 'ink', 'force', 'seed', 'timestamp'];
const TYPEWRITER_INKS = ['black', 'red', 'stencil'];

export class PaperLifecycleError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'PaperLifecycleError';
    this.code = code;
  }
}

export class PaperPersistenceError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'PaperPersistenceError';
    this.code = code;
  }
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    throw new PaperLifecycleError('not-serializable', 'Paper lifecycle data must be JSON serializable', error);
  }
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PaperLifecycleError('invalid-state', `${label} must be an object`);
  }
}

function assertTimestamp(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new PaperLifecycleError('invalid-state', `${label} must be a non-negative timestamp`);
  }
}

function assertPage(page, label, { checkSerializable = true } = {}) {
  assertPlainObject(page, label);
  if (typeof page.id !== 'string' || !page.id) {
    throw new PaperLifecycleError('invalid-state', `${label}.id must be a non-empty string`);
  }
  if (!Number.isSafeInteger(page.sheetNumber) || page.sheetNumber < 1) {
    throw new PaperLifecycleError('invalid-state', `${label}.sheetNumber must be a positive integer`);
  }
  assertTimestamp(page.createdAt, `${label}.createdAt`);
  assertTimestamp(page.updatedAt, `${label}.updatedAt`);
  assertPlainObject(page.metadata, `${label}.metadata`);
  if (checkSerializable) cloneJson(page.content);
}

function migrateLegacyState(rawState) {
  const manuscript = rawState.manuscript ?? rawState.manuscriptPages ?? [];
  const discards = rawState.discards ?? rawState.discardedPages ?? [];
  const insertedSheet = rawState.insertedSheet ?? rawState.activeSheet ?? null;
  const looseSheet = rawState.looseSheet ?? null;
  const pages = [
    insertedSheet,
    looseSheet?.page,
    ...manuscript.map((entry) => entry.page),
    ...discards.map((entry) => entry.page),
  ].filter(Boolean);
  const highestSheetNumber = pages.reduce(
    (highest, page) => Math.max(highest, Number.isSafeInteger(page.sheetNumber) ? page.sheetNumber : 0),
    0,
  );

  return {
    schemaVersion: PAPER_LIFECYCLE_SCHEMA_VERSION,
    revision: Number.isSafeInteger(rawState.revision) ? rawState.revision : 0,
    updatedAt: Number.isFinite(rawState.updatedAt) ? rawState.updatedAt : 0,
    nextSheetNumber: Math.max(rawState.nextSheetNumber ?? 1, highestSheetNumber + 1),
    insertedSheet,
    looseSheet,
    manuscript,
    discards,
  };
}

export function migratePaperLifecycleState(rawState) {
  assertPlainObject(rawState, 'paper lifecycle state');
  const version = rawState.schemaVersion ?? 0;
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new PaperLifecycleError('unsupported-version', 'Paper lifecycle schema version is invalid');
  }
  if (version > PAPER_LIFECYCLE_SCHEMA_VERSION) {
    throw new PaperLifecycleError(
      'unsupported-version',
      `Paper lifecycle schema ${version} is newer than supported schema ${PAPER_LIFECYCLE_SCHEMA_VERSION}`,
    );
  }

  return cloneJson(version === 0 ? migrateLegacyState(rawState) : rawState);
}

function validateNormalizedPaperLifecycleState(state, { checkSerializable = true } = {}) {
  if (state.schemaVersion !== PAPER_LIFECYCLE_SCHEMA_VERSION) {
    throw new PaperLifecycleError('unsupported-version', 'Paper lifecycle state could not be migrated');
  }
  if (!Number.isSafeInteger(state.revision) || state.revision < 0) {
    throw new PaperLifecycleError('invalid-state', 'revision must be a non-negative integer');
  }
  assertTimestamp(state.updatedAt, 'updatedAt');
  if (!Number.isSafeInteger(state.nextSheetNumber) || state.nextSheetNumber < 1) {
    throw new PaperLifecycleError('invalid-state', 'nextSheetNumber must be a positive integer');
  }
  if (!Array.isArray(state.manuscript) || !Array.isArray(state.discards)) {
    throw new PaperLifecycleError('invalid-state', 'manuscript and discards must be arrays');
  }

  const knownIds = new Set();
  let highestSheetNumber = 0;
  const recordPage = (page, label) => {
    assertPage(page, label, { checkSerializable });
    if (knownIds.has(page.id)) {
      throw new PaperLifecycleError('invalid-state', `Duplicate page id: ${page.id}`);
    }
    knownIds.add(page.id);
    highestSheetNumber = Math.max(highestSheetNumber, page.sheetNumber);
  };

  if (state.insertedSheet !== null) recordPage(state.insertedSheet, 'insertedSheet');
  if (state.looseSheet !== null) {
    assertPlainObject(state.looseSheet, 'looseSheet');
    recordPage(state.looseSheet.page, 'looseSheet.page');
    assertTimestamp(state.looseSheet.extractedAt, 'looseSheet.extractedAt');
    if (!['platen', 'manuscript', 'wastebasket'].includes(state.looseSheet.source)) {
      throw new PaperLifecycleError('invalid-state', 'looseSheet.source is invalid');
    }
  }

  state.manuscript.forEach((entry, index) => {
    assertPlainObject(entry, `manuscript[${index}]`);
    recordPage(entry.page, `manuscript[${index}].page`);
    assertTimestamp(entry.filedAt, `manuscript[${index}].filedAt`);
    assertPlainObject(entry.metadata, `manuscript[${index}].metadata`);
  });

  state.discards.forEach((entry, index) => {
    assertPlainObject(entry, `discards[${index}]`);
    recordPage(entry.page, `discards[${index}].page`);
    assertTimestamp(entry.discardedAt, `discards[${index}].discardedAt`);
    assertPlainObject(entry.crumple, `discards[${index}].crumple`);
    if (!Number.isSafeInteger(entry.crumple.seed) || entry.crumple.seed < 0) {
      throw new PaperLifecycleError('invalid-state', `discards[${index}].crumple.seed must be a non-negative integer`);
    }
    if (!Number.isFinite(entry.crumple.compression)
      || entry.crumple.compression < 0
      || entry.crumple.compression > 1) {
      throw new PaperLifecycleError('invalid-state', `discards[${index}].crumple.compression must be between 0 and 1`);
    }
  });

  if (state.insertedSheet !== null && state.looseSheet !== null) {
    throw new PaperLifecycleError('invalid-state', 'A sheet cannot be inserted and loose at the same time');
  }
  if (state.nextSheetNumber <= highestSheetNumber) {
    throw new PaperLifecycleError('invalid-state', 'nextSheetNumber must be greater than every existing sheet number');
  }

  return state;
}

export function validatePaperLifecycleState(rawState) {
  return validateNormalizedPaperLifecycleState(migratePaperLifecycleState(rawState));
}

function validatePaperLifecycleStateReference(rawState) {
  assertPlainObject(rawState, 'paper lifecycle state');
  const version = rawState.schemaVersion ?? 0;
  if (version === 0) return validatePaperLifecycleState(rawState);
  if (!Number.isSafeInteger(version) || version < 0 || version > PAPER_LIFECYCLE_SCHEMA_VERSION) {
    throw new PaperLifecycleError('unsupported-version', 'Paper lifecycle schema version is invalid or unsupported');
  }
  return validateNormalizedPaperLifecycleState(rawState, { checkSerializable: false });
}

export function createPaperLifecycleState(options = {}) {
  const state = {
    schemaVersion: PAPER_LIFECYCLE_SCHEMA_VERSION,
    revision: 0,
    updatedAt: options.updatedAt ?? Date.now(),
    nextSheetNumber: options.nextSheetNumber ?? 1,
    insertedSheet: null,
    looseSheet: null,
    manuscript: [],
    discards: [],
  };
  return validatePaperLifecycleState(state);
}

function checksum(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function createStorageEnvelope(state) {
  const validState = validatePaperLifecycleState(state);
  const stateText = JSON.stringify(validState);
  return {
    format: STORAGE_FORMAT,
    storageVersion: PAPER_LIFECYCLE_STORAGE_VERSION,
    checksum: checksum(stateText),
    state: validState,
  };
}

export function serializePaperLifecycleState(state) {
  return JSON.stringify(createStorageEnvelope(state));
}

export function deserializePaperLifecycleState(serialized) {
  let envelope;
  try {
    envelope = typeof serialized === 'string' ? JSON.parse(serialized) : cloneJson(serialized);
  } catch (error) {
    throw new PaperPersistenceError('corrupt-record', 'Paper lifecycle record is not valid JSON', error);
  }
  if (!envelope || ![STORAGE_FORMAT, LEGACY_STORAGE_FORMAT].includes(envelope.format)) {
    throw new PaperPersistenceError('corrupt-record', 'Paper lifecycle storage format is invalid');
  }
  if (envelope.storageVersion !== PAPER_LIFECYCLE_STORAGE_VERSION) {
    throw new PaperPersistenceError('unsupported-storage-version', 'Paper lifecycle storage version is unsupported');
  }
  if (checksum(JSON.stringify(envelope.state)) !== envelope.checksum) {
    throw new PaperPersistenceError('checksum-mismatch', 'Paper lifecycle record failed its integrity check');
  }
  return validatePaperLifecycleState(envelope.state);
}

function ownKeysExcept(value, excluded) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !excluded.has(key)));
}

function canCompactTypewriterDocument(content) {
  return Boolean(
    content
    && typeof content === 'object'
    && !Array.isArray(content)
    && TYPEWRITER_DOCUMENT_FIELDS.every((field) => Object.hasOwn(content, field))
    && Array.isArray(content.marks)
    && content.marks.every(
      (mark) => mark
        && typeof mark === 'object'
        && !Array.isArray(mark)
        && TYPEWRITER_MARK_FIELDS.every((field) => Object.hasOwn(mark, field)),
    )
  );
}

function compactPageContent(content) {
  if (!canCompactTypewriterDocument(content)) return ['json-v1', content];
  const documentFields = new Set([...TYPEWRITER_DOCUMENT_FIELDS, 'marks']);
  const markFields = new Set(TYPEWRITER_MARK_FIELDS);
  const extras = ownKeysExcept(content, documentFields);
  const header = TYPEWRITER_DOCUMENT_FIELDS.map((field) => content[field]);
  const marks = content.marks.map((mark) => {
    const inkIndex = TYPEWRITER_INKS.indexOf(mark.ink);
    const markExtras = ownKeysExcept(mark, markFields);
    return [
      mark.character,
      mark.column,
      mark.line,
      inkIndex === -1 ? mark.ink : inkIndex,
      mark.force,
      mark.seed,
      mark.timestamp,
      Object.keys(markExtras).length ? markExtras : null,
    ];
  });
  return [
    'typewriter-document-v1',
    header,
    marks,
    Object.keys(extras).length ? extras : null,
  ];
}

function expandPageContent(payload) {
  if (!Array.isArray(payload)) {
    throw new PaperPersistenceError('corrupt-page', 'Paper page payload is invalid');
  }
  if (payload[0] === 'json-v1') return cloneJson(payload[1]);
  if (payload[0] !== 'typewriter-document-v1' || !Array.isArray(payload[1]) || !Array.isArray(payload[2])) {
    throw new PaperPersistenceError('unsupported-page-encoding', 'Paper page encoding is unsupported');
  }
  const content = { ...(payload[3] ?? {}) };
  TYPEWRITER_DOCUMENT_FIELDS.forEach((field, index) => {
    content[field] = payload[1][index];
  });
  content.marks = payload[2].map((mark) => {
    if (!Array.isArray(mark) || mark.length < 7) {
      throw new PaperPersistenceError('corrupt-page', 'Paper impression payload is invalid');
    }
    const ink = Number.isSafeInteger(mark[3]) && TYPEWRITER_INKS[mark[3]]
      ? TYPEWRITER_INKS[mark[3]]
      : mark[3];
    return {
      ...(mark[7] ?? {}),
      character: mark[0],
      column: mark[1],
      line: mark[2],
      ink,
      force: mark[4],
      seed: mark[5],
      timestamp: mark[6],
    };
  });
  return content;
}

function createPageBlob(page) {
  const payload = compactPageContent(page.content);
  const payloadText = JSON.stringify(payload);
  const payloadChecksum = checksum(payloadText);
  const serialized = JSON.stringify({
    format: PAGE_STORAGE_FORMAT,
    storageVersion: PAGE_STORAGE_VERSION,
    pageId: page.id,
    checksum: payloadChecksum,
    payload,
  });
  return { payloadChecksum, serialized };
}

function deserializePageBlob(serialized, pageRef) {
  let envelope;
  try {
    envelope = JSON.parse(serialized);
  } catch (error) {
    throw new PaperPersistenceError('corrupt-page', `Stored page ${pageRef.id} is not valid JSON`, error);
  }
  if (![PAGE_STORAGE_FORMAT, LEGACY_PAGE_STORAGE_FORMAT].includes(envelope?.format)
    || envelope.storageVersion !== PAGE_STORAGE_VERSION) {
    throw new PaperPersistenceError('corrupt-page', `Stored page ${pageRef.id} has an invalid format`);
  }
  if (envelope.pageId !== pageRef.id) {
    throw new PaperPersistenceError('page-identity-mismatch', `Stored page ${pageRef.id} has the wrong identity`);
  }
  if (checksum(JSON.stringify(envelope.payload)) !== envelope.checksum) {
    throw new PaperPersistenceError('page-checksum-mismatch', `Stored page ${pageRef.id} failed its integrity check`);
  }
  return expandPageContent(envelope.payload);
}

function createManifestEnvelope(state) {
  const stateText = JSON.stringify(state);
  return JSON.stringify({
    format: MANIFEST_STORAGE_FORMAT,
    storageVersion: MANIFEST_STORAGE_VERSION,
    checksum: checksum(stateText),
    state,
  });
}

function parseManifestEnvelope(serialized) {
  let envelope;
  try {
    envelope = JSON.parse(serialized);
  } catch (error) {
    throw new PaperPersistenceError('corrupt-record', 'Paper lifecycle manifest is not valid JSON', error);
  }
  if (![MANIFEST_STORAGE_FORMAT, LEGACY_MANIFEST_STORAGE_FORMAT].includes(envelope?.format)
    || envelope.storageVersion !== MANIFEST_STORAGE_VERSION) {
    throw new PaperPersistenceError('unsupported-storage-version', 'Paper lifecycle manifest version is unsupported');
  }
  if (checksum(JSON.stringify(envelope.state)) !== envelope.checksum) {
    throw new PaperPersistenceError('checksum-mismatch', 'Paper lifecycle manifest failed its integrity check');
  }
  return envelope.state;
}

function isQuotaError(error) {
  return error?.name === 'QuotaExceededError'
    || error?.code === 22
    || /quota|capacity|storage full/i.test(error?.message ?? '');
}

function persistenceWriteError(code, message, error) {
  return new PaperPersistenceError(isQuotaError(error) ? 'storage-capacity-exceeded' : code, message, error);
}

function assertStorage(storage) {
  for (const method of ['getItem', 'setItem', 'removeItem']) {
    if (!storage || typeof storage[method] !== 'function') {
      throw new PaperPersistenceError('invalid-storage', `Storage adapter must implement ${method}()`);
    }
  }
}

export function createLocalStorageAdapter(storage = globalThis.localStorage) {
  assertStorage(storage);
  return Object.freeze({
    getItem: (key) => storage.getItem(key),
    setItem: (key, value) => storage.setItem(key, value),
    removeItem: (key) => storage.removeItem(key),
  });
}

export class PaperLifecycleStore {
  constructor(options = {}) {
    assertStorage(options.storage);
    this.storage = options.storage;
    this.key = options.key ?? DEFAULT_PAPER_LIFECYCLE_KEY;
    this.journalKey = `${this.key}.journal`;
    this.backupKey = `${this.key}.backup`;
    const legacyKeys = options.legacyKeys ?? LEGACY_STORAGE_KEYS.get(this.key) ?? [];
    if (!Array.isArray(legacyKeys)
      || legacyKeys.some((key) => typeof key !== 'string' || !key || key === this.key)
      || new Set(legacyKeys).size !== legacyKeys.length) {
      throw new PaperPersistenceError('invalid-storage-key', 'Legacy paper storage keys must be unique non-empty strings');
    }
    this.legacyKeys = [...new Set(legacyKeys)];
    this.knownRevision = null;
    this.pageRefs = new Map();
    this.referencedBlobKeys = new Set();
  }

  hydrateManifestState(manifestState) {
    assertPlainObject(manifestState, 'paper lifecycle manifest state');
    const blobKeys = new Set();
    const pageRefs = new Map();
    const hydratePage = (pageRef, label) => {
      assertPlainObject(pageRef, label);
      if (typeof pageRef.contentKey !== 'string' || !pageRef.contentKey) {
        throw new PaperPersistenceError('corrupt-record', `${label}.contentKey is missing`);
      }
      const serialized = this.storage.getItem(pageRef.contentKey);
      if (serialized === null) {
        throw new PaperPersistenceError('missing-page', `Stored page ${pageRef.id} is missing`);
      }
      const page = {
        id: pageRef.id,
        sheetNumber: pageRef.sheetNumber,
        createdAt: pageRef.createdAt,
        updatedAt: pageRef.updatedAt,
        content: deserializePageBlob(serialized, pageRef),
        metadata: cloneJson(pageRef.metadata ?? {}),
      };
      blobKeys.add(pageRef.contentKey);
      pageRefs.set(page.id, { updatedAt: page.updatedAt, contentKey: pageRef.contentKey });
      return page;
    };
    const state = {
      schemaVersion: manifestState.schemaVersion,
      revision: manifestState.revision,
      updatedAt: manifestState.updatedAt,
      nextSheetNumber: manifestState.nextSheetNumber,
      insertedSheet: manifestState.insertedSheet
        ? hydratePage(manifestState.insertedSheet, 'insertedSheet')
        : null,
      looseSheet: manifestState.looseSheet
        ? {
          ...manifestState.looseSheet,
          page: hydratePage(manifestState.looseSheet.page, 'looseSheet.page'),
        }
        : null,
      manuscript: (manifestState.manuscript ?? []).map((entry, index) => ({
        ...entry,
        page: hydratePage(entry.page, `manuscript[${index}].page`),
        metadata: cloneJson(entry.metadata ?? {}),
      })),
      discards: (manifestState.discards ?? []).map((entry, index) => ({
        ...entry,
        page: hydratePage(entry.page, `discards[${index}].page`),
        crumple: cloneJson(entry.crumple),
      })),
    };
    return {
      state: validatePaperLifecycleState(state),
      blobKeys,
      pageRefs,
    };
  }

  readRecord(key, { hydrate = true } = {}) {
    try {
      const serialized = this.storage.getItem(key);
      if (serialized === null) return null;
      const parsed = JSON.parse(serialized);
      if ([MANIFEST_STORAGE_FORMAT, LEGACY_MANIFEST_STORAGE_FORMAT].includes(parsed?.format)) {
        const manifestState = parseManifestEnvelope(serialized);
        if (!hydrate) return { key, revision: manifestState.revision, serialized, kind: 'manifest' };
        const hydrated = this.hydrateManifestState(manifestState);
        return {
          key,
          ...hydrated,
          revision: hydrated.state.revision,
          serialized,
          kind: 'manifest',
        };
      }
      const state = deserializePaperLifecycleState(serialized);
      return {
        key,
        state: hydrate ? state : undefined,
        revision: state.revision,
        blobKeys: new Set(),
        pageRefs: new Map(),
        serialized,
        kind: 'legacy',
      };
    } catch (error) {
      return {
        key,
        error: error instanceof PaperPersistenceError
          ? error
          : new PaperPersistenceError('storage-read-failed', `Could not read paper archive record ${key}`, error),
      };
    }
  }

  records({ hydrate = true, includeJournal = true } = {}) {
    const bases = [this.key, ...this.legacyKeys];
    const keys = bases.flatMap((base) => (includeJournal
      ? [base, `${base}.journal`, `${base}.backup`]
      : [base, `${base}.backup`]));
    return keys.map((key) => this.readRecord(key, { hydrate })).filter(Boolean);
  }

  sortRecords(records) {
    const preference = new Map();
    [...this.legacyKeys].reverse().forEach((base, index) => {
      const score = index * 3;
      preference.set(`${base}.journal`, score + 3);
      preference.set(base, score + 2);
      preference.set(`${base}.backup`, score + 1);
    });
    const currentScore = this.legacyKeys.length * 3;
    preference.set(this.journalKey, currentScore + 3);
    preference.set(this.key, currentScore + 2);
    preference.set(this.backupKey, currentScore + 1);
    return records.sort(
      (left, right) => right.revision - left.revision
        || (preference.get(right.key) ?? 0) - (preference.get(left.key) ?? 0),
    );
  }

  bestValidRecord(options = {}) {
    const records = this.records(options);
    const validRecords = records.filter((record) => !record.error && Number.isSafeInteger(record.revision));
    return this.sortRecords(validRecords)[0] ?? null;
  }

  load() {
    const records = this.records();
    if (!records.length) return null;

    const validRecords = records.filter((record) => record.state);
    if (!validRecords.length) {
      throw new PaperPersistenceError('no-valid-record', 'No valid paper lifecycle record could be recovered');
    }

    this.sortRecords(validRecords);
    const recoveredRecord = validRecords[0];
    const recovered = recoveredRecord.state;
    this.knownRevision = recovered.revision;
    this.pageRefs = new Map(recoveredRecord.pageRefs ?? []);
    this.referencedBlobKeys = new Set(validRecords.flatMap((record) => [...(record.blobKeys ?? [])]));

    const recoveredText = JSON.stringify(recovered);
    const allCurrent = [this.key, this.backupKey].every((key) => {
      const record = validRecords.find((candidate) => candidate.key === key);
      return record && JSON.stringify(record.state) === recoveredText;
    });
    if (!allCurrent || records.some((record) => record.error)) {
      try {
        this.writeState(recovered, { skipConflict: true });
      } catch {
        // A valid record is still safer to return than failing recovery because
        // storage repair is temporarily unavailable.
      }
    } else if (this.storage.getItem(this.journalKey) !== null) {
      try {
        this.storage.removeItem(this.journalKey);
      } catch {
        // Leaving an equal-revision journal is harmless and recoverable.
      }
    }

    return cloneJson(recovered);
  }

  assertNoRevisionConflict(state) {
    const current = this.bestValidRecord({ hydrate: false });
    const currentRevision = current?.revision ?? null;
    if (this.knownRevision === null) {
      if (currentRevision !== null) {
        throw new PaperPersistenceError(
          'revision-conflict',
          `Paper archive changed in another tab at revision ${currentRevision}`,
        );
      }
      return;
    }
    if (currentRevision !== this.knownRevision) {
      throw new PaperPersistenceError(
        'revision-conflict',
        `Paper archive changed from revision ${this.knownRevision} to ${currentRevision ?? 'missing'}`,
      );
    }
    if (state.revision < this.knownRevision || state.revision > this.knownRevision + 1) {
      throw new PaperPersistenceError(
        'invalid-revision-transition',
        `Cannot save paper revision ${state.revision} after revision ${this.knownRevision}`,
      );
    }
  }

  pageReference(page, { forceEncode = false, blobWrites, nextPageRefs }) {
    const cached = this.pageRefs.get(page.id);
    if (!forceEncode && cached?.updatedAt === page.updatedAt) {
      const reference = {
        id: page.id,
        sheetNumber: page.sheetNumber,
        createdAt: page.createdAt,
        updatedAt: page.updatedAt,
        metadata: page.metadata,
        contentKey: cached.contentKey,
      };
      nextPageRefs.set(page.id, cached);
      return reference;
    }

    const blob = createPageBlob(page);
    const contentKey = `${this.key}.page.${checksum(page.id)}.${page.updatedAt}.${blob.payloadChecksum}`;
    const existing = this.storage.getItem(contentKey);
    if (existing !== null && existing !== blob.serialized) {
      throw new PaperPersistenceError('page-key-collision', `Stored page key collision for ${page.id}`);
    }
    if (existing === null) blobWrites.set(contentKey, blob.serialized);
    nextPageRefs.set(page.id, { updatedAt: page.updatedAt, contentKey });
    return {
      id: page.id,
      sheetNumber: page.sheetNumber,
      createdAt: page.createdAt,
      updatedAt: page.updatedAt,
      metadata: page.metadata,
      contentKey,
    };
  }

  buildManifest(state) {
    const blobWrites = new Map();
    const nextPageRefs = new Map();
    const pageRef = (page, forceEncode = false) => this.pageReference(page, {
      forceEncode,
      blobWrites,
      nextPageRefs,
    });
    const manifestState = {
      schemaVersion: state.schemaVersion,
      revision: state.revision,
      updatedAt: state.updatedAt,
      nextSheetNumber: state.nextSheetNumber,
      insertedSheet: state.insertedSheet ? pageRef(state.insertedSheet, true) : null,
      looseSheet: state.looseSheet
        ? { ...state.looseSheet, page: pageRef(state.looseSheet.page) }
        : null,
      manuscript: state.manuscript.map((entry) => ({ ...entry, page: pageRef(entry.page) })),
      discards: state.discards.map((entry) => ({ ...entry, page: pageRef(entry.page) })),
    };
    return {
      serialized: createManifestEnvelope(manifestState),
      blobWrites,
      nextPageRefs,
      blobKeys: new Set([...nextPageRefs.values()].map((entry) => entry.contentKey)),
    };
  }

  removeIfEqual(key, expected) {
    try {
      if (this.storage.getItem(key) === expected) this.storage.removeItem(key);
    } catch {
      // Best-effort cleanup never invalidates a committed archive.
    }
  }

  cleanupBlobs(blobKeys) {
    for (const key of blobKeys) {
      try {
        this.storage.removeItem(key);
      } catch {
        // Unreferenced immutable blobs are harmless if cleanup is unavailable.
      }
    }
  }

  writeState(state, { skipConflict = false } = {}) {
    const validState = validatePaperLifecycleStateReference(state);
    if (!skipConflict) this.assertNoRevisionConflict(validState);
    const committedBefore = skipConflict
      ? null
      : this.bestValidRecord({ hydrate: false, includeJournal: false })?.revision ?? null;
    const previousBlobKeys = new Set(this.referencedBlobKeys);
    const manifest = this.buildManifest(validState);
    const newlyWritten = new Set();
    try {
      for (const [key, serialized] of manifest.blobWrites) {
        this.storage.setItem(key, serialized);
        newlyWritten.add(key);
        if (this.storage.getItem(key) !== serialized) throw new Error(`Page verification failed for ${key}`);
      }
    } catch (error) {
      this.cleanupBlobs([...newlyWritten].filter((key) => !previousBlobKeys.has(key)));
      throw persistenceWriteError('page-write-failed', 'Could not durably store the changed paper page', error);
    }

    try {
      this.storage.setItem(this.journalKey, manifest.serialized);
      if (this.storage.getItem(this.journalKey) !== manifest.serialized) {
        throw new Error('Journal verification failed');
      }
    } catch (error) {
      this.cleanupBlobs([...newlyWritten].filter((key) => !previousBlobKeys.has(key)));
      throw persistenceWriteError('journal-write-failed', 'Could not durably journal paper lifecycle state', error);
    }

    if (!skipConflict) {
      const committed = this.bestValidRecord({ hydrate: false, includeJournal: false });
      const committedRevision = committed?.revision ?? null;
      const baseChanged = committedRevision !== committedBefore;
      if (baseChanged || this.storage.getItem(this.journalKey) !== manifest.serialized) {
        this.removeIfEqual(this.journalKey, manifest.serialized);
        throw new PaperPersistenceError('revision-conflict', 'Paper archive changed while this revision was being saved');
      }
    }

    let primarySaved = false;
    let backupSaved = false;
    try {
      this.storage.setItem(this.key, manifest.serialized);
      primarySaved = this.storage.getItem(this.key) === manifest.serialized;
    } catch {
      primarySaved = false;
    }
    try {
      this.storage.setItem(this.backupKey, manifest.serialized);
      backupSaved = this.storage.getItem(this.backupKey) === manifest.serialized;
    } catch {
      backupSaved = false;
    }

    this.knownRevision = validState.revision;
    this.pageRefs = manifest.nextPageRefs;
    this.referencedBlobKeys = primarySaved && backupSaved
      ? new Set(manifest.blobKeys)
      : new Set([...previousBlobKeys, ...manifest.blobKeys]);

    if (primarySaved && backupSaved) {
      try {
        this.storage.removeItem(this.journalKey);
      } catch {
        // The committed copies are valid; an equal journal can be cleaned later.
      }
      this.cleanupBlobs([...previousBlobKeys].filter((key) => !manifest.blobKeys.has(key)));
      return {
        durable: true,
        journaled: false,
        revision: validState.revision,
        storageFormat: 'page-addressed-v2',
        pagesWritten: newlyWritten.size,
        manifestBytes: manifest.serialized.length,
      };
    }

    return {
      durable: true,
      journaled: true,
      revision: validState.revision,
      storageFormat: 'page-addressed-v2',
      pagesWritten: newlyWritten.size,
      manifestBytes: manifest.serialized.length,
    };
  }

  save(state) {
    return this.writeState(state);
  }

  clear() {
    const referenced = new Set(this.referencedBlobKeys);
    for (const record of this.records()) {
      for (const key of record.blobKeys ?? []) referenced.add(key);
    }
    for (const base of [this.key, ...this.legacyKeys]) {
      this.storage.removeItem(`${base}.journal`);
      this.storage.removeItem(base);
      this.storage.removeItem(`${base}.backup`);
    }
    this.cleanupBlobs(referenced);
    this.knownRevision = null;
    this.pageRefs.clear();
    this.referencedBlobKeys.clear();
  }
}

function defaultIdFactory(sheetNumber) {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `sheet-${sheetNumber}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function defaultSeedFactory() {
  return Math.floor(Math.random() * 0x7fffffff);
}

function deepFreezeJson(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreezeJson(child);
  return Object.freeze(value);
}

function truncatePreview(text, maxLength) {
  const characters = [...text];
  if (characters.length <= maxLength) return text;
  return `${characters.slice(0, Math.max(0, maxLength - 1)).join('')}…`;
}

function firstNonblankTextLine(text, maxLength) {
  const line = String(text)
    .split(/\r?\n/u)
    .map((candidate) => candidate.trim())
    .find(Boolean) ?? '';
  return truncatePreview(line, maxLength);
}

function firstNonblankMarkLine(marks, maxLength) {
  const rows = new Map();
  marks.forEach((mark, index) => {
    if (!mark || typeof mark.character !== 'string' || !mark.character) return;
    const line = Number.isSafeInteger(mark.line) && mark.line >= 0 ? mark.line : 0;
    const column = Number.isSafeInteger(mark.column) && mark.column >= 0 ? mark.column : index;
    if (!rows.has(line)) rows.set(line, new Map());
    // Later marks replace earlier marks in the same cell, matching the plain-text
    // document view while preserving the complete overstrike count separately.
    rows.get(line).set(column, mark.character);
  });

  for (const [, cells] of [...rows.entries()].sort(([a], [b]) => a - b)) {
    const columns = [...cells.keys()].sort((a, b) => a - b);
    if (!columns.length) continue;
    let text = '';
    let cursor = columns[0];
    for (const column of columns) {
      const gap = Math.max(0, Math.min(maxLength, column - cursor));
      text += ' '.repeat(gap);
      text += cells.get(column);
      cursor = column + 1;
      if ([...text].length > maxLength) break;
    }
    const preview = truncatePreview(text.trim(), maxLength);
    if (preview) return preview;
  }
  return '';
}

/**
 * Produce a compact, deterministic first-line preview from persisted paper
 * content without requiring a live TypewriterDocument instance.
 */
export function extractPaperFirstNonblankLine(content, options = {}) {
  const maxLength = options.maxLength ?? 80;
  if (!Number.isSafeInteger(maxLength) || maxLength < 1 || maxLength > 500) {
    throw new PaperLifecycleError('invalid-preview-length', 'Paper preview length must be an integer from 1 to 500');
  }
  if (typeof content === 'string') return firstNonblankTextLine(content, maxLength);
  if (!content || typeof content !== 'object') return '';
  for (const candidate of [content.plainText, content.text]) {
    if (typeof candidate === 'string') {
      const preview = firstNonblankTextLine(candidate, maxLength);
      if (preview) return preview;
    }
  }
  if (Array.isArray(content.lines)) {
    const preview = firstNonblankTextLine(content.lines.join('\n'), maxLength);
    if (preview) return preview;
  }
  return Array.isArray(content.marks)
    ? firstNonblankMarkLine(content.marks, maxLength)
    : '';
}

function createSheetRecords(state) {
  const records = [];
  if (state.insertedSheet) {
    records.push({
      location: 'loaded',
      page: state.insertedSheet,
      stateChangedAt: state.insertedSheet.updatedAt,
      details: {},
    });
  }
  if (state.looseSheet) {
    records.push({
      location: 'loose',
      page: state.looseSheet.page,
      stateChangedAt: state.looseSheet.extractedAt,
      details: {
        extractedAt: state.looseSheet.extractedAt,
        source: state.looseSheet.source,
      },
    });
  }
  state.manuscript.forEach((entry) => records.push({
    location: 'filed',
    page: entry.page,
    stateChangedAt: entry.filedAt,
    details: {
      filedAt: entry.filedAt,
      metadata: entry.metadata,
    },
  }));
  state.discards.forEach((entry) => records.push({
    location: 'discarded',
    page: entry.page,
    stateChangedAt: entry.discardedAt,
    details: {
      discardedAt: entry.discardedAt,
      crumple: entry.crumple,
    },
  }));
  return records;
}

function normalizeSheetLocations(locations = PAPER_SHEET_LOCATIONS) {
  const candidates = typeof locations === 'string' ? [locations] : locations;
  if (!Array.isArray(candidates) || candidates.some((location) => !PAPER_SHEET_LOCATIONS.includes(location))) {
    throw new PaperLifecycleError(
      'invalid-sheet-location',
      `Paper locations must be selected from: ${PAPER_SHEET_LOCATIONS.join(', ')}`,
    );
  }
  return new Set(candidates);
}

function summarizeSheetRecord(record, maxPreviewLength = 80) {
  const pageMetadata = cloneJson(record.page.metadata ?? {});
  const filingMetadata = record.location === 'filed' ? cloneJson(record.details.metadata ?? {}) : {};
  const markCount = Array.isArray(record.page.content?.marks) ? record.page.content.marks.length : 0;
  const firstNonblankLine = extractPaperFirstNonblankLine(record.page.content, {
    maxLength: maxPreviewLength,
  });
  return {
    id: record.page.id,
    sheetNumber: record.page.sheetNumber,
    location: record.location,
    createdAt: record.page.createdAt,
    updatedAt: record.page.updatedAt,
    stateChangedAt: record.stateChangedAt,
    firstNonblankLine,
    markCount,
    isBlank: !firstNonblankLine && markCount === 0,
    metadata: { ...pageMetadata, ...filingMetadata },
  };
}

/**
 * Enumerate every physical sheet without copying its potentially large mark
 * archive. Results are immutable and globally ordered by sheet number unless a
 * chronological order is explicitly requested.
 */
export function enumeratePaperSheets(rawState, options = {}) {
  const state = validatePaperLifecycleStateReference(rawState);
  const locations = normalizeSheetLocations(options.locations);
  const order = options.order ?? 'sheet-number';
  if (!['sheet-number', 'newest', 'oldest', 'physical'].includes(order)) {
    throw new PaperLifecycleError('invalid-sheet-order', 'Paper sheet order is invalid');
  }
  const maxPreviewLength = options.maxPreviewLength ?? 80;
  let records = createSheetRecords(state).filter((record) => locations.has(record.location));
  if (order === 'sheet-number') {
    records = records.sort((a, b) => a.page.sheetNumber - b.page.sheetNumber || a.page.id.localeCompare(b.page.id));
  } else if (order === 'newest') {
    records = records.sort((a, b) => b.stateChangedAt - a.stateChangedAt || b.page.sheetNumber - a.page.sheetNumber);
  } else if (order === 'oldest') {
    records = records.sort((a, b) => a.stateChangedAt - b.stateChangedAt || a.page.sheetNumber - b.page.sheetNumber);
  }
  return deepFreezeJson(records.map((record) => summarizeSheetRecord(record, maxPreviewLength)));
}

function requireSheetRecord(state, pageId) {
  if (typeof pageId !== 'string' || !pageId) {
    throw new PaperLifecycleError('invalid-page-id', 'Paper selection requires a non-empty page id');
  }
  const record = createSheetRecords(state).find((candidate) => candidate.page.id === pageId);
  if (!record) {
    throw new PaperLifecycleError('page-not-found', `Sheet ${pageId} was not found`);
  }
  return record;
}

/**
 * Select one sheet by identity for viewing or export. Selection is read-only:
 * it does not move the sheet between the platen, desk, manuscript, or basket.
 */
export function selectPaperSheet(rawState, pageId, options = {}) {
  const state = validatePaperLifecycleStateReference(rawState);
  const record = requireSheetRecord(state, pageId);
  return deepFreezeJson({
    location: record.location,
    summary: summarizeSheetRecord(record, options.maxPreviewLength ?? 80),
    page: cloneJson(record.page),
    placement: cloneJson(record.details),
  });
}

function freezeLifecycleState(state) {
  const freezePage = (page) => {
    if (!page || Object.isFrozen(page)) return page;
    deepFreezeJson(page.content);
    deepFreezeJson(page.metadata);
    return Object.freeze(page);
  };
  freezePage(state.insertedSheet);
  if (state.looseSheet) {
    freezePage(state.looseSheet.page);
    Object.freeze(state.looseSheet);
  }
  for (const entry of state.manuscript) {
    freezePage(entry.page);
    deepFreezeJson(entry.metadata);
    Object.freeze(entry);
  }
  for (const entry of state.discards) {
    freezePage(entry.page);
    deepFreezeJson(entry.crumple);
    Object.freeze(entry);
  }
  Object.freeze(state.manuscript);
  Object.freeze(state.discards);
  return Object.freeze(state);
}

function createLifecycleOverview(state) {
  const summarizePage = (page) => page && deepFreezeJson({
    id: page.id,
    sheetNumber: page.sheetNumber,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
    metadata: cloneJson(page.metadata),
  });
  const overview = {
    schemaVersion: state.schemaVersion,
    revision: state.revision,
    updatedAt: state.updatedAt,
    nextSheetNumber: state.nextSheetNumber,
    insertedSheet: summarizePage(state.insertedSheet),
    looseSheet: state.looseSheet
      ? {
        page: summarizePage(state.looseSheet.page),
        extractedAt: state.looseSheet.extractedAt,
        source: state.looseSheet.source,
      }
      : null,
    manuscript: state.manuscript.map((entry) => ({
      page: summarizePage(entry.page),
      filedAt: entry.filedAt,
      metadata: cloneJson(entry.metadata),
    })),
    discards: state.discards.map((entry) => ({
      page: summarizePage(entry.page),
      discardedAt: entry.discardedAt,
      crumple: cloneJson(entry.crumple),
    })),
    manuscriptCount: state.manuscript.length,
    discardCount: state.discards.length,
  };
  return deepFreezeJson(overview);
}

function cloneStateForCommit(state) {
  return {
    ...state,
    manuscript: [...state.manuscript],
    discards: [...state.discards],
  };
}

export class PaperLifecycle {
  static open(options = {}) {
    const stored = options.store?.load();
    const lifecycle = new PaperLifecycle({
      ...options,
      state: stored ?? createPaperLifecycleState({ updatedAt: options.now?.() ?? Date.now() }),
    });
    if (!stored && options.store) options.store.save(lifecycle.state);
    return lifecycle;
  }

  constructor(options = {}) {
    this.store = options.store ?? null;
    this.now = options.now ?? (() => Date.now());
    this.idFactory = options.idFactory ?? defaultIdFactory;
    this.seedFactory = options.seedFactory ?? defaultSeedFactory;
    this.blankSheetFactory = options.blankSheetFactory ?? (() => null);
    this.state = freezeLifecycleState(validatePaperLifecycleState(
      options.state ?? createPaperLifecycleState({ updatedAt: this.now() }),
    ));
    this.overview = createLifecycleOverview(this.state);
  }

  snapshot() {
    return cloneJson(this.state);
  }

  getOverview() {
    return this.overview;
  }

  /**
   * Return lightweight summaries for the paper-desk UI. This deliberately does
   * not expose or duplicate the full impression archive for every sheet.
   */
  listSheets(options = {}) {
    return enumeratePaperSheets(this.state, options);
  }

  getSheetSummary(pageId, options = {}) {
    const record = requireSheetRecord(this.state, pageId);
    return deepFreezeJson(summarizeSheetRecord(record, options.maxPreviewLength ?? 80));
  }

  /**
   * Select a specific sheet for preview/export without moving it physically.
   */
  selectSheet(pageId, options = {}) {
    return selectPaperSheet(this.state, pageId, options);
  }

  commit(mutator) {
    const candidate = cloneStateForCommit(this.state);
    const result = mutator(candidate);
    candidate.schemaVersion = PAPER_LIFECYCLE_SCHEMA_VERSION;
    candidate.revision = this.state.revision + 1;
    candidate.updatedAt = this.now();
    const validCandidate = freezeLifecycleState(validatePaperLifecycleStateReference(candidate));
    const persistence = this.store?.save(validCandidate) ?? { durable: false, journaled: false };
    this.state = validCandidate;
    this.overview = createLifecycleOverview(this.state);
    return { ...cloneJson(result), state: this.state, overview: this.overview, persistence };
  }

  loadFreshSheet(content, metadata = {}) {
    return this.commit((state) => {
      if (state.insertedSheet || state.looseSheet) {
        throw new PaperLifecycleError('paper-path-busy', 'Finish handling the current sheet before loading another');
      }
      const sheetNumber = state.nextSheetNumber;
      const timestamp = this.now();
      const page = {
        id: this.idFactory(sheetNumber),
        sheetNumber,
        createdAt: timestamp,
        updatedAt: timestamp,
        content: cloneJson(content === undefined ? this.blankSheetFactory(sheetNumber) : content),
        metadata: cloneJson(metadata),
      };
      state.insertedSheet = page;
      state.nextSheetNumber += 1;
      return { page };
    });
  }

  updateInsertedSheet(content, metadataPatch = {}) {
    return this.commit((state) => {
      if (!state.insertedSheet) {
        throw new PaperLifecycleError('no-inserted-sheet', 'There is no inserted sheet to update');
      }
      state.insertedSheet = {
        ...state.insertedSheet,
        content: cloneJson(content),
        metadata: {
          ...state.insertedSheet.metadata,
          ...cloneJson(metadataPatch),
        },
        updatedAt: this.now(),
      };
      return { page: state.insertedSheet };
    });
  }

  extractInsertedSheet() {
    return this.commit((state) => {
      if (!state.insertedSheet) {
        throw new PaperLifecycleError('no-inserted-sheet', 'There is no inserted sheet to extract');
      }
      const page = state.insertedSheet;
      state.insertedSheet = null;
      state.looseSheet = { page, extractedAt: this.now(), source: 'platen' };
      return { page };
    });
  }

  saveLooseSheetToManuscript(metadata = {}) {
    return this.commit((state) => {
      if (!state.looseSheet) {
        throw new PaperLifecycleError('no-loose-sheet', 'Extract a sheet before saving it to the manuscript');
      }
      const entry = {
        page: state.looseSheet.page,
        filedAt: this.now(),
        metadata: cloneJson(metadata),
      };
      state.manuscript.push(entry);
      state.looseSheet = null;
      return { entry };
    });
  }

  discardLooseSheet(options = {}) {
    return this.commit((state) => {
      if (!state.looseSheet) {
        throw new PaperLifecycleError('no-loose-sheet', 'Extract a sheet before discarding it');
      }
      const seed = options.seed ?? this.seedFactory();
      if (!Number.isSafeInteger(seed) || seed < 0) {
        throw new PaperLifecycleError('invalid-crumple-seed', 'Crumple seed must be a non-negative integer');
      }
      const entry = {
        page: state.looseSheet.page,
        discardedAt: this.now(),
        crumple: {
          seed,
          compression: options.compression ?? 1,
          landing: cloneJson(options.landing ?? null),
        },
      };
      state.discards.push(entry);
      state.looseSheet = null;
      return { entry };
    });
  }

  recoverDiscardedSheet(pageId) {
    return this.commit((state) => {
      if (state.insertedSheet || state.looseSheet) {
        throw new PaperLifecycleError('paper-path-busy', 'Clear the paper path before recovering a discarded sheet');
      }
      const index = state.discards.findIndex((entry) => entry.page.id === pageId);
      if (index === -1) {
        throw new PaperLifecycleError('discard-not-found', `Discarded sheet ${pageId} was not found`);
      }
      const [entry] = state.discards.splice(index, 1);
      state.looseSheet = { page: entry.page, extractedAt: this.now(), source: 'wastebasket' };
      return { page: entry.page, previousCrumple: entry.crumple };
    });
  }

  restoreManuscriptSheet(pageId) {
    return this.commit((state) => {
      if (state.insertedSheet || state.looseSheet) {
        throw new PaperLifecycleError('paper-path-busy', 'Clear the paper path before restoring a manuscript sheet');
      }
      const index = state.manuscript.findIndex((entry) => entry.page.id === pageId);
      if (index === -1) {
        throw new PaperLifecycleError('manuscript-page-not-found', `Manuscript sheet ${pageId} was not found`);
      }
      const [entry] = state.manuscript.splice(index, 1);
      state.looseSheet = { page: entry.page, extractedAt: this.now(), source: 'manuscript' };
      return { page: entry.page, previousMetadata: entry.metadata };
    });
  }

  reinsertLooseSheet() {
    return this.commit((state) => {
      if (state.insertedSheet) {
        throw new PaperLifecycleError('paper-path-busy', 'A sheet is already inserted');
      }
      if (!state.looseSheet) {
        throw new PaperLifecycleError('no-loose-sheet', 'There is no loose sheet to reinsert');
      }
      const page = state.looseSheet.page;
      state.looseSheet = null;
      state.insertedSheet = page;
      return { page };
    });
  }

  permanentlyEmptyWastebasket() {
    return this.commit((state) => {
      const removedCount = state.discards.length;
      state.discards = [];
      return { removedCount };
    });
  }
}
