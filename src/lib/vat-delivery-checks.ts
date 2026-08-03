/**
 * เช็คลิสต์ตรวจความถูกต้องยอดเดลิเวอรี่ต่อแอพ
 * A = สรุปเดือน · B = ม้วนรายวัน
 * คอลัมน์: ยอดขายแอพ · ยอดโอน · คชจ.GP · VAT-ซื้อ
 */
import { daysInMonthKey } from "./categories";
import { gpVatFromFee } from "./personal-income-tax";
import { roundMoney } from "./vat-sales";
import type { DeliveryChannel } from "./vat-sales";
import type {
  ChannelDayAmount,
  ChannelMonthProposal,
  VatDeliveryMonthProposal,
} from "./vat-delivery-month-proposals";
import { channelHasConfirmableAmounts, sortedChannelDays } from "./vat-delivery-month-proposals";

export type DeliveryCheckKind = "pipeline" | "monthly" | "daily" | "shared";

export type DeliveryCheckItem = {
  id: string;
  kind: DeliveryCheckKind;
  label: string;
  ok: boolean;
  /** พร้อมตรวจแล้วหรือยัง (false = ยังไม่มีข้อมูลพอ) */
  applicable: boolean;
  detail?: string;
};

const TOL_BAHT = 2;

function num(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(Number(n))) return null;
  return Number(n);
}

function near(a: number, b: number, tol = TOL_BAHT) {
  return Math.abs(a - b) <= tol;
}

/** วันในเดือนที่ควรมีแถว (YYYY-MM-DD[]) */
export function expectedDayKeys(monthKey: string): string[] {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return [];
  const n = daysInMonthKey(monthKey);
  const out: string[] = [];
  for (let d = 1; d <= n; d += 1) {
    out.push(`${monthKey}-${String(d).padStart(2, "0")}`);
  }
  return out;
}

function rowEquationOk(day: ChannelDayAmount): boolean | null {
  const sales = num(day.appSales);
  const transfer = num(day.transfer);
  const gp = num(day.gpExVat);
  const vat = num(day.gpVat);
  if (sales == null || transfer == null) return null;
  if (sales < transfer - TOL_BAHT) return false;
  const fee = (gp || 0) + (vat || 0);
  if (fee <= 0 && sales > transfer) {
    // ยังไม่มี GP — ถือว่ายังไม่ครบ ไม่ fail สมการ
    return null;
  }
  if (fee > 0) {
    return near(sales - transfer, fee);
  }
  return near(sales, transfer) || sales >= transfer;
}

function vatFromGpOk(gpEx: number | null, gpVat: number | null): boolean | null {
  if (gpEx == null || gpVat == null) return null;
  if (gpEx <= 0 && gpVat <= 0) return true;
  const feeInc = roundMoney(gpEx + gpVat);
  if (feeInc <= 0) return true;
  const expect = gpVatFromFee(feeInc, "incVat", 7);
  return near(gpVat, expect, 1);
}

/**
 * เช็คต่อช่องทาง — A (สรุปเดือน) + B (รายวัน) + ร่วม
 */
