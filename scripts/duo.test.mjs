// Tests for iPhone Duo screenshots: the slot, the April 2027 rule, and `bridge` carrying zdymak's outer and inner
// targets into ONE set in a chosen order — and refusing a wrong size or more files than the set holds.
//   node --test scripts/duo.test.mjs        (or: npm run check:duo)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { IOS_DEVICE, duoRequired, DUO_REQUIRED_FROM, localScreenshots } from '../src/screenshots.mjs';
import { SNAPSHOT_CATALOG, SCREENSHOT_GROUP, describeSize, matchFile } from '../src/assetCatalog.mjs';
import { run as bridge, dirLabels, mergedName } from '../src/commands/bridge.mjs';
import { run as fill } from '../src/commands/fill.mjs';
import { preflightStore, withStore, client, quietly } from './fake-asc.mjs';

const png = (file, w, h) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 20, g: 90, b: 60 } } }).png().toFile(file);
};


/** A project with zdymak's output under store-assets/ and an en-GB listing, cwd moved into it for the bridge. */
async function project(dirs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vydanne-duo-'));
  fs.mkdirSync(path.join(dir, 'fastlane', 'metadata', 'en-GB'), { recursive: true });
  for (const [name, [w, h], scenes] of dirs) {
    for (const s of scenes) await png(path.join(dir, 'store-assets', name, s), w, h);
  }
  const config = { primaryLocale: 'en-GB', metadataDir: path.join(dir, 'fastlane', 'metadata'), screenshots: null, bridge: null, google: null };
  return { dir, config };
}

async function inProject(dir, argv, fn) {
  const cwd = process.cwd();
  const saved = process.argv;
  process.chdir(dir);
  process.argv = [saved[0], saved[1], 'bridge', ...argv];
  try {
    return await fn();
  } finally {
    process.chdir(cwd);
    process.argv = saved;
  }
}

const OUTER = [1398, 2034];
const INNER = [2007, 2853];
const INNER_LANDSCAPE = [2853, 2007];

test('the iphoneduo prefix selects APP_IPHONE_DUO, and that set is one group holding all four sizes, ten files', () => {
  assert.equal(IOS_DEVICE.iphoneduo, 'APP_IPHONE_DUO');
  assert.equal(SCREENSHOT_GROUP.APP_IPHONE_DUO, 'IPHONE_DUO_PROFILE');
  const sizes = SNAPSHOT_CATALOG.screenshotSpecs('APP_IPHONE_DUO').map(describeSize).sort();
  assert.deepEqual(sizes, ['1398×2034', '2007×2853', '2034×1398', '2853×2007']);
  assert.equal(SNAPSHOT_CATALOG.screenshotLimit('APP_IPHONE_DUO'), 10);
});

test('Duo is optional before April 2027 and required from its first day', () => {
  assert.equal(DUO_REQUIRED_FROM, '2027-04-01');
  assert.equal(duoRequired(new Date('2026-10-12T12:00:00Z')), false);
  assert.equal(duoRequired(new Date('2027-03-31T23:59:59Z')), false);
  assert.equal(duoRequired(new Date('2027-04-01T00:00:00Z')), true);
});

test('a Duo file is matched to its size, and a 6.9" screenshot is refused in the Duo set', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vydanne-duo-size-'));
  const specs = SNAPSHOT_CATALOG.screenshotSpecs('APP_IPHONE_DUO');
  for (const [w, h] of [OUTER, [2034, 1398], INNER, INNER_LANDSCAPE]) {
    const f = path.join(dir, `ok-${w}.png`);
    await png(f, w, h);
    assert.ok((await matchFile(f, specs)).spec, `${w}×${h} accepted`);
  }
  const wrong = path.join(dir, 'iphone69.png');
  await png(wrong, 1320, 2868);
  const m = await matchFile(wrong, specs);
  assert.match(m.problem, /1320×2868 — accepted: .*1398×2034/);
});

test('labels drop the prefix the directories share, at a hyphen', () => {
  assert.deepEqual(dirLabels(['appstore-iphone-duo-outer', 'appstore-iphone-duo-inner', 'appstore-iphone-duo-inner-landscape']), ['outer', 'inner', 'inner-landscape']);
  assert.deepEqual(dirLabels(['duo-outer-plain']), ['duo-outer-plain']);
});

test('merged names sort into the order asked for', () => {
  const display = [
    mergedName('iphoneduo', 1, 'inner', '01-home.png'),
    mergedName('iphoneduo', 0, 'outer', '02-table.png'),
    mergedName('iphoneduo', 0, 'outer', '01-home.png'),
  ].sort();
  assert.deepEqual(display, ['iphoneduo_1-outer_01-home.png', 'iphoneduo_1-outer_02-table.png', 'iphoneduo_2-inner_01-home.png']);
  const scene = [
    mergedName('iphoneduo', 0, 'outer', '02-table.png', 'scene'),
    mergedName('iphoneduo', 1, 'inner', '01-home.png', 'scene'),
    mergedName('iphoneduo', 0, 'outer', '01-home.png', 'scene'),
  ].sort();
  assert.deepEqual(scene, ['iphoneduo_01-home_1-outer.png', 'iphoneduo_01-home_2-inner.png', 'iphoneduo_02-table_1-outer.png']);
  for (const n of [...display, ...scene]) assert.equal(IOS_DEVICE[n.split('_')[0]], 'APP_IPHONE_DUO', `${n} is read by fill as Duo`);
});

