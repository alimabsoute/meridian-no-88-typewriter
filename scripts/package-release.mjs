import { copyFile, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { BRAND } from '../src/brand.js';
import { createDeterministicZip } from './deterministic-zip.mjs';

const source = path.resolve('dist/index.html');
const destination = path.resolve('dist', BRAND.releaseArtifactFilename);
const webPackage = path.resolve('dist', BRAND.releaseWebPackageFilename);
const releaseManifest = path.resolve('dist/release-manifest.json');

async function collectRuntimeFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectRuntimeFiles(absolute, relative));
    } else if (entry.isFile()) {
      files.push({ path: relative, contents: await readFile(absolute) });
    }
  }
  return files;
}

await stat(source);
await rm(webPackage, { force: true });
await rm(releaseManifest, { force: true });
await copyFile(source, destination);
const contents = await readFile(destination);
const sha256 = createHash('sha256').update(contents).digest('hex');

const packagedDirectories = [
  ['coming-soon', path.resolve('dist/coming-soon')],
  ['node_modules', path.resolve('dist/node_modules')],
];
const webEntries = [
  { path: 'index.html', contents: await readFile(source) },
  { path: BRAND.releaseArtifactFilename, contents },
];
for (const [prefix, directory] of packagedDirectories) {
  await stat(directory);
  webEntries.push(...await collectRuntimeFiles(directory, prefix));
}

const archive = createDeterministicZip(webEntries);
await writeFile(webPackage, archive);
const webPackageSha256 = createHash('sha256').update(archive).digest('hex');
const manifest = {
  schemaVersion: 1,
  product: BRAND.displayName,
  standalone: {
    path: BRAND.releaseArtifactFilename,
    bytes: contents.byteLength,
    sha256,
  },
  webPackage: {
    path: BRAND.releaseWebPackageFilename,
    bytes: archive.byteLength,
    sha256: webPackageSha256,
    entries: webEntries.length,
  },
  previewRoutes: [
    'coming-soon/community/',
    'coming-soon/writing-board/',
  ],
};
await writeFile(releaseManifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

process.stdout.write(`${JSON.stringify({
  ok: true,
  source,
  artifact: destination,
  bytes: contents.byteLength,
  sha256,
  webPackage,
  webPackageBytes: archive.byteLength,
  webPackageSha256,
  webPackageEntries: webEntries.length,
  releaseManifest,
}, null, 2)}\n`);
