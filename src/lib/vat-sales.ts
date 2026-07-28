/**
 * ยอดขายรายวัน · VAT 7% — เจ้าของเท่านั้น
 * เดลิเวอรี่จะมาจากเมล (P2+) · P1 รองรับกรอกมือ + suggest หน้าร้านจาก POS
 */

import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { POS_SALES_COL } from "./pos-sales";
import { daysInMonthKey } from "./categories";

export const DAILY_SALES_COL = "dailySales";
export const VAT_SALES_SETTINGS_DOC = "vatSalesSettings";
export const VAT_RATE = 0.07;

export const DELIVERY_CHANNELS = ["shopee", "grab", "lineman"] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

export const DELIVERY_CHANNEL_LABELS: Record<DeliveryChannel, string> = {
  shopee: "ShopeeFood",
  grab: "Grab",
  lineman: "LINE MAN",
};

export type DailySalesStatus = "draft" | "confirmed";
export type ChannelSource = "manual" | "pos_suggest" | "email";
export type PnlIncomeMode = "exVat" | "incVat";

export type MailChannelRule = {
  enabled: boolean;
  fromIncludes: string[];
  subjectIncludes: string[];
};

export type VatMailRules = Record<DeliveryChannel, MailChannelRule>;

export const DEFAULT_MAIL_RULES: VatMailRules = {
  shopee: {
    enabled: true,
    fromIncludes: ["shopee", "shopeefood"],
    subjectIncludes: ["shopee", "shopeefood", "สรุปยอด", "ยอดขาย"],
  },
  grab: {
    enabled: true,
    fromIncludes: ["grab.com", "grabfood"],
    subjectIncludes: ["grab", "รายงาน", "สรุป", "sales", "settlement"],
  },
  lineman: {
    enabled: true,
    fromIncludes: ["lineman", "line.me", "linedelivery"],
    subjectIncludes: ["lineman", "line man", "สรุป", "ยอดขาย", "รายงาน"],
  },
};

export function mapMailRules(raw: unknown): VatMailRules {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const one = (key: DeliveryChannel): MailChannelRule => {
    const src = o[key] && typeof o[key] === "object" ? (o[key] as Record<string, unknown>) : {};
    const fallback = DEFAULT_MAIL_RULES[key];
    const list = (v: unknown, fb: string[]) =>
      Array.isArray(v) && v.length
        ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, 20)
        : [...fb];
    return {
      enabled: src.enabled !== false,
      fromIncludes: list(src.fromIncludes, fallback.fromIncludes),
      subjectIncludes: list(src.subjectIncludes, fallback.subjectIncludes),
    };
  };
  return {
    shopee: one("shopee"),
    grab: one("grab"),
    lineman: one("lineman"),
  };
}

export type ChannelAmount = {
  /** ยอดที่ลูกค้าจ่าย (รวม VAT) — ฐานคิด VAT */
  grossInclusive: number;
  /** ค่า GP / ค่าธรรมเนียมแพลตฟอร์ม */
  fee: number;
  /** ยอดโอนเข้าบัญชีจริง */
  netTransfer: number;
};

export type DailySalesSources = {
  storefront: ChannelSource;
  shopee?: ChannelSource;
  grab?: ChannelSource;
  lineman?: ChannelSource;
};

export type DailySalesEmailRefs = Partial<Record<DeliveryChannel, string>>;

export type DailySalesDoc = {
  dateKey: string;
  storefront: ChannelAmount;
  delivery: Record<DeliveryChannel, ChannelAmount>;
  storefrontGross: number;
  deliveryGross: number;
  totalGross: number;
  vatBase: number;
  vatOutput: number;
  status: DailySalesStatus;
  sources: DailySalesSources;
  /** platformEmailReports doc id ต่อช่องทาง */
  emailRefs: DailySalesEmailRefs;
  note: string;
  confirmedAt: number | null;
  confirmedBy: string;
  updatedAt: number;
  updatedBy: string;
};

export type VatSalesSettings = {
  vatRegistered: boolean;
  vatRate: number;
  pnlIncomeMode: PnlIncomeMode;
  reportEmails: string[];
  channelsEnabled: {
    shopee: boolean;
    grab: boolean;
    lineman: boolean;
    storefront: boolean;
  };
  mailRules: VatMailRules;
  /** แจ้งเตือนเจ้าของเมื่อขาดเมล / parse พัง */
  alertsEnabled: boolean;
  /** ชั่วโมง Bangkok หลังวันนี้แล้วค่อยเตือนของเมื่อวาน (0–23) */
  alertAfterHourBangkok: number;
  updatedAt: number;
  updatedBy: string;
};

