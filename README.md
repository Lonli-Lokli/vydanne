# vydanne

**Fill in your app's App Store and Google Play listing — in every language — from files on your computer.**

Publishing an app means typing the same things into a web form over and over: a name, a subtitle, a
description, keywords, screenshots… once per language, twice per store, again for the Mac version. Miss a
box and the store quietly shows a blank page to half the world. Get a folder name wrong and the whole
upload fails.

vydanne does that typing for you, then **checks your work before Apple or Google does**.

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

vydanne has a sibling — **[zdymak](https://www.npmjs.com/package/zdymak)**. They split the job cleanly:

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
export ASC_KEY_ID=…  ASC_ISSUER_ID=…
```
```powershell
# Windows PowerShell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.appstoreconnect\private_keys"
Move-Item "$env:USERPROFILE\Downloads\AuthKey_*.p8" "$env:USERPROFILE\.appstoreconnect\private_keys\"
$env:ASC_KEY_ID = "…"; $env:ASC_ISSUER_ID = "…"
```

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
npx vydanne fill          # do it
```

Run vydanne **from your project folder** — it finds everything relative to where you are.

<br>

## What each command does

| Command | In plain English |
|---|---|
| `preflight` | **Run this first.** Checks the listing is complete and nothing is over a character limit. Green means submittable. |
| `diff` | Shows exactly what's different between your files and what's live. Nothing is changed — a safe preview. |
| `fill` | Uploads your listing text and screenshots. Handles iPhone, iPad and Mac. |
| `previews` | Uploads App Preview videos. |
| `inspect` | Shows the app's current state in the store. Read-only. |
| `locales` | Lists your languages and Apple's code for each — and warns about any language the App Store doesn't offer. |
| `age-rating` | Sets the age rating. |
| `review-contact` | Fills in the App Review contact details (who Apple calls if there's a problem). |
| `accessibility` | Saves Accessibility Nutrition Labels. Stays a draft until your app is live. |
| `privacy` | Prints the privacy answers to paste into Apple's website (Apple's privacy section has no API). |
| `iap` | Checks your in-app purchase text fits, and can strip transparency from an image. |
| `compliance` | Generates the US encryption self-classification PDF that Apple asks for. |
| `version` | Prints the version of vydanne. |

For **Google Play**, add `--store google` to `inspect`, `diff`, `preflight`, or `fill`.

<br>

## Google Play

Add a `google` block to your config and point `PLAY_JSON_KEY_FILE` at a service-account key
([how to get one](GETTING_STARTED.md#4-get-your-google-play-credentials-once-android-only)):

```sh
npx vydanne preflight --store google
npx vydanne fill --store google                    # dry run — shows what would change
VYDANNE_COMMIT=1 npx vydanne fill --store google   # actually do it
#   Windows PowerShell:  $env:VYDANNE_COMMIT = "1"; npx vydanne fill --store google
```

**Play is dry by default on purpose.** Nothing goes live until you add `VYDANNE_COMMIT=1`, so a
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
| Apple's privacy section can't be reached by any API key | Prints the exact answers to paste in |
| Accessibility labels can't publish before launch | Saved as a draft automatically |
| In-app purchases need **two** different images, easily confused | Labels both slots |
| Play's language codes differ from Apple's | Documented and validated separately |
| A missing local screenshot folder deleting your live ones | Only uploads what exists — never deletes by omission |

<br>

## What vydanne will never do

- **It never submits your app.** A human attaches the build and presses Submit. That's on purpose.
- It doesn't build, sign, or upload your app binary.
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
