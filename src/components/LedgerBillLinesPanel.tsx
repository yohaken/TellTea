"use client";

import { useMemo, useRef, useState } from "react";
import { PackagePlus, Sparkles } from "lucide-react";
import {
  applyLedgerBillLineToStock,
  classifyBillLineForCatalog,
  extractBillLinesFromPhotos,
  importUnmatchedBillLinesToStock,
  markBillLineCostApplied,
  rematchBillLinesToStock,
} from "@/lib/ledger-bill-lines";
import { canonicalLedgerType } from "@/lib/ledger-labels";
import { updateLedgerEntry } from "@/lib/ledger";
import { mapFirestoreError } from "@/lib/firestore-errors";
import type { LedgerBillLine, StockItem } from "@/lib/types";
import { formatDateShort, formatPlainNumber } from "@/lib/utils";

/**
 * รายการในบิล — โชว์ในรายละเอียดบัญชีเท่านั้น
 * · นำชื่อเข้าคลังได้ (ไม่ใส่ต้นทุน)
 * · ประเภทบช. ต้นทุน (cogs) → ถือว่าเป็นวัตถุดิบ นำเข้าก่อน
 * · เจ้าของยืนยันก่อนอัปเดตต้นทุนคลัง
 *
 * สำคัญ: AI แยกใช้ busy ในแผงนี้เท่านั้น — ไม่ setBusy ฟอร์มบัญชี
 */
