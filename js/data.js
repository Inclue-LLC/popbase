/*
 * ポップアップショップの設定・キャラクター・商品データ
 * --------------------------------------------------
 * このファイルを書き換えるだけで、会期・キャラクター・商品を差し替えられます。
 * キャラクターは仮のオリジナルデザイン（js/art.js の SVG）です。
 * 実際のキャラクター画像に置き換える場合は、商品の `image` に画像パスを指定してください。
 */

window.SHOP = {
  brand: 'STUDIO HANEUL',
  brandKana: 'スタジオハヌル',
  title: 'Virtual Pop-up Store',
  theme: 'sky', // 店内の内装テーマ（js/themes.js のキー：sky / night / holiday / spring）
  period: '2026.11.20 (金) – 12.25 (金)',
  shippingFee: 600,
  freeShippingThreshold: 5000,
  // 購入特典（店内管理画面の「購入特典」で設定。なしなら null）例: { threshold: 3000, name: 'オリジナルステッカー' }
  novelty: null,
  // 同時接続サーバーの URL。空ならこのサイトと同じサーバーの /ws につなぎます（npm start で起動したとき）
  multiplayerUrl: '',
};

/*
 * Shopify 連携
 * --------------------------------------------------
 * domain と storefrontToken を入れると、商品・価格・在庫・購入手続きが Shopify に切り替わり、
 * 内装テーマや会期も Shopify 管理画面（メタオブジェクト）から変更できるようになります。
 * 空のままなら、このファイルの見本データで動きます。設定方法は docs/shopify-setup.md を参照。
 */
window.SHOPIFY_CONFIG = {
  domain: '',             // 例: 'studio-haneul.myshopify.com'
  storefrontToken: '',    // ヘッドレス チャネルで発行する「公開アクセストークン」（公開してよいトークン）
  apiVersion: '2025-01',
  collection: 'popup',    // 店内に並べるコレクションのハンドル
  eventHandle: 'current', // 使う「POP UPイベント」メタオブジェクトのハンドル
};

window.CHARACTERS = [
  { id: 'haru', name: 'ハル', en: 'HARU', kind: 'cloud', color: '#8fc8f0', accent: '#4a90c8',
    profile: 'ふわふわの雲の子。いつもぼんやり空を見ている。' },
  { id: 'byeol', name: 'ビョル', en: 'BYEOL', kind: 'star', color: '#ffd76a', accent: '#e0a520',
    profile: 'きらきら好きの星の子。夜になると元気になる。' },
  { id: 'dalbit', name: 'タルビ', en: 'DALBIT', kind: 'rabbit', color: '#c9b8f0', accent: '#8a6fd0',
    profile: '月明かりのうさぎ。おもちとお昼寝が大好き。' },
  { id: 'gomi', name: 'ゴミ', en: 'GOMI', kind: 'bear', color: '#f2b8a0', accent: '#d07a5a',
    profile: 'のんびり屋のくま。ポケットにいつもおやつ。' },
];

window.CATEGORIES = [
  { id: 'plush', name: 'ぬいぐるみ' },
  { id: 'keychain', name: 'キーホルダー' },
  { id: 'stationery', name: 'ステーショナリー' },
  { id: 'living', name: '雑貨・リビング' },
  { id: 'bag', name: 'バッグ・ポーチ' },
];

/*
 * shape: 商品イラストの形（plush / keychain / sticker / note / mug / tote / pouch）
 * limited: 会場限定品 / limit: お一人様の購入上限 / stock: 在庫数
 */
