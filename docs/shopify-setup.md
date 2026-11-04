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

## 2. 店内管理画面用：Admin API の鍵（秘密の鍵）

2026年から、ストアの管理画面で「カスタムアプリ」を新しく作ることはできなくなり、**Dev Dashboard** でアプリを作る方法に変わりました。
このサイトのサーバーは、アプリの **クライアント ID とシークレット** を使って、必要なときに Shopify からアクセストークンを受け取ります（期限が切れる前に自動で取り直します）。

1. Shopify 管理画面 → **設定 → アプリ → 「アプリを開発」**（または Dev Dashboard）で、アプリを作成（名前の例: `POP BASE 店内管理`）
2. アプリの **バージョン（設定）** で、Admin API のスコープ（権限）に次を付けて、バージョンを公開（リリース）する
   - `read_products`, `write_products`
   - `read_metaobjects`, `write_metaobjects`, `write_metaobject_definitions`
   - `read_files`, `write_files`
3. アプリを **このストア（popbase.myshopify.com）にインストール** する
4. アプリの **設定** 画面にある **クライアント ID** と **シークレット** を、サーバーの環境変数に設定する（ファイル・チャットには書かない）

| 環境変数 | 例 |
| --- | --- |
| `SHOPIFY_STORE_DOMAIN` | `popbase.myshopify.com` |
| `SHOPIFY_CLIENT_ID` | アプリのクライアント ID |
| `SHOPIFY_CLIENT_SECRET` | アプリのシークレット |
| `SHOPIFY_COLLECTION` | `popup`（省略可） |

> 以前の方法で作ったアプリの `shpat_` で始まるトークンがある場合は、`SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET` の代わりに `SHOPIFY_ADMIN_TOKEN` に設定しても動きます。

> **重要**：シークレットとトークンは、ストアのほぼすべてを操作できる鍵です。
> `js/data.js` など、ブラウザに届くファイルには**絶対に**書かないでください。GitHub にも入れないでください。

これらが設定されていると、店内管理画面の保存先が自動で Shopify になります（画面右上に「保存先：Shopify」と表示されます）。
うまくつながらないときは、サーバーのログに「Shopify のアクセストークンを取得できませんでした」と理由が出ます。

## 3. 定義を作る（自動）

手順2の環境変数を設定したターミナルで、次を1回だけ実行します。

```bash
npm run shopify:setup
```

次のものが作成されます（すでにあればそのまま）。

- メタオブジェクト定義「**POP UPイベント**」（タイプ `popup_event`、ストアフロントから読み取り可。項目は `settings`（イベントの設定をまとめた JSON）・`layout`（棚の配置）・`admin_meta`（管理情報）の3つ）
  - 店内管理画面が、エントリー `draft`（下書き）と `current`（公開中）を自動で作成・更新します
- 商品メタフィールド定義（ネームスペース `popup`）

| 管理画面での表示 | キー | 内容 |
| --- | --- | --- |
| キャラクター | `popup.character` | 自由入力（`ハル` / `ビョル` / `タルビ` / `ゴミ` は自社キャラクターとして扱う。他社のキャラクター名も入れられる） |
| 会場限定 | `popup.limited` | オンで「会場限定」マーク |
| お一人様の購入上限 | `popup.purchase_limit` | 例: 1 |
| 仕様（サイズ・素材） | `popup.spec` | 例: 約 W24 × H20cm / ポリエステル |
| 棚での大きさ | `popup.size` | `大` / `中` / `小` |

サイトを更新して管理画面に新しい項目（入口の画面・フォント・キャラクターなど）が増えたときも、**もう一度このコマンドを実行**してください。
すでにある定義に、足りない項目だけが追加されます。

スクリプトが使えない場合は、Shopify 管理画面の **設定 → カスタムデータ** で同じ定義を手で作成してください
（POP UPイベントの項目は `server/admin/shopify-setup.js` の `EVENT_FIELDS` にあります）。

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

## 注意

- 「お一人様の購入上限」はサイト上のカートで制限しています。購入手続きの段階でも確実に止めたい場合は、
  Shopify の購入数制限アプリ（またはチェックアウトの検証機能）を併用してください。
- 下書き（エントリー `draft`）もストアフロント API から読める設定になります。公開前の内容を絶対に見られたくない場合はご相談ください。
