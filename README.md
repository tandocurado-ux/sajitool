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
| `npm run check:actions` | `"use server"` のエクスポート規約チェック |
| `npm run check` | 上記4つをまとめて実行 |

## 画面

| パス            | 内容                                                                       |
| --------------- | -------------------------------------------------------------------------- |
| `/login`        | メール＋パスワードのログイン／新規登録（切替式）                           |
| `/dashboard`    | ホーム。実行状況サマリ（直近24時間・7日間の status 別内訳、直近20件、ブロック率警告） |
| `/dashboard?tab=matrix` | 地域比較を見る顧客を選ぶ                                           |
| `/clients`      | 顧客管理。テーブル表示（キーワード数・地域数・スケジュール・直近実行・本日の実行） |
| `/clients/new`  | 顧客の新規登録（店舗名・キーワード・検索地点・検索時間を1ページで）         |
| `/clients/[id]` | 登録内容サマリ ＋ キーワード／地域／スケジュール／実行履歴／地域比較（タブ） |
| `/clients/[id]/setup` | まとめて登録（既存に足りないスケジュールだけを作る追加モード）       |

ダッシュボードのブロック率警告は、直近24時間に実行があればその期間、無ければ直近7日間を
対象に判定する（しきい値 20%、`lib/runs.ts` の `BLOCKED_RATE_THRESHOLD`）。

ログイン後は左サイドバー固定のレイアウト（`app/(app)/layout.tsx`）。
メニューはホーム／顧客管理／地域比較で、下部にログイン中のメールとログアウト。
モバイル幅ではハンバーガーで開閉する。

## ディレクトリ構成

