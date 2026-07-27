---
name: vydanne
description: Prepare an App Store Connect / Google Play submission — write AND push the localized store listing. Crafts the ASO copy (app-store name, subtitle, the 100-char keyword field, description, promo text), then fills the listing + screenshots + previews, age rating, review contact, accessibility & App Privacy labels, IAP fields, and export-compliance docs; verifies with a preflight gate and diffs local-vs-live. Native Node (ES256 JWT + fetch, no fastlane/Ruby). One vydanne.config.mjs per app. Use when writing or shipping any App Store / Play listing. Never submits — a human attaches the signed build and hits Submit.
---

# vydanne

The App Store Connect / Google Play half of a two-part release pipeline. Native Node — no
fastlane/Ruby/Python. Two jobs: **(A) write the listing well (ASO)**, **(B) push it + the declarations**.

**Companion tool — [zdymak](https://www.npmjs.com/package/zdymak)** makes the *media* (screenshots, App
Preview videos, Play feature graphic); vydanne pushes that media plus all the *text and paperwork*. If the
user needs screenshots or a preview video produced, that's zdymak's job, not vydanne's — vydanne only
uploads files that already exist. zdymak's default output paths are exactly the paths vydanne reads for
Play images (below), so the two line up with no glue.

**Never submits.** A human attaches the signed build and presses Submit. Don't try to work around this.

## Setup

`npm i -D vydanne`, then **`npx vydanne <cmd>` from the app's repo root** — the config and every relative
path in it resolve against the working directory. Running from a subfolder silently reads the wrong paths.

One `vydanne.config.mjs` per app (schema: `vydanne.config.example.mjs`; type
`import('vydanne').VydanneConfig`). Node ≥20.9. Cross-platform. On Windows PowerShell the `VAR=1 cmd`
form does **not** exist; set `$env:VAR = "1"` first.

**Auth resolves automatically — NEVER put credentials in the config.** That file is committed; vydanne
refuses a keyId/issuerId found there and warns. The signing key stays at
`~/.appstoreconnect/private_keys/AuthKey_<keyId>.p8`. The ids resolve highest-priority-first from: the
environment (`ASC_KEY_ID` / `ASC_ISSUER_ID` / `PLAY_JSON_KEY_FILE`) → the **`.env` cascade** → the **user
config file**.

The cascade is the standard one (dotenv-parsed, later file wins): `.env` → `.env.<mode>` → `.env.local` →
`.env.<mode>.local`, `mode` from `VYDANNE_ENV`/`NODE_ENV`. So `.env` and `.env.<mode>` stay COMMITTABLE
for shared non-secret defaults and only `*.local` holds secrets — never tell a user to gitignore `.env`
itself. Files are parsed, never merged into `process.env`, so a real env var always wins.

