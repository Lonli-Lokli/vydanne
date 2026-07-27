import fs from "node:fs";
import path from "node:path";
import { green, yellow, red } from "../util.mjs";

/**
 * App Review contact, from the GITIGNORED `<metadataDir>/review_information/*.txt`. PATCH (or POST) the
 * review detail directly — deliver can't do this cleanly pre-first-submission.
 *
 * DEMO ACCOUNT. `demoAccountRequired` used to be hardcoded false. That is true of an account-less game
 * and false of anything with a login, and getting it wrong is not a small thing: telling Apple no demo
 * account is needed for an app whose first screen is a sign-in wall is a guaranteed rejection, with a
 * review cycle attached. fastlane's own convention already puts `demo_user.txt` / `demo_password.txt`
 * in the very directory this reads from, so the fix is to read the two files that were sitting there.
 *
 * Every platform gets the same contact, because the contact is a property of the submitter rather than
 * of a platform — an app shipping iOS and macOS used to set it on `platforms[0]` and leave the other
 * version's review detail empty.
 */
export async function run(config, client) {
  const dir = path.join(config.metadataDir, "review_information");
  const read = (n) => { const p = path.join(dir, `${n}.txt`); return fs.existsSync(p) ? fs.readFileSync(p, "utf8").trim() : ""; };

  const demoUser = read("demo_user");
  const demoPassword = read("demo_password");
  const attributes = {
    contactFirstName: read("first_name"), contactLastName: read("last_name"),
    contactPhone: read("phone_number"), contactEmail: read("email_address"),
    // Declared by what is on disk, with an explicit config override for the app that needs one and
    // supplies it some other way (a reviewer-specific build, a magic link in the notes).
    demoAccountRequired: config.reviewContact?.demoAccountRequired ?? !!demoUser,
    notes: read("notes"),
  };
  if (demoUser) attributes.demoAccountName = demoUser;
  if (demoPassword) attributes.demoAccountPassword = demoPassword;

  if (!attributes.contactEmail) { console.error(red(`review-contact: ${dir}/*.txt missing`)); return false; }
  // A demo account that is required but has no credentials is the rejection this command exists to
  // avoid, arriving by a different door — say it here rather than letting Apple say it in a week.
  if (attributes.demoAccountRequired && !demoUser) {
    console.error(red("review-contact: demoAccountRequired is true but no demo_user.txt was found."));
    console.error(`  Add ${dir}/demo_user.txt and demo_password.txt (both gitignored), or set`);
    console.error("  reviewContact: { demoAccountRequired: false } if the reviewer genuinely needs no account.");
    return false;
  }

  await client.findApp(config.bundleId);

  let ok = true;
  let touched = 0;
  for (const platform of config.platforms) {
    const v = await client.editVersion(platform);
    if (!v) {
      console.error(red(`review-contact ${platform}: no editable version — nothing to attach the contact to.`));
      console.error("  `vydanne prepare --apply` creates the version being submitted, then re-run this.");
      ok = false;
      continue;
    }
    const { json } = await client.get(`/v1/appStoreVersions/${v.id}/appStoreReviewDetail`);
    const existing = json.data;
    const r = existing?.id
      ? await client.patch(`/v1/appStoreReviewDetails/${existing.id}`, { data: { type: "appStoreReviewDetails", id: existing.id, attributes } })
      : await client.post(`/v1/appStoreReviewDetails`, { data: { type: "appStoreReviewDetails", attributes, relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: v.id } } } } });
    if (r.status >= 300) {
      console.error(red(`review-contact ${platform}: ${r.status}: ${JSON.stringify(r.json).slice(0, 200)}`));
      ok = false;
      continue;
    }
    touched++;
  }
  if (!touched) return false;

  const who = `${attributes.contactFirstName} ${attributes.contactLastName} · ${attributes.contactPhone}`;
  const demo = attributes.demoAccountRequired ? ` · demo account ${demoUser}` : "";
  console.log(client.dryRun
    ? yellow(`review contact WOULD be set on ${touched} platform(s) -> ${who}${demo}`)
    : green(`review contact set on ${touched} platform(s) -> ${who}${demo}`));
  return ok;
}
