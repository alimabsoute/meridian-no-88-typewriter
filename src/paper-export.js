export const PAPER_EXPORT_BASE_WIDTH = 1280;
export const PAPER_EXPORT_BASE_HEIGHT = 1656;
export const PAPER_EXPORT_PAGE = Object.freeze({
  size: 'Letter',
  orientation: 'portrait',
  widthInches: 8.5,
  heightInches: 11,
});
export const PAPER_EXPORT_APPEARANCES = Object.freeze(['original', 'carbon-copy']);
export const PAPER_EXPORT_MIME_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp']);

function assertPlainOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Paper export options must be an object');
  }
}

function freezeDescriptor(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freezeDescriptor);
  return Object.freeze(value);
}

export function normalizePaperExportOptions(options = {}) {
  assertPlainOptions(options);
  const resolutionScale = options.resolutionScale ?? 1;
  const appearance = options.appearance ?? 'original';
  const mimeType = options.mimeType ?? 'image/png';
  const quality = options.quality ?? 0.92;
  if (!Number.isFinite(resolutionScale) || resolutionScale < 1 || resolutionScale > 4) {
    throw new RangeError('Paper export resolutionScale must be between 1 and 4');
  }
  if (!PAPER_EXPORT_APPEARANCES.includes(appearance)) {
    throw new RangeError(`Paper export appearance must be one of: ${PAPER_EXPORT_APPEARANCES.join(', ')}`);
  }
  if (!PAPER_EXPORT_MIME_TYPES.includes(mimeType)) {
    throw new RangeError(`Paper export mimeType must be one of: ${PAPER_EXPORT_MIME_TYPES.join(', ')}`);
  }
  if (!Number.isFinite(quality) || quality < 0 || quality > 1) {
    throw new RangeError('Paper export quality must be between 0 and 1');
  }
  return Object.freeze({ resolutionScale, appearance, mimeType, quality });
}

export function getPaperExportDimensions(options = {}) {
  const normalized = normalizePaperExportOptions(options);
  const width = Math.round(PAPER_EXPORT_BASE_WIDTH * normalized.resolutionScale);
  const height = Math.round(PAPER_EXPORT_BASE_HEIGHT * normalized.resolutionScale);
  return Object.freeze({
    width,
    height,
    approximateDpi: Math.round(width / PAPER_EXPORT_PAGE.widthInches),
  });
}

function normalizePrintTitle(value) {
  const title = typeof value === 'string' ? value.trim() : '';
  return title || 'Octoberline 211 — Typewritten page';
}

/**
 * Create a dependency-free payload that a browser print view can consume.
 * This is intentionally identified as browser print rather than claiming to be
 * a generated PDF; the user chooses PDF or a physical printer in the native
 * print dialog.
 */
export function createBrowserPrintPayload(imageDataUrl, options = {}) {
  const imageTypeMatch = typeof imageDataUrl === 'string'
    ? /^data:(image\/(?:png|jpeg|webp))[;,]/u.exec(imageDataUrl)
    : null;
  if (!imageTypeMatch) {
    throw new TypeError('Browser print payload requires an image data URL');
  }
  assertPlainOptions(options);
  const normalized = normalizePaperExportOptions({
    ...options,
    resolutionScale: options.resolutionScale ?? 2,
    mimeType: options.mimeType ?? imageTypeMatch[1],
  });
  if (normalized.mimeType !== imageTypeMatch[1]) {
    throw new TypeError('Browser print payload mimeType must match its image data URL');
  }
  const dimensions = getPaperExportDimensions(normalized);
  return freezeDescriptor({
    format: 'octoberline211-browser-print-v1',
    title: normalizePrintTitle(options.title),
    imageDataUrl,
    image: {
      width: dimensions.width,
      height: dimensions.height,
      mimeType: normalized.mimeType,
      appearance: normalized.appearance,
      approximateDpi: dimensions.approximateDpi,
    },
    page: { ...PAPER_EXPORT_PAGE },
    cssText: [
      '@page { size: Letter portrait; margin: 0; }',
      'html, body { width: 8.5in; min-height: 11in; margin: 0; background: #fff; }',
      'img { display: block; width: 8.5in; height: 11in; object-fit: fill; }',
    ].join('\n'),
  });
}