The user config file is the answer for a portfolio: write `{"keyId","issuerId","playJsonKeyFile"}` once
and every app picks it up with no per-repo setup. Looked up first-hit-wins —
`$VYDANNE_CONFIG_HOME/config.json` → `%APPDATA%\vydanne\config.json` (Windows) or
`$XDG_CONFIG_HOME/vydanne/config.json` (default `~/.config/vydanne/`) → `~/.appstoreconnect/config.json`
(beside the keys, where Apple's tooling and fastlane already keep the `.p8`). Several accounts → named
`profiles` + `VYDANNE_PROFILE`, or pin one per app with `asc: {profile}` (a label, not a secret).
**Run `vydanne auth` before debugging any 401** — it prints what resolved, from which source, masked,
which user file was used, and whether the `.p8` is on disk.

**Config fields:** `bundleId` · `primaryLocale` (the fallback — must be populated) · `asc` (optional
`{profile}` — selection only, never secrets) · `platforms` (iOS and macOS are SEPARATE) · `uiLocales`
(auto-mapped to ASC codes) · `metadataDir` · `rating` · `privacy` · `iaps` · `previews` · `export` ·
`google` (Google Play).

For a non-technical user asking how to set this up from scratch, walk them through
**`GETTING_STARTED.md`** (accounts → API key → config → folders → push) rather than improvising.

## File layout — read this before writing any file

vydanne reads plain `.txt` files from fixed locations. **These conventions are not configurable beyond
`metadataDir`; do not invent paths.**

**Apple listing text** — `<metadataDir>/<ASC-locale>/*.txt` (default `metadataDir`: `fastlane/metadata`):

| File | Field | Limit |
|---|---|---|
| `name.txt` | app name (on **AppInfo**, shared across platforms) | 30 |
| `subtitle.txt` | subtitle (on AppInfo) | 30 |
| `description.txt` | description (on the **version**) | 4000 |
| `keywords.txt` | keyword field (version) | 100 |
| `promotional_text.txt` | promo text (version) | 170 |
| `release_notes.txt` | what's new (version) | — |
| `marketing_url.txt`, `support_url.txt` | optional URLs (version) | — |

Folder names must be **Apple's exact ASC codes** (`de-DE`, `ar-SA`, `zh-Hans`, `en-GB`…). A folder whose
name isn't in the valid set is skipped; run `vydanne locales` to get the mapping from the config's
`uiLocales`. A language with no App Store equivalent (e.g. Belarusian `be`) must **not** get a folder — it
falls back to `primaryLocale`.

**App Review contact** — `<metadataDir>/review_information/{first_name,last_name,phone_number,email_address,notes}.txt`.
This is PII: keep it gitignored.

**Apple screenshots** — `fastlane/screenshots/<ASC-locale>/<prefix>_<anything>.png`, and
`fastlane/screenshots-macos/<ASC-locale>/…` for Mac. **These two base paths are hardcoded.** The token
before the **first underscore** selects the device slot; files upload in sorted order, so number them:

| Prefix | Slot |
|---|---|
| `iphone69_` | `APP_IPHONE_67` (6.9″) |
| `iphone65_` | `APP_IPHONE_65` |
| `ipad13_` | `APP_IPAD_PRO_3GEN_129` |
| `watch_` | `APP_WATCH_ULTRA` |
| `macos_` | `APP_DESKTOP` (in `screenshots-macos/`) |

An unknown prefix is silently ignored. A set that **already has screenshots is skipped**, never
duplicated — to replace shots, delete them in ASC first. PNGs must be **RGB with no alpha**.

**Play listing text** — `<google.metadataDir>/<PLAY-locale>/{title,short_description,full_description}.txt`
(30 / 80 / 4000). Play uses its **own** codes (`de-DE`, `zh-CN`, `iw-IL`, `ar`, `be`) — *not* Apple's
`zh-Hans`/`he`/`ar-SA`.

**Play images** — hardcoded source paths (zdymak's output), each pushed only when the file exists, so a
missing local set never deletes the live one: `brand/icons/play/icon-512.png` (512²) ·
`marketing/out/play-feature-graphic.png` (1024×500) · `marketing/out/play-phone-plain/` ·
`marketing/out/play-tablet7-plain/` (7″) · `marketing/out/play-tablet-plain/` (10″).

## A. Writing the listing (the ASO craft — the durable value)

**Write the English master first, then localize.**

### The fields, what they're FOR, and the hard limits

| Field | Limit | Indexed for search? | Job |
|---|---|---|---|
| `name` | 30 | **Yes (highest weight)** | Brand + the single strongest keyword. Must be globally UNIQUE. |
| `subtitle` | 30 | **Yes** | A second keyword-bearing benefit line — NOT a repeat of the name. |
| `keywords` (App Store only) | 100 | **Yes** | The biggest lever. Comma-separated, **no spaces**. |
| `promotional_text` | 170 | No | Rotating hook (sale/seasonal); editable anytime with no review. |
| `description` | 4000 | **App Store: NO** / **Play: YES** | Conversion copy for the human. On Play it's also indexed → bake keywords in naturally. |
| Play `title`/`short`/`full` | 30/80/4000 | short + full **Yes** | Play has NO keyword field → keywords go in title + short + full. |

### The keyword field — the rules people get wrong (App Store)

- **No spaces** after commas (`a,b,c` not `a, b, c`) — every char counts toward 100. **Fill all 100.**
- **Don't repeat** any word already in `name` or `subtitle` — Apple already indexes those; repeating wastes the field.
- **Singular OR plural, never both** — Apple matches both stems; pick one (usually singular).
- **Omit** "app", "game", "free", and the app's own name — Apple indexes those automatically.
- Apple **auto-combines** keywords into phrases (kw+kw), so prefer **single words** to maximize combinations — no multi-word phrases unless the phrase is the exact search term.
- **No competitor trademarks** (rejection risk, especially for games).
- Prioritize by **relevance × search volume × achievable rank**: generic head terms are hard to rank; mid-tail terms convert AND rank. Order best-first (leading keywords weigh more).

### Positioning — ground it in the app's real audience, not generic hype

Before writing, establish what actually motivates *this* app's users (ask the user, or read whatever
audience research/positioning docs the repo has). Then:

- **Lead with the strongest shared motivation**, stated concretely — not a feature list.
- **Name the genuine differentiator plainly.** If there's one thing competitors can't claim, say it in
  the subtitle, not buried in paragraph four.
- **Match the audience's temperature.** A calm, premium audience reacts badly to hype punctuation and
  competitive framing; a competitive audience finds understatement flat. Mirror the in-app voice.
- **Be honest in the close** — "no ads", "no account", "buy once" only if true. Claims here are checkable.
- Don't lead with mechanics the audience doesn't care about (leaderboards, streaks) just because they exist.

### Description shape (App Store & Play)

Hook (1–2 lines: the promise) → **WHY \<APP\>** (3–5 benefit bullets, each benefit-first) → what it is /
who it's for → honest close. Keep it scannable; lead each bullet with the payoff, not the feature.

### Localizing the listing (transcreation, not translation)

- **App name**: the brand is **never** translated; the DESCRIPTOR may be localized per store locale.
- **Keywords**: use the target market's **actual search terms**, not a dictionary translation. Research
  per market — the literal translation of a category name is often not what people type.
- **Subtitle / promo / description**: **transcreate** — adapt benefit + tone naturally; never word-for-word.
- **Fan out one agent per locale** (a Sonnet-tier translator/copywriter is the right size). Give each:
  the master English copy, the target locale, its `<metadataDir>/<ASC-locale>/` directory, the brand name
  (untranslated), the character limits, and the positioning above. Validate limits after the merge —
  translations routinely blow the 30-char fields.

## B. Commands (push it)

`fill` (metadata + screenshots, native PATCH/chunked upload — works even at READY_FOR_REVIEW) ·
`previews` (App Preview videos) · `age-rating` · `review-contact` · `accessibility` (draft; publish once
live) · `privacy` (prints answers for the UI — the API can't reach Apple's iris host) · `iap` (validate +
RGB flatten) · `compliance` (US self-classification PDF) · `diff` (what differs vs live) · `preflight`
(completeness gate) · `inspect` · `auth` (what credentials resolved, and from where) · `locales` · `version`.

`prerelease` uploads the BUILD. On Apple it validates and uploads the `.ipa` to **TestFlight** via
`xcrun altool` — the one command that shells out, because the ASC REST API has never carried a binary,
which also makes it macOS-only. `.ipa` comes from `ios.ipa` / `VYDANNE_IPA` (a directory takes its
newest), the build number from the archive's own `CFBundleVersion`, and `ios.testFlightGroup` may add
it to an **internal** group. External groups are REFUSED — they need Beta App Review, a submission by
another name — and App Store review is never submitted, mirroring the Play side refusing `production`.
It then points the version being prepared AT that build, so the fix-and-re-upload loop is one command:
re-running re-points (the relationship holds one build), while a version that is `IN_REVIEW` or
`READY_FOR_SALE` is left alone, since re-pointing it would mean withdrawing a submission.

With `--store google` it uploads an `.aab` to a **closed testing track** with release notes, inside one
edit transaction. `production` is REFUSED — not flag-gated — so no argument combination ships to the
public; promoting the tested build stays a human's job, mirroring the Apple side never submitting. Track
comes from `google.track` / `VYDANNE_TRACK`, default `internal`; the bundle from `google.aab` /
`VYDANNE_AAB` (a directory takes its newest `.aab`). **For a PAID app use `internal`** — it's the only
track where testers install without buying. Notes follow supply's layout:
`<google.metadataDir>/<play-locale>/changelogs/<versionCode>.txt`, falling back to `default.txt`, capped
at Play's 500 chars. DRY by default like `fill --store google`; `VYDANNE_COMMIT=1` publishes. The
versionCode comes from the bundle itself, so re-uploading one fails loudly instead of silently replacing.

`--store google` routes `inspect` · `diff` · `preflight` · `fill` · `prerelease` to the Play Developer **Edits** API
(OAuth2 service account; **scoped to the config's `packageName`** — a shared key can't touch another app).
`fill --store google` is **DRY by default**; `VYDANNE_COMMIT=1` commits. The AAB binary and the
(YouTube-URL) promo video stay outside vydanne.

**Env toggles:** `VYDANNE_CONFIG` · `VYDANNE_SKIP_METADATA` / `VYDANNE_SKIP_SCREENSHOTS` (fill) ·
`VYDANNE_COMMIT` (Play fill) · `VYDANNE_REPLACE` (previews) · `VYDANNE_FLATTEN=<png>` (iap) ·
`VYDANNE_A11Y_PUBLISH` (accessibility).

## Flow

config → **write the English master listing (ASO, research-grounded)** → `preflight` (char limits) → fan
out one copywriter agent per locale → media from zdymak → `fill` + `previews` + declarations → `diff`
(dry-run) → `preflight` (must be green) → **a human submits**.

## Gotchas it encodes (don't re-derive)

ASC locale folder codes must be exact (`de`→`de-DE`; a bad one aborts the upload) · `name`/`subtitle` on
AppInfo vs `description`/`keywords`/`promo` on the version · macOS is a separate platform · list endpoints
return sparse/empty text (read each localization by id) · primary locale must be populated · App Privacy is
on the `iris` host (JWT 401s — UI only) · accessibility can't publish until live (409) · edit-version /
app-info / deliver all break at READY_FOR_REVIEW (fetch by id; native PATCH still works) ·
screenshots/IAP images must be RGB no-alpha · IAP has two image slots (tall review screenshot vs 1024²
promo) · char limits (name/subtitle 30, keywords 100, promo 170; IAP name 30 / desc 45; Play title 30 /
short 80 / full 4000) · **Play uses its OWN locale codes** · Play images push only when the local file
exists, so a missing set never wipes the live one · Apple requires `name` when *creating* an app-info
localization (409 otherwise).
