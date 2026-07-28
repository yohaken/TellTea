"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { VatSalesMailPanel } from "@/components/vat-sales/VatSalesMailPanel";
import { VatSalesMonthClosePanel } from "@/components/vat-sales/VatSalesMonthClosePanel";
import { VatSalesReconcilePanel } from "@/components/vat-sales/VatSalesReconcilePanel";
import { VatSalesInputVatPanel } from "@/components/vat-sales/VatSalesInputVatPanel";
import { VatSalesAuditPanel } from "@/components/vat-sales/VatSalesAuditPanel";
import { VatSalesOwnerGuide } from "@/components/vat-sales/VatSalesOwnerGuide";
import { useAuth } from "@/lib/auth";
import { formatPlainNumber } from "@/lib/utils";
import {
  bangkokDateKey,
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
import { listPlatformEmailReportsForMonth } from "@/lib/vat-sales-mail";
import {
  countDayStatuses,
  DAY_OPS_STATUS_LABELS,
  deriveDayOpsStatus,
  groupReportsByDate,
  isActionNeeded,
  type DayOpsStatus,
} from "@/lib/vat-sales-status";

type VatTab = "daily" | "mail" | "recon" | "input" | "close" | "audit";

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
  const [reportsByDate, setReportsByDate] = useState<
    Record<string, import("@/lib/vat-sales-mail").PlatformEmailReport[]>
  >({});
  const [statusFilter, setStatusFilter] = useState<DayOpsStatus | "all" | "action">("all");
  const [highlightDay, setHighlightDay] = useState<string | null>(null);
  const [jumpDay, setJumpDay] = useState("");
  const [minGross, setMinGross] = useState("");
  const [mailFocusDate, setMailFocusDate] = useState<string | null>(null);
  const todayKey = useMemo(() => bangkokDateKey(), []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const t = params.get("tab");
    if (
      t === "mail" ||
      t === "close" ||
      t === "daily" ||
      t === "recon" ||
      t === "input" ||
      t === "audit"
    ) {
      setTab(t);
    }
    const date = params.get("date");
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setMailFocusDate(date);
      if (t === "mail" || !t) setTab("mail");
    }
    const mail = params.get("mail");
    const provider = params.get("provider");
    if (mail === "connected") {
      setTab("mail");
      setMsg(
        provider === "outlook" ? "เชื่อม Outlook สำเร็จ" : "เชื่อม Gmail สำเร็จ",
      );
    } else if (mail === "error") {
      setTab("mail");
      setError(
        `เชื่อม${provider === "outlook" ? " Outlook" : " Gmail"} ไม่สำเร็จ (${params.get("reason") || "error"})`,
      );
    }
  }, []);

  const dateKeys = useMemo(() => dateKeysInMonth(month), [month]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [monthDocs, vatSettings, monthReports] = await Promise.all([
        listDailySalesInMonth(month),
        loadVatSalesSettings(),
        listPlatformEmailReportsForMonth(month).catch(() => []),
      ]);
      setDocs(monthDocs);
      setDrafts(draftsFromDocs(monthDocs));
      setSettings(vatSettings);
      setReportEmailsText(vatSettings.reportEmails.join("\n"));
      setReportsByDate(groupReportsByDate(monthReports));
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

  const dayStatuses = useMemo(() => {
    if (!settings) return {} as Record<string, DayOpsStatus>;
    const out: Record<string, DayOpsStatus> = {};
    for (const k of dateKeys) {
      out[k] = deriveDayOpsStatus(
        k,
        docs[k] || emptyDailySales(k),
        reportsByDate[k] || [],
        settings,
        todayKey,
      );
    }
    return out;
  }, [dateKeys, docs, reportsByDate, settings, todayKey]);

  const statusCounts = useMemo(
    () => countDayStatuses(Object.values(dayStatuses)),
    [dayStatuses],
  );

  const actionDays = useMemo(
    () => dateKeys.filter((k) => isActionNeeded(dayStatuses[k] || "empty")),
    [dateKeys, dayStatuses],
  );

  const totals = useMemo(() => sumMonthSales(rows), [rows]);
  const confirmedTotals = useMemo(
    () => sumMonthSales(rows, { confirmedOnly: true }),
    [rows],
  );

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

  const visibleKeys = useMemo(() => {
    let keys =
      statusFilter === "all"
        ? dateKeys
        : statusFilter === "action"
          ? actionDays
          : dateKeys.filter((k) => dayStatuses[k] === statusFilter);

    if (jumpDay.trim()) {
      const day = jumpDay.trim().padStart(2, "0");
      keys = keys.filter((k) => k.endsWith(`-${day}`) || k === jumpDay.trim());
    }

    const min = Number(String(minGross).replace(/,/g, ""));
    if (Number.isFinite(min) && min > 0) {
      keys = keys.filter((k) => previewRow(k).totalGross >= min);
    }
    return keys;
  }, [dateKeys, statusFilter, dayStatuses, actionDays, jumpDay, minGross, previewRow]);

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

  const confirmAllReady = async () => {
    const ready = dateKeys.filter((k) => dayStatuses[k] === "ready");
    if (ready.length === 0) {
      setError("ไม่มีวันที่สถานะพร้อมยืนยัน");
      return;
    }
    const dirty = ready.filter((k) => drafts[k]?.dirty);
    if (dirty.length > 0) {
      setError(`มี ${dirty.length} วันยังไม่บันทึก — บันทึกก่อนยืนยันทั้งชุด`);
      return;
    }
    if (!window.confirm(`ยืนยันทั้ง ${ready.length} วันที่พร้อมในเดือน ${month}?`)) return;
    setBusy("bulk-confirm");
    setError("");
    setMsg("");
    try {
      let n = 0;
      for (const dateKey of ready) {
        const next = await confirmDailySales(dateKey, actor);
        setDocs((prev) => ({ ...prev, [dateKey]: next }));
        n += 1;
      }
      setMsg(`ยืนยันแล้ว ${n} วัน`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const jumpToDay = () => {
    const raw = jumpDay.trim();
    if (!raw) return;
    const key = raw.includes("-") ? raw : `${month}-${raw.padStart(2, "0")}`;
    setHighlightDay(key);
    const el = document.getElementById(`vat-day-${key}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
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
          alertsEnabled: settings.alertsEnabled,
          alertAfterHourBangkok: settings.alertAfterHourBangkok,
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
          <VatSalesOwnerGuide />
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
          <button
            type="button"
            role="tab"
            className={tab === "recon" ? "vat-sales-tab is-active" : "vat-sales-tab"}
            aria-selected={tab === "recon"}
            onClick={() => setTab("recon")}
          >
            เทียบยอด
          </button>
          <button
            type="button"
            role="tab"
            className={tab === "input" ? "vat-sales-tab is-active" : "vat-sales-tab"}
            aria-selected={tab === "input"}
            onClick={() => setTab("input")}
          >
            ภาษีซื้อ
          </button>
          <button
            type="button"
            role="tab"
            className={tab === "close" ? "vat-sales-tab is-active" : "vat-sales-tab"}
            aria-selected={tab === "close"}
            onClick={() => setTab("close")}
          >
            ปิดเดือน / VAT
          </button>
          <button
            type="button"
            role="tab"
            className={tab === "audit" ? "vat-sales-tab is-active" : "vat-sales-tab"}
            aria-selected={tab === "audit"}
            onClick={() => setTab("audit")}
          >
            ประวัติ
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
            focusDate={mailFocusDate}
          />
        ) : (
          <p className="muted">กำลังโหลด...</p>
        )
      ) : null}

      {tab === "recon" ? (
        <VatSalesReconcilePanel
          month={month}
          onMonthChange={setMonth}
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          setMsg={setMsg}
        />
      ) : null}

      {tab === "input" ? (
        <VatSalesInputVatPanel
          month={month}
          onMonthChange={setMonth}
          actor={actor}
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          setMsg={setMsg}
          outputVat={confirmedTotals.vatOutput}
        />
      ) : null}

      {tab === "close" ? (
        <VatSalesMonthClosePanel
          month={month}
          onMonthChange={setMonth}
          actor={actor}
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          setMsg={setMsg}
        />
      ) : null}

      {tab === "audit" ? (
        <VatSalesAuditPanel
          month={month}
          onMonthChange={setMonth}
          setError={setError}
        />
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
          <button
            type="button"
            className="primary-btn"
            disabled={busy !== null || loading || statusCounts.ready <= 0}
            onClick={() => void confirmAllReady()}
          >
            {busy === "bulk-confirm"
              ? "กำลังยืนยัน..."
              : `ยืนยันทั้งที่พร้อม (${statusCounts.ready})`}
          </button>
          <label className="vat-sales-month">
            ไปวัน
            <input
              inputMode="numeric"
              placeholder="15"
              value={jumpDay}
              onChange={(e) => setJumpDay(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") jumpToDay();
              }}
              style={{ width: "4.5rem" }}
            />
          </label>
          <button type="button" className="ghost-btn" onClick={jumpToDay}>
            กระโดด
          </button>
          <label className="vat-sales-month">
            ยอดร้าน ≥
            <input
              inputMode="decimal"
              placeholder="0"
              value={minGross}
              onChange={(e) => setMinGross(e.target.value)}
              style={{ width: "5.5rem" }}
            />
          </label>
          <label className="vat-sales-month">
            กรองสถานะ
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as typeof statusFilter)
              }
            >
              <option value="all">ทั้งหมด</option>
              <option value="action">ต้องจัดการ</option>
              {(Object.keys(DAY_OPS_STATUS_LABELS) as DayOpsStatus[]).map((s) => (
                <option key={s} value={s}>
                  {DAY_OPS_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
        </div>

      {actionDays.length > 0 ? (
        <section className="vat-sales-action-board">
          <h2 className="vat-sales-section-title">ต้องจัดการ ({actionDays.length} วัน)</h2>
          <div className="vat-sales-action-chips">
            {actionDays.slice(0, 31).map((d) => (
              <button
                key={d}
                type="button"
                className="vat-sales-action-chip"
                onClick={() => {
                  setHighlightDay(d);
                  setStatusFilter("action");
                  const el = document.getElementById(`vat-day-${d}`);
                  el?.scrollIntoView({ behavior: "smooth", block: "center" });
                }}
              >
                {d.slice(8)} · {DAY_OPS_STATUS_LABELS[dayStatuses[d] || "empty"]}
              </button>
            ))}
          </div>
          <p className="muted vat-sales-hint">
            ขาดเมล {statusCounts.missing_mail} · รอตรวจ {statusCounts.pending_review} ·
            parse พัง {statusCounts.parse_error} · ยังไม่ครบ {statusCounts.incomplete} ·
            พร้อมยืนยัน {statusCounts.ready} · ยืนยันแล้ว {statusCounts.confirmed}
          </p>
        </section>
      ) : null}

      <p className="muted vat-sales-hint">
        รายได้ชั่วคราวจากวันยืนยันแล้ว (ยังไม่เข้า P&amp;L จนกดปิดเดือน): ฐานภาษี{" "}
        {fmt(confirmedTotals.vatBase)} · รวม VAT {fmt(confirmedTotals.totalGross)}
      </p>

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
          <label className="check-row">
            <input
              type="checkbox"
              checked={settings.alertsEnabled}
              onChange={(e) =>
                setSettings({ ...settings, alertsEnabled: e.target.checked })
              }
            />
            แจ้งเตือนเจ้าของเมื่อขาดเมล / parse พัง (เฉพาะ owner push)
          </label>
          <label className="vat-sales-field">
            ชั่วโมงแจ้งเตือน (Bangkok)
            <input
              type="number"
              min={0}
              max={23}
              value={settings.alertAfterHourBangkok}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  alertAfterHourBangkok: Number(e.target.value) || 0,
                })
              }
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
        <div className="vat-sales-summary-card">
          <span className="muted">ค่าธรรมเนียม</span>
          <strong>{fmt(totals.feeTotal)}</strong>
        </div>
        <div className="vat-sales-summary-card">
          <span className="muted">ยอดโอนสุทธิ</span>
          <strong>{fmt(totals.netTransferTotal)}</strong>
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
                <th>สถานะวัน</th>
                <th>บันทึก</th>
                <th className="col-act">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {visibleKeys.length === 0 ? (
                <tr>
                  <td colSpan={12} className="empty">
                    ไม่มีวันที่ตรงตัวกรอง
                  </td>
                </tr>
              ) : (
              visibleKeys.map((dateKey) => {
                const row = docs[dateKey] || emptyDailySales(dateKey);
                const draft = drafts[dateKey];
                const preview = previewRow(dateKey);
                const locked = row.status === "confirmed";
                const dayBusy = busy === dateKey;
                const ops = dayStatuses[dateKey] || "empty";
                return (
                  <tr
                    key={dateKey}
                    id={`vat-day-${dateKey}`}
                    className={[
                      locked ? "vat-sales-row-confirmed" : "",
                      highlightDay === dateKey ? "vat-sales-row-highlight" : "",
                      isActionNeeded(ops) ? "vat-sales-row-action" : "",
                    ]
                      .filter(Boolean)
                      .join(" ") || undefined}
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
                      <span className={`vat-ops-badge vat-ops-${ops}`}>
                        {DAY_OPS_STATUS_LABELS[ops]}
                      </span>
                    </td>
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
                        {ops === "pending_review" || ops === "parse_error" || ops === "missing_mail" ? (
                          <button
                            type="button"
                            className="ghost-btn vat-sales-act-btn"
                            onClick={() => {
                              setMailFocusDate(dateKey);
                              setTab("mail");
                            }}
                          >
                            เมล
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
              )}
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
                <td colSpan={3} />
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
