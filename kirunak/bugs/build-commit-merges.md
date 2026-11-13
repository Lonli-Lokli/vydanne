---
id: vydanne/build-commit-merges
title: releases cannot name a build's commit once history has merges
written: 2026-11-13
quad-damage: yes
---

## Who raised it
> Also our repo missing tags corresponding to each release, so I don't even know mappings between releases and commits
owner, 2026-11-13, session eed1e45b-6449-4545-a692-9acd92a20262

## Why
`vydanne releases` (and `--store google`) names the commit each store build came from, so a release can be tagged.
In Vodar it refuses build 797, App Store 1.5 and Play 1.3, with "commit 100517d22 has 777 ancestors, not 797 —
build number is not a commit count here", although c2547e2 on master has exactly 797 ancestors and is the commit
the build report names. `commitForBuild` takes the Nth line of `git rev-list --reverse HEAD`, which on a history
with merges is not the commit with N ancestors, then rightly refuses it. To see it: `npm run store:releases` in
~/sources/game-deduction at master 4139e9e.

## What was found
- Vodar's App Store 1.5 build 797 and Play 1.3 versionCode 797 both print the refusal above; builds 108 to 177 resolve [command npm run -s store:releases; npm run -s play:releases, in ~/sources/game-deduction, 2026-11-13]
- c2547e2 is the only commit in every ref and reflog with 797 ancestors, and the build report says both 797 builds were cut there [file ~/sources/game-deduction/kirunak/tasks/core-and-pick-motion/steps/S-23e/report.md:3]
- The lookup indexes `order[n - 1]`, where `order` is `rev-list --reverse HEAD`; the module's own comment already says that is right only by luck on a linear repo [file src/buildCommit.mjs:92]
- A test repo with a branch committed before the mainline commits it later merges with reproduces it: build 4 named a2 (2 ancestors) or was refused; failing before the fix, 2 of 3 tests, and passing after, 3 of 3; `npm run verify` passes [command node --test scripts/build-commit.test.mjs]
- With the fix, Vodar's builds 108, 131, 142, 152, 162, 177 and 797 resolve to the commits its tags name (797 to c2547e2) [command node -e commitForBuild over game-deduction, on bug/build-commit-merges]

## Fix written
- `commitForBuild` searches for the commit with N ancestors: a binary search along HEAD's first-parent line, where the count grows every step, then any other commit nearest the Nth line; the new test `scripts/build-commit.test.mjs` is wired as `check:build-commit` into `verify` [commit b37b283]

## Questions
1. Should this be fixed as its own task?
   Proposed: yes, as this bug: merge bug/build-commit-merges after its review. Goal: `releases` names the right commit for every build number that is a commit count, on any history.
2. What are the acceptance criteria?
   Proposed: AC-1 on a history with merges every build number that some commit carries as its ancestor count resolves to that commit, the mainline one first; AC-2 a count no commit carries is still refused with its reason; AC-3 the offset and bounds keep their messages; AC-4 Vodar's 797 resolves to c2547e2.
3. Which edge cases?
   Proposed: E-1 a build cut on a side branch merged later (falls back to a non-mainline commit); E-2 a squashed history with an offset; E-3 a shallow clone (out of scope: the build itself refuses one).
4. Which aspects are in?
   Proposed: vydanne's `releases` on both stores only; nothing touches a store; docs n/a beyond the module comment.
5. The plan?
   Proposed: review the diff on bug/build-commit-merges, merge it, publish vydanne as its release script says.
