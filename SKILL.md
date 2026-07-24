---
name: vydanne
description: Prepare an App Store Connect / Google Play submission — write AND push the localized store listing. Crafts the ASO copy (app-store name, subtitle, the 100-char keyword field, description, promo text) grounded in the portfolio's audience research, then fills the listing + screenshots + previews, age rating, review contact, accessibility & App Privacy labels, IAP fields, and export-compliance docs; verifies with a preflight gate and diffs local-vs-live. Native Node (ES256 JWT + fetch, no fastlane/Ruby). One vydanne.config.mjs per app. Use when writing or shipping any App Store / Play listing. Never submits — a human attaches the signed build and hits Submit.
---

# vydanne

The App Store Connect / Google Play half of a two-part release pipeline (**zdymak** makes the media;
vydanne writes + fills the listing + compliance). Native Node — no fastlane/Ruby/Python. Two jobs:
**(A) write the listing well (ASO)**, **(B) push it + declarations**.

## Setup

One `vydanne.config.mjs` per app (schema: `vydanne.config.example.mjs`; type
`import('vydanne').VydanneConfig`). Auth: `~/.appstoreconnect/private_keys/AuthKey_<id>.p8` +
`ASC_KEY_ID` / `ASC_ISSUER_ID`. `npm i -D vydanne`, then `npx vydanne <cmd>` **from the app's repo root**
(the config and its relative paths resolve against the working directory).

**Config fields:** `bundleId` · `primaryLocale` (the fallback — must be populated) · `asc` · `platforms`
(iOS and macOS are SEPARATE) · `uiLocales` (auto-mapped to ASC codes) · `metadataDir` · `rating` ·
`privacy` · `iaps` · `previews` · `export` · `google` (Google Play).

