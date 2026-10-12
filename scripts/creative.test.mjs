// Tests for the iOS 27 product page header and search results asset: the MP4 probe, validation against Apple's catalog,
// the local-vs-store comparison, and `creative` itself — run through the REAL client with `fetch` mocked, so the dry-run
// gate is the one that ships, and nothing can reach App Store Connect.
//   node --test scripts/creative.test.mjs        (or: npm run check:creative)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { probeVideo } from '../src/mp4.mjs';
import { SNAPSHOT_CATALOG, Catalog, loadCatalog, matchFile, isoSeconds } from '../src/assetCatalog.mjs';
import { checkCreative, compareCreative, localCreative } from '../src/creative.mjs';
import { md5FromReference, referenceFor } from '../src/assetLibrary.mjs';
import { md5 } from '../src/upload.mjs';
import { quietly, store, withStore, client, preflightStore } from './fake-asc.mjs';
import { run as creative } from '../src/commands/creative.mjs';
import { run as preflight } from '../src/commands/preflight.mjs';

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────────

const box = (type, ...parts) => {
  const payload = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + payload.length, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, payload]);
};
const u32 = (...n) => { const b = Buffer.alloc(4 * n.length); n.forEach((v, i) => b.writeUInt32BE(v >>> 0, i * 4)); return b; };
const IDENTITY = u32(0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000);

/** A movie with only the boxes Apple's checks need: duration, a video track of w×h at fps, optionally sound. */
function movie({ w, h, seconds, fps, audio = false }) {
  const scale = 600;
  const mvhd = box('mvhd', u32(0, 0, 0, scale, seconds * scale, 0x10000), Buffer.from([1, 0]), Buffer.alloc(10), IDENTITY, Buffer.alloc(24), u32(3));
  const trak = (handler, samples, width, height) => box('trak',
    box('tkhd', u32(0, 0, 0, 1, 0, seconds * scale), Buffer.alloc(8), Buffer.alloc(8), IDENTITY, u32(width * 65536, height * 65536)),
    box('mdia',
      box('mdhd', u32(0, 0, 0, scale, seconds * scale), Buffer.alloc(4)),
      box('hdlr', u32(0, 0), Buffer.from(handler, 'latin1'), Buffer.alloc(12), Buffer.from('x\0')),
      box('minf', box('stbl', box('stts', u32(0, 1, samples, Math.round((seconds * scale) / samples)))))));
  return Buffer.concat([
    box('ftyp', Buffer.from('isom'), u32(0), Buffer.from('isom')),
    box('moov', mvhd, trak('vide', Math.round(seconds * fps), w, h), ...(audio ? [trak('soun', seconds * 44, 0, 0)] : [])),
    box('mdat', Buffer.alloc(16)),
  ]);
}

const image = (file, w, h, { alpha = false, seed = 1 } = {}) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return sharp({ create: { width: w, height: h, channels: alpha ? 4 : 3, background: { r: seed * 40 % 255, g: 90, b: 60, alpha: 0.5 } } })
    .toFormat(path.extname(file) === '.png' ? 'png' : 'jpeg').toFile(file);
};

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `vydanne-${name}-`));

// ── the probe and the catalog ────────────────────────────────────────────────────────────────────────

test('the MP4 probe reads size, duration, frame rate and sound from the boxes', () => {
  const dir = tmp('mp4');
  const f = path.join(dir, 'h.mp4');
  fs.writeFileSync(f, movie({ w: 3840, h: 1646, seconds: 10, fps: 30, audio: true }));
  assert.deepEqual(probeVideo(f), { width: 3840, height: 1646, duration: 10, fps: 30, hasAudio: true });
  fs.writeFileSync(f, movie({ w: 1920, h: 1280, seconds: 6, fps: 60 }));
  assert.deepEqual(probeVideo(f), { width: 1920, height: 1280, duration: 6, fps: 60, hasAudio: false });
  fs.writeFileSync(f, 'not a movie');
  assert.equal(probeVideo(f), null);
});

test('ISO durations', () => {
  assert.equal(isoSeconds('PT5S'), 5);
  assert.equal(isoSeconds('PT30S'), 30);
  assert.equal(isoSeconds('PT1M'), 60);
  assert.equal(isoSeconds('nonsense'), null);
});

