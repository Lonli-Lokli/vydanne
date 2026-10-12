import fs from "node:fs";
import path from "node:path";
import { VALID } from "./locales.mjs";
import { md5 } from "./upload.mjs";
import { CREATIVE_SLOTS, matchFile, mediaKind } from "./assetCatalog.mjs";
import { md5FromReference } from "./assetLibrary.mjs";

/**
 * The product page header and the search results asset — local side.
 *
 * WHAT THEY ARE. Since iOS 27 a product page can open with a wide header image or looping video, and a
 * search result can show one in place of the first screenshots. Both are optional, both are per
 * localization, and each holds exactly one asset (the catalog's limit is 1). One 5244×2950 PNG is a
 * "universal" asset that fits both slots.
 *
 * WHERE THEY LIVE. `<creative.dir>/<ASC-locale>/header.<ext>` and `search.<ext>`, default
 * `fastlane/creative` — the same one-folder-per-App-Store-locale shape as the screenshots beside it, so a
 * locale code is checked the same way (`de-DE`, never `de`). An image (.png/.jpg/.jpeg) or a video
 * (.mp4/.m4v/.mov), never both for one slot: a placement holds one asset, and choosing between two files
 * on someone's behalf is how the wrong one ships.
 */
export const DEFAULT_CREATIVE_DIR = "fastlane/creative";
export const creativeBase = (config) => config?.creative?.dir || DEFAULT_CREATIVE_DIR;

const SLOT_FILE = /^(header|search)\.(png|jpe?g|mp4|m4v|mov)$/i;

/**
 * What is on disk: `{ locales: { code: { header: [file…], search: [file…] } }, strays, unknown }`.
 * `strays` are folders that are not App Store locale codes; `unknown` files that are not `header.*` or
 * `search.*`. Both are reported by the caller, never dropped in silence.
 */
export function localCreative(config) {
  const base = creativeBase(config);
  const out = { base, locales: {}, strays: [], unknown: [] };
  if (!fs.existsSync(base)) return out;
  for (const d of fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
    if (!VALID.has(d)) { out.strays.push(d); continue; }
    const slots = {};
    for (const f of fs.readdirSync(path.join(base, d)).sort()) {
      if (f.startsWith(".")) continue;
      const m = SLOT_FILE.exec(f);
      if (!m) { out.unknown.push(path.join(d, f)); continue; }
      (slots[m[1].toLowerCase()] ||= []).push(path.join(base, d, f));
    }
    if (Object.keys(slots).length) out.locales[d] = slots;
  }
  return out;
}

/**
 * Every local creative file matched against Apple's catalog, before anything is sent.
 *
 * Returns `{ plan, problems }`. `plan` is one entry per locale and slot that has something to place:
 * `{ locale, slot, file, kind, md5, spec, fromHeader }`. `problems` are the reasons a real run would be
 * refused — the same list `preflight` reports, so the two cannot disagree about what is valid.
 *
 * `creative.searchFromHeader` places a UNIVERSAL header (the 5244×2950 PNG) in search results as well,
 * for a locale with no `search.*` of its own — what App Store Connect's "Use header asset in search
 * results" box does. Off by default: a search-results asset is a change to how the app appears in
 * search, and that is worth one line of config to say out loud.
 */
export async function checkCreative(config, catalog) {
  const local = localCreative(config);
  const plan = [];
  const problems = [];
  for (const [locale, slots] of Object.entries(local.locales)) {
    for (const [slot, files] of Object.entries(slots)) {
      if (files.length > 1) {
        problems.push(`${locale}: ${files.length} files for the ${CREATIVE_SLOTS[slot].label} (${files.map((f) => path.basename(f)).join(", ")}) — a placement holds one; keep one`);
        continue;
      }
      const file = files[0];
      const { placementType, group } = CREATIVE_SLOTS[slot];
      const m = await matchFile(file, catalog.specsFor(placementType, group));
      if (m.problem) { problems.push(`${locale}: ${path.basename(file)} — ${m.problem}`); continue; }
      plan.push({ locale, slot, file, kind: mediaKind(file), md5: md5(fs.readFileSync(file)), spec: m.spec, fromHeader: false });
    }
    if (config.creative?.searchFromHeader && !slots.search) {
      const header = plan.find((p) => p.locale === locale && p.slot === "header");
      if (!header) continue;
      const fits = catalog.specsFor(CREATIVE_SLOTS.search.placementType, CREATIVE_SLOTS.search.group)
        .some((s) => s.specId === header.spec.specId);
      if (fits) plan.push({ ...header, slot: "search", fromHeader: true });
      else problems.push(`${locale}: searchFromHeader is on, but ${path.basename(header.file)} is not a universal asset — only a 5244×2950 PNG fits both slots (or add a search.* of its own)`);
    }
  }
  return { local, plan, problems };
}

/**
 * Local plan vs what one localization's placements show, by CONTENT — the md5 vydanne wrote into the
 * asset's reference name, because the library keeps no checksum of its own. One finding per slot that
 * is not in sync, the kinds kept apart because each wants a different action (the screenshot comparison
 * in screenshots.mjs makes the same distinction):
 *   missing     local has it, the store shows nothing there        → `creative --apply`
 *   stale       the store shows a different file                    → `creative --apply` with VYDANNE_REPLACE=1
 *   unverified  the store's asset carries no md5 (uploaded by hand) → nothing to compare against; said, not judged
 *   failed      Apple could not process what was placed             → replace the file
 *   remoteOnly  the store shows one and there is no local file      → informational; vydanne never deletes by omission
 */
export function compareCreative(planForLocale, placements) {
  const findings = [];
  for (const slot of Object.keys(CREATIVE_SLOTS)) {
    const local = planForLocale.find((p) => p.slot === slot);
    const remote = (placements || []).filter((p) => p.placementType === CREATIVE_SLOTS[slot].placementType);
    if (remote.some((p) => p.state === "FAILED" || p.asset?.state === "FAILED")) { findings.push({ slot, kind: "failed" }); continue; }
    if (!local) {
      if (remote.length) findings.push({ slot, kind: "remoteOnly", name: remote[0].asset?.fileName ?? null });
      continue;
    }
    if (!remote.length) { findings.push({ slot, kind: "missing", file: local.file }); continue; }
    const sum = md5FromReference(remote[0].asset?.referenceName);
    if (!sum) findings.push({ slot, kind: "unverified", file: local.file, name: remote[0].asset?.fileName ?? null });
    else if (sum !== local.md5) findings.push({ slot, kind: "stale", file: local.file, name: remote[0].asset?.fileName ?? null });
  }
  return findings;
}
