/**
 * Stable product identity shared by the simulator and release tooling.
 *
 * Storage keys and the browser namespace are compatibility contracts. Change
 * them only with an explicit migration so existing manuscripts remain usable.
 */
export const BRAND = Object.freeze({
  displayName: 'Octoberline 211',
  wordmark: 'OCTOBERLINE 211',
  familyName: 'Octoberline',
  modelNumber: '211',
  identityMark: 'carbon',
  identityTagline: 'ONE ROOM · ONE PAGE',
  identityAccent: '#a95a2d',
  slug: 'octoberline-211',
  packageName: 'octoberline-211-typewriter-simulator',
  pageTitle: 'Octoberline 211 — Mechanical Typewriter',
  releaseArtifactFilename: 'Octoberline-211-Typewriter.html',
  releaseWebPackageFilename: 'Octoberline-211-Web-Experience.zip',
  sheetExportPrefix: 'octoberline-211-sheet',
  browserNamespace: '__OCTOBERLINE_211__',
  storageNamespace: 'octoberline211',
  simulatorStorageKey: 'octoberline-211-typewriter-state-v1',
  paperStorageKey: 'octoberline211.paper-lifecycle.release-1',
});

export function formatSheetExportFilename(sheetNumber, extension) {
  if (!Number.isInteger(sheetNumber) || sheetNumber < 1) {
    throw new TypeError('sheetNumber must be a positive integer');
  }

  const normalizedExtension = String(extension).trim().replace(/^\.+/, '').toLowerCase();
  if (!/^[a-z0-9]+$/.test(normalizedExtension)) {
    throw new TypeError('extension must contain only letters and numbers');
  }

  return `${BRAND.sheetExportPrefix}-${String(sheetNumber).padStart(2, '0')}.${normalizedExtension}`;
}
