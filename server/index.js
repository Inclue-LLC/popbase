/*
 * POP BASE（バーチャルポップアップショップ）— サーバー
 * --------------------------------------------------
 * 1. サイト（静的ファイル）の配信
 * 2. 同時接続（WebSocket /ws）：同じ店内にいる他のお客さんのアバターを中継
 * 3. 店内管理画面（/admin）と、その API（server/admin/）
 *
 * 入場制限・待機列・お買い物時間・同時接続の中身は server/visit.js にあります。
 *
 * 環境変数:
 *   PORT              待ち受けポート（既定 8080）
 *   MAX_VISITORS      店内に同時に入れる人数（既定 50）。超えたら待機列
 *   VISIT_MINUTES     混雑中（待っている人がいるとき）の1人あたりのお買い物時間（既定 30）
 *   WARN_MINUTES      終了何分前からタイマーを出すか（既定 5）
 *   RECONNECT_SECONDS 再読み込み・通信の切れ目で、席や順番を預かる秒数（既定 30）
 *   MAX_PER_IP        同じIPからの同時接続数の上限（既定 6）
 *   TEST_BOTS         混雑テスト用：このサーバーの中から、自動で歩き回るお客さん（ボット）をこの人数入れる（試すときだけ。終わったら消す）
 *   ALLOWED_ORIGINS   接続を許可するサイトのURL（カンマ区切り。空なら制限なし）
 *   CLIENT_IP_HEADER / TRUST_PROXY_HOPS  接続元 IP の読み方（server/client-ip.js）
 *   CONTACT_TO / SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / CONTACT_FROM  お問い合わせフォームのメール送信（server/contact.js）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const adminApi = require('./admin/api');
const visit = require('./visit');
const { clientIp } = require('./client-ip');
const contact = require('./contact');

const PORT = Number(process.env.PORT) || 8080;
const MAX_PER_IP = Number(process.env.MAX_PER_IP) || 6;
const TEST_BOTS = Math.max(0, Math.min(200, Number(process.env.TEST_BOTS) || 0));
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const ROOT = path.resolve(__dirname, '..');

/* ---------- 静的ファイル ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8', '.glb': 'model/gltf-binary',
};
const PUBLIC_DIRS = ['css', 'js', 'vendor', 'images', 'admin'];

function serveStatic(req, res) {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { urlPath = '/'; }
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
  if (urlPath === '/admin' || urlPath === '/admin/') urlPath = '/admin/index.html';
  if (urlPath === '/creators' || urlPath === '/creators/') urlPath = '/creators.html'; // クリエイター向けの出品案内
  if (urlPath === '/healthz') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(stats())); }

  const filePath = path.resolve(ROOT, `.${urlPath}`);
  const rel = path.relative(ROOT, filePath);
  const top = rel.split(path.sep)[0];
  const allowed = !rel.startsWith('..') && (rel === 'index.html' || rel === 'creators.html' || PUBLIC_DIRS.includes(top));
  if (!allowed) { res.writeHead(404); return res.end('Not found'); }

  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {
      'content-type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'cache-control': top === 'vendor' || top === 'images' ? 'public, max-age=86400' : 'no-cache',
      'x-content-type-options': 'nosniff',
      // 管理画面は他のサイトの枠（iframe）に埋め込ませない
      ...(top === 'admin' ? { 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'" } : {}),
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const ipCount = new Map();
const stats = () => visit.stats();

/* ---------- WebSocket ---------- */
const server = http.createServer(async (req, res) => {
  let urlPath = '/';
  try { urlPath = new URL(req.url, 'http://x').pathname; } catch { /* noop */ }
  // 公開後の確認用：サーバーが判定したあなたの接続元（server/client-ip.js）
  if (urlPath === '/api/ip') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ ip: clientIp(req) }));
  }
  // お問い合わせフォーム（server/contact.js）
  if (urlPath === '/api/contact') {
    try { return await contact.handle(req, res); } catch (e) {
      console.error(e);
      if (!res.headersSent) { res.writeHead(500); res.end(); }
      return;
    }
  }
  if (urlPath.startsWith('/admin/api/') || urlPath === '/api/published' || urlPath === '/api/policies' || urlPath.startsWith('/uploads/')) {
    try {
      if ((await adminApi.handle(req, res, urlPath)) !== false) return;
    } catch (e) {
      console.error(e);
      if (!res.headersSent) { res.writeHead(500); res.end(); }
      return;
    }
  }
  serveStatic(req, res);
});
/*
 * 接続してよいサイトか（Origin）。このサーバー自身のアドレス（popbase.jp でも Render の仮のアドレスでも）は常に許可し、
 * それ以外は ALLOWED_ORIGINS にあるものだけ。断るときは接続の時点で断る（つないでから切ると、ブラウザがつなぎ直しを繰り返すため）
 */
