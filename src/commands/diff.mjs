import fs from "node:fs";
import path from "node:path";
import { green, yellow, red } from "../util.mjs";
import { VALID } from "../locales.mjs";
import { md5 } from "../upload.mjs";
import { localScreenshots, remoteScreenshots, compareShots, localScreenshotLocales } from "../screenshots.mjs";

// [asc attribute, local metadata filename, isLongText]
const VERSION_FIELDS = [
  ["description", "description", true], ["keywords", "keywords", false], ["promotionalText", "promotional_text", false],
  ["whatsNew", "release_notes", true], ["marketingUrl", "marketing_url", false], ["supportUrl", "support_url", false],
];
const INFO_FIELDS = [["name", "name", false], ["subtitle", "subtitle", false]];

const norm = (s) => (s == null ? null : String(s).replace(/\r/g, "").replace(/\n+$/, "").trim());
const short = (s, n = 24) => { s = String(s).replace(/\n/g, " "); return s.length > n ? s.slice(0, n) + "…" : s; };

// Show what's different between the local sources (metadata folders, screenshots, previews) and App Store
// Connect — i.e. what `fill` / `previews` would change. Reads each localization by id (list is sparse).
export async function run(config, client) {
  await client.findApp(config.bundleId);
  // allowLive for the same reason as editVersion below: comparing local name/subtitle against what is
  // on sale is a legitimate read, and on an app with nothing in preparation the live record is the
  // only one to compare against.
  const info = await client.appInfo({ allowLive: true });
  const infoLocs = info ? (await client.get(`/v1/appInfos/${info.id}/appInfoLocalizations?limit=200`)).json.data || [] : [];
  let actionable = 0; // differences `fill`/`previews` would actually change (release_notes on a 1.0 is benign)

  for (const platform of config.platforms) {
    // allowLive: comparing local against the version ON SALE is a legitimate question and often the
    // reason to run this before preparing a release. The state is printed below, so it is never unclear
    // WHICH version the comparison is against — and `fill` no longer targets a live one either way.
    const v = await client.editVersion(platform, { allowLive: true });
    if (!v) { console.log(red(`${platform}: no version at all`)); continue; }
    console.log(`${platform}  v${v.attributes.versionString} ${v.attributes.appStoreState}`);
    const verLocs = await client.versionLocalizations(v.id);
    const localDirs = fs.existsSync(config.metadataDir)
      ? fs.readdirSync(config.metadataDir, { withFileTypes: true }).filter((d) => d.isDirectory() && VALID.has(d.name)).map((d) => d.name)
      : [];

    const presence = {}; // field -> { localOnly:[], remoteOnly:[] }  (systematic — aggregated, not per-locale)
    for (const code of localDirs) {
      const folder = path.join(config.metadataDir, code);
      const readL = (f) => { const p = path.join(folder, `${f}.txt`); return fs.existsSync(p) ? norm(fs.readFileSync(p, "utf8")) : null; };
      const vl = verLocs.find((l) => l.attributes.locale === code);
      const il = infoLocs.find((l) => l.attributes.locale === code);
      const vAttrs = vl ? await client.localization(vl.id) : {};
      const iAttrs = il ? await client.localization(il.id, "appInfoLocalizations") : {};
      const content = []; // per-locale value differences (the ones you usually care about)
      const record = (file, L, R, long) => {
        const c = cmp(L, R, long);
        if (!c) return;
        if (c.kind === "diff") { content.push(`${file} ${red("differs")} ${c.detail}`); actionable++; return; }
        const arr = (presence[file] ||= { localOnly: [], remoteOnly: [] });
        if (c.kind === "local-only") { arr.localOnly.push(code); if (file !== "release_notes") actionable++; }
        else { arr.remoteOnly.push(code); actionable++; }
      };
      if (!vl) { content.unshift(yellow("[fill would create localization]")); actionable++; }
      for (const [attr, file, long] of VERSION_FIELDS) record(file, readL(file), norm(vAttrs[attr]), long);
      for (const [attr, file, long] of INFO_FIELDS) record(file, readL(file), norm(iAttrs[attr]), long);
      if (content.length) console.log(`  ${code}: ${content.join(" · ")}`);
    }
    for (const [file, p] of Object.entries(presence)) {
      const hint = file === "release_notes" ? "  (What's New — N/A on a first version)" : "";
      if (p.localOnly.length) console.log(`  ${green(`${file} local-only`)} in ${p.localOnly.length} locale(s)${hint}`);
      if (p.remoteOnly.length) console.log(`  ${yellow(`${file} remote-only`)} in ${p.remoteOnly.length} locale(s)`);
    }

    const localSet = new Set(localDirs);
    const extra = verLocs.map((l) => l.attributes.locale).filter((c) => !localSet.has(c));
    if (extra.length) console.log(`  ${yellow("remote-only locales")} (no local folder): ${extra.join(", ")}`);

    actionable += await mediaDiff(config, client, platform, verLocs);
  }

  console.log();
  console.log(actionable ? yellow(`${actionable} actionable difference(s) — run \`fill\` / \`previews\` to sync`) : green("in sync — local matches App Store Connect"));
  return true;
}