test('header and search files are matched to Apple\'s specs, and every refusal says why', async () => {
  const dir = tmp('specs');
  const header = SNAPSHOT_CATALOG.specsFor('PRODUCT_PAGE_HEADER_ASSET', 'DEFAULT_PROFILE');
  const search = SNAPSHOT_CATALOG.specsFor('APP_STORE_SEARCH_RESULTS_ASSET', 'DEFAULT_PROFILE');
  const f = (n) => path.join(dir, n);

  await image(f('wide.png'), 3840, 1646);
  assert.equal((await matchFile(f('wide.png'), header)).spec.shortName, 'i3840x1646a0');
  await image(f('universal.png'), 5244, 2950);
  assert.equal((await matchFile(f('universal.png'), header)).spec.universalAsset, true);
  assert.equal((await matchFile(f('universal.png'), search)).spec.universalAsset, true);
  await image(f('s.jpg'), 2400, 1600);
  assert.ok((await matchFile(f('s.jpg'), search)).spec, 'a 3:2 JPEG inside the range');

  await image(f('small.png'), 1920, 1080);
  assert.match((await matchFile(f('small.png'), header)).problem, /1920×1080 — accepted: 5244×2950, 3840×1646/);
  await image(f('tall.png'), 1920, 2560);
  assert.match((await matchFile(f('tall.png'), search)).problem, /accepted: .*\(3:2\)/);
  // The catalog takes the 21:9 header as PNG only — Apple's help page says JPEG too; the catalog is what processes it.
  await image(f('wide.jpg'), 3840, 1646);
  assert.match((await matchFile(f('wide.jpg'), header)).problem, /\.jpg is not accepted here \(\.png\)/);
  await image(f('alpha.png'), 3840, 1646, { alpha: true });
  assert.match((await matchFile(f('alpha.png'), header)).problem, /alpha/);

  fs.writeFileSync(f('h.mp4'), movie({ w: 3840, h: 1646, seconds: 12, fps: 30 }));
  assert.equal((await matchFile(f('h.mp4'), header)).spec.kind, 'video');
  fs.writeFileSync(f('short.mp4'), movie({ w: 3840, h: 1646, seconds: 4, fps: 30 }));
  assert.match((await matchFile(f('short.mp4'), header)).problem, /shorter than 5 s/);
  fs.writeFileSync(f('slow.mp4'), movie({ w: 3840, h: 1646, seconds: 10, fps: 24 }));
  assert.match((await matchFile(f('slow.mp4'), header)).problem, /24 fps is not 30 or 60 fps/);
  fs.writeFileSync(f('s.mov'), movie({ w: 1920, h: 1280, seconds: 8, fps: 60 }));
  assert.ok((await matchFile(f('s.mov'), search)).spec, 'a 3:2 60 fps search video');
});

test('the live catalog wins, and a failure falls back to the snapshot and says why', async () => {
  const live = { status: 200, json: { data: [{ id: '1', attributes: { ...SNAPSHOT_CATALOG.attributes, imageSpecs: [] } }] } };
  const c1 = await loadCatalog({ get: async () => live });
  assert.equal(c1.source, 'live');
  assert.equal(c1.specsFor('PRODUCT_PAGE_HEADER_ASSET', 'DEFAULT_PROFILE').every((s) => s.kind === 'video'), true);
  const c2 = await loadCatalog({ get: async () => ({ status: 403, json: {} }) });
  assert.equal(c2.source, 'snapshot');
  assert.match(c2.why, /403/);
  assert.ok(new Catalog(SNAPSHOT_CATALOG.attributes) instanceof Catalog);
});

// ── local discovery and comparison ───────────────────────────────────────────────────────────────────

test('local creative: per App Store locale, strays and unknown files named, two files in one slot refused', async () => {
  const dir = tmp('local');
  const base = path.join(dir, 'creative');
  await image(path.join(base, 'en-GB', 'header.png'), 5244, 2950);
  await image(path.join(base, 'de-DE', 'header.png'), 3840, 1646);
  fs.writeFileSync(path.join(base, 'de-DE', 'header.mp4'), movie({ w: 3840, h: 1646, seconds: 10, fps: 30 }));
  await image(path.join(base, 'de', 'header.png'), 3840, 1646);
  fs.writeFileSync(path.join(base, 'en-GB', 'notes.txt'), 'x');
  const config = { creative: { dir: base, searchFromHeader: true } };

  const local = localCreative(config);
  assert.deepEqual(local.strays, ['de']);
  assert.deepEqual(local.unknown, [path.join('en-GB', 'notes.txt')]);
  const { plan, problems } = await checkCreative(config, SNAPSHOT_CATALOG);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /de-DE: 2 files for the product page header/);
  // The universal en-GB header is placed in search results too, because searchFromHeader is on.
  assert.deepEqual(plan.map((p) => `${p.locale}/${p.slot}${p.fromHeader ? '*' : ''}`), ['en-GB/header', 'en-GB/search*']);
});

