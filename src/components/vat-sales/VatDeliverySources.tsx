"use client";

/**
 * ที่มายอดเดลิเวอรี่ — หน้าแยกจาก VAT เดือน
 * รับยอด → ผสานเข้าตารางยอดเดลิเวอรี่ทันที
 * คอลัมน์ที่มา / คู่มือแหล่งไฟล์ — ยังไม่นิ่ง ถอดไว้ก่อน · ใช้โน้ตส่วนตัวแทน
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { VatColHead } from "@/components/vat-sales/VatColHead";
import {
  loadVatDeliverySourceNotes,
  saveVatDeliverySourceNotes,
} from "@/lib/vat-delivery-source-notes";
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
  runDeliveryFreshStartIfNeeded,
  summarizeWipe,
  wipeAllDeliveryTotals,
  wipeDeliveryTotalsForMonth,
} from "@/lib/vat-delivery-wipe";
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
  const [note, setNote] = useState("");
  const [noteDirty, setNoteDirty] = useState(false);
  const [noteMsg, setNoteMsg] = useState("");
  const [wipeBusy, setWipeBusy] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadGen = useRef(0);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const noteRef = useRef(note);
  noteRef.current = note;

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

  // ครั้งเดียว: ล้างยอดเดลิเวอรี่ค้างจากระบบเก่า (ก.ค./ส.ค. ฯลฯ)
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setWipeBusy(true);
        const report = await runDeliveryFreshStartIfNeeded(actor);
        if (cancelled || !report) return;
        setMsg(summarizeWipe(report));
        await loadMonth(month);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setWipeBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // รันครั้งเดียวตอน mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor]);

  useEffect(() => {
    void (async () => {
      try {
        const n = await loadVatDeliverySourceNotes();
        setNote(n.text);
        setNoteDirty(false);
      } catch {
        /* โน้ตว่างได้ */
      }
    })();
  }, []);

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

  useEffect(() => {
    if (!noteDirty) return;
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => {
      void (async () => {
        try {
          await saveVatDeliverySourceNotes(noteRef.current, actor);
          setNoteDirty(false);
          setNoteMsg("บันทึกโน้ตแล้ว");
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      })();
    }, 800);
    return () => {
      if (noteTimer.current) clearTimeout(noteTimer.current);
    };
  }, [actor, note, noteDirty]);

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

  async function onWipeMonth() {
    if (wipeBusy) return;
    const ok = window.confirm(
      `ล้างยอดเดลิเวอรี่เดือน ${formatThaiMonthKey(month)} เป็น 0?\n(ข้อมูลเดิมค้างในฐานข้อมูลจากระบบเก่า)`,
    );
    if (!ok) return;
    setWipeBusy(true);
    setError("");
    try {
      const saved = await wipeDeliveryTotalsForMonth(month, actor);
      setDraft(retToMonthBooksDraft(saved));
      setLocked(saved.status === "filed");
      setDirty(false);
      setMsg(`ล้างยอดเดลิเวอรี่ ${formatThaiMonthKey(month)} แล้ว`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWipeBusy(false);
    }
  }

  async function onWipeAll() {
    if (wipeBusy) return;
    const ok = window.confirm(
      "ล้างยอดเดลิเวอรี่ทุกเดือน เป็น 0 และลบแถวนำเข้ารายวันเก่า?\nตัวเลขที่เห็นตอนนี้มาจากฐานข้อมูลระบบเก่า — ไม่ใช่ข้อมูลใหม่",
    );
    if (!ok) return;
    setWipeBusy(true);
    setError("");
    try {
      const report = await wipeAllDeliveryTotals(actor);
      await loadMonth(month);
      setMsg(summarizeWipe(report));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWipeBusy(false);
    }
  }

  return (
    <div className="vat-delivery-sources">
      <div className="vat-sales-toolbar">
        <label className="vat-month-pick">
          <span className="sr-only">เดือน</span>
          <select
            className="vat-thai-month-select"
            value={month}
            disabled={loading || wipeBusy}
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
      <p className="muted vat-sales-hint vat-hint-one-line">
        ตัวเลขที่เห็นอาจค้างจากระบบเก่าในฐานข้อมูล — ไม่ใช่จากหน้านี้โดยตรง
      </p>
      <div className="vat-wipe-actions">
        <button
          type="button"
          className="vat-mini-btn"
          disabled={wipeBusy || loading}
          onClick={() => void onWipeMonth()}
        >
          ล้างเดือนนี้
        </button>
        <button
          type="button"
          className="vat-mini-btn vat-mini-btn--danger"
          disabled={wipeBusy || loading}
          onClick={() => void onWipeAll()}
        >
          ล้างทุกเดือน (เริ่มใหม่)
        </button>
      </div>

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

      <section className="vat-table-block vat-source-notes" aria-label="โน้ต">
        <h3 className="vat-table-subtitle">โน้ต</h3>
        <textarea
          className="vat-source-notes-input"
          value={note}
          rows={6}
          spellCheck={false}
          placeholder="จดโน้ตเอง…"
          aria-label="โน้ตที่มายอดเดลิเวอรี่"
          onChange={(e) => {
            setNote(e.target.value);
            setNoteDirty(true);
            setNoteMsg("");
          }}
        />
        {noteMsg ? (
          <p className="muted vat-sales-hint vat-hint-one-line">{noteMsg}</p>
        ) : noteDirty ? (
          <p className="muted vat-sales-hint vat-hint-one-line">กำลังบันทึก…</p>
        ) : null}
      </section>
    </div>
  );
}