```
app/
  (app)/            認証必須のページ群（ヘッダー＋ログアウト）
  login/            未ログインでもアクセス可
components/         フォームなどの UI
  setup/            まとめて登録と新規登録で共有するフォーム部品
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

新規顧客は `/clients/new` で登録する（店舗名だけでも作れる）。
既存顧客への追加は `/clients/[id]/setup`。どちらも同じサーバーロジック
（`server/setup/apply.ts`）で作るので、重複判定は1か所にしかない。

**setup は追加モードとして使える。** ページを開くと登録済みのキーワードと地域が
最初から選択済みになっているので、増やしたぶんだけ足せば
「既存 × 新規」で不足しているスケジュールだけが作られる。

- キーワードは「登録済みから選ぶ」＋「新しく貼り付ける」の合算が対象。
  登録済みのものはスケジュール数と使われている時刻も一覧に出る
- 地域だけ足した場合も、選択中の既存キーワード全部との組み合わせが作られる
- 既存スケジュールがあれば **「前回と同じ設定を使う」** が出る。
  検索エンジン・デバイス・時刻の設定を推定して、ワンクリックで復元できる
  （初期値にも反映済み）
- 登録済みの `keyword × platform`、および同じ `keyword × region × device` の
  スケジュールはスキップする（二重登録されない）
- 登録前に「全 N 件の組み合わせのうち、**新規に作られるのは M 件**」を表示する。
  途中で失敗した場合はどこまで作成できたかを画面に表示する

### 顧客名の編集

`/clients` の各行と `/clients/[id]` の見出しに「名前を編集」がある。
その場で入力欄に切り替わり、保存すると両方の画面に反映される。

### 登録内容の見通し

`/clients/[id]` の先頭にサマリカードがある。

- キーワード数（Google / Yahoo! 別）と、スケジュールが1件も無い「未使用」件数
- 地域数と未使用件数
- スケジュール数（有効 / 無効）
- 設定されている時刻の一覧

キーワード一覧・地域一覧にも紐づくスケジュール数が出て、
0件のものには **未使用** バッジが付く。

### 地域の入力

都道府県 → 市区町村の2段プルダウンで選ぶ。緯度経度は市区町村の代表点から
自動で入り、画面では参考表示のみで編集できない。ラベルは省略すると
「愛知県名古屋市中区」のように自動生成される。

政令指定都市は「市」単体では選べず、区単位（「大阪市住之江区」など）で並ぶ。
計測エンジンは `regions.prefecture` を SOAX の exit 地域指定にそのまま使うため、
表記ゆれが出ないよう手入力を廃止している。

### 時刻の入力

一括登録では時刻の決め方を2つから選ぶ。

| モード | 内容 |
| ------ | ---- |
| 全件同じ時刻 | 00:00〜23:45 の15分刻み（96択）から選んで「+ 時刻を追加」で積む。追加済みの時刻はチップで個別に外せる |
| 時刻の自動分散 | **1日の回転数（1〜3回）** と時間帯（例 06:00〜23:00）を選ぶと、各スケジュールに回転数ぶんの時刻を15分枠へ均等に割り振る |

自動分散では、枠数と**互いに素な歩幅**で基準の枠を選び、そこから
「枠数 ÷ 回転数」ずつ離して回転数ぶんの時刻を決める。全枠を均等に使いながら、
同じキーワードの複数パターンが隣り合う枠に固まらない。

登録前に **1日の実行回数 / 1枠あたり最大件数 / 消化見込み**を表示し、
1枠（60分）で消化しきれない設定なら赤字で警告する。
件数が多い顧客は必ず自動分散を使うこと。全件同じ時刻にすると1つの枠に集中し、
スケジューラ側で超過分が捨てられる。

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

## 検索実行エンジン（engine/）

`schedules` を1件読み、その keyword × region × device × platform で Google または
Yahoo! の検索を実際に1回実行する「撃つだけ」スクリプト。
スクリーンショット・順位・SERP の保存はしない（後フェーズ）。`results` テーブルにも触らない。
**`runs` への実行ログ記録だけは必ず行う**（撃ったのに実は全部 blocked だった、を検知するため）。
定時実行は `scheduler.py`、常駐は Render の Background Worker が担う。

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

### 定時実行（scheduler.py・フェーズ2b）

`schedules` の `times` どおりに自動実行する常駐プロセス。検索処理は単発実行と同じ実装を
`runner.py` 経由で呼ぶので、レシピは共通。

```bash
python engine/scheduler.py            # SOAX 経由
python engine/scheduler.py --no-proxy # 直結（ローカル確認用）
```

- 時刻はすべて **JST 固定**（サーバーの TZ 設定に依存しない）
- 起動時と毎分、`enabled=true` の `schedules` を読み直す
- `times` が現在の「分」に一致したらキューに積み、**直列に1件ずつ**実行する
  （Chrome を同時に複数立ち上げない。Google / Yahoo! が混ざっても直列）
- 実行と実行の間にランダムな間隔を空ける。**次に実行するものの platform で決まる**

  | platform | 既定 | 環境変数 |
  | -------- | ---- | -------- |
  | google | 60〜180秒 | `GOOGLE_INTERVAL_MIN_SECONDS` / `GOOGLE_INTERVAL_MAX_SECONDS` |
  | yahoo | 20〜45秒 | `YAHOO_INTERVAL_MIN_SECONDS` / `YAHOO_INTERVAL_MAX_SECONDS` |
  | それ以外 | 60〜180秒 | `RUN_INTERVAL_MIN_SECONDS` / `RUN_INTERVAL_MAX_SECONDS` |

  Google だけが検知されるので、Yahoo! を同じ間隔で縛る必要はない
- 同じ時刻枠に並んだスケジュールは **毎日順序をシャッフル**する
  （毎日同じ順序・同じ間隔で同じキーワードが飛ぶパターンを崩す。
  シードは日付なので、同じ日に再起動しても順序は変わらない）
- 積むときに **同じキーワードが連続しないようラウンドロビン**する。
  同一キーワードの4パターン（google/yahoo × pc/mobile）が数分間隔で連射されるのを
  避けるのが目的。あわせて platform も直前と変える（キーワード優先のベストエフォート）
- 積める件数は **その枠の platform 構成と間隔設定から動的に決まる**。
  1枠（60分）で消化しきれない分は積まずに捨て、警告とアラートを出す
  （当日中の再実行はしない）。google だけなら約30件、yahoo だけなら約110件が目安。
  `QUEUE_MAX_ITEMS` に 0 以外を入れると、件数の絶対上限も併用できる
- 同じ `schedule × 時刻` は同じ日に二度実行しない。再起動時は当日の `runs` を読んで復元する
- **過去分のバックフィルはしない。** 見るのは「前回スキャンの次の分から現在の分まで」で、
  起動前の枠や、起動後に追加されたスケジュールの過去枠は積まない。
  実行が長引いて分をまたいだときだけ、取りこぼさないよう最大5分遡る
- 1件が失敗してもプロセスは死なない。`runs` に `error` で記録して次へ進む
- `Ctrl+C` は実行中の1件を終えてから停止する（もう一度押すと強制終了）

標準出力のログ:

| タイミング | 内容 |
| ---------- | ---- |
| 起動時 | 実行間隔、読み込んだスケジュール数、当日の残り実行予定（時刻と KW × 地域 × デバイス × PF） |
| キューに積むとき | 件数とプラットフォーム別内訳、消化見込み時間 |
| 実行ごと | 単発実行と同じ内容（結果・件数・`runs.id`） |
| 毎時0分 | 直近1時間の集計1行（実行 N 件 / ok N / blocked N / error N） |

```
[09:00] 実行予定に 5 件追加（google 3 / yahoo 2）
    09:00  不用品回収 名古屋 × 名古屋市中区 × pc × google
    …
    消化見込み: 約 10 分（平均間隔 120 秒 × 5 件。検索そのものの時間は別）
