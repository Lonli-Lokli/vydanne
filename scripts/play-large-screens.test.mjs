// Play's large-screen sets in `fill --store google`, with a fake client (nothing is uploaded): the 7-inch and
// 10-inch sets each go to their own slot, the Chromebook set (no API slot) is checked and named for Play Console,
// and the approval gate refuses a shot its comparison did not pass and the owner did not approve.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { run } from '../src/play/commands/fill.mjs';
import { checkLargeScreenSet } from '../src/play/manual.mjs';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, sum]); };
/** A solid PNG of w x h; `alpha` writes RGBA, `shade` makes each file's content its own. */
function png(file, w, h, { alpha = false, shade = 0 } = {}) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = alpha ? 6 : 2;
  const row = Buffer.alloc(1 + w * (alpha ? 4 : 3), shade); row[0] = 0;
  const idat = zlib.deflateSync(Buffer.concat(Array.from({ length: h }, () => row)));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]));
  return file;
}
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

function app() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vydanne-large-'));
  const dir = (name) => path.join(root, 'out', name);
  const sets = { seven: dir('play-tablet7-plain'), ten: dir('play-tablet-plain'), chromebook: dir('play-chromebook-plain') };
  const files = [];
  for (let i = 0; i < 4; i++) {
    files.push(png(path.join(sets.seven, `0${i}.png`), 1920, 1080, { shade: 10 + i }));
    files.push(png(path.join(sets.ten, `0${i}.png`), 2560, 1440, { shade: 20 + i }));
    files.push(png(path.join(sets.chromebook, `0${i}.png`), 1920, 1080, { shade: 30 + i }));
  }
  const config = { google: { packageName: 'app.example', metadataDir: path.join(root, 'meta'), defaultLocale: 'en-US',
    images: { sevenInchScreenshots: sets.seven, tenInchScreenshots: sets.ten }, manualImages: { chromebookScreenshots: sets.chromebook } } };
  return { root, sets, files, config };
}

function fakeClient() {
  const calls = [];
  return { calls, dryRun: true,
    async newEdit() { calls.push(['newEdit']); return 'e'; },
    async deleteAllImages(e, lang, type) { calls.push(['delete', lang, type]); },
    async uploadImage(e, lang, type, f) { calls.push(['upload', lang, type, path.basename(f)]); },
    async validate() { return { status: 200, json: {} }; },
    async deleteEdit() { calls.push(['deleteEdit']); },
    async commit() { throw new Error('a dry run never commits'); } };
}

async function quiet(fn) {
  const out = [];
  const { log, error } = console;
  console.log = (...a) => out.push(a.join(' ')); console.error = (...a) => out.push(a.join(' '));
  try { return { result: await fn(), out: out.join('\n') }; } finally { Object.assign(console, { log, error }); }
}

test('the 7-inch and 10-inch sets go to their own slots, and the Chromebook set is checked and named, not pushed', async () => {
  const { config, sets } = app();
  const client = fakeClient();
  const { result, out } = await quiet(() => run(config, client));
  assert.equal(result, true);
  const uploads = client.calls.filter((c) => c[0] === 'upload');
  assert.deepEqual([...new Set(uploads.map((c) => c[2]))], ['sevenInchScreenshots', 'tenInchScreenshots']);
  assert.equal(uploads.filter((c) => c[2] === 'sevenInchScreenshots').length, 4);
  assert.equal(uploads.filter((c) => c[2] === 'tenInchScreenshots').length, 4);
  assert.ok(!client.calls.some((c) => /chromebook/i.test(String(c[2]))), 'nothing is sent to a Chromebook slot');
  assert.match(out, /chromebookScreenshots: Play's API cannot take this set .* so it is not pushed\. 4 image\(s\) checked; upload the folder .*play-chromebook-plain by hand in Play Console/);
  assert.ok(out.includes(sets.chromebook));
});

test('a Chromebook set that breaks Play\'s rule refuses the fill before an edit is opened', async () => {
  const { config, sets } = app();
  png(path.join(sets.chromebook, '04.png'), 1920, 1200, { shade: 40 });
  png(path.join(sets.chromebook, '05.png'), 1920, 1080, { alpha: true });
  const client = fakeClient();
  const { result, out } = await quiet(() => run(config, client));
  assert.equal(result, false);
  assert.deepEqual(client.calls, []);
  assert.match(out, /04\.png: 1920x1200 is neither 16:9 nor 9:16/);
  assert.match(out, /05\.png: has an alpha channel/);
  assert.deepEqual(checkLargeScreenSet(sets.seven).problems, []);
});

test('the approval gate refuses a shot that is neither passed nor approved, and lets a cleared set through', async () => {
  const { root, config, files } = app();
  const approvals = path.join(root, 'references', 'approvals.json');
  const [held, ...cleared] = files;
  fs.mkdirSync(path.dirname(approvals), { recursive: true });
  const passed = Object.fromEntries(cleared.slice(1).map((f) => [sha(f), { kind: 'same' }]));
  fs.writeFileSync(approvals, JSON.stringify({ references: { 'play-tablet/x': { sha256: sha(cleared[0]) } }, accepted: {}, passed }));
  const gated = { ...config, compare: { approvals } };

  let client = fakeClient();
  let { result, out } = await quiet(() => run(gated, client));
  assert.equal(result, false);
  assert.deepEqual(client.calls, [], 'nothing is uploaded, not even the cleared shots');
  assert.match(out, new RegExp(`refused ${held.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: beyond its threshold or never compared, and not approved`));
  assert.match(out, /1 shot\(s\) are not cleared/);

  fs.writeFileSync(approvals, JSON.stringify({ references: {}, accepted: { [sha(held)]: {} }, passed: { ...passed, [sha(cleared[0])]: {} } }));
  client = fakeClient();
  ({ result } = await quiet(() => run(gated, client)));
  assert.equal(result, true);
  assert.equal(client.calls.filter((c) => c[0] === 'upload').length, 8);

  fs.rmSync(approvals);
  client = fakeClient();
  ({ result, out } = await quiet(() => run(gated, client)));
  assert.equal(result, false);
  assert.match(out, /no approvals file at .*: compare the shots first/);
});
