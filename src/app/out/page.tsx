"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { useAuth } from "@/lib/auth";
import { addLedgerEntry, frequentDescriptions, listRecentLedgerEntries } from "@/lib/ledger";
import { guessTypeFromDescription, labelLedgerType } from "@/lib/ledger-labels";
import {
  compressImageForUpload,
  fileToReceiptDataUrl,
  saveImageToDevice,
} from "@/lib/receipts";
import { parseDateInput, todayInputValue } from "@/lib/utils";

const TYPE_OPTIONS = [
  { value: "auto", label: "อัตโนมัติจากชื่อรายการ" },
  { value: "cogs", label: "ต้นทุน (cogs)" },
  { value: "sga", label: "ค่าใช้จ่าย (sga)" },
  { value: "asset", label: "สินทรัพย์ (asset)" },
  { value: "อื่นๆ", label: "อื่นๆ" },
];

export default function MoneyOutPage() {
  return (
    <AuthGate>
      <MoneyOutView />
    </AuthGate>
  );
}

function MoneyOutView() {
  const { user, staff } = useAuth();
  const router = useRouter();
  const isOwner = staff?.role === "owner";
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const [date, setDate] = useState(todayInputValue());
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [typeMode, setTypeMode] = useState("auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);

  const autoType = useMemo(() => guessTypeFromDescription(description), [description]);
  const resolvedType = typeMode === "auto" ? autoType : typeMode;

  const filteredSuggestions = useMemo(() => {
    const q = description.trim().toLowerCase();
    if (!q) return suggestions.slice(0, 8);
    return suggestions.filter((s) => s.toLowerCase().includes(q)).slice(0, 8);
  }, [description, suggestions]);

  useEffect(() => {
    void listRecentLedgerEntries(200)
      .then((entries) => setSuggestions(frequentDescriptions(entries)))
      .catch(() => setSuggestions([]));
  }, []);

  useEffect(() => {
    return () => {
      if (receiptPreview) URL.revokeObjectURL(receiptPreview);
    };
  }, [receiptPreview]);

  async function handleReceiptFile(file: File | null) {
    if (!file) return;
    setError(null);
    setNotice(null);
    try {
      // บันทึกลงเครื่องทันทีหลังถ่าย/เลือก — iPhone ใช้ Share, Android ดาวน์โหลด
      const how = await saveImageToDevice(file);
      setNotice(
        how === "shared"
          ? "เปิดเมนูแชร์แล้ว — เลือกบันทึกรูปลงเครื่องได้"
          : "บันทึกรูปลงเครื่องแล้ว",
      );
      const compressed = await compressImageForUpload(file);
      if (receiptPreview) URL.revokeObjectURL(receiptPreview);
      setReceiptFile(compressed);
      setReceiptPreview(URL.createObjectURL(compressed));
    } catch (err) {
      setError((err as Error).message || "ใช้รูปไม่สำเร็จ");
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user?.email) return;
    setBusy(true);
    setError(null);
    try {
      let receiptUrl = "";
      if (receiptFile) {
        receiptUrl = await fileToReceiptDataUrl(receiptFile);
      }
      await addLedgerEntry({
        date: parseDateInput(date),
        description,
        amountIn: 0,
        amountOut: Number(amount),
        type: resolvedType,
        createdBy: user.email,
        receiptUrl,
      });
      router.replace("/ledger/");
    } catch (err) {
      setError((err as Error).message || "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="panel-title">บันทึกเงินออก</h1>
      <p className="muted" style={{ marginBottom: "1rem", textAlign: "left" }}>
        ใส่วันที่ รายการ จำนวนเงิน — ถ่ายสลิปด้วยกล้องเต็มจอได้ทั้ง iPhone และ Android
      </p>
      {error ? <p className="error-text">{error}</p> : null}
      {notice ? <p className="muted">{notice}</p> : null}

      <form className="form-card" onSubmit={(e) => void onSubmit(e)}>
        <div className="field">
          <label htmlFor="date">วันที่</label>
          <input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>

        <div className="field">
          <label htmlFor="description">รายการ</label>
          <input
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="เช่น ค่าน้ำแข็ง / แม็คโคร"
            autoComplete="off"
            required
          />
          {filteredSuggestions.length > 0 ? (
            <div className="suggest-list" role="listbox" aria-label="รายการที่ใช้บ่อย">
              {filteredSuggestions.map((item) => (
                <button
                  key={item}
                  type="button"
                  className="suggest-chip"
                  onClick={() => setDescription(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="amount">จำนวนเงินออก (บาท)</label>
          <input
            id="amount"
            type="number"
            min="0.01"
            step="0.01"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="250"
            required
          />
        </div>

        <div className="field">
          <span className="field-label">สลิป / รูปถ่าย</span>
          <div className="receipt-actions">
            <button
              type="button"
              className="primary-btn"
              onClick={() => cameraRef.current?.click()}
            >
              ถ่ายด้วยกล้อง
            </button>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => galleryRef.current?.click()}
            >
              เลือกจากคลังรูป
            </button>
          </div>
          {/* capture=environment = เปิดกล้องหลังแบบ native เต็มฟังก์ชัน บน iOS/Android */}
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(e) => void handleReceiptFile(e.target.files?.[0] || null)}
          />
          <input
            ref={galleryRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => void handleReceiptFile(e.target.files?.[0] || null)}
          />
          {receiptPreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={receiptPreview} alt="ตัวอย่างสลิป" className="receipt-preview" />
          ) : (
            <p className="muted" style={{ marginTop: "0.5rem", textAlign: "left" }}>
              ถ่ายแล้วระบบพยายามบันทึกลงเครื่องทันที แล้วแนบเข้าบิลนี้
            </p>
          )}
        </div>

        {isOwner ? (
          <div className="field">
            <label htmlFor="type">หมวด (เจ้าของแก้ได้ · พนักงานไม่เห็นช่องนี้)</label>
            <select id="type" value={typeMode} onChange={(e) => setTypeMode(e.target.value)}>
              {TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {typeMode === "auto" && description ? (
              <p className="muted" style={{ marginTop: "0.35rem", textAlign: "left" }}>
                จะบันทึกเป็น: {labelLedgerType(autoType)}
              </p>
            ) : null}
          </div>
        ) : null}

        <button type="submit" className="primary-btn action-out" disabled={busy}>
          {busy ? "กำลังบันทึก..." : "บันทึกเงินออก"}
        </button>
      </form>
    </div>
  );
}
