"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDateTimeShort, formatPlainNumber } from "@/lib/utils";
import {
  loadOwnerMonthBreakdown,
  loadStaffMonthBreakdown,
  saveMonthlyIncome,
  type MonthCategoryRow,
} from "@/lib/pnl";
import {
  fetchPosStorefrontTotalsByMonth,
  listDailySalesInMonth,
  sumMonthSales,
} from "@/lib/vat-sales";
import {
  DEFAULT_OUTPUT_PCT,
  DEFAULT_PERIOD_START_DAY,
  DEFAULT_STOREFRONT_REMIT_PCT,
  DEFAULT_VAT_LOGIC_RATES,
  emptySegment,
  fileVatMonthlyReturn,
  getVatPeriodBoundary,
  loadVatMonthlyReturn,
  loadVatMonthlySettings,
  mapVatLogicRates,
  outputPctToFraction,
  proposePnlIncome,
  ratesLabel,
  recomputeSegment,
  saveVatMonthlyReturn,
  sumMonthlyTotals,
  unlockVatMonthlyReturn,
  type DeliveryChannels,
  type StorefrontTenders,
  type VatLogicRates,
  type VatMonthlyReturn,
  type VatSegmentState,
} from "@/lib/vat-monthly";

function emptyBookRow(month: string): MonthCategoryRow {
  return { month, asset: 0, cogs: 0, sga: 0, other: 0 };
}

function pickBookRow(rows: MonthCategoryRow[], month: string): MonthCategoryRow {
  return rows.find((r) => r.month === month) || emptyBookRow(month);
}

function bookOutTotal(row: MonthCategoryRow) {
  return row.asset + row.cogs + row.sga + row.other;
}

function fmt(n: number) {
  if (!n) return "—";
  return formatPlainNumber(n);
}

function moneyInputValue(n: number) {
  return n ? String(n) : "";
}

