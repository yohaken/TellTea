"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatPlainNumber } from "@/lib/utils";
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
  if (!n && n !== 0) return "—";
  return formatPlainNumber(n);
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
    const g = Number(String(gross).replace(/,/g, ""));
    if (!Number.isFinite(g) || g < 0) return null;
    if (vatOverride.trim()) {
      const v = Number(String(vatOverride).replace(/,/g, ""));
      if (!Number.isFinite(v) || v < 0) return null;
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
      const g = Number(String(gross).replace(/,/g, ""));
      if (!Number.isFinite(g) || g < 0) throw new Error("ยอดรวมไม่ถูกต้อง");
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
          ? Number(String(vatOverride).replace(/,/g, ""))
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
      <section className="vat-sales-settings">
        <h2 className="vat-sales-section-title">ภาษีซื้อ (ใบกำกับซื้อ)</h2>
        <p className="muted vat-sales-hint">
          เจ้าของเท่านั้น · ไม่ปน ledger พนักงาน · แนบหลักฐานได้ (evp)
        </p>
        <div className="vat-sales-toolbar">
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
            รีเฟรช
          </button>
        </div>
        <div className="vat-sales-summary">
          <div className="vat-sales-summary-card">
            <span>ภาษีซื้อรวม</span>
            <strong>{fmt(totals.vatInput)}</strong>
          </div>
          <div className="vat-sales-summary-card">
            <span>ภาษีขาย (เดือนนี้)</span>
            <strong>{fmt(outputVat)}</strong>
          </div>
          <div className="vat-sales-summary-card vat-sales-summary-main">
            <span>VAT สุทธิ (ขาย − ซื้อ)</span>
            <strong>{fmt(netVat)}</strong>
          </div>
        </div>
      </section>

      <section className="vat-sales-settings">
        <h3 className="vat-sales-section-title">เพิ่มใบกำกับ</h3>
        <div className="vat-sales-toolbar" style={{ flexWrap: "wrap" }}>
          <label className="vat-sales-field">
            วันที่
            <input
              type="date"
              value={dateKey}
              onChange={(e) => setDateKey(e.target.value)}
            />
          </label>
          <label className="vat-sales-field">
            ผู้ขาย / ร้าน
            <input value={vendor} onChange={(e) => setVendor(e.target.value)} />
          </label>
          <label className="vat-sales-field">
            ยอดรวม (รวม VAT)
            <input
              inputMode="decimal"
              value={gross}
              onChange={(e) => setGross(e.target.value)}
            />
          </label>
          <label className="vat-sales-field">
            VAT ซื้อ (ว่าง = คิด 7%)
            <input
              inputMode="decimal"
              value={vatOverride}
              onChange={(e) => setVatOverride(e.target.value)}
              placeholder={previewVat ? String(previewVat.vatAmount) : ""}
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
          <table className="sheet-table vat-sales-table">
            <thead>
              <tr>
                <th>วันที่</th>
                <th>ผู้ขาย</th>
                <th>รายละเอียด</th>
                <th className="col-num">ยอดรวม</th>
                <th className="col-num">ฐาน</th>
                <th className="col-num">VAT ซื้อ</th>
                <th>หลักฐาน</th>
                <th className="col-act">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.dateKey}</td>
                  <td>{r.vendor}</td>
                  <td className="col-desc">{r.description || r.note || "—"}</td>
                  <td className="col-num">{fmt(r.grossInclusive)}</td>
                  <td className="col-num">{fmt(r.vatBase)}</td>
                  <td className="col-num">{fmt(r.vatInput)}</td>
                  <td>{r.evidenceRef ? "มี" : "—"}</td>
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
