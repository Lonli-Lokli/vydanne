// Tests for `bridge` on zdymak's iOS 27 output, laid out exactly as zdymak's ios27-store-assets branch (d0c84c5) writes
// it — checked by running that branch's `zdymak screenshots`, not read from its README:
//   <out>/[<locale>/]appstore-iphone-duo-<display>/NN-<scene>.png   one folder per Duo target, NN per device's own scenes
//   <out>/[<locale>/][<dir>/]appstore-header.png | appstore-search.png | appstore-universal.png
//   <out>/<reel name>.mp4                                             reels, never localized; found by their destination
//   node --test scripts/bridge.test.mjs        (or: npm run check:bridge)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { run as bridge } from '../src/commands/bridge.mjs';
import { checkCreative } from '../src/creative.mjs';
import { SNAPSHOT_CATALOG } from '../src/assetCatalog.mjs';
import { quietly } from './fake-asc.mjs';
import { movie } from './media-fixtures.mjs';

const SIX = ['home', 'table', 'teach', 'lobby', 'plan', 'score'];

const png = (file, w, h) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 20, g: 90, b: 60 } } }).png().toFile(file);
};
const mp4 = (file, opts) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, movie(opts));
};

/** A project with an en-GB and de-DE listing; `zdymak` is the text of its zdymak.config.mjs, when it has one. */
function project({ zdymak = null, config = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vydanne-bridge-'));
  for (const l of ['en-GB', 'de-DE']) fs.mkdirSync(path.join(dir, 'fastlane', 'metadata', l), { recursive: true });
  if (zdymak) fs.writeFileSync(path.join(dir, 'zdymak.config.mjs'), zdymak);
  const out = (...p) => path.join(dir, 'store-assets', ...p);
  return { dir, out, config: { primaryLocale: 'en-GB', metadataDir: path.join(dir, 'fastlane', 'metadata'), screenshots: null, bridge: null, google: null, ...config } };
}

/** What zdymak writes for a Duo device of six scenes (outer) and one limited to four (inner, both orientations). */
async function duoOutput(out, locale = '') {
  for (const [i, s] of SIX.entries()) await png(out(locale, 'appstore-iphone-duo-outer', `0${i + 1}-${s}.png`), 1398, 2034);
  for (const [i, s] of SIX.slice(0, 4).entries()) {
    await png(out(locale, 'appstore-iphone-duo-inner', `0${i + 1}-${s}.png`), 2007, 2853);
    await png(out(locale, 'appstore-iphone-duo-inner-landscape', `0${i + 1}-${s}.png`), 2853, 2007);
  }
}

async function bridgeIn(dir, config, argv = []) {
  const cwd = process.cwd();
  const saved = process.argv;
  process.chdir(dir);
  process.argv = [saved[0], saved[1], 'bridge', ...argv];
  try {
    return await quietly(() => bridge(config));
  } finally {
    process.chdir(cwd);
    process.argv = saved;
  }
}

const listing = (dir, ...p) => {
  const root = path.join(dir, ...p);
  return fs.existsSync(root) ? fs.readdirSync(root, { recursive: true }).filter((f) => /\.\w+$/.test(f)).sort() : [];
};

// ── iPhone Duo on zdymak's real layout ─────────────────────────────────────────────────────────────

test('zdymak\'s four Duo targets are all known; 6 outer + 4 inner + 4 inner-landscape is refused for a set of ten', async () => {
  const p = project();
  await duoOutput(p.out);
  const { result, out } = await bridgeIn(p.dir, p.config);
  assert.equal(result, false);
  assert.match(out, /14 iphoneduo files for a set of 10/);
  assert.doesNotMatch(out, /ignored/, 'no Duo folder mistaken for a locale');
});

test('Vinto\'s set: 6 outer + 4 inner, by naming the two directories — ten, outer first', async () => {
  const p = project({ config: { bridge: { apple: { iphoneduo: { dirs: ['appstore-iphone-duo-outer', 'appstore-iphone-duo-inner'] } } } } });
  await duoOutput(p.out);
  const { result, out } = await bridgeIn(p.dir, p.config);
  assert.equal(result, true, out);
  assert.deepEqual(listing(p.dir, 'fastlane', 'screenshots', 'en-GB'), [
    ...SIX.map((s, i) => `iphoneduo_1-outer_0${i + 1}-${s}.png`),
    ...SIX.slice(0, 4).map((s, i) => `iphoneduo_2-inner_0${i + 1}-${s}.png`),
  ]);
});

test('…or by zdymak alone: a device whose `scenes` stop at four, and no landscape target, needs no bridge config', async () => {
  const p = project();
  await duoOutput(p.out);
  fs.rmSync(p.out('appstore-iphone-duo-inner-landscape'), { recursive: true });
  const { result, out } = await bridgeIn(p.dir, p.config);
  assert.equal(result, true, out);
  const got = listing(p.dir, 'fastlane', 'screenshots', 'en-GB');
  assert.equal(got.length, 10);
  // The default ranks all four Duo targets, so inner is third even when the outer-landscape one is absent.
  assert.deepEqual([got[0], got[6]], ['iphoneduo_1-outer_01-home.png', 'iphoneduo_3-inner_01-home.png']);
});

test('outer + inner-landscape, the other pairing Vinto could pick, labels the landscape files as such', async () => {
  const p = project({ config: { bridge: { apple: { iphoneduo: { dirs: ['appstore-iphone-duo-outer', 'appstore-iphone-duo-inner-landscape'] } } } } });
  await duoOutput(p.out);
  const { result } = await bridgeIn(p.dir, p.config);
  assert.equal(result, true);
  const got = listing(p.dir, 'fastlane', 'screenshots', 'en-GB');
  assert.equal(got.length, 10);
  assert.equal(got[6], 'iphoneduo_2-inner-landscape_01-home.png');
});

// ── header and search ─────────────────────────────────────────────────────────────────────────────

test('header and search graphics, primary and localized, land where `creative` reads them — and it accepts them', async () => {
  const p = project();
  await png(p.out('appstore-header.png'), 3840, 1646);
  await png(p.out('appstore-search.png'), 3840, 2560);
  await png(p.out('de', 'appstore-header.png'), 3840, 1646);
  await png(p.out('de', 'appstore-search.png'), 1920, 1280);
  const { result, out } = await bridgeIn(p.dir, p.config);
  assert.equal(result, true, out);
  assert.deepEqual(listing(p.dir, 'fastlane', 'creative'), ['de-DE/header.png', 'de-DE/search.png', 'en-GB/header.png', 'en-GB/search.png'].map((f) => f.split('/').join(path.sep)));
  const { plan, problems } = await checkCreative({ creative: { dir: path.join(p.dir, 'fastlane', 'creative') } }, SNAPSHOT_CATALOG);
  assert.deepEqual(problems, []);
  assert.equal(plan.length, 4);
});

test('the universal graphic becomes the header; searchFromHeader is what takes it to search, and the bridge says which', async () => {
  for (const searchFromHeader of [false, true]) {
    const p = project({ config: { creative: { searchFromHeader } } });
    await png(p.out('appstore-universal.png'), 5244, 2950);
    const { result, out } = await bridgeIn(p.dir, p.config);
    assert.equal(result, true, out);
    assert.deepEqual(listing(p.dir, 'fastlane', 'creative'), [path.join('en-GB', 'header.png')]);
    assert.match(out, searchFromHeader ? /placed in search results too .*: en-GB/ : /set creative\.searchFromHeader to place it there too: en-GB/);
    if (searchFromHeader) {
      const { plan } = await checkCreative({ creative: { dir: path.join(p.dir, 'fastlane', 'creative'), searchFromHeader } }, SNAPSHOT_CATALOG);
      assert.deepEqual(plan.map((x) => `${x.slot}${x.fromHeader ? '*' : ''}`), ['header', 'search*']);
    }
  }
});

test('a header reel is found by the destination zdymak.config.mjs gives it, whatever it is named', async () => {
  const zdymak = `export default { out: './store-assets', reel: [
    { name: 'vinto-header', destination: 'appstore-header-video', segments: [{ image: 'x.png' }] },
    { name: 'vinto-search', destination: 'appstore-search-video', segments: [{ image: 'x.png' }] },
  ] };`;
  const p = project({ zdymak });
  mp4(p.out('vinto-header.mp4'), { w: 3840, h: 1646, seconds: 10, fps: 30 });
  mp4(p.out('vinto-search.mp4'), { w: 2880, h: 1920, seconds: 8, fps: 60 });
  const { result, out } = await bridgeIn(p.dir, p.config);
  assert.equal(result, true, out);
  assert.deepEqual(listing(p.dir, 'fastlane', 'creative'), ['header.mp4', 'search.mp4'].map((f) => path.join('en-GB', f)));
});

test('an image and a reel for one slot is refused until the config names one — and naming it keeps the locales\' own images', async () => {
  const zdymak = `export default { reel: { name: 'vinto-header', destination: 'appstore-header-video', segments: [{ image: 'x.png' }] } };`;
  const p = project({ zdymak });
  mp4(p.out('vinto-header.mp4'), { w: 3840, h: 1646, seconds: 10, fps: 30 });
  await png(p.out('appstore-header.png'), 3840, 1646);
  await png(p.out('de', 'appstore-header.png'), 3840, 1646);

  let r = await bridgeIn(p.dir, p.config);
  assert.equal(r.result, false);
  assert.match(r.out, /en-GB: store-assets\/appstore-header\.png and store-assets\/vinto-header\.mp4 — both for the product page header, which holds one/);
  assert.equal(listing(p.dir, 'fastlane', 'creative').length, 0, 'nothing written');

  p.config.bridge = { creative: { header: 'vinto-header.mp4' } };
  r = await bridgeIn(p.dir, p.config);
  assert.equal(r.result, true, r.out);
  // The reel is the primary's header; German keeps the localized graphic zdymak rendered for it.
  assert.deepEqual(listing(p.dir, 'fastlane', 'creative'), [path.join('de-DE', 'header.png'), path.join('en-GB', 'header.mp4')]);
});

test('a creative file Apple would refuse stops the bridge before anything is copied, dry run or not', async () => {
  const p = project();
  await png(p.out('appstore-header.png'), 1920, 1080);
  mp4(p.out('appstore-search.mp4'), { w: 2880, h: 1920, seconds: 3, fps: 30 });
  for (const argv of [['--dry-run'], []]) {
    const { result, out } = await bridgeIn(p.dir, p.config, argv);
    assert.equal(result, false);
    assert.match(out, /appstore-header\.png — 1920×1080 — accepted: 5244×2950, 3840×1646/);
    assert.match(out, /appstore-search\.mp4 — 3\.00 s is shorter than 5 s/);
  }
  assert.equal(listing(p.dir, 'fastlane', 'creative').length, 0);
});

test('the creative folder is rebuilt when zdymak makes creative assets, and left alone when it makes none', async () => {
  // Owned: a header from an earlier run, for a locale zdymak no longer renders, does not survive.
  const p = project();
  await png(p.out('appstore-header.png'), 3840, 1646);
  await png(path.join(p.dir, 'fastlane', 'creative', 'fr-FR', 'header.png'), 3840, 1646);
  let r = await bridgeIn(p.dir, p.config);
  assert.equal(r.result, true, r.out);
  assert.deepEqual(listing(p.dir, 'fastlane', 'creative'), [path.join('en-GB', 'header.png')]);

  // Not owned: screenshots only, no creative output and none configured — a hand-placed header stays.
  const q = project();
  await png(q.out('appstore-iphone-6.9', '01-home.png'), 1320, 2868);
  await png(path.join(q.dir, 'fastlane', 'creative', 'en-GB', 'header.png'), 3840, 1646);
  r = await bridgeIn(q.dir, q.config);
  assert.equal(r.result, true, r.out);
  assert.deepEqual(listing(q.dir, 'fastlane', 'creative'), [path.join('en-GB', 'header.png')]);
});
