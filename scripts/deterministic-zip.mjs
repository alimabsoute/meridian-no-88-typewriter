import { deflateRawSync } from 'node:zlib';

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  CRC_TABLE[index] = value >>> 0;
}

function crc32(contents) {
  let value = 0xffffffff;
  for (const byte of contents) {
    value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function localHeader({ name, checksum, compressedSize, uncompressedSize }) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4); // ZIP 2.0
  header.writeUInt16LE(0, 6); // flags
  header.writeUInt16LE(8, 8); // deflate
  header.writeUInt16LE(0, 10); // deterministic DOS time
  header.writeUInt16LE(33, 12); // 1980-01-01
  header.writeUInt32LE(checksum, 14);
  header.writeUInt32LE(compressedSize, 18);
  header.writeUInt32LE(uncompressedSize, 22);
  header.writeUInt16LE(name.byteLength, 26);
  header.writeUInt16LE(0, 28);
  return header;
}

function centralHeader({ name, checksum, compressedSize, uncompressedSize, offset }) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4); // version made by
  header.writeUInt16LE(20, 6); // version needed
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(8, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(33, 14);
  header.writeUInt32LE(checksum, 16);
  header.writeUInt32LE(compressedSize, 20);
  header.writeUInt32LE(uncompressedSize, 24);
  header.writeUInt16LE(name.byteLength, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(offset, 42);
  return header;
}

/**
 * Create a reproducible ZIP archive from in-memory files. Paths are sorted and
 * timestamps are fixed, so identical inputs produce identical bytes.
 */
export function createDeterministicZip(entries) {
  const normalized = entries
    .map((entry) => ({
      path: String(entry.path).replaceAll('\\', '/').replace(/^\/+/, ''),
      contents: Buffer.isBuffer(entry.contents) ? entry.contents : Buffer.from(entry.contents),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));

  if (!normalized.length) throw new Error('A release ZIP must contain at least one file');
  if (new Set(normalized.map((entry) => entry.path)).size !== normalized.length) {
    throw new Error('A release ZIP cannot contain duplicate paths');
  }

  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const entry of normalized) {
    if (!entry.path || entry.path.includes('..')) {
      throw new Error(`Unsafe ZIP path: ${JSON.stringify(entry.path)}`);
    }
    const name = Buffer.from(entry.path, 'utf8');
    const compressed = deflateRawSync(entry.contents, { level: 9 });
    const metadata = {
      name,
      checksum: crc32(entry.contents),
      compressedSize: compressed.byteLength,
      uncompressedSize: entry.contents.byteLength,
      offset: localOffset,
    };
    const header = localHeader(metadata);
    localParts.push(header, name, compressed);
    centralParts.push(centralHeader(metadata), name);
    localOffset += header.byteLength + name.byteLength + compressed.byteLength;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(normalized.length, 8);
  end.writeUInt16LE(normalized.length, 10);
  end.writeUInt32LE(centralDirectory.byteLength, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

export function listZipEntries(archive) {
  const contents = Buffer.isBuffer(archive) ? archive : Buffer.from(archive);
  const minimumOffset = Math.max(0, contents.byteLength - 65_557);
  let endOffset = -1;
  for (let offset = contents.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (contents.readUInt32LE(offset) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error('ZIP end-of-central-directory record not found');

  const count = contents.readUInt16LE(endOffset + 10);
  let offset = contents.readUInt32LE(endOffset + 16);
  const names = [];
  for (let index = 0; index < count; index += 1) {
    if (contents.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`Invalid ZIP central-directory record at byte ${offset}`);
    }
    const nameLength = contents.readUInt16LE(offset + 28);
    const extraLength = contents.readUInt16LE(offset + 30);
    const commentLength = contents.readUInt16LE(offset + 32);
    names.push(contents.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

