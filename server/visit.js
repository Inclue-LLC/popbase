/*
 * 入店の管理（入場制限・待機列・お買い物時間）と、店内の同時接続
 * --------------------------------------------------
 * - 管理画面で公開した会期・営業時間の外は入店できない。閉店時刻になると店内のお客さんは自動で退店
 *   （閉店 WARN_MINUTES 分前から、お客さんの画面に「閉店まで」のタイマーが出る）
 * - 店内は1部屋だけ。同時に入れるのは MAX_VISITORS 人（既定 50）
 * - 満員なら待機列に並んでもらい、空きが出たら先頭から自動で入店
 * - 待っている人がいる間（＝混雑中）は、店内の1人あたりのお買い物時間を VISIT_MINUTES 分（既定 30）にする
 *   ・混雑が始まった時点ですでに時間を過ぎている人には、WARN_MINUTES 分（既定 5）の猶予を付ける
 *   ・時間になったら自動で退出（お客さんのブラウザでカートも空にする）
 *   ・待っている人がいなくなれば、時間制限はなくなる
 * - ページの再読み込みや通信の切れ目に備えて、RECONNECT_SECONDS 秒（既定 30）は
 *   店内の場所・待機の順番・残り時間をそのまま預かる（入店券＝ランダムな token で本人確認）
 *
 * お客さんから届くのは「入店券・位置・向き・アバターの種類・スタンプの番号」だけ（自由入力の文字なし）。
 */
const crypto = require('crypto');

const CAP = Math.max(1, Number(process.env.MAX_VISITORS) || 50);
const VISIT_MS = (Number(process.env.VISIT_MINUTES) || 30) * 60e3;
const WARN_MS = (Number(process.env.WARN_MINUTES) || 5) * 60e3;
const GRACE_MS = (Number(process.env.RECONNECT_SECONDS) || 30) * 1000;

// クライアント（js/world/avatars.js・js/event.js）と同じ値
const AVATARS = ['haru', 'byeol', 'dalbit', 'gomi'];
const CUSTOM_AVATAR = /^[ck]_[a-z0-9]{6,16}$/; // 管理画面で追加したアバター（c_）・イベントのキャラクター（k_）
const avatarOk = (v) => typeof v === 'string' && (AVATARS.includes(v) || CUSTOM_AVATAR.test(v));
const EMOTE_COUNT = 6;
const BOUNDS = 6.8; // 店内の広さ（±m）

/* ---------- 会期・営業時間（管理画面で公開した設定。js/schedule.js） ---------- */
const schedule = require('../js/schedule.js');
let sched = {};
/** 公開中のイベント設定から、会期・営業時間を受け取る（server/index.js・管理画面の公開時に呼ばれる） */
function setSchedule(f = {}) {
  sched = { open_at: f.open_at || '', close_at: f.close_at || '', daily_open: f.daily_open || '', daily_close: f.daily_close || '' };
}
const storeStatus = (at = Date.now()) => schedule.status(sched, at);
const closedInfo = (st) => ({ state: st.state, opensAt: st.opensAt || null });

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const int = (v, max) => (Number.isInteger(v) && v >= 0 && v < max ? v : 0);

/**
 * 入店券：token -> { token, id, state:'queued'|'inside', ws, enteredAt, lostAt, avatar, x, z, ry, moving, joined,
 *   crowdDeadline（混雑中のお買い物時間の終わり）, deadline（実際に退店する時刻＝お買い物時間と閉店の早いほう）, reason（'visit'|'closing'） }
 */
const tickets = new Map();
const queue = []; // 待機中の token（先頭から入店）
let nextId = 1;

const inside = () => [...tickets.values()].filter((t) => t.state === 'inside');
const crowded = () => queue.length > 0;

function send(t, msg) {
  if (t.ws && t.ws.readyState === t.ws.OPEN) t.ws.send(JSON.stringify(msg));
}
function broadcast(msg, except) {
  const data = JSON.stringify(msg);
  for (const t of tickets.values()) {
    if (t !== except && t.state === 'inside' && t.joined && t.ws?.readyState === t.ws?.OPEN) t.ws.send(data);
  }
}
const publicState = (t) => ({ id: t.id, avatar: t.avatar, x: t.x, z: t.z, ry: t.ry, m: t.moving });

function remaining(t) {
  return t.deadline ? Math.max(0, t.deadline - Date.now()) : null;
}

