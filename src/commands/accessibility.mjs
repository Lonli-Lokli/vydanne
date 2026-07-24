import { green, yellow, red } from "../util.mjs";

const T = true, F = false;
// Honest DoD-backed matrix; Apple caveats: Larger Text N/A on Mac, Voice Control N/A on Watch, no video →
// no captions/AD. DRAFT-safe; VYDANNE_A11Y_PUBLISH=1 publishes, but Apple 409s publish until the app is live.
const MATRIX = {
  IPHONE: { supportsVoiceover: T, supportsVoiceControl: T, supportsLargerText: T, supportsSufficientContrast: T, supportsDarkInterface: T, supportsDifferentiateWithoutColorAlone: T, supportsReducedMotion: T, supportsCaptions: F, supportsAudioDescriptions: F },
  IPAD: { supportsVoiceover: T, supportsVoiceControl: T, supportsLargerText: T, supportsSufficientContrast: T, supportsDarkInterface: T, supportsDifferentiateWithoutColorAlone: T, supportsReducedMotion: T, supportsCaptions: F, supportsAudioDescriptions: F },
  MAC: { supportsVoiceover: T, supportsVoiceControl: T, supportsSufficientContrast: T, supportsDarkInterface: T, supportsDifferentiateWithoutColorAlone: T, supportsReducedMotion: T, supportsCaptions: F, supportsAudioDescriptions: F },
  APPLE_WATCH: { supportsVoiceover: T, supportsLargerText: T, supportsSufficientContrast: T, supportsDarkInterface: T, supportsDifferentiateWithoutColorAlone: T, supportsReducedMotion: T, supportsCaptions: F, supportsAudioDescriptions: F },
};

export async function run(config, client) {
  await client.findApp(config.bundleId);
  const publish = process.env.VYDANNE_A11Y_PUBLISH === "1";
  const { json } = await client.get(`/v1/apps/${client.appId}/accessibilityDeclarations?limit=50`);
  const decls = {};
  for (const d of json.data || []) decls[d.attributes.deviceFamily] = d.id;
  let gated = false;
  for (const [fam, attributes] of Object.entries(MATRIX)) {
    const id = decls[fam];
    if (!id) { console.error(yellow(`  no ${fam} declaration`)); continue; }
    const r = await client.patch(`/v1/accessibilityDeclarations/${id}`, { data: { type: "accessibilityDeclarations", id, attributes } });
    if (r.status >= 300) { console.error(red(`  ${fam} draft ${r.status}`)); continue; }
    if (publish) {
      const p = await client.patch(`/v1/accessibilityDeclarations/${id}`, { data: { type: "accessibilityDeclarations", id, attributes: { publish: true } } });
      if (p.status < 300) console.log(green(`  ${fam}: PUBLISHED`));
      else if (JSON.stringify(p.json).includes("CANNOT_PUBLISH_APP_MUST_BE_AVAILABLE")) { gated = true; console.log(yellow(`  ${fam}: draft saved — publish deferred (app not live yet)`)); }
      else console.error(red(`  ${fam} publish ${p.status}`));
    } else {
      console.log(green(`  ${fam}: draft saved`));
    }
  }
  console.log(gated ? yellow("accessibility staged (DRAFT); re-run with VYDANNE_A11Y_PUBLISH=1 once the app is live") : "accessibility done");
  return true;
}
