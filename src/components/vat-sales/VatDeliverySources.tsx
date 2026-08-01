"use client";

/**
 * ที่มายอดเดลิเวอรี่ — หน้าแยกจาก VAT เดือน
 * รับยอดจากแหล่งจริง → ผสานเข้าตารางยอดเดลิเวอรี่ทันที
 * รายละเอียดไฟล์/อะแดปเตอร์พัฒนาที่หน้านี้คนละสาย
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
  DELIVERY_SOURCE_GUIDE,
  draftToMonthSources,
  emptyChannelSource,
  mergeMonthSourcesIntoBooks,
  MONTH_CHANNEL_LABEL,
  MONTH_CHANNEL_SHORT,
  MONTH_CHANNEL_SOURCE_HINT,
  MONTH_CHANNELS,
  MONTH_SOURCE_KIND_LABEL,
  type MonthChannelSource,
  type MonthSourceKind,
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

function defaultKind(channel: MonthChannel): MonthSourceKind {
  if (channel === "grab") return "grab-rollup";
  if (channel === "lineman") return "lineman-monthly";
  return "shopee-monthly";
}

type Props = { actor: string };

export function VatDeliverySources({ actor }: Props) {
  const monthOptions = useMemo(() => listThaiMonthOptions(undefined, 18), []);
  const [month, setMonth] = useState(() => bangkokMonthKey());
  const [draft, setDraft] = useState<MonthBooksDraft>(() =>
    emptyMonthBooksDraft(bangkokMonthKey()),
  );
  const [kinds, setKinds] = useState<Record<MonthChannel, MonthSourceKind>>(
    () => ({
      shopee: "shopee-monthly",
      grab: "grab-rollup",
      lineman: "lineman-monthly",
    }),
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

  const sources = useMemo(() => {
    const base = draftToMonthSources(draft);
    for (const k of MONTH_CHANNELS) {
      base.byChannel[k] = {
        ...base.byChannel[k],
        kind: kinds[k],
        note: MONTH_CHANNEL_SOURCE_HINT[k],
      };
    }
    return base;
  }, [draft, kinds]);

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
      setKinds({
        shopee: "shopee-monthly",
        grab: "grab-rollup",
        lineman: "lineman-monthly",
      });
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
    for (const k of MONTH_CHANNELS) {
      view.byChannel[k] = {
        ...view.byChannel[k],
        kind: kinds[k],
        note: MONTH_CHANNEL_SOURCE_HINT[k],
      };
    }
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
  }, [actor, kinds, locked, month]);

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
        ...emptyChannelSource(channel, kinds[channel]),
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
      <p className="muted vat-sales-hint">{DELIVERY_SOURCE_GUIDE.overview}</p>

      <section
        className="vat-table-block vat-source-guide"
        aria-label="หลักการแหล่งที่มา"
      >
        <h3 className="vat-table-subtitle">หลักการแหล่งที่มา</h3>
        <ul className="vat-source-guide-list">
          <li>
            <strong>Grab</strong> — {DELIVERY_SOURCE_GUIDE.grab}
          </li>
          <li>
            <strong>LINE MAN</strong> — {DELIVERY_SOURCE_GUIDE.lineman}
          </li>
          <li>
            <strong>Shopee</strong> — {DELIVERY_SOURCE_GUIDE.shopee}
          </li>
          <li>{DELIVERY_SOURCE_GUIDE.sync}</li>
          <li className="muted">{DELIVERY_SOURCE_GUIDE.later}</li>
        </ul>
      </section>

      {error ? <p className="error-text">{error}</p> : null}
      {msg ? <p className="muted vat-sales-msg">{msg}</p> : null}
      {loading ? <p className="muted">กำลังโหลด…</p> : null}

      <section className="vat-table-block vat-month-sources">
        <h3 className="vat-table-subtitle">ยอดรวมเดือน (ผสานเข้างบทันที)</h3>
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
                <th
                  className="col-seg"
                  title="รูปแบบต้นทางของช่องทางนี้"
                >
                  ที่มา
                </th>
              </tr>
            </thead>
            <tbody>
              {MONTH_CHANNELS.map((k) => (
                <tr key={k} title={MONTH_CHANNEL_SOURCE_HINT[k]}>
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
                  <td className="col-seg muted">
                    {MONTH_SOURCE_KIND_LABEL[kinds[k] || defaultKind(k)]}
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
                <td className="col-seg" />
              </tr>
            </tbody>
          </table>
        </div>
        <p className="muted vat-sales-hint vat-hint-one-line">
          แก้แล้วผสานอัตโนมัติ · เปิดหน้า VAT เดือนเพื่อดูงบ A/B/C/D
        </p>
      </section>
    </div>
  );
}
