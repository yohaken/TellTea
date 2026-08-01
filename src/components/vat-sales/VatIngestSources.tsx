"use client";

/**
 * แหล่งนำเข้าเดลิเวอรี่ — กล่อง AI เดียวรับแคปจอ ≤3 รูป
 * คัดแยก GB / SF / LM → ตารางพรีวิว · ยังไม่ผสานเข้างบเดือน
 * (ยกเลิก Gmail + อัปรูป Grab แยกแล้ว)
 */
import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { VatSalesSubNav } from "@/components/vat-sales/VatSalesSubNav";
import {
  captureItemToIngestPreview,
  extractDeliveryCaptures,
  fileToImageDataUrl,
} from "@/lib/vat-delivery-capture-extract";
import {
  formatIngestMoney,
  type IngestPreview,
} from "@/lib/vat-ingest-preview";
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

type Props = { actor: string };

const MAX_CAPTURES = 3;

function emptyPreviews(): Record<MonthChannel, IngestPreview | null> {
  return { grab: null, shopee: null, lineman: null };
}

function AmountsRow({ preview }: { preview: IngestPreview }) {
  const a = preview.amounts;
  if (!a) return null;
  return (
    <dl className="vat-ingest-amounts">
      <div>
        <dt>ขายแอพ</dt>
        <dd>{formatIngestMoney(a.sales)}</dd>
      </div>
      <div>
        <dt>โอน</dt>
        <dd>{formatIngestMoney(a.transfer)}</dd>
      </div>
      <div>
        <dt>คชจ.GP</dt>
        <dd>{formatIngestMoney(a.fee)}</dd>
      </div>
      <div>
        <dt>VAT-ซื้อ</dt>
        <dd>{formatIngestMoney(a.gpVat)}</dd>
      </div>
    </dl>
  );
}

export function VatIngestSources({ actor: _actor }: Props) {
  const monthOptions = useMemo(() => listThaiMonthOptions(undefined, 18), []);
  const [monthKey, setMonthKey] = useState(() => bangkokMonthKey());
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] =
    useState<Record<MonthChannel, IngestPreview | null>>(emptyPreviews);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const onPickFiles = useCallback((list: FileList | null) => {
    if (!list?.length) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (!f.type.startsWith("image/")) continue;
      if (next.length >= MAX_CAPTURES) break;
      next.push(f);
    }
    setFiles(next.slice(0, MAX_CAPTURES));
    setError("");
  }, [files]);

  const removeFile = useCallback((idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const clearAll = useCallback(() => {
    setFiles([]);
    setPreviews(emptyPreviews());
    setMsg("");
    setError("");
  }, []);

  const runAi = useCallback(async () => {
    if (!files.length) {
      setError("เลือกแคปจออย่างน้อย 1 รูป (สูงสุด 3 · GB/SF/LM)");
      return;
    }
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const images = await Promise.all(files.map((f) => fileToImageDataUrl(f)));
      const res = await extractDeliveryCaptures({ monthKey, images });
      const next = emptyPreviews();
      const notes: string[] = [];
      for (const ch of MONTH_CHANNELS) {
        const item = res.byChannel?.[ch];
        if (item) {
          next[ch] = captureItemToIngestPreview(item);
          notes.push(
            `${MONTH_CHANNEL_SHORT[ch]} ${formatIngestMoney(item.sales)}`,
          );
        }
      }
      setPreviews(next);
      if (res.errors?.length) {
        setError(res.errors.slice(0, 3).join(" · "));
      }
      setMsg(
        notes.length
          ? `AI อ่านแล้ว · ${notes.join(" · ")} · ยังไม่เข้าตารางสรุป`
          : "AI อ่านแล้ว แต่ยังจัดช่องทางไม่ได้ — ตรวจรูป/เดือน",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [files, monthKey]);

  return (
    <div
      className="vat-ingest-page"
      id="vat-delivery-ingest"
      data-ai-context="vat-delivery-ingest-ai-capture"
    >
      <VatSalesSubNav active="sources" />
      <h2 className="vat-table-title">แหล่งนำเข้าเดลิเวอรี่</h2>
      <p className="muted vat-sales-hint vat-hint-one-line">
        กล่อง AI เดียว · โยนแคปจอ GB + SF + LM (≤3 รูป) · คัดแยกใส่ตารางพรีวิว ·{" "}
        <strong>ยังไม่เข้าตารางยอดเดลิเวอรี่</strong>
      </p>

      <div className="vat-ingest-mail-bar" aria-label="เดือนและ AI">
        <label className="vat-month-pick">
          <span className="muted">เดือน</span>
          <select
            value={monthKey}
            disabled={busy}
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
        <Link href="/vat-sales/" className="vat-ingest-back muted">
          VAT เดือน
        </Link>
      </div>

      <section
        className="vat-ingest-ai-box"
        aria-label="อัปโหลดแคปจอให้ AI"
      >
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
            disabled={busy || files.length >= MAX_CAPTURES}
            onClick={() => inputRef.current?.click()}
          >
            เลือกแคปจอ
          </button>
          <button
            type="button"
            className="btn btn-secondary vat-ingest-btn"
            disabled={busy || !files.length}
            onClick={() => void runAi()}
          >
            {busy ? "AI กำลังอ่าน…" : "ให้ AI คัดแยก"}
          </button>
          {files.length || MONTH_CHANNELS.some((c) => previews[c]) ? (
            <button
              type="button"
              className="btn btn-ghost vat-ingest-btn"
              disabled={busy}
              onClick={clearAll}
            >
              ล้าง
            </button>
          ) : null}
        </div>
        <p className="muted vat-ingest-hint">
          วางได้สูงสุด 3 รูป — Grab สรุปการเงิน · Shopee เมลสรุปเดือน · LINE MAN
          รายงาน/เมล GP · เดือนที่เลือก: {formatThaiMonthKey(monthKey)}
        </p>
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
                  disabled={busy}
                  onClick={() => removeFile(i)}
                >
                  ลบ
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {msg ? <p className="muted vat-sales-msg">{msg}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}

      <div className="vat-ingest-preview-grid">
        {MONTH_CHANNELS.map((ch) => {
          const p = previews[ch];
          return (
            <section
              key={ch}
              className="vat-ingest-slot"
              data-channel={ch}
              aria-label={`พรีวิว ${MONTH_CHANNEL_LABEL[ch]}`}
            >
              <header className="vat-ingest-slot-head">
                <strong>
                  {MONTH_CHANNEL_SHORT[ch]} · {MONTH_CHANNEL_LABEL[ch]}
                </strong>
              </header>
              {p ? (
                <div
                  className={
                    p.ok
                      ? "vat-ingest-result is-ok"
                      : "vat-ingest-result is-bad"
                  }
                >
                  <p className="vat-ingest-identity">
                    <span className="vat-ingest-kind">{p.identity}</span>
                    {p.fileName ? (
                      <span className="muted"> · {p.fileName}</span>
                    ) : null}
                  </p>
                  <p className="vat-ingest-meta muted">
                    {p.monthKey
                      ? `เดือน ${formatThaiMonthKey(p.monthKey)} (${p.monthKey})`
                      : "ยังไม่อ่านเดือนได้"}
                    {p.ok ? " · พร้อมสรุป" : " · ยังไม่ครบ"}
                  </p>
                  <AmountsRow preview={p} />
                  {p.warnings.length > 0 ? (
                    <ul className="vat-ingest-warnings">
                      {p.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : (
                <p className="muted vat-ingest-hint">รอแคปจาก AI</p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
