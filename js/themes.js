/*
 * POP UP テーマ（店内の内装）
 * --------------------------------------------------
 * 壁紙・腰壁・床・天井・棚・看板・入口の色をテーマごとに定義します。
 * 使うテーマは data.js の SHOP.theme で指定します（URL の ?theme=sage でも切り替え可）。
 *
 * 新しいテーマを作るときは、既存のテーマをコピーして色と柄を変えるだけでOKです。
 *
 * wall.pattern   : 'clouds' | 'stars' | 'flowers' | 'hearts' | 'dots' | 'stripes' | 'gingham' | 'none'
 * wall.image     : 壁紙に実画像を使う場合の画像パス（指定すると pattern より優先）
 * floor.style    : 'wood' | 'check' | 'tile' | 'carpet'
 * floor.image    : 床に実画像を使う場合の画像パス
 * light          : 'day' | 'night'（night は店内を暗めにして棚をスポットライトで照らす）
 */
window.THEMES = {
  /*
   * やさしい色の 5 パターン（壁はギンガムチェック）。初期設定は Milk Tea（js/data.js の SHOP.theme）
   * 指定いただいた色：壁・壁のチェック・腰壁・見切り・床（タイル・目地）・会場限定テーブルの下・看板（地・大きい文字・小さい文字）・
   * 商品の画面の背景・棚。それ以外（棚の板と奥・天井・入口）は、その色から合わせて作っている
   */
  milktea: {
    name: 'Milk Tea',
    title: 'ミルクティー',
    wall: { color: '#f8f4ed', pattern: 'gingham', patternColor: '#e8ddd1', lower: '#e9ded2', trim: '#cdbeaf' },
    floor: { style: 'tile', colors: ['#fcfaf5', '#e8dfd5'] }, // タイル・目地
    ceiling: '#fcfaf5',
    shelf: { board: '#ece2d8', edge: '#dccbb9', back: '#f4efea' }, // 棚の色 #dccbb9
    sign: { bg: '#fffcf8', ink: '#51453f', sub: '#b58f7d', style: 'board' },
    rug: '#eadbd1',
    productBg: '#faf6f0', // 商品の画面の背景色
    rugOpacity: 1,
    light: 'day',
    entrance: { top: '#e8ddd1', bottom: '#f8f4ed', glow: 'rgba(255, 255, 255, .55)' },
  },

  softpink: {
    name: 'Soft Pink',
    title: 'ソフトピンク',
    wall: { color: '#fbf2ed', pattern: 'gingham', patternColor: '#f3dadd', lower: '#f1ddd2', trim: '#dcc8bf' },
    floor: { style: 'tile', colors: ['#fffaf8', '#ede1e0'] }, // タイル・目地
    ceiling: '#fffaf8',
    shelf: { board: '#f3eae1', edge: '#e9d9c8', back: '#f8f4ee' }, // 棚の色 #e9d9c8
    sign: { bg: '#ffffff', ink: '#393238', sub: '#d986aa', style: 'board' },
    rug: '#f7d8e4',
    productBg: '#fff8f9', // 商品の画面の背景色
    rugOpacity: 1,
    light: 'day',
    entrance: { top: '#f3dadd', bottom: '#fbf2ed', glow: 'rgba(255, 255, 255, .55)' },
  },

  lavender: {
    name: 'Lavender Dream',
    title: 'ラベンダードリーム',
    wall: { color: '#faf7fc', pattern: 'gingham', patternColor: '#e9dff2', lower: '#eee5f3', trim: '#d6c8e0' },
    floor: { style: 'tile', colors: ['#fdfbff', '#e9e1ef'] }, // タイル・目地
    ceiling: '#fdfbff',
    shelf: { board: '#efe9f4', edge: '#e2d7eb', back: '#f6f3f9' }, // 棚の色 #e2d7eb
    sign: { bg: '#ffffff', ink: '#443c50', sub: '#b18acb', style: 'board' },
    rug: '#eaddf6',
    productBg: '#faf7fe', // 商品の画面の背景色
    rugOpacity: 1,
    light: 'day',
    entrance: { top: '#e9dff2', bottom: '#faf7fc', glow: 'rgba(255, 255, 255, .55)' },
  },

  sage: {
    name: 'Sage Mint',
    title: 'セージミント',
    wall: { color: '#f7f9f5', pattern: 'gingham', patternColor: '#dfeae0', lower: '#e6ede3', trim: '#c6d4c5' },
    floor: { style: 'tile', colors: ['#fbfdf9', '#e1e9df'] }, // タイル・目地
    ceiling: '#fbfdf9',
    shelf: { board: '#e7ede6', edge: '#d4dfd2', back: '#f2f5f2' }, // 棚の色 #d4dfd2
    sign: { bg: '#fffdf9', ink: '#3e4c43', sub: '#82ad94', style: 'board' },
    rug: '#dcece1',
    productBg: '#f6faf6', // 商品の画面の背景色
    rugOpacity: 1,
    light: 'day',
    entrance: { top: '#dfeae0', bottom: '#f7f9f5', glow: 'rgba(255, 255, 255, .55)' },
  },

  powderblue: {
    name: 'Powder Blue',
    title: 'パウダーブルー',
    wall: { color: '#f7fafc', pattern: 'gingham', patternColor: '#deeaf3', lower: '#e5eef5', trim: '#c8d9e5' },
    floor: { style: 'tile', colors: ['#fcfdff', '#e1e9f0'] }, // タイル・目地
    ceiling: '#fcfdff',
    shelf: { board: '#e8f0f6', edge: '#d6e4ef', back: '#f3f7fa' }, // 棚の色 #d6e4ef
    sign: { bg: '#ffffff', ink: '#3b4756', sub: '#87b2d3', style: 'board' },
    rug: '#e0ecf8',
    productBg: '#f6fafe', // 商品の画面の背景色
    rugOpacity: 1,
    light: 'day',
    entrance: { top: '#deeaf3', bottom: '#f7fafc', glow: 'rgba(255, 255, 255, .55)' },
  },

};

