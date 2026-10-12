// Media for the tests: an MP4 built box by box, with only what Apple's checks read (duration, a video track of a
// size and frame rate, optionally sound) — so no test needs ffmpeg. Not a test file itself.

const box = (type, ...parts) => {
  const payload = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + payload.length, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, payload]);
};
const u32 = (...n) => { const b = Buffer.alloc(4 * n.length); n.forEach((v, i) => b.writeUInt32BE(v >>> 0, i * 4)); return b; };
const IDENTITY = u32(0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000);

/** A movie with only the boxes Apple's checks need: duration, a video track of w×h at fps, optionally sound. */
export function movie({ w, h, seconds, fps, audio = false }) {
  const scale = 600;
  const mvhd = box('mvhd', u32(0, 0, 0, scale, seconds * scale, 0x10000), Buffer.from([1, 0]), Buffer.alloc(10), IDENTITY, Buffer.alloc(24), u32(3));
  const trak = (handler, samples, width, height) => box('trak',
    box('tkhd', u32(0, 0, 0, 1, 0, seconds * scale), Buffer.alloc(8), Buffer.alloc(8), IDENTITY, u32(width * 65536, height * 65536)),
    box('mdia',
      box('mdhd', u32(0, 0, 0, scale, seconds * scale), Buffer.alloc(4)),
      box('hdlr', u32(0, 0), Buffer.from(handler, 'latin1'), Buffer.alloc(12), Buffer.from('x\0')),
      box('minf', box('stbl', box('stts', u32(0, 1, samples, Math.round((seconds * scale) / samples)))))));
  return Buffer.concat([
    box('ftyp', Buffer.from('isom'), u32(0), Buffer.from('isom')),
    box('moov', mvhd, trak('vide', Math.round(seconds * fps), w, h), ...(audio ? [trak('soun', seconds * 44, 0, 0)] : [])),
    box('mdat', Buffer.alloc(16)),
  ]);
}
