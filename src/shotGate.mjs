import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * The approval gate: no screenshot leaves for a store unless its comparison passed it or the owner approved it.
 *
 * zdymak's `compare` judges each shot against the approved reference (by pixels for the source language, by layout for
 * a translation) and writes `approvals.json` beside the references: `references` (each approved source-language shot),
 * `accepted` (each approved translated shot) and `passed` (each shot within its threshold), all by the content's
 * sha256. `compare: { approvals: "<path to approvals.json>" }` in vydanne.config.mjs turns the gate on; a file whose
 * content is in none of the three is refused, and so is every file when the approvals file is missing. Without the
 * key nothing is checked, as before, so an app that does not compare its shots is not stopped by this.
 */
export const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** The same rule as zdymak's `isCleared`: an approved reference, an approved translated shot, or a pass. */
export function isCleared(approvals, sum) {
  return Boolean(approvals?.passed?.[sum] || approvals?.accepted?.[sum]
    || Object.values(approvals?.references || {}).some((r) => r?.sha256 === sum));
}

/** `null` when the gate is off; otherwise `[{ file, why }]` for every file that may not be uploaded. */
export function refusedShots(config, files) {
  const at = config?.compare?.approvals;
  if (!at) return null;
  const file = path.resolve(at);
  let approvals;
  try { approvals = JSON.parse(fs.readFileSync(file, "utf8")); } catch {
    return files.map((f) => ({ file: f, why: `no approvals file at ${file}: compare the shots first (zdymak compare)` }));
  }
  return files.filter((f) => !isCleared(approvals, sha256(f)))
    .map((f) => ({ file: f, why: "beyond its threshold or never compared, and not approved: answer its review first" }));
}
