/*
 * STUDIO HANEUL Virtual Pop-up — サーバー
 * --------------------------------------------------
 * 1. サイト（静的ファイル）の配信
 * 2. 同時接続（WebSocket /ws）：同じ店内にいる他のお客さんのアバターを中継
 * 3. 店内管理画面（/admin）と、その API（server/admin/）
 *
 * お客さんが送れるのは「位置・向き・アバターの種類・名前の番号・スタンプの番号」だけです。
 * 自由入力の文字は一切受け付けないので、チャットの荒らし対策は不要です。
 *
 * 環境変数:
 *   PORT            待ち受けポート（既定 8080）
 *   ROOM_CAPACITY   1部屋の最大人数。超えると次の部屋（チャンネル）を自動で作る（既定 30）
 *   MAX_PER_IP      同じIPからの同時接続数の上限（既定 6）
 *   ALLOWED_ORIGINS 接続を許可するサイトのURL（カンマ区切り。空なら制限なし）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const adminApi = require('./admin/api');

const PORT = Number(process.env.PORT) || 8080;
const ROOM_CAPACITY = Number(process.env.ROOM_CAPACITY) || 30;
const MAX_PER_IP = Number(process.env.MAX_PER_IP) || 6;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const ROOT = path.resolve(__dirname, '..');

// クライアント（js/world/avatars.js）と同じ値
const AVATARS = ['haru', 'byeol', 'dalbit', 'gomi'];
// 管理画面で追加したアバターの ID（c_ ＋英数字）。見た目は各お客さんのブラウザが公開中の一覧から探し、
// 一覧にない ID は最初のアバターで表示する
const CUSTOM_AVATAR = /^c_[a-z0-9]{6,16}$/;
const avatarOk = (v) => typeof v === 'string' && (AVATARS.includes(v) || CUSTOM_AVATAR.test(v));
const NAME_COUNT = 12;   // 名前の前半（形容詞）の数
const EMOTE_COUNT = 6;   // スタンプの数
const BOUNDS = 6.8;      // 店内の広さ（±m）

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

/* ---------- 部屋（チャンネル） ---------- */
const rooms = new Map(); // roomId -> Map<clientId, client>
let nextClientId = 1;
let nextRoomId = 1;
const ipCount = new Map();

function pickRoom() {
  for (const [id, members] of rooms) if (members.size < ROOM_CAPACITY) return id;
  const id = nextRoomId++;
  rooms.set(id, new Map());
  return id;
}

function stats() {
  return { rooms: [...rooms].map(([id, m]) => ({ id, people: m.size })), capacity: ROOM_CAPACITY };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const int = (v, max) => (Number.isInteger(v) && v >= 0 && v < max ? v : 0);

function publicState(c) {
  return { id: c.id, avatar: c.avatar, name: c.name, x: c.x, z: c.z, ry: c.ry, m: c.moving };
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(roomId, msg, exceptId) {
  const members = rooms.get(roomId);
  if (!members) return;
  const data = JSON.stringify(msg);
  for (const c of members.values()) if (c.id !== exceptId && c.ws.readyState === c.ws.OPEN) c.ws.send(data);
}

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

  let client = null;
  let tokens = 30; // 簡易レート制限（1秒あたり約20通まで）
  const refill = setInterval(() => { tokens = Math.min(30, tokens + 20); }, 1000);

  ws.on('message', (raw) => {
    if (--tokens < 0) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object') return;

    if (msg.t === 'join' && !client) {
      const roomId = pickRoom();
      client = {
        id: nextClientId++, ws, roomId,
        avatar: avatarOk(msg.avatar) ? msg.avatar : AVATARS[0],
        name: int(msg.name, NAME_COUNT),
        x: clamp(num(msg.x), -BOUNDS, BOUNDS), z: clamp(num(msg.z, 5.5), -BOUNDS, BOUNDS), ry: num(msg.ry), moving: false,
      };
      rooms.get(roomId).set(client.id, client);
      send(ws, { t: 'welcome', id: client.id, room: roomId, capacity: ROOM_CAPACITY,
        peers: [...rooms.get(roomId).values()].filter((c) => c.id !== client.id).map(publicState) });
      broadcast(roomId, { t: 'join', peer: publicState(client) }, client.id);
      return;
    }
    if (!client) return;

    if (msg.t === 'move') {
      client.x = clamp(num(msg.x, client.x), -BOUNDS, BOUNDS);
      client.z = clamp(num(msg.z, client.z), -BOUNDS, BOUNDS);
      client.ry = num(msg.ry, client.ry);
      client.moving = !!msg.m;
      broadcast(client.roomId, { t: 'move', id: client.id, x: client.x, z: client.z, ry: client.ry, m: client.moving }, client.id);
    } else if (msg.t === 'emote') {
      broadcast(client.roomId, { t: 'emote', id: client.id, e: int(msg.e, EMOTE_COUNT) }, client.id);
    } else if (msg.t === 'look') {
      // アバターや名前の変更
      client.avatar = avatarOk(msg.avatar) ? msg.avatar : client.avatar;
      client.name = int(msg.name, NAME_COUNT);
      broadcast(client.roomId, { t: 'look', id: client.id, avatar: client.avatar, name: client.name }, client.id);
    }
  });

  ws.on('close', () => {
    clearInterval(refill);
    ipCount.set(ip, Math.max(0, (ipCount.get(ip) || 1) - 1));
    if (!client) return;
    const members = rooms.get(client.roomId);
    members?.delete(client.id);
    broadcast(client.roomId, { t: 'leave', id: client.id });
    if (members && members.size === 0 && rooms.size > 1) rooms.delete(client.roomId);
  });
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

server.listen(PORT, () => {
  console.log(`STUDIO HANEUL pop-up: http://localhost:${PORT}  (multiplayer: ws://localhost:${PORT}/ws, ${ROOM_CAPACITY} people/room)`);
  console.log(`店内管理画面: http://localhost:${PORT}/admin  （保存先: ${adminApi.store.label}）`);
  if (!require('./admin/auth').readUsers().length) {
    console.log('  ※ 管理画面のアカウントがまだありません。別のターミナルで npm run admin:user -- <名前> を実行して作成してください');
  }
});
