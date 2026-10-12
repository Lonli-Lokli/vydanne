// A fake App Store Connect for the tests, behind `fetch`: it answers the reads the commands make, accepts the writes a
// real run makes, and records every request — so a test can assert that a dry run sent nothing but GETs. The commands run
// through the REAL client (src/client.mjs), so the dry-run gate under test is the one that ships. Not a test file itself.
import crypto from 'node:crypto';
import { SNAPSHOT_CATALOG } from '../src/assetCatalog.mjs';
import { Client } from '../src/client.mjs';

export async function quietly(fn) {
  const { log, error } = console;
  const out = [];
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => out.push(a.join(' '));
  try {
    return { result: await fn(), out: out.join('\n') };
  } finally {
    console.log = log;
    console.error = error;
  }
}

export const KEY = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256', privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey;

/** The store: one app, one version (or only a live one), two localizations, an Asset Library. */
export function store({ version = { id: 'v1', attributes: { versionString: '1.4', appStoreState: 'PREPARE_FOR_SUBMISSION', platform: 'IOS' } }, placements = [], library = [], refData = 'live' } = {}) {
  const calls = [];
  const state = { placements: [...placements], library: [...library], n: 0 };
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || 'GET';
    const u = new URL(url);
    const body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ method, path: u.pathname + u.search, body });
    const p = u.pathname;
    if (u.host === 'upload.example') return new Response('', { status: 200 });
    if (method === 'GET') {
      if (p === '/v1/apps') return json(200, { data: [{ id: 'app1', attributes: { name: 'Vinto', primaryLocale: 'en-GB' } }] });
      if (p === '/v1/appAssetLibraryRefData') return refData === 'live' ? json(200, { data: [{ id: '1', attributes: SNAPSHOT_CATALOG.attributes }] }) : json(500, {});
      if (p === '/v1/apps/app1/appStoreVersions') return json(200, { data: version ? [version] : [{ id: 'live', attributes: { versionString: '1.3', appStoreState: 'READY_FOR_SALE' } }] });
      if (p === '/v1/apps/app1/assetLibrary') return json(200, { data: { type: 'appAssetLibraries', id: 'lib1' } });
      if (p.endsWith('/appStoreVersionLocalizations')) return json(200, { data: [{ id: 'loc-en', attributes: { locale: 'en-GB' } }, { id: 'loc-de', attributes: { locale: 'de-DE' } }] });
      if (/^\/v1\/appAssetLibraries\/lib1\/(images|videos)$/.test(p)) {
        const kind = p.endsWith('images') ? 'image' : 'video';
        return json(200, { data: state.library.filter((a) => a.kind === kind).map((a) => ({ id: a.id, attributes: a })) });
      }
      const m = /^\/v1\/appStoreVersionLocalizations\/([^/]+)\/placements$/.exec(p);
      if (m) {
        const mine = state.placements.filter((x) => x.loc === m[1]);
        return json(200, {
          data: mine.map((x) => ({ id: x.id, attributes: { placementType: x.placementType, placementGroup: 'DEFAULT_PROFILE', state: x.state || 'PARENT_PREPARE_FOR_SUBMISSION' }, relationships: { image: { data: { type: 'appAssetLibraryImages', id: x.asset.id } } } })),
          included: mine.map((x) => ({ type: 'appAssetLibraryImages', id: x.asset.id, attributes: x.asset })),
        });
      }
      const a = /^\/v1\/appAssetLibrary(Images|Videos)\/([^/]+)$/.exec(p);
      if (a) return json(200, { data: { id: a[2], attributes: { state: 'PREPARE_FOR_SUBMISSION' } } });
      return json(404, { errors: [{ detail: `no route ${p}` }] });
    }
    if (method === 'POST' && /^\/v1\/appAssetLibrary(Images|Videos)$/.test(p)) {
      const id = `asset-${++state.n}`;
      return json(201, { data: { id, type: body.data.type, attributes: { ...body.data.attributes, state: 'AWAITING_UPLOAD', uploadOperations: [{ method: 'PUT', url: `https://upload.example/${id}`, offset: 0, length: body.data.attributes.fileSize, requestHeaders: [] }] } } });
    }
    if (method === 'PATCH' && /^\/v1\/appAssetLibrary(Images|Videos)\//.test(p)) return json(200, { data: { id: body.data.id, attributes: { state: 'UPLOAD_COMPLETE' } } });
    if (method === 'POST' && p === '/v1/appAssetLibraryPlacements') return json(201, { data: { id: `placement-${++state.n}`, attributes: body.data.attributes } });
    if (method === 'DELETE' && p.startsWith('/v1/appAssetLibraryPlacements/')) return new Response(null, { status: 204 });
    return json(400, { errors: [{ detail: `unexpected ${method} ${p}` }] });
  };
  return { calls, fetchImpl };
}

