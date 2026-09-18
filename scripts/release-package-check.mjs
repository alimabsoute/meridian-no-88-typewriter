import { createHash } from 'node:crypto';
import { access, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { BRAND } from '../src/brand.js';
import { listZipEntries } from './deterministic-zip.mjs';

const dist = path.resolve('dist');
const standalonePath = path.join(dist, BRAND.releaseArtifactFilename);
const webPackagePath = path.join(dist, BRAND.releaseWebPackageFilename);

const expectedPreviewRuntime = [
  'coming-soon/community/index.html',
  'coming-soon/community/community.css',
  'coming-soon/community/community.js',
  'coming-soon/community/assets/community-machine-specimen.svg',
  'coming-soon/writing-board/index.html',
  'coming-soon/writing-board/board.css',
  'coming-soon/writing-board/board.js',
  'coming-soon/release-manifest.json',
];
const expectedRoomMedia = ['media/philly-tv.mp4', 'media/philly-tv-standby.svg', 'media/philly-wall-art.png'];

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function hash(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

async function collectFiles(directory, prefix = '') {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await collectFiles(absolute, relative));
    else if (entry.isFile()) output.push(relative);
  }
  return output.sort();
}

for (const relative of expectedPreviewRuntime) await access(path.join(dist, relative));

const previewFiles = await collectFiles(path.join(dist, 'coming-soon'), 'coming-soon');
const forbidden = previewFiles.filter((file) => (
  file.endsWith('.png') || file.endsWith('/smoke.mjs') || file.includes('preview-desktop') || file.includes('preview-mobile')
));
invariant(!forbidden.length, `Non-runtime preview files leaked into dist: ${forbidden.join(', ')}`);

const rootContents = await readFile(path.join(dist, 'index.html'));
const standaloneContents = await readFile(standalonePath);
invariant(rootContents.equals(standaloneContents), 'The named standalone artifact differs from dist/index.html');

const archive = await readFile(webPackagePath);
const archiveEntries = listZipEntries(archive);
for (const relative of ['index.html', BRAND.releaseArtifactFilename, ...expectedPreviewRuntime, ...expectedRoomMedia]) {
  invariant(archiveEntries.includes(relative), `Web ZIP is missing ${relative}`);
}
const forbiddenArchiveEntries = archiveEntries.filter((file) => (
  (file.endsWith('.png') && !expectedRoomMedia.includes(file)) || file.endsWith('/smoke.mjs') || file === BRAND.releaseWebPackageFilename
));
invariant(!forbiddenArchiveEntries.length, `Web ZIP contains excluded files: ${forbiddenArchiveEntries.join(', ')}`);
invariant(archiveEntries.some((file) => file.endsWith('bebas-neue-latin-400-normal.woff2')), 'Bebas Neue font is missing');
invariant(archiveEntries.some((file) => file.endsWith('special-elite-latin-400-normal.woff2')), 'Special Elite font is missing');

const releaseManifest = JSON.parse(await readFile(path.join(dist, 'release-manifest.json'), 'utf8'));
invariant(releaseManifest.standalone.sha256 === hash(standaloneContents), 'Standalone checksum mismatch');
invariant(releaseManifest.webPackage.sha256 === hash(archive), 'Web-package checksum mismatch');
invariant(releaseManifest.webPackage.entries === archiveEntries.length, 'Web-package entry count mismatch');

const previewManifest = JSON.parse(await readFile(path.join(dist, 'coming-soon/release-manifest.json'), 'utf8'));
for (const route of ['coming-soon/community/', 'coming-soon/writing-board/']) {
  invariant(previewManifest.routes.includes(route), `Preview manifest is missing route ${route}`);
}
for (const file of previewManifest.files) {
  const contents = await readFile(path.join(dist, file.path));
  invariant((await stat(path.join(dist, file.path))).size === file.bytes, `Byte count mismatch for ${file.path}`);
  invariant(hash(contents) === file.sha256, `Checksum mismatch for ${file.path}`);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  standalone: BRAND.releaseArtifactFilename,
  standaloneBytes: standaloneContents.byteLength,
  previews: previewManifest.routes,
  previewRuntimeFiles: previewFiles.length,
  webPackage: BRAND.releaseWebPackageFilename,
  webPackageBytes: archive.byteLength,
  webPackageEntries: archiveEntries.length,
  releaseManifest: 'release-manifest.json',
}, null, 2)}\n`);

