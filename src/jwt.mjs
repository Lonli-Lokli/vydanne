import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PEM_MARKER = "-----BEGIN";

/**
 * The .p8 itself, from whichever place this machine keeps it.
 *
 * A FILE is the right default on a developer's Mac, where the key sits beside the credentials in
 * `~/.appstoreconnect`. It is the wrong and only option in CI, where a secret arrives as an
 * environment variable and there is no home directory worth writing to — every caller was left
 * materialising the key itself:
 *
 *     mkdir -p "$HOME/.appstoreconnect/private_keys"
 *     printf '%s' "$ASC_KEY_CONTENT" | base64 --decode > ".../AuthKey_${ASC_KEY_ID}.p8"
 *
 * That is four lines of shell, per workflow, that must agree with vydanne's private path convention —
 * and it silently writes a signing key to disk on a shared runner. `keyContent` removes the need.
 *
 * Accepts the PEM as-is or base64-encoded, because CI secrets are usually stored base64 (GitHub's own
 * docs recommend it for multi-line values, and `ASC_KEY_CONTENT` is already base64 wherever fastlane
 * reads it with `is_key_content_base64`).
 */
export function resolveKey({ keyId, keyPath, keyContent }) {
  if (keyContent) {
    const raw = keyContent.trim();
    if (raw.includes(PEM_MARKER)) return raw;
    const decoded = Buffer.from(raw, "base64").toString("utf8");
    if (decoded.includes(PEM_MARKER)) return decoded;
    throw new Error(
      "vydanne: ASC_KEY_CONTENT is neither a PEM nor base64 of one — expected it to contain " +
        `"${PEM_MARKER} PRIVATE KEY". Check the secret was stored whole, newlines included.`,
    );
  }
  const file = keyPath || path.join(os.homedir(), ".appstoreconnect", "private_keys", `AuthKey_${keyId}.p8`);
  if (!fs.existsSync(file)) {
    throw new Error(
      `vydanne: ASC key not found at ${file}. On a developer machine put the .p8 there; in CI set ` +
        "ASC_KEY_CONTENT (the .p8, raw or base64) or ASC_KEY_PATH instead — no file needed.",
    );
  }
  return fs.readFileSync(file, "utf8");
}

// App Store Connect JWT (ES256). Node's built-in crypto signs it — `dsaEncoding: "ieee-p1363"` returns the
// raw r||s signature JWT/JOSE needs (the default DER encoding would be rejected). No fastlane/spaceship.
export function makeToken({ keyId, issuerId, keyPath, keyContent }) {
  const p8 = resolveKey({ keyId, keyPath, keyContent });
  const b64u = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64u({ alg: "ES256", kid: keyId, typ: "JWT" })}.${b64u({ iss: issuerId, iat: now, exp: now + 1200, aud: "appstoreconnect-v1" })}`;
  const sig = crypto.sign("sha256", Buffer.from(input), { key: p8, dsaEncoding: "ieee-p1363" });
  return `${input}.${sig.toString("base64url")}`;
}
