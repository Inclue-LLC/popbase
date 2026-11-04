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
// Shopify のメタオブジェクト定義は 1 つにつき 40 項目までなので、イベントの設定はまとめて 1 つの JSON に入れる
const EVENT_FIELDS = [
  t('settings', 'イベントの設定（管理画面が書き込みます）', 'json'),
  t('layout', '棚の配置（管理画面が書き込みます）', 'json'),
  t('admin_meta', '管理情報（管理画面が書き込みます）', 'json'),
];

const PRODUCT_FIELDS = [
  // 他社のキャラクターも入れられるよう、自由に入力できる文字にする（ハル・ビョル・タルビ・ゴミは自社のキャラクターとして扱う）
  { key: 'character', name: 'キャラクター', type: 'single_line_text_field' },
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
