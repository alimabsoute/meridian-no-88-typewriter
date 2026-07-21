export const DEFAULT_COLUMNS = 65;
export const DEFAULT_LINES = 46;

/**
 * Logical paper state. Marks are immutable impression records so overstrikes,
 * ink variation, and high-resolution re-rendering stay deterministic.
 */
export class TypewriterDocument {
  constructor(options = {}) {
    this.columns = options.columns ?? DEFAULT_COLUMNS;
    this.lines = options.lines ?? DEFAULT_LINES;
    this.leftMargin = options.leftMargin ?? 0;
    this.rightMargin = options.rightMargin ?? this.columns;
    this.bellDistance = options.bellDistance ?? 5;
    this.lineSpacing = options.lineSpacing ?? 1;
    this.sheetNumber = options.sheetNumber ?? 1;
    this.column = this.leftMargin;
    this.line = 0;
    this.marks = [];
    this.bellRungForLine = false;
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
    this.column += 1;
    const bellThreshold = this.rightMargin - this.bellDistance;
    const bell = !this.bellRungForLine && this.column === bellThreshold;
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

  tab(tabWidth = 8, marginReleased = false) {
    if (this.atMargin && !marginReleased) return { accepted: false, reason: 'margin' };
    const next = Math.ceil((this.column + 1) / tabWidth) * tabWidth;
    const limit = marginReleased ? this.columns + 5 : this.rightMargin;
    const previousColumn = this.column;
    this.column = Math.min(next, limit);
    const bellThreshold = this.rightMargin - this.bellDistance;
    const crossedBell = previousColumn < bellThreshold && this.column >= bellThreshold && !this.bellRungForLine;
    if (crossedBell) this.bellRungForLine = true;
    return {
      accepted: true,
      previousColumn,
      column: this.column,
      line: this.line,
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
    const document = new TypewriterDocument(payload);
    document.column = payload.column ?? document.leftMargin;
    document.line = payload.line ?? 0;
    document.marks = Array.isArray(payload.marks) ? payload.marks : [];
    document.bellRungForLine = Boolean(payload.bellRungForLine);
    return document;
  }
}
