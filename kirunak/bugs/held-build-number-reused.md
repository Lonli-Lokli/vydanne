---
id: vydanne/held-build-number-reused
title: prerelease reuses a held build number for a different binary
written: 2026-11-13
quad-damage: yes
---

## Who raised it
found by the agent: katyafm/release-1-0's review (S-16, E-3) read vydanne 1.4.0 and saw a build number a store already
holds reused in silence instead of refused; asked, the owner answered "B: later, as a bug" (owner, 2026-11-13, session
5914cfed-f941-41fd-b3ea-f7e788cd28cc).

## Why
`vydanne prerelease` treats an iOS build number App Store Connect already holds as "already uploaded" and attaches the
held build, and on Play it catches "Version code N has already been used" and reuses the held bundle for any local
file. When the local archive is a different binary with a used number, the old binary is what testers and review get,
and the new one never reaches the store, with a green line saying all is well. Seen by running prerelease with an
archive whose number the store holds (the new test below fails that way without the fix).

## What was found
- iOS: `alreadyUp = held.has(String(declared))` prints "already uploaded — skipping the transfer, attaching it below" and attaches the held build [file src/commands/prerelease.mjs]
- Play: "Version code N has already been used" is caught and the held bundle reused, with a comment claiming it "can't diverge from the file" [file src/play/commands/prerelease.mjs]
- App Store Connect keeps no hash of a build's binary, so iOS cannot tell the same binary from a new one; Play lists each bundle's sha256 [file src/play/client.mjs]
- The katyafm review's finding, E-3 not met [file ~/sources/katyafm/kirunak/tasks/release-1-0/review.md]
- Before the fix, 2 of the 4 new tests failed: iOS "already uploaded — skipping the transfer ... actual: true, expected: false"; Play "versionCode 7 already uploaded — reusing that bundle ... actual: true, expected: false" [command node --test scripts/held-build.test.mjs]
- After the fix: 4 pass, 0 fail; `npm run verify` exits 0, fail 0 in all 11 test files [command node --test scripts/held-build.test.mjs]

## Fix written
- iOS refuses a held build number before any transfer, naming both ways on (bump CFBundleVersion, or VYDANNE_ATTACH_HELD=1 for the same binary after `withdraw`); Play compares the held bundle's sha256 with the local .aab, reuses the same bundle (promotion to another track keeps working), refuses a different one with the edit discarded, and refuses an unlisted one unless VYDANNE_ATTACH_HELD=1; scripts/held-build.test.mjs in `npm run verify`; README.md and SKILL.md updated [commit 73578be]

## Questions
1. Goal: a build number a store already holds is refused loudly unless the operator says it is the same binary. Yes or no?
   Proposed: yes; it is katyafm/release-1-0's E-3, moved here by its amendment A-1.
2. Is VYDANNE_ATTACH_HELD=1, in the shape of VYDANNE_REPLACE=1, the right way to say "same binary"?
   Proposed: yes; App Store Connect gives no hash to compare, so only the operator can say it, and Play needs it only when it lists no hash.
3. Plan: review the diff on bug/held-build-number-reused and merge it; every app picks it up with its next vydanne install.
   Proposed: yes; no app code changes, and build numbers are master's commit count, so it bites only on a rebuilt commit or a BUILD_NUMBER override.
