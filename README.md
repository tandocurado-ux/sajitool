# サジェツール

複数顧客の Google / Yahoo! 検索順位・SERP・サジェストを、地域 × デバイス × 時刻で定時計測する SaaS のフロントエンド。

- Next.js 16 (App Router / Turbopack) + TypeScript + Tailwind CSS v4
- Supabase (Auth + Postgres + RLS)。ブラウザ・サーバーとも anon key のみを使い、認可は RLS に委ねる

## セットアップ

1. `.env.local` に Supabase の値を設定する（`.env.example` 参照）

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
   ```

2. 依存関係をインストールして開発サーバーを起動する

   ```bash
   npm install
   npm run dev
   ```

## スクリプト

| コマンド            | 内容                       |
| ------------------- | -------------------------- |
| `npm run dev`       | 開発サーバー               |
| `npm run build`     | 本番ビルド                 |
| `npm run typecheck` | `tsc --noEmit`             |
| `npm run lint`      | ESLint                     |
| `npm run check:data` | 市区町村データの網羅性チェック |

## 画面

| パス            | 内容                                                                       |
| --------------- | -------------------------------------------------------------------------- |
| `/login`        | メール＋パスワードのログイン／新規登録（切替式）                           |
| `/dashboard`    | 実行状況サマリ（直近24時間・7日間の status 別内訳、直近20件、ブロック率警告） |
| `/clients`      | 顧客一覧・追加・削除                                                       |
| `/clients/[id]` | キーワード／地域／スケジュール／実行履歴／地域比較（タブ）                 |
| `/clients/[id]/setup` | まとめて登録（キーワード×検索エンジン×地域×デバイスを一括作成）     |

ダッシュボードのブロック率警告は、直近24時間に実行があればその期間、無ければ直近7日間を
対象に判定する（しきい値 20%、`lib/runs.ts` の `BLOCKED_RATE_THRESHOLD`）。

## ディレクトリ構成

```
app/
  (app)/            認証必須のページ群（ヘッダー＋ログアウト）
  login/            未ログインでもアクセス可
components/         フォームなどの UI
lib/
  supabase/         ブラウザ用・サーバー用クライアントと環境変数
  parse.ts          入力値の正規化（キーワード行・時刻）
  runs.ts           実行履歴の集計・日時整形
  japan.ts          都道府県・市区町村の参照と緯度経度の範囲チェック
  municipalities.ts 市区町村データ（自動生成・手で編集しない）
scripts/            市区町村データの生成とチェック
server/
  <domain>/         actions.ts / queries.ts / schema.ts をドメインごとに同居
proxy.ts            セッション更新と未ログイン時のリダイレクト
engine/             検索実行エンジン（Python + nodriver）
```

## 登録の流れ

1件ずつ登録するなら `/clients/[id]` の各タブ、まとめて登録するなら
`/clients/[id]/setup`（顧客一覧と顧客詳細の「まとめて登録」ボタンから）。

一括登録では次の組み合わせがまとめて作られる。

    キーワード数 × 検索エンジン数 × 地域数 × デバイス数

- キーワードはテキストエリアに1行1つで貼り付ける
- 検索エンジン・デバイスは「両方」を選べる（その場合それぞれ2倍になる）
- 登録済みの `keyword × platform`、および同じ `keyword × region × device` の
  スケジュールはスキップする（二重登録されない）
- 実行前に作成件数を確認ダイアログに出す。途中で失敗した場合は
  どこまで作成できたかを画面に表示する

### 地域の入力

都道府県 → 市区町村の2段プルダウンで選ぶ。緯度経度は市区町村の代表点から
自動で入り、画面では参考表示のみで編集できない。ラベルは省略すると
「愛知県名古屋市中区」のように自動生成される。

政令指定都市は「市」単体では選べず、区単位（「大阪市住之江区」など）で並ぶ。
計測エンジンは `regions.prefecture` を SOAX の exit 地域指定にそのまま使うため、
表記ゆれが出ないよう手入力を廃止している。

### 時刻の入力

00:00〜23:45 の15分刻み（96択）から選んで「+ 時刻を追加」で積む。
追加済みの時刻はチップで個別に外せる。同じ時刻は二重に選べない。

## 市区町村データ

`lib/municipalities.ts` は自動生成ファイル。**手で編集しない。**

| 項目 | 値 |
| ---- | -- |
| 都道府県 | 47 |
| 市区町村 | 1896（市町村1718 + 特別区23 − 政令市20 + 行政区175） |
| 政令市の行政区 | 175（20市すべて） |

再生成とチェック:

```bash
curl -o latest.csv https://raw.githubusercontent.com/geolonia/japanese-addresses/master/data/latest.csv
python scripts/generate_municipalities.py latest.csv
npm run check:data
```

`npm run check:data` は政令市20市の区数（大阪市24区、名古屋市16区、横浜市18区…）、
東京23区、総数1896件、座標が日本の範囲内かを検証し、1つでも欠けたら失敗する。

### 出典

- 市区町村の代表点: [Geolonia 住所データ](https://github.com/geolonia/japanese-addresses)（CC BY 4.0）。
  国土交通省「位置参照情報」および総務省統計局「国勢調査町丁・字等別境界データ」に由来。
  代表点は町丁目レベル座標の中央値。
- 上記データに町丁目が存在しない **利島村**（東京都）と **球磨郡湯前町**（熊本県）の2件のみ、
  OpenStreetMap（© OpenStreetMap contributors, ODbL）の行政界重心で補完。

## 認証まわりの方針

- `proxy.ts`（Next.js 16 で `middleware.ts` から改称）でセッション Cookie を更新し、未ログインなら `/login` へ振り分ける。これは楽観的なリダイレクトにすぎない
- 実際の認可は **RLS** と、各 Server Component / Server Action 内の `supabase.auth.getUser()` で行う。`getSession()` は認可判定に使わない
- Server Action は直接 POST でも到達できるため、すべての Action で `getUser()` と所有権チェックを行っている

## 未対応

- `results`（順位・SERP）の表示。計測エンジン側が書き込むのは後フェーズ
- `lib/types.ts` は手書きの行型。Supabase CLI が使えるようになったら
  `npx supabase gen types typescript --project-id <ref>` の生成物に置き換える

## 検索実行エンジン（engine/・フェーズ2a）

`schedules` を1件読み、その keyword × region × device × platform で Google または
Yahoo! の検索を実際に1回実行する「撃つだけ」スクリプト。
スクリーンショット・順位・SERP の保存はしない（後フェーズ）。`results` テーブルにも触らない。
**`runs` への実行ログ記録だけは必ず行う**（撃ったのに実は全部 blocked だった、を検知するため）。
スケジューラも次フェーズ。

### セットアップ

```bash
python -m venv engine/.venv
engine/.venv/Scripts/python.exe -m pip install -r engine/requirements.txt
cp engine/.env.example engine/.env   # SUPABASE_SERVICE_ROLE_KEY と SOAX_* を埋める
```

### 実行

```bash
python engine/run_once.py --schedule-id <uuid>
python engine/run_once.py --schedule-id <uuid> --no-proxy   # 直結（exit_ip は null）
```

DB を触らずにブラウザのレシピだけ確かめたいとき:

```bash
python engine/run_once.py --dry-run --no-proxy \
  --platform google --device pc \
  --keyword "不用品回収 名古屋" --lat 35.1681 --lng 136.9066
