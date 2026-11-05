# popbase.jp で公開する手順（Render ＋ Xserverドメイン）

お店のサーバーを **Render** に置き、**Xserverドメイン** で取った `popbase.jp` をつなぎます。
設定は `render.yaml` に書いてあるので、画面の操作は少なくて済みます。

## 費用の目安

| 項目 | 金額 |
| --- | --- |
| Render のサーバー（Starter） | 月 7 ドル程度 |
| 保存用ディスク（1GB） | 月 0.25 ドル程度 |
| ドメイン（Xserverドメイン） | 取得済み（毎年の更新料のみ） |

無料プランは、しばらくアクセスがないと止まり、保存先も使えないため、このお店には使えません。
金額は変わることがあります。最新は Render の料金ページで確認してください。

## 1. 公開するブランチを決める

Render は、GitHub のリポジトリの決まったブランチを公開します。
これまでの変更は `claude/wonderful-faraday-owyz8u` ブランチにあるので、`main` に取り込んでから公開するのがおすすめです
（取り込み用のプルリクエストが必要なら作ります）。

## 2. Render にサーバーを作る

1. https://render.com で、GitHub のアカウントでサインアップします
2. 画面の案内に沿って、Render から `Inclue-LLC/popbase` を読めるように GitHub を許可します
3. 「New ＋」→「**Blueprint**」→ リポジトリ `popbase` を選びます
4. `render.yaml` の内容（サーバー `popbase`）が表示されます。次の 2 つを入力します
   - `ADMIN_INITIAL_USER` … 管理画面のログイン名（半角英数字、例: `staff`）
   - `ADMIN_INITIAL_PASSWORD` … パスワード（10文字以上。ほかで使っていないもの）
5. 支払い方法を登録して「Apply」を押します。数分で公開されます

公開されると、`https://popbase-xxxx.onrender.com` のような仮のアドレスが表示されます。

## 3. 仮のアドレスで確認する

1. 仮のアドレスを開いて、入口が表示されることを確認します
2. `（仮のアドレス）/admin` を開き、2. で入れた名前とパスワードでログインします
3. ログインできたら、Render の「Environment」で **`ADMIN_INITIAL_PASSWORD` を削除** して保存します
   （アカウントは保存済みなので、消してもログインできます）

> 仮のアドレスでも、同時接続（他のお客さんのアバター）と入場制限は popbase.jp と同じように動きます。

## 4. popbase.jp をつなぐ

1. Render のサーバー `popbase` の「Settings」→「**Custom Domains**」を開きます。
   `popbase.jp` と `www.popbase.jp` が並び、それぞれに設定する値（DNS レコード）が表示されます
2. Xserverドメインの管理画面で、`popbase.jp` の「**DNSレコード設定**」を開き、表示された値を追加します

   | ホスト名 | 種別 | 内容 |
   | --- | --- | --- |
   | （空欄。popbase.jp そのもの） | A | Render の画面に出る IP アドレス（例: `216.24.57.1`） |
   | www | CNAME | Render の画面に出るアドレス（例: `popbase-xxxx.onrender.com`） |

   - 必ず **Render の画面に表示された値** を使ってください（上の例と違うことがあります）
   - 同じホスト名に、もともと A レコードや CNAME がある場合は、それを消してから追加します
3. 反映には数分〜数時間かかります。Render の画面で「Verified」になると、HTTPS（鍵マーク）も自動で設定されます
4. https://popbase.jp を開いて、入口が表示されれば完了です

## 5. 接続元の判定を確認する（大事）

同じ人からの接続数の上限や、ログイン失敗の制限は、お客さんの接続元（IP アドレス）で見分けています。
公開サービスでは中継サーバーを通るため、正しく見分けられているかを一度確認してください。

1. パソコンで https://popbase.jp/api/ip を開きます
2. スマホで **Wi-Fi を切って**（モバイル回線で）同じアドレスを開きます
3. 2 つの `ip` が **違う値** で、それぞれ「確認くん」などの IP 確認サイトで出る値と同じなら、問題ありません

同じ値が出る、または確認サイトと違う値が出る場合は、技術担当（または Claude）に連絡してください。
Render の「Environment」で `CLIENT_IP_HEADER` か `TRUST_PROXY_HOPS` を設定して直します（`server/client-ip.js`）。

## 6. 公開前に管理画面で設定すること

- 「内装・イベント」のブランド名・イベント名・開始日時・終了日時（必須）を入れて「公開する」
- 開始日時より前は、入口に「まもなくオープン」と出て入店できません。
  関係者だけで先に試すときは、開始日時を今日にして公開し、本番の前に正しい日時に直してください

## 更新のしかた

`main` ブランチに変更を取り込むと、Render が自動で入れ替えます（数分）。
入れ替えの間、店内のお客さんは一度切断され、自動でつなぎ直します。営業中の更新はなるべく避けてください。

## Shopify をつなぐとき

Render の「Environment」に `SHOPIFY_STORE_DOMAIN` と `SHOPIFY_ADMIN_TOKEN` を足し、
`js/data.js` の `SHOPIFY_CONFIG` に Storefront API の公開トークンを書きます（手順: [shopify-setup.md](shopify-setup.md)）。
Admin API のトークンは、Render の「Environment」以外（ファイル・チャットなど）には書かないでください。
