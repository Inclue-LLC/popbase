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

/**
 * このイベントの商品（コレクション）が入った注文。出品者が発送するために、管理画面の「注文」に出す
 * Admin API の権限 read_orders と、お客さまの情報（名前・住所・電話・メール）を読む許可が必要
 * （read_orders で読めるのは直近60日の注文）
 */
// 都道府県（Shopify の provinceCode「JP-13」→ 日本語）。Shopify の province は英語（Tokyo など）で返るため
const PREFS = ['', '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
  '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'];
const prefOf = (a) => {
  const m = /^JP-(\d{2})$/.exec(a.provinceCode || '');
  return m && PREFS[Number(m[1])] ? PREFS[Number(m[1])] : (a.province || '');
};
// お名前は日本の順（姓 名）。姓・名がなければ、Shopify の name のまま
const nameOf = (a) => (a.lastName || a.firstName ? [a.lastName, a.firstName].filter(Boolean).join(' ') : (a.name || ''));

/** このイベントのコレクションの商品 ID */
async function collectionProductIds(collection) {
  const pd = await gql(`
    query P($q: String!) { collections(first: 1, query: $q) { nodes { products(first: 250) { nodes { id } } } } }`, { q: `handle:${collection}` });
  return new Set((pd.collections.nodes[0]?.products.nodes || []).map((n) => n.id));
}

async function orders(collection, sinceIso) {
  const ids = await collectionProductIds(collection);
  if (!ids.size) return [];
  const out = [];
  let after = null;
  const q = sinceIso ? `created_at:>=${sinceIso}` : '';
  for (let page = 0; page < 10; page++) {
    const data = await gql(`
      query O($q: String, $after: String) {
        orders(first: 100, after: $after, query: $q, sortKey: CREATED_AT, reverse: true) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id name createdAt cancelledAt email phone note
            displayFinancialStatus displayFulfillmentStatus
            shippingAddress { name firstName lastName zip province provinceCode city address1 address2 phone company }
            lineItems(first: 100) { nodes { title variantTitle sku quantity unfulfilledQuantity product { id } } }
            fulfillments(first: 20) { createdAt trackingInfo(first: 3) { company number url } }
          }
        }
      }`, { q, after });
    for (const o of data.orders.nodes) {
      const items = o.lineItems.nodes.filter((li) => li.product && ids.has(li.product.id));
      if (!items.length) continue;
      const a = o.shippingAddress || {};
      out.push({
        id: o.id, name: o.name, createdAt: o.createdAt, cancelled: !!o.cancelledAt,
        financial: o.displayFinancialStatus, fulfillment: o.displayFulfillmentStatus,
        email: o.email || '', phone: o.phone || a.phone || '', note: o.note || '',
        ship: { name: nameOf(a), company: a.company || '', zip: a.zip || '', province: prefOf(a), city: a.city || '', address1: a.address1 || '', address2: a.address2 || '', phone: a.phone || '' },
        items: items.map((li) => ({ title: li.title, variant: li.variantTitle || '', sku: li.sku || '', quantity: li.quantity, unfulfilled: li.unfulfilledQuantity ?? li.quantity })),
        // このイベントの商品が、すべて発送済みか（ほかのイベントの商品が同じ注文に入っていても、こちらの分だけで判断）
        shipped: items.every((li) => (li.unfulfilledQuantity ?? li.quantity) === 0),
        tracking: (o.fulfillments || []).flatMap((f) => (f.trackingInfo || []).map((t) => ({ company: t.company || '', number: t.number || '', url: t.url || '' }))).filter((t) => t.number),
      });
    }
    if (!data.orders.pageInfo.hasNextPage) break;
    after = data.orders.pageInfo.endCursor;
  }
  return out;
}

/**
 * 発送済みにする（Shopify の「発送」を作る）。このイベントの商品の、まだ発送していない分だけ。
 * notify が true なら、Shopify から注文した人へ発送通知メール（Shopify の「発送確認」の通知）が届く。
 * Admin API の権限 read_merchant_managed_fulfillment_orders / write_merchant_managed_fulfillment_orders が必要
 */
