"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { FormError } from "./form-error";
import { inputClass, labelClass, primaryButtonClass } from "./ui";

type Mode = "signin" | "signup";

/** オープンリダイレクト防止。自サイト内の絶対パスだけ許可する。 */
function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/clients";
  return raw;
}

function toJapaneseMessage(message: string): string {
  if (/invalid login credentials/i.test(message)) {
    return "メールアドレスまたはパスワードが正しくありません。";
  }
  if (/user already registered/i.test(message)) {
    return "このメールアドレスは既に登録されています。";
  }
  if (/password should be at least/i.test(message)) {
    return "パスワードは6文字以上で入力してください。";
  }
  if (/email not confirmed/i.test(message)) {
    return "メールアドレスが未確認です。確認メールのリンクを開いてください。";
  }
  return message;
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = safeNextPath(searchParams.get("next"));

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function switchMode(nextMode: Mode) {
    setMode(nextMode);
    setError(null);
    setMessage(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setPending(true);

    try {
      const supabase = createSupabaseBrowserClient();

      if (mode === "signin") {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) {
          setError(toJapaneseMessage(signInError.message));
          return;
        }
        router.replace(nextPath);
        router.refresh();
        return;
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
      });
      if (signUpError) {
        setError(toJapaneseMessage(signUpError.message));
        return;
      }
      if (data.session) {
        router.replace(nextPath);
        router.refresh();
        return;
      }
      setMessage(
        "確認メールを送信しました。メール内のリンクを開いて登録を完了してください。",
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "予期しないエラーが発生しました。",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-6">
      <h1 className="text-lg font-semibold text-neutral-900">サジェツール</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {mode === "signin" ? "ログインしてください" : "新規アカウントを作成します"}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-1 rounded bg-neutral-100 p-1">
        <button
          type="button"
          onClick={() => switchMode("signin")}
          className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
            mode === "signin" ? "bg-white text-neutral-900" : "text-neutral-500"
          }`}
        >
          ログイン
        </button>
        <button
          type="button"
          onClick={() => switchMode("signup")}
          className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
            mode === "signup" ? "bg-white text-neutral-900" : "text-neutral-500"
          }`}
        >
          新規登録
        </button>
      </div>

      <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
        <div>
          <label htmlFor="email" className={labelClass}>
            メールアドレス
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="password" className={labelClass}>
            パスワード
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            required
            minLength={6}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={inputClass}
          />
        </div>

        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending
            ? "処理中…"
            : mode === "signin"
              ? "ログイン"
              : "アカウントを作成"}
        </button>

        <FormError message={error} />
        {message ? (
          <p className="text-sm text-green-700" role="status">
            {message}
          </p>
        ) : null}
      </form>
    </div>
  );
}
