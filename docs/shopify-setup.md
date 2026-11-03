# Shopify 連携の設定手順

バーチャルポップアップは、次のように役割を分けています。

| 管理するもの | どこで |
| --- | --- |
| 商品・価格・在庫・商品画像・決済 | **Shopify 管理画面**（いつもの商品管理） |
| 棚の配置・内装（壁紙・床・色）・会期・看板の文字 | **店内管理画面**（`/admin`。保存先は Shopify） |

店内管理画面の使い方は [docs/admin-guide.md](admin-guide.md) を見てください。
ここでは、Shopify とつなぐための初期設定（1回だけ・技術担当向け）を説明します。

> Shopify の管理画面は、時期によってメニューの名前や場所が変わることがあります。
> 見つからないときは、Shopify ヘルプセンターで「Headless チャネル」「アプリを開発」「Admin API アクセストークン」などを検索してください。

---

## 1. お客さんのサイト用：Storefront API のトークン（公開してよいトークン）

1. Shopify 管理画面 → **販売チャネル** → 「**Headless**」チャネルを追加（無料）
2. Headless → **ストアフロントを作成**
3. Storefront API の **権限** で次をオンにする
   - 商品の閲覧（`unauthenticated_read_product_listings`）
   - 商品の在庫の閲覧（`unauthenticated_read_product_inventory`）※「残りわずか」表示用。オフでも動きます
   - チェックアウト／カートの作成（`unauthenticated_write_checkouts` など）
   - メタオブジェクトの閲覧（`unauthenticated_read_metaobjects`）
4. **公開アクセストークン**（public access token）をコピーし、`js/data.js` の `SHOPIFY_CONFIG` に入力

```js
window.SHOPIFY_CONFIG = {
  domain: 'your-store.myshopify.com',
  storefrontToken: 'ここに公開アクセストークン',
  apiVersion: '2025-01',
  collection: 'popup',
  eventHandle: 'current',
};
```

公開アクセストークンはブラウザに公開される前提のものなので、サイトに書いて問題ありません。

## 2. 店内管理画面用：Admin API のトークン（秘密のトークン）

1. Shopify 管理画面 → **設定 → アプリと販売チャネル → アプリを開発**（または Shopify の開発者ダッシュボード）でアプリを作成
2. **Admin API の権限** に次を付ける
   - `read_products`
   - `read_metaobjects`, `write_metaobjects`
   - `read_files`, `write_files`
   - 初期設定スクリプト（次の手順3）を使う場合は、加えて `write_metaobject_definitions`, `write_products`
3. アプリをインストールし、**Admin API アクセストークン**（`shpat_` で始まる）を取得
4. **サーバーの環境変数**に設定する（ファイルには書かない）

| 環境変数 | 例 |
| --- | --- |
| `SHOPIFY_STORE_DOMAIN` | `your-store.myshopify.com` |
| `SHOPIFY_ADMIN_TOKEN` | `shpat_xxxxxxxx` |
| `SHOPIFY_COLLECTION` | `popup`（省略可） |

> **重要**：Admin API のトークンはストアのほぼすべてを操作できる鍵です。
> `js/data.js` など、ブラウザに届くファイルには**絶対に**書かないでください。GitHub にも入れないでください。

この2つが設定されていると、店内管理画面の保存先が自動で Shopify になります（画面右上に「保存先：Shopify」と表示されます）。

## 3. 定義を作る（自動）

手順2の環境変数を設定したターミナルで、次を1回だけ実行します。

```bash
npm run shopify:setup
```

次のものが作成されます（すでにあればそのまま）。

- メタオブジェクト定義「**POP UPイベント**」（タイプ `popup_event`、ストアフロントから読み取り可）
  - 店内管理画面が、エントリー `draft`（下書き）と `current`（公開中）を自動で作成・更新します
- 商品メタフィールド定義（ネームスペース `popup`）

| 管理画面での表示 | キー | 内容 |
| --- | --- | --- |
| キャラクター | `popup.character` | `ハル` / `ビョル` / `タルビ` / `ゴミ` |
| 会場限定 | `popup.limited` | オンで「会場限定」マーク |
| お一人様の購入上限 | `popup.purchase_limit` | 例: 1 |
| 仕様（サイズ・素材） | `popup.spec` | 例: 約 W24 × H20cm / ポリエステル |
| 棚での大きさ | `popup.size` | `大` / `中` / `小` |

スクリプトが使えない場合は、Shopify 管理画面の **設定 → カスタムデータ** で同じ定義を手で作成してください
（POP UPイベントのフィールド一覧は `server/admin/shopify-setup.js` の `EVENT_FIELDS` にあります）。

## 4. コレクションと商品

- **商品管理 → コレクション** で、ハンドルが `popup` のコレクションを作り、店内に出す商品を入れます。
- 商品が **Headless チャネルに公開** されていることを確認してください。
- 店内管理画面の「商品の配置」に、このコレクションの商品が並びます。

| Shopify の項目 | 店内での使われ方 |
| --- | --- |
| 商品名・説明・価格 | 商品詳細・値札 |
| 商品画像（1枚目） | 棚に並ぶ姿（**背景を透明にした PNG・正方形** がおすすめ） |
| タグ `new` | NEW マーク |
| 在庫 | 0 で SOLD OUT。5 以下で「残りわずか」 |

## 5. ガチャのクーポン

**割引** で次のディスカウントコードを作成します（`js/data.js` の `GACHA_PRIZES` と同じコード）。

| コード | 割引 |
| --- | --- |
| HANEUL5 | 5% |
| HANEUL10 | 10% |
| HANEUL15 | 15% |
| HANEUL20 | 20% |

> ガチャはお客さんのブラウザで抽選しているため、コードが SNS などで共有される可能性があります。
> 「お客様1人につき1回まで」「期間をイベント会期に限定」の設定を必ず入れてください。

## 注意

- 「お一人様の購入上限」はサイト上のカートで制限しています。購入手続きの段階でも確実に止めたい場合は、
  Shopify の購入数制限アプリ（またはチェックアウトの検証機能）を併用してください。
- 下書き（エントリー `draft`）もストアフロント API から読める設定になります。公開前の内容を絶対に見られたくない場合はご相談ください。