```

消化見込みが1時間を超えると次の枠に食い込むため、警告を出す（webhook にも飛ぶ）。

```
⚠ アラート: 09:00 の枠に 40 件が入り、消化に約 80 分かかる見込みです（1枠 60 分）。
次の枠に食い込みます。件数を減らすか実行間隔を詰めてください。
```

1枠にいくつ入るかの目安は **3600 ÷ 平均間隔**。google（平均120秒）なら30件、
yahoo（平均32.5秒）なら110件。混在ならその間になる。
これを超える分はそもそも積まれないので、件数が多い顧客は
一括登録の「時刻の自動分散」で時刻をばらしておくこと。

地域の緯度経度が日本の範囲外のときは実行前に警告を出す（止めはしない）。

### SOAX（住宅IPプロキシ）

パッケージの識別は**パスワード側**で行われる。ユーザー名には package ID を入れず、
オプション文字列そのものを組み立てて渡す（`engine/device.py`）。

```
proxy.soax.com:1337
country-jp-region-osaka-network-res-rotate-timed_300-session-<sessionid>
```

| トークン | 由来 |
| -------- | ---- |
| `country` | `SOAX_COUNTRY`（既定 `jp`） |
| `region` | `regions.prefecture`（日本語）を英語小文字に変換。`SOAX_REGION_ENABLED=0` で省略 |
| `network` | `SOAX_NETWORK`（既定 `res` = 住宅IP） |
| `rotate` | `rotate-timed_<SOAX_ROTATE_SECONDS>`（既定 300秒） |
| `session` | 実行ごとにランダム生成。`SOAX_SESSION_ID` で固定も可 |

実測で確定している注意点:

- **`session` の値は英数字のみ。** ハイフンなどが混ざるとトークンの区切りと解釈されて壊れる。
  英数字以外を除去 → 小文字化 → 32文字以内に詰めてから渡している
- **`onerror` トークンは付けない。** `onerror-rotate` は無効で 400 になる。
  エラー時の挙動はパッケージ既定に任せる
- `region` は英語小文字（`osaka` / `aichi` …）。変換表は `device.py` の
  `PREFECTURE_TO_SOAX_REGION` にある（47都道府県）

#### Google だけ検知されるときの対処

直結では通る・SOAX 経由の Yahoo! も通るのに Google だけ `/sorry/` になる場合、
住宅IPプールに対する Google の評価を疑う。Google のときだけ次を効かせられる。
**Yahoo! 側の組み立ては一切変わらない**ので、片方だけ条件を変えて比較できる。

| 変数 | 既定 | 効果 |
| ---- | ---- | ---- |
| `SOAX_GOOGLE_NETWORK` | `res` | Google のときだけ使うプール。`mob` でモバイルIPに逃がす |
| `SOAX_GOOGLE_OMIT_REGION` | `0` | `1` で Google のときだけ `region` を外して `country-jp` だけで出る。地点は geolocation override で決まるので順位への実害はない |
| `SOAX_GOOGLE_ROTATE_SECONDS` | （空） | Google のときだけローテート間隔を変える。空なら `SOAX_ROTATE_SECONDS` |

3つは併用できる。`SOAX_GOOGLE_NETWORK=mob` + `SOAX_GOOGLE_OMIT_REGION=1` +
`SOAX_GOOGLE_ROTATE_SECONDS=600` なら Google の接続文字列はこうなる。

```
country-jp-network-mob-rotate-timed_600-session-<sessionid>
```

> **モバイルプールは帯域単価が高いことがある。** 住宅IPと同じ感覚で常用せず、
> 切り替えたら SOAX 側の使用量を確認すること。画像・メディア・フォントは
> CDP で落としているので1回あたりの転送量は抑えてあるが、実行件数×日数で効いてくる。

`SOAX_GOOGLE_NETWORK` を未設定にすると `SOAX_NETWORK`（既定 `res`）に従う。
契約パッケージで Residential と Mobile の両方が有効である必要がある
（接続文字列の `network-res_mob` 表記で確認できる）。

#### blocked 時の自動リトライ

`blocked` または `search_box_not_found` のときは、**セッション ID を変えて新しい
exit IP で1回だけ**自動リトライする。`runs` に残るのは最終結果だけだが、
ログと注記に「1回目の status / exit IP → 2回目の status / exit IP」を残す。

- `--no-proxy` のときはリトライしない（IP が変わらないため）
- `SOAX_SESSION_ID` を固定しているときもリトライしない（同じ IP になるため。理由を注記に残す）

#### 検索窓が見つからないとき

同意画面・別レイアウト・`/sorry/` 亜種のどれなのかを切り分けられるよう、
その時点の **URL / ページタイトル / body の先頭500文字** をログと `runs` の注記に出す。
同意画面（`consent.google.com` など）を検出した場合は「同意する」を押して続行する
（`#L2AGLb` などの実クリックを優先し、だめならボタン文言で探して JS クリック）。

