import fs from "node:fs";
import path from "node:path";
import { green, yellow, red } from "../../util.mjs";
import { reportCrossStore } from "../../crossStore.mjs";
import { playImages, imageLocales } from "../images.mjs";

const FIELDS = [["title", "title"], ["shortDescription", "short_description"], ["fullDescription", "full_description"]];

// Push the Play listing (text + images) inside one Edit, then validate and commit. iOS/Android are separate
// stores — this is the Google half. Images only touch a type whose local asset EXISTS (so a missing local
// set never deletes the live one). Without `--apply` it validates and discards without committing.
export async function run(config, client) {
  const g = config.google;
  // SAFE BY DEFAULT: validate + discard the edit unless `--apply`. A store-mutating commit must be an
  // explicit opt-in — never the default (a stale/partial local set could otherwise clobber a live one).
  const commit = !client.dryRun;
  const IMAGES = playImages(config);
  const localLangs = fs.existsSync(g.metadataDir)
    ? fs.readdirSync(g.metadataDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
    : [];
  const haveImages = IMAGES.some(([, src]) => fs.existsSync(src));
  if (!localLangs.length && !haveImages) {
    console.log(yellow(`fill(play): no local listing folders under ${g.metadataDir} and no local play assets — nothing to upload yet (populate them, or run \`vydanne bridge\`).`));
    return true;
  }

  if (process.env.VYDANNE_ALLOW_CROSS_STORE !== "1"
      && !reportCrossStore("google", g.metadataDir, config.allowCrossStoreTerms)) {
    console.error(red("fill(play): refusing to upload — fix the listing text, or set VYDANNE_ALLOW_CROSS_STORE=1."));
    return false;
  }

  const editId = await client.newEdit();
  try {
    // Listing text
    for (const lang of localLangs) {
      const read = (f) => { const p = path.join(g.metadataDir, lang, `${f}.txt`); return fs.existsSync(p) ? fs.readFileSync(p, "utf8").replace(/\n+$/, "") : undefined; };
      const body = {};
      for (const [attr, file] of FIELDS) { const t = read(file); if (t !== undefined) body[attr] = t; }
      if (Object.keys(body).length) {
        const r = await client.putListing(editId, lang, body);
        if (r.status >= 300) throw new Error(`listing ${lang} ${r.status}: ${JSON.stringify(r.json).slice(0, 160)}`);
        console.log(green(`  ${lang}: listing (${Object.keys(body).join(", ")})`));
      }
    }
    // Images — replace a type only when the local asset exists (delete-all then upload).
    for (const lang of imageLocales(g, localLangs)) {
      for (const [type, src, kind] of IMAGES) {
        // A per-locale override directory (`<src>/<lang>`) wins when it exists, so an app can localize
        // some slots and leave the rest shared without listing every combination in the config.
        const localized = path.join(src, lang);
        const from = kind === "dir" && fs.existsSync(localized) ? localized : src;
        if (!fs.existsSync(from)) continue;
        const files = kind === "dir" ? fs.readdirSync(from).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort().map((f) => path.join(from, f)) : [from];
        // A dir that EXISTS but is empty is different from a missing one: someone (the store-assets
        // bridge, when zdymak stops producing a form factor) deliberately emptied it, expecting the live
        // set to follow. It doesn't — never-delete-by-omission holds — but that must be said, because the
        // silent skip is how a listing keeps showing screenshots of a UI the app no longer has.
        if (!files.length) { console.log(yellow(`  ${lang}/${type}: local dir is empty — live set left untouched (delete it in Play Console if it is stale)`)); continue; }
        await client.deleteAllImages(editId, lang, type);
        for (const f of files) await client.uploadImage(editId, lang, type, f);
        console.log(green(`  ${lang}/${type}: ${files.length} image(s)`));
      }
    }

    const v = await client.validate(editId);
    if (v.status >= 300) throw new Error(`validate ${v.status}: ${JSON.stringify(v.json).slice(0, 200)}`);
    if (!commit) { await client.deleteEdit(editId); console.log(yellow("fill(play): validated — DRY (nothing changed). Review the above, then re-run with --apply to commit.")); return true; }
    const co = await client.commit(editId);
    if (co.status >= 300) throw new Error(`commit ${co.status}: ${JSON.stringify(co.json).slice(0, 200)}`);
    console.log(green("fill(play): committed."));
  } catch (e) {
    await client.deleteEdit(editId).catch(() => {});
    throw e;
  }
  return true;
}
