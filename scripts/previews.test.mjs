// `finishPreviews`: an App Preview is done only once Apple has drawn its poster image. Niva's 1.7 previews read
// COMPLETE with a 0×0 image after their poster was set through the API, and App Store Connect showed tiles that
// never loaded (2026-10-14). The client here is a script of what App Store Connect answered, read by read.
//   node --test scripts/previews.test.mjs        (or: npm run check:previews)
import test from 'node:test';
import assert from 'node:assert/strict';
import { finishPreviews } from '../src/upload.mjs';

const IMG = (n) => ({ templateUrl: `https://is1-ssl.mzstatic.com/image/thumb/Video/${n}.png/{w}x{h}bb.{f}`, width: 886, height: 1920 });
const NONE = { templateUrl: 'https://is1-ssl.mzstatic.com/image/thumb//{w}x{h}bb.{f}', width: 0, height: 0 };

/** A client whose preview `id` answers each GET with the next of `reads` (the last one repeats). */
function fake(reads) {
  const seen = {};
  const patches = [];
  return {
    patches,
    async get(p) {
      const id = p.split('/').pop();
      const list = reads[id];
      const i = Math.min(seen[id] = (seen[id] ?? -1) + 1, list.length - 1);
      return { json: { data: { id, attributes: list[i] } } };
    },
    async patch(p, body) { patches.push({ p, code: body.data.attributes.previewFrameTimeCode }); return { status: 200, json: {} }; },
  };
}
const clock = () => { let t = 0; return { now: () => t, sleep: async (ms) => { t += ms; } }; };
const ready = (extra) => ({ videoUrl: 'https://v', assetDeliveryState: { state: 'COMPLETE' }, ...extra });

test('without a poster, a preview is done once Apple has its own frame and image', async () => {
  const c = fake({ p1: [{ assetDeliveryState: { state: 'UPLOAD_COMPLETE' } }, ready({ previewFrameTimeCode: '00:00:05:01', previewImage: IMG(1) })] });
  const [r] = await finishPreviews(c, [{ id: 'p1', label: 'IOS/de-DE/IPHONE_67' }], clock());
  assert.equal(r.ok, true);
  assert.equal(r.frame, '00:00:05:01');
  assert.equal(c.patches.length, 0, 'no poster asked for, none set');
});

test('a poster that never gets its image fails, naming the tile that never loads', async () => {
  const c = fake({ p1: [ready({ previewFrameTimeCode: '00:00:05:01', previewImage: IMG(1) }),
    ready({ previewFrameTimeCode: '00:00:08:00', previewImage: NONE, previewFrameImage: { state: { state: 'COMPLETE' } } })] });
  const [r] = await finishPreviews(c, [{ id: 'p1', label: 'IOS/en-GB/IPHONE_67', poster: '00:00:08:00' }], clock());
  assert.equal(c.patches.length, 1);
  assert.equal(r.ok, false);
  assert.match(r.why, /no poster image .* never loads\. Leave `poster` out/);
});

test('Apple’s earlier image is not taken for the poster that was asked for', async () => {
  // Right after the poster is set, the old frame's image is still there; then Apple draws the new one.
  const c = fake({ p1: [ready({ previewFrameTimeCode: '00:00:05:01', previewImage: IMG(1) }),
    ready({ previewFrameTimeCode: '00:00:08:00', previewImage: IMG(1) }),
    ready({ previewFrameTimeCode: '00:00:08:00', previewImage: IMG(2) })] });
  const [r] = await finishPreviews(c, [{ id: 'p1', label: 'x', poster: '00:00:08:00' }], clock());
  assert.equal(r.ok, true);
  assert.equal(r.frame, '00:00:08:00');
});

test('every upload is waited on together, and a failed one says why', async () => {
  const c = fake({
    a: [ready({ previewFrameTimeCode: '00:00:05:01', previewImage: IMG(1) })],
    b: [{ assetDeliveryState: { state: 'FAILED', errors: [{ code: 'VIDEO_TOO_SHORT', description: 'too short' }] } }],
  });
  const out = await finishPreviews(c, [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], clock());
  assert.deepEqual(out.map((r) => [r.label, r.ok]).sort(), [['A', true], ['B', false]]);
  assert.match(out.find((r) => r.label === 'B').why, /too short/);
});

// ── preflight ─────────────────────────────────────────────────────────────────────────────────────────

import { previewProblems } from '../src/commands/previews.mjs';

test('preflight: a missing preview and one with no poster image are blockers; a drawn one is not', async () => {
  const sets = {
    'loc-en': { data: [{ attributes: { previewType: 'IPHONE_67' }, relationships: { appPreviews: { data: [{ id: 'e' }] } } }],
      included: [{ type: 'appPreviews', id: 'e', attributes: { assetDeliveryState: { state: 'COMPLETE' }, previewFrameTimeCode: '00:00:08:00', previewImage: NONE } }] },
    'loc-de': { data: [{ attributes: { previewType: 'IPHONE_67' }, relationships: { appPreviews: { data: [{ id: 'd' }] } } }],
      included: [{ type: 'appPreviews', id: 'd', attributes: { assetDeliveryState: { state: 'COMPLETE' }, previewFrameTimeCode: '00:00:05:01', previewImage: IMG(1) } }] },
    'loc-fr': { data: [] },
  };
  const client = { async get(p) { return { json: sets[p.split('/')[3]] }; } };
  const locs = ['en-GB', 'de-DE', 'fr-FR'].map((locale) => ({ id: `loc-${locale.slice(0, 2)}`, attributes: { locale } }));
  const config = { primaryLocale: 'en-GB', previews: [{ platform: 'IOS', type: 'IPHONE_67', locales: ['en-GB', 'de-DE', 'fr-FR'] }] };
  const problems = await previewProblems(client, config, 'IOS', locs);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /^IOS\/en-GB\/IPHONE_67: preview has no poster image \(frame 00:00:08:00\)/);
  assert.match(problems[1], /^IOS\/fr-FR\/IPHONE_67: no App Preview/);
});
