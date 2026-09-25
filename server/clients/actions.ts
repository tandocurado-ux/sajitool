"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getUserFrom } from "@/server/auth/queries";
import { parseId } from "@/lib/parse";
import type { ActionState } from "@/lib/action-state";
import { applyBulkSetup } from "@/server/setup/apply";
import { parseNewClientSetup, wantsImmediateTest } from "@/server/setup/schema";
import { enqueueImmediateRun, findFirstScheduleId } from "@/server/immediate/queue";
import {
  initialNewClientState,
  parseClientRename,
  type NewClientState,
} from "./schema";

export async function createClientWithSetup(
  _prevState: NewClientState,
  formData: FormData,
): Promise<NewClientState> {
  const parsed = parseNewClientSetup(formData);
  if (!parsed.ok) return { ...initialNewClientState, error: parsed.error };
  const { name, setup, warnings } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const user = await getUserFrom(supabase);
  if (!user) {
    return { ...initialNewClientState, warnings, error: "ログインが必要です。" };
  }

  const created = await supabase
    .from("clients")
    .insert({ name, user_id: user.id })
    .select("id");

  if (created.error || !created.data?.[0]) {
    return {
      ...initialNewClientState,
      warnings,
      error: `顧客の作成に失敗しました: ${created.error?.message ?? "不明なエラー"}`,
    };
  }
  const clientId = String(created.data[0].id);

  // キーワードも地域も無ければ顧客だけ作って終わり（あとから追加できる）。
  let immediateRequestId: string | null = null;
  if (setup) {
    const input = { ...setup, client_id: clientId };
    const result = await applyBulkSetup(supabase, input);
    if (!result.ok) {
      revalidatePath("/clients");
      revalidatePath(`/clients/${clientId}`);
      return {
        error: result.error,
        warnings,
        summary: null,
        progress: result.progress,
        createdClientId: clientId,
      };
    }
    // 「登録して今すぐ1件テスト実行」: 先頭の組み合わせを1件だけ積み、
    // 顧客詳細のスケジュールタブで進捗を見せる。
    if (wantsImmediateTest(formData)) {
      const scheduleId = await findFirstScheduleId(input);
      if (scheduleId) {
        const queued = await enqueueImmediateRun(supabase, scheduleId);
        if (queued.ok) immediateRequestId = queued.requestId;
      }
    }
  }

  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
  redirect(
    immediateRequestId
      ? `/clients/${clientId}?tab=schedules&immediate=${immediateRequestId}`
      : `/clients/${clientId}`,
  );
}

export async function removeClient(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = parseId(formData);
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createSupabaseServerClient();
  const user = await getUserFrom(supabase);
  if (!user) return { error: "ログインが必要です。" };

  const { error } = await supabase.from("clients").delete().eq("id", parsed.data);
  if (error) return { error: `顧客の削除に失敗しました: ${error.message}` };

  revalidatePath("/clients");
  return { error: null };
}

export async function renameClient(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = parseClientRename(formData);
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createSupabaseServerClient();
  const user = await getUserFrom(supabase);
  if (!user) return { error: "ログインが必要です。" };

  const { error } = await supabase
    .from("clients")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.id);

  if (error) return { error: `顧客名の変更に失敗しました: ${error.message}` };

  revalidatePath("/clients");
  revalidatePath(`/clients/${parsed.data.id}`);
  return { error: null };
}
