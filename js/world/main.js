/*
 * 3D 店内（アバターで歩けるバーチャルポップアップ）
 * --------------------------------------------------
 * room.js     店内の組み立て（壁・棚・テーブル・レジ・出口）
 * avatars.js  アバター（キャラクターの絵を立体の板にしたもの）
 * controls.js キーボード・スティック・ドラッグ・タップ
 * 同時接続（他のお客さんのアバター）は、入店の手続きと同じ接続（js/visit.js の window.Visit）を使う
 */
import * as THREE from '../../vendor/three.module.min.js';
import { buildRoom, disposeRoom } from './room.js';
import { Avatar, EMOTES } from './avatars.js';
import { Controls } from './controls.js';

const $ = (s, r = document) => r.querySelector(s);
const saved = {
  get(k, d) { try { const v = localStorage.getItem(`haneul:${k}`); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`haneul:${k}`, JSON.stringify(v)); } catch { /* noop */ } },
};

const SPEED = 2.8;
const RADIUS = 0.32;
const BOUND = 6.65;
const SPAWN = new THREE.Vector3(0, 0, 3.4);
const NEAR = 1.45;
// クリック（タップ）1回で歩く距離（m）。遠くをクリックしても、この距離だけ進んで止まる
const CLICK_STEP = 3;

