import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderUpdatesSignup } from './updates-signup-shell-plugin.mjs';

const PREVIEW_RUNTIME_FILES = Object.freeze([
  ['coming-soon/community/index.html', 'coming-soon/community/index.html'],
  ['coming-soon/community/community.css', 'coming-soon/community/community.css'],
  ['coming-soon/community/community.js', 'coming-soon/community/community.js'],
  [
    'coming-soon/community/assets/community-machine-specimen.svg',
    'coming-soon/community/assets/community-machine-specimen.svg',
  ],
  ['coming-soon/writing-board/index.html', 'coming-soon/writing-board/index.html'],
  ['coming-soon/writing-board/board.css', 'coming-soon/writing-board/board.css'],
  ['coming-soon/writing-board/board.js', 'coming-soon/writing-board/board.js'],
  [
    'node_modules/@fontsource/bebas-neue/400.css',
    'node_modules/@fontsource/bebas-neue/400.css',
  ],
  [
    'node_modules/@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff',
    'node_modules/@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff',
  ],
  [
    'node_modules/@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff2',
    'node_modules/@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff2',
  ],
  [
    'node_modules/@fontsource/bebas-neue/files/bebas-neue-latin-ext-400-normal.woff',
    'node_modules/@fontsource/bebas-neue/files/bebas-neue-latin-ext-400-normal.woff',
  ],
  [
    'node_modules/@fontsource/bebas-neue/files/bebas-neue-latin-ext-400-normal.woff2',
    'node_modules/@fontsource/bebas-neue/files/bebas-neue-latin-ext-400-normal.woff2',
  ],
  [
    'node_modules/@fontsource/special-elite/400.css',
    'node_modules/@fontsource/special-elite/400.css',
  ],
  [
    'node_modules/@fontsource/special-elite/files/special-elite-latin-400-normal.woff',
    'node_modules/@fontsource/special-elite/files/special-elite-latin-400-normal.woff',
  ],
  [
    'node_modules/@fontsource/special-elite/files/special-elite-latin-400-normal.woff2',
    'node_modules/@fontsource/special-elite/files/special-elite-latin-400-normal.woff2',
  ],
  [
    'node_modules/@fontsource/special-elite/files/special-elite-latin-ext-400-normal.woff',
    'node_modules/@fontsource/special-elite/files/special-elite-latin-ext-400-normal.woff',
  ],
  [
    'node_modules/@fontsource/special-elite/files/special-elite-latin-ext-400-normal.woff2',
    'node_modules/@fontsource/special-elite/files/special-elite-latin-ext-400-normal.woff2',
  ],
]);

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

export async function copyComingSoonPreviews({
  projectRoot = process.cwd(),
  outDir = path.join(projectRoot, 'dist'),
} = {}) {
  const comingSoonOut = path.join(outDir, 'coming-soon');
  const packagedFontOut = path.join(outDir, 'node_modules', '@fontsource');

  // Vite empties dist before every build. Removing these exact generated
  // subtrees also keeps direct script runs deterministic without risking any
  // other release artifacts.
  await rm(comingSoonOut, { recursive: true, force: true });
  await rm(packagedFontOut, { recursive: true, force: true });

  const files = [];
  for (const [sourceRelative, destinationRelative] of PREVIEW_RUNTIME_FILES) {
    const source = path.join(projectRoot, sourceRelative);
    const destination = path.join(outDir, destinationRelative);
    await stat(source);
    await mkdir(path.dirname(destination), { recursive: true });
    if (sourceRelative.endsWith('/index.html')) {
      await writeFile(destination, await renderUpdatesSignup(await readFile(source, 'utf8')), 'utf8');
    } else {
      await copyFile(source, destination);
    }

    const contents = await readFile(destination);
    files.push({
      path: destinationRelative.replaceAll('\\', '/'),
      bytes: contents.byteLength,
      sha256: sha256(contents),
    });
  }

  files.sort((left, right) => left.path.localeCompare(right.path));
  const manifest = {
    schemaVersion: 1,
    kind: 'octoberline-coming-soon-runtime',
    routes: [
      'coming-soon/community/',
      'coming-soon/writing-board/',
    ],
    files,
  };
  const manifestPath = path.join(comingSoonOut, 'release-manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return {
    ok: true,
    outDir,
    manifest: manifestPath,
    files: files.length,
  };
}

export function comingSoonPreviewsPlugin(options = {}) {
  return {
    name: 'octoberline-coming-soon-previews',
    apply: 'build',
    async closeBundle() {
      await copyComingSoonPreviews(options);
    },
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  const result = await copyComingSoonPreviews({
    projectRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