test('searchFromHeader with a header that is not universal is a refusal, not a silent skip', async () => {
  const dir = tmp('fromheader');
  await image(path.join(dir, 'en-GB', 'header.png'), 3840, 1646);
  const { plan, problems } = await checkCreative({ creative: { dir, searchFromHeader: true } }, SNAPSHOT_CATALOG);
  assert.deepEqual(plan.map((p) => p.slot), ['header']);
  assert.match(problems[0], /not a universal asset/);
});

test('the md5 rides in the reference name, and the comparison sorts every case apart', () => {
  const sum = 'a'.repeat(32);
  assert.equal(md5FromReference(referenceFor('/x/header.png', sum)), sum);
  assert.equal(md5FromReference('a name typed in App Store Connect'), null);
  const plan = [{ slot: 'header', file: '/x/header.png', md5: sum }, { slot: 'search', file: '/x/search.png', md5: 'b'.repeat(32) }];
  const placed = (type, ref, state = 'PARENT_PREPARE_FOR_SUBMISSION') => ({ placementType: type, state, asset: { fileName: 'f.png', referenceName: ref, state: 'PREPARE_FOR_SUBMISSION' } });
  assert.deepEqual(compareCreative(plan, [
    placed('PRODUCT_PAGE_HEADER_ASSET', referenceFor('header.png', sum)),
    placed('APP_STORE_SEARCH_RESULTS_ASSET', referenceFor('search.png', 'c'.repeat(32))),
  ]).map((f) => `${f.slot}:${f.kind}`), ['search:stale']);
  assert.deepEqual(compareCreative(plan, []).map((f) => f.kind), ['missing', 'missing']);
  assert.deepEqual(compareCreative(plan, [placed('PRODUCT_PAGE_HEADER_ASSET', 'typed by hand')]).map((f) => `${f.slot}:${f.kind}`), ['header:unverified', 'search:missing']);
  assert.deepEqual(compareCreative([], [placed('PRODUCT_PAGE_HEADER_ASSET', 'x', 'FAILED')]).map((f) => f.kind), ['failed']);
  assert.deepEqual(compareCreative([], [placed('APP_STORE_SEARCH_RESULTS_ASSET', 'x')]).map((f) => f.kind), ['remoteOnly']);
});

// ── the command, through the real client ────────────────────────────────────────────────────────────

async function creativeProject() {
  const dir = tmp('cmd');
  const base = path.join(dir, 'creative');
  await image(path.join(base, 'en-GB', 'header.png'), 5244, 2950, { seed: 2 });
  fs.writeFileSync(path.join(base, 'en-GB', 'search.mp4'), movie({ w: 1920, h: 1280, seconds: 8, fps: 30 }));
  await image(path.join(base, 'de-DE', 'header.png'), 5244, 2950, { seed: 2 }); // the same bytes as en-GB's
  const config = { bundleId: 'app.example', primaryLocale: 'en-GB', platforms: ['IOS'], creative: { dir: base, searchFromHeader: false, poster: '00:00:02:00' } };
  return { dir, base, config };
}

