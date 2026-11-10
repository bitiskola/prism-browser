'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

function makePngFromRgba(width, height, rgbaBuf) {
  const scanlineLen = 1 + width * 4;
  const rawData = Buffer.alloc(height * scanlineLen);

  for (let y = 0; y < height; y++) {
    const rowStart = y * scanlineLen;
    rawData[rowStart] = 0; // Filter type: None
    rgbaBuf.copy(rawData, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  const deflated = zlib.deflateSync(rawData);

  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let k = 0; k < 8; k++) {
        c = (c >>> 1) ^ (-(c & 1) & 0xedb88320);
      }
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    const chunkData = Buffer.concat([typeBuf, data]);
    crcBuf.writeUInt32BE(crc32(chunkData), 0);
    return Buffer.concat([len, chunkData, crcBuf]);
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // 8 bits per channel
  ihdr[9] = 6;  // Color type 6: RGBA
  ihdr[10] = 0; // Compression
  ihdr[11] = 0; // Filter
  ihdr[12] = 0; // Interlace

  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', deflated),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

function parseXcursor(fileBuf, desiredSize = 24) {
  if (!fileBuf || fileBuf.length < 16) return null;
  const magic = fileBuf.toString('ascii', 0, 4);
  if (magic !== 'Xcur') return null;

  const ntoc = fileBuf.readUInt32LE(12);
  let bestChunk = null;
  let bestDiff = Infinity;
  let bestNominal = 0;

  for (let i = 0; i < ntoc; i++) {
    const type = fileBuf.readUInt32LE(16 + i * 12);
    const subtype = fileBuf.readUInt32LE(20 + i * 12);
    const pos = fileBuf.readUInt32LE(24 + i * 12);

    if (type === 0xfffd0002) { // Image chunk
      const diff = Math.abs(subtype - desiredSize);
      // On a tie prefer the larger image: downscaling stays sharp.
      if (diff < bestDiff || (diff === bestDiff && subtype > bestNominal)) {
        bestDiff = diff;
        bestChunk = pos;
        bestNominal = subtype;
      }
    }
  }

  if (bestChunk === null || bestChunk + 36 > fileBuf.length) return null;

  const width = fileBuf.readUInt32LE(bestChunk + 16);
  const height = fileBuf.readUInt32LE(bestChunk + 20);
  const xhot = fileBuf.readUInt32LE(bestChunk + 24);
  const yhot = fileBuf.readUInt32LE(bestChunk + 28);

  const pixelDataOffset = bestChunk + 36;
  const pixelBytes = width * height * 4;
  if (pixelDataOffset + pixelBytes > fileBuf.length) return null;

  // Xcursor stores 32-bit ARGB pixels (B, G, R, A)
  const rgba = Buffer.alloc(pixelBytes);
  for (let i = 0; i < width * height; i++) {
    const src = pixelDataOffset + i * 4;
    const dst = i * 4;
    const b = fileBuf[src];
    const g = fileBuf[src + 1];
    const r = fileBuf[src + 2];
    const a = fileBuf[src + 3];
    rgba[dst] = r;
    rgba[dst + 1] = g;
    rgba[dst + 2] = b;
    rgba[dst + 3] = a;
  }

  const png = makePngFromRgba(width, height, rgba);
  return {
    width,
    height,
    xhot,
    yhot,
    nominal: bestNominal,
    dataUrl: 'data:image/png;base64,' + png.toString('base64')
  };
}

function parseCurFile(fileBuf, desiredSize = 24) {
  if (!fileBuf || fileBuf.length < 22) return null;
  if (fileBuf.readUInt16LE(2) !== 2) return null; // 2 = CURSOR
  const count = fileBuf.readUInt16LE(4);
  if (count <= 0) return null;

  let bestEntry = null;
  let bestDiff = Infinity;

  for (let i = 0; i < count; i++) {
    const o = 6 + i * 16;
    if (o + 16 > fileBuf.length) break;
    const w = fileBuf[o] || 256;
    const h = fileBuf[o + 1] || 256;
    const xhot = fileBuf.readUInt16LE(o + 4);
    const yhot = fileBuf.readUInt16LE(o + 6);
    const size = fileBuf.readUInt32LE(o + 8);
    const offset = fileBuf.readUInt32LE(o + 12);

    const diff = Math.abs(w - desiredSize);
    if (diff < bestDiff || (diff === bestDiff && bestEntry && w > bestEntry.w)) {
      bestDiff = diff;
      bestEntry = { w, h, xhot, yhot, size, offset };
    }
  }

  if (!bestEntry || bestEntry.offset + bestEntry.size > fileBuf.length) return null;

  const data = fileBuf.slice(bestEntry.offset, bestEntry.offset + bestEntry.size);
  // Check if raw PNG inside .cur
  if (data.length > 8 && data.slice(0, 8).toString('hex') === '89504e470d0a1a0a') {
    return {
      width: bestEntry.w,
      height: bestEntry.h,
      xhot: bestEntry.xhot,
      yhot: bestEntry.yhot,
      dataUrl: 'data:image/png;base64,' + data.toString('base64')
    };
  }

  // DIB format
  if (data.length >= 40 && data.readUInt32LE(0) === 40) {
    const biWidth = data.readInt32LE(4);
    const biHeight = Math.floor(data.readInt32LE(8) / 2);
    const biBitCount = data.readUInt16LE(14);
    if (biBitCount === 32 && biWidth > 0 && biHeight > 0) {
      const pixelOffset = 40;
      const pixelBytes = biWidth * biHeight * 4;
      if (pixelOffset + pixelBytes <= data.length) {
        const rgba = Buffer.alloc(pixelBytes);
        for (let y = 0; y < biHeight; y++) {
          const dibY = biHeight - 1 - y; // Bottom-up
          for (let x = 0; x < biWidth; x++) {
            const src = pixelOffset + (dibY * biWidth + x) * 4;
            const dst = (y * biWidth + x) * 4;
            rgba[dst] = data[src + 2];     // R
            rgba[dst + 1] = data[src + 1]; // G
            rgba[dst + 2] = data[src];     // B
            rgba[dst + 3] = data[src + 3]; // A
          }
        }
        const png = makePngFromRgba(biWidth, biHeight, rgba);
        return {
          width: biWidth,
          height: biHeight,
          xhot: bestEntry.xhot,
          yhot: bestEntry.yhot,
          dataUrl: 'data:image/png;base64,' + png.toString('base64')
        };
      }
    }
  }

  return null;
}

const FALLBACK_SVGS = {
  linux: {
    width: 24,
    height: 24,
    xhot: 4,
    yhot: 4,
    dataUrl: 'data:image/svg+xml;utf8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
      '<path d="M4 4 L4 20 L8.5 15.5 L12.5 23 L15.5 21.5 L11.5 14 L17.5 14 Z" fill="#2d2d2d" stroke="#ffffff" stroke-width="1.8" stroke-linejoin="round"/>' +
      '</svg>'
    )
  },
  win32: {
    width: 24,
    height: 24,
    xhot: 0,
    yhot: 0,
    dataUrl: 'data:image/svg+xml;utf8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
      '<path d="M0 0 L0 18 L4.5 13.5 L8.5 21 L11.5 19.5 L7.5 12 L13.5 12 Z" fill="#ffffff" stroke="#000000" stroke-width="1.5" stroke-linejoin="round"/>' +
      '</svg>'
    )
  },
  darwin: {
    width: 24,
    height: 24,
    xhot: 2,
    yhot: 2,
    dataUrl: 'data:image/svg+xml;utf8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
      '<path d="M2 2 L2 19 L6.8 14.2 L10.8 22 L13.6 20.6 L9.6 12.8 L15.6 12.8 Z" fill="#1e1e1e" stroke="#ffffff" stroke-width="1.8" stroke-linejoin="round"/>' +
      '</svg>'
    )
  }
};

