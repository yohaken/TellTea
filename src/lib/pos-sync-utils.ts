/** Shared sync helpers — safe to import from Node tests. */

export function createPosMutationId(deviceId: string): string {
  const tail =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${deviceId.slice(0, 12)}-${tail}`;
}

export function formatPendingBillNo(clientMutationId: string): string {
  const short = clientMutationId.replace(/[^a-zA-Z0-9]/g, "").slice(-6).toUpperCase();
  return `รอส่ง-${short || "LOCAL"}`;
}

export function isRetryableSaleError(err: unknown): boolean {
  const code = (err as { code?: string })?.code || "";
  const message = (err as Error)?.message || "";
  if (code === "functions/invalid-argument" || code === "functions/permission-denied") {
    return false;
  }
  if (code === "functions/unavailable" || code === "functions/deadline-exceeded") {
    return true;
  }
  if (code === "functions/internal") return true;
  if (/network|fetch|failed to fetch|offline|unavailable/i.test(message)) return true;
  return false;
}

export function isBrowserOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}
