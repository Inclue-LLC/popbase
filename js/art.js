/*
 * キャラクター・商品のイラスト（インラインSVG）
 * 実画像に差し替える場合は data.js の商品に `image: 'images/xxx.png'` を追加してください。
 */
(function () {
  const INK = '#3a3346';
  const CHEEK = '#ff9fb2';

  function face(cx, cy) {
    return `
      <ellipse cx="${cx - 17}" cy="${cy + 6}" rx="5" ry="3" fill="${CHEEK}" opacity=".7"/>
      <ellipse cx="${cx + 17}" cy="${cy + 6}" rx="5" ry="3" fill="${CHEEK}" opacity=".7"/>
      <circle cx="${cx - 10}" cy="${cy}" r="3.2" fill="${INK}"/>
      <circle cx="${cx + 10}" cy="${cy}" r="3.2" fill="${INK}"/>
      <circle cx="${cx - 9}" cy="${cy - 1.2}" r="1" fill="#fff"/>
      <circle cx="${cx + 11}" cy="${cy - 1.2}" r="1" fill="#fff"/>
      <path d="M${cx - 4} ${cy + 6} Q${cx} ${cy + 10} ${cx + 4} ${cy + 6}" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>`;
  }

  function starPoints(cx, cy, R, r) {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const rad = (Math.PI / 5) * i - Math.PI / 2;
      const len = i % 2 === 0 ? R : r;
      pts.push(`${(cx + Math.cos(rad) * len).toFixed(1)},${(cy + Math.sin(rad) * len).toFixed(1)}`);
    }
    return pts.join(' ');
  }

  const bodies = {
    cloud: (c) => `
      <g fill="${c.color}">
        <circle cx="28" cy="62" r="18"/><circle cx="50" cy="48" r="25"/><circle cx="73" cy="60" r="19"/>
        <rect x="26" y="56" width="50" height="24" rx="12"/>
      </g>
      <circle cx="42" cy="38" r="7" fill="#fff" opacity=".35"/>
      ${face(50, 60)}`,
    star: (c) => `
      <polygon points="${starPoints(50, 56, 40, 19)}" fill="${c.color}" stroke="${c.color}" stroke-width="10" stroke-linejoin="round"/>
      <circle cx="40" cy="44" r="4" fill="#fff" opacity=".5"/>
      ${face(50, 60)}`,
    rabbit: (c) => `
      <ellipse cx="37" cy="26" rx="9" ry="23" fill="${c.color}"/>
      <ellipse cx="63" cy="26" rx="9" ry="23" fill="${c.color}"/>
      <ellipse cx="37" cy="28" rx="4" ry="15" fill="#fff" opacity=".55"/>
      <ellipse cx="63" cy="28" rx="4" ry="15" fill="#fff" opacity=".55"/>
      <ellipse cx="50" cy="63" rx="32" ry="27" fill="${c.color}"/>
      <path d="M66 42 a7 7 0 1 0 6 9 a5.5 5.5 0 1 1 -6 -9z" fill="#fff6c8"/>
      ${face(50, 64)}`,
    bear: (c) => `
      <circle cx="25" cy="36" r="12" fill="${c.color}"/><circle cx="75" cy="36" r="12" fill="${c.color}"/>
      <circle cx="25" cy="36" r="6" fill="${c.accent}" opacity=".45"/><circle cx="75" cy="36" r="6" fill="${c.accent}" opacity=".45"/>
      <circle cx="50" cy="60" r="31" fill="${c.color}"/>
      <ellipse cx="50" cy="69" rx="11" ry="8" fill="#fff" opacity=".55"/>
      ${face(50, 60)}`,
  };

  /** キャラクターを (x, y) 中心・倍率 s で描画する <g> を返す（素体は 100×100） */
  function character(c, x = 50, y = 50, s = 1) {
    return `<g transform="translate(${x} ${y}) scale(${s}) translate(-50 -50)">${bodies[c.kind](c)}</g>`;
  }

  // 管理画面でイラストを画像に差し替えた場合は、その画像を表示する
  // イラストのないキャラクター（イベントで追加して画像をまだ選んでいない）は、色の丸に名前の頭文字
  function placeholderSVG(c) {
    const initial = String(c.name || '?').trim().charAt(0) || '?';
    const esc = (s) => s.replace(/[&<>"']/g, '');
    return `<circle cx="50" cy="54" r="38" fill="${esc(c.color || '#e6dcf3')}"/><circle cx="50" cy="54" r="38" fill="#fff" opacity=".18"/>
      <text x="50" y="66" text-anchor="middle" font-size="34" font-weight="700" fill="#fff" font-family="sans-serif">${esc(initial)}</text>`;
  }

  function characterSVG(c, cls = '') {
    if (!c.image && !bodies[c.kind]) return `<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true">${placeholderSVG(c)}</svg>`;
    if (c.image) {
      const src = String(c.image).replace(/["<>]/g, '');
      return `<img class="char-img ${cls}" src="${src}" alt="" aria-hidden="true" loading="lazy">`;
    }
    return `<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true">${character(c)}</svg>`;
  }

  function tint(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const mix = (v) => Math.round(v + (255 - v) * amt);
    return `rgb(${mix(n >> 16)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
  }

  const shapes = {
    plush: (c) => `
      <ellipse cx="100" cy="172" rx="58" ry="9" fill="${INK}" opacity=".08"/>
      ${character(c, 100, 98, 1.55)}`,
    keychain: (c) => `
      <circle cx="100" cy="28" r="13" fill="none" stroke="#b9b4c4" stroke-width="5"/>
      <rect x="97" y="40" width="6" height="18" rx="3" fill="#b9b4c4"/>
      <rect x="44" y="56" width="112" height="118" rx="34" fill="#fff" opacity=".75" stroke="#fff" stroke-width="3"/>
      ${character(c, 100, 116, 1.0)}`,
    sticker: (c) => {
      const all = window.CHARACTERS;
      return `
      <rect x="30" y="30" width="140" height="140" rx="22" fill="#fff" transform="rotate(-6 100 100)"/>
      ${character(all[0], 70, 72, 0.5)}${character(all[1], 130, 72, 0.5)}
      ${character(all[2], 70, 130, 0.5)}${character(all[3], 130, 130, 0.5)}`;
    },
    note: (c) => `
      <rect x="52" y="26" width="104" height="150" rx="8" fill="${tint(c.color, 0.35)}"/>
      <rect x="52" y="26" width="104" height="150" rx="8" fill="none" stroke="${c.accent}" stroke-width="3" opacity=".5"/>
      ${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="42" y="${40 + i * 22}" width="20" height="7" rx="3.5" fill="#b9b4c4"/>`).join('')}
      ${character(c, 106, 92, 0.8)}
      <rect x="74" y="146" width="62" height="6" rx="3" fill="#fff" opacity=".8"/>`,
    mug: (c) => `
      <path d="M140 80 h12 a22 22 0 0 1 0 44 h-12" fill="none" stroke="#fff" stroke-width="12"/>
      <rect x="44" y="58" width="104" height="112" rx="16" fill="#fff"/>
      <ellipse cx="96" cy="60" rx="52" ry="8" fill="${tint(c.color, 0.5)}"/>
      ${character(c, 96, 118, 0.78)}`,
    tote: (c) => `
      <path d="M72 70 v-22 a28 28 0 0 1 56 0 v22" fill="none" stroke="#e7dccb" stroke-width="9"/>
      <rect x="40" y="66" width="120" height="112" rx="6" fill="#f6efe2"/>
      ${character(c, 100, 120, 0.82)}`,
    pouch: (c) => `
      <rect x="34" y="62" width="132" height="98" rx="34" fill="${tint(c.color, 0.25)}"/>
      <path d="M50 80 H150" stroke="${c.accent}" stroke-width="4" stroke-dasharray="4 4"/>
      <circle cx="152" cy="80" r="6" fill="#d8d2e2"/>
      ${character(c, 100, 120, 0.62)}`,
  };

  // 画像がなく、自社のキャラクターでもない商品（他社のキャラクターなど）は「画像準備中」の絵にする
  const NO_IMAGE = `
      <rect x="40" y="40" width="120" height="132" rx="18" fill="#f6f0fb" stroke="#e3d8f0" stroke-width="3"/>
      <path d="M78 96 l20 -9 v26 l-20 9 z M96 104 l22 -10 v30 l-22 10 z" fill="#dccef5"/>
      <text x="100" y="152" text-anchor="middle" font-size="13" font-weight="700" fill="#9a8fa6" font-family="sans-serif">NO IMAGE</text>`;

  function productSVG(p) {
    const c = window.CHARACTERS.find((ch) => ch.id === p.character);
    if (p.image) return `<img src="${p.image}" alt="" loading="lazy">`;
    const shape = shapes[p.shape] || shapes.mug;
    return `<svg viewBox="0 0 200 200" aria-hidden="true">${c ? shape(c) : NO_IMAGE}</svg>`;
  }

  window.Art = { character, characterSVG, productSVG, tint, starPoints };
})();
