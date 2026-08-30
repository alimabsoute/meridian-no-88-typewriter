export const DEFAULT_COLUMNS = 65;
export const DEFAULT_LINES = 46;
export const DEFAULT_TAB_WIDTH = 8;

function assertPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer`);
  }
}

function assertMargin(value, label) {
  if (!Number.isInteger(value)) throw new TypeError(`${label} must be an integer`);
}

function defaultTabStops(columns, width = DEFAULT_TAB_WIDTH) {
  const stops = [];
  for (let column = width; column < columns; column += width) stops.push(column);
  return stops;
}

/**
 * Logical paper state. Marks are immutable impression records so overstrikes,
 * ink variation, and high-resolution re-rendering stay deterministic.
 */
export class TypewriterDocument {
  constructor(options = {}) {
    this.columns = options.columns ?? DEFAULT_COLUMNS;
    this.lines = options.lines ?? DEFAULT_LINES;
    assertPositiveInteger(this.columns, 'Columns');
    assertPositiveInteger(this.lines, 'Lines');

    const leftMargin = options.leftMargin ?? 0;
    const rightMargin = options.rightMargin ?? this.columns;
    this.validateMargins(leftMargin, rightMargin);
    this.leftMargin = leftMargin;
    this.rightMargin = rightMargin;
    this.bellDistance = options.bellDistance ?? 5;
    this.lineSpacing = options.lineSpacing ?? 1;
    this.sheetNumber = options.sheetNumber ?? 1;
    this.column = this.leftMargin;
    this.line = 0;
    this.marks = [];
    this.bellRungForLine = false;
    this._tabStops = [];
    this.setTabStops(options.tabStops ?? defaultTabStops(this.columns));
  }

  get atMargin() {
    return this.column >= this.rightMargin;
  }

  get isFull() {
    return this.line >= this.lines;
  }

  get remainingColumns() {
    return Math.max(0, this.rightMargin - this.column);
  }

  get tabStops() {
    return [...this._tabStops];
  }

  validateMargins(leftMargin, rightMargin) {
    assertMargin(leftMargin, 'Left margin');
    assertMargin(rightMargin, 'Right margin');
    if (leftMargin < 0 || leftMargin >= this.columns) {
      throw new RangeError(`Left margin must be between 0 and ${this.columns - 1}`);
    }
    if (rightMargin <= 0 || rightMargin > this.columns) {
      throw new RangeError(`Right margin must be between 1 and ${this.columns}`);
    }
    if (leftMargin >= rightMargin) throw new RangeError('Left margin must be before right margin');
  }

  setMargins(leftMargin, rightMargin) {
    this.validateMargins(leftMargin, rightMargin);
    const previous = {
      leftMargin: this.leftMargin,
      rightMargin: this.rightMargin,
      column: this.column,
    };
    this.leftMargin = leftMargin;
    this.rightMargin = rightMargin;
    this.column = Math.max(leftMargin, Math.min(rightMargin, this.column));
    this.bellRungForLine = this.column >= this.bellThreshold;
    return {
      ...this.getMargins(),
      previous,
      column: this.column,
      columnAdjusted: previous.column !== this.column,
    };
  }

  setLeftMargin(leftMargin) {
    return this.setMargins(leftMargin, this.rightMargin);
  }

  setRightMargin(rightMargin) {
    return this.setMargins(this.leftMargin, rightMargin);
  }

  getMargins() {
    return { leftMargin: this.leftMargin, rightMargin: this.rightMargin };
  }

  get bellThreshold() {
    return Math.max(this.leftMargin, this.rightMargin - this.bellDistance);
  }

  setTabStops(stops) {
    if (!Array.isArray(stops)) throw new TypeError('Tab stops must be an array');
    const normalized = stops.map((column) => {
      if (!Number.isInteger(column)) throw new TypeError('Every tab stop must be an integer');
      if (column <= 0 || column > this.columns) {
        throw new RangeError(`Tab stops must be between 1 and ${this.columns}`);
      }
      return column;
    });
    this._tabStops = [...new Set(normalized)].sort((a, b) => a - b);
    return this.tabStops;
  }

  setTabStop(column, enabled = true) {
    if (!Number.isInteger(column)) throw new TypeError('Tab stop must be an integer');
    if (column <= 0 || column > this.columns) {
      throw new RangeError(`Tab stop must be between 1 and ${this.columns}`);
    }
    const stops = new Set(this._tabStops);
    if (enabled) stops.add(column);
    else stops.delete(column);
    return this.setTabStops([...stops]);
  }

  clearTabStops() {
    this._tabStops = [];
    return this.tabStops;
  }

  resetTabStops(width = DEFAULT_TAB_WIDTH) {
    assertPositiveInteger(width, 'Tab width');
    return this.setTabStops(defaultTabStops(this.columns, width));
  }

  type(character, metadata = {}, marginReleased = false) {
    if (typeof character !== 'string' || [...character].length !== 1) {
      return { accepted: false, reason: 'unsupported' };
    }
    if (this.isFull) return { accepted: false, reason: 'paper-end' };
    if (this.atMargin && !marginReleased) return { accepted: false, reason: 'margin' };

    const impression = {
      character,
      column: this.column,
      line: this.line,
      ink: metadata.ink ?? 'black',
      force: metadata.force ?? 0.72,
      seed: metadata.seed ?? Math.floor(Math.random() * 0x7fffffff),
      timestamp: metadata.timestamp ?? Date.now(),
    };

    this.marks.push(impression);
    const advance = this.advance(marginReleased);
    return { accepted: true, impression, ...advance };
  }

  space(marginReleased = false) {
    if (this.isFull) return { accepted: false, reason: 'paper-end' };
    if (this.atMargin && !marginReleased) return { accepted: false, reason: 'margin' };
    return { accepted: true, ...this.advance(marginReleased) };
  }

  advance(marginReleased = false) {
    const previousColumn = this.column;
    this.column += 1;
    const bell = !this.bellRungForLine
      && previousColumn < this.bellThreshold
      && this.column >= this.bellThreshold;
    if (bell) this.bellRungForLine = true;
    return {
      bell,
      column: this.column,
      line: this.line,
      marginReached: this.column >= this.rightMargin && !marginReleased,
    };
  }

  backspace() {
    const previous = this.column;
    this.column = Math.max(this.leftMargin, this.column - 1);
    return { moved: previous !== this.column, column: this.column, line: this.line };
  }

  carriageReturn() {
    const previousColumn = this.column;
    this.column = this.leftMargin;
    this.line += this.lineSpacing;
    this.bellRungForLine = false;
    return {
      previousColumn,
      column: this.column,
      line: this.line,
      paperEnd: this.isFull,
    };
  }

  tab(tabWidth = null, marginReleased = false) {
    if (this.atMargin && !marginReleased) return { accepted: false, reason: 'margin' };
    let next;
    if (tabWidth === null || tabWidth === undefined) {
      next = this._tabStops.find((column) => column > this.column);
    } else {
      assertPositiveInteger(tabWidth, 'Tab width');
      next = Math.ceil((this.column + 1) / tabWidth) * tabWidth;
    }
    const limit = marginReleased ? this.columns + 5 : this.rightMargin;
    const previousColumn = this.column;
    const target = next ?? limit;
    this.column = Math.min(target, limit);
    const crossedBell = previousColumn < this.bellThreshold
      && this.column >= this.bellThreshold
      && !this.bellRungForLine;
    if (crossedBell) this.bellRungForLine = true;
    return {
      accepted: true,
      previousColumn,
      column: this.column,
      line: this.line,
      tabStop: next !== undefined && next <= limit ? next : null,
      bell: crossedBell,
      marginReached: this.column >= this.rightMargin && !marginReleased,
    };
  }

  setLineSpacing(spacing) {
    if (![1, 2, 3].includes(spacing)) throw new Error('Line spacing must be 1, 2, or 3');
    this.lineSpacing = spacing;
  }

  toPlainText() {
    if (!this.marks.length) return '';
    const maxLine = Math.max(this.line, ...this.marks.map((mark) => mark.line));
    const rows = Array.from({ length: maxLine + 1 }, () => []);
    for (const mark of this.marks) {
      rows[mark.line][mark.column] = mark.character;
    }
    return rows
      .map((row) => {
        let text = '';
        const last = row.reduce((index, value, i) => (value !== undefined ? i : index), -1);
        for (let i = 0; i <= last; i += 1) text += row[i] ?? ' ';
        return text;
      })
      .join('\n')
      .replace(/\s+$/u, '');
  }

  serialize() {
    return {
      columns: this.columns,
      lines: this.lines,
      leftMargin: this.leftMargin,
      rightMargin: this.rightMargin,
      tabStops: this.tabStops,
      bellDistance: this.bellDistance,
      lineSpacing: this.lineSpacing,
      sheetNumber: this.sheetNumber,
      column: this.column,
      line: this.line,
      marks: this.marks,
      bellRungForLine: this.bellRungForLine,
    };
  }

  static deserialize(payload) {
    const source = payload && typeof payload === 'object' ? payload : {};
    const document = new TypewriterDocument(source);
    document.column = Math.max(
      document.leftMargin,
      Math.min(document.columns + 5, Number.isFinite(source.column) ? source.column : document.leftMargin),
    );
    document.line = Number.isFinite(source.line) ? Math.max(0, source.line) : 0;
    document.marks = Array.isArray(source.marks) ? source.marks : [];
    document.bellRungForLine = Boolean(source.bellRungForLine);
    return document;
  }
}
