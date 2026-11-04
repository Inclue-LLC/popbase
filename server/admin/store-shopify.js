/*
 * 保存先：Shopify（Admin API）
 * --------------------------------------------------
 * メタオブジェクト「POP UPイベント」（タイプ popup_event）の2つのエントリーを使います。
 *   draft   … 管理画面で編集中の下書き
 *   current … 公開中（お客さんのサイトが Storefront API で読むもの）
 * 「公開」は draft の内容を current にコピーします。画像は Shopify の「ファイル」に保存されます。
 *
 * 環境変数（サーバーだけに設定。ブラウザには出しません）:
 *   SHOPIFY_STORE_DOMAIN   例: your-store.myshopify.com
 *   SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET  Dev Dashboard のアプリ（または SHOPIFY_ADMIN_TOKEN。shopify-token.js）
 *   SHOPIFY_API_VERSION    既定 2025-01
 *   SHOPIFY_COLLECTION     店内に並べるコレクションのハンドル（既定 popup）
 */
const { KEYS, IMAGE, JSON_KEYS, cleanEvent, cleanLayout, flatten } = require('./fields');

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

async function readEntry(handle) {
  const data = await gql(`
    query Entry($handle: MetaobjectHandleInput!) {
      metaobjectByHandle(handle: $handle) {
        id updatedAt
        fields { key value reference { ... on MediaImage { id image { url } } } }
      }
    }`, { handle: { type: TYPE, handle } });
  const mo = data.metaobjectByHandle;
  if (!mo) return null;
  const f = Object.fromEntries(mo.fields.map((x) => [x.key, x]));
  const event = {};
  for (const k of KEYS) {
    const x = f[k];
    if (!x || x.value == null) { event[k] = ''; continue; }
    if (IMAGE.includes(k)) event[k] = x.reference?.image?.url ? { id: x.value, url: x.reference.image.url } : '';
    else if (JSON_KEYS.includes(k)) { try { event[k] = JSON.parse(x.value); } catch { event[k] = ''; } }
    else event[k] = x.value;
  }
  let layout = null;
  let meta = {};
  try { layout = f.layout?.value ? JSON.parse(f.layout.value) : null; } catch { layout = null; }
  try { meta = f.admin_meta?.value ? JSON.parse(f.admin_meta.value) : {}; } catch { meta = {}; }
  return { event, layout, meta, updatedAt: mo.updatedAt };
}

async function writeEntry(handle, event, layout, meta) {
  const fields = KEYS.map((k) => {
    const v = event[k];
    let value = '';
    if (IMAGE.includes(k)) value = v && typeof v === 'object' ? v.id : '';
    else if (JSON_KEYS.includes(k)) value = v && typeof v === 'object' ? JSON.stringify(v) : '';
    else value = v == null ? '' : String(v);
    return { key: k, value };
  });
  fields.push({ key: 'layout', value: JSON.stringify(layout) });
  fields.push({ key: 'admin_meta', value: JSON.stringify(meta) });
  const data = await gql(`
    mutation Upsert($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
      metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
        metaobject { id }
        userErrors { field message code }
      }
    }`, { handle: { type: TYPE, handle }, metaobject: { fields } });
  userErrors(data.metaobjectUpsert.userErrors);
}

async function products() {
  const data = await gql(`
    query Products($q: String!) {
      collections(first: 1, query: $q) {
        nodes {
          products(first: 250) {
            nodes {
              handle title productType tags totalInventory status
              featuredImage { url(transform: { maxWidth: 300, maxHeight: 300 }) }
              variants(first: 1) { nodes { price } }
              limited: metafield(namespace: "popup", key: "limited") { value }
              character: metafield(namespace: "popup", key: "character") { value }
              size: metafield(namespace: "popup", key: "size") { value }
            }
          }
        }
      }
    }`, { q: `handle:${COLLECTION}` });
  const nodes = data.collections.nodes[0]?.products.nodes || [];
  const CHAR = { 'ハル': 'haru', 'ビョル': 'byeol', 'タルビ': 'dalbit', 'ゴミ': 'gomi' };
  const SIZE = { '大': 'plush', '中': 'mug', '小': 'keychain' };
  return nodes.map((n) => ({
    id: n.handle,
    name: n.title,
    price: Math.round(Number(n.variants.nodes[0]?.price || 0)),
    stock: n.totalInventory ?? 99,
    image: n.featuredImage?.url || null,
    limited: n.limited?.value === 'true' || (n.tags || []).includes('limited'),
    isNew: (n.tags || []).some((t) => t.toLowerCase() === 'new'),
    character: CHAR[n.character?.value] || n.character?.value || '',
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

  async getState() {
    const [cur, draft, list] = await Promise.all([readEntry('current'), readEntry('draft'), products()]);
    const published = cur
      ? { event: cur.event, layout: cur.layout, publishedAt: cur.meta.publishedAt || cur.updatedAt, publishedBy: cur.meta.publishedBy || null }
      : { event: {}, layout: null, publishedAt: null, publishedBy: null };
    const d = draft
      ? { event: draft.event, layout: draft.layout, rev: draft.meta.rev || 0, updatedAt: draft.meta.updatedAt || draft.updatedAt, updatedBy: draft.meta.updatedBy || null }
      : { event: published.event, layout: published.layout, rev: 0, updatedAt: null, updatedBy: null };
    return { draft: d, published, history: cur?.meta.history || [], products: list };
  },

  async saveDraft({ event, layout, rev }, user) {
    const cur = await readEntry('draft');
    const curRev = cur?.meta.rev || 0;
    if (rev !== curRev) throw new Conflict();
    const ev = cleanEvent(event, imageOk);
    const lay = cleanLayout(layout);
    const meta = { rev: curRev + 1, updatedAt: new Date().toISOString(), updatedBy: user };
    await writeEntry('draft', ev, lay, meta);
    return { event: ev, layout: lay, ...meta };
  },

  async publish(user, rev) {
    const draft = await readEntry('draft');
    if (!draft || rev !== (draft.meta.rev || 0)) throw new Conflict();
    const cur = await readEntry('current');
    const at = new Date().toISOString();
    const history = [{ at, by: user }, ...(cur?.meta.history || [])].slice(0, 50);
    await writeEntry('current', draft.event, draft.layout, { publishedAt: at, publishedBy: user, history });
    return { event: draft.event, layout: draft.layout, publishedAt: at, publishedBy: user };
  },

  async discard(user) {
    const cur = await readEntry('current');
    const draft = await readEntry('draft');
    const meta = { rev: (draft?.meta.rev || 0) + 1, updatedAt: new Date().toISOString(), updatedBy: user };
    await writeEntry('draft', cur?.event || {}, cur?.layout || null, meta);
    return { event: cur?.event || {}, layout: cur?.layout || null, ...meta };
  },

  async getPublished() {
    const cur = await readEntry('current');
    return { event: flatten(cur?.event || {}), layout: cur?.layout || null };
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
