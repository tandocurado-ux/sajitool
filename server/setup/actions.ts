"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getUserFrom } from "@/server/auth/queries";
import { isClientOwned } from "@/server/clients/queries";
import { applyBulkSetup } from "./apply";
import {
  initialBulkSetupState,
  parseBulkSetupInput,
  type BulkSetupState,
} from "./schema";

export async function bulkCreateSchedules(
  _prevState: BulkSetupState,
  formData: FormData,
): Promise<BulkSetupState> {
  const parsed = parseBulkSetupInput(formData);
  if (!parsed.ok) {
    return { ...initialBulkSetupState, error: parsed.error };
  }
  const { input, warnings } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const user = await getUserFrom(supabase);
  if (!user) {
    return { ...initialBulkSetupState, warnings, error: "ログインが必要です。" };
  }
  if (!(await isClientOwned(supabase, input.client_id))) {
    return {
      ...initialBulkSetupState,
      warnings,
      error: "この顧客を操作する権限がありません。",
    };
  }

  const result = await applyBulkSetup(supabase, input);
  if (!result.ok) {
    return { error: result.error, warnings, summary: null, progress: result.progress };
  }

  revalidatePath(`/clients/${input.client_id}`);
  revalidatePath(`/clients/${input.client_id}/setup`);

  return { error: null, warnings, summary: result.summary, progress: null };
}
