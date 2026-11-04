/*
 * POP UP テーマ（店内の内装）
 * --------------------------------------------------
 * 壁紙・腰壁・床・天井・棚・看板・入口の色をテーマごとに定義します。
 * 使うテーマは data.js の SHOP.theme で指定します（URL の ?theme=night でも切り替え可）。
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
  sky: {
    name: 'Sky Walk',
    title: '空のおさんぽ',
    wall: { color: '#d6ecfb', pattern: 'clouds', patternColor: '#ffffff', lower: '#ffffff', trim: '#9cc9ea' },
    floor: { style: 'wood', colors: ['#ecd9bd', '#e2caa8'] },
    ceiling: '#f7fbff',
    shelf: { board: '#ffffff', edge: '#d9c6ad', back: '#f4f9fe' },
    sign: { bg: '#ffffff', ink: '#4a90c8', sub: '#e0607e', style: 'board' },
    rug: '#ffffff',
    light: 'day',
    entrance: { top: '#9fd3f7', bottom: '#fde7f0' },
  },

  night: {
    name: 'Starry Night',
    title: '星降る夜のおさんぽ',
    wall: { color: '#283063', pattern: 'stars', patternColor: '#ffd76a', lower: '#1d2350', trim: '#ffd76a' },
    floor: { style: 'carpet', colors: ['#1b1f44', '#232a5a'] },
    ceiling: '#141838',
    shelf: { board: '#3a4280', edge: '#ffd76a', back: '#222a5a' },
    sign: { bg: '#141838', ink: '#ffe9a0', sub: '#c9b8f0', style: 'neon' },
    rug: '#c9b8f0',
    light: 'night',
    entrance: { top: '#141838', bottom: '#4a3567' },
  },

  holiday: {
    name: 'Holiday Party',
    title: 'ハヌルのホリデーパーティー',
    wall: { color: '#fbf3e6', pattern: 'stripes', patternColor: '#f3d9d4', lower: '#2f6b4f', trim: '#c94a4a' },
    floor: { style: 'check', colors: ['#f6efe4', '#c94a4a'] },
    ceiling: '#fffaf2',
    shelf: { board: '#fffaf2', edge: '#b8864f', back: '#fff6ea' },
    sign: { bg: '#c94a4a', ink: '#ffffff', sub: '#ffe9a0', style: 'board' },
    rug: '#2f6b4f',
    light: 'day',
    entrance: { top: '#2f6b4f', bottom: '#c94a4a' },
  },

  spring: {
    name: 'Spring Picnic',
    title: 'はるのピクニック',
    wall: { color: '#fde8ee', pattern: 'flowers', patternColor: '#ffffff', lower: '#bfe3c6', trim: '#f29ab2' },
    floor: { style: 'tile', colors: ['#fffaf0', '#f1e4cf'] },
    ceiling: '#fffafc',
    shelf: { board: '#ffffff', edge: '#e8c9a8', back: '#fff5f8' },
    sign: { bg: '#ffffff', ink: '#e0607e', sub: '#4f9a6e', style: 'board' },
    rug: '#bfe3c6',
    light: 'day',
    entrance: { top: '#ffd4e0', bottom: '#e6f6e0' },
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
  window.SHOP.themeLabel = `${t.name} ― ${t.title}`;
  const root = document.documentElement.style;
  root.setProperty('--theme-top', t.entrance.top);
  root.setProperty('--theme-bottom', t.entrance.bottom);
  document.querySelectorAll('[data-bind="themeLabel"]').forEach((el) => { el.textContent = window.SHOP.themeLabel; });
  return k;
};
window.applyThemeMeta(new URLSearchParams(location.search).get('theme') || window.SHOP.theme);