### 異常の早期検知（alerts.py）

検知が遅れて計測を取りこぼすのを防ぐため、毎時の集計時に次を判定して通知する。
通知先は `ALERT_WEBHOOK_URL`（Slack / Discord 互換の incoming webhook）。
**未設定でも判定は動き、標準出力には必ず残る。**

| 条件 | 内容 |
| ---- | ---- |
| ブロック率 | 直近3時間の `blocked` が 30% 超（実行5件以上のとき） |
| 停止・詰まり | 直近3時間、実行予定があったのに実行が0件 |
| 連続失敗 | 同じスケジュールが3回連続で `error` |

- 同じ条件の通知は **6時間に1回**まで（連打防止）。連続失敗はスケジュール単位で数える
- 起動直後に「実行0件」で誤検知しないよう、判定の窓は起動時刻以降に限る
- 毎日 **21:00 JST** に当日の実行数 / ok / blocked / error を1行通知する
  （集計は `runs` から取るので、再起動をまたいでも正しい）

## 常駐運用（Render / フェーズ2c）

PC を閉じても時刻どおりに動くよう、`engine/` を Docker 化して Render の
**Background Worker** として常駐させる。HTTP は受けないのでヘルスチェックは不要で、
ログはそのまま Render の Logs に出る。

### イメージの中身

- `python:3.12-slim-bookworm` + **Chrome for Testing をバージョン固定で取得**
  （`CHROME_VERSION`、現在 153.0.8010.52。`/opt/chrome/chrome` に展開）
  - 以前は `google-chrome-stable`（常に最新）だったが、再ビルドで Chrome が 154 に
    上がった途端 nodriver 0.47.0 が「Failed to connect to browser」になり全件 error
    になった（2026-09-24 確認）。**上げる時は必ず `run_once.py --dry-run` で接続確認**
  - Chromium ではレシピが通らないので Chrome 本体（Chrome for Testing）を使う
- `fonts-noto-cjk`（日本語表示）、`xvfb`（仮想ディスプレイ）
- `TZ=Asia/Tokyo`
- 起動時に「Chrome 接続セルフチェック」を1回行い、OK/NG をログに出す
  （NG でも常駐は続く。ログで気づいたら Chrome と nodriver の組み合わせを疑う）

ヘッドレス Chrome は検知されやすく、実証済みのレシピは実ブラウザ前提で通してあるため、
**既定では Xvfb 上で通常の Chrome を起動する**（`docker-entrypoint.sh`）。
`ENGINE_HEADLESS=1` を渡すと Xvfb を使わず `--headless` で動く。

コンテナ差を吸収する起動オプションは `CHROME_EXTRA_ARGS`
（既定 `--no-sandbox --disable-dev-shm-usage --disable-gpu`）で足している。
レシピの必須条件（`--lang=ja` / `Accept-Language` / `TZ`）は `device.py` 側で固定。

