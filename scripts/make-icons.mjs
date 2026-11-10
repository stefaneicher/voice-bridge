// Generates the tray and app icons as PNG (no image dependencies). Run: node scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const segDist = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax,
    dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
};

/** Signed coverage of the microphone glyph in a 24-unit box (Lucide "mic" geometry). */
function mic(x, y) {
  const d = [
    segDist(x, y, 12, 5, 12, 11) - 3.2, // capsule (filled)
    Math.abs(Math.hypot(x - 12, y - 11) - 7) - 1.1 + (y < 11 ? 99 : 0), // lower arc
    segDist(x, y, 5, 9, 5, 11) - 1.1,
    segDist(x, y, 19, 9, 19, 11) - 1.1,
    segDist(x, y, 12, 18, 12, 21.5) - 1.1,
    segDist(x, y, 8.5, 21.5, 15.5, 21.5) - 1.1,
  ];
  return Math.min(...d);
}

function render(size, { color, dot, slash, background }) {
  const out = Buffer.alloc(size * size * 4);
  const ss = 4;
  const pad = background ? 0.22 : 0.02;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let acc = [0, 0, 0, 0];
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (px + (sx + 0.5) / ss) / size;
          const v = (py + (sy + 0.5) / ss) / size;
          let rgba = [0, 0, 0, 0];
          if (background) {
            const r = 0.2;
            const qx = Math.max(Math.abs(u - 0.5) - (0.5 - r), 0);
            const qy = Math.max(Math.abs(v - 0.5) - (0.5 - r), 0);
            if (Math.hypot(qx, qy) <= r) rgba = [...hex(background), 255];
          }
          const gx = ((u - pad) / (1 - 2 * pad)) * 24;
          const gy = ((v - pad) / (1 - 2 * pad)) * 24;
          if (mic(gx, gy) <= 0) rgba = [...hex(color), 255];
          if (slash && segDist(gx, gy, 3, 3, 21, 21) <= 1.3) rgba = [...hex(color), 255];
          if (dot && Math.hypot(gx - 19.5, gy - 4.5) <= 4.2) rgba = [...hex('#FF5A5F'), 255];
          acc = acc.map((a, i) => a + (i < 3 ? (rgba[i] * rgba[3]) / 255 : rgba[3]));
        }
      }
      const n = ss * ss;
      const o = (py * size + px) * 4;
      const alpha = acc[3] / n;
      for (let i = 0; i < 3; i++) out[o + i] = acc[3] ? Math.round((acc[i] / acc[3]) * 255) : 0;
      out[o + 3] = Math.round(alpha);
    }
  }
  return png(size, out);
}

const states = {
  ready: { color: '#9A9CAB' },
  'recording-dictate': { color: '#2AA5A1', dot: true },
  'recording-agent': { color: '#A3D858', dot: true },
  working: { color: '#C6CAD3' },
  paused: { color: '#9A9CAB', slash: true },
  error: { color: '#FF5A5F' },
};

mkdirSync('resources/tray', { recursive: true });
for (const [name, style] of Object.entries(states)) {
  writeFileSync(`resources/tray/${name}.png`, render(16, style));
  writeFileSync(`resources/tray/${name}@2x.png`, render(32, style));
}
writeFileSync('resources/icon.png', render(512, { color: '#2AA5A1', background: '#15151C' }));
console.log('icons written');