test('a dry run plans every upload and placement, uploads identical bytes once, and sends only GETs', async () => {
  const { config } = await creativeProject();
  const s = store();
  const c = client(true);
  const { result, out } = await withStore(s, () => quietly(() => creative(config, c)));
  assert.equal(result, true, out);
  assert.deepEqual(s.calls.filter((x) => x.method !== 'GET'), [], 'nothing but reads left the process');
  const planned = c.planned.map((p) => `${p.method} ${p.path}`);
  // Locales run in order, so de-DE uploads the header and en-GB — the same bytes — places that asset rather than a copy.
  assert.deepEqual(planned, [
    'POST /v1/appAssetLibraryImages', 'PATCH /v1/appAssetLibraryImages/dry-run-1', 'POST /v1/appAssetLibraryPlacements',
    'POST /v1/appAssetLibraryPlacements',
    'POST /v1/appAssetLibraryVideos', 'PATCH /v1/appAssetLibraryVideos/dry-run-5', 'POST /v1/appAssetLibraryPlacements',
  ]);
  const reserve = c.planned[0].attributes;
  assert.equal(reserve.category, 'CREATIVE_ASSETS');
  assert.equal(md5FromReference(reserve.referenceName), md5(fs.readFileSync(path.join(config.creative.dir, 'en-GB', 'header.png'))));
  assert.equal(c.planned[4].attributes.previewFrameTimeCode, '00:00:02:00');
  assert.deepEqual(c.planned[2].attributes, { placementType: 'PRODUCT_PAGE_HEADER_ASSET', placementGroup: 'DEFAULT_PROFILE' });
  assert.deepEqual(c.planned[6].attributes, { placementType: 'APP_STORE_SEARCH_RESULTS_ASSET', placementGroup: 'DEFAULT_PROFILE' });
  assert.match(out, /de-DE\/header: would upload header\.png \(image, 5244×2950\)/);
  assert.match(out, /en-GB\/header: reusing library asset dry-run-1/);
});

test('an applied run reserves, uploads the bytes, commits with uploaded alone, places, and waits for processing', async () => {
  const { config } = await creativeProject();
  delete config.creative.poster;
  fs.rmSync(path.join(config.creative.dir, 'de-DE'), { recursive: true });
  fs.rmSync(path.join(config.creative.dir, 'en-GB', 'search.mp4'));
  const s = store();
  const { result, out } = await withStore(s, () => quietly(() => creative(config, client(false))));
  assert.equal(result, true, out);
  const writes = s.calls.filter((x) => x.method !== 'GET').map((x) => `${x.method} ${x.path}`);
  assert.deepEqual(writes, ['POST /v1/appAssetLibraryImages', 'PUT /asset-1', 'PATCH /v1/appAssetLibraryImages/asset-1', 'POST /v1/appAssetLibraryPlacements']);
  const commit = s.calls.find((x) => x.method === 'PATCH').body;
  assert.deepEqual(commit.data.attributes, { uploaded: true }, 'no checksum: the library has none');
  const placement = s.calls.find((x) => x.path === '/v1/appAssetLibraryPlacements').body.data.relationships;
  assert.deepEqual(placement.image.data, { type: 'appAssetLibraryImages', id: 'asset-1' });
  assert.deepEqual(placement.appStoreVersionLocalization.data, { type: 'appStoreVersionLocalizations', id: 'loc-en' });
  assert.ok(s.calls.some((x) => x.method === 'GET' && x.path === '/v1/appAssetLibraryImages/asset-1'), 'processing checked');
});