### ローカルでのビルド・起動

```bash
# ビルドコンテキストはリポジトリのルート
docker build -f engine/Dockerfile -t sajitool-engine .

# 起動（engine/.env をそのまま渡す）
docker run --rm --env-file engine/.env sajitool-engine

# 単発実行だけ試す
docker run --rm --env-file engine/.env sajitool-engine \
  python run_once.py --schedule-id <uuid> --no-proxy
```

### Render へのデプロイ

1. リポジトリを push し、Render の **Blueprints → New Blueprint Instance** で
   `render.yaml` を読み込む（`type: worker` / `runtime: docker` / `plan: starter`）
2. 作成された Worker の **Environment** に次を設定する（`render.yaml` には値を置かない）

   | 変数 | 必須 | 内容 |
   | ---- | ---- | ---- |
   | `SUPABASE_URL` | ○ | Supabase の Project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | ○ | service_role キー。**公開厳禁** |
   | `SOAX_PASS` | ○ | SOAX のパスワード。**ここでパッケージが識別される** |
   | `ALERT_WEBHOOK_URL` | 任意 | Slack / Discord の incoming webhook。未設定ならログのみ |
   | `GOOGLE_INTERVAL_MIN_SECONDS` | 任意 | 既定 `60` |
   | `GOOGLE_INTERVAL_MAX_SECONDS` | 任意 | 既定 `180` |
   | `YAHOO_INTERVAL_MIN_SECONDS` | 任意 | 既定 `20` |
   | `YAHOO_INTERVAL_MAX_SECONDS` | 任意 | 既定 `45` |
   | `RUN_INTERVAL_MIN_SECONDS` | 任意 | 既定 `60`。上記に無い platform 用 |
   | `RUN_INTERVAL_MAX_SECONDS` | 任意 | 既定 `180`。同上 |
   | `QUEUE_MAX_ITEMS` | 任意 | 既定 `0`（無効）。件数の絶対上限 |
   | `SOAX_ENDPOINT` | 任意 | 既定 `proxy.soax.com:1337` |
   | `SOAX_REGION_ENABLED` | 任意 | 既定 `1`。`0` で地域指定なし |
   | `SOAX_COUNTRY` | 任意 | 既定 `jp` |
   | `SOAX_NETWORK` | 任意 | 既定 `res`（住宅IP） |
   | `SOAX_ROTATE_SECONDS` | 任意 | 既定 `300` |
   | `SOAX_SESSION_ID` | 任意 | session を固定したいときだけ（固定するとリトライが無効になる） |
   | `SOAX_GOOGLE_NETWORK` | 任意 | 既定 `res`。`mob` で Google のときだけモバイルIP（**単価注意**） |
   | `SOAX_GOOGLE_OMIT_REGION` | 任意 | 既定 `0`。`1` で Google のときだけ region を外す |
   | `SOAX_GOOGLE_ROTATE_SECONDS` | 任意 | Google のときだけローテート間隔を変える |

   `SOAX_USER` は不要（旧仕様。設定されていても無視される）。

   `TZ` / `CHROME_PATH` / `CHROME_EXTRA_ARGS` / `DISPLAY` は Dockerfile で設定済み。

3. デプロイ完了後、Logs を確認する

### デプロイ後チェックリスト

- [ ] Logs に「スケジューラを起動しました（時刻はすべて JST）。」が出ている
- [ ] 「現在時刻」が **JST** になっている（UTC ならタイムゾーン設定を疑う）
- [ ] 「スケジュール: N 件（enabled=true）」が想定どおりの件数
- [ ] 「アラート: webhook へ通知」になっている（ログのみなら `ALERT_WEBHOOK_URL` 未設定）
- [ ] 「今日の残り予定」に直近の予定が並んでいる
- [ ] 最初の実行時刻に「実行予定に追加 → 実行開始 → 結果 → runs.id」が流れる
- [ ] その結果が `/dashboard` と `/clients/[id]` の実行履歴タブに出る
- [ ] `runs.exit_ip` に SOAX の住宅 IP が入っている（`blocked` が続くならここを疑う）
- [ ] 手動で Redeploy し、**同じ時刻の分が二重実行されない**こと
      （起動ログの「当日実行済み: N 件（runs から復元…）」で確認できる）
- [ ] 21:00 JST に日次サマリが通知される

