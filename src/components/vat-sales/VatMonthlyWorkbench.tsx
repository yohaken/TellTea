"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDateShort, formatDateTimeShort } from "@/lib/utils";
import {
  loadOwnerMonthBreakdown,
  loadPnlReport,
  loadStaffMonthBreakdown,
  saveMonthlyIncome,
  type MonthCategoryRow,
} from "@/lib/pnl";
import {
  buildIncomeBridge,
  computePersonalIncomeTax,
  DEFAULT_PERSONAL_ALLOWANCE,
  defaultGpByChannel,
  loadPersonalTaxSettings,
  mapGpByChannel,
  savePersonalTaxSettings,
  THAI_PIT_BRACKETS,
  type GpByChannel,
  type GpChannelKey,
} from "@/lib/personal-income-tax";
import {
  formatVatMoney,
  formatVatPct,
  moneyFieldValue,
  normalizeMoneyFieldText,
  parseVatMoneyInput,
  parseVatPctInput,
} from "@/lib/vat-number-format";
import { listVatImportRows } from "@/lib/vat-import";
import {
  computeImportFillStats,
  formatFillPct,
} from "@/lib/vat-import-fill";
import {
  recentVatImportMergeAt,
  subscribeVatImportMonthMerged,
} from "@/lib/vat-import-month-sync";
import {
  DEFAULT_OUTPUT_PCT,
  DEFAULT_PERIOD_START_DAY,
  emptySegment,
  fileVatMonthlyReturn,
  formatThaiMonthKey,
  getVatPeriodBoundary,
  listThaiMonthOptions,
  loadVatMonthlyReturn,
  loadVatMonthlySettings,
  mapVatLogicRates,
  outputPctToFraction,
  recomputeSegment,
  saveVatMonthlyReturn,
  saveVatMonthlySettings,
  sumMonthlyTotals,
  unlockVatMonthlyReturn,
  type DeliveryChannels,
  type StorefrontTenders,
  type VatLogicRates,
  type VatMonthlyReturn,
  type VatSegmentState,
} from "@/lib/vat-monthly";
import {
  bookLabel,
  loadBothBooksVatByMonth,
  type BooksVatBook,
  type BooksVatLine,
} from "@/lib/books-vat-month";
import { updateLedgerEntry } from "@/lib/ledger";
import { updateOwnerBookEntry } from "@/lib/owner-books";
import { BooksVatEntryDetailModal } from "@/components/vat-sales/BooksVatEntryDetailModal";
import { exportPersonalTaxYearXlsx } from "@/lib/xlsx-export";

function emptyBookRow(month: string): MonthCategoryRow {
  return { month, asset: 0, cogs: 0, sga: 0, other: 0 };
}

function pickBookRow(rows: MonthCategoryRow[], month: string): MonthCategoryRow {
  return rows.find((r) => r.month === month) || emptyBookRow(month);
}

/** แสดงเงินในตาราง — ทศนิยม 2 เสมอ (รวม 0.00) */
function fmt(n: number) {
  if (!Number.isFinite(n)) return "—";
  return formatVatMoney(n);
}

function moneyInputValue(n: number) {
  return moneyFieldValue(n);
}

function parseMoneyInput(raw: string): number {
  return parseVatMoneyInput(raw);
}

function parseRate(raw: string, fallback: number): number {
  return parseVatPctInput(raw, fallback);
}

function roundPct(n: number) {
  return Math.round(n * 10000) / 100;
}

function draftStorageKey(month: string) {
  return `telltea:vat-monthly-draft:${month}`;
}

type Props = { actor: string };

type DraftSeg = {
  grossManual: string;
  channels: Record<keyof DeliveryChannels, string>;
  tenders: Record<keyof StorefrontTenders, string>;
  remitPct: string;
  gpVat: string;
  useGpEstimate: boolean;
  ingredientVat: string;
  rates: VatLogicRates;
};

/** เลือกข้อความตัวเลขที่ไม่ว่าง / มากกว่า */
function pickMoneyStr(a: string, b: string): string {
  const na = parseMoneyInput(a);
  const nb = parseMoneyInput(b);
  if (na > 0 && nb > 0) return na >= nb ? a : b;
  if (na > 0) return a;
  if (nb > 0) return b;
  return a || b || "";
}

function draftMoneyScore(d: DraftSeg): number {
  return (
    parseMoneyInput(d.grossManual) +
    parseMoneyInput(d.channels.shopee) +
    parseMoneyInput(d.channels.grab) +
    parseMoneyInput(d.channels.lineman) +
    parseMoneyInput(d.tenders.transfer) +
    parseMoneyInput(d.tenders.cash) +
    parseMoneyInput(d.gpVat) +
    parseMoneyInput(d.ingredientVat)
  );
}

/** รวมร่างแบบไม่ให้ค่าว่างทับค่าที่มีตัวเลข */
function mergePreferMoney(base: DraftSeg, overlay: DraftSeg): DraftSeg {
  return {
    grossManual: pickMoneyStr(base.grossManual, overlay.grossManual),
    channels: {
      shopee: pickMoneyStr(base.channels.shopee, overlay.channels.shopee),
      grab: pickMoneyStr(base.channels.grab, overlay.channels.grab),
      lineman: pickMoneyStr(base.channels.lineman, overlay.channels.lineman),
    },
    tenders: {
      transfer: pickMoneyStr(base.tenders.transfer, overlay.tenders.transfer),
      cash: pickMoneyStr(base.tenders.cash, overlay.tenders.cash),
    },
    remitPct: overlay.remitPct || base.remitPct,
    gpVat: pickMoneyStr(base.gpVat, overlay.gpVat),
    useGpEstimate: overlay.useGpEstimate,
    ingredientVat: pickMoneyStr(base.ingredientVat, overlay.ingredientVat),
    rates: mapVatLogicRates(overlay.rates || base.rates),
  };
}

function readLocalDraft(month: string): {
  delivery?: DraftSeg;
  storefront?: DraftSeg;
  note?: string;
  pnlMode?: "exVat" | "incVat";
  pnlIncome?: string;
} | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(draftStorageKey(month));
    if (!raw) return null;
    const cached = JSON.parse(raw) as {
      delivery?: DraftSeg;
      storefront?: DraftSeg;
      note?: string;
      pnlMode?: "exVat" | "incVat";
      pnlIncome?: string;
    };
    return cached && typeof cached === "object" ? cached : null;
  } catch {
    return null;
  }
}

function writeLocalDraft(month: string, payload: string) {
  if (typeof window === "undefined") return;
  try {
    const prevRaw = localStorage.getItem(draftStorageKey(month));
    if (prevRaw) {
      try {
        const prev = JSON.parse(prevRaw) as {
          delivery?: DraftSeg;
          storefront?: DraftSeg;
        };
        const next = JSON.parse(payload) as {
          delivery?: DraftSeg;
          storefront?: DraftSeg;
        };
        const prevScore =
          (prev.delivery ? draftMoneyScore(prev.delivery) : 0) +
          (prev.storefront ? draftMoneyScore(prev.storefront) : 0);
        const nextScore =
          (next.delivery ? draftMoneyScore(next.delivery) : 0) +
          (next.storefront ? draftMoneyScore(next.storefront) : 0);
        // กัน race: ค่าว่างตอนโหลดห้ามทับร่างที่มีตัวเลข
        if (prevScore > 0 && nextScore === 0) return;
      } catch {
        /* ignore parse, write anyway */
      }
    }
    localStorage.setItem(draftStorageKey(month), payload);
  } catch {
    /* quota */
  }
}

function segToDraft(seg: VatSegmentState): DraftSeg {
  return {
    grossManual: moneyInputValue(seg.grossManual),
    channels: {
      shopee: moneyInputValue(seg.channels.shopee),
      grab: moneyInputValue(seg.channels.grab),
      lineman: moneyInputValue(seg.channels.lineman),
    },
    tenders: {
      transfer: moneyInputValue(seg.tenders.transfer),
      cash: moneyInputValue(seg.tenders.cash),
    },
    // หน้าร้านเริ่มนำส่ง 100% ตามมาตรฐานง่าย
    remitPct: seg.kind === "storefront" ? "100" : String(seg.remitPct || 100),
    gpVat: moneyInputValue(seg.gpVat),
    useGpEstimate: seg.useGpEstimate,
    ingredientVat: moneyInputValue(seg.ingredientVat),
    rates: mapVatLogicRates(seg.rates),
  };
}

function draftToSeg(
  kind: "delivery" | "storefront",
  d: DraftSeg,
): VatSegmentState {
  return recomputeSegment({
    kind,
    grossManual: parseMoneyInput(d.grossManual),
    channels: {
      shopee: parseMoneyInput(d.channels.shopee),
      grab: parseMoneyInput(d.channels.grab),
      lineman: parseMoneyInput(d.channels.lineman),
    },
    tenders: {
      transfer: parseMoneyInput(d.tenders.transfer),
      cash: parseMoneyInput(d.tenders.cash),
    },
    remitPct: kind === "storefront" ? 100 : parseRate(d.remitPct, 100),
    gpVat: parseMoneyInput(d.gpVat),
    useGpEstimate: d.useGpEstimate,
    ingredientVat: parseMoneyInput(d.ingredientVat),
    rates: d.rates,
  });
}

function setOutputPct(rates: VatLogicRates, pct: number): VatLogicRates {
  const outputPct = Math.min(99, Math.max(0.01, pct));
  const frac = outputPctToFraction(outputPct);
  return mapVatLogicRates({ ...rates, outputPct, ...frac });
}

function MoneyCell({
  value,
  locked,
  ariaLabel,
  onChange,
}: {
  value: string;
  locked: boolean;
  ariaLabel: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      className="vat-sales-input"
      inputMode="decimal"
      disabled={locked}
      value={value}
      placeholder="0.00"
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => {
        const next = normalizeMoneyFieldText(value);
        if (next !== value) onChange(next);
      }}
    />
  );
}

function TapRate({
  value,
  locked,
  ariaLabel,
  onCommit,
  suffix = "",
  step = "1",
}: {
  value: number;
  locked: boolean;
  ariaLabel: string;
  onCommit: (n: number) => void;
  suffix?: string;
  step?: string;
}) {
  if (locked) {
    return (
      <span className="vat-tap-val">
        {formatVatMoney(value)}
        {suffix}
      </span>
    );
  }
  return (
    <span className="vat-tap-edit">
      <input
        className="vat-sales-input vat-tap-input"
        type="number"
        step={step}
        min={0}
        disabled={locked}
        aria-label={ariaLabel}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onCommit(parseRate(e.target.value, value))}
      />
      {suffix ? <span className="vat-tap-suffix">{suffix}</span> : null}
    </span>
  );
}

function ExpandBtn({
  open,
  onToggle,
  label,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className="vat-expand-btn"
      aria-expanded={open}
      aria-label={`${open ? "ยุบ" : "ขยาย"} ${label}`}
      onClick={onToggle}
    >
      {open ? "−" : "+"}
    </button>
  );
}

