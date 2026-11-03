/*
 * Shopify 連携（Storefront API）
 * --------------------------------------------------
 * data.js の SHOPIFY_CONFIG が設定されているときだけ動きます。
 *
 * 管理はすべて Shopify 管理画面で行います（設定手順: docs/shopify-setup.md）。
 *   商品・価格・在庫・画像          … 通常の商品管理
 *   店内での置き場所・並び順など    … 商品メタフィールド（ネームスペース popup）
 *   会期・内装テーマ・壁紙・色      … メタオブジェクト「POP UPイベント」（タイプ popup_event）
 *   購入手続き・割引コード          … Shopify のチェックアウト
 */
(function () {
  const cfg = window.SHOPIFY_CONFIG || {};
  const enabled = !!(cfg.domain && cfg.storefrontToken);

  // 置き場所メタフィールドの値（管理画面の選択肢）→ 店内のゾーン
  const ZONES = { '左の棚': 'left', '右の棚': 'right', '限定テーブル': 'island', '置かない': 'none',
    left: 'left', right: 'right', island: 'island', table: 'island', none: 'none' };
  const CHARACTER_IDS = { 'ハル': 'haru', 'ビョル': 'byeol', 'タルビ': 'dalbit', 'ゴミ': 'gomi' };
  const SIZES = { '大': 'plush', '中': 'mug', '小': 'keychain' };

  const PRODUCT_FIELDS = (withInventory) => `
    id handle title description productType tags
    featuredImage { url(transform: { maxWidth: 600, maxHeight: 600 }) }
    variants(first: 1) { nodes { id availableForSale ${withInventory ? 'quantityAvailable' : ''} price { amount } } }
    metafields(identifiers: [
      { namespace: "popup", key: "zone" }, { namespace: "popup", key: "order" },
      { namespace: "popup", key: "character" }, { namespace: "popup", key: "limited" },
      { namespace: "popup", key: "purchase_limit" }, { namespace: "popup", key: "spec" },
      { namespace: "popup", key: "size" }
    ]) { key value }`;

  const QUERY = (withInventory) => `
    query PopupStore($collection: String!, $event: String!) {
      collection(handle: $collection) {
        products(first: 100) { nodes { ${PRODUCT_FIELDS(withInventory)} } }
      }
      metaobject(handle: { type: "popup_event", handle: $event }) {
        fields { key value reference { ... on MediaImage { image { url } } } }
      }
    }`;

  async function gql(query, variables) {
    const res = await fetch(`https://${cfg.domain}/api/${cfg.apiVersion || '2025-01'}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Storefront-Access-Token': cfg.storefrontToken },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`Shopify API ${res.status}`);
    return res.json();
  }

  const mf = (node, key) => (node.metafields || []).find((m) => m && m.key === key)?.value ?? null;
  const toInt = (v) => (v == null || v === '' ? null : Number.parseInt(v, 10));
  const slug = (s) => String(s || 'other').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-');

  function mapProduct(node, i) {
    const v = node.variants.nodes[0] || {};
    const zone = ZONES[mf(node, 'zone')] || null;
    const limited = mf(node, 'limited') === 'true' || zone === 'island' || (node.tags || []).includes('limited');
    const qty = typeof v.quantityAvailable === 'number' ? v.quantityAvailable : null;
    const stock = v.availableForSale === false ? 0 : qty != null && qty > 0 ? qty : 99;
    const charRaw = mf(node, 'character');
    return {
      id: node.handle,
      variantId: v.id,
      name: node.title,
      desc: node.description || '',
      spec: mf(node, 'spec') || '',
      price: Math.round(Number(v.price?.amount || 0)),
      stock,
      limited,
      limit: toInt(mf(node, 'purchase_limit')) || undefined,
      isNew: (node.tags || []).some((t) => t.toLowerCase() === 'new'),
      character: CHARACTER_IDS[charRaw] || charRaw || '',
      category: slug(node.productType),
      categoryName: node.productType || 'その他',
      image: node.featuredImage?.url || null,
      shape: SIZES[mf(node, 'size')] || 'mug',
      display: zone,
      order: toInt(mf(node, 'order')) ?? 1000 + i,
    };
  }

  /* メタオブジェクト「POP UPイベント」→ SHOP / テーマ / 棚の看板 */
  function applyEvent(mo) {
    if (!mo) return;
    const f = Object.fromEntries(mo.fields.map((x) => [x.key, x.reference?.image?.url || x.value]));
    const has = (k) => f[k] != null && f[k] !== '';
    const base = window.THEMES[f.theme_preset] || window.THEMES[window.SHOP.theme] || Object.values(window.THEMES)[0];
    const theme = JSON.parse(JSON.stringify(base));
    if (has('title')) theme.name = f.title;
    if (has('subtitle')) theme.title = f.subtitle;
    const set = (obj, key, field) => { if (has(field)) obj[key] = f[field]; };
    set(theme.wall, 'image', 'wall_image');
    set(theme.wall, 'color', 'wall_color');
    set(theme.wall, 'pattern', 'wall_pattern');
    set(theme.wall, 'patternColor', 'wall_pattern_color');
    set(theme.wall, 'lower', 'lower_color');
    set(theme.wall, 'trim', 'trim_color');
    set(theme.floor, 'image', 'floor_image');
    set(theme.floor, 'style', 'floor_style');
    if (has('floor_color_1')) theme.floor.colors[0] = f.floor_color_1;
    if (has('floor_color_2')) theme.floor.colors[1] = f.floor_color_2;
    set(theme.sign, 'bg', 'sign_color');
    set(theme.sign, 'ink', 'sign_text_color');
    set(theme, 'light', 'light');
    window.THEMES.shopify = theme;
    window.SHOP.theme = 'shopify';
    window.applyThemeMeta?.('shopify');
    if (has('period')) window.SHOP.period = f.period;
    if (has('novelty_threshold')) window.SHOP.novelty.threshold = Number(f.novelty_threshold);
    if (has('novelty_name')) window.SHOP.novelty.name = f.novelty_name;
    const L = window.STORE_LAYOUT;
    if (has('left_title')) L.left.title = f.left_title;
    if (has('left_label')) L.left.label = f.left_label;
    if (has('right_title')) L.right.title = f.right_title;
    if (has('right_label')) L.right.label = f.right_label;
  }

  async function load() {
    if (!enabled) return;
    const vars = { collection: cfg.collection || 'popup', event: cfg.eventHandle || 'current' };
    let json = await gql(QUERY(true), vars);
    // 在庫数の公開権限（unauthenticated_read_product_inventory）がない場合は在庫数なしで取り直す
    if (json.errors?.some((e) => /quantityAvailable|access/i.test(e.message))) json = await gql(QUERY(false), vars);
    if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join(' / '));

    const nodes = json.data?.collection?.products?.nodes || [];
    const products = nodes.map(mapProduct).filter((p) => p.display !== 'none').sort((a, b) => a.order - b.order);
    if (!products.length) throw new Error(`コレクション「${vars.collection}」に商品がありません`);

    window.PRODUCTS = products;
    const cats = [];
    for (const p of products) if (!cats.some((c) => c.id === p.category)) cats.push({ id: p.category, name: p.categoryName });
    window.CATEGORIES = cats;
    // 置き場所が未設定の商品は、会場限定→テーブル、それ以外は左右の棚に交互に並べる
    let flip = 0;
    for (const p of products) if (!p.display) p.display = p.limited ? 'island' : (flip++ % 2 ? 'right' : 'left');

    applyEvent(json.data?.metaobject);
  }

  async function checkout(lines, discountCode) {
    const json = await gql(`
      mutation CreateCart($input: CartInput!) {
        cartCreate(input: $input) { cart { checkoutUrl } userErrors { field message } }
      }`, {
      input: {
        lines: lines.map((l) => ({ merchandiseId: l.variantId, quantity: l.quantity })),
        ...(discountCode ? { discountCodes: [discountCode] } : {}),
      },
    });
    const r = json.data?.cartCreate;
    if (!r?.cart?.checkoutUrl) throw new Error(r?.userErrors?.map((e) => e.message).join(' / ') || 'cartCreate failed');
    return r.cart.checkoutUrl;
  }

  window.ShopifyData = { enabled, load, checkout };
})();
