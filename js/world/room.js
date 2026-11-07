/*
 * 店内の組み立て
 * --------------------------------------------------
 * 単位はメートル。x 右が＋ / y 上が＋ / z 手前（入口）が＋。
 *   店内: x -7〜7、z -7（奥の壁）〜 7（入口）、天井 4.2m
 * 返り値:
 *   group        … シーンに追加する Object3D
 *   colliders    … ぶつかり判定用の箱 [{minX,maxX,minZ,maxZ}]
 *   interactables… 近づく／クリックで反応するもの [{type,id,label,object,pos}]
 */
import * as THREE from '../../vendor/three.module.min.js';
import * as T from './textures.js';

export const ROOM = { w: 14, d: 14, h: 4.2 };
const HALF_W = ROOM.w / 2;
const HALF_D = ROOM.d / 2;

const ITEM_HEIGHT = { plush: 0.78, mug: 0.6, tote: 0.66, pouch: 0.56, note: 0.6, keychain: 0.56, sticker: 0.56 };


const basic = (map, extra = {}) => new THREE.MeshBasicMaterial({ map, ...extra });
const lambert = (color) => new THREE.MeshLambertMaterial({ color });

function plane(w, h, material) {
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
}

function productsFor(zone) {
  const lay = window.STORE_LAYOUT[zone] || {};
  return window.PRODUCTS.filter((p) => {
    if (p.display) return p.display === zone;
    if (zone === 'island') return !!p.limited;
    return !p.limited && (lay.categories || []).includes(p.category);
  }).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) ||
    (lay.categories ? lay.categories.indexOf(a.category) - lay.categories.indexOf(b.category) : 0));
}

