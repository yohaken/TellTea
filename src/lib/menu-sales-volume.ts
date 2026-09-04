/**
 * Menu Sales Volume (จำนวนขายรายเมนู แยกหน้าร้าน vs แพลตฟอร์ม)
 * เก็บใน Firestore: menuPriceHub/salesVolume
 */
import { doc, getDoc, getDocFromServer, onSnapshot, setDoc, type Unsubscribe } from "firebase/firestore";
import { getMenuDb } from "@/lib/pos-menu-db";

export type SalesPeriod = "1m" | "3m" | "6m";

export const SALES_PERIODS: SalesPeriod[] = ["1m", "3m", "6m"];

export const SALES_PERIOD_LABELS: Record<SalesPeriod, string> = {
  "1m": "1 เดือน",
  "3m": "3 เดือน",
  "6m": "6 เดือน",
};

export const SALES_PERIOD_DESCRIPTIONS: Record<SalesPeriod, string> = {
  "1m": "30 วันล่าสุด (หรือ 1 เดือนเต็ม)",
  "3m": "90 วันล่าสุด (3 เดือน)",
  "6m": "180 วันล่าสุด (6 เดือน)",
};

export type ChannelSalesEntry = {
  qty: number;
  salesBaht: number;
  available?: boolean;
  rawName?: string;
  rank?: number;
  note?: string;
};

export type MenuItemSalesData = {
  itemId: string;
  name: string;
  pos: ChannelSalesEntry;
  grab: ChannelSalesEntry;
  lineman: ChannelSalesEntry;
  shopee: ChannelSalesEntry;
  totalQty: number;
  totalSalesBaht: number;
};

export type ChannelSummaryStatus = {
  available: boolean;
  itemCount: number;
  totalQty: number;
  totalSalesBaht: number;
  note?: string;
  dateRangeText?: string;
};

export type PeriodSalesSummary = {
  period: SalesPeriod;
  label: string;
  dateRangeText: string;
  updatedAt: number;
  channels: {
    pos: ChannelSummaryStatus;
    grab: ChannelSummaryStatus;
    lineman: ChannelSummaryStatus;
    shopee: ChannelSummaryStatus;
  };
  byItemId: Record<string, MenuItemSalesData>;
};

export type SalesVolumeStore = {
  updatedAt: number;
  activePeriod: SalesPeriod;
  periods: Partial<Record<SalesPeriod, PeriodSalesSummary>>;
};

const COL = "menuPriceHub";
const DOC_ID = "salesVolume";

export function emptyPeriodSalesSummary(period: SalesPeriod): PeriodSalesSummary {
  return {
    period,
    label: SALES_PERIOD_LABELS[period],
    dateRangeText: "—",
    updatedAt: 0,
    channels: {
      pos: { available: true, itemCount: 0, totalQty: 0, totalSalesBaht: 0 },
      grab: { available: false, itemCount: 0, totalQty: 0, totalSalesBaht: 0, note: "ยังไม่สแกนจาก Chrome" },
      lineman: { available: false, itemCount: 0, totalQty: 0, totalSalesBaht: 0, note: "ยังไม่สแกนจาก Chrome" },
      shopee: { available: false, itemCount: 0, totalQty: 0, totalSalesBaht: 0, note: "Shopee Partner ไม่มีรายงานรายเมนู" },
    },
    byItemId: {},
  };
}

export function emptySalesVolumeStore(): SalesVolumeStore {
  return {
    updatedAt: 0,
    activePeriod: "1m",
    periods: {
      "1m": emptyPeriodSalesSummary("1m"),
      "3m": emptyPeriodSalesSummary("3m"),
      "6m": emptyPeriodSalesSummary("6m"),
    },
  };
}

