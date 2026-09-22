import Link from "next/link";
import type { ReactNode } from "react";
import { requireUser } from "@/server/auth/queries";
import { signOut } from "@/server/auth/actions";
import { subtleButtonClass } from "@/components/ui";

export default async function AppLayout({ children }: { children: ReactNode }) {
  // proxy.ts のリダイレクトに加えて、描画側でも必ず getUser() で確認する。
  const user = await requireUser();

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-5">
            <Link href="/clients" className="text-sm font-semibold text-neutral-900">
              サジェツール
            </Link>
            <nav className="flex items-center gap-4">
              <Link
                href="/dashboard"
                className="text-sm text-neutral-600 underline-offset-4 hover:text-neutral-900 hover:underline"
              >
                ダッシュボード
              </Link>
              <Link
                href="/clients"
                className="text-sm text-neutral-600 underline-offset-4 hover:text-neutral-900 hover:underline"
              >
                顧客
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-neutral-500 sm:inline">
              {user.email}
            </span>
            <form action={signOut}>
              <button type="submit" className={subtleButtonClass}>
                ログアウト
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
