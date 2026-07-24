# vydanne

**App Store Connect submission prep — the companion to [zdymak](https://www.npmjs.com/package/zdymak).**

zdymak makes the *media* (screenshots, previews, promo images). `vydanne` (Belarusian *выданне* —
"publishing") does everything else App Store Connect needs before a human hits **Submit**: the localized
listing, ratings, review contact, accessibility & privacy labels, IAPs, export-compliance docs — and a
**preflight verifier** that checks completeness the *correct* way and warns on every ASC gotcha before
Apple does.

**Native Node — no fastlane, no Ruby, no Python.** ES256 JWT via Node's built-in `crypto`, the ASC REST
API via `fetch`, the chunked screenshot/preview upload by hand (`reserve → PUT → commit + MD5`), PDFs via
`pdfkit`, RGB flatten via `sharp`. A true `.mjs` sibling to zdymak — no build step.

```
npm i -D vydanne
npx vydanne preflight
```

Run it from **the app's repo root** — `vydanne.config.mjs` and every relative path inside it
(`metadataDir`, `previews[].file`) resolve against the working directory.

One `vydanne.config.mjs` per app (see [`vydanne.config.example.mjs`](vydanne.config.example.mjs); type
`import('vydanne').VydanneConfig`); nothing hard-coded. Auth:
`~/.appstoreconnect/private_keys/AuthKey_<id>.p8` + `ASC_KEY_ID` / `ASC_ISSUER_ID`.

**Config fields:** `bundleId` · `primaryLocale` (fallback — must be populated) · `asc` · `platforms`
(iOS + macOS are separate) · `uiLocales` (auto-mapped to ASC codes) · `metadataDir` · `rating` · `privacy`
· `iaps` · `previews` · `export` · `google` (Google Play).

## Google Play (`--store google`)

vydanne also does the **Play** listing natively (OAuth2 service account → the Play Developer **Edits** API:
insert edit → mutate listings/images/details → commit). Add a `google` block (`packageName`, `metadataDir`
= `fastlane/metadata/android`, `defaultLocale`) and set `PLAY_JSON_KEY_FILE` to the service-account JSON,
then `--store google`:

```
vydanne inspect --store google      # listings, contact, image counts
vydanne diff --store google         # local (fastlane/metadata/android + play assets) vs Play
vydanne preflight --store google    # title/short/full + feature graphic + >=2 phone screenshots
vydanne fill --store google         # DRY by default (validate + discard) — VYDANNE_COMMIT=1 to commit
```

Play differs from Apple (its own gotchas): the **Edits transaction** (nothing is live until commit) · limits
**title 30 / short 80 / full 4000** · its **own locale codes** (`zh-CN`, `iw-IL`, `ar`, `be` … *not* Apple's
`zh-Hans`/`he`/`ar-SA`), so each `metadataDir/<code>/` folder is named for the Play code · the store `icon`
(512²) + `featureGraphic` (1024×500) + screenshot buckets (`phoneScreenshots`, `sevenInchScreenshots`,
`tenInchScreenshots`), each pushed only when its local asset exists so a missing set never deletes the live
one · promo video is a YouTube URL · Data Safety + content rating are separate (UI). `fill --store google` is
**dry unless `VYDANNE_COMMIT=1`** so a stale local set can't clobber a live one. (Binary AAB stays with
fastlane, like the iOS binary.)

## Commands

All native, all verified end-to-end against a live listing:

| Command | Does | Notes |
|---|---|---|
| `fill` | metadata + screenshots via native PATCH / chunked upload | iOS & macOS separate; **works at READY_FOR_REVIEW** (deliver can't); `VYDANNE_SKIP_METADATA` / `VYDANNE_SKIP_SCREENSHOTS`; never duplicates existing shots |
| `age-rating` | set the rating (AppInfo declaration) | v1: `4+` |
| `review-contact` | App Review contact from the gitignored files | |
| `accessibility` | Accessibility Nutrition Labels | draft-safe; `VYDANNE_A11Y_PUBLISH=1` (publishes once app is live) |
| `privacy` | write the record + print the ASC-UI answers | API can't reach `iris` — UI/passkey only |
| `previews` | upload App Preview videos | native reserve→PUT→commit→poll→poster; skips a locale that already has one (`VYDANNE_REPLACE=1` deletes the old preview first, to swap in a new reel) |
| `iap` | validate IAP fields (char limits) | `VYDANNE_FLATTEN=<png>` → RGB (sharp) |
| `compliance` | US encryption self-classification PDF | pdfkit; France = separate ANSSI upload |
| `diff` | show what differs between local and ASC | per-field, per-locale (reads each by id); dry-run of `fill`; distinguishes actionable vs benign |
| `inspect` · `preflight` · `locales` · `version` | read-only / gate / mapping | |

Never submits — a human attaches the signed build and submits.

## The gotchas it encodes (the durable value)

| # | Gotcha | Handled |
|---|---|---|
| 1 | ASC locale folder codes must be exact (`de`→`de-DE`, `ar`→`ar-SA`); a bad one aborts the upload | `locales` maps + flags unsupported (Belarusian) |
| 2 | `name`/`subtitle` on **AppInfo**; `description`/`keywords`/`promo` on the **version** | `fill` writes both; `preflight` reads the version fields |
| 3 | **macOS is a separate platform** — listing text not shared | platforms iterated independently |
| 4 | list endpoints return **empty text** (sparse) | `Client#localization` reads each by id |
| 5 | **primary locale** must be populated | preflight blocks on empty primary |
| 6 | App Privacy is on the **`iris` host** → JWT 401s | `privacy` prints the UI/passkey answers |
| 7 | accessibility **can't publish until live** (409) | staged draft, publish deferred |
| 8 | edit version / app-info / **deliver** all choke at `READY_FOR_REVIEW` | fetch by id from the full list; `fill` uses native PATCH so it still works |
| 9 | screenshots/IAP images must be **RGB, no alpha** | `iap` flatten (sharp) |
| 10 | IAP has **two** image slots (tall Review Screenshot vs 1024² Promotional) | `iap` labels both |
| 11 | preview/screenshot sets need camelCase `previewType`/`screenshotDisplayType` + chunked upload | `upload.mjs` primitive |
| 12 | char limits (30/30/100/170; IAP 30/45) | validated in preflight + iap |

## Types & drift guards

Ships TypeScript definitions ([`types/index.d.ts`](types/index.d.ts), wired via `package.json` `exports`/
`types`) and a package [`SKILL.md`](SKILL.md). Two drift guards keep them honest — the source exports the
canonical surface (`CONFIG_KEYS` in `src/config.mjs`, `COMMAND_NAMES` in `src/registry.mjs`) and the guards
assert each is present:

- `npm run check:docs` — every config field + command is documented in README.md / SKILL.md.
- `npm run check:types` — `tsc --noEmit` + every config field is declared and every command is a literal in
  `types/index.d.ts`.

Both run on `prepublishOnly`, so a new knob or command can't ship undocumented or untyped.

MIT.