export function normalizeSalesVolumeStore(raw: unknown): SalesVolumeStore {
  if (!raw || typeof raw !== "object") return emptySalesVolumeStore();
  const o = raw as Record<string, unknown>;
  const activePeriod: SalesPeriod =
    o.activePeriod === "3m" || o.activePeriod === "6m" ? o.activePeriod : "1m";
  const updatedAt = typeof o.updatedAt === "number" ? o.updatedAt : 0;
  const periodsRaw = o.periods && typeof o.periods === "object" ? (o.periods as Record<string, unknown>) : {};

  const periods: Partial<Record<SalesPeriod, PeriodSalesSummary>> = {};
  for (const p of SALES_PERIODS) {
    const pr = periodsRaw[p];
    if (pr && typeof pr === "object") {
      const pobj = pr as Record<string, unknown>;
      const byItemIdRaw = (pobj.byItemId && typeof pobj.byItemId === "object" ? pobj.byItemId : {}) as Record<string, unknown>;
      const byItemId: Record<string, MenuItemSalesData> = {};
      for (const [id, itemRaw] of Object.entries(byItemIdRaw)) {
        if (!itemRaw || typeof itemRaw !== "object") continue;
        const ir = itemRaw as Record<string, unknown>;
        const parseEntry = (eRaw: unknown, defaultAvail: boolean): ChannelSalesEntry => {
          if (!eRaw || typeof eRaw !== "object") {
            return { qty: 0, salesBaht: 0, available: defaultAvail };
          }
          const er = eRaw as Record<string, unknown>;
          return {
            qty: typeof er.qty === "number" ? er.qty : 0,
            salesBaht: typeof er.salesBaht === "number" ? er.salesBaht : 0,
            available: typeof er.available === "boolean" ? er.available : defaultAvail,
            rawName: typeof er.rawName === "string" ? er.rawName : undefined,
            rank: typeof er.rank === "number" ? er.rank : undefined,
            note: typeof er.note === "string" ? er.note : undefined,
          };
        };

        const pos = parseEntry(ir.pos, true);
        const grab = parseEntry(ir.grab, true);
        const lineman = parseEntry(ir.lineman, true);
        const shopee = parseEntry(ir.shopee, false);
        const totalQty = typeof ir.totalQty === "number" ? ir.totalQty : pos.qty + grab.qty + lineman.qty + shopee.qty;
        const totalSalesBaht = typeof ir.totalSalesBaht === "number" ? ir.totalSalesBaht : pos.salesBaht + grab.salesBaht + lineman.salesBaht + shopee.salesBaht;

        byItemId[id] = {
          itemId: id,
          name: typeof ir.name === "string" ? ir.name : "",
          pos,
          grab,
          lineman,
          shopee,
          totalQty,
          totalSalesBaht,
        };
      }

      const parseChannelStatus = (cRaw: unknown, defaultAvail: boolean): ChannelSummaryStatus => {
        if (!cRaw || typeof cRaw !== "object") {
          return { available: defaultAvail, itemCount: 0, totalQty: 0, totalSalesBaht: 0 };
        }
        const cr = cRaw as Record<string, unknown>;
        return {
          available: typeof cr.available === "boolean" ? cr.available : defaultAvail,
          itemCount: typeof cr.itemCount === "number" ? cr.itemCount : 0,
          totalQty: typeof cr.totalQty === "number" ? cr.totalQty : 0,
          totalSalesBaht: typeof cr.totalSalesBaht === "number" ? cr.totalSalesBaht : 0,
          note: typeof cr.note === "string" ? cr.note : undefined,
          dateRangeText: typeof cr.dateRangeText === "string" ? cr.dateRangeText : undefined,
        };
      };

      const channelsRaw = (pobj.channels && typeof pobj.channels === "object" ? pobj.channels : {}) as Record<string, unknown>;
      periods[p] = {
        period: p,
        label: typeof pobj.label === "string" ? pobj.label : SALES_PERIOD_LABELS[p],
        dateRangeText: typeof pobj.dateRangeText === "string" ? pobj.dateRangeText : "—",
        updatedAt: typeof pobj.updatedAt === "number" ? pobj.updatedAt : 0,
        channels: {
          pos: parseChannelStatus(channelsRaw.pos, true),
          grab: parseChannelStatus(channelsRaw.grab, false),
          lineman: parseChannelStatus(channelsRaw.lineman, false),
          shopee: parseChannelStatus(channelsRaw.shopee, false),
        },
        byItemId,
      };
    } else {
      periods[p] = emptyPeriodSalesSummary(p);
    }
  }

  return {
    updatedAt,
    activePeriod,
    periods,
  };
}

export async function loadSalesVolumeStore(): Promise<SalesVolumeStore> {
  const snap = await getDoc(doc(getMenuDb(), COL, DOC_ID));
  if (!snap.exists()) return emptySalesVolumeStore();
  return normalizeSalesVolumeStore(snap.data());
}

export async function loadSalesVolumeStoreFromServer(): Promise<SalesVolumeStore> {
  try {
    const snap = await getDocFromServer(doc(getMenuDb(), COL, DOC_ID));
    if (!snap.exists()) return emptySalesVolumeStore();
    return normalizeSalesVolumeStore(snap.data());
  } catch {
    return loadSalesVolumeStore();
  }
}

export function subscribeSalesVolumeStore(
  onNext: (store: SalesVolumeStore) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    doc(getMenuDb(), COL, DOC_ID),
    (snap) => {
      onNext(snap.exists() ? normalizeSalesVolumeStore(snap.data()) : emptySalesVolumeStore());
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export async function saveSalesVolumeStore(store: Partial<SalesVolumeStore>): Promise<void> {
  const db = getMenuDb();
  await setDoc(
    doc(db, COL, DOC_ID),
    {
      ...store,
      updatedAt: Date.now(),
    },
    { merge: true },
  );
}