function originAllowed(origin, host) {
  if (!ALLOWED_ORIGINS.length) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try { return !!host && new URL(origin).host === host; } catch { return false; }
}
const wss = new WebSocketServer({
  server, path: '/ws', maxPayload: 1024,
  verifyClient: ({ origin, req }) => originAllowed(origin || '', req.headers.host),
});

wss.on('connection', (ws, req) => {
  const ip = clientIp(req);
  // 混雑テストのボット（このサーバー自身からの接続）は、接続数の制限から外す
  const isTestBot = TEST_BOTS > 0 && !req.headers['x-forwarded-for'] && /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(req.socket.remoteAddress || '');
  if (!isTestBot && (ipCount.get(ip) || 0) >= MAX_PER_IP) return ws.close(1008, 'too many');
  ipCount.set(ip, (ipCount.get(ip) || 0) + 1);
  ws.on('close', () => ipCount.set(ip, Math.max(0, (ipCount.get(ip) || 1) - 1)));

  visit.onConnection(ws);
});

// 切断を検知するための ping
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);
wss.on('connection', (ws) => { ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; }); });

// 公開中の会期・営業時間をサーバーの入店管理に反映（起動時と30秒ごと。管理画面で公開したときはすぐ）
async function refreshSchedule() {
  try { visit.setSchedule((await adminApi.store.getPublished()).event || {}); } catch (e) { console.error('[schedule]', e.message); }
}
refreshSchedule();
setInterval(refreshSchedule, 30000).unref?.();

server.listen(PORT, () => {
  console.log(`POP BASE: http://localhost:${PORT}  （同時接続: ws://localhost:${PORT}/ws）`);
  console.log(`入場制限: ${visit.CAP} 人まで。混雑中のお買い物時間 ${visit.VISIT_MS / 60e3} 分（終了 ${visit.WARN_MS / 60e3} 分前からタイマー表示）`);
  console.log(`店内管理画面: http://localhost:${PORT}/admin  （保存先: ${adminApi.store.label}）`);
  // 混雑テスト：TEST_BOTS 人のボットを入れる（scripts/crowd.js を、このサーバーに向けて起動）
  if (TEST_BOTS) {
    console.log(`[混雑テスト] ボット ${TEST_BOTS} 人を入れます。終わったら環境変数 TEST_BOTS を消してください`);
    const { spawn } = require('child_process');
    setTimeout(() => {
      const bots = spawn(process.execPath, [require('path').join(__dirname, '..', 'scripts', 'crowd.js'), String(TEST_BOTS), '--url', `http://127.0.0.1:${PORT}`], { stdio: 'inherit' });
      process.on('exit', () => bots.kill());
    }, 3000);
  }
  const auth = require('./admin/auth');
  // 最初のアカウント：アカウントが1つもなく、ADMIN_INITIAL_USER / ADMIN_INITIAL_PASSWORD があれば作る
  // （コマンドを打てない公開サービス向け。作ったあとは、この2つの環境変数を消してください）
  const iu = (process.env.ADMIN_INITIAL_USER || '').trim();
  const ipw = process.env.ADMIN_INITIAL_PASSWORD || '';
  if (!auth.readUsers().length && iu) {
    if (!/^[\w.@-]{2,40}$/.test(iu) || ipw.length < 10) {
      console.log('  ※ ADMIN_INITIAL_USER は半角英数字（2〜40文字）、ADMIN_INITIAL_PASSWORD は10文字以上にしてください');
    } else {
      auth.setUser(iu, ipw);
      console.log(`  管理画面のアカウント ${iu} を作成しました。環境変数 ADMIN_INITIAL_PASSWORD は消してください`);
    }
  } else if (auth.readUsers().length && ipw) {
    console.log('  ※ アカウントはもうあります。環境変数 ADMIN_INITIAL_USER / ADMIN_INITIAL_PASSWORD は消してください（使われません）');
  }
  if (!auth.readUsers().length) {
    console.log('  ※ 管理画面のアカウントがまだありません。別のターミナルで npm run admin:user -- <名前> を実行して作成してください');
  }
});
