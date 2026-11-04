/*
 * Shopify の初期設定を自動で行う（npm run shopify:setup）
 *   - メタオブジェクト定義「POP UPイベント」（popup_event）を作成
 *   - 商品メタフィールド定義（popup.character / limited / purchase_limit / spec / size）を作成
 * すでにある場合はそのままにします。必要な環境変数は store-shopify.js と同じです。
 * Admin API の権限: write_metaobject_definitions, write_metaobjects, read_products, write_products（メタフィールド定義用）, write_files, read_files
 */
const auth = require('./shopify-token');

const DOMAIN = auth.DOMAIN;
const VERSION = process.env.SHOPIFY_API_VERSION || '2025-01';
const ENDPOINT = process.env.SHOPIFY_ADMIN_URL || `https://${DOMAIN}/admin/api/${VERSION}/graphql.json`;

if (!process.env.SHOPIFY_ADMIN_URL && !auth.configured) {
  console.error('SHOPIFY_STORE_DOMAIN と、SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET（または SHOPIFY_ADMIN_TOKEN）を設定してから実行してください');
  process.exit(1);
}

async function gql(query, variables) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': await auth.getToken() },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join(' / '));
  return json.data;
}

const t = (key, name, type) => ({ key, name, type });
const EVENT_FIELDS = [
  t('brand', 'ブランド名', 'single_line_text_field'),
  t('title', 'イベント名', 'single_line_text_field'),
  t('subtitle', 'サブタイトル', 'single_line_text_field'),
  t('period', '会期', 'single_line_text_field'),
  t('open_at', '開始日時（YYYY-MM-DDTHH:MM）', 'single_line_text_field'),
  t('close_at', '終了日時（YYYY-MM-DDTHH:MM）', 'single_line_text_field'),
  t('daily_open', '毎日の開店時刻（HH:MM）', 'single_line_text_field'),
  t('daily_close', '毎日の閉店時刻（HH:MM）', 'single_line_text_field'),
  t('theme_preset', 'ベースのテーマ', 'single_line_text_field'),
  t('wall_image', '壁紙の画像', 'file_reference'),
  t('wall_color', '壁の色', 'color'),
  t('wall_pattern', '壁の柄', 'single_line_text_field'),
  t('wall_pattern_color', '柄の色', 'color'),
  t('lower_color', '腰壁の色', 'color'),
  t('trim_color', '見切りの色', 'color'),
  t('floor_image', '床の画像', 'file_reference'),
  t('floor_style', '床の種類', 'single_line_text_field'),
  t('floor_color_1', '床の色1', 'color'),
  t('floor_color_2', '床の色2', 'color'),
  t('sign_color', '看板の色', 'color'),
  t('sign_text_color', '看板の文字色', 'color'),
  t('light', '照明', 'single_line_text_field'),
  t('left_title', '左の棚の看板（英字）', 'single_line_text_field'),
  t('left_label', '左の棚の看板（日本語）', 'single_line_text_field'),
  t('right_title', '右の棚の看板（英字）', 'single_line_text_field'),
  t('right_label', '右の棚の看板（日本語）', 'single_line_text_field'),
  t('font', 'ショップの基本フォント', 'single_line_text_field'),
  t('novelty', '購入特典のあり・なし', 'single_line_text_field'),
  t('novelty_threshold', '特典の条件金額', 'number_integer'),
  t('novelty_name', '特典の名前', 'single_line_text_field'),
  t('entrance_kicker', '入口：上の小さい文字', 'single_line_text_field'),
  t('entrance_heading', '入口：大きい見出し', 'single_line_text_field'),
  t('entrance_message', '入口：見出しの下の文字', 'single_line_text_field'),
  t('entrance_notice', '入口：お知らせ', 'multi_line_text_field'),
  t('entrance_button', '入口：ボタンの文字', 'single_line_text_field'),
  t('entrance_logo', '入口：ロゴ画像', 'file_reference'),
  t('entrance_image', '入口：背景の画像', 'file_reference'),
  t('entrance_color_top', '入口：背景の色（上）', 'color'),
  t('entrance_color_bottom', '入口：背景の色（下）', 'color'),
  t('entrance_heading_color', '入口：大きい見出しの色', 'color'),
  t('entrance_text_color', '入口：そのほかの文字の色', 'color'),
  t('entrance_characters', '入口：キャラクター', 'single_line_text_field'),
  t('characters', 'キャラクター（管理画面が書き込みます）', 'json'),
  t('avatars', 'アバター（管理画面が書き込みます）', 'json'),
  t('layout', '棚の配置（管理画面が書き込みます）', 'json'),
  t('admin_meta', '管理情報（管理画面が書き込みます）', 'json'),
];

