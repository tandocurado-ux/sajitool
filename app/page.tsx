import { redirect } from "next/navigation";

export default function RootPage() {
  // 未ログインの場合は proxy.ts が /login へ振り分ける。
  redirect("/clients");
}
