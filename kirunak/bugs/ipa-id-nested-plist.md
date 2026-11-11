---
id: vydanne/ipa-id-nested-plist
title: TestFlight upload reads the Watch app's id and refuses the build
written: 2026-11-11
quad-damage: yes
---

## Who raised it
found by the agent: `vydanne prerelease --config vydanne.ios.config.mjs --apply` refused Asilak 1.5 (2014) with
"refusing: this archive is com.asilak.app.watch, but this config uploads com.asilak.app.", though the archive is the
iPhone app's.

## Why
`ipaPlistKey` reads `unzip -p <ipa> 'Payload/*.app/Info.plist'`. unzip's `*` also matches `/`, so the pattern takes
every nested Info.plist (a Watch app's, a resource bundle's), and plutil keeps the first one stored. When Xcode's
export stores the Watch app's plist first, every TestFlight upload of the app is refused. Seen with
`unzip -l Asilak-2014.ipa | grep Info.plist`.

## What was found
- The pattern matched two plists in Asilak-2014.ipa, the Watch app's stored first [command unzip -p build/Asilak-2014.ipa 'Payload/*.app/Info.plist' | grep -c '<plist']
- The reader [file src/commands/prerelease.mjs]
- The new test failed before the fix: actual 'com.example.app.watch', expected 'com.example.app' [commit e173a01]
- After the fix scripts/build-id.test.mjs passes 10 of 10, and the real archive reads com.asilak.app; the other test files pass but three that need sharp, absent from the worktree [commit 3cc5700]

## Fix written
- A test with a Watch app's Info.plist stored before the app's, red before the fix [commit e173a01]
- `ipaPlistKey` lists the archive (`unzip -Z1`) and reads only `Payload/<name>.app/Info.plist` [commit 3cc5700]

## Questions
1. Goal: prerelease reads the app's own Info.plist, whatever else the archive holds?
   Proposed: yes.
2. Criteria: the test above passes and fails without the fix; Asilak 1.5 (2014) uploads?
   Proposed: yes.
3. Aspects: no UI, no locale, no store text: all n/a?
   Proposed: yes.
4. Plan: review the two commits, merge.
   Proposed: yes; the fix exists.