export const DEFAULT_VAT_SALES_SETTINGS: VatSalesSettings = {
  vatRegistered: false,
  vatRate: VAT_RATE,
  pnlIncomeMode: "exVat",
  reportEmails: [],
  channelsEnabled: {
    shopee: true,
    grab: true,
    lineman: true,
    storefront: true,
  },
  mailRules: mapMailRules(undefined),
  alertsEnabled: true,
  alertAfterHourBangkok: 10,
  updatedAt: 0,
  updatedBy: "",
};

export function emptyChannelAmount(): ChannelAmount {
  return { grossInclusive: 0, fee: 0, netTransfer: 0 };
}

/** ปัดเงิน 2 ทศนิยม — ใช้จุดเดียวทั้งโมดูล */
export function roundMoney(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function normalizeMoney(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v) || v < 0) return 0;
  return roundMoney(v);
}

export function computeVatFromGross(grossInclusive: number): {
  vatBase: number;
  vatOutput: number;
} {
  const gross = normalizeMoney(grossInclusive);
  const vatBase = roundMoney(gross / (1 + VAT_RATE));
  const vatOutput = roundMoney(gross - vatBase);
  return { vatBase, vatOutput };
}

export function isDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function isMonthKey(value: string): boolean {
  return /^\d{4}-\d{2}$/.test(value);
}

/** Asia/Bangkok calendar YYYY-MM-DD */
export function bangkokDateKey(ms = Date.now()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "0";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function bangkokMonthKey(ms = Date.now()): string {
  return bangkokDateKey(ms).slice(0, 7);
}

/** Bangkok midnight epoch for YYYY-MM-DD */
export function startMsFromDateKey(dateKey: string): number {
  if (!isDateKey(dateKey)) throw new Error("วันที่ไม่ถูกต้อง");
  const [y, m, d] = dateKey.split("-").map(Number);
  return Date.UTC(y, m - 1, d) - 7 * 60 * 60 * 1000;
}

export function dateKeysInMonth(monthKey: string): string[] {
  if (!isMonthKey(monthKey)) throw new Error("เดือนไม่ถูกต้อง");
  const days = daysInMonthKey(monthKey);
  const out: string[] = [];
  for (let d = 1; d <= days; d++) {
    out.push(`${monthKey}-${String(d).padStart(2, "0")}`);
  }
  return out;
}

export function mapChannelAmount(raw: unknown): ChannelAmount {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    grossInclusive: normalizeMoney(o.grossInclusive),
    fee: normalizeMoney(o.fee),
    netTransfer: normalizeMoney(o.netTransfer),
  };
}

function mapSources(raw: unknown): DailySalesSources {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const src = (v: unknown): ChannelSource | undefined => {
    if (v === "manual" || v === "pos_suggest" || v === "email") return v;
    return undefined;
  };
  return {
    storefront: src(o.storefront) || "manual",
    ...(src(o.shopee) ? { shopee: src(o.shopee) } : {}),
    ...(src(o.grab) ? { grab: src(o.grab) } : {}),
    ...(src(o.lineman) ? { lineman: src(o.lineman) } : {}),
  };
}

function mapEmailRefs(raw: unknown): DailySalesEmailRefs {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: DailySalesEmailRefs = {};
  for (const ch of DELIVERY_CHANNELS) {
    const id = typeof o[ch] === "string" ? String(o[ch]).trim() : "";
    if (id) out[ch] = id;
  }
  return out;
}

export function recomputeDailyTotals(input: {
  storefront: ChannelAmount;
  delivery: Record<DeliveryChannel, ChannelAmount>;
}): Pick<
  DailySalesDoc,
  "storefrontGross" | "deliveryGross" | "totalGross" | "vatBase" | "vatOutput"
> {
  const storefrontGross = normalizeMoney(input.storefront.grossInclusive);
  const deliveryGross = roundMoney(
    DELIVERY_CHANNELS.reduce(
      (sum, ch) => sum + normalizeMoney(input.delivery[ch].grossInclusive),
      0,
    ),
  );
  const totalGross = roundMoney(storefrontGross + deliveryGross);
  const { vatBase, vatOutput } = computeVatFromGross(totalGross);
  return { storefrontGross, deliveryGross, totalGross, vatBase, vatOutput };
}

export function emptyDailySales(dateKey: string): DailySalesDoc {
  const delivery = {
    shopee: emptyChannelAmount(),
    grab: emptyChannelAmount(),
    lineman: emptyChannelAmount(),
  };
  const storefront = emptyChannelAmount();
  const totals = recomputeDailyTotals({ storefront, delivery });
  return {
    dateKey,
    storefront,
    delivery,
    ...totals,
    status: "draft",
    sources: { storefront: "manual" },
    emailRefs: {},
    note: "",
    confirmedAt: null,
    confirmedBy: "",
    updatedAt: 0,
    updatedBy: "",
  };
}

