import type { Metadata } from "next";
import { Geist_Mono, Inter, Noto_Sans_JP } from "next/font/google";
import "./globals.css";

// 英数字は Inter、日本語は Noto Sans JP へフォールバック。どちらも next/font で
// ビルド時に取得してセルフホストするので、実行時に外部へは繋がない。
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const notoSansJp = Noto_Sans_JP({
  variable: "--font-noto-sans-jp",
  subsets: ["latin"],
  display: "swap",
  // 日本語は unicode-range で分割された多数のファイルになるため preload しない。
  preload: false,
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "サジェツール",
  description: "検索順位・SERP・サジェストを地域×デバイス×時刻で定時計測する管理画面",
};

/**
 * 描画前にテーマを決める。localStorage の保存値を優先し、無ければ OS 設定に従う。
 * ダークが既定なので、ライトのときだけ data-theme="light" が意味を持つ。
 * <head> のインラインで実行して、最初の描画がちらつかないようにする。
 */
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("theme");if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}document.documentElement.setAttribute("data-theme",t)}catch(e){document.documentElement.setAttribute("data-theme","dark")}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ja"
      data-theme="dark"
      suppressHydrationWarning
      className={`${inter.variable} ${notoSansJp.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