const CARRIERS = {
  yamato: { company: 'Yamato (JA)', url: (n) => `https://jizen.kuronekoyamato.co.jp/jizen/servlet/crjz.b.NQ0010?id=${encodeURIComponent(n)}` },
  sagawa: { company: 'Sagawa (JA)', url: (n) => `https://k2k.sagawa-exp.co.jp/p/web/okurijosearch.do?okurijoNo=${encodeURIComponent(n)}` },
  japanpost: { company: 'Japan Post (JA)', url: (n) => `https://trackings.post.japanpost.jp/services/srv/search/direct?reqCodeNo1=${encodeURIComponent(n)}&locale=ja` },
  other: { company: 'Other', url: () => '' },
};
async function fulfill(collection, orderId, { carrier = 'other', number = '', notify = true } = {}) {
  if (!/^gid:\/\/shopify\/Order\/\d+$/.test(orderId || '')) throw new InputError('注文');
  const ids = await collectionProductIds(collection);
  const data = await gql(`
    query F($id: ID!) { order(id: $id) { id fulfillmentOrders(first: 20) { nodes { id status
      lineItems(first: 100) { nodes { id remainingQuantity lineItem { product { id } } } } } } } }`, { id: orderId });
  if (!data.order) throw new InputError('注文が見つかりません');
  const groups = [];
  for (const fo of data.order.fulfillmentOrders.nodes) {
    if (!['OPEN', 'IN_PROGRESS'].includes(fo.status)) continue;
    const lines = fo.lineItems.nodes.filter((l) => l.remainingQuantity > 0 && l.lineItem?.product && ids.has(l.lineItem.product.id))
      .map((l) => ({ id: l.id, quantity: l.remainingQuantity }));
    if (lines.length) groups.push({ fulfillmentOrderId: fo.id, fulfillmentOrderLineItems: lines });
  }
  if (!groups.length) throw new InputError('このイベントの商品は、すでに発送済みです');
  const c = CARRIERS[carrier] || CARRIERS.other;
  const num = String(number || '').trim().slice(0, 60);
  const trackingInfo = num ? { company: c.company, number: num, ...(c.url(num) ? { url: c.url(num) } : {}) } : undefined;
  const r = await gql(`
    mutation C($f: FulfillmentInput!) { fulfillmentCreate(fulfillment: $f) { fulfillment { id status } userErrors { field message } } }`,
  { f: { lineItemsByFulfillmentOrder: groups, notifyCustomer: !!notify, ...(trackingInfo ? { trackingInfo } : {}) } });
  userErrors(r.fulfillmentCreate.userErrors);
  return { ok: true, status: r.fulfillmentCreate.fulfillment?.status || 'SUCCESS' };
}

/**
 * 商品の「NEW」「会場限定」を、Shopify の商品タグ（new / limited）で付け外しする（管理画面の「商品の配置」から）
 * Admin API の権限 write_products が必要
 */
async function setProductTags(handle, { isNew, limited }) {
  const found = await gql(`query P($q: String!) { products(first: 1, query: $q) { nodes { id handle tags } } }`, { q: `handle:${handle}` });
  const prod = found.products.nodes.find((n) => n.handle === handle);
  if (!prod) throw new InputError('商品が見つかりません');
  const has = (t) => prod.tags.some((x) => x.toLowerCase() === t);
  const add = []; const remove = [];
  if (typeof isNew === 'boolean') { if (isNew && !has('new')) add.push('new'); if (!isNew && has('new')) remove.push(...prod.tags.filter((x) => x.toLowerCase() === 'new')); }
  if (typeof limited === 'boolean') { if (limited && !prod.tags.includes('limited')) add.push('limited'); if (!limited && prod.tags.includes('limited')) remove.push('limited'); }
  if (add.length) {
    const r = await gql(`mutation A($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { field message } } }`, { id: prod.id, tags: add });
    userErrors(r.tagsAdd.userErrors);
  }
  if (remove.length) {
    const r = await gql(`mutation R($id: ID!, $tags: [String!]!) { tagsRemove(id: $id, tags: $tags) { userErrors { field message } } }`, { id: prod.id, tags: remove });
    userErrors(r.tagsRemove.userErrors);
  }
  const tags = [...prod.tags.filter((t) => !remove.includes(t)), ...add];
  return { id: handle, isNew: tags.some((t) => t.toLowerCase() === 'new'), limited: tags.includes('limited') };
}

// 画像の値（{ id: MediaImage の GID, url: Shopify CDN }）
const imageOk = (v) => v && typeof v === 'object' &&
  /^gid:\/\/shopify\/MediaImage\/\d+$/.test(v.id) && /^https:\/\/cdn\.shopify\.com\//.test(v.url);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let policyCache = null; // 規約・ポリシー（10分ごとに読み直す）

module.exports = {
  mode: 'shopify',
  label: `Shopify（${DOMAIN}）`,
  enabled: auth.configured,
  defaultCollection: COLLECTION,
  orders,
  fulfill,
  setProductTags,

  /**
   * 規約・ポリシー（Shopify 管理画面「設定 → ポリシー」）。お客さんのサイトのページ下から、POP BASE の中で開く
   * Admin API の権限 read_legal_policies が必要（なければ空で返し、サイトは Shopify のページへのリンクにする）
   */
  async policies() {
    const now = Date.now();
    if (policyCache && now - policyCache.at < 10 * 60e3) return policyCache.list;
    const data = await gql(`{ shop { shopPolicies { type title body url } } }`);
    const list = (data.shop?.shopPolicies || []).filter((p) => p.body && p.body.trim())
      .map((p) => ({ type: String(p.type).toLowerCase().replace(/_/g, '-'), title: p.title, body: p.body, url: p.url }));
    policyCache = { at: now, list };
    return list;
  },

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