/** 実際に退店する時刻：混雑中のお買い物時間の終わりと、閉店時刻の早いほう */
function updateDeadline(t, st = storeStatus()) {
  const closeAt = st.state === 'open' ? st.closesAt : null;
  const c = [t.crowdDeadline, closeAt].filter((v) => v != null);
  const dl = c.length ? Math.min(...c) : null;
  const reason = dl != null && dl === closeAt ? 'closing' : 'visit';
  const changed = dl !== t.deadline || reason !== t.reason;
  t.deadline = dl;
  t.reason = reason;
  return changed;
}

function admit(t) {
  t.state = 'inside';
  t.enteredAt = Date.now();
  // 混雑中に入った人は、入店した時点から時間を数える
  t.crowdDeadline = crowded() ? t.enteredAt + VISIT_MS : null;
  updateDeadline(t);
  sendAdmitted(t);
}
function sendAdmitted(t) {
  const st = storeStatus();
  send(t, {
    t: 'admitted', token: t.token, id: t.id, capacity: CAP,
    visitMinutes: VISIT_MS / 60e3, warnMinutes: WARN_MS / 60e3,
    crowded: crowded(), remaining: remaining(t), reason: t.reason,
    closesAt: st.state === 'open' ? st.closesAt : null,
  });
}

function queueInfo(t) {
  const pos = queue.indexOf(t.token) + 1;
  // 目安の待ち時間：店内の人の終了時刻を早い順に並べ、自分の順番の人が出る時刻まで
  const deadlines = inside().map((x) => x.deadline || x.crowdDeadline || x.enteredAt + VISIT_MS).sort((a, b) => a - b);
  const free = Math.max(0, CAP - inside().length);
  const k = pos - free; // 自分より先に空く必要がある席の数
  let minutes = 0;
  if (k > 0) {
    const at = k <= deadlines.length ? deadlines[k - 1] : Date.now() + Math.ceil(k / CAP) * VISIT_MS;
    minutes = Math.max(1, Math.ceil((at - Date.now()) / 60e3));
  }
  return { t: 'queue', token: t.token, pos, ahead: pos - 1, waiting: queue.length, capacity: CAP, estimateMinutes: minutes };
}

function release(t, { notify } = {}) {
  if (!tickets.has(t.token)) return;
  tickets.delete(t.token);
  t.state = 'gone';
  const qi = queue.indexOf(t.token);
  if (qi >= 0) queue.splice(qi, 1);
  if (t.joined) broadcast({ t: 'leave', id: t.id }, t);
  t.joined = false;
  if (notify) send(t, notify);
}

/* ---------- 1秒ごとの見回り ---------- */
let lastQueueKey = new Map();
function tick() {
  const now = Date.now();
  // 通信が切れたまま預かり時間を過ぎた入店券を破棄
  for (const t of [...tickets.values()]) if (!t.ws && t.lostAt && now - t.lostAt > GRACE_MS) release(t);

  // 営業時間外：店内のお客さんは退店、待っている人にも営業終了を知らせる
  const st = storeStatus(now);
  if (st.state !== 'open') {
    const info = closedInfo(st);
    for (const t of inside()) release(t, { notify: { t: 'timeout', reason: 'closed', ...info } });
    for (const token of [...queue]) { const t = tickets.get(token); if (t) release(t, { notify: { t: 'closed', ...info } }); }
    return;
  }

  // 混雑中は時間制限をかけ、空いたら外す。閉店が近ければ閉店時刻まで
  for (const t of inside()) {
    if (crowded() && !t.crowdDeadline) t.crowdDeadline = Math.max(t.enteredAt + VISIT_MS, now + WARN_MS);
    else if (!crowded()) t.crowdDeadline = null;
    if (updateDeadline(t, st)) send(t, { t: 'timer', remaining: remaining(t), reason: t.reason, crowded: crowded() });
  }
  // 時間切れ → 退出
  for (const t of inside()) {
    if (t.deadline && now >= t.deadline) {
      const closing = t.reason === 'closing';
      release(t, { notify: { t: 'timeout', reason: closing ? 'closed' : 'visit', ...(closing ? closedInfo(storeStatus(now + 1000)) : {}) } });
    }
  }

  // 空いた席に、待機列の先頭から入店
  while (queue.length && inside().length < CAP) {
    const t = tickets.get(queue.shift());
    if (t) admit(t);
  }
  // 待っている人へ順番を知らせる（変わったときだけ）
  for (const token of queue) {
    const t = tickets.get(token);
    if (!t?.ws) continue;
    const info = queueInfo(t);
    const key = `${info.pos}|${info.estimateMinutes}`;
    if (lastQueueKey.get(token) !== key) { lastQueueKey.set(token, key); send(t, info); }
  }
  if (lastQueueKey.size > queue.length * 2 + 100) lastQueueKey = new Map();
}
setInterval(tick, 1000).unref?.();

