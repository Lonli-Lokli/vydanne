import fs from "node:fs";
import path from "node:path";
import { green, yellow, red } from "../util.mjs";
import { VALID } from "../locales.mjs";
import { uploadAsset } from "../upload.mjs";
import { reportCrossStore } from "../crossStore.mjs";
import { deviceMap, screenshotBase, IMAGE_FILE } from "../screenshots.mjs";

// Version-localization fields (attr -> metadata filename) and AppInfo fields (shared across releases).
const VERSION_TXT = { description: "description", keywords: "keywords", promotionalText: "promotional_text", whatsNew: "release_notes", marketingUrl: "marketing_url", supportUrl: "support_url" };
// `privacyPolicyUrl` belongs here rather than on the version because it is an APP-level fact, not a
// per-release one. Apple blocks Add for Review without it ("You must enter a Privacy Policy URL in
// App Privacy") — a wall you hit at the very end, once everything else is green, and one nothing in
// vydanne could clear because this map stopped at name/subtitle. It is per-LOCALE all the same, so a
// game with a single policy page writes the same line into each locale's `privacy_url.txt`; the
// filename follows fastlane's own convention, so an existing metadata tree needs no rearranging.
const INFO_TXT = { name: "name", subtitle: "subtitle", privacyPolicyUrl: "privacy_url" };

/**
 * PATCH a localization, surviving attributes Apple refuses to edit RIGHT NOW.
 *
 * A version-localization PATCH is all-or-nothing: one un-editable attribute rejects the WHOLE payload
 * with 409 STATE_ERROR and nothing is written. The classic case is `whatsNew` on a first version — there
 * is no previous release, so "What's New" cannot exist, and sending it silently costs you the
 * description and keywords for every locale.
 *
 * So: send everything, and if Apple names offending attributes, drop exactly those and retry once. Any
 * other failure is reported rather than swallowed — a fill that writes nothing must never look like a
 * fill that worked.
 */