window.PRODUCTS = [
  { id: 'p01', name: 'ハル もちもちぬいぐるみ M', character: 'haru', category: 'plush', shape: 'plush', price: 3300, stock: 40, isNew: true,
    desc: '雲みたいにやわらかいもちもち生地。抱きしめサイズのMサイズです。', spec: '約 W24 × H20cm / ポリエステル' },
  { id: 'p02', name: 'ビョル もちもちぬいぐるみ M', character: 'byeol', category: 'plush', shape: 'plush', price: 3300, stock: 32,
    desc: 'きらきら刺繍の星の子ぬいぐるみ。', spec: '約 W24 × H22cm / ポリエステル' },
  { id: 'p03', name: '【会場限定】タルビ おつきみぬいぐるみ', character: 'dalbit', category: 'plush', shape: 'plush', price: 4400, stock: 15, limited: true, limit: 1,
    desc: 'ポップアップ限定の三日月クッション付き。お一人様1点まで。', spec: '約 W26 × H28cm / ポリエステル' },
  { id: 'p04', name: 'ゴミ ぬいぐるみキーホルダー', character: 'gomi', category: 'keychain', shape: 'keychain', price: 1980, stock: 50, isNew: true,
    desc: 'バッグにつけられる手のひらサイズ。', spec: '約 H10cm / ボールチェーン付き' },
  { id: 'p05', name: 'ハル アクリルキーホルダー', character: 'haru', category: 'keychain', shape: 'keychain', price: 880, stock: 80,
    desc: 'オーロラ加工でゆらめく雲のアクキー。', spec: '約 H6cm / アクリル' },
  { id: 'p06', name: 'ビョル アクリルキーホルダー', character: 'byeol', category: 'keychain', shape: 'keychain', price: 880, stock: 80,
    desc: 'ラメ入りアクリルの星のアクキー。', spec: '約 H6cm / アクリル' },
  { id: 'p07', name: 'タルビ アクリルキーホルダー', character: 'dalbit', category: 'keychain', shape: 'keychain', price: 880, stock: 4,
    desc: '夜空グラデーションのアクキー。', spec: '約 H6cm / アクリル' },
  { id: 'p08', name: 'スカイウォーク ステッカーセット', character: 'haru', category: 'stationery', shape: 'sticker', price: 660, stock: 120,
    desc: '4キャラ全員集合のフレークステッカー 12枚入り。', spec: '12枚入り / 透明PET' },
  { id: 'p09', name: 'ビョル きらきらメモ帳', character: 'byeol', category: 'stationery', shape: 'note', price: 550, stock: 90, isNew: true,
    desc: '4柄入りのブロックメモ。', spec: 'A6 / 100枚' },
  { id: 'p10', name: 'タルビ リングノート', character: 'dalbit', category: 'stationery', shape: 'note', price: 990, stock: 60,
    desc: '月夜の表紙の方眼リングノート。', spec: 'B6 / 80枚 / 5mm方眼' },
  { id: 'p11', name: '【会場限定】ハル マグカップ', character: 'haru', category: 'living', shape: 'mug', price: 2200, stock: 20, limited: true, limit: 2,
    desc: '内側にもハルがいる、限定カラーのマグ。お一人様2点まで。', spec: '容量 約320ml / 陶器' },
  { id: 'p12', name: 'ゴミ マグカップ', character: 'gomi', category: 'living', shape: 'mug', price: 1980, stock: 30,
    desc: 'ころんとした形のくまマグ。', spec: '容量 約300ml / 陶器' },
  { id: 'p13', name: 'スカイウォーク キャンバストート', character: 'byeol', category: 'bag', shape: 'tote', price: 2750, stock: 35, isNew: true,
    desc: 'A4が入る厚手キャンバス生地のトート。', spec: '約 W36 × H38cm / 綿100%' },
  { id: 'p14', name: 'タルビ ふわふわポーチ', character: 'dalbit', category: 'bag', shape: 'pouch', price: 1650, stock: 0,
    desc: 'ボア素材のふわふわポーチ。', spec: '約 W18 × H12cm / ポリエステル' },
  { id: 'p15', name: 'ゴミ フラットポーチ', character: 'gomi', category: 'bag', shape: 'pouch', price: 1430, stock: 45,
    desc: '通帳やマスクも入るフラットポーチ。', spec: '約 W20 × H14cm / 綿' },
  { id: 'p16', name: '【会場限定】4キャラ集合トート', character: 'gomi', category: 'bag', shape: 'tote', price: 3300, stock: 12, limited: true, limit: 1,
    desc: 'ポップアップ限定デザインのトート。お一人様1点まで。', spec: '約 W36 × H38cm / 綿100%' },
];
