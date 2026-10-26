---
id: vydanne/prepublish-commands
title: An app's own commands run before any upload, and a failure refuses it
written: 2026-10-26
---

## Who raised it
> And we must fail early if tests or any other check failed. Not like we will have failed check and new build in closed track
> Yes create proper filled draft for vydanne to add support of pre publish hook where we can add our custom commands
> We can also use npm way of pre and post commands

owner, 2026-10-26, session b26ca605-a4e8-4a96-9fd2-e03b58a670f2

## Why
Asilak moved its Gradle checks (detekt, the shared-core tests, the Android classpath-skew check) off the pre-push hook
and into CI, where every release workflow waits for them. But a local `npx vydanne prerelease --store google --apply`
uploads a bundle built on the Mac and never touches CI, so a red check can still put a build in the closed track. The
place to stop that is vydanne itself, at the moment it would write. Today an app can do it only by writing JavaScript
middleware that spawns processes, or a gate run when the config is imported. Every app in the portfolio uploads
through vydanne, so this is a vydanne feature, not part of asilak's work.

## What was found
- vydanne 1.4.0 on master [commit 5721c8b] [file package.json:3]
- `--apply` (or `VYDANNE_COMMIT=1`) is the one switch for every store write; without it a write command is a dry run [file bin/vydanne.mjs:35]
- The commands that write: Apple prepare, push, fill, appinfo, age-rating, review-contact, accessibility, previews, creative, withdraw, prerelease; Play fill, prerelease [file src/registry.mjs:16-62]
- Binaries are uploaded only by `prerelease`: altool `--upload-app` for Apple, the bundle named by `google.aab` or `VYDANNE_AAB` for Play [file src/commands/prerelease.mjs:222] [file src/play/commands/prerelease.mjs:52-54]
- vydanne already has a hook: `middleware` in the config, JavaScript functions around every store command, narrowed by `commands` and `stores`, which refuse with `ctx.fail()` (exit 1, no stack trace) [file src/middleware.mjs:1-37] [file src/middleware.mjs:41] [file README.md:548]
- Middleware takes functions only, so running a shell command means the app writes its own child_process call, exit-code check and messages [file src/middleware.mjs:63-88]
- middleware.mjs is identical in vydanne and zdymak by rule, so a change to it is a change to both [file src/middleware.mjs:4-5] [file ~/sources/zdymak/src/middleware.mjs]
- On Play, middleware runs before the client exists, so a refusal costs no authentication and no Play request [file bin/vydanne.mjs:91]
- The library entry `runCommand` runs the same middleware as the CLI, so a script cannot get around a gate written there [file src/index.mjs:42-66]
- The config is resolved against the shell's current directory, and its known keys are listed in CONFIG_KEYS, typed in VydanneConfig, and guarded by check-config, check-types and check-docs [file src/config.mjs:10] [file src/config.mjs:33] [file types/index.d.ts:338] [file package.json:52-54]
- `push` runs prepare, fill, previews, creative, age-rating, review-contact, accessibility and preflight inside one process, not through the CLI [file README.md:272-273]
- vydanne can name the commit a build number came from, where the app's build number is a commit count [file src/buildCommit.mjs:77]
- Tests are node:test files in scripts/, with a fake App Store Connect that records requests; no test drives `--apply` through the CLI yet [file scripts/middleware.test.mjs] [file scripts/fake-asc.mjs] [file package.json:60]
- `verify` runs every check before an npm publish [file package.json:55-56]
- The portfolio's release gates today run when the config is imported: asilak's voice gate refuses an `--apply` without ../gulnya, and the games call games-core's legacy-gate and ios-smoke `guardRelease()` the same way, each with a `*_WAIVER` variable [file ~/sources/asilak/vydanne.config.mjs:5-17] [file ~/sources/gulnya/tools/legacy-gate.mjs:41] [file ~/sources/gulnya/tools/ios-smoke.mjs:31]
- ios-smoke's receipt counts only for the same commits, with no tracked change in either tree [file ~/sources/gulnya/tools/ios-smoke.mjs:28]
- Asilak's checks now live in its checks.yml, and each release workflow's `release` job needs them [file ~/sources/asilak/.github/workflows/checks.yml] [file ~/sources/asilak/.github/workflows/release-android.yml]
- Asilak's local upload path is vydanne itself, binary included [file ~/.claude/projects/-Users-volha-sources-asilak/memory/store-upload-path.md]
- GitHub Actions refused to start asilak's CI run 40416944628 on 2026-10-26 ("recent account payments have failed or your spending limit needs to be increased"), so a local upload is the only path that works now [command gh run view 40416944628 -R dia-olka/asilak]
- Asilak is not a kirunak repo, so its own entry cannot be a draft here [command grep -n "name: 'asilak'" ~/sources/gulnya/kirunak/workspace.mjs]

## Questions
1. The goal: an app names shell commands in its vydanne config, and vydanne runs them around its own commands; a failing command before a write refuses it, with exit 1, before vydanne authenticates or uploads anything. Yes or no?
   Proposed: yes. It is the owner's ask, and a refusal can reuse middleware's MiddlewareRefusal so it reads like every other refusal.
2. The shape: A, the npm way, a `scripts` block whose `pre<command>` runs before a command and `post<command>` after it (`preprerelease`, `postprerelease`, `prefill`), plus `prepublish` and `postpublish` around every command that writes; or B, one `prepublish` list of `{ name, run, commands, stores }` entries, like middleware?
   Proposed: A, the owner's suggestion (2026-10-26). Every developer reads it at a glance, it gives post-steps (tag, notify) for free, and an app writes its gate once in `prepublish`.
