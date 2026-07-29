"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  formatVatMoney,
  normalizeMoneyFieldText,
  parseVatMoneyInput,
} from "@/lib/vat-number-format";
import {
  createVatInputInvoice,
  deleteVatInputInvoice,
  listVatInputInvoices,
  sumVatInput,
  type VatInputInvoice,
} from "@/lib/vat-input";
import { uploadEvidencePhotos } from "@/lib/photo-upload";
import { computeVatFromGross, roundMoney } from "@/lib/vat-sales";

function fmt(n: number) {
  if (!Number.isFinite(n)) return "—";
  return formatVatMoney(n);
}

type Props = {
  month: string;
  onMonthChange: (m: string) => void;
  actor: string;
  busy: string | null;
  setBusy: (v: string | null) => void;
  setError: (v: string) => void;
  setMsg: (v: string) => void;
  /** VAT ขายรวมเดือน (จากตารางรายวัน) — แสดงเทียบสุทธิ */
  outputVat?: number;
};

export function VatSalesInputVatPanel({
  month,
  onMonthChange,
  actor,
  busy,
  setBusy,
  setError,
  setMsg,
  outputVat = 0,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<VatInputInvoice[]>([]);
  const [dateKey, setDateKey] = useState(`${month}-01`);
  const [vendor, setVendor] = useState("");
  const [description, setDescription] = useState("");
  const [gross, setGross] = useState("");
  const [vatOverride, setVatOverride] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    if (!dateKey.startsWith(month)) setDateKey(`${month}-01`);
  }, [month, dateKey]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setRows(await listVatInputInvoices(month));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [month, setError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const totals = useMemo(() => sumVatInput(rows), [rows]);
  const netVat = roundMoney(outputVat - totals.vatInput);

  const previewVat = useMemo(() => {
    const g = parseVatMoneyInput(gross);
    if (!gross.trim() || g < 0) return null;
    if (vatOverride.trim()) {
      const v = parseVatMoneyInput(vatOverride);
      if (v < 0) return null;
      return { vatBase: roundMoney(Math.max(0, g - v)), vatAmount: roundMoney(v) };
    }
    const c = computeVatFromGross(g);
    return { vatBase: c.vatBase, vatAmount: c.vatOutput };
  }, [gross, vatOverride]);

  const addRow = async () => {
    setBusy("vat-input-add");
    setError("");
    setMsg("");
    try {
      const g = parseVatMoneyInput(gross);
      if (!gross.trim() || g < 0) throw new Error("ยอดรวมไม่ถูกต้อง");
      let evidenceRef = "";
      if (file) {
        const refs = await uploadEvidencePhotos([file], {
          folder: "vat-input",
          slotKey: dateKey,
        });
        evidenceRef = refs[0] || "";
      }
      const vatInput =
        vatOverride.trim() !== ""
          ? parseVatMoneyInput(vatOverride)
          : undefined;
      await createVatInputInvoice(
        {
          dateKey,
          vendor,
          description,
          grossInclusive: g,
          vatInput,
          evidenceRef,
          note,
        },
        actor,
      );
      setVendor("");
      setDescription("");
      setGross("");
      setVatOverride("");
      setNote("");
      setFile(null);
      setMsg("บันทึกใบกำกับซื้อแล้ว");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (row: VatInputInvoice) => {
    if (!window.confirm(`ลบใบกำกับจาก ${row.vendor}?`)) return;
    setBusy(`vat-input-del-${row.id}`);
    setError("");
    try {
      await deleteVatInputInvoice(row.id);
      setMsg("ลบแล้ว");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="vat-input-panel">
      <section className="vat-sales-settings vat-sales-settings--slim">
        <h2 className="vat-sales-section-title">ภาษีซื้อ</h2>
        <p className="muted vat-sales-hint">owner · ใบกำกับ · แนบรูปได้</p>
        <div className="vat-sales-toolbar vat-sales-toolbar--slim">
          <label className="vat-sales-month">
            เดือน
            <input
              type="month"
              value={month}
              onChange={(e) => onMonthChange(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="ghost-btn"
            disabled={busy !== null || loading}
            onClick={() => void refresh()}
          >
            รี
          </button>
        </div>
        <div className="vat-sales-summary vat-sales-summary--slim">
          <span>
            ซื้อ <strong>{fmt(totals.vatInput)}</strong>
          </span>
          <span>
            ขาย <strong>{fmt(outputVat)}</strong>
          </span>
          <span className="vat-sales-summary-main">
            สุทธิ <strong>{fmt(netVat)}</strong>
          </span>
        </div>
      </section>

      <section className="vat-sales-settings vat-sales-settings--slim">
        <h3 className="vat-sales-section-title">เพิ่มใบกำกับ</h3>
        <div className="vat-sales-toolbar vat-sales-toolbar--slim" style={{ flexWrap: "wrap" }}>
          <label className="vat-sales-month">
            วันที่
            <input
              type="date"
              value={dateKey}
              onChange={(e) => setDateKey(e.target.value)}
            />
          </label>
          <label className="vat-sales-month">
            ผู้ขาย
            <input value={vendor} onChange={(e) => setVendor(e.target.value)} />
          </label>
          <label className="vat-sales-month">
            ยอดรวม
            <input
              inputMode="decimal"
              value={gross}
              placeholder="0.00"
              onChange={(e) => setGross(e.target.value)}
              onBlur={() => setGross(normalizeMoneyFieldText(gross))}
            />
          </label>
          <label className="vat-sales-field">
            VAT ซื้อ (ว่าง = คิด 7%)
            <input
              inputMode="decimal"
              value={vatOverride}
              onChange={(e) => setVatOverride(e.target.value)}
              onBlur={() =>
                setVatOverride(normalizeMoneyFieldText(vatOverride))
              }
              placeholder={
                previewVat ? formatVatMoney(previewVat.vatAmount) : ""
              }
            />
          </label>
          <label className="vat-sales-field">
            รายละเอียด
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label className="vat-sales-field">
            หมายเหตุ
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <label className="vat-sales-field">
            หลักฐานรูป
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </label>
        </div>
        {previewVat ? (
          <p className="muted">
            ตัวอย่าง · ฐาน {fmt(previewVat.vatBase)} · VAT {fmt(previewVat.vatAmount)}
          </p>
        ) : null}
        <button
          type="button"
          className="primary-btn"
          disabled={busy !== null || !vendor.trim() || !gross.trim()}
          onClick={() => void addRow()}
        >
          {busy === "vat-input-add" ? "กำลังบันทึก..." : "เพิ่มใบกำกับซื้อ"}
        </button>
      </section>

      {loading ? (
        <p className="muted">กำลังโหลด...</p>
      ) : rows.length === 0 ? (
        <p className="muted">ยังไม่มีใบกำกับซื้อในเดือนนี้</p>
      ) : (
        <div className="sheet-wrap vat-sales-scroll">
          <table className="sheet-table vat-sales-table vat-sales-table--slim vat-input-table">
            <thead>
              <tr>
                <th className="col-date">วัน</th>
                <th>ผู้ขาย</th>
                <th className="col-desc">รายละเอียด</th>
                <th className="col-num">ยอด</th>
                <th className="col-num">ฐาน</th>
                <th className="col-num">VAT</th>
                <th title="หลักฐาน">รูป</th>
                <th className="col-act" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} title={[r.vendor, r.description, r.note].filter(Boolean).join(" · ")}>
                  <td className="col-date">{r.dateKey.slice(8)}</td>
                  <td>{r.vendor}</td>
                  <td className="col-desc">
                    <div className="vat-mail-subject">{r.description || r.note || "—"}</div>
                  </td>
                  <td className="col-num">{fmt(r.grossInclusive)}</td>
                  <td className="col-num">{fmt(r.vatBase)}</td>
                  <td className="col-num">{fmt(r.vatInput)}</td>
                  <td>{r.evidenceRef ? "✓" : "—"}</td>
                  <td className="col-act">
                    <button
                      type="button"
                      className="ghost-btn vat-sales-act-btn"
                      disabled={busy !== null}
                      onClick={() => void remove(r)}
                    >
                      ลบ
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
