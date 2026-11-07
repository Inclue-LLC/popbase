/*
 * 管理画面の API
 *   POST /admin/api/login     { user, password }
 *   POST /admin/api/logout
 *   GET  /admin/api/session   ログイン中のスタッフ・保存先
 *   GET  /admin/api/events            イベントの一覧（どれがお客さんに出ているか）
 *   POST /admin/api/events            { title, copyFrom? } イベントを作る（copyFrom で複製）
 *   DELETE /admin/api/events?event=ID イベントを削除
 *   GET  /admin/api/state?event=ID    下書き・公開済み・履歴・（Shopify なら）商品一覧
 *   PUT  /admin/api/draft?event=ID    { event, layout, rev } 下書きを保存
 *   POST /admin/api/publish?event=ID  { rev } 下書きを公開
 *   POST /admin/api/discard?event=ID  下書きを捨てて公開済みの内容に戻す
 *   GET  /admin/api/collections       Shopify のコレクションの一覧
 *   GET  /admin/api/products?collection=HANDLE  コレクションの商品（Shopify）
 *   GET  /admin/api/preview?event=ID  下書きをサイトで確認する用
 *   POST /admin/api/upload    画像（PNG / JPEG / WebP、8MB まで）
 * 出品者まわり（運営 admin と 出品者 seller。出品者は担当のイベントだけ。server/admin/seller.js）
 *   POST /admin/api/review?event=ID      出品者：運営に「サイトへの反映」の確認を依頼 { note }
 *   GET  /admin/api/users                運営：アカウントの一覧
 *   POST /admin/api/users                運営：アカウントを作る・変える { name, role, events }（新しいアカウントには、パスワード設定用のリンクを発行して返す）
 *   POST /admin/api/setup-link?name=NAME 運営：パスワード設定（再設定）用のリンクを発行
 *   GET  /admin/api/setup?token=TOKEN    パスワード設定用のリンクの確認（ログイン不要）→ { name }
 *   POST /admin/api/setup                リンクからパスワードを決める（ログイン不要）{ token, password } → ログイン
 *   POST /admin/api/password             自分のパスワードを変える { current, password }
 *   DELETE /admin/api/users?name=NAME    運営：アカウントを削除
 *   GET  /admin/api/orders?event=ID      このイベントの商品が入った注文（Shopify）
 *   POST /admin/api/product-tags         運営：商品の NEW・会場限定（Shopify のタグ new / limited）{ handle, isNew?, limited? }
 *   GET  /admin/api/submissions?event=ID 商品の申請の一覧
 *   POST /admin/api/submissions?event=ID 商品を申請 { name, price, stock, description, spec, size, limit, images }
 *   PUT  /admin/api/submissions?event=ID&id=ID   直す（運営は { status, note } も）
 *   DELETE /admin/api/submissions?event=ID&id=ID
 *   POST /admin/api/submission-image     申請の画像（PNG / JPEG / WebP、8MB まで）→ { file }
 *   GET  /admin/api/submission-image?event=ID&file=NAME   申請の画像
 *   GET  /admin/api/submissions.zip?event=ID[&pending=1]   運営：画像と一覧（CSV）をまとめてダウンロード
 * 公開用
 *   GET  /api/published       お客さんに出すイベント（会期で自動）の設定と棚の配置（サイトが読む）
 *   GET  /uploads/...         アップロードした画像（ローカル保存のとき）
 */
const fs = require('fs');
const path = require('path');
const auth = require('./auth');
const { InputError, missingRequired, SELLER_LOCKED } = require('./fields');
const seller = require('./seller');
const local = require('./store-local');
const ev = require('./events');
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

const { clientIp } = require('../client-ip');
const contact = require('../contact');

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

// 必須項目（Shopify につないでいるときは、店内に並べるコレクションも必須）
function missingFor(event) {
  const missing = missingRequired(event || {});
  if (store.mode === 'shopify' && !event?.collection) missing.push('Shopify のコレクション');
  return missing;
}