/** ยอดขายอ้างอิงคิดภาษีขาย — นำส่ง 100% · ไม่ใช่ตารางรายได้ */
function SalesVatTable({
  deliveryDraft,
  storefrontDraft,
  delivery,
  storefront,
  locked,
  openDelivery,
  openStorefront,
  onToggleDelivery,
  onToggleStorefront,
  onDeliveryChange,
  onStorefrontChange,
}: {
  deliveryDraft: DraftSeg;
  storefrontDraft: DraftSeg;
  delivery: VatSegmentState;
  storefront: VatSegmentState;
  locked: boolean;
  openDelivery: boolean;
  openStorefront: boolean;
  onToggleDelivery: () => void;
  onToggleStorefront: () => void;
  onDeliveryChange: (d: DraftSeg) => void;
  onStorefrontChange: (d: DraftSeg) => void;
}) {
  const totalSales = delivery.reportedGross + storefront.reportedGross;
  const totalOut = delivery.outputVat + storefront.outputVat;

  const renderParent = (
    kind: "delivery" | "storefront",
    label: string,
    draft: DraftSeg,
    computed: VatSegmentState,
    open: boolean,
    onToggle: () => void,
    onChange: (d: DraftSeg) => void,
  ) => {
    const usesParts = computed.partsSum > 0;
    const isStore = kind === "storefront";
    return (
      <>
        <tr className="vat-row-parent">
          <td className="col-seg">
            <span className="vat-seg-cell">
              <ExpandBtn open={open} onToggle={onToggle} label={label} />
              <span className="vat-seg-label">{label}</span>
            </span>
          </td>
          <td className="col-num col-input">
            {usesParts ? (
              <span className="vat-est-val" title="รวมจากรายการย่อย">
                {fmt(computed.reportedGross)}
              </span>
            ) : (
              <MoneyCell
                value={draft.grossManual}
                locked={locked}
                ariaLabel={
                  isStore ? `${label} ยอดขายหน้าร้าน` : `${label} ยอดขายรวม VAT`
                }
                onChange={(v) => onChange({ ...draft, grossManual: v })}
              />
            )}
          </td>
          <td className="col-rate">
            <TapRate
              value={draft.rates.outputPct || DEFAULT_OUTPUT_PCT}
              locked={locked}
              ariaLabel={`${label} เรทขาย %`}
              suffix="%"
              step="0.01"
              onCommit={(pct) =>
                onChange({ ...draft, rates: setOutputPct(draft.rates, pct) })
              }
            />
          </td>
          <td className="col-num col-net">{fmt(computed.outputVat)}</td>
        </tr>
        {kind === "delivery" && open
          ? (
              [
                ["grab", "Grab"],
                ["shopee", "ShopeeFood"],
                ["lineman", "LINE MAN"],
              ] as const
            ).map(([key, name]) => (
              <tr key={key} className="vat-row-child">
                <td className="col-seg col-child">{name}</td>
                <td className="col-num col-input">
                  <MoneyCell
                    value={draft.channels[key]}
                    locked={locked}
                    ariaLabel={`${name} ยอดขาย`}
                    onChange={(v) =>
                      onChange({
                        ...draft,
                        channels: { ...draft.channels, [key]: v },
                      })
                    }
                  />
                </td>
                <td className="col-rate" />
                <td className="col-num" />
              </tr>
            ))
          : null}
        {kind === "storefront" && open
          ? (
              [
                ["transfer", "เงินโอน"],
                ["cash", "เงินสด"],
              ] as const
            ).map(([key, name]) => (
              <tr key={key} className="vat-row-child">
                <td className="col-seg col-child">{name}</td>
                <td className="col-num col-input">
                  <MoneyCell
                    value={draft.tenders[key]}
                    locked={locked}
                    ariaLabel={`${name} ยอดขาย`}
                    onChange={(v) =>
                      onChange({
                        ...draft,
                        tenders: { ...draft.tenders, [key]: v },
                      })
                    }
                  />
                </td>
                <td className="col-rate" />
                <td className="col-num" />
              </tr>
            ))
          : null}
      </>
    );
  };

  return (
    <section className="vat-table-block">
      <h2 className="vat-table-title">ยอดขาย → ภาษีขาย</h2>
      <div className="sheet-wrap vat-month-slim-wrap">
        <table className="sheet-table vat-sales-table vat-sales-table--slim vat-month-slim vat-month-slim--output">
          <thead>
            <tr>
              <th className="col-seg">ส่วน</th>
              <th className="col-num">ยอดขาย (นำส่ง 100%)</th>
              <th className="col-rate">เรท %</th>
              <th className="col-num">ภาษีขาย</th>
            </tr>
          </thead>
          <tbody>
            {renderParent(
              "delivery",
              "ยอดขายเดลิเวอรี่",
              deliveryDraft,
              delivery,
              openDelivery,
              onToggleDelivery,
              onDeliveryChange,
            )}
            {renderParent(
              "storefront",
              "ยอดขายหน้าร้าน",
              storefrontDraft,
              storefront,
              openStorefront,
              onToggleStorefront,
              onStorefrontChange,
            )}
            <tr className="vat-sales-totals-row">
              <td className="col-seg">รวม</td>
              <td className="col-num">{fmt(totalSales)}</td>
              <td className="col-rate">—</td>
              <td className="col-num col-net">{fmt(totalOut)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function InputVatTable({
  month,
  deliveryGpFromChannels = false,
  deliveryDraft,
  storefrontDraft,
  delivery,
  storefront,
  locked,
  onDeliveryChange,
  onStorefrontChange,
}: {
  month: string;
  /** ภาษีซื้อ GP เดลิเวอรี่มาจากตารางช่องทาง — ปิดประมาณก้อน */
  deliveryGpFromChannels?: boolean;
  deliveryDraft: DraftSeg;
  storefrontDraft: DraftSeg;
  delivery: VatSegmentState;
  storefront: VatSegmentState;
  locked: boolean;
  onDeliveryChange: (d: DraftSeg) => void;
  onStorefrontChange: (d: DraftSeg) => void;
}) {
  const [pullBusy, setPullBusy] = useState(false);
  const [pullMsg, setPullMsg] = useState("");
  const [linesBusy, setLinesBusy] = useState(false);
  const [claimBusyId, setClaimBusyId] = useState("");
  const [booksLines, setBooksLines] = useState<BooksVatLine[]>([]);
  const [booksCount, setBooksCount] = useState(0);
  const [booksAllCount, setBooksAllCount] = useState(0);
  const [booksVatTotal, setBooksVatTotal] = useState(0);
  const [ledgerCount, setLedgerCount] = useState(0);
  const [ownerCount, setOwnerCount] = useState(0);
  const [openBooksLines, setOpenBooksLines] = useState(false);
  const [detailLine, setDetailLine] = useState<{
    book: BooksVatBook;
    id: string;
  } | null>(null);

  const refreshBooksVatLines = useCallback(async () => {
    setLinesBusy(true);
    try {
      const bundle = await loadBothBooksVatByMonth(month);
      setBooksLines(bundle.lines);
      setBooksCount(bundle.count);
      setBooksAllCount(bundle.allCount);
      setBooksVatTotal(bundle.vatInput);
      setLedgerCount(bundle.ledgerCount);
      setOwnerCount(bundle.ownerCount);
      return bundle;
    } catch {
      setBooksLines([]);
      setBooksCount(0);
      setBooksAllCount(0);
      setBooksVatTotal(0);
      setLedgerCount(0);
      setOwnerCount(0);
      return null;
    } finally {
      setLinesBusy(false);
    }
  }, [month]);

  useEffect(() => {
    setOpenBooksLines(false);
    setDetailLine(null);
    void refreshBooksVatLines();
  }, [month, refreshBooksVatLines]);

  async function toggleLineClaim(line: BooksVatLine, nextClaim: boolean) {
    if (locked) return;
    const key = `${line.book}-${line.id}`;
    setClaimBusyId(key);
    setPullMsg("");
    try {
      if (line.book === "ledger") {
        await updateLedgerEntry(line.id, { vatClaim: nextClaim });
      } else {
        await updateOwnerBookEntry(line.id, { vatClaim: nextClaim });
      }
      await refreshBooksVatLines();
    } catch (e) {
      setPullMsg(e instanceof Error ? e.message : "อัปเดตไม่สำเร็จ");
    } finally {
      setClaimBusyId("");
    }
  }

  async function toggleClaimAll(nextClaim: boolean) {
    if (locked || !booksLines.length) return;
    setClaimBusyId("all");
    setPullMsg("");
    try {
      await Promise.all(
        booksLines
          .filter((line) => line.vatClaim !== nextClaim)
          .map((line) =>
            line.book === "ledger"
              ? updateLedgerEntry(line.id, { vatClaim: nextClaim })
              : updateOwnerBookEntry(line.id, { vatClaim: nextClaim }),
          ),
      );
      await refreshBooksVatLines();
      setPullMsg(
        nextClaim
          ? `ติ๊กรวมทั้งหมด ${booksLines.length} รายการแล้ว · จำในรายการเดิมครั้งหน้า`
          : "ยกเลิกติ๊กทั้งหมดแล้ว",
      );
    } catch (e) {
      setPullMsg(e instanceof Error ? e.message : "อัปเดตไม่สำเร็จ");
    } finally {
      setClaimBusyId("");
    }
  }

  const allClaimed =
    booksAllCount > 0 && booksCount === booksAllCount && booksAllCount > 0;
  const someClaimed = booksCount > 0 && booksCount < booksAllCount;

  async function pullIngredientFromBothBooks() {
    if (locked) return;
    setPullBusy(true);
    setPullMsg("");
    try {
      const bundle = await refreshBooksVatLines();
      if (!bundle || bundle.count <= 0 || bundle.vatInput <= 0) {
        setPullMsg(
          bundle && bundle.allCount > 0
            ? `มี ${bundle.allCount} รายการมียอด VAT แต่ยังไม่มีรายการที่ติ๊ก「รวมเข้าระบบ」 — เปิด + แล้วติ๊กก่อนดึง`
            : "ยังไม่มีรายการภาษีซื้อจากสองบช. ในเดือนนี้",
        );
        setOpenBooksLines(true);
        return;
      }
      // รวมสองบช. → วัตถุดิบหน้าร้าน · GP เดลิเวอรี่แยก (ไม่ทับ)
      onStorefrontChange({
        ...storefrontDraft,
        ingredientVat: moneyInputValue(bundle.vatInput),
      });
      setPullMsg(
        `ดึง ${formatVatMoney(bundle.vatInput)} · พนง. ${formatVatMoney(bundle.ledgerVat)} (${bundle.ledgerCount}) + เจ้าของ ${formatVatMoney(bundle.ownerVat)} (${bundle.ownerCount}) → วัตถุดิบหน้าร้าน`,
      );
      setOpenBooksLines(true);
    } catch (e) {
      setPullMsg(e instanceof Error ? e.message : "ดึงไม่สำเร็จ");
    } finally {
      setPullBusy(false);
    }
  }

  const renderRow = (
    label: string,
    draft: DraftSeg,
    computed: VatSegmentState,
    onChange: (d: DraftSeg) => void,
    opts?: { fromChannels?: boolean },
  ) => (
    <tr className="vat-row-parent">
      <td className="col-seg">{label}</td>
      <td className="col-num col-input">
        {opts?.fromChannels ? (
          <span className="vat-est-val" title="จากตาราง GP ช่องทางด้านบน">
            {fmt(computed.gpVatClaimed)}
            <span className="vat-gp-src"> จากช่องทาง</span>
          </span>
        ) : (
          <span className="vat-pct-cell">
            {draft.useGpEstimate ? (
              <span className="vat-est-val">{fmt(computed.gpVatClaimed)}</span>
            ) : (
              <MoneyCell
                value={draft.gpVat}
                locked={locked}
                ariaLabel={`${label} ภาษีซื้อ GP`}
                onChange={(v) => onChange({ ...draft, gpVat: v })}
              />
            )}
            <label className="vat-gp-toggle">
              <input
                type="checkbox"
                disabled={locked}
                checked={draft.useGpEstimate}
                onChange={(e) =>
                  onChange({ ...draft, useGpEstimate: e.target.checked })
                }
              />
              ประมาณ
            </label>
          </span>
        )}
      </td>
      <td className="col-pct">
        <TapRate
          value={roundPct(draft.rates.inputClaimFactor)}
          locked={locked}
          ariaLabel={`${label} ยื่นภาษีซื้อ %`}
          suffix="%"
          step="0.01"
          onCommit={(pct) =>
            onChange({
              ...draft,
              rates: {
                ...draft.rates,
                inputClaimFactor: Math.min(100, Math.max(1, pct)) / 100,
              },
            })
          }
        />
      </td>
      <td className="col-num col-input">
        <MoneyCell
          value={draft.ingredientVat}
          locked={locked}
          ariaLabel={`${label} ภาษีซื้อวัตถุดิบ`}
          onChange={(v) => onChange({ ...draft, ingredientVat: v })}
        />
      </td>
      <td className="col-num col-net">{fmt(computed.inputVat)}</td>
    </tr>
  );

  return (
    <section className="vat-table-block">
      <h2 className="vat-table-title">ภาษีซื้อ — GP + บช.</h2>
      {!locked ? (
        <div className="vat-month-actions vat-month-actions--mini">
          <button
            type="button"
            className="vat-mini-btn"
            disabled={pullBusy || linesBusy}
            onClick={() => void pullIngredientFromBothBooks()}
          >
            {pullBusy ? "กำลังดึง…" : "ดึงภาษีซื้อจากสองบช."}
          </button>
        </div>
      ) : null}
      {pullMsg ? <p className="muted vat-sales-msg">{pullMsg}</p> : null}
      <div className="sheet-wrap vat-month-slim-wrap">
        <table className="sheet-table vat-sales-table vat-sales-table--slim vat-month-slim vat-month-slim--input">
          <thead>
            <tr>
              <th className="col-seg">ส่วน</th>
              <th className="col-num">ภาษีซื้อ GP</th>
              <th className="col-pct">ยื่น %</th>
              <th className="col-num">วัตถุดิบ</th>
              <th className="col-num">ภาษีซื้อรวม</th>
            </tr>
          </thead>
          <tbody>
            {renderRow(
              "เดลิเวอรี่",
              deliveryDraft,
              delivery,
              onDeliveryChange,
              { fromChannels: deliveryGpFromChannels },
            )}
            {renderRow(
              "หน้าร้าน",
              storefrontDraft,
              storefront,
              onStorefrontChange,
            )}
            <tr className="vat-sales-totals-row">
              <td className="col-seg">รวมภาษีซื้อ</td>
              <td className="col-num">
                {fmt(delivery.gpVatClaimed + storefront.gpVatClaimed)}
              </td>
              <td className="col-pct">—</td>
              <td className="col-num">
                {fmt(
                  delivery.ingredientVatClaimed +
                    storefront.ingredientVatClaimed,
                )}
              </td>
              <td className="col-num col-net">
                {fmt(delivery.inputVat + storefront.inputVat)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="vat-books-breakdown">
        <div className="vat-books-breakdown-head">
          <span className="vat-seg-cell">
            <ExpandBtn
              open={openBooksLines}
              onToggle={() => setOpenBooksLines((v) => !v)}
              label="รายการภาษีซื้อจากสองบช."
            />
            <span className="vat-seg-label">
              รายการจากสองบช.
              {linesBusy
                ? "…"
                : booksAllCount > 0
                  ? ` (${booksCount}/${booksAllCount} รวม · ${formatVatMoney(booksVatTotal)})`
                  : " (ยังไม่มี)"}
            </span>
          </span>
          {!linesBusy && booksAllCount > 0 ? (
            <span className="muted vat-books-breakdown-meta">
              รวมแล้ว พนง. {ledgerCount} · เจ้าของ {ownerCount}
            </span>
          ) : null}
        </div>
        {openBooksLines ? (
          booksAllCount === 0 ? (
            <p className="muted vat-sales-msg">ยังไม่มีรายการ VAT จากสองบช.</p>
          ) : (
            <div className="sheet-wrap vat-month-slim-wrap">
              <table className="sheet-table vat-sales-table vat-sales-table--slim vat-month-slim vat-books-lines">
                <thead>
                  <tr>
                    <th className="col-claim">
                      <input
                        type="checkbox"
                        className="vat-claim-check"
                        checked={allClaimed}
                        ref={(el) => {
                          if (el) el.indeterminate = someClaimed;
                        }}
                        disabled={
                          locked || claimBusyId === "all" || linesBusy
                        }
                        title="ติ๊กรวมยอดทั้งหมด"
                        aria-label="ติ๊กรวมเข้าระบบทั้งหมด"
                        onChange={(e) =>
                          void toggleClaimAll(e.target.checked)
                        }
                      />
                    </th>
                    <th className="col-date">วันที่</th>
                    <th className="col-seg">บช.</th>
                    <th className="col-seg">รายการ</th>
                    <th className="col-num">จ่าย</th>
                    <th className="col-num">ภาษีซื้อ</th>
                    <th className="col-seg">ตรวจ</th>
                  </tr>
                </thead>
                <tbody>
                  {booksLines.map((line) => {
                    const rowKey = `${line.book}-${line.id}`;
                    return (
                      <tr
                        key={rowKey}
                        className={`vat-row-child vat-books-line-row${line.vatClaim ? " is-claimed" : ""}`}
                        onClick={() =>
                          setDetailLine({ book: line.book, id: line.id })
                        }
                      >
                        <td
                          className="col-claim"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            className="vat-claim-check"
                            checked={line.vatClaim}
                            disabled={
                              locked ||
                              claimBusyId === rowKey ||
                              claimBusyId === "all" ||
                              linesBusy
                            }
                            title="รวมเข้าระบบ"
                            aria-label={`รวมเข้าระบบ ${line.description}`}
                            onChange={(e) =>
                              void toggleLineClaim(line, e.target.checked)
                            }
                          />
                        </td>
                        <td className="col-date">{formatDateShort(line.date)}</td>
                        <td className="col-seg">{bookLabel(line.book)}</td>
                        <td
                          className="col-seg col-child"
                          title={`${line.description} — แตะเพื่อดูรายละเอียด`}
                        >
                          {line.description}
                        </td>
                        <td className="col-num">{fmt(line.amountOut)}</td>
                        <td className="col-num col-net">{fmt(line.vatInput)}</td>
                        <td className="col-seg">
                          {line.vatVerified ? (
                            <span className="vat-line-ok">ตรงบิล</span>
                          ) : (
                            <span className="muted">ยังไม่ติ๊ก</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="vat-sales-totals-row">
                    <td className="col-seg" colSpan={4}>
                      รวมที่ติ๊ก「รวมเข้าระบบ」
                    </td>
                    <td className="col-num">—</td>
                    <td className="col-num col-net">
                      {fmt(booksVatTotal)}
                    </td>
                    <td className="col-seg">—</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )
        ) : null}
      </div>

      {detailLine ? (
        <BooksVatEntryDetailModal
          book={detailLine.book}
          entryId={detailLine.id}
          locked={locked}
          onClose={() => setDetailLine(null)}
          onSaved={() => {
            setDetailLine(null);
            void refreshBooksVatLines();
          }}
        />
      ) : null}
    </section>
  );
}

/** VAT มาตรฐานบช. — ขาย − ซื้อ · คนละชั้นกับรายได้/คชจ. */
function NetVatStrip({
  delivery,
  storefront,
  totals,
}: {
  delivery: VatSegmentState;
  storefront: VatSegmentState;
  totals: {
    outputVat: number;
    inputVat: number;
    netVat: number;
  };
}) {
  return (
    <div className="vat-net-strip" role="status">
      <span className="vat-net-strip-item">
        ภาษีขาย <strong>{fmt(totals.outputVat)}</strong>
        <span className="muted">
          {" "}
          (ส่ง {fmt(delivery.outputVat)} · ร้าน {fmt(storefront.outputVat)})
        </span>
      </span>
      <span className="vat-net-strip-sep">−</span>
      <span className="vat-net-strip-item">
        ภาษีซื้อ <strong>{fmt(totals.inputVat)}</strong>
        <span className="muted">
          {" "}
          (GP {fmt(delivery.inputVat)} · บช. {fmt(storefront.inputVat)})
        </span>
      </span>
      <span className="vat-net-strip-sep">=</span>
      <span className="vat-net-strip-item vat-net-strip-item--net">
        VAT สุทธิ <strong>{fmt(totals.netVat)}</strong>
      </span>
    </div>
  );
}

/** ค่าใช้จ่ายดำเนินงาน (หักรายได้) — ไม่นับซื้อสินทรัพย์ */
function bookOpEx(row: MonthCategoryRow | null) {
  if (!row) return null;
  return row.cogs + row.sga + row.other;
}

function patchGpChannel(
  gpByChannel: GpByChannel,
  key: GpChannelKey,
  patch: Partial<GpByChannel[GpChannelKey]>,
  onChange: (next: GpByChannel) => void,
) {
  onChange({
    ...gpByChannel,
    [key]: { ...gpByChannel[key], ...patch },
  });
}

/** 1) รายได้ = ยอดโอนจริงถึงร้าน (≠ ยอดขาย) */
function IncomeTransferTable({
  month,
  locked,
  bridge,
  gpByChannel,
  pnlIncomeStr,
  onGpByChannelChange,
  onPnlIncomeChange,
  onUseBridgeIncome,
}: {
  month: string;
  locked: boolean;
  bridge: ReturnType<typeof buildIncomeBridge>;
  gpByChannel: GpByChannel;
  pnlIncomeStr: string;
  onGpByChannelChange: (next: GpByChannel) => void;
  onPnlIncomeChange: (v: string) => void;
  onUseBridgeIncome: () => void;
}) {
  function setNetTransfer(key: GpChannelKey, raw: string) {
    const net = parseVatMoneyInput(raw);
    const fee = gpByChannel[key].amount;
    const pct =
      fee + net > 0
        ? Math.min(100, Math.round((fee / (fee + net)) * 10000) / 100)
        : 0;
    patchGpChannel(
      gpByChannel,
      key,
      { mode: "transfer", netTransfer: net, pct },
      onGpByChannelChange,
    );
  }

  const deliveryRows = bridge.channelRows.filter((r) => r.key !== "storefront");
  const storefrontRow = bridge.channelRows.find((r) => r.key === "storefront");
  const parts = deliveryRows.map((r) => ({
    key: r.key,
    label:
      r.key === "shopee" ? "SF" : r.key === "grab" ? "GB" : r.key === "lineman" ? "LM" : r.label,
    amount: r.netTransfer,
  }));
  if (storefrontRow) {
    parts.push({
      key: "storefront",
      label: "หน้าร้าน",
      amount: storefrontRow.netTransfer,
    });
  }
  const partsText = parts
    .map((p) => `${p.label} ${formatVatMoney(p.amount)}`)
    .join(" + ");
  const incomeRaw = parseVatMoneyInput(pnlIncomeStr);
  const incomeDiffers =
    incomeRaw > 0 && Math.abs(incomeRaw - bridge.pnlIncome) > 0.009;

  function transferCell(key: GpChannelKey, row: (typeof bridge.channelRows)[number]) {
    const s = gpByChannel[key];
    const value =
      s.mode === "transfer" || s.mode === "amount"
        ? moneyFieldValue(s.netTransfer)
        : moneyFieldValue(row.netTransfer);
    return (
      <MoneyCell
        value={value}
        locked={locked}
        ariaLabel={`ยอดโอน ${row.label}`}
        onChange={(v) => setNetTransfer(key, v)}
      />
    );
  }

  return (
    <section className="vat-table-block vat-income-bridge">
      <h2 className="vat-table-title">
        1) รายได้ — ยอดโอน — {formatThaiMonthKey(month)}
      </h2>
      <div className="sheet-wrap vat-month-slim-wrap">
        <table className="sheet-table vat-sales-table vat-sales-table--slim vat-month-slim vat-close-table">
          <thead>
            <tr>
              <th className="col-seg">รายการ</th>
              <th
                className="col-num"
                title="เงินถึงร้าน — ซิงก์จากแท็บนำเข้า (คอลัมน์ยอดโอน) หรือแก้ตรงนี้"
              >
                ยอดโอน / ถึงร้าน
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="vat-row-parent">
              <td
                className="col-seg"
                title="ผลรวมยอดโอน SF + GB + LM (ไม่ใช่ยอดขาย)"
              >
                รายได้เดลิเวอรี่ (รวม)
              </td>
              <td className="col-num col-net">{fmt(bridge.deliveryGross)}</td>
            </tr>
            {deliveryRows.map((row) => (
              <tr key={row.key} className="vat-row-child">
                <td
                  className="col-seg col-child"
                  title={`ยอดโอน ${row.label} จากแท็บนำเข้า · ซิงก์อัตโนมัติ`}
                >
                  {row.label}
                </td>
                <td className="col-num col-input">
                  {transferCell(row.key, row)}
                </td>
              </tr>
            ))}
            {storefrontRow ? (
              <tr className="vat-row-parent">
                <td
                  className="col-seg"
                  title="ยอดถึงร้านหน้าร้าน — ใส่เอง (ไม่ผ่านนำเข้า SF/GB/LM)"
                >
                  รายได้หน้าร้าน
                </td>
                <td className="col-num col-input">
                  {transferCell("storefront", storefrontRow)}
                </td>
              </tr>
            ) : null}
            <tr className="vat-sales-totals-row">
              <td
                className="col-seg"
                title={`รายได้สุทธิ = ${partsText} = ${formatVatMoney(bridge.pnlIncome)} · ใช้เข้ากำไรขาดทุน`}
              >
                = รายได้สุทธิ
              </td>
              <td className="col-num col-input col-net">
                <MoneyCell
                  value={pnlIncomeStr}
                  locked={locked}
                  ariaLabel="รายได้สุทธิ"
                  onChange={onPnlIncomeChange}
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="muted vat-sales-hint vat-hint-one-line" title="ที่มาของยอดคำนวณ">
        ยอดคำนวณ = {partsText || "—"} = {formatVatMoney(bridge.pnlIncome)}
        {incomeDiffers ? " · ช่องรายได้สุทธิต่างจากผลรวม (กดปุ่มด้านล่างเพื่อใส่ยอดคำนวณ)" : ""}
      </p>
      {!locked ? (
        <div className="vat-month-actions vat-month-actions--mini">
          <button
            type="button"
            className="vat-mini-btn"
            title={`ใส่ผลรวมยอดโอนด้านบน (${formatVatMoney(bridge.pnlIncome)}) เข้าช่องรายได้สุทธิ — ใช้เมื่อแก้ช่องรายได้แล้วอยากกลับยอดคำนวณ`}
            onClick={onUseBridgeIncome}
          >
            ใช้ยอดคำนวณ ({formatVatMoney(bridge.pnlIncome)})
          </button>
        </div>
      ) : null}
    </section>
  );
}

/** 2) คชจ. — GP + บช. (ไม่รวมสินทรัพย์) */
function CostsTable({
  month,
  locked,
  bridge,
  gpByChannel,
  staff,
  owner,
  booksPulled,
  booksBusy,
  booksPulledAt,
  onGpByChannelChange,
  onPullBooks,
}: {
  month: string;
  locked: boolean;
  bridge: ReturnType<typeof buildIncomeBridge>;
  gpByChannel: GpByChannel;
  staff: MonthCategoryRow | null;
  owner: MonthCategoryRow | null;
  booksPulled: boolean;
  booksBusy: boolean;
  booksPulledAt: number;
  onGpByChannelChange: (next: GpByChannel) => void;
  onPullBooks: () => void;
}) {
  function setFee(key: GpChannelKey, raw: string) {
    const fee = parseVatMoneyInput(raw);
    const net = gpByChannel[key].netTransfer;
    const pct =
      fee + net > 0
        ? Math.min(100, Math.round((fee / (fee + net)) * 10000) / 100)
        : 0;
    patchGpChannel(
      gpByChannel,
      key,
      { mode: "transfer", amount: fee, pct },
      onGpByChannelChange,
    );
  }

  const deliveryRows = bridge.channelRows.filter((r) => r.key !== "storefront");
  const deliveryFee = deliveryRows.reduce((s, r) => s + r.deduct, 0);
  const staffOp = bookOpEx(staff) || 0;
  const ownerOp = bookOpEx(owner) || 0;
  const booksOp = staffOp + ownerOp;
  const assetTotal = (staff?.asset || 0) + (owner?.asset || 0);
  const costNet = deliveryFee + (booksPulled ? booksOp : 0);
  const gpRateNote =
    bridge.weightedAvgPct > 0
      ? `เรท GP เฉลี่ยเดลิเวอรี่ ≈ ${formatVatPct(bridge.weightedAvgPct)}% (= คชจ.÷(คชจ.+ยอดโอนจริง))`
      : "เรท GP ≈ คชจ.÷(คชจ.+ยอดโอนจริง)";

  return (
    <section className="vat-table-block">
      <h2 className="vat-table-title">
        2) คชจ. — {formatThaiMonthKey(month)}
      </h2>
      <div className="sheet-wrap vat-month-slim-wrap">
        <table className="sheet-table vat-sales-table vat-sales-table--slim vat-month-slim vat-close-table">
          <thead>
            <tr>
              <th className="col-seg">รายการ</th>
              <th className="col-num">ยอด</th>
            </tr>
          </thead>
          <tbody>
            <tr className="vat-row-parent">
              <td className="col-seg">คชจ. GP เดลิเวอรี่ (รวม)</td>
              <td className="col-num col-net">{fmt(deliveryFee)}</td>
            </tr>
            {deliveryRows.map((row) => {
              const s = gpByChannel[row.key];
              const feeDisplay = moneyFieldValue(
                s.mode === "transfer" || s.mode === "amount"
                  ? s.amount
                  : row.deduct,
              );
              return (
                <tr key={row.key} className="vat-row-child">
                  <td className="col-seg col-child">{row.label}</td>
                  <td className="col-num col-input">
                    <MoneyCell
                      value={feeDisplay}
                      locked={locked}
                      ariaLabel={`คชจ. GP ${row.label}`}
                      onChange={(v) => setFee(row.key, v)}
                    />
                  </td>
                </tr>
              );
            })}
            <tr className="vat-row-parent">
              <td className="col-seg">
                บช. สองสมุด (COGS+SGA+อื่น)
                {!locked ? (
                  <>
                    {" "}
                    <button
                      type="button"
                      className="vat-mini-btn"
                      disabled={booksBusy}
                      onClick={onPullBooks}
                    >
                      {booksBusy ? "…" : "ดึง"}
                    </button>
                  </>
                ) : null}
                {booksPulledAt ? (
                  <span className="muted">
                    {" "}
                    {formatDateTimeShort(booksPulledAt)}
                  </span>
                ) : null}
              </td>
              <td className="col-num col-net">
                {booksPulled ? fmt(booksOp) : "—"}
              </td>
            </tr>
            <tr className="vat-row-child">
              <td className="col-seg col-child">บช. พนักงาน</td>
              <td className="col-num">{booksPulled ? fmt(staffOp) : "—"}</td>
            </tr>
            <tr className="vat-row-child">
              <td className="col-seg col-child">บช. เจ้าของ</td>
              <td className="col-num">{booksPulled ? fmt(ownerOp) : "—"}</td>
            </tr>
            <tr>
              <td className="col-seg">ซื้อสินทรัพย์ (ไม่หักคชจ.)</td>
              <td className="col-num">{booksPulled ? fmt(assetTotal) : "—"}</td>
            </tr>
            <tr className="vat-sales-totals-row">
              <td className="col-seg">= คชจ. สุทธิ</td>
              <td className="col-num col-net">{fmt(costNet)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="muted vat-sales-hint vat-hint-one-line">{gpRateNote}</p>
    </section>
  );
}

function PersonalTaxBlock({
  month,
  income,
  gpCost,
  netVat,
  staff,
  owner,
  booksPulled,
  locked,
  allowanceStr,
  otherDeductStr,
  taxNote,
  yearBusy,
  yearProfit,
  yearTax,
  onAllowanceChange,
  onOtherDeductChange,
  onTaxNoteChange,
  onSaveTaxSettings,
  onPullYear,
  onExportYear,
}: {
  month: string;
  income: number;
  gpCost: number;
  netVat: number;
  staff: MonthCategoryRow | null;
  owner: MonthCategoryRow | null;
  booksPulled: boolean;
  locked: boolean;
  allowanceStr: string;
  otherDeductStr: string;
  taxNote: string;
  yearBusy: boolean;
  yearProfit: number | null;
  yearTax: ReturnType<typeof computePersonalIncomeTax> | null;
  onAllowanceChange: (v: string) => void;
  onOtherDeductChange: (v: string) => void;
  onTaxNoteChange: (v: string) => void;
  onSaveTaxSettings: () => void;
  onPullYear: () => void;
  onExportYear: () => void;
}) {
  const staffOp = bookOpEx(staff);
  const ownerOp = bookOpEx(owner);
  const booksOp =
    booksPulled && staffOp != null && ownerOp != null
      ? staffOp + ownerOp
      : null;
  const costNet = gpCost + (booksOp ?? 0);
  const monthProfit =
    booksOp != null ? income - gpCost - booksOp : income - gpCost;
  const yearBe = Number(month.slice(0, 4)) + 543;

  return (
    <section className="vat-table-block vat-personal-pnl">
      <h2 className="vat-table-title">
        3) กำไรขาดทุนง่าย — {formatThaiMonthKey(month)}
      </h2>
      <div className="sheet-wrap vat-month-slim-wrap">
        <table className="sheet-table vat-sales-table vat-sales-table--slim vat-month-slim vat-close-table">
          <thead>
            <tr>
              <th className="col-seg">รายการเดือน</th>
              <th className="col-num">ยอด</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="col-seg">รายได้สุทธิ (ยอดโอน)</td>
              <td className="col-num">{fmt(income)}</td>
            </tr>
            <tr>
              <td className="col-seg">− คชจ. สุทธิ</td>
              <td className="col-num">{fmt(costNet)}</td>
            </tr>
            <tr className="vat-row-child">
              <td className="col-seg col-child">คชจ. GP</td>
              <td className="col-num">{fmt(gpCost)}</td>
            </tr>
            <tr className="vat-row-child">
              <td className="col-seg col-child">บช. สองสมุด</td>
              <td className="col-num">{booksOp == null ? "—" : fmt(booksOp)}</td>
            </tr>
            <tr className="vat-sales-totals-row">
              <td className="col-seg">= กำไรประมาณการเดือน</td>
              <td className="col-num col-net">{fmt(monthProfit)}</td>
            </tr>
            <tr>
              <td className="col-seg">VAT สุทธิ (แยก · ไม่หักกำไร)</td>
              <td className="col-num">{fmt(netVat)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 className="vat-table-title" style={{ marginTop: "0.55rem" }}>
        ค่าลดหย่อน + ภาษีเงินได้ (ภ.ง.ด.) · ปี {yearBe}
      </h2>
      <div className="sheet-wrap vat-month-slim-wrap">
        <table className="sheet-table vat-sales-table vat-sales-table--slim vat-month-slim vat-close-table">
          <thead>
            <tr>
              <th className="col-seg">รายการ</th>
              <th className="col-num">ค่า</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="col-seg">ค่าลดหย่อนผู้มีเงินได้</td>
              <td className="col-num col-input">
                <MoneyCell
                  value={allowanceStr}
                  locked={locked}
                  ariaLabel="ค่าลดหย่อนผู้มีเงินได้"
                  onChange={onAllowanceChange}
                />
              </td>
            </tr>
            <tr>
              <td className="col-seg">ค่าลดหย่อน / รายการอื่น (แก้เอง)</td>
              <td className="col-num col-input">
                <MoneyCell
                  value={otherDeductStr}
                  locked={locked}
                  ariaLabel="ค่าลดหย่อนอื่น"
                  onChange={onOtherDeductChange}
                />
              </td>
            </tr>
            <tr>
              <td className="col-seg">โน้ตภาษี</td>
              <td className="col-num col-input">
                <input
                  className="vat-sales-input"
                  disabled={locked}
                  value={taxNote}
                  placeholder="เช่น คู่สมรส / บุตร…"
                  aria-label="โน้ตภาษี"
                  onChange={(e) => onTaxNoteChange(e.target.value)}
                  style={{ textAlign: "left", minWidth: "8rem" }}
                />
              </td>
            </tr>
            <tr>
              <td className="col-seg">กำไรปี (หลังดึงสรุปปี)</td>
              <td className="col-num">
                {yearProfit == null ? "—" : fmt(yearProfit)}
              </td>
            </tr>
            <tr>
              <td className="col-seg">เงินได้สุทธิ (หลังลดหย่อน)</td>
              <td className="col-num">
                {yearTax ? fmt(yearTax.taxable) : "—"}
              </td>
            </tr>
            <tr className="vat-sales-totals-row">
              <td className="col-seg">ภาษีเงินได้ประมาณ</td>
              <td className="col-num col-net">
                {yearTax ? fmt(yearTax.tax) : "—"}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="vat-month-actions vat-month-actions--mini">
        {!locked ? (
          <button
            type="button"
            className="vat-mini-btn"
            onClick={onSaveTaxSettings}
          >
            บันทึกค่าลดหย่อน
          </button>
        ) : null}
        <button
          type="button"
          className="vat-mini-btn"
          disabled={yearBusy}
          onClick={onPullYear}
        >
          {yearBusy ? "กำลังดึงปี…" : `ดึงสรุปปี ${yearBe}`}
        </button>
        <button
          type="button"
          className="vat-mini-btn"
          disabled={!yearTax}
          onClick={onExportYear}
        >
          ส่งออกยื่น ภ.ง.ด.
        </button>
      </div>

      <h2 className="vat-table-title" style={{ marginTop: "0.45rem" }}>
        ขั้นบันไดภาษีเงินได้
      </h2>
      <div className="sheet-wrap vat-month-slim-wrap">
        <table className="sheet-table vat-sales-table vat-sales-table--slim vat-month-slim vat-close-table">
          <thead>
            <tr>
              <th className="col-seg">ช่วงเงินได้สุทธิ</th>
              <th className="col-pct">อัตรา</th>
              <th className="col-num">ยอดในชั้น</th>
              <th className="col-num">ภาษีชั้น</th>
            </tr>
          </thead>
          <tbody>
            {(yearTax?.slices?.length
              ? yearTax.slices
              : THAI_PIT_BRACKETS.map((b) => ({
                  label: b.label,
                  rate: b.rate,
                  bandAmount: 0,
                  tax: 0,
                }))
            ).map((s) => (
              <tr key={s.label}>
                <td className="col-seg">{s.label}</td>
                <td className="col-pct">{formatVatPct(s.rate * 100)}</td>
                <td className="col-num">
                  {yearTax ? fmt(s.bandAmount) : "—"}
                </td>
                <td className="col-num">{yearTax ? fmt(s.tax) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function VatMonthlyWorkbench({ actor }: Props) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    const y = d.toLocaleString("en-CA", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
    });
    const m = d.toLocaleString("en-CA", {
      timeZone: "Asia/Bangkok",
      month: "2-digit",
    });
    return `${y}-${m}`;
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [doc, setDoc] = useState<VatMonthlyReturn | null>(null);
  const [periodStartDay, setPeriodStartDay] = useState(DEFAULT_PERIOD_START_DAY);
  const [deliveryDraft, setDeliveryDraft] = useState<DraftSeg>(() =>
    segToDraft(emptySegment("delivery")),
  );
  const [storefrontDraft, setStorefrontDraft] = useState<DraftSeg>(() =>
    segToDraft(emptySegment("storefront")),
  );
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  /** ระบบเดียว: ยอดโอนจริงถึงร้าน (incVat) — ไม่สลับโหมดก่อน VAT */
  const pnlMode = "incVat" as const;
  const [pnlIncome, setPnlIncome] = useState("");
  const [openDelivery, setOpenDelivery] = useState(false);
  const [openStorefront, setOpenStorefront] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const savedSnapRef = useRef("");
  const hydratedRef = useRef(false);
  const dirtyRef = useRef(false);
  const deliveryDraftRef = useRef(deliveryDraft);
  const storefrontDraftRef = useRef(storefrontDraft);
  const noteRef = useRef(note);
  const pnlModeRef = useRef<"incVat">("incVat");
  const pnlIncomeRef = useRef(pnlIncome);
  const cloudSaveGen = useRef(0);
  const [bookStaff, setBookStaff] = useState<MonthCategoryRow | null>(null);
  const [bookOwner, setBookOwner] = useState<MonthCategoryRow | null>(null);
  const [booksBusy, setBooksBusy] = useState(false);
  const [booksPulledAt, setBooksPulledAt] = useState(0);
  const [gpByChannel, setGpByChannel] = useState<GpByChannel>(() =>
    defaultGpByChannel(),
  );
  const gpByChannelRef = useRef(gpByChannel);
  const [allowanceStr, setAllowanceStr] = useState(
    String(DEFAULT_PERSONAL_ALLOWANCE),
  );
  const [otherDeductStr, setOtherDeductStr] = useState("");
  const [taxNote, setTaxNote] = useState("");
  const [yearBusy, setYearBusy] = useState(false);
  const [yearProfit, setYearProfit] = useState<number | null>(null);
  const [yearTax, setYearTax] = useState<ReturnType<
    typeof computePersonalIncomeTax
  > | null>(null);
  const [yearMonths, setYearMonths] = useState<
    { month: string; income: number; opex: number; profit: number }[]
  >([]);
  const [importFillPct, setImportFillPct] = useState<{
    overall: number;
    shopee: number;
    grab: number;
    lineman: number;
    days: number;
  } | null>(null);

  deliveryDraftRef.current = deliveryDraft;
  storefrontDraftRef.current = storefrontDraft;
  noteRef.current = note;
  pnlModeRef.current = pnlMode;
  pnlIncomeRef.current = pnlIncome;
  gpByChannelRef.current = gpByChannel;
  dirtyRef.current = dirty;

  const snapshotDraft = useCallback(
    (
      d: DraftSeg,
      s: DraftSeg,
      n: string,
      mode: "exVat" | "incVat",
      income: string,
      gpMap: GpByChannel = defaultGpByChannel(),
    ) =>
      JSON.stringify({
        delivery: d,
        storefront: s,
        note: n,
        pnlMode: mode,
        pnlIncome: income,
        gpByChannel: gpMap,
      }),
    [],
  );

  const markDirty = useCallback(() => setDirty(true), []);

  const setDeliveryDraftTracked = useCallback(
    (next: DraftSeg | ((prev: DraftSeg) => DraftSeg)) => {
      setDeliveryDraft(next);
      markDirty();
    },
    [markDirty],
  );
  const setStorefrontDraftTracked = useCallback(
    (next: DraftSeg | ((prev: DraftSeg) => DraftSeg)) => {
      setStorefrontDraft(next);
      markDirty();
    },
    [markDirty],
  );

  const refresh = useCallback(async () => {
    // soft load: หลัง hydrate แล้วไม่เคลียร์ตาราง (ตัวเลขไม่หายตอนอัปเดต)
    if (!hydratedRef.current) setLoading(true);
    setError("");
    try {
      const [ret, st, taxSt, importRows] = await Promise.all([
        loadVatMonthlyReturn(month),
        loadVatMonthlySettings(),
        loadPersonalTaxSettings(),
        listVatImportRows(month).catch(() => []),
      ]);
      const fill = computeImportFillStats(month, importRows);
      setImportFillPct({
        overall: fill.overallPct,
        shopee: fill.byChannel.shopee.pct,
        grab: fill.byChannel.grab.pct,
        lineman: fill.byChannel.lineman.pct,
        days: fill.daysInMonth,
      });

      let d = segToDraft(ret.delivery);
      let s = segToDraft(ret.storefront);
      let n = ret.note;
      const mode = "incVat" as const;
      let income = moneyInputValue(ret.pnlIncome);
      // เดือนนี้ → ตั้งค่าร้าน (จำข้ามเดือน) — ไม่เติมจากประมาณก้อน VAT
      let nextGp = mapGpByChannel(
        ret.pnlGpByChannel || st.pnlGpByChannel,
        {
          mode: ret.pnlDeliveryGpMode || "transfer",
          pct: ret.pnlDeliveryGpPct > 0 ? ret.pnlDeliveryGpPct : 0,
          amount: ret.pnlDeliveryGpDeduct > 0 ? ret.pnlDeliveryGpDeduct : 0,
        },
      );

      const importOwned =
        ret.delivery.channels.shopee > 0 ||
        ret.delivery.channels.grab > 0 ||
        ret.delivery.channels.lineman > 0 ||
        ret.delivery.gpVat > 0 ||
        recentVatImportMergeAt(month) > 0;

      // ร่างในเครื่อง — รวมแบบไม่ให้ค่าว่างทับตัวเลข
      if (ret.status !== "filed") {
        const cached = readLocalDraft(month) as {
          delivery?: DraftSeg;
          storefront?: DraftSeg;
          note?: string;
          pnlMode?: "exVat" | "incVat";
          pnlIncome?: string;
          gpByChannel?: GpByChannel;
        } | null;
        if (cached?.delivery) d = mergePreferMoney(d, cached.delivery);
        if (cached?.storefront) s = mergePreferMoney(s, cached.storefront);
        if (typeof cached?.note === "string" && cached.note.trim()) n = cached.note;
        if (typeof cached?.pnlIncome === "string" && cached.pnlIncome.trim()) {
          income = cached.pnlIncome;
        }
        if (cached?.gpByChannel && !importOwned) {
          nextGp = mapGpByChannel(cached.gpByChannel);
        }
      }

      // ฟิลด์จากนำเข้า (ขายเดลิเวอรี่ / GP / ภาษีซื้อ GP) — เซิร์ฟเวอร์ชนะ
      if (importOwned && ret.status !== "filed") {
        const ch = ret.delivery.channels;
        d = {
          ...d,
          channels: {
            shopee:
              ch.shopee > 0 ? moneyInputValue(ch.shopee) : d.channels.shopee,
            grab: ch.grab > 0 ? moneyInputValue(ch.grab) : d.channels.grab,
            lineman:
              ch.lineman > 0 ? moneyInputValue(ch.lineman) : d.channels.lineman,
          },
          gpVat: moneyInputValue(ret.delivery.gpVat),
          useGpEstimate: false,
        };
        nextGp = mapGpByChannel(
          ret.pnlGpByChannel || st.pnlGpByChannel,
          {
            mode: ret.pnlDeliveryGpMode || "transfer",
            pct: ret.pnlDeliveryGpPct > 0 ? ret.pnlDeliveryGpPct : 0,
            amount: ret.pnlDeliveryGpDeduct > 0 ? ret.pnlDeliveryGpDeduct : 0,
          },
        );
      }

      // ถ้ากำลังแก้ค้างอยู่ ห้ามรีเฟรชทับด้วยค่าว่างจากเซิร์ฟเวอร์
      // (ยกเว้นฟิลด์นำเข้าที่เพิ่งผสาน — คงค่า importOwned ด้านบน)
      if (hydratedRef.current && dirtyRef.current) {
        const recentImport =
          Date.now() - recentVatImportMergeAt(month) < 5 * 60 * 1000;
        if (!recentImport) {
          d = mergePreferMoney(d, deliveryDraftRef.current);
          nextGp = gpByChannelRef.current;
        } else {
          // คง ingredient / rates / tenders จากร่างที่แก้ค้าง
          d = {
            ...d,
            ingredientVat: pickMoneyStr(
              d.ingredientVat,
              deliveryDraftRef.current.ingredientVat,
            ),
            rates: mapVatLogicRates(
              deliveryDraftRef.current.rates || d.rates,
            ),
            remitPct:
              deliveryDraftRef.current.remitPct || d.remitPct,
          };
        }
        s = mergePreferMoney(s, storefrontDraftRef.current);
        if (noteRef.current.trim()) n = noteRef.current;
        if (pnlIncomeRef.current.trim()) income = pnlIncomeRef.current;
      }

      setDoc(ret);
      setPeriodStartDay(st.periodStartDay);
      setDeliveryDraft(d);
      setStorefrontDraft({ ...s, remitPct: "100" });
      setNote(n);
      setNoteOpen(Boolean(n.trim()));
      setPnlIncome(income);
      setGpByChannel(nextGp);
      setAllowanceStr(String(taxSt.personalAllowance || DEFAULT_PERSONAL_ALLOWANCE));
      setOtherDeductStr(moneyInputValue(taxSt.otherDeductions));
      setTaxNote(taxSt.note);
      if (
        ret.delivery.partsSum > 0 ||
        parseMoneyInput(d.channels.shopee) +
          parseMoneyInput(d.channels.grab) +
          parseMoneyInput(d.channels.lineman) >
          0
      ) {
        setOpenDelivery(true);
      }
      if (
        ret.storefront.partsSum > 0 ||
        parseMoneyInput(s.tenders.transfer) + parseMoneyInput(s.tenders.cash) > 0
      ) {
        setOpenStorefront(true);
      }
      const savedSnap = snapshotDraft(
        segToDraft(ret.delivery),
        segToDraft(ret.storefront),
        ret.note,
        "incVat",
        moneyInputValue(ret.pnlIncome),
        mapGpByChannel(ret.pnlGpByChannel || st.pnlGpByChannel, {
          mode: ret.pnlDeliveryGpMode || "transfer",
          pct: ret.pnlDeliveryGpPct > 0 ? ret.pnlDeliveryGpPct : 0,
          amount: ret.pnlDeliveryGpDeduct > 0 ? ret.pnlDeliveryGpDeduct : 0,
        }),
      );
      const localSnap = snapshotDraft(d, s, n, mode, income, nextGp);
      savedSnapRef.current = savedSnap;
      setDirty(localSnap !== savedSnap);
      // เก็บร่างในเครื่องหลัง hydrate (สำรองแม้เซิร์ฟเวอร์ว่าง)
      writeLocalDraft(month, localSnap);
      hydratedRef.current = true;
      setHydrated(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      // โหลดพลาด: กู้จาก local ถ้ามี — ห้ามเขียนทับ local ด้วยค่าว่าง
      const cached = readLocalDraft(month);
      if (cached?.delivery || cached?.storefront) {
        if (cached.delivery) setDeliveryDraft(cached.delivery);
        if (cached.storefront) setStorefrontDraft(cached.storefront);
        if (typeof cached.note === "string") setNote(cached.note);
        if (typeof cached.pnlIncome === "string") setPnlIncome(cached.pnlIncome);
        setDirty(true);
        hydratedRef.current = true;
        setHydrated(true);
      }
    } finally {
      setLoading(false);
    }
  }, [month, snapshotDraft]);

  useEffect(() => {
    hydratedRef.current = false;
    setHydrated(false);
    void refresh();
  }, [refresh]);

  // ผสานจากแท็บนำเข้า → อัปเดต GP ช่องทาง + ภาษีซื้อ GP แบบเรียลไทม์
  useEffect(() => {
    return subscribeVatImportMonthMerged((detail) => {
      if (detail.monthKey !== month) return;
      const ret = detail.saved;
      if (ret.status === "filed") return;
      const ch = ret.delivery.channels;
      const nextGp = mapGpByChannel(ret.pnlGpByChannel);
      setDoc(ret);
      setDeliveryDraft((prev) => ({
        ...prev,
        channels: {
          shopee:
            ch.shopee > 0 ? moneyInputValue(ch.shopee) : prev.channels.shopee,
          grab: ch.grab > 0 ? moneyInputValue(ch.grab) : prev.channels.grab,
          lineman:
            ch.lineman > 0
              ? moneyInputValue(ch.lineman)
              : prev.channels.lineman,
        },
        gpVat: moneyInputValue(ret.delivery.gpVat),
        useGpEstimate: false,
      }));
      setGpByChannel(nextGp);
      setOpenDelivery(true);
      const dSeg = recomputeSegment({
        ...ret.delivery,
        kind: "delivery",
      });
      const sSeg = draftToSeg("storefront", storefrontDraftRef.current);
      const bridge = buildIncomeBridge({
        deliveryVatBase: dSeg.vatBase,
        deliveryGrossSales: dSeg.grossSales,
        storefrontVatBase: sSeg.vatBase,
        storefrontGrossSales: sSeg.grossSales,
        mode: "incVat",
        deliveryChannels: ret.delivery.channels,
        outputPct: dSeg.rates.outputPct,
        gpByChannel: nextGp,
      });
      setPnlIncome(moneyInputValue(bridge.pnlIncome));
      setMsg(
        `ซิงก์จากนำเข้า · ยอดโอนตาราง 1 + รายได้สุทธิ ${formatVatMoney(bridge.pnlIncome)}`,
      );
      void listVatImportRows(month)
        .then((importRows) => {
          const fill = computeImportFillStats(month, importRows);
          setImportFillPct({
            overall: fill.overallPct,
            shopee: fill.byChannel.shopee.pct,
            grab: fill.byChannel.grab.pct,
            lineman: fill.byChannel.lineman.pct,
            days: fill.daysInMonth,
          });
        })
        .catch(() => undefined);
    });
  }, [month]);

  const delivery = useMemo(
    () => draftToSeg("delivery", deliveryDraft),
    [deliveryDraft],
  );
  const storefront = useMemo(
    () => draftToSeg("storefront", storefrontDraft),
    [storefrontDraft],
  );
  const totals = useMemo(
    () =>
      sumMonthlyTotals(
        delivery,
        storefront,
        delivery.grossSales,
        storefront.grossSales,
      ),
    [delivery, storefront],
  );

  const incomeBridge = useMemo(
    () =>
      buildIncomeBridge({
        deliveryVatBase: delivery.vatBase,
        deliveryGrossSales: delivery.grossSales,
        storefrontVatBase: storefront.vatBase,
        storefrontGrossSales: storefront.grossSales,
        mode: "incVat",
        deliveryChannels: delivery.channels,
        outputPct: delivery.rates.outputPct,
        gpByChannel,
      }),
    [
      delivery.vatBase,
      delivery.grossSales,
      delivery.channels,
      delivery.rates.outputPct,
      storefront.vatBase,
      storefront.grossSales,
      gpByChannel,
    ],
  );
  const effectiveGpDeduct = incomeBridge.gpDeduct;
  const effectiveGpPct = incomeBridge.gpDeductPct;
  const gpDeductMode = incomeBridge.gpDeductMode;

  const locked = doc?.status === "filed";
  const period = useMemo(
    () => getVatPeriodBoundary(month, periodStartDay),
    [month, periodStartDay],
  );

  // Σ ภาษีซื้อ GP ช่องทาง → ภาษีซื้อเดลิเวอรี่ (ปิดประมาณก้อน)
  useEffect(() => {
    if (!hydrated || loading || locked) return;
    const nextStr = moneyInputValue(incomeBridge.deliveryGpVat);
    setDeliveryDraft((prev) => {
      if (!prev.useGpEstimate && prev.gpVat === nextStr) return prev;
      return { ...prev, gpVat: nextStr, useGpEstimate: false };
    });
  }, [incomeBridge.deliveryGpVat, hydrated, loading, locked]);

  const applyGpByChannel = useCallback(
    (nextMap: GpByChannel) => {
      setGpByChannel(nextMap);
      const next = buildIncomeBridge({
        deliveryVatBase: delivery.vatBase,
        deliveryGrossSales: delivery.grossSales,
        storefrontVatBase: storefront.vatBase,
        storefrontGrossSales: storefront.grossSales,
        mode: "incVat",
        deliveryChannels: delivery.channels,
        outputPct: delivery.rates.outputPct,
        gpByChannel: nextMap,
      });
      setPnlIncome(moneyInputValue(next.pnlIncome));
      markDirty();
    },
    [
      delivery.vatBase,
      delivery.grossSales,
      delivery.channels,
      delivery.rates.outputPct,
      storefront.vatBase,
      storefront.grossSales,
      markDirty,
    ],
  );

  // จำอัตโนมัติในเครื่อง — หลัง hydrate เท่านั้น และไม่ทับร่างที่มีตัวเลขด้วยค่าว่าง
  useEffect(() => {
    if (!hydrated || loading || locked) return;
    const payload = snapshotDraft(
      deliveryDraft,
      storefrontDraft,
      note,
      pnlMode,
      pnlIncome,
      gpByChannel,
    );
    writeLocalDraft(month, payload);
    setDirty(payload !== savedSnapRef.current);
  }, [
    deliveryDraft,
    storefrontDraft,
    note,
    pnlMode,
    pnlIncome,
    gpByChannel,
    month,
    loading,
    locked,
    hydrated,
    snapshotDraft,
  ]);

  // อัตโนมัติเซฟร่างขึ้น Firestore เบาๆ — กันตัวเลขหายตอนรีโหลด/อัปเดต
  useEffect(() => {
    if (!hydrated || loading || locked || !dirty) return;
    const score =
      draftMoneyScore(deliveryDraft) + draftMoneyScore(storefrontDraft);
    if (score <= 0 && !note.trim()) return;
    const gen = ++cloudSaveGen.current;
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const del = draftToSeg("delivery", deliveryDraftRef.current);
          const sf = draftToSeg("storefront", storefrontDraftRef.current);
          const mode = pnlModeRef.current;
          const incomeRaw = parseMoneyInput(pnlIncomeRef.current);
          const gpMap = gpByChannelRef.current;
          const bridge = buildIncomeBridge({
            deliveryVatBase: del.vatBase,
            deliveryGrossSales: del.grossSales,
            storefrontVatBase: sf.vatBase,
            storefrontGrossSales: sf.grossSales,
            mode,
            deliveryChannels: del.channels,
            outputPct: del.rates.outputPct,
            gpByChannel: gpMap,
          });
          const saved = await saveVatMonthlyReturn(
            {
              monthKey: month,
              delivery: del,
              storefront: sf,
              note: noteRef.current,
              pnlIncomeMode: mode,
              pnlIncome: incomeRaw > 0 ? incomeRaw : bridge.pnlIncome,
              pnlDeliveryGpDeduct: bridge.gpDeduct,
              pnlDeliveryGpMode: bridge.gpDeductMode,
              pnlDeliveryGpPct: bridge.gpDeductPct,
              pnlGpByChannel: gpMap,
              status: "draft",
            },
            actor,
          );
          // จำเรทรายช่องทางไว้ใช้เดือนถัดไป
          void saveVatMonthlySettings({ pnlGpByChannel: gpMap }, actor).catch(
            () => undefined,
          );
          if (gen !== cloudSaveGen.current) return;
          setDoc(saved);
          const snap = snapshotDraft(
            segToDraft(saved.delivery),
            segToDraft(saved.storefront),
            saved.note,
            saved.pnlIncomeMode,
            moneyInputValue(saved.pnlIncome),
            saved.pnlGpByChannel,
          );
          savedSnapRef.current = snap;
          writeLocalDraft(month, snap);
          // ถ้าผู้ใช้พิมพ์ต่อระหว่างเซฟ — คง dirty ไว้
          const now = snapshotDraft(
            deliveryDraftRef.current,
            storefrontDraftRef.current,
            noteRef.current,
            pnlModeRef.current,
            pnlIncomeRef.current,
            gpByChannelRef.current,
          );
          setDirty(now !== snap);
        } catch {
          /* เงียบ — ผู้ใช้ยังมี local + ปุ่มบันทึก */
        }
      })();
    }, 1800);
    return () => window.clearTimeout(t);
  }, [
    deliveryDraft,
    storefrontDraft,
    note,
    pnlMode,
    pnlIncome,
    gpByChannel,
    month,
    actor,
    hydrated,
    loading,
    locked,
    dirty,
    snapshotDraft,
  ]);

  // ถามตอนออกแท็บ/ปิดหน้า ถ้ายังไม่เซฟ
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirty || locked) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, locked]);

  const confirmLeaveIfDirty = useCallback(() => {
    if (!dirty || locked) return true;
    return window.confirm(
      "ยังไม่ได้บันทึกการเปลี่ยนแปลง — ต้องการออกโดยไม่บันทึกหรือไม่?\n\nกด OK = ออกโดยไม่เซฟ · Cancel = อยู่ต่อ",
    );
  }, [dirty, locked]);

  const changeMonth = (next: string) => {
    if (next === month) return;
    if (!confirmLeaveIfDirty()) return;
    setBookStaff(null);
    setBookOwner(null);
    setBooksPulledAt(0);
    setMonth(next);
  };

  const saveMonth = async (asDraft: boolean) => {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const proposed = incomeBridge.pnlIncome;
      const incomeRaw = parseMoneyInput(pnlIncome);
      const saved = await saveVatMonthlyReturn(
        {
          monthKey: month,
          delivery,
          storefront,
          note,
          pnlIncomeMode: pnlMode,
          pnlIncome: incomeRaw > 0 ? incomeRaw : proposed,
          pnlDeliveryGpDeduct: effectiveGpDeduct,
          pnlDeliveryGpMode: gpDeductMode,
          pnlDeliveryGpPct: effectiveGpPct,
          pnlGpByChannel: gpByChannel,
          status: asDraft ? "draft" : "saved",
        },
        actor,
      );
      void saveVatMonthlySettings({ pnlGpByChannel: gpByChannel }, actor).catch(
        () => undefined,
      );
      setDoc(saved);
      setPnlIncome(moneyInputValue(saved.pnlIncome));
      setGpByChannel(saved.pnlGpByChannel);
      const snap = snapshotDraft(
        segToDraft(saved.delivery),
        segToDraft(saved.storefront),
        saved.note,
        saved.pnlIncomeMode,
        moneyInputValue(saved.pnlIncome),
        saved.pnlGpByChannel,
      );
      savedSnapRef.current = snap;
      setDirty(false);
      // คงสำรองในเครื่อง — ห้ามลบ (กันตัวเลขหายตอนอัปเดต)
      writeLocalDraft(month, snap);
      setMsg(asDraft ? "บันทึกร่างแล้ว" : "บันทึกยอดเดือนแล้ว");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const closeMonth = async () => {
    if (dirty) {
      const okSave = window.confirm(
        "มีการแก้ที่ยังไม่บันทึก — บันทึกแล้วปิดงบเลยหรือไม่?\n\nOK = บันทึกและปิดงบ · Cancel = ยกเลิก",
      );
      if (!okSave) return;
    }
    const income = parseMoneyInput(pnlIncome);
    const finalIncome = income > 0 ? income : incomeBridge.pnlIncome;
    const ok = window.confirm(
      `ปิดงบ ${formatThaiMonthKey(month)} → รายได้ P&L = ${formatVatMoney(finalIncome)} บาท?\n` +
        `(หัก GP เดลิเวอรี่ ${formatVatMoney(effectiveGpDeduct)}) · VAT สุทธิ ${formatVatMoney(totals.netVat)} · หลังปิดล็อกแก้ยอด`,
    );
    if (!ok) return;
    setBusy(true);
    setError("");
    setMsg("");
    try {
      await saveVatMonthlyReturn(
        {
          monthKey: month,
          delivery,
          storefront,
          note,
          pnlIncomeMode: pnlMode,
          pnlIncome: finalIncome,
          pnlDeliveryGpDeduct: effectiveGpDeduct,
          pnlDeliveryGpMode: gpDeductMode,
          pnlDeliveryGpPct: effectiveGpPct,
          pnlGpByChannel: gpByChannel,
          status: "saved",
        },
        actor,
      );
      void saveVatMonthlySettings({ pnlGpByChannel: gpByChannel }, actor).catch(
        () => undefined,
      );
      const filed = await fileVatMonthlyReturn(month, actor, {
        forceIncome: finalIncome,
      });
      setDoc(filed);
      setGpByChannel(filed.pnlGpByChannel);
      setDirty(false);
      writeLocalDraft(
        month,
        snapshotDraft(
          segToDraft(filed.delivery),
          segToDraft(filed.storefront),
          filed.note,
          filed.pnlIncomeMode,
          moneyInputValue(filed.pnlIncome),
          filed.pnlGpByChannel,
        ),
      );
      setMsg(`ปิดงบแล้ว · รายได้ ${formatVatMoney(filed.pnlIncome)} เข้า P&L`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const unlock = async () => {
    if (!window.confirm(`ปลดล็อกเดือน ${month} เพื่อแก้ยอด?`)) return;
    setBusy(true);
    setError("");
    try {
      const next = await unlockVatMonthlyReturn(month, actor);
      setDoc(next);
      setMsg("ปลดล็อกแล้ว");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** ดึงบช.พนักงาน + บช.เจ้าของ ดูระหว่างงวด — ไม่ปิดงบ */
  const pullBothBooks = async () => {
    setBooksBusy(true);
    setError("");
    try {
      const [staffRows, ownerRows] = await Promise.all([
        loadStaffMonthBreakdown(),
        loadOwnerMonthBreakdown(),
      ]);
      setBookStaff(pickBookRow(staffRows, month));
      setBookOwner(pickBookRow(ownerRows, month));
      setBooksPulledAt(Date.now());
      setMsg(
        `ดึงบช. พนง. + เจ้าของ ${formatThaiMonthKey(month)} แล้ว (ยังไม่ปิดงบ)`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBooksBusy(false);
    }
  };

  const saveTaxSettings = async () => {
    setBusy(true);
    setError("");
    try {
      const saved = await savePersonalTaxSettings(
        {
          personalAllowance:
            parseMoneyInput(allowanceStr) || DEFAULT_PERSONAL_ALLOWANCE,
          otherDeductions: parseMoneyInput(otherDeductStr),
          note: taxNote,
        },
        actor,
      );
      setAllowanceStr(String(saved.personalAllowance));
      setOtherDeductStr(moneyInputValue(saved.otherDeductions));
      setTaxNote(saved.note);
      if (yearProfit != null) {
        setYearTax(
          computePersonalIncomeTax(yearProfit, {
            personalAllowance: saved.personalAllowance,
            otherDeductions: saved.otherDeductions,
          }),
        );
      }
      setMsg("บันทึกค่าลดหย่อนแล้ว");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const pullYearSummary = async () => {
    setYearBusy(true);
    setError("");
    try {
      const report = await loadPnlReport();
      const year = month.slice(0, 4);
      const months = report.combined
        .filter((r) => r.month.startsWith(year))
        .map((r) => {
          const income = Number(report.incomeByMonth[r.month]) || 0;
          const opex = r.cogs + r.sga + r.other;
          return {
            month: r.month,
            income,
            opex,
            profit: income - opex,
          };
        })
        .filter((m) => m.income > 0 || m.opex > 0);
      const profit = months.reduce((s, m) => s + m.profit, 0);
      const allowance =
        parseMoneyInput(allowanceStr) || DEFAULT_PERSONAL_ALLOWANCE;
      const other = parseMoneyInput(otherDeductStr);
      setYearMonths(months);
      setYearProfit(profit);
      setYearTax(
        computePersonalIncomeTax(profit, {
          personalAllowance: allowance,
          otherDeductions: other,
        }),
      );
      setMsg(
        `ดึงสรุปปี ${Number(year) + 543} แล้ว · กำไร ${formatVatMoney(profit)} · ${months.length} เดือน`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setYearBusy(false);
    }
  };

  const exportYearTax = () => {
    if (!yearTax || yearProfit == null) return;
    try {
      exportPersonalTaxYearXlsx({
        yearCe: Number(month.slice(0, 4)),
        months: yearMonths,
        personalAllowance: yearTax.personalAllowance,
        otherDeductions: yearTax.otherDeductions,
        taxable: yearTax.taxable,
        tax: yearTax.tax,
        slices: yearTax.slices,
        note: taxNote,
      });
      setMsg("ส่งออกไฟล์ ภ.ง.ด. แล้ว");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  /** ใส่รายได้ทดลองเข้า P&L โดยไม่ล็อกเดือน */
  const pushTrialIncome = async () => {
    const income = parseMoneyInput(pnlIncome);
    const finalIncome = income > 0 ? income : incomeBridge.pnlIncome;
    if (finalIncome <= 0) {
      setError("ยังมียอดรายได้ที่จะใส่ P&L ไม่พอ");
      return;
    }
    const ok = window.confirm(
      `ใส่รายได้ทดลอง ${formatVatMoney(finalIncome)} บาท เข้า P&L เดือน ${month}?\n\n` +
        "ไม่ปิดงบ · ไม่ล็อกตาราง VAT · แก้/ดึงใหม่ได้ระหว่างงวด",
    );
    if (!ok) return;
    setBusy(true);
    setError("");
    setMsg("");
    try {
      await saveVatMonthlyReturn(
        {
          monthKey: month,
          delivery,
          storefront,
          note,
          pnlIncomeMode: pnlMode,
          pnlIncome: finalIncome,
          pnlDeliveryGpDeduct: effectiveGpDeduct,
          pnlDeliveryGpMode: gpDeductMode,
          pnlDeliveryGpPct: effectiveGpPct,
          pnlGpByChannel: gpByChannel,
          status: "saved",
        },
        actor,
      );
      void saveVatMonthlySettings({ pnlGpByChannel: gpByChannel }, actor).catch(
        () => undefined,
      );
      await saveMonthlyIncome(month, finalIncome, actor);
      setPnlIncome(moneyInputValue(finalIncome));
      const snap = snapshotDraft(
        segToDraft(delivery),
        segToDraft(storefront),
        note,
        pnlMode,
        moneyInputValue(finalIncome),
        gpByChannel,
      );
      savedSnapRef.current = snap;
      setDirty(false);
      writeLocalDraft(month, snap);
      setMsg(
        `ใส่รายได้ทดลอง ${formatVatMoney(finalIncome)} เข้า P&L แล้ว · เดือนยังไม่ล็อก`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="vat-monthly-workbench">
      <div className="vat-top-bar">
        <div className="vat-sales-toolbar vat-sales-toolbar--slim">
          <label className="vat-sales-month">
            เดือน
            <select
              className="vat-thai-month-select"
              value={month}
              aria-label="เลือกเดือนไทย"
              onChange={(e) => changeMonth(e.target.value)}
            >
              {listThaiMonthOptions(month).map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          {doc ? (
            <span className="vat-ops-badge" data-status={doc.status}>
              {doc.status === "filed"
                ? "ปิดงบแล้ว · ล็อก"
                : doc.status === "saved"
                  ? "บันทึกแล้ว"
                  : "ร่าง"}
            </span>
          ) : null}
          {dirty && !locked ? (
            <span className="vat-dirty-dot" title="มีการแก้ที่ยังไม่บันทึก">
              ยังไม่บันทึก
            </span>
          ) : null}
          {busy ? <span className="muted">…</span> : null}
          {loading && hydrated ? (
            <span className="muted" title="อัปเดตพื้นหลัง — ตัวเลขไม่ถูกล้าง">
              ซิงก์…
            </span>
          ) : null}
        </div>

        <div className="vat-note-box">
          <button
            type="button"
            className="vat-note-toggle"
            aria-expanded={noteOpen}
            onClick={() => setNoteOpen((v) => !v)}
          >
            {noteOpen ? "− โน้ต" : "+ โน้ต"}
            {note.trim() && !noteOpen ? " · มีข้อความ" : ""}
          </button>
          {noteOpen ? (
            <textarea
              className="vat-note-area"
              rows={3}
              disabled={locked}
              value={note}
              placeholder="โน้ตเดือนนี้…"
              onChange={(e) => {
                setNote(e.target.value);
                markDirty();
              }}
            />
          ) : null}
        </div>
      </div>

      <p className="vat-period-banner vat-period-banner--one-line" role="note">
        <strong>รอบตัดยอด</strong>
        <span>{period.labelInclusive}</span>
      </p>

      {importFillPct ? (
        <p className="vat-import-fill-strip vat-import-fill-strip--month" role="status">
          <span>
            นำเข้าครบ <strong>{formatFillPct(importFillPct.overall)}</strong>
          </span>
          <span className="muted">SF {formatFillPct(importFillPct.shopee)}</span>
          <span className="muted">GB {formatFillPct(importFillPct.grab)}</span>
          <span className="muted">LM {formatFillPct(importFillPct.lineman)}</span>
          <span className="muted">· {importFillPct.days} วัน/เดือน</span>
        </p>
      ) : null}

      {error ? <p className="error-text">{error}</p> : null}
      {msg ? <p className="muted vat-sales-msg">{msg}</p> : null}

      {loading && !hydrated ? (
        <p className="muted">กำลังโหลด…</p>
      ) : (
        <>
          <IncomeTransferTable
            month={month}
            locked={Boolean(locked)}
            bridge={incomeBridge}
            gpByChannel={gpByChannel}
            pnlIncomeStr={pnlIncome}
            onGpByChannelChange={applyGpByChannel}
            onPnlIncomeChange={(v) => {
              setPnlIncome(v);
              markDirty();
            }}
            onUseBridgeIncome={() => {
              setPnlIncome(moneyInputValue(incomeBridge.pnlIncome));
              markDirty();
            }}
          />

          <CostsTable
            month={month}
            locked={Boolean(locked)}
            bridge={incomeBridge}
            gpByChannel={gpByChannel}
            staff={bookStaff}
            owner={bookOwner}
            booksPulled={Boolean(bookStaff && bookOwner)}
            booksBusy={booksBusy}
            booksPulledAt={booksPulledAt}
            onGpByChannelChange={applyGpByChannel}
            onPullBooks={() => void pullBothBooks()}
          />

          <PersonalTaxBlock
            month={month}
            income={parseMoneyInput(pnlIncome) || incomeBridge.pnlIncome}
            gpCost={incomeBridge.gpDeduct}
            netVat={totals.netVat}
            staff={bookStaff}
            owner={bookOwner}
            booksPulled={Boolean(bookStaff && bookOwner)}
            locked={Boolean(locked)}
            allowanceStr={allowanceStr}
            otherDeductStr={otherDeductStr}
            taxNote={taxNote}
            yearBusy={yearBusy}
            yearProfit={yearProfit}
            yearTax={yearTax}
            onAllowanceChange={setAllowanceStr}
            onOtherDeductChange={setOtherDeductStr}
            onTaxNoteChange={setTaxNote}
            onSaveTaxSettings={() => void saveTaxSettings()}
            onPullYear={() => void pullYearSummary()}
            onExportYear={exportYearTax}
          />

          <div className="vat-gp-input-bundle">
            <h2 className="vat-table-title">
              4) VAT — ภาษีขาย − ภาษีซื้อ — {formatThaiMonthKey(month)}
            </h2>
            <SalesVatTable
              deliveryDraft={deliveryDraft}
              storefrontDraft={storefrontDraft}
              delivery={delivery}
              storefront={storefront}
              locked={Boolean(locked)}
              openDelivery={openDelivery}
              openStorefront={openStorefront}
              onToggleDelivery={() => setOpenDelivery((v) => !v)}
              onToggleStorefront={() => setOpenStorefront((v) => !v)}
              onDeliveryChange={setDeliveryDraftTracked}
              onStorefrontChange={(d) =>
                setStorefrontDraftTracked({ ...d, remitPct: "100" })
              }
            />
            <InputVatTable
              month={month}
              deliveryGpFromChannels
              deliveryDraft={deliveryDraft}
              storefrontDraft={storefrontDraft}
              delivery={delivery}
              storefront={storefront}
              locked={Boolean(locked)}
              onDeliveryChange={setDeliveryDraftTracked}
              onStorefrontChange={(d) =>
                setStorefrontDraftTracked({ ...d, remitPct: "100" })
              }
            />
            <NetVatStrip
              delivery={delivery}
              storefront={storefront}
              totals={totals}
            />
          </div>

          <div className="vat-month-actions vat-month-actions--mini">
            {!locked ? (
              <>
                <button
                  type="button"
                  className="vat-mini-btn"
                  disabled={busy}
                  onClick={() => void saveMonth(true)}
                >
                  ร่าง
                </button>
                <button
                  type="button"
                  className="vat-mini-btn"
                  disabled={busy}
                  onClick={() => void saveMonth(false)}
                >
                  บันทึก
                </button>
                <button
                  type="button"
                  className="vat-mini-btn"
                  disabled={busy || incomeBridge.pnlIncome <= 0}
                  onClick={() => void pushTrialIncome()}
                >
                  รายได้ทดลอง → P&L
                </button>
                <button
                  type="button"
                  className="vat-mini-btn vat-mini-btn--primary"
                  disabled={busy || incomeBridge.pnlIncome <= 0}
                  onClick={() => void closeMonth()}
                >
                  ปิดงบจริง → ล็อก
                </button>
              </>
            ) : (
              <button
                type="button"
                className="vat-mini-btn"
                disabled={busy}
                onClick={() => void unlock()}
              >
                ปลดล็อก
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