/* 店内のどこに何を並べるか（商品の `display: 'left' | 'right' | 'island'` で個別に上書きできます） */
window.STORE_LAYOUT = {
  left: { title: 'PLUSH & CHARM', label: 'ぬいぐるみ・キーホルダー', categories: ['plush', 'keychain'] },
  right: { title: 'STATIONERY & GOODS', label: '文具・雑貨・バッグ', categories: ['stationery', 'living', 'bag'] },
  island: { title: 'LIMITED', label: '会場限定テーブル' }, // limited: true の商品が並びます
};

/*
 * テーマの名前・入口の色をページに反映する（3D 店内の組み立ては js/world/ が行う）
 * 存在しないキーなら最初のテーマを使い、実際に使ったキーを返す
 */
window.applyThemeMeta = function applyThemeMeta(key) {
  const k = window.THEMES[key] ? key : Object.keys(window.THEMES)[0];
  const t = window.THEMES[k];
  window.SHOP.theme = k;
  // 入口の「イベント名 ― サブタイトル」。サブタイトルは管理画面で入力したときだけ（テーマの title は使わない）
  const sub = window.SHOP.subtitle || '';
  window.SHOP.themeLabel = sub ? `${t.name} ― ${sub}` : t.name;
  const root = document.documentElement.style;
  root.setProperty('--theme-top', t.entrance.top);
  root.setProperty('--theme-bottom', t.entrance.bottom);
  // ピンクのにじみ・見出しの色（テーマで指定したときだけ）
  for (const [prop, v] of [['--theme-glow', t.entrance.glow], ['--theme-heading', t.entrance.heading]]) {
    if (v) root.setProperty(prop, v); else root.removeProperty(prop);
  }
  document.querySelectorAll('[data-bind="themeLabel"]').forEach((el) => { el.textContent = window.SHOP.themeLabel; });
  return k;
};
window.applyThemeMeta(new URLSearchParams(location.search).get('theme') || window.SHOP.theme);
