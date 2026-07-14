/**
 * Full document reload that bypasses bfcache / sticky HTML.
 * Keeps the page shell from serving a mixed old-JS / new-chunk session.
 */
export function hardReloadWithCacheBust(reason?: string): void {
  if (typeof window === "undefined") return;
  try {
    if (reason) {
      sessionStorage.setItem("telltea_last_reload_reason", reason.slice(0, 240));
    }
  } catch {
    /* ignore */
  }

  const { pathname, hash } = window.location;
  const params = new URLSearchParams();
  params.set("_reload", String(Date.now()));
  window.location.replace(`${pathname}?${params.toString()}${hash}`);
}
