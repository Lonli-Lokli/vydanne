import fs from "node:fs";
import zlib from "node:zlib";

/**
 * **Is this store screenshot a picture of nothing?**
 *
 * Palon shipped one. `store-assets/appstore-iphone-6.9/05-buildinglight.png` is a device frame
 * containing pure white and an iOS status bar — no board, no header, no queue — and it was uploaded
 * to a version that reached App Store review. Nothing in the chain could have noticed: zdymak
 * photographs whatever the app draws and reports success, the asset bridge copies what it is
 * handed, `fill` uploads it, and `preflight`'s existing checks are about presence, naming and
 * freshness, all of which a blank file passes perfectly.
 *
 * The one screenshot that broke was the only one in the set shot in the LIGHT palette — the least
 * trodden path in the capture, photographed once a release and looked at by nobody afterwards.
 *
 * ### It measures the CENTRE, and that is what makes the number mean something
 *
 * Measured across Palon's four asset sets, distinct colours over the whole frame do not separate:
 * the caption band and its gradient contribute thousands of their own, so the blank frame scored
 * 1821 against 7283 for a good one — a real gap, but one that depends entirely on how much
 * decoration a game's frame happens to carry. Over the middle of the image, where the device screen
 * sits, the same files score **28 against 3256–6811**. The quietest genuine screenshot in the
 * portfolio (Palon's Android `fresh`, a nearly empty opening board) scores 408.
 *
 * Those are full-pixel counts over the crop; the implementation samples every second pixel, which
 * scales them down but not the separation. See [BLANK_BELOW] for the figures the threshold is
 * actually set from. It is a blankness detector, not a judgement about how busy a screenshot is.
 *
 * ### PNG only, and decoded here rather than by a dependency
 *
 * vydanne has no image dependency and should not grow one for this. PNG is enough — every
 * screenshot in the portfolio is one — and anything else is reported as unchecked rather than
 * guessed at, because a false "blank" on a release would be worse than the gap it closes.
 */

/** Distinct colours in the middle of a PNG, or null when the file cannot be read as one. */
export function centreColours(file) {
  let png;
  try {
    png = decodePng(fs.readFileSync(file));
  } catch {
    return null;
  }
  if (!png) return null;
  const { width, height, pixels } = png;
  const x0 = Math.floor(width * 0.2);
  const x1 = Math.floor(width * 0.8);
  const y0 = Math.floor(height * 0.25);
  const y1 = Math.floor(height * 0.85);
  const seen = new Set();
  // Every 2nd pixel on both axes. Sampling matters more than it looks: at every 4th, the quietest
  // real screenshot in the portfolio (a nearly empty opening board) fell from 408 distinct colours
  // to 126 and would have been reported as blank, while the genuinely blank one stayed at 28
  // whatever the step. A false "blank" on a release would be worse than the gap this closes.
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const i = (y * width + x) * 4;
      seen.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
      // Enough to pass; stop counting. The exact figure only matters below the threshold.
      if (seen.size > BLANK_BELOW) return seen.size;
    }
  }
  return seen.size;
}

/**
 * Fewer distinct colours than this in the centre and the screen drew nothing.
 *
 * Measured at the sampling above: the blank screenshot scores **28**, the quietest genuine one in
 * the portfolio **270**, and a normal one 1500–6800. This sits 4x clear of both, which is the point
 * — near either edge it would be a taste threshold rather than a fault detector.
 */
export const BLANK_BELOW = 120;

/**
 * Minimal PNG reader: IHDR + IDAT, 8-bit RGB/RGBA, non-interlaced. Returns null for anything else,
 * which the caller reports as unchecked. Enough for every screenshot any of these pipelines make.
 */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  let pos = 8;
  let width = 0;
  let height = 0;
  let colourType = -1;
  let bitDepth = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colourType = data[9];
      if (data[12] !== 0) return null; // interlaced
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }
  if (bitDepth !== 8 || (colourType !== 2 && colourType !== 6)) return null;
  const channels = colourType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride));
    unfilter(filter, line, prev, channels);
    for (let x = 0; x < width; x++) {
      const s = x * channels;
      const d = (y * width + x) * 4;
      out[d] = line[s];
      out[d + 1] = line[s + 1];
      out[d + 2] = line[s + 2];
      out[d + 3] = channels === 4 ? line[s + 3] : 255;
    }
    prev = line;
  }
  return { width, height, pixels: out };
}

/** The five PNG line filters, in place. */
function unfilter(filter, line, prev, bpp) {
  for (let i = 0; i < line.length; i++) {
    const a = i >= bpp ? line[i - bpp] : 0;
    const b = prev[i];
    const c = i >= bpp ? prev[i - bpp] : 0;
    switch (filter) {
      case 1: line[i] = (line[i] + a) & 0xff; break;
      case 2: line[i] = (line[i] + b) & 0xff; break;
      case 3: line[i] = (line[i] + ((a + b) >> 1)) & 0xff; break;
      case 4: {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
        break;
      }
      default: break;
    }
  }
}
