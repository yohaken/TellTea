"use client";

/**
 * ที่มายอดเดลิเวอรี่ — เหลือเฉพาะตารางสรุป
 * ยอดรวมเดือน (ผสานเข้างบทันที) → vatMonthlyReturns
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { VatColHead } from "@/components/vat-sales/VatColHead";
import {
  formatVatMoney,
  moneyFieldValue,
  normalizeMoneyFieldText,
  parseVatMoneyInput,
} from "@/lib/vat-number-format";
import {
  applyChannelSourceToDraft,
  DELIVERY_COL_INFO,
  draftToMonthSources,
  emptyChannelSource,
  mergeMonthSourcesIntoBooks,
  MONTH_CHANNEL_LABEL,
  MONTH_CHANNEL_SHORT,
  MONTH_CHANNELS,
  type MonthChannelSource,
} from "@/lib/vat-month-sources";
import {
  emptyMonthBooksDraft,
  retToMonthBooksDraft,
  type MonthBooksDraft,
  type MonthChannel,
} from "@/lib/vat-month-books";
import {
  formatThaiMonthKey,
  listThaiMonthOptions,
  loadVatMonthlyReturn,
} from "@/lib/vat-monthly";
import { bangkokMonthKey } from "@/lib/vat-sales";

function fmt(n: number) {
  if (!Number.isFinite(n)) return "—";
  return formatVatMoney(n);
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

type Props = { actor: string };

export function VatDeliverySources({ actor }: Props) {
  const monthOptions = useMemo(() => listThaiMonthOptions(undefined, 18), []);
  const [month, setMonth] = useState(() => bangkokMonthKey());
  const [draft, setDraft] = useState<MonthBooksDraft>(() =>
    emptyMonthBooksDraft(bangkokMonthKey()),
  );
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [dirty, setDirty] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadGen = useRef(0);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const sources = useMemo(() => draftToMonthSources(draft), [draft]);

  const loadMonth = useCallback(async (m: string) => {
    const gen = ++loadGen.current;
    setLoading(true);
    setError("");
    setMsg("");
    try {
      const ret = await loadVatMonthlyReturn(m);
      if (gen !== loadGen.current) return;
      setDraft(retToMonthBooksDraft(ret));
      setLocked(ret.status === "filed");
      setDirty(false);
    } catch (e) {
      if (gen !== loadGen.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setDraft(emptyMonthBooksDraft(m));
      setLocked(false);
    } finally {
      if (gen === loadGen.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMonth(month);
  }, [month, loadMonth]);

  const flushSave = useCallback(async () => {
    if (locked) return;
    const view = draftToMonthSources(draftRef.current);
    try {
      const result = await mergeMonthSourcesIntoBooks({
        monthKey: month,
        sources: view,
        actor,
      });
      if (result.skipped) {
        setMsg(result.reason || "ข้ามการผสาน");
        if (result.reason === "เดือนปิดงบแล้ว") setLocked(true);
        return;
      }
      setDraft(retToMonthBooksDraft(result.saved));
      setDirty(false);
      setMsg("ผสานเข้ายอดเดลิเวอรี่แล้ว");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [actor, locked, month]);

  useEffect(() => {
    if (loading || locked || !dirty) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void flushSave();
    }, 700);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [dirty, draft, flushSave, loading, locked]);

  function patchField(
    channel: MonthChannel,
    field: keyof Pick<
      MonthChannelSource,
      "sales" | "transfer" | "fee" | "gpVat"
    >,
    raw: string,
  ) {
    if (locked) return;
    const value = parseVatMoneyInput(raw);
    setDraft((d) => {
      const src = {
        ...emptyChannelSource(channel),
        sales: d.sales[channel],
        transfer: d.transfer[channel],
        fee: d.gpFee[channel],
        gpVat: d.gpVatOverride[channel],
        [field]: value,
      };
      return applyChannelSourceToDraft(d, src);
    });
    setDirty(true);
    setMsg("");
  }

  const statusLabel = locked ? "ปิดงบ" : dirty ? "กำลังผสาน…" : "พร้อม";

  return (
    <div className="vat-delivery-sources">
      <div className="vat-sales-toolbar">
        <label className="vat-month-pick">
          <span className="sr-only">เดือน</span>
          <select
            className="vat-thai-month-select"
            value={month}
            disabled={loading}
            onChange={(e) => setMonth(e.target.value)}
            aria-label="เลือกเดือน"
          >
            {monthOptions.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <span
          className={`vat-status-badge${locked ? " is-filed" : ""}`}
          title={statusLabel}
        >
          {statusLabel}
        </span>
        <Link href="/vat-sales/" className="vat-sales-tab vat-sources-jump">
          → VAT เดือน
        </Link>
      </div>

      <h2 className="vat-table-title">
        ที่มายอดเดลิเวอรี่ — {formatThaiMonthKey(month)}
      </h2>

      {error ? <p className="error-text">{error}</p> : null}
      {msg ? <p className="muted vat-sales-msg">{msg}</p> : null}
      {loading ? <p className="muted">กำลังโหลด…</p> : null}

      <section className="vat-table-block vat-month-sources">
        <h3 className="vat-table-subtitle">
          ยอดรวมเดือน (ผสานเข้างบทันที)
        </h3>
        <div className="sheet-wrap vat-month-slim-wrap">
          <table className="sheet-table vat-sales-table vat-sales-table--slim vat-month-slim vat-close-table">
            <thead>
              <tr>
                <th className="col-seg">ช่องทาง</th>
                <VatColHead
                  label="ยอดขายแอพ"
                  info={DELIVERY_COL_INFO.appSales}
                />
                <VatColHead
                  label="ยอดโอน"
                  info={DELIVERY_COL_INFO.transfer}
                />
                <VatColHead label="คชจ.GP" info={DELIVERY_COL_INFO.gpFee} />
                <VatColHead
                  label="VAT-ซื้อ"
                  info={DELIVERY_COL_INFO.purchaseVat}
                />
              </tr>
            </thead>
            <tbody>
              {MONTH_CHANNELS.map((k) => (
                <tr key={k}>
                  <td className="col-seg">{MONTH_CHANNEL_LABEL[k]}</td>
                  <td className="col-num col-input">
                    <MoneyCell
                      value={moneyFieldValue(draft.sales[k])}
                      locked={locked}
                      ariaLabel={`ยอดขายแอพ ${MONTH_CHANNEL_SHORT[k]}`}
                      onChange={(v) => patchField(k, "sales", v)}
                    />
                  </td>
                  <td className="col-num col-input">
                    <MoneyCell
                      value={moneyFieldValue(draft.transfer[k])}
                      locked={locked}
                      ariaLabel={`ยอดโอน ${MONTH_CHANNEL_SHORT[k]}`}
                      onChange={(v) => patchField(k, "transfer", v)}
                    />
                  </td>
                  <td className="col-num col-input">
                    <MoneyCell
                      value={moneyFieldValue(draft.gpFee[k])}
                      locked={locked}
                      ariaLabel={`คชจ.GP ${MONTH_CHANNEL_SHORT[k]}`}
                      onChange={(v) => patchField(k, "fee", v)}
                    />
                  </td>
                  <td className="col-num col-input">
                    <MoneyCell
                      value={moneyFieldValue(draft.gpVatOverride[k])}
                      locked={locked}
                      ariaLabel={`VAT-ซื้อ ${MONTH_CHANNEL_SHORT[k]}`}
                      onChange={(v) => patchField(k, "gpVat", v)}
                    />
                  </td>
                </tr>
              ))}
              <tr className="vat-sales-totals-row">
                <td className="col-seg">รวมเดลิเวอรี่</td>
                <td className="col-num col-net">{fmt(sources.totals.sales)}</td>
                <td className="col-num col-net">
                  {fmt(sources.totals.transfer)}
                </td>
                <td className="col-num col-net">{fmt(sources.totals.fee)}</td>
                <td className="col-num col-net">{fmt(sources.totals.gpVat)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
