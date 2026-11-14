/*
 * 入店の手続き（お客さんのブラウザ側）
 * --------------------------------------------------
 * サーバー（server/visit.js）と1本の接続でやり取りし、入口（js/app.js）と店内（js/world/）の両方で使う。
 *   Visit.start()   入店を申し込む → 'admitted'（入店）または 'queued'（待機）
 *   Visit.send(msg) 店内の同時接続のメッセージを送る（入店中のみ）
 *   Visit.on(event, fn)
 *     'queued'   { pos, ahead, waiting, estimateMinutes }   待機中の順番（変わるたびに）
 *     'admitted' { crowded, visitMinutes, warnMinutes }      入店できた
 *     'timer'    { deadline（このブラウザの時刻 ms）| null } 残り時間が決まった／なくなった
 *     'timeout'  時間切れ・閉店で退出（{ reason: 'visit' | 'closed', opensAt }）
 *     'closed'   営業時間外で入店できない（{ state: 'before'|'closed'|'ended', opensAt }）
 *     'left'     自分で退店した（店内の EXIT から）
 *     'message'  店内の同時接続のメッセージ（join / leave / move / emote / look / welcome）
 *     'status'   'connecting' | 'online' | 'offline'
 * サーバーにつながらない場合（静的ホスティングなど）は、制限なしでそのまま入店する。
 */