function parseMoneyInput(raw: string): number {
  const t = raw.trim().replace(/,/g, "");
  if (!t) return 0;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function parseRate(raw: string, fallback: number): number {
  const n = Number(String(raw).trim());
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function roundPct(n: number) {
  return Math.round(n * 10000) / 100;
}

function pctLabel(n: number) {
  return `${formatPlainNumber(roundPct(n))}%`;
}

function draftStorageKey(month: string) {
  return `telltea:vat-monthly-draft:${month}`;
}

type Props = { actor: string };
type Tab = "month" | "close";

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
    remitPct: String(seg.remitPct || (seg.kind === "storefront" ? DEFAULT_STOREFRONT_REMIT_PCT : 100)),
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
    remitPct: parseRate(
      d.remitPct,
      kind === "storefront" ? DEFAULT_STOREFRONT_REMIT_PCT : 100,
    ),
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
      placeholder="0"
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
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
        {formatPlainNumber(value)}
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

function OutputVatTable({
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
  const totalReported = delivery.reportedGross + storefront.reportedGross;
  const totalRemit = delivery.remitAmount + storefront.remitAmount;
  const totalBase = delivery.vatBase + storefront.vatBase;
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
                  isStore ? `${label} รายได้หน้าร้าน` : `${label} ยอดขายรวม VAT`
                }
                onChange={(v) => onChange({ ...draft, grossManual: v })}
              />
            )}
          </td>
          <td className="col-pct col-remit">
            {isStore ? (
              <TapRate
                value={parseRate(draft.remitPct, DEFAULT_STOREFRONT_REMIT_PCT)}
                locked={locked}
                ariaLabel="นำส่ง %"
                suffix="%"
                step="0.01"
                onCommit={(pct) =>
                  onChange({
                    ...draft,
                    remitPct: String(Math.min(100, Math.max(0.01, pct))),
                  })
                }
              />
            ) : (
              <span className="vat-tap-edit vat-tap-edit--static" title="เดลิเวอรี่นำส่ง 100%">
                <span className="vat-tap-val">100</span>
                <span className="vat-tap-suffix">%</span>
              </span>
            )}
          </td>
          <td className="col-num">{fmt(computed.remitAmount)}</td>
          <td className="col-num">{fmt(computed.vatBase)}</td>
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
                ["shopee", "ShopeeFood"],
                ["grab", "Grab"],
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
                <td className="col-pct col-remit" />
                <td className="col-num" />
                <td className="col-num" />
                <td className="col-rate" />
                <td className="col-num">
                  <span className="muted vat-child-hint">ย่อยรวมเข้าเดลิเวอรี่</span>
                </td>
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
                <td className="col-pct col-remit" />
                <td className="col-num" />
                <td className="col-num" />
                <td className="col-rate" />
                <td className="col-num">
                  <span className="muted vat-child-hint">
                    ย่อยรวม · VAT จากนำส่งจริง
                  </span>
                </td>
              </tr>
            ))
          : null}
      </>
    );
  };

  return (
    <section className="vat-table-block">
      <h2 className="vat-table-title">1) ภาษีขาย — กลุ่มรายได้</h2>
      <div className="sheet-wrap vat-month-slim-wrap">
        <table className="sheet-table vat-sales-table vat-sales-table--slim vat-month-slim vat-month-slim--output">
          <colgroup>
            <col className="vat-col-seg" />
            <col className="vat-col-gross" />
            <col className="vat-col-remit-pct" />
            <col className="vat-col-money" />
            <col className="vat-col-money" />
            <col className="vat-col-rate" />
            <col className="vat-col-money" />
          </colgroup>
          <thead>
            <tr>
              <th className="col-seg">ส่วน</th>
              <th className="col-num">รายได้หน้าร้าน / ยอดขายรวม</th>
              <th className="col-pct col-remit">นำส่ง %</th>
              <th className="col-num">นำส่งจริง</th>
              <th className="col-num">ฐานภาษี</th>
              <th className="col-rate">เรทขาย %</th>
              <th className="col-num">ภาษีขาย</th>
            </tr>
          </thead>
          <tbody>
            {renderParent(
              "delivery",
              "เดลิเวอรี่",
              deliveryDraft,
              delivery,
              openDelivery,
              onToggleDelivery,
              onDeliveryChange,
            )}
            {renderParent(
              "storefront",
              "หน้าร้าน",
              storefrontDraft,
              storefront,
              openStorefront,
              onToggleStorefront,
              onStorefrontChange,
            )}
            <tr className="vat-sales-totals-row">
              <td className="col-seg">รวมภาษีขาย</td>
              <td className="col-num">{fmt(totalReported)}</td>
              <td className="col-pct col-remit">—</td>
              <td className="col-num">{fmt(totalRemit)}</td>
              <td className="col-num">{fmt(totalBase)}</td>
              <td className="col-rate">—</td>
              <td className="col-num col-net">{fmt(totalOut)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="muted vat-sales-hint vat-hint-one-line">
        หน้าร้าน: คิด VAT จากคอลัมน์นำส่งจริงเท่านั้น (default นำส่ง 90%) · เรทขาย %
        เช่น 7% = รวมในราคา (7÷107)
      </p>
    </section>
  );
}

function InputVatTable({
  deliveryDraft,
  storefrontDraft,
  delivery,
  storefront,
  locked,
  onDeliveryChange,
  onStorefrontChange,
}: {
  deliveryDraft: DraftSeg;
  storefrontDraft: DraftSeg;
  delivery: VatSegmentState;
  storefront: VatSegmentState;
  locked: boolean;
  onDeliveryChange: (d: DraftSeg) => void;
  onStorefrontChange: (d: DraftSeg) => void;
}) {
  const renderRow = (
    label: string,
    draft: DraftSeg,
    computed: VatSegmentState,
    onChange: (d: DraftSeg) => void,
  ) => (
    <tr className="vat-row-parent">
      <td className="col-seg">{label}</td>
      <td className="col-pct">
        <span className="vat-pct-cell">
          <TapRate
            value={roundPct(draft.rates.gpOfOutput)}
            locked={locked}
            ariaLabel={`${label} GP %`}
            suffix="%"
            step="0.01"
            onCommit={(pct) =>
              onChange({
                ...draft,
                rates: {
                  ...draft.rates,
                  gpOfOutput: Math.min(100, Math.max(0, pct)) / 100,
                },
              })
            }
          />
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
      </td>
      <td className="col-num col-input">
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
      <h2 className="vat-table-title">2) ภาษีซื้อ — กลุ่มหักได้</h2>
      <div className="sheet-wrap vat-month-slim-wrap">
        <table className="sheet-table vat-sales-table vat-sales-table--slim vat-month-slim vat-month-slim--input">
          <thead>
            <tr>
              <th className="col-seg">ส่วน</th>
              <th className="col-pct">GP % ของภาษีขาย</th>
              <th className="col-num">ภาษีซื้อ GP</th>
              <th className="col-pct">ยื่นภาษีซื้อ %</th>
              <th className="col-num">ภาษีซื้อวัตถุดิบ</th>
              <th className="col-num">ภาษีซื้อรวม</th>
            </tr>
          </thead>
          <tbody>
            {renderRow("เดลิเวอรี่", deliveryDraft, delivery, onDeliveryChange)}
            {renderRow(
              "หน้าร้าน",
              storefrontDraft,
              storefront,
              onStorefrontChange,
            )}
            <tr className="vat-sales-totals-row">
              <td className="col-seg">รวมภาษีซื้อ</td>
              <td className="col-pct">—</td>
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
    </section>
  );
}

