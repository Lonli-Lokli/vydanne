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
portfolio, not part of KatyaFM's task; katyafm/settings waits for it.

## What was found
- vydanne 1.3.0 on master (0ac06d8, 2026-10-20) [commit 0ac06d8] [file package.json]
- Its `iap` command only checks the config's English fields (display name at most 30 characters, description at most 45), prints the review note and reminds of the two image slots; `VYDANNE_FLATTEN=<png>` flattens a review screenshot to RGB. It writes nothing to either store [file src/commands/iap.mjs:4-24] [file bin/vydanne.mjs:163]
- Nothing in vydanne calls App Store Connect's in-app purchase localizations or Google Play's one-time product listings [command grep -rlnE 'inAppPurchase|inappproducts|onetimeproducts' src bin]
- KatyaFM's config says a person creates the in-app purchase and types its fields into App Store Connect and the Play Console; the price is the owner's [file ~/sources/katyafm/vydanne.config.mjs:115-118]
- KatyaFM's full version, `app.kupalinka.katyafm.full`, has its name and description in 20 languages: `fastlane/iap/app.kupalinka.katyafm.full/<lang>/display_name.txt` and `description.txt` for ar be bn de en es fr he hi id it ja ko pl pt ru tr uk ur zh [command ls ~/sources/katyafm/fastlane/iap/app.kupalinka.katyafm.full]
- katyafm/settings AC-18 needs that name and description in both stores in the same 20 languages; its step S-37 pushes them with vydanne and diffs them, and stays open until vydanne can [file ~/sources/katyafm/kirunak/tasks/settings/task.md:30] [file ~/sources/katyafm/kirunak/tasks/settings/plan.md:249-254]
- vydanne has no kirunak folder yet, but kirunak's workspace knows the repo: `k draft new vydanne/iap-text` wrote this file [command k draft new vydanne/iap-text --dry-run]
- A KatyaFM session prepared an intake prompt on 2026-10-21 (uncommitted, in KatyaFM's tmp/) with a starting point (both stores, every language with a folder, dry by default with `--apply`, `diff` local against live, nothing submitted for review, every app) and ten questions; they are taken into the questions below [file ~/sources/katyafm/tmp/vydanne-intake-prompt.md]
- That prompt asks for research before the questions, with links: App Store Connect API in-app purchase localizations (In-App Purchases v2, inAppPurchaseLocalizations), and Google Play's API for one-time product listings (inappproducts and the newer monetization.onetimeproducts: which one to use and what each accepts). Not yet done [file ~/sources/katyafm/tmp/vydanne-intake-prompt.md:42-44]

## Questions
1. Only the text of a product that already exists in the store (A), or also create the product when it is missing (B)? Today a person creates it in App Store Connect and the Play Console.
2. The price stays out of vydanne, and the owner sets it in the consoles: yes or no?
3. The files stay where KatyaFM has them, `fastlane/iap/<productId>/<lang>/display_name.txt` and `description.txt`, as vydanne's layout: yes, or another layout?
4. The folders use short language codes (en, zh, he); vydanne maps them to Apple's (en-US, zh-Hans, he) and Play's (en-US, zh-CN, iw-IL) with one table: yes or no?
5. Belarusian (be) has no App Store language: skip it on the App Store and keep it on Play: yes or no?
6. Text over a store's limit (Apple's name 30 characters and description 45, and Play's own) is refused before any upload: yes or no?
7. Buyers read this text, so it passes the voice gate (voice-lint) like the listing: yes or no?
8. Which command: A, part of `fill` and `push`, so one push sends the listing and the purchase text; B, a separate command; or C, the `iap` command learning to write?
9. Dry by default, `--apply` to write, and `diff` shows this text local against live, like every other vydanne command: yes or no?
10. Nothing is ever submitted for review: yes or no?
11. It works for every app in the portfolio, not only KatyaFM: yes or no?
12. A new vydanne on npm is outward-facing, so it waits for the owner's yes at the time: yes or no?
13. KatyaFM runs `npx --yes vydanne` with no node_modules; pin the vydanne version in its package.json instead: yes or no?
14. Tests run against recorded API answers, never against the live stores: yes or no?
15. The task lives in vydanne (vydanne/iap-text, as this draft does), not in gulnya: yes or no?
16. When it lands, katyafm/settings S-37 pushes the full version's text with it and checks it with `diff`: yes or no?
