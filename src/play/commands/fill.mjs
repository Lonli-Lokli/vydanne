import fs from "node:fs";
import path from "node:path";
import { green, yellow, red } from "../../util.mjs";

const FIELDS = [["title", "title"], ["shortDescription", "short_description"], ["fullDescription", "full_description"]];
// Play image type -> local source (a dir of PNGs = screenshots; a single file = graphic). From zdymak.
// Each type is uploaded only when its local asset EXISTS, so an app that lacks (say) tablet shots or a
// znachok icon simply skips that type — a missing local set never deletes the live one.
const IMAGES = [
  ["icon", "brand/icons/play/icon-512.png", "file"],
  ["featureGraphic", "marketing/out/play-feature-graphic.png", "file"],
  ["phoneScreenshots", "marketing/out/play-phone-plain", "dir"],
  ["sevenInchScreenshots", "marketing/out/play-tablet7-plain", "dir"],
  ["tenInchScreenshots", "marketing/out/play-tablet-plain", "dir"],
];

// Push the Play listing (text + images) inside one Edit, then validate and commit. iOS/Android are separate
// stores — this is the Google half. Images only touch a type whose local asset EXISTS (so a missing local
// set never deletes the live one). VYDANNE_DRY=1 validates and discards without committing.
export async function run(config, client) {
  const g = config.google;
  // SAFE BY DEFAULT: validate + discard the edit unless VYDANNE_COMMIT=1. A store-mutating commit must be
  // an explicit opt-in — never the default (a stale/partial local set could otherwise clobber a live one).
  const commit = process.env.VYDANNE_COMMIT === "1";
  const localLangs = fs.existsSync(g.metadataDir)
    ? fs.readdirSync(g.metadataDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
    : [];
  const haveImages = IMAGES.some(([, src]) => fs.existsSync(src));
  if (!localLangs.length && !haveImages) {
    console.log(yellow(`fill(play): no local listing folders under ${g.metadataDir} and no zdymak play assets — nothing to upload yet (populate them for Android Phase 2).`));
    return true;
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
    const lang = g.defaultLocale;
    for (const [type, src, kind] of IMAGES) {
      if (!fs.existsSync(src)) continue;
      const files = kind === "dir" ? fs.readdirSync(src).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort().map((f) => path.join(src, f)) : [src];
      if (!files.length) continue;
      await client.deleteAllImages(editId, lang, type);
      for (const f of files) await client.uploadImage(editId, lang, type, f);
      console.log(green(`  ${lang}/${type}: ${files.length} image(s)`));
    }

    const v = await client.validate(editId);
    if (v.status >= 300) throw new Error(`validate ${v.status}: ${JSON.stringify(v.json).slice(0, 200)}`);
    if (!commit) { await client.deleteEdit(editId); console.log(yellow("fill(play): validated — DRY (nothing changed). Review the above, then set VYDANNE_COMMIT=1 to commit.")); return true; }
    const co = await client.commit(editId);
    if (co.status >= 300) throw new Error(`commit ${co.status}: ${JSON.stringify(co.json).slice(0, 200)}`);
    console.log(green("fill(play): committed."));
  } catch (e) {
    await client.deleteEdit(editId).catch(() => {});
    throw e;
  }
  return true;
}
