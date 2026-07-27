import { makeToken } from "./jwt.mjs";
import { yellow } from "./util.mjs";

const API = "https://api.appstoreconnect.apple.com";
const IRIS = "https://appstoreconnect.apple.com/iris";
const DEAD_VERSION = ["READY_FOR_SALE", "REMOVED_FROM_SALE", "REPLACED_WITH_NEW_VERSION"];
// READY_FOR_DISTRIBUTION is Apple's newer name for the LIVE app-info (they're migrating the
// state vocabulary; versions still report appStoreState=READY_FOR_SALE). Without it here,
// appInfo() treats the live record as editable and every name/subtitle PATCH comes back
// ENTITY_ERROR.ATTRIBUTE.INVALID.INVALID_STATE — which fails the whole locale in `fill`,
// release notes included, on any app that already has a version on sale.
const DEAD_INFO = ["READY_FOR_SALE", "READY_FOR_DISTRIBUTION", "REPLACED_WITH_NEW_VERSION", "REMOVED_FROM_SALE"];

// Anything that is not a read. ASC has no transaction to roll back — unlike Play, where an edit can be
// discarded — so for Apple the only safe place to stand between a command and a live listing is here.
const MUTATING = new Set(["POST", "PATCH", "PUT", "DELETE"]);

// Thin ASC REST client. Encodes the gotchas: `iris` host (App Privacy 401s the JWT), version + app-info
// fetched from the FULL list (get_edit filters out READY_FOR_REVIEW), and individual localization reads
// (list endpoints return sparse/empty text).
export class Client {
  constructor({ keyId, issuerId, dryRun = false }) {
    this.token = makeToken({ keyId, issuerId });
    /** No mutating request leaves this process. Set by bin/ for a write command without `--apply`. */
    this.dryRun = dryRun;
    /** What a real run WOULD have sent, in order — the dry-run report, and the count bin/ prints. */
    this.planned = [];
  }

  async req(method, urlPath, { iris = false, body, rawHeaders, rawBody } = {}) {
    if (this.dryRun && MUTATING.has(method)) return this.#plan(method, urlPath, body);
    const headers = { Authorization: `Bearer ${this.token}` };
    if (body) headers["Content-Type"] = "application/json";
    Object.assign(headers, rawHeaders || {});
    const res = await fetch(`${iris ? IRIS : API}${urlPath}`, {
      method, headers, body: rawBody ?? (body ? JSON.stringify(body) : undefined),
    });
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; } catch { json = text; }
    return { status: res.status, json, text };
  }

  /**
   * Record a mutation instead of sending it, and hand back a response shaped like the one Apple would
   * have returned.
   *
   * The shape matters as much as the refusal. A dry run that returned `null` here would crash the first
   * caller that reads `.json.data.id` — and the operator would see one locale out of twenty, which is
   * exactly the report they cannot act on. So a synthesised `data` carries the id the caller needs to
   * keep going, and the run walks the WHOLE plan: every locale, every screenshot set, every field.
   *
   * The id is deliberately `dry-run-<n>` rather than a plausible-looking one — if it ever escapes into a
   * URL, the request 404s loudly instead of touching some real record.
   */
  #plan(method, urlPath, body) {
    const attributes = body?.data?.attributes || {};
    const fields = Object.keys(attributes);
    this.planned.push({ method, path: urlPath, attributes });
    console.log(yellow(`      would ${method} ${urlPath}${fields.length ? ` — ${fields.join(", ")}` : ""}`));
    return {
      status: method === "DELETE" ? 204 : 200,
      json: { data: { id: body?.data?.id || `dry-run-${this.planned.length}`, type: body?.data?.type, attributes } },
      text: "",
      dryRun: true,
    };
  }

  get(p, opts) { return this.req("GET", p, opts); }
  post(p, body) { return this.req("POST", p, { body }); }
  patch(p, body) { return this.req("PATCH", p, { body }); }
  del(p) { return this.req("DELETE", p); }

  async findApp(bundleId) {
    const { json } = await this.get(`/v1/apps?filter[bundleId]=${bundleId}&limit=1`);
    const app = json.data?.[0];
    if (!app) throw new Error(`vydanne: app '${bundleId}' not found for this ASC key`);
    this.app = app; this.appId = app.id;
    return app;
  }

  async editVersion(platform) {
    const { json } = await this.get(`/v1/apps/${this.appId}/appStoreVersions?filter[platform]=${platform}&limit=10`);
    const data = json.data || [];
    return data.find((v) => !DEAD_VERSION.includes(v.attributes.appStoreState)) || data[0] || null;
  }

  async appInfo() {
    const { json } = await this.get(`/v1/apps/${this.appId}/appInfos?limit=10`);
    const data = json.data || [];
    return data.find((i) => !DEAD_INFO.includes(i.attributes.state)) || data[0] || null;
  }

  async versionLocalizations(versionId) {
    const { json } = await this.get(`/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations?limit=200`);
    return json.data || [];
  }

  // Individual fetch — the list endpoints omit the text fields (sparse), so a populated/empty check must
  // read each localization by id.
  async localization(id, kind = "appStoreVersionLocalizations") {
    const { json } = await this.get(`/v1/${kind}/${id}`);
    return json.data?.attributes || {};
  }
}
