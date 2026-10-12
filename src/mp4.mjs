import fs from "node:fs";

/**
 * **What is in this video file?** Width, height, duration, frame rate and whether it carries sound, read
 * from the MP4 / QuickTime box structure itself.
 *
 * WHY NOT ffprobe. Every other check vydanne makes runs on what Node ships plus `sharp`, and a store tool
 * that needs a second binary on the PATH to say "this header video is 4 seconds long" is a tool whose
 * check silently does not run on the machine where it matters. The facts Apple validates a creative
 * video against (dimensions, 30 or 60 fps, 5–30 s) are all in the `moov` box, so this reads that and
 * nothing else: the boxes are walked by offset with a file descriptor, never loaded whole, so a 500 MB
 * file costs a few kilobytes of reads.
 *
 * WHAT IT DOES NOT DO. Decode anything, or understand fragmented MP4 (`moof`), which no App Store
 * pipeline produces. Anything it cannot read comes back as `null` and the caller reports the file as
 * unchecked rather than guessing.
 */
/** Box headers at [start, end): { type, start (of the payload), end }. Handles 64-bit and to-end sizes. */
function boxes(fd, start, end) {
  const out = [];
  const head = Buffer.alloc(16);
  let pos = start;
  while (pos + 8 <= end) {
    if (fs.readSync(fd, head, 0, 16, pos) < 8) break;
    let size = head.readUInt32BE(0);
    const type = head.toString("latin1", 4, 8);
    let header = 8;
    if (size === 1) {
      size = Number(head.readBigUInt64BE(8));
      header = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (size < header || pos + size > end) break;
    out.push({ type, start: pos + header, end: pos + size });
    pos += size;
  }
  return out;
}

const read = (fd, box) => {
  const buf = Buffer.alloc(Math.min(box.end - box.start, 1 << 20));
  fs.readSync(fd, buf, 0, buf.length, box.start);
  return buf;
};
const child = (fd, box, type) => boxes(fd, box.start, box.end).find((b) => b.type === type) ?? null;

/** One `trak`: its handler ('vide' | 'soun' | …), media timescale/duration, display size and sample count. */
function track(fd, trak) {
  const t = { handler: null, width: 0, height: 0, timescale: 0, duration: 0, samples: 0 };
  const tkhd = child(fd, trak, "tkhd");
  if (tkhd) {
    const b = read(fd, tkhd);
    // Width and height are the last eight bytes, 16.16 fixed point, before the rotation matrix is applied.
    const w = b.readUInt32BE(b.length - 8) / 65536;
    const h = b.readUInt32BE(b.length - 4) / 65536;
    // The matrix sits just before them; a = d = 0 means a quarter turn, so the picture shows rotated.
    const m = b.length - 8 - 36;
    const turned = m >= 0 && b.readInt32BE(m) === 0 && b.readInt32BE(m + 16) === 0;
    [t.width, t.height] = turned ? [h, w] : [w, h];
  }
  const mdia = child(fd, trak, "mdia");
  if (!mdia) return t;
  const mdhd = child(fd, mdia, "mdhd");
  if (mdhd) {
    const b = read(fd, mdhd);
    const v1 = b[0] === 1;
    t.timescale = b.readUInt32BE(v1 ? 20 : 12);
    t.duration = v1 ? Number(b.readBigUInt64BE(24)) : b.readUInt32BE(16);
  }
  const hdlr = child(fd, mdia, "hdlr");
  if (hdlr) t.handler = read(fd, hdlr).toString("latin1", 8, 12);
  const stbl = (() => {
    const minf = child(fd, mdia, "minf");
    return minf ? child(fd, minf, "stbl") : null;
  })();
  const stts = stbl ? child(fd, stbl, "stts") : null;
  if (stts) {
    const b = read(fd, stts);
    const n = b.readUInt32BE(4);
    for (let i = 0; i < n && 8 + i * 8 + 4 <= b.length; i++) t.samples += b.readUInt32BE(8 + i * 8);
  }
  return t;
}

/**
 * Probe an .mp4 / .m4v / .mov. Returns `{ width, height, duration, fps, hasAudio }` (duration in seconds,
 * fps to two decimals), or null when the file is not a readable MP4/QuickTime movie.
 */
export function probeVideo(file) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const size = fs.fstatSync(fd).size;
    const moov = boxes(fd, 0, size).find((b) => b.type === "moov");
    if (!moov) return null;
    let duration = null;
    const mvhd = child(fd, moov, "mvhd");
    if (mvhd) {
      const b = read(fd, mvhd);
      const v1 = b[0] === 1;
      const scale = b.readUInt32BE(v1 ? 20 : 12);
      const d = v1 ? Number(b.readBigUInt64BE(24)) : b.readUInt32BE(16);
      if (scale) duration = d / scale;
    }
    const tracks = boxes(fd, moov.start, moov.end).filter((b) => b.type === "trak").map((tr) => track(fd, tr));
    const video = tracks.find((t) => t.handler === "vide");
    if (!video) return null;
    const seconds = video.timescale ? video.duration / video.timescale : 0;
    return {
      width: Math.round(video.width),
      height: Math.round(video.height),
      duration: duration ?? seconds,
      fps: seconds ? Math.round((video.samples / seconds) * 100) / 100 : null,
      hasAudio: tracks.some((t) => t.handler === "soun"),
    };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
