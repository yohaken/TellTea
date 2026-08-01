"use client";

/**
 * แหล่งนำเข้าเดลิเวอรี่ — พรีวิวกระชับ
 * จำแนกไฟล์/ข้อความ + สรุป 4 ช่อง · ไม่ผสานเข้าตาราง VAT เดือน
 * Shopee/LM: ดึงจาก Gmail ได้ (เนื้อเมล / REPORT_*.csv ไฟล์แรก)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  extractGrabFinanceImage,
  fileToImageDataUrl,
  grabExtractToIngestPreview,
} from "@/lib/vat-grab-image-extract";
import {
  connectGmailForIngest,
  loadMailIngestStatus,
  pieceToIngestPreview,
  pullMonthlySourcesFromGmail,
} from "@/lib/vat-mail-monthly-pull";
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
import type { VatMailStatus } from "@/lib/vat-sales-mail";

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
  busy,
  onPasteChange,
  onClear,
  onFile,
  onParsePaste,
  onGrabImage,
}: {
  channel: MonthChannel;
  state: SlotState;
  busy?: boolean;
  onPasteChange: (v: string) => void;
  onClear: () => void;
  onFile: (file: File) => void;
  onParsePaste: () => void;
  onGrabImage?: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const short = MONTH_CHANNEL_SHORT[channel];
  const p = state.preview;

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
        {channel === "grab" ? (
          <>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="vat-ingest-file"
              aria-label="อัปโหลดแคปจอ Grab"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onGrabImage?.(f);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className="btn btn-secondary vat-ingest-btn"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              {busy ? "AI อ่านรูป…" : "อัปโหลดรูปแคป"}
            </button>
          </>
        ) : channel === "shopee" ? (
          <>
            <textarea
              className="vat-ingest-paste"
              rows={3}
              placeholder="วางบล็อก「รายงานยอดขายสะสมประจำเดือน」… (สำรองถ้าไม่ดึงจากเมล)"
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
              accept=".csv,.txt,.pdf"
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
              เลือกไฟล์ REPORT
            </button>
            <textarea
              className="vat-ingest-paste"
              rows={2}
              placeholder="หรือวางเนื้อ CSV…"
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
  const monthOptions = useMemo(() => listThaiMonthOptions(undefined, 18), []);
  const [monthKey, setMonthKey] = useState(() => bangkokMonthKey());
  const [mailStatus, setMailStatus] = useState<VatMailStatus | null>(null);
  const [mailBusy, setMailBusy] = useState<string | null>(null);
  const [mailMsg, setMailMsg] = useState("");
  const [mailError, setMailError] = useState("");
  const [slots, setSlots] = useState<Record<MonthChannel, SlotState>>({
    grab: emptySlot(),
    shopee: emptySlot(),
    lineman: emptySlot(),
  });

  const refreshMailStatus = useCallback(async () => {
    try {
      const st = await loadMailIngestStatus();
      setMailStatus(st);
    } catch {
      setMailStatus(null);
    }
  }, []);

  useEffect(() => {
    void refreshMailStatus();
    try {
      const q = new URLSearchParams(window.location.search);
      if (q.get("mail") === "connected") {
        setMailMsg("เชื่อม Gmail แล้ว — กด「ดึง SF+LM」ได้");
      }
    } catch {
      /* ignore */
    }
  }, [refreshMailStatus]);

  const setSlot = useCallback((ch: MonthChannel, next: Partial<SlotState>) => {
    setSlots((s) => ({ ...s, [ch]: { ...s[ch], ...next } }));
  }, []);

  const applyPreview = useCallback(
    (ch: MonthChannel, preview: IngestPreview, pasteFallback = "") => {
      setSlots((s) => ({
        ...s,
        [ch]: {
          ...s[ch],
          preview,
          error: "",
          paste:
            pasteFallback && pasteFallback.length < 12_000
              ? pasteFallback
              : s[ch].paste,
        },
      }));
    },
    [],
  );

  const runPreview = useCallback(
    (ch: MonthChannel, text: string, fileName: string) => {
      const preview = previewIngestText(text, { fileName });
      const warnings = [...preview.warnings];
      if (preview.channel && preview.channel !== ch) {
        warnings.unshift(
          `จำแนกเป็น ${INGEST_KIND_LABEL[preview.kind]} (ช่องทาง ${MONTH_CHANNEL_SHORT[preview.channel]}) — ไม่ใช่ ${MONTH_CHANNEL_SHORT[ch]}`,
        );
      }
      applyPreview(ch, { ...preview, warnings }, text);
    },
    [applyPreview],
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

  const onGrabImage = useCallback(
    async (file: File) => {
      setMailBusy("grab-ai");
      setMailError("");
      setSlot("grab", { error: "", preview: null });
      try {
        const imageDataUrl = await fileToImageDataUrl(file);
        const extracted = await extractGrabFinanceImage({
          imageDataUrl,
          monthKey,
        });
        const preview = grabExtractToIngestPreview(extracted);
        applyPreview("grab", preview);
        setMailMsg(
          extracted.monthMatch
            ? `Grab AI · เดือนตรง ${extracted.monthKey || monthKey} · ขาย ${formatIngestMoney(extracted.sales)}`
            : `Grab AI · เดือนในรูป ${extracted.monthKey || "?"} ≠ ที่เลือก ${monthKey} — ตรวจก่อน`,
        );
      } catch (e) {
        setSlot("grab", {
          error: e instanceof Error ? e.message : String(e),
          preview: null,
        });
      } finally {
        setMailBusy(null);
      }
    },
    [monthKey, applyPreview, setSlot],
  );

  const onConnectGmail = useCallback(async () => {
    setMailBusy("connect");
    setMailError("");
    setMailMsg("");
    try {
      const url = await connectGmailForIngest();
      window.location.href = url;
    } catch (e) {
      setMailError(e instanceof Error ? e.message : String(e));
      setMailBusy(null);
    }
  }, []);

  const onPullMail = useCallback(async () => {
    setMailBusy("pull");
    setMailError("");
    setMailMsg("");
    try {
      const res = await pullMonthlySourcesFromGmail({ monthKey });
      const notes: string[] = [];

      if (res.shopee?.ok && res.shopee.text) {
        const sfPrev = pieceToIngestPreview(res.shopee);
        if (sfPrev) {
          applyPreview("shopee", sfPrev, res.shopee.text.slice(0, 4000));
        }
        notes.push(
          `SF ${res.shopee.monthKey || "?"} · ขาย ${formatIngestMoney(sfPrev?.amounts?.sales || 0)}`,
        );
      } else if (res.shopee) {
        setSlot("shopee", {
          error: res.shopee.error || "ดึง Shopee ไม่สำเร็จ",
        });
        notes.push(`SF: ${res.shopee.error || "ไม่สำเร็จ"}`);
      }

      if (res.lineman?.ok && res.lineman.text) {
        const lmPrev = pieceToIngestPreview(res.lineman);
        if (lmPrev) {
          applyPreview(
            "lineman",
            lmPrev,
            res.lineman.text.length < 12_000 ? res.lineman.text : "",
          );
        }
        notes.push(
          `LM ${res.lineman.fileName || "REPORT"} · ขาย ${formatIngestMoney(lmPrev?.amounts?.sales || 0)}`,
        );
      } else if (res.lineman) {
        setSlot("lineman", {
          error: res.lineman.error || "ดึง LINE MAN ไม่สำเร็จ",
        });
        notes.push(`LM: ${res.lineman.error || "ไม่สำเร็จ"}`);
      }

      setMailMsg(
        notes.length
          ? `ดึงแล้ว · ${notes.join(" · ")} · ยังไม่เข้าตารางสรุป`
          : "ดึงแล้ว แต่ไม่มีผลลัพธ์",
      );
      await refreshMailStatus();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setMailError(msg);
      if (/ยังไม่ได้เชื่อม Gmail|เชื่อม Gmail/.test(msg)) {
        setMailMsg("ต้องกด「เชื่อม Gmail」ก่อน");
      }
    } finally {
      setMailBusy(null);
    }
  }, [monthKey, applyPreview, setSlot, refreshMailStatus]);

  const connected = Boolean(mailStatus?.connected);

  return (
    <div
      className="vat-ingest-page"
      id="vat-delivery-ingest"
      data-ai-context="vat-delivery-ingest-preview"
    >
      <VatSalesSubNav active="sources" />
      <h2 className="vat-table-title">แหล่งนำเข้าเดลิเวอรี่</h2>
      <p className="muted vat-sales-hint vat-hint-one-line">
        พรีวิวอย่างเดียว — SF/LM จากเมล (เดือนในรายงาน) · Grab จากรูปแคป+AI ·{" "}
        <strong>ยังไม่เข้าตารางยอดเดลิเวอรี่</strong>
      </p>

      <div className="vat-ingest-mail-bar" aria-label="Gmail สรุปเดือน">
        <label className="vat-month-pick">
          <span className="muted">เดือน</span>
          <select
            value={monthKey}
            disabled={Boolean(mailBusy)}
            onChange={(e) => setMonthKey(e.target.value)}
            aria-label="เดือนที่ดึงจากเมล"
          >
            {monthOptions.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <span className="vat-ingest-mail-status muted" title={mailStatus?.email || ""}>
          {connected
            ? `Gmail · ${mailStatus?.email || "เชื่อมแล้ว"}`
            : mailStatus?.hasConfig
              ? "ยังไม่เชื่อม Gmail"
              : "ยังไม่มี OAuth config"}
        </span>
        {connected ? (
          <button
            type="button"
            className="btn btn-secondary vat-ingest-btn"
            disabled={Boolean(mailBusy)}
            onClick={() => void onPullMail()}
          >
            {mailBusy === "pull" ? "กำลังดึง…" : "ดึง SF+LM จากเมล"}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-secondary vat-ingest-btn"
            disabled={Boolean(mailBusy) || mailStatus?.hasConfig === false}
            onClick={() => void onConnectGmail()}
          >
            {mailBusy === "connect" ? "เปิด Google…" : "เชื่อม Gmail"}
          </button>
        )}
        <Link href="/vat-sales/" className="vat-ingest-back muted">
          VAT เดือน
        </Link>
      </div>
      {mailMsg ? <p className="muted vat-sales-msg">{mailMsg}</p> : null}
      {mailError ? <p className="error-text">{mailError}</p> : null}

      {MONTH_CHANNELS.map((ch) => (
        <ChannelSlot
          key={ch}
          channel={ch}
          state={slots[ch]}
          busy={ch === "grab" && mailBusy === "grab-ai"}
          onPasteChange={(v) => setSlot(ch, { paste: v })}
          onClear={() => setSlot(ch, emptySlot())}
          onFile={(f) => void onFile(ch, f)}
          onParsePaste={() => runPreview(ch, slots[ch].paste, "")}
          onGrabImage={(f) => void onGrabImage(f)}
        />
      ))}
    </div>
  );
}
