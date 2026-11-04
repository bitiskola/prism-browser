'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getSystemCursorInfo, parseXcursor, parseCurFile, makePngFromRgba, FALLBACK_SVGS } = require('../electron/cursor-theme.cjs');

test('makePngFromRgba produces a valid PNG with correct dimensions', () => {
  const width = 4;
  const height = 4;
  const rgba = Buffer.alloc(width * height * 4, 255); // Solid white
  const png = makePngFromRgba(width, height, rgba);

  assert.ok(Buffer.isBuffer(png));
  assert.equal(png.slice(0, 8).toString('hex'), '89504e470d0a1a0a', 'PNG signature matches');
  assert.equal(png.readUInt32BE(16), width, 'IHDR width matches');
  assert.equal(png.readUInt32BE(20), height, 'IHDR height matches');
  assert.equal(png[24], 8, '8-bit depth');
  assert.equal(png[25], 6, 'RGBA color type');
});

test('parseXcursor parses X11 cursor data correctly', () => {
  // Mock an Xcursor buffer: 16 bytes header + 1 TOC (12 bytes) + 1 image chunk (36 bytes + pixels)
  const width = 2;
  const height = 2;
  const xhot = 1;
  const yhot = 1;
  const pixelBytes = width * height * 4;

  const header = Buffer.alloc(16);
  header.write('Xcur', 0, 4, 'ascii');
  header.writeUInt32LE(16, 4);
  header.writeUInt32LE(1, 8);
  header.writeUInt32LE(1, 12); // 1 TOC entry

  const toc = Buffer.alloc(12);
  toc.writeUInt32LE(0xfffd0002, 0); // Image type
  toc.writeUInt32LE(24, 4);         // Subtype (nominal size)
  toc.writeUInt32LE(28, 8);         // Offset (16 + 12 = 28)

  const chunkHeader = Buffer.alloc(36);
  chunkHeader.writeUInt32LE(36, 0);
  chunkHeader.writeUInt32LE(0xfffd0002, 4);
  chunkHeader.writeUInt32LE(24, 8);
  chunkHeader.writeUInt32LE(1, 12);
  chunkHeader.writeUInt32LE(width, 16);
  chunkHeader.writeUInt32LE(height, 20);
  chunkHeader.writeUInt32LE(xhot, 24);
  chunkHeader.writeUInt32LE(yhot, 28);
  chunkHeader.writeUInt32LE(50, 32);

  const pixels = Buffer.alloc(pixelBytes, 128);
  const buf = Buffer.concat([header, toc, chunkHeader, pixels]);

  const parsed = parseXcursor(buf, 24);
  assert.ok(parsed, 'parsed successfully');
  assert.equal(parsed.width, 2);
  assert.equal(parsed.height, 2);
  assert.equal(parsed.xhot, 1);
  assert.equal(parsed.yhot, 1);
  assert.ok(parsed.dataUrl.startsWith('data:image/png;base64,'));
});

test('parseCurFile parses Windows .cur format correctly', () => {
  // Mock a .cur buffer: 6 bytes header + 1 entry (16 bytes) + 40 bytes DIB header + pixels
  const width = 2;
  const height = 2;
  const xhot = 0;
  const yhot = 0;

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(2, 2); // 2 = Cursor
  header.writeUInt16LE(1, 4); // 1 icon

  const entry = Buffer.alloc(16);
  entry[0] = width;
  entry[1] = height;
  entry.writeUInt16LE(xhot, 4);
  entry.writeUInt16LE(yhot, 6);
  entry.writeUInt32LE(40 + width * height * 4, 8); // Size
  entry.writeUInt32LE(22, 12); // Offset (6 + 16 = 22)

  const dibHeader = Buffer.alloc(40);
  dibHeader.writeUInt32LE(40, 0); // biSize
  dibHeader.writeInt32LE(width, 4);
  dibHeader.writeInt32LE(height * 2, 8); // In ICO/CUR biHeight is 2 * height
  dibHeader.writeUInt16LE(1, 12);
  dibHeader.writeUInt16LE(32, 14); // 32-bit BGRA

  const pixels = Buffer.alloc(width * height * 4, 200);
  const curBuf = Buffer.concat([header, entry, dibHeader, pixels]);

  const parsed = parseCurFile(curBuf, 2);
  assert.ok(parsed, 'parsed .cur successfully');
  assert.equal(parsed.width, 2);
  assert.equal(parsed.height, 2);
  assert.equal(parsed.xhot, 0);
  assert.equal(parsed.yhot, 0);
  assert.ok(parsed.dataUrl.startsWith('data:image/png;base64,'));
});

test('getSystemCursorInfo returns valid cursor for current platform', () => {
  const info = getSystemCursorInfo();
  assert.ok(info, 'returns info');
  assert.ok(typeof info.width === 'number' && info.width > 0);
  assert.ok(typeof info.height === 'number' && info.height > 0);
  assert.ok(typeof info.xhot === 'number');
  assert.ok(typeof info.yhot === 'number');
  assert.ok(info.dataUrl && (info.dataUrl.startsWith('data:image/png;base64,') || info.dataUrl.startsWith('data:image/svg+xml;')));
});

test('FALLBACK_SVGS definitions contain valid SVGs for linux, win32, and darwin', () => {
  for (const plat of ['linux', 'win32', 'darwin']) {
    const fb = FALLBACK_SVGS[plat];
    assert.ok(fb);
    assert.equal(fb.width, 24);
    assert.equal(fb.height, 24);
    assert.ok(fb.dataUrl.includes('data:image/svg+xml;'));
  }
});
