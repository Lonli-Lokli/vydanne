import fs from "node:fs";
import path from "node:path";
import { getAccessToken } from "./auth.mjs";

const BASE = "https://androidpublisher.googleapis.com/androidpublisher/v3";
const UPLOAD = "https://androidpublisher.googleapis.com/upload/androidpublisher/v3";

// Google Play Developer API client. THE key difference from Apple: everything goes through an **Edit**
// transaction — insert an edit, mutate listings/images/details against it, then commit (all-or-nothing).
// Nothing is live until commit; a dropped edit changes nothing. Image bytes go to the /upload endpoint.
export class PlayClient {
  static async create({ keyPath, packageName }) {
    const token = await getAccessToken(keyPath);
    return new PlayClient(token, packageName);
  }
  constructor(token, packageName) {
    this.token = token;
    this.pkg = packageName;
  }

  async req(method, subpath, { body, base = BASE } = {}) {
    const res = await fetch(`${base}/applications/${this.pkg}${subpath}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json; try { json = text ? JSON.parse(text) : {}; } catch { json = text; }
    return { status: res.status, json };
  }

  // ── Edit transaction ──────────────────────────────────────────────────────────────────────────────
  async newEdit() {
    const { status, json } = await this.req("POST", "/edits", { body: {} });
    if (status >= 300) throw new Error(`edits.insert ${status}: ${JSON.stringify(json).slice(0, 200)}`);
    return json.id;
  }
  validate(editId) { return this.req("POST", `/edits/${editId}:validate`, { body: {} }); }
  commit(editId) { return this.req("POST", `/edits/${editId}:commit`, { body: {} }); }
  deleteEdit(editId) { return this.req("DELETE", `/edits/${editId}`); }

  // ── Listings (per language) ──────────────────────────────────────────────────────────────────────
  getListings(editId) { return this.req("GET", `/edits/${editId}/listings`); }
  // body: { language, title, shortDescription, fullDescription, video }
  putListing(editId, language, body) { return this.req("PUT", `/edits/${editId}/listings/${language}`, { body: { language, ...body } }); }

  // ── Details (default language + contact) ─────────────────────────────────────────────────────────
  getDetails(editId) { return this.req("GET", `/edits/${editId}/details`); }
  patchDetails(editId, body) { return this.req("PATCH", `/edits/${editId}/details`, { body }); }

  // ── Images ───────────────────────────────────────────────────────────────────────────────────────
  // imageType: phoneScreenshots | sevenInchScreenshots | tenInchScreenshots | wearScreenshots |
  //            tvScreenshots | icon | featureGraphic | promoGraphic | tvBanner
  listImages(editId, language, imageType) { return this.req("GET", `/edits/${editId}/listings/${language}/${imageType}`); }
  deleteAllImages(editId, language, imageType) { return this.req("DELETE", `/edits/${editId}/listings/${language}/${imageType}`); }
  async uploadImage(editId, language, imageType, filePath) {
    const bytes = fs.readFileSync(filePath);
    const mime = path.extname(filePath).toLowerCase() === ".jpg" || path.extname(filePath).toLowerCase() === ".jpeg" ? "image/jpeg" : "image/png";
    const res = await fetch(`${UPLOAD}/applications/${this.pkg}/edits/${editId}/listings/${language}/${imageType}?uploadType=media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": mime },
      body: bytes,
    });
    const j = await res.json().catch(() => ({}));
    if (res.status >= 300) throw new Error(`image upload ${res.status}: ${JSON.stringify(j).slice(0, 200)}`);
    return j;
  }
}
