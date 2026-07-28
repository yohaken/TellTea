"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatPlainNumber } from "@/lib/utils";
import {
  DEFAULT_VAT_LOGIC_RATES,
  emptySegment,
  fileVatMonthlyReturn,
  loadVatMonthlyReturn,
  loadVatMonthlySettings,
  mapVatLogicRates,
  proposePnlIncome,
  recomputeSegment,
  saveVatMonthlyReturn,
  saveVatMonthlySettings,
  sumMonthlyTotals,
  unlockVatMonthlyReturn,
  type VatLogicRates,
  type VatMonthlyReturn,
  type VatMonthlySettings,
  type VatSegmentKind,
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

type Props = {
  actor: string;
};

type Tab = "month" | "trial" | "close";

type DraftSeg = {
  grossSales: string;
  gpVat: string;
  useGpEstimate: boolean;
  ingredientVat: string;
  rates: VatLogicRates;
};

function segToDraft(seg: VatSegmentState): DraftSeg {
  return {
    grossSales: moneyInputValue(seg.grossSales),
    gpVat: moneyInputValue(seg.gpVat),
    useGpEstimate: seg.useGpEstimate,
    ingredientVat: moneyInputValue(seg.ingredientVat),
    rates: mapVatLogicRates(seg.rates),
  };
}

function draftToSeg(d: DraftSeg): VatSegmentState {
  return recomputeSegment({
    grossSales: parseMoneyInput(d.grossSales),
    gpVat: parseMoneyInput(d.gpVat),
    useGpEstimate: d.useGpEstimate,
    ingredientVat: parseMoneyInput(d.ingredientVat),
    rates: d.rates,
  });
}

function RatesEditor({
  title,
  rates,
  onChange,
  disabled,
}: {
  title: string;
  rates: VatLogicRates;
  onChange: (r: VatLogicRates) => void;
  disabled?: boolean;
}) {
  return (
    <div className="vat-rates-block">
      <h3 className="vat-sales-section-title">{title}</h3>
      <div className="vat-rates-grid">
        <label className="vat-sales-field">
          ภาษีขาย (เศษ)
          <input
            type="number"
            min={0}
            step={1}
            disabled={disabled}
            value={rates.outputNum}
            onChange={(e) =>
              onChange({
                ...rates,
                outputNum: parseRate(e.target.value, rates.outputNum),
              })
            }
          />
        </label>
        <label className="vat-sales-field">
          ภาษีขาย (ส่วน)
          <input
            type="number"
            min={1}
            step={1}
            disabled={disabled}
            value={rates.outputDen}
            onChange={(e) =>
              onChange({
                ...rates,
                outputDen: parseRate(e.target.value, rates.outputDen) || 1,
              })
            }
          />
        </label>
        <label className="vat-sales-field">
          GP ≈ สัดส่วนของภาษีขาย
          <input
            type="number"
            min={0}
            max={1}
            step={0.01}
            disabled={disabled}
            value={rates.gpOfOutput}
            onChange={(e) =>
              onChange({
                ...rates,
                gpOfOutput: Math.min(
                  1,
                  parseRate(e.target.value, rates.gpOfOutput),
                ),
              })
            }
          />
        </label>
        <label className="vat-sales-field">
          Play-safe claim (ภาษีซื้อ)
          <input
            type="number"
            min={0.01}
            max={1}
            step={0.01}
            disabled={disabled}
            value={rates.inputClaimFactor}
            onChange={(e) =>
              onChange({
                ...rates,
                inputClaimFactor: Math.min(
                  1,
                  Math.max(0.01, parseRate(e.target.value, rates.inputClaimFactor)),
                ),
              })
            }
          />
        </label>
        <label className="vat-sales-check-slim">
          <input
            type="checkbox"
            disabled={disabled}
            checked={rates.floorInput}
            onChange={(e) =>
              onChange({ ...rates, floorInput: e.target.checked })
            }
          />
          ปัดลงภาษีซื้อ
        </label>
      </div>
      <p className="muted vat-sales-hint">
        ภาษีขาย = ยอดรวม × {rates.outputNum}/{rates.outputDen}
        {" · "}
        GP ประมาณ {formatPlainNumber(roundPct(rates.gpOfOutput))}% ของภาษีขาย
        {" · "}
        ยื่นภาษีซื้อ {formatPlainNumber(roundPct(rates.inputClaimFactor))}%
      </p>
    </div>
  );
}

function roundPct(n: number) {
  return Math.round(n * 10000) / 100;
}

function SegmentCard({
  kind,
  draft,
  computed,
  locked,
  onChange,
}: {
  kind: VatSegmentKind;
  draft: DraftSeg;
  computed: VatSegmentState;
  locked: boolean;
  onChange: (d: DraftSeg) => void;
}) {
  const title = kind === "delivery" ? "เดลิเวอรี่ (ทุกแอป)" : "หน้าร้าน";
  return (
    <section className="vat-seg-card">
      <header className="vat-seg-head">
        <h2 className="vat-sales-section-title">{title}</h2>
        <span className="muted">
          เรท {computed.rates.outputNum}/{computed.rates.outputDen}
        </span>
      </header>

      <div className="vat-seg-fields">
        <label className="vat-sales-field">
          ยอดขายรวมทั้งเดือน (รวม VAT)
          <input
            inputMode="decimal"
            disabled={locked}
            value={draft.grossSales}
            placeholder="0"
            onChange={(e) =>
              onChange({ ...draft, grossSales: e.target.value })
            }
          />
        </label>

        <label className="vat-sales-check-slim">
          <input
            type="checkbox"
            disabled={locked}
            checked={draft.useGpEstimate}
            onChange={(e) =>
              onChange({ ...draft, useGpEstimate: e.target.checked })
            }
          />
          ใช้ประมาณ GP จากเรท (~1/3 ภาษีขาย)
        </label>

        {!draft.useGpEstimate ? (
          <label className="vat-sales-field">
            ภาษีซื้อจากบิล GP (สรุปรายเดือน)
            <input
              inputMode="decimal"
              disabled={locked}
              value={draft.gpVat}
              placeholder="0"
              onChange={(e) => onChange({ ...draft, gpVat: e.target.value })}
            />
          </label>
        ) : (
          <p className="muted vat-sales-hint">
            GP ประมาณ = {fmt(computed.gpEstimate)} บาท
          </p>
        )}

        <label className="vat-sales-field">
          ภาษีซื้อจากบิลวัตถุดิบจริง
          <input
            inputMode="decimal"
            disabled={locked}
            value={draft.ingredientVat}
            placeholder="0"
            onChange={(e) =>
              onChange({ ...draft, ingredientVat: e.target.value })
            }
          />
        </label>
      </div>

      <table className="sheet-table vat-seg-result">
        <tbody>
          <tr>
            <th>ฐานภาษี</th>
            <td className="col-num">{fmt(computed.vatBase)}</td>
          </tr>
          <tr>
            <th>ภาษีขาย (Output)</th>
            <td className="col-num">{fmt(computed.outputVat)}</td>
          </tr>
          <tr>
            <th>ภาษีซื้อ GP (หลัง play-safe)</th>
            <td className="col-num">{fmt(computed.gpVatClaimed)}</td>
          </tr>
          <tr>
            <th>ภาษีซื้อวัตถุดิบ (หลัง play-safe)</th>
            <td className="col-num">{fmt(computed.ingredientVatClaimed)}</td>
          </tr>
          <tr>
            <th>ภาษีซื้อรวม (Input)</th>
            <td className="col-num">{fmt(computed.inputVat)}</td>
          </tr>
          <tr className="vat-sales-totals-row">
            <th>ภาษีสุทธิต้องนำส่ง</th>
            <td className="col-num">{fmt(computed.netVat)}</td>
          </tr>
        </tbody>
      </table>
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
  const [settings, setSettings] = useState<VatMonthlySettings | null>(null);
  const [deliveryDraft, setDeliveryDraft] = useState<DraftSeg>(() =>
    segToDraft(emptySegment()),
  );
  const [storefrontDraft, setStorefrontDraft] = useState<DraftSeg>(() =>
    segToDraft(emptySegment()),
  );
  const [note, setNote] = useState("");
  const [pnlMode, setPnlMode] = useState<"exVat" | "incVat">("exVat");
  const [pnlIncome, setPnlIncome] = useState("");

  /** ตารางทด — ไม่บันทึกจนกว่าจะกดใช้เรท */
  const [trialDelivery, setTrialDelivery] = useState<VatLogicRates>(
    DEFAULT_VAT_LOGIC_RATES,
  );
  const [trialStorefront, setTrialStorefront] = useState<VatLogicRates>(
    DEFAULT_VAT_LOGIC_RATES,
  );
  const [trialGrossD, setTrialGrossD] = useState("");
  const [trialGrossS, setTrialGrossS] = useState("");
  const [trialIngD, setTrialIngD] = useState("");
  const [trialIngS, setTrialIngS] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [ret, st] = await Promise.all([
        loadVatMonthlyReturn(month),
        loadVatMonthlySettings(),
      ]);
      setDoc(ret);
      setSettings(st);
      setDeliveryDraft(segToDraft(ret.delivery));
      setStorefrontDraft(segToDraft(ret.storefront));
      setNote(ret.note);
      setPnlMode(ret.pnlIncomeMode);
      setPnlIncome(moneyInputValue(ret.pnlIncome));
      setTrialDelivery(mapVatLogicRates(st.deliveryRates));
      setTrialStorefront(mapVatLogicRates(st.storefrontRates));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const delivery = useMemo(() => draftToSeg(deliveryDraft), [deliveryDraft]);
  const storefront = useMemo(
    () => draftToSeg(storefrontDraft),
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

  const trialDeliverySeg = useMemo(
    () =>
      recomputeSegment({
        grossSales: parseMoneyInput(trialGrossD),
        gpVat: 0,
        useGpEstimate: true,
        ingredientVat: parseMoneyInput(trialIngD),
        rates: trialDelivery,
      }),
    [trialGrossD, trialIngD, trialDelivery],
  );
  const trialStorefrontSeg = useMemo(
    () =>
      recomputeSegment({
        grossSales: parseMoneyInput(trialGrossS),
        gpVat: 0,
        useGpEstimate: true,
        ingredientVat: parseMoneyInput(trialIngS),
        rates: trialStorefront,
      }),
    [trialGrossS, trialIngS, trialStorefront],
  );

  const saveMonth = async (asDraft: boolean) => {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const proposed = proposePnlIncome(
        {
          vatBase: totals.vatBase,
          grossSales: totals.grossSales,
        },
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

  const applyTrialRatesToMonth = () => {
    setDeliveryDraft((d) => ({ ...d, rates: mapVatLogicRates(trialDelivery) }));
    setStorefrontDraft((d) => ({
      ...d,
      rates: mapVatLogicRates(trialStorefront),
    }));
    setTab("month");
    setMsg("นำเรทจากตารางทดมาใช้กับเดือนนี้แล้ว — กดบันทึกเพื่อเก็บ");
  };

  const saveDefaultRates = async () => {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const next = await saveVatMonthlySettings(
        {
          deliveryRates: trialDelivery,
          storefrontRates: trialStorefront,
          pnlIncomeMode: pnlMode,
        },
        actor,
      );
      setSettings(next);
      setMsg("บันทึกเรทเริ่มต้นแล้ว");
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
      `ปิดเดือน ${month} → ใส่รายได้ P&L = ${formatPlainNumber(finalIncome)} บาท?\n` +
        `ภาษีขาย ${formatPlainNumber(totals.outputVat)} − ภาษีซื้อ ${formatPlainNumber(totals.inputVat)} = สุทธิ ${formatPlainNumber(totals.netVat)}`,
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
      setMsg(`ปิดเดือนแล้ว · รายได้ ${formatPlainNumber(filed.pnlIncome)} เข้า P&L`);
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
          VAT รายเดือน · ใส่ยอดรวมสิ้นเดือน · แยกเดลิเวอรี่ / หน้าร้าน · Play-safe
        </p>
        <div className="vat-sales-tabs" role="tablist">
          {(
            [
              ["month", "เดือน"],
              ["trial", "ตารางทด"],
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
              ? "ปิดแล้ว"
              : doc.status === "saved"
                ? "บันทึกแล้ว"
                : "ร่าง"}
          </span>
        ) : null}
        {busy ? <span className="muted">กำลังทำงาน…</span> : null}
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {msg ? <p className="muted vat-sales-msg">{msg}</p> : null}

      {loading ? (
        <p className="muted">กำลังโหลด…</p>
      ) : (
        <>
          {tab === "month" ? (
            <>
              <p className="muted vat-sales-hint">
                ยอดขายรวมจริง 100% (ภาษีขาย) · ภาษีซื้อปัดลง/ยื่นหย่อนเล็กน้อย ·
                จ่ายเกินหลักสิบได้ แต่ปลอดภัย
              </p>
              <div className="vat-seg-grid">
                <SegmentCard
                  kind="delivery"
                  draft={deliveryDraft}
                  computed={delivery}
                  locked={Boolean(locked)}
                  onChange={setDeliveryDraft}
                />
                <SegmentCard
                  kind="storefront"
                  draft={storefrontDraft}
                  computed={storefront}
                  locked={Boolean(locked)}
                  onChange={setStorefrontDraft}
                />
              </div>

              <section className="vat-sales-summary vat-sales-summary--slim vat-month-totals">
                <span>
                  รวมขาย <strong>{fmt(totals.grossSales)}</strong>
                </span>
                <span>
                  ภาษีขาย <strong>{fmt(totals.outputVat)}</strong>
                </span>
                <span>
                  ภาษีซื้อ <strong>{fmt(totals.inputVat)}</strong>
                </span>
                <span className="vat-sales-summary-main">
                  สุทธิต้องนำส่ง <strong>{fmt(totals.netVat)}</strong>
                </span>
              </section>

              <label className="vat-sales-field">
                หมายเหตุ
                <textarea
                  rows={2}
                  disabled={locked}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="เช่น แหล่งยอด Shopee/Grab/LM + บิล GP เดือนนี้"
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

          {tab === "trial" ? (
            <section className="vat-trial-panel">
              <p className="muted vat-sales-hint">
                ตารางทดเรท — ปรับสูตรก่อนใช้จริง ไม่เขียนทับเดือนจนกว่าจะกดนำเรทไปใช้
                {settings
                  ? ` · เรทเริ่มต้นที่บันทึกไว้: ส่ง ${settings.deliveryRates.outputNum}/${settings.deliveryRates.outputDen} · ร้าน ${settings.storefrontRates.outputNum}/${settings.storefrontRates.outputDen}`
                  : ""}
              </p>

              <div className="vat-seg-grid">
                <RatesEditor
                  title="เรทเดลิเวอรี่"
                  rates={trialDelivery}
                  onChange={setTrialDelivery}
                />
                <RatesEditor
                  title="เรทหน้าร้าน"
                  rates={trialStorefront}
                  onChange={setTrialStorefront}
                />
              </div>

              <h3 className="vat-sales-section-title">ทดลองคำนวณ</h3>
              <div className="vat-trial-inputs">
                <label className="vat-sales-field">
                  ยอดส่ง (ทด)
                  <input
                    inputMode="decimal"
                    value={trialGrossD}
                    onChange={(e) => setTrialGrossD(e.target.value)}
                    placeholder="0"
                  />
                </label>
                <label className="vat-sales-field">
                  VAT วัตถุดิบส่ง (ทด)
                  <input
                    inputMode="decimal"
                    value={trialIngD}
                    onChange={(e) => setTrialIngD(e.target.value)}
                    placeholder="0"
                  />
                </label>
                <label className="vat-sales-field">
                  ยอดร้าน (ทด)
                  <input
                    inputMode="decimal"
                    value={trialGrossS}
                    onChange={(e) => setTrialGrossS(e.target.value)}
                    placeholder="0"
                  />
                </label>
                <label className="vat-sales-field">
                  VAT วัตถุดิบร้าน (ทด)
                  <input
                    inputMode="decimal"
                    value={trialIngS}
                    onChange={(e) => setTrialIngS(e.target.value)}
                    placeholder="0"
                  />
                </label>
              </div>

              <div className="sheet-wrap">
                <table className="sheet-table vat-sales-table">
                  <thead>
                    <tr>
                      <th>ส่วน</th>
                      <th className="col-num">ภาษีขาย</th>
                      <th className="col-num">GP (ประมาณ+safe)</th>
                      <th className="col-num">วัตถุดิบ</th>
                      <th className="col-num">ภาษีซื้อ</th>
                      <th className="col-num">สุทธิ</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>เดลิเวอรี่</td>
                      <td className="col-num">{fmt(trialDeliverySeg.outputVat)}</td>
                      <td className="col-num">
                        {fmt(trialDeliverySeg.gpVatClaimed)}
                      </td>
                      <td className="col-num">
                        {fmt(trialDeliverySeg.ingredientVatClaimed)}
                      </td>
                      <td className="col-num">{fmt(trialDeliverySeg.inputVat)}</td>
                      <td className="col-num">{fmt(trialDeliverySeg.netVat)}</td>
                    </tr>
                    <tr>
                      <td>หน้าร้าน</td>
                      <td className="col-num">
                        {fmt(trialStorefrontSeg.outputVat)}
                      </td>
                      <td className="col-num">
                        {fmt(trialStorefrontSeg.gpVatClaimed)}
                      </td>
                      <td className="col-num">
                        {fmt(trialStorefrontSeg.ingredientVatClaimed)}
                      </td>
                      <td className="col-num">
                        {fmt(trialStorefrontSeg.inputVat)}
                      </td>
                      <td className="col-num">{fmt(trialStorefrontSeg.netVat)}</td>
                    </tr>
                    <tr className="vat-sales-totals-row">
                      <td>รวม</td>
                      <td className="col-num">
                        {fmt(
                          trialDeliverySeg.outputVat +
                            trialStorefrontSeg.outputVat,
                        )}
                      </td>
                      <td className="col-num">
                        {fmt(
                          trialDeliverySeg.gpVatClaimed +
                            trialStorefrontSeg.gpVatClaimed,
                        )}
                      </td>
                      <td className="col-num">
                        {fmt(
                          trialDeliverySeg.ingredientVatClaimed +
                            trialStorefrontSeg.ingredientVatClaimed,
                        )}
                      </td>
                      <td className="col-num">
                        {fmt(
                          trialDeliverySeg.inputVat + trialStorefrontSeg.inputVat,
                        )}
                      </td>
                      <td className="col-num">
                        {fmt(
                          trialDeliverySeg.netVat + trialStorefrontSeg.netVat,
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="vat-month-actions">
                <button
                  type="button"
                  className="ghost-btn"
                  disabled={busy}
                  onClick={() => void saveDefaultRates()}
                >
                  บันทึกเป็นเรทเริ่มต้น
                </button>
                <button
                  type="button"
                  className="primary-btn"
                  disabled={busy || locked}
                  onClick={applyTrialRatesToMonth}
                >
                  นำเรทไปใช้กับเดือนนี้
                </button>
              </div>
            </section>
          ) : null}

          {tab === "close" ? (
            <section className="vat-close-panel">
              <p className="muted vat-sales-hint">
                ปิดเดือน = ยืนยันมือครั้งเดียว → ใส่รายได้เข้าสรุปรายเดือน (P&L)
              </p>
              <section className="vat-sales-summary vat-sales-summary--slim">
                <span>
                  รวมขาย <strong>{fmt(totals.grossSales)}</strong>
                </span>
                <span>
                  ฐานภาษี <strong>{fmt(totals.vatBase)}</strong>
                </span>
                <span>
                  ภาษีสุทธิ <strong>{fmt(totals.netVat)}</strong>
                </span>
              </section>

              <label className="vat-sales-field">
                โหมดรายได้ P&L
                <select
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
              </label>

              <label className="vat-sales-field">
                ยอดรายได้ที่จะใส่ P&L
                <input
                  inputMode="decimal"
                  disabled={locked}
                  value={pnlIncome}
                  onChange={(e) => setPnlIncome(e.target.value)}
                />
              </label>

              <div className="vat-month-actions">
                {!locked ? (
                  <button
                    type="button"
                    className="primary-btn"
                    disabled={busy || totals.grossSales <= 0}
                    onClick={() => void closeMonth()}
                  >
                    ปิดเดือน → P&L
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
