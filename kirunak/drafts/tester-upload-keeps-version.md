---
id: vydanne/tester-upload-keeps-version
title: A tester upload that leaves the prepared App Store version's build alone
written: 2026-11-12
---

## Who raised it
found by the agent: on 2026-11-12 at 02:40, session 7eb5cf8c-3637-4d00-bf8b-7981d19004f9 (katyafm/licence-certificate S-13) uploaded KatyaFM build 878, from an unmerged branch, to TestFlight with the owner's word to upload it for their own check on a phone. `vydanne prerelease --apply` also moved App Store Connect's version 1.0 from build 839, the build the owner chose for the 1.0 release, to 878. Nothing was submitted.

## Why
A tester build and the release build are often different builds at the same time: one session prepares a release on a chosen build while another puts a branch in testers' hands. Today every TestFlight upload re-points the prepared version, and so does any later `prepare --apply` (it takes the newest uploaded build). The release then goes out on whichever build was uploaded last, unless someone notices the build field in App Store Connect before submitting. The same can happen on Play: an internal-track upload replaces the whole internal track. This is a change to how vydanne behaves, not a fault: the attach is documented. So it is a task of its own, in vydanne, not part of the KatyaFM work that ran into it.

## What was found
- The upload printed "version 1.0: build 839 -> build 878" and "Submitting for App Store review stays manual" [file /private/tmp/claude-501/-Users-volha-sources-gulnya/7eb5cf8c-3637-4d00-bf8b-7981d19004f9/scratchpad/s13/testflight.log]
- `run()` ends with an unconditional `await pointVersionAtBuild(client, config, build);`, after the TestFlight group assignment [file src/commands/prerelease.mjs:260]
- `pointVersionAtBuild` skips only when no version is editable, the version is in LOCKED_STATES (WAITING_FOR_REVIEW and later), or it already holds this build; otherwise it PATCHes `/v1/appStoreVersions/<id>/relationships/build` and prints the "from -> to" line after the change [file src/commands/prerelease.mjs:342-376]
- No flag, environment variable or config key skips the attach or names the build to attach; VYDANNE_IPA picks only which .ipa is uploaded [file src/commands/prerelease.mjs:53]
- `prepare --apply` attaches the newest uploaded build on the platform (`sort=-uploadedDate&limit=1`), so after a tester upload it would attach the tester build too [file src/commands/prepare.mjs:66-72] [file src/commands/prepare.mjs:255-271]
- The attach is documented: "Uploads builds to testers ... and points the prepared version at them", and `prepare` "attaches your newest build" [file SKILL.md:3] [file README.md:236]
- Read back after the upload: version 1.0 PREPARE_FOR_SUBMISSION holding 878; build 839 VALID, not expired [command node scratchpad/s13/restore-839.mjs, read-only, 2026-11-12]
- Play: one complete release object per track, "Play replaces the track's releases wholesale", so an internal upload removes whatever build the internal track held [file src/play/commands/prerelease.mjs:107]
- KatyaFM's own record of the move [commit b737c0c in katyafm] [commit 4bad8d5 in katyafm]

## Questions
1. Goal: vydanne can put a build in testers' hands without changing which build the prepared App Store version holds?
   Proposed: yes. That is the case met on 2026-11-12, and today it has no answer short of re-pointing by hand afterwards.
2. A or B: (A) a flag on `prerelease`, `--keep-version-build`, plus a config key `ios.attachToVersion: false`, the attach staying the default; or (B) the attach moves out of `prerelease` and only `prepare` attaches a build?
   Proposed: A. Most uploads are the release build and the attach saves a step; B would change every app's release routine at once.
3. When the prepared version already holds a different build, should `prerelease --apply` say so before uploading ("version 1.0 holds build 839; this upload will move it to 878; pass --keep-version-build to leave it") and go on?
   Proposed: yes, printed before the upload, not only after the change, so the run's first lines tell the reader. It goes on, because the attach stays the default (question 2).
4. Should `prepare --apply` take a build to attach (`VYDANNE_BUILD=839`) instead of always the newest, and leave the version's build alone when it already holds one of the same marketing version?
   Proposed: yes to both. The newest build is the wrong default when a tester build went up after the release build.
5. Play: should `prerelease --store google` print which build the track held before replacing it, the same as the App Store line?
   Proposed: yes. The replacement itself is how Play works and stays; the line makes it visible.
6. Criteria?
   Proposed: (a) with the flag or the key, the dry run plans no PATCH of `relationships/build` and the apply sends none; (b) without them, the warning of question 3 is printed before the transfer when the version holds another build; (c) `prepare` with VYDANNE_BUILD attaches that build, and without it leaves a same-version build in place; (d) the Play line names the build replaced; (e) README and SKILL.md say all of it.
7. Edge cases?
   Proposed: no version in preparation (nothing to keep, as today); a version in LOCKED_STATES (left alone, as today); the version holding no build yet (attach as today, no warning); VYDANNE_BUILD naming a build still PROCESSING or expired (refused, saying so).
8. Aspects?
   Proposed: all n/a. vydanne is a command-line tool with no app screens.
9. Plan?
   Proposed: S-1 tests on the dry-run client for criteria (a) to (c), seen failing; S-2 the flag, the key, the warning and VYDANNE_BUILD; S-3 the Play line and its test; S-4 README and SKILL.md; S-5 review. No heavy job and nothing sent to Apple or Google: the dry-run client records the requests it would send.