export async function buildRoom(theme) {
  const group = new THREE.Group();
  const colliders = [];
  const interactables = [];
  const night = theme.light === 'night';

  /* ---------- 床・天井・壁 ---------- */
  const floor = plane(ROOM.w, ROOM.d, basic(await T.floorTexture(theme, ROOM.w)));
  floor.rotation.x = -Math.PI / 2;
  floor.name = 'floor';
  group.add(floor);

  const ceil = plane(ROOM.w, ROOM.d, new THREE.MeshBasicMaterial({ color: theme.ceiling }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = ROOM.h;
  group.add(ceil);
  const lampMat = new THREE.MeshBasicMaterial({ color: night ? '#fff1c4' : '#ffffff' });
  for (const x of [-4.5, 0, 4.5]) for (const z of [-4.5, 0, 4.5]) {
    const lamp = new THREE.Mesh(new THREE.CircleGeometry(night ? 0.32 : 0.26, 24), lampMat);
    lamp.rotation.x = Math.PI / 2;
    lamp.position.set(x, ROOM.h - 0.01, z);
    group.add(lamp);
  }

  const walls = [
    { pos: [0, ROOM.h / 2, -HALF_D], ry: 0, w: ROOM.w },
    { pos: [-HALF_W, ROOM.h / 2, 0], ry: Math.PI / 2, w: ROOM.d },
    { pos: [HALF_W, ROOM.h / 2, 0], ry: -Math.PI / 2, w: ROOM.d },
    { pos: [0, ROOM.h / 2, HALF_D], ry: Math.PI, w: ROOM.w, door: true },
  ];
  for (const wd of walls) {
    const m = plane(wd.w, ROOM.h, basic(await T.wallTexture(theme, wd.w, ROOM.h, { door: wd.door })));
    m.position.set(...wd.pos);
    m.rotation.y = wd.ry;
    group.add(m);
  }

  /* ---------- 奥の壁：看板・キャラクター・会期 ---------- */
  // 看板の幅は、イベント名などの長さに合わせて 5.2m〜8.8m で伸び縮みする
  const signH = 1.5;
  // 3行目は会期（営業時間があれば続けて）。会期も営業時間もなければ2行（ブランド名・イベント名）の看板にする
  const period = [window.SHOP.period, window.SHOP.hours].filter(Boolean).join('　');
  const signLines = [
    // ブランド名・イベント名の色は管理画面で指定できる（なければテーマの看板の色）
    { text: window.SHOP.brand, size: period ? 0.18 : 0.22, color: theme.sign.brandInk || theme.sign.sub, spacing: 14 },
    { text: theme.name, size: period ? 0.48 : 0.56, color: theme.sign.eventInk || theme.sign.ink },
    ...(period ? [{ text: period, size: 0.16, weight: 700, color: theme.sign.eventInk || theme.sign.ink }] : []),
  ];
  const signW = Math.min(8.8, Math.max(5.2, T.signTextWidth(signLines, signH) + 0.9));
  const sign = plane(signW, signH, basic(T.signTexture(signLines, theme.sign, signW, signH), { transparent: true }));
  sign.position.set(0, 3.15, -HALF_D + 0.03);
  group.add(sign);

  // このイベントのキャラクター（管理画面の「キャラクター」タブ）。人数が多いときは間隔と大きさを詰めて壁に収める
  const chars = window.CAST || [];
  const gap = Math.min(1.35, 10.5 / Math.max(chars.length, 1));
  // 名前の札（中心 1.4m・高さ 0.2m）は腰壁の見切り（上端 1.22m）から少し離す。
  // 札の上に少しすき間をあけて絵を置き、看板の下端までのすき間に収める
  const tagY = 1.4;
  const artBottom = tagY + 0.1 + 0.08;
  const signBottom = 3.15 - signH / 2;
  const size = Math.min(gap * 0.86, signBottom - 0.07 - artBottom);
  // キャラクターどうしの大きさの比率：いちばん大きいキャラクターを枠いっぱいにして、ほかはその比率で小さく
  const fracs = await Promise.all(chars.map((c) => T.characterFrac(c)));
  const maxFrac = Math.max(...fracs, 0);
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const x = (i - (chars.length - 1) / 2) * gap;
    const m = plane(size, size, basic(await T.characterTexture(c, 256, { scale: fracs[i] && maxFrac ? fracs[i] / maxFrac : 1 }), { transparent: true, alphaTest: 0.05 }));
    m.position.set(x, artBottom + size / 2, -HALF_D + 0.05);
    group.add(m);
    const tagW = Math.min(0.7, gap * 0.9);
    const nameTag = plane(tagW, 0.2, basic(T.signTexture([{ text: c.name, size: 0.7 }], { bg: '#ffffff', ink: '#3a3346' }, tagW, 0.2, { radius: 0.1 }), { transparent: true }));
    nameTag.position.set(x, tagY, -HALF_D + 0.05);
    group.add(nameTag);
    interactables.push({ type: 'character', id: c.id, label: `${c.name}のプロフィール`, object: m, pos: new THREE.Vector3(x, 0, -HALF_D + 0.6) });
  }

  /* ---------- 左右の棚 ---------- */
  const shelfLen = 7.6;
  const shelfDepth = 0.5;
  const shelfH = 2.4;
  const shelfCenterZ = -0.6;
  for (const side of ['left', 'right']) {
    const items = productsFor(side);
    const unit = new THREE.Group();
    const dir = side === 'left' ? 1 : -1;
    unit.position.set(-dir * (HALF_W - shelfDepth / 2), 0, shelfCenterZ);
    unit.rotation.y = dir * Math.PI / 2; // ローカル +z（手前）が通路側を向く
    group.add(unit);

    const backM = new THREE.MeshBasicMaterial({ color: theme.shelf.back });
    const boardM = lambert(theme.shelf.board);
    const edgeM = lambert(theme.shelf.edge);
    const back = new THREE.Mesh(new THREE.BoxGeometry(shelfLen, shelfH, 0.04), backM);
    back.position.set(0, shelfH / 2, -shelfDepth / 2 + 0.02);
    unit.add(back);
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, shelfH, shelfDepth), edgeM);
      post.position.set(sx * (shelfLen / 2 - 0.04), shelfH / 2, 0);
      unit.add(post);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(shelfLen, 0.08, shelfDepth), edgeM);
    top.position.set(0, shelfH, 0);
    unit.add(top);

    const lay = window.STORE_LAYOUT[side] || { title: '', label: '' };
    // 棚の看板：英字・日本語のうち入っているものだけ。どちらも空なら看板を出さない
    const signLines = [
      lay.title && { text: lay.title, size: lay.label ? 0.5 : 0.56, spacing: 4 },
      lay.label && { text: lay.label, size: lay.title ? 0.3 : 0.44, color: lay.title ? theme.sign.sub : theme.sign.ink },
    ].filter(Boolean);
    if (signLines.length) {
      const zs = plane(2.8, 0.7, basic(T.signTexture(signLines, theme.sign, 2.8, 0.7), { transparent: true }));
      zs.position.set(0, shelfH + 0.55, -shelfDepth / 2 + 0.03);
      unit.add(zs);
    }

    // 管理画面で配置した棚（2段×5枠。商品の大きさ「大」でも上の段に届かない高さ）なら枠どおりに、未設定なら商品数に合わせて自動で並べる
    const byId = Object.fromEntries(window.PRODUCTS.map((x) => [x.id, x]));
    let levels;
    let rowSlots; // [[{ p, i, n }]]
    if (lay.rows) {
      levels = [0.38, 1.36];
      rowSlots = lay.rows.map((row) => row.map((id, i) => (byId[id] ? { p: byId[id], i, n: row.length } : null)).filter(Boolean));
    } else {
      const rows = Math.min(2, Math.max(1, Math.ceil(items.length / 4)));
      const perRow = Math.ceil(items.length / rows) || 1;
      levels = rows === 2 ? [0.38, 1.36] : [0.7];
      rowSlots = levels.map((_, r) => {
        const rowItems = items.slice(r * perRow, (r + 1) * perRow);
        return rowItems.map((p, i) => ({ p, i, n: rowItems.length }));
      });
    }
    for (let r = 0; r < levels.length; r++) {
      const y = levels[r];
      const plank = new THREE.Mesh(new THREE.BoxGeometry(shelfLen - 0.12, 0.05, shelfDepth - 0.04), boardM);
      plank.position.set(0, y, 0.01);
      unit.add(plank);
      for (const { p, i, n } of rowSlots[r] || []) {
        const gap = (shelfLen - 0.6) / Math.max(n, 1);
        const lx = -shelfLen / 2 + 0.3 + gap * (i + 0.5);
        const h = ITEM_HEIGHT[p.shape] || 0.48;
        // 商品画像は正方形のテクスチャに下揃えで描いてあるので、下端を板に合わせて置く
        const [tex] = await T.productTexture(p);
        const item = plane(h, h, basic(tex, { transparent: true, alphaTest: 0.05 }));
        item.position.set(lx, y + 0.025 + h / 2, 0.02);
        unit.add(item);
        const tag = plane(0.64, 0.16, basic(T.tagTexture(p.name, p.price, { soldOut: p.stock === 0 }), { transparent: true }));
        tag.position.set(lx, y - 0.1, shelfDepth / 2 + 0.005);
        unit.add(tag);
        const pos = new THREE.Vector3();
        unit.localToWorld(pos.set(lx, 0, shelfDepth / 2 + 0.5));
        interactables.push({ type: 'product', id: p.id, label: p.name, price: p.price, object: item, pos: pos.clone() });
      }
    }
    const minZ = shelfCenterZ - shelfLen / 2;
    const maxZ = shelfCenterZ + shelfLen / 2;
    colliders.push(side === 'left'
      ? { minX: -HALF_W, maxX: -HALF_W + shelfDepth, minZ, maxZ }
      : { minX: HALF_W - shelfDepth, maxX: HALF_W, minZ, maxZ });
  }

  /* ---------- 中央：会場限定テーブル ---------- */
  const tW = 3.6; const tH = 0.9; const tD = 1.4; const tZ = -1.6;
  const tableSign = T.signTexture([
    { text: (window.STORE_LAYOUT.island || {}).title || 'LIMITED', size: 0.42, spacing: 16 },
    { text: (window.STORE_LAYOUT.island || {}).label || '会場限定', size: 0.26, color: theme.sign.sub },
  ], { ...theme.sign, style: 'board' }, tW, tH, { full: true });
  const sideM = lambert(theme.shelf.edge);
  const table = new THREE.Mesh(new THREE.BoxGeometry(tW, tH, tD), [
    sideM, sideM, lambert(theme.shelf.board), sideM,
    new THREE.MeshBasicMaterial({ map: tableSign }), new THREE.MeshBasicMaterial({ map: tableSign }),
  ]);
  table.position.set(0, tH / 2, tZ);
  group.add(table);
  colliders.push({ minX: -tW / 2, maxX: tW / 2, minZ: tZ - tD / 2, maxZ: tZ + tD / 2 });

  const islandLay = window.STORE_LAYOUT.island || {};
  const byIdAll = Object.fromEntries(window.PRODUCTS.map((x) => [x.id, x]));
  const tableSlots = islandLay.items
    ? islandLay.items.map((id, i) => (byIdAll[id] ? { p: byIdAll[id], i, n: islandLay.items.length } : null)).filter(Boolean)
    : productsFor('island').map((p, i, arr) => ({ p, i, n: arr.length }));
  for (const { p, i, n } of tableSlots) {
    const x = -tW / 2 + (tW / n) * (i + 0.5);
    const h = (ITEM_HEIGHT[p.shape] || 0.6) * 0.95;
    const [tex] = await T.productTexture(p);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, alphaTest: 0.05 }));
    sp.center.set(0.5, 0);
    sp.scale.set(h, h, 1);
    sp.position.set(x, tH, tZ);
    group.add(sp);
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.tagTexture(p.name, p.price, { soldOut: p.stock === 0 }), transparent: true }));
    tag.center.set(0.5, 0);
    tag.scale.set(0.56, 0.14, 1);
    tag.position.set(x, tH + h + 0.04, tZ);
    group.add(tag);
    const front = new THREE.Vector3(x, 0, tZ + tD / 2 + 0.5);
    interactables.push({ type: 'product', id: p.id, label: p.name, price: p.price, object: sp, pos: front, alt: new THREE.Vector3(x, 0, tZ - tD / 2 - 0.5) });
  }

  const rug = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ color: theme.rug, transparent: true, opacity: theme.rugOpacity ?? 0.55 }));
  rug.rotation.x = -Math.PI / 2;
  rug.scale.set(3.2, 1.9, 1);
  rug.position.set(0, 0.004, tZ);
  group.add(rug);

  /* ---------- レジ ---------- */
  const rW = 2.2; const rH = 1.0; const rD = 0.9; const rX = -5.3; const rZ = -6.1;
  const regTex = T.signTexture([{ text: 'REGISTER', size: 0.34, spacing: 10, color: '#6f6880' }], { bg: theme.shelf.back, ink: '#6f6880' }, rW, rH, { full: true });
  const register = new THREE.Mesh(new THREE.BoxGeometry(rW, rH, rD), [
    sideM, sideM, lambert(theme.shelf.board), sideM, new THREE.MeshBasicMaterial({ map: regTex }), sideM,
  ]);
  register.position.set(rX, rH / 2, rZ);
  group.add(register);
  const regSign = new THREE.Sprite(new THREE.SpriteMaterial({
    map: T.signTexture([{ text: 'お会計', size: 0.5 }, { text: 'カートを見る', size: 0.26, color: theme.sign.sub }], theme.sign, 1.0, 0.5),
    transparent: true,
  }));
  regSign.center.set(0.5, 0);
  regSign.scale.set(1.0, 0.5, 1);
  regSign.position.set(rX, rH + 0.05, rZ);
  group.add(regSign);
  colliders.push({ minX: rX - rW / 2, maxX: rX + rW / 2, minZ: -HALF_D, maxZ: rZ + rD / 2 });
  interactables.push({ type: 'cart', id: 'cart', label: 'お会計（カートを見る）', object: register, extra: regSign, pos: new THREE.Vector3(rX, 0, rZ + rD / 2 + 0.6) });

  /* ---------- 出口（手前の壁のドア。クリック・近づいて Enter で退店の確認） ---------- */
  const exitDoor = plane(2.6, 2.9, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  exitDoor.rotation.y = Math.PI;
  exitDoor.position.set(0, 1.45, HALF_D - 0.03);
  group.add(exitDoor);
  interactables.push({ type: 'exit', id: 'exit', label: '出口（退店する）', object: exitDoor, pos: new THREE.Vector3(0, 0, HALF_D - 0.9) });

  /* ---------- 照明 ---------- */
  group.add(new THREE.HemisphereLight('#ffffff', night ? '#2a2f55' : '#d8c8b0', night ? 1.4 : 2.6));
  const sun = new THREE.DirectionalLight('#ffffff', night ? 0.6 : 1.3);
  sun.position.set(3, 8, 6);
  group.add(sun);

  return { group, colliders, interactables };
}

export function disposeRoom(group) {
  group.traverse((o) => {
    o.geometry?.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) { m.map?.dispose?.(); m.dispose?.(); }
  });
}
