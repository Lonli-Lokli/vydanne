import { makeToken } from "./jwt.mjs";

const API = "https://api.appstoreconnect.apple.com";
const IRIS = "https://appstoreconnect.apple.com/iris";
const DEAD_VERSION = ["READY_FOR_SALE", "REMOVED_FROM_SALE", "REPLACED_WITH_NEW_VERSION"];
const DEAD_INFO = ["READY_FOR_SALE", "REPLACED_WITH_NEW_VERSION", "REMOVED_FROM_SALE"];

// Thin ASC REST client. Encodes the gotchas: `iris` host (App Privacy 401s the JWT), version + app-info
// fetched from the FULL list (get_edit filters out READY_FOR_REVIEW), and individual localization reads
// (list endpoints return sparse/empty text).
export class Client {
  constructor({ keyId, issuerId }) {
    this.token = makeToken({ keyId, issuerId });
  }

  async req(method, urlPath, { iris = false, body, rawHeaders, rawBody } = {}) {
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
