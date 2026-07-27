import fs from "node:fs";
import zlib from "node:zlib";

/**
 * Read the versionCode out of an `.aab`, locally, before anything is uploaded.
 *
 * WHY. Release notes resolve to `<metadataDir>/<locale>/changelogs/<versionCode>.txt`, but in repos
 * that derive versionCode from `git rev-list --count HEAD` the number is unknowable until the build is
 * cut — every commit moves it. So nobody can name the changelog file in advance, the fallback quietly
 * wins, and the first time the real number appears in a log is AFTER a multi-megabyte upload. The
 * bundle itself has known its own versionCode all along: it is an attribute on the `<manifest>`
 * element of `base/manifest/AndroidManifest.xml`.
 *
 * HOW, without Java. bundletool is the official reader and is a JVM tool; shelling out to it would be
 * the first Java dependency in a package whose whole pitch is native Node. But the format is shallow:
 * an .aab is a ZIP, and the manifest inside is aapt2's protobuf XML. Neither needs a library —
 * `zlib.inflateRawSync` decompresses the entry, and protobuf's wire format is walkable generically:
 * find the submessage that looks like an XmlAttribute named "versionCode" (field 2, its `name`) and
 * take its value (field 3 as a decimal string, or the first varint inside field 6, the compiled item).
 * Matching by attribute NAME rather than by the exact Resources.proto field numbers for Primitive is
 * deliberate — those internals have shifted between aapt2 versions; "an attribute called versionCode
 * on the manifest of an Android app" has not.
 *
 * Returns null on anything unexpected rather than throwing: the caller has a correct-by-construction
 * fallback (Play reports the versionCode after upload), so a parse failure must degrade to the old
 * behaviour, never block a release.
 */
export function readAabVersionCode(file) {
  try {
    const manifest = zipEntry(fs.readFileSync(file), "base/manifest/AndroidManifest.xml");
    return manifest ? findVersionCode(manifest) : null;
  } catch {
    return null;
  }
}

/** Extract one entry from a ZIP buffer (stored or deflated), or null. */
function zipEntry(buf, wanted) {
  // End-of-central-directory: scan back from the end (the record allows a trailing comment).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  let off = buf.readUInt32LE(eocd + 16); // central directory offset
  const count = buf.readUInt16LE(eocd + 10);
  for (let n = 0; n < count && off + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + nameLen);
    if (name === wanted) {
      // The local header repeats name/extra with its OWN lengths (extra often differs) — read them.
      if (buf.readUInt32LE(localOff) !== 0x04034b50) return null;
      const lname = buf.readUInt16LE(localOff + 26);
      const lextra = buf.readUInt16LE(localOff + 28);
      const data = buf.subarray(localOff + 30 + lname + lextra, localOff + 30 + lname + lextra + csize);
      if (method === 0) return data;
      if (method === 8) return zlib.inflateRawSync(data);
      return null;
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

/** Parse one protobuf message into its fields. Throws on anything that isn't valid wire format. */
function protoFields(buf) {
  const out = [];
  let i = 0;
  const varint = () => {
    let v = 0, shift = 0;
    for (;;) {
      if (i >= buf.length || shift > 49) throw new Error("varint"); // >2^49 can't be a versionCode anyway
      const b = buf[i++];
      v += (b & 0x7f) * 2 ** shift;
      if (!(b & 0x80)) return v;
      shift += 7;
    }
  };
  while (i < buf.length) {
    const key = varint();
    const no = Math.floor(key / 8), wire = key % 8;
    if (wire === 0) out.push({ no, wire, val: varint() });
    else if (wire === 2) { const len = varint(); if (i + len > buf.length) throw new Error("len"); out.push({ no, wire, bytes: buf.subarray(i, i + len) }); i += len; }
    else if (wire === 5) { i += 4; out.push({ no, wire }); }
    else if (wire === 1) { i += 8; out.push({ no, wire }); }
    else throw new Error("wire");
  }
  return out;
}

/** Depth-first hunt for an XmlAttribute whose name (field 2) is "versionCode". */
function findVersionCode(buf) {
  let fields;
  try { fields = protoFields(buf); } catch { return null; } // not a message — a string that happened to be field-2
  const name = fields.find((f) => f.no === 2 && f.wire === 2);
  if (name && name.bytes.toString("utf8") === "versionCode") {
    const value = fields.find((f) => f.no === 3 && f.wire === 2)?.bytes.toString("utf8");
    if (value && /^\d+$/.test(value)) return Number(value);
    const compiled = fields.find((f) => f.no === 6 && f.wire === 2);
    if (compiled) {
      const v = firstVarint(compiled.bytes);
      if (v != null) return v;
    }
    return null;
  }
  for (const f of fields) {
    if (f.wire !== 2) continue;
    const found = findVersionCode(f.bytes);
    if (found != null) return found;
  }
  return null;
}

/** The first varint anywhere in a message — inside Item→Primitive that is the integer value itself
 *  (the attribute-level varints, like resource_id, live OUTSIDE the compiled item). */
function firstVarint(buf) {
  let fields;
  try { fields = protoFields(buf); } catch { return null; }
  for (const f of fields) {
    if (f.wire === 0) return f.val;
    if (f.wire === 2) {
      const v = firstVarint(f.bytes);
      if (v != null) return v;
    }
  }
  return null;
}
