/*
 * POP UP イベントの設定（内装・会期・看板）と、棚の配置
 * --------------------------------------------------
 * 管理画面（admin/）・サイト・Shopify 連携で共通に使う形と変換処理です。
 *
 * イベント設定 event … { title, subtitle, period, theme_preset, wall_image, wall_color, ... }
 *   キーは Shopify のメタオブジェクト「POP UPイベント」のフィールドと同じ。
 *   空欄（'' / undefined）はベースのテーマの値を使う。
 *   画像は URL 文字列、または管理画面では { id, url }。
 *
 * 棚の配置 layout … {
 *   left:   [[id|null ×5], [..], [..]],   // 左の棚。行は下の段から順に3段、1段5枠
 *   right:  [[..], [..], [..]],           // 右の棚
 *   island: [id|null ×5],                 // 会場限定テーブル
 * }
 */
(function () {
  const ROWS = 3;
  const SLOTS = 5;
  const TABLE_SLOTS = 5;

  const opt = (pairs) => pairs.map(([value, label]) => ({ value, label }));

  /* 管理画面のフォーム定義 */
  const FIELDS = [
    { group: 'イベント', key: 'title', label: 'イベント名', hint: '看板の大きな文字', type: 'text' },
    { group: 'イベント', key: 'subtitle', label: 'サブタイトル', type: 'text' },
    { group: 'イベント', key: 'period', label: '会期', hint: '例: 2026.12.01 – 12.31', type: 'text' },
    { group: 'イベント', key: 'theme_preset', label: 'ベースのテーマ', hint: '下の項目で空欄のものは、このテーマの値になります', type: 'select', options: () => Object.entries(window.THEMES).filter(([k]) => k !== 'event').map(([k, t]) => ({ value: k, label: `${t.name}（${t.title}）` })) },
    { group: '壁', key: 'wall_image', label: '壁紙の画像', hint: '横長の画像（例: 2048×540px）。指定すると柄より優先', type: 'image' },
    { group: '壁', key: 'wall_color', label: '壁の色', type: 'color', themePath: 'wall.color' },
    { group: '壁', key: 'wall_pattern', label: '壁の柄', type: 'select', options: () => opt([['', 'テーマのまま'], ['clouds', '雲'], ['stars', '星'], ['flowers', '花'], ['hearts', 'ハート'], ['dots', '水玉'], ['stripes', 'ストライプ'], ['gingham', 'ギンガムチェック'], ['none', 'なし']]) },
    { group: '壁', key: 'wall_pattern_color', label: '柄の色', type: 'color', themePath: 'wall.patternColor' },
    { group: '壁', key: 'lower_color', label: '腰壁の色', hint: '壁の下の部分', type: 'color', themePath: 'wall.lower' },
    { group: '壁', key: 'trim_color', label: '見切りの色', hint: '腰壁の上のライン', type: 'color', themePath: 'wall.trim' },
    { group: '床', key: 'floor_image', label: '床の画像', hint: '正方形の画像。繰り返して貼られます', type: 'image' },
    { group: '床', key: 'floor_style', label: '床の種類', type: 'select', options: () => opt([['', 'テーマのまま'], ['wood', '木目'], ['check', 'チェック'], ['tile', 'タイル'], ['carpet', 'カーペット']]) },
    { group: '床', key: 'floor_color_1', label: '床の色 1', type: 'color', themePath: 'floor.colors.0' },
    { group: '床', key: 'floor_color_2', label: '床の色 2', type: 'color', themePath: 'floor.colors.1' },
    { group: '看板・照明', key: 'sign_color', label: '看板の色', type: 'color', themePath: 'sign.bg' },
    { group: '看板・照明', key: 'sign_text_color', label: '看板の文字色', type: 'color', themePath: 'sign.ink' },
    { group: '看板・照明', key: 'light', label: '照明', type: 'select', options: () => opt([['', 'テーマのまま'], ['day', '明るい'], ['night', '夜（暗め＋スポットライト）']]) },
    { group: '棚の看板', key: 'left_title', label: '左の棚（英字）', type: 'text', placeholderPath: 'layout.left.title' },
    { group: '棚の看板', key: 'left_label', label: '左の棚（日本語）', type: 'text', placeholderPath: 'layout.left.label' },
    { group: '棚の看板', key: 'right_title', label: '右の棚（英字）', type: 'text', placeholderPath: 'layout.right.title' },
    { group: '棚の看板', key: 'right_label', label: '右の棚（日本語）', type: 'text', placeholderPath: 'layout.right.label' },
    { group: '購入特典', key: 'novelty_threshold', label: '特典の条件金額（円）', type: 'number' },
    { group: '購入特典', key: 'novelty_name', label: '特典の名前', type: 'text' },
  ];
  const IMAGE_KEYS = FIELDS.filter((f) => f.type === 'image').map((f) => f.key);

  // 最初に読み込んだときの値（何度適用しても元に戻せるように保存しておく）
  const original = {
    theme: window.SHOP.theme,
    period: window.SHOP.period,
    novelty: { ...window.SHOP.novelty },
    layout: JSON.parse(JSON.stringify(window.STORE_LAYOUT)),
  };

  const imageUrl = (v) => (v && typeof v === 'object' ? v.url : v) || '';
  const has = (f, k) => f[k] != null && f[k] !== '';

  /** イベント設定をテーマ・会期・看板に反映する（何度呼んでもよい） */
  function applyEvent(f = {}) {
    const baseKey = has(f, 'theme_preset') && window.THEMES[f.theme_preset] ? f.theme_preset : original.theme;
    const theme = JSON.parse(JSON.stringify(window.THEMES[baseKey] || Object.values(window.THEMES)[0]));
    const set = (obj, key, field) => { if (has(f, field)) obj[key] = f[field]; };
    set(theme, 'name', 'title');
    set(theme, 'title', 'subtitle');
    if (imageUrl(f.wall_image)) theme.wall.image = imageUrl(f.wall_image);
    set(theme.wall, 'color', 'wall_color');
    set(theme.wall, 'pattern', 'wall_pattern');
    set(theme.wall, 'patternColor', 'wall_pattern_color');
    set(theme.wall, 'lower', 'lower_color');
    set(theme.wall, 'trim', 'trim_color');
    if (imageUrl(f.floor_image)) theme.floor.image = imageUrl(f.floor_image);
    set(theme.floor, 'style', 'floor_style');
    if (has(f, 'floor_color_1')) theme.floor.colors[0] = f.floor_color_1;
    if (has(f, 'floor_color_2')) theme.floor.colors[1] = f.floor_color_2;
    set(theme.sign, 'bg', 'sign_color');
    set(theme.sign, 'ink', 'sign_text_color');
    set(theme, 'light', 'light');
    window.THEMES.event = theme;

    const S = window.SHOP;
    S.period = has(f, 'period') ? f.period : original.period;
    S.novelty = { ...original.novelty };
    if (has(f, 'novelty_threshold')) S.novelty.threshold = Number(f.novelty_threshold);
    if (has(f, 'novelty_name')) S.novelty.name = f.novelty_name;

    const L = window.STORE_LAYOUT;
    for (const side of ['left', 'right']) {
      L[side].title = has(f, `${side}_title`) ? f[`${side}_title`] : original.layout[side].title;
      L[side].label = has(f, `${side}_label`) ? f[`${side}_label`] : original.layout[side].label;
    }
    window.applyThemeMeta?.('event');
    return theme;
  }

  /** 棚の配置を反映する。layout が空なら自動で並べる */
  function applyLayout(layout) {
    const L = window.STORE_LAYOUT;
    // 商品ごとの元の置き場所を覚えておき、何度呼んでも元に戻せるようにする
    for (const p of window.PRODUCTS) if (!('_display0' in p)) p._display0 = p.display ?? null;
    if (!layout) {
      delete L.left.rows; delete L.right.rows; delete L.island.items;
      for (const p of window.PRODUCTS) p.display = p._display0;
      return;
    }
    const n = normalize(layout);
    L.left.rows = n.left;
    L.right.rows = n.right;
    L.island.items = n.island;
    const placed = new Set([...n.left.flat(), ...n.right.flat(), ...n.island].filter(Boolean));
    for (const p of window.PRODUCTS) p.display = placed.has(p.id) ? (p._display0 === 'none' ? null : p._display0) : 'none';
  }

  /** 形を整える（足りない枠は null で埋め、存在しない商品は外す） */
  function normalize(layout, products = window.PRODUCTS) {
    const ids = new Set(products.map((p) => p.id));
    const used = new Set();
    const clean = (v) => {
      if (!v || !ids.has(v) || used.has(v)) return null;
      used.add(v);
      return v;
    };
    const rows = (src) => Array.from({ length: ROWS }, (_, r) => Array.from({ length: SLOTS }, (_, i) => clean(src?.[r]?.[i])));
    return {
      left: rows(layout?.left),
      right: rows(layout?.right),
      island: Array.from({ length: TABLE_SLOTS }, (_, i) => clean(layout?.island?.[i])),
    };
  }

  /** 今の自動配置と同じ並びで、配置データを作る（初回の下書き用） */
  function autoLayout(products = window.PRODUCTS) {
    const L = original.layout;
    const zoneOf = (p) => {
      if (p.display) return p.display;
      if (p.limited) return 'island';
      if ((L.left.categories || []).includes(p.category)) return 'left';
      if ((L.right.categories || []).includes(p.category)) return 'right';
      return null;
    };
    const by = (zone) => products.filter((p) => zoneOf(p) === zone && p.display !== 'none')
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) ||
        ((L[zone]?.categories || []).indexOf(a.category) - (L[zone]?.categories || []).indexOf(b.category)));
    const fill = (list) => {
      const out = Array.from({ length: ROWS }, () => Array(SLOTS).fill(null));
      list.slice(0, ROWS * SLOTS).forEach((p, i) => { out[Math.floor(i / SLOTS)][i % SLOTS] = p.id; });
      return out;
    };
    const island = Array(TABLE_SLOTS).fill(null);
    by('island').slice(0, TABLE_SLOTS).forEach((p, i) => { island[i] = p.id; });
    return { left: fill(by('left')), right: fill(by('right')), island };
  }

  /** 公開用：画像を URL 文字列にそろえる */
  function flatten(event = {}) {
    const out = { ...event };
    for (const k of IMAGE_KEYS) out[k] = imageUrl(out[k]);
    return out;
  }

  window.HaneulEvent = { FIELDS, IMAGE_KEYS, ROWS, SLOTS, TABLE_SLOTS, applyEvent, applyLayout, normalize, autoLayout, flatten, imageUrl, original };
})();