export function buildChannelDeliveryChecks(input: {
  monthKey: string;
  channel: DeliveryChannel;
  proposal?: ChannelMonthProposal | null;
  fileCount?: number;
}): DeliveryCheckItem[] {
  const ch = input.proposal;
  const strategy = ch?.strategy || "unknown";
  const amounts = ch?.amounts;
  const sales = num(amounts?.appSales);
  const transfer = num(amounts?.transfer);
  const gpEx = num(amounts?.gpExVat);
  const gpVat = num(amounts?.gpVat);
  const hasAmounts = channelHasConfirmableAmounts(ch);
  const days = sortedChannelDays(ch?.days);
  const isMonthly = strategy === "monthly-summary";
  const isDaily =
    strategy === "daily-rollup" ||
    strategy === "mixed" ||
    (!isMonthly && days.length > 0);
  const fileCount = Number(input.fileCount) || 0;
  const items: DeliveryCheckItem[] = [];

  items.push({
    id: `${input.channel}-files`,
    kind: "shared",
    label: "มีไฟล์ในกองแอพ",
    ok: fileCount > 0,
    applicable: true,
    detail: fileCount > 0 ? `${fileCount} ไฟล์` : "ยังว่าง — ซิงก์กองแอพ",
  });

  items.push({
    id: `${input.channel}-group`,
    kind: "shared",
    label: isMonthly
      ? "กลุ่ม A · สรุปเดือน"
      : isDaily
        ? "กลุ่ม B · ม้วนรายวัน"
        : "ยังไม่จัดกลุ่ม A/B",
    ok: isMonthly || isDaily,
    applicable: Boolean(ch),
    detail: strategy,
  });

  // —— A สรุปเดือน / ยอดเดือนร่วม ——
  items.push({
    id: `${input.channel}-amounts`,
    kind: isMonthly ? "monthly" : "shared",
    label: "มียอด 4 คอลัมน์ (ระบบเติมแล้ว)",
    ok: hasAmounts && sales != null && sales > 0,
    applicable: Boolean(ch),
    detail: hasAmounts ? `ขาย ${sales ?? "—"}` : "กดระบบเติม F4",
  });

  items.push({
    id: `${input.channel}-sales-ge-transfer`,
    kind: "shared",
    label: "ยอดขาย ≥ ยอดโอน",
    ok: sales != null && transfer != null ? sales + TOL_BAHT >= transfer : false,
    applicable: sales != null && transfer != null,
    detail:
      sales != null && transfer != null
        ? `${sales} ≥ ${transfer}`
        : "ยังไม่มีครบ",
  });

  const fee = (gpEx || 0) + (gpVat || 0);
  items.push({
    id: `${input.channel}-gp-equation`,
    kind: "shared",
    label: "ขาย − โอน ≈ คชจ.GP+VAT (±2฿)",
    ok:
      sales != null && transfer != null && fee > 0
        ? near(sales - transfer, fee)
        : false,
    applicable: sales != null && transfer != null && fee > 0,
    detail:
      sales != null && transfer != null && fee > 0
        ? `ต่าง ${roundMoney(sales - transfer)} · fee ${roundMoney(fee)}`
        : "รอ GP",
  });

  const vatOk = vatFromGpOk(gpEx, gpVat);
  items.push({
    id: `${input.channel}-vat-split`,
    kind: "shared",
    label: "VAT-ซื้อ สอดคล้อง GP (7%)",
    ok: vatOk === true,
    applicable: vatOk != null,
    detail:
      vatOk == null
        ? "ยังไม่มี GP/VAT"
        : vatOk
          ? "ตรง"
          : "ไม่ตรงสูตร incVAT",
  });

  // —— B รายวัน ——
  const expected = expectedDayKeys(input.monthKey);
  const dayMap = new Map(days.map((d) => [d.dateKey, d]));
  const filled = days.filter(
    (d) =>
      d.status !== "gap" &&
      (num(d.appSales) != null || num(d.transfer) != null),
  );
  const gaps = expected.filter((dk) => {
    const row = dayMap.get(dk);
    if (!row) return true;
    return (
      row.status === "gap" ||
      (num(row.appSales) == null && num(row.transfer) == null)
    );
  });
  const eqBad = filled.filter((d) => rowEquationOk(d) === false);

  let rollSales = 0;
  let rollTransfer = 0;
  for (const d of filled) {
    rollSales += num(d.appSales) || 0;
    rollTransfer += num(d.transfer) || 0;
  }
  rollSales = roundMoney(rollSales);
  rollTransfer = roundMoney(rollTransfer);

  items.push({
    id: `${input.channel}-daily-table`,
    kind: "daily",
    label: "มีตารางรายวัน",
    ok: days.length > 0,
    applicable: isDaily || strategy === "unknown",
    detail: days.length ? `${days.length} แถว` : "ยังไม่มีแถว",
  });

  items.push({
    id: `${input.channel}-daily-coverage`,
    kind: "daily",
    label: `ครบวันในเดือน (${expected.length} วัน)`,
    ok: expected.length > 0 && gaps.length === 0 && filled.length > 0,
    applicable: isDaily && days.length > 0,
    detail:
      gaps.length === 0
        ? `ครบ ${filled.length}/${expected.length}`
        : `หาย ${gaps.length} วัน · เช่น ${gaps.slice(0, 3).join(", ")}`,
  });

  items.push({
    id: `${input.channel}-daily-row-eq`,
    kind: "daily",
    label: "สมการรายวันผ่าน (ขาย−โอน≈GP)",
    ok: filled.length > 0 && eqBad.length === 0,
    applicable: isDaily && filled.length > 0,
    detail:
      eqBad.length === 0
        ? "ผ่าน"
        : `ไม่ตรง ${eqBad.length} วัน · ${eqBad
            .slice(0, 2)
            .map((d) => d.dateKey)
            .join(", ")}`,
  });

  items.push({
    id: `${input.channel}-daily-rollup`,
    kind: "daily",
    label: "ม้วนรายวัน = ยอดเดือน",
    ok:
      sales != null &&
      transfer != null &&
      filled.length > 0 &&
      near(rollSales, sales) &&
      near(rollTransfer, transfer),
    applicable: isDaily && sales != null && transfer != null && filled.length > 0,
    detail:
      sales != null && transfer != null && filled.length > 0
        ? `ม้วนขาย ${rollSales} / เดือน ${sales}`
        : "รอยอดเดือน+รายวัน",
  });

  items.push({
    id: `${input.channel}-spotcheck`,
    kind: "shared",
    label: "พร้อมซุ่มตรวจ → F5",
    ok: hasAmounts && (isMonthly || (isDaily && gaps.length === 0 && eqBad.length === 0)),
    applicable: hasAmounts,
    detail: hasAmounts
      ? isMonthly
        ? "กลุ่ม A พร้อม"
        : gaps.length || eqBad.length
          ? "แก้ gap/สมการก่อน"
          : "กลุ่ม B พร้อม"
      : "ยังไม่มียอด",
  });

  return items;
}