(function () {
  const TOKEN_KEY = 'haneul:visit-token';
  const handlers = {};
  const emit = (ev, data) => (handlers[ev] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } });

  const store = {
    get() { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } },
    set(v) { try { if (v) sessionStorage.setItem(TOKEN_KEY, v); else sessionStorage.removeItem(TOKEN_KEY); } catch { /* noop */ } },
  };

  function resolveUrl() {
    const configured = window.SHOP?.multiplayerUrl;
    if (configured) return configured;
    if (!/^https?:$/.test(location.protocol)) return null;
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  }

  const V = {
    state: 'idle', // idle | connecting | queued | inside | offline | ended
    deadline: null,
    info: null,
    ws: null,
    failures: 0,
    wanted: false, // 入店を申し込み中（切れたら自動でつなぎ直す）
    on(ev, fn) { (handlers[ev] ||= []).push(fn); return V; },

    hasTicket: () => !!store.get(),

    /** 入店を申し込む（入店券があれば、その続きから） */
    start() {
      if (window.DEMO) return V.startDemo();
      if (window.PREVIEW_MODE) return V.startPreview();
      V.wanted = true;
      if (V.state === 'ended' || V.state === 'closed') V.state = 'idle';
      const url = resolveUrl();
      if (!url) return V.goOffline();
      if (V.ws && V.ws.readyState <= 1) { V.ws.send(JSON.stringify({ t: 'hello', token: store.get() })); return; }
      V.connect(url);
    },

    connect(url) {
      emit('status', 'connecting');
      let ws;
      try { ws = new WebSocket(url); } catch { V.retry(url); return; }
      V.ws = ws;
      ws.onopen = () => {
        // 失敗の回数は、サーバーから返事（入店・待機）が来たときに 0 に戻す
        // （つながってすぐ切られる場合に、つなぎ直しを無限に繰り返さないため）
        ws.send(JSON.stringify({ t: 'hello', token: store.get() }));
      };
      ws.onmessage = (e) => {
        let m;
        try { m = JSON.parse(e.data); } catch { return; }
        V.handle(m);
      };
      ws.onclose = () => {
        if (V.ws !== ws) return;
        V.ws = null;
        if (V.state === 'inside') emit('message', { t: 'reset' }); // 他のお客さんの表示をいったん消す
        if (V.wanted && V.state !== 'ended') V.retry(url);
      };
      ws.onerror = () => ws.close();
    },

    retry(url) {
      V.failures++;
      // 一度も入店できていないのにつながらない → サーバーなしとみなして制限なしで入店
      if (V.failures > 3 && V.state !== 'inside' && V.state !== 'queued') return V.goOffline();
      if (V.failures > 8) { emit('status', 'offline'); return; }
      emit('status', 'connecting');
      setTimeout(() => { if (V.wanted && !V.ws) V.connect(url); }, Math.min(8000, 600 * 2 ** V.failures));
    },

    /*
     * 見本のお店（/demo）：サーバーにはつながず、すぐ入店。店内のにぎわいは、このブラウザの中だけの見本のお客さんで出す
     * （本番の店内の人数・順番待ちには影響しない）
     */
    startDemo() {
      V.state = 'inside';
      emit('status', 'online');
      emit('admitted', { crowded: false, demo: true });
      if (V.demoTimer) return;
      const SPOTS = [[-5.6, 2.2], [-5.6, 0.6], [-5.6, -1.0], [-5.6, -2.6], [5.6, 2.2], [5.6, 0.6], [5.6, -1.0], [5.6, -2.6],
        [-1.3, -0.3], [1.3, -0.3], [-2.5, -1.6], [2.5, -1.6], [-1.3, -2.9], [1.3, -2.9], [0, 2.5], [-2, 4], [2, 4], [-3, 1.5], [3, 1.5]];
      const rnd = (a, b) => a + Math.random() * (b - a);
      // テーブル・棚・レジをすり抜けないように：店内のぶつかり判定（js/world/room.js の colliders）を使う
      const R = 0.42; // アバターの半径（少し余裕をもたせる）
      const boxes = () => window.World?.debug?.room?.colliders || [];
      const inside = (x, z) => boxes().some((c) => x > c.minX - R && x < c.maxX + R && z > c.minZ - R && z < c.maxZ + R);
      // 2点を結ぶ線が、どれかの箱（半径の分ふくらませる）を通るか（細かく区切って確かめる）
      const clear = (x0, z0, x1, z1) => {
        const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.15));
        for (let k = 1; k <= n; k++) { const t = k / n; if (inside(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)) return false; }
        return true;
      };
      const pickRaw = () => { const s = SPOTS[Math.floor(Math.random() * SPOTS.length)]; return [s[0] + rnd(-0.5, 0.5), s[1] + rnd(-0.4, 0.4)]; };
      const pick = () => { for (let i = 0; i < 30; i++) { const p = pickRaw(); if (!inside(p[0], p[1])) return p; } return [0, 3]; };
      // 次の行き先：まっすぐ行けなければ、両方の区間が空いている中継点を経由する（見つからなければ別の行き先に）
      const route = (b) => {
        for (let i = 0; i < 20; i++) {
          const [tx, tz] = pick();
          if (clear(b.x, b.z, tx, tz)) return [[tx, tz]];
          for (let j = 0; j < 25; j++) {
            const w = [rnd(-6, 6), rnd(-5.5, 6)];
            if (!inside(w[0], w[1]) && clear(b.x, b.z, w[0], w[1]) && clear(w[0], w[1], tx, tz)) return [w, [tx, tz]];
          }
        }
        return [];
      };
      const ids = (window.AVATARS || []).map((a) => a.id);
      const bots = Array.from({ length: 5 }, (_, i) => {
        const [x, z] = pick();
        return { id: 9000 + i, avatar: ids[i % Math.max(1, ids.length)] || 'haru', x, z, path: [], wait: rnd(0, 4) };
      });
      emit('message', { t: 'welcome', peers: bots.map((b) => ({ id: b.id, avatar: b.avatar, x: b.x, z: b.z, ry: 0, m: false })) });
      let last = Date.now();
      V.demoTimer = setInterval(() => {
        const now = Date.now();
        const dt = Math.min(0.5, (now - last) / 1000);
        last = now;
        for (const b of bots) {
          let moving = false;
          if (b.wait > 0) b.wait -= dt;
          else if (!b.path.length) {
            // 店内の準備ができたら（ぶつかり判定が読めたら）道順を決める
            if (boxes().length) b.path = route(b);
            if (inside(b.x, b.z)) [b.x, b.z] = pick(); // 最初の位置が箱の中なら外へ
          } else {
            const [tx, tz] = b.path[0];
            const dx = tx - b.x; const dz = tz - b.z; const d = Math.hypot(dx, dz);
            if (d < 0.1) { b.path.shift(); if (!b.path.length) b.wait = rnd(3, 9); } else { const s = Math.min(d, 1.3 * dt); b.x += (dx / d) * s; b.z += (dz / d) * s; moving = true; }
          }
          emit('message', { t: 'move', id: b.id, x: b.x, z: b.z, ry: 0, m: moving });
          if (Math.random() < 0.003) emit('message', { t: 'emote', id: b.id, e: Math.floor(Math.random() * 6) });
        }
      }, 120);
    },

    /*
     * 管理画面からの下書きの確認（?preview=draft）：会期・営業時間に関係なく、サーバーにはつながず、すぐ入店
     * （本番の店内の人数・順番待ちには影響しない。ほかのお客さんは表示しない）
     */
    startPreview() {
      V.state = 'inside';
      emit('status', 'online');
      emit('admitted', { crowded: false, preview: true });
      emit('message', { t: 'welcome', peers: [] });
    },

    goOffline() {
      V.state = 'offline';
      emit('status', 'offline');
      emit('admitted', { offline: true, crowded: false });
    },

    handle(m) {
      if (m.t === 'queue' || m.t === 'admitted') V.failures = 0;
      if (m.t === 'queue') {
        store.set(m.token);
        V.state = 'queued';
        V.info = m;
        emit('status', 'online');
        emit('queued', m);
      } else if (m.t === 'admitted') {
        store.set(m.token);
        const wasInside = V.state === 'inside';
        V.state = 'inside';
        V.info = m;
        V.reason = m.reason || 'visit';
        V.setDeadline(m.remaining);
        emit('status', 'online');
        if (!wasInside) emit('admitted', m);
        else emit('resumed', m);
      } else if (m.t === 'timer') {
        V.reason = m.reason || 'visit';
        V.setDeadline(m.remaining);
      } else if (m.t === 'closed') {
        // 営業時間外（入店・待機できない）
        store.set(null);
        V.state = 'closed';
        V.wanted = false;
        V.setDeadline(null);
        emit('closed', m);
      } else if (m.t === 'timeout') {
        store.set(null);
        V.state = 'ended';
        V.wanted = false;
        V.setDeadline(null);
        emit('timeout', m);
      } else {
        emit('message', m);
      }
    },

    setDeadline(remaining) {
      V.deadline = typeof remaining === 'number' ? Date.now() + remaining : null;
      emit('timer', { deadline: V.deadline });
    },

    send(msg) {
      if (V.state === 'inside' && V.ws?.readyState === WebSocket.OPEN) V.ws.send(JSON.stringify(msg));
    },

    /** 自分から退店（席をすぐ空ける） */
    leave() {
      if (V.demoTimer) { clearInterval(V.demoTimer); V.demoTimer = null; emit('message', { t: 'reset' }); }
      if (V.ws?.readyState === WebSocket.OPEN) V.ws.send(JSON.stringify({ t: 'bye' }));
      store.set(null);
      V.state = 'ended';
      V.wanted = false;
      V.setDeadline(null);
      emit('left');
    },
  };

  window.Visit = V;
})();
