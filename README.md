# vydanne

[![npm version](https://img.shields.io/npm/v/vydanne.svg)](https://www.npmjs.com/package/vydanne)
[![npm downloads](https://img.shields.io/npm/dm/vydanne.svg)](https://www.npmjs.com/package/vydanne)
[![node](https://img.shields.io/node/v/vydanne.svg)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/vydanne.svg)](LICENSE)

**Fill in your app's App Store and Google Play listing — in every language — from files on your computer.**

Publishing an app means typing the same things into a web form over and over: a name, a subtitle, a
description, keywords, screenshots… once per language, twice per store, again for the Mac version. Miss a
box and the store quietly shows a blank page to half the world. Get a folder name wrong and the whole
upload fails.

vydanne does that typing for you, then **checks your work before Apple or Google does** — and puts
your build in front of testers on both stores. It stops at the one step that should stay a human's:
it never submits for review, and never ships to the public.

> *выданне* (Belarusian) — "publishing".

<br>

## Is this for me?

**Yes, if** you have an app and you're tired of the store's web forms — especially in more than one
language. You do not need to be a programmer: you write text files, and run three commands.

**Probably not, if** you publish one app in one language and never change it. The web form is fine.

**You'll still need** an Apple Developer account (and/or a Play Console account) and someone to build the
actual app. vydanne handles the *listing*, not the software.

<br>

## The two halves of a release

vydanne has a sibling — **[zdymak](https://github.com/Lonli-Lokli/zdymak)**. They split the job cleanly:

| | [zdymak](https://github.com/Lonli-Lokli/zdymak) 📸 | **vydanne** 📝 |
|---|---|---|
| Makes | The **pictures** — screenshots, App Preview videos, the Play feature graphic | The **words and the paperwork** — listing text, ratings, contacts, privacy, compliance |
| Ends with | Image and video files on disk | A listing filled in and verified, ready for a human to submit |

Use them together: zdymak produces the assets, vydanne uploads them alongside your text. Use vydanne
alone if you already have your screenshots.

<br>

## Install

You need **Node.js 20.9 or newer** ([nodejs.org](https://nodejs.org) — the LTS build). Then, in your app's
folder:

```sh
npm i -D vydanne
npx vydanne version
```

Works on **macOS, Linux and Windows**. The examples below use macOS/Linux shell syntax; Windows
PowerShell equivalents are in [GETTING_STARTED.md](GETTING_STARTED.md) (`$env:NAME = "value"` instead of
`export`, and set variables on their own line — PowerShell has no `VAR=1 command` form).

<br>

## Quick start

**→ First time? Follow [GETTING_STARTED.md](GETTING_STARTED.md).** It walks through every click:
getting your Apple API key, setting up a Play service account, where each file goes, and what to do when
something errors. This section is the short version for people who've done it before.

**1. Get a key from Apple.** App Store Connect → Users and Access → Integrations → App Store Connect API.
Download the `.p8` (once only!), then:

```sh
mkdir -p ~/.appstoreconnect/private_keys
mv ~/Downloads/AuthKey_*.p8 ~/.appstoreconnect/private_keys/

# Write the ids ONCE — every app you ship reads them from here. Nothing to export per shell,
# nothing secret in any repo. (The .p8 stays next to it, in private_keys/.)
cat > ~/.appstoreconnect/config.json <<'JSON'
{ "keyId": "ABCD123456", "issuerId": "69a6de70-…" }
JSON
chmod 600 ~/.appstoreconnect/config.json

npx vydanne auth      # confirms what resolved, and from where
```
```powershell
# Windows PowerShell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.appstoreconnect\private_keys"
Move-Item "$env:USERPROFILE\Downloads\AuthKey_*.p8" "$env:USERPROFILE\.appstoreconnect\private_keys\"
'{ "keyId": "ABCD123456", "issuerId": "69a6de70-…" }' |
  Set-Content "$env:USERPROFILE\.appstoreconnect\config.json"
```

### Where credentials come from

Resolved automatically, highest priority first — and **never** from `vydanne.config.mjs`, which is
committed. A keyId or issuerId found there is refused at load, with a warning telling you to move it:

| Source | Use it for |
|---|---|
| `ASC_KEY_ID` / `ASC_ISSUER_ID` / `PLAY_JSON_KEY_FILE` in the environment | CI secrets, one-off overrides |
| the `.env` cascade in the repo | one app that needs a different account from the rest |
| **the user config file** | **the default for every app you ship** — one account, many repos |

**The `.env` cascade** is the standard one (same shape Vite and Next.js use), parsed with `dotenv`, later
file wins: `.env` → `.env.<mode>` → `.env.local` → `.env.<mode>.local`, where `mode` is `VYDANNE_ENV` (or
`NODE_ENV`) and is optional. So `.env` and `.env.<mode>` stay **committable** for shared non-secret
defaults, and only the `*.local` files hold secrets — those are the ones to gitignore:

```gitignore
.env.local
.env.*.local
```

Values are *parsed*, never loaded into `process.env`, so a real environment variable always wins.

**The user config file** is looked up in this order, first hit wins — there is no single cross-platform
home for it, so all three are honoured instead of forcing one on everyone:

| Path | |
|---|---|
| `$VYDANNE_CONFIG_HOME/config.json` | explicit escape hatch (a secrets mount, a shared drive, tests) |
| `%APPDATA%\vydanne\config.json` (Windows)<br>`$XDG_CONFIG_HOME/vydanne/config.json` → `~/.config/vydanne/config.json` | what a Windows or Linux user expects |
| `~/.appstoreconnect/config.json` | beside the keys — Apple's tooling and fastlane already keep the `.p8` in `~/.appstoreconnect/private_keys` on every platform |

Shipping under more than one account? Use named profiles, selected with `VYDANNE_PROFILE=client-x` or
pinned per app via `asc: { profile: "client-x" }` in its config — a label, not a secret:

```json
{ "default": "kupalinka",
  "profiles": { "kupalinka": { "keyId": "…", "issuerId": "…", "playJsonKeyFile": "~/.config/play/sa.json" },
                "client-x":  { "keyId": "…", "issuerId": "…" } } }
```

`vydanne auth` prints what resolved and which source won, masked — run it first when Apple returns a 401.

**2. Describe your app** in a `vydanne.config.mjs` file next to your project:

```js
export default {
  bundleId: "com.example.myapp",
  primaryLocale: "en-US",
  platforms: ["IOS"],
  uiLocales: ["en", "de", "fr"],
  metadataDir: "fastlane/metadata",
  rating: "4+",
};
```

**3. Write your listing** as plain text files, one folder per language:

```
fastlane/metadata/en-US/name.txt          ← "My App"
fastlane/metadata/en-US/subtitle.txt      ← "The one-line pitch"
fastlane/metadata/en-US/description.txt
fastlane/metadata/en-US/keywords.txt
```

**4. Check, then push:**

```sh
npx vydanne preflight     # anything missing or too long?
npx vydanne diff          # what exactly would change?
npx vydanne fill          # DRY RUN — prints every write it would make
npx vydanne fill --apply  # do it
```

Run vydanne **from your project folder** — it finds everything relative to where you are.

<br>

## `--apply`, or nothing happens

**Every command that can change a store is a dry run unless you pass `--apply`.** It reads the store,
prints each write it would make, and sends nothing:

```
DRY RUN — 'fill' will not change App Store Connect. Add --apply to write.
      would PATCH /v1/appStoreVersionLocalizations/ad2f… — description, keywords, whatsNew
      …
DRY RUN — 40 store write(s) withheld. Re-run with --apply to perform them.
```

The commands this applies to are marked `✎` in `vydanne help`: `fill`, `previews`, `age-rating`,
`review-contact`, `accessibility`, `prerelease`. Everything else only reads, and ignores the flag.

Two details worth knowing:

- **A dry run walks the whole plan.** It does not stop at the first locale — the count at the end is the
  number to compare against `diff`. "Nothing to write" and "nothing happened" are different sentences, and
  only the first one means your local files already match the store.
- **The two stores enforce it differently, deliberately.** Play builds the Edit and *validates it against
  Google* for real, then discards it — so a dry run catches everything a commit would have caught. Apple
  has no transaction to roll back, so there the block is at the HTTP layer: no `POST`/`PATCH`/`PUT`/
  `DELETE` leaves the process at all. `prerelease` also refuses the `altool` upload, after validating the
  archive.

> Upgrading from ≤ 0.5? The Apple half used to write immediately — `vydanne fill` now needs `--apply`.
> `VYDANNE_COMMIT=1` still works as an alias so existing Play scripts keep running, but prefer the flag.

<br>

## What each command does

| Command | In plain English |
|---|---|
| `preflight` | **Run this first.** Checks the listing is complete, nothing is over a character limit, and no locale mentions the other app store. Green means submittable. |
| `diff` | Shows exactly what's different between your files and what's live. Nothing is changed — a safe preview. |
| `fill` | Uploads your listing text and screenshots. Handles iPhone, iPad and Mac. Refuses to upload text that names the other mobile platform. |
| `previews` | Uploads App Preview videos. |
| `inspect` | Shows the app's current state in the store. Read-only. |
| `locales` | Lists your languages and Apple's code for each — and warns about any language the App Store doesn't offer. |
| `age-rating` | Sets the age rating. |
| `review-contact` | Fills in the App Review contact details (who Apple calls if there's a problem). |
| `accessibility` | Saves Accessibility Nutrition Labels from the `accessibility` block in your config. Stays a draft until your app is live. Refuses to run if you have not declared one — see below. |
| `privacy` | Prints the privacy answers to paste into Apple's website (Apple's privacy section has no API). |
| `iap` | Checks your in-app purchase text fits, and can strip transparency from an image. |
| `compliance` | Generates the US encryption self-classification PDF that Apple asks for. |
| `version` | Prints the version of vydanne. |

For **Google Play**, add `--store google` to `inspect`, `diff`, `preflight`, `fill`, or `prerelease`.

`fill`, `previews`, `age-rating`, `review-contact`, `accessibility` and `prerelease` change the store, so
they need [`--apply`](#--apply-or-nothing-happens); without it they report and exit.

<br>

## Google Play

Add a `google` block to your config and point `PLAY_JSON_KEY_FILE` at a service-account key
([how to get one](GETTING_STARTED.md#4-get-your-google-play-credentials-once-android-only)):

```sh
npx vydanne preflight --store google
npx vydanne fill --store google           # dry run — shows what would change
npx vydanne fill --store google --apply   # actually do it
```

### `prerelease` — the build, to testers

`fill` writes the *listing*; `prerelease` uploads the **binary** — to TestFlight on Apple, or to a
closed testing track on Play. Neither submits anything for review.

**Apple — TestFlight**

```sh
npx vydanne prerelease            # validate, upload, wait for processing
```

```js
ios: {
  ipa: "./dist",                  // a file, or a directory whose NEWEST .ipa is taken
  testFlightGroup: "Internal",    // optional; INTERNAL groups only
}
```

The App Store Connect REST API has never accepted a binary, so this is the one command that shells
out — to `xcrun altool`, which ships with Xcode and authenticates from the same
`~/.appstoreconnect/private_keys` key `vydanne auth` reports. That makes it **macOS-only**, which it
checks up front. The archive is validated before it is uploaded, so the common refusals (bad
entitlements, missing icons, a version Apple already holds) cost seconds rather than a full transfer.

Build numbers come from the archive's own `CFBundleVersion` — re-uploading one Apple already holds
fails loudly instead of quietly replacing a binary.

It also **points the version you are preparing at the build it just uploaded**, which is the loop
this command exists for:

```sh
npx vydanne prerelease      # version 1.1 -> build 66, off to testers
# …find something, fix it, re-archive with a new build number…
npx vydanne prerelease      # version 1.1: build 66 -> build 67
```

The version→build relationship holds exactly one build, so re-running re-points it and there is
nothing to clean up. A version that is no longer editable — `IN_REVIEW`, `READY_FOR_SALE` — is left
alone and said so, because re-pointing it would mean withdrawing that submission, and that is a
decision with reviewer-facing consequences.

**External TestFlight groups are refused.** Distributing to them requires Beta App Review, which is a
submission by another name; internal groups are the exact parallel of Play's `internal` track, and on
a paid app they are the testers who install without buying it.

**Google Play — a closed track**

```sh
npx vydanne prerelease --store google           # dry run
npx vydanne prerelease --store google --apply   # publish to the track
```

```js
google: {
  packageName: "com.x.app",
  aab: "./dist",        // a file, or a directory whose NEWEST .aab is taken
  track: "internal",    // 'internal' (default) | 'alpha' | 'beta'
}
```

**It refuses `production`** — that isn't a flag you can pass, it's a refusal. A staged rollout can be
halted but never un-shipped, so promoting a tested build stays a human decision in Play Console. This is
the same line the Apple side draws by never submitting.

**Paid app? Use `internal`.** It is the only track where testers install without buying; closed and open
testers pay like everyone else.

Release notes follow supply's layout, so an existing repo needs no migration —
`<metadataDir>/<play-locale>/changelogs/<versionCode>.txt`, falling back to `default.txt`, truncated to
Play's 500-char cap with a warning. The versionCode comes from the bundle's own manifest, so build
numbering stays with the build and re-uploading a used code fails loudly instead of silently replacing a
binary. Overrides: `VYDANNE_AAB`, `VYDANNE_TRACK`, `VYDANNE_RELEASE_NAME`.

**Play is dry by default on purpose.** Nothing goes live until you add `--apply`, so a
half-finished folder can never overwrite a good listing. Play also uses its **own** language codes
(`zh-CN`, `iw-IL`) which are *not* Apple's — `vydanne locales` and the
[layout guide](GETTING_STARTED.md#6-put-your-text-and-images-where-vydanne-looks) keep them straight.

<br>

## Your config, field by field

`bundleId` · `primaryLocale` (your main language — everything else falls back to it, so it must be
complete) · `asc` (Apple key IDs, if you'd rather not use environment variables) · `platforms` (iOS and
macOS are **separate listings**) · `uiLocales` (your languages, auto-translated to Apple's codes) ·
`metadataDir` (where your text lives) · `rating` · `privacy` (what data actually leaves the device) ·
`iaps` (in-app purchases) · `previews` (App Preview videos) · `export` (encryption compliance details) ·
`google` (the Play block).

A commented example ships with the package: **[`vydanne.config.example.mjs`](vydanne.config.example.mjs)**.

<br>

## The mistakes it saves you from

Every one of these has cost somebody a rejected build or a blank store page. vydanne handles them so you
don't have to learn them the hard way.

| The trap | What vydanne does |
|---|---|
| A wrongly-named language folder aborts the **entire** upload | Maps your codes to Apple's and flags any language the store doesn't support |
| Your main language is left empty → most of the world sees a blank page | `preflight` refuses to pass |
| macOS is a **separate** listing; its text is not shared with iOS | Fills each platform independently |
| Apple's list endpoints return blank text, so tools "see" an empty listing | Reads each language individually |
| Screenshots with transparency get rejected | Converts them to RGB |
| Once a version is *Ready for Review*, most tools can no longer edit it | Uses a method that still works |
| Character limits (30 / 30 / 100 / 170; purchases 30 / 45) | Checked before upload, not after rejection |
| One translation says "also on Google Play" → rejected under guideline 2.3.10 | Every locale is scanned before upload; `preflight` and `fill` both refuse |
| Apple's privacy section can't be reached by any API key | Prints the exact answers to paste in |
| Accessibility labels can't publish before launch | Saved as a draft automatically |
| In-app purchases need **two** different images, easily confused | Labels both slots |
| Play's language codes differ from Apple's | Documented and validated separately |
| A missing local screenshot folder deleting your live ones | Only uploads what exists — never deletes by omission |

<br>

## What vydanne will never do

- **It never submits for review, and never ships to the public.** It *will* put a build in front of
  your testers — TestFlight internal, or a Play closed track — and point the version you are
  preparing at it. Pressing Submit, promoting to Play production, and distributing to external
  TestFlight (which needs Beta App Review) all stay yours. Those are refusals, not flags: there is
  no argument combination that reaches the public.
- It doesn't build or sign your binary. It uploads the `.ipa` / `.aab` you already produced.
- It doesn't create the app record — make that in App Store Connect / Play Console first.

<br>

## For developers & AI agents

The package ships **[SKILL.md](SKILL.md)** — a precise, agent-facing operating guide (exact file layout,
the store gotchas, the ASO rules) — plus TypeScript definitions
([`types/index.d.ts`](types/index.d.ts), type `import('vydanne').VydanneConfig`).

Two guards keep the docs honest: `npm run check:docs` (every config field and command is documented) and
`npm run check:types` (every one is typed). Both run before publish, so the docs can't drift from the code.

Technically: native Node, no fastlane, Ruby, or Python. ES256 JWT via `node:crypto`, the App Store Connect
REST API over `fetch`, chunked uploads by hand, PDFs via `pdfkit`, image flattening via `sharp`. Android
goes through the Google Play Developer **Edits** API.

Releasing a new version: [RELEASING.md](RELEASING.md).

MIT.


### One store never mentions the other

Both stores reject a listing that advertises the competing platform — Apple under App Review
guideline **2.3.10** ("no names, icons, or imagery of other mobile platforms"), Google under its
Store Listing and Promotion policy. It is an easy mistake to make and an expensive one to find: the
two listings come from the same source copy, so a single translator writing "auch für Android"
costs a review cycle, in one locale out of twenty, days later.

`preflight` and `fill` both scan the local metadata before anything is uploaded, per locale, per
field — store names, store URLs, and the other platform's device names, in Latin script and in the
localized forms (安卓, Андроид, アンドロイド, …). A store's OWN platform is never flagged: "Android"
belongs in a Play listing. Neither does the bare word "Play", which every game listing uses.

Ambiguous words ("apple" in a game about fruit) are reported as warnings and never block. If one
genuinely belongs in your copy:

```js
allowCrossStoreTerms: ["Apple"],
```

`VYDANNE_ALLOW_CROSS_STORE=1` overrides the whole check for one run.

### Accessibility Nutrition Labels

Every other thing vydanne writes is a *fact* about your app. This one is a **claim about its
behaviour**, made to Apple — so the tool will not guess it for you.

```js
accessibility: {
  voiceover: true,
  voiceControl: true,
  largerText: true,
  sufficientContrast: true,
  darkInterface: true,
  differentiateWithoutColorAlone: true,
  reducedMotion: true,
  captions: false,
  audioDescriptions: false,
},
```

Every feature is stated explicitly. An omission would read as a quiet "no", which is just as
unverified as a quiet "yes", so a partial block is rejected along with a missing one.

Earlier versions applied one hardcoded matrix to every app, which meant an app inherited claims
nobody had checked against it. At least one shipped app declared Larger Text support while its
board glyphs scaled twice and grew off the high-contrast disc behind them. If you are upgrading,
audit before you declare.

Apple's platform caveats are still applied automatically: Larger Text does not exist on macOS and
Voice Control does not exist on watchOS, so those are sent as false whatever you declare.
