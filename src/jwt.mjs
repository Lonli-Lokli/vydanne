import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// App Store Connect JWT (ES256). Node's built-in crypto signs it — `dsaEncoding: "ieee-p1363"` returns the
// raw r||s signature JWT/JOSE needs (the default DER encoding would be rejected). No fastlane/spaceship.
export function makeToken({ keyId, issuerId, keyPath }) {
  keyPath ||= path.join(os.homedir(), ".appstoreconnect", "private_keys", `AuthKey_${keyId}.p8`);
  if (!fs.existsSync(keyPath)) throw new Error(`vydanne: ASC key not found at ${keyPath}`);
  const p8 = fs.readFileSync(keyPath, "utf8");
  const b64u = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64u({ alg: "ES256", kid: keyId, typ: "JWT" })}.${b64u({ iss: issuerId, iat: now, exp: now + 1200, aud: "appstoreconnect-v1" })}`;
  const sig = crypto.sign("sha256", Buffer.from(input), { key: p8, dsaEncoding: "ieee-p1363" });
  return `${input}.${sig.toString("base64url")}`;
}
