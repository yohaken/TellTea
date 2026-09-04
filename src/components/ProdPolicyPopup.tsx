"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import {
  DEFAULT_PROD_POLICY_LABELS,
  filterProdEntriesOnBangkokDay,
  formatDeductRate,
  formatPolicyMoney,
  formatPolicyQty,
  formatPolicyRate,
  hasAnyProdMinPolicy,
  saveProdPolicy,
  summarizeProdPolicyMonth,
  sumProdPolicyMonth,
  type ProdPolicyLabels,
  type ProdPolicySettings,
} from "@/lib/prod-policy";
import type { ProdEntry, ProdProduct } from "@/lib/production";
import { ProdPolicyPopupToggle } from "@/components/ProdPolicyPopupToggle";

export function ProdPolicyPopup({
  open,
  onClose,
  products,
  entries,
  policy,
  canSetPolicy,
  actorId,
  monthLabel,
  onOpenCatalog,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  products: ProdProduct[];
  entries: ProdEntry[];
  policy: ProdPolicySettings;
  /** เจ้าของจริงเท่านั้น — พนักงาน/พรีวิวดูได้อย่างเดียว */
  canSetPolicy: boolean;
  actorId: string;
  monthLabel: string;
  onOpenCatalog?: () => void;
  onError: (msg: string) => void;
}) {
  useBodyScrollLock(open);
  const [editing, setEditing] = useState(false);
  const [wastePct, setWastePct] = useState(String(policy.wasteBonusPct));
  const [labels, setLabels] = useState<ProdPolicyLabels>(policy.labels);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !canSetPolicy) {
      setEditing(false);
      return;
    }
    setWastePct(String(policy.wasteBonusPct));
    setLabels(policy.labels);
  }, [open, policy, canSetPolicy]);

  const dayEntries = useMemo(
    () => filterProdEntriesOnBangkokDay(entries),
    [entries],
  );
  const rows = useMemo(
    () => summarizeProdPolicyMonth(dayEntries, products, policy.wasteBonusPct),
    [dayEntries, products, policy.wasteBonusPct],
  );
  const totals = useMemo(() => sumProdPolicyMonth(rows), [rows]);
  const hasPolicy = hasAnyProdMinPolicy(products);
  const L = policy.labels;

  async function onSave() {
    if (!canSetPolicy) return;
    setBusy(true);
    try {
      await saveProdPolicy(
        {
          wasteBonusPct: Number(wastePct),
          labels,
        },
        actorId,
        { asOwner: true },
      );
      setEditing(false);
    } catch (err) {
      onError((err as Error).message || "บันทึกนโยบายไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="modal-backdrop edit-modal is-compact-form is-prod-policy"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="modal-card prod-policy-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prod-policy-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="entry-toolbar module-form-head">
          <h2 id="prod-policy-title" className="panel-title">
            นโยบายผลิต
          </h2>
          <button type="button" className="ghost-btn icon-btn" aria-label="ปิด" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <p className="prod-policy-lead">
          ขั้นต่ำต่อวัน · ไม่บังคับ · เฉพาะสินค้าที่ตั้งเกณฑ์ · {monthLabel}
        </p>
        <p className="prod-policy-waste">
          เรทเสียใช้หักอย่างเดียว · รายได้ − หัก(เรทเสีย × ทิ้ง) = โบนัสผลิต · ไม่มีทิ้ง = ×0
        </p>
        {canSetPolicy ? (
          <ProdPolicyPopupToggle
            policy={policy}
            actorId={actorId}
            onError={onError}
            compact
          />
        ) : null}

        {editing && canSetPolicy ? (
          <form
            className="prod-policy-edit"
            onSubmit={(e) => {
              e.preventDefault();
              void onSave();
            }}
          >
            <div className="prod-policy-edit-row">
              <label htmlFor="prod-policy-waste-pct">เรทเสีย % ของเรทผลิต</label>
              <input
                id="prod-policy-waste-pct"
                type="number"
                min="0"
                max="100"
                step="1"
                inputMode="decimal"
                value={wastePct}
                onChange={(e) => setWastePct(e.target.value)}
              />
            </div>
            <p className="prod-policy-edit-kicker">หัวคอลัมน์</p>
            <div className="prod-policy-labels">
              {(
                [
                  ["product", "สินค้า"],
                  ["minRange", "ขั้นต่ำ"],
                  ["monthQty", "วันนี้"],
                  ["wasteQty", "ทิ้ง"],
                  ["wasteMoney", "เงินทิ้ง"],
                  ["bonus", "โบนัส"],
                ] as const
              ).map(([key, fallback]) => (
                <label key={key} className="prod-policy-label-field">
                  <span>{fallback}</span>
                  <input
                    value={labels[key]}
                    maxLength={12}
                    onChange={(e) =>
                      setLabels((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                    placeholder={DEFAULT_PROD_POLICY_LABELS[key]}
                  />
                </label>
              ))}
            </div>
            <p className="muted prod-policy-hint">
              ขั้นต่ำต่อวันต่อสินค้าตั้งที่แท็บ สินค้า / เรท · ว่าง = ไม่มีนโยบาย
            </p>
            <div className="entry-actions module-form-actions">
              <button type="submit" className="primary-btn" disabled={busy}>
                {busy ? "กำลังบันทึก..." : "บันทึก"}
              </button>
              <button
                type="button"
                className="ghost-btn"
                disabled={busy}
                onClick={() => setEditing(false)}
              >
                ยกเลิก
              </button>
            </div>
          </form>
        ) : (
          <>
            {hasPolicy ? (
              <div className="prod-policy-table-wrap">
                <table className="prod-policy-table">
                  <thead>
                    <tr>
                      <th>{L.product}</th>
                      <th>{L.minRange}</th>
                      <th className="prod-policy-rate-head">
                        เรทผลิต
                        <span>เรทเสีย หัก × ทิ้ง</span>
                      </th>
                      <th>{L.monthQty}</th>
                      <th>{L.wasteQty}</th>
                      <th>{L.wasteMoney}</th>
                      <th>{L.bonus}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.productId}>
                        <td>{row.productName}</td>
                        <td>{row.minRange}</td>
                        <td className="prod-policy-rate-cell">
                          <span>{formatPolicyRate(row.prodRate)}</span>
                          <span className="is-waste">{formatDeductRate(row.wasteRate) || "—"}</span>
                        </td>
                        <td>{formatPolicyQty(row.monthQty)}</td>
                        <td>{formatPolicyQty(row.wasteQty)}</td>
                        <td>{formatPolicyMoney(row.wasteMoney)}</td>
                        <td>{formatPolicyMoney(row.bonus)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th colSpan={2}>สรุป</th>
                      <th />
                      <th>{formatPolicyQty(totals.monthQty)}</th>
                      <th>{formatPolicyQty(totals.wasteQty)}</th>
                      <th>{formatPolicyMoney(totals.wasteMoney)}</th>
                      <th>{formatPolicyMoney(totals.bonus)}</th>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <p className="prod-policy-empty">
                ยังไม่ตั้งขั้นต่ำ — ไม่ต้องแจ้งพนักงาน
                {canSetPolicy && onOpenCatalog ? (
                  <>
                    {" "}
                    <button type="button" className="linkish-btn" onClick={onOpenCatalog}>
                      ไปตั้งที่สินค้า / เรท
                    </button>
                  </>
                ) : null}
              </p>
            )}
            <div className="entry-actions module-form-actions">
              {canSetPolicy ? (
                <button type="button" className="primary-btn" onClick={() => setEditing(true)}>
                  ตั้งนโยบาย
                </button>
              ) : null}
              <button type="button" className="ghost-btn" onClick={onClose}>
                ปิด
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