async function patchAttrs(client, url, type, id, attrs, label) {
  const send = (a) => client.patch(url, { data: { type, id, attributes: a } });
  let res = await send(attrs);
  if (res.status < 300) return { ok: true, dropped: [] };

  // "Attribute 'whatsNew' cannot be edited at this time" → drop the named attributes and retry.
  const blocked = (res.json?.errors || [])
    .flatMap((e) => [...String(e.detail || "").matchAll(/Attribute '([^']+)' cannot be edited/g)].map((m) => m[1]))
    .filter((k) => k in attrs);
  if (blocked.length) {
    const rest = Object.fromEntries(Object.entries(attrs).filter(([k]) => !blocked.includes(k)));
    if (!Object.keys(rest).length) return { ok: true, dropped: blocked };
    res = await send(rest);
    if (res.status < 300) return { ok: true, dropped: blocked };
  }
  const why = (res.json?.errors || []).map((e) => `${e.code || res.status}: ${e.detail || e.title}`).join("; ") || `HTTP ${res.status}`;
  console.error(red(`    ✗ ${label}: ${why}`));
  return { ok: false, dropped: [] };
}

// Push metadata (native PATCH — works at any editable state, incl. READY_FOR_REVIEW, unlike deliver) +
// screenshots (native chunked upload; skips sets that already have shots so it never duplicates).
// iOS and macOS are separate platforms. Toggles: VYDANNE_SKIP_METADATA / VYDANNE_SKIP_SCREENSHOTS.
export async function run(config, client) {
  await client.findApp(config.bundleId);
  let ok = true; // a locale Apple refused must fail the command, not just print
  const skipMeta = process.env.VYDANNE_SKIP_METADATA === "1";
  const skipShots = process.env.VYDANNE_SKIP_SCREENSHOTS === "1";

  // Checked here and not only in preflight, because preflight is something you REMEMBER to run and
  // this is the thing that actually uploads. A cross-store reference costs a review cycle, and it
  // is free to catch one function call earlier. VYDANNE_ALLOW_CROSS_STORE=1 is the deliberate
  // override for the rare listing that genuinely needs the word.
  if (!skipMeta && process.env.VYDANNE_ALLOW_CROSS_STORE !== "1"
      && !reportCrossStore("apple", config.metadataDir, config.allowCrossStoreTerms)) {
    console.error(red("fill: refusing to upload — fix the listing text, or set VYDANNE_ALLOW_CROSS_STORE=1."));
    return false;
  }
  // No allowLive: name/subtitle live on the app-info record, and the live one must never take a PATCH
  // (Apple would refuse each with INVALID_STATE, failing the whole locale — release notes included).
  const info = await client.appInfo();
  // Said out loud, because the `if (info)` guard below otherwise skips name/subtitle for every locale
  // in perfect silence — twenty locales of "written" with two fields quietly missing from each.
  if (!info) console.log(yellow("  no editable app info — name/subtitle will be skipped (the live record is not writable)"));
  const infoLocs = info ? (await client.get(`/v1/appInfos/${info.id}/appInfoLocalizations?limit=200`)).json.data || [] : [];

  for (const platform of config.platforms) {
    // No allowLive, deliberately: this is the command whose PATCHes would otherwise land on the listing
    // customers are reading. Refusing is the whole point — an unwritten release note is recoverable, a
    // rewritten live listing is not.
    const v = await client.editVersion(platform);
    if (!v) {
      console.error(red(`fill ${platform}: no editable version — refusing to write to the live listing.`));
      console.error("  `vydanne prepare --apply` creates the version to fill, then re-run this.");
      ok = false;
      continue;
    }
    console.log(green(`fill ${platform} (metadata=${!skipMeta} screenshots=${!skipShots}) -> ${v.attributes.versionString} ${v.attributes.appStoreState}`));
    const verLocs = await client.versionLocalizations(v.id);

    if (!skipMeta) {
      let failed = 0;
      const dropped = new Set();
      // Guarded: a metadataDir that doesn't exist used to surface as a raw ENOENT stack from readdirSync
      // — the Play half of this command has always said it in a sentence, and there is no reason the
      // Apple half should be the one that throws.
      if (!fs.existsSync(config.metadataDir)) {
        console.error(red(`fill ${platform}: no metadata directory at ${config.metadataDir}`));
        console.error("  Create it (one folder per App Store locale), or point `metadataDir` at yours.");
        return false;
      }
      const all = fs.readdirSync(config.metadataDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
      const dirs = all.filter((d) => VALID.has(d));
      // A folder Apple has no locale for is dropped from the upload — silently, until now. `de` instead
      // of `de-DE` is the exact mistake locales.mjs calls the #1 gotcha, and the old filter made it look
      // like the locale had simply been forgotten. Naming it costs one line and saves a release.
      const strays = all.filter((d) => !VALID.has(d));
      if (strays.length) console.log(yellow(`  ${strays.length} folder(s) are not App Store locale codes, skipped: ${strays.join(", ")} (\`vydanne locales\` lists the valid ones)`));
      for (const code of dirs) {
        const folder = path.join(config.metadataDir, code);
        const read = (f) => { const p = path.join(folder, `${f}.txt`); return fs.existsSync(p) ? fs.readFileSync(p, "utf8").replace(/\n+$/, "") : null; };
        // version localization (description/keywords/promo/whatsNew/urls)
        let vl = verLocs.find((l) => l.attributes.locale === code);
        if (!vl) {
          const c = await client.post(`/v1/appStoreVersionLocalizations`, { data: { type: "appStoreVersionLocalizations", attributes: { locale: code }, relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: v.id } } } } });
          vl = c.json.data;
          // A refused POST leaves `vl` undefined, and the PATCH below then reads `.id` off it — a raw
          // TypeError that kills the whole fill on one bad locale. Report the locale Apple refused and
          // carry on with the rest, the way every other per-locale failure here behaves.
          if (!vl) {
            console.error(red(`    ✗ ${code}: could not create localization — ${JSON.stringify(c.json?.errors?.[0]?.detail || c.json).slice(0, 160)}`));
            failed++;
            continue;
          }
          verLocs.push(vl);
        }
        const vattrs = {};
        for (const [k, f] of Object.entries(VERSION_TXT)) { const t = read(f); if (t != null) vattrs[k] = t; }
        if (Object.keys(vattrs).length) {
          const r = await patchAttrs(client, `/v1/appStoreVersionLocalizations/${vl.id}`, "appStoreVersionLocalizations", vl.id, vattrs, `${code} version`);
          if (!r.ok) failed++;
          for (const d of r.dropped) dropped.add(d);
        }
        // app-info localization (name/subtitle — shared across platforms). Apple REQUIRES `name` when
        // CREATING a localization (409 ATTRIBUTE.REQUIRED otherwise), so build the attrs first and send
        // them in the POST; only PATCH when the localization already exists.
        if (info) {
          const iattrs = {};
          for (const [k, f] of Object.entries(INFO_TXT)) { const t = read(f); if (t != null) iattrs[k] = t; }
          let il = infoLocs.find((l) => l.attributes.locale === code);
          if (!il) {
            const c = await client.post(`/v1/appInfoLocalizations`, { data: { type: "appInfoLocalizations", attributes: { locale: code, ...iattrs }, relationships: { appInfo: { data: { type: "appInfos", id: info.id } } } } });
            il = c.json.data;
            if (il) infoLocs.push(il);
            else console.error(`  appInfo ${code}: create failed — ${JSON.stringify(c.json?.errors?.[0]?.detail || c.json)}`);
          } else if (Object.keys(iattrs).length) {
            const r = await patchAttrs(client, `/v1/appInfoLocalizations/${il.id}`, "appInfoLocalizations", il.id, iattrs, `${code} app-info`);
            if (!r.ok) failed++;
            for (const d of r.dropped) dropped.add(d);
          }
        }
      }
      if (dropped.size) console.log(yellow(`  skipped un-editable attribute(s) in this version state: ${[...dropped].join(", ")}`));
      console.log(failed ? red(`  metadata: ${dirs.length - failed}/${dirs.length} locales written, ${failed} FAILED`) : green(`  metadata: ${dirs.length} locales`));
      if (failed) ok = false;
    }

    if (!skipShots) await uploadScreenshots(config, client, platform, verLocs);
  }
  return ok;
}

