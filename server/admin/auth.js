/*
 * 管理画面のログイン（スタッフごとのアカウント）
 * --------------------------------------------------
 * アカウントは data/users.json に保存（パスワードは scrypt でハッシュ化。平文は保存しない）。
 * 追加・削除は管理画面の「アカウント」（運営のみ）か、npm run admin:user で行います。
 *
 * 権限（role）:
 *   admin  … 運営。すべてのイベント・アカウントを扱え、「サイトに反映する」ができる（以前からのアカウントはすべて admin）
 *   seller … 出品者。担当のイベント（events）だけ。会期・送料などは変えられず、反映は運営に「確認を依頼」する
 * ログイン状態は署名付き Cookie（HttpOnly / SameSite=Strict / 12時間）で保持します。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../../data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SECRET_FILE = path.join(DATA_DIR, 'session-secret');
const COOKIE = 'haneul_admin';
const SESSION_HOURS = 12;

fs.mkdirSync(DATA_DIR, { recursive: true });

function readUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')).users || []; } catch { return []; }
}
function writeUsers(users) {
  const tmp = `${USERS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ users }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, USERS_FILE);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

const ROLES = ['admin', 'seller'];
const roleOf = (u) => (u?.role === 'seller' ? 'seller' : 'admin');

/** アカウントを作る・変える。password を省くとパスワードはそのまま（role・events だけ変える） */
function setUser(name, password, { role, events } = {}) {
  const users = readUsers();
  const old = users.find((u) => u.name === name);
  const next = {
    name,
    ...(password ? hashPassword(password) : { salt: old?.salt, hash: old?.hash }),
    role: ROLES.includes(role) ? role : roleOf(old),
    events: Array.isArray(events) ? [...new Set(events.map(String))] : (old?.events || []),
    createdAt: old?.createdAt || new Date().toISOString(),
    // パスワード設定用のリンク（パスワードを設定したら消す）
    ...(!password && old?.setupHash ? { setupHash: old.setupHash, setupExp: old.setupExp } : {}),
  };
  writeUsers([...users.filter((u) => u.name !== name), next]);
}

/*
 * パスワード設定用のリンク：運営がアカウントを作ると発行し、ご本人がリンクを開いて自分でパスワードを決める
 * （パスワードを忘れたときの再設定にも使う）。リンクの合言葉そのものは保存せず、ハッシュだけ保存する。7日間有効・1回限り
 */
const SETUP_DAYS = 7;
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
function issueSetup(name) {
  const users = readUsers();
  const u = users.find((x) => x.name === name);
  if (!u) return null;
  const token = crypto.randomBytes(24).toString('base64url');
  u.setupHash = sha(token);
  u.setupExp = Date.now() + SETUP_DAYS * 86400e3;
  writeUsers(users);
  return { token, expiresAt: new Date(u.setupExp).toISOString() };
}
function findSetup(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const h = sha(token);
  const u = readUsers().find((x) => x.setupHash && x.setupHash.length === h.length && crypto.timingSafeEqual(Buffer.from(x.setupHash), Buffer.from(h)));
  return u && u.setupExp > Date.now() ? u : null;
}
/** リンクからパスワードを決める（成功したらアカウント名を返す） */
function completeSetup(token, password) {
  const u = findSetup(token);
  if (!u) return null;
  const users = readUsers();
  const x = users.find((y) => y.name === u.name);
  Object.assign(x, hashPassword(password));
  delete x.setupHash;
  delete x.setupExp;
  writeUsers(users);
  return x.name;
}
/** 画面に出す用（パスワードのハッシュは出さない） */
function getUser(name) {
  const u = readUsers().find((x) => x.name === name);
  return u ? {
    name: u.name, role: roleOf(u), events: u.events || [], createdAt: u.createdAt || null,
    hasPassword: !!u.hash, setupPending: !!(u.setupHash && u.setupExp > Date.now()), setupExpiresAt: u.setupExp ? new Date(u.setupExp).toISOString() : null,
  } : null;
}
const listUsers = () => readUsers().map((u) => getUser(u.name));
function deleteUser(name) {
  const users = readUsers();
  const next = users.filter((u) => u.name !== name);
  writeUsers(next);
  return next.length !== users.length;
}

function verify(name, password) {
  const u = readUsers().find((x) => x.name === name);
  // ユーザーがいなくても同じだけ時間をかける（存在の推測を防ぐ）
  const { hash } = hashPassword(String(password || ''), u?.salt || 'x'.repeat(32));
  if (!u || !u.hash) return false; // パスワード未設定（リンクから設定する前）はログインできない
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(u.hash, 'hex'));
}

let secret = process.env.SESSION_SECRET;
if (!secret) {
  try { secret = fs.readFileSync(SECRET_FILE, 'utf8').trim(); } catch {
    secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
  }
}

const b64 = (s) => Buffer.from(s).toString('base64url');
const sign = (data) => crypto.createHmac('sha256', secret).update(data).digest('base64url');

function sessionCookie(name, req) {
  const payload = b64(JSON.stringify({ u: name, exp: Date.now() + SESSION_HOURS * 3600e3 }));
  const secure = process.env.COOKIE_SECURE === '1' || req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted;
  return `${COOKIE}=${payload}.${sign(payload)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}${secure ? '; Secure' : ''}`;
}
const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;

function currentUser(req) {
  const raw = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`));
  if (!raw) return null;
  const [payload, sig] = raw.slice(COOKIE.length + 1).split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const { u, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (Date.now() > exp) return null;
    return readUsers().some((x) => x.name === u) ? u : null; // 削除されたアカウントは即無効
  } catch { return null; }
}

/* ログインの試行回数制限（IP ごとに 15 分で 10 回まで） */
const attempts = new Map();
function loginAllowed(ip) {
  const a = attempts.get(ip);
  if (!a || Date.now() > a.until) return true;
  return a.count < 10;
}
function loginFailed(ip) {
  const a = attempts.get(ip);
  if (!a || Date.now() > a.until) attempts.set(ip, { count: 1, until: Date.now() + 15 * 60e3 });
  else a.count++;
}
function loginSucceeded(ip) { attempts.delete(ip); }

module.exports = {
  DATA_DIR, ROLES, readUsers, setUser, getUser, listUsers, deleteUser, verify, issueSetup, findSetup, completeSetup, sessionCookie, clearCookie, currentUser,
  loginAllowed, loginFailed, loginSucceeded,
};