test('a slot already showing this exact file is left alone; another file is skipped unless VYDANNE_REPLACE=1', async () => {
  const { config } = await creativeProject();
  fs.rmSync(path.join(config.creative.dir, 'de-DE'), { recursive: true });
  fs.rmSync(path.join(config.creative.dir, 'en-GB', 'search.mp4'));
  const sum = md5(fs.readFileSync(path.join(config.creative.dir, 'en-GB', 'header.png')));
  const same = { id: 'p1', loc: 'loc-en', placementType: 'PRODUCT_PAGE_HEADER_ASSET', asset: { id: 'a1', fileName: 'header.png', referenceName: referenceFor('header.png', sum), state: 'APPROVED' } };
  let c = client(true);
  let r = await withStore(store({ placements: [same] }), () => quietly(() => creative(config, c)));
  assert.equal(r.result, true);
  assert.match(r.out, /already shows header\.png — in sync/);
  assert.deepEqual(c.planned, []);

  const other = { ...same, asset: { ...same.asset, id: 'a0', fileName: 'old.png', referenceName: 'old.png' } };
  c = client(true);
  r = await withStore(store({ placements: [other] }), () => quietly(() => creative(config, c)));
  assert.match(r.out, /already shows old\.png, skipping \(set VYDANNE_REPLACE=1/);
  assert.deepEqual(c.planned, []);

  c = client(true);
  r = await withStore(store({ placements: [other], library: [{ id: 'kept', kind: 'image', state: 'APPROVED', referenceName: referenceFor('header.png', sum) }] }),
    () => quietly(() => creative(config, c)), { VYDANNE_REPLACE: '1' });
  assert.equal(r.result, true, r.out);
  // The old placement goes, the library's existing copy of these bytes is placed — no second upload.
  assert.deepEqual(c.planned.map((p) => `${p.method} ${p.path}`), ['DELETE /v1/appAssetLibraryPlacements/p1', 'POST /v1/appAssetLibraryPlacements']);
  assert.match(r.out, /reusing library asset kept/);
});

test('an invalid file refuses the whole run before any request that writes', async () => {
  const { config } = await creativeProject();
  await image(path.join(config.creative.dir, 'de-DE', 'search.png'), 1000, 1000);
  const c = client(true);
  const s = store();
  const { result, out } = await withStore(s, () => quietly(() => creative(config, c)));
  assert.equal(result, false);
  assert.match(out, /de-DE: search\.png — 1000×1000 — accepted:/);
  assert.deepEqual(c.planned, []);
});

test('with no version being prepared it refuses and prints the App Store Connect route instead', async () => {
  const { config } = await creativeProject();
  const c = client(true);
  const { result, out } = await withStore(store({ version: null }), () => quietly(() => creative(config, c)));
  assert.equal(result, false);
  assert.match(out, /no editable iOS version/);
  assert.match(out, /Asset Library → \+ → Upload Creative Assets/);
  assert.match(out, /Header and Search Results/);
  assert.deepEqual(c.planned, []);
});

test('no local creative assets is a quiet success — both slots are optional', async () => {
  const c = client(true);
  const config = { bundleId: 'app.example', primaryLocale: 'en-GB', platforms: ['IOS'], creative: { dir: path.join(tmp('none'), 'creative') } };
  const { result, out } = await withStore(store(), () => quietly(() => creative(config, c)));
  assert.equal(result, true);
  assert.match(out, /nothing to place\. Both slots are optional/);
});

// ── preflight: Duo optional, creative slots optional, a local file not on the store a blocker ──────────

test('preflight: no Duo set on an iPhone listing is a note until April 2027, and empty creative slots are a note', async () => {
  const dir = tmp('pf');
  const config = {
    bundleId: 'app.example', primaryLocale: 'en-GB', platforms: ['IOS'], metadataDir: path.join(dir, 'meta'),
    screenshots: { IOS: path.join(dir, 'shots'), MAC_OS: path.join(dir, 'mac') }, creative: { dir: path.join(dir, 'creative') },
    resolvedLocales: { supported: {}, unsupported: [], invalid: [] }, allowCrossStoreTerms: [],
  };
  fs.mkdirSync(config.metadataDir, { recursive: true });
  const s = preflightStore({ sets: [{ type: 'APP_IPHONE_67', files: ['iphone69_01.png'] }] });
  const { result, out } = await withStore(s, () => quietly(() => preflight(config, client(false))));
  assert.equal(result, true, out);
  assert.match(out, /no iPhone Duo screenshots — optional until 2027-04-01/);
  assert.match(out, /product page header and search results asset not set \(optional/);
  assert.deepEqual(s.calls.filter((x) => x.method !== 'GET'), []);
});

test('preflight: a local header the store does not show is a blocker', async () => {
  const dir = tmp('pf2');
  await image(path.join(dir, 'creative', 'en-GB', 'header.png'), 3840, 1646);
  const config = {
    bundleId: 'app.example', primaryLocale: 'en-GB', platforms: ['IOS'], metadataDir: path.join(dir, 'meta'),
    screenshots: { IOS: path.join(dir, 'shots'), MAC_OS: path.join(dir, 'mac') }, creative: { dir: path.join(dir, 'creative') },
    resolvedLocales: { supported: {}, unsupported: [], invalid: [] }, allowCrossStoreTerms: [],
  };
  fs.mkdirSync(config.metadataDir, { recursive: true });
  const s = preflightStore({ sets: [{ type: 'APP_IPHONE_DUO', files: ['iphoneduo_1-outer_01.png'] }, { type: 'APP_IPHONE_67', files: ['iphone69_01.png'] }] });
  const { result, out } = await withStore(s, () => quietly(() => preflight(config, client(false))));
  assert.equal(result, false);
  assert.match(out, /en-GB: product page header header\.png is not on the store/);
  assert.doesNotMatch(out, /no iPhone Duo screenshots/);
});
