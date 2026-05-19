/** Normalises Nest `{ message }` payload for UI. */
export function formatApiError(data: unknown, fallback = "Something went wrong."): string {
  if (!data || typeof data !== "object") return fallback;
  const message = (data as { message?: unknown }).message;
  if (typeof message === "string" && message.trim()) return message;
  if (Array.isArray(message) && message.length) {
    const parts = message.filter((x) => typeof x === "string") as string[];
    if (parts.length) return parts.join(", ");
  }
  return fallback;
}