async function main() {
  await window.AppReady;
  // 管理画面の「入口の画面」プレビューでは店内は使わない
  if (new URLSearchParams(location.search).has('entrance-preview')) return;
  const root = $('#world');
  const labelsEl = $('#worldLabels');

  /* ---------- レンダラー ---------- */
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch {
    $('#worldFallback').hidden = false;
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.domElement.className = 'world-canvas';
  root.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 60);
  const raycaster = new THREE.Raycaster();

  function resize() {
    const w = root.clientWidth;
    const h = root.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(root);
  resize();

  // 看板の文字に丸ゴシックを使うため、フォントの読み込みを少し待つ
  try {
    await window.HaneulEvent.fontReady();
  } catch { /* noop */ }

  /* ---------- 店内（テーマ） ---------- */
  let room = null;
  let themeKey = window.SHOP.theme;
  let building = Promise.resolve();
  function setTheme(key) {
    themeKey = window.applyThemeMeta(key);
    building = building.then(async () => {
      const built = await buildRoom(window.THEMES[themeKey]);
      if (room) { scene.remove(room.group); disposeRoom(room.group); }
      room = built;
      scene.add(room.group);
      scene.background = new THREE.Color(window.THEMES[themeKey].ceiling);
      root.dataset.ready = 'true';
    });
    return building;
  }
  await setTheme(new URLSearchParams(location.search).get('theme') || themeKey);

  const themeSel = $('#themeSelect');
  if (window.ShopifyData?.enabled || window.SHOP.theme === 'event') {
    $('.theme-switch').hidden = true; // 店内管理画面（/admin）で公開した内装に従う
  } else {
    themeSel.innerHTML = Object.entries(window.THEMES).map(([id, t]) => `<option value="${id}">${t.name}（${t.title}）</option>`).join('');
    themeSel.value = themeKey;
    themeSel.addEventListener('change', () => {
      setTheme(themeSel.value);
      try { const u = new URL(location.href); u.searchParams.set('theme', themeSel.value); history.replaceState(null, '', u); } catch { /* noop */ }
    });
  }

  /* ---------- 自分のアバター ---------- */
  let look = saved.get('look', null);
  // 前に選んだアバターが管理画面で外されていたら、最初のアバターに替える
  if (look && !window.AVATARS.some((a) => a.id === look.avatar)) look = { avatar: window.AVATARS[0].id };
  const self = new Avatar({ avatar: look?.avatar || window.AVATARS[0].id, isSelf: true, labelsEl });
  self.group.position.copy(SPAWN);
  scene.add(self.group);

  /* ---------- 他のお客さん（入店の手続きと同じ接続 window.Visit を使う） ---------- */
  const Visit = window.Visit;
  const peers = new Map();
  let netState = 'connecting';
  const statusEl = $('#netStatus');
  function setStatus(s = netState) {
    netState = s;
    statusEl.dataset.state = s;
    statusEl.textContent = s === 'online' ? `店内 ${peers.size + 1} 人`
      : s === 'connecting' ? '接続しています…' : 'ひとりで見ています';
  }
  function addPeer(p) {
    if (peers.has(p.id)) return;
    const a = new Avatar({ avatar: p.avatar, labelsEl });
    a.group.position.set(p.x, 0, p.z);
    a.setTarget(p.x, p.z, p.m);
    scene.add(a.group);
    peers.set(p.id, a);
  }
  function removePeer(id) {
    const a = peers.get(id);
    if (!a) return;
    scene.remove(a.group);
    a.dispose();
    peers.delete(id);
  }
  const clearPeers = () => { for (const id of [...peers.keys()]) removePeer(id); };
  Visit.on('status', (s) => setStatus(s === 'online' && Visit.state !== 'inside' ? 'connecting' : s));
  Visit.on('message', (m) => {
    if (m.t === 'welcome') { clearPeers(); m.peers.forEach(addPeer); }
    else if (m.t === 'join') addPeer(m.peer);
    else if (m.t === 'leave') removePeer(m.id);
    else if (m.t === 'move') peers.get(m.id)?.setTarget(m.x, m.z, m.m);
    else if (m.t === 'emote') peers.get(m.id)?.emote(m.e);
    else if (m.t === 'look') peers.get(m.id)?.setLook(m.avatar);
    else if (m.t === 'reset') clearPeers();
    if (m.t !== 'move') setStatus(Visit.state === 'inside' ? 'online' : netState);
  });
  // 入店できたら（再接続のときも）、自分のアバターで店内に現れる
  function tryJoin() {
    if (Visit.state !== 'inside') return;
    const p = self.group.position;
    Visit.send({ t: 'join', avatar: self.avatar, x: p.x, z: p.z });
  }
  // 入口でアバターを選んだとき（js/app.js から）
  document.addEventListener('haneul:look', (e) => {
    look = { avatar: e.detail.avatar };
    self.setLook(look.avatar);
    tryJoin();
  });
  Visit.on('admitted', (info) => { if (info.offline) setStatus('offline'); tryJoin(); });
  Visit.on('resumed', tryJoin);
  Visit.on('timeout', () => { clearPeers(); setStatus('offline'); self.group.position.copy(SPAWN); });
  Visit.on('left', () => { clearPeers(); setStatus('offline'); self.group.position.copy(SPAWN); });
  if (Visit.state === 'inside') tryJoin();
  else if (Visit.state === 'offline') setStatus('offline');

  /* ---------- アバター選び（名前はなし） ---------- */
  const picker = $('#avatarPicker');
  let pick = { avatar: self.avatar };
  function renderPicker() {
    // 選べるアバター：キャラクター＋管理画面で追加したアバター（window.AVATARS）
    const escName = (v) => String(v).replace(/[&<>"']/g, '');
    $('#pickChars').innerHTML = window.AVATARS.map((a) => `
      <button class="pick-char" data-avatar="${escName(a.id)}" aria-pressed="${pick.avatar === a.id}" style="--c:${a.character ? a.character.color : '#e3e6f0'}">
        ${window.Art.characterSVG(a.character || { image: a.image })}<span>${escName(a.name)}</span></button>`).join('');
  }
  $('#pickChars').addEventListener('click', (e) => {
    const b = e.target.closest('[data-avatar]');
    if (b) { pick.avatar = b.dataset.avatar; renderPicker(); }
  });
  function openPicker() {
    pick = { avatar: self.avatar };
    renderPicker();
    picker.hidden = false;
    $('#pickGo').focus({ preventScroll: true });
  }
  // 店内でアバターを変える（入店時は入口で選ぶ）
  $('#pickGo').addEventListener('click', () => {
    look = { avatar: pick.avatar };
    saved.set('look', look);
    self.setLook(look.avatar);
    picker.hidden = true;
    root.focus({ preventScroll: true });
    tryJoin(); // 入店中なら、他のお客さんの画面でも見た目が変わる
  });
  $('#pickCancel').addEventListener('click', () => { picker.hidden = true; root.focus({ preventScroll: true }); });
  $('#lookBtn').addEventListener('click', openPicker);

  /* ---------- スタンプ ---------- */
  $('#emotes').innerHTML = EMOTES.map((e, i) => `<button class="emote-btn" data-emote="${i}" aria-label="スタンプ ${i + 1}">${e}</button>`).join('');
  function emote(i) {
    self.emote(i);
    Visit.send({ t: 'emote', e: i });
  }
  $('#emotes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-emote]');
    if (b) emote(Number(b.dataset.emote));
  });

  /* ---------- 近くのもの・クリック ---------- */
  let nearest = null;
  let walkTarget = null;
  // クリックした方向へ CLICK_STEP だけ進む地点
  function stepToward(x, z) {
    const p = self.group.position;
    const dx = x - p.x;
    const dz = z - p.z;
    const d = Math.hypot(dx, dz);
    const k = d > CLICK_STEP ? CLICK_STEP / d : 1;
    return new THREE.Vector3(
      Math.max(-BOUND, Math.min(BOUND, p.x + dx * k)), 0,
      Math.max(-BOUND, Math.min(BOUND, p.z + dz * k)));
  }
  const promptEl = $('#prompt');
  const promptBtn = $('#promptBtn');
  function interact(it) {
    if (!it) return;
    if (it.type === 'product') window.App.openProduct(it.id);
    else if (it.type === 'cart') window.App.openCart();
    else if (it.type === 'exit') window.App.confirmExit();
    else if (it.type === 'character') window.App.showCharacter(it.id);
  }
  promptBtn.addEventListener('click', () => interact(nearest));

  const controls = new Controls(root, renderer.domElement, {
    onInteract: () => interact(nearest),
    onEmote: emote,
    onTap(nx, ny) {
      if (!room || !picker.hidden) return;
      raycaster.setFromCamera({ x: nx, y: ny }, camera);
      const objs = room.interactables.flatMap((it) => (it.extra ? [it.object, it.extra] : [it.object]));
      const hit = raycaster.intersectObjects(objs, false)[0];
      if (hit) {
        const it = room.interactables.find((x) => x.object === hit.object || x.extra === hit.object);
        // キャラクターの絵は、近くにいるときだけ反応（遠くからは歩いていく）
        if (it && (it.type === 'product' || it.type === 'cart' || it.type === 'exit' || self.group.position.distanceTo(it.pos) < NEAR * 1.6)) return interact(it);
        if (it) { walkTarget = stepToward(it.pos.x, it.pos.z); return; }
      }
      const floor = room.group.getObjectByName('floor');
      const f = raycaster.intersectObject(floor, false)[0];
      if (f) walkTarget = stepToward(f.point.x, f.point.z);
    },
  });

  /* ---------- 移動（ぶつかり判定） ---------- */
  function blocked(x, z) {
    if (x < -BOUND || x > BOUND || z < -BOUND || z > BOUND) return true;
    return room.colliders.some((c) => x > c.minX - RADIUS && x < c.maxX + RADIUS && z > c.minZ - RADIUS && z < c.maxZ + RADIUS);
  }
  function moveBy(dx, dz) {
    const p = self.group.position;
    let moved = false;
    if (!blocked(p.x + dx, p.z)) { p.x += dx; moved = true; }
    if (!blocked(p.x, p.z + dz)) { p.z += dz; moved = true; }
    return moved;
  }

  /* ---------- 自分の位置を送る（1秒あたり最大10回・変わったときだけ） ---------- */
  let lastMoveKey = '';
  let lastMoveAt = 0;
  function sendMove(st, now) {
    const key = `${st.x.toFixed(2)},${st.z.toFixed(2)},${st.m}`;
    if (key === lastMoveKey || now - lastMoveAt < 100) return;
    lastMoveKey = key;
    lastMoveAt = now;
    Visit.send({ t: 'move', x: +st.x.toFixed(2), z: +st.z.toFixed(2), ry: +st.ry.toFixed(2), m: st.m });
  }

  /* ---------- 描画ループ ---------- */
  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(root);
  const clock = new THREE.Clock();
  const camPos = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  let first = true;

  function update(dt) {
    const layerOpen = window.App.isLayerOpen() || !picker.hidden;
    const inp = layerOpen ? { x: 0, y: 0 } : controls.input(dt);
    const yaw = controls.yaw;
    const fwd = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
    const right = { x: Math.cos(yaw), z: -Math.sin(yaw) };
    let dx = 0;
    let dz = 0;
    if (inp.x || inp.y) {
      walkTarget = null;
      dx = (right.x * inp.x + fwd.x * inp.y) * SPEED * dt;
      dz = (right.z * inp.x + fwd.z * inp.y) * SPEED * dt;
    } else if (walkTarget) {
      const p = self.group.position;
      const vx = walkTarget.x - p.x;
      const vz = walkTarget.z - p.z;
      const d = Math.hypot(vx, vz);
      if (d < 0.12) walkTarget = null;
      else { const s = Math.min(d, SPEED * dt); dx = (vx / d) * s; dz = (vz / d) * s; }
    }
    const moving = (dx || dz) ? moveBy(dx, dz) : false;
    if ((dx || dz) && !moving) walkTarget = null;
    self.moving = moving;
    self.update(dt);
    for (const a of peers.values()) a.update(dt, { follow: true });


    // カメラ：アバターの後ろから追いかける
    const p = self.group.position;
    const cp = Math.cos(controls.pitch);
    camPos.set(
      p.x + Math.sin(yaw) * controls.distance * cp,
      1.25 + Math.sin(controls.pitch) * controls.distance,
      p.z + Math.cos(yaw) * controls.distance * cp,
    );
    camPos.x = Math.max(-6.85, Math.min(6.85, camPos.x));
    camPos.z = Math.max(-6.85, Math.min(6.85, camPos.z));
    camPos.y = Math.min(3.95, camPos.y);
    if (first) { camera.position.copy(camPos); first = false; } else camera.position.lerp(camPos, 1 - Math.exp(-dt * 8));
    // アバターの少し先を見る（店内が広く見えるように）
    lookAt.set(p.x + fwd.x * 1.6, 1.05, p.z + fwd.z * 1.6);
    camera.lookAt(lookAt);

    // 近くの商品など
    let best = null;
    let bestD = NEAR;
    for (const it of room.interactables) {
      for (const q of it.alt ? [it.pos, it.alt] : [it.pos]) {
        const d = Math.hypot(q.x - p.x, q.z - p.z);
        if (d < bestD) { bestD = d; best = it; }
      }
    }
    if (best !== nearest) {
      nearest = best;
      promptEl.hidden = !best;
      const escHtml = (v) => String(v).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
      if (best) promptBtn.innerHTML = `<b>${best.type === 'product' ? 'この商品を見る' : escHtml(best.label)}</b>` +
        (best.type === 'product' ? `<span>${escHtml(best.label)}　¥${best.price.toLocaleString('ja-JP')}</span>` : '') +
        '<kbd>Enter</kbd>';
    }

    const w = root.clientWidth;
    const h = root.clientHeight;
    self.placeLabel(camera, w, h);
    for (const a of peers.values()) a.placeLabel(camera, w, h);

    sendMove({ x: p.x, z: p.z, ry: yaw, m: moving }, performance.now());
  }

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.1);
    if (visible && !document.hidden && room) {
      update(dt);
      renderer.render(scene, camera);
    }
    requestAnimationFrame(frame);
  }
  frame();

  /* ---------- 全画面 ----------
   * 店内だけを全画面にすると、商品詳細やカート（店内の外にある画面）が表示されないため、
   * ページ全体を全画面にして、店内を画面いっぱいに広げる。
   * Fullscreen API がない環境（iPhone の Safari など）でも、画面いっぱいの表示になる。 */
  const fsBtn = $('#fullscreenBtn');
  const docEl = document.documentElement;
  function setFs(on) {
    document.body.classList.toggle('world-fs', on);
    fsBtn.textContent = on ? '全画面をやめる' : '全画面';
    if (on) root.focus({ preventScroll: true });
    else root.scrollIntoView({ block: 'center' });
  }
  fsBtn.addEventListener('click', () => {
    const on = !document.body.classList.contains('world-fs');
    if (on) {
      setFs(true);
      docEl.requestFullscreen?.().catch(() => {});
    } else {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      setFs(false);
    }
  });
  // Esc キーなどでブラウザの全画面が解除されたら、表示も戻す
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && document.body.classList.contains('world-fs')) setFs(false);
  });

  $('#hudCart').addEventListener('click', () => window.App.openCart());

  window.World = {
    refresh: () => setTheme(themeKey), // 在庫が変わったときに棚を作り直す
    setTheme,
    debug: { self, peers, scene, camera, controls, get room() { return room; } },
  };
  root.dispatchEvent(new CustomEvent('world:ready'));
}

main().catch((err) => {
  console.error(err);
  const fb = document.getElementById('worldFallback');
  if (fb) fb.hidden = false;
});