/** Run with this store behind `fetch` and these environment toggles, restoring both after. */
export async function withStore(s, fn, env = {}) {
  const realFetch = globalThis.fetch;
  const keys = ['VYDANNE_REPLACE', 'VYDANNE_SKIP_METADATA', 'VYDANNE_SKIP_SCREENSHOTS', ...Object.keys(env)];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, env);
  globalThis.fetch = s.fetchImpl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of Object.entries(saved)) (v === undefined ? delete process.env[k] : (process.env[k] = v));
  }
}

export const client = (dryRun) => new Client({ keyId: 'K', issuerId: 'I', keyContent: KEY, dryRun });

/** The store with the extra records `preflight` and `fill` read: app info, review contact, screenshot sets. */
export function preflightStore({ placements = [], sets = [] } = {}) {
  const base = store({ placements });
  const inner = base.fetchImpl;
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  base.fetchImpl = async (url, init = {}) => {
    if ((init.method || 'GET') !== 'GET') return inner(url, init); // every write is recorded by the base store
    const u = new URL(url);
    const p = u.pathname;
    if (p === '/v1/apps') return json(200, { data: [{ id: 'app1', attributes: { name: 'Vinto', primaryLocale: 'en-GB', contentRightsDeclaration: 'DOES_NOT_USE_THIRD_PARTY_CONTENT' } }] });
    if (p === '/v1/apps/app1/appInfos') return json(200, { data: [{ id: 'info1', attributes: { state: 'PREPARE_FOR_SUBMISSION', appStoreAgeRating: 'FOUR_PLUS' } }] });
    if (p === '/v1/appInfos/info1/primaryCategory') return json(200, { data: { id: 'GAMES' } });
    if (p === '/v1/appInfos/info1/appInfoLocalizations') return json(200, { data: [{ id: 'il1', attributes: { locale: 'en-GB' } }] });
    if (p === '/v1/appInfoLocalizations/il1') return json(200, { data: { attributes: { name: 'Vinto', subtitle: 'Cards' } } });
    if (p === '/v1/appStoreVersions/v1/appStoreReviewDetail') return json(200, { data: { attributes: { contactFirstName: 'a', contactLastName: 'b', contactPhone: '1', contactEmail: 'e' } } });
    if (p === '/v1/apps/app1/appStoreVersions') return json(200, { data: [{ id: 'v1', attributes: { versionString: '1.4', appStoreState: 'PREPARE_FOR_SUBMISSION', copyright: '2026' } }] });
    if (/^\/v1\/appStoreVersionLocalizations\/loc-(en|de)$/.test(p)) return json(200, { data: { attributes: { description: 'd', keywords: 'k', promotionalText: 'p' } } });
    if (/\/appScreenshotSets$/.test(p)) return json(200, { data: sets.map((s, i) => ({ id: `set${i}`, attributes: { screenshotDisplayType: s.type }, relationships: { appScreenshots: { data: s.files.map((f, j) => ({ id: `${i}-${j}` })) } } })), included: sets.flatMap((s, i) => s.files.map((f, j) => ({ type: 'appScreenshots', id: `${i}-${j}`, attributes: { fileName: f, sourceFileChecksum: null } }))) });
    return inner(url, init);
  };
  return base;
}
