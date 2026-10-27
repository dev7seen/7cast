const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const logosDir = path.join(__dirname, '..', 'public', 'assets', 'logos');
if (!fs.existsSync(logosDir)) fs.mkdirSync(logosDir, { recursive: true });

function createPng(width, height, getPixel) {
  const rowSize = width * 4 + 1;
  const raw = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    raw[y * rowSize] = 0;
    for (let x = 0; x < width; x++) {
      const idx = y * rowSize + 1 + x * 4;
      const [r, g, b, a] = getPixel(x, y);
      raw[idx] = r;
      raw[idx + 1] = g;
      raw[idx + 2] = b;
      raw[idx + 3] = a;
    }
  }
  const idatData = zlib.deflateSync(raw);

  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    const crc = crc32(Buffer.concat([typeBuf, data]));
    crcBuf.writeInt32BE(crc);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  function crc32(buf) {
    let c = -1;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (-(c & 1) & 0xEDB88320);
    }
    return ~c;
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    sig,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idatData),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

// 1. 7SEEN TV Logo: Width 240, Height 90
const p7seen = createPng(240, 90, (x, y) => {
  // Border container with subtle glow
  if (x < 4 || x >= 236 || y < 4 || y >= 86) return [0, 0, 0, 0];
  
  // Left: Red "7"
  if (x >= 15 && x <= 45 && y >= 25 && y <= 75) {
    if (y <= 38 || (x + y >= 75 && x + y <= 95)) return [225, 29, 72, 255]; // crimson 7
  }
  // "SEEN" in white
  if (x >= 55 && x <= 145 && y >= 30 && y <= 70) {
    // Letters block
    return [255, 255, 255, 255];
  }
  // "TV" Red rounded badge on right
  if (x >= 155 && x <= 225 && y >= 22 && y <= 68) {
    // inside TV badge
    if (x >= 165 && x <= 185 && y >= 32 && y <= 58) {
      // T letter
      if (y <= 38 || (x >= 172 && x <= 178)) return [255, 255, 255, 255];
    }
    if (x >= 190 && x <= 215 && y >= 32 && y <= 58) {
      // V letter
      if (Math.abs((x - 190) - (y - 32) * 0.4) < 4 || Math.abs((215 - x) - (y - 32) * 0.4) < 4) return [255, 255, 255, 255];
    }
    return [225, 29, 72, 255];
  }
  // Crown on top of 7SEEN
  if (x >= 65 && x <= 135 && y >= 8 && y <= 24) {
    return [245, 158, 11, 255]; // Gold crown
  }
  return [15, 23, 42, 200]; // dark glass background
});
fs.writeFileSync(path.join(logosDir, '7seen_tv.png'), p7seen);

// 2. Champions League: 160x160 circular badge
const pUcl = createPng(160, 160, (x, y) => {
  const dx = x - 80;
  const dy = y - 80;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > 76) return [0, 0, 0, 0];
  if (dist > 72) return [255, 255, 255, 240];
  // Star sphere pattern
  if ((Math.abs(dx) < 8 && Math.abs(dy) < 35) || (Math.abs(dy) < 8 && Math.abs(dx) < 35)) return [255, 255, 255, 255];
  if (Math.abs(dx - dy) < 8 && dist < 45) return [255, 255, 255, 255];
  if (Math.abs(dx + dy) < 8 && dist < 45) return [255, 255, 255, 255];
  return [3, 7, 30, 240];
});
fs.writeFileSync(path.join(logosDir, 'champions_league.png'), pUcl);

// 3. beIN SPORTS: 220x80 purple badge
const pBein = createPng(220, 80, (x, y) => {
  if (x < 4 || x >= 216 || y < 4 || y >= 76) return [0, 0, 0, 0];
  if (x >= 120 && x <= 205 && y >= 18 && y <= 62) {
    // Purple highlight box for SPORTS
    return [168, 85, 247, 255];
  }
  if (x >= 20 && x <= 100 && y >= 25 && y <= 55) {
    return [255, 255, 255, 255]; // beIN text
  }
  return [46, 16, 101, 230]; // deep purple
});
fs.writeFileSync(path.join(logosDir, 'bein_sports.png'), pBein);

// 4. Al Iraq TV: 200x80 red badge
const pIraq = createPng(200, 80, (x, y) => {
  if (x < 4 || x >= 196 || y < 4 || y >= 76) return [0, 0, 0, 0];
  // Play triangle on left
  const tx = x - 25;
  const ty = y - 40;
  if (tx >= 0 && tx <= 25 && Math.abs(ty) <= tx * 0.7) {
    return [255, 255, 255, 255];
  }
  // Iraq text area
  if (x >= 65 && x <= 180 && y >= 25 && y <= 55) {
    return [255, 255, 255, 255];
  }
  return [153, 27, 27, 240]; // Crimson red
});
fs.writeFileSync(path.join(logosDir, 'al_iraq_tv.png'), pIraq);

console.log('Sample brand logos generated successfully in public/assets/logos/!');
