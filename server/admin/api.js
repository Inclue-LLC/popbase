/*
 * 管理画面の API
 *   POST /admin/api/login     { user, password }
 *   POST /admin/api/logout
 *   GET  /admin/api/session   ログイン中のスタッフ・保存先
 *   GET  /admin/api/state     下書き・公開中・履歴・（Shopify なら）商品一覧
 *   PUT  /admin/api/draft     { event, layout, rev } 下書きを保存
 *   POST /admin/api/publish   { rev } 下書きを公開
 *   POST /admin/api/discard   下書きを捨てて公開中に戻す
 *   POST /admin/api/upload    画像（PNG / JPEG / WebP、8MB まで）
 * 公開用
 *   GET  /api/published       公開中のイベント設定と棚の配置（サイトが読む）
 *   GET  /uploads/...         アップロードした画像（ローカル保存のとき）
 */
const fs = require('fs');
const path = require('path');
const auth = require('./auth');
const { InputError } = require('./fields');
const local = require('./store-local');
const shopify = require('./store-shopify');

const store = shopify.enabled ? shopify : local;

function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req) {
  const buf = await readBody(req, 200 * 1024);
  try { return JSON.parse(buf.toString('utf8') || '{}'); } catch { throw new InputError('json'); }
}

const clientIp = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;

// 画像の種類をファイルの中身で判定（拡張子や Content-Type は信用しない）
function sniffImage(buf) {
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ['png', 'image/png'];
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ['jpg', 'image/jpeg'];
  if (buf.length > 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return ['webp', 'image/webp'];
  return null;
}

/** 別サイトからの書き込み（CSRF）を防ぐ：独自ヘッダー必須＋ Origin が同じサイトか */
function sameOrigin(req) {
  if (req.headers['x-haneul-admin'] !== '1') return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

async function handle(req, res, urlPath) {
  /* ---------- 公開用 ---------- */
  if (urlPath === '/api/published' && req.method === 'GET') {
    try { return json(res, 200, await store.getPublished()); } catch (e) {
      console.error(e);
      return json(res, 502, { error: 'unavailable' });
    }
  }
  if (urlPath.startsWith('/uploads/') && req.method === 'GET') {
    const name = path.basename(urlPath);
    const file = path.join(local.uploadsDir, name);
    const ext = path.extname(name).slice(1);
    const mime = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[ext];
    if (!mime || !/^[a-f0-9]{24}\.(png|jpg|webp)$/.test(name) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': mime, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' });
    return fs.createReadStream(file).pipe(res);
  }

  /* ---------- 管理画面 ---------- */
  if (!urlPath.startsWith('/admin/api/')) return false;
  const route = urlPath.slice('/admin/api/'.length);
  const ip = clientIp(req);

  if (req.method !== 'GET' && !sameOrigin(req)) return json(res, 403, { error: 'forbidden' });

  try {
    if (route === 'login' && req.method === 'POST') {
      if (!loginAllowedOrTell(res, ip)) return true;
      const { user, password } = await readJson(req);
      if (typeof user !== 'string' || !auth.verify(user, password)) {
        auth.loginFailed(ip);
        return json(res, 401, { error: 'IDまたはパスワードが違います' });
      }
      auth.loginSucceeded(ip);
      return json(res, 200, { user }, { 'set-cookie': auth.sessionCookie(user, req) });
    }
    if (route === 'logout' && req.method === 'POST') {
      return json(res, 200, { ok: true }, { 'set-cookie': auth.clearCookie() });
    }

    const user = auth.currentUser(req);
    if (!user) return json(res, 401, { error: 'ログインしてください', needsSetup: auth.readUsers().length === 0 });

    if (route === 'session' && req.method === 'GET') return json(res, 200, { user, mode: store.mode, storage: store.label });
    if (route === 'state' && req.method === 'GET') return json(res, 200, await store.getState());
    if (route === 'draft' && req.method === 'PUT') {
      const body = await readJson(req);
      return json(res, 200, await store.saveDraft(body, user));
    }
    if (route === 'publish' && req.method === 'POST') {
      const { rev } = await readJson(req);
      const pub = await store.publish(user, rev);
      // 会期・営業時間をすぐ入店管理に反映
      try { require('../visit').setSchedule((await store.getPublished()).event || {}); } catch (e) { console.error(e); }
      console.log(`[admin] ${user} が公開しました (${pub.publishedAt})`);
      return json(res, 200, pub);
    }
    if (route === 'discard' && req.method === 'POST') return json(res, 200, await store.discard(user));
    if (route === 'upload' && req.method === 'POST') {
      const buf = await readBody(req, 8 * 1024 * 1024);
      const kind = sniffImage(buf);
      if (!kind) return json(res, 400, { error: 'PNG・JPEG・WebP の画像を選んでください' });
      return json(res, 200, await store.upload(buf, kind[0], kind[1]));
    }
    return json(res, 404, { error: 'not found' });
  } catch (e) {
    if (e instanceof InputError) return json(res, 400, { error: `入力内容を確認してください（${e.message}）` });
    if (e instanceof store.Conflict) return json(res, 409, { error: '他のスタッフが先に変更を保存しました。最新の内容を読み込み直します' });
    if (e.status === 413) return json(res, 413, { error: 'ファイルが大きすぎます（8MB まで）' });
    console.error('[admin]', e);
    return json(res, 502, { error: e.message || '保存に失敗しました' });
  }
}

function loginAllowedOrTell(res, ip) {
  if (auth.loginAllowed(ip)) return true;
  json(res, 429, { error: 'ログインの失敗が続いたため、15分ほど待ってからお試しください' });
  return false;
}

module.exports = { handle, store };
