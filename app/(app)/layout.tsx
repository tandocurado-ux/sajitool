import { Suspense, type ReactNode } from "react";
import { requireUser } from "@/server/auth/queries";
import { signOut } from "@/server/auth/actions";
import { AppSidebar } from "@/components/app-sidebar";

export default async function AppLayout({ children }: { children: ReactNode }) {
  // proxy.ts のリダイレクトに加えて、描画側でも必ず getUser() で確認する。
  const user = await requireUser();

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* useSearchParams を使うので Suspense で包む。 */}
      <Suspense fallback={null}>
        <AppSidebar email={user.email} signOutAction={signOut} />
      </Suspense>

      <main className="mx-auto w-full max-w-5xl px-6 py-8 md:pl-[15.5rem]">
        {children}
      </main>
    </div>
  );
}
