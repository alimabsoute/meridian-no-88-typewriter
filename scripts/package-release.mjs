import { copyFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = path.resolve('dist/index.html');
const destination = path.resolve('dist/Meridian-No-88-Typewriter.html');

await stat(source);
await copyFile(source, destination);
const contents = await readFile(destination);
const sha256 = createHash('sha256').update(contents).digest('hex');

process.stdout.write(`${JSON.stringify({
  ok: true,
  source,
  artifact: destination,
  bytes: contents.byteLength,
  sha256,
}, null, 2)}\n`);
