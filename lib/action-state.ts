export type ActionState = {
  error: string | null;
  message?: string | null;
};

export const initialActionState: ActionState = { error: null };
