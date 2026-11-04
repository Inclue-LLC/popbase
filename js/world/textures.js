/*
 * テクスチャ（壁紙・床・看板・商品・キャラクター）を canvas で描く
 * テーマの色・柄・画像から毎回生成するので、内装テーマの変更にそのまま追従します。
 */
import * as THREE from '../../vendor/three.module.min.js';

// 看板・値札の文字。店内管理画面で選んだショップのフォント（js/event.js の applyFont）を使う
const DEFAULT_FONT = "'M PLUS Rounded 1c', 'Hiragino Maru Gothic ProN', 'Yu Gothic', sans-serif";
export const font = () => window.SHOP?.fontStack || DEFAULT_FONT;
export const PPM = 128; // 壁・看板の解像度（1m あたりの px）

const imageCache = new Map();

/** URL（画像 or data URI）を読み込む。失敗したら null */
export function loadImage(url) {
  if (!url) return Promise.resolve(null);
  if (imageCache.has(url)) return imageCache.get(url);
  const p = new Promise((resolve) => {
    const img = new Image();
    if (!url.startsWith('data:')) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
  imageCache.set(url, p);
  return p;
}

/** インライン SVG 文字列を画像として読み込む */
export function svgImage(svg, w = 256, h = 256) {
  let s = svg.trim();
  if (!/xmlns=/.test(s)) s = s.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  s = s.replace('<svg', `<svg width="${w}" height="${h}"`);
  return loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`);
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.round(w));
  c.height = Math.max(2, Math.round(h));
  return c;
}

export function toTexture(canvas, { repeat } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/* ---------- 壁紙の柄 ---------- */
const cloudShape = (fill, op = 1) =>
  `<g fill="${fill}" opacity="${op}"><circle cx="-18" cy="2" r="13"/><circle cx="0" cy="-6" r="18"/><circle cx="19" cy="2" r="12"/><rect x="-30" y="0" width="60" height="15" rx="7.5"/></g>`;
const star = (cx, cy, R, fill, op = 1) =>
  `<polygon points="${window.Art.starPoints(cx, cy, R, R * 0.45)}" fill="${fill}" opacity="${op}" stroke="${fill}" stroke-width="${R * 0.25}" stroke-linejoin="round"/>`;
const flower = (cx, cy, r, fill, center = '#ffd76a') =>
  [0, 1, 2, 3, 4].map((i) => {
    const a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
    return `<circle cx="${(cx + Math.cos(a) * r).toFixed(1)}" cy="${(cy + Math.sin(a) * r).toFixed(1)}" r="${r * 0.75}" fill="${fill}"/>`;
  }).join('') + `<circle cx="${cx}" cy="${cy}" r="${r * 0.6}" fill="${center}"/>`;
const heart = (cx, cy, s, fill) =>
  `<path transform="translate(${cx} ${cy}) scale(${s})" d="M0 6 C-10 -2 -8 -10 -3 -10 C-1 -10 0 -8 0 -7 C0 -8 1 -10 3 -10 C8 -10 10 -2 0 6Z" fill="${fill}"/>`;

// [svg, 1タイルの幅(m)]
const PATTERN_TILES = {
  clouds: (fg) => [`<svg viewBox="0 0 240 170"><g transform="translate(55 45)">${cloudShape(fg, 0.95)}</g><g transform="translate(170 120) scale(.7)">${cloudShape(fg, 0.75)}</g></svg>`, 1.5, 240, 170],
  stars: (fg) => [`<svg viewBox="0 0 150 150">${star(32, 34, 9, fg)}${star(108, 92, 6, fg, 0.8)}${star(52, 122, 4, fg, 0.6)}<circle cx="120" cy="24" r="1.6" fill="${fg}"/><circle cx="84" cy="54" r="1.2" fill="${fg}" opacity=".7"/></svg>`, 0.9, 150, 150],
  flowers: (fg) => [`<svg viewBox="0 0 130 130">${flower(32, 32, 8, fg)}<g opacity=".8">${flower(98, 96, 6, fg)}</g></svg>`, 0.8, 130, 130],
  hearts: (fg) => [`<svg viewBox="0 0 110 110">${heart(28, 30, 1.3, fg)}${heart(82, 84, 1, fg)}</svg>`, 0.7, 110, 110],
};

/** 壁一面のテクスチャ（壁紙＋腰壁＋巾木＋陰影） */
export async function wallTexture(theme, widthM, heightM, { door = false } = {}) {
  const W = widthM * PPM;
  const H = heightM * PPM;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const wall = theme.wall;

  ctx.fillStyle = wall.color;
  ctx.fillRect(0, 0, W, H);
  const img = await loadImage(wall.image);
  if (img) {
    // 実画像：高さに合わせて横方向に並べる
    const h = H;
    const w = (img.width / img.height) * h;
    for (let x = 0; x < W; x += w) ctx.drawImage(img, x, 0, w, h);
  } else if (PATTERN_TILES[wall.pattern]) {
    const [svg, tileM, vw, vh] = PATTERN_TILES[wall.pattern](wall.patternColor);
    const tw = tileM * PPM;
    const tile = await svgImage(svg, tw, (tw * vh) / vw);
    if (tile) {
      ctx.fillStyle = ctx.createPattern(tile, 'repeat');
      ctx.fillRect(0, 0, W, H);
    }
  } else if (wall.pattern === 'stripes') {
    ctx.fillStyle = wall.patternColor;
    const s = 0.36 * PPM;
    for (let x = s; x < W; x += s * 2) ctx.fillRect(x, 0, s, H);
  } else if (wall.pattern === 'dots') {
    ctx.fillStyle = wall.patternColor;
    const s = 0.34 * PPM;
    for (let y = s / 2; y < H; y += s) for (let x = s / 2; x < W; x += s) { ctx.beginPath(); ctx.arc(x, y, s * 0.2, 0, 7); ctx.fill(); }
  } else if (wall.pattern === 'gingham') {
    ctx.fillStyle = `${wall.patternColor}88`;
    const s = 0.24 * PPM;
    for (let x = 0; x < W; x += s * 2) ctx.fillRect(x, 0, s, H);
    for (let y = 0; y < H; y += s * 2) ctx.fillRect(0, y, W, s);
  }

  // 腰壁・見切り・巾木
  if (wall.lower && wall.lower !== 'none') {
    const lh = 1.15 * PPM;
    ctx.fillStyle = wall.lower;
    ctx.fillRect(0, H - lh, W, lh);
    ctx.fillStyle = wall.trim;
    ctx.fillRect(0, H - lh - 0.07 * PPM, W, 0.07 * PPM);
  }
  ctx.fillStyle = 'rgba(0,0,0,.14)';
  ctx.fillRect(0, H - 0.12 * PPM, W, 0.12 * PPM);

  if (door) drawDoor(ctx, W, H, theme);

  // 陰影（天井付近を明るく、四隅を暗く）
  let g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, theme.light === 'night' ? 'rgba(0,0,0,.35)' : 'rgba(255,255,255,.18)');
  g.addColorStop(0.5, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,.12)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, 'rgba(0,0,0,.16)');
  g.addColorStop(0.12, 'rgba(0,0,0,0)');
  g.addColorStop(0.88, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,.16)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  if (theme.light === 'night') {
    // 棚を照らすスポットライト
    for (const fx of [0.25, 0.5, 0.75]) {
      const rg = ctx.createRadialGradient(W * fx, H * 0.55, 0, W * fx, H * 0.55, H * 0.6);
      rg.addColorStop(0, 'rgba(255,226,150,.22)');
      rg.addColorStop(1, 'rgba(255,226,150,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, H);
    }
  }
  return toTexture(c);
}

function drawDoor(ctx, W, H, theme) {
  const dw = 2.6 * PPM;
  const dh = 2.9 * PPM;
  const x = (W - dw) / 2;
  const y = H - dh;
  ctx.fillStyle = theme.wall.trim;
  rr(ctx, x - 14, y - 14, dw + 28, dh + 14, [18, 18, 0, 0]);
  ctx.fill();
  const g = ctx.createLinearGradient(0, y, 0, H);
  g.addColorStop(0, '#cfe9fb');
  g.addColorStop(1, '#f6fbff');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, dw, dh);
  ctx.fillStyle = 'rgba(255,255,255,.55)';
  ctx.fillRect(x + dw * 0.12, y + 10, 18, dh - 20);
  ctx.fillRect(x + dw * 0.62, y + 10, 18, dh - 20);
  ctx.fillStyle = theme.wall.trim;
  ctx.fillRect(x + dw / 2 - 5, y, 10, dh);
  ctx.fillRect(x + dw / 2 - 30, y + dh * 0.5, 14, 60);
  ctx.fillRect(x + dw / 2 + 16, y + dh * 0.5, 14, 60);
  ctx.fillStyle = theme.sign.bg;
  rr(ctx, W / 2 - 1.1 * PPM, y - 0.62 * PPM, 2.2 * PPM, 0.42 * PPM, 20);
  ctx.fill();
  ctx.fillStyle = theme.sign.ink;
  ctx.font = `800 ${0.22 * PPM}px ${font()}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('EXIT', W / 2, y - 0.41 * PPM);
}

/** 床（4m 四方のタイルを繰り返す。carpet は一枚絵） */
export async function floorTexture(theme, sizeM) {
  const f = theme.floor;
  const [a, b] = f.colors;
  const img = await loadImage(f.image);
  if (img) {
    const c = makeCanvas(1024, 1024);
    c.getContext('2d').drawImage(img, 0, 0, 1024, 1024);
    return toTexture(c, { repeat: [sizeM / 3, sizeM / 3] });
  }
  if (f.style === 'carpet') {
    const c = makeCanvas(1024, 1024);
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(512, 560, 40, 512, 560, 720);
    g.addColorStop(0, b);
    g.addColorStop(1, a);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 4000; i++) {
      ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.04})`;
      ctx.fillRect(Math.random() * 1024, Math.random() * 1024, 2, 2);
    }
    return toTexture(c);
  }
  const TILE = 3; // m
  const S = 1024;
  const px = S / TILE;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  ctx.fillStyle = a;
  ctx.fillRect(0, 0, S, S);
  if (f.style === 'check') {
    const s = 0.75 * px;
    ctx.fillStyle = b;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if ((x + y) % 2) ctx.fillRect(x * s, y * s, s, s);
  } else if (f.style === 'tile') {
    const s = 0.6 * px;
    ctx.fillStyle = b;
    for (let i = 0; i <= 5; i++) { ctx.fillRect(i * s - 2, 0, 4, S); ctx.fillRect(0, i * s - 2, S, 4); }
  } else {
    // 木目：幅 25cm の板。継ぎ目をずらす
    const s = 0.25 * px;
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = i % 2 ? b : a;
      ctx.fillRect(i * s, 0, s, S);
      ctx.fillStyle = 'rgba(0,0,0,.08)';
      ctx.fillRect(i * s, 0, 3, S);
      const off = ((i * 37) % 10) / 10;
      ctx.fillRect(i * s, off * S, s, 3);
      for (let k = 0; k < 6; k++) {
        ctx.fillStyle = `rgba(90,60,30,${0.025 + Math.random() * 0.03})`;
        ctx.fillRect(i * s + Math.random() * s, Math.random() * S, 2, 40 + Math.random() * 120);
      }
    }
  }
  return toTexture(c, { repeat: [sizeM / TILE, sizeM / TILE] });
}

/**
 * 看板（角丸の板＋文字。style:'neon' で光る）
 * full: true … 台の側面などに貼る用。余白・角丸なしで端まで塗る（透明な部分が黒く見えるのを防ぐ）
 */
export function signTexture(lines, sign, wM, hM, { radius = 0.18, full = false } = {}) {
  const W = wM * PPM * 2;
  const H = hM * PPM * 2;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const pad = full ? 0 : sign.style === 'neon' ? 22 : 6;
  if (full) ctx.rect(0, 0, W, H);
  else rr(ctx, pad, pad, W - pad * 2, H - pad * 2, radius * PPM * 2);
  ctx.fillStyle = sign.bg;
  if (sign.style === 'neon' && !full) { ctx.shadowColor = sign.ink; ctx.shadowBlur = 24; }
  ctx.fill();
  if (sign.style === 'neon' && !full) { ctx.lineWidth = 8; ctx.strokeStyle = sign.ink; ctx.stroke(); }
  ctx.shadowBlur = 0;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const total = lines.reduce((s, l) => s + l.size, 0);
  let y = H / 2 - (total * H) / 2;
  for (const l of lines) {
    const fs = l.size * H;
    ctx.font = `${l.weight || 800} ${fs * 0.8}px ${font()}`;
    ctx.fillStyle = l.color || sign.ink;
    if (sign.style === 'neon') { ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 18; }
    if (l.spacing) ctx.letterSpacing = `${l.spacing}px`;
    fitText(ctx, l.text, W / 2, y + fs / 2, W - 60);
    ctx.letterSpacing = '0px';
    ctx.shadowBlur = 0;
    y += fs;
  }
  return toTexture(c);
}

/** 看板の文字が何 m の幅になるか（signTexture と同じ大きさ・フォントで測る） */
export function signTextWidth(lines, hM) {
  const H = hM * PPM * 2;
  const ctx = makeCanvas(4, 4).getContext('2d');
  let max = 0;
  for (const l of lines) {
    ctx.font = `${l.weight || 800} ${l.size * H * 0.8}px ${font()}`;
    ctx.letterSpacing = `${l.spacing || 0}px`;
    max = Math.max(max, ctx.measureText(String(l.text || '')).width);
  }
  return max / (PPM * 2);
}

function fitText(ctx, text, x, y, maxW) {
  const w = ctx.measureText(text).width;
  if (w > maxW) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(maxW / w, 1);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  } else ctx.fillText(text, x, y);
}

/** 値札（商品名＋価格） */
export function tagTexture(name, price, { soldOut = false } = {}) {
  const c = makeCanvas(512, 128);
  const ctx = c.getContext('2d');
  rr(ctx, 4, 4, 504, 120, 22);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(58,51,70,.15)';
  ctx.stroke();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#6f6880';
  ctx.font = `500 34px ${font()}`;
  let label = name.replace(/【.*?】/g, '').trim();
  while (ctx.measureText(label).width > 300 && label.length > 2) label = label.slice(0, -1);
  if (label !== name.replace(/【.*?】/g, '').trim()) label += '…';
  ctx.fillText(label, 26, 64);
  ctx.textAlign = 'right';
  ctx.fillStyle = soldOut ? '#c0392b' : '#3a3346';
  ctx.font = `800 42px ${font()}`;
  ctx.fillText(soldOut ? 'SOLD OUT' : `¥${price.toLocaleString('ja-JP')}`, 488, 64);
  return toTexture(c);
}

/** 商品画像（Shopify の写真 or 見本の SVG イラスト）→ [テクスチャ, 縦横比] */
export async function productTexture(p) {
  const S = 512;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  let img;
  if (p.image) img = await loadImage(p.image);
  else img = await svgImage(window.Art.productSVG(p), S, S);
  let aspect = 1;
  if (img) {
    aspect = img.width / img.height || 1;
    const w = aspect >= 1 ? S : S * aspect;
    const h = aspect >= 1 ? S / aspect : S;
    ctx.drawImage(img, (S - w) / 2, S - h, w, h);
  }
  if (p.stock === 0) {
    ctx.globalCompositeOperation = 'saturation';
    ctx.fillStyle = '#888';
    ctx.fillRect(0, 0, S, S);
    ctx.globalCompositeOperation = 'source-over';
  }
  if (p.isNew) {
    rr(ctx, S - 150, 12, 136, 54, 27);
    ctx.fillStyle = '#ffd76a';
    ctx.fill();
    ctx.fillStyle = '#5a4300';
    ctx.font = `800 34px ${font()}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('NEW', S - 82, 40);
  }
  return [toTexture(c), aspect];
}

/** キャラクター（アバター・壁の絵） */
export async function characterTexture(character, size = 256) {
  const img = character.image ? await loadImage(character.image) : await svgImage(window.Art.characterSVG(character), size, size);
  const c = makeCanvas(size, size);
  if (img) {
    // 縦横比を保って、下揃えで収める
    const k = Math.min(size / img.width, size / img.height);
    const w = img.width * k;
    const h = img.height * k;
    c.getContext('2d').drawImage(img, (size - w) / 2, size - h, w, h);
  }
  return toTexture(c);
}

/** 任意の SVG */
export async function svgTexture(svg, w, h) {
  const img = await svgImage(svg, w, h);
  const c = makeCanvas(w, h);
  if (img) c.getContext('2d').drawImage(img, 0, 0, w, h);
  return toTexture(c);
}

/** 柔らかい丸い影 */
export function shadowTexture() {
  const c = makeCanvas(128, 128);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return toTexture(c);
}