export function mapDailySalesDoc(
  dateKey: string,
  data: Record<string, unknown> | undefined,
): DailySalesDoc {
  const base = emptyDailySales(dateKey);
  if (!data) return base;
  const deliveryRaw =
    data.delivery && typeof data.delivery === "object"
      ? (data.delivery as Record<string, unknown>)
      : {};
  const storefront = mapChannelAmount(data.storefront);
  // legacy flat storefrontGross
  if (!data.storefront && typeof data.storefrontGross === "number") {
    storefront.grossInclusive = normalizeMoney(data.storefrontGross);
  }
  const delivery = {
    shopee: mapChannelAmount(deliveryRaw.shopee),
    grab: mapChannelAmount(deliveryRaw.grab),
    lineman: mapChannelAmount(deliveryRaw.lineman),
  };
  const totals = recomputeDailyTotals({ storefront, delivery });
  const status = data.status === "confirmed" ? "confirmed" : "draft";
  return {
    dateKey,
    storefront,
    delivery,
    ...totals,
    status,
    sources: mapSources(data.sources),
    emailRefs: mapEmailRefs(data.emailRefs),
    note: typeof data.note === "string" ? data.note : "",
    confirmedAt: typeof data.confirmedAt === "number" ? data.confirmedAt : null,
    confirmedBy: typeof data.confirmedBy === "string" ? data.confirmedBy : "",
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
    updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : "",
  };
}

function settingsRef() {
  return doc(getDb(), "meta", VAT_SALES_SETTINGS_DOC);
}

function dailyRef(dateKey: string) {
  return doc(getDb(), DAILY_SALES_COL, dateKey);
}

export function mapVatSalesSettings(data: Partial<VatSalesSettings> | undefined): VatSalesSettings {
  const ch = data?.channelsEnabled;
  return {
    vatRegistered: Boolean(data?.vatRegistered),
    vatRate: typeof data?.vatRate === "number" && data.vatRate > 0 ? data.vatRate : VAT_RATE,
    pnlIncomeMode: data?.pnlIncomeMode === "incVat" ? "incVat" : "exVat",
    reportEmails: Array.isArray(data?.reportEmails)
      ? data!.reportEmails.map((e) => String(e).trim()).filter(Boolean)
      : [],
    channelsEnabled: {
      shopee: ch?.shopee !== false,
      grab: ch?.grab !== false,
      lineman: ch?.lineman !== false,
      storefront: ch?.storefront !== false,
    },
    mailRules: mapMailRules(data?.mailRules),
    alertsEnabled: data?.alertsEnabled !== false,
    alertAfterHourBangkok: (() => {
      const h = Number(data?.alertAfterHourBangkok);
      if (!Number.isFinite(h)) return 10;
      return Math.min(23, Math.max(0, Math.round(h)));
    })(),
    updatedAt: typeof data?.updatedAt === "number" ? data.updatedAt : 0,
    updatedBy: typeof data?.updatedBy === "string" ? data.updatedBy : "",
  };
}

export async function loadVatSalesSettings(): Promise<VatSalesSettings> {
  const snap = await getDoc(settingsRef());
  return mapVatSalesSettings(snap.exists() ? (snap.data() as Partial<VatSalesSettings>) : undefined);
}

export async function saveVatSalesSettings(
  patch: Partial<VatSalesSettings>,
  updatedBy: string,
): Promise<VatSalesSettings> {
  const current = await loadVatSalesSettings();
  const next = mapVatSalesSettings({
    ...current,
    ...patch,
    channelsEnabled: {
      ...current.channelsEnabled,
      ...(patch.channelsEnabled || {}),
    },
    mailRules: patch.mailRules
      ? mapMailRules({ ...current.mailRules, ...patch.mailRules })
      : current.mailRules,
    updatedAt: Date.now(),
    updatedBy,
  });
  await setDoc(settingsRef(), next, { merge: true });
  return next;
}

export async function getDailySales(dateKey: string): Promise<DailySalesDoc> {
  if (!isDateKey(dateKey)) throw new Error("วันที่ไม่ถูกต้อง");
  const snap = await getDoc(dailyRef(dateKey));
  return mapDailySalesDoc(
    dateKey,
    snap.exists() ? (snap.data() as Record<string, unknown>) : undefined,
  );
}

