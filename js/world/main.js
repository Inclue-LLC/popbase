/*
 * 3D 店内（アバターで歩けるバーチャルポップアップ）
 * --------------------------------------------------
 * room.js     店内の組み立て（壁・棚・テーブル・レジ・ガチャ・飾り）
 * avatars.js  アバター（キャラクターの絵を立体の板にしたもの）
 * controls.js キーボード・スティック・ドラッグ・タップ
 * net.js      同時接続（他のお客さんのアバター）
 */
import * as THREE from '../../vendor/three.module.min.js';
import { buildRoom, disposeRoom } from './room.js';
import { Avatar, NAMES, EMOTES, displayName } from './avatars.js';
import { Controls } from './controls.js';
import { Net, resolveUrl } from './net.js';

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

async function main() {
  await window.AppReady;
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
    await Promise.race([
      Promise.all(['800 20px "M PLUS Rounded 1c"', '500 20px "M PLUS Rounded 1c"', '700 20px "M PLUS Rounded 1c"'].map((f) => document.fonts.load(f))),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
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
  if (window.ShopifyData?.enabled) {
    $('.theme-switch').hidden = true; // Shopify 管理画面のイベント設定に従う
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
  const self = new Avatar({ avatar: look?.avatar || 'haru', name: look?.name ?? 0, isSelf: true, labelsEl });
  self.group.position.copy(SPAWN);
  scene.add(self.group);

  /* ---------- 他のお客さん ---------- */
  const peers = new Map();
  let myRoom = null;
  const statusEl = $('#netStatus');
  function setStatus(s) {
    statusEl.dataset.state = s;
    statusEl.textContent = s === 'online' ? `店内 ${peers.size + 1} 人${myRoom > 1 ? `（チャンネル ${myRoom}）` : ''}`
      : s === 'connecting' ? '接続しています…' : 'ひとりで見ています';
  }
  function addPeer(p) {
    if (peers.has(p.id)) return;
    const a = new Avatar({ avatar: p.avatar, name: p.name, labelsEl });
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
  const net = new Net(resolveUrl(), {
    status: setStatus,
    message(m) {
      if (m.t === 'welcome') {
        for (const id of [...peers.keys()]) removePeer(id);
        myRoom = m.room;
        m.peers.forEach(addPeer);
      } else if (m.t === 'join') addPeer(m.peer);
      else if (m.t === 'leave') removePeer(m.id);
      else if (m.t === 'move') peers.get(m.id)?.setTarget(m.x, m.z, m.m);
      else if (m.t === 'emote') peers.get(m.id)?.emote(m.e);
      else if (m.t === 'look') peers.get(m.id)?.setLook(m.avatar, m.name);
      if (m.t !== 'move') setStatus('online');
    },
    disconnected() { for (const id of [...peers.keys()]) removePeer(id); },
  });

  /* ---------- アバター選び ---------- */
  const picker = $('#avatarPicker');
  let pick = { avatar: self.avatar, name: self.name };
  function renderPicker() {
    $('#pickChars').innerHTML = window.CHARACTERS.map((c) => `
      <button class="pick-char" data-avatar="${c.id}" aria-pressed="${pick.avatar === c.id}" style="--c:${c.color}">
        ${window.Art.characterSVG(c)}<span>${c.name}</span></button>`).join('');
    $('#pickNames').innerHTML = NAMES.map((n, i) => `<option value="${i}">${n}</option>`).join('');
    $('#pickNames').value = String(pick.name);
    $('#pickPreview').textContent = displayName(pick.avatar, pick.name);
  }
  $('#pickChars').addEventListener('click', (e) => {
    const b = e.target.closest('[data-avatar]');
    if (b) { pick.avatar = b.dataset.avatar; renderPicker(); }
  });
  $('#pickNames').addEventListener('change', (e) => { pick.name = Number(e.target.value); renderPicker(); });
  $('#pickShuffle').addEventListener('click', () => { pick.name = Math.floor(Math.random() * NAMES.length); renderPicker(); });
  function openPicker() {
    pick = { avatar: self.avatar, name: self.name };
    renderPicker();
    picker.hidden = false;
    $('#pickGo').focus({ preventScroll: true });
  }
  $('#pickGo').addEventListener('click', () => {
    const first = !look;
    look = { ...pick };
    saved.set('look', look);
    self.setLook(look.avatar, look.name);
    picker.hidden = true;
    root.focus({ preventScroll: true });
    if (first) net.connect({ avatar: look.avatar, name: look.name, x: self.group.position.x, z: self.group.position.z });
    else net.send({ t: 'look', avatar: look.avatar, name: look.name });
  });
  $('#lookBtn').addEventListener('click', openPicker);
  if (look) net.connect({ avatar: look.avatar, name: look.name, x: SPAWN.x, z: SPAWN.z });
  else { setStatus('offline'); openPicker(); }

  /* ---------- スタンプ ---------- */
  $('#emotes').innerHTML = EMOTES.map((e, i) => `<button class="emote-btn" data-emote="${i}" aria-label="スタンプ ${i + 1}">${e}</button>`).join('');
  function emote(i) {
    self.emote(i);
    net.send({ t: 'emote', e: i });
  }
  $('#emotes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-emote]');
    if (b) emote(Number(b.dataset.emote));
  });

  /* ---------- 近くのもの・クリック ---------- */
  let nearest = null;
  let walkTarget = null;
  const promptEl = $('#prompt');
  const promptBtn = $('#promptBtn');
  function interact(it) {
    if (!it) return;
    if (it.type === 'product') window.App.openProduct(it.id);
    else if (it.type === 'cart') window.App.openCart();
    else if (it.type === 'gacha') document.getElementById('gacha').scrollIntoView({ behavior: 'smooth' });
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
        // ガチャ・キャラクターの絵は、近くにいるときだけ反応（遠くからは歩いていく）
        if (it && (it.type === 'product' || it.type === 'cart' || self.group.position.distanceTo(it.pos) < NEAR * 1.6)) return interact(it);
        if (it) { walkTarget = it.pos.clone(); return; }
      }
      const floor = room.group.getObjectByName('floor');
      const f = raycaster.intersectObject(floor, false)[0];
      if (f) walkTarget = new THREE.Vector3(Math.max(-BOUND, Math.min(BOUND, f.point.x)), 0, Math.max(-BOUND, Math.min(BOUND, f.point.z)));
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

    // 吊り飾りをゆらす
    const t = clock.elapsedTime;
    room.group.children.forEach((o) => { if (o.userData.sway) o.position.x = o.userData.sway.base + Math.sin(t * 0.9 + o.userData.sway.phase) * 0.04; });

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
      if (best) promptBtn.innerHTML = `<b>${best.type === 'product' ? 'この商品を見る' : best.label}</b>` +
        (best.type === 'product' ? `<span>${best.label}　¥${best.price.toLocaleString('ja-JP')}</span>` : '') +
        '<kbd>Enter</kbd>';
    }

    const w = root.clientWidth;
    const h = root.clientHeight;
    self.placeLabel(camera, w, h);
    for (const a of peers.values()) a.placeLabel(camera, w, h);

    net.move({ x: p.x, z: p.z, ry: yaw, m: moving }, performance.now());
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

  /* ---------- 全画面 ---------- */
  const fsBtn = $('#fullscreenBtn');
  if (!root.requestFullscreen) fsBtn.hidden = true;
  fsBtn.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else root.requestFullscreen().then(() => root.focus({ preventScroll: true })).catch(() => {});
  });

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
