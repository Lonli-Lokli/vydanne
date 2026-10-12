// Tests for reading the store's screenshot sets (src/screenshots.mjs) — what `diff` and `preflight` compare against.
//   node --test scripts/screenshots.test.mjs        (or: npm run check:screenshots)
import test from 'node:test';
import assert from 'node:assert/strict';
import { remoteScreenshots, compareShots } from '../src/screenshots.mjs';

/** A client whose one answer is a localization's screenshot sets, shaped as App Store Connect returns them. */
const storeWith = (sets) => ({
  async get() {
    return {
      status: 200,
      json: {
        data: sets.map((s, i) => ({ id: `set${i}`, attributes: { screenshotDisplayType: s.type }, relationships: { appScreenshots: { data: s.files.map((_, j) => ({ type: 'appScreenshots', id: `${i}-${j}` })) } } })),
        included: sets.flatMap((s, i) => s.files.map(([fileName, sum], j) => ({ type: 'appScreenshots', id: `${i}-${j}`, attributes: { fileName, sourceFileChecksum: sum } }))),
      },
    };
  },
});

// Reported from Vinto 1.4 (2026-10-12): the 6.9" set on the store held NINE screenshots — 02-table, 04-lobby and
// 06-score each twice — against six local files, and `diff` said "in sync" while `preflight` said "no blockers". The
// store set was read into a Map keyed by file name, so the second copy of a name overwrote the first and the count
// came out six. A listing about to be submitted with three duplicate screenshots must not read as matching.
test('a store set holding the same file twice is not in sync with a local set holding it once', async () => {
  const names = ['01-home', '02-table', '03-teach', '04-lobby', '05-plan', '06-score'].map((n) => `iphone69_${n}.png`);
  const local = new Map(names.map((n) => [n, `sum-${n}`]));
  const onStore = [...names, 'iphone69_02-table.png', 'iphone69_04-lobby.png', 'iphone69_06-score.png'].map((n) => [n, `sum-${n}`]);
  const remote = await remoteScreenshots(storeWith([{ type: 'APP_IPHONE_67', files: onStore }]), 'loc');
  assert.equal(remote.APP_IPHONE_67.size, 9, 'every screenshot on the store is counted');
  assert.deepEqual(compareShots(local, remote.APP_IPHONE_67), { kind: 'count', local: 6, remote: 9 });
});

test('a store set matching the local one name for name and byte for byte is still in sync', async () => {
  const files = [['iphoneduo_1-outer_01-home.png', 'a'], ['iphoneduo_2-inner_01-home.png', 'b']];
  const remote = await remoteScreenshots(storeWith([{ type: 'APP_IPHONE_DUO', files }]), 'loc');
  assert.equal(compareShots(new Map(files), remote.APP_IPHONE_DUO), null);
});
