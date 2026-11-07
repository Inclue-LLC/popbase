/*
 * Shopify 連携（Storefront API）
 * --------------------------------------------------
 * data.js の SHOPIFY_CONFIG が設定されているときだけ動きます。
 *
 * 管理はすべて Shopify 管理画面で行います（設定手順: docs/shopify-setup.md）。
 *   商品・価格・在庫・画像          … 通常の商品管理
 *   店内での置き場所・並び順など    … 商品メタフィールド（ネームスペース popup）
 *   イベント（会期・内装・棚の配置・使うコレクション）… 店内管理画面（/admin）で編集・公開し、
 *                                     このサイトのサーバー（/api/published）から読みます
 *   購入手続き                      … Shopify のチェックアウト
 */
(function () {
  const cfg = window.SHOPIFY_CONFIG || {};
  const enabled = !!(cfg.domain && cfg.storefrontToken);

  // 置き場所メタフィールドの値（管理画面の選択肢）→ 店内のゾーン
  const ZONES = { '左の棚': 'left', '右の棚': 'right', '限定テーブル': 'island', '置かない': 'none',
    left: 'left', right: 'right', island: 'island', table: 'island', none: 'none' };
  const SIZES = { '大': 'plush', '中': 'mug', '小': 'keychain' };

  const PRODUCT_FIELDS = (withInventory) => `
    id handle title description descriptionHtml productType tags
    featuredImage { url(transform: { maxWidth: 600, maxHeight: 600 }) }
    variants(first: 1) { nodes { id availableForSale ${withInventory ? 'quantityAvailable' : ''} price { amount } } }
    metafields(identifiers: [
      { namespace: "popup", key: "zone" }, { namespace: "popup", key: "order" },
      { namespace: "popup", key: "purchase_limit" },
      { namespace: "popup", key: "size" }
    ]) { key value }`;

  const QUERY = (withInventory) => `
    query PopupStore($collection: String!) {
      collection(handle: $collection) {
        products(first: 100) { nodes { ${PRODUCT_FIELDS(withInventory)} } }
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

  /**
   * 商品説明（Shopify の HTML）を、改行を残した文字にする
   * 段落・改行・箇条書きの区切りを改行にして、タグは表示しない（HTML としては描かないので安全）
   */
  function descText(html, fallback) {
    if (!html) return fallback || '';
    const marked = String(html)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li[^>]*>/gi, '・')
      .replace(/<\/(p|div|li|h[1-6]|tr|blockquote)>/gi, '\n');
    const doc = new DOMParser().parseFromString(marked, 'text/html');
    return (doc.body.textContent || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim() || fallback || '';
  }

  const mf = (node, key) => (node.metafields || []).find((m) => m && m.key === key)?.value ?? null;
  const toInt = (v) => (v == null || v === '' ? null : Number.parseInt(v, 10));
  const slug = (s) => String(s || 'other').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-');

  function mapProduct(node, i) {
    const v = node.variants.nodes[0] || {};
    const zone = ZONES[mf(node, 'zone')] || null;
    // 会場限定：テーブルに置いた商品、またはタグ limited の商品
    const limited = zone === 'island' || (node.tags || []).includes('limited');
    const qty = typeof v.quantityAvailable === 'number' ? v.quantityAvailable : null;
    const stock = v.availableForSale === false ? 0 : qty != null && qty > 0 ? qty : 99;
    return {
      id: node.handle,
      variantId: v.id,
      name: node.title,
      desc: descText(node.descriptionHtml, node.description),
      spec: '',
      price: Math.round(Number(v.price?.amount || 0)),
      stock,
      limited,
      limit: toInt(mf(node, 'purchase_limit')) || undefined,
      isNew: (node.tags || []).some((t) => t.toLowerCase() === 'new'),
      character: '',
      category: slug(node.productType),
      categoryName: node.productType || 'その他',
      image: node.featuredImage?.url || null,
      shape: SIZES[mf(node, 'size')] || 'mug',
      display: zone,
      order: toInt(mf(node, 'order')) ?? 1000 + i,
    };
  }

  /**
   * イベントで選んだコレクションの商品を読み込む（window.PRODUCTS）
   * イベントの設定（内装・棚の配置など）は、このサイトのサーバーから読む（js/source.js）
   */
  async function load(collection) {
    if (!enabled) return;
    const vars = { collection: collection || cfg.collection || 'popup' };
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
  }

  async function checkout(lines) {
    const json = await gql(`
      mutation CreateCart($input: CartInput!) {
        cartCreate(input: $input) { cart { id checkoutUrl } userErrors { field message } }
      }`, {
      input: {
        lines: lines.map((l) => ({ merchandiseId: l.variantId, quantity: l.quantity })),
      },
    });
    const r = json.data?.cartCreate;
    if (!r?.cart?.checkoutUrl) throw new Error(r?.userErrors?.map((e) => e.message).join(' / ') || 'cartCreate failed');
    return { url: r.cart.checkoutUrl, cartId: r.cart.id };
  }

  /**
   * お会計（Shopify のカート）がまだ残っているか。注文が完了したカートは Shopify から消えるので null が返る
   * → 'open'（まだ注文していない）／'gone'（注文が完了した、または期限切れ）／'unknown'（通信できなかった）
   */
  async function cartState(cartId) {
    try {
      const json = await gql(`query CartState($id: ID!) { cart(id: $id) { id } }`, { id: cartId });
      if (json.errors?.length) return 'unknown';
      return json.data?.cart ? 'open' : 'gone';
    } catch { return 'unknown'; }
  }

  window.ShopifyData = { enabled, load, checkout, cartState };
})();
