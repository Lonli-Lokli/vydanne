# Releasing vydanne

Publishing is automated via **npm Trusted Publishing (OIDC)**: no `NPM_TOKEN`, no secret to rotate or leak, and
provenance is generated automatically (the repo and the package are public). It is the path npm and GitHub recommend
now that long-lived tokens are gone: **classic tokens were revoked on 2025-12-09**, `npm login` gives a two-hour
session that still asks for your OTP to publish, and a granular write token lives at most 90 days. Trusted publishing
needs none of those.

## One-time setup, per package

The package already exists, so there is no chicken-and-egg. As the npm owner, from a terminal:

```sh
npm login                                        # a two-hour session; publishing from it needs your OTP
npm trust github vydanne --file publish.yml --repo Lonli-Lokli/vydanne --allow-publish
npm trust list vydanne                           # confirm the entry is there
```

(Or on npmjs.com: the package → **Settings → Trusted Publishers → Add** → GitHub Actions, repo
`Lonli-Lokli/vydanne`, workflow `publish.yml`. The workflow filename must match exactly, extension included.)
Once the first publish through GitHub has succeeded, tighten the package: **Settings → Publishing access →
"Require two-factor authentication and disallow tokens"**, so nothing but trusted publishing (or an interactive
session) can ever publish it.

## Every release

```sh
npm version patch -m "release: v%s"      # or minor / major — checks nothing is dirty, bumps package.json, tags
git push --follow-tags
gh release create "v$(node -p "require('./package.json').version")" --generate-notes
```

Creating the GitHub **Release** fires `.github/workflows/publish.yml`, which installs, runs `npm run verify` (via
`prepublishOnly`) and publishes over OIDC with provenance. The Release step is your human approval gate.

Run the last two lines as the **account that owns the repository** (`Lonli-Lokli`): `gh auth status` must name it, and a
different logged-in account that has no push access cannot create the Release. **Do not combine this with
`npm run release:*`**: that script publishes from your laptop first, the workflow's publish then fails because the
version already exists, and the package ends up with no provenance.

## Local publish (escape hatch)

For publishing without CI, one command bumps + publishes + pushes the tag. Run `npm login` first (a two-hour
session, since classic tokens no longer exist); npm then prompts for your 2FA OTP at publish time. It carries no provenance:

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
