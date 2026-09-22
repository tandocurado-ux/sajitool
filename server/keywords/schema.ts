import type { ParseResult } from "@/lib/parse";
import type { Platform } from "@/lib/types";

export type KeywordInput = {
  client_id: string;
  keyword: string;
  platform: Platform;
};

const PLATFORMS: Platform[] = ["google", "yahoo"];

export function parseKeywordInput(
  formData: FormData,
): ParseResult<KeywordInput> {
  const clientId = String(formData.get("client_id") ?? "").trim();
  if (!clientId) return { ok: false, error: "顧客が指定されていません。" };

  const keyword = String(formData.get("keyword") ?? "").trim();
  if (!keyword) return { ok: false, error: "キーワードを入力してください。" };
  if (keyword.length > 200) {
    return { ok: false, error: "キーワードは200文字以内で入力してください。" };
  }

  const platform = String(formData.get("platform") ?? "") as Platform;
  if (!PLATFORMS.includes(platform)) {
    return { ok: false, error: "検索エンジンを選択してください。" };
  }

  return { ok: true, data: { client_id: clientId, keyword, platform } };
}