export async function listDailySalesInMonth(
  monthKey: string,
): Promise<Record<string, DailySalesDoc>> {
  if (!isMonthKey(monthKey)) throw new Error("เดือนไม่ถูกต้อง");
  const keys = dateKeysInMonth(monthKey);
  const start = keys[0];
  const end = keys[keys.length - 1];
  const snap = await getDocs(
    query(
      collection(getDb(), DAILY_SALES_COL),
      where(documentId(), ">=", start),
      where(documentId(), "<=", end),
    ),
  );
  const out: Record<string, DailySalesDoc> = {};
  for (const key of keys) out[key] = emptyDailySales(key);
  for (const d of snap.docs) {
    const raw = d.data() as Record<string, unknown>;
    const dateKey = isDateKey(d.id) ? d.id : String(raw.dateKey || "");
    if (!dateKey.startsWith(monthKey)) continue;
    out[dateKey] = mapDailySalesDoc(dateKey, raw);
  }
  return out;
}

export type UpsertDailySalesInput = {
  dateKey: string;
  storefront?: ChannelAmount;
  delivery?: Partial<Record<DeliveryChannel, ChannelAmount>>;
  sources?: Partial<DailySalesSources>;
  emailRefs?: DailySalesEmailRefs;
  note?: string;
  status?: DailySalesStatus;
  confirmedBy?: string;
};

export async function upsertDailySales(
  input: UpsertDailySalesInput,
  updatedBy: string,
): Promise<DailySalesDoc> {
  const { dateKey } = input;
  if (!isDateKey(dateKey)) throw new Error("วันที่ไม่ถูกต้อง");

  const existing = await getDailySales(dateKey);
  const unlocking = input.status === "draft";
  const confirming = input.status === "confirmed";
  if (existing.status === "confirmed" && !unlocking && !confirming) {
    throw new Error("วันนี้ยืนยันแล้ว — ปลดล็อกก่อนแก้ยอด");
  }

  const storefront = input.storefront
    ? {
        grossInclusive: normalizeMoney(input.storefront.grossInclusive),
        fee: normalizeMoney(input.storefront.fee),
        netTransfer: normalizeMoney(input.storefront.netTransfer),
      }
    : existing.storefront;

  const delivery = { ...existing.delivery };
  if (input.delivery) {
    for (const ch of DELIVERY_CHANNELS) {
      const patch = input.delivery[ch];
      if (!patch) continue;
      delivery[ch] = {
        grossInclusive: normalizeMoney(patch.grossInclusive),
        fee: normalizeMoney(patch.fee),
        netTransfer: normalizeMoney(patch.netTransfer),
      };
    }
  }

  const totals = recomputeDailyTotals({ storefront, delivery });
  let status: DailySalesStatus = existing.status;
  let confirmedAt = existing.confirmedAt;
  let confirmedBy = existing.confirmedBy;

  if (input.status === "draft") {
    status = "draft";
    confirmedAt = null;
    confirmedBy = "";
  } else if (input.status === "confirmed") {
    status = "confirmed";
    confirmedAt = Date.now();
    confirmedBy = input.confirmedBy || updatedBy;
  }

  const sources: DailySalesSources = {
    storefront: input.sources?.storefront || existing.sources.storefront || "manual",
    ...(input.sources?.shopee || existing.sources.shopee
      ? { shopee: input.sources?.shopee || existing.sources.shopee }
      : {}),
    ...(input.sources?.grab || existing.sources.grab
      ? { grab: input.sources?.grab || existing.sources.grab }
      : {}),
    ...(input.sources?.lineman || existing.sources.lineman
      ? { lineman: input.sources?.lineman || existing.sources.lineman }
      : {}),
  };

  const emailRefs: DailySalesEmailRefs = {
    ...existing.emailRefs,
    ...(input.emailRefs || {}),
  };

  const docData: DailySalesDoc = {
    dateKey,
    storefront,
    delivery,
    ...totals,
    status,
    sources,
    emailRefs,
    note: input.note != null ? String(input.note) : existing.note,
    confirmedAt,
    confirmedBy,
    updatedAt: Date.now(),
    updatedBy,
  };

  await setDoc(dailyRef(dateKey), docData, { merge: true });
  return docData;
}

export async function confirmDailySales(dateKey: string, by: string): Promise<DailySalesDoc> {
  return upsertDailySales({ dateKey, status: "confirmed", confirmedBy: by }, by);
}

export async function unconfirmDailySales(dateKey: string, by: string): Promise<DailySalesDoc> {
  return upsertDailySales({ dateKey, status: "draft" }, by);
}

