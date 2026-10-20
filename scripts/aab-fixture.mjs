// Crafted .aab files for tests: a stored ZIP holding aapt2-shaped protobuf manifest.
import fs from 'node:fs';
import path from 'node:path';

export const field = (no, bytes) => Buffer.concat([Buffer.from([(no << 3) | 2, bytes.length]), bytes]);
/** XmlAttribute: namespace_uri 1, name 2, value 3 (aapt2 leaves the namespace empty for `package`). */
export const attribute = (ns, name, value) => Buffer.concat([field(1, Buffer.from(ns)), field(2, Buffer.from(name)), field(3, Buffer.from(value))]);

/** A ZIP with one stored entry, enough for the manifest reader. */
export function zipOf(name, data) {
  const n = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(n.length, 28);
  const localPart = Buffer.concat([local, n, data]);
  const centralPart = Buffer.concat([central, n]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralPart.length, 12);
  end.writeUInt32LE(localPart.length, 16);
  return Buffer.concat([localPart, centralPart, end]);
}

/** An .aab whose manifest is XmlNode{element{name="manifest", attribute: package, versionName}}. */
export function bundle(dir, pkg) {
  const element = Buffer.concat([
    field(3, Buffer.from('manifest')),
    field(4, attribute('', 'package', pkg)),
    field(4, attribute('http://schemas.android.com/apk/res/android', 'versionName', '1.0')),
  ]);
  const file = path.join(dir, `${pkg}.aab`);
  fs.writeFileSync(file, zipOf('base/manifest/AndroidManifest.xml', field(1, element)));
  return file;
}

