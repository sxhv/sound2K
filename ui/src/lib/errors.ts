import type { AppError } from "../types";

function isAppError(e: unknown): e is AppError {
  return typeof e === "object" && e !== null && "kind" in e && "message" in e;
}

/** The `kind` of an error returned by a Rust command ("auth", "network", …). */
export function errorKind(e: unknown): string | undefined {
  return isAppError(e) ? e.kind : undefined;
}

export function errorMessage(e: unknown): string {
  if (isAppError(e)) return e.message;
  if (e instanceof Error) return e.message;
  return typeof e === "string" ? e : "Something went wrong.";
}
