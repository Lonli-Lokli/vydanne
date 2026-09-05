import fs from "node:fs";
import path from "node:path";
import { getAccessToken } from "./auth.mjs";

const BASE = "https://androidpublisher.googleapis.com/androidpublisher/v3";
const UPLOAD = "https://androidpublisher.googleapis.com/upload/androidpublisher/v3";

// Google Play Developer API client. THE key difference from Apple: everything goes through an **Edit**
// transaction — insert an edit, mutate listings/images/details against it, then commit (all-or-nothing).
// Nothing is live until commit; a dropped edit changes nothing. Image bytes go to the /upload endpoint.
export class PlayClient {
  static async create({ keyPath, packageName, dryRun = false }) {
    const token = await getAccessToken(keyPath);
    return new PlayClient(token, packageName, dryRun);
  }
  constructor(token, packageName, dryRun = false) {
    this.token = token;
    this.pkg = packageName;
    // Gates the COMMIT, not the requests: the edit is still built and validated against Google for real,
    // which is the whole advantage of Play's transaction over Apple's fire-and-forget PATCHes.
    this.dryRun = dryRun;
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

  // ── Binaries & tracks ─────────────────────────────────────────────────────────────────────────────

  /** Upload an .aab. The returned versionCode comes from the BUNDLE's manifest — Play assigns it, not us. */
  async uploadBundle(editId, filePath) {
    const bytes = fs.readFileSync(filePath);
    const res = await fetch(`${UPLOAD}/applications/${this.pkg}/edits/${editId}/bundles?uploadType=media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/octet-stream" },
      body: bytes,
    });
    const j = await res.json().catch(() => ({}));
    if (res.status >= 300) throw new Error(`bundle upload ${res.status}: ${JSON.stringify(j).slice(0, 300)}`);
    return j;
  }

  getTrack(editId, track) { return this.req("GET", `/edits/${editId}/tracks/${track}`); }

  /**
   * The track NAMES this app has, from inside an edit.
   *
   * Only the names are worth taking from here. The `releases` this returns are the track's DESIRED
   * state — whatever the last edit wrote — which is not what anyone means by "what is on the track".
   * Use [trackReleases] for that; see its note.
   */
  listTracks(editId) { return this.req("GET", `/edits/${editId}/tracks`); }

  /**
   * What is ACTUALLY on a track: every non-obsolete release, with its lifecycle state.
   *
   * Needs no edit, and it is a different answer from `edits/…/tracks`. That one reports the last
   * write; this reports reality, and the two disagree exactly when it matters most. Measured on
   * Niva, 2026-09-05:
   *
   *   edits/…/tracks   alpha → [131]                       "the upload worked"
   *   tracks/alpha/…   alpha → 1.4 (131) IN_REVIEW
   *                          + 1.0 (102) PUBLISHED         "…and testers still have 1.0"
   *
   * A newly uploaded build does not reach testers until review passes, so the previously published
   * release keeps serving — and the edit-based view cannot see it at all. Reporting only the edit
   * view meant `inspect` said a release was live when nobody had it yet.
   *
   * Shape differs from the edits API too: `releaseName`, `activeArtifacts[].versionCode` and
   * `releaseLifecycleState`, not `name`/`versionCodes`/`status`.
   */
  trackReleases(track) { return this.req("GET", `/tracks/${encodeURIComponent(track)}/releases`); }

  /**
   * Point a track at version codes. `releases` is the FULL desired state of that track — Play replaces
   * it wholesale, so send one complete release object rather than appending to what is already there.
   */
  putTrack(editId, track, releases) {
    return this.req("PUT", `/edits/${editId}/tracks/${track}`, { body: { track, releases } });
  }
}