test('bridge merges zdymak\'s outer and inner Duo targets into one set, outer first by default', async () => {
  const { dir, config } = await project([
    ['appstore-iphone-duo-outer', OUTER, ['01-home.png', '02-table.png']],
    ['appstore-iphone-duo-inner', INNER, ['01-home.png', '02-table.png']],
    ['appstore-iphone-6.9', [1320, 2868], ['01-home.png']],
  ]);
  const { result } = await inProject(dir, [], () => quietly(() => bridge(config)));
  assert.equal(result, true);
  const got = fs.readdirSync(path.join(dir, 'fastlane', 'screenshots', 'en-GB')).sort();
  assert.deepEqual(got, [
    'iphone69_01-home.png',
    'iphoneduo_1-outer_01-home.png',
    'iphoneduo_1-outer_02-table.png',
    'iphoneduo_2-inner_01-home.png',
    'iphoneduo_2-inner_02-table.png',
  ]);
  // What fill, diff and preflight then see: one APP_IPHONE_DUO set of four, in that order.
  const local = await inProject(dir, [], async () => localScreenshots('IOS', 'en-GB', config));
  assert.deepEqual([...local.APP_IPHONE_DUO.keys()], got.filter((f) => f.startsWith('iphoneduo_')));
});

test('bridge.apple.iphoneduo chooses the directories and the scene order', async () => {
  const { dir, config } = await project([
    ['appstore-iphone-duo-outer', OUTER, ['01-home.png', '02-table.png']],
    ['appstore-iphone-duo-inner-landscape', INNER_LANDSCAPE, ['01-home.png']],
    ['appstore-iphone-duo-inner', INNER, ['01-home.png']],
  ]);
  config.bridge = { apple: { iphoneduo: { dirs: ['appstore-iphone-duo-outer', 'appstore-iphone-duo-inner-landscape'], order: 'scene' } } };
  const { result } = await inProject(dir, [], () => quietly(() => bridge(config)));
  assert.equal(result, true);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'fastlane', 'screenshots', 'en-GB')).sort(), [
    'iphoneduo_01-home_1-outer.png',
    'iphoneduo_01-home_2-inner-landscape.png',
    'iphoneduo_02-table_1-outer.png',
  ]);
});

test('more Duo files than the set holds is refused before anything is copied', async () => {
  const scenes = ['01-a.png', '02-b.png', '03-c.png', '04-d.png', '05-e.png', '06-f.png'];
  const { dir, config } = await project([
    ['appstore-iphone-duo-outer', OUTER, scenes],
    ['appstore-iphone-duo-inner', INNER, scenes],
  ]);
  const { result, out } = await inProject(dir, [], () => quietly(() => bridge(config)));
  assert.equal(result, false);
  assert.match(out, /12 iphoneduo files for a set of 10/);
  assert.ok(!fs.existsSync(path.join(dir, 'fastlane', 'screenshots')), 'nothing written');
});

test('a capture of the wrong size is refused by name, and a dry run reports the same refusal', async () => {
  const { dir, config } = await project([
    ['appstore-iphone-duo-outer', [1320, 2868], ['01-home.png']],
  ]);
  for (const argv of [['--dry-run'], []]) {
    const { result, out } = await inProject(dir, argv, () => quietly(() => bridge(config)));
    assert.equal(result, false);
    assert.match(out, /1320×2868 — iphoneduo takes .*1398×2034/);
  }
  assert.ok(!fs.existsSync(path.join(dir, 'fastlane', 'screenshots')));
});

test('a merged slot with an order nobody implemented is refused, not quietly ordered by display', async () => {
  const { dir, config } = await project([['appstore-iphone-duo-outer', OUTER, ['01-home.png']]]);
  config.bridge = { apple: { iphoneduo: { dirs: ['appstore-iphone-duo-outer'], order: 'random' } } };
  const { result, out } = await inProject(dir, [], () => quietly(() => bridge(config)));
  assert.equal(result, false);
  assert.match(out, /order is 'random'/);
});

test('fill refuses a Duo set of eleven before uploading any of it, uploads the sets that fit, and fails the run', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vydanne-duo-fill-'));
  const shots = path.join(dir, 'shots', 'en-GB');
  fs.mkdirSync(shots, { recursive: true });
  for (let i = 1; i <= 11; i++) fs.writeFileSync(path.join(shots, `iphoneduo_1-outer_${String(i).padStart(2, '0')}.png`), '');
  fs.writeFileSync(path.join(shots, 'iphone69_01-home.png'), '');
  const config = { bundleId: 'app.example', primaryLocale: 'en-GB', platforms: ['IOS'], metadataDir: path.join(dir, 'meta'), screenshots: { IOS: path.join(dir, 'shots'), MAC_OS: path.join(dir, 'mac') } };
  const c = client(true);
  const s = preflightStore();
  const { result, out } = await withStore(s, () => quietly(() => fill(config, c)), { VYDANNE_SKIP_METADATA: '1' });
  assert.equal(result, false);
  assert.match(out, /en-GB\/APP_IPHONE_DUO: 11 files for a set of 10 — none uploaded/);
  const sets = c.planned.filter((p) => p.path === '/v1/appScreenshotSets').map((p) => p.attributes.screenshotDisplayType);
  assert.deepEqual(sets, ['APP_IPHONE_67'], 'the 6.9" set went ahead; no Duo set was created');
  assert.deepEqual(s.calls.filter((x) => x.method !== 'GET'), [], 'a dry run');
});
