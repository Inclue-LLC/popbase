/*
 * Shopify Admin API のアクセストークン
 * --------------------------------------------------
 * 2 つの方法に対応しています（どちらかを Render などの環境変数に設定）。
 *
 * A. Dev Dashboard で作ったアプリ（2026年以降の標準）
 *      SHOPIFY_CLIENT_ID      アプリの「クライアント ID」
 *      SHOPIFY_CLIENT_SECRET  アプリの「シークレット」
 *    サーバーが必要なときに Shopify からトークンを受け取ります（有効期限つき。切れる前に自動で取り直す）。
 *
 * B. 以前の方法（ストアの管理画面で作ったカスタムアプリ）
 *      SHOPIFY_ADMIN_TOKEN    shpat_ で始まるトークン（期限なし）
 *
 * どちらも、ストアのほぼすべてを操作できる鍵です。ファイルやチャットには書かず、環境変数にだけ設定してください。
 */
const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const STATIC_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;

const configured = !!(DOMAIN && (STATIC_TOKEN || (CLIENT_ID && CLIENT_SECRET)));
const method = STATIC_TOKEN ? 'token' : CLIENT_ID && CLIENT_SECRET ? 'client' : null;

let cached = null; // { token, expiresAt }
let pending = null;

async function fetchClientToken() {
  // テスト用に URL を差し替えられるようにしている
  const res = await fetch(process.env.SHOPIFY_TOKEN_URL || `https://${DOMAIN}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
  });
  const text = await res.text();
  let json = {};
  try { json = JSON.parse(text); } catch { /* noop */ }
  if (!res.ok || !json.access_token) {
    const why = json.error_description || json.error || json.errors || text.slice(0, 200);
    throw new Error(`Shopify のアクセストークンを取得できませんでした（${res.status}: ${typeof why === 'string' ? why : JSON.stringify(why)}）。` +
      'クライアント ID・シークレット、アプリがこのストアにインストールされているかを確認してください');
  }
  const seconds = Number(json.expires_in) || 24 * 3600;
  // 期限の 10 分前（短い場合は半分）で取り直す
  const margin = Math.min(600, seconds / 2);
  cached = { token: json.access_token, expiresAt: Date.now() + (seconds - margin) * 1000 };
  return cached.token;
}

/** 使えるアクセストークンを返す */
async function getToken() {
  if (method === 'token') return STATIC_TOKEN;
  if (method !== 'client') return '';
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  if (!pending) pending = fetchClientToken().finally(() => { pending = null; });
  return pending;
}

/** トークンが使えなくなった（401）ときに捨てる */
function invalidate() { cached = null; }

module.exports = { DOMAIN, configured, method, getToken, invalidate };
