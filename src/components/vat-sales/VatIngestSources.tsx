"use client";

/**
 * แหล่งนำเข้าเดลิเวอรี่ — 3 บล็อก
 * 1) กล่อง AI  2) ตารางพรีวิว  3) ล้าง / ส่งเข้าตารางหลัก
 * พรอมต์+เงื่อนไข VAT อยู่ใน Cloud Function (ไม่โชว์บนจอ)
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { VatColHead } from "@/components/vat-sales/VatColHead";
import { VatSalesSubNav } from "@/components/vat-sales/VatSalesSubNav";
import {
  captureItemToIngestPreview,
  extractDeliveryCaptures,
  fileToImageDataUrl,
} from "@/lib/vat-delivery-capture-extract";
import { formatIngestMoney } from "@/lib/vat-ingest-preview";
import {
  DELIVERY_COL_INFO,
  DELIVERY_COL_ROLE,
  emptyChannelSource,
  mergeMonthSourcesIntoBooks,
  sumMonthSources,
  type MonthChannelSource,
  type MonthSourcesView,
} from "@/lib/vat-month-sources";
import {
  MONTH_CHANNEL_LABEL,
  MONTH_CHANNEL_SHORT,
  MONTH_CHANNELS,
  type MonthChannel,
} from "@/lib/vat-month-books";
import {
  bangkokMonthKey,
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

type RowAmounts = {
  sales: number;
  transfer: number;
  fee: number;
  gpVat: number;
};

function emptyRows(): Record<MonthChannel, RowAmounts> {
  return {
    grab: { sales: 0, transfer: 0, fee: 0, gpVat: 0 },
    shopee: { sales: 0, transfer: 0, fee: 0, gpVat: 0 },
    lineman: { sales: 0, transfer: 0, fee: 0, gpVat: 0 },
  };
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

export function VatIngestSources({ actor }: Props) {
  const monthOptions = useMemo(() => listThaiMonthOptions(undefined, 18), []);
  const [monthKey, setMonthKey] = useState(() => bangkokMonthKey());
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<Record<MonthChannel, RowAmounts>>(emptyRows);
  const [strRows, setStrRows] =
    useState<Record<MonthChannel, Record<keyof RowAmounts, string>>>(
      emptyStrRows,
    );
  const [busy, setBusy] = useState<"ai" | "push" | null>(null);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

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
    () =>
      MONTH_CHANNELS.some(
        (k) =>
          rows[k].sales > 0 ||
          rows[k].transfer > 0 ||
          rows[k].fee > 0 ||
          rows[k].gpVat > 0,
      ),
    [rows],
  );

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
    },
    [],
  );

  const onPickFiles = useCallback(
    (list: FileList | null) => {
      if (!list?.length) return;
      const next = [...files];
      for (const f of Array.from(list)) {
        if (!f.type.startsWith("image/")) continue;
        if (next.length >= MAX_CAPTURES) break;
        next.push(f);
      }
      setFiles(next.slice(0, MAX_CAPTURES));
      setError("");
    },
    [files],
  );

  const applyPreviewRows = useCallback(
    (next: Record<MonthChannel, RowAmounts>) => {
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
    },
    [],
  );

  const clearAll = useCallback(() => {
    setFiles([]);
    applyPreviewRows(emptyRows());
    setMsg("");
    setError("");
    if (inputRef.current) inputRef.current.value = "";
  }, [applyPreviewRows]);

  const runAi = useCallback(async () => {
    if (!files.length) {
      setError("เลือกแคปจออย่างน้อย 1 รูป (สูงสุด 3)");
      return;
    }
    setBusy("ai");
    setError("");
    setMsg("");
    try {
      const images = await Promise.all(files.map((f) => fileToImageDataUrl(f)));
      const res = await extractDeliveryCaptures({ monthKey, images });
      const next = emptyRows();
      const notes: string[] = [];
      for (const ch of MONTH_CHANNELS) {
        const item = res.byChannel?.[ch];
        if (!item) continue;
        const p = captureItemToIngestPreview(item);
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
      applyPreviewRows(next);
      if (res.errors?.length) setError(res.errors.slice(0, 3).join(" · "));
      setMsg(
        notes.length
          ? `AI อ่านแล้ว · ${notes.join(" · ")}`
          : "AI อ่านแล้ว แต่ยังจัดช่องทางไม่ได้",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [files, monthKey, applyPreviewRows]);

  const pushToMain = useCallback(async () => {
    if (!hasAny) {
      setError("ยังไม่มียอดในตารางพรีวิว");
      return;
    }
    setBusy("push");
    setError("");
    setMsg("");
    try {
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
      setMsg(
        `ส่งเข้าตารางหลักแล้ว · ${formatThaiMonthKey(monthKey)}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [actor, hasAny, monthKey, rows]);

  const locked = busy !== null;

  return (
    <div
      className="vat-ingest-page"
      id="vat-delivery-ingest"
      data-ai-context="vat-delivery-ingest-ai-preview-push"
    >
      <VatSalesSubNav active="sources" />
      <div className="vat-ingest-mail-bar">
        <label className="vat-month-pick">
          <span className="muted">เดือน</span>
          <select
            value={monthKey}
            disabled={locked}
            onChange={(e) => {
              setMonthKey(e.target.value);
              applyPreviewRows(emptyRows());
              setMsg("");
              setError("");
            }}
            aria-label="เดือนเป้าหมาย"
          >
            {monthOptions.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
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
            className="btn btn-secondary vat-ingest-btn"
            disabled={locked || files.length >= MAX_CAPTURES}
            onClick={() => inputRef.current?.click()}
          >
            เลือกแคปจอ
          </button>
          <button
            type="button"
            className="btn btn-secondary vat-ingest-btn"
            disabled={locked || !files.length}
            onClick={() => void runAi()}
          >
            {busy === "ai" ? "AI กำลังอ่าน…" : "ให้ AI คัดแยก"}
          </button>
        </div>
        {files.length > 0 ? (
          <ul className="vat-ingest-file-list">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`}>
                <span>
                  {i + 1}. {f.name}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost vat-ingest-btn"
                  disabled={locked}
                  onClick={() =>
                    setFiles((prev) => prev.filter((_, j) => j !== i))
                  }
                >
                  ลบ
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted vat-ingest-hint">
            แคป ≤3 รูป · GB / SF / LM · เดือน {formatThaiMonthKey(monthKey)}
          </p>
        )}
      </section>

      {msg ? <p className="muted vat-sales-msg">{msg}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}

      <section className="vat-table-block vat-month-sources">
        <h2 className="vat-table-title">
          ยอดเดลิเวอรี่ (พรีวิว) — {formatThaiMonthKey(monthKey)}
        </h2>
        <div className="sheet-wrap vat-month-slim-wrap">
          <table className="sheet-table vat-sales-table vat-sales-table--slim vat-month-slim vat-close-table">
            <thead>
              <tr>
                <th className="col-seg">ช่องทาง</th>
                <VatColHead
                  label="ยอดขายแอพ"
                  role={DELIVERY_COL_ROLE.appSales}
                  info={DELIVERY_COL_INFO.appSales}
                />
                <VatColHead
                  label="ยอดโอน"
                  role={DELIVERY_COL_ROLE.transfer}
                  info={DELIVERY_COL_INFO.transfer}
                />
                <VatColHead
                  label="คชจ.GP"
                  role={DELIVERY_COL_ROLE.gpFee}
                  info={DELIVERY_COL_INFO.gpFee}
                />
                <VatColHead
                  label="VAT-ซื้อ"
                  role={DELIVERY_COL_ROLE.purchaseVat}
                  info={DELIVERY_COL_INFO.purchaseVat}
                />
              </tr>
            </thead>
            <tbody>
              {MONTH_CHANNELS.map((k) => (
                <tr key={k}>
                  <td className="col-seg">{MONTH_CHANNEL_LABEL[k]}</td>
                  {(
                    ["sales", "transfer", "fee", "gpVat"] as const
                  ).map((field) => (
                    <td key={field} className="col-num col-input">
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
              <tr className="vat-sales-totals-row">
                <td className="col-seg">รวมเดลิเวอรี่</td>
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
          className="btn btn-ghost vat-ingest-btn"
          disabled={locked || (!files.length && !hasAny)}
          onClick={clearAll}
        >
          ล้าง
        </button>
        <button
          type="button"
          className="btn btn-secondary vat-ingest-btn vat-ingest-push-main"
          disabled={locked || !hasAny}
          onClick={() => void pushToMain()}
        >
          {busy === "push" ? "กำลังส่ง…" : "ส่งเข้าตารางหลัก"}
        </button>
      </div>
    </div>
  );
}