export function LedgerBillLinesPanel({
  ledgerEntryId,
  receiptUrls,
  billLines,
  stock,
  isOwner,
  actorId,
  formBusy,
  setFormBusy,
  onLinesChange,
  onError,
  onMsg,
  ledgerType,
}: {
  ledgerEntryId: string | null;
  receiptUrls: string[];
  billLines: LedgerBillLine[];
  stock: StockItem[];
  isOwner: boolean;
  actorId: string;
  formBusy: boolean;
  setFormBusy: (v: boolean) => void;
  onLinesChange: (lines: LedgerBillLine[]) => void;
  onError: (msg: string | null) => void;
  onMsg?: (msg: string) => void;
  /** ประเภทบัญชีที่จัดไว้แล้ว — ต้นทุน = วัตถุดิบ */
  ledgerType?: string | null;
}) {
  const [pendingIdx, setPendingIdx] = useState<number | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [importing, setImporting] = useState(false);
  const extractGenRef = useRef(0);
  const isCogs = canonicalLedgerType(ledgerType) === "cogs";
  const costById = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of stock) {
      if (s.unitCost > 0) m.set(s.id, s.unitCost);
    }
    return m;
  }, [stock]);

  const pending =
    pendingIdx != null && pendingIdx >= 0 && pendingIdx < billLines.length
      ? billLines[pendingIdx]!
      : null;

  const unmatchedCount = useMemo(
    () => billLines.filter((l) => l.name && !l.matchStockItemId).length,
    [billLines],
  );

  const catalogCounts = useMemo(() => {
    let ingredient = 0;
    let uncertain = 0;
    let skip = 0;
    const opts = { ledgerType };
    for (const l of billLines) {
      if (!l.name || l.matchStockItemId) continue;
      const t = classifyBillLineForCatalog(l, opts);
      if (t === "ingredient") ingredient += 1;
      else if (t === "uncertain") uncertain += 1;
      else skip += 1;
    }
    return { ingredient, uncertain, skip };
  }, [billLines, ledgerType]);

  async function runExtract() {
    const refs = receiptUrls.filter(Boolean);
    if (!refs.length) {
      onMsg?.("ต้องมีรูปบิลก่อน");
      return;
    }
    const gen = ++extractGenRef.current;
    setExtracting(true);
    try {
      const lines = await extractBillLinesFromPhotos({
        imageRefs: refs,
        stock,
      });
      if (gen !== extractGenRef.current) return;
      onLinesChange(lines);
      if (ledgerEntryId) {
        await updateLedgerEntry(ledgerEntryId, { billLines: lines });
      }
      onMsg?.(
        lines.length
          ? `แยกรายการในบิลได้ ${lines.length} รายการ`
          : "ไม่พบรายการวัตถุดิบบนบิล",
      );
    } catch (e) {
      if (gen !== extractGenRef.current) return;
      onMsg?.(mapFirestoreError(e) || "แยกรายการในบิลไม่สำเร็จ — บันทึกบัญชีได้ตามปกติ");
    } finally {
      if (gen === extractGenRef.current) setExtracting(false);
    }
  }

  async function runImportCatalog() {
    if (!actorId || !billLines.length) return;
    const { ingredient, uncertain } = catalogCounts;
    if (!ingredient && !uncertain) {
      onMsg?.("ไม่มีรายการที่ยังไม่คู่สำหรับเข้าคลัง");
      return;
    }
    let includeUncertain = false;
    // ประเภทต้นทุน — ไม่ต้องถามเรื่องไม่มั่นใจ (จัดหมวดบช. ไว้แล้ว)
    if (!isCogs) {
      if (ingredient > 0 && uncertain > 0) {
        includeUncertain = window.confirm(
          `เข้าคลังที่มั่นใจ ${ingredient} รายการ\n\nมีอีก ${uncertain} รายการที่ไม่มั่นใจว่าเป็นวัตถุดิบ แต่ยังอยู่ในรายชื่อ\n\nรวมที่ไม่มั่นใจด้วยไหม?`,
        );
      } else if (!ingredient && uncertain > 0) {
        includeUncertain = window.confirm(
          `มี ${uncertain} รายการที่ไม่มั่นใจว่าเป็นวัตถุดิบ\n\nยังจะเข้าคลังไหม? (ติดโน้ตว่าไม่มั่นใจ)`,
        );
        if (!includeUncertain) return;
      }
    }
    setImporting(true);
    onError(null);
    try {
      const result = await importUnmatchedBillLinesToStock({
        lines: billLines,
        stock,
        updatedBy: actorId,
        ledgerType,
        includeUncertain,
      });
      const merged: StockItem[] = [
        ...stock.map((s) => {
          const aliasHit = result.aliased.find((a) => a.stockItemId === s.id);
          if (!aliasHit) return s;
          const nextAlias = aliasHit.billName;
          if ((s.aliases || []).some((a) => a === nextAlias)) return s;
          return { ...s, aliases: [...(s.aliases || []), nextAlias] };
        }),
        ...result.created.map((c) => ({
          id: c.stockItemId,
          name: c.name,
          unit: "ก.",
          qty: 0,
          minQty: 0,
          alertEnabled: false,
          safetyStock: 0,
          unitCost: 0,
          includeInCount: false,
          aliases: c.name === c.billName ? [] : [c.billName],
          updatedAt: Date.now(),
          updatedBy: actorId,
        })),
      ];
      const next = rematchBillLinesToStock(billLines, merged);
      onLinesChange(next);
      if (ledgerEntryId) {
        await updateLedgerEntry(ledgerEntryId, { billLines: next });
      }
      onMsg?.(
        `เข้าคลัง · ใหม่ ${result.created.length} · เติม alias ${result.aliased.length} · ข้าม ${result.skipped.length} (ยังไม่ใส่ต้นทุน)${
          isCogs ? " · จากประเภทต้นทุน" : ""
        }`,
      );
    } catch (e) {
      onError(mapFirestoreError(e));
    } finally {
      setImporting(false);
    }
  }

  async function confirmApply(idx: number) {
    const line = billLines[idx];
    if (!isOwner || !line || !actorId) return;
    if (!ledgerEntryId) {
      onMsg?.("บันทึกบัญชีก่อน แล้วเปิดรายละเอียดเพื่ออัปเดตต้นทุน");
      setPendingIdx(null);
      return;
    }
    setFormBusy(true);
    onError(null);
    try {
      const result = await applyLedgerBillLineToStock({
        line,
        stock,
        ledgerEntryId,
        updatedBy: actorId,
      });
      const next = markBillLineCostApplied(billLines, idx);
      onLinesChange(next);
      await updateLedgerEntry(ledgerEntryId, { billLines: next });
      setPendingIdx(null);
      onMsg?.(
        `อัปเดต ${line.matchStockName || line.name} = ${formatPlainNumber(result.unitCost)}฿/${result.unit}`,
      );
    } catch (e) {
      onError(mapFirestoreError(e));
    } finally {
      setFormBusy(false);
    }
  }

  return (
    <div className="ledger-bill-lines">
      {pending && pendingIdx != null ? (
        <div className="ledger-bill-lines-confirm">
          <p className="ledger-bill-lines-confirm-title">ยืนยันอัปเดตต้นทุน</p>
          <p className="muted ledger-bill-lines-confirm-diff">
            {pending.matchStockName || pending.name}:{" "}
            {formatPlainNumber(
              costById.get(pending.matchStockItemId || "") || 0,
            )}
            → {formatPlainNumber(pending.unitCost || 0)}/{pending.baseUnit}
            {pending.confidence > 0 && pending.confidence < 0.7
              ? " · มั่นใจต่ำ"
              : ""}
          </p>
          <div className="ledger-bill-lines-confirm-actions">
            <button
              type="button"
              className="btn bakery-sop-fit-btn"
              disabled={formBusy}
              onClick={() => setPendingIdx(null)}
            >
              ยกเลิก
            </button>
            <button
              type="button"
              className="btn primary bakery-sop-fit-btn"
              disabled={formBusy}
              onClick={() => void confirmApply(pendingIdx)}
            >
              ยืนยัน
            </button>
          </div>
        </div>
      ) : null}

      <div className="ledger-bill-lines-bar">
        <span className="ledger-bill-lines-label">
          รายการในบิล
          {isCogs ? (
            <span className="muted ledger-bill-lines-cogs-hint"> · ประเภทต้นทุน</span>
          ) : null}
        </span>
        <div className="ledger-bill-lines-bar-acts">
          {actorId && billLines.length ? (
            <button
              type="button"
              className="btn bakery-sop-fit-btn"
              disabled={
                formBusy ||
                extracting ||
                importing ||
                !(catalogCounts.ingredient || catalogCounts.uncertain)
              }
              title={
                isCogs
                  ? "ประเภทต้นทุน — ถือเป็นวัตถุดิบ · เข้าคลังชื่อ (ไม่ใส่ต้นทุนหน่วย)"
                  : "เข้าคลังชื่อที่มั่นใจว่าเป็นวัตถุดิบ · ไม่ใส่ต้นทุน · ของไม่มั่นใจถามก่อน"
              }
              onClick={() => void runImportCatalog()}
            >
              <PackagePlus size={12} aria-hidden />{" "}
              {importing
                ? "กำลังเข้าคลัง…"
                : catalogCounts.ingredient
                  ? `เข้าคลัง ${catalogCounts.ingredient}${
                      catalogCounts.uncertain
                        ? ` (+${catalogCounts.uncertain}?)`
                        : ""
                    }`
                  : catalogCounts.uncertain
                    ? `เข้าคลัง? ${catalogCounts.uncertain}`
                    : unmatchedCount
                      ? "เข้าคลังแล้ว"
                      : "เข้าคลังแล้ว"}
            </button>
          ) : null}
          <button
            type="button"
            className="btn bakery-sop-fit-btn"
            disabled={formBusy || extracting || importing || !receiptUrls.length}
            onClick={() => void runExtract()}
          >
            <Sparkles size={12} aria-hidden />{" "}
            {extracting
              ? "กำลังแยก…"
              : billLines.length
                ? "แยกใหม่"
                : "AI แยก"}
          </button>
        </div>
      </div>

      {billLines.length === 0 ? (
        <p className="muted ledger-bill-lines-empty">
          {extracting
            ? "กำลังแยกรายการจากรูป — บันทึกบัญชีได้ตามปกติ ไม่ต้องรอ"
            : "แนบรูปแล้วระบบแยกให้อัตโนมัติ (หรือกด AI แยก) · ไม่โชว์ในลิสต์บัญชี"}
        </p>
      ) : (
        <div className="sheet-wrap ledger-bill-lines-sheet">
          <table className="sheet-table sheet-table--dense ledger-bill-lines-table">
            <thead>
              <tr>
                <th>ชื่อบนบิล</th>
                <th>คลัง</th>
                {isOwner ? <th>฿/หน่วย</th> : null}
                {isOwner ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {billLines.map((line, idx) => {
                const matched = !!line.matchStockItemId;
                const applied = !!(line.costAppliedAt && line.costAppliedAt > 0);
                const tier = classifyBillLineForCatalog(line, { ledgerType });
                return (
                  <tr
                    key={`${line.name}-${idx}`}
                    className={
                      !matched
                        ? tier === "uncertain"
                          ? "ledger-bill-lines-miss ledger-bill-lines-uncertain"
                          : tier === "skip"
                            ? "ledger-bill-lines-miss ledger-bill-lines-skip"
                            : "ledger-bill-lines-miss"
                        : undefined
                    }
                  >
                    <td className="ledger-bill-lines-name" title={line.name}>
                      {line.name}
                      {!matched && tier === "ingredient" ? (
                        <span className="ledger-bill-lines-tier is-ok"> มั่นใจ</span>
                      ) : null}
                      {!matched && tier === "uncertain" ? (
                        <span className="ledger-bill-lines-tier is-low"> ไม่มั่นใจ</span>
                      ) : null}
                      {!matched && tier === "skip" ? (
                        <span className="ledger-bill-lines-tier is-skip"> บรรจุ</span>
                      ) : null}
                      {matched && line.confidence > 0 && line.confidence < 0.7 ? (
                        <span className="ledger-bill-lines-warn"> มั่นใจต่ำ</span>
                      ) : null}
                    </td>
                    <td
                      className="ledger-bill-lines-stock"
                      title={line.matchStockName || undefined}
                    >
                      {line.matchStockName || (
                        <span className="muted">ยังไม่คู่</span>
                      )}
                    </td>
                    {isOwner ? (
                      <td className="ledger-bill-lines-num">
                        {line.unitCost != null
                          ? `${formatPlainNumber(line.unitCost)}/${line.baseUnit}`
                          : "—"}
                      </td>
                    ) : null}
                    {isOwner ? (
                      <td className="ledger-bill-lines-act">
                        {applied ? (
                          <span
                            className="muted"
                            title={
                              line.costAppliedAt
                                ? formatDateShort(line.costAppliedAt)
                                : undefined
                            }
                          >
                            อัปเดตแล้ว
                          </span>
                        ) : matched && line.unitCost != null && ledgerEntryId ? (
                          <button
                            type="button"
                            className="btn bakery-sop-fit-btn"
                            disabled={formBusy || extracting || importing}
                            onClick={() => setPendingIdx(idx)}
                          >
                            อัปเดต
                          </button>
                        ) : matched && line.unitCost != null && !ledgerEntryId ? (
                          <span
                            className="muted"
                            title="บันทึกบัญชีก่อน แล้วเปิดรายละเอียดเพื่ออัปเดตต้นทุน"
                          >
                            บันทึกก่อน
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