function cmp(L, R, long) {
  if (L == null && (R == null || R === "")) return null;
  if (L == null) return { kind: "remote-only" };
  if (R == null || R === "") return { kind: "local-only" };
  if (L === R) return null;
  return { kind: "diff", detail: long ? `(local ${L.length} / remote ${R.length} ch)` : `local="${short(L)}" remote="${short(R)}"` };
}

async function mediaDiff(config, client, platform, verLocs) {
  const primary = verLocs.find((l) => l.attributes.locale === config.primaryLocale);
  if (!primary) return 0;
  let diffs = 0;
  // Compared by CONTENT, not by count — the machinery lives in src/screenshots.mjs and is shared with
  // `preflight`, so the two commands cannot drift apart in what "in sync" means. The history is there.
  // Every locale with a local set, for the reason preflight now does the same: `bridge` writes one
  // folder per translated locale, and checking only the primary reported "in sync" about a listing
  // whose other nineteen locales were showing last month's art.
  for (const code of [...new Set([config.primaryLocale, ...localScreenshotLocales(platform, config)])]) {
    const loc = verLocs.find((l) => l.attributes.locale === code);
    if (!loc) continue;
    const local = localScreenshots(platform, code, config);
    const remote = await remoteScreenshots(client, loc.id);
    for (const dt of new Set([...Object.keys(local), ...Object.keys(remote)])) {
      const c = compareShots(local[dt] || new Map(), remote[dt] || new Map());
      if (!c) continue;
      const label = `  ${yellow("screenshots")} ${dt.replace("APP_", "")}`;
      if (c.kind === "count") {
        diffs++;
        console.log(`${label}: local ${c.local} / remote ${c.remote}  (@${code})`);
      } else if (c.kind === "renamed") {
        diffs++;
        console.log(`${label}: ${c.names.length} not on the store by name (${c.names.slice(0, 3).join(", ")})  (@${code})`);
      } else if (c.kind === "stale") {
        diffs++;
        console.log(`${label}: ${c.names.length} of ${c.of} differ in content (${c.names.slice(0, 3).join(", ")})  (@${code})`);
      } else {
        // Apple did not give a checksum back. Say so rather than reporting a match we did not establish.
        console.log(`${label}: ${c.names.length} present, checksum not reported by Apple — content unverified  (@${code})`);
      }
    }
  }
  // Previews by content too — the count comparison this replaces had the screenshot bug in miniature:
  // one-local-vs-one-remote reads "in sync" however different the videos are, so a re-rendered App
  // Preview reported nothing to do. `uploadAsset` commits md5(bytes) as sourceFileChecksum for
  // previews exactly as it does for screenshots, so the same comparison is available for free.
  const { json: psets } = await client.get(`/v1/appStoreVersionLocalizations/${primary.id}/appPreviewSets?include=appPreviews&limit=50`);
  const prevById = new Map((psets.included || []).filter((r) => r.type === "appPreviews").map((r) => [r.id, r.attributes || {}]));
  const remotePrev = {};
  for (const s of psets.data || []) {
    remotePrev[s.attributes.previewType] = (s.relationships?.appPreviews?.data || [])
      .map((ref) => prevById.get(ref.id)?.sourceFileChecksum ?? null);
  }
  for (const spec of (config.previews || []).filter((s) => s.platform === platform && (s.locales || []).includes(config.primaryLocale))) {
    const file = path.resolve(spec.file);
    const L = fs.existsSync(file) ? 1 : 0;
    const R = remotePrev[spec.type] || [];
    const label = `  ${yellow("preview")} ${spec.type}`;
    if (L !== R.length) {
      diffs++;
      console.log(`${label}: local ${L} / remote ${R.length}  (@${config.primaryLocale})`);
    } else if (L === 1) {
      if (R.every((sum) => sum === null)) {
        console.log(`${label}: present, checksum not reported by Apple — content unverified`);
      } else if (!R.includes(md5(fs.readFileSync(file)))) {
        diffs++;
        console.log(`${label}: differs in content (${path.basename(spec.file)})  (@${config.primaryLocale})`);
      }
    }
  }
  return diffs;
}
