import fs from "node:fs";
import path from "node:path";
import { green, yellow } from "../util.mjs";

// App Privacy is on Apple's iris host, which 401s the JWT — it CANNOT be set with the ASC API key. Write
// the honest record + print the exact ASC-UI answers (a passkey login works there).
const GROUP = { CRASH_DATA: "Diagnostics", PERFORMANCE_DATA: "Diagnostics", OTHER_DIAGNOSTIC_DATA: "Diagnostics" };

export async function run(config) {
  const collected = config.privacy?.collected || ["CRASH_DATA", "PERFORMANCE_DATA"];
  const tracking = !!config.privacy?.tracking;
  const record = collected.map((cat) => ({
    category: cat, purposes: ["APP_FUNCTIONALITY"],
    data_protections: [tracking ? "DATA_LINKED_TO_YOU" : "DATA_NOT_LINKED_TO_YOU", tracking ? "DATA_USED_TO_TRACK_YOU" : null].filter(Boolean),
  }));
  const out = path.join(path.dirname(config.metadataDir), "app_privacy_details.json");
  fs.writeFileSync(out, JSON.stringify(record, null, 2));
  console.log(green(`wrote ${out} (declaration record)`));
  console.log();
  console.log(yellow("App Privacy is UI-only (passkey) — the API key 401s on Apple's iris host. Enter:"));
  if (collected.length) console.log("  Do you or your partners collect data? -> Yes");
  for (const c of collected) {
    const name = c.split("_").map((w) => w[0] + w.slice(1).toLowerCase()).join(" ");
    console.log(`  ${GROUP[c] || "?"} -> ${name}: App Functionality · ${tracking ? "Linked" : "Not Linked"} · ${tracking ? "Tracking" : "No Tracking"}`);
  }
  console.log("  Everything else -> Not Collected.");
  console.log(yellow("  'accesses' is not 'collects' — E2EE content you can't read is not collected."));
  return true;
}
