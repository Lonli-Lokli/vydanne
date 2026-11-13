// Tests for buildCommit: a build number that is a commit count names the commit with that many ancestors, also on a
// history with merges, where the Nth line of `rev-list --reverse` is a different commit.
//   node --test scripts/build-commit.test.mjs        (or: npm run check:build-commit)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { commitOrder, commitForBuild } from '../src/buildCommit.mjs';

const git = (dir, ...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
const commit = (dir, msg, date) =>
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', msg],
    { cwd: dir, env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });

/**
 * master: a1 . . a2 a3 a4 merge(7) a8, and a branch b2 b3 off a1, committed BEFORE a2 in time, merged at 7. So
 * `rev-list --reverse` reads a1 b2 b3 a2 a3 a4 m a8: its 4th line is a2, with 2 ancestors, while a4 has the 4.
 */
function mergedRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vydanne-build-commit-'));
  git(dir, 'init', '-q', '-b', 'master');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 't');
  commit(dir, 'a1', '2026-01-01T00:00:00');
  git(dir, 'checkout', '-q', '-b', 'side');
  commit(dir, 'b2', '2026-01-02T00:00:00');
  commit(dir, 'b3', '2026-01-03T00:00:00');
  git(dir, 'checkout', '-q', 'master');
  commit(dir, 'a2', '2026-01-04T00:00:00');
  commit(dir, 'a3', '2026-01-05T00:00:00');
  commit(dir, 'a4', '2026-01-06T00:00:00');
  execFileSync('git', ['merge', '-q', '--no-ff', '-m', 'm', 'side'],
    { cwd: dir, env: { ...process.env, GIT_AUTHOR_DATE: '2026-01-07T00:00:00', GIT_COMMITTER_DATE: '2026-01-07T00:00:00' } });
  commit(dir, 'a8', '2026-01-08T00:00:00');
  return dir;
}

function inDir(dir, fn) {
  const old = process.cwd();
  process.chdir(dir);
  try { return fn(); } finally { process.chdir(old); }
}

test('every build number names the commit with that many ancestors, on a history with merges', () => {
  const dir = mergedRepo();
  inDir(dir, () => {
    const order = commitOrder();
    const head = Number(git(dir, 'rev-list', '--count', 'HEAD'));
    for (let n = 1; n <= head; n++) {
      const found = commitForBuild(order, n);
      // No commit has 5 or 6 ancestors here; every other count is master's and must resolve.
      if (!found.sha) {
        assert.ok([5, 6].includes(n), `build ${n}: ${found.why}`);
        continue;
      }
      assert.equal(Number(git(dir, 'rev-list', '--count', found.sha)), n, `build ${n} named ${found.sha}`);
    }
  });
});

test('a build on master names master\'s commit, not a side branch\'s with the same count', () => {
  const dir = mergedRepo();
  inDir(dir, () => {
    const subject = (n) => git(dir, 'log', '-1', '--format=%s', commitForBuild(commitOrder(), n).sha);
    assert.equal(subject(2), 'a2');
    assert.equal(subject(3), 'a3');
    assert.equal(subject(4), 'a4');
    assert.equal(subject(8), 'a8');
  });
});

test('the offset and the bounds still refuse with their reasons', () => {
  const dir = mergedRepo();
  inDir(dir, () => {
    const order = commitOrder();
    assert.match(commitForBuild(order, 99).why, /past HEAD/);
    assert.match(commitForBuild(order, 0).why, /below the first commit/);
    assert.equal(git(dir, 'log', '-1', '--format=%s', commitForBuild(order, 108, 100).sha), 'a8');
  });
});
