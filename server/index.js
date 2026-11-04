/*
 * STUDIO HANEUL Virtual Pop-up — サーバー
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
 *   ALLOWED_ORIGINS   接続を許可するサイトのURL（カンマ区切り。空なら制限なし）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const adminApi = require('./admin/api');
const visit = require('./visit');

const PORT = Number(process.env.PORT) || 8080;
const MAX_PER_IP = Number(process.env.MAX_PER_IP) || 6;
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
  if (urlPath === '/healthz') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(stats())); }

  const filePath = path.resolve(ROOT, `.${urlPath}`);
  const rel = path.relative(ROOT, filePath);
  const top = rel.split(path.sep)[0];
  const allowed = !rel.startsWith('..') && (rel === 'index.html' || PUBLIC_DIRS.includes(top));
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
  if (urlPath.startsWith('/admin/api/') || urlPath === '/api/published' || urlPath.startsWith('/uploads/')) {
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
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1024 });

wss.on('connection', (ws, req) => {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.length && !ALLOWED_ORIGINS.includes(origin)) return ws.close(1008, 'origin');

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
  if ((ipCount.get(ip) || 0) >= MAX_PER_IP) return ws.close(1008, 'too many');
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
  console.log(`STUDIO HANEUL pop-up: http://localhost:${PORT}  （同時接続: ws://localhost:${PORT}/ws）`);
  console.log(`入場制限: ${visit.CAP} 人まで。混雑中のお買い物時間 ${visit.VISIT_MS / 60e3} 分（終了 ${visit.WARN_MS / 60e3} 分前からタイマー表示）`);
  console.log(`店内管理画面: http://localhost:${PORT}/admin  （保存先: ${adminApi.store.label}）`);
  if (!require('./admin/auth').readUsers().length) {
    console.log('  ※ 管理画面のアカウントがまだありません。別のターミナルで npm run admin:user -- <名前> を実行して作成してください');
  }
});
