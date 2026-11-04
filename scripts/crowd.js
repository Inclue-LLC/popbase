/*
 * 混雑テスト：自動で歩き回るお客さん（ボット）を店内に入れる
 * --------------------------------------------------
 *   npm run crowd                     49人（あなたが入ると50人）
 *   npm run crowd -- 60               60人（50人を超えた分は入口で待機）
 *   npm run crowd -- 49 --stay 3      各ボットが 2〜4 分ほどで自分から退店する（入れ替わりのテスト）
 *   npm run crowd -- 49 --url http://192.168.1.23:8080   別のパソコンのサーバーに入れる
 *
 * ボットは本物のお客さんと同じ手順（入店 → 待機 → アバター選択 → 歩く・スタンプ）でつながります。
 * 公開中のアバター（管理画面で追加したものも含む）からランダムに選びます。
 * 止めるときは Ctrl + C（ボットは全員すぐに退店します）。
 *
 * ※ サーバーは、同じパソコンからの接続数を制限しています（既定 6）。
 *    テストするときは、サーバーを MAX_PER_IP=100 を付けて起動してください（README の「混雑テスト」）。
 */
const WebSocket = require('ws');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const COUNT = Number(args.find((a) => /^\d+$/.test(a)) || 49);
const BASE = (opt('url', 'http://localhost:8080')).replace(/\/$/, '');
const STAY_MIN = opt('stay', null) ? Number(opt('stay')) : null;
const WS_URL = `${BASE.replace(/^http/, 'ws')}/ws`;

// 人が集まりそうな場所（棚の前・テーブルのまわり・レジ・ガチャ・通路）
const SPOTS = [
  [-5.6, 2.2], [-5.6, 0.6], [-5.6, -1.0], [-5.6, -2.6], [-5.6, -3.8],
  [5.6, 2.2], [5.6, 0.6], [5.6, -1.0], [5.6, -2.6], [5.6, -3.8],
  [-1.3, -0.3], [0, -0.3], [1.3, -0.3], [-1.3, -2.9], [1.3, -2.9], [-2.5, -1.6], [2.5, -1.6],
  [-5.2, -4.8], [5.3, -4.7], [0, 2.5], [-2, 4], [2, 4], [0, 5.5], [-3, 1.5], [3, 1.5],
];
const rnd = (a, b) => a + Math.random() * (b - a);
const stats = { inside: 0, waiting: 0, timedOut: 0, left: 0, refused: 0, msgs: 0 };
const sockets = new Set();

async function avatarIds() {
  const ids = ['haru', 'byeol', 'dalbit', 'gomi'];
  try {
    const pub = await (await fetch(`${BASE}/api/published`)).json();
    let av = pub.event?.avatars;
    if (typeof av === 'string') av = JSON.parse(av);
    const hide = new Set(av?.hide || []);
    const list = ids.filter((id) => !hide.has(id)).concat((av?.custom || []).map((a) => a.id));
    return list.length ? list : ids;
  } catch { return ids; }
}

function bot(i, AVATARS) {
  const ws = new WebSocket(WS_URL, { headers: { origin: BASE } });
  sockets.add(ws);
  const pick = () => { const s = SPOTS[Math.floor(Math.random() * SPOTS.length)]; return [s[0] + rnd(-0.6, 0.6), s[1] + rnd(-0.5, 0.5)]; };
  let [x, z] = pick();
  let [tx, tz] = pick();
  let wait = rnd(0, 4);
  let state = 'connecting';
  let walker = null;

  ws.on('open', () => ws.send(JSON.stringify({ t: 'hello' })));
  ws.on('message', (raw) => {
    stats.msgs++;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'queue' && state !== 'waiting') { state = 'waiting'; stats.waiting++; }
    if (m.t === 'admitted') {
      if (state === 'waiting') stats.waiting--;
      state = 'inside';
      stats.inside++;
      startWalking();
      if (STAY_MIN) setTimeout(() => leave('left'), rnd(STAY_MIN * 0.66, STAY_MIN * 1.33) * 60e3);
    }
    if (m.t === 'timeout') { stats.timedOut++; leave(); }
  });
  ws.on('close', (code, reason) => {
    clearInterval(walker);
    sockets.delete(ws);
    if (state === 'inside') stats.inside--;
    if (state === 'waiting') stats.waiting--;
    if (String(reason) === 'too many') stats.refused++;
    state = 'closed';
  });
  ws.on('error', () => {});

  function leave(kind) {
    if (kind) stats[kind]++;
    try { ws.send(JSON.stringify({ t: 'bye' })); } catch { /* noop */ }
    ws.close();
  }

  function startWalking() {
    ws.send(JSON.stringify({ t: 'join', avatar: AVATARS[i % AVATARS.length], x, z }));
    let last = Date.now();
    walker = setInterval(() => {
      const now = Date.now();
      const dt = (now - last) / 1000;
      last = now;
      let moving = false;
      if (wait > 0) wait -= dt;
      else {
        const dx = tx - x; const dz = tz - z; const d = Math.hypot(dx, dz);
        if (d < 0.1) { wait = rnd(2, 8); [tx, tz] = pick(); }
        else { const s = Math.min(d, 1.4 * dt); x += (dx / d) * s; z += (dz / d) * s; moving = true; }
      }
      if (moving || Math.random() < 0.05) ws.send(JSON.stringify({ t: 'move', x: +x.toFixed(2), z: +z.toFixed(2), ry: 0, m: moving }));
      if (Math.random() < 0.004) ws.send(JSON.stringify({ t: 'emote', e: Math.floor(Math.random() * 6) }));
    }, 100);
  }
}

(async () => {
  const AVATARS = await avatarIds();
  console.log(`ボット ${COUNT} 人を ${BASE} に入れます（アバター: ${AVATARS.join(', ')}${STAY_MIN ? `／約${STAY_MIN}分で退店` : ''}）`);
  console.log('止めるときは Ctrl + C\n');
  for (let i = 0; i < COUNT; i++) setTimeout(() => bot(i, AVATARS), i * 60);

  setInterval(async () => {
    let h = {};
    try { h = await (await fetch(`${BASE}/healthz`)).json(); } catch { /* noop */ }
    const line = [
      `店内 ${h.inside ?? '?'} / ${h.capacity ?? '?'} 人`,
      `待機 ${h.waiting ?? '?'} 人`,
      h.crowded ? `混雑中（1人 ${h.visitMinutes} 分）` : '空いている（時間制限なし）',
      `ボット：店内 ${stats.inside}・待機 ${stats.waiting}`,
      stats.timedOut ? `時間切れ ${stats.timedOut}` : '',
      stats.left ? `自分で退店 ${stats.left}` : '',
      `ボット全体の受信 ${Math.round(stats.msgs / 5)} 通/秒（1人あたり ${stats.inside ? Math.round(stats.msgs / 5 / stats.inside) : 0}）`,
    ].filter(Boolean).join('　');
    console.log(`[${new Date().toLocaleTimeString('ja-JP')}] ${line}`);
    stats.msgs = 0;
    if (stats.refused) {
      console.log(`\n⚠ ${stats.refused} 人が接続を断られました。サーバーを MAX_PER_IP=100 を付けて起動し直してください（README の「混雑テスト」）。\n`);
      stats.refused = 0;
    }
  }, 5000);

  // 止めたときは全員きちんと退店させる（席をすぐ空ける）
  const stop = () => {
    console.log('\nボットを退店させています…');
    for (const ws of sockets) { try { ws.send(JSON.stringify({ t: 'bye' })); ws.close(); } catch { /* noop */ } }
    setTimeout(() => process.exit(0), 500);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
})();
