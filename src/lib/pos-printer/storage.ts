import { doc, getDoc, onSnapshot, setDoc, type Unsubscribe } from "firebase/firestore";
import { getDb } from "../firebase";
import { getPosDb } from "../pos-firebase";
import { mapFirestoreError } from "../firestore-errors";
import { defaultPrinterSetup } from "./profiles";
import type { PosPrinterConfig, PosPrinterSetup, PrinterKind, PrinterRole } from "./types";

const LOCAL_KEY = "telltea-pos-printer-setup";

function metaPosRef(db: ReturnType<typeof getDb> | ReturnType<typeof getPosDb>) {
  return doc(db, "meta", "pos");
}

function isPrinterKind(v: unknown): v is PrinterKind {
  return v === "builtin_80" || v === "desktop_80" || v === "mobile_58";
}

function isPrinterRole(v: unknown): v is PrinterRole {
  return v === "receipt" || v === "kitchen" || v === "bar" || v === "mobile";
}

function mapPrinter(raw: unknown, index: number): PosPrinterConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || !isPrinterKind(o.kind)) return null;
  return {
    id: o.id,
    name: typeof o.name === "string" && o.name.trim() ? o.name.trim() : "เครื่องพิมพ์",
    kind: o.kind,
    role: isPrinterRole(o.role) ? o.role : "receipt",
    connection:
      o.connection === "builtin" ||
      o.connection === "lan" ||
      o.connection === "wifi" ||
      o.connection === "usb" ||
      o.connection === "bluetooth" ||
      o.connection === "browser"
        ? o.connection
        : "browser",
    paperWidthMm: o.paperWidthMm === 58 ? 58 : 80,
    cutMode: o.cutMode === "manual" ? "manual" : "auto",
    enabled: o.enabled !== false,
    networkHost: typeof o.networkHost === "string" ? o.networkHost.trim() : undefined,
    networkPort: typeof o.networkPort === "number" ? o.networkPort : undefined,
    categoryIds: Array.isArray(o.categoryIds)
      ? o.categoryIds.filter((c): c is string => typeof c === "string")
      : undefined,
    sortOrder: typeof o.sortOrder === "number" ? o.sortOrder : index,
  };
}

export function mapPrinterSetup(data: Record<string, unknown> | undefined): PosPrinterSetup {
  const defaults = defaultPrinterSetup();
  const rawPrinters = data?.printers;
  let printers: PosPrinterConfig[] = defaults.printers;
  if (Array.isArray(rawPrinters) && rawPrinters.length > 0) {
    const mapped = rawPrinters
      .map((p, i) => mapPrinter(p, i))
      .filter((p): p is PosPrinterConfig => p != null);
    if (mapped.length > 0) printers = mapped.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  const deviceReceiptPrinter: Record<string, string> = {};
  if (data?.deviceReceiptPrinter && typeof data.deviceReceiptPrinter === "object") {
    for (const [k, v] of Object.entries(data.deviceReceiptPrinter as Record<string, unknown>)) {
      if (typeof v === "string") deviceReceiptPrinter[k] = v;
    }
  }

  return {
    printers,
    deviceReceiptPrinter,
    autoPrintKitchen: data?.autoPrintKitchen === true,
    autoPrintBar: data?.autoPrintBar === true,
  };
}

function readLocalSetup(): PosPrinterSetup | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    return mapPrinterSetup(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    return null;
  }
}

function writeLocalSetup(setup: PosPrinterSetup): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(setup));
  } catch {
    /* ignore quota */
  }
}

export function subscribePosPrinterSetup(
  onSetup: (setup: PosPrinterSetup) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const local = readLocalSetup();
  if (local) onSetup(local);

  return onSnapshot(
    metaPosRef(getPosDb()),
    (snap) => {
      const setup = mapPrinterSetup(snap.data() as Record<string, unknown> | undefined);
      writeLocalSetup(setup);
      onSetup(setup);
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export async function getPosPrinterSetup(): Promise<PosPrinterSetup> {
  try {
    const snap = await getDoc(metaPosRef(getPosDb()));
    const setup = mapPrinterSetup(snap.data() as Record<string, unknown> | undefined);
    writeLocalSetup(setup);
    return setup;
  } catch {
    return readLocalSetup() ?? defaultPrinterSetup();
  }
}

export async function savePosPrinterSetup(patch: Partial<PosPrinterSetup>): Promise<void> {
  const current = await getPosPrinterSetup();
  const next: PosPrinterSetup = {
    printers: patch.printers ?? current.printers,
    deviceReceiptPrinter: patch.deviceReceiptPrinter ?? current.deviceReceiptPrinter,
    autoPrintKitchen: patch.autoPrintKitchen ?? current.autoPrintKitchen,
    autoPrintBar: patch.autoPrintBar ?? current.autoPrintBar,
  };
  writeLocalSetup(next);

  const payload: Record<string, unknown> = {
    updatedAt: Date.now(),
    printers: next.printers,
    deviceReceiptPrinter: next.deviceReceiptPrinter,
    autoPrintKitchen: next.autoPrintKitchen,
    autoPrintBar: next.autoPrintBar,
  };
  try {
    await setDoc(metaPosRef(getDb()), payload, { merge: true });
  } catch (err) {
    throw new Error(mapFirestoreError(err, "บันทึกตั้งค่าเครื่องพิมพ์"));
  }
}

export function getCachedPrinterSetup(): PosPrinterSetup {
  return readLocalSetup() ?? defaultPrinterSetup();
}
