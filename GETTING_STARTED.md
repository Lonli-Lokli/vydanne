# Getting started with vydanne

A step-by-step setup for **your** app — written so you can follow it without being a developer. Every
step is a command to paste or a button to click. Budget ~30 minutes the first time; after that a release
is three commands.

If you'd rather skim: [What vydanne does](#0-what-vydanne-does-and-what-stays-yours) →
[Accounts](#1-what-you-need-before-you-start) → [Install](#2-install-vydanne) →
[Apple key](#3-get-your-apple-credentials-once) → [Play key](#4-get-your-google-play-credentials-once-android-only) →
[Config](#5-write-the-config-file) → [Folders](#6-put-your-text-and-images-where-vydanne-looks) →
[Push it](#8-push-it-to-the-store).

---

## 0. What vydanne does, and what stays yours

vydanne fills in **an app record that already exists**. It does not create apps, build software, or
submit anything for review.

| vydanne does | You (or your developer) still do |
|---|---|
| Write/push the store text in every language | **Create the app record** in App Store Connect / Play Console |
| Upload screenshots, app previews, Play graphics | **Build and sign the binary** (`.ipa` / `.aab`) |
| Upload that binary to testers (`prerelease`: TestFlight internal / a Play testing track) | Answer **App Privacy** in Apple's web UI (see [step 9](#9-finish-in-the-browser-the-parts-no-api-can-do)) |
| Set age rating, App Review contact, IAP text | Play **Data Safety** + content-rating questionnaires |
| Generate the US export-compliance PDF · check everything is complete (`preflight`) | **Press Submit for Review** |

> **It never submits.** That's deliberate — a human should always be the one who ships.

---

## 1. What you need before you start

**For Apple (iPhone / iPad / Mac):**
1. An **Apple Developer Program** membership (~$99/year) — [developer.apple.com/programs](https://developer.apple.com/programs/).
2. An **app already created** in [App Store Connect](https://appstoreconnect.apple.com) → **My Apps → +**.
   You need its **Bundle ID** (e.g. `com.example.myapp`).
3. Permission to create API keys: your account must be **Account Holder** or **Admin**.

**For Google Play (Android)** — skip if you're iOS-only:
1. A **Play Console** developer account (one-time $25) — [play.google.com/console](https://play.google.com/console).
2. An **app already created** in Play Console, with its **package name** (e.g. `com.example.myapp`).
3. For a brand-new app, upload your first build through the Play Console web UI once. The API can edit a
   listing, but a never-released app has nothing to attach a listing to.

**On your computer:**
- **Node.js 20.9 or newer.** Check with `node -v`. If it's missing or older, install the LTS build from
  [nodejs.org](https://nodejs.org).
- **macOS, Linux, or Windows** — vydanne runs on all three.

> **Windows users:** every step below shows both versions. Use the **PowerShell** one (open *Terminal* or
> *Windows PowerShell* from the Start menu). The commands are not interchangeable — `export` and
> `VAR=1 command` are Unix-only syntax and will fail in PowerShell.

---

## 2. Install vydanne

Open your terminal and go to your app's project folder (the top level — the folder you'd open in an editor):

```sh
# macOS / Linux
cd /path/to/your-app
```
```powershell
# Windows PowerShell
cd C:\path\to\your-app
```

If there's no `package.json` there yet, create one (harmless — it just records your tools):

```sh
npm init -y
```

Install vydanne and confirm it runs:

```sh
npm i -D vydanne
npx vydanne version
```

You should see something like `vydanne 0.1.0`.

> **Always run vydanne from this folder.** It reads `vydanne.config.mjs` and every file path relative to
> wherever you are. Running it from a subfolder will make it look in the wrong place.

---

## 3. Get your Apple credentials (once)

vydanne talks to Apple with an **API key** — three pieces: a `.p8` file, a **Key ID**, and an **Issuer ID**.

1. Go to [App Store Connect](https://appstoreconnect.apple.com) → **Users and Access**.
2. Open the **Integrations** tab → **App Store Connect API** → **Team Keys**.
3. Click **+**, name it `vydanne`, and set **Access** to **App Manager**. *(Admin also works. Anything
   lower can't edit a listing.)*
4. Click **Generate**, then **Download the key**. ⚠️ **Apple lets you download it exactly once.** If you
   lose it, revoke the key and make a new one.
5. On that same page, copy the **Key ID** (next to your new key) and the **Issuer ID** (at the top of the
   list — one per team, looks like `57246542-96fe-1a63-e053-0824d011072a`).

Now put the file where vydanne looks for it — inside a `.appstoreconnect\private_keys` folder in your
home directory. vydanne finds your home folder automatically on every operating system.

```sh
# macOS / Linux
mkdir -p ~/.appstoreconnect/private_keys
mv ~/Downloads/AuthKey_*.p8 ~/.appstoreconnect/private_keys/
```
```powershell
# Windows PowerShell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.appstoreconnect\private_keys"
Move-Item "$env:USERPROFILE\Downloads\AuthKey_*.p8" "$env:USERPROFILE\.appstoreconnect\private_keys\"
```

Tell your terminal the two IDs (substitute your own values):

```sh
# macOS / Linux
export ASC_KEY_ID=ABCD123456
export ASC_ISSUER_ID=57246542-96fe-1a63-e053-0824d011072a
```
```powershell
# Windows PowerShell
$env:ASC_KEY_ID = "ABCD123456"
$env:ASC_ISSUER_ID = "57246542-96fe-1a63-e053-0824d011072a"
```

**To avoid retyping these every time you open a terminal:**

- **macOS / Linux** — append the same two `export` lines to `~/.zshrc` (or `~/.bashrc`), then run
  `source ~/.zshrc`.
- **Windows** — save them permanently for your user account (run once; then reopen the terminal):
  ```powershell
  [Environment]::SetEnvironmentVariable("ASC_KEY_ID", "ABCD123456", "User")
  [Environment]::SetEnvironmentVariable("ASC_ISSUER_ID", "57246542-96fe-1a63-e053-0824d011072a", "User")
  ```

**Test it:**

```sh
npx vydanne inspect
```

If you see your app's current state, Apple is wired up. (Errors? See
[Troubleshooting](#troubleshooting).)

---

## 4. Get your Google Play credentials (once, Android only)

Play uses a **service account** — a robot Google account with a JSON key file.

1. In [Play Console](https://play.google.com/console): **Setup → API access**. Link or create a Google
   Cloud project if prompted.
2. Click through to **Google Cloud → Service Accounts**, then **Create service account**. Name it
   `vydanne`. You can skip the optional role/user steps.
3. Open the new service account → **Keys → Add key → Create new key → JSON**. It downloads immediately —
   this file is a password, keep it out of your project folder and out of git.
4. Back in **Play Console → Users and permissions → Invite new user**. Paste the service account's email
   (it looks like `vydanne@your-project.iam.gserviceaccount.com`).
5. Give it access to **your app only**, with the **Edit store listing, pricing & distribution**
   permission (and **Release** if you'll also push builds later). Send the invite — it's auto-accepted.

Point vydanne at the key — use the **full path**, not a shortcut like `~` (vydanne does not expand it):

```sh
# macOS / Linux
export PLAY_JSON_KEY_FILE="$HOME/keys/play-service-account.json"
```
```powershell
# Windows PowerShell
$env:PLAY_JSON_KEY_FILE = "$env:USERPROFILE\keys\play-service-account.json"
```

**Test it:**

```sh
npx vydanne inspect --store google
```

> vydanne is **scoped to the one `packageName`** in your config. Even a service-account key with wider
> access can't touch another app through vydanne.

---

## 5. Write the config file

Create a file named **`vydanne.config.mjs`** in your project folder. Start from the copy that ships
inside the package:

```sh
# macOS / Linux
cp node_modules/vydanne/vydanne.config.example.mjs vydanne.config.mjs
```
```powershell
# Windows PowerShell
Copy-Item node_modules\vydanne\vydanne.config.example.mjs vydanne.config.mjs
```

A minimal iPhone-only config looks like this — edit the values to match your app:

```js
export default {
  bundleId: "com.example.myapp",   // exactly as registered with Apple
  primaryLocale: "en-US",          // your main language — MUST be filled in
  platforms: ["IOS"],              // add "MAC_OS" only if you also ship a Mac app
  uiLocales: ["en", "de", "fr"],   // the languages you'll publish
  metadataDir: "fastlane/metadata",
  rating: "4+",
};
```

**The fields, in plain terms:**

| Field | What to put |
|---|---|
| `bundleId` | Your app's bundle identifier, exactly as Apple has it. |
| `primaryLocale` | Your main App Store language. Any language you *don't* translate falls back to this, so it must be complete. |
| `platforms` | `["IOS"]`, or `["IOS", "MAC_OS"]` if you ship a Mac app too. **Mac is a separate listing** — its text is not shared with iOS. |
| `uiLocales` | Short language codes you publish in. vydanne converts them to Apple's codes (`de` → `de-DE`) and warns about any language the App Store doesn't offer. |
| `localeMap` | Optional. Your code → Apple's code, for anything the built-in table doesn't cover (`{ "nb": "no" }`). Merged over the defaults, so list only your exceptions. |
| `metadataDir` | Where your listing text lives. `fastlane/metadata` is the default. |
| `screenshots` | Optional. Where your screenshots live, per platform: `{ IOS: "…", MAC_OS: "…" }`. Defaults to `fastlane/screenshots` and `fastlane/screenshots-macos`. |
| `rating` | Age rating, e.g. `"4+"`. Anything other than `"4+"` also needs `ageRating` below. |
| `ageRating` | The content descriptors behind a rating above 4+, e.g. `{ violenceCartoonOrFantasy: "INFREQUENT_OR_MILD" }`. Merged over an all-NONE base — Apple computes the band from what you declare. |
| `reviewContact` | Optional `{ demoAccountRequired }`. By default this is inferred from whether `review_information/demo_user.txt` exists. |
| `asc` | Optional `{ keyId, issuerId }` — only if you'd rather not use environment variables. |
| `privacy` | What data actually leaves the device, e.g. `{ collected: ["CRASH_DATA"], tracking: false }`. |
| `iaps` | Your in-app purchases (name ≤30 chars, description ≤45). |
| `previews` | App Preview videos — see step 7. |
| `export` | Export-compliance details for the PDF: `{ encryption, appName, version, teamId, algorithms, statement, filed }`. `algorithms` and `statement` are **required** when `encryption` is `"standard"` — the command will not invent your cryptography. |
| `google` | The Play block — `{ packageName, metadataDir, defaultLocale, track, images, imageLocales }`. Omit it if you're iOS-only. |
| `bridge` | Optional `{ out, apple, play }` — where zdymak wrote, and which of its output folders feed which store slot. Only needed when `dir:` in `zdymak.config.mjs` makes a folder name differ from its target name. |
| `push` | Optional `{ skip: [...] }` — pipeline steps this app never runs. |

Check your languages resolved correctly:

```sh
npx vydanne locales
```

Anything listed as *unsupported* has no App Store language and will fall back to your primary locale —
**don't** create a folder for it.

---

## 6. Put your text and images where vydanne looks

This is the part that trips people up. vydanne reads **plain `.txt` files in named folders**. One folder
per language, named with **Apple's** code (from `vydanne locales`).

```
your-app/
├─ vydanne.config.mjs
├─ fastlane/
│  ├─ metadata/
│  │  ├─ en-US/                    ← Apple's locale code, not "en"
│  │  │  ├─ name.txt               (≤30)  your app's store name
│  │  │  ├─ subtitle.txt           (≤30)  one benefit line
│  │  │  ├─ description.txt        (≤4000)
│  │  │  ├─ keywords.txt           (≤100) comma-separated, NO spaces
│  │  │  ├─ promotional_text.txt   (≤170) editable anytime, no review
│  │  │  ├─ release_notes.txt      what's new in this version
│  │  │  ├─ marketing_url.txt      (optional)
│  │  │  └─ support_url.txt        (optional)
│  │  ├─ de-DE/  …same files…
│  │  └─ review_information/       ← App Review contact. KEEP OUT OF GIT.
│  │     ├─ first_name.txt
│  │     ├─ last_name.txt
│  │     ├─ phone_number.txt
│  │     ├─ email_address.txt
│  │     └─ notes.txt              how a reviewer tests your app
│  ├─ screenshots/                 ← iPhone / iPad / Watch
│  │  └─ en-US/
│  │     ├─ iphone69_01.png
│  │     ├─ iphone69_02.png
│  │     └─ ipad13_01.png
│  └─ screenshots-macos/           ← Mac only
│     └─ en-US/
│        └─ macos_01.png
```

**Screenshot file names matter.** The part **before the first underscore** tells vydanne which device the
image is for. Anything after it is yours — but files upload in alphabetical order, so number them
`_01`, `_02`, …

| Prefix | Device slot |
|---|---|
| `iphone69_` | iPhone 6.9″ |
| `iphone65_` | iPhone 6.5″ |
| `ipad13_` | iPad Pro 12.9″ |
| `watch_` | Apple Watch Ultra |
| `macos_` | Mac (in `screenshots-macos/`) |

A file whose prefix isn't in that table is **not uploaded**, and `fill` says so by name — it lists every
file it skipped and the prefixes it knows. Same for a folder that isn't an App Store locale code (`de`
instead of `de-DE`, the classic one): named, not dropped in silence.

PNG and JPEG are both accepted.

> **Screenshots must have no transparency.** Simulator captures often carry an alpha channel and Apple
> rejects those. `npx vydanne bridge` refuses before copying anything if it finds one, and tells you
> which file; to fix a single image in place, `VYDANNE_FLATTEN=path/to.png npx vydanne iap` converts it
> to RGB. Note that `fill` itself does **not** convert — flatten at the source.

**Google Play** uses its **own** language codes (`de-DE`, `zh-CN`, `iw-IL`, `ar` — *not* Apple's
`zh-Hans`/`he`), and only three text files:

```
fastlane/metadata/android/
└─ en-US/
   ├─ title.txt              (≤30)
   ├─ short_description.txt  (≤80)
   └─ full_description.txt   (≤4000)
```

Play images are read from **fixed paths**. Each is uploaded only if the file exists, so a missing set
never wipes what's live:

| Play asset | Path vydanne reads |
|---|---|
| Store icon (512×512) | `brand/icons/play/icon-512.png` |
| Feature graphic (1024×500) | `marketing/out/play-feature-graphic.png` |
| Phone screenshots | `marketing/out/play-phone-plain/` |
| 7″ tablet screenshots | `marketing/out/play-tablet7-plain/` |
| 10″ tablet screenshots | `marketing/out/play-tablet-plain/` |

*(These paths are not configurable yet — create the folders at those locations, or symlink them.)*

> **Capturing with [zdymak](https://www.npmjs.com/package/zdymak)?** Its output layout is different
> from all of the above (one `store-assets/` tree, short locale codes, numbered filenames). Run
> **`npx vydanne bridge`** after every capture — it renames and files everything into the Apple and
> Play layouts on this page, holds back screenshots for locales that have no listing text yet, and
> refuses images with an alpha channel before Apple can. `--dry-run` shows what it would do.

---

## 7. Optional extras

**App Preview videos** — add them to your config, then `npx vydanne previews`:

```js
previews: [
  { platform: "IOS", type: "IPHONE_67", file: "marketing/out/preview.mp4",
    poster: "00:00:05:00", locales: ["en-US"] },
],
```

`poster` is the still frame shown before playback, as `HH:MM:SS:FF`. A locale that already has a preview
is skipped; set `VYDANNE_REPLACE=1` to swap in a new one.

**In-app purchases** — list them under `iaps` and run `npx vydanne iap` to validate the character limits
before you paste them into App Store Connect.

**Export compliance** — `npx vydanne compliance` writes the US self-classification PDF to
`export-compliance/`. Attach it in App Store Connect. If you set `france: true`, remember France needs a
separate ANSSI declaration.

---

## 8. Push it to the store

**Every command that changes a store is a dry run until you add `--apply`** — it prints each write it
would make and sends nothing. So the safe rhythm is always: run it, read the plan, run it again with
`--apply`.

The whole Apple release is one command, which runs the seven steps in the only order that works
(`prepare` → `fill` → `previews` → `age-rating` → `review-contact` → `accessibility` → `preflight`) and
stops at the first problem:

```sh
npx vydanne diff          # exactly what would change vs what's live now
npx vydanne push          # DRY RUN of the whole pipeline — read it
npx vydanne push --apply  # do it; ends at a green preflight
npx vydanne privacy       # prints the answers to type into Apple's web UI
```

Each step is also its own command (`npx vydanne fill --apply`, etc.) if you prefer to go one at a time.
Two things worth knowing:

- **Updating an app that's already live?** The draft version to write into doesn't exist until
  `prepare` creates it — `push` runs it first, or run `npx vydanne prepare --apply` yourself. Without
  it, `fill` refuses rather than touching the listing your customers are reading.
- **Replacing screenshots or previews that are already on the store** needs `VYDANNE_REPLACE=1` — by
  default a populated slot is skipped (and says so), never overwritten.

**For Google Play**, the same `--apply` rule applies — a dry run validates against Google for real,
then throws the change away, so a half-finished local folder can't overwrite your live listing:

```sh
# macOS / Linux
npx vydanne fill --store google            # dry run: shows what would happen
npx vydanne fill --store google --apply    # actually commit it
```
```powershell
# Windows PowerShell — same flag, no environment variables needed
npx vydanne fill --store google
npx vydanne fill --store google --apply
```

Finally, run `npx vydanne diff` once more — it compares text *and* image content against the store —
and eyeball one screenshot per platform in the web UI.

---

## 9. Finish in the browser (the parts no API can do)

1. **App Privacy** (Apple) — Apple's privacy API isn't reachable with an API key, so `vydanne privacy`
   prints the exact answers; you paste them into App Store Connect by hand.
2. **Build the binary** — Xcode / Gradle, as usual. `npx vydanne prerelease --apply` can then upload it
   for you (TestFlight internal groups, or a Play testing track). Shipping it to the *public* stays in
   the consoles, always.
3. **Play Data Safety + content rating** — questionnaires in the Play Console.
4. **Submit for Review** — yours to press.

---

## Troubleshooting

| What you see | What it means | Fix |
|---|---|---|
| `config not found at …` | You're in the wrong folder, or the file is misnamed. | `cd` to your project root; the file must be `vydanne.config.mjs`. |
| `ASC key not found at …` | The `.p8` isn't where vydanne looks. | The error prints the exact path it wants — move the file there. List it with `ls ~/.appstoreconnect/private_keys/` (macOS/Linux) or `dir "$env:USERPROFILE\.appstoreconnect\private_keys"` (Windows). |
| `app '…' not found for this ASC key` | The bundle ID is wrong, or the key's team doesn't own the app. | Check `bundleId` matches App Store Connect exactly. |
| `401` / `403` from Apple | Key lacks permission, or the IDs are swapped. | Key access must be **App Manager**+. Confirm `ASC_KEY_ID` vs `ASC_ISSUER_ID` aren't reversed. |
| `no editable version` | The only version is live (read-only) and no draft exists yet. | `npx vydanne prepare --apply` creates the next version — that's its job. |
| A locale was ignored | The folder name isn't an Apple code. | Run `npx vydanne locales` and rename the folder to the code shown. |
| Screenshots didn't upload | Wrong filename prefix, or the slot already has images. | `fill` now names both cases in its output. Use the prefix table above; to replace an already-populated slot, re-run with `VYDANNE_REPLACE=1`. |
| Apple rejects a screenshot | It has an alpha channel. | Flatten to RGB — macOS/Linux: `VYDANNE_FLATTEN=shot.png npx vydanne iap` · Windows: `$env:VYDANNE_FLATTEN="shot.png"; npx vydanne iap`. (`bridge` checks this for you.) |
| `VYDANNE_… =1` "does nothing" on Windows | PowerShell doesn't support the Unix `VAR=1 command` form. | Set it first: `$env:VYDANNE_REPLACE = "1"`, then run the command. |
| `no google block in config` | Play isn't configured. | Add the `google` block and set `PLAY_JSON_KEY_FILE`. |
| Play changes didn't stick | Store-changing commands are dry by default. | Re-run with `--apply`. |
| `accessibility` returns 409 | Labels can't publish before the app is live. | Leave it as a draft; publish after launch with `VYDANNE_A11Y_PUBLISH=1`. |

---

## Reference: environment variables

| Variable | Purpose |
|---|---|
| `ASC_KEY_ID`, `ASC_ISSUER_ID` | Apple API key identifiers (**required**). |
| `PLAY_JSON_KEY_FILE` | Path to the Play service-account JSON (**required for Play**). |
| `VYDANNE_CONFIG` | Use a different config file (same as `--config`). |
| `VYDANNE_SKIP_METADATA` / `VYDANNE_SKIP_SCREENSHOTS` | `fill`: push only one half. |
| `VYDANNE_REPLACE=1` | `fill` / `previews`: delete what's in an already-populated slot and upload yours. |
| `VYDANNE_VERSION=<x>` | `prepare`: name the version when it's created before its build exists. |
| `VYDANNE_IPA=<path>` / `VYDANNE_AAB=<path>` | `prerelease`: override where the binary is found. |
| `VYDANNE_TRACK` / `VYDANNE_RELEASE_NAME` | `prerelease --store google`: testing track / release name. |
| `VYDANNE_FLATTEN=<png>` | `iap`: convert an image to RGB (removes transparency). |
| `VYDANNE_A11Y_PUBLISH=1` | `accessibility`: publish the labels (only once the app is live). |
| `VYDANNE_ALLOW_CROSS_STORE=1` | Skip the other-store-mention check for one run. |
| `VYDANNE_COMMIT=1` | Legacy alias for `--apply` — prefer the flag. |

Set them with `export NAME=value` on macOS/Linux, or `$env:NAME = "value"` in Windows PowerShell.

Secrets — the `.p8`, the Play JSON, and `fastlane/metadata/review_information/` — should **never** be
committed to git. Add them to your `.gitignore`.

---

Next: the [README](README.md) for the full command list and the store gotchas vydanne encodes.
