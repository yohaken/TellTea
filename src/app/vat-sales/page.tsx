"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { VatSalesMailPanel } from "@/components/vat-sales/VatSalesMailPanel";
import { useAuth } from "@/lib/auth";
import { formatPlainNumber } from "@/lib/utils";
import {
  bangkokMonthKey,
  confirmDailySales,
  dateKeysInMonth,
  DELIVERY_CHANNEL_LABELS,
  DELIVERY_CHANNELS,
  emptyDailySales,
  fetchPosStorefrontTotalsByMonth,
  listDailySalesInMonth,
  loadVatSalesSettings,
  recomputeDailyTotals,
  saveVatSalesSettings,
  sourceLabel,
  sumMonthSales,
  unconfirmDailySales,
  upsertDailySales,
  type ChannelAmount,
  type DailySalesDoc,
  type DeliveryChannel,
  type PnlIncomeMode,
  type VatSalesSettings,
} from "@/lib/vat-sales";

type VatTab = "daily" | "mail";

export default function VatSalesPage() {
  return (
    <AuthGate>
      <VatSalesGate />
    </AuthGate>
  );
}

function VatSalesGate() {
  const { staff } = useAuth();
  const router = useRouter();
  const isOwner = staff?.role === "owner";

  useEffect(() => {
    if (staff && !isOwner) router.replace("/more/");
  }, [staff, isOwner, router]);

  if (!isOwner) return null;
  return <VatSalesView actor={staff?.id || staff?.email || "owner"} />;
}

function fmt(n: number) {
  if (!n) return "—";
  return formatPlainNumber(n);
}

function fmtDay(dateKey: string) {
  const [, , d] = dateKey.split("-");
  return d;
}

function moneyInputValue(n: number) {
  return n ? String(n) : "";
}

