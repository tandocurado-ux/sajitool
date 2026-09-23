"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { subtleButtonClass } from "./ui";

type NavItem = {
  href: string;
  label: string;
  isActive: (pathname: string, tab: string | null) => boolean;
};

const NAV_ITEMS: NavItem[] = [
  {
    href: "/dashboard",
    label: "ホーム",
    isActive: (pathname, tab) => pathname === "/dashboard" && tab !== "matrix",
  },
  {
    href: "/clients",
    label: "顧客管理",
    isActive: (pathname) => pathname.startsWith("/clients"),
  },
  {
    href: "/dashboard?tab=matrix",
    label: "地域比較",
    isActive: (pathname, tab) => pathname === "/dashboard" && tab === "matrix",
  },
];

type Props = {
  email?: string;
  /** ログアウトの Server Action。 */
  signOutAction: () => Promise<void>;
};

export function AppSidebar({ email, signOutAction }: Props) {
  const pathname = usePathname();
  const tab = useSearchParams().get("tab");
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* モバイル用のバー。ここからサイドバーを開閉する。 */}
      <div className="flex items-center gap-3 border-b border-neutral-200 bg-white px-4 py-3 md:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="メニューを開く"
          aria-expanded={open}
          className="rounded border border-neutral-300 px-2 py-1 text-neutral-700"
        >
          <span aria-hidden className="block text-lg leading-none">
            ☰
          </span>
        </button>
        <span className="text-sm font-semibold text-neutral-900">サジェツール</span>
      </div>

      {open ? (
        <button
          type="button"
          aria-label="メニューを閉じる"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-neutral-900/30 md:hidden"
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-neutral-200 bg-white transition-transform md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4">
          <Link
            href="/dashboard"
            onClick={() => setOpen(false)}
            className="text-sm font-semibold text-neutral-900"
          >
            サジェツール
          </Link>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="メニューを閉じる"
            className="text-neutral-500 md:hidden"
          >
            ×
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => {
              const active = item.isActive(pathname, tab);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={`block rounded px-3 py-2 text-sm transition-colors ${
                      active
                        ? "bg-neutral-900 font-medium text-white"
                        : "text-neutral-700 hover:bg-neutral-100"
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="border-t border-neutral-200 px-5 py-4">
          {email ? (
            <p className="mb-2 truncate text-xs text-neutral-500" title={email}>
              {email}
            </p>
          ) : null}
          <form action={signOutAction}>
            <button type="submit" className={subtleButtonClass}>
              ログアウト
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
