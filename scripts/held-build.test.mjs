// Tests for a build number the store already holds: attaching the held build is right only when it IS this binary.
// A different binary carrying a used number is refused loudly on both stores, so the new one is never silently
// replaced by the old one.
//   node --test scripts/held-build.test.mjs        (or: npm run check:held-build)
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { bundle } from './aab-fixture.mjs';
import { run as runPlay } from '../src/play/commands/prerelease.mjs';
import { run as runApple } from '../src/commands/prerelease.mjs';

const tmp = (what) => fs.mkdtempSync(path.join(os.tmpdir(), `vydanne-held-${what}-`));
async function captured(fn) {
  const { log, error } = console;
  const out = [];
  console.log = console.error = (...a) => out.push(a.join(' '));
  try { return { result: await fn(), out: out.join('\n') }; } finally { console.log = log; console.error = error; }
}
async function withEnv(vars, fn) {
  const old = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  try { return await fn(); } finally { for (const [k, v] of Object.entries(old)) v === undefined ? delete process.env[k] : (process.env[k] = v); }
}

/** An .ipa whose CFBundleVersion is 7. */
function ipa(dir) {
  fs.mkdirSync(path.join(dir, 'Payload', 'App.app'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Payload', 'App.app', 'Info.plist'),
    '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.example.app</string>' +
    '<key>CFBundleVersion</key><string>7</string></dict></plist>');
  const file = path.join(dir, 'app.ipa');
  execFileSync('zip', ['-qr', file, 'Payload'], { cwd: dir });
  return file;
}

/** App Store Connect already holding build 7, with an editable version 1.4 pointing at nothing. */
function appleHolding7() {
  const calls = [];
  const held = { id: 'b7', attributes: { version: '7', processingState: 'VALID' } };
  return {
    calls,
    appId: 'app1',
    dryRun: false,
    async findApp() {},
    async get(p) {
      calls.push(['GET', p]);
      if (p.startsWith('/v1/builds')) return { json: { data: [held] } };
      if (p.endsWith('/build?fields[builds]=version')) return { json: { data: null } };
      if (p.includes('/betaGroups')) return { json: { data: [] } };
      throw new Error(`unexpected GET ${p}`);
    },
    async editVersion() { return { id: 'v1', attributes: { versionString: '1.4', appStoreState: 'PREPARE_FOR_SUBMISSION' } }; },
    async patch(p, body) { calls.push(['PATCH', p, body]); return { status: 200, json: {} }; },
    async post(p, body) { calls.push(['POST', p, body]); return { status: 201, json: {} }; },
  };
}

const mac = { skip: process.platform !== 'darwin' && 'the iOS upload is macOS-only' };

test('iOS: a build number App Store Connect already holds is refused, not attached', mac, async () => {
  const file = ipa(tmp('ipa'));
  const client = appleHolding7();
  const { result, out } = await withEnv({ VYDANNE_IPA: file, VYDANNE_ATTACH_HELD: undefined },
    () => captured(() => runApple({ bundleId: 'com.example.app', ios: {} }, client, {})));
  assert.equal(result, false, out);
  assert.match(out, /refusing: build 7 is already on App Store Connect/);
  assert.deepEqual(client.calls.filter(([m]) => m !== 'GET'), [], 'nothing attached');
});

test('iOS: VYDANNE_ATTACH_HELD=1 says it is the same binary, and the held build is attached', mac, async () => {
  const file = ipa(tmp('ipa-same'));
  const client = appleHolding7();
  const { result, out } = await withEnv({ VYDANNE_IPA: file, VYDANNE_ATTACH_HELD: '1' },
    () => captured(() => runApple({ bundleId: 'com.example.app', ios: {} }, client, {})));
  assert.equal(result, true, out);
  assert.deepEqual(client.calls.filter(([m]) => m === 'PATCH').map(([, p, b]) => [p, b.data.id]),
    [['/v1/appStoreVersions/v1/relationships/build', 'b7']]);
});

/** Play holding versionCode 7 with the given sha256: the upload is refused as Play refuses it. */
function playHolding7(sha256) {
  const calls = [];
  return {
    calls,
    dryRun: false,
    async newEdit() { return 'e1'; },
    async uploadBundle() { throw new Error('bundle upload 403: {"error":{"message":"APK specifies a version code that has already been used. Version code 7 has already been used."}}'); },
    async listBundles(editId) { calls.push(['listBundles', editId]); return { status: 200, json: { bundles: [{ versionCode: 7, sha256 }] } }; },
    async putTrack(editId, track, releases) { calls.push(['putTrack', track, releases]); return { status: 200, json: {} }; },
    async commit() { calls.push(['commit']); return { status: 200, json: {} }; },
    async deleteEdit() { calls.push(['deleteEdit']); return { status: 204, json: {} }; },
  };
}

function playConfig(dir) {
  return { google: { packageName: 'com.example.app', aab: dir, metadataDir: path.join(dir, 'meta'), defaultLocale: 'en-GB', track: 'internal' } };
}

test('Play: a versionCode Play holds for a DIFFERENT bundle is refused, not reused', async () => {
  const dir = tmp('play-other');
  bundle(dir, 'com.example.app');
  const client = playHolding7('0'.repeat(64));
  const { result, out } = await captured(() => runPlay(playConfig(dir), client));
  assert.equal(result, false, out);
  assert.match(out, /versionCode 7 is already on Play, and it is a different bundle/);
  assert.equal(client.calls.some(([m]) => m === 'putTrack' || m === 'commit'), false, 'no track written');
});

test('Play: a versionCode Play holds for THIS bundle is reused (promoting to another track)', async () => {
  const dir = tmp('play-same');
  const file = bundle(dir, 'com.example.app');
  const client = playHolding7(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
  const { result, out } = await captured(() => runPlay(playConfig(dir), client));
  assert.equal(result, true, out);
  assert.deepEqual(client.calls.find(([m]) => m === 'putTrack')[2][0].versionCodes, ['7']);
  assert.ok(client.calls.some(([m]) => m === 'commit'));
});