async function handle(req, res, urlPath) {
  /* ---------- 公開用 ---------- */
  if (urlPath === '/api/published' && req.method === 'GET') {
    try {
      // 混雑中のお買い物時間（ご案内の「混雑時の入店」に出す）
      const v = require('../visit');
      return json(res, 200, { ...(await store.getPublished()), visit: { minutes: v.VISIT_MS / 60e3, warnMinutes: v.WARN_MS / 60e3 } });
    } catch (e) {
      console.error(e);
      return json(res, 502, { error: 'unavailable' });
    }
  }
  if (urlPath === '/api/policies' && req.method === 'GET') {
    try { return json(res, 200, { policies: await store.policies() }); } catch (e) {
      console.error('[policies]', e.message);
      return json(res, 200, { policies: [] }); // 権限がないときなど：サイトは Shopify のページへのリンクにする
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
    // パスワード設定用のリンク（ログイン前）
    if (route === 'setup' && req.method === 'GET') {
      const u = auth.findSetup(new URL(req.url, 'http://x').searchParams.get('token'));
      return u ? json(res, 200, { name: u.name }) : json(res, 404, { error: 'このリンクは使えません（有効期限切れ、または設定済み）。運営に新しいリンクの発行を依頼してください' });
    }
    if (route === 'setup' && req.method === 'POST') {
      if (!loginAllowedOrTell(res, ip)) return true;
      const { token, password } = await readJson(req);
      if (typeof password !== 'string' || password.length < 10 || password.length > 200) throw new InputError('パスワードは10文字以上にしてください');
      const name = auth.completeSetup(token, password);
      if (!name) { auth.loginFailed(ip); return json(res, 404, { error: 'このリンクは使えません（有効期限切れ、または設定済み）。運営に新しいリンクの発行を依頼してください' }); }
      auth.loginSucceeded(ip);
      console.log(`[admin] ${name} がパスワードを設定しました`);
      return json(res, 200, { user: name }, { 'set-cookie': auth.sessionCookie(name, req) });
    }
    if (route === 'logout' && req.method === 'POST') {
      return json(res, 200, { ok: true }, { 'set-cookie': auth.clearCookie() });
    }

    const user = auth.currentUser(req);
    if (!user) return json(res, 401, { error: 'ログインしてください', needsSetup: auth.readUsers().length === 0 });

    const me = auth.getUser(user);
    const isAdmin = me.role === 'admin';
    if (route === 'session' && req.method === 'GET') return json(res, 200, { user, role: me.role, events: me.events, mode: store.mode, storage: store.label });
    const q = new URL(req.url, 'http://x').searchParams;
    const id = q.get('event') || '';
    // 出品者は担当のイベントだけ。運営だけができる操作は断る
    const own = (eventId) => isAdmin || me.events.includes(eventId);
    const SELLER_ROUTES = new Set(['password:POST', 'events:GET', 'state:GET', 'draft:PUT', 'preview:GET', 'upload:POST', 'products:GET', 'collections:GET',
      'review:POST', 'orders:GET', 'submissions:GET', 'submissions:POST', 'submissions:PUT', 'submissions:DELETE', 'submission-image:GET', 'submission-image:POST', 'discard:POST']);
    if (!isAdmin) {
      if (!SELLER_ROUTES.has(`${route}:${req.method}`)) return json(res, 403, { error: 'この操作は運営のアカウントでのみできます' });
      if (id && !own(id)) return json(res, 403, { error: '担当していないイベントです' });
    }

    if (route === 'events' && req.method === 'GET') {
      const all = await store.listEvents();
      const rv = seller.reviews();
      const subs = (eid) => seller.listSubmissions(eid).filter((x) => x.status === 'pending').length;
      const list = all.filter((x) => own(x.id)).map((x) => ({ ...x, review: rv[x.id] || null, pendingSubmissions: subs(x.id) }));
      return json(res, 200, { events: list });
    }
    if (route === 'events' && req.method === 'POST') {
      const { title, copyFrom } = await readJson(req);
      if (typeof title !== 'string' || !title.trim() || title.length > 60) throw new InputError('イベント名を入れてください');
      const r = await store.createEvent({ title: title.trim(), copyFrom: copyFrom || null }, user);
      console.log(`[admin] ${user} がイベント ${r.id} を作成しました`);
      return json(res, 200, r);
    }
    if (route === 'events' && req.method === 'DELETE') {
      const active = await store.getPublished();
      if (active.id === id) return json(res, 400, { error: 'お客さんに表示中のイベントは削除できません' });
      await store.deleteEvent(id);
      console.log(`[admin] ${user} がイベント ${id} を削除しました`);
      return json(res, 200, { ok: true });
    }
    if (route === 'collections' && req.method === 'GET') {
      return json(res, 200, { collections: store.collections ? await store.collections() : [] });
    }
    if (route === 'products' && req.method === 'GET') {
      const c = q.get('collection') || '';
      if (!store.products || !/^[a-z0-9][a-z0-9-]{0,254}$/.test(c)) return json(res, 200, { products: null });
      // 出品者は、担当のイベントのコレクションの商品だけ
      if (!isAdmin) {
        const mine = (await store.listEvents()).filter((x) => own(x.id)).map((x) => x.collection);
        if (!mine.includes(c)) return json(res, 403, { error: '担当していないコレクションです' });
      }
      return json(res, 200, { products: await store.products(c) });
    }
    if (route === 'preview' && req.method === 'GET') return json(res, 200, await store.getDraft(id));

    if (route === 'state' && req.method === 'GET') return json(res, 200, await store.getState(id));
    if (route === 'draft' && req.method === 'PUT') {
      const body = await readJson(req);
      // 会期を変えたときは、ほかのイベントの会期と重ならないこと（1つの期間に開けるイベントは1つ）
      const next = body?.event || {};
      const prev = (await store.getState(id)).draft.event || {};
      // 出品者は会期・送料などを変えられない（送られてきても、いまの値のままにする）
      if (!isAdmin) for (const k of SELLER_LOCKED) { if (k in prev) next[k] = prev[k]; else delete next[k]; }
      if (next.open_at !== prev.open_at || next.close_at !== prev.close_at) {
        const o = ev.findOverlap(await store.listEvents(), id, next.open_at, next.close_at);
        if (o) return json(res, 409, { error: ev.overlapMessage(o) });
      }
      return json(res, 200, await store.saveDraft(id, body, user));
    }
    if (route === 'publish' && req.method === 'POST') {
      const { rev } = await readJson(req);
      // 必須項目が空欄なら公開しない
      const missing = missingFor((await store.getState(id)).draft.event);
      if (missing.length) return json(res, 400, { error: `必須項目が未入力です：${missing.join('・')}` });
      const d = (await store.getState(id)).draft.event || {};
      const o = ev.findOverlap(await store.listEvents(), id, d.open_at, d.close_at);
      if (o) return json(res, 409, { error: ev.overlapMessage(o) });
      const pub = await store.publish(id, user, rev);
      // 会期・営業時間をすぐ入店管理に反映（お客さんに出すイベントが変わることもある）
      try { require('../visit').setSchedule((await store.getPublished()).event || {}); } catch (e) { console.error(e); }
      seller.clearReview(id); // 出品者からの確認依頼は、反映した時点で済み
      console.log(`[admin] ${user} がイベント ${id} を公開しました (${pub.publishedAt})`);
      return json(res, 200, pub);
    }
    if (route === 'discard' && req.method === 'POST') return json(res, 200, await store.discard(id, user));
    if (route === 'upload' && req.method === 'POST') {
      const buf = await readBody(req, 8 * 1024 * 1024);
      const kind = sniffImage(buf);
      if (!kind) return json(res, 400, { error: 'PNG・JPEG・WebP の画像を選んでください' });
      return json(res, 200, await store.upload(buf, kind[0], kind[1]));
    }

    /* ---------- 出品者まわり ---------- */
    if (route === 'review' && req.method === 'POST') {
      const { note } = await readJson(req);
      await store.getState(id); // イベントがあるか
      const r = seller.requestReview(id, user, note);
      const title = (await store.listEvents()).find((x) => x.id === id)?.title || id;
      contact.notify(`「${title}」の反映の確認依頼`, `${user} さんから、イベント「${title}」をサイトに反映する確認の依頼がありました。\n\n${r.note ? `メッセージ：\n${r.note}\n\n` : ''}管理画面でイベントを開き、内容を確認して「サイトに反映する」を押してください。`);
      return json(res, 200, { review: r });
    }
    if (route === 'password' && req.method === 'POST') {
      const { current, password } = await readJson(req);
      if (!loginAllowedOrTell(res, ip)) return true;
      if (!auth.verify(user, current)) { auth.loginFailed(ip); return json(res, 400, { error: 'いまのパスワードが違います' }); }
      if (typeof password !== 'string' || password.length < 10 || password.length > 200) throw new InputError('新しいパスワードは10文字以上にしてください');
      auth.setUser(user, password, {});
      console.log(`[admin] ${user} がパスワードを変更しました`);
      return json(res, 200, { ok: true });
    }
    const setupUrl = (token) => {
      const proto = req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http');
      return `${proto}://${req.headers.host}/admin/#/setup/${token}`;
    };
    if (route === 'setup-link' && req.method === 'POST') {
      const name = q.get('name') || '';
      const r = auth.issueSetup(name);
      if (!r) return json(res, 404, { error: 'アカウントが見つかりません' });
      console.log(`[admin] ${user} が ${name} のパスワード設定用リンクを発行しました`);
      return json(res, 200, { url: setupUrl(r.token), expiresAt: r.expiresAt, user: auth.getUser(name) });
    }
    if (route === 'users') {
      if (req.method === 'GET') return json(res, 200, { users: auth.listUsers() });
      if (req.method === 'POST') {
        const { name, role, events } = await readJson(req);
        const password = null; // パスワードはご本人がリンクから決める
        if (typeof name !== 'string' || !/^[\w.@-]{2,40}$/.test(name)) throw new InputError('ID は半角英数字・. @ - _ の2〜40文字');
        const exists = !!auth.getUser(name);
        if (!auth.ROLES.includes(role)) throw new InputError('権限');
        if (name === user && role !== 'admin') throw new InputError('自分のアカウントを出品者にはできません');
        const ids = new Set((await store.listEvents()).map((x) => x.id));
        const evs = Array.isArray(events) ? events.filter((x) => ids.has(x)) : [];
        auth.setUser(name, password, { role, events: evs });
        console.log(`[admin] ${user} がアカウント ${name} を${exists ? '変更' : '作成'}しました（${role}）`);
        // 新しいアカウントには、パスワード設定用のリンクを発行する
        const link = exists ? null : auth.issueSetup(name);
        return json(res, 200, { user: auth.getUser(name), ...(link ? { url: setupUrl(link.token), expiresAt: link.expiresAt } : {}) });
      }
      if (req.method === 'DELETE') {
        const name = q.get('name') || '';
        if (name === user) throw new InputError('自分のアカウントは削除できません');
        if (!auth.deleteUser(name)) return json(res, 404, { error: 'アカウントが見つかりません' });
        console.log(`[admin] ${user} がアカウント ${name} を削除しました`);
        return json(res, 200, { ok: true });
      }
    }
    if (route === 'product-tags' && req.method === 'POST') {
      if (!store.setProductTags) return json(res, 400, { error: 'NEW・会場限定の設定は、Shopify につないでいるときにできます' });
      const { handle, isNew, limited } = await readJson(req);
      if (typeof handle !== 'string' || !/^[a-z0-9][a-z0-9-]{0,254}$/.test(handle)) throw new InputError('商品');
      const r = await store.setProductTags(handle, { isNew: typeof isNew === 'boolean' ? isNew : undefined, limited: typeof limited === 'boolean' ? limited : undefined });
      console.log(`[admin] ${user} が商品 ${handle} のタグを変更しました（NEW: ${r.isNew} / 会場限定: ${r.limited}）`);
      return json(res, 200, r);
    }
    if (route === 'orders' && req.method === 'GET') {
      const d = (await store.getState(id)).draft.event || {};
      const p = (await store.getState(id)).published?.event || {};
      const col = p.collection || d.collection;
      if (!store.orders) return json(res, 200, { orders: null, reason: 'local' });
      if (!col) return json(res, 200, { orders: null, reason: 'no_collection' });
      // 会期の始まり（日本時間）の1日前から。会期未設定なら直近60日
      const open = require('../../js/schedule.js').parseDateTime(p.open_at || d.open_at);
      const since = open ? new Date(open - 86400e3).toISOString() : null;
      try {
        return json(res, 200, { orders: await store.orders(col, since), collection: col });
      } catch (e) {
        console.error('[orders]', e.message);
        const denied = /access|scope|denied|protected customer/i.test(e.message);
        return json(res, 200, { orders: null, reason: denied ? 'scope' : 'error', message: e.message });
      }
    }
    if (route === 'submissions') {
      if (req.method !== 'POST') await store.getState(id); // イベントがあるか
      if (req.method === 'GET') return json(res, 200, { items: seller.listSubmissions(id), status: seller.STATUS });
      if (req.method === 'POST') {
        await store.getState(id);
        const item = seller.addSubmission(id, await readJson(req), user);
        const title = (await store.listEvents()).find((x) => x.id === id)?.title || id;
        if (!isAdmin) contact.notify(`「${title}」に商品の申請`, `${user} さんから、イベント「${title}」に商品の申請がありました。\n\n商品名：${item.name}\n価格：${item.price}円（税込）\n在庫数：${item.stock}\n\n管理画面でイベントを開き、「商品の申請」タブから画像をダウンロードして Shopify に登録してください。`);
        return json(res, 200, { item });
      }
      if (req.method === 'PUT') return json(res, 200, { item: seller.updateSubmission(id, q.get('id'), await readJson(req), user, isAdmin) });
      if (req.method === 'DELETE') { seller.deleteSubmission(id, q.get('id'), isAdmin); return json(res, 200, { ok: true }); }
    }
    if (route === 'submission-image' && req.method === 'POST') {
      const buf = await readBody(req, 8 * 1024 * 1024);
      const kind = sniffImage(buf);
      if (!kind) return json(res, 400, { error: 'PNG・JPEG・WebP の画像を選んでください' });
      return json(res, 200, { file: seller.saveImage(buf, kind[0]) });
    }
    if (route === 'submission-image' && req.method === 'GET') {
      const p = seller.imagePath(id, q.get('file'));
      if (!p) { res.writeHead(404); res.end(); return true; }
      const ext = path.extname(p).slice(1);
      res.writeHead(200, {
        'content-type': { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[ext], 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff',
        ...(q.get('download') ? { 'content-disposition': `attachment; filename="${path.basename(p)}"` } : {}),
      });
      fs.createReadStream(p).pipe(res);
      return true;
    }
    if (route === 'submissions.zip' && req.method === 'GET') {
      if (!isAdmin) return json(res, 403, { error: 'この操作は運営のアカウントでのみできます' });
      await store.getState(id);
      const buf = seller.submissionsZip(id, { onlyPending: q.get('pending') === '1' });
      const name = `申請_${id}${q.get('pending') === '1' ? '_申請中' : ''}.zip`;
      res.writeHead(200, { 'content-type': 'application/zip', 'cache-control': 'no-store', 'content-length': buf.length, 'content-disposition': `attachment; filename="submissions.zip"; filename*=UTF-8''${encodeURIComponent(name)}` });
      res.end(buf);
      return true;
    }
    return json(res, 404, { error: 'not found' });
  } catch (e) {
    if (e instanceof seller.SellerError) return json(res, e.status, { error: e.message });
    if (e instanceof InputError) return json(res, e.status || 400, { error: e.status === 404 ? e.message : `入力内容を確認してください（${e.message}）` });
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
