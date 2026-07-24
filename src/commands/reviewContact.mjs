import fs from "node:fs";
import path from "node:path";
import { green, red } from "../util.mjs";

// App Review contact from the GITIGNORED metadata/review_information/*.txt. PATCH (or POST) the review
// detail directly — deliver can't do this cleanly pre-first-submission.
export async function run(config, client) {
  const dir = path.join(config.metadataDir, "review_information");
  const read = (n) => { const p = path.join(dir, `${n}.txt`); return fs.existsSync(p) ? fs.readFileSync(p, "utf8").trim() : ""; };
  const attributes = {
    contactFirstName: read("first_name"), contactLastName: read("last_name"),
    contactPhone: read("phone_number"), contactEmail: read("email_address"),
    demoAccountRequired: false, notes: read("notes"),
  };
  if (!attributes.contactEmail) { console.error(red(`review-contact: ${dir}/*.txt missing`)); return false; }
  await client.findApp(config.bundleId);
  const v = await client.editVersion(config.platforms[0]);
  if (!v) { console.error(red("review-contact: no editable version")); return false; }
  const { json } = await client.get(`/v1/appStoreVersions/${v.id}/appStoreReviewDetail`);
  const existing = json.data;
  const r = existing?.id
    ? await client.patch(`/v1/appStoreReviewDetails/${existing.id}`, { data: { type: "appStoreReviewDetails", id: existing.id, attributes } })
    : await client.post(`/v1/appStoreReviewDetails`, { data: { type: "appStoreReviewDetails", attributes, relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: v.id } } } } });
  if (r.status >= 300) { console.error(red(`review-contact: ${r.status}: ${JSON.stringify(r.json).slice(0, 200)}`)); return false; }
  console.log(green(`review contact set -> ${attributes.contactFirstName} ${attributes.contactLastName} · ${attributes.contactPhone}`));
  return true;
}
