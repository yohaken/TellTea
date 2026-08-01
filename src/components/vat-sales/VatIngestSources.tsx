"use client";

/**
 * แหล่งนำเข้าเดลิเวอรี่ — พรีวิวกระชับ
 * จำแนกไฟล์/ข้อความ + สรุป 4 ช่อง · ไม่ผสานเข้าตาราง VAT เดือน
 */
import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { VatSalesSubNav } from "@/components/vat-sales/VatSalesSubNav";
import {
  formatIngestMoney,
  INGEST_CHANNEL_HINT,
  INGEST_KIND_LABEL,
  previewIngestText,
  type IngestPreview,
} from "@/lib/vat-ingest-preview";
import {
  MONTH_CHANNEL_LABEL,
  MONTH_CHANNEL_SHORT,
  MONTH_CHANNELS,
  type MonthChannel,
} from "@/lib/vat-month-books";
import { formatThaiMonthKey } from "@/lib/vat-monthly";

type Props = { actor: string };

type SlotState = {
  preview: IngestPreview | null;
  paste: string;
  error: string;
};

function emptySlot(): SlotState {
  return { preview: null, paste: "", error: "" };
}

async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("อ่านไฟล์ไม่ได้"));
    reader.readAsText(file);
  });
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

function ChannelSlot({
  channel,
  state,
  onPasteChange,
  onClear,
  onFile,
  onParsePaste,
}: {
  channel: MonthChannel;
  state: SlotState;
  onPasteChange: (v: string) => void;
  onClear: () => void;
  onFile: (file: File) => void;
  onParsePaste: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const short = MONTH_CHANNEL_SHORT[channel];
  const p = state.preview;
  const accept =
    channel === "shopee" ? ".txt,.csv,.pdf" : ".csv,.txt,.pdf";

  return (
    <section
      className="vat-ingest-slot"
      data-channel={channel}
      aria-label={`แหล่งนำเข้า ${MONTH_CHANNEL_LABEL[channel]}`}
    >
      <header className="vat-ingest-slot-head">
        <strong>
          {short} · {MONTH_CHANNEL_LABEL[channel]}
        </strong>
        <span className="muted vat-ingest-hint">
          {INGEST_CHANNEL_HINT[channel]}
        </span>
      </header>

      <div className="vat-ingest-actions">
        {channel === "shopee" ? (
          <>
            <textarea
              className="vat-ingest-paste"
              rows={3}
              placeholder="วางบล็อก「รายงานยอดขายสะสมประจำเดือน」…"
              value={state.paste}
              onChange={(e) => onPasteChange(e.target.value)}
              aria-label={`วางข้อความเมล ${short}`}
            />
            <button
              type="button"
              className="btn btn-secondary vat-ingest-btn"
              onClick={onParsePaste}
              disabled={!state.paste.trim()}
            >
              อ่านข้อความ
            </button>
          </>
        ) : (
          <>
            <input
              ref={inputRef}
              type="file"
              accept={accept}
              className="vat-ingest-file"
              aria-label={`เลือกไฟล์ ${short}`}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className="btn btn-secondary vat-ingest-btn"
              onClick={() => inputRef.current?.click()}
            >
              เลือกไฟล์
            </button>
            <textarea
              className="vat-ingest-paste"
              rows={2}
              placeholder="หรือวางเนื้อ CSV / ข้อความ…"
              value={state.paste}
              onChange={(e) => onPasteChange(e.target.value)}
              aria-label={`วางข้อความ ${short}`}
            />
            <button
              type="button"
              className="btn btn-secondary vat-ingest-btn"
              onClick={onParsePaste}
              disabled={!state.paste.trim()}
            >
              อ่านข้อความ
            </button>
          </>
        )}
        {p || state.paste ? (
          <button
            type="button"
            className="btn btn-ghost vat-ingest-btn"
            onClick={onClear}
          >
            ล้าง
          </button>
        ) : null}
      </div>

      {state.error ? <p className="error-text">{state.error}</p> : null}

      {p ? (
        <div
          className={
            p.ok ? "vat-ingest-result is-ok" : "vat-ingest-result is-bad"
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
            {p.dayCount > 0 ? ` · ${p.dayCount} วัน/แถว` : ""}
            {p.ok ? " · พร้อมสรุป" : " · ยังไม่ครบ"}
          </p>
          <AmountsRow preview={p} />
          {p.headers.length > 0 ? (
            <p
              className="muted vat-ingest-headers"
              title={p.headers.join(" · ")}
            >
              คอลัมน์: {p.headers.slice(0, 6).join(" · ")}
              {p.headers.length > 6 ? "…" : ""}
            </p>
          ) : null}
          {p.warnings.length > 0 ? (
            <ul className="vat-ingest-warnings">
              {p.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function VatIngestSources({ actor: _actor }: Props) {
  const [slots, setSlots] = useState<Record<MonthChannel, SlotState>>({
    grab: emptySlot(),
    shopee: emptySlot(),
    lineman: emptySlot(),
  });

  const setSlot = useCallback((ch: MonthChannel, next: Partial<SlotState>) => {
    setSlots((s) => ({ ...s, [ch]: { ...s[ch], ...next } }));
  }, []);

  const runPreview = useCallback(
    (ch: MonthChannel, text: string, fileName: string) => {
      const preview = previewIngestText(text, { fileName });
      const warnings = [...preview.warnings];
      if (preview.channel && preview.channel !== ch) {
        warnings.unshift(
          `จำแนกเป็น ${INGEST_KIND_LABEL[preview.kind]} (ช่องทาง ${MONTH_CHANNEL_SHORT[preview.channel]}) — ไม่ใช่ ${MONTH_CHANNEL_SHORT[ch]}`,
        );
      }
      setSlots((s) => ({
        ...s,
        [ch]: {
          ...s[ch],
          preview: { ...preview, warnings },
          error: "",
          paste: text.length < 12_000 ? text : s[ch].paste,
        },
      }));
    },
    [],
  );

  const onFile = useCallback(
    async (ch: MonthChannel, file: File) => {
      try {
        const text = await readFileAsText(file);
        runPreview(ch, text, file.name);
      } catch {
        setSlot(ch, { error: "อ่านไฟล์ไม่ได้", preview: null });
      }
    },
    [runPreview, setSlot],
  );

  return (
    <div
      className="vat-ingest-page"
      id="vat-delivery-ingest"
      data-ai-context="vat-delivery-ingest-preview"
    >
      <VatSalesSubNav active="sources" />
      <h2 className="vat-table-title">แหล่งนำเข้าเดลิเวอรี่</h2>
      <p className="muted vat-sales-hint vat-hint-one-line">
        พรีวิวอย่างเดียว — จำแนกไฟล์ให้ถูก · สรุป 4 ช่อง ·{" "}
        <strong>ยังไม่เข้าตารางยอดเดลิเวอรี่</strong>
      </p>
      <p className="muted vat-sales-hint vat-hint-one-line">
        กลับไปกรอกมือที่{" "}
        <Link href="/vat-sales/">VAT เดือน</Link> ได้ตามปกติ
      </p>

      {MONTH_CHANNELS.map((ch) => (
        <ChannelSlot
          key={ch}
          channel={ch}
          state={slots[ch]}
          onPasteChange={(v) => setSlot(ch, { paste: v })}
          onClear={() => setSlot(ch, emptySlot())}
          onFile={(f) => void onFile(ch, f)}
          onParsePaste={() => runPreview(ch, slots[ch].paste, "")}
        />
      ))}
    </div>
  );
}
