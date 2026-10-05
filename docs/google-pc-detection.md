# Google × pc の検知問題（2026-09-30 の調査と対応）

Google × pc が SOAX 経由で検知（blocked）される問題について、その日に分かったことと
入れた対応の記録。本番での効果はまだ確認できていない（「未確認と次の手」を参照）。

## 問題

- Google × pc が SOAX 経由だと検知され、`/sorry/` に飛ばされて `blocked` になる。
- 同じ IP でも Google × mobile は通過し、pc だけが弾かれる。
  IP の評価ではなく、pc として振る舞うときの何かが検知材料になっている。

前提として、Google の計測デバイスはこの日に mobile から pc へ切り替えている
（コミット `47953ea`）。UA と UA-CH を揃えた後、mobile はモバイル版の HTML が返り、
結果セレクタ（`#rso a h3` 系）が合わず `no_results` になるため。pc はデスクトップ版の
HTML で結果を拾える。つまり「mobile は通過するが結果を拾えない」「pc は結果を拾えるが
検知される」という状態だった。

## 原因

ヤマアラシ（本番で通っている別実装）との差分調査で、2 点が挙がった。

### ① プロキシ認証が CDP の Fetch.AuthRequired 方式

- サジツールは、SOAX の認証（407 への応答）を CDP の `Fetch.AuthRequired` で返していた。
  この方式は `Fetch.enable` で全リクエストを CDP 経由で一時停止させるため、Chrome の外
  （Python のイベントループ）から通信に介入することになる。ループが詰まると応答が遅れ、
  プロキシ応答が壊れる。
- ヤマアラシは Chrome 拡張（`chrome.proxy.settings` + `webRequest.onAuthRequired`）で
  認証しており、Chrome の中で完結する。CDP 層はリクエストに介入しない。
- 本番ログで頻発していた「exit IP 取得: JSONDecodeError」が、この症状とされた。

**補足（実装時に分かったこと）**: JSONDecodeError は、認証方式に関係なくローカルで
再現した。プロキシへの接続に失敗して Chrome がエラーページ（タイムアウトや
`HTTP ERROR 407`）を表示しているとき、その本文を JSON として読もうとして出ていた。
つまり JSONDecodeError の一部は「CDP が応答を壊した」のではなく「プロキシ接続の失敗が
そう見えていた」可能性がある。①がどこまで効いているかは、本番のログで切り分ける
（後述の「表示内容」のログ）。

### ② アセット（image / font / media）のブロック

- サジツールは帯域節約のため、image / font / media を CDP でブロックしていた。
- pc では「Windows のデスクトップ Chrome と名乗りながら、画像を 1 バイトも読まない」
  ことになり、実ブラウザと違う挙動として検知材料になる。
- 同じ IP で mobile は通り pc は弾かれる、という現象と整合する。
- ヤマアラシはアセットを一切ブロックせず、実ブラウザのように全部読む。

## 対応（コミット `098caf3`）

どちらも Google 経路だけの変更。検索レシピ（検索窓経由・人間速度のタイプ・Enter・
geolocation の順序）、Yahoo! の経路、スキーマは変えていない。

### P1: プロキシ認証を Chrome 拡張方式に切り替え

- Google 経路は、起動のたびに拡張を一時ディレクトリへ作り、`--load-extension` と
  `--disable-extensions-except` で読み込む。Chrome を止めたら消す（パスワードを含むため）。
- 拡張は **Manifest V3**（`proxy` + `webRequest` + `webRequestAuthProvider`、
  `onAuthRequired` の `asyncBlocking`）。Chrome 139 以降は Manifest V2 を読み込めない
  想定のため、ヤマアラシの V2 ではなく V3 で作った。
- 拡張で認証し、ブロックする種別も無いときは、CDP の `Fetch` を有効にしない。
  転送量の計測は `Network` のイベントを聞くだけで、通信には介入しない。
- `--proxy-server` は**安全のため併用**する。拡張だけにプロキシ指定を任せると、拡張が
  読み込まれなかったときに Render の IP から直結で検索してしまい、エラーにもならない。
  併用していれば 407 で失敗する。
- 起動後に拡張の service worker を確認する。見つからなければ、その実行だけ CDP 方式に
  切り替える。
- exit IP の取得は、応答の描画を最大 10 秒待ってから読む。JSON でないものが表示されて
  いたら、その内容をログに残す（JSONDecodeError の切り分け用）。

### P2: アセットブロックを解除

