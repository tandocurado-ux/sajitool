import { errorTextClass } from "./ui";

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className={errorTextClass}>
      {message}
    </p>
  );
}
