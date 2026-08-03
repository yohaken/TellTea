"use client";

/**
 * แหล่งนำเข้าเดลิเวอรี่
 * AI แคป → ตารางพรีวิว (slim) → เซฟ draft (ยอด+รูป) / ส่งเข้าตารางหลัก
 * อัปโหลดทีหลัง: อ่านเฉพาะรูปใหม่ · คงช่องทางที่เซฟไว้
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VatSalesSubNav } from "@/components/vat-sales/VatSalesSubNav";
import {
  captureItemToIngestPreview,
  extractDeliveryCaptures,
  fileToImageDataUrl,
} from "@/lib/vat-delivery-capture-extract";
import {
  amountsHaveValue,
  deleteIngestDraft,
  emptyIngestByChannel,
  loadIngestDraft,
  clearIngestMonthConfirmed,
  needsIngestMonthConfirm,
  readIngestMonthConfirmed,
  saveIngestDraft,
  uploadIngestCaptureFile,
  writeIngestMonthConfirmed,
  type IngestDraftAmounts,
  type IngestDraftImage,
} from "@/lib/vat-delivery-ingest-draft";
import { formatIngestMoney } from "@/lib/vat-ingest-preview";
import {
  emptyChannelSource,
  mergeMonthSourcesIntoBooks,
  sumMonthSources,
  type MonthChannelSource,
  type MonthSourcesView,
} from "@/lib/vat-month-sources";
import {
  MONTH_CHANNEL_SHORT,
  MONTH_CHANNELS,
  type MonthChannel,
} from "@/lib/vat-month-books";
import {
  defaultVatCloseMonthKey,
  formatThaiMonthKey,
  listThaiMonthOptions,
} from "@/lib/vat-monthly";
import {
  moneyFieldValue,
  normalizeMoneyFieldText,
  parseVatMoneyInput,
} from "@/lib/vat-number-format";
import { normalizeMoney } from "@/lib/vat-sales";

type Props = { actor: string };

const MAX_CAPTURES = 3;

type RowAmounts = IngestDraftAmounts;

function emptyRows(): Record<MonthChannel, RowAmounts> {
  return emptyIngestByChannel();
}

function emptyStrRows(): Record<
  MonthChannel,
  Record<keyof RowAmounts, string>
> {
  return {
    grab: { sales: "", transfer: "", fee: "", gpVat: "" },
    shopee: { sales: "", transfer: "", fee: "", gpVat: "" },
    lineman: { sales: "", transfer: "", fee: "", gpVat: "" },
  };
}

function rowsToSources(
  monthKey: string,
  rows: Record<MonthChannel, RowAmounts>,
): MonthSourcesView {
  const byChannel = {} as Record<MonthChannel, MonthChannelSource>;
  for (const k of MONTH_CHANNELS) {
    const r = rows[k];
    byChannel[k] = {
      ...emptyChannelSource(k),
      sales: normalizeMoney(r.sales),
      transfer: normalizeMoney(r.transfer),
      fee: normalizeMoney(r.fee),
      gpVat: normalizeMoney(r.gpVat),
      kind:
        k === "grab"
          ? "grab-rollup"
          : k === "shopee"
            ? "shopee-monthly"
            : "lineman-monthly",
      note: "จากแคป AI",
    };
  }
  return { monthKey, byChannel, totals: sumMonthSources(byChannel) };
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
      onBlur={() => {
        const next = normalizeMoneyFieldText(value);
        if (next !== value) onChange(next);
      }}
    />
  );
}

export function VatIngestSources({ actor }: Props) {
  const monthOptions = useMemo(() => listThaiMonthOptions(undefined, 18), []);
  /** ช่วงปิดงบต้นเดือน → เปิดเดือนก่อน (เช่น ส.ค. → ก.ค.) */
  const [monthKey, setMonthKey] = useState(() => defaultVatCloseMonthKey());
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingChannels, setPendingChannels] = useState<
    Array<MonthChannel | "unknown">
  >([]);
  const [savedImages, setSavedImages] = useState<IngestDraftImage[]>([]);
  const [rows, setRows] = useState<Record<MonthChannel, RowAmounts>>(emptyRows);
  const [strRows, setStrRows] =
    useState<Record<MonthChannel, Record<keyof RowAmounts, string>>>(
      emptyStrRows,
    );
  const [busy, setBusy] = useState<"ai" | "save" | "push" | "load" | null>(
    null,
  );
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [draftSavedAt, setDraftSavedAt] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [monthConfirmOpen, setMonthConfirmOpen] = useState(false);
  const [confirmMonthKey, setConfirmMonthKey] = useState(() =>
    defaultVatCloseMonthKey(),
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const pendingPickAfterLoadRef = useRef(false);
  const confirmedMonthsRef = useRef<Set<string>>(new Set());

  const totals = useMemo(() => {
    let sales = 0;
    let transfer = 0;
    let fee = 0;
    let gpVat = 0;
    for (const k of MONTH_CHANNELS) {
      sales += rows[k].sales;
      transfer += rows[k].transfer;
      fee += rows[k].fee;
      gpVat += rows[k].gpVat;
    }
    return {
      sales: normalizeMoney(sales),
      transfer: normalizeMoney(transfer),
      fee: normalizeMoney(fee),
      gpVat: normalizeMoney(gpVat),
    };
  }, [rows]);

  const hasAny = useMemo(
    () => MONTH_CHANNELS.some((k) => amountsHaveValue(rows[k])),
    [rows],
  );

  const slotUsed = savedImages.length + pendingFiles.length;
  const canAddMore = slotUsed < MAX_CAPTURES;

  const applyPreviewRows = useCallback(
    (next: Record<MonthChannel, RowAmounts>, markDirty = true) => {
      setRows(next);
      setStrRows({
        grab: {
          sales: moneyFieldValue(next.grab.sales),
          transfer: moneyFieldValue(next.grab.transfer),
          fee: moneyFieldValue(next.grab.fee),
          gpVat: moneyFieldValue(next.grab.gpVat),
        },
        shopee: {
          sales: moneyFieldValue(next.shopee.sales),
          transfer: moneyFieldValue(next.shopee.transfer),
          fee: moneyFieldValue(next.shopee.fee),
          gpVat: moneyFieldValue(next.shopee.gpVat),
        },
        lineman: {
          sales: moneyFieldValue(next.lineman.sales),
          transfer: moneyFieldValue(next.lineman.transfer),
          fee: moneyFieldValue(next.lineman.fee),
          gpVat: moneyFieldValue(next.lineman.gpVat),
        },
      });
      if (markDirty) setDirty(true);
    },
    [],
  );

  const hydrateDraft = useCallback(
    async (key: string) => {
      setBusy("load");
      setError("");
      setMsg("");
      setPendingFiles([]);
      setPendingChannels([]);
      try {
        const draft = await loadIngestDraft(key);
        if (!draft) {
          applyPreviewRows(emptyRows(), false);
          setSavedImages([]);
          setDraftSavedAt(0);
          setDirty(false);
          return;
        }
        applyPreviewRows(draft.byChannel, false);
        setSavedImages(draft.images);
        setDraftSavedAt(draft.updatedAt);
        setDirty(false);
        if (draft.images.length) {
          confirmedMonthsRef.current.add(key);
          writeIngestMonthConfirmed(key);
        }
        setMsg(
          draft.updatedAt
            ? `โหลดพรีวิวที่เซฟไว้ · ${new Date(draft.updatedAt).toLocaleString("th-TH")}`
            : "โหลดพรีวิวที่เซฟไว้",
        );
      } catch (e) {
        applyPreviewRows(emptyRows(), false);
        setSavedImages([]);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
        if (pendingPickAfterLoadRef.current) {
          pendingPickAfterLoadRef.current = false;
          queueMicrotask(() => inputRef.current?.click());
        }
      }
    },
    [applyPreviewRows],
  );

  useEffect(() => {
    void hydrateDraft(monthKey);
  }, [monthKey, hydrateDraft]);

  const setField = useCallback(
    (ch: MonthChannel, field: keyof RowAmounts, raw: string) => {
      setStrRows((s) => ({
        ...s,
        [ch]: { ...s[ch], [field]: raw },
      }));
      setRows((r) => ({
        ...r,
        [ch]: { ...r[ch], [field]: parseVatMoneyInput(raw) },
      }));
      setDirty(true);
    },
    [],
  );

  const onPickFiles = useCallback(
    (list: FileList | null) => {
      if (!list?.length) return;
      const next = [...pendingFiles];
      for (const f of Array.from(list)) {
        if (!f.type.startsWith("image/")) continue;
        if (savedImages.length + next.length >= MAX_CAPTURES) break;
        next.push(f);
      }
      const clipped = next.slice(0, MAX_CAPTURES - savedImages.length);
      setPendingFiles(clipped);
      setPendingChannels((prev) =>
        clipped.map((_, i) => prev[i] || ("unknown" as const)),
      );
      setError("");
      setDirty(true);
    },
    [pendingFiles, savedImages.length],
  );

  const openFilePicker = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const onAddCaptureClick = useCallback(() => {
    const already =
      confirmedMonthsRef.current.has(monthKey) ||
      readIngestMonthConfirmed(monthKey);
    if (
      needsIngestMonthConfirm({
        hasSavedImages: savedImages.length > 0,
        alreadyConfirmed: already,
      })
    ) {
      setConfirmMonthKey(monthKey);
      setMonthConfirmOpen(true);
      return;
    }
    openFilePicker();
  }, [monthKey, openFilePicker, savedImages.length]);

  const confirmMonthAndPick = useCallback(() => {
    const key = confirmMonthKey;
    confirmedMonthsRef.current.add(key);
    writeIngestMonthConfirmed(key);
    setMonthConfirmOpen(false);
    if (key !== monthKey) {
      pendingPickAfterLoadRef.current = true;
      setMonthKey(key);
      return;
    }
    openFilePicker();
  }, [confirmMonthKey, monthKey, openFilePicker]);

  const clearAll = useCallback(async () => {
    setBusy("save");
    setError("");
    setMsg("");
    try {
      await deleteIngestDraft(monthKey);
      setPendingFiles([]);
      setPendingChannels([]);
      setSavedImages([]);
      applyPreviewRows(emptyRows(), false);
      setDraftSavedAt(0);
      setDirty(false);
      confirmedMonthsRef.current.delete(monthKey);
      clearIngestMonthConfirmed(monthKey);
      if (inputRef.current) inputRef.current.value = "";
      setMsg("ล้างพรีวิวแล้ว");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [applyPreviewRows, monthKey]);

  const runAi = useCallback(async () => {
    if (!pendingFiles.length) {
      setError(
        savedImages.length
          ? "เพิ่มแคปรูปใหม่ก่อน — ช่องทางที่เซฟไว้จะไม่ถูกอ่านซ้ำ"
          : "เลือกแคปจออย่างน้อย 1 รูป (สูงสุด 3)",
      );
      return;
    }
    setBusy("ai");
    setError("");
    setMsg("");
    try {
      const images = await Promise.all(
        pendingFiles.map((f) => fileToImageDataUrl(f)),
      );
      const res = await extractDeliveryCaptures({ monthKey, images });
      // คงยอดเดิม · ทับเฉพาะช่องทางที่อ่านได้จากรูปใหม่
      const next: Record<MonthChannel, RowAmounts> = {
        grab: { ...rowsRef.current.grab },
        shopee: { ...rowsRef.current.shopee },
        lineman: { ...rowsRef.current.lineman },
      };
      const notes: string[] = [];
      const fileChannels: Array<MonthChannel | "unknown"> = pendingFiles.map(
        () => "unknown",
      );
      for (const item of res.items || []) {
        const idx = item.imageIndex;
        if (
          Number.isFinite(idx) &&
          idx >= 0 &&
          idx < fileChannels.length &&
          (item.channel === "grab" ||
            item.channel === "shopee" ||
            item.channel === "lineman")
        ) {
          fileChannels[idx] = item.channel;
        }
      }
      for (const ch of MONTH_CHANNELS) {
        const item = res.byChannel?.[ch];
        if (!item) continue;
        const p = captureItemToIngestPreview(item);
        if (!(p.ok || (p.amounts?.sales || 0) > 0 || (p.amounts?.transfer || 0) > 0)) {
          continue;
        }
        next[ch] = {
          sales: p.amounts?.sales || 0,
          transfer: p.amounts?.transfer || 0,
          fee: p.amounts?.fee || 0,
          gpVat: p.amounts?.gpVat || 0,
        };
        notes.push(
          `${MONTH_CHANNEL_SHORT[ch]} ${formatIngestMoney(next[ch].sales)}`,
        );
      }
      applyPreviewRows(next, true);
      setPendingChannels(fileChannels);
      if (res.errors?.length) setError(res.errors.slice(0, 3).join(" · "));
      const kept = MONTH_CHANNELS.filter(
        (k) =>
          !notes.some((n) => n.startsWith(MONTH_CHANNEL_SHORT[k])) &&
          amountsHaveValue(next[k]),
      ).map((k) => MONTH_CHANNEL_SHORT[k]);
      setMsg(
        [
          notes.length
            ? `อ่านรูปใหม่ · ${notes.join(" · ")}`
            : "อ่านรูปใหม่แล้ว แต่จัดช่องทางไม่ได้",
          kept.length ? `คงไว้ ${kept.join(" · ")}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [pendingFiles, monthKey, applyPreviewRows, savedImages.length]);

  const saveDraft = useCallback(async () => {
    if (!hasAny && !pendingFiles.length && !savedImages.length) {
      setError("ยังไม่มีอะไรให้เซฟ");
      return;
    }
    setBusy("save");
    setError("");
    setMsg("เซฟยอด…");
    const filesToUpload = [...pendingFiles];
    const channelsToUpload = [...pendingChannels];
    try {
      // 1) เซฟยอดก่อน — UI ได้ feedback เร็ว ไม่รอรูป
      let images = [...savedImages];
      let saved = await saveIngestDraft({
        monthKey,
        byChannel: rows,
        images,
        updatedAt: Date.now(),
        updatedBy: actor,
      });
      setDraftSavedAt(saved.updatedAt);
      setDirty(false);
      if (!filesToUpload.length) {
        setMsg(
          `เซฟแล้ว · รูป ${saved.images.length} · ${formatThaiMonthKey(monthKey)}`,
        );
        return;
      }

      // 2) บันทึกรูปใหม่ทีละใบ → evidencePhotos (ไม่ผ่าน Storage)
      const uploaded: IngestDraftImage[] = [];
      const uploadErrors: string[] = [];
      for (let i = 0; i < filesToUpload.length; i += 1) {
        setMsg(`บันทึกรูป ${i + 1}/${filesToUpload.length}…`);
        try {
          const img = await uploadIngestCaptureFile({
            file: filesToUpload[i],
            monthKey,
          });
          const ch = channelsToUpload[i];
          uploaded.push({
            ...img,
            channel:
              ch === "grab" || ch === "shopee" || ch === "lineman"
                ? ch
                : "unknown",
          });
        } catch (e) {
          uploadErrors.push(
            `รูป ${i + 1}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }

      if (uploaded.length) {
        images = [...savedImages, ...uploaded].slice(0, MAX_CAPTURES);
        saved = await saveIngestDraft({
          monthKey,
          byChannel: rows,
          images,
          updatedAt: Date.now(),
          updatedBy: actor,
        });
        confirmedMonthsRef.current.add(monthKey);
        writeIngestMonthConfirmed(monthKey);
      }

      setSavedImages(saved.images);
      setPendingFiles([]);
      setPendingChannels([]);
      setDraftSavedAt(saved.updatedAt);
      setDirty(false);
      if (uploadErrors.length) {
        setError(uploadErrors.slice(0, 2).join(" · "));
        setMsg(
          `เซฟยอดแล้ว · รูปบางใบไม่ขึ้น (${saved.images.length} ใบ)`,
        );
      } else {
        setMsg(
          `เซฟแล้ว · รูป ${saved.images.length} · ${formatThaiMonthKey(monthKey)}`,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setMsg("");
    } finally {
      setBusy(null);
    }
  }, [
    actor,
    hasAny,
    monthKey,
    pendingChannels,
    pendingFiles,
    rows,
    savedImages,
  ]);

  const pushToMain = useCallback(async () => {
    if (!hasAny) {
      setError("ยังไม่มียอดในตารางพรีวิว");
      return;
    }
    setBusy("push");
    setError("");
    setMsg("");
    try {
      if (dirty || pendingFiles.length) {
        setMsg("เซฟยอดก่อนส่ง…");
        let images = [...savedImages];
        for (let i = 0; i < pendingFiles.length; i += 1) {
          setMsg(`บันทึกรูป ${i + 1}/${pendingFiles.length}…`);
          try {
            const img = await uploadIngestCaptureFile({
              file: pendingFiles[i],
              monthKey,
            });
            const ch = pendingChannels[i];
            images.push({
              ...img,
              channel:
                ch === "grab" || ch === "shopee" || ch === "lineman"
                  ? ch
                  : "unknown",
            });
          } catch {
            /* ส่งยอดได้แม้รูปบางใบพลาด */
          }
        }
        images = images.slice(0, MAX_CAPTURES);
        const saved = await saveIngestDraft({
          monthKey,
          byChannel: rows,
          images,
          updatedAt: Date.now(),
          updatedBy: actor,
        });
        setSavedImages(saved.images);
        setPendingFiles([]);
        setPendingChannels([]);
        setDraftSavedAt(saved.updatedAt);
        setDirty(false);
      }
      const sources = rowsToSources(monthKey, rows);
      const res = await mergeMonthSourcesIntoBooks({
        monthKey,
        sources,
        actor,
      });
      if (res.skipped) {
        setError(res.reason || "ข้ามการอัปเดต");
        return;
      }
      setMsg(`ส่งเข้าตารางหลักแล้ว · ${formatThaiMonthKey(monthKey)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [
    actor,
    dirty,
    hasAny,
    monthKey,
    pendingChannels,
    pendingFiles,
    rows,
    savedImages,
  ]);

  const removeSavedImage = useCallback((id: string) => {
    setSavedImages((prev) => prev.filter((x) => x.id !== id));
    setDirty(true);
  }, []);

  const locked = busy !== null;

  return (
    <div
      className="vat-ingest-page"
      id="vat-delivery-ingest"
      data-ai-context="vat-delivery-ingest-save-month-confirm"
    >
      <VatSalesSubNav active="sources" />
      <div className="vat-ingest-mail-bar">
        <label className="vat-month-pick">
          <span className="muted">เดือน</span>
          <select
            value={monthKey}
            disabled={locked}
            onChange={(e) => setMonthKey(e.target.value)}
            aria-label="เดือนเป้าหมาย"
          >
            {monthOptions.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {draftSavedAt > 0 ? (
          <span className="muted vat-ingest-hint">
            เซฟแล้ว{dirty ? " · มีแก้ยังไม่เซฟ" : ""}
          </span>
        ) : null}
      </div>

      <section className="vat-ingest-ai-box" aria-label="กล่อง AI แคปจอ">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="vat-ingest-file"
          aria-label="เลือกแคปจอสูงสุด 3 รูป"
          onChange={(e) => {
            onPickFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <div className="vat-ingest-ai-actions">
          <button
            type="button"
            className="ghost-btn vat-sales-act-btn"
            disabled={locked || !canAddMore}
            onClick={onAddCaptureClick}
          >
            เพิ่มแคป
          </button>
          <button
            type="button"
            className="primary-btn vat-sales-act-btn"
            disabled={locked || !pendingFiles.length}
            onClick={() => void runAi()}
          >
            {busy === "ai" ? "AI กำลังอ่าน…" : "อ่านรูปใหม่"}
          </button>
        </div>
        {savedImages.length || pendingFiles.length ? (
          <ul className="vat-ingest-file-list">
            {savedImages.map((img, i) => (
              <li key={img.id}>
                <span>
                  {i + 1}. {img.fileName}
                  {img.channel !== "unknown"
                    ? ` · ${MONTH_CHANNEL_SHORT[img.channel]}`
                    : ""}{" "}
                  <span className="muted">เซฟแล้ว</span>
                </span>
                <button
                  type="button"
                  className="ghost-btn vat-sales-act-btn"
                  disabled={locked}
                  onClick={() => removeSavedImage(img.id)}
                >
                  ลบ
                </button>
              </li>
            ))}
            {pendingFiles.map((f, i) => (
              <li key={`p-${f.name}-${i}`}>
                <span>
                  {savedImages.length + i + 1}. {f.name}{" "}
                  <span className="muted">ใหม่</span>
                </span>
                <button
                  type="button"
                  className="ghost-btn vat-sales-act-btn"
                  disabled={locked}
                  onClick={() => {
                    setPendingFiles((prev) => prev.filter((_, j) => j !== i));
                    setPendingChannels((prev) =>
                      prev.filter((_, j) => j !== i),
                    );
                  }}
                >
                  ลบ
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted vat-ingest-hint">
            แคป ≤3 · อ่านเฉพาะรูปใหม่ · เดือน {formatThaiMonthKey(monthKey)}
          </p>
        )}
      </section>

      {msg ? <p className="muted vat-sales-msg">{msg}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}

      <section className="vat-table-block vat-month-sources vat-ingest-preview-block">
        <h2 className="vat-table-title vat-ingest-preview-title">
          พรีวิว — {formatThaiMonthKey(monthKey)}
        </h2>
        <div className="vat-ingest-preview-wrap">
          <table className="vat-ingest-preview-slim">
            <thead>
              <tr>
                <th>ช่อง</th>
                <th title="ยอดขายแอพ → VAT">ขาย</th>
                <th title="ยอดโอน → รายได้">โอน</th>
                <th title="คชจ.GP ex-VAT">คชจ.</th>
                <th title="VAT-ซื้อ ของ GP">VAT</th>
              </tr>
            </thead>
            <tbody>
              {MONTH_CHANNELS.map((k) => (
                <tr key={k}>
                  <td className="col-seg">{MONTH_CHANNEL_SHORT[k]}</td>
                  {(
                    ["sales", "transfer", "fee", "gpVat"] as const
                  ).map((field) => (
                    <td key={field} className="col-num">
                      <MoneyCell
                        value={strRows[k][field]}
                        locked={locked}
                        ariaLabel={`${field} ${MONTH_CHANNEL_SHORT[k]}`}
                        onChange={(v) => setField(k, field, v)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="vat-ingest-total-row">
                <td className="col-seg">รวม</td>
                <td className="col-num col-net">
                  {formatIngestMoney(totals.sales)}
                </td>
                <td className="col-num col-net">
                  {formatIngestMoney(totals.transfer)}
                </td>
                <td className="col-num col-net">
                  {formatIngestMoney(totals.fee)}
                </td>
                <td className="col-num col-net">
                  {formatIngestMoney(totals.gpVat)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <div className="vat-ingest-push-bar">
        <button
          type="button"
          className="ghost-btn vat-sales-act-btn"
          disabled={
            locked || (!pendingFiles.length && !savedImages.length && !hasAny)
          }
          onClick={() => void clearAll()}
        >
          ล้าง
        </button>
        <button
          type="button"
          className="ghost-btn vat-sales-act-btn"
          disabled={
            locked ||
            (!dirty && !pendingFiles.length && draftSavedAt > 0) ||
            (!hasAny && !pendingFiles.length && !savedImages.length)
          }
          onClick={() => void saveDraft()}
        >
          {busy === "save" ? "กำลังเซฟ…" : "เซฟ"}
        </button>
        <button
          type="button"
          className="primary-btn vat-sales-act-btn"
          disabled={locked || !hasAny}
          onClick={() => void pushToMain()}
        >
          {busy === "push" ? "กำลังส่ง…" : "ส่งเข้าตารางหลัก"}
        </button>
      </div>

      {monthConfirmOpen ? (
        <div
          className="modal-backdrop edit-modal is-module-form vat-ingest-month-confirm"
          role="presentation"
          onClick={() => setMonthConfirmOpen(false)}
        >
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-label="ยืนยันเดือนก่อนเพิ่มแคป"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="entry-toolbar module-form-head">
              <h2 className="panel-title">เดือนถูกต้องไหม?</h2>
            </div>
            <p className="muted form-hint-inline vat-ingest-month-confirm-hint">
              ถามครั้งแรกของเดือนเมื่อยังไม่เคยอัปแคป — กันอัปผิดเดือน
            </p>
            <label className="vat-month-pick vat-ingest-month-confirm-pick">
              <span className="muted">เดือนเป้าหมาย</span>
              <select
                value={confirmMonthKey}
                onChange={(e) => setConfirmMonthKey(e.target.value)}
                aria-label="เลือกเดือนเป้าหมาย"
              >
                {monthOptions.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="vat-ingest-month-confirm-focus">
              จะอัปเข้า <strong>{formatThaiMonthKey(confirmMonthKey)}</strong>
            </p>
            <div className="entry-actions vat-ingest-month-confirm-actions">
              <button
                type="button"
                className="ghost-btn vat-sales-act-btn"
                onClick={() => setMonthConfirmOpen(false)}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className="primary-btn vat-sales-act-btn"
                onClick={confirmMonthAndPick}
              >
                ใช่ · เลือกไฟล์
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
