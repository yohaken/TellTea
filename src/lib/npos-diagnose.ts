import {
  collection,
  onSnapshot,
  orderBy,
  query,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { resolveNposDeviceClass, resolveStableKey, type NposDeviceClass } from "./npos-device-class";

export const NPOS_DIAGNOSE_COL = "nposDiagnose";

export type NposDisplayInfo = {
  number: number;
  displayId: number;
  primary: boolean;
  name: string;
  widthPx: number;
  heightPx: number;
  densityDpi: number;
  refreshHz: number;
  rotation: number;
  orientation: string;
};

export type NposHardwareItem = {
  category: string;
  title: string;
  detail: string;
};

export type NposDiagnoseReport = {
  id: string;
  installId: string;
  stableKey: string;
  isEmulator: boolean;
  deviceClass: NposDeviceClass;
  blocked: boolean;
  disabled: boolean;
  reportedAt: number;
  versionCode: number;
  versionName: string;
  summary: string;
  customerDisplay: string;
  displays: NposDisplayInfo[];
  hardware: NposHardwareItem[];
  source: string;
  latestCaptureAt: number;
  latestCaptureId: string;
  latestPrimaryUrl: string;
  latestSecondaryUrl: string;
  latestCaptureReason: string;
};

function mapDisplay(raw: unknown, index: number): NposDisplayInfo {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    number: typeof o.number === "number" ? o.number : index + 1,
    displayId: typeof o.displayId === "number" ? o.displayId : -1,
    primary: !!o.primary,
    name: typeof o.name === "string" ? o.name : `display-${index + 1}`,
    widthPx: typeof o.widthPx === "number" ? o.widthPx : 0,
    heightPx: typeof o.heightPx === "number" ? o.heightPx : 0,
    densityDpi: typeof o.densityDpi === "number" ? o.densityDpi : 0,
    refreshHz: typeof o.refreshHz === "number" ? o.refreshHz : 0,
    rotation: typeof o.rotation === "number" ? o.rotation : 0,
    orientation: typeof o.orientation === "string" ? o.orientation : "unknown",
  };
}

function mapHardware(raw: unknown): NposHardwareItem {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    category: typeof o.category === "string" ? o.category : "อื่น",
    title: typeof o.title === "string" ? o.title : "—",
    detail: typeof o.detail === "string" ? o.detail : "",
  };
}

export function mapNposDiagnoseReport(
  id: string,
  data?: Record<string, unknown> | null,
): NposDiagnoseReport {
  const displaysRaw = Array.isArray(data?.displays) ? data!.displays : [];
  const hardwareRaw = Array.isArray(data?.hardware) ? data!.hardware : [];
  const isEmulator = data?.isEmulator === true;
  const blocked = data?.blocked === true || data?.deviceClass === "blocked";
  const deviceClass = resolveNposDeviceClass({
    deviceClass: typeof data?.deviceClass === "string" ? data.deviceClass : "",
    isEmulator,
    blocked,
  });
  const installId = typeof data?.installId === "string" ? data.installId : id;
  const stableKey = resolveStableKey(
    typeof data?.stableKey === "string" ? data.stableKey : "",
    installId,
  );
  return {
    id,
    installId,
    stableKey,
    isEmulator,
    deviceClass,
    blocked,
    disabled: data?.disabled === true && !blocked,
    reportedAt: typeof data?.reportedAt === "number" ? data.reportedAt : 0,
    versionCode: typeof data?.versionCode === "number" ? data.versionCode : 0,
    versionName: typeof data?.versionName === "string" ? data.versionName : "",
    summary: typeof data?.summary === "string" ? data.summary : "",
    customerDisplay:
      typeof data?.customerDisplay === "string"
        ? data.customerDisplay
        : displaysRaw.some((d) => {
            const o = d && typeof d === "object" ? (d as Record<string, unknown>) : {};
            return !o.primary;
          })
          ? "ok"
          : "missing",
    displays: displaysRaw.map(mapDisplay),
    hardware: hardwareRaw.map(mapHardware),
    source: typeof data?.source === "string" ? data.source : "npos-telltea",
    latestCaptureAt: typeof data?.latestCaptureAt === "number" ? data.latestCaptureAt : 0,
    latestCaptureId: typeof data?.latestCaptureId === "string" ? data.latestCaptureId : "",
    latestPrimaryUrl: typeof data?.latestPrimaryUrl === "string" ? data.latestPrimaryUrl : "",
    latestSecondaryUrl:
      typeof data?.latestSecondaryUrl === "string" ? data.latestSecondaryUrl : "",
    latestCaptureReason:
      typeof data?.latestCaptureReason === "string" ? data.latestCaptureReason : "",
  };
}

export function subscribeNposDiagnoseReports(
  onReports: (reports: NposDiagnoseReport[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  // updatedAt is set by both diagnose reports and capture uploads — reportedAt-only
  // queries omit capture-only docs (missing reportedAt) so BO gallery stayed empty.
  const q = query(collection(getDb(), NPOS_DIAGNOSE_COL), orderBy("updatedAt", "desc"));
  return onSnapshot(
    q,
    (snap) => {
      onReports(
        snap.docs.map((d) => mapNposDiagnoseReport(d.id, d.data() as Record<string, unknown>)),
      );
    },
    (err) => {
      onError?.(err instanceof Error ? err : new Error(String(err)));
    },
  );
}

export function formatDiagnoseAt(ts: number): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString("th-TH");
  } catch {
    return String(ts);
  }
}
