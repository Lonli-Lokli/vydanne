// Tests for release notes named by version (`changelogs/1.3.txt`): read from the bundle, chosen first after an
// exact `<versionCode>.txt`, never renamed. App Store side: `release_notes/<version>.txt` (src/notes.mjs).
//   node --test scripts/notes.test.mjs        (or: npm run check:notes)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readAabVersionCode, readAabVersionName } from '../src/play/aab.mjs';
import { readNotes, run } from '../src/play/commands/prerelease.mjs';
import { appStoreNotesFile } from '../src/notes.mjs';

/** A length-delimited protobuf field. */
const field = (no, bytes) => Buffer.concat([Buffer.from([(no << 3) | 2, bytes.length]), bytes]);
/** An XmlAttribute: name in field 2, raw string value in field 3, the shape aapt2 writes. */
const attribute = (name, value) => Buffer.concat([field(2, Buffer.from(name)), field(3, Buffer.from(value))]);

/** A ZIP with one stored entry: enough for the manifest reader, which walks the central directory. */
function zipOf(name, data) {
  const n = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(0, 8); // stored
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(n.length, 28);
  central.writeUInt32LE(0, 42); // local header offset
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

function bundle(dir, versionCode, versionName) {
  const element = Buffer.concat([field(1, attribute('versionCode', String(versionCode))), field(1, attribute('versionName', versionName))]);
  const file = path.join(dir, `app-${versionName}-${versionCode}.aab`);
  fs.writeFileSync(file, zipOf('base/manifest/AndroidManifest.xml', field(1, element)));
  return file;
}

function notesDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vydanne-notes-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

const quiet = (fn) => {
  const { log } = console;
  console.log = () => {};
  try { return fn(); } finally { console.log = log; }
};

test('the bundle says its own versionName, beside its versionCode', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vydanne-aab-'));
  const file = bundle(dir, 182, '1.3');
  assert.equal(readAabVersionCode(file), 182);
  assert.equal(readAabVersionName(file), '1.3');
});

test('<versionName>.txt is this version\'s notes; an exact <versionCode>.txt still wins; next.txt is the fallback', () => {
  const meta = notesDir({
    'en-GB/changelogs/1.3.txt': 'One point three.',
    'en-GB/changelogs/next.txt': 'Next.',
    'de-DE/changelogs/182.txt': 'Exact.',
    'de-DE/changelogs/1.3.txt': 'Eins drei.',
    'fr-FR/changelogs/next.txt': 'Suivant.',
  });
  const notes = quiet(() => readNotes(meta, 182, 'en-GB', '1.3'));
  const byLang = Object.fromEntries(notes.entries.map((e) => [e.language, e.text]));
  assert.deepEqual(byLang, { 'en-GB': 'One point three.', 'de-DE': 'Exact.', 'fr-FR': 'Suivant.' });
  assert.deepEqual(notes.nextFiles.map((f) => path.basename(path.dirname(path.dirname(f)))), ['fr-FR'], 'only next.txt is archived');
});

test('a version file is never renamed after a real upload', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vydanne-run-'));
  fs.mkdirSync(path.join(root, 'dist'));
  bundle(path.join(root, 'dist'), 7, '2.0');
  const meta = path.join(root, 'meta');
  fs.mkdirSync(path.join(meta, 'en-GB', 'changelogs'), { recursive: true });
  fs.writeFileSync(path.join(meta, 'en-GB', 'changelogs', '2.0.txt'), 'Two.');
  const calls = [];
  const client = {
    dryRun: false,
    async newEdit() { return 'e'; },
    async uploadBundle() { return { versionCode: 7 }; },
    async putTrack(e, track, releases) { calls.push(releases[0]); return { status: 200, json: {} }; },
    async commit() { return { status: 200, json: {} }; },
    async deleteEdit() {},
  };
  const saved = process.env.VYDANNE_TRACK;
  delete process.env.VYDANNE_TRACK;
  const { log } = console;
  console.log = () => {};
  try {
    assert.equal(await run({ google: { aab: path.join(root, 'dist'), metadataDir: meta, defaultLocale: 'en-GB', track: 'internal' } }, client), true);
  } finally {
    console.log = log;
    if (saved !== undefined) process.env.VYDANNE_TRACK = saved;
  }
  assert.equal(calls[0].releaseNotes[0].text, 'Two.');
  assert.deepEqual(fs.readdirSync(path.join(meta, 'en-GB', 'changelogs')), ['2.0.txt']);
});

test('App Store: release_notes/<version>.txt first, then release_notes.txt', () => {
  const meta = notesDir({
    'en-GB/release_notes/1.6.txt': 'One point six.',
    'en-GB/release_notes.txt': 'Old.',
    'de-DE/release_notes.txt': 'Alt.',
  });
  assert.equal(path.relative(meta, appStoreNotesFile(path.join(meta, 'en-GB'), '1.6')), path.join('en-GB', 'release_notes', '1.6.txt'));
  assert.equal(path.relative(meta, appStoreNotesFile(path.join(meta, 'en-GB'), '1.7')), path.join('en-GB', 'release_notes.txt'));
  assert.equal(path.relative(meta, appStoreNotesFile(path.join(meta, 'de-DE'), '1.6')), path.join('de-DE', 'release_notes.txt'));
  assert.equal(appStoreNotesFile(path.join(meta, 'fr-FR'), '1.6'), null);
});