export function summarizeChannelChecks(items: DeliveryCheckItem[]): {
  ready: number;
  total: number;
  applicable: number;
  allOk: boolean;
} {
  const applicable = items.filter((i) => i.applicable);
  const ready = applicable.filter((i) => i.ok).length;
  return {
    ready,
    total: items.length,
    applicable: applicable.length,
    allOk: applicable.length > 0 && ready === applicable.length,
  };
}

/** สรุปทั้งเดือน — pipeline + ต่อแอพ */
export function buildMonthDeliveryCheckSummary(input: {
  monthKey: string;
  proposal: VatDeliveryMonthProposal | null;
  fileCounts: Record<DeliveryChannel, number>;
  pipeline: { f0: boolean; f1: boolean; f4: boolean; f5: boolean };
}): {
  channels: Record<
    DeliveryChannel,
    { items: DeliveryCheckItem[]; summary: ReturnType<typeof summarizeChannelChecks> }
  >;
  pipelineReady: number;
} {
  const channels = {} as Record<
    DeliveryChannel,
    { items: DeliveryCheckItem[]; summary: ReturnType<typeof summarizeChannelChecks> }
  >;
  for (const ch of ["grab", "lineman", "shopee"] as DeliveryChannel[]) {
    const items = buildChannelDeliveryChecks({
      monthKey: input.monthKey,
      channel: ch,
      proposal: input.proposal?.channels[ch],
      fileCount: input.fileCounts[ch] || 0,
    });
    channels[ch] = { items, summary: summarizeChannelChecks(items) };
  }
  const pipe = [input.pipeline.f0, input.pipeline.f1, input.pipeline.f4, input.pipeline.f5];
  return {
    channels,
    pipelineReady: pipe.filter(Boolean).length,
  };
}
