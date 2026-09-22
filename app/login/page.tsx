import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";

export const metadata = {
  title: "ログイン | サジェツール",
};

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 p-6">
      <Suspense
        fallback={
          <div className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-6 text-sm text-neutral-500">
            読み込み中…
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </main>
  );
}
