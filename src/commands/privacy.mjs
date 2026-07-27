import fs from "node:fs";
import path from "node:path";
import { green, yellow } from "../util.mjs";

/**
 * App Privacy is on Apple's iris host, which 401s the ASC API key — it CANNOT be set through the API.
 * So this writes the honest record and prints the exact answers to type into the ASC UI (where a
 * passkey login works).
 *
 * PURPOSES ARE DECLARED, NOT ASSUMED. Every collected category used to be reported as
 * "APP_FUNCTIONALITY", which is right for crash data in a game and wrong for almost anything else — an
 * email address collected for marketing, or location used for analytics, would have been printed as
 * App Functionality and typed into Apple's form that way. And the UI group was known only for the three
 * diagnostics categories, so anything else printed a literal "?" as its section heading, which is not
 * an answer anyone can enter. Both are now data tables covering Apple's full vocabulary, with
 * per-category overrides in the config for the app that needs them.
 */

/** Apple's data categories -> the section they live under in the App Privacy form. */
const GROUP = {
  // Contact info
  NAME: "Contact Info", EMAIL_ADDRESS: "Contact Info", PHONE_NUMBER: "Contact Info",
  PHYSICAL_ADDRESS: "Contact Info", OTHER_USER_CONTACT_INFO: "Contact Info",
  // Health & fitness
  HEALTH: "Health & Fitness", FITNESS: "Health & Fitness",
  // Financial info
  PAYMENT_INFO: "Financial Info", CREDIT_INFO: "Financial Info", OTHER_FINANCIAL_INFO: "Financial Info",
  // Location
  PRECISE_LOCATION: "Location", COARSE_LOCATION: "Location",
  // Sensitive info
  SENSITIVE_INFO: "Sensitive Info",
  // Contacts
  CONTACTS: "Contacts",
  // User content
  EMAILS_OR_TEXT_MESSAGES: "User Content", PHOTOS_OR_VIDEOS: "User Content", AUDIO_DATA: "User Content",
  GAMEPLAY_CONTENT: "User Content", CUSTOMER_SUPPORT: "User Content", OTHER_USER_CONTENT: "User Content",
  // Browsing / search history
  BROWSING_HISTORY: "Browsing History", SEARCH_HISTORY: "Search History",
  // Identifiers
  USER_ID: "Identifiers", DEVICE_ID: "Identifiers",
  // Purchases
  PURCHASE_HISTORY: "Purchases",
  // Usage data
  PRODUCT_INTERACTION: "Usage Data", ADVERTISING_DATA: "Usage Data", OTHER_USAGE_DATA: "Usage Data",
  // Diagnostics
  CRASH_DATA: "Diagnostics", PERFORMANCE_DATA: "Diagnostics", OTHER_DIAGNOSTIC_DATA: "Diagnostics",
  // Other
  OTHER_DATA_TYPES: "Other Data",
};

/** Apple's purpose codes -> the label the form uses. */
const PURPOSE_LABEL = {
  THIRD_PARTY_ADVERTISING: "Third-Party Advertising",
  DEVELOPERS_ADVERTISING: "Developer's Advertising or Marketing",
  ANALYTICS: "Analytics",
  PRODUCT_PERSONALIZATION: "Product Personalization",
  APP_FUNCTIONALITY: "App Functionality",
  OTHER_PURPOSES: "Other Purposes",
};

export async function run(config) {
  const collected = config.privacy?.collected || ["CRASH_DATA", "PERFORMANCE_DATA"];
  const tracking = !!config.privacy?.tracking;
  // `purposes` may be one list for everything, or a per-category map. App Functionality stays the
  // default because it is the honest answer for the diagnostics an app collects to fix itself — but it
  // is now a default that an app can disagree with, rather than the only thing this command can say.
  const declared = config.privacy?.purposes;
  const purposesFor = (cat) => {
    const p = Array.isArray(declared) ? declared : declared?.[cat];
    return (p && p.length ? p : ["APP_FUNCTIONALITY"]);
  };

  const record = collected.map((cat) => ({
    category: cat,
    purposes: purposesFor(cat),
    data_protections: [tracking ? "DATA_LINKED_TO_YOU" : "DATA_NOT_LINKED_TO_YOU", tracking ? "DATA_USED_TO_TRACK_YOU" : null].filter(Boolean),
  }));
  const out = path.join(path.dirname(config.metadataDir), "app_privacy_details.json");
  fs.writeFileSync(out, JSON.stringify(record, null, 2));
  console.log(green(`wrote ${out} (declaration record)`));
  console.log();

  const unknown = collected.filter((c) => !GROUP[c]);
  if (unknown.length) {
    console.log(yellow(`  category not in Apple's published list, section unknown: ${unknown.join(", ")}`));
    console.log("  Check the spelling against App Privacy in App Store Connect before entering it.");
  }

  console.log(yellow("App Privacy is UI-only (passkey) — the API key 401s on Apple's iris host. Enter:"));
  if (collected.length) console.log("  Do you or your partners collect data? -> Yes");
  for (const c of collected) {
    const name = c.split("_").map((w) => w[0] + w.slice(1).toLowerCase()).join(" ");
    const purposes = purposesFor(c).map((p) => PURPOSE_LABEL[p] || p).join(" + ");
    console.log(`  ${GROUP[c] || "?"} -> ${name}: ${purposes} · ${tracking ? "Linked" : "Not Linked"} · ${tracking ? "Tracking" : "No Tracking"}`);
  }
  console.log("  Everything else -> Not Collected.");
  console.log(yellow("  'accesses' is not 'collects' — E2EE content you can't read is not collected."));
  return true;
}