**Google Play** — add a `google` block (`packageName`, `metadataDir`, `defaultLocale`) + `PLAY_JSON_KEY_FILE`,
then `--store google`: `inspect` · `diff` · `preflight` · `fill` run against the Play Developer **Edits** API
(OAuth2 service account, native; **scoped to that one `packageName`** — a shared account key can't touch
another app). Listing lives in `<metadataDir>/<play-code>/{title,short_description,full_description}.txt` —
Play uses its **own** locale codes (`de-DE`, `zh-CN`, `iw-IL`, `ar`, `be` …, *not* Apple's). `fill` also
pushes the store `icon` (512²), `featureGraphic` (1024×500), and phone / 7″ / 10″ screenshots when the local
asset exists. `fill --store google` is **DRY by default**; `VYDANNE_COMMIT=1` commits. The AAB binary and the
(YouTube-URL) promo video stay in fastlane / the Console.

## A. Writing the listing (the ASO craft — this is the durable value)

Store copy lives per-locale in `<metadataDir>/<locale>/*.txt` (name, subtitle, keywords,
promotional_text, description, release_notes, urls). **Write the English master first, then localize.**

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
- **Omit** "app", "game", "free", and your own app name — Apple indexes those automatically.
- Apple **auto-combines** keywords into phrases (kw+kw), so prefer **single words** to maximize combinations — no multi-word phrases unless the phrase is the exact search.
- **No competitor trademarks** as keywords for a game (rejection risk) — even though a tool app might.
- Prioritize by **relevance × search volume × achievable rank**: generic head terms ("puzzle") are hard to rank; mid-tail ("no guess minesweeper", "daily logic") convert AND rank. Order best-first (leading keywords weigh more).

### Positioning — grounded in real audience research (example: a daily puzzle game)

The copy must reflect what the audience research shows, not generic hype:
- **Lead with Completion + the daily ritual** — the one motivation that wins across every gender/age segment. "A new field every day", "keep your streak", "collect the art".
- **Accessibility is the growth feature + our differentiator** — "every board is solvable without a guess", "no tutorial — teachable in one line", "instant play". The no-guess engine is unique; say it plainly, never a coin-flip.
- **Make competition optional** — do NOT lead with leaderboards/ranking; the puzzle audience skews female + older and responds to calm mastery, not competitive hype.
- **Voice: calm, premium, understated** — no gamification hype ("crush it", "🔥 streak", forced `!`). Same voice as the in-app copy (see the `game-translator` agent's voice note).
- Name the unique visual hook — "uncover a piece of generative art as you clear the field".

### Description shape (App Store & Play)

Hook (1–2 lines: the promise) → **WHY <APP>** (3–5 benefit bullets, each benefit-first) → what it is /
who it's for → honest close (no ads / no account / free-to-play, whatever's true). Keep it scannable;
lead each bullet with the payoff, not the feature. A tight, benefit-led `description.txt` where every
bullet opens with the payoff is the bar.

### Keyword seed per game (research the REAL terms; curate to ~100 chars)

Niva (minesweeper) starting pool — drop any word in the name/subtitle, pick singular, order by value:
`minesweeper,mines,daily,no guess,logic,brain,sweeper,board,minesweep,deduction,brain training,offline,streak,solvable,number,flag,classic,relax` → trim to fit 100 with the highest-value first. Validate real
demand where possible (App Store search suggestions, competitor titles) before committing.

### Localizing the listing (transcreation, not translation)

- **App name**: the brand ("Niva") is **never** translated; the DESCRIPTOR ("Daily Minesweeper") MAY be localized per store locale.
- **Keywords**: use the target market's **actual search terms**, not a dictionary translation — e.g. minesweeper → `Buscaminas` (es), `マインスイーパー` (ja), `Сапёр` (ru/be/uk), `Minensuchspiel/Minesweeper` (de). Research per market.
- **Subtitle / promo / description**: **transcreate** — adapt the benefit + tone naturally; never word-for-word.
- Fan out one locale per **`store-copywriter`** agent (Sonnet), same pattern as `translate-game`/`game-translator`. Give each: the master English copy, the target locale, its `<metadataDir>/<locale>/` dir, the brand name (untranslated), and the positioning above.

## B. Commands (push it)

`fill` (metadata + screenshots, native PATCH/chunked upload — works even at READY_FOR_REVIEW) ·
`previews` (App Preview videos) · `age-rating` · `review-contact` · `accessibility` (draft; publish once
live) · `privacy` (UI/passkey — the API can't reach Apple's iris host) · `iap` (validate + RGB flatten) ·
`compliance` (US self-classification PDF) · `diff` (what differs vs live) · `preflight` (completeness gate) ·
`inspect` · `locales` · `version`. Never submits.

## Flow

config → **write English master listing (ASO, research-grounded)** → `preflight` (char limits) → fan out
`store-copywriter` per locale → zdymak media → `fill` + `previews` + declarations → `diff` (dry-run) →
`preflight` (must be green) → a human submits.

## Gotchas it encodes (don't re-derive)

ASC locale folder codes must be exact (`de`→`de-DE`; a bad one aborts the upload) · `name`/`subtitle` on
AppInfo vs `description`/`keywords`/`promo` on the version · macOS is a separate platform · list endpoints
return sparse/empty text (read each localization by id) · primary locale must be populated · App Privacy is
on the `iris` host (JWT 401s) · accessibility can't publish until live · edit-version/app-info/deliver all
break at READY_FOR_REVIEW (fetch by id; native PATCH still works) · screenshots/IAP images must be RGB
no-alpha · IAP has two image slots · char limits (name/subtitle 30, keywords 100, promo 170; IAP name 30 /
desc 45; Play title 30 / short 80 / full 4000) · **Play uses its OWN locale codes** (folder = Play code:
`zh-CN`/`iw-IL`/`ar`/`be`, not Apple's `zh-Hans`/`he`/`ar-SA`) · Play images push only when the local file
exists (icon 512², featureGraphic 1024×500, phone / 7″ / 10″) so a missing set never wipes the live one.
