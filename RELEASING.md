# Releasing vydanne

Publishing is automated via **npm Trusted Publishing (OIDC)** — no `NPM_TOKEN`, no secret to rotate or
leak. It's the path npm now recommends after deprecating 2FA-bypass tokens (those lose publish ability
~Jan 2027). Provenance is generated automatically.

## One-time setup (≈2 minutes)

1. **First publish** (creates the package name). From a clean checkout, with 2FA on your npm account:
   ```sh
   npm publish --access public
   ```
   (Chicken-and-egg: a trusted publisher can only be attached to a package that exists.)

2. **Attach the trusted publisher.** npmjs.com → the `vydanne` package → **Settings → Trusted Publishers →
   Add** → GitHub Actions · repo `Lonli-Lokli/vydanne` · workflow `publish.yml`. (Leave environment blank
   unless you use one.)

That's it — from now on CI publishes with zero tokens.

## Every release

```sh
npm version patch          # or minor / major — bumps package.json + tags
git push --follow-tags
gh release create "v$(node -p "require('./package.json').version")" --generate-notes
```

Creating the GitHub **Release** fires `.github/workflows/publish.yml`, which runs `npm publish` over OIDC.
The Release step is your human approval gate.

## Local publish (escape hatch)

For the **first** publish, or publishing without CI, one command bumps + publishes + pushes the tag (npm
prompts for your 2FA OTP — no stored token):

```sh
npm run release:patch      # or release:minor / release:major
```

`scripts/release.mjs` refuses to run on a dirty tree, **verifies npm auth before touching anything**, and
runs both drift guards (`check:docs`, `check:types`) first. Provenance is only generated on the CI/OIDC
path, so prefer the GitHub Release flow for regular releases.

**The npm auth gate.** `npm version` creates a commit *and* a tag, so a login problem discovered at
`npm publish` time would leave the repo bumped and tagged with nothing published — annoying to unpick. The
script therefore checks `npm whoami` and `npm owner ls vydanne` up front and aborts while the tree is still
clean. An unclaimed name is treated as a first publish, not an error. Check yourself anytime with:

```sh
npm whoami            # who am I publishing as?
npm owner ls vydanne  # may this account publish it? (404 until the first publish)
```

## Notes

- **npm v12 install-time security**: lifecycle scripts are off by default now. `pdfkit` is pure JS;
  `sharp` *does* declare an install script (`node install/check`), but it only **verifies** the binary —
  the actual libvips binaries arrive **prebuilt** via optional dependencies (`@img/sharp-*`). Skipping the
  script is harmless (verified: `flatten().removeAlpha().png()` works on a scripts-off install), so
  `npm ci` needs no `--allow-scripts`; npm just prints an `allow-scripts` warning.
- **`sharp` is pinned to `^0.35.3`** — every `<0.35.0` line carries the high-severity inherited libvips
  CVEs (GHSA-f88m-g3jw-g9cj). That's why `engines.node` is **`>=20.9.0`** (sharp 0.35's floor) rather than
  zdymak's `>=18`. Don't downgrade sharp to widen the engine range.
- **Provenance** requires a **public** repo; on a private repo publishing still works but no provenance
  statement is generated.
- Consumers install with `npm i -D vydanne`. Auth is theirs, not ours: an App Store Connect `.p8` at
  `~/.appstoreconnect/private_keys/AuthKey_<id>.p8` + `ASC_KEY_ID` / `ASC_ISSUER_ID`, and for Play a
  service-account JSON via `PLAY_JSON_KEY_FILE`.
- The consuming app runs vydanne from **its repo root** — `vydanne.config.mjs` and the config's relative
  paths (`metadataDir`, `previews[].file`) resolve against the working directory.