export type MonthSalesTotals = {
  storefrontGross: number;
  deliveryGross: number;
  totalGross: number;
  vatBase: number;
  vatOutput: number;
  shopee: number;
  grab: number;
  lineman: number;
  feeTotal: number;
  netTransferTotal: number;
  daysWithSales: number;
  confirmedDays: number;
};

export function sumMonthSales(
  docs: DailySalesDoc[],
  opts?: { confirmedOnly?: boolean },
): MonthSalesTotals {
  const tot: MonthSalesTotals = {
    storefrontGross: 0,
    deliveryGross: 0,
    totalGross: 0,
    vatBase: 0,
    vatOutput: 0,
    shopee: 0,
    grab: 0,
    lineman: 0,
    feeTotal: 0,
    netTransferTotal: 0,
    daysWithSales: 0,
    confirmedDays: 0,
  };
  for (const d of docs) {
    if (d.status === "confirmed") tot.confirmedDays += 1;
    if (opts?.confirmedOnly && d.status !== "confirmed") continue;
    if (d.totalGross <= 0 && d.status !== "confirmed") continue;
    if (d.totalGross > 0 || d.status === "confirmed") tot.daysWithSales += 1;
    tot.storefrontGross = roundMoney(tot.storefrontGross + d.storefrontGross);
    tot.deliveryGross = roundMoney(tot.deliveryGross + d.deliveryGross);
    tot.totalGross = roundMoney(tot.totalGross + d.totalGross);
    tot.vatBase = roundMoney(tot.vatBase + d.vatBase);
    tot.vatOutput = roundMoney(tot.vatOutput + d.vatOutput);
    tot.shopee = roundMoney(tot.shopee + d.delivery.shopee.grossInclusive);
    tot.grab = roundMoney(tot.grab + d.delivery.grab.grossInclusive);
    tot.lineman = roundMoney(tot.lineman + d.delivery.lineman.grossInclusive);
    tot.feeTotal = roundMoney(
      tot.feeTotal +
        d.delivery.shopee.fee +
        d.delivery.grab.fee +
        d.delivery.lineman.fee +
        d.storefront.fee,
    );
    tot.netTransferTotal = roundMoney(
      tot.netTransferTotal +
        d.delivery.shopee.netTransfer +
        d.delivery.grab.netTransfer +
        d.delivery.lineman.netTransfer +
        d.storefront.netTransfer,
    );
  }
  return tot;
}

/** รายได้เสนอเข้า monthlyIncome ตามโหมด */
export function proposeMonthlyIncomeAmount(
  docs: DailySalesDoc[],
  mode: PnlIncomeMode,
): { amount: number; confirmedDays: number; totals: MonthSalesTotals } {
  const confirmed = docs.filter((d) => d.status === "confirmed");
  const totals = sumMonthSales(confirmed, { confirmedOnly: true });
  const amount = mode === "incVat" ? totals.totalGross : totals.vatBase;
  return { amount, confirmedDays: confirmed.length, totals };
}

/**
 * รวมยอดหน้าร้านจาก posSales ตามวัน Bangkok (ไม่นับ void)
 * คืน map dateKey → grossInclusive
 */
export async function fetchPosStorefrontTotalsByMonth(
  monthKey: string,
): Promise<Record<string, number>> {
  if (!isMonthKey(monthKey)) throw new Error("เดือนไม่ถูกต้อง");
  const keys = dateKeysInMonth(monthKey);
  const start = startMsFromDateKey(keys[0]);
  const end = startMsFromDateKey(keys[keys.length - 1]);
  const legacyStart = start + 7 * 60 * 60 * 1000;
  const legacyEnd = end + 7 * 60 * 60 * 1000;

  const out: Record<string, number> = {};
  for (const k of keys) out[k] = 0;

  const seen = new Set<string>();

  const addSnap = async (startMs: number, endMs: number) => {
    const snap = await getDocs(
      query(
        collection(getDb(), POS_SALES_COL),
        where("date", ">=", startMs),
        where("date", "<=", endMs),
      ),
    );
    for (const d of snap.docs) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      const data = d.data() as Record<string, unknown>;
      if (data.status === "voided") continue;
      const dateMs = typeof data.date === "number" ? data.date : 0;
      if (!dateMs) continue;
      const dateKey = bangkokDateKey(dateMs);
      if (!(dateKey in out)) continue;
      const total = typeof data.total === "number" ? data.total : 0;
      out[dateKey] = roundMoney(out[dateKey] + normalizeMoney(total));
    }
  };

  await addSnap(start, end);
  await addSnap(legacyStart, legacyEnd);

  return out;
}

export function sourceLabel(src: ChannelSource | undefined): string {
  if (src === "pos_suggest") return "POS";
  if (src === "email") return "เมล";
  return "มือ";
}
