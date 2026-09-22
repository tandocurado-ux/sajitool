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

## 画面（フェーズ1）

| パス            | 内容                                                     |
| --------------- | -------------------------------------------------------- |
| `/login`        | メール＋パスワードのログイン／新規登録（切替式）         |
| `/clients`      | 顧客一覧・追加・削除                                     |
| `/clients/[id]` | キーワード／地域／スケジュールの登録・一覧・削除（タブ） |

## ディレクトリ構成

```
app/
  (app)/            認証必須のページ群（ヘッダー＋ログアウト）
  login/            未ログインでもアクセス可
components/         フォームなどの UI
lib/
  supabase/         ブラウザ用・サーバー用クライアントと環境変数
  parse.ts          入力値の正規化（時刻など）
server/
  <domain>/         actions.ts / queries.ts / schema.ts をドメインごとに同居
proxy.ts            セッション更新と未ログイン時のリダイレクト
```

## 認証まわりの方針

- `proxy.ts`（Next.js 16 で `middleware.ts` から改称）でセッション Cookie を更新し、未ログインなら `/login` へ振り分ける。これは楽観的なリダイレクトにすぎない
- 実際の認可は **RLS** と、各 Server Component / Server Action 内の `supabase.auth.getUser()` で行う。`getSession()` は認可判定に使わない
- Server Action は直接 POST でも到達できるため、すべての Action で `getUser()` と所有権チェックを行っている

## 未対応（フェーズ1の範囲外）

- `runs` / `results`（計測エンジン側が書き込む）の表示
- `lib/types.ts` は手書きの行型。Supabase CLI が使えるようになったら
  `npx supabase gen types typescript --project-id <ref>` の生成物に置き換える