- Google 経路は `SAJI_BLOCK_ASSETS_GOOGLE` の既定を `0`（ブロックしない）にした。
  共通設定（`SAJI_BLOCK_ASSETS`）には従わない。
- Yahoo! は `SAJI_BLOCK_ASSETS`（既定 `1`）のまま、ブロックを維持する。
- Google の転送量は増える。帯域より検知回避を優先した。

## 環境変数と切り戻し

Render の環境変数で、コードを変えずに戻せる。

| 環境変数 | 既定 | 切り戻すときの値 | 内容 |
| -------- | ---- | ---------------- | ---- |
| `NODRIVER_PROXY_AUTH` | `extension` | `cdp` | Google 経路のプロキシ認証の方式 |
| `SAJI_BLOCK_ASSETS_GOOGLE` | `0` | `1` | Google 経路のアセットブロック（`1` で image / font / media をブロック） |
| `NODRIVER_PROXY_SERVER_ARG` | `1` | - | `--proxy-server` の併用。`0` でプロキシ指定も拡張だけに任せる（拡張が無いと中止） |
| `NODRIVER_PROXY_AUTH_YAHOO` | `cdp` | - | Yahoo! 経路の方式。今回は変えていない |

## 本番で確認するログ

起動時:

- `プロキシ認証: Google extension / Yahoo! cdp（… --proxy-server 併用）`
- `アセット遮断: Yahoo! on（image, font, media） / Google off`

Google の実行ごと:

- `プロキシ認証拡張: 読み込み確認 id=…（Manifest V3・service worker 起動済み）`
  - 「service worker が見つかりません」と出ていたら拡張が効いておらず、その実行は
    CDP 方式で動いている。
- `プロキシ設定: … 認証=あり（Chrome 拡張で応答） … / アセットブロック: off / CDP Fetch: 無効`
- `exit IP取得` の直後に `! exit IP を取得できません` が出た場合は、続く
  `表示内容: …` を見る。エラーページ（タイムアウト）や `HTTP ERROR 407` なら
  プロキシ接続の問題で、認証方式の問題ではない。
- `判定: status=…`。`blocked` が減り `ok` が出るかが、今回の対応の成否。
- `転送量: … MB（ブロック: off）`。1 時間ごとの集計で、Google の平均 MB/run が
  どれだけ増えたかを確認する。

## 検証した範囲

SOAX の資格情報がローカルに無いため、認証付きのテスト用プロキシを立てて確認した
（Chrome for Testing 153）。

- 拡張が読み込まれ、認証が通り、exit IP を取得できる。CDP の Fetch は無効になる。
- `NODRIVER_PROXY_AUTH=cdp` で従来方式に戻る。拡張が見つからない場合も CDP 方式に
  切り替わる。
- Google 経路は画像を受信し、Yahoo! 経路は従来どおりブロックする。
- Yahoo! × pc はプロキシ経由で ok（CDP 認証 + ブロック on のまま）。
- Google × pc は検索窓入力から結果判定まで動く。

確認できていないこと:

- Manifest V2 が Chrome 153 で本当に読み込めないかは、決定的には確かめていない。
- ブランド版の Google Chrome 154 では拡張が読み込まれず、自動で CDP 方式になった。
  本番は Chrome for Testing なので対象外だが、Chrome の種類を変えるときは注意。

## 未確認と次の手

- **本番の SOAX 経由で Google × pc が通るかは未検証。** ローカルの結果は、自宅 IP からの
  直結またはテスト用プロキシでのもので、検知の有無の判断材料にはならない。
- P1 / P2 で通らなければ、次の候補は以下（ヤマアラシとの残りの差分）。効果を見てから
  判断するので、今回は入れていない。
  - P3: per-request profile
  - P5: UA-CH の自動化
  - P6: Chrome stable の使用
- mobile 版の結果セレクタは別件として残っている。`no_results` のときに結果ページの
  DOM 構造をログに出す診断を入れてある（コミット `6e7dcea`）。ローカルで見た限り、
  mobile 版は見出しが `a h3` ではなく `a[ping]` 配下の `div[role=heading]` になっている。

## 関連

- Yahoo! は `network-res` + アセットブロックで安定しており（成功率 94%）、今回は無変更。
- Google の SOAX 設定は `network-mob`・region 省略（render.yaml、コミット `1ad66c1`）。
- 実装の詳細は README の「プロキシ認証の方式（Chrome 拡張 / CDP）」と
  「帯域（SOAX の転送量）」を参照。
