"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDateTimeShort, formatPlainNumber } from "@/lib/utils";
import {
  DEFAULT_PERIOD_START_DAY,
  DEFAULT_VAT_LOGIC_RATES,
  emptySegment,
  fileVatMonthlyReturn,
  getVatPeriodBoundary,
  loadVatMonthlyReturn,
  loadVatMonthlySettings,
  mapVatLogicRates,
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

type Props = { actor: string };
type Tab = "month" | "close";

type DraftSeg = {
  grossManual: string;
  channels: Record<keyof DeliveryChannels, string>;
  tenders: Record<keyof StorefrontTenders, string>;
  gpVat: string;
  useGpEstimate: boolean;
  ingredientVat: string;
  rates: VatLogicRates;
};

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
    gpVat: parseMoneyInput(d.gpVat),
    useGpEstimate: d.useGpEstimate,
    ingredientVat: parseMoneyInput(d.ingredientVat),
    rates: d.rates,
  });
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

/** ตาราง 1 — ภาษีขาย (กลุ่มรายได้) */
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
  const totalGross = delivery.grossSales + storefront.grossSales;
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
                {fmt(computed.grossSales)}
              </span>
            ) : (
              <MoneyCell
                value={draft.grossManual}
                locked={locked}
                ariaLabel={`${label} ยอดขายรวม VAT`}
                onChange={(v) => onChange({ ...draft, grossManual: v })}
              />
            )}
          </td>
          <td className="col-num">{fmt(computed.vatBase)}</td>
          <td className="col-rate">
            <span className="vat-rate-pair">
              <TapRate
                value={draft.rates.outputNum}
                locked={locked}
                ariaLabel={`${label} เศษภาษีขาย`}
                onCommit={(n) =>
                  onChange({
                    ...draft,
                    rates: { ...draft.rates, outputNum: Math.max(0, n) },
                  })
                }
              />
              <span>/</span>
              <TapRate
                value={draft.rates.outputDen}
                locked={locked}
                ariaLabel={`${label} ส่วนภาษีขาย`}
                onCommit={(n) =>
                  onChange({
                    ...draft,
                    rates: { ...draft.rates, outputDen: Math.max(1, n) },
                  })
                }
              />
            </span>
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
                <td className="col-num" colSpan={3}>
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
                <td className="col-num" colSpan={3}>
                  <span className="muted vat-child-hint">ย่อยรวมเข้าหน้าร้าน</span>
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
            <col className="vat-col-num" />
            <col className="vat-col-num" />
            <col className="vat-col-rate" />
            <col className="vat-col-num" />
          </colgroup>
          <thead>
            <tr>
              <th className="col-seg">ส่วน</th>
              <th className="col-num">ยอดขายรวม VAT</th>
              <th className="col-num">ฐานภาษี</th>
              <th className="col-rate">เรทขาย</th>
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
              <td className="col-num">{fmt(totalGross)}</td>
              <td className="col-num">{fmt(totalBase)}</td>
              <td className="col-rate">—</td>
              <td className="col-num col-net">{fmt(totalOut)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** ตาราง 2 — ภาษีซื้อ (กลุ่มหักได้) โครงแถวคล้ายตาราง 1 */
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
          <span className="vat-est-val" title="หลัง play-safe">
            {fmt(computed.gpVatClaimed)}
          </span>
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
          <colgroup>
            <col className="vat-col-seg" />
            <col className="vat-col-pct" />
            <col className="vat-col-num" />
            <col className="vat-col-pct-sm" />
            <col className="vat-col-num" />
            <col className="vat-col-num" />
          </colgroup>
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
      <p className="muted vat-sales-hint vat-hint-one-line">
        ติ๊กประมาณ = คำนวณ GP จาก % ของภาษีขาย · ปิดติ๊กแล้วคีย์จากบิล GP จริง ·
        ยื่น % = play-safe (เช่น 98%)
      </p>
    </section>
  );
}

