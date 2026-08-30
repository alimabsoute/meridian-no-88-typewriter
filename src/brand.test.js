import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BRAND, formatSheetExportFilename } from './brand.js';

const packageMetadata = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

describe('Octoberline 211 brand metadata', () => {
  it('keeps user-facing and machine-facing names aligned', () => {
    expect(BRAND).toMatchObject({
      displayName: 'Octoberline 211',
      wordmark: 'OCTOBERLINE 211',
      familyName: 'Octoberline',
      modelNumber: '211',
      identityMark: 'carbon',
      identityTagline: 'ONE ROOM · ONE PAGE',
      identityAccent: '#a95a2d',
      slug: 'octoberline-211',
      packageName: 'octoberline-211-typewriter-simulator',
      releaseArtifactFilename: 'Octoberline-211-Typewriter.html',
      releaseWebPackageFilename: 'Octoberline-211-Web-Experience.zip',
    });
    expect(BRAND.displayName).toBe(`${BRAND.familyName} ${BRAND.modelNumber}`);
    expect(BRAND.packageName.startsWith(BRAND.slug)).toBe(true);
    expect(packageMetadata.name).toBe(BRAND.packageName);
    expect(Object.isFrozen(BRAND)).toBe(true);
  });

  it('preserves storage and browser compatibility contracts', () => {
    expect(BRAND.browserNamespace).toBe('__OCTOBERLINE_211__');
    expect(BRAND.simulatorStorageKey).toBe('octoberline-211-typewriter-state-v1');
    expect(BRAND.paperStorageKey).toBe('octoberline211.paper-lifecycle.release-1');
  });

  it('formats predictable sheet export names', () => {
    expect(formatSheetExportFilename(1, 'TXT')).toBe('octoberline-211-sheet-01.txt');
    expect(formatSheetExportFilename(27, '.png')).toBe('octoberline-211-sheet-27.png');
    expect(() => formatSheetExportFilename(0, 'txt')).toThrow(TypeError);
    expect(() => formatSheetExportFilename(1, '../txt')).toThrow(TypeError);
  });
});
