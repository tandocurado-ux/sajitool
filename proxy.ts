import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured, requireSupabaseEnv } from "@/lib/supabase/env";

/** 未ログインでもアクセスできるパス。 */
const PUBLIC_PATHS = ["/login"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

/**
 * Next.js 16 では middleware.ts は deprecated で proxy.ts が正。
 * ランタイムは Node.js 固定（runtime 設定は指定不可）。
 *
 * ここでの認証チェックはあくまで楽観的なリダイレクト。
 * 実際の認可は RLS と各 Server Action / Server Component 側の
 * getUser() チェックで行う。
 */
export async function proxy(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    // 環境変数未設定時はここで落とさず、画面側にエラーを出させる。
    return NextResponse.next({ request });
  }

  const { url: supabaseUrl, anonKey: supabaseAnonKey } = requireSupabaseEnv();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        // 認証 Cookie を載せたレスポンスは CDN にキャッシュさせない。
        for (const [key, value] of Object.entries(headers)) {
          response.headers.set(key, value);
        }
      },
    },
  });

  // getSession() ではなく getUser() を使う（auth サーバーで検証させる）。
  let user = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    // Supabase に到達できない場合はリダイレクト判定を諦めて素通しし、
    // 画面側でエラーを表示させる。
    return response;
  }

  const { pathname } = request.nextUrl;

  if (!user && !isPublicPath(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    if (pathname !== "/") {
      loginUrl.searchParams.set("next", pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  if (user && pathname === "/login") {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/clients";
    homeUrl.search = "";
    return NextResponse.redirect(homeUrl);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