async function uploadScreenshots(config, client, platform, verLocs) {
  const base = screenshotBase(platform, config);
  const DEV = deviceMap(platform);
  if (!fs.existsSync(base)) return;
  const dirs = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  const strays = dirs.filter((d) => !VALID.has(d));
  if (strays.length) console.log(yellow(`    ${strays.length} screenshot folder(s) are not App Store locale codes, skipped: ${strays.join(", ")}`));
  for (const code of dirs.filter((d) => VALID.has(d))) {
    const loc = verLocs.find((l) => l.attributes.locale === code);
    // Said, not skipped: with VYDANNE_SKIP_METADATA=1 (or a screenshots folder for a locale that has no
    // metadata folder) no localization was created above, and a silent `continue` here reports success
    // for a locale whose screenshots never left the disk.
    if (!loc) { console.log(yellow(`    ${code}: no App Store localization — screenshots skipped (run fill with metadata to create it)`)); continue; }
    const files = fs.readdirSync(path.join(base, code)).filter((f) => IMAGE_FILE.test(f)).sort();
    const byDev = {};
    const unknown = [];
    for (const f of files) { const dt = DEV[f.split("_")[0]]; dt ? (byDev[dt] ||= []).push(f) : unknown.push(f); }
    // The prefix before the first underscore selects the device slot; a file with an unknown one used to
    // vanish without a word — the docs even said "if a screenshot doesn't appear, check the name first",
    // which is the tool telling the user to do its job. Name the files instead.
    if (unknown.length) console.log(yellow(`    ${code}: ${unknown.length} file(s) with no device prefix, not uploaded: ${unknown.slice(0, 3).join(", ")}${unknown.length > 3 ? ", …" : ""} (known: ${Object.keys(DEV).join(", ")})`));
    const { json: sets } = await client.get(`/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets?include=appScreenshots&limit=50`);
    for (const [dt, list] of Object.entries(byDev)) {
      let set = (sets.data || []).find((s) => s.attributes.screenshotDisplayType === dt);
      // A populated slot used to `continue` unconditionally — "never duplicate", but it also meant a
      // re-render could NEVER reach a listing that already had images, and because the skip happened
      // before the log below, `fill` reported success having uploaded nothing. Same shape as previews
      // now, and the same VYDANNE_REPLACE flag rather than a second one for the other asset kind.
      const existing = set?.relationships?.appScreenshots?.data || [];
      if (existing.length && process.env.VYDANNE_REPLACE !== "1") {
        console.log(yellow(`    ${code}/${dt}: already has ${existing.length}, skipping (set VYDANNE_REPLACE=1 to replace)`));
        continue;
      }
      for (const s of existing) { // VYDANNE_REPLACE: drop the old shots so the new upload takes their place
        await client.del(`/v1/appScreenshots/${s.id}`);
        console.log(yellow(`    ${code}/${dt}: ${client.dryRun ? "would remove" : "removed"} old screenshot ${s.id}`));
      }
      if (!set) { const c = await client.post(`/v1/appScreenshotSets`, { data: { type: "appScreenshotSets", attributes: { screenshotDisplayType: dt }, relationships: { appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: loc.id } } } } }); set = c.json.data; }
      for (const f of list) await uploadAsset(client, { type: "appScreenshots", setType: "appScreenshotSet", setId: set.id, filePath: path.join(base, code, f) });
      console.log(green(`    ${code}/${dt}: ${list.length} screenshots`));
    }
  }
}
