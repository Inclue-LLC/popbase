/*
 * POP UP イベントの設定（内装・会期・看板）と、棚の配置
 * --------------------------------------------------
 * 管理画面（admin/）・サイト・Shopify 連携で共通に使う形と変換処理です。
 *
 * イベント設定 event … { title, period, theme_preset, wall_image, wall_color, ... }
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
    { value: '', label: 'Zen Kaku Gothic New（すっきりゴシック・初期設定）', family: 'Zen Kaku Gothic New', weights: [400, 500, 700, 900] },
    { value: 'mplus-maru', label: 'M PLUS Rounded 1c（丸ゴシック）', family: 'M PLUS Rounded 1c', weights: [400, 500, 700, 800] },
    { value: 'zen-maru', label: 'Zen Maru Gothic（やさしい丸ゴシック）', family: 'Zen Maru Gothic', weights: [400, 500, 700, 900] },
    { value: 'kosugi-maru', label: 'Kosugi Maru（すっきり丸ゴシック）', family: 'Kosugi Maru', weights: [400] },
    { value: 'kiwi-maru', label: 'Kiwi Maru（やわらか丸明朝）', family: 'Kiwi Maru', weights: [400, 500] },
    { value: 'noto-sans', label: 'Noto Sans JP（標準のゴシック）', family: 'Noto Sans JP', weights: [400, 500, 700, 800] },
    { value: 'noto-serif', label: 'Noto Serif JP（明朝・上品）', family: 'Noto Serif JP', weights: [400, 500, 700, 900] },
    { value: 'yusei', label: 'Yusei Magic（マジックで書いた手書き風）', family: 'Yusei Magic', weights: [400] },
    { value: 'hachi-maru', label: 'Hachi Maru Pop（丸いポップ体）', family: 'Hachi Maru Pop', weights: [400] },
    { value: 'dotgothic', label: 'DotGothic16（レトロなドット文字）', family: 'DotGothic16', weights: [400] },
  ];
  const FALLBACK = "'Hiragino Sans', 'Yu Gothic', system-ui, sans-serif";
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
  /**
   * フォントの読み込みが終わるまで待つ（3D の看板・値札を描く前に使う。最大 5 秒）
   * 日本語の Google Fonts は文字のグループごとにファイルが分かれていて、使う文字のファイルだけを読み込む。
   * 文字を指定しないと英数字のファイルしか読まれず、漢字が別のフォントで描かれてしまうため、
   * 店内に描く文字（看板・商品名・キャラクター名など）をすべて渡して、その分のファイルを読み込んでおく。
   */
  async function fontReady(extraText = '') {
    const def = currentFont;
    const text = `${shopText()}${extraText}`;
    const wait = (async () => {
      await fontLoading;
      await Promise.all([500, 700, 800].map((w) => document.fonts.load(`${w} 20px "${def.family}"`, text).catch(() => {})));
    })();
    await Promise.race([wait, new Promise((r) => setTimeout(r, 5000))]);
  }

  /** 店内に描く文字をまとめる（重複は除く） */
  function shopText() {
    const S = window.SHOP || {};
    const L = window.STORE_LAYOUT || {};
    const t = window.THEMES?.event || window.THEMES?.[S.theme] || {};
    const parts = [
      S.brand, S.period, S.hours, t.name,
      L.left?.title, L.left?.label, L.right?.title, L.right?.label, L.island?.title, L.island?.label,
      ...(window.PRODUCTS || []).map((p) => `${p.name}¥${p.price}`),
      ...(window.CHARACTERS || []).map((c) => c.name),
      'REGISTER お会計 カートを見る EXIT LIMITED 会場限定テーブル SOLD OUT NEW ¥0123456789,…',
    ];
    return [...new Set(parts.filter(Boolean).join('').replace(/\s/g, ''))].join('');
  }

  // 購入特典があるか。「なし／あり」を選ぶ前の設定は、特典の名前が入っていれば「あり」
  const NOVELTY_THRESHOLD = 3000;
  const noveltyOn = (ev = {}) => ev.novelty === 'on' || (ev.novelty !== 'off' && ev.novelty_name != null && String(ev.novelty_name).trim() !== '');

  /* 管理画面のフォーム定義 */
  const FIELDS = [
    { group: 'イベント', key: 'brand', label: 'ブランド名', hint: '店内の看板の上の行・ページ上部のロゴなど（全角15文字・半角30文字まで）', type: 'text', maxUnits: 30, placeholderPath: 'shop.brand' },
    { group: 'イベント', key: 'title', label: 'イベント名', hint: '看板の大きな文字。長さに合わせて看板の幅が広がります（全角14文字・半角28文字まで）', type: 'text', maxUnits: 28 },
    { group: 'イベント', key: 'collection', label: 'Shopify のコレクション', hint: 'このイベントで店内に並べる商品のコレクション。Shopify で作ったコレクションから選びます', type: 'collection', showIf: () => !!window.ADMIN_SHOPIFY },
    { group: '会期・営業時間', key: 'open_at', label: '開始日時', hint: 'この日時になると入店できるようになります（日本時間）', type: 'datetime' },
    { group: '会期・営業時間', key: 'close_at', label: '終了日時', hint: 'この日時で閉店し、店内のお客さんは自動で退店します', type: 'datetime' },
    { group: '会期・営業時間', key: 'daily_open', label: '毎日の開店時刻', hint: '閉店時刻とセットで設定。空欄なら会期中は24時間営業', type: 'time' },
    { group: '会期・営業時間', key: 'daily_close', label: '毎日の閉店時刻', hint: '閉店5分前から店内にタイマーを表示し、時間になると自動で退店', type: 'time' },
    { group: '会期・営業時間', key: 'period', label: '会期の表示文', hint: '看板の下の行・入口・ご案内に出す文。空欄なら上の日時から自動で作ります', type: 'text', placeholderPath: 'schedule.period' },
    { group: 'イベント', key: 'theme_preset', label: 'ベースのテーマ', hint: '下の項目で空欄のものは、このテーマの値になります', type: 'select', options: () => Object.entries(window.THEMES).filter(([k]) => k !== 'event').map(([k, t]) => ({ value: k, label: t.name })) },
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
    { group: '床', key: 'rug_color', label: '会場限定テーブルの下の色', hint: 'テーブルの下に敷く楕円の色。指定した色のまま表示します', type: 'color', themePath: 'rug' },
    { group: '看板・照明', key: 'sign_color', label: '看板の色', type: 'color', themePath: 'sign.bg' },
    { group: '看板・照明', key: 'sign_text_color', label: 'イベント名の色', hint: '正面の看板のイベント名と会期の文字の色', type: 'color', themePath: 'sign.ink' },
    { group: '看板・照明', key: 'sign_sub_color', label: 'ブランド名の色', hint: '正面の看板の、イベント名の上のブランド名の文字の色', type: 'color', themePath: 'sign.sub' },
    { group: '看板・照明', key: 'light', label: '照明', type: 'select', options: () => opt([['', 'テーマのまま'], ['day', '明るい'], ['night', '夜（暗め＋スポットライト）']]) },
    { group: '棚の看板', key: 'left_label', label: '左の棚（日本語）', hint: '例：ぬいぐるみ・キーホルダー', type: 'text', placeholderPath: 'const.（空欄なら表示しません）' },
    { group: '棚の看板', key: 'left_title', label: '左の棚（英字）', hint: '例：PLUSH & CHARM', type: 'text', placeholderPath: 'const.（空欄なら表示しません）' },
    { group: '棚の看板', key: 'right_label', label: '右の棚（日本語）', hint: '例：文具・雑貨・バッグ', type: 'text', placeholderPath: 'const.（空欄なら表示しません）' },
    { group: '棚の看板', key: 'right_title', label: '右の棚（英字）', hint: '例：STATIONERY & GOODS', type: 'text', placeholderPath: 'const.（空欄なら表示しません）' },
    { group: 'フォント', key: 'font', label: 'ショップの基本フォント', hint: '入口・メニュー・商品詳細・店内の看板や値札の文字に使います', type: 'select', options: () => FONTS.map((x) => ({ value: x.value, label: x.label })) },
    { group: 'アバター・キャラクター紹介', key: 'avatar_ring_color', label: 'アバターの下の円の色', hint: '店内で、自分のアバターの足元に出る円の色', type: 'color', themePath: 'avatarRing' },
    { group: 'アバター・キャラクター紹介', key: 'char_note_color', label: 'キャラクター紹介文の背景色', hint: '店内の壁のキャラクターをタップしたときに出る紹介文の背景の色（文字の色は自動で読みやすい色に）', type: 'color', themePath: 'charNote.bg' },
    { tab: 'characters', group: 'キャラクター紹介の背景色', key: 'cast_card_color', label: 'キャラクター紹介（ページ下）の背景色', hint: 'ページ下の「キャラクター紹介」の枠の色。指定すると全員同じ色になります（文字の色は自動で読みやすい色に）', type: 'color', themePath: 'castCard', defaultLabel: 'キャラクターごとの色', defaultSwatch: '#f3ece6',
      // すぐ選べる淡い色（いまのキャラクター紹介と同じくらいの薄さ）
      presets: [['#e3eff8', 'ミズイロ'], ['#fbf2da', 'クリーム'], ['#ece6f7', 'ラベンダー'], ['#f9e5ec', 'ピンク'],
        ['#e2f1e7', 'ミント'], ['#fbe8dd', 'ピーチ'], ['#f2ebe2', 'ミルクティー'], ['#eeeef1', 'グレー']] },
    { group: '商品の画面', key: 'product_bg_color', label: '商品の画面の背景色', hint: '棚の商品をクリックしたときに出る画面で、商品画像の後ろに敷く色', type: 'color', themePath: 'productBg' },
    { group: '購入特典', key: 'novelty', label: '購入特典', hint: '「あり」にすると、カートに「あと○円で特典」、ご案内に特典の説明が出ます', type: 'select',
      options: () => opt([['off', 'なし'], ['on', 'あり']]), value: (ev) => (noveltyOn(ev) ? 'on' : 'off') },
    { group: '購入特典', key: 'novelty_threshold', label: '特典の条件金額（円）', hint: 'この金額（税込）以上のお買い上げで特典が付きます', type: 'number', showIf: (ev) => noveltyOn(ev) },
    { group: '購入特典', key: 'novelty_name', label: '特典の名前', type: 'text', showIf: (ev) => noveltyOn(ev) },

    /* キャラクター（管理画面の「キャラクター」タブ）。値は { haru: { name, en, profile, color, image, hidden }, ... } */
    /* キャラクター（「キャラクター」タブ）。イベントごとに自由に登録。値は { use: true/false, list: [{ id, name, en, profile, color, image }] }
     * 入口・店内の正面の壁・ご案内のキャラクター紹介に並ぶ。空なら自社の4体（アバターとは別） */
    { tab: 'characters', group: 'キャラクター', key: 'cast', label: 'キャラクター', type: 'cast' },
    /* アバター（管理画面の「アバター」タブ）。値は { hide: [キャラクターID], custom: [{ id, name, image }] } */
    { tab: 'avatars', group: 'アバター', key: 'avatars', label: 'アバター', type: 'avatars' },

    /* 入口の画面（管理画面の「入口の画面」タブ） */
    { tab: 'entrance', group: '文字', key: 'entrance_kicker', label: '上の小さい文字', type: 'text', placeholderPath: 'shop.title' },
    { tab: 'entrance', group: '文字', key: 'entrance_heading', label: '大きい見出し', hint: 'ロゴ画像を設定した場合は、画像の代替テキストになります', type: 'text', placeholderPath: 'shop.brand' },
    { tab: 'entrance', group: '文字', key: 'entrance_message', label: '見出しの下の文字', hint: '空欄ならイベント名', type: 'text', placeholderPath: 'shop.themeLabel' },
    { tab: 'entrance', group: '文字', key: 'entrance_notice', label: 'お知らせ', hint: '会期の下に表示（例: 12/1 新作入荷！）。空欄なら表示しません', type: 'textarea' },
    { tab: 'entrance', group: '文字', key: 'entrance_button', label: 'ボタンの文字', type: 'text', placeholderPath: 'const.お店に入る' },
    { tab: 'entrance', group: '画像', key: 'entrance_logo', label: 'ロゴ画像', hint: '大きい見出しの代わりに表示。背景が透明な PNG がおすすめ', type: 'image' },
    { tab: 'entrance', group: '画像', key: 'entrance_image', label: '背景の画像', hint: '画面いっぱいに表示（例: 1920×1080px）。設定すると背景の色と雲の飾りは表示しません', type: 'image' },
    { tab: 'entrance', group: '色', key: 'entrance_color_top', label: '背景の色（上）', type: 'color', themePath: 'entrance.top' },
    { tab: 'entrance', group: '色', key: 'entrance_color_bottom', label: '背景の色（下）', type: 'color', themePath: 'entrance.bottom' },
    { tab: 'entrance', group: '色', key: 'entrance_heading_color', label: '大きい見出しの色', type: 'color', themePath: 'entrance.heading' },
    { tab: 'entrance', group: '色', key: 'entrance_text_color', label: 'そのほかの文字の色', type: 'color', themePath: 'entrance.ink' },
    { tab: 'entrance', group: '表示', key: 'entrance_characters', label: 'キャラクター', type: 'select', options: () => opt([['', '表示する'], ['hide', '表示しない']]) },
  ];
  /*
   * 項目の種類（管理画面に「必須」「任意」と表示する）。必須を変えたいときはここを書き換えてください。
   * （サーバー側 server/admin/fields.js の REQUIRED も同じにする）
   *   required … 必須。空欄のままでは公開できない
   *   default  … 任意。空欄なら [1] の内容を使う
   *   hide     … 任意。空欄なら店内に表示しない
   */
  const NEED = {
    brand: ['required'], title: ['required'], open_at: ['required'], close_at: ['required'], collection: ['required'],
    entrance_notice: ['hide'],
    novelty: ['default', 'なし'], novelty_name: ['required'],
    product_bg_color: ['default', 'テーマの色'],
    daily_open: ['default', '24時間営業'], daily_close: ['default', '24時間営業'], period: ['default', '日時から自動で作成'], cast_card_color: ['default', 'キャラクターごとの色'],
    theme_preset: ['default', 'Milk Tea'], font: ['default', '初期設定のフォント'],
    wall_image: ['default', '壁の色と柄'], wall_pattern: ['default', 'テーマの柄'], floor_image: ['default', '床の種類と色'],
    floor_style: ['default', 'テーマの床'], light: ['default', 'テーマの照明'],
    left_title: ['hide'], left_label: ['hide'], right_title: ['hide'], right_label: ['hide'],
    novelty_threshold: ['default', '3,000円'],
    entrance_kicker: ['default', 'POP BASE'], entrance_heading: ['default', 'ブランド名'],
    entrance_message: ['default', 'イベント名'], entrance_button: ['default', '「お店に入る」'],
    entrance_logo: ['default', '大きい見出しの文字'], entrance_image: ['default', '背景の色'],
    entrance_characters: ['default', '表示する'],
    cast: ['default', '自社の4体のキャラクター'], avatars: ['default', '4体のキャラクター'],
  };
  for (const f of FIELDS) {
    const [need, fallback] = NEED[f.key] || ['default', f.type === 'color' ? 'テーマの色' : '初期設定'];
    f.need = need;
    f.fallback = fallback || '';
  }
  const blank = (v) => v == null || (typeof v === 'string' && !v.trim());
  /** 必須なのに空欄の項目（ラベルの一覧） */
  // showIf のある項目（特典の名前など）は、表示しているときだけ必須
  const missingRequired = (ev = {}) => FIELDS.filter((f) => f.need === 'required' && (!f.showIf || f.showIf(ev)) && blank(ev[f.key]));

  const IMAGE_KEYS = FIELDS.filter((f) => f.type === 'image').map((f) => f.key);

  // 最初に読み込んだときの値（何度適用しても元に戻せるように保存しておく）
  const original = {
    title: window.SHOP.title,
    brand: window.SHOP.brand,
    theme: window.SHOP.theme,
    period: window.SHOP.period,
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

  /* ---------- イベントのキャラクター（cast） ---------- */
  const MAX_CAST = 12;
  const parseJson = (v) => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return null; } };
  /**
   * イベントのキャラクターの設定（{ use, list }）。まだ設定していないイベントは、自社の4体
   * （以前の「キャラクター」タブの名前・画像の変更と「表示しない」を引き継ぐ）
   */
  function castOf(value, legacyChars) {
    const v = parseJson(value);
    if (v && typeof v === 'object' && Array.isArray(v.list)) return { use: v.use !== false, list: v.list.slice(0, MAX_CAST) };
    const over = parseJson(legacyChars) || {};
    const list = original.characters.filter((o) => !over[o.id]?.hidden).map((o) => {
      const x = over[o.id] || {};
      return { id: o.id, name: x.name || o.name, en: x.en || o.en, profile: x.profile || o.profile, color: '', image: x.image || '' };
    });
    return { use: true, list };
  }
  /** 表示用の一覧 window.CAST（自社の4体は元のイラスト（kind）を使える）。色は変えられない（自社の4体は元の色、追加したキャラクターは淡いラベンダー） */
  function applyCast(value, legacyChars) {
    const c = castOf(value, legacyChars);
    window.CAST_ENABLED = c.use;
    window.CAST = c.use ? c.list.filter((x) => x && x.name).map((x) => {
      const o = original.characters.find((y) => y.id === x.id);
      return { ...(o || {}), id: x.id, name: x.name, en: x.en || '', profile: x.profile || '', color: o?.color || '#e6dcf3', accent: o?.accent || '#b9a3ec', image: imageUrl(x.image) || '', kind: o?.kind || '' };
    }) : [];
  }

  /** イベント設定をテーマ・会期・看板に反映する（何度呼んでもよい） */
  function applyEvent(f = {}) {
    const baseKey = has(f, 'theme_preset') && window.THEMES[f.theme_preset] ? f.theme_preset : original.theme;
    const theme = JSON.parse(JSON.stringify(window.THEMES[baseKey] || Object.values(window.THEMES)[0]));
    const set = (obj, key, field) => { if (has(f, field)) obj[key] = f[field]; };
    set(theme, 'name', 'title');
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
    // 会場限定テーブルの下の敷物：指定したときは、その色のまま（透けさせない）
    if (has(f, 'rug_color')) { theme.rug = f.rug_color; theme.rugOpacity = 1; }
    set(theme.sign, 'bg', 'sign_color');
    // 正面の看板のイベント名・ブランド名の色（棚やテーブルの看板はテーマの色のまま）
    set(theme, 'avatarRing', 'avatar_ring_color');
    set(theme, 'castCard', 'cast_card_color');
    if (has(f, 'char_note_color')) theme.charNote = { ...(theme.charNote || {}), bg: f.char_note_color, ink: '' };
    set(theme.sign, 'eventInk', 'sign_text_color');
    set(theme.sign, 'brandInk', 'sign_sub_color');
    set(theme, 'light', 'light');
    set(theme.entrance, 'top', 'entrance_color_top');
    set(theme.entrance, 'bottom', 'entrance_color_bottom');
    window.THEMES.event = theme;

    const S = window.SHOP;
    // 会期と営業時間（js/schedule.js）。表示文が空欄なら日時から自動で作る
    S.schedule = { open_at: f.open_at || '', close_at: f.close_at || '', daily_open: f.daily_open || '', daily_close: f.daily_close || '' };
    const HS = window.HaneulSchedule;
    S.period = has(f, 'period') ? f.period : (HS?.periodText(S.schedule) || original.period);
    S.hours = HS?.hoursText(S.schedule) || '';
    S.brand = has(f, 'brand') ? f.brand : original.brand;
    S.productBg = has(f, 'product_bg_color') ? f.product_bg_color : (theme.productBg || ''); // 商品の画面の背景色（空欄ならテーマの色、なければ商品ごとの色）
    // 購入特典：「なし」なら表示しない
    S.novelty = noveltyOn(f) && has(f, 'novelty_name')
      ? { threshold: has(f, 'novelty_threshold') ? Number(f.novelty_threshold) : NOVELTY_THRESHOLD, name: f.novelty_name }
      : null;
    applyFont(f.font);
    applyCharacters(f.characters); // 自社の4体（アバター用）
    applyCast(f.cast, f.characters); // このイベントのキャラクター
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
      // 棚の看板の文字は、未記入なら表示しない（英字・日本語とも空なら看板ごと出さない）
      L[side].title = has(f, `${side}_title`) ? f[`${side}_title`] : '';
      L[side].label = has(f, `${side}_label`) ? f[`${side}_label`] : '';
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
  /**
   * アバターにするキャラクター：このイベントにキャラクターが登録されていればそのキャラクターだけ、
   * いなければ（または「キャラクターを使う」をオフにしていれば）自社の4体
   */
  const avatarCharacters = () => (window.CAST_ENABLED && window.CAST?.length ? window.CAST : window.CHARACTERS);

  function applyAvatars(value) {
    let v = value || {};
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = {}; } }
    const hide = new Set(Array.isArray(v.hide) ? v.hide : []);
    const base = avatarCharacters();
    const list = base.filter((c) => !hide.has(c.id))
      .map((c) => ({ id: c.id, name: c.name, image: c.image || '', character: c }));
    for (const a of Array.isArray(v.custom) ? v.custom : []) {
      const image = imageUrl(a.image);
      if (a && a.id && a.name && image) list.push({ id: a.id, name: a.name, image });
    }
    // すべて外された場合でも、最初のキャラクターは選べるようにする
    if (!list.length) list.push({ id: base[0].id, name: base[0].name, image: base[0].image || '', character: base[0] });
    window.AVATARS = list;
    return list;
  }

  /** アバターの ID から表示用の情報を探す（一覧にないもの＝他のお客さんの古い選択などは、キャラクター→最初のアバターの順で代わりに使う） */
  function findAvatar(id) {
    const list = window.AVATARS || applyAvatars(null);
    const hit = list.find((a) => a.id === id);
    if (hit) return hit;
    const c = (window.CAST || []).find((x) => x.id === id) || window.CHARACTERS.find((x) => x.id === id);
    if (c) return { id: c.id, name: c.name, image: c.image || '', character: c };
    return list[0];
  }

  // 何も公開されていなくても、フォントの情報（SHOP.fontStack）とアバターの一覧は用意しておく
  applyFont('');
  applyAvatars(null);

  /**
   * 文字数（看板に収まるかの目安）：全角は 2、半角（英数字・記号・半角カナ）は 1 と数える
   * 例：イベント名は 28 まで ＝ 全角14文字・半角28文字
   */
  function textUnits(str) {
    let n = 0;
    for (const ch of String(str || '')) {
      const c = ch.codePointAt(0);
      n += c <= 0x7e || (c >= 0xff61 && c <= 0xff9f) ? 1 : 2;
    }
    return n;
  }
  /** 上限を超えた分を切る */
  function clampUnits(str, max) {
    let n = 0;
    let out = '';
    for (const ch of String(str || '')) {
      const c = ch.codePointAt(0);
      const w = c <= 0x7e || (c >= 0xff61 && c <= 0xff9f) ? 1 : 2;
      if (n + w > max) break;
      n += w;
      out += ch;
    }
    return out;
  }

  applyCast(''); // 最初は自社の4体
  window.HaneulEvent = { avatarCharacters, castOf, applyCast, MAX_CAST, noveltyOn, NOVELTY_THRESHOLD, missingRequired, textUnits, clampUnits, FIELDS, FONTS, applyFont, applyCharacters, applyAvatars, findAvatar, fontReady, IMAGE_KEYS, ROWS, SLOTS, TABLE_SLOTS, applyEvent, applyLayout, normalize, autoLayout, flatten, imageUrl, original };
})();