/** ตาราง 3 — สรุป = ภาษีขาย − ภาษีซื้อ */
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
    vatBase: number;
    grossSales: number;
  };
}) {
  return (
    <section className="vat-table-block">
      <h2 className="vat-table-title">
        3) สรุป — ภาษีขาย − ภาษีซื้อ = สุทธิต้องนำส่ง
      </h2>
      <div className="sheet-wrap vat-month-slim-wrap">
        <table className="sheet-table vat-sales-table vat-sales-table--slim vat-month-slim vat-month-slim--summary vat-close-table">
          <colgroup>
            <col className="vat-col-seg-wide" />
            <col className="vat-col-num" />
            <col className="vat-col-num" />
            <col className="vat-col-num" />
          </colgroup>
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
  const [pnlMode, setPnlMode] = useState<"exVat" | "incVat">("exVat");
  const [pnlIncome, setPnlIncome] = useState("");
  const [openDelivery, setOpenDelivery] = useState(false);
  const [openStorefront, setOpenStorefront] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [ret, st] = await Promise.all([
        loadVatMonthlyReturn(month),
        loadVatMonthlySettings(),
      ]);
      setDoc(ret);
      setPeriodStartDay(st.periodStartDay);
      setDeliveryDraft(segToDraft(ret.delivery));
      setStorefrontDraft(segToDraft(ret.storefront));
      setNote(ret.note);
      setPnlMode(ret.pnlIncomeMode);
      setPnlIncome(moneyInputValue(ret.pnlIncome));
      if (ret.delivery.partsSum > 0) setOpenDelivery(true);
      if (ret.storefront.partsSum > 0) setOpenStorefront(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
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
      setMsg(asDraft ? "บันทึกแบบร่างแล้ว" : "บันทึกยอดเดือนแล้ว");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const closeMonth = async () => {
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

  return (
    <div className="vat-monthly-workbench">
      <header className="vat-sales-header">
        <p className="vat-sales-lead">
          VAT รายเดือน · 3 ตาราง: ภาษีขาย · ภาษีซื้อ · สรุป (ขาย − ซื้อ) · compact slim
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
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="vat-sales-toolbar vat-sales-toolbar--slim">
        <label className="vat-sales-month">
          เดือน
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
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
        {busy ? <span className="muted">กำลังทำงาน…</span> : null}
      </div>

      <p className="vat-period-banner vat-period-banner--one-line" role="note">
        <strong>รอบตัดยอด</strong>
        <span>{period.labelInclusive}</span>
        <span className="muted">· {period.timeZone}</span>
      </p>

      {error ? <p className="error-text">{error}</p> : null}
      {msg ? <p className="muted vat-sales-msg">{msg}</p> : null}

      {loading ? (
        <p className="muted">กำลังโหลด…</p>
      ) : (
        <>
          {tab === "month" ? (
            <>
              <p className="muted vat-sales-hint vat-hint-one-line">
                ตาราง 1 รายได้ → ตาราง 2 หักได้ → ตาราง 3 สุทธิ = ขาย − ซื้อ · เรทแตะแก้ได้ต่อเดือน
                {" · "}
                default {ratesLabel(DEFAULT_VAT_LOGIC_RATES)} · GP{" "}
                {pctLabel(DEFAULT_VAT_LOGIC_RATES.gpOfOutput)}
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
                onDeliveryChange={setDeliveryDraft}
                onStorefrontChange={setStorefrontDraft}
              />

              <InputVatTable
                deliveryDraft={deliveryDraft}
                storefrontDraft={storefrontDraft}
                delivery={delivery}
                storefront={storefront}
                locked={Boolean(locked)}
                onDeliveryChange={setDeliveryDraft}
                onStorefrontChange={setStorefrontDraft}
              />

              <SummaryVatTable
                delivery={delivery}
                storefront={storefront}
                totals={totals}
              />

              <label className="vat-sales-field vat-note-slim">
                หมายเหตุ
                <input
                  type="text"
                  disabled={locked}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="แหล่งยอดแอป + บิล GP เดือนนี้"
                />
              </label>

              <div className="vat-month-actions">
                {!locked ? (
                  <>
                    <button
                      type="button"
                      className="ghost-btn"
                      disabled={busy}
                      onClick={() => void saveMonth(true)}
                    >
                      บันทึกร่าง
                    </button>
                    <button
                      type="button"
                      className="primary-btn"
                      disabled={busy}
                      onClick={() => void saveMonth(false)}
                    >
                      บันทึกยอดเดือน
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={busy}
                    onClick={() => void unlock()}
                  >
                    ปลดล็อกแก้ยอด
                  </button>
                )}
              </div>
            </>
          ) : null}

          {tab === "close" ? (
            <section className="vat-close-panel">
              <p className="muted vat-sales-hint vat-hint-one-line">
                ปิดงบ = ยืนยันสรุปตาราง 3 → ใส่รายได้ P&L · ปิดแล้วล็อกทั้งเดือน
              </p>

              <SummaryVatTable
                delivery={delivery}
                storefront={storefront}
                totals={totals}
              />

              <div className="sheet-wrap vat-month-slim-wrap">
                <table className="sheet-table vat-sales-table vat-sales-table--slim vat-month-slim vat-close-table">
                  <thead>
                    <tr>
                      <th className="col-seg">รายการปิดงบ → P&L</th>
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
                          onChange={setPnlIncome}
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

              <div className="vat-month-actions">
                {!locked ? (
                  <button
                    type="button"
                    className="primary-btn"
                    disabled={busy || totals.grossSales <= 0}
                    onClick={() => void closeMonth()}
                  >
                    ปิดงบเดือน → P&L
                  </button>
                ) : (
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={busy}
                    onClick={() => void unlock()}
                  >
                    ปลดล็อกเดือนนี้
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
