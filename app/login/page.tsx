import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";

export const metadata = {
  title: "ログイン | サジェツール",
};

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <Suspense
        fallback={
          <div className="w-full max-w-sm rounded-lg border border-line bg-surface p-6 text-sm text-subtle">
            読み込み中…
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </main>
  );
}