### 運用メモ

- `plan: starter`（512MB）は Chrome を1つ動かすには余裕が少ない。OOM で落ちるようなら
  `standard` に上げる。画像・メディア・フォントは CDP で落としているので通常は足りる
- Render の Worker は再デプロイのたびにプロセスが入れ替わるが、当日分は `runs` から
  復元するので二重実行にはならない。ただし**再起動中に来た時刻は実行されない**
  （過去分のバックフィルはしない仕様）

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
  scheduler.py          定時実行の常駐プロセス（フェーズ2b）
  run_once.py           単発実行（schedules を1件読み → 検索 → runs insert）
  runner.py             両者が共有する実行・表示・記録
  alerts.py             異常検知の判定と webhook 通知
  search_google.py      Google レシピ（本番実証済み）
  search_yahoo.py       Yahoo! レシピ（実測しながら調整する初版）
  device.py             pc / mobile の記述子と、両レシピ共通のブラウザ context
  db.py                 Supabase（schedules 読み込み + runs insert）
  Dockerfile            常駐用イメージ（Chrome + 日本語フォント + Xvfb）
  docker-entrypoint.sh  Xvfb を起動してから scheduler を exec する
render.yaml             Render の Background Worker 定義
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

### 検証手順（単発実行）

1. `--no-proxy` で google × pc を1回。`runs` に行が入ることを確認する
2. google × mobile → yahoo × pc → yahoo × mobile を順に確認する
3. 最後に SOAX 込み（`--no-proxy` なし）で再確認し、`runs.exit_ip` に住宅 IP が入ることを見る

### 検証手順（定時実行）

1. 画面（`/clients/[id]` のスケジュールタブ、または `/clients/[id]/setup`）から、
   **数分後の時刻**でスケジュールを1件登録する（`enabled` が有効であること）
2. `python engine/scheduler.py --no-proxy` を起動する
3. 起動ログの「今日の残り予定」に、いま登録したスケジュールが出ることを確認する
4. その時刻になると次の順にログが流れることを確認する

   ```
   [HH:MM] 実行予定に追加: HH:MM <KW> × <地域> × <device> × <platform>
   [HH:MM:SS] 実行開始（予定 HH:MM）
   結果: 判定 / 結果件数 / 最終 URL
     runs.id    : <uuid>（status=... で記録）
   ```

5. 画面の `/dashboard` か `/clients/[id]` の実行履歴タブに行が増えていることを確認する
6. `Ctrl+C` で停止する（実行中なら1件終わってから止まる）
7. そのまま `scheduler.py` を再起動しても、同じ時刻の分が**二重実行されない**ことを確認する
   （当日の `runs` から復元するため）

### 実測状況（2026-09-22 / --no-proxy・自宅 IP）

| platform × device | 結果                                                                     |
| ----------------- | ------------------------------------------------------------------------ |
| google × pc       | `ok`（9件）                                                              |
| google × mobile   | `blocked`（検索は送信できているが Google が `/sorry/` を返す）           |
| yahoo × pc        | `ok`（19件、`search.yahoo.co.jp/search?p=...`）                          |
| yahoo × mobile    | `ok`（17件。検索窓は候補4番目の `input[type=search]` がヒット）          |

google × mobile はプロキシ無しの固定 IP だと繰り返しブロックされる。SOAX 住宅 IP での
再確認が必要（手順3）。

2026-09-23: 実スケジュールに対する `run_once.py --schedule-id <id> --no-proxy` で
`runs` への記録まで確認済み（この回は `blocked` で記録された）。

### 既知の制約・注意

- `nodriver` は 0.48 以降 `cdp/network.py` に非UTF-8バイトが混入していて import
  できないため、0.47.0 に固定している
- 社内プロキシやセキュリティソフトが TLS を差し替える環境では、Supabase への接続が
  `CERTIFICATE_VERIFY_FAILED` になる（Python は OS の証明書ストアを見ないため）。
  `truststore` を入れてエントリポイントで OS のストアを使うようにしてある
- モバイル記述子ではマウスクリックだとフォーカスが body に戻されるため、
  `Input.dispatchTouchEvent` でタップしてから入力している
- 検索窓・結果要素のセレクタは platform × device ごとに候補を並べて順に試す
  （`search_*.py` の `SEARCH_BOX_SELECTORS` / `RESULT_SELECTORS`）
