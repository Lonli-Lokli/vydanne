// Tests for the build-id check: a bundle or archive whose own id is not the app id the config names, or whose id
// cannot be read, is refused before any network call on both stores, and nothing (flag, option, env var) bypasses it.
//   node --test scripts/build-id.test.mjs        (or: npm run check:build-id)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { bundle, zipOf } from './aab-fixture.mjs';
import { buildIdProblem } from '../src/build-id.mjs';
import { readAabPackage } from '../src/play/aab.mjs';
import { run as runPlay } from '../src/play/commands/prerelease.mjs';
import { run as runApple, ipaBundleId } from '../src/commands/prerelease.mjs';

const tmp = (what) => fs.mkdtempSync(path.join(os.tmpdir(), `vydanne-build-id-${what}-`));
/** A client that fails the test on any call: the refusal must come before the network. */
const noNetwork = new Proxy({}, { get: (_, name) => () => { throw new Error(`network call: ${String(name)}`); } });
const quietly = async (fn) => {
  const { log, error } = console;
  console.log = console.error = () => {};
  try { return await fn(); } finally { console.log = log; console.error = error; }
};
async function withEnv(vars, fn) {
  const old = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try { return await fn(); } finally { for (const [k, v] of Object.entries(old)) v === undefined ? delete process.env[k] : (process.env[k] = v); }
}

test('the id must equal the config id, and an unreadable id is a problem too', () => {
  assert.equal(buildIdProblem('bundle', 'com.example.app', 'com.example.app'), null);
  assert.match(buildIdProblem('bundle', 'com.example.app.debug', 'com.example.app'), /this bundle is com\.example\.app\.debug, but this config uploads com\.example\.app/);
  assert.match(buildIdProblem('archive', null, 'com.example.app'), /could not read this archive/);
});

test('the bundle says its own package, from the empty-namespace attribute', () => {
  const dir = tmp('aab');
  assert.equal(readAabPackage(bundle(dir, 'com.example.app')), 'com.example.app');
  assert.equal(readAabPackage(bundle(dir, 'com.example.app.debug')), 'com.example.app.debug');
  fs.writeFileSync(path.join(dir, 'junk.aab'), 'not a bundle');
  assert.equal(readAabPackage(path.join(dir, 'junk.aab')), null);
});

test('Play: a differing-id bundle is refused before any network call, whatever the environment says', async () => {
  const dir = tmp('play');
  bundle(dir, 'com.example.app.debug');
  const config = { google: { packageName: 'com.example.app', aab: dir, metadataDir: path.join(dir, 'meta'), defaultLocale: 'en-GB', track: 'internal' } };
  for (const env of [{}, { VYDANNE_FORCE: '1', VYDANNE_ALLOW_ANY: '1', FORCE: '1' }]) {
    assert.equal(await withEnv(env, () => quietly(() => runPlay(config, noNetwork))), false);
  }
});

test('Play: a release bundle passes the check and reaches Play', async () => {
  const dir = tmp('play-ok');
  bundle(dir, 'com.example.app');
  const config = { google: { packageName: 'com.example.app', aab: dir, metadataDir: path.join(dir, 'meta'), defaultLocale: 'en-GB', track: 'internal' } };
  await assert.rejects(quietly(() => runPlay(config, noNetwork)), /network call: newEdit/);
});

/** An .ipa (a zip) holding Payload/App.app/Info.plist; needs the `zip` tool, so macOS only like the command. */
function ipa(dir, id) {
  fs.mkdirSync(path.join(dir, 'Payload', 'App.app'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Payload', 'App.app', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${id}</string>` +
    `<key>CFBundleVersion</key><string>7</string></dict></plist>`);
  const file = path.join(dir, `${id}.ipa`);
  execFileSync('zip', ['-qr', file, 'Payload'], { cwd: dir });
  return file;
}

const mac = { skip: process.platform !== 'darwin' && 'the iOS upload is macOS-only' };

test('iOS: the archive says its own CFBundleIdentifier', mac, async () => {
  const dir = tmp('ipa');
  assert.equal(await ipaBundleId(ipa(dir, 'com.example.app')), 'com.example.app');
});

test('iOS: a differing-id archive is refused before any network call, whatever the environment says', mac, async () => {
  const dir = tmp('ipa-other');
  const file = ipa(dir, 'com.example.app.debug');
  for (const env of [{ VYDANNE_IPA: file }, { VYDANNE_IPA: file, VYDANNE_FORCE: '1', VYDANNE_ALLOW_ANY: '1' }]) {
    assert.equal(await withEnv(env, () => quietly(() => runApple({ bundleId: 'com.example.app', ios: {} }, noNetwork, {}))), false);
  }
});

test('iOS: a release archive passes the check and reaches App Store Connect', mac, async () => {
  const dir = tmp('ipa-ok');
  const file = ipa(dir, 'com.example.app');
  await assert.rejects(withEnv({ VYDANNE_IPA: file }, () => quietly(() => runApple({ bundleId: 'com.example.app', ios: {} }, noNetwork, {}))), /network call: findApp/);
});

test('Play: a bundle whose id cannot be read is refused, before any network call', async () => {
  const dir = tmp('play-unreadable');
  const config = { google: { packageName: 'com.example.app', aab: dir, metadataDir: path.join(dir, 'meta'), defaultLocale: 'en-GB', track: 'internal' } };
  for (const content of [zipOf('base/other.txt', Buffer.from('x')), zipOf('base/manifest/AndroidManifest.xml', Buffer.from('garbage \xff\xff')), Buffer.from('not a zip')]) {
    fs.writeFileSync(path.join(dir, 'a.aab'), content);
    assert.equal(await quietly(() => runPlay(config, noNetwork)), false);
  }
});

test('iOS: an archive with no CFBundleIdentifier is refused, before any network call', mac, async () => {
  const dir = tmp('ipa-noid');
  fs.mkdirSync(path.join(dir, 'Payload', 'App.app'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Payload', 'App.app', 'Info.plist'),
    '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleVersion</key><string>7</string></dict></plist>');
  const file = path.join(dir, 'x.ipa');
  execFileSync('zip', ['-qr', file, 'Payload'], { cwd: dir });
  assert.equal(await withEnv({ VYDANNE_IPA: file }, () => quietly(() => runApple({ bundleId: 'com.example.app', ios: {} }, noNetwork, {}))), false);
});