3. A value is a command string run through `sh -c` (so `&&` works), a list of them run in order, or `{ run, stores }` to limit it to `apple` or `google`. Yes or no?
   Proposed: yes; a string covers almost every case, and `stores` is the one narrowing npm has no word for.
4. `prepublish` and `postpublish` run only for a command that writes and only with `--apply`; `pre<command>` and `post<command>` run for any command they name, read-only ones included. Yes or no?
   Proposed: yes; `prepublish` is the gate, and a named hook does what its name says, as in npm.
5. In a dry run (no `--apply`) of a write command, the hooks do not run, and vydanne prints each one it would run. Yes, or run them in a dry run too?
   Proposed: print only. A dry run is for looking, asilak's checks take minutes, and the print shows nothing is forgotten.
6. The order is `prepublish`, `pre<command>`, the middleware chain with the command inside, `post<command>`, `postpublish`, all outside middleware, so a failed pre-hook costs no authentication and no store request. Yes or no?
   Proposed: yes, as Play's middleware already does (bin/vydanne.mjs:91).
7. Within a hook, commands run one after another, the first failure stops the rest, and output streams live to the terminal; the refusal names the hook, the command and its exit code. Yes or no?
   Proposed: yes; a check can take minutes, and a refusal must say what failed.
8. A post-hook runs only when the command succeeded; when it fails, vydanne exits 1 and says the write already happened. Yes or no?
   Proposed: yes; nothing can undo an upload, so the message must not suggest it failed.
9. `push` runs only `prepush`, `postpush` and the publish pair, not the hooks of the eight steps it runs inside. Yes or no?
   Proposed: yes; otherwise one push runs `prepublish` eight times over.
10. Hooks run in the folder of vydanne.config.mjs, not the shell's current folder. Yes or no?
   Proposed: yes; the config is resolved against the current folder (config.mjs:33), so a run with `--config` from elsewhere would run the checks in the wrong tree.
11. vydanne passes what it knows to each hook as environment: `VYDANNE_COMMAND`, `VYDANNE_STORE`, `VYDANNE_APPLY`, and for prerelease the binary's path and build number. Yes or no?
   Proposed: yes; a hook can then check the exact bundle, as legacy-gate's receipt does.
12. Before `prepublish`, vydanne refuses an `--apply` when the app's tree has tracked changes, so the checks run on the committed code. Yes, or leave that to each app?
   Proposed: yes, the rule ios-smoke's receipt keeps (ios-smoke.mjs:28); a check on uncommitted code says nothing about what ships.
13. For prerelease, where the app's build number is a commit count, vydanne also refuses when HEAD is not the commit that build number names (buildCommit.mjs:77), and only warns where it is not a count. Yes, or out of scope?
   Proposed: yes; otherwise the checks pass on HEAD while a bundle built from an older commit uploads.
14. A waiver, `VYDANNE_SCRIPTS_WAIVER="<reason>"`, skips the pre-hooks, prints the reason and goes on; an empty reason refuses. Yes, or no waiver at all?
   Proposed: yes, the same shape as VOICE_GATE_WAIVER, LEGACY_GATE_WAIVER and IOS_SMOKE_WAIVER, so a broken tool cannot block a hotfix, and every skip says why.
15. `runCommand`, the library entry, runs the same hooks as the CLI. Yes or no?
   Proposed: yes; otherwise a script calling vydanne as a library would get around the gate (index.mjs:42-66 does the same for middleware).
16. The hooks live in a vydanne module of their own, and middleware.mjs, shared with zdymak, stays as it is; zdymak gets nothing, since it publishes nothing. Yes or no?
   Proposed: yes; the shared file's rule is that both tools change together, and this need is vydanne's alone.
17. Out of scope: asilak's own hooks (its Gradle checks through gulnya's heavy-lock queue) and moving the games' import-time gates (voice, legacy-gate, ios-smoke) onto `scripts`. Both are follow-ups after a vydanne release has it. Yes or no?
   Proposed: yes; asilak is not a kirunak repo, so its change is made in an asilak session, and moving the games' gates touches every game, so it is its own task.
18. Aspects: vydanne is a command-line tool with no screen, so accessibility, light and dark, localization and store screenshots are all n/a. Yes or no?
   Proposed: yes; the only text is the tool's English messages and its docs.
19. Done means: `scripts` in CONFIG_KEYS, VydanneConfig, README's "Your config, field by field" (with a section beside "Middleware") and SKILL.md, check-docs, check-types and check-config passing, and a node:test suite in `verify` that proves each rule above against the fake store. That covers: a failing `prepublish` refuses an `--apply` prerelease before any request; a passing one lets it through; a dry run runs nothing and prints the plan; `stores` narrows; `push` runs its hooks once; a post-hook failure says the write happened; tracked changes refuse; the waiver needs a reason; hooks run in the config's folder; `runCommand` runs them too. Yes or no?
   Proposed: yes; each case is a test that fails without the change.
20. The plan: 1, the hooks module and its tests; 2, the wiring in bin/vydanne.mjs and runCommand; 3, docs, types and guards; 4, a minor release (1.5.0) from a tag, once the owner says yes at the time, since an npm release is outward-facing. Yes, or another order?
   Proposed: yes; it is one bounded change, so no step needs Fable, and the release waits for the owner.