```

`--debug-screenshot <DIR>` を付けるとローカルにスクショを残せる（DB にも Storage にも上げない。
Yahoo! の実測で画面を確認するためのもの）。

### runs への記録

実行1回につき `runs` に1行入る。

| 結果                 | status    | exit_ip                      |
| -------------------- | --------- | ---------------------------- |
| 検索成立             | `ok`      | プロキシ使用時のみ実 IP      |
| ボット検知ページ到達 | `blocked` | 同上                         |
| その他失敗           | `error`   | 同上（`--no-proxy` では null） |

`runs.status` は CHECK 制約で3値しか取れないため、実行開始時ではなく結果確定後に
1行 insert する（`run_at` には開始時刻を入れる）。

### 構成

```
engine/
  run_once.py       エントリポイント（schedules 読み → 検索 → runs insert）
  search_google.py  Google レシピ（本番実証済み）
  search_yahoo.py   Yahoo! レシピ（実測しながら調整する初版）
  device.py         pc / mobile の記述子と、両レシピ共通のブラウザ context
  db.py             Supabase（schedules 読み込み + runs insert）
```

### 検索レシピ（変更禁止）

- URL 直行はしない。トップページから検索窓に1文字ずつ 50〜150ms でタイプする
- Enter は CDP の `Input.dispatchKeyEvent` で送る
- Google Chrome の実バイナリを使う（Chromium では通らない）
- 地点指定は about:blank → 権限付与 → `setGeolocationOverride(accuracy=100)` →
  トップを開く → **必ずリロード** → タイプ の順
- 結果は固定 sleep ではなくポーリングし、件数が3回連続で増えなくなるまで待つ（最大10秒）
- 画像・メディア・フォントは CDP で abort し、HTML/JS/CSS だけ通す

### 成否判定

| platform | ok の条件                                              | blocked の印                                             |
| -------- | ------------------------------------------------------ | -------------------------------------------------------- |
| google   | `final_url` に `/search?` があり結果要素が1件以上       | `/sorry/`                                                 |
| yahoo    | `final_url` に `search.yahoo.co.jp/search` があり結果要素あり | `/captcha` `captcha.yahoo` `login.yahoo.co.jp` `ipblock` `/notice/` |

`/search?` に到達していない場合は `not_searched` として `error` にする
（検索窓に文字が入っただけの誤成功を防ぐガード）。Yahoo! の判定文字列は
`search_yahoo.py` の定数にまとめてあり、実測に合わせて調整できる。

### 検証手順

1. `--no-proxy` で google × pc を1回。`runs` に `ok` が入ることを確認する
2. google × mobile → yahoo × pc → yahoo × mobile を順に確認する
3. 最後に SOAX 込み（`--no-proxy` なし）で再確認し、`runs.exit_ip` に住宅 IP が入ることを見る

### 実測状況（2026-09-22 / --no-proxy・自宅 IP）

| platform × device | 結果                                                                     |
| ----------------- | ------------------------------------------------------------------------ |
| google × pc       | `ok`（9件）                                                              |
| google × mobile   | `blocked`（検索は送信できているが Google が `/sorry/` を返す）           |
| yahoo × pc        | `ok`（19件、`search.yahoo.co.jp/search?p=...`）                          |
| yahoo × mobile    | `ok`（17件。検索窓は候補4番目の `input[type=search]` がヒット）          |

google × mobile はプロキシ無しの固定 IP だと繰り返しブロックされる。SOAX 住宅 IP での
再確認が必要（手順3）。

### 既知の制約・注意

- `nodriver` は 0.48 以降 `cdp/network.py` に非UTF-8バイトが混入していて import
  できないため、0.47.0 に固定している
- モバイル記述子ではマウスクリックだとフォーカスが body に戻されるため、
  `Input.dispatchTouchEvent` でタップしてから入力している
- 検索窓・結果要素のセレクタは platform × device ごとに候補を並べて順に試す
  （`search_*.py` の `SEARCH_BOX_SELECTORS` / `RESULT_SELECTORS`）