function SummaryVatTable({
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
    <section className="vat-table-block">
      <h2 className="vat-table-title">
        3) สรุป — ภาษีขาย − ภาษีซื้อ = สุทธิต้องนำส่ง
      </h2>
      <div className="sheet-wrap vat-month-slim-wrap">
        <table className="sheet-table vat-sales-table vat-sales-table--slim vat-month-slim vat-month-slim--summary vat-close-table">
          <thead>
            <tr>
              <th className="col-seg">รายการ</th>
              <th className="col-num">เดลิเวอรี่</th>
              <th className="col-num">หน้าร้าน</th>
              <th className="col-num">รวม</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="col-seg">ภาษีขาย (จากตาราง 1)</td>
              <td className="col-num">{fmt(delivery.outputVat)}</td>
              <td className="col-num">{fmt(storefront.outputVat)}</td>
              <td className="col-num">{fmt(totals.outputVat)}</td>
            </tr>
            <tr>
              <td className="col-seg">หัก ภาษีซื้อ (จากตาราง 2)</td>
              <td className="col-num">{fmt(delivery.inputVat)}</td>
              <td className="col-num">{fmt(storefront.inputVat)}</td>
              <td className="col-num">{fmt(totals.inputVat)}</td>
            </tr>
            <tr className="vat-sales-totals-row">
              <td className="col-seg">ภาษีสุทธิต้องนำส่ง</td>
              <td className="col-num col-net">{fmt(delivery.netVat)}</td>
              <td className="col-num col-net">{fmt(storefront.netVat)}</td>
              <td className="col-num col-net">{fmt(totals.netVat)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function VatMonthlyWorkbench({ actor }: Props) {
  const [tab, setTab] = useState<Tab>("month");
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
  const [pnlMode, setPnlMode] = useState<"exVat" | "incVat">("exVat");
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
  const pnlModeRef = useRef(pnlMode);
  const pnlIncomeRef = useRef(pnlIncome);
  const cloudSaveGen = useRef(0);
  const [bookStaff, setBookStaff] = useState<MonthCategoryRow | null>(null);
  const [bookOwner, setBookOwner] = useState<MonthCategoryRow | null>(null);
  const [booksBusy, setBooksBusy] = useState(false);
  const [booksPulledAt, setBooksPulledAt] = useState(0);

  deliveryDraftRef.current = deliveryDraft;
  storefrontDraftRef.current = storefrontDraft;
  noteRef.current = note;
  pnlModeRef.current = pnlMode;
  pnlIncomeRef.current = pnlIncome;
  dirtyRef.current = dirty;

  const snapshotDraft = useCallback(
    (
      d: DraftSeg,
      s: DraftSeg,
      n: string,
      mode: "exVat" | "incVat",
      income: string,
    ) =>
      JSON.stringify({
        delivery: d,
        storefront: s,
        note: n,
        pnlMode: mode,
        pnlIncome: income,
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
      const [ret, st] = await Promise.all([
        loadVatMonthlyReturn(month),
        loadVatMonthlySettings(),
      ]);
      let d = segToDraft(ret.delivery);
      let s = segToDraft(ret.storefront);
      let n = ret.note;
      let mode = ret.pnlIncomeMode;
      let income = moneyInputValue(ret.pnlIncome);

      // ร่างในเครื่อง — รวมแบบไม่ให้ค่าว่างทับตัวเลข
      if (ret.status !== "filed") {
        const cached = readLocalDraft(month);
        if (cached?.delivery) d = mergePreferMoney(d, cached.delivery);
        if (cached?.storefront) s = mergePreferMoney(s, cached.storefront);
        if (typeof cached?.note === "string" && cached.note.trim()) n = cached.note;
        if (cached?.pnlMode === "incVat" || cached?.pnlMode === "exVat") {
          mode = cached.pnlMode;
        }
        if (typeof cached?.pnlIncome === "string" && cached.pnlIncome.trim()) {
          income = cached.pnlIncome;
        }
      }

      // ถ้ากำลังแก้ค้างอยู่ ห้ามรีเฟรชทับด้วยค่าว่างจากเซิร์ฟเวอร์
      if (hydratedRef.current && dirtyRef.current) {
        d = mergePreferMoney(d, deliveryDraftRef.current);
        s = mergePreferMoney(s, storefrontDraftRef.current);
        if (noteRef.current.trim()) n = noteRef.current;
        mode = pnlModeRef.current;
        if (pnlIncomeRef.current.trim()) income = pnlIncomeRef.current;
      }

      setDoc(ret);
      setPeriodStartDay(st.periodStartDay);
      setDeliveryDraft(d);
      setStorefrontDraft(s);
      setNote(n);
      setNoteOpen(Boolean(n.trim()));
      setPnlMode(mode);
      setPnlIncome(income);
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
        ret.pnlIncomeMode,
        moneyInputValue(ret.pnlIncome),
      );
      const localSnap = snapshotDraft(d, s, n, mode, income);
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
        if (cached.pnlMode === "incVat" || cached.pnlMode === "exVat") {
          setPnlMode(cached.pnlMode);
        }
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

  const locked = doc?.status === "filed";
  const period = useMemo(
    () => getVatPeriodBoundary(month, periodStartDay),
    [month, periodStartDay],
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
    );
    writeLocalDraft(month, payload);
    setDirty(payload !== savedSnapRef.current);
  }, [
    deliveryDraft,
    storefrontDraft,
    note,
    pnlMode,
    pnlIncome,
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
          const proposed = proposePnlIncome(
            {
              vatBase: del.vatBase + sf.vatBase,
              grossSales: del.grossSales + sf.grossSales,
            },
            mode,
          );
          const saved = await saveVatMonthlyReturn(
            {
              monthKey: month,
              delivery: del,
              storefront: sf,
              note: noteRef.current,
              pnlIncomeMode: mode,
              pnlIncome: incomeRaw > 0 ? incomeRaw : proposed,
              status: "draft",
            },
            actor,
          );
          if (gen !== cloudSaveGen.current) return;
          setDoc(saved);
          const snap = snapshotDraft(
            segToDraft(saved.delivery),
            segToDraft(saved.storefront),
            saved.note,
            saved.pnlIncomeMode,
            moneyInputValue(saved.pnlIncome),
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

  const changeTab = (next: Tab) => {
    if (next === tab) return;
    setTab(next);
  };

  const saveMonth = async (asDraft: boolean) => {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const proposed = proposePnlIncome(
        { vatBase: totals.vatBase, grossSales: totals.grossSales },
        pnlMode,
      );
      const incomeRaw = parseMoneyInput(pnlIncome);
      const saved = await saveVatMonthlyReturn(
        {
          monthKey: month,
          delivery,
          storefront,
          note,
          pnlIncomeMode: pnlMode,
          pnlIncome: incomeRaw > 0 ? incomeRaw : proposed,
          status: asDraft ? "draft" : "saved",
        },
        actor,
      );
      setDoc(saved);
      setPnlIncome(moneyInputValue(saved.pnlIncome));
      const snap = snapshotDraft(
        segToDraft(saved.delivery),
        segToDraft(saved.storefront),
        saved.note,
        saved.pnlIncomeMode,
        moneyInputValue(saved.pnlIncome),
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

  /** ดึงยอดแอพเดลิเวอรี่ + หน้าร้าน จาก dailySales / POS กลับเข้าตาราง */
  const pullSalesFromSources = async () => {
    if (locked) return;
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const [byDay, posByDay] = await Promise.all([
        listDailySalesInMonth(month),
        fetchPosStorefrontTotalsByMonth(month),
      ]);
      const totalsDay = sumMonthSales(Object.values(byDay));
      const posSum = Object.values(posByDay).reduce(
        (acc, n) => acc + (Number(n) || 0),
        0,
      );
      const storefrontGross =
        totalsDay.storefrontGross > 0 ? totalsDay.storefrontGross : posSum;

      setDeliveryDraftTracked((prev) => {
        const hasApps =
          totalsDay.shopee + totalsDay.grab + totalsDay.lineman > 0;
        return {
          ...prev,
          // มียอดย่อยแอพแล้วไม่ใช้ grossManual (กันสับสน)
          grossManual: hasApps ? "" : prev.grossManual,
          channels: {
            shopee:
              totalsDay.shopee > 0
                ? moneyInputValue(totalsDay.shopee)
                : prev.channels.shopee,
            grab:
              totalsDay.grab > 0
                ? moneyInputValue(totalsDay.grab)
                : prev.channels.grab,
            lineman:
              totalsDay.lineman > 0
                ? moneyInputValue(totalsDay.lineman)
                : prev.channels.lineman,
          },
        };
      });
      setStorefrontDraftTracked((prev) => ({
        ...prev,
        grossManual:
          storefrontGross > 0
            ? moneyInputValue(storefrontGross)
            : prev.grossManual,
      }));
      if (totalsDay.shopee + totalsDay.grab + totalsDay.lineman > 0) {
        setOpenDelivery(true);
      }
      if (storefrontGross > 0) setOpenStorefront(true);

      const parts = [
        totalsDay.shopee || totalsDay.grab || totalsDay.lineman
          ? `แอพ ส่ง=${formatPlainNumber(totalsDay.deliveryGross)}`
          : null,
        storefrontGross > 0
          ? `หน้าร้าน=${formatPlainNumber(storefrontGross)}${
              totalsDay.storefrontGross > 0 ? "" : " (POS)"
            }`
          : null,
      ].filter(Boolean);
      setMsg(
        parts.length
          ? `ดึงยอดกลับแล้ว · ${parts.join(" · ")} · จำในเครื่อง + จะเซฟร่างอัตโนมัติ`
          : "ไม่พบยอดใน dailySales/POS เดือนนี้ — ถ้าเคยคีย์ไว้ให้ดูว่ายังมีจุด「ยังไม่บันทึก」หรือกดร่าง",
      );
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
    const proposed = proposePnlIncome(
      { vatBase: totals.vatBase, grossSales: totals.grossSales },
      pnlMode,
    );
    const finalIncome = income > 0 ? income : proposed;
    const ok = window.confirm(
      `ปิดงบเดือน ${month} → ใส่รายได้ P&L = ${formatPlainNumber(finalIncome)} บาท?\n` +
        `ภาษีสุทธิ ${formatPlainNumber(totals.netVat)} · หลังปิดจะล็อกแก้ยอด`,
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
          status: "saved",
        },
        actor,
      );
      const filed = await fileVatMonthlyReturn(month, actor, {
        forceIncome: finalIncome,
      });
      setDoc(filed);
      setDirty(false);
      writeLocalDraft(
        month,
        snapshotDraft(
          segToDraft(filed.delivery),
          segToDraft(filed.storefront),
          filed.note,
          filed.pnlIncomeMode,
          moneyInputValue(filed.pnlIncome),
        ),
      );
      setMsg(`ปิดงบแล้ว · รายได้ ${formatPlainNumber(filed.pnlIncome)} เข้า P&L`);
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
      setMsg(`ดึงบช. พนง. + เจ้าของ เดือน ${month} แล้ว (ยังไม่ปิดงบ)`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBooksBusy(false);
    }
  };

  /** ใส่รายได้ทดลองเข้า P&L โดยไม่ล็อกเดือน */
  const pushTrialIncome = async () => {
    const income = parseMoneyInput(pnlIncome);
    const proposed = proposePnlIncome(
      { vatBase: totals.vatBase, grossSales: totals.grossSales },
      pnlMode,
    );
    const finalIncome = income > 0 ? income : proposed;
    if (finalIncome <= 0) {
      setError("ยังมียอดรายได้ที่จะใส่ P&L ไม่พอ");
      return;
    }
    const ok = window.confirm(
      `ใส่รายได้ทดลอง ${formatPlainNumber(finalIncome)} บาท เข้า P&L เดือน ${month}?\n\n` +
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
          status: "saved",
        },
        actor,
      );
      await saveMonthlyIncome(month, finalIncome, actor);
      setPnlIncome(moneyInputValue(finalIncome));
      const snap = snapshotDraft(
        segToDraft(delivery),
        segToDraft(storefront),
        note,
        pnlMode,
        moneyInputValue(finalIncome),
      );
      savedSnapRef.current = snap;
      setDirty(false);
      setMsg(
        `ใส่รายได้ทดลอง ${formatPlainNumber(finalIncome)} เข้า P&L แล้ว · เดือนยังไม่ล็อก`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="vat-monthly-workbench">
      <header className="vat-sales-header">
        <p className="vat-sales-lead">
          VAT รายเดือน · 3 ตาราง compact · เรทขาย % · หน้าร้านคิดจากยอดนำส่งจริง
        </p>
        <div className="vat-sales-tabs" role="tablist">
          {(
            [
              ["month", "เดือน"],
              ["close", "ปิด P&L"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? "vat-sales-tab is-active" : "vat-sales-tab"}
              onClick={() => changeTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="vat-top-bar">
        <div className="vat-sales-toolbar vat-sales-toolbar--slim">
          <label className="vat-sales-month">
            เดือน
            <input
              type="month"
              value={month}
              onChange={(e) => changeMonth(e.target.value)}
            />
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
          {!locked ? (
            <button
              type="button"
              className="vat-mini-btn"
              disabled={busy || (loading && !hydrated)}
              onClick={() => void pullSalesFromSources()}
              title="ดึงยอด Shopee/Grab/LINE MAN + หน้าร้าน จาก dailySales หรือ POS"
            >
              ดึงยอดแอพ/ร้าน
            </button>
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

      {error ? <p className="error-text">{error}</p> : null}
      {msg ? <p className="muted vat-sales-msg">{msg}</p> : null}

      {loading && !hydrated ? (
        <p className="muted">กำลังโหลด…</p>
      ) : (
        <>
          {tab === "month" ? (
            <>
              <p className="muted vat-sales-hint vat-hint-one-line">
                จำในเครื่อง + เซฟร่างอัตโนมัติ · ตัวเลขไม่ถูกล้างตอนอัปเดต · ดึงยอดแอพ/ร้านได้ ·
                เรทขาย {ratesLabel(DEFAULT_VAT_LOGIC_RATES)} · นำส่งหน้าร้าน{" "}
                {DEFAULT_STOREFRONT_REMIT_PCT}%
              </p>

              <OutputVatTable
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
                onStorefrontChange={setStorefrontDraftTracked}
              />

              <InputVatTable
                deliveryDraft={deliveryDraft}
                storefrontDraft={storefrontDraft}
                delivery={delivery}
                storefront={storefront}
                locked={Boolean(locked)}
                onDeliveryChange={setDeliveryDraftTracked}
                onStorefrontChange={setStorefrontDraftTracked}
              />

              <SummaryVatTable
                delivery={delivery}
                storefront={storefront}
                totals={totals}
              />

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
                      className="vat-mini-btn vat-mini-btn--primary"
                      disabled={busy}
                      onClick={() => void saveMonth(false)}
                    >
                      บันทึก
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
          ) : null}

          {tab === "close" ? (
            <section className="vat-close-panel">
              <p className="muted vat-sales-hint vat-hint-one-line">
                ดึงบช. พนง. + เจ้าของ ดูระหว่างงวดได้ · ใส่รายได้ทดลองได้โดยไม่ล็อก ·
                ปิดงบจริงค่อยล็อกเดือน
              </p>

              <SummaryVatTable
                delivery={delivery}
                storefront={storefront}
                totals={totals}
              />

              <div className="vat-books-block">
                <div className="vat-books-head">
                  <h2 className="vat-table-title">บช. สองสมุด — เดือน {month}</h2>
                  <button
                    type="button"
                    className="vat-mini-btn"
                    disabled={booksBusy || busy}
                    onClick={() => void pullBothBooks()}
                  >
                    {booksBusy ? "กำลังดึง…" : "ดึงบช. พนง. + เจ้าของ"}
                  </button>
                </div>
                <p className="muted vat-sales-hint vat-hint-one-line">
                  ดึงเข้า = ดูยอดออกจาก ledger / ownerBooks ตามเดือน · ไม่ใช่ปิดงบ
                  {booksPulledAt
                    ? ` · ดึงล่าสุด ${formatDateTimeShort(booksPulledAt)}`
                    : " · ยังไม่ได้ดึง"}
                </p>
                <div className="sheet-wrap vat-month-slim-wrap">
                  <table className="sheet-table vat-sales-table vat-sales-table--slim vat-month-slim vat-close-table">
                    <thead>
                      <tr>
                        <th className="col-seg">บช.</th>
                        <th className="col-num">COGS</th>
                        <th className="col-num">SGA</th>
                        <th className="col-num">สินทรัพย์</th>
                        <th className="col-num">อื่น</th>
                        <th className="col-num">รวมออก</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(
                        [
                          ["บช. พนักงาน", bookStaff],
                          ["บช. เจ้าของ", bookOwner],
                        ] as const
                      ).map(([label, row]) => (
                        <tr key={label}>
                          <td className="col-seg">{label}</td>
                          <td className="col-num">
                            {row ? fmt(row.cogs) : "—"}
                          </td>
                          <td className="col-num">
                            {row ? fmt(row.sga) : "—"}
                          </td>
                          <td className="col-num">
                            {row ? fmt(row.asset) : "—"}
                          </td>
                          <td className="col-num">
                            {row ? fmt(row.other) : "—"}
                          </td>
                          <td className="col-num col-net">
                            {row ? fmt(bookOutTotal(row)) : "—"}
                          </td>
                        </tr>
                      ))}
                      {bookStaff && bookOwner ? (
                        <tr className="vat-sales-totals-row">
                          <td className="col-seg">รวมสองบช.</td>
                          <td className="col-num">
                            {fmt(bookStaff.cogs + bookOwner.cogs)}
                          </td>
                          <td className="col-num">
                            {fmt(bookStaff.sga + bookOwner.sga)}
                          </td>
                          <td className="col-num">
                            {fmt(bookStaff.asset + bookOwner.asset)}
                          </td>
                          <td className="col-num">
                            {fmt(bookStaff.other + bookOwner.other)}
                          </td>
                          <td className="col-num col-net">
                            {fmt(
                              bookOutTotal(bookStaff) + bookOutTotal(bookOwner),
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="sheet-wrap vat-month-slim-wrap">
                <table className="sheet-table vat-sales-table vat-sales-table--slim vat-month-slim vat-close-table">
                  <thead>
                    <tr>
                      <th className="col-seg">รายได้ → P&L</th>
                      <th className="col-num">ค่า</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="col-seg">โหมดรายได้ P&L</td>
                      <td className="col-num col-input">
                        <select
                          className="vat-inline-select"
                          disabled={locked}
                          value={pnlMode}
                          onChange={(e) => {
                            const mode =
                              e.target.value === "incVat" ? "incVat" : "exVat";
                            setPnlMode(mode);
                            setPnlIncome(
                              moneyInputValue(
                                proposePnlIncome(
                                  {
                                    vatBase: totals.vatBase,
                                    grossSales: totals.grossSales,
                                  },
                                  mode,
                                ),
                              ),
                            );
                            markDirty();
                          }}
                        >
                          <option value="exVat">ก่อน VAT (แนะนำ)</option>
                          <option value="incVat">รวม VAT</option>
                        </select>
                      </td>
                    </tr>
                    <tr>
                      <td className="col-seg">ยอดรายได้ที่จะใส่ P&L</td>
                      <td className="col-num col-input">
                        <MoneyCell
                          value={pnlIncome}
                          locked={Boolean(locked)}
                          ariaLabel="ยอดรายได้ P&L"
                          onChange={(v) => {
                            setPnlIncome(v);
                            markDirty();
                          }}
                        />
                      </td>
                    </tr>
                    <tr>
                      <td className="col-seg">สถานะเดือน</td>
                      <td className="col-num">
                        {doc?.status === "filed"
                          ? "ปิดงบแล้ว · ล็อก"
                          : doc?.status === "saved"
                            ? "บันทึกแล้ว · ยังไม่ปิด"
                            : "ร่าง"}
                      </td>
                    </tr>
                    {doc?.filedAt ? (
                      <tr>
                        <td className="col-seg">ปิดงบเมื่อ</td>
                        <td className="col-num">
                          {formatDateTimeShort(doc.filedAt)}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <div className="vat-month-actions vat-month-actions--mini">
                {!locked ? (
                  <>
                    <button
                      type="button"
                      className="vat-mini-btn"
                      disabled={busy || totals.grossSales <= 0}
                      onClick={() => void pushTrialIncome()}
                    >
                      ใส่รายได้ทดลอง → P&L
                    </button>
                    <button
                      type="button"
                      className="vat-mini-btn vat-mini-btn--primary"
                      disabled={busy || totals.grossSales <= 0}
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
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
