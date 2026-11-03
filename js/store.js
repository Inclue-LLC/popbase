/*
 * 3D の店内（CSS 3D Transform）
 * --------------------------------------------------
 * 部屋の座標系（単位 px）：x 右が＋ / y 下が＋ / z 手前が＋
 *   左右の壁 x = ±700、床 y = 340、天井 y = -300、奥の壁 z = -1000、手前の端 z = 400
 * 視点（カメラ）は VIEWS のプリセットで移動します。
 */
(function () {
  const { THEMES, STORE_LAYOUT, PRODUCTS, CHARACTERS, SHOP, Art } = window;

  const PERSPECTIVE = 900;
  const STAGE_H = 700;
  const ROOM = { w: 1400, h: 640, floorY: 340, ceilY: -300, back: -1000, front: 400 };
  const UNIT_Z = -290; // 左右の棚の中心の奥行き位置
  const DEPTH = ROOM.front - ROOM.back; // 1400
  const MID_Z = (ROOM.front + ROOM.back) / 2; // -300
  const WALL_Y = (ROOM.floorY + ROOM.ceilY) / 2; // 20

  const VIEWS = [
    { id: 'left', label: '左の棚', x: -150, y: -30, z: 1190, yaw: -90, pitch: 0 },
    { id: 'overview', label: '店内全体', x: 0, y: 0, z: 150, yaw: 0, pitch: 0 },
    { id: 'island', label: '限定テーブル', x: 0, y: 60, z: 950, yaw: 0, pitch: -16 },
    { id: 'back', label: '正面', x: 0, y: -20, z: 600, yaw: 0, pitch: 0 },
    { id: 'right', label: '右の棚', x: 150, y: -30, z: 1190, yaw: 90, pitch: 0 },
  ];
  const ORDER = ['left', 'overview', 'island', 'back', 'right'];

  let theme;
  let viewId = 'overview';
  const $ = (s, r = document) => r.querySelector(s);
  const yen = (n) => `¥${n.toLocaleString('ja-JP')}`;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- 柄（壁紙） ---------- */
  const svgUrl = (svg) => `url('data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, '%27')}')`;
  const NS = 'xmlns="http://www.w3.org/2000/svg"';
  const cloudShape = (fill, op = 1) =>
    `<g fill="${fill}" opacity="${op}"><circle cx="-18" cy="2" r="13"/><circle cx="0" cy="-6" r="18"/><circle cx="19" cy="2" r="12"/><rect x="-30" y="0" width="60" height="15" rx="7.5"/></g>`;
  const star = (cx, cy, R, fill, op = 1) =>
    `<polygon points="${Art.starPoints(cx, cy, R, R * 0.45)}" fill="${fill}" opacity="${op}" stroke="${fill}" stroke-width="${R * 0.25}" stroke-linejoin="round"/>`;
  const flower = (cx, cy, r, fill, center = '#ffd76a') =>
    [0, 1, 2, 3, 4].map((i) => {
      const a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
      return `<circle cx="${(cx + Math.cos(a) * r).toFixed(1)}" cy="${(cy + Math.sin(a) * r).toFixed(1)}" r="${r * 0.75}" fill="${fill}"/>`;
    }).join('') + `<circle cx="${cx}" cy="${cy}" r="${r * 0.6}" fill="${center}"/>`;
  const heart = (cx, cy, s, fill) =>
    `<path transform="translate(${cx} ${cy}) scale(${s})" d="M0 6 C-10 -2 -8 -10 -3 -10 C-1 -10 0 -8 0 -7 C0 -8 1 -10 3 -10 C8 -10 10 -2 0 6Z" fill="${fill}"/>`;

  const patterns = {
    none: () => 'none',
    clouds: (fg) => svgUrl(`<svg ${NS} width="240" height="170"><g transform="translate(55 45)">${cloudShape(fg, 0.95)}</g><g transform="translate(170 120) scale(.7)">${cloudShape(fg, 0.75)}</g></svg>`),
    stars: (fg) => svgUrl(`<svg ${NS} width="150" height="150">${star(32, 34, 9, fg)}${star(108, 92, 6, fg, 0.8)}${star(52, 122, 4, fg, 0.6)}<circle cx="120" cy="24" r="1.6" fill="${fg}"/><circle cx="84" cy="54" r="1.2" fill="${fg}" opacity=".7"/><circle cx="20" cy="88" r="1.4" fill="${fg}" opacity=".7"/></svg>`),
    flowers: (fg) => svgUrl(`<svg ${NS} width="130" height="130">${flower(32, 32, 8, fg)}<g opacity=".8">${flower(98, 96, 6, fg)}</g><circle cx="98" cy="28" r="2" fill="${fg}"/><circle cx="26" cy="100" r="2" fill="${fg}"/></svg>`),
    hearts: (fg) => svgUrl(`<svg ${NS} width="110" height="110">${heart(28, 30, 1.3, fg)}${heart(82, 84, 1, fg)}</svg>`),
    dots: (fg) => `radial-gradient(${fg} 22%, transparent 23%) 0 0 / 44px 44px`,
    stripes: (fg) => `repeating-linear-gradient(90deg, transparent 0 46px, ${fg} 46px 92px)`,
    gingham: (fg) => `linear-gradient(90deg, ${fg}88 50%, transparent 50%) 0 0 / 60px 60px, linear-gradient(${fg}88 50%, transparent 50%) 0 0 / 60px 60px`,
  };

  /* 光と影（壁・床の背景の一番上に重ねる） */
  const SHADE = {
    back: 'radial-gradient(ellipse 60% 55% at 50% 0%, rgba(255,255,255,.28), transparent 70%), linear-gradient(to bottom, transparent 70%, rgba(0,0,0,.08))',
    left: 'linear-gradient(to left, rgba(0,0,0,.14), transparent 35%, transparent 80%, rgba(0,0,0,.06))',
    right: 'linear-gradient(to right, rgba(0,0,0,.14), transparent 35%, transparent 80%, rgba(0,0,0,.06))',
    floor: 'linear-gradient(to bottom, rgba(0,0,0,.18), transparent 55%)',
    nightWall: 'radial-gradient(ellipse 45% 55% at 50% 62%, rgba(255,226,150,.22), transparent 70%), linear-gradient(to bottom, rgba(0,0,0,.25), transparent 40%, rgba(0,0,0,.2))',
    nightFloor: 'radial-gradient(ellipse at 50% 45%, rgba(255,226,150,.12), rgba(0,0,0,.35) 75%)',
  };
  const shadeFor = (t, part) => (t.light === 'night' ? (part === 'floor' ? SHADE.nightFloor : `${SHADE.nightWall}, ${SHADE[part]}`) : SHADE[part]);

  function wallBackground(t, part) {
    const shade = shadeFor(t, part);
    if (t.wall.image) return `background:${shade}, url('${t.wall.image}') center / cover, ${t.wall.color}`;
    const p = (patterns[t.wall.pattern] || patterns.none)(t.wall.patternColor);
    return `background:${shade},${p === 'none' ? '' : p + ','} ${t.wall.color}`;
  }

  function floorBackground(t) {
    const [a, b] = t.floor.colors;
    const sh = shadeFor(t, 'floor');
    if (t.floor.image) return `background:${sh}, url('${t.floor.image}') center / 400px, ${a}`;
    switch (t.floor.style) {
      case 'check': return `background: ${sh}, conic-gradient(${a} 25%, ${b} 0 50%, ${a} 0 75%, ${b} 0) 0 0 / 150px 150px`;
      case 'tile': return `background: ${sh}, linear-gradient(90deg, ${b} 3px, transparent 3px) 0 0 / 110px 110px, linear-gradient(${b} 3px, transparent 3px) 0 0 / 110px 110px, ${a}`;
      case 'carpet': return `background: ${sh}, radial-gradient(ellipse at 50% 45%, ${b}, ${a} 75%)`;
      default: return `background: ${sh}, repeating-linear-gradient(0deg, transparent 0 238px, rgba(0,0,0,.06) 238px 240px), repeating-linear-gradient(90deg, ${a} 0 98px, rgba(0,0,0,.07) 98px 100px, ${b} 100px 198px, rgba(0,0,0,.07) 198px 200px)`;
    }
  }

  function garland(width, colors) {
    if (!colors) return '';
    const sag = 46;
    const n = Math.floor(width / 64);
    const pt = (t) => ({ x: width * t, y: 8 + 4 * sag * t * (1 - t) });
    let flags = '';
    for (let i = 1; i < n; i++) {
      const { x, y } = pt(i / n);
      flags += `<path d="M${x - 18} ${y} L${x + 18} ${y} L${x} ${y + 34} Z" fill="${colors[i % colors.length]}"/>`;
    }
    return `<svg class="garland" viewBox="0 0 ${width} 100" width="${width}" height="100" aria-hidden="true">
      <path d="M0 8 Q${width / 2} ${8 + 2 * sag} ${width} 8" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="2"/>${flags}</svg>`;
  }

  /* ---------- 吊り飾り ---------- */
  const hangingSVG = {
    cloud: () => `<svg viewBox="-34 -26 68 44">${cloudShape('#ffffff')}</svg>`,
    star: () => `<svg viewBox="-24 -24 48 48">${star(0, 0, 18, '#ffd76a')}</svg>`,
    moon: () => `<svg viewBox="0 0 48 48"><path d="M30 6 a19 19 0 1 0 12 30 a15 15 0 1 1 -12 -30z" fill="#fff1a8"/></svg>`,
    ornament: (i) => {
      const c = ['#c94a4a', '#2f6b4f', '#ffd76a', '#4a90c8'][i % 4];
      return `<svg viewBox="0 0 48 56"><rect x="18" y="0" width="12" height="8" rx="2" fill="#d4af37"/><circle cx="24" cy="32" r="21" fill="${c}"/><path d="M6 30 Q24 40 42 30" stroke="#fff" stroke-width="3" fill="none" opacity=".7"/><circle cx="16" cy="24" r="4" fill="#fff" opacity=".5"/></svg>`;
    },
    snow: () => `<svg viewBox="-24 -24 48 48"><g stroke="#ffffff" stroke-width="3.5" stroke-linecap="round">${[0, 60, 120].map((a) => `<line x1="0" y1="-20" x2="0" y2="20" transform="rotate(${a})"/>`).join('')}</g><circle r="4" fill="#cfe8ff"/></svg>`,
    flower: (i) => `<svg viewBox="-24 -24 48 48">${flower(0, 0, 10, ['#ffb3c6', '#ffffff', '#fff1a8'][i % 3])}</svg>`,
    heart: () => `<svg viewBox="-16 -14 32 26">${heart(0, 0, 1.4, '#ff8fa8')}</svg>`,
    balloon: (i) => {
      const c = ['#ffb3c6', '#8fc8f0', '#ffd76a', '#c9b8f0'][i % 4];
      return `<svg viewBox="0 0 40 56"><ellipse cx="20" cy="22" rx="17" ry="21" fill="${c}"/><path d="M17 43 L23 43 L20 48 Z" fill="${c}"/><ellipse cx="13" cy="14" rx="4" ry="6" fill="#fff" opacity=".5"/></svg>`;
    },
  };

  // 毎回同じ配置になる疑似乱数
  function rand(seed) {
    let s = seed;
    return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  }

  /* ---------- 小物 ---------- */
  function box({ w, h, d, x, y, z, cls, front = '', top = '', side = '', children = '' }) {
    const f = (fw, fh, tf, inner = '', extra = '') =>
      `<div class="box-face ${extra}" style="width:${fw}px;height:${fh}px;left:${-fw / 2}px;top:${-fh / 2}px;transform:${tf}">${inner}</div>`;
    return `<div class="box ${cls}" style="transform:translate3d(${x}px,${y}px,${z}px)">
      ${f(w, h, `translateZ(${d / 2}px)`, front, 'box-front')}
      ${f(w, h, `rotateY(180deg) translateZ(${d / 2}px)`, '', 'box-side')}
      ${f(d, h, `rotateY(-90deg) translateZ(${w / 2}px)`, side, 'box-side')}
      ${f(d, h, `rotateY(90deg) translateZ(${w / 2}px)`, side, 'box-side')}
      ${f(w, d, `rotateX(90deg) translateZ(${h / 2}px)`, top, 'box-top')}
      ${children}
    </div>`;
  }

  const ITEM_SIZE = { plush: 170, mug: 150, tote: 150, pouch: 140, note: 135, keychain: 130, sticker: 130 };

  function itemButton(p, extraStyle) {
    const size = ITEM_SIZE[p.shape] || 140;
    const flags = (p.stock === 0 ? '<span class="item-stamp">SOLD OUT</span>' : '') +
      (p.isNew ? '<span class="item-flag">NEW</span>' : '');
    return `<button class="item ${p.stock === 0 ? 'is-soldout' : ''}" data-product="${p.id}" style="width:${size}px;height:${size}px;${extraStyle}"
      aria-label="${esc(p.name)} ${yen(p.price)}"><span class="item-inner">${Art.productSVG(p)}${flags}</span></button>`;
  }

  function priceTag(p, style) {
    const short = p.name.replace(/【.*?】/g, '').trim();
    return `<span class="price-tag" style="${style}"><span class="pt-name">${esc(short)}</span><span class="pt-price">${yen(p.price)}</span></span>`;
  }

  function productsFor(zone) {
    const lay = STORE_LAYOUT[zone];
    return PRODUCTS.filter((p) => {
      if (p.display) return p.display === zone;
      if (zone === 'island') return !!p.limited;
      return !p.limited && lay.categories.includes(p.category);
    }).sort((a, b) => (lay.categories ? lay.categories.indexOf(a.category) - lay.categories.indexOf(b.category) : 0));
  }

  /* ---------- 壁（左右） ---------- */
  function sideWall(side) {
    const t = theme;
    const lay = STORE_LAYOUT[side];
    const items = productsFor(side);
    const unitW = 860;
    const unitCenter = DEPTH / 2 + (side === 'left' ? MID_Z - UNIT_Z : UNIT_Z - MID_Z);
    const unitLeft = unitCenter - unitW / 2;
    const rows = Math.min(3, Math.max(1, Math.ceil(items.length / 4)));
    const perRow = Math.ceil(items.length / rows);
    const planksY = rows === 3 ? [600, 432, 264] : rows === 2 ? [600, 400] : [560];

    let shelves = '';
    planksY.slice(0, rows).forEach((py, r) => {
      const rowItems = items.slice(r * perRow, (r + 1) * perRow);
      const gap = (unitW - 60) / Math.max(rowItems.length, 1);
      const rowItemsHtml = rowItems.map((p, i) => {
        const cx = unitLeft + 30 + gap * (i + 0.5);
        const size = ITEM_SIZE[p.shape] || 140;
        return itemButton(p, `left:${cx - size / 2}px;top:${py - size + 8}px`);
      }).join('');
      const tags = rowItems.map((p, i) => priceTag(p, `left:${30 + gap * (i + 0.5)}px`)).join('');
      shelves += `
        <div class="plank" style="left:${unitLeft + 4}px;width:${unitW - 8}px;top:${py - 14}px;background:${t.shelf.board}"></div>
        <div class="plank-lip" style="left:${unitLeft + 4}px;width:${unitW - 8}px;top:${py}px;background:${t.shelf.edge}">${tags}</div>
        ${rowItemsHtml}`;
    });

    const unitTop = planksY[rows - 1] - 210;
    const faceT = side === 'left' ? 'rotateY(90deg)' : 'rotateY(-90deg)';
    const x = side === 'left' ? -ROOM.w / 2 : ROOM.w / 2;
    return `
    <div class="face wall wall-${side}" data-zone="${side}" style="width:${DEPTH}px;height:${ROOM.h}px;left:${-DEPTH / 2}px;top:${-ROOM.h / 2}px;
      transform:translate3d(${x}px,${WALL_Y}px,${MID_Z}px) ${faceT};${wallBackground(t, side)}">
      <div class="wainscot" style="background:${t.wall.lower};border-top-color:${t.wall.trim}"></div>
      ${garland(DEPTH, t.garland)}
      <div class="shelf-unit" style="left:${unitLeft}px;width:${unitW}px;top:${unitTop}px;background:${t.shelf.back};border-color:${t.shelf.edge}"></div>
      <div class="zone-sign" style="left:${unitLeft + unitW / 2}px;top:${Math.max(56, unitTop - 70)}px;background:${t.sign.bg};color:${t.sign.ink}">
        <b>${esc(lay.title)}</b><small style="color:${t.sign.sub}">${esc(lay.label)}</small>
      </div>
      ${shelves}
    </div>`;
  }

  /* ---------- 奥の壁 ---------- */
  function backWall() {
    const t = theme;
    const mural = CHARACTERS.map((c) =>
      `<button class="mural-char" data-char="${c.id}" aria-label="${c.name}のグッズを見る">${Art.characterSVG(c)}<span>${c.name}</span></button>`).join('');
    return `
    <div class="face wall wall-back" data-zone="back" style="width:${ROOM.w}px;height:${ROOM.h}px;left:${-ROOM.w / 2}px;top:${-ROOM.h / 2}px;
      transform:translate3d(0,${WALL_Y}px,${ROOM.back}px);${wallBackground(t, 'back')}">
      <div class="wainscot" style="background:${t.wall.lower};border-top-color:${t.wall.trim}"></div>
      ${garland(ROOM.w, t.garland)}
      <div class="main-sign sign-${t.sign.style}" style="--sb:${t.sign.bg};--si:${t.sign.ink};--ss:${t.sign.sub}">
        <span class="ms-brand">${esc(SHOP.brand)}</span>
        <span class="ms-name">${esc(t.name)}</span>
        <span class="ms-title">${esc(t.title)}</span>
      </div>
      <div class="mural">${mural}</div>
      <div class="period-plate" style="background:${t.sign.bg};color:${t.sign.ink}">${esc(SHOP.period)}</div>
    </div>`;
  }

  /* ---------- 床置きの什器 ---------- */
  function furniture() {
    const t = theme;
    // 限定テーブル
    const lim = productsFor('island');
    const iw = 600; const ih = 170; const id = 220;
    const spacing = iw / Math.max(lim.length, 1);
    const topItems = lim.map((p, i) => {
      const x = -iw / 2 + spacing * (i + 0.5);
      const size = ITEM_SIZE[p.shape] || 140;
      return itemButton(p, `left:${x - size / 2}px;top:${-ih / 2 - size}px;transform:translateZ(-10px)`) +
        `<div class="stand-tag" style="transform:translate3d(${x}px,${-ih / 2}px,${id / 2 - 14}px) translate(-50%,-100%)">${priceTag(p, '')}</div>`;
    }).join('');
    const island = box({
      w: iw, h: ih, d: id, x: 0, y: ROOM.floorY - ih / 2, z: -650, cls: 'island',
      front: `<div class="island-front" style="background:${t.sign.bg};color:${t.sign.ink}"><b>${esc(STORE_LAYOUT.island.title)}</b><small style="color:${t.sign.sub}">${esc(STORE_LAYOUT.island.label)}</small></div>`,
      top: `<div class="island-top" style="background:${t.shelf.board}"></div>`,
      children: topItems,
    });

    // レジ
    const rw = 250; const rh = 120; const rd = 140;
    const register = box({
      w: rw, h: rh, d: rd, x: -540, y: ROOM.floorY - rh / 2, z: -880, cls: 'register',
      front: `<div class="register-front" style="background:${t.shelf.back};border-color:${t.shelf.edge}">REGISTER</div>`,
      top: `<div class="island-top" style="background:${t.shelf.board}"></div>`,
      children: `<button class="register-sign" data-action="cart" style="transform:translate3d(0,${-rh / 2}px,0) translate(-50%,-100%);background:${t.sign.bg};color:${t.sign.ink}" aria-label="レジ（カートを見る）">
        <svg viewBox="0 0 24 24"><path d="M6 7h12l-1.2 11.2a2 2 0 0 1-2 1.8H9.2a2 2 0 0 1-2-1.8L6 7zm3 0V6a3 3 0 0 1 6 0v1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span>お会計</span><small id="registerCount"></small>
      </button>`,
    });

    // ガチャマシン
    const gacha = `<button class="gacha-prop" data-action="gacha" style="transform:translate3d(540px,${ROOM.floorY}px,-880px) translate(-50%,-100%)" aria-label="クーポンガチャへ">
      <svg viewBox="0 0 160 280" aria-hidden="true">
        <rect x="18" y="150" width="124" height="120" rx="16" fill="#e0607e"/>
        <rect x="34" y="218" width="40" height="32" rx="8" fill="rgba(58,51,70,.35)"/>
        <circle cx="112" cy="190" r="20" fill="#fff"/><rect x="107" y="174" width="10" height="32" rx="5" fill="#ffd76a"/>
        <path d="M14 156 a66 66 0 0 1 132 0 v4 h-132z" fill="rgba(255,255,255,.75)" stroke="#fff" stroke-width="5"/>
        ${['#8fc8f0', '#ffd76a', '#c9b8f0', '#f2b8a0', '#ffb3c6', '#a8e0c0', '#8fc8f0', '#ffd76a'].map((c, i) =>
          `<circle cx="${38 + (i % 4) * 28}" cy="${138 - Math.floor(i / 4) * 26}" r="12" fill="${c}"/>`).join('')}
        <rect x="40" y="58" width="80" height="22" rx="11" fill="#fff"/><text x="80" y="74" text-anchor="middle" font-size="12" font-weight="800" fill="#e0607e" font-family="sans-serif">GACHA</text>
      </svg></button>`;

    return island + register + gacha;
  }

  function hangings() {
    const r = rand(7);
    const kinds = theme.hangings || [];
    if (!kinds.length) return '';
    let out = '';
    for (let i = 0; i < 16; i++) {
      let x = -300 + r() * 600;
      x += x < 0 ? -300 : 300; // 中央（看板の前）はあけて左右に吊るす
      const z = -950 + r() * 850;
      const drop = 30 + r() * 130;
      const size = 44 + r() * 36;
      const kind = kinds[i % kinds.length];
      out += `<div class="hang" data-x="${x.toFixed(0)}" data-z="${z.toFixed(0)}" style="transform:translate3d(${x.toFixed(0)}px,${ROOM.ceilY}px,${z.toFixed(0)}px)">
        <div class="hang-inner" style="animation-delay:${(-r() * 4).toFixed(2)}s">
          <span class="hang-string" style="height:${drop.toFixed(0)}px"></span>
          <span class="hang-deco" style="width:${size.toFixed(0)}px">${hangingSVG[kind](i)}</span>
        </div></div>`;
    }
    return out;
  }

  /* ---------- 組み立て ---------- */
  function render() {
    const t = theme;
    const lights = [-400, 0, 400].flatMap((x) => [300, 700].map((y) => `<span class="downlight" style="left:${700 + x}px;top:${y}px"></span>`)).join('');
    $('#storeRoom').innerHTML = `
      ${backWall()}
      ${sideWall('left')}
      ${sideWall('right')}
      <div class="face floor" style="width:${ROOM.w}px;height:${DEPTH}px;left:${-ROOM.w / 2}px;top:${-DEPTH / 2}px;
        transform:translate3d(0,${ROOM.floorY}px,${MID_Z}px) rotateX(90deg);${floorBackground(t)}">
        <span class="rug" style="background:${t.rug}"></span>
        <span class="floor-shadow" style="left:160px;top:120px;width:260px;height:160px"></span>
        <span class="floor-shadow" style="left:1130px;top:110px;width:160px;height:110px"></span>
      </div>
      <div class="face ceiling" style="width:${ROOM.w}px;height:${DEPTH}px;left:${-ROOM.w / 2}px;top:${-DEPTH / 2}px;
        transform:translate3d(0,${ROOM.ceilY}px,${MID_Z}px) rotateX(-90deg);background:${t.ceiling}">${lights}</div>
      ${furniture()}
      ${hangings()}`;
    $('#storeStage').dataset.light = t.light;
    window.App?.refreshRegister?.();
    applyView(false);
  }

  function applyView(animate = true) {
    const v = VIEWS.find((x) => x.id === viewId);
    const room = $('#storeRoom');
    room.style.transition = animate ? '' : 'none';
    room.style.transform = `translateZ(${PERSPECTIVE}px) rotateX(${v.pitch}deg) rotateY(${v.yaw}deg) translate3d(${v.x}px,${v.y}px,${v.z - PERSPECTIVE}px)`;
    // 吊り飾りは常にこちらを向く
    room.querySelectorAll('.hang').forEach((h) => {
      h.style.transform = `translate3d(${h.dataset.x}px,${ROOM.ceilY}px,${h.dataset.z}px) rotateY(${-v.yaw}deg)`;
    });
    if (!animate) { void room.offsetWidth; room.style.transition = ''; }
    document.querySelectorAll('.view-btn').forEach((b) => b.setAttribute('aria-pressed', b.dataset.view === viewId));
    $('#viewLabel').textContent = v.label;
    $('#storeStage').dataset.view = viewId;
  }

  function go(id) { viewId = id; applyView(true); }
  function step(dir) {
    const i = ORDER.indexOf(viewId);
    go(ORDER[(i + dir + ORDER.length) % ORDER.length]);
  }

  /* ---------- 画面サイズに合わせて拡縮 ---------- */
  function fit() {
    const vp = $('#storeViewport');
    const w = vp.clientWidth;
    const s = Math.min(1, Math.max(0.5, w / 1200));
    const stage = $('#storeStage');
    stage.style.width = `${w / s}px`;
    stage.style.height = `${STAGE_H}px`;
    stage.style.transform = `scale(${s})`;
    vp.style.height = `${STAGE_H * s}px`;
  }

  /* ---------- テーマ ---------- */
  function setTheme(id, { updateUrl = false } = {}) {
    const key = THEMES[id] ? id : Object.keys(THEMES)[0];
    theme = THEMES[key];
    SHOP.themeId = key;
    SHOP.themeLabel = `${theme.name} ― ${theme.title}`;
    const root = document.documentElement.style;
    root.setProperty('--theme-top', theme.entrance.top);
    root.setProperty('--theme-bottom', theme.entrance.bottom);
    document.querySelectorAll('[data-bind="themeLabel"]').forEach((el) => { el.textContent = SHOP.themeLabel; });
    const sel = $('#themeSelect');
    if (sel) sel.value = key;
    if (updateUrl) {
      try {
        const u = new URL(location.href);
        u.searchParams.set('theme', key);
        history.replaceState(null, '', u);
      } catch { /* file:// などでは無視 */ }
    }
    if ($('#storeRoom')) render();
  }

  function init() {
    const params = new URLSearchParams(location.search);
    setTheme(params.get('theme') || SHOP.theme);

    $('#viewButtons').innerHTML = VIEWS.map((v) =>
      `<button class="view-btn" data-view="${v.id}" aria-pressed="false">${v.label}</button>`).join('');
    $('#themeSelect').innerHTML = Object.entries(THEMES).map(([id, t]) =>
      `<option value="${id}">${esc(t.name)}（${esc(t.title)}）</option>`).join('');
    $('#themeSelect').value = SHOP.themeId;

    fit();
    render();
    window.addEventListener('resize', fit);
    if ('ResizeObserver' in window) new ResizeObserver(fit).observe($('#storeViewport'));

    $('#viewButtons').addEventListener('click', (e) => { const b = e.target.closest('.view-btn'); if (b) go(b.dataset.view); });
    $('#viewPrev').addEventListener('click', () => step(-1));
    $('#viewNext').addEventListener('click', () => step(1));
    $('#themeSelect').addEventListener('change', (e) => setTheme(e.target.value, { updateUrl: true }));
    $('#storeViewport').addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    });

    $('#storeRoom').addEventListener('click', (e) => {
      const item = e.target.closest('[data-product]');
      if (item) return window.App?.openProduct(item.dataset.product);
      const ch = e.target.closest('[data-char]');
      if (ch) return window.App?.showCharacter(ch.dataset.char);
      const act = e.target.closest('[data-action]');
      if (act?.dataset.action === 'cart') return window.App?.openCart();
      if (act?.dataset.action === 'gacha') return document.getElementById('gacha').scrollIntoView({ behavior: 'smooth' });
      // 全体表示で壁をクリックしたら、その壁に近づく
      const wall = e.target.closest('[data-zone]');
      if (wall && viewId === 'overview') go(wall.dataset.zone);
    });
  }

  // 入口の表示より前にテーマ色を反映
  setTheme(new URLSearchParams(location.search).get('theme') || SHOP.theme);
  window.Store = { init, render, go, setTheme };
})();
