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

  /* ショップの基本フォント（日本語に対応した Google Fonts から選ぶ） */
  const FONTS = [
    { value: '', label: 'M PLUS Rounded 1c（丸ゴシック・初期設定）', family: 'M PLUS Rounded 1c', weights: [400, 500, 700, 800] },
    { value: 'zen-maru', label: 'Zen Maru Gothic（やさしい丸ゴシック）', family: 'Zen Maru Gothic', weights: [400, 500, 700, 900] },
    { value: 'kosugi-maru', label: 'Kosugi Maru（すっきり丸ゴシック）', family: 'Kosugi Maru', weights: [400] },
    { value: 'kiwi-maru', label: 'Kiwi Maru（やわらか丸明朝）', family: 'Kiwi Maru', weights: [400, 500] },
    { value: 'noto-sans', label: 'Noto Sans JP（標準のゴシック）', family: 'Noto Sans JP', weights: [400, 500, 700, 800] },
    { value: 'zen-kaku', label: 'Zen Kaku Gothic New（すっきりゴシック）', family: 'Zen Kaku Gothic New', weights: [400, 500, 700, 900] },
    { value: 'noto-serif', label: 'Noto Serif JP（明朝・上品）', family: 'Noto Serif JP', weights: [400, 500, 700, 900] },
    { value: 'yusei', label: 'Yusei Magic（マジックで書いた手書き風）', family: 'Yusei Magic', weights: [400] },
    { value: 'hachi-maru', label: 'Hachi Maru Pop（丸いポップ体）', family: 'Hachi Maru Pop', weights: [400] },
    { value: 'dotgothic', label: 'DotGothic16（レトロなドット文字）', family: 'DotGothic16', weights: [400] },
  ];
  const FALLBACK = "'Hiragino Maru Gothic ProN', 'Hiragino Sans', 'Yu Gothic', system-ui, sans-serif";
  let fontLoading = Promise.resolve();
  let currentFont = FONTS[0];

  /** フォントを読み込んで、サイトの文字（CSS の --shop-font）と 3D 店内の看板の文字に使う */
  function applyFont(key) {
    const def = FONTS.find((x) => x.value === (key || '')) || FONTS[0];
    currentFont = def;
    window.SHOP.font = def.value;
    window.SHOP.fontStack = `'${def.family}', ${FALLBACK}`;
    const root = document.documentElement.style;
    let link = document.getElementById('haneul-font');
    if (!def.value) {
      // 初期設定のフォントは index.html で読み込み済み
      root.removeProperty('--shop-font');
      link?.remove();
      fontLoading = Promise.resolve();
      return;
    }
    const href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(def.family).replace(/%20/g, '+')}:wght@${def.weights.join(';')}&display=swap`;
    if (link?.getAttribute('href') !== href) {
      link?.remove();
      link = document.createElement('link');
      link.id = 'haneul-font';
      link.rel = 'stylesheet';
      link.href = href;
      fontLoading = new Promise((resolve) => { link.onload = resolve; link.onerror = resolve; });
      document.head.appendChild(link);
    }
    root.setProperty('--shop-font', window.SHOP.fontStack);
  }

  /** フォントの読み込みが終わるまで待つ（3D の看板を描く前に使う。最大 3 秒） */
  async function fontReady() {
    const def = currentFont;
    const wait = (async () => {
      await fontLoading;
      await Promise.all([500, 700, 800].map((w) => document.fonts.load(`${w} 20px "${def.family}"`).catch(() => {})));
    })();
    await Promise.race([wait, new Promise((r) => setTimeout(r, 3000))]);
  }

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
    { group: 'フォント', key: 'font', label: 'ショップの基本フォント', hint: '入口・メニュー・商品詳細・店内の看板や値札の文字に使います', type: 'select', options: () => FONTS.map((x) => ({ value: x.value, label: x.label })) },
    { group: '購入特典', key: 'novelty_threshold', label: '特典の条件金額（円）', type: 'number' },
    { group: '購入特典', key: 'novelty_name', label: '特典の名前', type: 'text' },

    /* キャラクター（管理画面の「キャラクター」タブ）。値は { haru: { name, en, profile, color, image, hidden }, ... } */
    { tab: 'characters', group: 'キャラクター', key: 'characters', label: 'キャラクター', type: 'characters' },
    /* アバター（管理画面の「アバター」タブ）。値は { hide: [キャラクターID], custom: [{ id, name, image }] } */
    { tab: 'avatars', group: 'アバター', key: 'avatars', label: 'アバター', type: 'avatars' },

    /* 入口の画面（管理画面の「入口の画面」タブ） */
    { tab: 'entrance', group: '文字', key: 'entrance_kicker', label: '上の小さい文字', type: 'text', placeholderPath: 'shop.title' },
    { tab: 'entrance', group: '文字', key: 'entrance_heading', label: '大きい見出し', hint: 'ロゴ画像を設定した場合は、画像の代替テキストになります', type: 'text', placeholderPath: 'shop.brand' },
    { tab: 'entrance', group: '文字', key: 'entrance_message', label: '見出しの下の文字', hint: '空欄ならイベント名とサブタイトル', type: 'text', placeholderPath: 'shop.themeLabel' },
    { tab: 'entrance', group: '文字', key: 'entrance_notice', label: 'お知らせ', hint: '会期の下に表示（例: 12/1 新作入荷！）。空欄なら表示しません', type: 'textarea' },
    { tab: 'entrance', group: '文字', key: 'entrance_button', label: 'ボタンの文字', type: 'text', placeholderPath: 'const.お店に入る' },
    { tab: 'entrance', group: '画像', key: 'entrance_logo', label: 'ロゴ画像', hint: '大きい見出しの代わりに表示。背景が透明な PNG がおすすめ', type: 'image' },
    { tab: 'entrance', group: '画像', key: 'entrance_image', label: '背景の画像', hint: '画面いっぱいに表示（例: 1920×1080px）。設定すると背景の色と雲の飾りは表示しません', type: 'image' },
    { tab: 'entrance', group: '色', key: 'entrance_color_top', label: '背景の色（上）', type: 'color', themePath: 'entrance.top' },
    { tab: 'entrance', group: '色', key: 'entrance_color_bottom', label: '背景の色（下）', type: 'color', themePath: 'entrance.bottom' },
    { tab: 'entrance', group: '色', key: 'entrance_heading_color', label: '大きい見出しの色', type: 'color', themePath: 'const.#ffffff' },
    { tab: 'entrance', group: '色', key: 'entrance_text_color', label: 'そのほかの文字の色', type: 'color', themePath: 'const.#3a3346' },
    { tab: 'entrance', group: '表示', key: 'entrance_characters', label: 'キャラクター', type: 'select', options: () => opt([['', '表示する'], ['hide', '表示しない']]) },
  ];
  const IMAGE_KEYS = FIELDS.filter((f) => f.type === 'image').map((f) => f.key);

  // 最初に読み込んだときの値（何度適用しても元に戻せるように保存しておく）
  const original = {
    title: window.SHOP.title,
    brand: window.SHOP.brand,
    theme: window.SHOP.theme,
    period: window.SHOP.period,
    novelty: { ...window.SHOP.novelty },
    layout: JSON.parse(JSON.stringify(window.STORE_LAYOUT)),
    characters: JSON.parse(JSON.stringify(window.CHARACTERS)),
  };

  /** キャラクターの変更（名前・英語名・プロフィール・色・画像・表示しない）を反映する */
  function applyCharacters(value) {
    let over = value || {};
    if (typeof over === 'string') { try { over = JSON.parse(over); } catch { over = {}; } }
    for (const c of window.CHARACTERS) {
      const o = original.characters.find((x) => x.id === c.id);
      const v = over[c.id] || {};
      Object.assign(c, o, {
        name: v.name || o.name,
        en: v.en || o.en,
        profile: v.profile || o.profile,
        color: v.color || o.color,
        image: imageUrl(v.image) || o.image || '',
        hidden: !!v.hidden,
      });
    }
  }

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
    set(theme.entrance, 'top', 'entrance_color_top');
    set(theme.entrance, 'bottom', 'entrance_color_bottom');
    window.THEMES.event = theme;

    const S = window.SHOP;
    S.period = has(f, 'period') ? f.period : original.period;
    S.novelty = { ...original.novelty };
    if (has(f, 'novelty_threshold')) S.novelty.threshold = Number(f.novelty_threshold);
    if (has(f, 'novelty_name')) S.novelty.name = f.novelty_name;
    applyFont(f.font);
    applyCharacters(f.characters);
    applyAvatars(f.avatars);
    // 入口の画面（空欄は初期表示のまま）
    S.entrance = {
      kicker: f.entrance_kicker || '',
      heading: f.entrance_heading || '',
      message: f.entrance_message || '',
      notice: f.entrance_notice || '',
      button: f.entrance_button || '',
      logo: imageUrl(f.entrance_logo),
      image: imageUrl(f.entrance_image),
      headingColor: f.entrance_heading_color || '',
      textColor: f.entrance_text_color || '',
      characters: f.entrance_characters || '',
    };

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

  /**
   * アバター選びに出すものの一覧 window.AVATARS を作る
   *   キャラクター（「アバター」タブで外したものを除く）＋ 管理画面で追加したアバター
   *   ※ キャラクター紹介・入口での表示/非表示（「キャラクター」タブ）とは別に設定する
   *   各要素は { id, name, image, character? }（character があればキャラクターの絵、なければ image を使う）
   */
  function applyAvatars(value) {
    let v = value || {};
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = {}; } }
    const hide = new Set(Array.isArray(v.hide) ? v.hide : []);
    const list = window.CHARACTERS.filter((c) => !hide.has(c.id))
      .map((c) => ({ id: c.id, name: c.name, image: c.image || '', character: c }));
    for (const a of Array.isArray(v.custom) ? v.custom : []) {
      const image = imageUrl(a.image);
      if (a && a.id && a.name && image) list.push({ id: a.id, name: a.name, image });
    }
    // すべて外された場合でも、最初のキャラクターは選べるようにする
    if (!list.length) list.push({ id: window.CHARACTERS[0].id, name: window.CHARACTERS[0].name, image: window.CHARACTERS[0].image || '', character: window.CHARACTERS[0] });
    window.AVATARS = list;
    return list;
  }

  /** アバターの ID から表示用の情報を探す（一覧にないもの＝他のお客さんの古い選択などは、キャラクター→最初のアバターの順で代わりに使う） */
  function findAvatar(id) {
    const list = window.AVATARS || applyAvatars(null);
    const hit = list.find((a) => a.id === id);
    if (hit) return hit;
    const c = window.CHARACTERS.find((x) => x.id === id);
    if (c) return { id: c.id, name: c.name, image: c.image || '', character: c };
    return list[0];
  }

  // 何も公開されていなくても、フォントの情報（SHOP.fontStack）とアバターの一覧は用意しておく
  applyFont('');
  applyAvatars(null);

  window.HaneulEvent = { FIELDS, FONTS, applyFont, applyCharacters, applyAvatars, findAvatar, fontReady, IMAGE_KEYS, ROWS, SLOTS, TABLE_SLOTS, applyEvent, applyLayout, normalize, autoLayout, flatten, imageUrl, original };
})();