// Cursor metrics returned to callers are in DIPs (device-independent pixels),
// the unit the OS uses for its own pointer size and the unit the screencast
// overlay converts into page CSS pixels. Images are picked at the display's
// physical resolution so they stay sharp at fractional/HiDPI scales.
// Maps image pixels to DIPs: `dipSize` DIPs per `physicalWidth` image pixels.
function toDips(parsed, dipSize, physicalWidth) {
  const k = dipSize / physicalWidth;
  return {
    ...parsed,
    width: parsed.width * k,
    height: parsed.height * k,
    xhot: parsed.xhot * k,
    yhot: parsed.yhot * k,
  };
}

function positiveInt(value) {
  const parsed = parseInt(String(value ?? '').replace(/^['"]|['"]$/g, ''), 10);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 512 ? parsed : 0;
}

function getLinuxCursor(scaleFactor = 1) {
  let theme = '';
  let size = 0;

  try {
    const rawTheme = execFileSync('gsettings', ['get', 'org.gnome.desktop.interface', 'cursor-theme'], { encoding: 'utf8', timeout: 500 }).trim();
    theme = rawTheme.replace(/^['"]|['"]$/g, '');
  } catch {}

  // GNOME's cursor-size is in logical pixels, matching Chromium's pointer size.
  // XCURSOR_SIZE is only a fallback: it is often a physical size under scaling.
  try {
    size = positiveInt(execFileSync('gsettings', ['get', 'org.gnome.desktop.interface', 'cursor-size'], { encoding: 'utf8', timeout: 500 }).trim());
  } catch {}
  if (!theme && process.env.XCURSOR_THEME) theme = process.env.XCURSOR_THEME;
  if (!size) size = positiveInt(process.env.XCURSOR_SIZE) || 24;

  const physical = Math.max(1, Math.round(size * scaleFactor));
  const themesToTry = [theme, 'Yaru', 'DMZ-White', 'Adwaita', 'default', 'breeze_cursors'].filter(Boolean);
  const searchDirs = [
    path.join(os.homedir(), '.icons'),
    path.join(os.homedir(), '.local', 'share', 'icons'),
    '/usr/share/icons',
    '/usr/local/share/icons'
  ];

  const candidateNames = ['default', 'left_ptr', 'arrow', 'top_left_arrow'];

  for (const t of themesToTry) {
    for (const d of searchDirs) {
      const cursorDir = path.join(d, t, 'cursors');
      for (const name of candidateNames) {
        const filePath = path.join(cursorDir, name);
        try {
          if (fs.existsSync(filePath)) {
            const fileBuf = fs.readFileSync(filePath);
            const parsed = parseXcursor(fileBuf, physical);
            if (parsed) {
              // Chromium loads the theme image closest to size x scale and
              // draws it 1:1 in physical pixels, i.e. image / scale in DIPs.
              return { ...toDips(parsed, 1, scaleFactor), size, theme: t, platform: 'linux' };
            }
            const cur = parseCurFile(fileBuf, physical);
            if (cur) return { ...toDips(cur, size, cur.width), size, theme: t, platform: 'linux' };
          }
        } catch {}
      }
    }
  }

  return { ...toDips(FALLBACK_SVGS.linux, size, FALLBACK_SVGS.linux.width), size, platform: 'linux', theme: theme || 'default' };
}

function readRegistryValue(key, name) {
  try {
    const output = execFileSync('reg', ['query', key, '/v', name], { encoding: 'utf8', timeout: 500, windowsHide: true });
    const match = output.match(new RegExp(name + '\\s+(REG_\\w+)\\s+(.*)', 'i'));
    if (!match) return null;
    return { type: match[1].toUpperCase(), value: match[2].trim() };
  } catch { return null; }
}

function getWindowsCursor(scaleFactor = 1) {
  const sysRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';

  // Windows draws the pointer at CursorBaseSize DIPs (32 by default; larger
  // when "Mouse pointer size" is raised in Accessibility settings), scaled by
  // the display scale. The whole cursor frame is stretched to that size.
  let size = 32;
  const base = readRegistryValue('HKCU\\Control Panel\\Cursors', 'CursorBaseSize');
  if (base) {
    const parsed = base.type === 'REG_DWORD' ? parseInt(base.value, 16) : parseInt(base.value, 10);
    if (Number.isFinite(parsed) && parsed >= 16 && parsed <= 512) size = parsed;
  }
  const physical = Math.max(1, Math.round(size * scaleFactor));

  let cursorPath = '';
  const arrow = readRegistryValue('HKCU\\Control Panel\\Cursors', 'Arrow');
  if (arrow && arrow.value) {
    cursorPath = arrow.value
      .replace(/%SystemRoot%/gi, sysRoot)
      .replace(/%windir%/gi, sysRoot)
      .replace(/%USERPROFILE%/gi, os.homedir());
  }

  const candidates = [
    cursorPath,
    path.join(sysRoot, 'Cursors', 'aero_arrow.cur'),
    path.join(sysRoot, 'Cursors', 'arrow.cur')
  ].filter(Boolean);

  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        const buf = fs.readFileSync(c);
        const parsed = parseCurFile(buf, physical);
        if (parsed) return { ...toDips(parsed, size, parsed.width), size, platform: 'win32' };
      }
    } catch {}
  }

  return { ...toDips(FALLBACK_SVGS.win32, size, FALLBACK_SVGS.win32.width), size, platform: 'win32' };
}

function getMacCursor() {
  const candidateDirs = [
    '/System/Library/Frameworks/ApplicationServices.framework/Versions/A/Frameworks/HIServices.framework/Versions/A/Resources/cursors/arrow',
    '/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources'
  ];

  for (const d of candidateDirs) {
    try {
      const p = path.join(d, 'cursor_24.png');
      if (fs.existsSync(p)) {
        const buf = fs.readFileSync(p);
        return {
          width: 24,
          height: 24,
          xhot: 2,
          yhot: 2,
          dataUrl: 'data:image/png;base64,' + buf.toString('base64'),
          platform: 'darwin'
        };
      }
    } catch {}
  }

  return { ...FALLBACK_SVGS.darwin, platform: 'darwin' };
}

const cachedCursors = new Map();

// options: { scaleFactor = 1, forceRefresh = false }. A boolean is accepted as
// forceRefresh for older callers.
function getSystemCursorInfo(options = {}) {
  const opts = typeof options === 'boolean' ? { forceRefresh: options } : (options || {});
  const scaleFactor = Number.isFinite(opts.scaleFactor) && opts.scaleFactor > 0 ? opts.scaleFactor : 1;
  if (opts.forceRefresh) cachedCursors.clear();
  const key = String(scaleFactor);
  if (cachedCursors.has(key)) return cachedCursors.get(key);

  let info;
  if (process.platform === 'win32') info = getWindowsCursor(scaleFactor);
  else if (process.platform === 'darwin') info = getMacCursor();
  else info = getLinuxCursor(scaleFactor);

  cachedCursors.set(key, info);
  return info;
}

module.exports = {
  getSystemCursorInfo,
  getLinuxCursor,
  getWindowsCursor,
  parseXcursor,
  parseCurFile,
  makePngFromRgba,
  FALLBACK_SVGS
};
