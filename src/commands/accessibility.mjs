import { green, yellow, red } from "../util.mjs";

/**
 * Accessibility Nutrition Labels.
 *
 * These used to come from a hardcoded matrix that said the same thing for every app the tool was
 * pointed at. That is the wrong shape for this one command. Everything else vydanne writes is a
 * FACT about an app — its name, its price, the data it collects — but this is a CLAIM about
 * behaviour, made to Apple, and the tool had no way of knowing whether it was true. It asserted
 * VoiceOver, Voice Control and Larger Text support for apps nobody had audited, and at least one
 * of them did not honour Larger Text at all: its board glyphs scaled twice and grew off the
 * high-contrast disc drawn behind them.
 *
 * So the app declares it, feature by feature, in `vydanne.config.mjs`. Silence is not consent — an
 * app with no `accessibility` block gets an error, not a default, because "nobody wrote this down"
 * must never become "supports everything".
 *
 * Apple's platform caveats are still applied here, because they are facts about the platforms
 * rather than about any app: Larger Text does not exist on macOS and Voice Control does not exist
 * on watchOS, so those are forced false regardless of what an app claims.
 */

/** Config key -> the ASC attribute it sets. */
const FEATURES = {
  voiceover: "supportsVoiceover",
  voiceControl: "supportsVoiceControl",
  largerText: "supportsLargerText",
  sufficientContrast: "supportsSufficientContrast",
  darkInterface: "supportsDarkInterface",
  differentiateWithoutColorAlone: "supportsDifferentiateWithoutColorAlone",
  reducedMotion: "supportsReducedMotion",
  captions: "supportsCaptions",
  audioDescriptions: "supportsAudioDescriptions",
};

/** Features Apple does not offer on a device family — never sent, whatever the app declares. */
const UNAVAILABLE = {
  IPHONE: [],
  IPAD: [],
  MAC: ["largerText"],
  APPLE_WATCH: ["voiceControl"],
};

const EXAMPLE = `  accessibility: {
    voiceover: true,
    voiceControl: true,
    largerText: true,
    sufficientContrast: true,
    darkInterface: true,
    differentiateWithoutColorAlone: true,
    reducedMotion: true,
    captions: false,
    audioDescriptions: false,
  },`;

/** Turn the app's declaration into the attributes for one device family. */
function attributesFor(declared, family) {
  const out = {};
  for (const [key, attribute] of Object.entries(FEATURES)) {
    out[attribute] = UNAVAILABLE[family].includes(key) ? false : declared[key] === true;
  }
  return out;
}

/** Returns a human-readable problem, or null when the declaration is usable. */
export function validate(config) {
  const declared = config.accessibility;
  if (!declared || typeof declared !== "object") {
    return [
      "accessibility: missing.",
      "This command publishes CLAIMS about your app's behaviour to Apple, so it will not guess.",
      "Declare what you have actually verified:",
      "",
      EXAMPLE,
    ].join("\n");
  }
  const unknown = Object.keys(declared).filter((k) => !(k in FEATURES));
  if (unknown.length) {
    return `accessibility: unknown feature(s) ${unknown.join(", ")}. Known: ${Object.keys(FEATURES).join(", ")}`;
  }
  const missing = Object.keys(FEATURES).filter((k) => typeof declared[k] !== "boolean");
  if (missing.length) {
    return [
      `accessibility: ${missing.join(", ")} must be declared true or false.`,
      "Every feature is stated explicitly — an omission would read as a quiet 'no', which is just",
      "as unverified as a quiet 'yes'.",
    ].join("\n");
  }
  return null;
}

export async function run(config, client) {
  const problem = validate(config);
  if (problem) {
    console.error(red(problem));
    return false;
  }
  const declared = config.accessibility;

  await client.findApp(config.bundleId);
  const publish = process.env.VYDANNE_A11Y_PUBLISH === "1";
  const { json } = await client.get(`/v1/apps/${client.appId}/accessibilityDeclarations?limit=50`);
  const decls = {};
  for (const d of json.data || []) decls[d.attributes.deviceFamily] = d.id;

  const claimed = Object.keys(FEATURES).filter((k) => declared[k]);
  console.log(`  declaring: ${claimed.length ? claimed.join(", ") : "(nothing)"}`);

  let gated = false;
  // A PATCH that Apple refuses is a claim that never reached the store. Both failure paths below used
  // to print red and `continue`, and the command still returned true — so `push` treated a family whose
  // declaration never saved as a completed step. The `continue`s stay (one refused family must not hide
  // the other three); the verdict now travels out with the return.
  const failures = [];
  for (const family of Object.keys(UNAVAILABLE)) {
    const id = decls[family];
    // Not a failure: Apple only holds declarations for the families the app actually ships on.
    if (!id) {
      console.error(yellow(`  no ${family} declaration`));
      continue;
    }
    const attributes = attributesFor(declared, family);
    const r = await client.patch(`/v1/accessibilityDeclarations/${id}`, {
      data: { type: "accessibilityDeclarations", id, attributes },
    });
    if (r.status >= 300) {
      console.error(red(`  ${family} draft ${r.status}`));
      failures.push(`${family}: draft not saved (${r.status})`);
      continue;
    }
    if (publish) {
      const p = await client.patch(`/v1/accessibilityDeclarations/${id}`, {
        data: { type: "accessibilityDeclarations", id, attributes: { publish: true } },
      });
      if (p.status < 300) {
        console.log(green(`  ${family}: PUBLISHED`));
      } else if (JSON.stringify(p.json).includes("CANNOT_PUBLISH_APP_MUST_BE_AVAILABLE")) {
        gated = true;
        console.log(yellow(`  ${family}: draft saved — publish deferred (app not live yet)`));
      } else {
        console.error(red(`  ${family} publish ${p.status}`));
        failures.push(`${family}: publish refused (${p.status})`);
      }
    } else {
      console.log(green(`  ${family}: draft saved`));
    }
  }
  if (failures.length) {
    console.error(red(`accessibility: ${failures.length} declaration(s) did not save:`));
    for (const f of failures) console.error(`  ${red("x")} ${f}`);
    return false;
  }
  console.log(
    gated
      ? yellow("accessibility staged (DRAFT); re-run with VYDANNE_A11Y_PUBLISH=1 once the app is live")
      : "accessibility done",
  );
  return true;
}