function parseMoneyInput(raw: string): number {
  const t = raw.trim().replace(/,/g, "");
  if (!t) return 0;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

type DraftRow = {
  shopee: string;
  grab: string;
  lineman: string;
  storefront: string;
  dirty: boolean;
};

function draftsFromDocs(docs: Record<string, DailySalesDoc>): Record<string, DraftRow> {
  const out: Record<string, DraftRow> = {};
  for (const [key, doc] of Object.entries(docs)) {
    out[key] = {
      shopee: moneyInputValue(doc.delivery.shopee.grossInclusive),
      grab: moneyInputValue(doc.delivery.grab.grossInclusive),
      lineman: moneyInputValue(doc.delivery.lineman.grossInclusive),
      storefront: moneyInputValue(doc.storefront.grossInclusive),
      dirty: false,
    };
  }
  return out;
}

function channelFromDraft(
  existing: ChannelAmount,
  raw: string,
): ChannelAmount {
  return {
    ...existing,
    grossInclusive: parseMoneyInput(raw),
  };
}

function VatSalesView({ actor }: { actor: string }) {
  const [tab, setTab] = useState<VatTab>("daily");
  const [month, setMonth] = useState(() => bangkokMonthKey());
  const [docs, setDocs] = useState<Record<string, DailySalesDoc>>({});
  const [drafts, setDrafts] = useState<Record<string, DraftRow>>({});
  const [settings, setSettings] = useState<VatSalesSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [reportEmailsText, setReportEmailsText] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") === "mail") setTab("mail");
    const mail = params.get("mail");
    if (mail === "connected") {
      setTab("mail");
      setMsg("เชื่อม Gmail สำเร็จ");
    } else if (mail === "error") {
      setTab("mail");
      setError(`เชื่อม Gmail ไม่สำเร็จ (${params.get("reason") || "error"})`);
    }
  }, []);

  const dateKeys = useMemo(() => dateKeysInMonth(month), [month]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [monthDocs, vatSettings] = await Promise.all([
        listDailySalesInMonth(month),
        loadVatSalesSettings(),
      ]);
      setDocs(monthDocs);
      setDrafts(draftsFromDocs(monthDocs));
      setSettings(vatSettings);
      setReportEmailsText(vatSettings.reportEmails.join("\n"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const rows = useMemo(
    () => dateKeys.map((k) => docs[k] || emptyDailySales(k)),
    [dateKeys, docs],
  );

  const totals = useMemo(() => sumMonthSales(rows), [rows]);

  const previewRow = useCallback(
    (dateKey: string): DailySalesDoc => {
      const base = docs[dateKey] || emptyDailySales(dateKey);
      const d = drafts[dateKey];
      if (!d) return base;
      const delivery = {
        shopee: channelFromDraft(base.delivery.shopee, d.shopee),
        grab: channelFromDraft(base.delivery.grab, d.grab),
        lineman: channelFromDraft(base.delivery.lineman, d.lineman),
      };
      const storefront = channelFromDraft(base.storefront, d.storefront);
      const recomputed = recomputeDailyTotals({ storefront, delivery });
      return { ...base, storefront, delivery, ...recomputed };
    },
    [docs, drafts],
  );

  const setDraftField = (
    dateKey: string,
    field: "shopee" | "grab" | "lineman" | "storefront",
    value: string,
  ) => {
    setDrafts((prev) => {
      const cur = prev[dateKey] || {
        shopee: "",
        grab: "",
        lineman: "",
        storefront: "",
        dirty: false,
      };
      return {
        ...prev,
        [dateKey]: { ...cur, [field]: value, dirty: true },
      };
    });
  };

  const saveRow = async (dateKey: string) => {
    const base = docs[dateKey] || emptyDailySales(dateKey);
    if (base.status === "confirmed") {
      setError("วันนี้ยืนยันแล้ว — ปลดล็อกก่อนแก้ยอด");
      return;
    }
    const d = drafts[dateKey];
    if (!d) return;
    setBusy(dateKey);
    setError("");
    setMsg("");
    try {
      const delivery: Record<DeliveryChannel, ChannelAmount> = {
        shopee: channelFromDraft(base.delivery.shopee, d.shopee),
        grab: channelFromDraft(base.delivery.grab, d.grab),
        lineman: channelFromDraft(base.delivery.lineman, d.lineman),
      };
      const storefront = channelFromDraft(base.storefront, d.storefront);
      const sources = {
        storefront:
          base.sources.storefront === "pos_suggest" &&
          storefront.grossInclusive === base.storefront.grossInclusive
            ? ("pos_suggest" as const)
            : ("manual" as const),
        shopee: "manual" as const,
        grab: "manual" as const,
        lineman: "manual" as const,
      };
      // keep email source if unchanged later — P1 all manual for delivery
      const saved = await upsertDailySales(
        { dateKey, storefront, delivery, sources },
        actor,
      );
      setDocs((prev) => ({ ...prev, [dateKey]: saved }));
      setDrafts((prev) => ({
        ...prev,
        [dateKey]: {
          shopee: moneyInputValue(saved.delivery.shopee.grossInclusive),
          grab: moneyInputValue(saved.delivery.grab.grossInclusive),
          lineman: moneyInputValue(saved.delivery.lineman.grossInclusive),
          storefront: moneyInputValue(saved.storefront.grossInclusive),
          dirty: false,
        },
      }));
      setMsg(`บันทึก ${dateKey} แล้ว`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const toggleConfirm = async (dateKey: string) => {
    const row = docs[dateKey] || emptyDailySales(dateKey);
    setBusy(dateKey);
    setError("");
    setMsg("");
    try {
      if (row.status !== "confirmed" && drafts[dateKey]?.dirty) {
        const base = docs[dateKey] || emptyDailySales(dateKey);
        const d = drafts[dateKey]!;
        const delivery: Record<DeliveryChannel, ChannelAmount> = {
          shopee: channelFromDraft(base.delivery.shopee, d.shopee),
          grab: channelFromDraft(base.delivery.grab, d.grab),
          lineman: channelFromDraft(base.delivery.lineman, d.lineman),
        };
        const storefront = channelFromDraft(base.storefront, d.storefront);
        await upsertDailySales(
          {
            dateKey,
            storefront,
            delivery,
            sources: {
              storefront:
                base.sources.storefront === "pos_suggest" &&
                storefront.grossInclusive === base.storefront.grossInclusive
                  ? "pos_suggest"
                  : "manual",
              shopee: "manual",
              grab: "manual",
              lineman: "manual",
            },
          },
          actor,
        );
      }
      const next =
        row.status === "confirmed"
          ? await unconfirmDailySales(dateKey, actor)
          : await confirmDailySales(dateKey, actor);
      setDocs((prev) => ({ ...prev, [dateKey]: next }));
      setDrafts((prev) => ({
        ...prev,
        [dateKey]: {
          shopee: moneyInputValue(next.delivery.shopee.grossInclusive),
          grab: moneyInputValue(next.delivery.grab.grossInclusive),
          lineman: moneyInputValue(next.delivery.lineman.grossInclusive),
          storefront: moneyInputValue(next.storefront.grossInclusive),
          dirty: false,
        },
      }));
      setMsg(next.status === "confirmed" ? `ยืนยัน ${dateKey}` : `ปลดล็อก ${dateKey}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const pullPosMonth = async () => {
    if (!window.confirm(`ดึงยอดหน้าร้านจาก POS ทั้งเดือน ${month}? ค่าที่มาจากมือ/เมลจะถามก่อนทับ`)) {
      return;
    }
    setBusy("pos");
    setError("");
    setMsg("");
    try {
      const totalsByDay = await fetchPosStorefrontTotalsByMonth(month);
      let applied = 0;
      let skipped = 0;
      for (const dateKey of dateKeys) {
        const suggested = totalsByDay[dateKey] || 0;
        if (suggested <= 0) continue;
        const row = docs[dateKey] || emptyDailySales(dateKey);
        if (row.status === "confirmed") {
          skipped += 1;
          continue;
        }
        const current = row.storefront.grossInclusive;
        if (current > 0 && current !== suggested && row.sources.storefront !== "pos_suggest") {
          const ok = window.confirm(
            `${dateKey}: มียอดหน้าร้าน ${formatPlainNumber(current)} อยู่แล้ว — ทับด้วย POS ${formatPlainNumber(suggested)}?`,
          );
          if (!ok) {
            skipped += 1;
            continue;
          }
        }
        const saved = await upsertDailySales(
          {
            dateKey,
            storefront: {
              ...row.storefront,
              grossInclusive: suggested,
            },
            sources: { storefront: "pos_suggest" },
          },
          actor,
        );
        setDocs((prev) => ({ ...prev, [dateKey]: saved }));
        setDrafts((prev) => ({
          ...prev,
          [dateKey]: {
            ...(prev[dateKey] || {
              shopee: "",
              grab: "",
              lineman: "",
              storefront: "",
              dirty: false,
            }),
            storefront: moneyInputValue(saved.storefront.grossInclusive),
            dirty: false,
          },
        }));
        applied += 1;
      }
      setMsg(`ดึง POS แล้ว ${applied} วัน · ข้าม ${skipped} วัน`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const saveSettings = async () => {
    if (!settings) return;
    setBusy("settings");
    setError("");
    setMsg("");
    try {
      const emails = reportEmailsText
        .split(/[\n,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const next = await saveVatSalesSettings(
        {
          vatRegistered: settings.vatRegistered,
          pnlIncomeMode: settings.pnlIncomeMode,
          channelsEnabled: settings.channelsEnabled,
          reportEmails: emails,
          mailRules: settings.mailRules,
        },
        actor,
      );
      setSettings(next);
      setReportEmailsText(next.reportEmails.join("\n"));
      setMsg("บันทึกตั้งค่าแล้ว");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const saveMailRulesOnly = async () => {
    if (!settings) return;
    setBusy("mail-rules");
    setError("");
    setMsg("");
    try {
      const next = await saveVatSalesSettings({ mailRules: settings.mailRules }, actor);
      setSettings(next);
      setMsg("บันทึกกฎค้นหาเมลแล้ว");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="vat-sales-page">
      <header className="vat-sales-header">
        <div>
          <h1 className="panel-title">ยอดขาย / VAT</h1>
          <p className="muted vat-sales-lead">
            เดลิเวอรี่ 3 ช่องทาง + หน้าร้าน · คิด VAT 7% จากยอดลูกค้า · เฉพาะเจ้าของ
          </p>
        </div>
        <div className="vat-sales-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            className={tab === "daily" ? "vat-sales-tab is-active" : "vat-sales-tab"}
            aria-selected={tab === "daily"}
            onClick={() => setTab("daily")}
          >
            ตารางรายวัน
          </button>
          <button
            type="button"
            role="tab"
            className={tab === "mail" ? "vat-sales-tab is-active" : "vat-sales-tab"}
            aria-selected={tab === "mail"}
            onClick={() => setTab("mail")}
          >
            กล่องเมล
          </button>
        </div>
      </header>

      {error ? <p className="error-text">{error}</p> : null}
      {msg ? <p className="muted vat-sales-msg">{msg}</p> : null}

      {tab === "mail" ? (
        settings ? (
          <VatSalesMailPanel
            actor={actor}
            settings={settings}
            onSettingsChange={setSettings}
            onSaveMailRules={saveMailRulesOnly}
            busy={busy}
            setBusy={setBusy}
            setError={setError}
            setMsg={setMsg}
          />
        ) : (
          <p className="muted">กำลังโหลด...</p>
        )
      ) : null}

      {tab === "daily" ? (
        <>
        <div className="vat-sales-toolbar" style={{ marginBottom: "0.85rem" }}>
          <label className="vat-sales-month">
            เดือน
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
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
          <button
            type="button"
            className="primary-btn"
            disabled={busy !== null || loading}
            onClick={() => void pullPosMonth()}
          >
            ดึงหน้าร้านจาก POS
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => setShowSettings((v) => !v)}
          >
            {showSettings ? "ซ่อนตั้งค่า" : "ตั้งค่า"}
          </button>
        </div>

      {showSettings && settings ? (
        <section className="vat-sales-settings">
          <h2 className="vat-sales-section-title">ตั้งค่าภาษี / ช่องทาง</h2>
          <label className="check-row">
            <input
              type="checkbox"
              checked={settings.vatRegistered}
              onChange={(e) =>
                setSettings({ ...settings, vatRegistered: e.target.checked })
              }
            />
            จด VAT แล้ว (ใช้เป็นบริบท — ยังไม่ยื่นแบบอัตโนมัติ)
          </label>
          <label className="vat-sales-field">
            รายได้เข้า P&amp;L
            <select
              value={settings.pnlIncomeMode}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  pnlIncomeMode: e.target.value as PnlIncomeMode,
                })
              }
            >
              <option value="exVat">ยอดก่อน VAT (แนะนำ)</option>
              <option value="incVat">ยอดรวม VAT</option>
            </select>
          </label>
          <div className="vat-sales-channels">
            <span className="muted">ช่องทางที่เปิดใช้</span>
            {(
              [
                ["shopee", "ShopeeFood"],
                ["grab", "Grab"],
                ["lineman", "LINE MAN"],
                ["storefront", "หน้าร้าน"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="check-row">
                <input
                  type="checkbox"
                  checked={settings.channelsEnabled[key]}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      channelsEnabled: {
                        ...settings.channelsEnabled,
                        [key]: e.target.checked,
                      },
                    })
                  }
                />
                {label}
              </label>
            ))}
          </div>
          <label className="vat-sales-field">
            อีเมลรับรายงานแพลตฟอร์ม (เตรียมดึงเมล)
            <textarea
              rows={3}
              value={reportEmailsText}
              onChange={(e) => setReportEmailsText(e.target.value)}
              placeholder="one@email.com"
            />
          </label>
          <button
            type="button"
            className="primary-btn"
            disabled={busy !== null}
            onClick={() => void saveSettings()}
          >
            บันทึกตั้งค่า
          </button>
        </section>
      ) : null}

      <section className="vat-sales-summary">
        <div className="vat-sales-summary-card">
          <span className="muted">เดลิเวอรี่</span>
          <strong>{fmt(totals.deliveryGross)}</strong>
          <small className="muted">
            Shopee {fmt(totals.shopee)} · Grab {fmt(totals.grab)} · LINE MAN{" "}
            {fmt(totals.lineman)}
          </small>
        </div>
        <div className="vat-sales-summary-card">
          <span className="muted">หน้าร้าน</span>
          <strong>{fmt(totals.storefrontGross)}</strong>
        </div>
        <div className="vat-sales-summary-card vat-sales-summary-main">
          <span className="muted">ยอดขายร้าน (รวม VAT)</span>
          <strong>{fmt(totals.totalGross)}</strong>
        </div>
        <div className="vat-sales-summary-card">
          <span className="muted">ฐานภาษี</span>
          <strong>{fmt(totals.vatBase)}</strong>
        </div>
        <div className="vat-sales-summary-card">
          <span className="muted">VAT 7%</span>
          <strong>{fmt(totals.vatOutput)}</strong>
        </div>
      </section>

      <p className="muted vat-sales-hint">
        ยอดในช่อง = ยอดที่ลูกค้าจ่าย (รวม VAT) · สูตร: ฐาน = รวม÷1.07 · VAT = รวม−ฐาน · วันยืนยัน{" "}
        {totals.confirmedDays}/{dateKeys.length}
      </p>

      {loading ? (
        <p className="muted">กำลังโหลด...</p>
      ) : (
        <div className="sheet-wrap vat-sales-scroll">
          <table className="sheet-table vat-sales-table">
            <thead>
              <tr>
                <th className="col-date">วัน</th>
                {DELIVERY_CHANNELS.map((ch) => (
                  <th key={ch} className="col-num">
                    {DELIVERY_CHANNEL_LABELS[ch]}
                  </th>
                ))}
                <th className="col-num">รวมส่ง</th>
                <th className="col-num">หน้าร้าน</th>
                <th className="col-num">ยอดร้าน</th>
                <th className="col-num">ฐานภาษี</th>
                <th className="col-num">VAT</th>
                <th>สถานะ</th>
                <th className="col-act">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const dateKey = row.dateKey;
                const draft = drafts[dateKey];
                const preview = previewRow(dateKey);
                const locked = row.status === "confirmed";
                const dayBusy = busy === dateKey;
                return (
                  <tr
                    key={dateKey}
                    className={locked ? "vat-sales-row-confirmed" : undefined}
                  >
                    <td className="col-date">
                      {fmtDay(dateKey)}
                      <div className="vat-sales-src muted">
                        {sourceLabel(row.sources.storefront)}
                      </div>
                    </td>
                    {DELIVERY_CHANNELS.map((ch) => (
                      <td key={ch} className="col-num">
                        <input
                          className="vat-sales-input"
                          inputMode="decimal"
                          disabled={locked || dayBusy}
                          value={draft?.[ch] ?? ""}
                          onChange={(e) => setDraftField(dateKey, ch, e.target.value)}
                          aria-label={`${DELIVERY_CHANNEL_LABELS[ch]} ${dateKey}`}
                        />
                      </td>
                    ))}
                    <td className="col-num">{fmt(preview.deliveryGross)}</td>
                    <td className="col-num">
                      <input
                        className="vat-sales-input"
                        inputMode="decimal"
                        disabled={locked || dayBusy}
                        value={draft?.storefront ?? ""}
                        onChange={(e) =>
                          setDraftField(dateKey, "storefront", e.target.value)
                        }
                        aria-label={`หน้าร้าน ${dateKey}`}
                      />
                    </td>
                    <td className="col-num">
                      <strong>{fmt(preview.totalGross)}</strong>
                    </td>
                    <td className="col-num">{fmt(preview.vatBase)}</td>
                    <td className="col-num">{fmt(preview.vatOutput)}</td>
                    <td>
                      <span
                        className={
                          locked ? "vat-sales-badge ok" : "vat-sales-badge draft"
                        }
                      >
                        {locked ? "ยืนยัน" : draft?.dirty ? "ยังไม่บันทึก" : "ร่าง"}
                      </span>
                    </td>
                    <td className="col-act">
                      <div className="vat-sales-acts">
                        {!locked ? (
                          <button
                            type="button"
                            className="primary-btn vat-sales-act-btn"
                            disabled={dayBusy || busy !== null}
                            onClick={() => void saveRow(dateKey)}
                          >
                            บันทึก
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="ghost-btn vat-sales-act-btn"
                          disabled={dayBusy || busy !== null}
                          onClick={() => void toggleConfirm(dateKey)}
                        >
                          {locked ? "ปลดล็อก" : "ยืนยัน"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="vat-sales-totals-row">
                <td className="col-date">รวม</td>
                <td className="col-num">{fmt(totals.shopee)}</td>
                <td className="col-num">{fmt(totals.grab)}</td>
                <td className="col-num">{fmt(totals.lineman)}</td>
                <td className="col-num">{fmt(totals.deliveryGross)}</td>
                <td className="col-num">{fmt(totals.storefrontGross)}</td>
                <td className="col-num">{fmt(totals.totalGross)}</td>
                <td className="col-num">{fmt(totals.vatBase)}</td>
                <td className="col-num">{fmt(totals.vatOutput)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
        </>
      ) : null}
    </div>
  );
}
