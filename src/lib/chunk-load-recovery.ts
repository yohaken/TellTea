import { hardReloadWithCacheBust } from "./hard-reload";

const LOOP_KEY = "telltea_chunk_reload_at";
const LOOP_GAP_MS = 20_000;

function isStaleChunkFailure(message: string): boolean {
  return /ChunkLoadError|Loading chunk \d+|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|\/_next\/static\//i.test(
    message,
  );
}

/**
 * After a deploy, old tabs may request hashed chunks that no longer exist —
 * UI looks "broken" / random missing pieces. Recover with a hard reload once.
 */
export function installChunkLoadRecovery(): () => void {
  if (typeof window === "undefined") return () => {};

  function recover(detail: string) {
    try {
      const last = Number(sessionStorage.getItem(LOOP_KEY) || 0);
      if (Date.now() - last < LOOP_GAP_MS) return;
      sessionStorage.setItem(LOOP_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    hardReloadWithCacheBust(`chunk:${detail}`);
  }

  function onError(event: ErrorEvent) {
    const msg = `${event.message || ""} ${event.filename || ""}`;
    if (isStaleChunkFailure(msg)) recover(msg);
  }

  function onRejection(event: PromiseRejectionEvent) {
    const reason = event.reason;
    const msg =
      reason instanceof Error
        ? `${reason.name} ${reason.message}`
        : typeof reason === "string"
          ? reason
          : String(reason ?? "");
    if (isStaleChunkFailure(msg)) recover(msg);
  }

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}

export { isStaleChunkFailure };
