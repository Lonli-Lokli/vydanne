// Tests for several tracks in one `prerelease --store google` (src/play/tracks.mjs and the Play command).
//   node --test scripts/tracks.test.mjs        (or: npm run check:tracks)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describeTracks, parseTracks } from '../src/play/tracks.mjs';
import { bundle } from './aab-fixture.mjs';
import { run } from '../src/play/commands/prerelease.mjs';

test('one name, a comma list or an array, trimmed and without repeats', () => {
  assert.deepEqual(parseTracks('internal'), ['internal']);
  assert.deepEqual(parseTracks('alpha, internal'), ['alpha', 'internal']);
  assert.deepEqual(parseTracks(['alpha', ' internal ', 'alpha']), ['alpha', 'internal']);
  assert.deepEqual(parseTracks(' , ,'), []);
  assert.deepEqual(parseTracks(undefined), []);
  assert.equal(describeTracks(['alpha', 'internal']), '"alpha", "internal"');
});

/** A repo with a bundle (no versionCode on purpose) and next.txt notes. */
function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vydanne-tracks-'));
  fs.mkdirSync(path.join(dir, 'dist'));
  bundle(path.join(dir, 'dist'), 'app.example.tracks'); // readable id, no versionCode: Play's answer is then the versionCode
  for (const locale of ['en-GB', 'de-DE']) {
    fs.mkdirSync(path.join(dir, 'meta', locale, 'changelogs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'meta', locale, 'changelogs', 'next.txt'), `What changed (${locale}).`);
  }
  const config = { google: { packageName: 'app.example.tracks', aab: path.join(dir, 'dist'), metadataDir: path.join(dir, 'meta'), defaultLocale: 'en-GB' } };
  return { dir, config };
}

/** A Play client that records every call; `failOn` makes that track's update fail. */
function client({ failOn = null, dryRun = false } = {}) {
  const calls = [];
  return {
    calls,
    dryRun,
    async newEdit() { calls.push(['newEdit']); return 'edit-1'; },
    async uploadBundle(editId) { calls.push(['upload', editId]); return { versionCode: 7 }; },
    async putTrack(editId, track, releases) {
      calls.push(['putTrack', editId, track, releases]);
      return track === failOn ? { status: 403, json: { error: { message: 'no' } } } : { status: 200, json: {} };
    },
    async commit(editId) { calls.push(['commit', editId]); return { status: 200, json: {} }; },
    async deleteEdit(editId) { calls.push(['deleteEdit', editId]); },
  };
}

async function quietly(fn) {
  const { log, error } = console;
  console.log = () => {};
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
    console.error = error;
  }
}

function withEnv(env, fn) {
  const saved = {};
  for (const k of ['VYDANNE_TRACK', 'VYDANNE_AAB', 'VYDANNE_STATUS', 'VYDANNE_RELEASE_NAME']) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  Object.assign(process.env, env);
  return fn().finally(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

test('two tracks: one edit, one upload, the same release on each, one commit, notes archived once', async () => {
  const { dir, config } = repo();
  config.google.track = ['alpha', 'internal'];
  const play = client();
  const ok = await withEnv({}, () => quietly(() => run(config, play)));
  assert.equal(ok, true);
  const names = play.calls.map((c) => c[0]);
  assert.deepEqual(names, ['newEdit', 'upload', 'putTrack', 'putTrack', 'commit']);
  const puts = play.calls.filter((c) => c[0] === 'putTrack');
  assert.deepEqual(puts.map((c) => c[2]), ['alpha', 'internal']);
  assert.deepEqual(puts[0][3], puts[1][3], 'both tracks got the same release');
  assert.deepEqual(puts[0][3][0].versionCodes, ['7']);
  assert.equal(puts[0][3][0].releaseNotes.length, 2);
  for (const locale of ['en-GB', 'de-DE']) {
    const cl = path.join(dir, 'meta', locale, 'changelogs');
    assert.deepEqual(fs.readdirSync(cl).sort(), ['7.txt'], `${locale}: next.txt archived as 7.txt, once`);
  }
});

test('VYDANNE_TRACK takes a comma list, and overrides the config', async () => {
  const { config } = repo();
  config.google.track = 'internal';
  const play = client();
  await withEnv({ VYDANNE_TRACK: 'alpha,internal' }, () => quietly(() => run(config, play)));
  assert.deepEqual(play.calls.filter((c) => c[0] === 'putTrack').map((c) => c[2]), ['alpha', 'internal']);
});

test('a track that fails leaves every track untouched: no commit, the edit deleted, next.txt kept', async () => {
  const { dir, config } = repo();
  config.google.track = 'alpha,internal';
  const play = client({ failOn: 'internal' });
  const ok = await withEnv({}, () => quietly(() => run(config, play)));
  assert.equal(ok, false);
  const names = play.calls.map((c) => c[0]);
  assert.ok(!names.includes('commit'), 'nothing committed');
  assert.equal(names.at(-1), 'deleteEdit');
  assert.ok(fs.existsSync(path.join(dir, 'meta', 'en-GB', 'changelogs', 'next.txt')), 'notes not archived');
});

test('production anywhere in the list is refused before any edit opens', async () => {
  const { config } = repo();
  config.google.track = ['alpha', 'production'];
  const play = client();
  const ok = await withEnv({}, () => quietly(() => run(config, play)));
  assert.equal(ok, false);
  assert.deepEqual(play.calls, []);
});

test('a dry run writes both tracks into the edit, then discards it and archives nothing', async () => {
  const { dir, config } = repo();
  config.google.track = ['alpha', 'internal'];
  const play = client({ dryRun: true });
  const ok = await withEnv({}, () => quietly(() => run(config, play)));
  assert.equal(ok, true);
  assert.deepEqual(play.calls.map((c) => c[0]), ['newEdit', 'upload', 'putTrack', 'putTrack', 'deleteEdit']);
  assert.ok(fs.existsSync(path.join(dir, 'meta', 'en-GB', 'changelogs', 'next.txt')));
});
