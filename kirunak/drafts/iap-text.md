---
id: vydanne/iap-text
title: vydanne pushes in-app purchase names and descriptions
written: 2026-10-22
---

## Who raised it
> C

owner, 2026-10-21, session 36492b62-ee48-4425-b343-d657e9fc4133, picking "C: Teach vydanne first" for the session's question "The full version's name and description are ready in 20 languages, but vydanne cannot send them to the stores: 20 entries in App Store Connect and 20 in the Play Console. How should they get there?" (A: type them in the consoles through the owner's Chrome; B: the owner types them; C: teach vydanne first)

## Why
vydanne pushes every other part of a listing but no in-app purchase text, so each app's purchase names and
descriptions in every language would be typed by hand in two consoles. It is a vydanne change for every app in the
portfolio, not part of KatyaFM's task; katyafm/settings no longer waits for it (amendment A-4, 2026-10-22).

## What was found
- vydanne 1.3.0 on master (0ac06d8, 2026-10-20) [commit 0ac06d8] [file package.json]
- Its `iap` command only checks the config's English fields (display name at most 30 characters, description at most 45), prints the review note and reminds of the two image slots; `VYDANNE_FLATTEN=<png>` flattens a review screenshot to RGB. It writes nothing to either store [file src/commands/iap.mjs:4-24] [file bin/vydanne.mjs:163]
- Nothing in vydanne calls App Store Connect's in-app purchase localizations or Google Play's one-time product listings [command grep -rlnE 'inAppPurchase|inappproducts|onetimeproducts' src bin]
- KatyaFM's config says a person creates the in-app purchase and types its fields into App Store Connect and the Play Console; the price is the owner's [file ~/sources/katyafm/vydanne.config.mjs:115-118]
- KatyaFM's full version, `app.kupalinka.katyafm.full`, has its name and description in 20 languages: `fastlane/iap/app.kupalinka.katyafm.full/<lang>/display_name.txt` and `description.txt` for ar be bn de en es fr he hi id it ja ko pl pt ru tr uk ur zh [command ls ~/sources/katyafm/fastlane/iap/app.kupalinka.katyafm.full]
- katyafm/settings took the full version's store text out by amendment A-4 (owner, 2026-10-22: "I don't want to wait for vydanne release for this story, I want it closed"): its O-6 says the 20 languages' texts in fastlane/iap/app.kupalinka.katyafm.full/ reach the stores with this task [file ~/sources/katyafm/kirunak/tasks/settings/task.md:80] [file ~/sources/katyafm/kirunak/tasks/settings/amendments/A-4.md]
- vydanne has no kirunak folder yet, but kirunak's workspace knows the repo: `k draft new vydanne/iap-text` wrote this file [command k draft new vydanne/iap-text --dry-run]
- A KatyaFM session prepared an intake prompt on 2026-10-21 (uncommitted, in KatyaFM's tmp/) with a starting point (both stores, every language with a folder, dry by default with `--apply`, `diff` local against live, nothing submitted for review, every app) and ten questions; they are taken into the questions below [file ~/sources/katyafm/tmp/vydanne-intake-prompt.md]
- That prompt asks for research before the questions, with links: App Store Connect API in-app purchase localizations (In-App Purchases v2, inAppPurchaseLocalizations), and Google Play's API for one-time product listings (inappproducts and the newer monetization.onetimeproducts: which one to use and what each accepts). Not yet done [file ~/sources/katyafm/tmp/vydanne-intake-prompt.md:42-44]
- vydanne already maps short codes to Apple's with one table and returns null for a language Apple lacks (`be`), which falls back to the primary listing; an app's own `localeMap` extends it [file src/locales.mjs:1-27]
- Nothing in vydanne's src or README names voice-lint; the voice gate runs in an app's config, from gulnya [command grep -rn "voice-lint" src README.md]
- Neither store's API was read for this draft, so the endpoints, the Play product kind and Play's length limits are open [command git log --oneline -60]
- Nothing already landed this: the commits since 1.3.0 are the build-id check, v1.4.0 and drafts [commit 5721c8b]


## Questions
1. Only the text of a product that already exists in the store (A), or also create the product when it is missing (B)? Today a person creates it in App Store Connect and the Play Console.
   Proposed: A. Creating a product also needs a price, a review screenshot and tax settings, which are the owner's (question 2); text for an existing product is the part that is typed 40 times today.
2. The price stays out of vydanne, and the owner sets it in the consoles: yes or no?
   Proposed: yes; KatyaFM's config already says the price is the owner's (tasks 2.8).
3. The files stay where KatyaFM has them, `fastlane/iap/<productId>/<lang>/display_name.txt` and `description.txt`, as vydanne's layout: yes, or another layout?
   Proposed: yes; 20 languages are written there already, and it matches `fastlane/metadata`'s shape.
4. The folders use short language codes (en, zh, he); vydanne maps them to Apple's (en-US, zh-Hans, he) and Play's (en-US, zh-CN, iw-IL) with one table: yes or no?
   Proposed: yes, extending the table in `src/locales.mjs` (Apple's side is there; Play's codes are added, and the app's `localeMap` can override).
5. Belarusian (be) has no App Store language: skip it on the App Store and keep it on Play: yes or no?
   Proposed: yes; the listing already falls back for `be`, and the run says which locales it skipped and why.
6. Text over a store's limit (Apple's name 30 characters and description 45, and Play's own) is refused before any upload: yes or no?
   Proposed: yes, with Apple's two limits from `iap.mjs` and Play's from the API reference in the research step; one refused file refuses the whole run.
7. Buyers read this text, so it passes the voice gate (voice-lint) like the listing: yes or no?
   Proposed: yes, in the app's config through the gate it already uses, not inside vydanne, which does not know voice-lint.
8. Which command: A, part of `fill` and `push`, so one push sends the listing and the purchase text; B, a separate command; or C, the `iap` command learning to write?
   Proposed: C, with `push` calling it; `iap` is already the command that checks these fields, so its check becomes the dry run and `--apply` writes. A separate name would leave two commands for one thing.
9. Dry by default, `--apply` to write, and `diff` shows this text local against live, like every other vydanne command: yes or no?
   Proposed: yes; `--apply` is the one switch for every store write (bin/vydanne.mjs:35).
10. Nothing is ever submitted for review: yes or no?
   Proposed: yes; the same rule as every other vydanne command.
11. It works for every app in the portfolio, not only KatyaFM: yes or no?
   Proposed: yes; it reads the config's `iaps` and the folder, with nothing KatyaFM-specific.
12. A new vydanne on npm is outward-facing, so it waits for the owner's yes at the time: yes or no?
   Proposed: yes, as for 1.4.0; a minor release (1.5.0) from a tag.
13. KatyaFM runs `npx --yes vydanne` with no node_modules; pin the vydanne version in its package.json instead: yes or no?
   Proposed: yes, as a follow-up in KatyaFM once 1.5.0 is out; the pin keeps a push from using a different vydanne than the one `diff` was checked with. I did not check KatyaFM's scripts for this.
14. Tests run against recorded API answers, never against the live stores: yes or no?
   Proposed: yes, node:test with the fake App Store Connect (scripts/fake-asc.mjs) and a recorded Play answer, added to `verify`.
15. The task lives in vydanne (vydanne/iap-text, as this draft does), not in gulnya: yes or no?
   Proposed: yes; vydanne is the repo that changes.
16. When it lands, this task pushes KatyaFM's full version text in the 20 languages with it and checks it with `diff` (katyafm/settings O-6): yes or no?
   Proposed: yes, as the last step, with the owner's yes before `--apply` (it writes to the live stores, though nothing goes to review).
17. The goal, in one paragraph: `npx vydanne iap --apply` writes each in-app purchase's name and description in every language of its folder to App Store Connect and Google Play, and `diff` shows where they differ, so no one types them in a console. Yes or no?
   Proposed: yes; it is what the owner chose on 2026-10-21 ("C").
18. The criteria: (a) a dry run lists each store, language and field it would write, and writes nothing; (b) `--apply` creates or updates one localization per language on Apple and one listing per language on Play, and a second run changes nothing; (c) over-limit text, a missing `description.txt` or an unknown product id refuses before any request; (d) `be` is skipped on Apple with a line saying so; (e) `diff` reports local against live per field; (f) the tests above pass in `verify`. Yes or no?
   Proposed: yes; each line is a test against the fake stores.
19. Edge cases and out of scope: a product the store does not have yet is an error that names it; a language in the store but not in the folder is left alone, never deleted; prices, review screenshots, promotional images and product creation are out. Yes or no?
   Proposed: yes; leaving store-only languages alone is the safe default for a tool that writes to a live store.
20. Aspects: vydanne is a command-line tool with no screen, so accessibility, light and dark, localization of its own messages and screenshots are all n/a. Yes or no?
   Proposed: yes; the only text is English messages and docs.
21. Research first: App Store Connect's in-app purchase localizations (In-App Purchases v2, inAppPurchaseLocalizations) and Google Play's one-time products (inappproducts against monetization.onetimeproducts: which to use and what each accepts, with its limits). Yes or no?
   Proposed: yes; open until read, since I did not read either API. Default: monetization.onetimeproducts if it accepts listings per language and the old inappproducts is deprecated, otherwise inappproducts.
22. The plan: 1, research and the length limits; 2, the Apple writer and its tests; 3, the Play writer and its tests; 4, `iap` and `push` wiring, `diff`, docs, types and guards; 5, release 1.5.0 on the owner's yes; 6, KatyaFM pushes its text (question 16). Yes or no?
   Proposed: yes; step 1 and the two writers are API work an Opus session can do, and nothing needs Fable.