/* ---------- 接続ごとの処理 ---------- */
function onConnection(ws) {
  let t = null; // この接続の入店券
  let tokens = 30; // 簡易レート制限（1秒あたり約20通まで）
  const refill = setInterval(() => { tokens = Math.min(30, tokens + 20); }, 1000);

  ws.on('message', (raw) => {
    if (--tokens < 0) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object') return;

    // 入店の申し込み（再読み込み後は前の入店券で再開）
    // （時間切れ・退店のあとに「もう一度並ぶ」ときも、ここから）
    if (msg.t === 'hello' && (!t || t.state === 'gone')) {
      const old = typeof msg.token === 'string' ? tickets.get(msg.token) : null;
      if (old && (!old.ws || old.ws.readyState !== old.ws.OPEN)) {
        t = old;
        t.ws = ws;
        t.lostAt = null;
        if (t.state === 'inside') sendAdmitted(t);
        else send(t, queueInfo(t));
        return;
      }
      // 営業時間外は入店も待機もできない
      const st = storeStatus();
      if (st.state !== 'open') {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: 'closed', ...closedInfo(st) }));
        t = null;
        return;
      }
      t = {
        token: crypto.randomBytes(16).toString('hex'), id: nextId++, state: 'queued', ws, crowdDeadline: null, reason: 'visit',
        enteredAt: null, deadline: null, lostAt: null,
        avatar: AVATARS[0], x: 0, z: 5.5, ry: 0, moving: false, joined: false,
      };
      tickets.set(t.token, t);
      if (!queue.length && inside().length < CAP) admit(t);
      else { queue.push(t.token); send(t, queueInfo(t)); }
      return;
    }
    // 自分から退店・待機をやめる（席や順番をすぐ空ける）
    if (msg.t === 'bye') { if (t && t.state !== 'gone') release(t); return; }
    if (!t || t.state !== 'inside') return;

    if (msg.t === 'join') {
      t.avatar = avatarOk(msg.avatar) ? msg.avatar : t.avatar;
      t.x = clamp(num(msg.x, t.x), -BOUNDS, BOUNDS);
      t.z = clamp(num(msg.z, t.z), -BOUNDS, BOUNDS);
      const first = !t.joined;
      t.joined = true;
      send(t, { t: 'welcome', id: t.id, capacity: CAP, peers: inside().filter((x) => x !== t && x.joined).map(publicState) });
      if (first) broadcast({ t: 'join', peer: publicState(t) }, t);
      else broadcast({ t: 'look', id: t.id, avatar: t.avatar }, t);
    } else if (msg.t === 'move' && t.joined) {
      t.x = clamp(num(msg.x, t.x), -BOUNDS, BOUNDS);
      t.z = clamp(num(msg.z, t.z), -BOUNDS, BOUNDS);
      t.ry = num(msg.ry, t.ry);
      t.moving = !!msg.m;
      broadcast({ t: 'move', id: t.id, x: t.x, z: t.z, ry: t.ry, m: t.moving }, t);
    } else if (msg.t === 'emote' && t.joined) {
      broadcast({ t: 'emote', id: t.id, e: int(msg.e, EMOTE_COUNT) }, t);
    } else if (msg.t === 'look' && t.joined) {
      t.avatar = avatarOk(msg.avatar) ? msg.avatar : t.avatar;
      broadcast({ t: 'look', id: t.id, avatar: t.avatar }, t);
    }
  });

  ws.on('close', () => {
    clearInterval(refill);
    if (!t || t.ws !== ws) return;
    t.ws = null;
    t.lostAt = Date.now();
    // アバターは消すが、席と順番は預かり時間のあいだ残す
    if (t.joined) { t.joined = false; broadcast({ t: 'leave', id: t.id }, t); }
  });
}

function stats() {
  const st = storeStatus();
  return {
    store: st.state, opensAt: st.opensAt || null, closesAt: st.closesAt || null,
    inside: inside().length, waiting: queue.length, capacity: CAP, crowded: crowded(),
    visitMinutes: VISIT_MS / 60e3, warnMinutes: WARN_MS / 60e3,
  };
}

module.exports = { onConnection, stats, setSchedule, CAP, VISIT_MS, WARN_MS };
