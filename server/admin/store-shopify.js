/*
 * 保存先：Shopify（Admin API）
 * --------------------------------------------------
 * メタオブジェクト「POP UPイベント」（タイプ popup_event）に、イベントごとに2つのエントリーを使います。
 *   <イベントID>-draft … 管理画面で編集中の下書き
 *   <イベントID>-live  … 公開済みの内容
 * （以前の形式の draft / current は、イベント「main」として扱います）
 * 「公開」は下書きの内容を live にコピーします。お客さんのサイトに出すイベントは会期で自動で決まります（events.js）。
 * 画像は Shopify の「ファイル」に保存されます。
 *
 * 環境変数（サーバーだけに設定。ブラウザには出しません）:
 *   SHOPIFY_STORE_DOMAIN   例: your-store.myshopify.com
 *   SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET  Dev Dashboard のアプリ（または SHOPIFY_ADMIN_TOKEN。shopify-token.js）
 *   SHOPIFY_API_VERSION    既定 2025-01
 *   SHOPIFY_COLLECTION     店内に並べるコレクションのハンドル（既定 popup）
 */
const { KEYS, IMAGE, cleanEvent, cleanLayout, flatten, InputError } = require('./fields');
const ev = require('./events');

const auth = require('./shopify-token');

const DOMAIN = auth.DOMAIN;
const VERSION = process.env.SHOPIFY_API_VERSION || '2025-01';
const COLLECTION = process.env.SHOPIFY_COLLECTION || 'popup';
// テスト用に API の URL を差し替えられるようにしている
const ENDPOINT = process.env.SHOPIFY_ADMIN_URL || `https://${DOMAIN}/admin/api/${VERSION}/graphql.json`;
const TYPE = 'popup_event';

class Conflict extends Error {}
class ShopifyError extends Error {}

