"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { Trash2, X } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { TypePicker } from "@/components/TypePicker";
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { frequentTypes, guessTypeFromDescription } from "@/lib/ledger-labels";
import {
  addOwnerBookEntry,
  deleteOwnerBookEntry,
  frequentOwnerDescriptions,
  listOwnerBookEntries,
  OWNER_BOOKS_LIVE_MAX,
  OWNER_BOOKS_PAGE_SIZE,
  subscribeOwnerBooksPage,
  subscribeOwnerBooksTotalOut,
  updateOwnerBookEntry,
  type OwnerBookEntry,
} from "@/lib/owner-books";
import {
  compressImageForUpload,
  fileToReceiptDataUrl,
  saveImageToDevice,
} from "@/lib/receipts";
import {
  entryUpdatedAt,
  formatBaht,
  formatDateShort,
  formatDateTimeShort,
  formatPlainNumber,
  parseDateInput,
  todayInputValue,
} from "@/lib/utils";

export default function OwnerBooksPage() {
  return (
    <AuthGate>
      <OwnerBooksView />
    </AuthGate>
  );
}

function toDateInput(ms: number) {
  return todayInputValue(new Date(ms));
}

function OwnerBooksView() {
  const { user, staff } = useAuth();
  const router = useRouter();
  const [entries, setEntries] = useState<OwnerBookEntry[]>([]);
  const [totalOut, setTotalOut] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveLimit, setLiveLimit] = useState(OWNER_BOOKS_PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [editing, setEditing] = useState<OwnerBookEntry | null>(null);
  const [adding, setAdding] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (staff && !can(staff, "ownerBooks")) {
      router.replace("/ledger/");
    }
  }, [staff, router]);

  useEffect(() => {
    if (!can(staff, "ownerBooks")) return;
    return subscribeOwnerBooksTotalOut(
      (n) => setTotalOut(n),
      (err) => setError(err.message || "โหลดยอดไม่สำเร็จ"),
    );
  }, [staff]);

  useEffect(() => {
    if (!can(staff, "ownerBooks")) return;
    setLoading(true);
    const unsub = subscribeOwnerBooksPage(
      liveLimit,
      (page) => {
        setEntries(page.entries);
        setHasMore(page.hasMore);
        setLoading(false);
        setLoadingMore(false);
      },
      (err) => {
        setLoading(false);
        setLoadingMore(false);
        setError(err.message || "โหลดบัญชีไม่สำเร็จ");
      },
    );
    return unsub;
  }, [staff, liveLimit]);

  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore || liveLimit >= OWNER_BOOKS_LIVE_MAX) return;
    setLoadingMore(true);
    setLiveLimit((n) => Math.min(n + OWNER_BOOKS_PAGE_SIZE, OWNER_BOOKS_LIVE_MAX));
  }, [hasMore, loadingMore, liveLimit]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || loading) return;
    const observer = new IntersectionObserver(
      (items) => {
        if (items.some((item) => item.isIntersecting)) loadMore();
      },
      { root: null, rootMargin: "240px", threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore, loading, hasMore, entries.length]);

  if (!can(staff, "ownerBooks")) return null;

  return (
    <div>
      <div className="balance-bar">
        <span>รวมออก · บช.เจ้าของ</span>
        <strong>{totalOut == null ? "…" : formatBaht(totalOut)}</strong>
      </div>

      <div className="quick-actions">
        <button
          type="button"
          className="primary-btn action-out"
          onClick={() => setAdding(true)}
        >
          บันทึกเงินออก
        </button>
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading && entries.length === 0 ? (
        <p className="empty">ยังไม่มีรายการ — กดบันทึกเงินออกเพื่อเริ่ม</p>
      ) : !loading ? (
        <>
          <div className="sheet-wrap">
            <table className="sheet-table">
              <thead>
                <tr>
                  <th className="col-date">วันที่</th>
                  <th className="col-desc">รายการ</th>
                  <th className="col-out">ออก</th>
                  <th className="col-act">ประเภท</th>
                  <th className="col-note">note</th>
                  <th className="col-updated">แก้ไขล่าสุด</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((row) => (
                  <tr key={row.id} className="row-out">
                    <td className="col-date">{formatDateShort(row.date)}</td>
                    <td className="col-desc">
                      <button
                        type="button"
                        className="desc-link"
                        title="แตะเพื่อแก้ไข"
                        onClick={() => setEditing(row)}
                      >
                        {row.description}
                      </button>
                    </td>
                    <td className="col-out">
                      {row.amountOut > 0 ? formatPlainNumber(row.amountOut) : ""}
                    </td>
                    <td className="col-act">
                      <span className="muted" style={{ fontSize: "0.72rem" }}>
                        {row.type || "—"}
                      </span>
                    </td>
                    <td className="col-note" title={row.note || ""}>
                      {row.note || ""}
                    </td>
                    <td className="col-updated">{formatDateTimeShort(entryUpdatedAt(row))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div ref={sentinelRef} className="load-more-sentinel" aria-hidden />
          {loadingMore ? <p className="empty">กำลังโหลดเพิ่ม...</p> : null}
          {!hasMore && entries.length > 0 ? (
            <p className="empty muted-foot">
              {liveLimit >= OWNER_BOOKS_LIVE_MAX && entries.length >= OWNER_BOOKS_LIVE_MAX
                ? `แสดงล่าสุด ${entries.length} รายการ`
                : `ครบทุกรายการแล้ว (${entries.length})`}
            </p>
          ) : null}
        </>
      ) : null}

      {adding && user?.email ? (
        <OwnerEntryModal
          mode="add"
          createdBy={user.email}
          onClose={() => setAdding(false)}
          onSaved={() => setAdding(false)}
          onError={setError}
        />
      ) : null}

      {editing && user?.email ? (
        <OwnerEntryModal
          mode="edit"
          entry={editing}
          createdBy={user.email}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
          onError={setError}
        />
      ) : null}
    </div>
  );
}

function OwnerEntryModal({
  mode,
  entry,
  createdBy,
  onClose,
  onSaved,
  onError,
}: {
  mode: "add" | "edit";
  entry?: OwnerBookEntry;
  createdBy: string;
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [date, setDate] = useState(entry ? toDateInput(entry.date) : todayInputValue());
  const [description, setDescription] = useState(entry?.description || "");
  const [amount, setAmount] = useState(entry ? String(entry.amountOut) : "");
  const [typeMode, setTypeMode] = useState(() => (entry?.type || "").trim() || "auto");
  const [note, setNote] = useState(entry?.note || "");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [typeFreq, setTypeFreq] = useState<string[]>([]);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const autoType = useMemo(() => guessTypeFromDescription(description), [description]);
  const resolvedType = typeMode === "auto" ? autoType : typeMode;

  const filteredSuggestions = useMemo(() => {
    const q = description.trim().toLowerCase();
    if (!q) return suggestions.slice(0, 10);
    return suggestions.filter((s) => s.toLowerCase().includes(q)).slice(0, 10);
  }, [description, suggestions]);

  useEffect(() => {
    void listOwnerBookEntries()
      .then((rows) => {
        setSuggestions(frequentOwnerDescriptions(rows));
        setTypeFreq(frequentTypes(rows));
      })
      .catch(() => {
        setSuggestions([]);
        setTypeFreq([]);
      });
  }, []);

  useEffect(() => {
    return () => {
      if (receiptPreview) URL.revokeObjectURL(receiptPreview);
    };
  }, [receiptPreview]);

  async function handleReceiptFile(file: File | null) {
    if (!file) return;
    setNotice(null);
    try {
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
      onError((err as Error).message || "ใช้รูปไม่สำเร็จ");
    }
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      let receiptUrl = entry?.receiptUrl || "";
      if (receiptFile) {
        receiptUrl = await fileToReceiptDataUrl(receiptFile);
      }
      if (mode === "add") {
        await addOwnerBookEntry({
          date: parseDateInput(date),
          description,
          amountOut: Number(amount),
          type: resolvedType,
          createdBy,
          receiptUrl,
          note,
        });
      } else if (entry) {
        await updateOwnerBookEntry(entry.id, {
          date: parseDateInput(date),
          description,
          amountOut: Number(amount),
          type: resolvedType,
          receiptUrl,
          note,
        });
      }
      onSaved();
    } catch (err) {
      onError((err as Error).message || "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!entry) return;
    if (!window.confirm("ลบรายการนี้?")) return;
    setBusy(true);
    try {
      await deleteOwnerBookEntry(entry.id);
      onSaved();
    } catch (err) {
      onError((err as Error).message || "ลบไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop edit-modal" role="presentation">
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={mode === "add" ? "บันทึกเงินออก" : "แก้ไขรายการ"}
      >
        <div className="entry-toolbar">
          <h2 className="panel-title">{mode === "add" ? "บันทึกเงินออก" : "แก้ไขรายการ"}</h2>
          <button
            type="button"
            className="ghost-btn icon-btn"
            aria-label="ปิด"
            disabled={busy}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        {notice ? <p className="muted" style={{ margin: "0 0 0.55rem" }}>{notice}</p> : null}
        <form className="form-card entry-form" onSubmit={(e) => void onSave(e)}>
          <div className="field">
            <label htmlFor="ob-date">วันที่</label>
            <input
              id="ob-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="ob-desc">รายการ</label>
            <input
              id="ob-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
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
            <label htmlFor="ob-amount">เงินออก</label>
            <input
              id="ob-amount"
              type="number"
              min="0.01"
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>
          <TypePicker
            id="ob-type"
            value={typeMode}
            onChange={setTypeMode}
            frequent={typeFreq}
            autoHint={autoType}
          />
          <div className="field">
            <label htmlFor="ob-note">note</label>
            <input
              id="ob-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              autoComplete="off"
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
                ถ่ายรูป
              </button>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => galleryRef.current?.click()}
              >
                แนบรูป
              </button>
            </div>
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
            ) : entry?.receiptUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={entry.receiptUrl} alt="สลิปเดิม" className="receipt-preview" />
            ) : null}
          </div>

          <div className="entry-actions">
            <button type="submit" className="primary-btn" disabled={busy}>
              {busy ? "กำลังบันทึก..." : "บันทึก"}
            </button>
            <button type="button" className="ghost-btn" disabled={busy} onClick={onClose}>
              ออก
            </button>
            {mode === "edit" ? (
              <button
                type="button"
                className="trash-btn"
                aria-label="ลบรายการ"
                title="ลบรายการ"
                disabled={busy}
                onClick={() => void onDelete()}
              >
                <Trash2 size={16} />
              </button>
            ) : (
              <span aria-hidden style={{ width: "2.6rem" }} />
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
