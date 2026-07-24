import crypto from "node:crypto";
import fs from "node:fs";

const SCOPE = "https://www.googleapis.com/auth/androidpublisher";

// Google Play uses OAuth2 two-legged (service account): sign an RS256 JWT with the SA private key, exchange
// it at the token endpoint for a ~1h access token. Native crypto — no googleapis lib. (Apple is per-request
// ES256; Google is a token exchange — the one real auth difference between the two stores.)
export async function getAccessToken(keyPath) {
  if (!fs.existsSync(keyPath)) throw new Error(`vydanne: Play service-account key not found at ${keyPath}`);
  const sa = JSON.parse(fs.readFileSync(keyPath, "utf8"));
  if (sa.type !== "service_account") {
    throw new Error(`vydanne: ${keyPath} is not a service-account key (type=${sa.type || "?"}). ` +
      "You need a Google Cloud service account with the Android Publisher role — NOT an OAuth client_secret.");
  }
  const b64u = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const claim = { iss: sa.client_email, scope: SCOPE, aud: sa.token_uri, iat: now, exp: now + 3600 };
  const input = `${b64u({ alg: "RS256", typ: "JWT" })}.${b64u(claim)}`;
  const sig = crypto.sign("RSA-SHA256", Buffer.from(input), sa.private_key).toString("base64url");
  const res = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${input}.${sig}` }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error(`vydanne: Play token exchange failed: ${JSON.stringify(j).slice(0, 300)}`);
  return j.access_token;
}
