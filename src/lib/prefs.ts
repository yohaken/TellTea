const ZOOM_KEY = "telltea_sheet_zoom";

export function loadSheetZoom(defaultValue = 1): number {
  if (typeof window === "undefined") return defaultValue;
  const raw = window.localStorage.getItem(ZOOM_KEY);
  const n = Number(raw);
  if (!Number.isFinite(n)) return defaultValue;
  return Math.min(1.6, Math.max(0.7, n));
}

export function saveSheetZoom(value: number) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ZOOM_KEY, String(value));
}