const PRODUCT_FIELDS = [
  { key: 'character', name: 'キャラクター', type: 'single_line_text_field', validations: [{ name: 'choices', value: JSON.stringify(['ハル', 'ビョル', 'タルビ', 'ゴミ']) }] },
  { key: 'limited', name: '会場限定', type: 'boolean' },
  { key: 'purchase_limit', name: 'お一人様の購入上限', type: 'number_integer' },
  { key: 'spec', name: '仕様（サイズ・素材）', type: 'single_line_text_field' },
  { key: 'size', name: '棚での大きさ', type: 'single_line_text_field', validations: [{ name: 'choices', value: JSON.stringify(['大', '中', '小']) }] },
];

(async () => {
  const mo = await gql(`
    mutation Def($definition: MetaobjectDefinitionCreateInput!) {
      metaobjectDefinitionCreate(definition: $definition) {
        metaobjectDefinition { id type }
        userErrors { field message code }
      }
    }`, {
    definition: {
      type: 'popup_event',
      name: 'POP UPイベント',
      access: { storefront: 'PUBLIC_READ' },
      fieldDefinitions: EVENT_FIELDS,
    },
  });
  const moErr = mo.metaobjectDefinitionCreate.userErrors;
  if (moErr.length && !moErr.some((e) => e.code === 'TAKEN')) throw new Error(moErr.map((e) => e.message).join(' / '));
  if (!moErr.length) console.log('・POP UPイベント の定義を作成しました');
  else {
    // すでにある定義に、足りないフィールド（新しく追加した項目）だけを追加する
    const cur = await gql(`
      query Existing($type: String!) {
        metaobjectDefinitionByType(type: $type) { id fieldDefinitions { key } }
      }`, { type: 'popup_event' });
    const def = cur.metaobjectDefinitionByType;
    const have = new Set(def.fieldDefinitions.map((f) => f.key));
    const missing = EVENT_FIELDS.filter((f) => !have.has(f.key));
    if (missing.length) {
      const up = await gql(`
        mutation Update($id: ID!, $definition: MetaobjectDefinitionUpdateInput!) {
          metaobjectDefinitionUpdate(id: $id, definition: $definition) {
            metaobjectDefinition { id }
            userErrors { field message code }
          }
        }`, { id: def.id, definition: { fieldDefinitions: missing.map((f) => ({ create: f })) } });
      const upErr = up.metaobjectDefinitionUpdate.userErrors;
      if (upErr.length) throw new Error(upErr.map((e) => e.message).join(' / '));
      console.log(`・POP UPイベント の定義に ${missing.length} 項目を追加しました（${missing.map((f) => f.key).join(', ')}）`);
    } else {
      console.log('・POP UPイベント の定義はすでにあります（追加する項目はありません）');
    }
  }

  for (const f of PRODUCT_FIELDS) {
    const r = await gql(`
      mutation MF($definition: MetafieldDefinitionInput!) {
        metafieldDefinitionCreate(definition: $definition) {
          createdDefinition { id }
          userErrors { field message code }
        }
      }`, {
      definition: { ...f, namespace: 'popup', ownerType: 'PRODUCT', access: { storefront: 'PUBLIC_READ' } },
    });
    const errs = r.metafieldDefinitionCreate.userErrors;
    if (errs.length && !errs.some((e) => e.code === 'TAKEN')) throw new Error(`${f.key}: ${errs.map((e) => e.message).join(' / ')}`);
    console.log(errs.length ? `・商品メタフィールド popup.${f.key} はすでにあります` : `・商品メタフィールド popup.${f.key} を作成しました`);
  }
  console.log('完了しました。続けてコレクション「popup」に商品を入れ、/admin から配置してください。');
})().catch((e) => { console.error('失敗しました:', e.message); process.exit(1); });