async function gql(query, variables = {}, retried = false) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': await auth.getToken() },
    body: JSON.stringify({ query, variables }),
  });
  // 期限切れなどでトークンが使えなくなったら、1 回だけ取り直す
  if (res.status === 401 && auth.method === 'client' && !retried) { auth.invalidate(); return gql(query, variables, true); }
  if (!res.ok) throw new ShopifyError(`Shopify Admin API ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new ShopifyError(json.errors.map((e) => e.message).join(' / '));
  return json.data;
}

function userErrors(errs) {
  if (errs?.length) throw new ShopifyError(errs.map((e) => `${e.field?.join('.') || ''} ${e.message}`).join(' / '));
}

/** メタオブジェクトのフィールド → { event, layout, meta } */
function parseEntry(mo) {
  const f = Object.fromEntries(mo.fields.map((x) => [x.key, x]));
  // イベントの設定は 1 つの JSON（settings）にまとめて保存している（画像は { id, url }）
  let saved = {};
  try { saved = f.settings?.value ? JSON.parse(f.settings.value) : {}; } catch { saved = {}; }
  const event = {};
  for (const k of KEYS) {
    const v = saved[k];
    if (v == null) event[k] = '';
    else if (IMAGE.includes(k)) event[k] = v && typeof v === 'object' && v.url ? { id: v.id, url: v.url } : '';
    else event[k] = v;
  }
  let layout = null;
  let meta = {};
  try { layout = f.layout?.value ? JSON.parse(f.layout.value) : null; } catch { layout = null; }
  try { meta = f.admin_meta?.value ? JSON.parse(f.admin_meta.value) : {}; } catch { meta = {}; }
  return { id: mo.id, event, layout, meta, updatedAt: mo.updatedAt };
}

async function readEntry(handle) {
  const data = await gql(`
    query Entry($handle: MetaobjectHandleInput!) {
      metaobjectByHandle(handle: $handle) { id updatedAt fields { key value } }
    }`, { handle: { type: TYPE, handle } });
  return data.metaobjectByHandle ? parseEntry(data.metaobjectByHandle) : null;
}

/* イベント ID → エントリーのハンドル（以前の形式の「main」は draft / current） */
const handleOf = (id, kind) => (id === 'main' ? (kind === 'draft' ? 'draft' : 'current') : `${id}-${kind}`);
function idOfHandle(h) {
  if (h === 'draft' || h === 'current') return ['main', h === 'draft' ? 'draft' : 'live'];
  const m = /^(e\d{8}-[a-f0-9]{6})-(draft|live)$/.exec(h);
  return m ? [m[1], m[2]] : [null, null];
}

/** すべてのイベント（下書きと公開済みを組み合わせる） */
async function readAll() {
  const out = {};
  let after = null;
  for (let page = 0; page < 10; page++) {
    const data = await gql(`
      query All($type: String!, $after: String) {
        metaobjects(type: $type, first: 100, after: $after) {
          nodes { id handle updatedAt fields { key value } }
          pageInfo { hasNextPage endCursor }
        }
      }`, { type: TYPE, after });
    for (const mo of data.metaobjects.nodes) {
      const [id, kind] = idOfHandle(mo.handle);
      if (!id) continue;
      out[id] ||= { id, draft: null, live: null };
      out[id][kind] = parseEntry(mo);
    }
    if (!data.metaobjects.pageInfo.hasNextPage) break;
    after = data.metaobjects.pageInfo.endCursor;
  }
  return Object.values(out).map(toEvent);
}

/** エントリーの組 → events.js の形 { id, createdAt, draft, published, history } */
function toEvent({ id, draft, live }) {
  const published = live
    ? { event: live.event, layout: live.layout, publishedAt: live.meta.publishedAt || live.updatedAt, publishedBy: live.meta.publishedBy || null }
    : null;
  const d = draft
    ? { event: draft.event, layout: draft.layout, rev: draft.meta.rev || 0, updatedAt: draft.meta.updatedAt || draft.updatedAt, updatedBy: draft.meta.updatedBy || null }
    : { event: published?.event || {}, layout: published?.layout || null, rev: 0, updatedAt: null, updatedBy: null };
  return { id, createdAt: draft?.meta.createdAt || live?.meta.createdAt || null, draft: d, published, history: live?.meta.history || [], _draftMeta: draft?.meta || {} };
}

async function readEvent(id) {
  if (!ev.validId(id)) throw Object.assign(new InputError('イベントが見つかりません'), { status: 404 });
  const [draft, live] = await Promise.all([readEntry(handleOf(id, 'draft')), readEntry(handleOf(id, 'live'))]);
  if (!draft && !live) throw Object.assign(new InputError('イベントが見つかりません'), { status: 404 });
  return toEvent({ id, draft, live });
}

async function writeEntry(handle, event, layout, meta) {
  const settings = {};
  for (const k of KEYS) {
    const v = event[k];
    if (v == null || v === '') continue;
    settings[k] = IMAGE.includes(k) ? (v && typeof v === 'object' ? { id: v.id, url: v.url } : undefined) : v;
  }
  const fields = [
    { key: 'settings', value: JSON.stringify(settings) },
    { key: 'layout', value: JSON.stringify(layout) },
    { key: 'admin_meta', value: JSON.stringify(meta) },
  ];
  const data = await gql(`
    mutation Upsert($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
      metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
        metaobject { id }
        userErrors { field message code }
      }
    }`, { handle: { type: TYPE, handle }, metaobject: { fields } });
  userErrors(data.metaobjectUpsert.userErrors);
}

async function products(collection = COLLECTION) {
  const data = await gql(`
    query Products($q: String!) {
      collections(first: 1, query: $q) {
        nodes {
          products(first: 250) {
            nodes {
              handle title productType tags totalInventory status
              featuredImage { url(transform: { maxWidth: 300, maxHeight: 300 }) }
              variants(first: 1) { nodes { price } }
              size: metafield(namespace: "popup", key: "size") { value }
            }
          }
        }
      }
    }`, { q: `handle:${collection}` });
  const nodes = data.collections.nodes[0]?.products.nodes || [];
  const SIZE = { '大': 'plush', '中': 'mug', '小': 'keychain' };
  return nodes.map((n) => ({
    id: n.handle,
    name: n.title,
    price: Math.round(Number(n.variants.nodes[0]?.price || 0)),
    stock: n.totalInventory ?? 99,
    image: n.featuredImage?.url || null,
    limited: (n.tags || []).includes('limited'),
    isNew: (n.tags || []).some((t) => t.toLowerCase() === 'new'),
    character: '',
    shape: SIZE[n.size?.value] || 'mug',
    category: n.productType || '',
    status: n.status,
  }));
}

// 画像の値（{ id: MediaImage の GID, url: Shopify CDN }）
const imageOk = (v) => v && typeof v === 'object' &&
  /^gid:\/\/shopify\/MediaImage\/\d+$/.test(v.id) && /^https:\/\/cdn\.shopify\.com\//.test(v.url);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = {
  mode: 'shopify',
  label: `Shopify（${DOMAIN}）`,
  enabled: auth.configured,
  defaultCollection: COLLECTION,

  async listEvents() {
    const all = await readAll();
    const active = ev.pickActive(all);
    return all.map((x) => ev.summary(x, active?.id))
      .sort((a, b) => (b.open_at || b.createdAt || '').localeCompare(a.open_at || a.createdAt || ''));
  },

  async createEvent({ title, copyFrom }, user) {
    const id = ev.newId();
    let event = { title };
    let layout = null;
    if (copyFrom) {
      const src = await readEvent(copyFrom);
      event = ev.copyForNew(src.draft.event, title);
      layout = src.draft.layout;
    }
    const now = new Date().toISOString();
    await writeEntry(handleOf(id, 'draft'), event, layout, { rev: 1, updatedAt: now, updatedBy: user, createdAt: now, createdBy: user });
    return { id };
  },

  async deleteEvent(id) {
    for (const kind of ['draft', 'live']) {
      const e = await readEntry(handleOf(id, kind));
      if (!e) continue;
      const data = await gql(`
        mutation Del($id: ID!) { metaobjectDelete(id: $id) { deletedId userErrors { field message } } }`, { id: e.id });
      userErrors(data.metaobjectDelete.userErrors);
    }
  },

  async getState(id) {
    const x = await readEvent(id);
    const list = await products(x.draft.event.collection || COLLECTION);
    const published = x.published || { event: {}, layout: null, publishedAt: null, publishedBy: null };
    return { id, draft: x.draft, published, history: x.history, products: list };
  },

  products,

  /** 管理画面の「コレクション」の選択肢 */
  async collections() {
    const data = await gql(`
      query Cols { collections(first: 250, sortKey: TITLE) { nodes { handle title productsCount { count } } } }`);
    return data.collections.nodes.map((c) => ({ handle: c.handle, title: c.title, count: c.productsCount?.count ?? null }));
  },

  async saveDraft(id, { event, layout, rev }, user) {
    const x = await readEvent(id);
    if (rev !== x.draft.rev) throw new Conflict();
    const e = cleanEvent(event, imageOk);
    const lay = cleanLayout(layout);
    const meta = { ...x._draftMeta, rev: x.draft.rev + 1, updatedAt: new Date().toISOString(), updatedBy: user };
    await writeEntry(handleOf(id, 'draft'), e, lay, meta);
    return { event: e, layout: lay, rev: meta.rev, updatedAt: meta.updatedAt, updatedBy: user };
  },

  async publish(id, user, rev) {
    const x = await readEvent(id);
    if (rev !== x.draft.rev) throw new Conflict();
    const at = new Date().toISOString();
    const history = [{ at, by: user }, ...(x.history || [])].slice(0, 50);
    await writeEntry(handleOf(id, 'live'), x.draft.event, x.draft.layout, { publishedAt: at, publishedBy: user, history, createdAt: x.createdAt });
    // 下書きのエントリーがまだない（以前の形式）ときは作っておく
    if (!x._draftMeta.rev) await writeEntry(handleOf(id, 'draft'), x.draft.event, x.draft.layout, { rev: x.draft.rev, updatedAt: at, updatedBy: user, createdAt: x.createdAt || at });
    return { event: x.draft.event, layout: x.draft.layout, publishedAt: at, publishedBy: user };
  },

  async discard(id, user) {
    const x = await readEvent(id);
    const p = x.published || { event: {}, layout: null };
    const meta = { ...x._draftMeta, rev: x.draft.rev + 1, updatedAt: new Date().toISOString(), updatedBy: user };
    await writeEntry(handleOf(id, 'draft'), p.event, p.layout, meta);
    return { event: p.event, layout: p.layout, ...meta };
  },

  /** お客さんのサイトに出すイベント（会期で自動） */
  async getPublished() {
    const active = ev.pickActive(await readAll());
    if (!active) return { id: null, event: {}, layout: null };
    return { id: active.id, event: flatten(active.published.event || {}), layout: active.published.layout };
  },

  /** 下書きのプレビュー用 */
  async getDraft(id) {
    const x = await readEvent(id);
    return { id, event: flatten(x.draft.event || {}), layout: x.draft.layout };
  },

  /* 画像を Shopify の「ファイル」にアップロード */
  async upload(buffer, ext, mime) {
    const filename = `popup-${Date.now()}.${ext}`;
    const staged = await gql(`
      mutation Staged($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets { url resourceUrl parameters { name value } }
          userErrors { field message }
        }
      }`, { input: [{ filename, mimeType: mime, resource: 'IMAGE', httpMethod: 'POST', fileSize: String(buffer.length) }] });
    userErrors(staged.stagedUploadsCreate.userErrors);
    const target = staged.stagedUploadsCreate.stagedTargets[0];
    const form = new FormData();
    for (const p of target.parameters) form.append(p.name, p.value);
    form.append('file', new Blob([buffer], { type: mime }), filename);
    const up = await fetch(target.url, { method: 'POST', body: form });
    if (!up.ok) throw new ShopifyError(`upload ${up.status}`);

    const created = await gql(`
      mutation FileCreate($files: [FileCreateInput!]!) {
        fileCreate(files: $files) { files { id ... on MediaImage { image { url } } } userErrors { field message } }
      }`, { files: [{ originalSource: target.resourceUrl, contentType: 'IMAGE', alt: 'POP UP 内装' }] });
    userErrors(created.fileCreate.userErrors);
    const id = created.fileCreate.files[0].id;
    let url = created.fileCreate.files[0].image?.url;
    // 画像の処理が終わるまで少し待つ
    for (let i = 0; !url && i < 15; i++) {
      await sleep(1000);
      const n = await gql(`query F($id: ID!) { node(id: $id) { ... on MediaImage { fileStatus image { url } } } }`, { id });
      url = n.node?.image?.url;
      if (n.node?.fileStatus === 'FAILED') throw new ShopifyError('画像の処理に失敗しました');
    }
    if (!url) throw new ShopifyError('画像の処理に時間がかかっています。少し待ってからもう一度お試しください');
    return { id, url };
  },

  Conflict,
  ShopifyError,
};
